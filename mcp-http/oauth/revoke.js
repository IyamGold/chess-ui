import { Router } from 'express';
import { hashToken } from './helpers.js';

// RFC 7009 — token revocation. Always returns 200 per spec, even for unknown tokens.
export function createRevokeRouter(db) {
  const router = Router();

  const deleteAccess = db.prepare('DELETE FROM access_tokens WHERE token_hash = ?');
  const deleteRefresh = db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?');

  router.post('/revoke', (req, res) => {
    const { token, token_type_hint } = req.body || {};
    if (typeof token !== 'string') return res.status(200).end();
    const h = hashToken(token);

    if (token_type_hint === 'refresh_token') {
      deleteRefresh.run(h);
      deleteAccess.run(h);
    } else {
      deleteAccess.run(h);
      deleteRefresh.run(h);
    }
    res.status(200).end();
  });

  return router;
}
