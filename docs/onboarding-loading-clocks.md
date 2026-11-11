# Dark onboarding, loading, 10+0 clocks and supplied pieces

The onboarding keeps its artwork, layout and copy, with the approved black canvas, white branding and green Continue with Login action. Its footer omits “Unaudited” as requested; signed-in demo disclosures remain. The loading screen uses a stationary white knight and three green dots, responds to actual loading state without an artificial delay, and uses static dots for reduced-motion preferences. Short session checks on the onboarding keep the existing button loading state. Failed requests still show the existing recovery/error flows.

## Clock rules

- New human and computer games give each side 600,000 ms, with zero increment.
- White starts when both seats are filled. Waiting for someone to join consumes no time. Computer rooms start when created because both seats are filled immediately.
- Only the active side's time runs. A valid move subtracts elapsed time and switches the active clock. Illegal or wrong-turn requests do not pause or reset it. Choosing a promotion continues to use the mover's time until the promotion move is submitted.
- The first side to reach zero loses on time, as requested. A 250 ms server sweep awards the result without requiring a connected browser or another move. Every read/move/end-game action also settles an expired deadline before proceeding.
- Draw acceptance, resignation, illegal-move forfeits and checkmate freeze both clocks. Late moves or engine replies cannot replace a timeout or an already-finished result.
- SQLite persists both budgets, the active colour and the start timestamp. Closing a tab, leaving the board, disconnecting or restarting the server does not pause the game. A restarted server settles due games before serving requests.
- The browser interpolates a server snapshot for display. It never writes remaining time or decides the winner. Authenticated server-sent events, reconnect/visibility refresh and a single deadline GET keep it in sync. See `game-reliability.md` for the deployment transport repair.
- Existing rooms and browser-saved games without a clock record stay untimed; adding a fresh 10 minutes to a game already in progress would reset its rules.

New Computer matches use the existing server Stockfish service so they have the same authoritative clocks. Legacy browser-saved matches can still be resumed. Searches on the shared Stockfish worker are queued to avoid mixing responses between games. Engine queues and thinking time count against that engine's clock.

## Piece artwork

All twelve original transparent PNGs from the team's ZIP are installed under `public/pieces/`. The board, promotion choices and colour selector share the same numeric-piece mapping in `src/pieceArtwork.js`. King images have crosses; queen images have pointed crowns. Files are copied unchanged, with original filename/hash records in `public/pieces/artwork-manifest.json`. CSS preserves their aspect ratio and removes the old colour filters, hover enlargement and shadow outlines. Existing numeric values, legal moves, promotion rules and click-to-move interaction are unchanged. The wordmark/loading silhouette stays the existing brand mark.

## Deployment and data

Deploy the Chess API on Railway first, then the frontend on Vercel. Both need the merged code for timed matches. The database setup adds `room_clocks` and its index idempotently; existing games are not rewritten. Keep the current persistent `CHESS_DB_PATH`. No new environment variables, domains, dependencies, funds, credentials or Login-provider changes are required. Do not use a client-controlled clock duration in production; the 10-minute budget is fixed in server code.

## Validation

Use Node 22 and the existing installed dependencies:

```sh
npm run build
npm run test:server
npm run test:clocks
npm run test:clocks-ui
npm run test:landing
npm run test:dashboard
npm run test:login
```

The deterministic clock tests use an injected server time source and temporary databases, not a production clock override. Browser checks require Vite on localhost:5190 and Chromium; on Linux set `CHESS_CHROMIUM_EXECUTABLE=/usr/bin/chromium`. The real Login/gameplay regression also needs the local Login and Chess APIs. Testing uses synthetic accounts, virtual passkeys and no real identity documents or funds.
