import ChessIcon from './ChessIcon';

// The API has no time controls. Keep this honest instead of displaying a fake countdown.
export default function MatchPlayer({
  name,
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
      <span
        className={`match-clock ${active && !finished ? 'active' : ''}`}
        aria-label={`${color}: untimed game`}
      >
        <ChessIcon name="clock" size={16} />
        Untimed
      </span>
    </div>
  );
}
