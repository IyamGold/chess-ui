const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const TOKEN_TTL_DAYS = 30;
const CONSENT_TOKEN_TTL_SECONDS = 5 * 60;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createMcpAuthRouter(db) {
  const router = express.Router();

  const findHumanByPasskey = db.prepare(
    "SELECT id, username FROM users WHERE passkey_address = ? AND parent_user_id IS NULL"
  );
  const findUserById = db.prepare(
    "SELECT id, username, parent_user_id FROM users WHERE id = ?"
  );
  const findByUsername = db.prepare("SELECT id FROM users WHERE username = ?");
  const insertAgent = db.prepare(
    "INSERT INTO users (username, token_hash, token_expires_at, parent_user_id) VALUES (?, ?, datetime('now', ?), ?)"
  );
  const updateToken = db.prepare(
    "UPDATE users SET token_hash = ?, token_expires_at = datetime('now', ?) WHERE id = ?"
  );

  // POST /api/auth/passkey-resolve
  // Returns the human user_id for a registered passkey, or 404 if not registered.
  router.post('/passkey-resolve', (req, res) => {
    const { passkeyAddress } = req.body;
    if (!passkeyAddress || typeof passkeyAddress !== 'string') {
      return res.status(400).json({ error: 'passkeyAddress is required' });
    }
    const user = findHumanByPasskey.get(passkeyAddress);
    if (!user) {
      return res.status(404).json({ error: 'not_registered' });
    }
    res.json({ user_id: user.id, username: user.username });
  });

  // POST /api/auth/agent-create
  // Creates an agent (child user) under a human (parent_user_id).
  router.post('/agent-create', (req, res) => {
    const { parent_user_id, username } = req.body;
    if (typeof parent_user_id !== 'number') {
      return res.status(400).json({ error: 'parent_user_id is required' });
    }
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'username is required' });
    }
    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 32) {
      return res.status(400).json({ error: 'Username must be 3-32 characters' });
    }
    if (!/^[a-zA-Z0-9-]+$/.test(trimmed)) {
      return res.status(400).json({ error: 'Username may only contain letters, numbers, and hyphens' });
    }
    const parent = findUserById.get(parent_user_id);
    if (!parent) {
      return res.status(404).json({ error: 'parent not found' });
    }
    if (parent.parent_user_id !== null) {
      return res.status(400).json({ error: 'parent must be a top-level user (no nested agents)' });
    }
    if (findByUsername.get(trimmed)) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const token = uuidv4();
    const tokenHash = hashToken(token);
    const ttl = `+${TOKEN_TTL_DAYS} days`;
    try {
      const result = insertAgent.run(trimmed, tokenHash, ttl, parent_user_id);
      res.status(201).json({
        agent_user_id: result.lastInsertRowid,
        username: trimmed,
        chess_token: token,
        expiresInDays: TOKEN_TTL_DAYS,
      });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Username already taken' });
      }
      throw err;
    }
  });

  // POST /api/auth/agent-token
  // Mints a fresh chess-server token for an existing agent (rotates the old one).
  router.post('/agent-token', (req, res) => {
    const { agent_user_id } = req.body;
    if (typeof agent_user_id !== 'number') {
      return res.status(400).json({ error: 'agent_user_id is required' });
    }
    const agent = findUserById.get(agent_user_id);
    if (!agent) {
      return res.status(404).json({ error: 'agent not found' });
    }
    if (agent.parent_user_id === null) {
      return res.status(400).json({ error: 'not an agent' });
    }
    const token = uuidv4();
    const tokenHash = hashToken(token);
    const ttl = `+${TOKEN_TTL_DAYS} days`;
    updateToken.run(tokenHash, ttl, agent_user_id);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    res.json({ chess_token: token, expires_at: expiresAt });
  });

  // POST /api/auth/issue-consent-token
  // Returns an HMAC-signed payload that the consent UI passes to the MCP server.
  router.post('/issue-consent-token', (req, res) => {
    const { human_user_id, agent_user_id, agent_chess_token, client_id } = req.body;
    if (typeof human_user_id !== 'number') {
      return res.status(400).json({ error: 'human_user_id is required' });
    }
    if (typeof agent_user_id !== 'number') {
      return res.status(400).json({ error: 'agent_user_id is required' });
    }
    if (!agent_chess_token || typeof agent_chess_token !== 'string') {
      return res.status(400).json({ error: 'agent_chess_token is required' });
    }
    if (!client_id || typeof client_id !== 'string') {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const secret = process.env.MCP_SERVICE_SECRET;
    const exp = Math.floor(Date.now() / 1000) + CONSENT_TOKEN_TTL_SECONDS;
    const payload = { human_user_id, agent_user_id, agent_chess_token, client_id, exp };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
    res.json({ consent_token: `${payloadB64}.${sig}` });
  });

  return router;
}

module.exports = { createMcpAuthRouter };
