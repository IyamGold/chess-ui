const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function authMiddleware(db) {
  const findUser = db.prepare(
    'SELECT id, username, passkey_address, token_expires_at FROM users WHERE token_hash = ?'
  );

  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);
    const tokenHash = hashToken(token);
    const user = findUser.get(tokenHash);

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check expiry
    if (user.token_expires_at) {
      const expiresAt = new Date(user.token_expires_at + 'Z'); // SQLite datetime is UTC
      if (expiresAt <= new Date()) {
        return res.status(401).json({ error: 'token_expired' });
      }
    }

    req.user = { id: user.id, username: user.username, passkey_address: user.passkey_address };
    next();
  };
}

module.exports = { authMiddleware };
