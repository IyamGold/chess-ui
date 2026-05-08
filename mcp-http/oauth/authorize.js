import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { generateToken, hashToken, expiresAtIso, verifyConsentToken } from './helpers.js';

export function createAuthorizeRouter(db) {
  const router = Router();

  const findClient = db.prepare('SELECT * FROM clients WHERE client_id = ?');
  const insertAuthRequest = db.prepare(`
    INSERT INTO auth_requests
      (request_id, client_id, redirect_uri, code_challenge, code_challenge_method, scope, state, resource, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findAuthRequest = db.prepare('SELECT * FROM auth_requests WHERE request_id = ?');
  const deleteAuthRequest = db.prepare('DELETE FROM auth_requests WHERE request_id = ?');

  const findAuthorization = db.prepare(
    'SELECT * FROM mcp_authorizations WHERE client_id = ? AND human_user_id = ?'
  );
  const upsertAuthorization = db.prepare(`
    INSERT INTO mcp_authorizations (id, client_id, human_user_id, agent_user_id, agent_chess_token, scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT (client_id, human_user_id) DO UPDATE SET
      agent_user_id = excluded.agent_user_id,
      agent_chess_token = excluded.agent_chess_token,
      scope = excluded.scope,
      updated_at = datetime('now')
  `);
  const insertAuthCode = db.prepare(`
    INSERT INTO auth_codes (code_hash, mcp_authorization_id, code_challenge, code_challenge_method, redirect_uri, scope, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // GET /authorize — validate, persist auth_request, redirect to consent UI.
  router.get('/authorize', (req, res) => {
    const {
      response_type, client_id, redirect_uri,
      code_challenge, code_challenge_method,
      scope, state, resource,
    } = req.query;

    if (response_type !== 'code') {
      return renderError(res, 'unsupported_response_type', 'response_type must be "code"');
    }
    if (typeof client_id !== 'string') {
      return renderError(res, 'invalid_request', 'client_id is required');
    }
    const client = findClient.get(client_id);
    if (!client) {
      return renderError(res, 'invalid_client', 'client_id is not registered');
    }
    if (typeof redirect_uri !== 'string') {
      return renderError(res, 'invalid_request', 'redirect_uri is required');
    }
    const allowedRedirects = JSON.parse(client.redirect_uris);
    if (!allowedRedirects.includes(redirect_uri)) {
      return renderError(res, 'invalid_redirect_uri', 'redirect_uri does not match registered values');
    }
    if (typeof code_challenge !== 'string' || code_challenge.length < 43) {
      return renderError(res, 'invalid_request', 'code_challenge is required (PKCE mandatory)');
    }
    if (code_challenge_method !== 'S256') {
      return renderError(res, 'invalid_request', 'code_challenge_method must be S256');
    }
    const requestedScope = (typeof scope === 'string' && scope.trim()) ? scope.trim() : 'mcp:play';
    if (!requestedScope.split(/\s+/).every(s => s === 'mcp:play')) {
      return renderError(res, 'invalid_scope', 'only "mcp:play" is supported');
    }

    const requestId = uuidv4();
    insertAuthRequest.run(
      requestId,
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      requestedScope,
      typeof state === 'string' ? state : null,
      typeof resource === 'string' ? resource : null,
      expiresAtIso(config.authRequestTtl),
    );

    res.redirect(302, `${config.consentUiUrl}/auth?request_id=${encodeURIComponent(requestId)}`);
  });

  // GET /authorize/lookup — consent UI calls this to fetch params it should display.
  router.get('/authorize/lookup', (req, res) => {
    const { request_id } = req.query;
    if (typeof request_id !== 'string') return res.status(400).json({ error: 'invalid_request' });
    const row = findAuthRequest.get(request_id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (new Date(row.expires_at) < new Date()) {
      deleteAuthRequest.run(request_id);
      return res.status(410).json({ error: 'expired' });
    }
    const client = findClient.get(row.client_id);
    res.json({
      client_id: row.client_id,
      client_name: client?.client_name || 'Unnamed MCP Client',
      scope: row.scope,
      resource: row.resource,
      redirect_uri: row.redirect_uri,
    });
  });

  // POST /authorize/complete — consent UI posts the verified consent token here.
  router.post('/authorize/complete', (req, res) => {
    const { request_id, consent_token } = req.body || {};
    if (typeof request_id !== 'string' || typeof consent_token !== 'string') {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const authReq = findAuthRequest.get(request_id);
    if (!authReq) return res.status(404).json({ error: 'auth_request_not_found' });
    if (new Date(authReq.expires_at) < new Date()) {
      deleteAuthRequest.run(request_id);
      return res.status(410).json({ error: 'auth_request_expired' });
    }

    const consent = verifyConsentToken(consent_token);
    if (!consent) {
      return res.status(403).json({ error: 'invalid_consent_token' });
    }
    if (consent.client_id !== authReq.client_id) {
      return res.status(403).json({ error: 'client_id mismatch' });
    }

    // Upsert authorization (auto-bind on re-auth).
    let mcpAuthorizationId;
    const existing = findAuthorization.get(authReq.client_id, consent.human_user_id);
    if (existing) {
      mcpAuthorizationId = existing.id;
    } else {
      mcpAuthorizationId = uuidv4();
    }
    upsertAuthorization.run(
      mcpAuthorizationId,
      authReq.client_id,
      consent.human_user_id,
      consent.agent_user_id,
      consent.agent_chess_token,
      authReq.scope,
    );

    // Mint auth code.
    const code = generateToken();
    insertAuthCode.run(
      hashToken(code),
      mcpAuthorizationId,
      authReq.code_challenge,
      authReq.code_challenge_method,
      authReq.redirect_uri,
      authReq.scope,
      expiresAtIso(config.authCodeTtl),
    );
    deleteAuthRequest.run(request_id);

    const url = new URL(authReq.redirect_uri);
    url.searchParams.set('code', code);
    if (authReq.state) url.searchParams.set('state', authReq.state);
    res.json({ redirect_url: url.toString() });
  });

  return router;
}

function renderError(res, code, description) {
  res.status(400).type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>Authorization error</title>
<style>body{font-family:system-ui;padding:2rem;max-width:36rem;margin:auto}code{background:#f4f4f4;padding:.1em .3em;border-radius:.2em}</style>
<h1>Authorization error</h1>
<p><strong>${escapeHtml(code)}</strong>: ${escapeHtml(description)}</p>`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
