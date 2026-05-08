import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MCP_SERVER_URL } from '../config';
import { usePasskeyAuth } from '../hooks/usePasskeyAuth';
import './AuthPages.css';

// Phases:
//   loading      – fetching client info
//   resolving    – calling passkey-resolve / has-agent
//   name-agent   – first-time auth for this client; ask for agent name
//   submitting   – provision-agent / issue-consent / authorize/complete in flight
//   error        – terminal error
//   expired      – auth_request expired or missing

export default function AuthPage() {
  const passkey = usePasskeyAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestId = new URLSearchParams(location.search).get('request_id');

  const [phase, setPhase] = useState('loading');
  const [client, setClient] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [humanUserId, setHumanUserId] = useState(null);
  const [agentUsername, setAgentUsername] = useState('');

  const resolveStartedRef = useRef(false);

  // 1. Load OAuth params for this request_id.
  useEffect(() => {
    if (!requestId) {
      setPhase('expired');
      setErrorMsg('Missing request_id. Start the connection from your AI client.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${MCP_SERVER_URL}/authorize/lookup?request_id=${encodeURIComponent(requestId)}`);
        if (cancelled) return;
        if (resp.status === 410 || resp.status === 404) {
          setPhase('expired');
          setErrorMsg('This authorization session has expired. Retry from your AI client.');
          return;
        }
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `Lookup failed (${resp.status})`);
        }
        const data = await resp.json();
        setClient(data);
        // If user isn't signed in, we route them off this page entirely.
        if (!passkey.isAuthenticated) {
          navigate(`/signin-required?request_id=${encodeURIComponent(requestId)}`, { replace: true });
        }
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setErrorMsg(err.message || 'Network error');
      }
    })();
    return () => { cancelled = true; };
  }, [requestId, passkey.isAuthenticated, navigate]);

  // 2. Once authenticated and client info loaded, kick off resolve → has-agent.
  useEffect(() => {
    if (!client || !passkey.isAuthenticated || resolveStartedRef.current) return;
    resolveStartedRef.current = true;
    runResolveAndHasAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, passkey.isAuthenticated]);

  async function runResolveAndHasAgent() {
    setPhase('resolving');
    try {
      const resolveResp = await fetch(`${MCP_SERVER_URL}/authorize/passkey-resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          passkeyAddress: passkey.account,
          credentialId: passkey.credentialId,
        }),
      });
      if (resolveResp.status === 404) {
        // Edge case: passkey verified but no chess account row. Rare —
        // shouldn't happen with persistent storage. Send them through
        // sign-in flow to re-bridge the chess account.
        navigate(`/signin-required?request_id=${encodeURIComponent(requestId)}`, { replace: true });
        return;
      }
      if (!resolveResp.ok) {
        const data = await resolveResp.json().catch(() => ({}));
        throw new Error(data.error || `passkey-resolve failed (${resolveResp.status})`);
      }
      const { user_id } = await resolveResp.json();
      setHumanUserId(user_id);

      const hasResp = await fetch(`${MCP_SERVER_URL}/authorize/has-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, human_user_id: user_id }),
      });
      if (!hasResp.ok) {
        const data = await hasResp.json().catch(() => ({}));
        throw new Error(data.error || `has-agent failed (${hasResp.status})`);
      }
      const { agent } = await hasResp.json();
      if (agent) {
        await finalize({ human_user_id: user_id, agent_user_id: agent.agent_user_id });
      } else {
        setPhase('name-agent');
      }
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message || 'Network error');
    }
  }

  async function finalize({ human_user_id, agent_user_id, agent_username }) {
    setPhase('submitting');
    try {
      const provBody = { request_id: requestId, human_user_id };
      if (agent_user_id) provBody.agent_user_id = agent_user_id;
      else provBody.agent_username = agent_username;
      const provResp = await fetch(`${MCP_SERVER_URL}/authorize/provision-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provBody),
      });
      if (!provResp.ok) {
        const data = await provResp.json().catch(() => ({}));
        throw new Error(data.error || `Provisioning failed (${provResp.status})`);
      }
      const provision = await provResp.json();

      const issueResp = await fetch(`${MCP_SERVER_URL}/authorize/issue-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          human_user_id,
          agent_user_id: provision.agent_user_id,
          agent_chess_token: provision.chess_token,
        }),
      });
      if (!issueResp.ok) {
        const data = await issueResp.json().catch(() => ({}));
        throw new Error(data.error || `Consent issuance failed (${issueResp.status})`);
      }
      const { consent_token } = await issueResp.json();

      const completeResp = await fetch(`${MCP_SERVER_URL}/authorize/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, consent_token }),
      });
      if (!completeResp.ok) {
        const data = await completeResp.json().catch(() => ({}));
        throw new Error(data.error || `Complete failed (${completeResp.status})`);
      }
      const { redirect_url } = await completeResp.json();
      navigate(`/authsuccessful?redirect_url=${encodeURIComponent(redirect_url)}`, { replace: true });
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message || 'Network error');
    }
  }

  const handleSubmitAgent = (e) => {
    e.preventDefault();
    const trimmed = agentUsername.trim();
    if (trimmed.length < 3) return;
    finalize({ human_user_id: humanUserId, agent_username: trimmed });
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Authorize agent</h1>

        {phase === 'loading' && <p className="auth-status">Loading…</p>}

        {phase === 'expired' && <p className="auth-error">{errorMsg}</p>}

        {phase === 'error' && (
          <>
            <p className="auth-error">{errorMsg || 'Something went wrong.'}</p>
            <button className="auth-btn" onClick={() => window.location.reload()}>Try again</button>
          </>
        )}

        {phase === 'resolving' && client && (
          <>
            <p className="auth-msg">
              <strong>{client.client_name}</strong> wants to play chess on onchainchess as your agent.
            </p>
            <p className="auth-status">Verifying your account…</p>
          </>
        )}

        {phase === 'name-agent' && client && (
          <form className="auth-form" onSubmit={handleSubmitAgent}>
            <p className="auth-msg">
              Pick a username for your <strong>{client.client_name}</strong> agent.
            </p>
            <p className="auth-sub">
              Your agent gets its own username, rating, and game history — separate from yours.
            </p>
            <input
              className="auth-input"
              type="text"
              placeholder="e.g. claude-chess"
              value={agentUsername}
              onChange={(e) => setAgentUsername(e.target.value)}
              autoFocus
              maxLength={32}
              pattern="[a-zA-Z0-9-]+"
              minLength={3}
              required
            />
            <p className="auth-sub">3–32 chars · letters, numbers, hyphens.</p>
            <button type="submit" className="auth-btn auth-btn-primary">
              Approve
            </button>
          </form>
        )}

        {phase === 'submitting' && <p className="auth-status">Authorizing…</p>}
      </div>
    </div>
  );
}
