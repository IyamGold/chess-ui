import { useState, useCallback } from 'react';
import '../Chessboard.css';
import { PIECE_TYPES } from '../constants';
import Piece from '../Piece';
import { needsPromotion, isKingInCheck } from '../moveValidation';
import { playMoveSound, playCaptureSound, playNotifySound } from '../sounds';
import { useOnlineGame } from '../hooks/useOnlineGame';

async function gameAction(roomId, path, body = {}) {
  const response = await fetch(`/api/rooms/${roomId}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Could not complete action');
}

function OnlineChessboard({ sessionReady, roomId, onBackToList, onRoomGone }) {
  const game = useOnlineGame({ sessionReady, roomId, onRoomGone });

  const [selection, setSelection] = useState(null);
  const [promotionData, setPromotionData] = useState(null); // { from, to, piece }
  const [copied, setCopied] = useState(false);

  const isMyTurn = game.myColor === game.currentTurn;
  const canInteract = game.status === 'playing' && isMyTurn && !promotionData;
  // A server update invalidates a selection made on the previous board.
  const selectedFrom = canInteract && selection?.board === game.board ? selection.from : null;
  const selectedPiece = selectedFrom === null ? null : selection.piece;
  const validMoves = selectedFrom === null ? [] : game.getValidMovesForSquare(selectedFrom);

  const handleMove = (squareIndex) => {
    if (!canInteract || selectedFrom === null || !validMoves.includes(squareIndex)) return;

    if (needsPromotion(selectedPiece, squareIndex)) {
      setPromotionData({ from: selectedFrom, to: squareIndex, piece: selectedPiece });
      setSelection(null);
      return;
    }

    const cols = 'abcdefgh';
    const fromStr = cols[selectedFrom % 8] + (8 - Math.floor(selectedFrom / 8));
    const toStr = cols[squareIndex % 8] + (8 - Math.floor(squareIndex / 8));
    if (game.board[squareIndex] !== 0) playCaptureSound();
    else playMoveSound();

    game.applyOptimisticMove(selectedFrom, squareIndex);
    setSelection(null);
    void game.submitMove(fromStr + toStr);
  };

  const handleSquareClick = (squareIndex) => {
    if (!canInteract) return;
    if (validMoves.includes(squareIndex)) {
      handleMove(squareIndex);
      return;
    }
    const piece = game.board[squareIndex];
    const ownPiece = piece !== 0 && (piece > 0 ? 'white' : 'black') === game.myColor;
    if (squareIndex !== selectedFrom && ownPiece) {
      setSelection({ from: squareIndex, piece, board: game.board });
    } else {
      setSelection(null);
    }
  };

  const handlePromotion = useCallback(
    async (pieceType) => {
      if (!promotionData || game.status !== 'playing' || !isMyTurn) return;

      const { from, to } = promotionData;
      const cols = 'abcdefgh';
      const fromStr = cols[from % 8] + (8 - Math.floor(from / 8));
      const toStr = cols[to % 8] + (8 - Math.floor(to / 8));
      const promoChar =
        {
          [PIECE_TYPES.QUEEN]: 'q',
          [PIECE_TYPES.ROOK]: 'r',
          [PIECE_TYPES.BISHOP]: 'b',
          [PIECE_TYPES.KNIGHT]: 'n',
        }[pieceType] || 'q';
      const uci = fromStr + toStr + promoChar;

      playCaptureSound();

      // Apply promotion optimistically
      game.applyOptimisticMove(from, to);

      setPromotionData(null);

      game.submitMove(uci);
    },
    [promotionData, game, isMyTurn],
  );

  const inviteCode = game.room?.inviteCode;
  const handleCopyInvite = useCallback(async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
    } catch {
      // Fallback for non-HTTPS contexts where clipboard API is unavailable
      const el = document.createElement('textarea');
      el.value = inviteCode;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [inviteCode]);

  // Loading state
  if (game.status === 'loading' || !game.board) {
    return (
      <div className="online-loading">
        <p>Loading game...</p>
      </div>
    );
  }

  // Waiting for an opponent to join — restorable on reload via /game/:roomId.
  // The 'join' WebSocket event flips status to 'playing' and the board appears.
  if (game.status === 'waiting') {
    return (
      <div className="new-game-setup waiting-room">
        <h2>Waiting for Opponent</h2>
        <p className="waiting-subtitle">Share this code with your opponent:</p>
        <div className="invite-code-display">
          <span className="invite-code">{inviteCode || '…'}</span>
          <button className="copy-button" onClick={handleCopyInvite} disabled={!inviteCode}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="waiting-hint">The game will start automatically when they join.</p>
        <div className="setup-actions">
          <button className="setup-back" onClick={onBackToList}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (game.status === 'error') {
    return (
      <div className="online-error">
        <p>Error: {game.error}</p>
        <button className="back-button" onClick={onBackToList}>
          Back to Games
        </button>
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
      gameStatus = 'White wins!';
    } else if (game.gameResult === '0-1') {
      gameStatus = 'Black wins!';
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
          <button className="back-button" onClick={onBackToList}>
            Back to Games
          </button>
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

      {game.status === 'playing' && game.myColor && (
        <div className="game-actions">
          <button
            onClick={() => {
              if (confirm('Resign this game?'))
                void gameAction(roomId, 'resign')
                  .then(game.fetchRoom)
                  .catch((e) => alert(e.message));
            }}
          >
            Resign
          </button>
          {!game.room?.drawOffer && (
            <button
              onClick={() =>
                void gameAction(roomId, 'draw', { action: 'offer' })
                  .then(game.fetchRoom)
                  .catch((e) => alert(e.message))
              }
            >
              Offer draw
            </button>
          )}
          {game.room?.drawOffer && game.room.drawOffer !== game.myColor && (
            <>
              <button
                onClick={() =>
                  void gameAction(roomId, 'draw', { action: 'accept' })
                    .then(game.fetchRoom)
                    .catch((e) => alert(e.message))
                }
              >
                Accept draw
              </button>
              <button
                onClick={() =>
                  void gameAction(roomId, 'draw', { action: 'decline' })
                    .then(game.fetchRoom)
                    .catch((e) => alert(e.message))
                }
              >
                Decline draw
              </button>
            </>
          )}
          {game.room?.drawOffer === game.myColor && (
            <span>Draw offered. Waiting for your opponent.</span>
          )}
        </div>
      )}
      <p className="board-instructions">Click a piece, then click a highlighted square to move.</p>
      <div className="chessboard" role="group" aria-label="Chess board">
        {renderBoard(
          game.board,
          game.myColor,
          validMoves,
          selectedFrom,
          canInteract,
          handleSquareClick,
        )}
      </div>

      {promotionData && game.status === 'playing' && (
        <div className="promotion-overlay">
          <div className="promotion-dialog">
            <h3>Promote Pawn</h3>
            <div className="promotion-choices">
              <button
                aria-label="Promote to Queen"
                onClick={() => handlePromotion(PIECE_TYPES.QUEEN)}
              >
                <Piece type={promoPieceIsWhite ? PIECE_TYPES.QUEEN : -PIECE_TYPES.QUEEN} />
                <span>Queen</span>
              </button>
              <button
                aria-label="Promote to Rook"
                onClick={() => handlePromotion(PIECE_TYPES.ROOK)}
              >
                <Piece type={promoPieceIsWhite ? PIECE_TYPES.ROOK : -PIECE_TYPES.ROOK} />
                <span>Rook</span>
              </button>
              <button
                aria-label="Promote to Bishop"
                onClick={() => handlePromotion(PIECE_TYPES.BISHOP)}
              >
                <Piece type={promoPieceIsWhite ? PIECE_TYPES.BISHOP : -PIECE_TYPES.BISHOP} />
                <span>Bishop</span>
              </button>
              <button
                aria-label="Promote to Knight"
                onClick={() => handlePromotion(PIECE_TYPES.KNIGHT)}
              >
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

function renderBoard(board, myColor, validMovesList, selectedFrom, canInteract, onSquareClick) {
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
      const squareClass = `square ${isLight ? 'light' : 'dark'}${isValidMove ? ' valid-move' : ''}${
        selectedFrom === squareIndex ? ' selected' : ''
      }`;

      row.push(
        <button
          key={`${x}-${y}`}
          type="button"
          className={squareClass}
          data-square={`${'abcdefgh'[x]}${8 - y}`}
          aria-label={`Square ${'abcdefgh'[x]}${8 - y}`}
          aria-pressed={selectedFrom === squareIndex}
          aria-disabled={!canInteract}
          onClick={() => onSquareClick(squareIndex)}
        >
          {piece !== 0 && <Piece type={piece} />}
        </button>,
      );
    }

    boardElements.push(
      <div key={y} className="row">
        {row}
      </div>,
    );
  }

  return boardElements;
}

export default OnlineChessboard;
