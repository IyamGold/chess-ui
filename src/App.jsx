import { useState, useEffect, useRef } from 'react';

import './App.css';
import Chessboard from './Chessboard';
import GameList from './components/GameList';
import AuthGate from './components/AuthGate';
import GameSetup from './components/GameSetup';
import JoinGame from './components/JoinGame';
import WaitingRoom from './components/WaitingRoom';
import OnlineChessboard from './components/OnlineChessboard';
import { createGame, saveGame, loadGame, markGamePublished, setCurrentUser } from './utils/gameManager';
import { usePasskeyAuth } from './hooks/usePasskeyAuth';
import { usePasskeyPublish } from './hooks/usePasskeyPublish';
import { useServerAuth } from './hooks/useServerAuth';
import { GAME_SERVER_URL } from './config';

// Persist/restore online game session across reloads
const SS_ONLINE_KEY = 'online_game_session';

function saveOnlineSession(view, roomId, inviteCode) {
  if (view === 'online' || view === 'waiting') {
    localStorage.setItem(SS_ONLINE_KEY, JSON.stringify({ view, roomId, inviteCode }));
  } else {
    localStorage.removeItem(SS_ONLINE_KEY);
  }
}

function loadOnlineSession() {
  try {
    const raw = localStorage.getItem(SS_ONLINE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function App() {
  const saved = loadOnlineSession();
  const [view, setView] = useState(saved?.view || 'list');
  const [activeGame, setActiveGame] = useState(null);
  const [publishStatus, setPublishStatus] = useState(null);

  // Online game state
  const [onlineRoomId, setOnlineRoomId] = useState(saved?.roomId || null);
  const [onlineInviteCode, setOnlineInviteCode] = useState(saved?.inviteCode || null);

  const passkey = usePasskeyAuth();
  const serverAuth = useServerAuth({
    isAuthenticated: passkey.isAuthenticated,
    account: passkey.account,
    username: passkey.username,
  });
  const { publishGame: passkeyPublish } = usePasskeyPublish({
    account: passkey.account,
    credentialId: passkey.credentialId,
    rawId: passkey.rawId,
  });

  // Persist online session to sessionStorage on state changes
  useEffect(() => {
    saveOnlineSession(view, onlineRoomId, onlineInviteCode);
  }, [view, onlineRoomId, onlineInviteCode]);

  // Scope game storage to the authenticated user — must be synchronous
  // so that GameList reads the correct localStorage key on first render.
  // (useEffect would run after child effects, causing a race condition.)
  const prevUserRef = useRef(null);
  const currentAccount = passkey.isAuthenticated ? passkey.account : null;
  if (currentAccount !== prevUserRef.current) {
    prevUserRef.current = currentAccount;
    setCurrentUser(currentAccount);
  }

  const handleLogout = () => {
    passkey.logout();
    serverAuth.logout();
    setActiveGame(null);
    setPublishStatus(null);
    setOnlineRoomId(null);
    setOnlineInviteCode(null);
    setView('list');
  };

  const handleNewGame = () => {
    setView('setup');
  };

  // Local AI game start
  const handleStartLocal = (color) => {
    const engineColor = color === 'white' ? 'black' : 'white';
    const game = createGame(engineColor);
    setActiveGame(game);
    setView('playing');
  };

  // Online game start
  const handleStartOnline = async (color) => {
    if (!serverAuth.serverToken) return;

    try {
      const resp = await fetch(`${GAME_SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serverAuth.serverToken}`,
        },
        body: JSON.stringify({ color, opponent: 'human' }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        console.error('Create room failed:', data.error);
        return;
      }

      setOnlineRoomId(data.roomId);
      setOnlineInviteCode(data.inviteCode);
      setView('waiting');
    } catch (err) {
      console.error('Create room error:', err);
    }
  };

  const handleJoinGame = () => {
    setView('join');
  };

  const handleJoined = (roomId) => {
    setOnlineRoomId(roomId);
    setView('online');
  };

  const handleWaitingGameStart = (roomId) => {
    setOnlineRoomId(roomId);
    setView('online');
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

    const latestState = loadGame(activeGame.id);
    if (latestState) {
      latestState.result = result;
      saveGame(latestState);
    }
    setActiveGame(prev => ({ ...prev, result }));

    const finishedGame = latestState || { ...activeGame, result };

    setPublishStatus('pending');
    const publishResult = await passkeyPublish(finishedGame);

    if (publishResult.published) {
      setPublishStatus('success');
      markGamePublished(finishedGame.id, publishResult.txHash);
      setTimeout(() => setPublishStatus(null), 4000);
    } else if (['no-contract-address', 'passkey-not-authenticated'].includes(publishResult.reason)) {
      setPublishStatus(null);
    } else {
      setPublishStatus('error');
      setTimeout(() => setPublishStatus(null), 5000);
    }
  };

  const handleBackToList = () => {
    setActiveGame(null);
    setPublishStatus(null);
    setOnlineRoomId(null);
    setOnlineInviteCode(null);
    setView('list');
  };

  // Unauthenticated: show auth gate only
  if (!passkey.isAuthenticated) {
    return <AuthGate onSignup={passkey.signup} onLogin={passkey.login} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Chess Board</h1>
        <div className="passkey-status">
          <span className="passkey-badge" title={passkey.account}>
            {passkey.username || passkey.account?.slice(0, 6) + '...' + passkey.account?.slice(-4)}
          </span>
          {serverAuth.isConnected && <span className="server-badge">Online</span>}
          <button className="passkey-logout" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      {publishStatus && (
        <div className={`publish-toast ${publishStatus}`}>
          {publishStatus === 'pending' && 'Publishing game on-chain...'}
          {publishStatus === 'success' && 'Game published on-chain!'}
          {publishStatus === 'error' && 'Failed to publish on-chain'}
        </div>
      )}

      {view === 'list' && (
        <GameList
          onNewGame={handleNewGame}
          onResumeGame={handleResumeGame}
          onResumeOnline={(roomId) => { setOnlineRoomId(roomId); setView('online'); }}
          serverToken={serverAuth.serverToken}
        />
      )}

      {view === 'setup' && (
        <GameSetup
          onStartLocal={handleStartLocal}
          onStartOnline={handleStartOnline}
          onJoinGame={handleJoinGame}
          onCancel={() => setView('list')}
          isServerConnected={serverAuth.isConnected}
        />
      )}

      {view === 'join' && (
        <JoinGame
          serverToken={serverAuth.serverToken}
          onJoined={handleJoined}
          onCancel={() => setView('setup')}
        />
      )}

      {view === 'waiting' && (
        <WaitingRoom
          inviteCode={onlineInviteCode}
          serverToken={serverAuth.serverToken}
          roomId={onlineRoomId}
          onGameStart={handleWaitingGameStart}
          onCancel={handleBackToList}
        />
      )}

      {view === 'online' && onlineRoomId && (
        <OnlineChessboard
          key={onlineRoomId}
          serverToken={serverAuth.serverToken}
          roomId={onlineRoomId}
          onBackToList={handleBackToList}
        />
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
