import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MCP_SERVER_URL } from '../config';
import { usePasskeyAuth } from '../hooks/usePasskeyAuth';
import './McpConsentPage.css';

// Phases of the consent flow:
//   loading     – fetching client info
//   ready       – have client info, awaiting user action
//   resolving   – calling passkey-resolve / has-agent
//   need-signup – passkey-resolve 404; user must complete chess account first
//   name-agent  – first-time auth for this client; ask for agent name
//   submitting  – provision-agent / issue-consent / authorize-complete in flight
//   redirecting – got redirect_url, about to leave
//   error       – terminal error
//   expired     – auth_request expired or missing

export default function McpConsentPage() {
  const passkey = usePasskeyAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestId = new URLSearchParams(location.search).get('request_id');

  const [phase, setPhase] = useState('loading');
  const [client, setClient] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [humanUserId, setHumanUserId] = useState(null);
  const [agentUsername, setAgentUsername] = useState('');

  // Avoid double-running the resolve flow under React strict mode.
  const resolveStartedRef = useRef(false);

  // Step 1: load OAuth params for this request_id.
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
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setErrorMsg(err.message || 'Network error');
      }
    })();
    return () => { cancelled = true; };
  }, [requestId]);

  // Step 2: when authenticated, kick off resolve → has-agent.
  useEffect(() => {
    if (phase !== 'ready' || !passkey.isAuthenticated || resolveStartedRef.current) return;
    resolveStartedRef.current = true;
    runResolveAndHasAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, passkey.isAuthenticated]);

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
      if (resolveResp.status === 404) { setPhase('need-signup'); return; }
      if (!resolveResp.ok) {
        const data = await resolveResp.json().catch(() => ({}));
        throw new Error(data.error || `passkey-resolve failed (${resolveResp.status})`);
      }
      const { user_id } = await resolveResp.json();
      setHumanUserId(user_id);

      // Check whether this client × human already has an agent.
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
        // Re-auth: skip naming, finalize directly.
        await finalize({ human_user_id: user_id, agent_user_id: agent.agent_user_id, agent_username: null });
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
      // Provision: rotate token (existing) or create (new).
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

      // Issue consent token (server-side hop, secret stays out of browser).
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

      // Complete OAuth — server mints code, returns redirect_url.
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
      setPhase('redirecting');
      window.location.assign(redirect_url);
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message || 'Network error');
    }
  }

  const handleSignIn = async () => {
    try {
      await passkey.login();
      // The effect on `passkey.isAuthenticated` will trigger resolve.
    } catch (err) {
      setErrorMsg(err.message || 'Sign-in failed');
    }
  };

  const handleSubmitAgent = (e) => {
    e.preventDefault();
    const trimmed = agentUsername.trim();
    if (trimmed.length < 3) return;
    finalize({ human_user_id: humanUserId, agent_user_id: null, agent_username: trimmed });
  };

  const goSignUp = () => {
    const returnTo = location.pathname + location.search;
    navigate(`/login?return_to=${encodeURIComponent(returnTo)}`);
  };

  return (
    <div className="mcp-consent">
      <div className="mcp-consent-card">
        <h1 className="mcp-consent-title">Authorize agent</h1>

        {phase === 'loading' && <p className="mcp-consent-status">Loading…</p>}

        {phase === 'expired' && (
          <>
            <p className="mcp-consent-msg mcp-consent-error">{errorMsg}</p>
          </>
        )}

        {phase === 'error' && (
          <>
            <p className="mcp-consent-msg mcp-consent-error">{errorMsg || 'Something went wrong.'}</p>
            <button className="mcp-consent-btn" onClick={() => window.location.reload()}>Try again</button>
          </>
        )}

        {client && phase === 'ready' && (
          <>
            <p className="mcp-consent-msg">
              <strong>{client.client_name}</strong> wants to play chess on onchainchess as your agent.
            </p>
            <p className="mcp-consent-sub">
              Your agent gets its own username, rating, and game history — separate from yours.
            </p>
            {!passkey.isAuthenticated ? (
              <button className="mcp-consent-btn mcp-consent-btn-primary" onClick={handleSignIn}>
                Sign in with passkey
              </button>
            ) : (
              <p className="mcp-consent-status">Verifying…</p>
            )}
            {errorMsg && <p className="mcp-consent-error">{errorMsg}</p>}
          </>
        )}

        {phase === 'resolving' && <p className="mcp-consent-status">Verifying your account…</p>}

        {phase === 'need-signup' && (
          <>
            <p className="mcp-consent-msg">This passkey isn't registered on onchainchess yet.</p>
            <button className="mcp-consent-btn mcp-consent-btn-primary" onClick={goSignUp}>
              Sign up at onchainchess →
            </button>
            <p className="mcp-consent-sub">After signup you'll come right back here.</p>
          </>
        )}

        {phase === 'name-agent' && client && (
          <form className="mcp-consent-form" onSubmit={handleSubmitAgent}>
            <p className="mcp-consent-msg">
              Pick a username for your <strong>{client.client_name}</strong> agent.
            </p>
            <input
              className="mcp-consent-input"
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
            <p className="mcp-consent-sub">3–32 chars · letters, numbers, hyphens.</p>
            <button type="submit" className="mcp-consent-btn mcp-consent-btn-primary">
              Approve
            </button>
          </form>
        )}

        {phase === 'submitting' && <p className="mcp-consent-status">Authorizing…</p>}
        {phase === 'redirecting' && <p className="mcp-consent-status">Redirecting back…</p>}
      </div>
    </div>
  );
}
