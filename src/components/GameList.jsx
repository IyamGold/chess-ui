import { useState, useEffect } from 'react';
import { listGames, deleteGame, clearAllGames, loadGame } from '../utils/gameManager';
import { GAME_SERVER_URL } from '../config';
import './GameList.css';

function GameList({ onNewGame, onResumeGame, onResumeOnline, serverToken }) {
  const [games, setGames] = useState([]);
  const [onlineGames, setOnlineGames] = useState([]);

  useEffect(() => {
    setGames(listGames());
  }, []);

  // Fetch active online games
  useEffect(() => {
    if (!serverToken) return;

    async function fetchOnlineGames() {
      try {
        const resp = await fetch(`${GAME_SERVER_URL}/api/rooms`, {
          headers: { 'Authorization': `Bearer ${serverToken}` },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        setOnlineGames(data.rooms || []);
      } catch (err) {
        console.error('Failed to fetch online games:', err);
      }
    }

    fetchOnlineGames();
  }, [serverToken]);

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
    const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

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
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="game-list">
      <h2>Your Games</h2>
      <div className="game-list-actions">
        <button className="new-game-btn" onClick={onNewGame}>+ New Game</button>
        {games.length > 0 && (
          <button className="clear-all-btn" onClick={handleClearAll}>Clear All</button>
        )}
      </div>

      {/* Online games */}
      {onlineGames.length > 0 && (
        <>
          <h3 className="section-label">Online Games</h3>
          <div className="game-cards">
            {onlineGames.map(room => (
              <div key={`online-${room.roomId}`} className="game-card online-card" onClick={() => onResumeOnline(room.roomId)}>
                <div className="game-card-header">
                  <span className={`game-result ${room.status === 'waiting' ? 'waiting' : 'in-progress'}`}>
                    {room.status === 'waiting' ? 'Waiting for opponent' : `${room.currentTurn}'s turn`}
                  </span>
                  <span className="online-badge">Online</span>
                </div>
                <div className="game-card-body">
                  <span>{room.white || '?'} vs {room.black || '?'}</span>
                  <span>{room.moveCount} moves</span>
                </div>
                <div className="game-card-footer">
                  Playing as {room.myColor} &middot; {formatDate(room.updatedAt)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Local games */}
      {games.length > 0 && (
        <>
          {onlineGames.length > 0 && <h3 className="section-label">Local Games</h3>}
          <div className="game-cards">
            {games.map(game => (
              <div key={game.id} className="game-card" onClick={() => onResumeGame(game.id)}>
                <div className="game-card-header">
                  <span className={`game-result ${game.result === '*' ? 'in-progress' : 'finished'}`}>
                    {resultLabel(game.result)}
                  </span>
                  {game.txHash && (
                    <a
                      href={`https://testnet.fluentscan.xyz/tx/${game.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="onchain-badge"
                      onClick={(e) => e.stopPropagation()}
                      title="View on-chain transaction"
                    >
                      On-chain
                    </a>
                  )}
                  <div className="card-actions">
                    {game.result !== '*' && (
                      <button
                        className="share-btn"
                        onClick={(e) => handleShare(e, game)}
                        title="Download game record as XML"
                      >
                        Share
                      </button>
                    )}
                    <button className="delete-btn" onClick={(e) => handleDelete(e, game.id)} title="Delete game">
                      &times;
                    </button>
                  </div>
                </div>
                <div className="game-card-body">
                  <span>Playing as {game.engineColor === 'white' ? 'Black' : 'White'}</span>
                  <span>{game.moveCount} moves</span>
                </div>
                <div className="game-card-footer">
                  {formatDate(game.updatedAt)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {games.length === 0 && onlineGames.length === 0 && (
        <p className="no-games">No saved games yet. Start a new game!</p>
      )}
    </div>
  );
}

export default GameList;
