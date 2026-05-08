import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env loader (no extra dep). Loads ./.env if present and not already set.
function loadDotEnv() {
  const path = resolve('.env');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf-8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  baseUrl: required('BASE_URL').replace(/\/$/, ''),
  consentUiUrl: required('CONSENT_UI_URL').replace(/\/$/, ''),
  chessServerUrl: required('CHESS_SERVER_URL').replace(/\/$/, ''),
  passkeyServerUrl: required('PASSKEY_SERVER_URL').replace(/\/$/, ''),
  mcpServiceSecret: required('MCP_SERVICE_SECRET'),
  databasePath: process.env.DATABASE_PATH || './mcp.db',
  port: parseInt(process.env.PORT || '3002', 10),
  accessTokenTtl: parseInt(process.env.ACCESS_TOKEN_TTL || '3600', 10),
  refreshTokenTtl: parseInt(process.env.REFRESH_TOKEN_TTL || '2592000', 10),
  authRequestTtl: 600,        // 10 min
  authCodeTtl: 300,           // 5 min
};
