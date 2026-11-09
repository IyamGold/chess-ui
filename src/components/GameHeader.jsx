import { useEffect, useRef, useState } from 'react';
import ChessIcon from './ChessIcon';

export default function GameHeader({
  onBack,
  onAccount,
  onLogout,
  loginOrigin,
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!menu.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const act = (callback) => {
    setOpen(false);
    trigger.current?.focus();
    callback();
  };
  return (
    <header className="match-toolbar">
      <div className="match-menu-shell" ref={menu}>
        <button
          className="match-menu"
          ref={trigger}
          aria-label="Open game menu"
          aria-expanded={open}
          aria-controls="game-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="menu-avatar">
            <ChessIcon name="person" />
          </span>
          <ChessIcon name="menu" />
        </button>
        {open && (
          <nav
            className="match-menu-options"
            id="game-navigation"
            aria-label="Game menu"
          >
            <button onClick={() => act(onBack)}>
              <ChessIcon name="games" />
              Back to Games
            </button>
            <button onClick={() => act(onAccount)}>
              <ChessIcon name="user" />
              My account
            </button>
            <button className="menu-logout" onClick={() => act(onLogout)}>
              <ChessIcon name="logout" />
              Log out
            </button>
          </nav>
        )}
      </div>
      <a
        className="wallet-handoff"
        href={`${loginOrigin}/`}
        target="_blank"
        rel="noreferrer"
      >
        <span className="wallet-mark">
          <ChessIcon name="wallet" size={17} />
        </span>
        Login wallet
      </a>
    </header>
  );
}
