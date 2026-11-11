import { useState, useEffect, useRef, useCallback } from 'react';
import { GAME_SERVER_URL, GAME_WS_URL } from '../config';
import { playMoveSound, playCaptureSound } from '../sounds';

export function useOnlineGame({ sessionReady, roomId, onRoomGone }) {
  const [board, setBoard] = useState(null);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [myColor, setMyColor] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [moveHistory, setMoveHistory] = useState([]);
  const [gameResult, setGameResult] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | waiting | playing | finished | error
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);
  const [clock, setClock] = useState(null);
  const receiveClock = useCallback(
    (value) =>
      setClock(value ? { ...value, receivedAt: performance.now() } : null),
    []
  );

  const wsRef = useRef(null);

  // Keep the latest onRoomGone in a ref so fetchRoom's identity (and the
  // WebSocket effect that depends on it) stays stable across renders.
  const onRoomGoneRef = useRef(onRoomGone);
  useEffect(() => {
    onRoomGoneRef.current = onRoomGone;
  }, [onRoomGone]);

  const headers = useCallback(
    () => ({
      'Content-Type': 'application/json',
    }),
    []
  );

  // Fetch room state from server
  const fetchRoom = useCallback(async () => {
    if (!sessionReady || !roomId) return;

    try {
      const resp = await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}`, {});

      if (!resp.ok) {
        // 404 = the room/game no longer exists (abandoned, reaped, or never
        // existed). This is a stale session, not a transient failure — hand
        // it to the caller to clear and route back to the list instead of
        // stranding the user on an error screen.
        if (resp.status === 404 && onRoomGoneRef.current) {
          onRoomGoneRef.current();
          return;
        }
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
      receiveClock(data.clock);

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
  }, [sessionReady, roomId, receiveClock]);

  // Initial fetch
  useEffect(() => {
    void Promise.resolve().then(fetchRoom);
  }, [fetchRoom]);

  // WebSocket connection — with auto-reconnect (backoff) and resync on reopen.
  useEffect(() => {
    if (!sessionReady || !roomId) return;

    let unmounted = false;
    let attempt = 0;
    let reconnectTimer = null;
    let firstConnect = true;

    function handleMessage(event) {
      const msg = JSON.parse(event.data);

      switch (msg.event) {
        case 'joined':
          break;

        case 'drawOffer':
          fetchRoom();
          break;

        case 'join':
          setStatus('playing');
          fetchRoom();
          break;

        case 'move': {
          if ('clock' in msg.data) receiveClock(msg.data.clock);
          if (msg.data.move) {
            const uci = msg.data.move;
            const cols = 'abcdefgh';
            const toCol = cols.indexOf(uci[2]);
            const toRow = 8 - parseInt(uci[3]);
            const toIndex = toRow * 8 + toCol;
            setBoard((prev) => {
              const wasCapture = prev && prev[toIndex] !== 0;
              if (wasCapture) {
                playCaptureSound();
              } else {
                playMoveSound();
              }
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
          if ('clock' in msg.data) receiveClock(msg.data.clock);
          setGameResult(msg.data.result);
          setStatus('finished');
          fetchRoom();
          break;

        case 'playerConnected':
        case 'playerDisconnected':
          break;
      }
    }

    function connect() {
      if (unmounted) return;
      reconnectTimer = null;

      const ws = new WebSocket(`${GAME_WS_URL}/api/rooms/${roomId}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        // Resync after a reconnect — initial mount already fetches via the fetchRoom effect.
        if (!firstConnect) fetchRoom();
        firstConnect = false;
      };

      ws.onmessage = handleMessage;

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (unmounted) return;
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    function forceReconnect() {
      if (unmounted) return;
      const ws = wsRef.current;
      if (
        ws &&
        (ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING)
      )
        return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      attempt = 0;
      connect();
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        forceReconnect();
        fetchRoom();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', forceReconnect);

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', forceReconnect);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [sessionReady, roomId, fetchRoom, receiveClock]);

  // Submit a move via REST
  const submitMove = useCallback(
    async (uciStr) => {
      if (!sessionReady || !roomId) return { ok: false };

      try {
        const resp = await fetch(
          `${GAME_SERVER_URL}/api/rooms/${roomId}/move`,
          {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ move: uciStr }),
          }
        );

        const data = await resp.json();

        if (!resp.ok) {
          console.error('Move rejected:', data.error);
          await fetchRoom(); // Roll back the optimistic board after a rejected move.
          return { ok: false, error: data.error };
        }

        // Use response data directly instead of re-fetching
        if ('clock' in data) receiveClock(data.clock);
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
        await fetchRoom();
        return { ok: false, error: 'Network error' };
      }
    },
    [sessionReady, roomId, headers, fetchRoom, receiveClock]
  );

  // Apply move optimistically on the client before server responds
  const applyOptimisticMove = useCallback((fromIndex, toIndex) => {
    setBoard((prev) => {
      if (!prev) return prev;
      const newBoard = [...prev];
      newBoard[toIndex] = newBoard[fromIndex];
      newBoard[fromIndex] = 0;
      return newBoard;
    });
    setCurrentTurn((prev) => (prev === 'white' ? 'black' : 'white'));
    setLegalMoves([]); // Clear until server responds
  }, []);

  // Get valid target squares for a source square from server legal moves
  const getValidMovesForSquare = useCallback(
    (sourceIndex) => {
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
    },
    [legalMoves]
  );

  // Expiry needs no client move. The server ticker broadcasts it; this GET is a
  // reconnect/fallback path and never awards a result on the browser's authority.
  useEffect(() => {
    if (!clock?.running || status !== 'playing') return;
    const budget = clock.running === 'white' ? clock.whiteMs : clock.blackMs;
    const timer = setTimeout(
      fetchRoom,
      Math.max(100, budget - (performance.now() - clock.receivedAt) + 100)
    );
    return () => clearTimeout(timer);
  }, [clock, status, fetchRoom]);
  return {
    clock,
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
