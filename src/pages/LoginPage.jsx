import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useLogin } from '../login/context';
import './LoginPage.css';

function Fingerprint() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="welcome-fingerprint"
    >
      <g stroke="currentColor" strokeWidth="1.65" strokeLinecap="round">
        <path d="M5.5 12.5a11 11 0 0 1 21 0M3.8 18v-1.8M28.2 16.2V18" />
        <path d="M8.2 15.7a7.8 7.8 0 0 1 15.6 0c0 5.4 1.1 8.6 2.4 11M5.4 23.8c1.5-2.2 2.8-4.7 2.8-8.1" />
        <path d="M11.5 16a4.5 4.5 0 0 1 9 0c0 5.7 1.1 9.8 2.7 13M8.7 28.3c1.8-3.2 2.8-7.6 2.8-12.3" />
        <path d="M16 15.3c0 5.9-.7 10.6-2.6 14.3M16.8 23c.3 2.3.8 4.6 1.6 6.6" />
        <path d="M9 5.3a14 14 0 0 1 14 0" />
      </g>
    </svg>
  );
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="welcome-arrow"
    >
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LoginPage() {
  const login = useLogin();
  const [retrying, setRetrying] = useState(false);
  if (login.isAuthenticated) return <Navigate to="/" replace />;

  const busy = login.loading || retrying;
  const cancelled = new URLSearchParams(location.search).has('error');
  const message =
    login.serviceError ||
    (cancelled
      ? 'Sign-in didn’t finish. Give it another go when you’re ready.'
      : '');
  const retry = async () => {
    setRetrying(true);
    try {
      await login.refresh();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <main className="welcome-page">
      <header className="welcome-header">
        <div className="welcome-brand" aria-label="Login Chess">
          <img src="/blackknight.svg" alt="" width="34" height="40" />
          <span>
            chess<span className="welcome-brand-dot">.</span>
            <small>with Login</small>
          </span>
        </div>
        <p className="welcome-header-note">
          <span aria-hidden="true" />A little friendly competition.
        </p>
      </header>

      <section className="welcome-hero" aria-labelledby="welcome-title">
        <picture className="welcome-art" aria-hidden="true">
          <source
            media="(max-width: 760px)"
            srcSet="/login-art/chess-garden-mobile.webp"
          />
          <img
            src="/login-art/chess-garden-desktop.webp"
            alt=""
            width="1536"
            height="1024"
            fetchPriority="high"
          />
        </picture>
        <div className="welcome-shade" aria-hidden="true" />
        <div className="welcome-content">
          <h1 id="welcome-title">
            <span>Play a friend.</span>
            <span>Challenge the computer.</span>
          </h1>
          <div className="welcome-action-area" aria-busy={busy}>
            {message && !login.loading && (
              <p className="welcome-feedback" role="alert">
                {message}
              </p>
            )}
            {busy ? (
              <button
                className="welcome-primary"
                disabled
                aria-label="Checking session…"
              >
                <span className="welcome-spinner" aria-hidden="true" />
                <span role="status">Checking session…</span>
              </button>
            ) : login.serviceError ? (
              <button className="welcome-primary" onClick={() => void retry()}>
                <Fingerprint />
                <span>Try again</span>
                <Arrow />
              </button>
            ) : (
              <a className="welcome-primary" href="/api/login/start?fresh=1">
                <Fingerprint />
                <span>Continue with Login</span>
                <Arrow />
              </a>
            )}
            <p className="welcome-reassurance">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect
                  x="3.5"
                  y="7"
                  width="9"
                  height="7"
                  rx="2"
                  stroke="currentColor"
                />
                <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" />
              </svg>
              Your passkey. Your move.
            </p>
          </div>
        </div>
      </section>

      <footer className="welcome-footer">
        <p>
          Hackathon demo <span aria-hidden="true">·</span> Testnet only
        </p>
        <p>KYC is optional. Sandbox verification only. No real funds.</p>
      </footer>
    </main>
  );
}
