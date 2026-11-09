import { useState } from 'react';
import { useLogin } from './context';
import ChessIcon from '../components/ChessIcon';

export default function AccountPanel() {
  const { profile, refresh } = useLogin();
  const [name, setName] = useState(profile?.username ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const initials = profile.username
    .split('-')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const save = async (event) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const response = await fetch('/api/login/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refresh();
      setSaved(true);
    } catch (e) {
      setError(e.message || 'Could not save name');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section
      className="player-card"
      id="player-account"
      tabIndex={-1}
      aria-labelledby="player-account-title"
    >
      <p className="card-eyebrow">Your profile</p>
      <h2 id="player-account-title">Your Login account</h2>
      <div className="profile-identity">
        <span className="profile-avatar">{initials}</span>
        <div>
          <strong>{profile.username}</strong>
          <span>Ready for your next move</span>
        </div>
      </div>
      <div className={`verification-label ${profile.verified_human ? 'verified' : ''}`}>
        <ChessIcon name={profile.verified_human ? 'verified' : 'user'} size={16} />
        <span>{profile.verified_human ? 'Verified human' : 'Verification optional'}</span>
      </div>
      {profile.verification_sandbox && (
        <p className="sandbox-result">Sandbox result, not real-world verification.</p>
      )}
      <details className="profile-edit">
        <summary>
          <ChessIcon name="edit" size={16} />
          Edit player name
          <ChessIcon name="chevron" size={14} />
        </summary>
        <form onSubmit={save}>
          <label htmlFor="player-name">Player name</label>
          <input
            id="player-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            minLength={3}
            maxLength={24}
            required
            pattern="[A-Za-z0-9-]+"
          />
          <button className="setup-start" disabled={saving}>
            {saving ? 'Saving…' : 'Save name'}
          </button>
        </form>
        {error && (
          <p className="profile-feedback error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="profile-feedback" role="status">
            Name saved.
          </p>
        )}
      </details>
      <div className="profile-links">
        <a href={`${profile.loginOrigin}/`} target="_blank" rel="noreferrer">
          <ChessIcon name="wallet" />
          <span>
            Open Login<small>Wallet &amp; verification</small>
          </span>
          <ChessIcon name="chevron" size={15} />
        </a>
        <a href={`${profile.loginOrigin}/#transfer-h`} target="_blank" rel="noreferrer">
          <ChessIcon name="friends" />
          <span>
            Send a private tip<small>Continue in your Login wallet</small>
          </span>
          <ChessIcon name="chevron" size={15} />
        </a>
        <a href="/api/login/start?fresh=1">
          <ChessIcon name="verified" />
          <span>Refresh verification</span>
          <ChessIcon name="chevron" size={15} />
        </a>
      </div>
      <details className="profile-privacy">
        <summary>
          <ChessIcon name="lock" size={14} />
          Your privacy, by design
        </summary>
        <p>
          Wallet keys, balances and identity documents never come to Chess. Verification is
          optional; you can play without it.
        </p>
        <p>
          For a tip, ask your opponent for their receiving address outside Chess. Enter it only in
          Login’s “Send privately” screen. Chess never receives the address or transfer details.
          Testnet only; no real funds.
        </p>
      </details>
    </section>
  );
}
