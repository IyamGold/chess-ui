# Universal Online Chess — Implementation Todo

---

## Phase 1: Game Server + Room + Agent API

The server IS the agent API. After this phase, any agent can play chess.

### Server Scaffold
- [ ] Create `server/` directory with Express app (`server/index.js`)
- [ ] `npm init` + install dependencies: `express`, `ws`, `better-sqlite3`, `cors`, `uuid`, `express-rate-limit`
- [ ] CORS middleware (allow browser origin + any agent origin)
- [ ] Rate limiting middleware (signup: 5/min per IP, moves: 60/min per token)
- [ ] Basic error handling middleware (consistent JSON error responses)
- [ ] Dev script: `npm run dev` starts server on `:3001` with file watching

### Database (SQLite)
- [ ] Create `server/db.js` — SQLite setup via `better-sqlite3`
- [ ] Schema: `users` table (id, username, token, created_at)
- [ ] Schema: `rooms` table (id, invite_code, white_user_id, black_user_id, status, stockfish_level, time_control, created_at)
- [ ] Schema: `game_states` table (room_id, fen, current_turn, move_history JSON, en_passant, moved_pieces JSON, half_move_clock, position_history JSON, result, updated_at)
- [ ] Auto-create tables on server start (migrations not needed for MVP)

### Auth System
- [ ] `POST /api/auth/signup` — create user with username, generate bearer token, store in SQLite, return `{ token, username }`
- [ ] Username validation: unique, 3-24 chars, alphanumeric + hyphens only
- [ ] `POST /api/auth/token` — bridge endpoint for passkey users: accepts passkey account address, returns game-server bearer token (creates user if first time)
- [ ] Auth middleware: extract + validate `Authorization: Bearer <token>`, attach user to `req.user`
- [ ] Rate limit signup: 5 per minute per IP

### Room System
- [ ] `POST /api/rooms` — create room. Params: `color` (white/black/random), optional `opponent` ("stockfish"), optional `stockfishLevel` (0-20, default 10). Returns `{ roomId, inviteCode, color }`.
- [ ] Invite code generation: 6-char human-readable codes (e.g., `ROOK42`, `PAWN7X`)
- [ ] `POST /api/rooms/join` — join room via invite code. Assigns joiner to empty seat. Returns `{ roomId, color }`.
- [ ] Invite code expiry: 15 minutes if no one joins (server cleans up on check)
- [ ] Room state machine: `waiting` → `playing` → `finished`
- [ ] `GET /api/rooms/:id` — return room info + game state: FEN, current turn, move history, result, legal moves, player info (usernames, colors), `myColor` for authenticated requester
- [ ] Prevent double-join (same user can't fill both seats)

### Game Engine (Server-Side)
- [ ] Copy `moveValidation.js` to `server/` and adapt for Node.js (strip any browser-specific code if any)
- [ ] Copy `constants.js` to `server/` (piece constants, initial board)
- [ ] Implement `boardToFEN()` on server (port from `chessEngine.js`)
- [ ] Implement `fenToBoard()` on server (parse FEN back to board array)
- [ ] Implement `getLegalMoves(board, turn, enPassant, movedPieces)` — returns all legal moves for current player
- [ ] `POST /api/rooms/:id/move` — validate move, update game state, check for game end, persist to SQLite
- [ ] Move format normalization: accept UCI (`e2e4`), dashed (`e2-e4`), spaced (`e2 e4`). Parse all to internal `{from, to}` format.
- [ ] Game end detection (server-side): checkmate, stalemate, 50-move rule, threefold repetition, insufficient material
- [ ] On illegal move: return `{ error: "illegal move", fen, legalMoves: [...] }`
- [ ] Forfeit after 3 consecutive illegal moves from same player

### WebSocket Layer
- [ ] WebSocket server on same port as Express (upgrade handling via `ws`)
- [ ] Connection URL: `ws://host/api/rooms/:id/ws?token=<bearer_token>`
- [ ] On connect: validate token, determine if player or spectator
- [ ] Broadcast events: `move` (from, to, fen, turn), `join` (opponent username), `gameOver` (result), `error`
- [ ] Spectator connections: receive all events but can't make moves
- [ ] Clean up connections when game finishes or client disconnects

### AvE: Agent vs Stockfish
- [ ] Install `stockfish` npm package (or bundle the binary)
- [ ] `StockfishPlayer` class: wraps Stockfish process, implements `getMove(fen)` returning a UCI move
- [ ] When room has `opponent: "stockfish"`: server fills second seat, auto-plays Stockfish moves after each player move
- [ ] Configurable difficulty via `stockfishLevel` (maps to Stockfish skill 0-20)
- [ ] Stockfish move delay: ~1 second (so it feels natural, not instant)

### Testing & Verification
- [ ] Manual test: agent signup → create room → get invite code (via curl)
- [ ] Manual test: second agent joins room via invite code → game starts (via curl)
- [ ] Manual test: two agents play a complete game via REST polling (curl script)
- [ ] Manual test: agent vs Stockfish — agent creates AvE room, makes moves, Stockfish responds
- [ ] Manual test: WebSocket connection receives move events in real-time
- [ ] Manual test: illegal move returns error + legal moves list
- [ ] Manual test: game end (checkmate) detected and result stored

---

## Phase 2: Online Play in the Browser

After this phase, humans can play each other online and spectate agent games.

### Auth Bridge (Browser → Game Server)
- [ ] After passkey login in `App.jsx`, call `POST /api/auth/token` with passkey account address to get game-server token
- [ ] Store game-server token in React state (not localStorage — it's session-scoped)
- [ ] Pass token to online game hooks/components

### New Game Menu
- [ ] Update game list with two entry points: "Play vs Computer" (existing) and "Play Online" (new)
- [ ] "Play Online" screen with two options: "Create Game" and "Join Game"

### Create Game Flow (Browser)
- [ ] Create game form: pick color (white/black/random), optional "vs Stockfish" toggle with difficulty slider
- [ ] On submit: `POST /api/rooms` → show waiting screen with invite code
- [ ] Waiting screen: large invite code display, copy-to-clipboard button, "Waiting for opponent..."
- [ ] WebSocket connection opens on room creation, listens for `join` event
- [ ] On opponent join → transition to playing view

### Join Game Flow (Browser)
- [ ] Join screen: text input for invite code, "Join" button
- [ ] On submit: `POST /api/rooms/join` → get room details
- [ ] On success: open WebSocket → transition to playing view
- [ ] On error (invalid/expired code): show error message

### `useOnlineGame` Hook
- [ ] Create `src/hooks/useOnlineGame.js`
- [ ] Manages WebSocket connection lifecycle (connect, reconnect, cleanup)
- [ ] State: `gameState` (board, turn, moves, result), `myColor`, `opponentJoined`, `isMyTurn`, `connectionStatus`
- [ ] `makeMove(from, to, promotion)` — sends `POST /api/rooms/:id/move`, optimistic local update
- [ ] WebSocket event handlers: `move` → update board, `join` → set opponentJoined, `gameOver` → set result
- [ ] If move rejected by server → revert optimistic update

### Chessboard Integration
- [ ] Add `mode` prop to Chessboard: `"local"` (existing PvE) or `"online"`
- [ ] In online mode: `onSave` replaced by `useOnlineGame.makeMove`
- [ ] Opponent moves arrive via WebSocket → update board state
- [ ] Board auto-flips based on player color (black at bottom if playing black)
- [ ] Disable drag-and-drop when not your turn or when game is over
- [ ] Show opponent's username in the game UI

### Spectator Mode
- [ ] Route or view for spectating: enter room code as non-player
- [ ] Fully read-only Chessboard (no drag-and-drop)
- [ ] "Spectating" indicator in header
- [ ] Live move updates via WebSocket
- [ ] Show both player usernames

### Time Controls (Basic)
- [ ] Server: track remaining time per player in room/game state
- [ ] Server: on each move, deduct elapsed time from moving player, start opponent's clock
- [ ] Server: timeout check — if time <= 0, opponent wins (or draw if insufficient material)
- [ ] Single preset for MVP: 10+0 (10 min per side, no increment)
- [ ] Also support "Unlimited" option (no clock)
- [ ] Browser UI: display clocks above/below the board, ticking in real-time
- [ ] WebSocket event: `timeUpdate` with remaining times (sent periodically or on move)

### Testing & Verification
- [ ] Browser: create room → see invite code → share with another browser tab → both play
- [ ] Browser: join room via code → game starts, moves sync in real-time
- [ ] Browser: play a full game to checkmate, result shows correctly on both sides
- [ ] Browser: spectate an ongoing game (open room as non-player)
- [ ] Browser + Agent: human creates room in browser, agent joins via API, they play together
- [ ] Timer: verify clocks tick correctly and timeout works
- [ ] Auth: passkey login → get game token → all online features work

---

## Phase 3: Social + Discovery

After this phase, players can find each other without sharing codes out-of-band.

### Username Search + Invite
- [ ] `GET /api/users/search?q=<query>` — returns matching usernames (limit 10, fuzzy prefix match)
- [ ] `POST /api/invite` — send game invite to a username. Body: `{ username, color }`
- [ ] Server creates a pending invite in DB, pushes WebSocket notification to recipient if online
- [ ] `GET /api/invites` — list pending invites for authenticated user
- [ ] `POST /api/invites/:id/accept` — accept invite, server creates room, both auto-joined
- [ ] `POST /api/invites/:id/decline` — decline invite, notify sender
- [ ] Browser UI: "Invite Player" option in Play Online screen
- [ ] Search bar with autocomplete dropdown
- [ ] Notification toast: "alice wants to play! [Accept] [Decline]"

### Online Presence
- [ ] Server tracks which users have active WebSocket connections
- [ ] `GET /api/users/search` results include `online: true/false`
- [ ] Browser UI: green/gray dot next to usernames in search results
- [ ] Presence updates pushed to friends/contacts via WebSocket (if we add contacts — maybe skip for now)

### Matchmaking Queue
- [ ] `POST /api/matchmaking/join` — enter the queue (same endpoint for humans and agents)
- [ ] `DELETE /api/matchmaking/leave` — leave the queue
- [ ] Server matches two players FIFO, creates room, assigns colors randomly, notifies both via WebSocket
- [ ] Browser UI: "Quick Match" button → enters queue → "Searching for opponent..." → matched → game starts
- [ ] Agents use same endpoint: `POST /api/matchmaking/join` with bearer token
- [ ] Timeout: if no match in 5 minutes, return from queue with timeout message

### Spectator Links
- [ ] Route: `/watch/:roomId` in the browser app
- [ ] No auth required to spectate public rooms
- [ ] Share link copies to clipboard from the game view
- [ ] Show number of spectators in game UI

### Testing & Verification
- [ ] Search for username → see results → invite → opponent accepts → game starts
- [ ] Quick match: two users both click Quick Match → matched → game starts
- [ ] Quick match: agent joins queue via API → matched with human or another agent
- [ ] Spectator: open `/watch/:roomId` → see live game
- [ ] Online presence: user shows as online in search when connected

---

## Phase 4: Polish + Hardening

After this phase, the platform is production-ready.

### Reconnection Handling
- [ ] Browser: auto-reconnect WebSocket on disconnect (exponential backoff)
- [ ] On reconnect: fetch latest game state from `GET /api/rooms/:id` to resync
- [ ] Server: grace period on disconnect (60 seconds). If player reconnects → game continues.
- [ ] If grace period expires → player forfeits (or option for draw if both agree)
- [ ] UI: "Reconnecting..." indicator when WebSocket is down

### Time Control Selection
- [ ] Room creation supports time control param: `{ "timeControl": "5+3" }`
- [ ] Presets: Bullet (1+0, 2+1), Blitz (3+0, 5+0, 5+3), Rapid (10+0, 15+10), Unlimited
- [ ] Browser UI: time control picker in room creation form
- [ ] Increment support: add N seconds after each move
- [ ] API: time control included in `GET /api/rooms/:id` response

### On-Chain Publishing for Online Games
- [ ] After online game finishes, both players see "Publish on-chain" option
- [ ] Game `.game` file includes: both player usernames, moves, result, timestamps, room ID
- [ ] Public rooms: `.game` file data is fully public on-chain
- [ ] Use existing `usePasskeyPublish` hook for the publish flow
- [ ] Only players in the game can trigger publish (auth check)

### Game History
- [ ] All finished games already in SQLite from Phase 1 — just need the query endpoint
- [ ] `GET /api/games/history?page=1&limit=20` — paginated list of user's past online games
- [ ] Each entry: opponent username, result, move count, date, time control, room ID
- [ ] Browser UI: "Online Games" tab/section in game list
- [ ] Click a finished game → replay mode (step through moves)
- [ ] Link to on-chain record if published

### Move Format Normalization (Robust)
- [ ] SAN parser: `e4` → figure out it's `e2e4` based on board state. `Nf3` → `g1f3`. `Qxd5+` → resolve.
- [ ] Castling variants: `O-O`, `O-O-O`, `0-0`, `0-0-0`, `e1g1`, `e1c1` all accepted
- [ ] Promotion variants: `e8=Q`, `e7e8q`, `e8Q`, `e7e8=Q` all accepted
- [ ] Strip annotations: `!`, `?`, `!!`, `??`, `+`, `#` stripped before parsing
- [ ] Reject truly unparseable input with clear error message

### Testing & Verification
- [ ] Disconnect mid-game → reconnect → game continues from where it left off
- [ ] Disconnect timeout → forfeit works
- [ ] All time control presets work correctly (bullet through unlimited)
- [ ] On-chain publish works for online games
- [ ] Game history shows all past games, replay works
- [ ] SAN moves from various agents parsed correctly (test with known LLM output formats)
- [ ] Server restart → active games resume from SQLite state
