// Synthetic in-memory accounts only. Exercises real OIDC code exchange/userinfo
// and Chess cookies, rather than replacing the authenticated callback with mocks.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const express = require('../server/node_modules/express');
const Database = require('../server/node_modules/better-sqlite3');
const { createLogin } = require('../server/login/index.js');
const loginDir =
  process.env.CHESS_LOGIN_DIR ||
  resolve(dirname(fileURLToPath(import.meta.url)), '../../login-accounts');
const source = (file) =>
  import(pathToFileURL(resolve(loginDir, 'apps/server/src', file)).href);
const { openDb } = await source('db.ts');
const { createOidc } = await source('oidc/provider.ts');
const { generateOidcKeys } = await source('oidc/config.ts');
const { createGetKycClaims } = await source('kyc/claims.ts');
const loginDb = openDb(':memory:'),
  chessDb = new Database(':memory:');
chessDb.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE)');
loginDb
  .prepare('INSERT INTO users VALUES(?,?,?,?)')
  .run('synthetic-user', 'synthetic@example.com', 'synthetic', Date.now());
let oidc;
const identityServer = createServer((req, res) => {
  void oidc.handle(req, res).then((handled) => {
    if (!handled) {
      res.writeHead(404);
      res.end();
    }
  });
});
const app = express(),
  chessServer = createServer(app);
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://localhost:${server.address().port}`)
    )
  );
const issuer = (await listen(identityServer)) + '/oidc',
  chessOrigin = await listen(chessServer);
try {
  oidc = createOidc({
    issuer,
    db: loginDb,
    ...generateOidcKeys(),
    clients: [
      {
        client_id: 'chess-app-local',
        client_name: 'Chess',
        redirect_uris: [chessOrigin + '/api/login/callback'],
      },
    ],
    getSignedInUser: async () => ({
      userId: 'synthetic-user',
      authenticatedAt: Math.floor(Date.now() / 1000),
      method: 'passkey',
      userVerified: true,
    }),
    getKycClaims: createGetKycClaims(loginDb),
  });
  const login = await createLogin(chessDb, { issuer, origin: chessOrigin });
  app.use('/api/login', login.router);
  const jar = new Map();
  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      redirect: 'manual',
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...options.headers,
      },
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0],
        at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  };
  let notices = 0;
  async function signIn() {
    let url = chessOrigin + '/api/login/start';
    for (let step = 0; step < 16; step++) {
      const response = await request(url);
      const location = response.headers.get('location');
      if (url.startsWith(chessOrigin + '/api/login/callback')) {
        assert.equal(response.status, 303);
        assert.equal(location, '/', 'callback must succeed');
        const session = await request(chessOrigin + '/api/login/session');
        assert.equal(session.status, 200);
        return session.json();
      }
      if (location) {
        url = new URL(location, url).href;
        continue;
      }
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.ok(
        html.includes(
          'Chess receives your verification status and level when available.'
        )
      );
      assert.ok(!html.includes('checkbox'));
      const action = html.match(/action="([^"]+\/confirm)"/)?.[1];
      assert.ok(action);
      notices++;
      const confirmed = await request(new URL(action, issuer).href, {
        method: 'POST',
        headers: { origin: new URL(issuer).origin },
      });
      assert.equal(confirmed.status, 303);
      url = new URL(confirmed.headers.get('location'), issuer).href;
    }
    throw Error('Sign-in did not finish');
  }
  let profile = await signIn();
  assert.equal(profile.verified_human, undefined);
  assert.equal(profile.kyc_level, undefined);
  assert.equal(notices, 1, 'only the existing Continue page is needed');
  const id = profile.id;
  for (const level of ['L1', 'L2']) {
    loginDb
      .prepare(
        'INSERT INTO kyc_status(user_id,level,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET level=excluded.level,updated_at=excluded.updated_at'
      )
      .run('synthetic-user', level, Date.now());
    profile = await signIn();
    assert.equal(profile.id, id);
    assert.equal(profile.kyc_level, level);
    assert.equal(profile.verified_human, true);
    assert.equal(profile.verification_sandbox, true);
    console.log(
      `PASS: Login ${level} reaches the same Chess account through the real callback`
    );
  }
  loginDb
    .prepare('DELETE FROM kyc_status WHERE user_id=?')
    .run('synthetic-user');
  profile = await signIn();
  assert.equal(profile.verified_human, undefined);
  assert.equal(profile.kyc_level, undefined);
  assert.equal(
    chessDb.prepare('SELECT kyc_level FROM login_accounts').get().kyc_level,
    null
  );
  console.log(
    'PASS: unverified sign-in, one Continue screen, sandbox marker, level refresh and stale-level clearing'
  );
} finally {
  for (const server of [identityServer, chessServer]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  loginDb.close();
  chessDb.close();
}
