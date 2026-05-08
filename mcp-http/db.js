import Database from 'better-sqlite3';
import { config } from './config.js';

export function createDb() {
  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- DCR-registered OAuth clients (Claude Desktop, ChatGPT, etc.)
    CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY,
      client_secret_hash TEXT,
      client_name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,                -- JSON array
      token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Short-lived state for /authorize → consent UI handoff (10-min TTL).
    CREATE TABLE IF NOT EXISTS auth_requests (
      request_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(client_id),
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      scope TEXT NOT NULL,
      state TEXT,
      resource TEXT,
      expires_at TEXT NOT NULL
    );

    -- Long-lived (client_id, human_user_id) → agent binding.
    CREATE TABLE IF NOT EXISTS mcp_authorizations (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(client_id),
      human_user_id INTEGER NOT NULL,
      agent_user_id INTEGER NOT NULL,
      agent_chess_token TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (client_id, human_user_id)
    );

    -- Auth codes minted by /authorize/complete, exchanged at /token (5-min TTL).
    CREATE TABLE IF NOT EXISTS auth_codes (
      code_hash TEXT PRIMARY KEY,
      mcp_authorization_id TEXT NOT NULL REFERENCES mcp_authorizations(id),
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- Access tokens (bearer) — hashed at rest. Default 1-hour TTL.
    CREATE TABLE IF NOT EXISTS access_tokens (
      token_hash TEXT PRIMARY KEY,
      mcp_authorization_id TEXT NOT NULL REFERENCES mcp_authorizations(id),
      scope TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- Refresh tokens — rotation with reuse detection via family_id.
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      mcp_authorization_id TEXT NOT NULL REFERENCES mcp_authorizations(id),
      family_id TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_access_tokens_mcp_auth ON access_tokens(mcp_authorization_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_mcp_auth ON refresh_tokens(mcp_authorization_id);
  `);

  return db;
}

// Periodic cleanup of expired rows. Called from index.js.
export function startCleanup(db) {
  const cleanup = () => {
    const now = "datetime('now')";
    db.exec(`
      DELETE FROM auth_requests WHERE expires_at < ${now};
      DELETE FROM auth_codes WHERE expires_at < ${now};
      DELETE FROM access_tokens WHERE expires_at < ${now};
      DELETE FROM refresh_tokens WHERE expires_at < ${now};
    `);
  };
  cleanup();
  return setInterval(cleanup, 5 * 60 * 1000);
}
