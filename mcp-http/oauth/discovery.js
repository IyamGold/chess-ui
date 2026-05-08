import { Router } from 'express';
import { config } from '../config.js';

export function createDiscoveryRouter() {
  const router = Router();

  // RFC 9728 — Protected Resource Metadata.
  // MCP clients hit this first to discover where the AS lives.
  router.get('/.well-known/oauth-protected-resource', (req, res) => {
    res.json({
      resource: `${config.baseUrl}/mcp`,
      authorization_servers: [config.baseUrl],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:play'],
    });
  });

  // RFC 8414 — Authorization Server Metadata.
  router.get('/.well-known/oauth-authorization-server', (req, res) => {
    res.json({
      issuer: config.baseUrl,
      authorization_endpoint: `${config.baseUrl}/authorize`,
      token_endpoint: `${config.baseUrl}/token`,
      registration_endpoint: `${config.baseUrl}/register`,
      revocation_endpoint: `${config.baseUrl}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['mcp:play'],
    });
  });

  return router;
}
