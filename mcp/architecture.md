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
