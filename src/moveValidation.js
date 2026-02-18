import { PIECE_TYPES, isWhitePiece, isBlackPiece } from './constants';

// Helper to convert index to row/col
export const indexToRowCol = (index) => {
  const row = Math.floor(index / 8);
  const col = index % 8;
  return { row, col };
};

// Helper to convert row/col to index
export const rowColToIndex = (row, col) => {
  return row * 8 + col;
};

// Validate pawn moves
export const isValidPawnMove = (board, fromIndex, toIndex, enPassantTarget) => {
  const piece = board[fromIndex];
  const targetPiece = board[toIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.PAWN) {
    return false;
  }

  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  const isWhite = isWhitePiece(piece);
  const direction = isWhite ? -1 : 1; // White moves up (negative), black moves down (positive)
  const startingRow = isWhite ? 6 : 1; // Starting row for pawns

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
    // Check that the square in between is also empty
    const middleIndex = rowColToIndex(fromRow + direction, fromCol);
    if (board[middleIndex] === 0) {
      return true;
    }
  }

  // 3. Diagonal capture
  if (rowDiff === direction && colDiff === 1) {
    // Regular capture
    if (targetPiece !== 0) {
      // Check that target is opponent's piece
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
export const getEnPassantTarget = (board, fromIndex, toIndex) => {
  const piece = board[fromIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.PAWN) {
    return null;
  }

  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  const isWhite = isWhitePiece(piece);
  const direction = isWhite ? -1 : 1;

  // Check if pawn moved 2 squares
  if (Math.abs(toRow - fromRow) === 2 && fromCol === toCol) {
    // Return the square behind the pawn as the en passant target
    return rowColToIndex(toRow - direction, toCol);
  }

  return null;
};

// Check if pawn needs promotion
export const needsPromotion = (piece, toIndex) => {
  const pieceType = Math.abs(piece);
  if (pieceType !== PIECE_TYPES.PAWN) {
    return false;
  }

  const { row } = indexToRowCol(toIndex);
  const isWhite = isWhitePiece(piece);

  // White pawns promote on row 0, black pawns on row 7
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
      return false; // Path is blocked
    }
    currentRow += rowStep;
    currentCol += colStep;
  }

  return true;
};

// Validate rook moves
export const isValidRookMove = (board, fromIndex, toIndex) => {
  const piece = board[fromIndex];
  const targetPiece = board[toIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.ROOK) {
    return false;
  }

  const { row: fromRow, col: fromCol } = indexToRowCol(fromIndex);
  const { row: toRow, col: toCol } = indexToRowCol(toIndex);

  // Rook moves horizontally or vertically
  const isHorizontal = fromRow === toRow && fromCol !== toCol;
  const isVertical = fromCol === toCol && fromRow !== toRow;

  if (!isHorizontal && !isVertical) {
    return false; // Not a straight line
  }

  // Check if path is clear
  if (!isPathClear(board, fromIndex, toIndex)) {
    return false;
  }

  // Check destination square
  if (targetPiece !== 0) {
    // Can only capture opponent's piece
    const isWhite = isWhitePiece(piece);
    if (isWhite && isWhitePiece(targetPiece)) {
      return false; // Can't capture own piece
    }
    if (!isWhite && isBlackPiece(targetPiece)) {
      return false; // Can't capture own piece
    }
  }

  return true;
};

// Validate bishop moves
export const isValidBishopMove = (board, fromIndex, toIndex) => {
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

  // Bishop moves diagonally - row and column difference must be equal
  if (rowDiff !== colDiff || rowDiff === 0) {
    return false; // Not a diagonal move
  }

  // Check if path is clear
  if (!isPathClear(board, fromIndex, toIndex)) {
    return false;
  }

  // Check destination square
  if (targetPiece !== 0) {
    // Can only capture opponent's piece
    const isWhite = isWhitePiece(piece);
    if (isWhite && isWhitePiece(targetPiece)) {
      return false; // Can't capture own piece
    }
    if (!isWhite && isBlackPiece(targetPiece)) {
      return false; // Can't capture own piece
    }
  }

  return true;
};

// Helper function to check if a square is under attack by opponent
export const isSquareUnderAttack = (board, squareIndex, byColor) => {
  // byColor: 'white' or 'black' - the color attacking the square
  const { row: targetRow, col: targetCol } = indexToRowCol(squareIndex);

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (piece === 0) continue;

    const pieceIsWhite = isWhitePiece(piece);
    const pieceColor = pieceIsWhite ? 'white' : 'black';

    // Only check pieces of the attacking color
    if (pieceColor !== byColor) continue;

    const pieceType = Math.abs(piece);

    // Check if this piece can attack the target square
    switch (pieceType) {
      case PIECE_TYPES.PAWN: {
        const { row: fromRow, col: fromCol } = indexToRowCol(i);
        const direction = pieceIsWhite ? -1 : 1;
        // Pawns attack diagonally
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
        // King attacks all adjacent squares
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
export const isKingInCheck = (board, isWhite) => {
  const kingIndex = findKing(board, isWhite);
  if (kingIndex === null) return false;

  const opponentColor = isWhite ? 'black' : 'white';
  return isSquareUnderAttack(board, kingIndex, opponentColor);
};

// Validate king moves
export const isValidKingMove = (board, fromIndex, toIndex, hasMoved) => {
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
    // Check destination square
    if (targetPiece !== 0) {
      // Can only capture opponent's piece
      if (isWhite && isWhitePiece(targetPiece)) {
        return false;
      }
      if (!isWhite && isBlackPiece(targetPiece)) {
        return false;
      }
    }

    // Check if move would put king in check
    const testBoard = [...board];
    testBoard[toIndex] = piece;
    testBoard[fromIndex] = 0;

    if (isKingInCheck(testBoard, isWhite)) {
      return false; // Can't move into check
    }

    return true;
  }

  // Castling: king moves 2 squares horizontally
  if (rowDiff === 0 && colDiff === 2 && !hasMoved) {
    const direction = toCol > fromCol ? 1 : -1; // Right (kingside) or left (queenside)
    const rookCol = direction === 1 ? 7 : 0;
    const rookIndex = rowColToIndex(fromRow, rookCol);
    const rook = board[rookIndex];

    // Check if rook exists and hasn't moved
    const expectedRook = isWhite ? PIECE_TYPES.ROOK : -PIECE_TYPES.ROOK;
    if (rook !== expectedRook) {
      return false;
    }

    // Check if king is in check
    if (isKingInCheck(board, isWhite)) {
      return false;
    }

    // Check if squares between king and rook are empty
    const start = Math.min(fromCol, rookCol) + 1;
    const end = Math.max(fromCol, rookCol);
    for (let col = start; col < end; col++) {
      const index = rowColToIndex(fromRow, col);
      if (board[index] !== 0) {
        return false; // Path is blocked
      }
    }

    // Check if king passes through or ends in check
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
export const isValidQueenMove = (board, fromIndex, toIndex) => {
  const piece = board[fromIndex];
  const pieceType = Math.abs(piece);

  if (pieceType !== PIECE_TYPES.QUEEN) {
    return false;
  }

  // Queen can move like a rook OR a bishop
  // Temporarily change piece type to test rook/bishop moves
  const tempRook = piece > 0 ? PIECE_TYPES.ROOK : -PIECE_TYPES.ROOK;
  const tempBishop = piece > 0 ? PIECE_TYPES.BISHOP : -PIECE_TYPES.BISHOP;

  const tempBoard = [...board];

  // Try as rook
  tempBoard[fromIndex] = tempRook;
  if (isValidRookMove(tempBoard, fromIndex, toIndex)) {
    return true;
  }

  // Try as bishop
  tempBoard[fromIndex] = tempBishop;
  if (isValidBishopMove(tempBoard, fromIndex, toIndex)) {
    return true;
  }

  return false;
};

// Validate knight moves
export const isValidKnightMove = (board, fromIndex, toIndex) => {
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

  // Knight moves in L-shape: 2 squares in one direction + 1 perpendicular
  const isLShape = (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);

  if (!isLShape) {
    return false;
  }

  // Knights can jump over pieces, so no path checking needed

  // Check destination square
  if (targetPiece !== 0) {
    // Can only capture opponent's piece
    const isWhite = isWhitePiece(piece);
    if (isWhite && isWhitePiece(targetPiece)) {
      return false; // Can't capture own piece
    }
    if (!isWhite && isBlackPiece(targetPiece)) {
      return false; // Can't capture own piece
    }
  }

  return true;
};

// Check if checkmate
export const isCheckmate = (board, isWhite) => {
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
export const isInsufficientMaterial = (board) => {
  const pieces = [];
  
  // Collect all pieces
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
    // Only bishop or knight
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
        // Check if light or dark square
        bishops.push((row + col) % 2);
      }
    }
    // Both bishops on same color squares
    if (bishops.length === 2 && bishops[0] === bishops[1]) {
      return true;
    }
  }

  return false;
};

// Generate a position key for repetition detection
export const generatePositionKey = (board) => {
  return board.join(',');
};
