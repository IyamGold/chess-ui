# Rejoin / reconnect hardening

Fixing the four gaps in game rejoin. Server is already the source of truth
(SQLite `rooms` + `game_states`, player tied via `users.id` →
`rooms.white_user_id|black_user_id`). These fixes are about the *client*
recovering cleanly and the DB not accumulating cruft.

## Gap 1 — Stale session shows an error screen (highest user impact)
Repro: persisted `roomId` no longer exists → `fetchRoom()` 404s →
`useOnlineGame` sets `status='error'` (`useOnlineGame.js:34-39`), but the
`online_game_session` localStorage key is never cleared, so reload repeats it.

- [ ] In `useOnlineGame.fetchRoom`, distinguish 404 ("room not found" /
      "game state not found") from transient/network errors.
- [ ] Add an `onRoomGone` callback prop to `useOnlineGame` + `OnlineChessboard`.
- [ ] On 404, call `onRoomGone()` instead of dropping to the error screen.
- [ ] In `App.jsx`, `onRoomGone` clears the online session and returns to the
      list (reuse `handleBackToList`) + shows a brief toast.
- [ ] Keep the error screen only for genuine/transient errors (network, 5xx).

## Gaps 2 + 3 — Deep-linkable `/game/:roomId` (unifies multi-game + direct URL)
Today routing is view-state only (`AppRoutes.jsx` catch-all `/*` → `App`),
and the active online room lives in the single-valued `online_game_session`
localStorage key — so reload only ever restores the last game, and games
aren't shareable/bookmarkable; browser back/forward doesn't map to a game.

Make the URL the source of truth for the active online game:
- [ ] Read `/game/:roomId` param inside `App` (the `/*` route already matches).
      On that path: `view='online'`, `roomId` from the param.
- [ ] Entering an online game → `navigate('/game/' + roomId)`. Leaving → `navigate('/')`.
- [ ] Remove the `online`-view branch of the `online_game_session` hack
      (URL replaces it). Each game gets its own URL → multiple active games each
      restore correctly; back/forward works; refresh restores from URL.
- [ ] Verify deep-link survives login via existing `return_to` guard
      (`App.jsx:187-190`).
- [ ] DECISION NEEDED: waiting-room reload (keep localStorage vs route it too).

## Gap 4 — Abandoned/stale rooms in the DB
Today only `status='waiting'` rooms are reaped after 15 min
(`index.js:106-130`). `playing` and `finished` rooms persist forever.
NOTE: finished games are history (may be published on-chain) — deleting them
may be wrong. DECISION NEEDED on policy.
- [ ] Implement the chosen retention policy in the existing interval job.
- [ ] (Maybe) GameList separates "in progress" from "finished/archived".

## Verification
- [ ] Server tests pass; add coverage for new reaper + 404 path.
- [ ] Manual: reload mid-game restores; two concurrent games each restore via
      their own URL; server-side room delete → client falls back to list with
      toast (no stuck error screen); direct `/game/:id` loads after login.

## Review

Implemented all four gaps. Decisions: full `/game/:roomId` URL routing,
reap-abandoned-keep-finished, waiting room routed too.

Server:
- `server/reaper.js` (new) — extracted + extended the room reaper. Reaps
  `waiting` >15min AND `playing` idle >7d; keeps `finished` (history).
- Bug caught in review: `rooms.updated_at` is NOT bumped per move (only on
  join/game-over), so idle-time is keyed off `game_states.updated_at` (bumped
  every move) via a JOIN — otherwise long active correspondence games would be
  wrongly reaped.
- `server/index.js` — replaced inline waiting-only expiry with `createReaper`.
- `server/test.js` — added `testReaper()` (7 assertions, in-process, controlled
  timestamps; covers the long-active-game-kept case). 64/67 pass; the 3
  failures are pre-existing passkey-bridge tests that need the external passkey
  server (localhost:3000) — unrelated to this change.

Client:
- `useOnlineGame.js` — `fetchRoom` now distinguishes 404 → calls new
  `onRoomGone`; removed dead `roomIdRef`; ref synced via effect (lint clean).
- `OnlineChessboard.jsx` — accepts `onRoomGone`; renders the waiting panel
  (invite code + copy) when `status==='waiting'`, so `/game/:id` covers waiting
  AND playing. The `join` WS event flips to the board.
- `AppRoutes.jsx` — added `/game/:roomId` route.
- `App.jsx` — URL is now source of truth for the active online room
  (`useParams`); removed the single-valued `online_game_session` localStorage
  hack and the `saveOnlineSession` effect; navigation via `navigate('/game/..')`;
  `handleRoomGone` clears + toasts; GameList resume → navigate.
- Deleted `WaitingRoom.jsx` (folded into OnlineChessboard).

Verification: `npm run build` ✓; eslint clean on changed files (remaining
warnings are pre-existing); server suite 64/67 (3 pre-existing env failures).

Not done (out of scope / would need product input):
- GameList does not yet visually separate in-progress vs finished (offered as
  optional; can add if wanted).
- Local AI games ('playing' view) still aren't deep-linkable — only online
  games were in scope.
