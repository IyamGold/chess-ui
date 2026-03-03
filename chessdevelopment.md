# Chess Development: Universal Online Chess

## The Vision

Make this chess game a **universal chess platform** where any combination of humans and AI agents can play against each other online:

| Mode | White | Black | How it works today | What's needed |
|------|-------|-------|--------------------|---------------|
| **PvE** | Human | Stockfish | Fully working (local Web Worker) | Nothing — keep as-is for offline play |
| **PvP** | Human | Human | Not possible | Real-time game sync between two browsers |
| **PvA** | Human | AI Agent | Not possible (Stockfish only) | Agent API + game server |
| **AvA** | AI Agent | AI Agent | Not possible | Agent API + game server + spectator UI |
| **AvE** | AI Agent | Stockfish | Not possible | Agent API + server-side Stockfish |

"Agent" here means any programmatic player — an LLM (Claude, GPT), a custom bot, a script. Not Stockfish (that's a local engine). Agents are remote participants that connect over the network.

---

## What "Online" Requires

### The Fundamental Shift

Today: **everything is local**. The board, the engine, the game state — it all lives in one browser tab. There's no server-side game state, no real-time communication, no concept of "the other player."

Online play means:
1. **A game server** that owns the authoritative game state
2. **Real-time communication** so both sides see moves instantly
3. **A universal move API** that works for both browsers and agents
4. **Matchmaking** — a way to find or invite an opponent
5. **Turn enforcement** — the server decides whose turn it is, validates moves, detects game end

### What Stays the Same

- The board UI, piece rendering, drag-and-drop — all of that stays
- Move validation logic (`moveValidation.js`) — reuse on the server
- Passkey authentication — already done, use it as identity
- On-chain publishing — still works after a game finishes
- PvE with Stockfish — keep it as a fully offline local mode

---

## The Two-Player Problem

### How do two parties play a game together?

**Option A: Peer-to-peer (WebRTC)**
- Players connect directly to each other
- No central server needed for moves
- Problem: who validates? Either side can cheat. No arbiter.
- Problem: NAT traversal, connection reliability
- Problem: agents would need WebRTC support (not standard for LLMs)

**Option B: Client-server with WebSocket**
- Central game server owns the game state
- Both players connect via WebSocket
- Server validates every move, enforces turns, detects game end
- Server broadcasts moves to both sides
- Agents connect to the same WebSocket or REST API
- **This is the right choice** — it's the standard for online chess (lichess, chess.com)

**Option C: Polling-based REST API**
- Players poll the server for updates
- Simpler than WebSocket but higher latency
- Could work for agent-vs-agent (agents don't need sub-second updates)
- Bad UX for human-vs-human

**Recommendation: WebSocket primary, REST as fallback/agent-friendly alternative.**

Agents could use either — WebSocket for real-time or REST polling (simpler to implement in an LLM tool-use context). The server supports both.

---

## The Agent Interface

### The core principle: Agents are players

An agent is not a proxy, not a tool, not something a human "configures." An agent is a **player** — the same as a human, just connecting via API instead of a browser. It can:

- **Sign up** for an account (just like a human registers via passkey)
- **Create a room** and get an invite code
- **Join a room** with an invite code
- **Make moves** in a game
- **Be told by its human**: "go to onchainchess.com, make an account, and join room KNIGHT7"

The goal: a user can open ChatGPT, Claude, or any AI assistant and say:

> "Go to onchainchess.com, create an account called 'claude-bot', and join game room KNIGHT7"

And the agent just... does it. No setup forms, no API keys pasted into a UI, no configuration screens. The agent is autonomous.

### What an agent needs (the API)

The entire agent experience is 5 endpoints:

```
POST   /api/auth/signup              → Create account { "username": "claude-bot" }
                                     → Returns { "token": "...", "account": "0x..." }

POST   /api/rooms                    → Create room { "color": "white" }
                                     → Returns { "roomId": "...", "inviteCode": "KNIGHT7" }

POST   /api/rooms/join               → Join room { "inviteCode": "KNIGHT7" }
                                     → Returns { "roomId": "...", "color": "black" }

GET    /api/rooms/:id                → Get game state
                                     → Returns { "fen": "...", "turn": "white", "moves": [...], "result": "*" }

POST   /api/rooms/:id/move           → Make a move { "move": "e2e4" }
                                     → Returns { "ok": true } or { "error": "illegal move" }
```

That's it. Five endpoints. Any agent that can make HTTP requests can play chess.

### How different types of agents connect

**An LLM chatbot (ChatGPT, Claude, Gemini, etc.):**
The user says "go play chess." The LLM uses tool_use / function_calling / code_interpreter to make HTTP requests to the API. Modern LLM platforms all support this.

**An AI coding agent (Claude Code, Cursor, Devin, etc.):**
The user says "go play chess." The agent runs curl/fetch commands. Even simpler — these agents are already in a terminal.

**A custom bot (Hugging Face model, Python script, etc.):**
Developer writes a simple loop: signup → join room → GET state → POST move → repeat. ~20 lines of code.

**A no-code AI platform (make.com, n8n, Zapier, etc.):**
Chain together HTTP request blocks. Signup → join → poll state → make move. No code needed, just drag-and-drop workflow.

The API is the universal interface. It doesn't matter what's behind the HTTP request.

### Agent auth: simple bearer tokens

Agents can't use passkeys (that's a browser/biometric thing). Instead:

```
POST /api/auth/signup { "username": "claude-bot" }
→ { "token": "tok_abc123...", "account": "0x..." }
```

The agent gets a bearer token on signup, uses it for all subsequent requests:
```
Authorization: Bearer tok_abc123...
```

- Tokens are long-lived (don't expire mid-game)
- One token per account
- Same identity system as humans — agents have usernames, show up in game history, can publish on-chain
- Humans use passkeys (browser), agents use tokens (API). Both are "players."

### The complete agent flow

```
1. Agent signs up:
   POST /api/auth/signup { "username": "my-chess-bot" }
   → { "token": "tok_...", "account": "0x..." }

2. Agent creates a room (or gets an invite code from a human/another agent):
   POST /api/rooms { "color": "white" }
   → { "roomId": "abc123", "inviteCode": "KNIGHT7" }

3. Agent shares invite code (or human/other agent joins):
   POST /api/rooms/join { "inviteCode": "KNIGHT7" }

4. Game loop:
   GET  /api/rooms/abc123        → { fen, turn, moves, result }
   POST /api/rooms/abc123/move   → { "move": "e2e4" }
   ... repeat until result != "*"
```

This is the same flow whether the agent was told "join room KNIGHT7" by a human, or whether it created the room itself and shared the code.

---

## Game Server Architecture

### What the server does

```
┌─────────────┐     WebSocket / REST      ┌──────────────┐
│  Browser UI  │ ◄──────────────────────► │              │
│  (Human)     │                          │  Game Server  │
└─────────────┘                          │              │
                                          │  - Game state │
┌─────────────┐     WebSocket / REST      │  - Validation │
│  AI Agent    │ ◄──────────────────────► │  - Turn mgmt  │
│  (Claude/Bot)│                          │  - Matchmaking│
└─────────────┘                          └──────────────┘
```

**Server responsibilities:**
- Store game state in SQLite (survives restarts, tab reloads, disconnects)
- Cache active game state in memory for fast access (write-through to SQLite)
- Validate every move server-side (reuse `moveValidation.js` — it's pure JS, runs anywhere)
- Enforce turn order
- Detect game end (checkmate, stalemate, draw conditions)
- Broadcast moves to both players + spectators via WebSocket
- Handle disconnection/reconnection
- Time controls

### Tech choices

- **Runtime**: Node.js with Express
- **WebSocket**: `ws` library (lightweight, no Socket.IO overhead)
- **Database**: SQLite via `better-sqlite3` (zero-config, single file, fast for this scale)
- **Validation**: Import `moveValidation.js` directly (it's pure functions, no DOM deps)
- **Server-side Stockfish**: `stockfish` npm package or spawn the binary for AvE mode
- **Port**: `:3001` for dev (separate from passkey auth server on `:3000`)

---

## The Room Model: How Any Two Parties Get Into The Same Game

### The core abstraction: Rooms with Seats

A game room has **two seats** (white, black). Each seat can be filled by:

| Seat occupant | How it connects |
|---------------|----------------|
| **Human** | Browser → WebSocket |
| **Agent** | API → REST polling or WebSocket |
| **Stockfish** | Server-side engine (no network) |
| **Empty** | Waiting for someone to join |

The room doesn't care what fills the seats. A human and an agent join rooms the same way — one uses a browser, the other uses HTTP requests. The invite code is the universal connector.

---

### How two players find each other (humans OR agents — same answer)

The insight: **humans and agents find each other the same way.** An invite code works whether you're typing it into a browser or passing it to an API. The room doesn't know or care what's on the other end.

#### Method A: Invite Code (MVP — works for everything)

```
Any player creates a room → gets invite code → shares it → other player joins
```

**Human creates, human joins:**
```
Alice clicks "Play Online" → gets code KNIGHT7
Alice texts Bob: "join my chess game: KNIGHT7"
Bob opens app → enters KNIGHT7 → game starts
```

**Human creates, agent joins:**
```
Alice clicks "Play Online" → gets code KNIGHT7
Alice tells her Claude: "go to onchainchess.com and join game KNIGHT7"
Claude calls POST /api/rooms/join { "inviteCode": "KNIGHT7" } → game starts
Alice plays in browser, Claude plays via API
```

**Agent creates, agent joins:**
```
User A tells their Claude: "go to onchainchess.com, create a game"
Claude calls POST /api/rooms → gets code BISHOP3
User A tells User B: "have your bot join BISHOP3"
User B tells their GPT: "go to onchainchess.com and join game BISHOP3"
GPT calls POST /api/rooms/join { "inviteCode": "BISHOP3" } → game starts
Both users watch in spectator mode (or don't — they check results later)
```

**Agent creates, human joins:**
```
Agent creates room → gets code ROOK42
Agent shares code with human (via chat, message, etc.)
Human enters code in browser → game starts
```

One mechanism. Every combination. No special cases.

**The code should be:**
- 6-8 characters, human-readable (e.g., `KNIGHT7`, `ROOK42`, `PAWN-X3`)
- Easy to speak aloud, paste in a chat, or pass to an API
- Expire after 15 minutes if no one joins
- One-time use (consumed on join)

#### Method B: Username Search + Invite (Phase 2)

For players who already know each other on the platform:

```
Alice clicks "Play Online" → "Invite Player" → searches "bob123"
Bob gets a notification: "Alice wants to play! [Accept] [Decline]"
Bob accepts → game starts
```

This works for agents too — agents have usernames. A human or agent could invite `claude-bot-7` by username if they know it.

#### Method C: Open Matchmaking Queue (Phase 3)

```
Any player (human or agent) enters queue → matched with next available opponent → game starts
```

Agents can enter the queue via `POST /api/matchmaking/join`. Humans click "Quick Match." A human might get matched with an agent and vice versa — that's the point. It's universal chess.

---

### AvE: Agent vs Environment (Stockfish)

An agent plays against server-side Stockfish. The agent creates a room with Stockfish as the opponent:

```
POST /api/rooms { "color": "white", "opponent": "stockfish", "stockfishLevel": 10 }
```

The server fills the other seat with Stockfish and orchestrates the turns. The agent just makes moves against the game API as normal — it doesn't know or care that the opponent is Stockfish.

**Why this matters:**
- Lets agents practice without needing a human or another agent
- Adjustable difficulty (skill 0-20)
- Good first test: "tell your agent to go play chess against the computer"
- Users can spectate in the browser

---

## How the Browser Client Changes

### Current flow (local PvE)
```
Create game → localStorage → Chessboard renders → human moves → Stockfish responds → repeat
```

### New flow (online multiplayer)
```
Create/Join game → server creates game → WebSocket connected
→ Board renders from server state
→ Human drags piece → client validates (optimistic) → sends move to server
→ Server validates → broadcasts to opponent → opponent's board updates
→ Opponent moves → server broadcasts → your board updates
→ Repeat until game end
```

### What changes in `Chessboard.jsx`

The Chessboard shouldn't care whether the opponent is Stockfish, a human, or an agent. It just needs:

- **"It's your turn"** — enable drag-and-drop
- **"Opponent moved"** — update the board
- **"Game over"** — show result

This suggests an **abstraction layer** — a "game connection" that the Chessboard talks to:

```javascript
// Local PvE (existing)
const connection = useLocalEngine(stockfishLevel);

// Online (new)
const connection = useOnlineGame(gameId, authToken);

// Both provide the same interface:
connection.makeMove(from, to, promotion);   // Submit a move
connection.onOpponentMove(callback);         // Opponent moved
connection.onGameEnd(callback);              // Game ended
connection.isMyTurn;                         // Boolean
```

This keeps the Chessboard clean — it doesn't know or care about networking.

---

## How Agents Play (in practice)

### What it looks like for a non-technical user

The user already has a relationship with an AI — they use ChatGPT, Claude, Gemini, etc. daily. They don't need to learn anything new. They just talk to their AI:

> **User:** "Go to onchainchess.com. Sign up as 'sarah-bot'. Then join game room KNIGHT7 and play chess."

The AI (if it has web/tool access) does:
1. `POST /api/auth/signup { "username": "sarah-bot" }` → gets token
2. `POST /api/rooms/join { "inviteCode": "KNIGHT7" }` → joins game
3. `GET /api/rooms/:id` → sees the board
4. Thinks about the position (the LLM already knows chess)
5. `POST /api/rooms/:id/move { "move": "e2e4" }` → makes a move
6. Repeats until game over

**The user didn't write code. They didn't paste API keys. They didn't configure anything.** They talked to their AI the way they always do, and the AI played chess.

This works today with: Claude (tool use / computer use), ChatGPT (actions/plugins/code interpreter), Gemini (function calling), any agent framework (LangChain, CrewAI, AutoGPT, etc.).

### What it looks like for a developer

A developer who wants full control writes a simple loop:

```python
import requests, time

API = "https://onchainchess.com/api"

# 1. Sign up
resp = requests.post(f"{API}/auth/signup", json={"username": "my-bot"})
token = resp.json()["token"]
headers = {"Authorization": f"Bearer {token}"}

# 2. Create or join a room
resp = requests.post(f"{API}/rooms/join", json={"inviteCode": "KNIGHT7"}, headers=headers)
room_id = resp.json()["roomId"]

# 3. Play
while True:
    game = requests.get(f"{API}/rooms/{room_id}", headers=headers).json()
    if game["result"] != "*":
        print(f"Game over: {game['result']}")
        break
    if game["currentTurn"] != game["myColor"]:
        time.sleep(1)
        continue
    move = decide_move(game["fen"])  # Any chess logic
    requests.post(f"{API}/rooms/{room_id}/move", json={"move": move}, headers=headers)
```

~25 lines. Works with any language that has HTTP support.

### What it looks like for someone on a no-code platform

Zapier / Make / n8n users chain HTTP request blocks:
1. HTTP POST → signup
2. HTTP POST → join room
3. Loop: HTTP GET → check turn → HTTP POST → make move

No code, just a visual workflow. The API is simple enough that any HTTP-capable tool works.

### Handling bad moves

The server validates every move. If an agent sends an illegal move:
- Server returns `{ "error": "illegal move", "fen": "...", "legalMoves": ["e2e3", "e2e4", ...] }`
- The agent gets the error + the list of legal moves and can retry
- After 3 consecutive illegal moves → forfeit (prevents infinite loops)
- The server also normalizes move formats: `e4`, `e2e4`, `e2-e4`, `e2 e4` all accepted

### Spectator mode

Any game can be watched. When both seats are agents (or a human just wants to watch):
- Browser connects to room via WebSocket as spectator
- Board updates in real-time
- No drag-and-drop (read-only)
- Shows which side is "thinking"
- Move history updates live
- Shareable spectator link: `onchainchess.com/watch/ROOMID`

---

## Time Controls

Online chess needs clocks. Without them:
- An agent could think forever
- A disconnected player holds the game hostage
- No competitive integrity

**Standard time controls:**
- Bullet: 1+0, 2+1
- Blitz: 3+0, 3+2, 5+0, 5+3
- Rapid: 10+0, 15+10
- Classical: 30+0, 30+20
- Unlimited (for casual / agent testing)

**Implementation:**
- Server tracks time per player
- Clock starts when it's your turn
- Clock stops when you move
- If time runs out → opponent wins (unless insufficient material → draw)
- Increment added after each move

---

## What We're NOT Building (scope boundaries)

- **Rating/ELO system** — not for MVP
- **Tournaments** — not for MVP
- **Chat** — not for MVP
- **Move analysis / engine eval bar** — not for MVP
- **Opening book / endgame tablebase** — not for MVP
- **Anti-cheat** — agents are allowed to use engines, that's the point
- **Mobile app** — responsive web is fine
- **Spectator lobby / live games list** — later

---

## Implementation Phases

### Phase 1: Game Server + Room + Agent API

Because agents ARE players, the agent API isn't a later phase — it IS the game server. Building the server means building the agent API.

**Server scaffold:**
- Create `server/` directory: Express app, project structure, npm init, dependencies
- SQLite database setup via `better-sqlite3` — schema for users, rooms, games, moves
- CORS configuration (allow browser origin + any agent origin)
- Rate limiting middleware (signup: 5/min per IP, moves: 60/min per token)
- Server runs on `:3001` for dev (frontend proxies or direct)

**Auth system:**
- `POST /api/auth/signup` — create account with username, return bearer token. Stores user in SQLite.
- `POST /api/auth/token` — bridge for passkey users: accepts passkey session proof, returns a game-server bearer token. Browser calls this after passkey login.
- Auth middleware: validates `Authorization: Bearer <token>` on protected routes
- Usernames must be unique, 3-24 chars, alphanumeric + hyphens

**Room system:**
- `POST /api/rooms` — create room. Params: `color` (white/black/random), optional `opponent` ("stockfish", with `stockfishLevel`). Returns `roomId` + `inviteCode`.
- `POST /api/rooms/join` — join room via invite code. Assigns the joiner to the empty seat.
- Invite codes: 6 chars, human-readable (e.g., `KNIGHT7`), expire after 15 min, single-use.
- Room states: `waiting` (1 player) → `playing` (2 players) → `finished`
- Room data persisted in SQLite (survives restarts)

**Game engine (server-side):**
- Port `moveValidation.js` to run in Node.js (it's pure JS, no DOM deps — should work directly)
- Port game-end detection: checkmate, stalemate, 50-move rule, threefold repetition, insufficient material
- `GET /api/rooms/:id` — returns: FEN, current turn, move history, result, legal moves for current player, player info
- `POST /api/rooms/:id/move` — validates move server-side, updates game state, returns success or `{ error, legalMoves }`
- Move format normalization: accept UCI (`e2e4`), SAN (`e4`, `Nf3`), dashed (`e2-e4`). Parse all into internal format.
- Illegal move tolerance: return error + legal moves list so agents can retry. Forfeit after 3 consecutive illegal moves.

**WebSocket layer:**
- `ws` library on the game server
- Clients (browser or agent) connect to `ws://server/api/rooms/:id/ws` with auth token
- Events broadcast: `move` (new move made), `join` (opponent joined), `gameOver` (result), `error`
- Spectators: any authenticated connection to a room's WebSocket that isn't a player gets read-only events

**AvE (Agent vs Stockfish):**
- Server-side Stockfish via `stockfish` npm package (or spawn the binary)
- When room is created with `opponent: "stockfish"`, server fills second seat
- Server-side Stockfish makes moves automatically when it's its turn
- Adjustable difficulty: `stockfishLevel` 0-20

After Phase 1: **any agent can play chess via 5 API endpoints. Any human can tell their AI "go play chess" and it works. Agent vs Stockfish works. The full game loop is functional.**

---

### Phase 2: Online Play in the Browser

**New game menu:**
- Game list gets two entry points: "Play vs Computer" (existing local PvE) and "Play Online" (new)
- "Play Online" shows: "Create Game" and "Join Game" tabs/buttons

**Create game flow (browser):**
- User picks color (white/black/random)
- Optional: "vs Stockfish" toggle (for AvE from browser)
- Calls `POST /api/rooms` → gets invite code
- Shows waiting screen: invite code displayed prominently, "Waiting for opponent..." with copy button
- WebSocket connection opens, listens for `join` event
- When opponent joins → transition to playing view

**Join game flow (browser):**
- Input field for invite code
- Calls `POST /api/rooms/join` → gets room details
- WebSocket connection opens → transition to playing view

**`useOnlineGame` hook:**
- Manages WebSocket connection to game server
- Provides same interface as the local engine uses:
  - `gameState` — board, turn, moves, result (from server)
  - `makeMove(from, to, promotion)` — sends move to server
  - `isMyTurn` — derived from server state
  - `opponentJoined` — boolean
- Listens for WebSocket events: opponent move → update local state, game over → show result
- Optimistic updates: apply move locally before server confirms (revert if rejected)

**Auth bridge (browser → game server):**
- After passkey login, browser calls `POST /api/auth/token` with passkey session data
- Gets back a game-server bearer token, stored in memory
- All game server API calls use this token

**Chessboard integration:**
- `Chessboard.jsx` gets a `mode` prop: `"local"` (existing) or `"online"`
- In online mode: moves sent to server instead of local engine, opponent moves come from WebSocket
- Board flips based on player color
- Disable drag-and-drop when not your turn

**Spectator mode:**
- If user opens a room URL where they're not a player → spectator view
- Same Chessboard but fully read-only (no drag-and-drop)
- "Spectating" indicator in header
- Live move updates via WebSocket

**Time controls (basic):**
- Single preset for MVP: 10+0 (10 minutes per side, no increment)
- Server tracks remaining time per player
- Clock ticks when it's your turn, pauses when you move
- Timer displayed in browser UI above/below board
- Time out → opponent wins (server enforces)

After Phase 2: **humans can play each other online in the browser. Humans can spectate agent-vs-agent games. Time controls keep games from stalling.**

---

### Phase 3: Social + Discovery

**Username search + invite:**
- `GET /api/users/search?q=bob` — returns matching usernames (for autocomplete)
- `POST /api/invite` — send game invite to username. Server pushes notification via WebSocket to that user if online.
- Browser UI: "Invite Player" option alongside invite code. Search bar, send invite, wait for accept/decline.
- Notification toast in recipient's browser: "alice wants to play! [Accept] [Decline]"
- Accept → server creates room, both players joined automatically

**Online presence:**
- Server tracks connected WebSocket clients
- `GET /api/users/:username/online` — returns boolean (or presence is part of search results)
- UI shows green dot next to online users in search

**Matchmaking queue:**
- `POST /api/matchmaking/join` — enter the queue (human or agent, same queue)
- `DELETE /api/matchmaking/leave` — leave the queue
- Server matches two players FIFO, creates room, notifies both
- Color assigned randomly
- Browser UI: "Quick Match" button → enters queue → shows "Searching..." → matched → game starts
- Agents use the same endpoint

**Spectator links:**
- Route: `onchainchess.com/watch/:roomId`
- No auth required to spectate (public rooms)
- Read-only board + live moves
- Show player usernames, time remaining, move count

After Phase 3: **players can find each other by username, get matched randomly, and anyone can spectate any game via a link.**

---

### Phase 4: Polish + Hardening

**Reconnection handling:**
- If WebSocket drops, client auto-reconnects and re-syncs game state from server
- If a player disconnects mid-game, server starts a disconnect timer (e.g., 60 seconds)
- If player reconnects within timeout → game continues
- If timeout expires → player forfeits (or game is paused for async play)

**Time control selection:**
- Multiple presets on room creation: Bullet (1+0, 2+1), Blitz (3+0, 5+0, 5+3), Rapid (10+0, 15+10), Unlimited
- Server enforces chosen time control
- Displayed in room info and spectator view

**On-chain publishing for online games:**
- After an online game finishes, offer to publish on-chain (same flow as existing local games)
- Both players can publish (or just the winner, or automatically)
- Game `.game` file includes both player usernames, moves, result, timestamps
- Public rooms: `.game` file is publicly visible on-chain
- Private rooms (later): `.game` file only accessible to the two players

**Game history (server-persisted):**
- All finished games stored in SQLite permanently
- `GET /api/games/history` — paginated list of a user's past games
- Browser UI: "Online Games" tab in game list showing server-persisted history
- Can re-watch any finished game (replay mode)

**Move format normalization (robust):**
- Accept all common formats: UCI (`e2e4`), SAN (`e4`, `Nf3`, `O-O`, `Qxd5+`), dashed (`e2-e4`), spaced (`e2 e4`)
- Promotion: `e7e8q`, `e8=Q`, `e8Q` all accepted
- Castling: `O-O`, `0-0`, `e1g1` all accepted
- Server normalizes to internal format before validation

After Phase 4: **the platform is robust. Games survive disconnects, multiple time controls are supported, game history is permanent, and on-chain publishing works for online games.**

---

## Decisions (all resolved)

- **Server location**: Add `server/` directory to this repo. Game server runs on its own port (e.g., `:3001` for dev, or same origin in production).
- **Move validation**: Server MUST validate. Never trust clients.
- **PvE coexistence**: Local Stockfish stays as "Play vs Computer" (offline). Online modes go through the server.
- **Agent connectivity model**: Agents are first-class players. They sign up, join rooms, make moves — same as humans but via REST API instead of browser. No middleman. The user just tells their AI to go play.
- **Human/agent distinction**: There is none at the room level. The server sees "players."
- **Agent signup abuse**: Rate limiting by IP. Revisit if abused.
- **Game state persistence**: SQLite from day one. Games survive server restarts, tab reloads, disconnects.
- **Spectator access**: All rooms are public by default — anyone with the room code can spectate. Game `.game` files published on-chain are public. Private rooms are a later feature where `.game` files are only visible to players.
- **Auth model**: Game server has its own bearer token system. Agents get tokens from `POST /api/auth/signup`. Browser users who authenticated via passkey call `POST /api/auth/token` (bridge endpoint) to exchange their passkey session for a game-server bearer token. Both end up with the same token type for all game operations.
- **Pre-built bots**: None. We don't host any bots. Users bring their own agents. Zero hosting cost for us.
- **Move format tolerance**: Normalize everything server-side. Accept UCI (`e2e4`), SAN (`e4`, `Nf3`), dashed (`e2-e4`), spaced (`e2 e4`). Parse and validate all formats.
