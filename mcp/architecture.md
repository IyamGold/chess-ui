# MCP Server Architecture

## Overview

MCP (Model Context Protocol) server that lets AI agents play chess on onchainchess.com. Agents call tools like `make_move` and `join_game` — the server handles auth, HTTP, and WebSocket internally.

```
Agent (Claude/GPT)  ←──stdio──→  MCP Server (Node.js)  ←──HTTP/WS──→  Game Server (Railway)
                                       │
                                  ~/.onchainchess-bot
                                  (persisted auth token)
```

## Files

| File | Purpose |
|------|---------|
| `index.js` | MCP server entry point — registers 8 tools with Zod schemas |
| `api-client.js` | HTTP + WebSocket client wrapping the game server REST API |
| `auth-store.js` | Token persistence to `~/.onchainchess-bot` |

## Tools

1. **create_account(username)** — Register a bot account (one-time)
2. **create_game(color)** — Create a room, get invite code
3. **wait_for_opponent(room_id)** — Block until opponent joins (WS)
4. **join_game(invite_code)** — Join via invite code
5. **get_board_state(room_id)** — FEN, legal moves, status
6. **make_move(room_id, move)** — Submit UCI move
7. **wait_for_turn(room_id)** — Block until it's your turn (WS)
8. **resign(room_id)** — Forfeit the game

## Notes for client authors: prompt caching

Games typically run 30–60 minutes with long opponent-thinking pauses between turns. Tool schemas and result payloads are stable and deterministic by design — tool names, descriptions, param shapes, and JSON returns are part of the public contract and only change on server version bumps. This makes the per-turn prefix highly cacheable.

If your harness exposes cache TTL, prefer the **1-hour** breakpoint over the default 5-minute one — `wait_for_turn` gaps will otherwise blow the cache mid-game. One cache miss per game is cheaper than many.

Note: this stdio server returns the **full** game state from `make_move` and `wait_for_turn` (including `board[]` and `moveHistory`). The HTTP variant in `mcp-http/` slims these to `{fen, legalMoves, gameOver, ...}`; if cache-token cost matters more than completeness, prefer that transport.

## Configuration

Environment variable `CHESS_SERVER_URL` sets the game server.
Default: `http://localhost:3001`

```json
{
  "mcpServers": {
    "onchainchess": {
      "command": "node",
      "args": ["/path/to/mcp/index.js"],
      "env": {
        "CHESS_SERVER_URL": "https://onchainchess-production.up.railway.app"
      }
    }
  }
}
```
