import { useEffect, useState } from 'react';
import ChessIcon from './ChessIcon';
export default function GameClock({ clock, color, active, finished }) {
  const [at, setAt] = useState(() => performance.now());
  useEffect(() => {
    if (!clock?.running || finished) return;
    const tick = () => setAt(performance.now());
    const timer = setInterval(tick, 100);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [clock, finished]);
  const elapsed =
    clock?.running === color && !finished
      ? Math.max(0, at - clock.receivedAt)
      : 0;
  const ms = clock
    ? Math.max(0, (color === 'white' ? clock.whiteMs : clock.blackMs) - elapsed)
    : null;
  const seconds = ms === null ? null : Math.ceil(ms / 1000);
  const text =
    seconds === null
      ? 'Untimed'
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <span
      className={`match-clock${active && !finished ? ' active' : ''}${
        ms !== null && ms <= 30000 ? ' low-time' : ''
      }`}
      aria-label={`${color}: ${text}${
        seconds === null ? ' game' : ' remaining'
      }`}
    >
      {seconds === null && <ChessIcon name="clock" size={16} />}
      {text}
    </span>
  );
}
