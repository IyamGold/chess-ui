import { useState, useEffect, useRef } from 'react';
import { GAME_WS_URL } from '../config';

function WaitingRoom({ inviteCode, serverToken, roomId, onGameStart, onCancel }) {
  const [copied, setCopied] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!serverToken || !roomId) return;

    const ws = new WebSocket(`${GAME_WS_URL}/api/rooms/${roomId}/ws`, [`token.${serverToken}`]);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.event === 'join') {
        onGameStart(roomId);
      }
    };

    ws.onerror = (err) => {
      console.error('WaitingRoom WS error:', err);
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [serverToken, roomId, onGameStart]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS
      const el = document.createElement('textarea');
      el.value = inviteCode;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="new-game-setup waiting-room">
      <h2>Waiting for Opponent</h2>

      <p className="waiting-subtitle">Share this code with your opponent:</p>

      <div className="invite-code-display">
        <span className="invite-code">{inviteCode}</span>
        <button className="copy-button" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p className="waiting-hint">The game will start automatically when they join.</p>

      <div className="setup-actions">
        <button className="setup-back" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default WaitingRoom;
