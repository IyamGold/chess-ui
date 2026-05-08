import { Router } from 'express';
import { generateClientId, generateClientSecret, hashToken } from './helpers.js';

// RFC 7591 — Dynamic Client Registration.
// Open registration: any MCP client can register itself. Confidential clients are
// allowed (they can request token_endpoint_auth_method != "none") but most MCP
// clients are public (PKCE-only).
export function createRegisterRouter(db) {
  const router = Router();

  const insertClient = db.prepare(`
    INSERT INTO clients (client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method)
    VALUES (?, ?, ?, ?, ?)
  `);

  router.post('/register', (req, res) => {
    const body = req.body || {};
    const clientName = typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 200)
      : 'Unnamed MCP Client';
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (redirectUris.length === 0) {
      return res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris is required and must be non-empty',
      });
    }
    for (const uri of redirectUris) {
      if (typeof uri !== 'string' || !/^https?:\/\//i.test(uri)) {
        return res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: 'redirect_uris must be http/https URLs',
        });
      }
    }

    const requestedAuthMethod = typeof body.token_endpoint_auth_method === 'string'
      ? body.token_endpoint_auth_method
      : 'none';
    const allowedMethods = ['none', 'client_secret_post', 'client_secret_basic'];
    if (!allowedMethods.includes(requestedAuthMethod)) {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: `token_endpoint_auth_method must be one of ${allowedMethods.join(', ')}`,
      });
    }

    const clientId = generateClientId();
    let clientSecret = null;
    let clientSecretHash = null;
    if (requestedAuthMethod !== 'none') {
      clientSecret = generateClientSecret();
      clientSecretHash = hashToken(clientSecret);
    }

    insertClient.run(
      clientId,
      clientSecretHash,
      clientName,
      JSON.stringify(redirectUris),
      requestedAuthMethod
    );

    const response = {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: requestedAuthMethod,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
    if (clientSecret) response.client_secret = clientSecret;

    res.status(201).json(response);
  });

  return router;
}
