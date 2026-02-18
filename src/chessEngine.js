// Chess Engine using Stockfish.js
import { PIECE_TYPES, isWhitePiece } from './constants';
import { indexToRowCol, rowColToIndex } from './moveValidation';

class ChessEngine {
  constructor() {
    this.engine = null;
    this.isReady = false;
    this.skillLevel = 10; // 0-20, where 20 is strongest
  }

  async init() {
    return new Promise((resolve) => {
      // Check WebAssembly support
      const wasmSupported = typeof WebAssembly === 'object' &&
        WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));

      // Create Web Worker with stockfish
      const workerPath = wasmSupported
        ? '/stockfish.wasm.js'
        : '/stockfish.js';

      this.engine = new Worker(workerPath);

      this.engine.addEventListener('message', (e) => {
        const msg = e.data;
        console.log('Stockfish:', msg);
        if (msg === 'readyok') {
          this.isReady = true;
          resolve();
        }
      });

      // Initialize engine
      this.engine.postMessage('uci');
      this.engine.postMessage(`setoption name Skill Level value ${this.skillLevel}`);
      this.engine.postMessage('isready');
    });
  }

  setSkillLevel(level) {
    // level: 0-20 (0 = weakest, 20 = strongest)
    this.skillLevel = Math.max(0, Math.min(20, level));
    if (this.engine) {
      this.engine.postMessage(`setoption name Skill Level value ${this.skillLevel}`);
    }
  }

  // Convert board array to FEN notation
  boardToFEN(board, currentTurn, halfMoveClock, fullMoveNumber = 1, castlingRights = 'KQkq', enPassantTarget = null) {
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
          const pieceType = Math.abs(piece);
          const isWhite = isWhitePiece(piece);

          let pieceChar = '';
          switch (pieceType) {
            case PIECE_TYPES.KING: pieceChar = 'k'; break;
            case PIECE_TYPES.QUEEN: pieceChar = 'q'; break;
            case PIECE_TYPES.ROOK: pieceChar = 'r'; break;
            case PIECE_TYPES.BISHOP: pieceChar = 'b'; break;
            case PIECE_TYPES.KNIGHT: pieceChar = 'n'; break;
            case PIECE_TYPES.PAWN: pieceChar = 'p'; break;
          }

          fen += isWhite ? pieceChar.toUpperCase() : pieceChar;
        }
      }
      if (emptyCount > 0) {
        fen += emptyCount;
      }
      if (row < 7) fen += '/';
    }

    // Active color
    fen += ' ' + (currentTurn === 'white' ? 'w' : 'b');

    // Castling availability
    fen += ' ' + castlingRights;

    // En passant target
    fen += ' ' + (enPassantTarget !== null ? this.indexToAlgebraic(enPassantTarget) : '-');

    // Halfmove clock and fullmove number
    fen += ` ${halfMoveClock} ${fullMoveNumber}`;

    return fen;
  }

  // Convert board index to algebraic notation (e.g., 0 -> a8, 63 -> h1)
  indexToAlgebraic(index) {
    const { row, col } = indexToRowCol(index);
    const file = String.fromCharCode(97 + col); // 'a' to 'h'
    const rank = 8 - row;
    return file + rank;
  }

  // Convert algebraic notation to board index
  algebraicToIndex(algebraic) {
    const file = algebraic.charCodeAt(0) - 97; // 'a' = 0
    const rank = parseInt(algebraic[1]);
    const row = 8 - rank;
    return rowColToIndex(row, file);
  }

  // Get best move from engine
  async getBestMove(board, currentTurn, halfMoveClock, castlingRights, enPassantTarget) {
    if (!this.isReady) {
      await this.init();
    }

    return new Promise((resolve) => {
      const fen = this.boardToFEN(board, currentTurn, halfMoveClock, 1, castlingRights, enPassantTarget);

      console.log('Position FEN:', fen);

      const messageHandler = (e) => {
        const msg = e.data;
        console.log('Stockfish:', msg);

        // Look for bestmove in response
        if (msg.startsWith('bestmove')) {
          const match = msg.match(/bestmove ([a-h][1-8])([a-h][1-8])([qrbn])?/);
          if (match) {
            const from = this.algebraicToIndex(match[1]);
            const to = this.algebraicToIndex(match[2]);
            const promotion = match[3]; // q, r, b, n or undefined

            // Remove this handler
            this.engine.removeEventListener('message', messageHandler);
            resolve({ from, to, promotion });
          } else {
            this.engine.removeEventListener('message', messageHandler);
            resolve(null);
          }
        }
      };

      this.engine.addEventListener('message', messageHandler);

      // Send position and request move
      this.engine.postMessage('ucinewgame');
      this.engine.postMessage(`position fen ${fen}`);
      this.engine.postMessage('go movetime 1000'); // Think for 1 second
    });
  }

  terminate() {
    if (this.engine) {
      this.engine.terminate();
      this.engine = null;
      this.isReady = false;
    }
  }
}

export default ChessEngine;
