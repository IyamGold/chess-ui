// Piece type constants (0-6)
export const PIECE_TYPES = {
  NONE: 0,
  KING: 1,
  PAWN: 2,
  KNIGHT: 3,
  ROOK: 4,
  BISHOP: 5,
  QUEEN: 6
};

// Color constants
export const COLORS = {
  WHITE: 'white',
  BLACK: 'black'
};

// White pieces (positive numbers 1-6)
export const WHITE_PIECES = {
  KING: 1,
  PAWN: 2,
  KNIGHT: 3,
  ROOK: 4,
  BISHOP: 5,
  QUEEN: 6
};

// Black pieces (negative numbers -1 to -6)
export const BLACK_PIECES = {
  KING: -1,
  PAWN: -2,
  KNIGHT: -3,
  ROOK: -4,
  BISHOP: -5,
  QUEEN: -6
};

// Helper function to get piece color
export const getPieceColor = (piece) => {
  if (piece > 0) return COLORS.WHITE;
  if (piece < 0) return COLORS.BLACK;
  return null;
};

// Helper function to get piece type
export const getPieceType = (piece) => {
  return Math.abs(piece);
};

// Helper function to check if piece is white
export const isWhitePiece = (piece) => piece > 0;

// Helper function to check if piece is black
export const isBlackPiece = (piece) => piece < 0;

// Standard starting position in FEN notation
export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

// Unicode chess piece symbols
export const PIECE_SYMBOLS = {
  // White pieces
  1: '♔',   // White King
  2: '♙',   // White Pawn
  3: '♘',   // White Knight
  4: '♖',   // White Rook
  5: '♗',   // White Bishop
  6: '♕',   // White Queen
  // Black pieces
  '-1': '♚',  // Black King
  '-2': '♟',  // Black Pawn
  '-3': '♞',  // Black Knight
  '-4': '♜',  // Black Rook
  '-5': '♝',  // Black Bishop
  '-6': '♛',  // Black Queen
};

// FEN character to piece number mapping
const FEN_TO_PIECE = {
  'K': 1,   // White King
  'P': 2,   // White Pawn
  'N': 3,   // White Knight
  'R': 4,   // White Rook
  'B': 5,   // White Bishop
  'Q': 6,   // White Queen
  'k': -1,  // Black King
  'p': -2,  // Black Pawn
  'n': -3,  // Black Knight
  'r': -4,  // Black Rook
  'b': -5,  // Black Bishop
  'q': -6,  // Black Queen
};

// Parse FEN notation to board array
export const parseFEN = (fen) => {
  const board = new Array(64).fill(0);
  const ranks = fen.split('/');

  let squareIndex = 0;

  for (let rank of ranks) {
    for (let char of rank) {
      if (isNaN(char)) {
        // It's a piece
        board[squareIndex] = FEN_TO_PIECE[char];
        squareIndex++;
      } else {
        // It's a number indicating empty squares
        const emptySquares = parseInt(char);
        squareIndex += emptySquares;
      }
    }
  }

  return board;
};

// Initial chess board state (64 squares, 0-63)
export const INITIAL_BOARD = parseFEN(STARTING_FEN);
