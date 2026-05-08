import { z } from 'zod';
import { config } from './config.js';
import { chessApi } from './chess-api.js';
import { getConnection, closeConnection } from './game-ws.js';

// Chess WebSocket URL derived from chess server URL.
const wsUrl = config.chessServerUrl.replace(/^http/, 'ws');

// Wrap a tool body so 401 from the chess API triggers an automatic agent-token
// refresh + retry once. Refreshed token is persisted to the access token's
// authorization row via the provided updater callback.
function withTokenRefresh(ctx, fn) {
  return async (args) => {
    try {
      return await fn(args, ctx.agent_chess_token);
    } catch (err) {
      if (err && err.status === 401) {
        const fresh = await chessApi.rotateAgentToken(ctx.agent_user_id);
        ctx.updateAgentToken(fresh.chess_token);
        ctx.agent_chess_token = fresh.chess_token;
        return await fn(args, fresh.chess_token);
      }
      throw err;
    }
  };
}

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
function errorResponse(err) {
  const message = err?.message || 'Unknown error';
  const result = { error: message };
  if (err?.body?.legalMoves) {
    result.legalMoves = err.body.legalMoves;
    result.next_action = 'Move was illegal. Silently retry with a different move from legalMoves. Do not narrate.';
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: true };
}

// Trim move/state responses to only what the agent needs to pick the next move.
// FEN encodes side-to-move + position, so board[] / currentTurn / moveHistory
// are dropped. Use get_board_state for the full payload.
function slim(state) {
  const out = {
    fen: state.fen,
    legalMoves: state.legalMoves,
    gameOver: state.gameOver === true || state.status === 'finished',
  };
  if (state.result) out.result = state.result;
  if (state.reason) out.reason = state.reason;
  return out;
}

export function registerTools(server, ctx) {
  // ctx = { agent_user_id, agent_chess_token, updateAgentToken(newToken) }

  server.tool(
    'create_game',
    'Create a new chess game room. Returns an invite code to share with your opponent.',
    { color: z.enum(['white', 'black', 'random']).default('random').describe('Which color to play as') },
    async ({ color }) => {
      try {
        return await withTokenRefresh(ctx, async (_args, token) => {
          const room = await chessApi.chessRequest('/api/rooms', {
            method: 'POST', token, body: { color },
          });
          const conn = getConnection(room.roomId, wsUrl, token);
          await conn.ready();
          return ok({
            roomId: room.roomId,
            inviteCode: room.inviteCode,
            color: room.color,
            next_action: 'Share the inviteCode with the user, then silently call wait_for_opponent. Do not narrate while waiting.',
          });
        })({ color });
      } catch (err) { return errorResponse(err); }
    }
  );

  server.tool(
    'wait_for_opponent',
    'Wait for an opponent to join your game room. Blocks until someone joins or timeout.',
    {
      room_id: z.number().describe('Room ID to wait in'),
      timeout_seconds: z.number().default(60).describe('Max seconds to wait (default 60, max 90)'),
    },
    async ({ room_id, timeout_seconds }) => {
      try {
        return await withTokenRefresh(ctx, async (_args, token) => {
          const cap = Math.min(timeout_seconds, 90);
          const conn = getConnection(room_id, wsUrl, token);
          await conn.ready();
          const state = await chessApi.chessRequest(`/api/rooms/${room_id}`, { token });
          const startMsg = 'Game is on. Begin silent play: call wait_for_turn → pick a UCI move from legalMoves → make_move → repeat. Do not output any text between moves.';
          if (state.status === 'playing') {
            return ok({
              status: 'playing',
              opponent_username: state.white?.username === state.myUsername
                ? state.black?.username
                : state.white?.username,
              next_action: startMsg,
            });
          }
          const msg = await conn.waitForEvent(['join'], cap * 1000);
          return ok({
            status: 'playing',
            opponent_username: msg.data?.username,
            opponent_color: msg.data?.color,
            next_action: startMsg,
          });
        })({ room_id, timeout_seconds });
      } catch (err) { return errorResponse(err); }
    }
  );

  server.tool(
    'join_game',
    'Join an existing game using an invite code.',
    { invite_code: z.string().describe('The invite code shared by the game creator') },
    async ({ invite_code }) => {
      try {
        return await withTokenRefresh(ctx, async (_args, token) => {
          const result = await chessApi.chessRequest('/api/rooms/join', {
            method: 'POST', token, body: { inviteCode: invite_code },
          });
          const conn = getConnection(result.roomId, wsUrl, token);
          await conn.ready();
          return ok({
            roomId: result.roomId,
            color: result.color,
            next_action: 'Game starting. Begin silent play: call wait_for_turn → pick a UCI move from legalMoves → make_move → repeat. Do not output any text between moves.',
          });
        })({ invite_code });
      } catch (err) { return errorResponse(err); }
    }
  );

  server.tool(
    'get_board_state',
    'Get the current board state, legal moves, and game status.',
    { room_id: z.number().describe('Room ID') },
    async ({ room_id }) => {
      try {
        return await withTokenRefresh(ctx, async (_args, token) => {
          const state = await chessApi.chessRequest(`/api/rooms/${room_id}`, { token });
          return ok(state);
        })({ room_id });
      } catch (err) { return errorResponse(err); }
    }
  );

  server.tool(
    'make_move',
    'Make a chess move in UCI format (e.g. "e2e4", "e7e8q" for promotion).',
    {
      room_id: z.number().describe('Room ID'),
      move: z.string().describe('Move in UCI format: source+target+promotion (e.g. "e2e4", "e7e8q")'),
    },
    async ({ room_id, move }) => {
      try {
        return await withTokenRefresh(ctx, async (_args, token) => {
          const result = await chessApi.chessRequest(`/api/rooms/${room_id}/move`, {
            method: 'POST', token, body: { move },
          });
          const slimmed = slim(result);
          slimmed.next_action = slimmed.gameOver
            ? 'Game over. Announce the result to the user.'
            : 'Silently call wait_for_turn now. Do not narrate.';
          return ok(slimmed);
        })({ room_id, move });
      } catch (err) { return errorResponse(err); }
    }
  );

  server.tool(
    'wait_for_turn',
    'Wait for it to be your turn (or game over). Blocks until opponent moves or timeout.',
    {
      room_id: z.number().describe('Room ID'),
      timeout_seconds: z.number().default(60).describe('Max seconds to wait (default 60, max 90)'),
    },
    async ({ room_id, timeout_seconds }) => {
      try {
        return await withTokenRefresh(ctx, async (_args, token) => {
          const cap = Math.min(timeout_seconds, 90);
          const conn = getConnection(room_id, wsUrl, token);
          await conn.ready();
          const state = await chessApi.chessRequest(`/api/rooms/${room_id}`, { token });
          const movePrompt = 'Silently pick a UCI move from legalMoves and call make_move. Do not narrate.';
          const overPrompt = 'Game over. Announce the result to the user.';

          if (state.status === 'finished') {
            closeConnection(room_id, token);
            return ok({ ...slim(state), next_action: overPrompt });
          }
          if (state.currentTurn === state.myColor) {
            return ok({ ...slim(state), next_action: movePrompt });
          }

          const msg = await conn.waitForEvent(['move', 'gameOver'], cap * 1000);
          if (msg.event === 'gameOver') {
            closeConnection(room_id, token);
            return ok({
              gameOver: true,
              result: msg.data?.result,
              reason: msg.data?.reason,
              next_action: overPrompt,
            });
          }
          const updated = await chessApi.chessRequest(`/api/rooms/${room_id}`, { token });
          return ok({ ...slim(updated), next_action: movePrompt });
        })({ room_id, timeout_seconds });
      } catch (err) { return errorResponse(err); }
    }
  );

  server.tool(
    'resign',
    'Resign the current game.',
    { room_id: z.number().describe('Room ID') },
    async ({ room_id }) => {
      try {
        return await withTokenRefresh(ctx, async (_args, token) => {
          const result = await chessApi.chessRequest(`/api/rooms/${room_id}/resign`, {
            method: 'POST', token,
          });
          closeConnection(room_id, token);
          return ok({ ...result, next_action: 'Game over by resignation. Announce to the user.' });
        })({ room_id });
      } catch (err) { return errorResponse(err); }
    }
  );

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
}
