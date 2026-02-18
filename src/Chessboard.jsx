import { useState, useEffect, useRef, useCallback } from 'react';
import './Chessboard.css';
import { INITIAL_BOARD, PIECE_TYPES } from './constants';
import Piece from './Piece';
import { playMoveSound, playCaptureSound, playNotifySound } from './sounds';
import { isValidPawnMove, getEnPassantTarget, needsPromotion, indexToRowCol, isValidRookMove, isValidKnightMove, isValidBishopMove, isValidQueenMove, isValidKingMove, isKingInCheck, isCheckmate, isInsufficientMaterial, generatePositionKey } from './moveValidation';
import ChessEngine from './chessEngine';

function Chessboard({ initialState, onSave, onGameEnd, onBackToList, engineColorProp }) {
  const s = initialState || {};

  const [board, setBoard] = useState(() => s.board || INITIAL_BOARD);
  const [draggedPiece, setDraggedPiece] = useState(null);
  const [draggedFrom, setDraggedFrom] = useState(null);
  const [enPassantTarget, setEnPassantTarget] = useState(() => s.enPassantTarget ?? null);
  const [promotionSquare, setPromotionSquare] = useState(null);
  const [movedPieces, setMovedPieces] = useState(() =>
    s.movedPieces instanceof Set ? s.movedPieces : new Set(s.movedPieces || [])
  );
  const [currentTurn, setCurrentTurn] = useState(() => s.currentTurn || 'white');
  const [halfMoveClock, setHalfMoveClock] = useState(() => s.halfMoveClock || 0);
  const [positionHistory, setPositionHistory] = useState(() =>
    s.positionHistory?.length ? s.positionHistory : [generatePositionKey(s.board || INITIAL_BOARD)]
  );
  const [validMoves, setValidMoves] = useState([]);
  const [moveHistory, setMoveHistory] = useState(() => s.moveHistory || []);
  const [isEngineThinking, setIsEngineThinking] = useState(false);

  const engineColor = engineColorProp || s.engineColor || 'black';

  const engineRef = useRef(null);
  const lastMoveRef = useRef(null);
  const gameEndedRef = useRef(s.result && s.result !== '*');
  const saveCounterRef = useRef(0);
  const rows = 8;
  const cols = 8;

  // Helper to record a move
  const recordMove = useCallback((from, to, promotion) => {
    const cols = 'abcdefgh';
    const fromStr = cols[from % 8] + (8 - Math.floor(from / 8));
    const toStr = cols[to % 8] + (8 - Math.floor(to / 8));
    const promoStr = promotion ? { [PIECE_TYPES.QUEEN]: 'q', [PIECE_TYPES.ROOK]: 'r', [PIECE_TYPES.BISHOP]: 'b', [PIECE_TYPES.KNIGHT]: 'n' }[promotion] || '' : '';
    setMoveHistory(prev => [...prev, fromStr + toStr + promoStr]);
  }, []);

  // Auto-save after every move
  const triggerSave = useCallback((boardState, turnState, epTarget, movedSet, hmClock, posHistory, moves, result) => {
    if (!onSave) return;
    saveCounterRef.current += 1;
    onSave({
      board: boardState,
      currentTurn: turnState,
      enPassantTarget: epTarget,
      movedPieces: [...movedSet],
      halfMoveClock: hmClock,
      positionHistory: posHistory,
      moveHistory: moves,
      result: result || '*',
    });
  }, [onSave]);

  // Detect game result
  const getGameResult = useCallback((boardState, hmClock, posHist) => {
    const whiteInCheck = isKingInCheck(boardState, true);
    const blackInCheck = isKingInCheck(boardState, false);
    const whiteCheckmate = isCheckmate(boardState, true);
    const blackCheckmate = isCheckmate(boardState, false);
    const insuffMat = isInsufficientMaterial(boardState);
    const fiftyMove = hmClock >= 100;
    const pos = generatePositionKey(boardState);
    const threefold = posHist.filter(p => p === pos).length >= 3;

    if (whiteCheckmate && whiteInCheck) return '0-1';
    if (blackCheckmate && blackInCheck) return '1-0';
    if (insuffMat || fiftyMove || threefold) return '1/2-1/2';
    if ((!whiteInCheck && whiteCheckmate) || (!blackInCheck && blackCheckmate)) return '1/2-1/2';
    return null;
  }, []);

  // Initialize engine + auto-move if engine's turn on mount
  useEffect(() => {
    if (!engineRef.current) {
      engineRef.current = new ChessEngine();
      engineRef.current.init().then(() => {
        // If resuming a game where it's the engine's turn, trigger engine move
        const initBoard = s.board || INITIAL_BOARD;
        const initTurn = s.currentTurn || 'white';
        const initEngineColor = engineColorProp || s.engineColor || 'black';
        const initResult = s.result || '*';
        if (initTurn === initEngineColor && initResult === '*') {
          setTimeout(() => makeEngineMove(initBoard, initTurn), 500);
        }
      });
    }

    return () => {
      if (engineRef.current) {
        engineRef.current.terminate();
        engineRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Play notification sound when game ends
  useEffect(() => {
    const result = getGameResult(board, halfMoveClock, positionHistory);
    if (result && !gameEndedRef.current) {
      gameEndedRef.current = true;
      playNotifySound();
      if (onGameEnd) onGameEnd(result);
    }
  }, [board, halfMoveClock, positionHistory, getGameResult, onGameEnd]);

  const handleDragStart = (squareIndex, piece) => {
    setDraggedPiece(piece);
    setDraggedFrom(squareIndex);

    const pieceType = Math.abs(piece);
    const isWhite = piece > 0;
    const moves = [];

    for (let toIndex = 0; toIndex < 64; toIndex++) {
      if (toIndex === squareIndex) continue;

      let isValid = false;

      switch (pieceType) {
        case PIECE_TYPES.PAWN:
          isValid = isValidPawnMove(board, squareIndex, toIndex, enPassantTarget);
          break;
        case PIECE_TYPES.KNIGHT:
          isValid = isValidKnightMove(board, squareIndex, toIndex);
          break;
        case PIECE_TYPES.BISHOP:
          isValid = isValidBishopMove(board, squareIndex, toIndex);
          break;
        case PIECE_TYPES.ROOK:
          isValid = isValidRookMove(board, squareIndex, toIndex);
          break;
        case PIECE_TYPES.QUEEN:
          isValid = isValidQueenMove(board, squareIndex, toIndex);
          break;
        case PIECE_TYPES.KING: {
          const kingHasMoved = movedPieces.has(squareIndex);
          isValid = isValidKingMove(board, squareIndex, toIndex, kingHasMoved);
          break;
        }
      }

      if (isValid) {
        const testBoard = [...board];
        testBoard[toIndex] = piece;
        testBoard[squareIndex] = 0;

        if (pieceType === PIECE_TYPES.PAWN && toIndex === enPassantTarget) {
          const { row: toRow, col: toCol } = indexToRowCol(toIndex);
          const capturedPawnRow = isWhite ? toRow + 1 : toRow - 1;
          const capturedPawnIndex = capturedPawnRow * 8 + toCol;
          testBoard[capturedPawnIndex] = 0;
        }

        if (!isKingInCheck(testBoard, isWhite)) {
          moves.push(toIndex);
        }
      }
    }

    setValidMoves(moves);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handlePromotion = (pieceType) => {
    if (promotionSquare === null) return;

    const newBoard = [...board];
    const isWhite = board[promotionSquare] > 0;
    newBoard[promotionSquare] = isWhite ? pieceType : -pieceType;

    setBoard(newBoard);
    setPromotionSquare(null);

    const nextTurn = currentTurn === 'white' ? 'black' : 'white';
    setCurrentTurn(nextTurn);

    const positionKey = generatePositionKey(newBoard);
    const newPosHistory = [...positionHistory];
    newPosHistory[newPosHistory.length - 1] = positionKey;
    setPositionHistory(newPosHistory);

    // Record the promotion move
    if (lastMoveRef.current) {
      recordMove(lastMoveRef.current.from, lastMoveRef.current.to, pieceType);
    }
    const newMoves = [...moveHistory];
    if (lastMoveRef.current) {
      const colChars = 'abcdefgh';
      const { from, to } = lastMoveRef.current;
      const promoChar = { [PIECE_TYPES.QUEEN]: 'q', [PIECE_TYPES.ROOK]: 'r', [PIECE_TYPES.BISHOP]: 'b', [PIECE_TYPES.KNIGHT]: 'n' }[pieceType] || '';
      newMoves.push(colChars[from % 8] + (8 - Math.floor(from / 8)) + colChars[to % 8] + (8 - Math.floor(to / 8)) + promoChar);
    }

    lastMoveRef.current = null;

    // Check for game end
    const result = getGameResult(newBoard, halfMoveClock, newPosHistory);
    triggerSave(newBoard, nextTurn, enPassantTarget, movedPieces, halfMoveClock, newPosHistory, newMoves, result);

    if (nextTurn === engineColor && !result) {
      setTimeout(() => makeEngineMove(newBoard, nextTurn), 500);
    }
  };

  const handleDrop = (squareIndex) => {
    if (draggedFrom === null || draggedFrom === squareIndex) {
      setValidMoves([]);
      return;
    }

    const pieceType = Math.abs(draggedPiece);
    const isWhite = draggedPiece > 0;
    const pieceColor = isWhite ? 'white' : 'black';

    // Check if game is over
    if (gameEndedRef.current) {
      setDraggedPiece(null);
      setDraggedFrom(null);
      setValidMoves([]);
      return;
    }

    const gameOver = isCheckmate(board, true) || isCheckmate(board, false) ||
                     isInsufficientMaterial(board) || halfMoveClock >= 100;
    const currentPos = generatePositionKey(board);
    const repCount = positionHistory.filter(pos => pos === currentPos).length;
    const gameOverRep = repCount >= 3;

    if (gameOver || gameOverRep) {
      setDraggedPiece(null);
      setDraggedFrom(null);
      setValidMoves([]);
      return;
    }

    if (pieceColor !== currentTurn) {
      setDraggedPiece(null);
      setDraggedFrom(null);
      setValidMoves([]);
      return;
    }

    // Validate moves
    if (pieceType === PIECE_TYPES.PAWN && !isValidPawnMove(board, draggedFrom, squareIndex, enPassantTarget)) {
      setDraggedPiece(null); setDraggedFrom(null); setValidMoves([]); return;
    }
    if (pieceType === PIECE_TYPES.ROOK && !isValidRookMove(board, draggedFrom, squareIndex)) {
      setDraggedPiece(null); setDraggedFrom(null); setValidMoves([]); return;
    }
    if (pieceType === PIECE_TYPES.KNIGHT && !isValidKnightMove(board, draggedFrom, squareIndex)) {
      setDraggedPiece(null); setDraggedFrom(null); setValidMoves([]); return;
    }
    if (pieceType === PIECE_TYPES.BISHOP && !isValidBishopMove(board, draggedFrom, squareIndex)) {
      setDraggedPiece(null); setDraggedFrom(null); setValidMoves([]); return;
    }
    if (pieceType === PIECE_TYPES.QUEEN && !isValidQueenMove(board, draggedFrom, squareIndex)) {
      setDraggedPiece(null); setDraggedFrom(null); setValidMoves([]); return;
    }
    if (pieceType === PIECE_TYPES.KING) {
      const kingHasMoved = movedPieces.has(draggedFrom);
      if (!isValidKingMove(board, draggedFrom, squareIndex, kingHasMoved)) {
        setDraggedPiece(null); setDraggedFrom(null); setValidMoves([]); return;
      }
    }

    // Check if move leaves king in check
    const testBoard = [...board];
    testBoard[squareIndex] = draggedPiece;
    testBoard[draggedFrom] = 0;

    if (pieceType === PIECE_TYPES.PAWN && squareIndex === enPassantTarget) {
      const { row: toRow, col: toCol } = indexToRowCol(squareIndex);
      const capturedPawnRow = isWhite ? toRow + 1 : toRow - 1;
      testBoard[capturedPawnRow * 8 + toCol] = 0;
    }

    if (isKingInCheck(testBoard, isWhite)) {
      setDraggedPiece(null);
      setDraggedFrom(null);
      return;
    }

    // Execute the move
    let isCapture = board[squareIndex] !== 0;
    const newBoard = [...board];
    newBoard[squareIndex] = draggedPiece;
    newBoard[draggedFrom] = 0;

    // Handle castling
    if (pieceType === PIECE_TYPES.KING) {
      const { row: fromRow, col: fromCol } = indexToRowCol(draggedFrom);
      const { row: toRow, col: toCol } = indexToRowCol(squareIndex);
      if (Math.abs(toCol - fromCol) === 2) {
        const direction = toCol > fromCol ? 1 : -1;
        const rookCol = direction === 1 ? 7 : 0;
        const rookIndex = fromRow * 8 + rookCol;
        const newRookIndex = toRow * 8 + (toCol - direction);
        newBoard[newRookIndex] = newBoard[rookIndex];
        newBoard[rookIndex] = 0;
      }
    }

    // Handle en passant capture
    if (pieceType === PIECE_TYPES.PAWN && squareIndex === enPassantTarget) {
      const { row: toRow, col: toCol } = indexToRowCol(squareIndex);
      const capturedPawnRow = draggedPiece > 0 ? toRow + 1 : toRow - 1;
      newBoard[capturedPawnRow * 8 + toCol] = 0;
      isCapture = true;
    }

    const newEnPassantTarget = getEnPassantTarget(board, draggedFrom, squareIndex);
    setEnPassantTarget(newEnPassantTarget);

    const isPromotion = needsPromotion(draggedPiece, squareIndex);
    if (isPromotion) {
      setPromotionSquare(squareIndex);
      lastMoveRef.current = { from: draggedFrom, to: squareIndex };
    }

    setBoard(newBoard);

    const newMovedPieces = new Set([...movedPieces, draggedFrom]);
    setMovedPieces(newMovedPieces);

    const newHalfMoveClock = (pieceType === PIECE_TYPES.PAWN || isCapture) ? 0 : halfMoveClock + 1;
    setHalfMoveClock(newHalfMoveClock);

    const positionKey = generatePositionKey(newBoard);
    const newPosHistory = [...positionHistory, positionKey];
    setPositionHistory(newPosHistory);

    setDraggedPiece(null);
    setDraggedFrom(null);
    setValidMoves([]);

    if (isCapture) { playCaptureSound(); } else { playMoveSound(); }

    if (isPromotion) return;

    // Record the move
    recordMove(draggedFrom, squareIndex);
    const newMoves = [...moveHistory];
    const colChars = 'abcdefgh';
    newMoves.push(colChars[draggedFrom % 8] + (8 - Math.floor(draggedFrom / 8)) + colChars[squareIndex % 8] + (8 - Math.floor(squareIndex / 8)));

    const nextTurn = currentTurn === 'white' ? 'black' : 'white';
    setCurrentTurn(nextTurn);

    // Check for game end and save
    const result = getGameResult(newBoard, newHalfMoveClock, newPosHistory);
    triggerSave(newBoard, nextTurn, newEnPassantTarget, newMovedPieces, newHalfMoveClock, newPosHistory, newMoves, result);

    if (nextTurn === engineColor && !result) {
      setTimeout(() => makeEngineMove(newBoard, nextTurn), 500);
    }
  };

  // Make engine move
  const makeEngineMove = async (currentBoard, turn) => {
    if (!engineRef.current || isEngineThinking) return;

    setIsEngineThinking(true);

    try {
      const castlingRights = 'KQkq';

      const move = await engineRef.current.getBestMove(
        currentBoard,
        turn,
        halfMoveClock,
        castlingRights,
        enPassantTarget
      );

      if (move) {
        const newBoard = [...currentBoard];
        const piece = newBoard[move.from];
        newBoard[move.to] = piece;
        newBoard[move.from] = 0;

        const pieceType = Math.abs(piece);

        // Handle castling
        if (pieceType === PIECE_TYPES.KING) {
          const { row: fromRow, col: fromCol } = indexToRowCol(move.from);
          const { row: toRow, col: toCol } = indexToRowCol(move.to);
          if (Math.abs(toCol - fromCol) === 2) {
            const direction = toCol > fromCol ? 1 : -1;
            const rookCol = direction === 1 ? 7 : 0;
            const rookIndex = fromRow * 8 + rookCol;
            const newRookIndex = toRow * 8 + (toCol - direction);
            newBoard[newRookIndex] = newBoard[rookIndex];
            newBoard[rookIndex] = 0;
          }
        }

        // Handle en passant
        if (pieceType === PIECE_TYPES.PAWN && move.to === enPassantTarget) {
          const { row: toRow, col: toCol } = indexToRowCol(move.to);
          const isWhite = piece > 0;
          const capturedPawnRow = isWhite ? toRow + 1 : toRow - 1;
          newBoard[capturedPawnRow * 8 + toCol] = 0;
        }

        const newEnPassantTarget = getEnPassantTarget(currentBoard, move.from, move.to);
        setEnPassantTarget(newEnPassantTarget);

        // Handle promotion
        let promotionType = 0;
        if (move.promotion && needsPromotion(piece, move.to)) {
          const promotionMap = { q: PIECE_TYPES.QUEEN, r: PIECE_TYPES.ROOK, b: PIECE_TYPES.BISHOP, n: PIECE_TYPES.KNIGHT };
          const promotedPiece = piece > 0 ? promotionMap[move.promotion] : -promotionMap[move.promotion];
          newBoard[move.to] = promotedPiece;
          promotionType = promotionMap[move.promotion];
        }

        setBoard(newBoard);

        const newMovedPieces = new Set([...movedPieces, move.from]);
        setMovedPieces(newMovedPieces);

        const isCapture = currentBoard[move.to] !== 0;
        const newHalfMoveClock = (pieceType === PIECE_TYPES.PAWN || isCapture) ? 0 : halfMoveClock + 1;
        setHalfMoveClock(newHalfMoveClock);

        const positionKey = generatePositionKey(newBoard);
        const newPosHistory = [...positionHistory, positionKey];
        setPositionHistory(newPosHistory);

        const nextTurn = turn === 'white' ? 'black' : 'white';
        setCurrentTurn(nextTurn);

        if (isCapture) { playCaptureSound(); } else { playMoveSound(); }

        // Record move
        recordMove(move.from, move.to, promotionType);
        const newMoves = [...moveHistory];
        const colChars = 'abcdefgh';
        const promoChar = move.promotion || '';
        newMoves.push(colChars[move.from % 8] + (8 - Math.floor(move.from / 8)) + colChars[move.to % 8] + (8 - Math.floor(move.to / 8)) + promoChar);

        // Check for game end and save
        const result = getGameResult(newBoard, newHalfMoveClock, newPosHistory);
        triggerSave(newBoard, nextTurn, newEnPassantTarget, newMovedPieces, newHalfMoveClock, newPosHistory, newMoves, result);
      }
    } catch (error) {
      console.error('Engine error:', error);
    } finally {
      setIsEngineThinking(false);
    }
  };

  const renderBoard = () => {
    const boardElements = [];

    for (let y = 0; y < rows; y++) {
      const row = [];

      for (let x = 0; x < cols; x++) {
        const squareIndex = y * 8 + x;
        const piece = board[squareIndex];
        const isLight = (x + y) % 2 === 0;
        const isValidMove = validMoves.includes(squareIndex);
        const squareClass = `square ${isLight ? 'light' : 'dark'}${isValidMove ? ' valid-move' : ''}`;

        row.push(
          <div
            key={`${x}-${y}`}
            className={squareClass}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(squareIndex)}
          >
            {piece !== 0 && (
              <Piece
                type={piece}
                onDragStart={() => handleDragStart(squareIndex, piece)}
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
  };

  // Check game status for display
  const whiteInCheck = isKingInCheck(board, true);
  const blackInCheck = isKingInCheck(board, false);
  const whiteCheckmate = isCheckmate(board, true);
  const blackCheckmate = isCheckmate(board, false);
  const whiteStalemate = !whiteInCheck && whiteCheckmate;
  const blackStalemate = !blackInCheck && blackCheckmate;
  const fiftyMoveRule = halfMoveClock >= 100;
  const currentPosition = generatePositionKey(board);
  const positionCount = positionHistory.filter(pos => pos === currentPosition).length;
  const threefoldRepetition = positionCount >= 3;
  const insufficientMaterial = isInsufficientMaterial(board);

  let gameStatus = '';
  let statusColor = '#ff6b6b';

  if (whiteCheckmate && whiteInCheck) {
    gameStatus = 'Checkmate! Black wins!';
  } else if (blackCheckmate && blackInCheck) {
    gameStatus = 'Checkmate! White wins!';
  } else if (insufficientMaterial) {
    gameStatus = 'Draw - Insufficient material!';
    statusColor = '#4CAF50';
  } else if (fiftyMoveRule) {
    gameStatus = 'Draw - 50 move rule!';
    statusColor = '#4CAF50';
  } else if (threefoldRepetition) {
    gameStatus = 'Draw - Threefold repetition!';
    statusColor = '#4CAF50';
  } else if (whiteStalemate || blackStalemate) {
    gameStatus = 'Stalemate! Game is a draw!';
    statusColor = '#ffa500';
  } else if (whiteInCheck && currentTurn === 'white') {
    gameStatus = 'White is in check!';
  } else if (blackInCheck && currentTurn === 'black') {
    gameStatus = 'Black is in check!';
  }

  return (
    <>
      <div className="game-controls">
        <div className="engine-settings">
          <button className="back-button" onClick={onBackToList}>Back to Games</button>
          {isEngineThinking && <span className="thinking">Engine thinking...</span>}
        </div>
      </div>

      {gameStatus && (
        <div className="game-status" style={{ backgroundColor: statusColor }}>
          {gameStatus}
        </div>
      )}

      <div className="chessboard">
        {renderBoard()}
      </div>

      {promotionSquare !== null && (
        <div className="promotion-overlay">
          <div className="promotion-dialog">
            <h3>Promote Pawn</h3>
            <div className="promotion-choices">
              <button onClick={() => handlePromotion(PIECE_TYPES.QUEEN)}>
                <Piece type={board[promotionSquare] > 0 ? PIECE_TYPES.QUEEN : -PIECE_TYPES.QUEEN} />
                <span>Queen</span>
              </button>
              <button onClick={() => handlePromotion(PIECE_TYPES.ROOK)}>
                <Piece type={board[promotionSquare] > 0 ? PIECE_TYPES.ROOK : -PIECE_TYPES.ROOK} />
                <span>Rook</span>
              </button>
              <button onClick={() => handlePromotion(PIECE_TYPES.BISHOP)}>
                <Piece type={board[promotionSquare] > 0 ? PIECE_TYPES.BISHOP : -PIECE_TYPES.BISHOP} />
                <span>Bishop</span>
              </button>
              <button onClick={() => handlePromotion(PIECE_TYPES.KNIGHT)}>
                <Piece type={board[promotionSquare] > 0 ? PIECE_TYPES.KNIGHT : -PIECE_TYPES.KNIGHT} />
                <span>Knight</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Chessboard;
