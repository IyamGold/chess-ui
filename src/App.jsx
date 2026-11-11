import { useState, useRef } from 'react';
import {
  Navigate,
  useLocation,
  useParams,
  useNavigate,
} from 'react-router-dom';

import './App.css';
import './Dashboard.css';
import './Game.css';
import GameHeader from './components/GameHeader';
import AccountDialog from './components/AccountDialog';
import LoadingScreen from './components/LoadingScreen';
import ChessIcon from './components/ChessIcon';
import Chessboard from './Chessboard';
import GameList from './components/GameList';
import GameSetup from './components/GameSetup';
import JoinGame from './components/JoinGame';
import OnlineChessboard from './components/OnlineChessboard';
import { saveGame, loadGame, setCurrentUser } from './utils/gameManager';
import { useLogin } from './login/context';
import AccountPanel from './login/AccountPanel';
import { GAME_SERVER_URL } from './config';
import { requestJSON } from './api';

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
  const [notice, setNotice] = useState(null);
  const [setupOpponent, setSetupOpponent] = useState('local');
  const [accountOpen, setAccountOpen] = useState(false);

  const passkey = useLogin();
  const sessionReady = passkey.isAuthenticated;
  // Scope game storage to the authenticated user — must be synchronous
  // so that GameList reads the correct localStorage key on first render.
  // (useEffect would run after child effects, causing a race condition.)
  const prevUserRef = useRef(null);
  const currentAccount = passkey.isAuthenticated ? passkey.account : null;
  if (currentAccount !== prevUserRef.current) {
    prevUserRef.current = currentAccount;
    setCurrentUser(currentAccount);
  }

  const handleLogout = async () => {
    try {
      await passkey.logout();
    } catch {
      setNotice('Could not sign out. Try again.');
      return;
    }
    setActiveGame(null);
    setAccountOpen(false);
    setView('list');
    if (onlineRoomId) navigate('/');
  };

  const handleNewGame = (opponent = 'local') => {
    setSetupOpponent(opponent);
    setNotice(null);
    setView('setup');
  };

  // New computer matches use the existing server Stockfish service so clocks
  // and timeout results have the same authority as human-vs-human matches.
  const startMatch = async (color, opponent) => {
    setNotice(null);
    try {
      const health = await requestJSON(`${GAME_SERVER_URL}/api/health`);
      if (health.gameProtocol !== 2 || health.timeControl !== '10+0') {
        setNotice(
          'Timed games are temporarily unavailable while the game service updates. Please try again shortly.'
        );
        return;
      }
      const data = await requestJSON(`${GAME_SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color, opponent }),
      });
      navigate(`/game/${data.roomId}`);
    } catch (err) {
      setNotice(
        err.name === 'AbortError'
          ? 'Starting the game timed out. Please try again.'
          : err.message
      );
    }
  };
  const handleStartLocal = (color) => startMatch(color, 'stockfish');

  const handleStartOnline = (color) => startMatch(color, 'human');

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
    saveGame({
      ...state,
      id: activeGame.id,
      engineColor: activeGame.engineColor,
      createdAt: activeGame.createdAt,
    });
  };

  const handleGameEnd = async (result) => {
    if (!activeGame) return;

    const latestState = loadGame(activeGame.id);
    if (latestState) {
      latestState.result = result;
      saveGame(latestState);
    }
    setActiveGame((prev) => ({ ...prev, result }));
  };

  const handleBackToList = () => {
    setAccountOpen(false);
    setActiveGame(null);
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
  if (passkey.loading) return <LoadingScreen fullScreen />;
  if (!passkey.isAuthenticated) {
    const returnTo = location.pathname + location.search;
    return (
      <Navigate
        to={`/login?return_to=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  const atLobby = !onlineRoomId && view === 'list';
  const atGame = Boolean(onlineRoomId) || view === 'playing';
  const scrollBehavior = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
  const showAccount = () => {
    if (atGame) {
      setAccountOpen(true);
      return;
    }
    const panel = document.getElementById('player-account');
    panel?.scrollIntoView({ block: 'center', behavior: scrollBehavior });
    panel?.focus({ preventScroll: true });
  };
  const closeAccount = () => {
    setAccountOpen(false);
    requestAnimationFrame(() => document.querySelector('.match-menu')?.focus());
  };
  const showGames = () => {
    handleBackToList();
    requestAnimationFrame(() =>
      document
        .getElementById('your-games')
        ?.scrollIntoView({ block: 'start', behavior: scrollBehavior })
    );
  };
  const initials = (passkey.username || 'Player')
    .split('-')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const pageTitle =
    onlineRoomId || view === 'playing'
      ? 'At the board'
      : view === 'setup'
      ? 'New game'
      : view === 'join'
      ? 'Join a game'
      : 'Let’s play';

  return (
    <div className={`app chess-app${atGame ? ' match-view' : ''}`}>
      {atGame && (
        <GameHeader
          onBack={handleBackToList}
          onAccount={showAccount}
          onLogout={handleLogout}
          loginOrigin={passkey.profile.loginOrigin}
        />
      )}
      <div className="chess-shell">
        <aside className="chess-navigation">
          <button
            className="chess-brand"
            onClick={handleBackToList}
            aria-label="Chess home"
          >
            <img src="/blackknight.svg" width="33" height="40" alt="" />
            <span>
              chess<span className="brand-dot">.</span>
              <small>with Login</small>
            </span>
          </button>
          <p className="navigation-label">Your chess corner</p>
          <nav aria-label="Chess navigation">
            <button
              className={atLobby ? 'nav-item active' : 'nav-item'}
              aria-current={atLobby ? 'page' : undefined}
              onClick={handleBackToList}
            >
              <ChessIcon name="play" />
              <span>Play</span>
              <ChessIcon name="chevron" size={15} />
            </button>
            <button
              className="nav-item"
              aria-label="My games"
              onClick={showGames}
            >
              <ChessIcon name="games" />
              <span>Games</span>
            </button>
            <button
              className="nav-item"
              aria-label="My account"
              onClick={showAccount}
            >
              <ChessIcon name="user" />
              <span>Account</span>
            </button>
          </nav>
          <div className="sidebar-note">
            <ChessIcon name="shield" size={22} />
            <p>
              One account.
              <br />
              <strong>Every move is yours.</strong>
            </p>
            <span>Powered by Login</span>
          </div>
        </aside>
        <div className="chess-main">
          <header className="chess-topbar">
            <h1>{pageTitle}</h1>
            <div className="player-tools">
              <button
                className="player-pill"
                onClick={showAccount}
                aria-label={`Open account for ${passkey.username}`}
              >
                <span className="player-avatar">{initials}</span>
                <span>
                  {passkey.username}
                  <small>Signed in with Login</small>
                </span>
              </button>
              <button
                className="logout-button"
                aria-label="Log out"
                onClick={handleLogout}
              >
                <ChessIcon name="logout" size={18} />
                <span>Log out</span>
              </button>
            </div>
          </header>
          {notice && (
            <div className="dashboard-notice" role="alert">
              {notice}
            </div>
          )}
          <div className="workspace-columns">
            <main className="chess-workspace">
              {onlineRoomId ? (
                <OnlineChessboard
                  key={onlineRoomId}
                  sessionReady={sessionReady}
                  roomId={onlineRoomId}
                  onBackToList={handleBackToList}
                  onRoomGone={handleRoomGone}
                />
              ) : (
                <>
                  {view === 'list' && (
                    <GameList
                      onNewGame={handleNewGame}
                      onJoinGame={handleJoinGame}
                      onResumeGame={handleResumeGame}
                      onResumeOnline={(roomId) => navigate(`/game/${roomId}`)}
                      sessionReady={sessionReady}
                    />
                  )}

                  {view === 'setup' && (
                    <GameSetup
                      initialOpponent={setupOpponent}
                      onStartLocal={handleStartLocal}
                      onStartOnline={handleStartOnline}
                      onJoinGame={handleJoinGame}
                      onCancel={() => setView('list')}
                      isServerConnected={sessionReady}
                    />
                  )}

                  {view === 'join' && (
                    <JoinGame
                      sessionReady={sessionReady}
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
            </main>
            {!atGame && (
              <aside className="player-sidebar">
                <AccountPanel />
              </aside>
            )}
          </div>
          {!atGame && (
            <button className="mobile-logout" onClick={handleLogout}>
              <ChessIcon name="logout" size={18} />
              Log out
            </button>
          )}
          <footer className={atGame ? 'match-footer' : 'chess-footer'}>
            <span>
              {atGame
                ? 'Chess with Login'
                : 'Good games. Your people. Your next move.'}
            </span>
            <span>
              Unaudited demo <b aria-hidden="true">·</b> Testnet only
            </span>
          </footer>
        </div>
      </div>
      {atGame && accountOpen && <AccountDialog onClose={closeAccount} />}
    </div>
  );
}

export default App;
