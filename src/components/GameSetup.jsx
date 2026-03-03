import { useState } from 'react';

function GameSetup({ onStartLocal, onStartOnline, onJoinGame, onCancel, isServerConnected }) {
  const [color, setColor] = useState('white');
  const [opponent, setOpponent] = useState('local'); // local | online

  const handleStart = () => {
    if (opponent === 'local') {
      onStartLocal(color);
    } else {
      onStartOnline(color);
    }
  };

  return (
    <div className="new-game-setup">
      <h2>New Game</h2>

      <div className="opponent-picker">
        <label>Opponent:</label>
        <div className="opponent-options">
          <button
            className={`opponent-option ${opponent === 'local' ? 'selected' : ''}`}
            onClick={() => setOpponent('local')}
          >
            Local
          </button>
          <button
            className={`opponent-option ${opponent === 'online' ? 'selected' : ''}`}
            onClick={() => setOpponent('online')}
            disabled={!isServerConnected}
          >
            Online
          </button>
        </div>
        {!isServerConnected && (
          <span className="server-offline-msg">Server not connected</span>
        )}
      </div>

      <div className="color-picker">
        <label>Play as:</label>
        <div className="color-options">
          <button
            className={`color-option ${color === 'white' ? 'selected' : ''}`}
            onClick={() => setColor('white')}
          >
            White
          </button>
          <button
            className={`color-option ${color === 'black' ? 'selected' : ''}`}
            onClick={() => setColor('black')}
          >
            Black
          </button>
        </div>
      </div>

      <div className="setup-actions">
        <button className="setup-back" onClick={onCancel}>Cancel</button>
        {isServerConnected && (
          <button className="setup-back" onClick={onJoinGame}>Join Game</button>
        )}
        <button className="setup-start" onClick={handleStart}>Start Game</button>
      </div>
    </div>
  );
}

export default GameSetup;
