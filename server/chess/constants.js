// Piece type constants (0-6)
const PIECE_TYPES = {
  NONE: 0,
  KING: 1,
  PAWN: 2,
  KNIGHT: 3,
  ROOK: 4,
  BISHOP: 5,
  QUEEN: 6
};

// Color constants
const COLORS = {
  WHITE: 'white',
  BLACK: 'black'
};

// White pieces (positive numbers 1-6)
const WHITE_PIECES = {
  KING: 1,
  PAWN: 2,
  KNIGHT: 3,
  ROOK: 4,
  BISHOP: 5,
  QUEEN: 6
};

// Black pieces (negative numbers -1 to -6)
const BLACK_PIECES = {
  KING: -1,
  PAWN: -2,
  KNIGHT: -3,
  ROOK: -4,
  BISHOP: -5,
  QUEEN: -6
};

// Helper function to get piece color
const getPieceColor = (piece) => {
  if (piece > 0) return COLORS.WHITE;
  if (piece < 0) return COLORS.BLACK;
  return null;
};

// Helper function to get piece type
const getPieceType = (piece) => {
  return Math.abs(piece);
};

// Helper function to check if piece is white
const isWhitePiece = (piece) => piece > 0;

// Helper function to check if piece is black
const isBlackPiece = (piece) => piece < 0;

// Standard starting position in FEN notation
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

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

// Piece number to FEN character mapping (reverse of FEN_TO_PIECE)
const PIECE_TO_FEN = {};
for (const [char, num] of Object.entries(FEN_TO_PIECE)) {
  PIECE_TO_FEN[num] = char;
}

// Parse FEN notation to board array
const parseFEN = (fen) => {
  const board = new Array(64).fill(0);
  const ranks = fen.split('/');

  let squareIndex = 0;

  for (let rank of ranks) {
    for (let char of rank) {
      if (isNaN(char)) {
        board[squareIndex] = FEN_TO_PIECE[char];
        squareIndex++;
      } else {
        const emptySquares = parseInt(char);
        squareIndex += emptySquares;
      }
    }
  }

  return board;
};

// Initial chess board state (64 squares, 0-63)
const INITIAL_BOARD = parseFEN(STARTING_FEN);

module.exports = {
  PIECE_TYPES,
  COLORS,
  WHITE_PIECES,
  BLACK_PIECES,
  getPieceColor,
  getPieceType,
  isWhitePiece,
  isBlackPiece,
  STARTING_FEN,
  FEN_TO_PIECE,
  PIECE_TO_FEN,
  parseFEN,
  INITIAL_BOARD
};
