import { Router } from 'express';
import { config } from '../config.js';
import { chessApi } from '../chess-api.js';

// Browser-safe proxy endpoints that the consent UI calls. These keep the
// shared MCP_SERVICE_SECRET server-side and tie every call to a valid in-flight
// auth_request (so an arbitrary passkey holder can't drive consent for an
// unrelated client_id).

async function verifyPasskey(passkeyAddress, credentialId) {
  const resp = await fetch(`${config.passkeyServerUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentialId }),
  });
  if (!resp.ok) {
    const err = new Error('passkey verification failed');
    err.status = 403;
    throw err;
  }
  const data = await resp.json();
  if (data.accountAddress !== passkeyAddress) {
    const err = new Error('passkey address mismatch');
    err.status = 403;
    throw err;
  }
  return data;
}

export function createConsentProxyRouter(db) {
  const router = Router();

  const findAuthRequest = db.prepare('SELECT * FROM auth_requests WHERE request_id = ?');
  const findAuthorization = db.prepare(
    'SELECT * FROM mcp_authorizations WHERE client_id = ? AND human_user_id = ?'
  );

  // Resolve & validate the auth_request once per call.
  function loadAuthRequest(req, res) {
    const { request_id } = req.body || {};
    if (typeof request_id !== 'string') {
      res.status(400).json({ error: 'invalid_request' });
      return null;
    }
    const row = findAuthRequest.get(request_id);
    if (!row) {
      res.status(404).json({ error: 'auth_request_not_found' });
      return null;
    }
    if (new Date(row.expires_at) < new Date()) {
      res.status(410).json({ error: 'auth_request_expired' });
      return null;
    }
    return row;
  }

  // POST /authorize/passkey-resolve
  router.post('/authorize/passkey-resolve', async (req, res) => {
    const authReq = loadAuthRequest(req, res);
    if (!authReq) return;
    const { passkeyAddress, credentialId } = req.body || {};
    if (typeof passkeyAddress !== 'string' || typeof credentialId !== 'string') {
      return res.status(400).json({ error: 'passkeyAddress and credentialId required' });
    }
    try {
      await verifyPasskey(passkeyAddress, credentialId);
    } catch (err) {
      return res.status(err.status || 502).json({ error: err.message });
    }
    try {
      const result = await chessApi.resolvePasskey(passkeyAddress);
      res.json(result);
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'not_registered' });
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // POST /authorize/has-agent
  // Returns existing agent for (client_id, human_user_id), or { agent: null }.
  router.post('/authorize/has-agent', (req, res) => {
    const authReq = loadAuthRequest(req, res);
    if (!authReq) return;
    const { human_user_id } = req.body || {};
    if (typeof human_user_id !== 'number') {
      return res.status(400).json({ error: 'human_user_id required' });
    }
    const existing = findAuthorization.get(authReq.client_id, human_user_id);
    if (!existing) return res.json({ agent: null });
    res.json({
      agent: {
        agent_user_id: existing.agent_user_id,
      },
    });
  });

  // POST /authorize/provision-agent
  // Either creates a new agent (agent_username given) or rotates an existing
  // one's chess token (agent_user_id given). Returns the values the consent UI
  // needs to call /authorize/issue-consent.
  router.post('/authorize/provision-agent', async (req, res) => {
    const authReq = loadAuthRequest(req, res);
    if (!authReq) return;
    const { human_user_id, agent_username, agent_user_id } = req.body || {};
    if (typeof human_user_id !== 'number') {
      return res.status(400).json({ error: 'human_user_id required' });
    }

    try {
      let result;
      if (typeof agent_user_id === 'number') {
        // Existing agent — rotate its chess token.
        const tokenResp = await chessApi.rotateAgentToken(agent_user_id);
        result = {
          agent_user_id,
          chess_token: tokenResp.chess_token,
        };
      } else if (typeof agent_username === 'string') {
        // New agent — create.
        const createResp = await chessApi.createAgent(human_user_id, agent_username);
        result = {
          agent_user_id: createResp.agent_user_id,
          username: createResp.username,
          chess_token: createResp.chess_token,
        };
      } else {
        return res.status(400).json({ error: 'agent_username or agent_user_id required' });
      }
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, body: err.body });
    }
  });

  // POST /authorize/issue-consent
  // Asks chess server to mint a consent_token; consent UI then POSTs that token
  // to /authorize/complete. We keep this hop server-side so the MCP secret is
  // never exposed to the browser.
  router.post('/authorize/issue-consent', async (req, res) => {
    const authReq = loadAuthRequest(req, res);
    if (!authReq) return;
    const { human_user_id, agent_user_id, agent_chess_token } = req.body || {};
    if (typeof human_user_id !== 'number' || typeof agent_user_id !== 'number' || typeof agent_chess_token !== 'string') {
      return res.status(400).json({ error: 'human_user_id, agent_user_id, agent_chess_token required' });
    }
    try {
      const result = await chessApi.issueConsentToken({
        human_user_id,
        agent_user_id,
        agent_chess_token,
        client_id: authReq.client_id,
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  return router;
}
