import { useState, useRef } from 'react';
import { Navigate, useLocation, useParams, useNavigate } from 'react-router-dom';

import './App.css';
import Chessboard from './Chessboard';
import GameList from './components/GameList';
import GameSetup from './components/GameSetup';
import JoinGame from './components/JoinGame';
import OnlineChessboard from './components/OnlineChessboard';
import { createGame, saveGame, loadGame, markGamePublished, setCurrentUser } from './utils/gameManager';
import { usePasskeyAuth } from './hooks/usePasskeyAuth';
import { usePasskeyPublish } from './hooks/usePasskeyPublish';
import { useServerAuth } from './hooks/useServerAuth';
import { GAME_SERVER_URL } from './config';

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  // The active online room is identified by the URL (/game/:roomId), so it is
  // deep-linkable, shareable, and restores correctly on reload — even with
  // multiple concurrent games. No localStorage session needed.
  const { roomId: roomIdParam } = useParams();
  const onlineRoomId = roomIdParam ? Number(roomIdParam) : null;

  const [view, setView] = useState('list');
  const [activeGame, setActiveGame] = useState(null);
  const [publishStatus, setPublishStatus] = useState(null);
  const [notice, setNotice] = useState(null);

  const passkey = usePasskeyAuth();
  const serverAuth = useServerAuth({
    isAuthenticated: passkey.isAuthenticated,
    account: passkey.account,
    username: passkey.username,
    credentialId: passkey.credentialId,
  });
  const { publishGame: passkeyPublish } = usePasskeyPublish({
    account: passkey.account,
    credentialId: passkey.credentialId,
    rawId: passkey.rawId,
  });

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
    setView('list');
    if (onlineRoomId) navigate('/');
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

      // The room starts in 'waiting'; OnlineChessboard shows the invite code
      // until the opponent joins, then swaps to the board.
      navigate(`/game/${data.roomId}`);
    } catch (err) {
      console.error('Create room error:', err);
    }
  };

  const handleJoinGame = () => {
    setView('join');
  };

  const handleJoined = (roomId) => {
    navigate(`/game/${roomId}`);
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
    setView('list');
    if (onlineRoomId) navigate('/');
  };

  // The online room no longer exists (abandoned, reaped, or stale link).
  // Clear it from the URL and return to the list with a brief notice instead
  // of stranding the user on an error screen.
  const handleRoomGone = () => {
    setView('list');
    navigate('/');
    setNotice('That game is no longer available.');
    setTimeout(() => setNotice(null), 5000);
  };

  // Unauthenticated: route to /login, preserving where they tried to go.
  if (!passkey.isAuthenticated) {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/login?return_to=${encodeURIComponent(returnTo)}`} replace />;
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

      {notice && <div className="publish-toast error">{notice}</div>}

      {onlineRoomId ? (
        <OnlineChessboard
          key={onlineRoomId}
          serverToken={serverAuth.serverToken}
          roomId={onlineRoomId}
          onBackToList={handleBackToList}
          onRoomGone={handleRoomGone}
        />
      ) : (
        <>
          {view === 'list' && (
            <GameList
              onNewGame={handleNewGame}
              onResumeGame={handleResumeGame}
              onResumeOnline={(roomId) => navigate(`/game/${roomId}`)}
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
        </>
      )}
    </div>
  );
}

export default App;
