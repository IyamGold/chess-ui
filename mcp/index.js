import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ChessApiClient, ApiError, getConnection, closeConnection, closeAllConnections } from './api-client.js';
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

// Wrap a tool handler to auto-refresh on token expiry and retry once
function withAutoRefresh(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.message === 'token_expired') {
        // Attempt token refresh
        const creds = loadCredentials();
        if (!creds) throw err;
        try {
          const result = await client.refresh(creds.token);
          saveCredentials(result.username, result.token);
          // Retry the original handler with refreshed credentials
          return await handler(args);
        } catch (refreshErr) {
          throw new Error('Token expired and refresh failed. Use create_account to re-register.');
        }
      }
      throw err;
    }
  };
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
      return await withAutoRefresh(async () => {
        const { token } = requireAuth();
        const room = await client.createRoom(token, color);
        const conn = getConnection(room.roomId, client.wsUrl, token);
        await conn.ready();
        return ok({ roomId: room.roomId, inviteCode: room.inviteCode, color: room.color });
      })();
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
      return await withAutoRefresh(async () => {
        const { token } = requireAuth();
        const conn = getConnection(room_id, client.wsUrl, token);
        await conn.ready();

        const state = await client.getRoomState(token, room_id);
        if (state.status === 'playing') {
          return ok({
            status: 'playing',
            opponent_username: state.white?.username === state.myUsername ? state.black?.username : state.white?.username,
          });
        }

        const msg = await conn.waitForEvent(['join'], timeout_seconds * 1000);
        return ok({
          status: 'playing',
          opponent_username: msg.data?.username,
          opponent_color: msg.data?.color,
        });
      })();
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
      return await withAutoRefresh(async () => {
        const { token } = requireAuth();
        const result = await client.joinRoom(token, invite_code);
        const conn = getConnection(result.roomId, client.wsUrl, token);
        await conn.ready();
        return ok({ roomId: result.roomId, color: result.color });
      })();
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
      return await withAutoRefresh(async () => {
        const { token } = requireAuth();
        const state = await client.getRoomState(token, room_id);
        return ok(state);
      })();
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
      return await withAutoRefresh(async () => {
        const { token } = requireAuth();
        const result = await client.submitMove(token, room_id, move);
        return ok(result);
      })();
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
      return await withAutoRefresh(async () => {
        const { token } = requireAuth();
        const conn = getConnection(room_id, client.wsUrl, token);
        await conn.ready();

        const state = await client.getRoomState(token, room_id);
        if (state.status === 'finished') {
          closeConnection(room_id);
          return ok(state);
        }
        if (state.currentTurn === state.myColor) {
          return ok(state);
        }

        const msg = await conn.waitForEvent(['move', 'gameOver'], timeout_seconds * 1000);

        if (msg.event === 'gameOver') {
          closeConnection(room_id);
          return ok({ gameOver: true, result: msg.data?.result, reason: msg.data?.reason });
        }

        const updated = await client.getRoomState(token, room_id);
        return ok(updated);
      })();
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
      return await withAutoRefresh(async () => {
        const { token } = requireAuth();
        const result = await client.resign(token, room_id);
        closeConnection(room_id);
        return ok(result);
      })();
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// Prompt: instructs the agent how to play a chess game
server.prompt(
  'play_chess',
  'Instructions for playing a chess game efficiently',
  () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `You are playing chess on onchainchess.com via MCP tools. Follow these rules strictly:

1. SILENT PLAY: Do NOT output any text between moves. No commentary, no analysis, no narration. Just call tools silently.
2. GAME LOOP: After setup (create/join game), repeat: wait_for_turn → make_move. wait_for_turn already returns the full board state (FEN, legal moves, status) — do NOT call get_board_state separately. Do not pause or speak between these calls.
3. ONLY SPEAK when: the game ends (report result), an unrecoverable error occurs, or you need info from the user (like an invite code).
4. Move selection: Pick the best move from legalMoves. Don't explain your reasoning.
5. If a move is rejected, silently retry with a legal move.

Start by asking the user how they want to set up the game, then go silent until it's over.`
      }
    }]
  })
);

// Cleanup persistent connections on exit
process.on('SIGINT', () => { closeAllConnections(); process.exit(0); });
process.on('SIGTERM', () => { closeAllConnections(); process.exit(0); });

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
