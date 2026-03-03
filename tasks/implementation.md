# Phase 1 Implementation Summary

## Overview
Phase 1 adds online multiplayer (PvP) alongside the existing local Stockfish play. Two completely independent paths: local is zero-server (Stockfish WASM in browser, saves to localStorage), online is server-authoritative (Express + SQLite + WebSocket).

## Server Infrastructure

### Express Server (`server/index.js`)
- Runs on port 3001 with CORS for any localhost port
- Rate limiting: 5 signup attempts/min, 60 moves/min per user
- Request logging with timing
- Graceful shutdown (SIGINT handler)
- Stale room cleanup every 5 minutes (waiting rooms older than 15 min)

### Database (`server/db.js`)
- SQLite via `better-sqlite3` — single file, no separate DB server needed
- Tables: `users`, `rooms`, `game_states`
- Foreign key constraints enforced

### Authentication (`server/routes/auth.js`, `server/middleware/auth.js`)
- `POST /api/auth/token` — bridges passkey address + username to a server bearer token
- `POST /api/auth/signup` — standalone username registration
- Bearer token middleware on all `/api/rooms` routes
- Username validation: 3-32 chars, alphanumeric + hyphens

### Room System (`server/routes/rooms.js`)
- `POST /api/rooms` — create room (choose color, opponent type)
- `POST /api/rooms/join` — join by invite code (e.g. ROOK42)
- `GET /api/rooms/:id` — fetch full game state, board, legal moves
- `POST /api/rooms/:id/move` — submit move in UCI format (e.g. "e2e4")
- Invite codes: chess word + 2-digit number (ROOK42, KING07, etc.)
- Illegal move tracking: 3 consecutive illegal moves = forfeit

### WebSocket (`server/ws.js`)
- Server-to-client only (all actions via REST)
- Events: `joined`, `join`, `move`, `gameOver`, `playerConnected`, `playerDisconnected`
- Per-room client tracking with role-based access (player vs spectator)
- Token-authenticated upgrade handshake

### Server Stockfish (`server/chess/stockfishPlayer.js`)
- WASM Stockfish engine running server-side
- Configurable difficulty levels
- Async move generation triggered after player moves

## Frontend — New Files

### Hooks

#### `src/hooks/useServerAuth.js`
- Bridges passkey auth to game server automatically on login
- `POST /api/auth/token` with passkey address + username
- Stores token in `sessionStorage` (re-established each browser session)
- Returns `{ serverToken, isConnected, logout }`

#### `src/hooks/useOnlineGame.js`
- Core hook for managing online game state
- Fetches room state via `GET /api/rooms/:id` on mount
- Opens WebSocket for real-time opponent move/join/gameOver events
- `submitMove(uciStr)` — sends move via REST, re-fetches state
- `getValidMovesForSquare(index)` — filters server legal moves by source square
- Returns board, turn, color, legal moves, history, result, status

### Components

#### `src/components/OnlineChessboard.jsx`
- Self-contained board for online games (does NOT touch `Chessboard.jsx`)
- Reuses `Chessboard.css` and `Piece` component
- Server-driven state: drags check server legal moves, drops submit via REST
- Board flips based on player color (black sees board from their perspective)
- Promotion dialog using client-side `needsPromotion()` for UX only
- Check detection via client-side `isKingInCheck()` on server-provided board
- Sound effects on moves and captures
- Shows "Opponent's turn..." / "White is in check!" / game result banners

#### `src/components/GameSetup.jsx`
- Replaces inline setup JSX from old App.jsx
- Two opponent options: **Local** (browser Stockfish) and **Online** (PvP)
- Color picker (White / Black)
- "Join Game" button (visible when server connected)
- Online option disabled with message when server unreachable

#### `src/components/JoinGame.jsx`
- Invite code text input (auto-uppercase, max 10 chars)
- Joins via `POST /api/rooms/join` with server token
- Error display for invalid/full rooms
- Enter key support

#### `src/components/WaitingRoom.jsx`
- Displays invite code in large styled text after creating an online game
- Copy-to-clipboard button (with fallback for non-HTTPS)
- WebSocket listener for `join` event — auto-transitions to game
- "Cancel" button to abandon

## Frontend — Modified Files

### `src/App.jsx`
- Added `useServerAuth` hook alongside existing `usePasskeyAuth`
- Expanded view states: `'list' | 'setup' | 'playing' | 'join' | 'waiting' | 'online'`
- Online session persistence in `sessionStorage` — survives page reloads
- `handleStartOnline(color)` — creates room, routes to waiting screen
- `handleJoined(roomId)` — routes to online board after joining
- Server token + connection status passed to child components
- "Online" badge in header when server connected
- Existing local play (`view === 'playing'` with `<Chessboard>`) completely unchanged

### `src/App.css`
- Server connection badge (green "Online" pill)
- Opponent picker styles (Local / Online toggle buttons)
- Join game form (centered input with uppercase styling)
- Waiting room (large invite code with dashed border, copy button)
- Online loading/error states
- Disabled button states
- All existing styles untouched

## Bug Fixes
- **FK constraint crash**: Server room expiry was deleting parent `rooms` before child `game_states`, violating foreign key. Fixed by deleting game_states first in a transaction.
- **CORS**: Widened from hardcoded port 5173 to regex matching any localhost port.

## Files NOT Changed
- `src/Chessboard.jsx` — zero modifications, zero risk to local play
- `src/chessEngine.js` — browser Stockfish untouched
- `src/moveValidation.js` — untouched (OnlineChessboard imports only `needsPromotion` and `isKingInCheck`)
- `src/utils/gameManager.js` — untouched (online games don't use localStorage)
- `src/constants.js` — untouched
- `src/Piece.jsx` — untouched
- `src/sounds.js` — untouched

## Architecture Decisions
- **Separate OnlineChessboard**: Parallel component instead of modifying Chessboard.jsx. Eliminates risk of breaking local play.
- **Server-authoritative**: All move validation happens server-side. Client legal moves come from server. Client-side check detection is purely cosmetic.
- **REST for actions, WebSocket for events**: Moves submitted via HTTP POST (reliable, transactional). Real-time updates pushed via WebSocket (low latency).
- **sessionStorage for server token**: Re-established each browser session via passkey. No long-lived tokens stored permanently.
- **SQLite**: Zero-config database, single file, bundled with npm package. Perfect for a game server that doesn't need horizontal scaling.
