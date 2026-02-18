import { useState, useEffect } from 'react';
import { listGames, deleteGame, loadGame } from '../utils/gameManager';
import { formatMoves } from '../hooks/usePublishGame';
import './GameList.css';

function GameList({ onNewGame, onResumeGame }) {
  const [games, setGames] = useState([]);
  const [copiedId, setCopiedId] = useState(null);

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

    const moves = formatMoves(fullGame.moveHistory || []);
    const playerColor = game.engineColor === 'white' ? 'Black' : 'White';
    const text = [
      `Chess Game Record`,
      `Player: ${playerColor} vs Engine (${game.engineColor})`,
      `Result: ${resultLabel(game.result)}`,
      `Date: ${formatDate(game.updatedAt)}`,
      `Moves: ${moves}`,
      game.txHash ? `On-chain: https://testnet.fluentscan.xyz/tx/${game.txHash}` : '',
    ].filter(Boolean).join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(game.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
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
                    title="Copy game record"
                  >
                    {copiedId === game.id ? 'Copied!' : 'Share'}
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
