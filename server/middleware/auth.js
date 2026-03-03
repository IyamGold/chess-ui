function authMiddleware(db) {
  const findUser = db.prepare('SELECT id, username, passkey_address FROM users WHERE token = ?');

  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);
    const user = findUser.get(token);

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  };
}

module.exports = { authMiddleware };
