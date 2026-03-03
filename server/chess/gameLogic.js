const {
  PIECE_TYPES, COLORS, INITIAL_BOARD, PIECE_TO_FEN,
  isWhitePiece, isBlackPiece, getPieceColor
} = require('./constants');

const {
  indexToRowCol, rowColToIndex,
  isValidPawnMove, isValidKnightMove, isValidBishopMove,
  isValidRookMove, isValidQueenMove, isValidKingMove,
  isKingInCheck, isSquareUnderAttack,
  getEnPassantTarget, needsPromotion,
  isInsufficientMaterial, generatePositionKey
} = require('./moveValidation');

// --- Algebraic notation conversion (ported from chessEngine.js) ---

function indexToAlgebraic(index) {
  const { row, col } = indexToRowCol(index);
  const file = String.fromCharCode(97 + col); // 'a' to 'h'
  const rank = 8 - row;
  return file + rank;
}

function algebraicToIndex(alg) {
  const col = alg.charCodeAt(0) - 97; // 'a' = 0
  const rank = parseInt(alg[1]);
  const row = 8 - rank;
  return rowColToIndex(row, col);
}

// --- FEN generation (ported from chessEngine.js) ---

function boardToFEN(gameState) {
  const { board, currentTurn, halfMoveClock, enPassantTarget, movedPieces } = gameState;
  let fen = '';

  // Piece placement
  for (let row = 0; row < 8; row++) {
    let emptyCount = 0;
    for (let col = 0; col < 8; col++) {
      const piece = board[row * 8 + col];
      if (piece === 0) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          fen += emptyCount;
          emptyCount = 0;
        }
        fen += PIECE_TO_FEN[piece] || '?';
      }
    }
    if (emptyCount > 0) {
      fen += emptyCount;
    }
    if (row < 7) fen += '/';
  }

  // Active color
  fen += ' ' + (currentTurn === COLORS.WHITE ? 'w' : 'b');

  // Castling availability
  let castling = '';
  // White kingside: king on e1 (60) and rook on h1 (63) haven't moved
  if (!movedPieces.has(60) && !movedPieces.has(63) && board[60] === PIECE_TYPES.KING && board[63] === PIECE_TYPES.ROOK) castling += 'K';
  // White queenside: king on e1 (60) and rook on a1 (56) haven't moved
  if (!movedPieces.has(60) && !movedPieces.has(56) && board[60] === PIECE_TYPES.KING && board[56] === PIECE_TYPES.ROOK) castling += 'Q';
  // Black kingside: king on e8 (4) and rook on h8 (7) haven't moved
  if (!movedPieces.has(4) && !movedPieces.has(7) && board[4] === -PIECE_TYPES.KING && board[7] === -PIECE_TYPES.ROOK) castling += 'k';
  // Black queenside: king on e8 (4) and rook on a8 (0) haven't moved
  if (!movedPieces.has(4) && !movedPieces.has(0) && board[4] === -PIECE_TYPES.KING && board[0] === -PIECE_TYPES.ROOK) castling += 'q';
  fen += ' ' + (castling || '-');

  // En passant target
  fen += ' ' + (enPassantTarget !== null ? indexToAlgebraic(enPassantTarget) : '-');

  // Halfmove clock
  fen += ' ' + halfMoveClock;

  // Fullmove number (derive from move history length)
  const fullMove = Math.floor((gameState.moveHistory || []).length / 2) + 1;
  fen += ' ' + fullMove;

  return fen;
}

// --- Move parsing ---

function parseMove(moveStr) {
  if (!moveStr || typeof moveStr !== 'string') return null;

  // Normalize: remove spaces, dashes, lowercase
  const clean = moveStr.replace(/[\s\-]/g, '').toLowerCase();

  // UCI format: e2e4, e7e8q (with optional promotion)
  const uciMatch = clean.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (uciMatch) {
    return {
      from: algebraicToIndex(uciMatch[1]),
      to: algebraicToIndex(uciMatch[2]),
      promotion: uciMatch[3] || null
    };
  }

  return null;
}

// --- Move legality check ---

function isMoveLegal(gameState, from, to, promotion) {
  const { board, currentTurn, enPassantTarget, movedPieces } = gameState;
  const piece = board[from];

  // Must have a piece at source
  if (piece === 0) {
    return { legal: false, reason: 'No piece at source square' };
  }

  // Must be the correct color's turn
  const pieceColor = getPieceColor(piece);
  if (pieceColor !== currentTurn) {
    return { legal: false, reason: 'Not your piece' };
  }

  // Can't capture own piece
  const targetPiece = board[to];
  if (targetPiece !== 0 && getPieceColor(targetPiece) === currentTurn) {
    return { legal: false, reason: 'Cannot capture your own piece' };
  }

  const pieceType = Math.abs(piece);
  let isValid = false;

  // Dispatch to piece-specific validation
  switch (pieceType) {
    case PIECE_TYPES.PAWN:
      isValid = isValidPawnMove(board, from, to, enPassantTarget);
      break;
    case PIECE_TYPES.KNIGHT:
      isValid = isValidKnightMove(board, from, to);
      break;
    case PIECE_TYPES.BISHOP:
      isValid = isValidBishopMove(board, from, to);
      break;
    case PIECE_TYPES.ROOK:
      isValid = isValidRookMove(board, from, to);
      break;
    case PIECE_TYPES.QUEEN:
      isValid = isValidQueenMove(board, from, to);
      break;
    case PIECE_TYPES.KING: {
      // For castling, check if king has moved AND if rook has moved
      const kingHasMoved = movedPieces.has(from);
      const { row: fromRow, col: fromCol } = indexToRowCol(from);
      const { col: toCol } = indexToRowCol(to);
      const colDiff = Math.abs(toCol - fromCol);

      if (colDiff === 2 && !kingHasMoved) {
        // Castling attempt - also need to check rook hasn't moved
        const direction = toCol > fromCol ? 1 : -1;
        const rookCol = direction === 1 ? 7 : 0;
        const rookIndex = rowColToIndex(fromRow, rookCol);
        if (movedPieces.has(rookIndex)) {
          return { legal: false, reason: 'Rook has already moved' };
        }
      }

      isValid = isValidKingMove(board, from, to, kingHasMoved);
      break;
    }
  }

  if (!isValid) {
    return { legal: false, reason: 'Invalid move for this piece' };
  }

  // Simulate move and check if own king is in check
  const testBoard = [...board];
  testBoard[to] = piece;
  testBoard[from] = 0;

  // Handle en passant capture in simulation
  if (pieceType === PIECE_TYPES.PAWN && to === enPassantTarget) {
    const { row: toRow, col: toCol } = indexToRowCol(to);
    const capturedPawnRow = isWhitePiece(piece) ? toRow + 1 : toRow - 1;
    testBoard[rowColToIndex(capturedPawnRow, toCol)] = 0;
  }

  const isWhite = currentTurn === COLORS.WHITE;
  if (isKingInCheck(testBoard, isWhite)) {
    return { legal: false, reason: 'Move would leave king in check' };
  }

  // Check promotion requirements
  if (needsPromotion(piece, to)) {
    if (!promotion) {
      return { legal: false, reason: 'Promotion piece required (q, r, b, n)' };
    }
    const validPromotions = ['q', 'r', 'b', 'n'];
    if (!validPromotions.includes(promotion)) {
      return { legal: false, reason: 'Invalid promotion piece. Must be q, r, b, or n' };
    }
  }

  return { legal: true };
}

// --- Generate all legal moves ---

function getLegalMoves(gameState) {
  const { board, currentTurn } = gameState;
  const isWhite = currentTurn === COLORS.WHITE;
  const moves = [];

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (piece === 0) continue;
    if (isWhite && !isWhitePiece(piece)) continue;
    if (!isWhite && !isBlackPiece(piece)) continue;

    for (let to = 0; to < 64; to++) {
      if (from === to) continue;

      // For pawn promotions, try queen promotion as default check
      const pieceType = Math.abs(piece);
      let promotion = null;
      if (pieceType === PIECE_TYPES.PAWN && needsPromotion(piece, to)) {
        promotion = 'q'; // Check with queen; other promotions are also legal
      }

      const result = isMoveLegal(gameState, from, to, promotion);
      if (result.legal) {
        const uci = indexToAlgebraic(from) + indexToAlgebraic(to);
        if (pieceType === PIECE_TYPES.PAWN && needsPromotion(piece, to)) {
          // Add all promotion variants
          moves.push(uci + 'q');
          moves.push(uci + 'r');
          moves.push(uci + 'b');
          moves.push(uci + 'n');
        } else {
          moves.push(uci);
        }
      }
    }
  }

  return moves;
}

// --- Apply a move to game state (mutates a copy) ---

function applyMove(gameState, from, to, promotion) {
  const board = [...gameState.board];
  const piece = board[from];
  const pieceType = Math.abs(piece);
  const isWhite = isWhitePiece(piece);
  let isCapture = board[to] !== 0;

  // Basic move
  board[to] = piece;
  board[from] = 0;

  // Castling: move the rook too
  if (pieceType === PIECE_TYPES.KING) {
    const { row: fromRow, col: fromCol } = indexToRowCol(from);
    const { col: toCol } = indexToRowCol(to);
    if (Math.abs(toCol - fromCol) === 2) {
      const direction = toCol > fromCol ? 1 : -1;
      const rookCol = direction === 1 ? 7 : 0;
      const rookIndex = rowColToIndex(fromRow, rookCol);
      const newRookIndex = rowColToIndex(fromRow, toCol - direction);
      board[newRookIndex] = board[rookIndex];
      board[rookIndex] = 0;
    }
  }

  // En passant capture: remove the captured pawn
  if (pieceType === PIECE_TYPES.PAWN && to === gameState.enPassantTarget) {
    const { row: toRow, col: toCol } = indexToRowCol(to);
    const capturedPawnRow = isWhite ? toRow + 1 : toRow - 1;
    board[rowColToIndex(capturedPawnRow, toCol)] = 0;
    isCapture = true;
  }

  // Promotion
  if (pieceType === PIECE_TYPES.PAWN && needsPromotion(piece, to)) {
    const promotionMap = {
      'q': PIECE_TYPES.QUEEN,
      'r': PIECE_TYPES.ROOK,
      'b': PIECE_TYPES.BISHOP,
      'n': PIECE_TYPES.KNIGHT
    };
    const promotedType = promotionMap[promotion] || PIECE_TYPES.QUEEN;
    board[to] = isWhite ? promotedType : -promotedType;
  }

  // Update en passant target
  const newEnPassantTarget = getEnPassantTarget(gameState.board, from, to);

  // Update moved pieces
  const newMovedPieces = new Set(gameState.movedPieces);
  newMovedPieces.add(from);

  // Update half-move clock
  const newHalfMoveClock = (pieceType === PIECE_TYPES.PAWN || isCapture) ? 0 : gameState.halfMoveClock + 1;

  // Update position history
  const positionKey = generatePositionKey(board);
  const newPositionHistory = [...gameState.positionHistory, positionKey];

  // Update move history
  const moveUci = indexToAlgebraic(from) + indexToAlgebraic(to) + (promotion || '');
  const newMoveHistory = [...gameState.moveHistory, moveUci];

  // Toggle turn
  const nextTurn = gameState.currentTurn === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;

  return {
    board,
    currentTurn: nextTurn,
    moveHistory: newMoveHistory,
    enPassantTarget: newEnPassantTarget,
    movedPieces: newMovedPieces,
    halfMoveClock: newHalfMoveClock,
    positionHistory: newPositionHistory
  };
}

// --- Game result detection (fixes stalemate bug) ---

function getGameResult(gameState) {
  const { board, currentTurn, halfMoveClock, positionHistory } = gameState;
  const isWhite = currentTurn === COLORS.WHITE;

  // Check for insufficient material
  if (isInsufficientMaterial(board)) {
    return { over: true, result: '1/2-1/2', reason: 'insufficient_material' };
  }

  // 50-move rule (100 half-moves)
  if (halfMoveClock >= 100) {
    return { over: true, result: '1/2-1/2', reason: 'fifty_move_rule' };
  }

  // Threefold repetition
  const currentPosition = generatePositionKey(board);
  const repetitions = positionHistory.filter(p => p === currentPosition).length;
  if (repetitions >= 3) {
    return { over: true, result: '1/2-1/2', reason: 'threefold_repetition' };
  }

  // Check legal moves for the side to move
  const legalMoves = getLegalMoves(gameState);

  if (legalMoves.length === 0) {
    // No legal moves — is the king in check?
    if (isKingInCheck(board, isWhite)) {
      // Checkmate: the other side wins
      const winner = isWhite ? '0-1' : '1-0';
      return { over: true, result: winner, reason: 'checkmate' };
    } else {
      // Stalemate
      return { over: true, result: '1/2-1/2', reason: 'stalemate' };
    }
  }

  return { over: false };
}

// --- Initial game state ---

function createInitialGameState() {
  return {
    board: [...INITIAL_BOARD],
    currentTurn: COLORS.WHITE,
    moveHistory: [],
    enPassantTarget: null,
    movedPieces: new Set(),
    halfMoveClock: 0,
    positionHistory: []
  };
}

// --- Serialization for SQLite ---

function serializeGameState(gs) {
  return {
    board: JSON.stringify(gs.board),
    current_turn: gs.currentTurn,
    move_history: JSON.stringify(gs.moveHistory),
    en_passant_target: gs.enPassantTarget,
    moved_pieces: JSON.stringify([...gs.movedPieces]),
    half_move_clock: gs.halfMoveClock,
    position_history: JSON.stringify(gs.positionHistory)
  };
}

function deserializeGameState(row) {
  return {
    board: JSON.parse(row.board),
    currentTurn: row.current_turn,
    moveHistory: JSON.parse(row.move_history),
    enPassantTarget: row.en_passant_target,
    movedPieces: new Set(JSON.parse(row.moved_pieces)),
    halfMoveClock: row.half_move_clock,
    positionHistory: JSON.parse(row.position_history)
  };
}

module.exports = {
  indexToAlgebraic,
  algebraicToIndex,
  boardToFEN,
  parseMove,
  isMoveLegal,
  getLegalMoves,
  applyMove,
  getGameResult,
  createInitialGameState,
  serializeGameState,
  deserializeGameState
};
