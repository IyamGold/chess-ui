const { PIECE_TYPES, isWhitePiece, isBlackPiece } = require('./constants');

// Helper to convert index to row/col
const indexToRowCol = (index) => {
  const row = Math.floor(index / 8);
  const col = index % 8;
  return { row, col };
};

// Helper to convert row/col to index
const rowColToIndex = (row, col) => {
  return row * 8 + col;
};

// Validate pawn moves
const isValidPawnMove = (board, fromIndex, toIndex, enPassantTarget) => {
  const piece = board[fromIndex];
  const targetPiece = board[toIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.PAWN) {
    return false;
  }

  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  const isWhite = isWhitePiece(piece);
  const direction = isWhite ? -1 : 1;
  const startingRow = isWhite ? 6 : 1;

  const rowDiff = toRow - fromRow;
  const colDiff = Math.abs(toCol - fromCol);

  // 1. Move forward 1 square
  if (rowDiff === direction && colDiff === 0 && targetPiece === 0) {
    return true;
  }

  // 2. Move forward 2 squares from starting position
  if (
    fromRow === startingRow &&
    rowDiff === direction * 2 &&
    colDiff === 0 &&
    targetPiece === 0
  ) {
    const middleIndex = rowColToIndex(fromRow + direction, fromCol);
    if (board[middleIndex] === 0) {
      return true;
    }
  }

  // 3. Diagonal capture
  if (rowDiff === direction && colDiff === 1) {
    // Regular capture
    if (targetPiece !== 0) {
      if (isWhite && isBlackPiece(targetPiece)) {
        return true;
      }
      if (!isWhite && isWhitePiece(targetPiece)) {
        return true;
      }
    }

    // En passant capture
    if (toIndex === enPassantTarget) {
      return true;
    }
  }

  return false;
};

// Check if move results in en passant opportunity
const getEnPassantTarget = (board, fromIndex, toIndex) => {
  const piece = board[fromIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.PAWN) {
    return null;
  }

  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  const isWhite = isWhitePiece(piece);
  const direction = isWhite ? -1 : 1;

  if (Math.abs(toRow - fromRow) === 2 && fromCol === toCol) {
    return rowColToIndex(toRow - direction, toCol);
  }

  return null;
};

// Check if pawn needs promotion
const needsPromotion = (piece, toIndex) => {
  const pieceType = Math.abs(piece);
  if (pieceType !== PIECE_TYPES.PAWN) {
    return false;
  }

  const { row } = indexToRowCol(toIndex);
  const isWhite = isWhitePiece(piece);

  return (isWhite && row === 0) || (!isWhite && row === 7);
};

// Helper to check if path is clear (no pieces in between)
const isPathClear = (board, fromIndex, toIndex) => {
  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  const rowStep = toRow > fromRow ? 1 : toRow < fromRow ? -1 : 0;
  const colStep = toCol > fromCol ? 1 : toCol < fromCol ? -1 : 0;

  let currentRow = fromRow + rowStep;
  let currentCol = fromCol + colStep;

  while (currentRow !== toRow || currentCol !== toCol) {
    const index = rowColToIndex(currentRow, currentCol);
    if (board[index] !== 0) {
      return false;
    }
    currentRow += rowStep;
    currentCol += colStep;
  }

  return true;
};

// Validate rook moves
const isValidRookMove = (board, fromIndex, toIndex) => {
  const piece = board[fromIndex];
  const targetPiece = board[toIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.ROOK) {
    return false;
  }

  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  const isHorizontal = fromRow === toRow && fromCol !== toCol;
  const isVertical = fromCol === toCol && fromRow !== toRow;

  if (!isHorizontal && !isVertical) {
    return false;
  }

  if (!isPathClear(board, fromIndex, toIndex)) {
    return false;
  }

  if (targetPiece !== 0) {
    const isWhite = isWhitePiece(piece);
    if (isWhite && isWhitePiece(targetPiece)) {
      return false;
    }
    if (!isWhite && isBlackPiece(targetPiece)) {
      return false;
    }
  }

  return true;
};

// Validate bishop moves
const isValidBishopMove = (board, fromIndex, toIndex) => {
  const piece = board[fromIndex];
  const targetPiece = board[toIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.BISHOP) {
    return false;
  }

  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  const rowDiff = Math.abs(toRow - fromRow);
  const colDiff = Math.abs(toCol - fromCol);

  if (rowDiff !== colDiff || rowDiff === 0) {
    return false;
  }

  if (!isPathClear(board, fromIndex, toIndex)) {
    return false;
  }

  if (targetPiece !== 0) {
    const isWhite = isWhitePiece(piece);
    if (isWhite && isWhitePiece(targetPiece)) {
      return false;
    }
    if (!isWhite && isBlackPiece(targetPiece)) {
      return false;
    }
  }

  return true;
};

// Helper function to check if a square is under attack by opponent
const isSquareUnderAttack = (board, squareIndex, byColor) => {
  const { row: targetRow, col: targetCol } = indexToRowCol(squareIndex);

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (piece === 0) continue;

    const pieceIsWhite = isWhitePiece(piece);
    const pieceColor = pieceIsWhite ? 'white' : 'black';

    if (pieceColor !== byColor) continue;

    const pieceType = Math.abs(piece);

    switch (pieceType) {
      case PIECE_TYPES.PAWN: {
        const { row: fromRow, col: fromCol } = indexToRowCol(i);
        const direction = pieceIsWhite ? -1 : 1;
        if (fromRow + direction === targetRow && Math.abs(fromCol - targetCol) === 1) {
          return true;
        }
        break;
      }
      case PIECE_TYPES.KNIGHT:
        if (isValidKnightMove(board, i, squareIndex)) {
          return true;
        }
        break;
      case PIECE_TYPES.BISHOP:
        if (isValidBishopMove(board, i, squareIndex)) {
          return true;
        }
        break;
      case PIECE_TYPES.ROOK:
        if (isValidRookMove(board, i, squareIndex)) {
          return true;
        }
        break;
      case PIECE_TYPES.QUEEN:
        if (isValidQueenMove(board, i, squareIndex)) {
          return true;
        }
        break;
      case PIECE_TYPES.KING: {
        const { row: fromRow, col: fromCol } = indexToRowCol(i);
        if (Math.abs(fromRow - targetRow) <= 1 && Math.abs(fromCol - targetCol) <= 1) {
          return true;
        }
        break;
      }
    }
  }

  return false;
};

// Find the king's position on the board
const findKing = (board, isWhite) => {
  const kingValue = isWhite ? PIECE_TYPES.KING : -PIECE_TYPES.KING;
  for (let i = 0; i < 64; i++) {
    if (board[i] === kingValue) {
      return i;
    }
  }
  return null;
};

// Check if the king is in check
const isKingInCheck = (board, isWhite) => {
  const kingIndex = findKing(board, isWhite);
  if (kingIndex === null) return false;

  const opponentColor = isWhite ? 'black' : 'white';
  return isSquareUnderAttack(board, kingIndex, opponentColor);
};

// Validate king moves
const isValidKingMove = (board, fromIndex, toIndex, hasMoved) => {
  const piece = board[fromIndex];
  const targetPiece = board[toIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.KING) {
    return false;
  }

  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  const rowDiff = Math.abs(toRow - fromRow);
  const colDiff = Math.abs(toCol - fromCol);

  const isWhite = isWhitePiece(piece);

  // Basic king move: 1 square in any direction
  if (rowDiff <= 1 && colDiff <= 1 && (rowDiff + colDiff > 0)) {
    if (targetPiece !== 0) {
      if (isWhite && isWhitePiece(targetPiece)) {
        return false;
      }
      if (!isWhite && isBlackPiece(targetPiece)) {
        return false;
      }
    }

    const testBoard = [...board];
    testBoard[toIndex] = piece;
    testBoard[fromIndex] = 0;

    if (isKingInCheck(testBoard, isWhite)) {
      return false;
    }

    return true;
  }

  // Castling: king moves 2 squares horizontally
  if (rowDiff === 0 && colDiff === 2 && !hasMoved) {
    const direction = toCol > fromCol ? 1 : -1;
    const rookCol = direction === 1 ? 7 : 0;
    const rookIndex = rowColToIndex(fromRow, rookCol);
    const rook = board[rookIndex];

    const expectedRook = isWhite ? PIECE_TYPES.ROOK : -PIECE_TYPES.ROOK;
    if (rook !== expectedRook) {
      return false;
    }

    if (isKingInCheck(board, isWhite)) {
      return false;
    }

    const start = Math.min(fromCol, rookCol) + 1;
    const end = Math.max(fromCol, rookCol);
    for (let col = start; col < end; col++) {
      const index = rowColToIndex(fromRow, col);
      if (board[index] !== 0) {
        return false;
      }
    }

    for (let col = fromCol; col !== toCol + direction; col += direction) {
      const index = rowColToIndex(fromRow, col);
      const testBoard = [...board];
      testBoard[index] = piece;
      testBoard[fromIndex] = 0;

      const opponentColor = isWhite ? 'black' : 'white';
      if (isSquareUnderAttack(testBoard, index, opponentColor)) {
        return false;
      }
    }

    return true;
  }

  return false;
};

// Validate queen moves
const isValidQueenMove = (board, fromIndex, toIndex) => {
  const piece = board[fromIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.QUEEN) {
    return false;
  }

  const tempRook = piece > 0 ? PIECE_TYPES.ROOK : -PIECE_TYPES.ROOK;
  const tempBishop = piece > 0 ? PIECE_TYPES.BISHOP : -PIECE_TYPES.BISHOP;

  const tempBoard = [...board];

  tempBoard[fromIndex] = tempRook;
  if (isValidRookMove(tempBoard, fromIndex, toIndex)) {
    return true;
  }

  tempBoard[fromIndex] = tempBishop;
  if (isValidBishopMove(tempBoard, fromIndex, toIndex)) {
    return true;
  }

  return false;
};

// Validate knight moves
const isValidKnightMove = (board, fromIndex, toIndex) => {
  const piece = board[fromIndex];
  const targetPiece = board[toIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.KNIGHT) {
    return false;
  }

  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  const rowDiff = Math.abs(toRow - fromRow);
  const colDiff = Math.abs(toCol - fromCol);

  const isLShape = (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);

  if (!isLShape) {
    return false;
  }

  if (targetPiece !== 0) {
    const isWhite = isWhitePiece(piece);
    if (isWhite && isWhitePiece(targetPiece)) {
      return false;
    }
    if (!isWhite && isBlackPiece(targetPiece)) {
      return false;
    }
  }

  return true;
};

// Check if checkmate
const isCheckmate = (board, isWhite) => {
  const inCheck = isKingInCheck(board, isWhite);

  for (let fromIndex = 0; fromIndex < 64; fromIndex++) {
    const piece = board[fromIndex];
    if (piece === 0) continue;

    const pieceIsWhite = isWhitePiece(piece);
    if (pieceIsWhite !== isWhite) continue;

    const pieceType = Math.abs(piece);

    for (let toIndex = 0; toIndex < 64; toIndex++) {
      if (fromIndex === toIndex) continue;

      let isValid = false;

      switch (pieceType) {
        case PIECE_TYPES.PAWN:
          isValid = isValidPawnMove(board, fromIndex, toIndex, null);
          break;
        case PIECE_TYPES.KNIGHT:
          isValid = isValidKnightMove(board, fromIndex, toIndex);
          break;
        case PIECE_TYPES.BISHOP:
          isValid = isValidBishopMove(board, fromIndex, toIndex);
          break;
        case PIECE_TYPES.ROOK:
          isValid = isValidRookMove(board, fromIndex, toIndex);
          break;
        case PIECE_TYPES.QUEEN:
          isValid = isValidQueenMove(board, fromIndex, toIndex);
          break;
        case PIECE_TYPES.KING:
          isValid = isValidKingMove(board, fromIndex, toIndex, false);
          break;
      }

      if (isValid) {
        const testBoard = [...board];
        testBoard[toIndex] = piece;
        testBoard[fromIndex] = 0;

        if (!isKingInCheck(testBoard, isWhite)) {
          return false;
        }
      }
    }
  }

  return inCheck;
};

// Check for insufficient material (automatic draw)
const isInsufficientMaterial = (board) => {
  const pieces = [];

  for (let i = 0; i < 64; i++) {
    if (board[i] !== 0) {
      pieces.push(Math.abs(board[i]));
    }
  }

  // King vs King
  if (pieces.length === 2) {
    return true;
  }

  // King + minor piece vs King
  if (pieces.length === 3) {
    const nonKings = pieces.filter(p => p !== PIECE_TYPES.KING);
    if (nonKings.every(p => p === PIECE_TYPES.BISHOP || p === PIECE_TYPES.KNIGHT)) {
      return true;
    }
  }

  // King + Bishop vs King + Bishop (same color squares)
  if (pieces.length === 4) {
    const bishops = [];
    for (let i = 0; i < 64; i++) {
      if (Math.abs(board[i]) === PIECE_TYPES.BISHOP) {
        const { row, col } = indexToRowCol(i);
        bishops.push((row + col) % 2);
      }
    }
    if (bishops.length === 2 && bishops[0] === bishops[1]) {
      return true;
    }
  }

  return false;
};

// Generate a position key for repetition detection
const generatePositionKey = (board) => {
  return board.join(',');
};

module.exports = {
  indexToRowCol,
  rowColToIndex,
  isValidPawnMove,
  getEnPassantTarget,
  needsPromotion,
  isValidRookMove,
  isValidBishopMove,
  isSquareUnderAttack,
  isKingInCheck,
  isValidKingMove,
  isValidQueenMove,
  isValidKnightMove,
  isCheckmate,
  isInsufficientMaterial,
  generatePositionKey,
  isPathClear,
  needsPromotion,
  findKing
};
