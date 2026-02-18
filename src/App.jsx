import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import './App.css';
import Chessboard from './Chessboard';
import GameList from './components/GameList';
import { createGame, saveGame, loadGame, markGamePublished } from './utils/gameManager';
import { usePublishGame } from './hooks/usePublishGame';

function App() {
  const [view, setView] = useState('list'); // 'list' | 'setup' | 'playing'
  const [activeGame, setActiveGame] = useState(null);
  const [setupColor, setSetupColor] = useState('white');
  const [publishStatus, setPublishStatus] = useState(null); // null | 'pending' | 'success' | 'error'

  const { publishGame } = usePublishGame();

  const handleNewGame = () => {
    setView('setup');
  };

  const handleStartGame = () => {
    const engineColor = setupColor === 'white' ? 'black' : 'white';
    const game = createGame(engineColor);
    setActiveGame(game);
    setView('playing');
  };

  const handleResumeGame = (gameId) => {
    const game = loadGame(gameId);
    if (game) {
      setActiveGame(game);
      setView('playing');
    }
  };

  const handleSave = (state) => {
    if (!activeGame) return;
    saveGame({ ...state, id: activeGame.id, engineColor: activeGame.engineColor, createdAt: activeGame.createdAt });
  };

  const handleGameEnd = async (result) => {
    if (!activeGame) return;

    // Load the latest auto-saved state (triggerSave already saved the correct final board)
    // Don't use stale activeGame — it holds the initial state from when the game was loaded
    const latestState = loadGame(activeGame.id);
    if (latestState) {
      latestState.result = result;
      saveGame(latestState);
    }
    setActiveGame(prev => ({ ...prev, result }));

    // Use latest state for on-chain publish (has actual move history)
    const finishedGame = latestState || { ...activeGame, result };

    // Attempt on-chain publish
    setPublishStatus('pending');
    const publishResult = await publishGame(finishedGame);

    if (publishResult.published) {
      setPublishStatus('success');
      markGamePublished(finishedGame.id, publishResult.txHash);
      setTimeout(() => setPublishStatus(null), 4000);
    } else if (publishResult.reason === 'wallet-not-connected' || publishResult.reason === 'no-contract-address') {
      setPublishStatus(null); // Silently skip
    } else {
      setPublishStatus('error');
      setTimeout(() => setPublishStatus(null), 5000);
    }
  };

  const handleBackToList = () => {
    setActiveGame(null);
    setPublishStatus(null);
    setView('list');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Chess Board</h1>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
      </header>

      {publishStatus && (
        <div className={`publish-toast ${publishStatus}`}>
          {publishStatus === 'pending' && 'Publishing game on-chain...'}
          {publishStatus === 'success' && 'Game published on-chain!'}
          {publishStatus === 'error' && 'Failed to publish on-chain'}
        </div>
      )}

      {view === 'list' && (
        <GameList onNewGame={handleNewGame} onResumeGame={handleResumeGame} />
      )}

      {view === 'setup' && (
        <div className="new-game-setup">
          <h2>New Game</h2>
          <div className="color-picker">
            <label>Play as:</label>
            <div className="color-options">
              <button
                className={`color-option ${setupColor === 'white' ? 'selected' : ''}`}
                onClick={() => setSetupColor('white')}
              >
                White
              </button>
              <button
                className={`color-option ${setupColor === 'black' ? 'selected' : ''}`}
                onClick={() => setSetupColor('black')}
              >
                Black
              </button>
            </div>
          </div>
          <div className="setup-actions">
            <button className="setup-back" onClick={() => setView('list')}>Cancel</button>
            <button className="setup-start" onClick={handleStartGame}>Start Game</button>
          </div>
        </div>
      )}

      {view === 'playing' && activeGame && (
        <Chessboard
          key={activeGame.id}
          initialState={activeGame}
          onSave={handleSave}
          onGameEnd={handleGameEnd}
          onBackToList={handleBackToList}
          engineColorProp={activeGame.engineColor}
        />
      )}
    </div>
  );
}

export default App;
