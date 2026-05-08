const crypto = require('crypto');

function requireServiceAuth(req, res, next) {
  const secret = process.env.MCP_SERVICE_SECRET;
  if (!secret) {
    console.error('MCP_SERVICE_SECRET not configured');
    return res.status(500).json({ error: 'Service auth not configured' });
  }
  const provided = req.headers['x-service-auth'];
  if (!provided) {
    return res.status(401).json({ error: 'Invalid service auth' });
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid service auth' });
  }
  next();
}

module.exports = { requireServiceAuth };
