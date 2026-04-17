import { useState, useEffect, useRef, useCallback } from 'react';
import { GAME_SERVER_URL, GAME_WS_URL } from '../config';
import { playMoveSound, playCaptureSound } from '../sounds';

export function useOnlineGame({ serverToken, roomId }) {
  const [board, setBoard] = useState(null);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [myColor, setMyColor] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [moveHistory, setMoveHistory] = useState([]);
  const [gameResult, setGameResult] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | waiting | playing | finished | error
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serverToken}`,
  }), [serverToken]);

  // Fetch room state from server
  const fetchRoom = useCallback(async () => {
    if (!serverToken || !roomId) return;

    try {
      const resp = await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}`, {
        headers: { 'Authorization': `Bearer ${serverToken}` },
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError(data.error || 'Failed to fetch room');
        setStatus('error');
        return;
      }

      const data = await resp.json();
      setBoard(data.board);
      setCurrentTurn(data.currentTurn);
      setMyColor(data.myColor);
      setLegalMoves(data.legalMoves || []);
      setMoveHistory(data.moveHistory || []);
      setRoom(data);

      if (data.result) {
        setGameResult(data.result);
        setStatus('finished');
      } else if (data.status === 'waiting') {
        setStatus('waiting');
      } else {
        setStatus('playing');
      }
    } catch (err) {
      console.error('Fetch room error:', err);
      setError('Network error');
      setStatus('error');
    }
  }, [serverToken, roomId]);

  // Initial fetch
  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  // WebSocket connection
  useEffect(() => {
    if (!serverToken || !roomId) return;

    const ws = new WebSocket(`${GAME_WS_URL}/api/rooms/${roomId}/ws`, [`token.${serverToken}`]);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.event) {
        case 'joined':
          // Our own connection confirmed
          break;

        case 'join':
          // Another player joined - game is starting
          setStatus('playing');
          fetchRoom();
          break;

        case 'move': {
          // Play sound before updating state — check capture against current board
          if (msg.data.move) {
            const uci = msg.data.move;
            const cols = 'abcdefgh';
            const toCol = cols.indexOf(uci[2]);
            const toRow = 8 - parseInt(uci[3]);
            const toIndex = toRow * 8 + toCol;
            // Use previous board state (before this move) to detect capture
            setBoard(prev => {
              const wasCapture = prev && prev[toIndex] !== 0;
              if (wasCapture) { playCaptureSound(); } else { playMoveSound(); }
              return msg.data.board || prev;
            });
          } else if (msg.data.board) {
            setBoard(msg.data.board);
          }
          if (msg.data.currentTurn) setCurrentTurn(msg.data.currentTurn);
          if (msg.data.legalMoves) setLegalMoves(msg.data.legalMoves);
          if (msg.data.moveHistory) setMoveHistory(msg.data.moveHistory);
          break;
        }

        case 'gameOver':
          setGameResult(msg.data.result);
          setStatus('finished');
          fetchRoom();
          break;

        case 'playerConnected':
        case 'playerDisconnected':
          // Could show connection indicators later
          break;
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [serverToken, roomId, fetchRoom]);

  // Submit a move via REST
  const submitMove = useCallback(async (uciStr) => {
    if (!serverToken || !roomId) return { ok: false };

    try {
      const resp = await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}/move`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ move: uciStr }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        console.error('Move rejected:', data.error);
        return { ok: false, error: data.error };
      }

      // Use response data directly instead of re-fetching
      if (data.board) setBoard(data.board);
      if (data.currentTurn) setCurrentTurn(data.currentTurn);
      if (data.legalMoves) setLegalMoves(data.legalMoves);
      if (data.moveHistory) setMoveHistory(data.moveHistory);

      if (data.gameOver) {
        setGameResult(data.result);
        setStatus('finished');
      }

      return { ok: true, data };
    } catch (err) {
      console.error('Submit move error:', err);
      return { ok: false, error: 'Network error' };
    }
  }, [serverToken, roomId, headers, fetchRoom]);

  // Apply move optimistically on the client before server responds
  const applyOptimisticMove = useCallback((fromIndex, toIndex) => {
    setBoard(prev => {
      if (!prev) return prev;
      const newBoard = [...prev];
      newBoard[toIndex] = newBoard[fromIndex];
      newBoard[fromIndex] = 0;
      return newBoard;
    });
    setCurrentTurn(prev => prev === 'white' ? 'black' : 'white');
    setLegalMoves([]); // Clear until server responds
  }, []);

  // Get valid target squares for a source square from server legal moves
  const getValidMovesForSquare = useCallback((sourceIndex) => {
    const cols = 'abcdefgh';
    const sourceFile = cols[sourceIndex % 8];
    const sourceRank = 8 - Math.floor(sourceIndex / 8);
    const sourceStr = sourceFile + sourceRank;

    const targets = [];
    for (const uci of legalMoves) {
      if (uci.startsWith(sourceStr)) {
        const targetFile = uci[2];
        const targetRank = parseInt(uci[3]);
        const targetCol = cols.indexOf(targetFile);
        const targetRow = 8 - targetRank;
        const targetIndex = targetRow * 8 + targetCol;
        targets.push(targetIndex);
      }
    }

    // Deduplicate (promotions create multiple moves for same target)
    return [...new Set(targets)];
  }, [legalMoves]);

  return {
    board,
    currentTurn,
    myColor,
    legalMoves,
    moveHistory,
    gameResult,
    status,
    error,
    room,
    submitMove,
    applyOptimisticMove,
    getValidMovesForSquare,
    fetchRoom,
  };
}
