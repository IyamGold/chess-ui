import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hashToken } from './oauth/helpers.js';
import { registerTools } from './tools.js';
import { config } from './config.js';

// Bearer extraction + bearer→authorization lookup. Populates req.mcpAuth on success.
export function bearerMiddleware(db) {
  const findAccess = db.prepare('SELECT * FROM access_tokens WHERE token_hash = ?');
  const findAuthorization = db.prepare('SELECT * FROM mcp_authorizations WHERE id = ?');
  const updateChessToken = db.prepare(
    'UPDATE mcp_authorizations SET agent_chess_token = ?, updated_at = datetime(\'now\') WHERE id = ?'
  );

  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      return unauthorized(res, 'missing_token');
    }
    const token = header.slice(7).trim();
    const row = findAccess.get(hashToken(token));
    if (!row) return unauthorized(res, 'invalid_token');
    if (new Date(row.expires_at) < new Date()) return unauthorized(res, 'invalid_token');

    const authorization = findAuthorization.get(row.mcp_authorization_id);
    if (!authorization) return unauthorized(res, 'invalid_token');

    req.mcpAuth = {
      mcp_authorization_id: authorization.id,
      client_id: authorization.client_id,
      human_user_id: authorization.human_user_id,
      agent_user_id: authorization.agent_user_id,
      agent_chess_token: authorization.agent_chess_token,
      scope: row.scope,
      updateAgentToken(newToken) {
        updateChessToken.run(newToken, authorization.id);
      },
    };
    next();
  };
}

function unauthorized(res, code) {
  const realm = `${config.baseUrl}/.well-known/oauth-protected-resource`;
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer error="${code}", resource_metadata="${realm}"`)
    .json({ error: code });
}

// Stateless MCP handler: per-request McpServer with bearer-derived context.
export async function handleMcpRequest(req, res) {
  const server = new McpServer({ name: 'onchainchess', version: '1.0.0' });
  registerTools(server, req.mcpAuth);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => transport.close());

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
