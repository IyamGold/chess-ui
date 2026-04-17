const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const TOKEN_TTL_DAYS = 30;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createAuthRouter(db, { passkeyServerUrl } = {}) {
  const router = express.Router();

  const insertUser = db.prepare(
    'INSERT INTO users (username, token_hash, token_expires_at) VALUES (?, ?, datetime(\'now\', ?))'
  );
  const findByUsername = db.prepare('SELECT id, username, token_hash FROM users WHERE username = ?');
  const findByTokenHash = db.prepare(
    'SELECT id, username, token_hash, token_expires_at, passkey_address FROM users WHERE token_hash = ?'
  );
  const findByPasskey = db.prepare(
    'SELECT id, username, token_hash, token_expires_at, passkey_address FROM users WHERE passkey_address = ?'
  );
  const insertPasskeyUser = db.prepare(
    'INSERT INTO users (username, token_hash, token_expires_at, passkey_address) VALUES (?, ?, datetime(\'now\', ?), ?)'
  );
  const updateToken = db.prepare(
    'UPDATE users SET token_hash = ?, token_expires_at = datetime(\'now\', ?) WHERE id = ?'
  );
  const revokeToken = db.prepare(
    'UPDATE users SET token_hash = NULL, token_expires_at = NULL WHERE id = ?'
  );

  // POST /api/auth/signup — agent/bot account creation
  router.post('/signup', (req, res) => {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }

    const trimmed = username.trim();

    if (trimmed.length < 3 || trimmed.length > 32) {
      return res.status(400).json({ error: 'Username must be 3-32 characters' });
    }

    if (!/^[a-zA-Z0-9-]+$/.test(trimmed)) {
      return res.status(400).json({ error: 'Username may only contain letters, numbers, and hyphens' });
    }

    const existing = findByUsername.get(trimmed);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const token = uuidv4();
    const tokenHash = hashToken(token);
    const ttl = `+${TOKEN_TTL_DAYS} days`;

    try {
      insertUser.run(trimmed, tokenHash, ttl);
      res.status(201).json({ token, username: trimmed, expiresInDays: TOKEN_TTL_DAYS });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Username already taken' });
      }
      throw err;
    }
  });

  // POST /api/auth/token — bridge for passkey users (requires credentialId verification)
  router.post('/token', async (req, res) => {
    const { passkeyAddress, username, credentialId } = req.body;

    if (!passkeyAddress || typeof passkeyAddress !== 'string') {
      return res.status(400).json({ error: 'passkeyAddress is required' });
    }

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'username is required' });
    }

    if (!credentialId || typeof credentialId !== 'string') {
      return res.status(400).json({ error: 'credentialId is required for verification' });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 32) {
      return res.status(400).json({ error: 'Username must be 3-32 characters' });
    }

    // Verify credentialId against passkey server
    if (passkeyServerUrl) {
      try {
        const verifyResp = await fetch(`${passkeyServerUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentialId }),
        });
        if (!verifyResp.ok) {
          return res.status(403).json({ error: 'Passkey verification failed' });
        }
        const verifyData = await verifyResp.json();
        // Ensure the returned address matches the claimed address
        if (verifyData.accountAddress !== passkeyAddress) {
          return res.status(403).json({ error: 'Passkey address mismatch' });
        }
      } catch (err) {
        console.error('Passkey server verification error:', err.message);
        return res.status(502).json({ error: 'Unable to verify passkey' });
      }
    }

    // Find existing user by passkey address
    const existing = findByPasskey.get(passkeyAddress);
    if (existing) {
      // Rotate token on each bridge call for security
      const token = uuidv4();
      const tokenHash = hashToken(token);
      const ttl = `+${TOKEN_TTL_DAYS} days`;
      updateToken.run(tokenHash, ttl, existing.id);
      return res.json({ token, username: existing.username, expiresInDays: TOKEN_TTL_DAYS });
    }

    // Create new user with passkey address
    const token = uuidv4();
    const tokenHash = hashToken(token);
    const ttl = `+${TOKEN_TTL_DAYS} days`;

    try {
      insertPasskeyUser.run(trimmedUsername, tokenHash, ttl, passkeyAddress);
      res.status(201).json({ token, username: trimmedUsername, expiresInDays: TOKEN_TTL_DAYS });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Username already taken' });
      }
      throw err;
    }
  });

  // POST /api/auth/refresh — rotate an expired or active token
  router.post('/refresh', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const oldToken = authHeader.slice(7);
    const oldHash = hashToken(oldToken);

    // Allow refresh even if expired (user still needs to know the old token)
    const user = findByTokenHash.get(oldHash);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const newToken = uuidv4();
    const newHash = hashToken(newToken);
    const ttl = `+${TOKEN_TTL_DAYS} days`;

    updateToken.run(newHash, ttl, user.id);
    res.json({ token: newToken, username: user.username, expiresInDays: TOKEN_TTL_DAYS });
  });

  // POST /api/auth/revoke — invalidate current token
  router.post('/revoke', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);
    const tokenHash = hashToken(token);

    const user = findByTokenHash.get(tokenHash);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    revokeToken.run(user.id);
    res.json({ message: 'Token revoked' });
  });

  return router;
}

module.exports = { createAuthRouter };
