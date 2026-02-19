import { useState, useEffect } from 'react';
import { listGames, deleteGame, loadGame } from '../utils/gameManager';
import './GameList.css';

function GameList({ onNewGame, onResumeGame }) {
  const [games, setGames] = useState([]);


  useEffect(() => {
    setGames(listGames());
  }, []);

  const handleDelete = (e, gameId) => {
    e.stopPropagation();
    deleteGame(gameId);
    setGames(listGames());
  };

  const handleShare = (e, game) => {
    e.stopPropagation();
    const fullGame = loadGame(game.id);
    if (!fullGame) return;

    const history = fullGame.moveHistory || [];
    const playerColor = game.engineColor === 'white' ? 'black' : 'white';
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const moveLines = [];
    for (let i = 0; i < history.length; i += 2) {
      const num = Math.floor(i / 2) + 1;
      const white = `    <white>${esc(history[i])}</white>`;
      const black = history[i + 1] ? `\n      <black>${esc(history[i + 1])}</black>` : '';
      moveLines.push(`    <move number="${num}">\n  ${white}${black}\n    </move>`);
    }

    const blockchain = game.txHash
      ? `\n  <blockchain>\n    <network>Fluent Testnet</network>\n    <tx-hash>${esc(game.txHash)}</tx-hash>\n    <explorer>https://testnet.fluentscan.xyz/tx/${esc(game.txHash)}</explorer>\n  </blockchain>`
      : '';

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<chess-game>
  <metadata>
    <id>${esc(game.id)}</id>
    <date>${esc(game.updatedAt)}</date>
    <player color="${esc(playerColor)}">Human</player>
    <player color="${esc(game.engineColor)}">Engine (Stockfish)</player>
    <result code="${esc(game.result)}">${esc(resultLabel(game.result))}</result>
    <total-moves>${history.length}</total-moves>
  </metadata>
  <moves>
${moveLines.join('\n')}
  </moves>${blockchain}
</chess-game>`;

    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chess-game-${game.id}.xml`;
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
      <button className="new-game-btn" onClick={onNewGame}>+ New Game</button>

      {games.length === 0 && <p className="no-games">No saved games yet. Start a new game!</p>}

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
    </div>
  );
}

export default GameList;
