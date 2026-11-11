# Game responsiveness and loading repair

The approved onboarding, pieces, board and dark theme are retained. The repair replaces the browser's competing game update paths; it does not add another game implementation or a polling loop.

## Findings and changes

- **Production transport mismatch:** the browser opened a WebSocket on its current host. Vite forwards upgrades locally, but the Vercel deployment uses an external HTTP API rewrite. Browser gameplay now uses native EventSource at `/api/rooms/:id/events`, through the existing same-origin authenticated HTTP proxy. Reconnect and initial stream opening both read the current room, covering events missed while connecting. Existing server WebSockets remain for agent/API clients. SSE uses the existing session middleware, checks session validity on broadcasts/heartbeats, cleans up disconnected subscribers, and closes backpressured streams so native reconnect can resync. No tokens are placed in URLs and no direct third-party browser cookie connection is introduced.
- **State races:** independent board/turn/history/clock setters allowed delayed GET or move responses to undo newer engine updates. All accepted snapshots now share a single update path, ordered by move history, terminal result and server clock timestamp. Superseded reads are aborted/invalidated. Move submissions have a synchronous pending guard. Optimistic previews include castling, en passant and the selected promotion piece; rejection resyncs the authoritative board.
- **Loading failures:** an initial error with no board previously matched the loader condition before the error UI. It now offers Retry and Back to Games. Temporary background failures retain the board. Game API requests have a 15-second deadline and handle proxy HTML errors. Session refresh failure preserves an already-known session; an actual 401 still clears it. Game-end sound runs in an effect rather than during render. Connection notices stay in normal layout and do not obstruct the game menu.
- **Engine latency and failures:** the shared worker previously spent a fixed 1,000 ms per search, plus an extra 100 ms route delay. Four queued searches took about four seconds. The default search budget is now 150 ms with the existing skill level, and the extra delay is removed. Shorter thinking trades some search depth for responsiveness. Searches still serialize; each room has at most one pending engine job. Worker initialization/search listeners and timers are cleaned up on completion, timeout, exit or shutdown. A failed worker is terminated before retrying that game's position once; a late bestmove cannot spill into another game. Exhausted retries report an engine error rather than silently leaving the player waiting.
- **Clocks and deployment mismatch:** “Untimed” means no clock data, rather than a frozen countdown. Since the supplied current server creates clocks for every new game, the report of a brand-new Untimed game points to a deployed API/version mismatch; live hosting could not be inspected from this environment. `/api/health` now advertises `gameProtocol: 2`, `timeControl: "10+0"`, `events: "sse"`. Creating a new match checks these capabilities first and gives a recoverable service-update message for an older API. Existing legitimate untimed rooms/saves remain untimed. Only the running clock schedules display updates, aligned to seconds, and ticking pauses while hidden. The server remains solely responsible for timeouts, persistence and results.

## Deployment

1. Merge and deploy this commit to the **Chess API on Railway**, preserving its persistent database and existing Login configuration.
2. Deploy the same commit to the **Chess frontend on Vercel**.
3. Check `/api/health` directly on the Chess API and through the frontend domain. Both must show `gameProtocol: 2`, `timeControl: "10+0"`, and `events: "sse"`.
4. In a fresh computer game, verify both clocks begin at 10:00, the engine replies and time changes sides. Test a fresh two-player room, reconnect/background/foreground, and a completed game. In the browser Network panel, `/api/rooms/<id>/events` should be a streaming `text/event-stream` response. Healthy idle games should not repeatedly GET room state; event/visibility/reconnect/deadline resyncs are intentional.

No new dependencies, environment variables, providers, domains, Login-provider changes or database migrations are needed. The existing API rewrite stays in place. Deploying only the frontend will not update the server's clocks or transport. The local proxy test verifies streaming HTTP without WebSocket upgrade support; actual Vercel/Railway buffering and deployment versions still need the post-deployment check above. This remains a shared single-worker engine, not an unlimited-concurrency service; queue time still counts against the engine's clock.

## Validation

Use the project's Node 22 installation and existing dependencies:

```sh
npm run build
npm run test:server
npm run test:clocks
npm run test:reliability
npm run test:reliability-ui
npm run test:clocks-ui
npm run test:dashboard
npm run test:landing
npm run test:login
```

Browser checks need the local frontend on localhost:5190. The full Login regression also needs the isolated local Login/Chess APIs. On Linux, set `CHESS_CHROMIUM_EXECUTABLE=/usr/bin/chromium`. Tests use synthetic users, virtual passkeys and temporary databases.

Measured on this local test machine with four simultaneous starting-position searches on one worker: original completion times were 1,004 / 2,009 / 3,013 / 4,018 ms; repaired completion times were 155 / 309 / 463 / 616 ms. These are engine timings, not claims about production network latency or move strength.
