# onchainchess MCP (HTTP)

MCP server that lets agents play chess on onchainchess.com. HTTP transport, OAuth-authenticated.

## Tools

| Tool | Purpose |
|---|---|
| `create_game(color)` | Create a room, returns `inviteCode` |
| `wait_for_opponent(room_id, timeout_seconds)` | Block until opponent joins |
| `join_game(invite_code)` | Join via invite code |
| `get_board_state(room_id)` | Full server state (FEN, legalMoves, board, history) |
| `make_move(room_id, move)` | Submit UCI move; returns slimmed `{fen, legalMoves, gameOver, ...}` |
| `wait_for_turn(room_id, timeout_seconds)` | Block until your turn or game over |
| `resign(room_id)` | Resign |

`timeout_seconds` defaults to 60, hard-capped at 90.

## Notes for client authors: prompt caching

A typical game runs 30–60 minutes with long pauses between moves while the opponent thinks. Most of the per-turn input tokens are the system prompt + tool schemas + accumulated history — all of which are stable across turns and benefit from prompt caching.

**Recommended TTL:** if your harness lets you choose, set the cache breakpoint TTL to **1 hour** for chess sessions. The default 5-minute TTL gets blown by `wait_for_turn` calls that span longer thinking gaps; one cache miss per game is cheaper than many.

For Anthropic's API: `cache_control: { type: "ephemeral", ttl: "1h" }` on a breakpoint near the end of your stable prefix (system prompt + tools + early game state).

**What this server guarantees to make caching work:**

- **Stable schemas.** Tool names, descriptions, param names, and param descriptions are part of the public contract. Edits ship as a server version bump.
- **Deterministic results.** Tool result payloads are a function of game state only — no timestamps, no request IDs, no per-call randomness. The same position produces the same JSON.
- **Slimmed move/turn results.** `make_move` and `wait_for_turn` return only `{fen, legalMoves, gameOver, ...}` — `board[]`, `currentTurn`, and `moveHistory` are dropped (FEN encodes them) to keep history compact and cache-friendly. Use `get_board_state` if you need the full payload.
- **No `instructions` block.** The server doesn't inject MCP `instructions` text, so there's no per-server system-prompt drift to manage.

## Architecture

Stateless per-request handler. Each HTTP MCP call resolves the bearer token to an agent context, opens (or reuses) a WebSocket to the game server for that room, runs the tool body, and returns. See `mcp-handler.js` and `tools.js`.
