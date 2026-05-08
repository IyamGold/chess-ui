import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { generateToken, hashToken, expiresAtIso, verifyPkceS256 } from './helpers.js';

export function createTokenRouter(db) {
  const router = Router();

  const findClient = db.prepare('SELECT * FROM clients WHERE client_id = ?');
  const findAuthCode = db.prepare('SELECT * FROM auth_codes WHERE code_hash = ?');
  const deleteAuthCode = db.prepare('DELETE FROM auth_codes WHERE code_hash = ?');
  const insertAccessToken = db.prepare(`
    INSERT INTO access_tokens (token_hash, mcp_authorization_id, scope, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertRefreshToken = db.prepare(`
    INSERT INTO refresh_tokens (token_hash, mcp_authorization_id, family_id, used, expires_at)
    VALUES (?, ?, ?, 0, ?)
  `);
  const findRefreshToken = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?');
  const markRefreshUsed = db.prepare('UPDATE refresh_tokens SET used = 1 WHERE token_hash = ?');
  const revokeFamily = db.prepare(`
    DELETE FROM refresh_tokens WHERE family_id = ?;
  `);
  const findAuthorization = db.prepare('SELECT * FROM mcp_authorizations WHERE id = ?');

  router.post('/token', (req, res) => {
    const params = req.body || {};
    const grantType = params.grant_type;

    if (grantType === 'authorization_code') {
      return handleAuthCode(req, res, params);
    }
    if (grantType === 'refresh_token') {
      return handleRefresh(req, res, params);
    }
    return res.status(400).json({ error: 'unsupported_grant_type' });
  });

  // Authenticate the client. Public clients use just client_id; confidential
  // clients post their client_secret (or send Basic auth).
  function authenticateClient(req, params) {
    const basicHeader = req.headers.authorization;
    let clientId = typeof params.client_id === 'string' ? params.client_id : null;
    let clientSecret = typeof params.client_secret === 'string' ? params.client_secret : null;
    if (basicHeader && basicHeader.startsWith('Basic ')) {
      try {
        const [u, p] = Buffer.from(basicHeader.slice(6), 'base64').toString().split(':');
        clientId = clientId || decodeURIComponent(u);
        clientSecret = clientSecret || decodeURIComponent(p);
      } catch { /* ignore malformed basic */ }
    }
    if (!clientId) return { error: 'invalid_client', desc: 'client_id required' };
    const client = findClient.get(clientId);
    if (!client) return { error: 'invalid_client', desc: 'unknown client_id' };

    if (client.token_endpoint_auth_method !== 'none') {
      if (!clientSecret) return { error: 'invalid_client', desc: 'client_secret required' };
      if (hashToken(clientSecret) !== client.client_secret_hash) {
        return { error: 'invalid_client', desc: 'invalid client_secret' };
      }
    }
    return { client };
  }

  function handleAuthCode(req, res, params) {
    const auth = authenticateClient(req, params);
    if (auth.error) return res.status(401).json({ error: auth.error, error_description: auth.desc });
    const client = auth.client;

    const { code, redirect_uri, code_verifier } = params;
    if (typeof code !== 'string' || typeof redirect_uri !== 'string' || typeof code_verifier !== 'string') {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const codeHash = hashToken(code);
    const row = findAuthCode.get(codeHash);
    if (!row) return res.status(400).json({ error: 'invalid_grant', error_description: 'unknown or used code' });
    deleteAuthCode.run(codeHash);
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'code expired' });
    }
    if (row.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    }
    if (!verifyPkceS256(code_verifier, row.code_challenge)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }
    // Optional sanity check: code's authorization belongs to this client.
    const authorization = findAuthorization.get(row.mcp_authorization_id);
    if (!authorization || authorization.client_id !== client.client_id) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'authorization mismatch' });
    }

    return issueTokens(res, row.mcp_authorization_id, row.scope);
  }

  function handleRefresh(req, res, params) {
    const auth = authenticateClient(req, params);
    if (auth.error) return res.status(401).json({ error: auth.error, error_description: auth.desc });
    const client = auth.client;

    const refresh = params.refresh_token;
    if (typeof refresh !== 'string') {
      return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token required' });
    }
    const row = findRefreshToken.get(hashToken(refresh));
    if (!row) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'unknown refresh_token' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token expired' });
    }
    if (row.used) {
      // Reuse detection — invalidate the entire family.
      revokeFamily.run(row.family_id);
      return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token reused' });
    }
    const authorization = findAuthorization.get(row.mcp_authorization_id);
    if (!authorization || authorization.client_id !== client.client_id) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'authorization mismatch' });
    }

    markRefreshUsed.run(row.token_hash);
    return issueTokens(res, row.mcp_authorization_id, authorization.scope, row.family_id);
  }

  function issueTokens(res, mcpAuthorizationId, scope, familyId = null) {
    const accessToken = generateToken();
    const refreshToken = generateToken();
    const family = familyId || uuidv4();

    insertAccessToken.run(
      hashToken(accessToken),
      mcpAuthorizationId,
      scope,
      expiresAtIso(config.accessTokenTtl),
    );
    insertRefreshToken.run(
      hashToken(refreshToken),
      mcpAuthorizationId,
      family,
      expiresAtIso(config.refreshTokenTtl),
    );

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: config.accessTokenTtl,
      refresh_token: refreshToken,
      scope,
    });
  }

  return router;
}
