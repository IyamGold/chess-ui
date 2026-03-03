import { useState } from 'react';

const SERVER_BASE = 'http://localhost:3001';

function JoinGame({ serverToken, onJoined, onCancel }) {
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setError('Enter an invite code');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const resp = await fetch(`${SERVER_BASE}/api/rooms/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serverToken}`,
        },
        body: JSON.stringify({ inviteCode: code }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        setError(data.error || 'Failed to join room');
        setLoading(false);
        return;
      }

      onJoined(data.roomId, data.color);
    } catch (err) {
      setError('Network error — is the server running?');
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleJoin();
  };

  return (
    <div className="new-game-setup">
      <h2>Join Game</h2>

      <div className="join-form">
        <label>Invite Code:</label>
        <input
          type="text"
          className="join-input"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. ROOK42"
          autoFocus
          maxLength={10}
        />
      </div>

      {error && <div className="join-error">{error}</div>}

      <div className="setup-actions">
        <button className="setup-back" onClick={onCancel}>Cancel</button>
        <button className="setup-start" onClick={handleJoin} disabled={loading}>
          {loading ? 'Joining...' : 'Join'}
        </button>
      </div>
    </div>
  );
}

export default JoinGame;
