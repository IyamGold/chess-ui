import { useState } from 'react';
import { GAME_SERVER_URL } from '../config';

function JoinGame({ sessionReady, onJoined, onCancel }) {
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
      const resp = await fetch(`${GAME_SERVER_URL}/api/rooms/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
    } catch {
      setError('Couldn’t reach the game. Please try again.');
      setLoading(false);
    }
  };

  return (
    <form
      className="new-game-setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (!loading) void handleJoin();
      }}
    >
      <p className="card-eyebrow">A FRIENDLY CHALLENGE</p>
      <h2>Join Game</h2>
      <p className="setup-intro">
        Good company makes a good game. Enter your friend’s invite code.
      </p>

      <div className="join-form">
        <label htmlFor="invite-code">Invite Code</label>
        <input
          id="invite-code"
          type="text"
          className="join-input"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          placeholder="e.g. ROOK42"
          autoFocus
          maxLength={10}
        />
      </div>

      {error && (
        <div className="join-error" role="alert">
          {error}
        </div>
      )}

      <div className="setup-actions">
        <button type="button" className="setup-back" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="setup-start" disabled={loading || !sessionReady}>
          {loading ? 'Joining...' : 'Join'}
        </button>
      </div>
    </form>
  );
}

export default JoinGame;
