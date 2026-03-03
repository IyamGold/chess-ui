const express = require('express');
const { v4: uuidv4 } = require('uuid');

function createAuthRouter(db) {
  const router = express.Router();

  const insertUser = db.prepare('INSERT INTO users (username, token) VALUES (?, ?)');
  const findByUsername = db.prepare('SELECT id, username, token FROM users WHERE username = ?');
  const findByPasskey = db.prepare('SELECT id, username, token, passkey_address FROM users WHERE passkey_address = ?');
  const insertPasskeyUser = db.prepare('INSERT INTO users (username, token, passkey_address) VALUES (?, ?, ?)');

  // POST /api/auth/signup
  router.post('/signup', (req, res) => {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }

    const trimmed = username.trim();

    // Validate: 3-32 chars, alphanumeric + hyphens
    if (trimmed.length < 3 || trimmed.length > 32) {
      return res.status(400).json({ error: 'Username must be 3-32 characters' });
    }

    if (!/^[a-zA-Z0-9-]+$/.test(trimmed)) {
      return res.status(400).json({ error: 'Username may only contain letters, numbers, and hyphens' });
    }

    // Check uniqueness
    const existing = findByUsername.get(trimmed);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const token = uuidv4();

    try {
      insertUser.run(trimmed, token);
      res.status(201).json({ token, username: trimmed });
    } catch (err) {
      // Handle race condition on unique constraint
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Username already taken' });
      }
      throw err;
    }
  });

  // POST /api/auth/token — bridge for passkey users
  router.post('/token', (req, res) => {
    const { passkeyAddress, username } = req.body;

    if (!passkeyAddress || typeof passkeyAddress !== 'string') {
      return res.status(400).json({ error: 'passkeyAddress is required' });
    }

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'username is required' });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 32) {
      return res.status(400).json({ error: 'Username must be 3-32 characters' });
    }

    // Find existing user by passkey address
    const existing = findByPasskey.get(passkeyAddress);
    if (existing) {
      return res.json({ token: existing.token, username: existing.username });
    }

    // Create new user with passkey address
    const token = uuidv4();

    try {
      insertPasskeyUser.run(trimmedUsername, token, passkeyAddress);
      res.status(201).json({ token, username: trimmedUsername });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Username already taken' });
      }
      throw err;
    }
  });

  return router;
}

module.exports = { createAuthRouter };
