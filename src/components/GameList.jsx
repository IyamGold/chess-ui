import { useState, useEffect } from 'react';
import { listGames, deleteGame, clearAllGames, loadGame } from '../utils/gameManager';
import { GAME_SERVER_URL } from '../config';
import './GameList.css';
import ChessIcon from './ChessIcon';
import { requestJSON } from '../api';

function GameList({ onNewGame, onJoinGame, onResumeGame, onResumeOnline, sessionReady }) {
  const [games, setGames] = useState(listGames);
  const [onlineGames, setOnlineGames] = useState([]);
  const [onlineLoading, setOnlineLoading] = useState(true);
  const [onlineError, setOnlineError] = useState('');
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!sessionReady) return;
    let active = true;
    const controller = new AbortController();
    async function fetchOnlineGames() {
      try {
        const data = await requestJSON(`${GAME_SERVER_URL}/api/rooms`, { signal: controller.signal });
        if (active) {
          setOnlineGames(data.rooms || []);
          setOnlineError('');
        }
      } catch {
        if (active) setOnlineError('Your online games couldn’t load. Please try again.');
      } finally {
        if (active) setOnlineLoading(false);
      }
    }
    void fetchOnlineGames();
    return () => {
      active = false;
      controller.abort();
    };
  }, [sessionReady, retry]);

  const handleDelete = (e, gameId) => {
    e.stopPropagation();
    deleteGame(gameId);
    setGames(listGames());
  };

  const handleClearAll = () => {
    if (!window.confirm('Delete all saved games?')) return;
    clearAllGames();
    setGames([]);
  };

  const handleShare = (e, game) => {
    e.stopPropagation();
    const fullGame = loadGame(game.id);
    if (!fullGame) return;

    const history = fullGame.moveHistory || [];
    const playerColor = game.engineColor === 'white' ? 'black' : 'white';
    const d = new Date(game.updatedAt);
    const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
      2,
      '0',
    )}:${String(d.getSeconds()).padStart(2, '0')}`;

    const humanName = playerColor === 'white' ? 'Human' : 'Engine (Stockfish)';
    const engineName = playerColor === 'white' ? 'Engine (Stockfish)' : 'Human';

    let txSection = '';
    if (game.txHash) {
      txSection = `\n\t<key>Blockchain</key>\n\t<string>Fluent Testnet</string>\n\t<key>TxHash</key>\n\t<string>${game.txHash}</string>\n\t<key>Explorer</key>\n\t<string>https://testnet.fluentscan.xyz/tx/${game.txHash}</string>`;
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>White</key>
\t<string>${humanName}</string>
\t<key>WhiteType</key>
\t<string>${playerColor === 'white' ? 'human' : 'program'}</string>
\t<key>Black</key>
\t<string>${engineName}</string>
\t<key>BlackType</key>
\t<string>${playerColor === 'black' ? 'human' : 'program'}</string>
\t<key>Event</key>
\t<string>vs Stockfish</string>
\t<key>StartDate</key>
\t<string>${dateStr}</string>
\t<key>StartTime</key>
\t<string>${timeStr}</string>
\t<key>Result</key>
\t<string>${game.result}</string>
\t<key>Variant</key>
\t<string>normal</string>
\t<key>Moves</key>
\t<string>
${history.join('\n')}
\t</string>${txSection}
</dict>
</plist>`;

    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Game ${game.id}.game`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resultLabel = (result) => {
    if (result === '1-0') return 'White wins';
    if (result === '0-1') return 'Black wins';
    if (result === '1/2-1/2') return 'Draw';
    return 'In progress';
  };

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const matches = (finished) => filter === 'all' || (filter === 'finished' ? finished : !finished);
  const visibleOnline = onlineGames.filter((room) => matches(room.status === 'finished'));
  const visibleLocal = games.filter((game) => matches(game.result !== '*'));
  const total = games.length + onlineGames.length;

  return (
    <div className="game-list dashboard-games">
      <section className="lobby-hero" aria-labelledby="lobby-title">
        <div className="lobby-hero-copy">
          <p className="hero-eyebrow">The board is yours</p>
          <h2 id="lobby-title">
            Your next move
            <br />
            starts here.
          </h2>
          <p>
            A friendly rivalry or a challenge for yourself.
            <br />
            There’s always a good game waiting.
          </p>
          <button className="new-game-btn" aria-label="+ New Game" onClick={() => onNewGame()}>
            <ChessIcon name="plus" size={18} />
            New Game
          </button>
        </div>
        <div className="lobby-hero-art" aria-hidden="true">
          <img src="/login-art/chess-garden-desktop.webp" alt="" width="1536" height="1024" />
        </div>
      </section>
      <div className="play-options" aria-label="Choose how to play">
        <button className="play-option" onClick={() => onNewGame('local')}>
          <span className="play-option-icon">
            <ChessIcon name="computer" size={25} />
          </span>
          <span>
            <strong>Play the computer</strong>
            <small>Sharpen your game with Stockfish.</small>
          </span>
          <ChessIcon name="arrow" size={19} />
        </button>
        <button className="play-option" onClick={() => onNewGame('online')}>
          <span className="play-option-icon">
            <ChessIcon name="friends" size={25} />
          </span>
          <span>
            <strong>Play a friend</strong>
            <small>Share an invite. Make it a rivalry.</small>
          </span>
          <ChessIcon name="arrow" size={19} />
        </button>
      </div>
      <button className="join-shortcut" onClick={onJoinGame}>
        <ChessIcon name="join" size={18} />
        <span>
          Have an invite code? <strong>Join a game</strong>
        </span>
        <ChessIcon name="arrow" size={16} />
      </button>
      <section className="saved-games" id="your-games" aria-labelledby="your-games-title">
        <div className="games-section-heading">
          <h2 id="your-games-title">
            Your games <span className="game-count">{onlineLoading ? '…' : total}</span>
          </h2>
          {games.length > 0 && (
            <button className="clear-all-btn" onClick={handleClearAll}>
              Clear saved games
            </button>
          )}
        </div>
        <div className="game-filters" aria-label="Filter games">
          {[
            ['all', 'All games'],
            ['active', 'In progress'],
            ['finished', 'Finished'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? 'active' : ''}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {onlineLoading && (
          <p className="games-loading" role="status">
            Loading your games…
          </p>
        )}
        {onlineError && (
          <div className="games-load-error" role="alert">
            <p>{onlineError}</p>
            <button
              onClick={() => {
                setOnlineLoading(true);
                setOnlineError('');
                setRetry((value) => value + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        <div className="game-cards">
          {visibleOnline.map((room) => (
            <article className="game-card online-card" key={`online-${room.roomId}`}>
              <span className="game-card-icon">
                <ChessIcon name={room.isStockfish ? 'computer' : 'friends'} size={22} />
              </span>
              <div className="game-card-info">
                <div className="game-card-heading">
                  <strong>
                    {room.white || 'White'} <span>vs</span> {room.black || 'Waiting for a player'}
                  </strong>
                  <span
                    className={`game-result ${
                      room.status === 'finished'
                        ? 'finished'
                        : room.status === 'waiting'
                        ? 'waiting'
                        : 'in-progress'
                    }`}
                  >
                    {room.status === 'finished'
                      ? resultLabel(room.result)
                      : room.status === 'waiting'
                      ? 'Waiting'
                      : `${room.currentTurn} to move`}
                  </span>
                </div>
                <p>
                  {room.moveCount} moves <span>·</span>{' '}
                  {room.myColor ? `Playing as ${room.myColor}` : 'Online game'} <span>·</span>{' '}
                  {formatDate(room.updatedAt)}
                </p>
              </div>
              <button
                className="resume-game"
                onClick={() => onResumeOnline(room.roomId)}
                aria-label={`Open online game ${room.roomId}`}
              >
                <ChessIcon name="arrow" size={19} />
              </button>
            </article>
          ))}
          {visibleLocal.map((game) => (
            <article className="game-card" key={game.id}>
              <span className="game-card-icon">
                <img src="/blackknight.svg" width="25" height="30" alt="" />
              </span>
              <div className="game-card-info">
                <div className="game-card-heading">
                  <strong>
                    You <span>vs</span> Stockfish
                  </strong>
                  <span
                    className={`game-result ${game.result === '*' ? 'in-progress' : 'finished'}`}
                  >
                    {resultLabel(game.result)}
                  </span>
                </div>
                <p>
                  {game.moveCount} moves <span>·</span> Playing as{' '}
                  {game.engineColor === 'white' ? 'Black' : 'White'} <span>·</span>{' '}
                  {formatDate(game.updatedAt)}
                </p>
                {game.txHash && (
                  <a
                    className="onchain-badge"
                    href={`https://testnet.fluentscan.xyz/tx/${game.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on-chain record
                  </a>
                )}
              </div>
              <div className="card-actions">
                {game.result !== '*' && (
                  <button
                    className="share-btn"
                    onClick={(event) => handleShare(event, game)}
                    aria-label={`Download saved game ${game.id}`}
                  >
                    Share
                  </button>
                )}
                <button
                  className="delete-btn"
                  onClick={(event) => handleDelete(event, game.id)}
                  aria-label={`Delete saved game ${game.id}`}
                >
                  ×
                </button>
                <button
                  className="resume-game"
                  onClick={() => onResumeGame(game.id)}
                  aria-label={`Open saved game ${game.id}`}
                >
                  <ChessIcon name="arrow" size={19} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {!onlineLoading &&
          !onlineError &&
          visibleOnline.length === 0 &&
          visibleLocal.length === 0 && (
            <div className="games-empty">
              <div className="empty-board" aria-hidden="true">
                {Array.from({ length: 16 }, (_, index) => (
                  <span
                    key={index}
                    className={(Math.floor(index / 4) + (index % 4)) % 2 ? 'dark' : ''}
                  >
                    {index === 5 && <img src="/blackknight.svg" alt="" />}
                  </span>
                ))}
              </div>
              <h3>{total === 0 ? 'Your first move is waiting.' : 'No games in this view.'}</h3>
              <p>
                {total === 0
                  ? 'Start a new game or join a friend with an invite code.'
                  : 'Try another filter to find your game.'}
              </p>
            </div>
          )}
      </section>
    </div>
  );
}

export default GameList;
