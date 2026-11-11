import { useState, useEffect, useRef, useCallback } from 'react';
import { GAME_SERVER_URL } from '../config';
import { playMoveSound, playCaptureSound } from '../sounds';
import { requestJSON } from '../api';
import { mergeSnapshot, previewMove } from '../gameSnapshot';

export function useOnlineGame({ sessionReady, roomId, onRoomGone }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState(null);
  const current = useRef(null),
    generation = useRef(0),
    alive = useRef(false);
  const pendingRef = useRef(false),
    readController = useRef(null);
  const onRoomGoneRef = useRef(onRoomGone);
  useEffect(() => {
    onRoomGoneRef.current = onRoomGone;
  }, [onRoomGone]);

  const receive = useCallback((data) => {
    if (!alive.current) return;
    const value =
      'clock' in data && data.clock
        ? { ...data, clock: { ...data.clock, receivedAt: performance.now() } }
        : data;
    const next = mergeSnapshot(current.current, value);
    if (next === current.current) return;
    current.current = next;
    setSnapshot(next);
    setPreview(null);
    setError(null);
  }, []);

  const fetchRoom = useCallback(async () => {
    if (!sessionReady || !roomId || !alive.current) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const version = ++generation.current;
    try {
      const data = await requestJSON(`${GAME_SERVER_URL}/api/rooms/${roomId}`, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        version !== generation.current ||
        !alive.current
      )
        return;
      if (!Array.isArray(data.board) || data.board.length !== 64)
        throw new Error('Invalid game state. Please retry.');
      receive(data);
    } catch (err) {
      if (
        controller.signal.aborted ||
        version !== generation.current ||
        !alive.current
      )
        return;
      if (err.status === 404 && onRoomGoneRef.current)
        return onRoomGoneRef.current();
      setError(
        err.name === 'AbortError'
          ? 'The game request timed out. Please retry.'
          : err.message
      );
    }
  }, [sessionReady, roomId, receive]);

  useEffect(() => {
    if (!sessionReady || !roomId) return;
    alive.current = true;
    // EventSource uses the same authenticated HTTP proxy as the API on Vercel.
    // Opening (including reconnect) always resyncs events missed while offline.
    const stream = new EventSource(
      `${GAME_SERVER_URL}/api/rooms/${roomId}/events`
    );
    stream.onopen = () => {
      setConnected(true);
      void fetchRoom();
    };
    stream.onerror = () => {
      if (alive.current) setConnected(false);
    };
    stream.onmessage = (event) => {
      if (!alive.current) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.event === 'move') {
        const old = current.current;
        if (
          msg.data.moveHistory?.length > (old?.moveHistory?.length ?? 0) &&
          old?.currentTurn !== old?.myColor
        ) {
          const to = msg.data.move?.slice(2, 4);
          const index = to
            ? (8 - Number(to[1])) * 8 + 'abcdefgh'.indexOf(to[0])
            : -1;
          if (old?.board?.[index]) playCaptureSound();
          else playMoveSound();
        }
        ++generation.current;
        receive(msg.data);
        // A very early event may arrive before the initial room metadata.
        if (!current.current?.myColor) void fetchRoom();
      } else if (msg.event === 'engineError') {
        setError(msg.data.error);
      } else if (msg.event === 'gameOver') {
        ++generation.current;
        receive({ ...msg.data, status: 'finished' });
        void fetchRoom();
      } else if (msg.event === 'join' || msg.event === 'drawOffer')
        void fetchRoom();
    };
    const resync = () => {
      if (document.visibilityState !== 'hidden') void fetchRoom();
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('online', resync);
    void fetchRoom();
    return () => {
      alive.current = false;
      // Invalidating this counter is intentional; it orders network responses.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++generation.current;
      readController.current?.abort();
      stream.close();
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('online', resync);
    };
  }, [sessionReady, roomId, fetchRoom, receive]);

  const submitMove = useCallback(
    async (uci) => {
      const state = current.current;
      if (
        !alive.current ||
        pendingRef.current ||
        !state?.legalMoves?.includes(uci)
      )
        return { ok: false };
      pendingRef.current = true;
      setPending(true);
      ++generation.current;
      readController.current?.abort();
      setPreview(previewMove(state.board, uci));
      try {
        const data = await requestJSON(
          `${GAME_SERVER_URL}/api/rooms/${roomId}/move`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ move: uci }),
          }
        );
        receive(data);
        return { ok: true, data };
      } catch (err) {
        if (alive.current) {
          setPreview(null);
          await fetchRoom();
          setError(
            err.name === 'AbortError'
              ? 'Move confirmation timed out. Check the board before trying again.'
              : err.message
          );
        }
        return { ok: false, error: err.message };
      } finally {
        pendingRef.current = false;
        if (alive.current) {
          setPending(false);
          setPreview(null);
        }
      }
    },
    [roomId, receive, fetchRoom]
  );

  // One deadline resync, never recurring network polling. The server awards wins.
  useEffect(() => {
    const clock = snapshot?.clock;
    if (!clock?.running || snapshot?.result) return;
    const budget = clock.running === 'white' ? clock.whiteMs : clock.blackMs;
    const timer = setTimeout(
      fetchRoom,
      Math.max(100, budget - (performance.now() - clock.receivedAt) + 100)
    );
    return () => clearTimeout(timer);
  }, [snapshot?.clock, snapshot?.result, fetchRoom]);

  const legalMoves = snapshot?.legalMoves || [];
  const getValidMovesForSquare = (index) => {
    const square = 'abcdefgh'[index % 8] + (8 - Math.floor(index / 8));
    return [
      ...new Set(
        legalMoves
          .filter((uci) => uci.startsWith(square))
          .map((uci) => (8 - Number(uci[3])) * 8 + 'abcdefgh'.indexOf(uci[2]))
      ),
    ];
  };
  const status = snapshot?.result
    ? 'finished'
    : !snapshot?.board
    ? error
      ? 'error'
      : 'loading'
    : snapshot.status === 'waiting'
    ? 'waiting'
    : 'playing';
  return {
    ...snapshot,
    room: snapshot,
    board: preview || snapshot?.board,
    legalMoves,
    moveHistory: snapshot?.moveHistory || [],
    gameResult: snapshot?.result,
    status,
    error,
    connected,
    pending,
    submitMove,
    getValidMovesForSquare,
    fetchRoom,
  };
}
