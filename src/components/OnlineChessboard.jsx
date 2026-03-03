import { useState, useCallback } from 'react';
import '../Chessboard.css';
import { PIECE_TYPES } from '../constants';
import Piece from '../Piece';
import { needsPromotion, isKingInCheck } from '../moveValidation';
import { playMoveSound, playCaptureSound, playNotifySound } from '../sounds';
import { useOnlineGame } from '../hooks/useOnlineGame';

function OnlineChessboard({ serverToken, roomId, onBackToList }) {
  const game = useOnlineGame({ serverToken, roomId });

  const [draggedPiece, setDraggedPiece] = useState(null);
  const [draggedFrom, setDraggedFrom] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [promotionData, setPromotionData] = useState(null); // { from, to, piece }

  const isMyTurn = game.myColor === game.currentTurn;

  const handleDragStart = useCallback((squareIndex, piece) => {
    // Only allow dragging own pieces on own turn
    if (!isMyTurn) return;
    const isWhite = piece > 0;
    if ((game.myColor === 'white' && !isWhite) || (game.myColor === 'black' && isWhite)) return;

    setDraggedPiece(piece);
    setDraggedFrom(squareIndex);
    setValidMoves(game.getValidMovesForSquare(squareIndex));
  }, [isMyTurn, game]);

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = useCallback(async (squareIndex) => {
    if (draggedFrom === null || draggedFrom === squareIndex) {
      setDraggedPiece(null);
      setDraggedFrom(null);
      setValidMoves([]);
      return;
    }

    if (!validMoves.includes(squareIndex)) {
      setDraggedPiece(null);
      setDraggedFrom(null);
      setValidMoves([]);
      return;
    }

    // Check if this is a promotion move (use client-side check for UX dialog)
    if (needsPromotion(draggedPiece, squareIndex)) {
      setPromotionData({ from: draggedFrom, to: squareIndex, piece: draggedPiece });
      setDraggedPiece(null);
      setDraggedFrom(null);
      setValidMoves([]);
      return;
    }

    // Build UCI string
    const cols = 'abcdefgh';
    const fromStr = cols[draggedFrom % 8] + (8 - Math.floor(draggedFrom / 8));
    const toStr = cols[squareIndex % 8] + (8 - Math.floor(squareIndex / 8));
    const uci = fromStr + toStr;

    // Play sound optimistically
    const isCapture = game.board[squareIndex] !== 0;
    if (isCapture) { playCaptureSound(); } else { playMoveSound(); }

    setDraggedPiece(null);
    setDraggedFrom(null);
    setValidMoves([]);

    await game.submitMove(uci);
  }, [draggedFrom, draggedPiece, validMoves, game]);

  const handlePromotion = useCallback(async (pieceType) => {
    if (!promotionData) return;

    const { from, to } = promotionData;
    const cols = 'abcdefgh';
    const fromStr = cols[from % 8] + (8 - Math.floor(from / 8));
    const toStr = cols[to % 8] + (8 - Math.floor(to / 8));
    const promoChar = { [PIECE_TYPES.QUEEN]: 'q', [PIECE_TYPES.ROOK]: 'r', [PIECE_TYPES.BISHOP]: 'b', [PIECE_TYPES.KNIGHT]: 'n' }[pieceType] || 'q';
    const uci = fromStr + toStr + promoChar;

    playCaptureSound();
    setPromotionData(null);

    await game.submitMove(uci);
  }, [promotionData, game]);

  // Loading state
  if (game.status === 'loading' || !game.board) {
    return (
      <div className="online-loading">
        <p>Loading game...</p>
      </div>
    );
  }

  // Error state
  if (game.status === 'error') {
    return (
      <div className="online-error">
        <p>Error: {game.error}</p>
        <button className="back-button" onClick={onBackToList}>Back to Games</button>
      </div>
    );
  }

  // Build game status message
  let gameStatus = '';
  let statusColor = '#ff6b6b';

  const whiteInCheck = game.board ? isKingInCheck(game.board, true) : false;
  const blackInCheck = game.board ? isKingInCheck(game.board, false) : false;

  if (game.gameResult) {
    playNotifySound();
    if (game.gameResult === '1-0') {
      gameStatus = 'Checkmate! White wins!';
    } else if (game.gameResult === '0-1') {
      gameStatus = 'Checkmate! Black wins!';
    } else {
      gameStatus = 'Draw!';
      statusColor = '#4CAF50';
    }
  } else if (whiteInCheck && game.currentTurn === 'white') {
    gameStatus = 'White is in check!';
  } else if (blackInCheck && game.currentTurn === 'black') {
    gameStatus = 'Black is in check!';
  } else if (!isMyTurn && game.status === 'playing') {
    gameStatus = "Opponent's turn...";
    statusColor = '#2196F3';
  }

  // Determine promotion piece color for dialog
  const promoPieceIsWhite = promotionData ? promotionData.piece > 0 : true;

  return (
    <>
      <div className="game-controls">
        <div className="engine-settings">
          <button className="back-button" onClick={onBackToList}>Back to Games</button>
          {game.room && (
            <span className="online-info">
              {game.room.white || '?'} vs {game.room.black || '?'}
              {game.room.isStockfish && ` (Stockfish Lv${game.room.stockfishLevel})`}
            </span>
          )}
        </div>
      </div>

      {gameStatus && (
        <div className="game-status" style={{ backgroundColor: statusColor }}>
          {gameStatus}
        </div>
      )}

      <div className="chessboard">
        {renderBoard(game.board, game.myColor, validMoves, handleDragStart, handleDragOver, handleDrop)}
      </div>

      {promotionData && (
        <div className="promotion-overlay">
          <div className="promotion-dialog">
            <h3>Promote Pawn</h3>
            <div className="promotion-choices">
              <button onClick={() => handlePromotion(PIECE_TYPES.QUEEN)}>
                <Piece type={promoPieceIsWhite ? PIECE_TYPES.QUEEN : -PIECE_TYPES.QUEEN} />
                <span>Queen</span>
              </button>
              <button onClick={() => handlePromotion(PIECE_TYPES.ROOK)}>
                <Piece type={promoPieceIsWhite ? PIECE_TYPES.ROOK : -PIECE_TYPES.ROOK} />
                <span>Rook</span>
              </button>
              <button onClick={() => handlePromotion(PIECE_TYPES.BISHOP)}>
                <Piece type={promoPieceIsWhite ? PIECE_TYPES.BISHOP : -PIECE_TYPES.BISHOP} />
                <span>Bishop</span>
              </button>
              <button onClick={() => handlePromotion(PIECE_TYPES.KNIGHT)}>
                <Piece type={promoPieceIsWhite ? PIECE_TYPES.KNIGHT : -PIECE_TYPES.KNIGHT} />
                <span>Knight</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function renderBoard(board, myColor, validMovesList, onDragStart, onDragOver, onDrop) {
  const boardElements = [];
  const rows = myColor === 'black' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const colOrder = myColor === 'black' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  for (const y of rows) {
    const row = [];
    for (const x of colOrder) {
      const squareIndex = y * 8 + x;
      const piece = board[squareIndex];
      const isLight = (x + y) % 2 === 0;
      const isValidMove = validMovesList.includes(squareIndex);
      const squareClass = `square ${isLight ? 'light' : 'dark'}${isValidMove ? ' valid-move' : ''}`;

      row.push(
        <div
          key={`${x}-${y}`}
          className={squareClass}
          onDragOver={onDragOver}
          onDrop={() => onDrop(squareIndex)}
        >
          {piece !== 0 && (
            <Piece
              type={piece}
              onDragStart={() => onDragStart(squareIndex, piece)}
            />
          )}
        </div>
      );
    }

    boardElements.push(
      <div key={y} className="row">
        {row}
      </div>
    );
  }

  return boardElements;
}

export default OnlineChessboard;
