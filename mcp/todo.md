# MCP Server — TODO

## Completed
- [x] Add resign endpoint to server (`POST /api/rooms/:id/resign`)
- [x] Create `mcp/package.json` with dependencies
- [x] Create `mcp/auth-store.js` — token persistence
- [x] Create `mcp/api-client.js` — HTTP + WebSocket client
- [x] Create `mcp/index.js` — MCP server with 8 tools
- [x] `npm install` succeeds
- [x] MCP server starts and lists all tools

## Testing
- [ ] End-to-end: create account → create game → join from browser → play moves → resign
- [ ] Test wait_for_opponent with real WebSocket
- [ ] Test wait_for_turn with real WebSocket
- [ ] Test error cases (bad auth, illegal moves, expired rooms)

## Future
- [ ] Add `offer_draw` / `accept_draw` tools
- [ ] Add `list_games` tool to see active/past games
- [ ] Add reconnection logic for dropped WebSocket connections
