import ChessIcon from './ChessIcon';
import GameClock from './GameClock';

// Legacy saved games have no clock; new matches use the server snapshot.
export default function MatchPlayer({
  name,
  clock,
  color,
  isYou = false,
  active = false,
  finished = false,
  thinking = false,
  computer = false,
  position,
}) {
  const label = name || (color === 'white' ? 'White' : 'Black');
  const initial = Array.from(label.trim())[0]?.toUpperCase() || '?';
  return (
    <div className={`match-player match-player--${position}`}>
      <span
        className={`match-avatar ${isYou ? '' : 'match-avatar--opponent'}`}
        aria-hidden="true"
      >
        {computer ? <ChessIcon name="computer" size={21} /> : initial}
      </span>
      <div className="match-name">
        <strong>
          {label}
          {isYou && <span className="you-label"> (You)</span>}
        </strong>
        <small>
          {active && !finished && (
            <span className="turn-dot" aria-hidden="true" />
          )}
          {color === 'white' ? 'White' : 'Black'} pieces
          {finished
            ? ' · Game finished'
            : thinking
            ? ' · Thinking…'
            : active
            ? isYou
              ? ' · Your turn'
              : ' · To move'
            : ''}
        </small>
      </div>
      <GameClock
        clock={clock}
        color={color}
        active={active}
        finished={finished}
      />
    </div>
  );
}
