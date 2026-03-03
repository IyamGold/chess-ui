import { useState } from 'react';
import './AuthGate.css';

export default function AuthGate({ onSignup, onLogin }) {
  const [mode, setMode] = useState(null); // null | 'signup' | 'login'
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onSignup(username.trim());
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await onLogin();
    } catch (err) {
      setError(err.message || 'Login failed. Do you have an account? Try signing up.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <h1 className="auth-title">Chess Board</h1>
        <p className="auth-subtitle">Sign in with a passkey to play</p>

        {error && <div className="auth-error">{error}</div>}

        {loading ? (
          <div className="auth-loading">
            <div className="auth-spinner" />
            <span>{mode === 'signup' ? 'Creating account...' : 'Signing in...'}</span>
          </div>
        ) : mode === 'signup' ? (
          <form className="auth-form" onSubmit={handleSignup}>
            <input
              className="auth-input"
              type="text"
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              maxLength={32}
            />
            <button className="auth-btn auth-btn-primary" type="submit" disabled={!username.trim()}>
              Create Account
            </button>
            <button className="auth-btn auth-btn-back" type="button" onClick={() => { setMode(null); setError(null); }}>
              Back
            </button>
          </form>
        ) : (
          <div className="auth-actions">
            <button className="auth-btn auth-btn-primary" onClick={() => setMode('signup')}>
              Sign Up
            </button>
            <button className="auth-btn auth-btn-secondary" onClick={handleLogin}>
              Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
