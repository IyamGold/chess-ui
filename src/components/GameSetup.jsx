import { useState } from 'react';
import ChessIcon from './ChessIcon';

function GameSetup({
  onStartLocal,
  onStartOnline,
  onJoinGame,
  onCancel,
  isServerConnected,
  initialOpponent = 'local',
}) {
  const [color, setColor] = useState('white');
  const [opponent, setOpponent] = useState(initialOpponent); // local | online

  const [starting, setStarting] = useState(false);
  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    try {
      if (opponent === 'local') await onStartLocal(color);
      else await onStartOnline(color);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="new-game-setup" aria-busy={starting}>
      <p className="card-eyebrow">MAKE IT YOUR GAME</p>
      <h2>New Game</h2>
      <p className="setup-intro">Choose your opponent and the side you’d like to play.</p>

      <div className="opponent-picker">
        <label>Opponent:</label>
        <div className="opponent-options">
          <button
            disabled={starting}
            aria-pressed={opponent === 'local'}
            className={`opponent-option ${opponent === 'local' ? 'selected' : ''}`}
            onClick={() => setOpponent('local')}
          >
            <ChessIcon name="computer" size={23} />
            Computer (Stockfish)
          </button>
          <button
            aria-pressed={opponent === 'online'}
            className={`opponent-option ${opponent === 'online' ? 'selected' : ''}`}
            onClick={() => setOpponent('online')}
            disabled={starting || !isServerConnected}
          >
            <ChessIcon name="friends" size={23} />
            Friend online
          </button>
        </div>
        {!isServerConnected && <span className="server-offline-msg">Server not connected</span>}
      </div>

      <div className="color-picker">
        <label>Play as:</label>
        <div className="color-options">
          <button
            disabled={starting}
            aria-pressed={color === 'white'}
            className={`color-option ${color === 'white' ? 'selected' : ''}`}
            onClick={() => setColor('white')}
          >
            <img src="/whiteking.svg" width="28" height="30" alt="" draggable={false} />
            White
          </button>
          <button
            disabled={starting}
            aria-pressed={color === 'black'}
            className={`color-option ${color === 'black' ? 'selected' : ''}`}
            onClick={() => setColor('black')}
          >
            <img src="/blackking.svg" width="28" height="30" alt="" draggable={false} />
            Black
          </button>
        </div>
      </div>

      <div className="setup-actions">
        <button className="setup-back" onClick={onCancel} disabled={starting}>
          Cancel
        </button>
        {isServerConnected && (
          <button className="setup-back" onClick={onJoinGame} disabled={starting}>
            Join Game
          </button>
        )}
        <button
          className="setup-start"
          onClick={() => void handleStart()}
          disabled={starting || (opponent === 'online' && !isServerConnected)}
        >
          {starting ? 'Starting…' : 'Start Game'}
        </button>
      </div>
    </div>
  );
}

export default GameSetup;
