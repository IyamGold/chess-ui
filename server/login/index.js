/** Unaudited testnet OIDC relying party. No wallet addresses, keys or identity documents. */
const express = require('express');
const { randomBytes, createHash, randomUUID } = require('node:crypto');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cookie = (request, name) => {
  const value = (request.headers.cookie || '')
    .split(';')
    .find((part) => part.trim().startsWith(`${name}=`));
  return value ? value.trim().slice(name.length + 1) : undefined;
};
const publicChessOrigins = new Set([
  'https://chess-demo.withlogin.com',
  'https://onchainchess.app',
]);
const loginConfig = ({ issuer, origin, clientId }) => {
  const issuerUrl = new URL(issuer),
    originUrl = new URL(origin);
  const secure = issuer === 'https://demo.withlogin.com/oidc';
  const local =
    issuerUrl.protocol === 'http:' &&
    issuerUrl.hostname === 'localhost' &&
    issuerUrl.pathname === '/oidc' &&
    originUrl.protocol === 'http:' &&
    originUrl.hostname === 'localhost';
  if (
    (!secure && !local) ||
    (secure && !publicChessOrigins.has(origin)) ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash ||
    originUrl.username ||
    originUrl.password ||
    originUrl.search ||
    originUrl.hash ||
    originUrl.pathname !== '/'
  ) {
    throw new Error('Chess Login requires approved demo HTTPS URLs or localhost HTTP.');
  }
  clientId = clientId || (secure ? 'chess-demo' : 'chess-app-local');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(clientId)) throw new Error('Invalid Chess Login client ID.');
  return { issuerUrl, originUrl, secure, clientId };
};
async function createLogin(db, options) {
  const client = await import('openid-client');
  const { issuerUrl, originUrl, secure, clientId } = loginConfig(options);
  let origin;
  origin = originUrl.origin;
  const redirect = `${origin}/api/login/callback`;
  db.exec(`CREATE TABLE IF NOT EXISTS login_accounts (
    issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
    verified_human INTEGER NOT NULL DEFAULT 0, sandbox INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(issuer, subject)
  );
  CREATE TABLE IF NOT EXISTS login_sessions (
    id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
  );`);
  const pending = new Map();
  const router = express.Router();
  const session = (request) => {
    const value = cookie(request, 'chess_session');
    if (!value) return null;
    return (
      db
        .prepare(
          `SELECT users.id, users.username, accounts.verified_human, accounts.sandbox
      FROM login_sessions sessions JOIN users ON users.id=sessions.user_id
      JOIN login_accounts accounts ON accounts.user_id=users.id
      WHERE sessions.id_hash=? AND sessions.expires_at>?`,
        )
        .get(hash(value), Date.now()) || null
    );
  };
  const discover = () =>
    client.discovery(issuerUrl, clientId, undefined, client.None(), {
      execute: [
        ...(secure ? [] : [client.allowInsecureRequests]),
        client.enableNonRepudiationChecks,
      ],
    });
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  router.get('/start', async (req, res) => {
    try {
      for (const [state, value] of pending) if (value.expires < Date.now()) pending.delete(state);
      if (pending.size > 500)
        return res.status(429).json({ error: 'Too many pending sign-ins. Try again shortly.' });
      const config = await discover();
      const state = client.randomState(),
        nonce = client.randomNonce(),
        verifier = client.randomPKCECodeVerifier();
      pending.set(state, { nonce, verifier, expires: Date.now() + 600_000 });
      res.cookie('chess_login_state', state, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 600_000,
      });
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirect,
        scope: 'openid',
        state,
        nonce,
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        ...(req.query.fresh === '1' ? { prompt: 'login' } : {}),
      });
      res.redirect(303, url.href);
    } catch {
      res.redirect(303, '/login?error=unavailable');
    }
  });
  router.get('/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const request = pending.get(state);
    pending.delete(state);
    res.clearCookie('chess_login_state', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
    });
    if (!request || request.expires < Date.now() || cookie(req, 'chess_login_state') !== state)
      return res.redirect(303, '/login?error=invalid');
    try {
      const config = await discover();
      const tokens = await client.authorizationCodeGrant(config, new URL(req.originalUrl, origin), {
        expectedState: state,
        expectedNonce: request.nonce,
        pkceCodeVerifier: request.verifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error('ID token required');
      const info = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
      let account = db
        .prepare('SELECT user_id FROM login_accounts WHERE issuer=? AND subject=?')
        .get(issuerUrl.href, claims.sub);
      if (!account) {
        const create = db.transaction(() => {
          const id = db
            .prepare('INSERT INTO users (username) VALUES (?)')
            .run(`player-${randomUUID().slice(0, 8)}`).lastInsertRowid;
          db.prepare('INSERT INTO login_accounts (issuer,subject,user_id) VALUES (?,?,?)').run(
            issuerUrl.href,
            claims.sub,
            id,
          );
          return { user_id: Number(id) };
        });
        account = create();
      }
      db.prepare(
        'UPDATE login_accounts SET verified_human=?,sandbox=? WHERE issuer=? AND subject=?',
      ).run(
        info.verified_human === true ? 1 : 0,
        info.verification_sandbox === true ? 1 : 0,
        issuerUrl.href,
        claims.sub,
      );
      const old = cookie(req, 'chess_session');
      if (old) db.prepare('DELETE FROM login_sessions WHERE id_hash=?').run(hash(old));
      db.prepare('DELETE FROM login_sessions WHERE expires_at<=?').run(Date.now());
      const value = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO login_sessions VALUES (?,?,?)').run(
        hash(value),
        account.user_id,
        Date.now() + 3_600_000,
      );
      res.cookie('chess_session', value, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 3_600_000,
      });
      res.redirect(303, '/');
    } catch {
      res.redirect(303, '/login?error=cancelled-or-invalid');
    }
  });
  router.get('/session', (req, res) => {
    const user = session(req);
    if (!user) return res.status(401).json({ error: 'signed-out' });
    return res.json({
      loginOrigin: issuerUrl.origin,
      id: user.id,
      username: user.username,
      ...(user.verified_human
        ? { verified_human: true, verification_sandbox: !!user.sandbox }
        : {}),
    });
  });
  router.post('/profile', (req, res) => {
    const user = session(req);
    if (!user) return res.status(401).json({ error: 'signed-out' });
    const name = req.body.username;
    if (typeof name !== 'string' || !/^[a-zA-Z0-9-]{3,24}$/.test(name))
      return res.status(400).json({ error: 'Use 3–24 letters, numbers or hyphens.' });
    try {
      db.prepare('UPDATE users SET username=? WHERE id=?').run(name, user.id);
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'That player name is already taken.' });
    }
  });
  router.post('/logout', (req, res) => {
    const value = cookie(req, 'chess_session');
    if (value) db.prepare('DELETE FROM login_sessions WHERE id_hash=?').run(hash(value));
    res.clearCookie('chess_session', {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure,
    });
    res.json({ ok: true });
  });
  const requireSession = (req, res, next) => {
    const user = session(req);
    if (!user) return res.status(401).json({ error: 'signed-out' });
    req.user = { id: user.id, username: user.username };
    next();
  };
  return { router, session, requireSession, origin, secure };
}
module.exports = { createLogin, loginConfig };
