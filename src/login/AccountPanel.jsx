import { useState } from 'react';
import { useLogin } from './context';
export default function AccountPanel() {
  const { profile, refresh } = useLogin();
  const [name, setName] = useState(profile?.username ?? ''),
    [error, setError] = useState('');
  const save = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const r = await fetch('/api/login/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await refresh();
    } catch (e) {
      setError(e.message || 'Could not save name');
    }
  };
  return (
    <section className="login-account">
      <h2>Your Login account</h2>
      <p>
        {profile.verified_human ? 'Verified human' : 'Human verification not provided'}
        {profile.verification_sandbox ? ' · Sandbox result, not real-world verification' : ''}
      </p>
      <form onSubmit={save}>
        <label>
          Player name{' '}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={3}
            maxLength={24}
            required
            pattern="[A-Za-z0-9-]+"
          />
        </label>
        <button>Save name</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <p>Wallet keys, balances and identity documents never come to Chess.</p>
      <div className="login-actions">
        <a href={`${profile.loginOrigin}/`} target="_blank" rel="noreferrer">
          Open Login wallet / verification
        </a>
        <a href={`${profile.loginOrigin}/#transfer-h`} target="_blank" rel="noreferrer">
          Send a private tip
        </a>
        <a href="/api/login/start?fresh=1">Refresh sign-in and verification</a>
      </div>
      <p className="small">
        For a tip, ask the other player to share their private receiving address outside Chess.
        Enter it only in Login’s “Send privately” screen. Chess never receives the address or
        transfer details. Testnet only.
      </p>
      <p className="small">
        Cross-chain deposits and withdrawals run in Login. Smart-account edge integration is pending
        the wallet team’s implemented interface; this app does not deploy a contract.
      </p>
    </section>
  );
}
