import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ChessApiClient, ApiError } from './api-client.js';
import { loadCredentials, saveCredentials } from './auth-store.js';

const serverUrl = process.env.CHESS_SERVER_URL || 'http://localhost:3001';
const client = new ChessApiClient(serverUrl);

const server = new McpServer({
  name: 'onchainchess',
  version: '1.0.0',
});

function requireAuth() {
  const creds = loadCredentials();
  if (!creds) {
    throw new Error('No account found. Use create_account first.');
  }
  return creds;
}

function errorResponse(err) {
  const message = err instanceof ApiError
    ? err.message
    : err.message || 'Unknown error';
  const result = { error: message };
  if (err instanceof ApiError && err.body?.legalMoves) {
    result.legalMoves = err.body.legalMoves;
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: true };
}

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

// 1. create_account
server.tool(
  'create_account',
  'Create a bot account on onchainchess.com. Only needed once — credentials are saved to disk.',
  { username: z.string().min(3).max(32).describe('Username (3-32 chars, alphanumeric + hyphens)') },
  async ({ username }) => {
    try {
      const existing = loadCredentials();
      if (existing) {
        return errorResponse(new Error(`Account already exists: ${existing.username}. Delete ~/.onchainchess-bot to create a new one.`));
      }
      const result = await client.signup(username);
      saveCredentials(result.username, result.token);
      return ok({ username: result.username, message: 'Account created and saved.' });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 2. create_game
server.tool(
  'create_game',
  'Create a new chess game room. Returns an invite code to share with your opponent.',
  { color: z.enum(['white', 'black', 'random']).default('random').describe('Which color to play as') },
  async ({ color }) => {
    try {
      const { token } = requireAuth();
      const room = await client.createRoom(token, color);
      return ok({ roomId: room.id, inviteCode: room.inviteCode, color: room.color });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 3. wait_for_opponent
server.tool(
  'wait_for_opponent',
  'Wait for an opponent to join your game room. Blocks until someone joins or timeout.',
  {
    room_id: z.number().describe('Room ID to wait in'),
    timeout_seconds: z.number().default(300).describe('Max seconds to wait (default 300)'),
  },
  async ({ room_id, timeout_seconds }) => {
    try {
      const { token } = requireAuth();

      // Pre-check: maybe opponent already joined
      const state = await client.getRoomState(token, room_id);
      if (state.status === 'playing') {
        return ok({
          status: 'playing',
          opponent_username: state.white?.username === state.myUsername ? state.black?.username : state.white?.username,
        });
      }

      // Wait via WebSocket
      const msg = await client.waitForEvent(token, room_id, ['join'], timeout_seconds * 1000);
      return ok({
        status: 'playing',
        opponent_username: msg.data?.username,
        opponent_color: msg.data?.color,
      });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 4. join_game
server.tool(
  'join_game',
  'Join an existing game using an invite code.',
  { invite_code: z.string().describe('The invite code shared by the game creator') },
  async ({ invite_code }) => {
    try {
      const { token } = requireAuth();
      const result = await client.joinRoom(token, invite_code);
      return ok({ roomId: result.roomId, color: result.color });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 5. get_board_state
server.tool(
  'get_board_state',
  'Get the current board state, legal moves, and game status.',
  { room_id: z.number().describe('Room ID') },
  async ({ room_id }) => {
    try {
      const { token } = requireAuth();
      const state = await client.getRoomState(token, room_id);
      return ok(state);
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 6. make_move
server.tool(
  'make_move',
  'Make a chess move in UCI format (e.g. "e2e4", "e7e8q" for promotion).',
  {
    room_id: z.number().describe('Room ID'),
    move: z.string().describe('Move in UCI format: source+target+promotion (e.g. "e2e4", "e7e8q")'),
  },
  async ({ room_id, move }) => {
    try {
      const { token } = requireAuth();
      const result = await client.submitMove(token, room_id, move);
      return ok(result);
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 7. wait_for_turn
server.tool(
  'wait_for_turn',
  'Wait for it to be your turn (or game over). Blocks until opponent moves or timeout.',
  {
    room_id: z.number().describe('Room ID'),
    timeout_seconds: z.number().default(300).describe('Max seconds to wait (default 300)'),
  },
  async ({ room_id, timeout_seconds }) => {
    try {
      const { token } = requireAuth();

      // Pre-check: maybe it's already our turn or game is over
      const state = await client.getRoomState(token, room_id);
      if (state.status === 'finished' || state.currentTurn === state.myColor) {
        return ok(state);
      }

      // Wait via WebSocket for move or gameOver
      const msg = await client.waitForEvent(token, room_id, ['move', 'gameOver'], timeout_seconds * 1000);

      if (msg.event === 'gameOver') {
        return ok({ gameOver: true, result: msg.data?.result, reason: msg.data?.reason });
      }

      // After receiving a move event, fetch full state for consistency
      const updated = await client.getRoomState(token, room_id);
      return ok(updated);
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 8. resign
server.tool(
  'resign',
  'Resign the current game.',
  { room_id: z.number().describe('Room ID') },
  async ({ room_id }) => {
    try {
      const { token } = requireAuth();
      const result = await client.resign(token, room_id);
      return ok(result);
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
