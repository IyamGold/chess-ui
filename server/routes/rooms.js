const express = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  createInitialGameState, serializeGameState, deserializeGameState,
  parseMove, isMoveLegal, getLegalMoves, applyMove, getGameResult,
  boardToFEN, indexToAlgebraic
} = require('../chess/gameLogic');

const CHESS_WORDS = ['ROOK', 'KING', 'PAWN', 'MATE', 'MOVE', 'PLAY', 'GAME', 'DRAW'];

function generateInviteCode(db) {
  const checkCode = db.prepare('SELECT id FROM rooms WHERE invite_code = ?');
  for (let attempt = 0; attempt < 20; attempt++) {
    const word = CHESS_WORDS[Math.floor(Math.random() * CHESS_WORDS.length)];
    const num = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    const code = word + num;
    if (!checkCode.get(code)) {
      return code;
    }
  }
  // Fallback to UUID prefix if all collide (extremely unlikely)
  return uuidv4().slice(0, 8).toUpperCase();
}

function createRoomsRouter(db, { broadcast, getStockfishPlayer }) {
  const router = express.Router();

  // Prepared statements
  const insertRoom = db.prepare(`
    INSERT INTO rooms (invite_code, white_user_id, black_user_id, status, is_stockfish, stockfish_level)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertGameState = db.prepare(`
    INSERT INTO game_states (room_id, board, current_turn, move_history, en_passant_target, moved_pieces, half_move_clock, position_history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findRoomByCode = db.prepare('SELECT * FROM rooms WHERE invite_code = ?');
  const findRoomById = db.prepare('SELECT * FROM rooms WHERE id = ?');
  const findGameState = db.prepare('SELECT * FROM game_states WHERE room_id = ?');
  const updateRoomJoin = db.prepare(`
    UPDATE rooms SET white_user_id = ?, black_user_id = ?, status = 'playing', updated_at = datetime('now')
    WHERE id = ?
  `);
  const updateGameState = db.prepare(`
    UPDATE game_states
    SET board = ?, current_turn = ?, move_history = ?, en_passant_target = ?,
        moved_pieces = ?, half_move_clock = ?, position_history = ?, updated_at = datetime('now')
    WHERE room_id = ?
  `);
  const updateRoomResult = db.prepare(`
    UPDATE rooms SET status = 'finished', result = ?, updated_at = datetime('now') WHERE id = ?
  `);
  const findUserById = db.prepare('SELECT id, username FROM users WHERE id = ?');

  // Stockfish system user
  const findStockfishUser = db.prepare("SELECT id FROM users WHERE username = '__stockfish__'");
  const insertStockfishUser = db.prepare("INSERT OR IGNORE INTO users (username, token) VALUES ('__stockfish__', '__stockfish_token__')");

  function getOrCreateStockfishUser() {
    let user = findStockfishUser.get();
    if (!user) {
      insertStockfishUser.run();
      user = findStockfishUser.get();
    }
    return user.id;
  }

  // Track consecutive illegal moves per room per user
  const illegalMoveCounters = new Map(); // `${roomId}:${userId}` -> count

  function getIllegalKey(roomId, userId) {
    return `${roomId}:${userId}`;
  }

  // POST /api/rooms — create a new room
  router.post('/', (req, res) => {
    const { color, opponent, stockfishLevel } = req.body;
    const userId = req.user.id;

    // Determine player's color
    let chosenColor = color;
    if (!chosenColor || chosenColor === 'random') {
      chosenColor = Math.random() < 0.5 ? 'white' : 'black';
    }
    if (chosenColor !== 'white' && chosenColor !== 'black') {
      return res.status(400).json({ error: 'color must be "white", "black", or "random"' });
    }

    const inviteCode = generateInviteCode(db);
    const isStockfish = opponent === 'stockfish' ? 1 : 0;
    const sfLevel = isStockfish ? (stockfishLevel || 10) : null;

    // Check Stockfish availability
    if (isStockfish) {
      const sfPlayer = getStockfishPlayer();
      if (!sfPlayer) {
        return res.status(503).json({ error: 'Stockfish engine is not available on this server' });
      }
    }

    let whiteUserId = chosenColor === 'white' ? userId : null;
    let blackUserId = chosenColor === 'black' ? userId : null;
    let status = 'waiting';

    // If Stockfish opponent, fill the other seat immediately
    if (isStockfish) {
      const sfUserId = getOrCreateStockfishUser();
      if (chosenColor === 'white') {
        blackUserId = sfUserId;
      } else {
        whiteUserId = sfUserId;
      }
      status = 'playing';
    }

    const createRoom = db.transaction(() => {
      const result = insertRoom.run(inviteCode, whiteUserId, blackUserId, status, isStockfish, sfLevel);
      const roomId = result.lastInsertRowid;

      // Initialize game state
      const gs = createInitialGameState();
      const s = serializeGameState(gs);
      insertGameState.run(roomId, s.board, s.current_turn, s.move_history, s.en_passant_target, s.moved_pieces, s.half_move_clock, s.position_history);

      return roomId;
    });

    const roomId = createRoom();

    // If Stockfish plays first (player chose black), trigger Stockfish move
    if (isStockfish && chosenColor === 'black') {
      triggerStockfishMove(roomId);
    }

    res.status(201).json({
      roomId: Number(roomId),
      inviteCode,
      color: chosenColor
    });
  });

  // POST /api/rooms/join — join a room by invite code
  router.post('/join', (req, res) => {
    const { inviteCode } = req.body;
    const userId = req.user.id;

    if (!inviteCode || typeof inviteCode !== 'string') {
      return res.status(400).json({ error: 'inviteCode is required' });
    }

    const room = findRoomByCode.get(inviteCode.toUpperCase());
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.status !== 'waiting') {
      return res.status(400).json({ error: 'Room is no longer accepting players' });
    }

    // Don't let the creator join their own room
    if (room.white_user_id === userId || room.black_user_id === userId) {
      return res.status(400).json({ error: 'You are already in this room' });
    }

    // Assign joiner to empty seat
    let whiteUserId = room.white_user_id;
    let blackUserId = room.black_user_id;
    let myColor;

    if (!whiteUserId) {
      whiteUserId = userId;
      myColor = 'white';
    } else {
      blackUserId = userId;
      myColor = 'black';
    }

    updateRoomJoin.run(whiteUserId, blackUserId, room.id);

    // Broadcast join event
    broadcast(room.id, 'join', {
      userId,
      username: req.user.username,
      color: myColor
    });

    res.json({
      roomId: room.id,
      color: myColor
    });
  });

  // GET /api/rooms — list user's active rooms
  const findUserRooms = db.prepare(`
    SELECT r.*, gs.current_turn, gs.move_history
    FROM rooms r
    JOIN game_states gs ON gs.room_id = r.id
    WHERE (r.white_user_id = ? OR r.black_user_id = ?)
    AND r.status IN ('waiting', 'playing', 'finished')
    ORDER BY r.updated_at DESC
  `);

  router.get('/', (req, res) => {
    const userId = req.user.id;
    const rows = findUserRooms.all(userId, userId);

    const rooms = rows.map(r => {
      const whiteUser = r.white_user_id ? findUserById.get(r.white_user_id) : null;
      const blackUser = r.black_user_id ? findUserById.get(r.black_user_id) : null;
      const moveHistory = r.move_history ? JSON.parse(r.move_history) : [];

      return {
        roomId: r.id,
        inviteCode: r.invite_code,
        status: r.status,
        result: r.result,
        white: whiteUser ? whiteUser.username : null,
        black: blackUser ? blackUser.username : null,
        myColor: r.white_user_id === userId ? 'white' : 'black',
        currentTurn: r.current_turn,
        moveCount: moveHistory.length,
        updatedAt: r.updated_at,
      };
    });

    res.json({ rooms });
  });

  // GET /api/rooms/:id — get room and game state
  router.get('/:id', (req, res) => {
    const roomId = parseInt(req.params.id);
    if (isNaN(roomId)) {
      return res.status(400).json({ error: 'Invalid room ID' });
    }

    const room = findRoomById.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const gsRow = findGameState.get(roomId);
    if (!gsRow) {
      return res.status(404).json({ error: 'Game state not found' });
    }

    const gameState = deserializeGameState(gsRow);
    const fen = boardToFEN(gameState);
    const legalMoves = room.status === 'playing' ? getLegalMoves(gameState) : [];

    // Determine caller's color
    let myColor = null;
    if (req.user.id === room.white_user_id) myColor = 'white';
    else if (req.user.id === room.black_user_id) myColor = 'black';

    // Get player names
    const whiteUser = room.white_user_id ? findUserById.get(room.white_user_id) : null;
    const blackUser = room.black_user_id ? findUserById.get(room.black_user_id) : null;

    res.json({
      roomId: room.id,
      inviteCode: room.invite_code,
      status: room.status,
      isStockfish: !!room.is_stockfish,
      stockfishLevel: room.stockfish_level,
      result: room.result,
      white: whiteUser ? whiteUser.username : null,
      black: blackUser ? blackUser.username : null,
      myColor,
      fen,
      currentTurn: gameState.currentTurn,
      moveHistory: gameState.moveHistory,
      legalMoves,
      board: gameState.board
    });
  });

  // POST /api/rooms/:id/move — submit a move
  router.post('/:id/move', (req, res) => {
    const roomId = parseInt(req.params.id);
    if (isNaN(roomId)) {
      return res.status(400).json({ error: 'Invalid room ID' });
    }

    const { move } = req.body;
    if (!move || typeof move !== 'string') {
      return res.status(400).json({ error: 'move is required (UCI format, e.g. "e2e4")' });
    }

    const parsed = parseMove(move);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid move format. Use UCI notation (e.g. "e2e4", "e7e8q")' });
    }

    // Use a transaction to prevent race conditions
    const submitMove = db.transaction(() => {
      const room = findRoomById.get(roomId);
      if (!room) {
        return { status: 404, body: { error: 'Room not found' } };
      }

      if (room.status !== 'playing') {
        return { status: 400, body: { error: 'Game is not in progress' } };
      }

      // Verify it's this player's turn
      const gsRow = findGameState.get(roomId);
      const gameState = deserializeGameState(gsRow);

      let expectedUserId;
      if (gameState.currentTurn === 'white') {
        expectedUserId = room.white_user_id;
      } else {
        expectedUserId = room.black_user_id;
      }

      if (req.user.id !== expectedUserId) {
        return { status: 403, body: { error: 'Not your turn' } };
      }

      // Check move legality
      const legality = isMoveLegal(gameState, parsed.from, parsed.to, parsed.promotion);

      if (!legality.legal) {
        // Track consecutive illegal moves
        const key = getIllegalKey(roomId, req.user.id);
        const count = (illegalMoveCounters.get(key) || 0) + 1;
        illegalMoveCounters.set(key, count);

        if (count >= 3) {
          // Forfeit the game
          const loser = gameState.currentTurn;
          const result = loser === 'white' ? '0-1' : '1-0';
          updateRoomResult.run(result, roomId);
          illegalMoveCounters.delete(key);

          broadcast(roomId, 'gameOver', { result, reason: 'illegal_move_forfeit' });

          return {
            status: 400,
            body: {
              error: legality.reason,
              forfeit: true,
              result,
              reason: 'Too many consecutive illegal moves (3)'
            }
          };
        }

        const legalMoves = getLegalMoves(gameState);
        return {
          status: 400,
          body: {
            error: legality.reason,
            illegalMoveCount: count,
            legalMoves
          }
        };
      }

      // Reset illegal move counter on legal move
      const key = getIllegalKey(roomId, req.user.id);
      illegalMoveCounters.delete(key);

      // Apply the move
      const newGameState = applyMove(gameState, parsed.from, parsed.to, parsed.promotion);

      // Check game result
      const gameResult = getGameResult(newGameState);

      // Persist to SQLite
      const s = serializeGameState(newGameState);
      updateGameState.run(s.board, s.current_turn, s.move_history, s.en_passant_target, s.moved_pieces, s.half_move_clock, s.position_history, roomId);

      if (gameResult.over) {
        updateRoomResult.run(gameResult.result, roomId);
      }

      const fen = boardToFEN(newGameState);

      const newLegalMoves = gameResult.over ? [] : getLegalMoves(newGameState);

      return {
        status: 200,
        body: {
          ok: true,
          fen,
          move: move,
          board: newGameState.board,
          currentTurn: newGameState.currentTurn,
          moveHistory: newGameState.moveHistory,
          legalMoves: newLegalMoves,
          gameOver: gameResult.over,
          result: gameResult.over ? gameResult.result : undefined,
          reason: gameResult.over ? gameResult.reason : undefined
        },
        newGameState,
        gameResult,
        room
      };
    });

    const txResult = submitMove();
    res.status(txResult.status).json(txResult.body);

    // Post-transaction side effects
    if (txResult.status === 200) {
      // Broadcast move with full state so opponent doesn't need to re-fetch
      // Reuse legalMoves already computed in the transaction
      broadcast(roomId, 'move', {
        move,
        fen: txResult.body.fen,
        board: txResult.newGameState.board,
        currentTurn: txResult.newGameState.currentTurn,
        moveHistory: txResult.newGameState.moveHistory,
        legalMoves: txResult.body.legalMoves
      }, req.user.id);

      if (txResult.gameResult.over) {
        broadcast(roomId, 'gameOver', {
          result: txResult.gameResult.result,
          reason: txResult.gameResult.reason
        });
      }

      // If AvE and now Stockfish's turn, trigger async Stockfish move
      if (!txResult.gameResult.over && txResult.room.is_stockfish) {
        const sfUserId = getOrCreateStockfishUser();
        const nextTurn = txResult.newGameState.currentTurn;
        const nextUserId = nextTurn === 'white' ? txResult.room.white_user_id : txResult.room.black_user_id;
        if (nextUserId === sfUserId) {
          triggerStockfishMove(roomId);
        }
      }
    }
  });

  // Resign
  router.post('/:id/resign', (req, res) => {
    const roomId = parseInt(req.params.id);
    if (isNaN(roomId)) {
      return res.status(400).json({ error: 'Invalid room ID' });
    }

    const submitResign = db.transaction(() => {
      const room = findRoomById.get(roomId);
      if (!room) {
        return { status: 404, body: { error: 'Room not found' } };
      }

      if (room.status !== 'playing') {
        return { status: 400, body: { error: 'Game is not in progress' } };
      }

      const isWhite = req.user.id === room.white_user_id;
      const isBlack = req.user.id === room.black_user_id;

      if (!isWhite && !isBlack) {
        return { status: 403, body: { error: 'You are not a player in this game' } };
      }

      const result = isWhite ? '0-1' : '1-0';
      updateRoomResult.run(result, roomId);

      return {
        status: 200,
        body: { ok: true, result },
        result,
        resignedColor: isWhite ? 'white' : 'black'
      };
    });

    const txResult = submitResign();
    res.status(txResult.status).json(txResult.body);

    if (txResult.status === 200) {
      broadcast(roomId, 'gameOver', {
        result: txResult.result,
        reason: 'resignation'
      });
    }
  });

  // Async Stockfish move
  function triggerStockfishMove(roomId) {
    setTimeout(async () => {
      try {
        const sfPlayer = getStockfishPlayer();
        if (!sfPlayer) return;

        const room = findRoomById.get(roomId);
        if (!room || room.status !== 'playing') return;

        const gsRow = findGameState.get(roomId);
        const gameState = deserializeGameState(gsRow);
        const fen = boardToFEN(gameState);

        const bestMove = await sfPlayer.getBestMove(fen, room.stockfish_level);
        if (!bestMove) return;

        const moveStr = bestMove.from + bestMove.to + (bestMove.promotion || '');

        // Apply Stockfish's move within a transaction
        const sfSubmit = db.transaction(() => {
          // Re-read to avoid stale state
          const freshGsRow = findGameState.get(roomId);
          const freshGameState = deserializeGameState(freshGsRow);

          const parsed = parseMove(moveStr);
          if (!parsed) return null;

          const legality = isMoveLegal(freshGameState, parsed.from, parsed.to, parsed.promotion);
          if (!legality.legal) {
            console.error(`Stockfish made illegal move: ${moveStr} — ${legality.reason}`);
            return null;
          }

          const newGameState = applyMove(freshGameState, parsed.from, parsed.to, parsed.promotion);
          const gameResult = getGameResult(newGameState);

          const s = serializeGameState(newGameState);
          updateGameState.run(s.board, s.current_turn, s.move_history, s.en_passant_target, s.moved_pieces, s.half_move_clock, s.position_history, roomId);

          if (gameResult.over) {
            updateRoomResult.run(gameResult.result, roomId);
          }

          return { newGameState, gameResult, moveStr };
        });

        const result = sfSubmit();
        if (!result) return;

        const newFen = boardToFEN(result.newGameState);

        broadcast(roomId, 'move', {
          move: result.moveStr,
          fen: newFen,
          currentTurn: result.newGameState.currentTurn,
          moveHistory: result.newGameState.moveHistory
        });

        if (result.gameResult.over) {
          broadcast(roomId, 'gameOver', {
            result: result.gameResult.result,
            reason: result.gameResult.reason
          });
        }
      } catch (err) {
        console.error('Stockfish move error:', err);
      }
    }, 100); // Small delay to let the HTTP response complete first
  }

  return router;
}

module.exports = { createRoomsRouter };
