const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const { createHash } = require('node:crypto');
const { createLogin, loginConfig } = require('./index');
function database() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE)');
  return db;
}
test('Login mode rejects non-localhost identity providers', async () => {
  const db = database();
  try {
    await assert.rejects(
      createLogin(db, {
        issuer: 'https://example.com/oidc',
        origin: 'http://localhost:5190',
      }),
    );
  } finally {
    db.close();
  }
});
test('sessions require the HttpOnly cookie, expire, and omit unchecked verification claims', async () => {
  const db = database();
  const login = await createLogin(db, {
    issuer: 'http://localhost:5180/oidc',
    origin: 'http://localhost:5190',
  });
  try {
    db.prepare('INSERT INTO users VALUES (?,?)').run(1, 'test-player');
    db.prepare('INSERT INTO login_accounts (issuer,subject,user_id) VALUES (?,?,?)').run(
      'http://localhost:5180/oidc',
      'app-specific-test-id',
      1,
    );
    const token = 'synthetic-test-session',
      hash = createHash('sha256').update(token).digest('hex');
    db.prepare('INSERT INTO login_sessions VALUES (?,?,?)').run(hash, 1, Date.now() + 10000);
    assert.equal(login.session({ headers: { authorization: 'Bearer ' + token } }), null);
    assert.equal(login.session({ headers: { cookie: 'chess_session=wrong' } }), null);
    assert.equal(
      login.session({ headers: { cookie: 'chess_session=' + token } }).username,
      'test-player',
    );
    db.prepare('UPDATE login_sessions SET expires_at=0').run();
    assert.equal(login.session({ headers: { cookie: 'chess_session=' + token } }), null);
  } finally {
    db.close();
  }
});
test('an invented OIDC callback cannot issue a chess session', async () => {
  const db = database();
  const login = await createLogin(db, {
    issuer: 'http://localhost:5180/oidc',
    origin: 'http://localhost:5190',
  });
  const app = express();
  app.use('/api/login', login.router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/login/callback?state=invented&code=invented`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login?error=invalid');
    assert.equal(db.prepare('SELECT count(*) AS n FROM login_sessions').get().n, 0);
    assert.ok(!response.headers.getSetCookie().some((value) => value.startsWith('chess_session=')));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('hosted Login pins both HTTPS origins and never enables local transport', () => {
  const options = {
    issuer: 'https://demo.withlogin.com/oidc',
    origin: 'https://chess-demo.withlogin.com',
  };
  assert.equal(loginConfig(options).secure, true);
  assert.equal(loginConfig(options).clientId, 'chess-demo');
  for (const bad of [
    { issuer: 'https://other.withlogin.com/oidc' },
    { issuer: 'http://demo.withlogin.com/oidc' },
    { origin: 'http://chess-demo.withlogin.com' },
    { origin: 'https://other.withlogin.com' },
    { origin: 'http://localhost:5190' },
    { origin: 'https://chess-demo.withlogin.com/?bad=1' },
  ])
    assert.throws(() => loginConfig({ ...options, ...bad }));
});
test('hosted invalid callbacks clear only a Secure flow cookie and cannot create a session', async () => {
  const db = database();
  const login = await createLogin(db, {
    issuer: 'https://demo.withlogin.com/oidc',
    origin: 'https://chess-demo.withlogin.com',
  });
  const app = express();
  app.use('/api/login', login.router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/login/callback?state=invented`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 303);
    assert.ok(response.headers.getSetCookie().every((cookie) => /; Secure/.test(cookie)));
    assert.equal(db.prepare('SELECT count(*) AS n FROM login_sessions').get().n, 0);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('onchainchess.app uses hosted Secure cookies and still rejects lookalike origins', async () => {
  const options = { issuer: 'https://demo.withlogin.com/oidc', origin: 'https://onchainchess.app' };
  assert.equal(loginConfig(options).secure, true);
  for (const origin of [
    'http://onchainchess.app',
    'https://www.onchainchess.app',
    'https://onchainchess.app.attacker.invalid',
    'https://onchainchess.app/?x=1',
  ]) {
    assert.throws(() => loginConfig({ ...options, origin }));
  }
  const db = database();
  try {
    const login = await createLogin(db, options);
    assert.equal(login.origin, 'https://onchainchess.app');
    assert.equal(login.secure, true);
  } finally {
    db.close();
  }
});

test('verification levels are displayed only alongside verified humanity; old accounts migrate without inventing a level', async () => {
  const db = database();
  db.exec(`CREATE TABLE login_accounts (
    issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
    verified_human INTEGER NOT NULL DEFAULT 0, sandbox INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(issuer,subject));`);
  db.prepare('INSERT INTO users VALUES (?,?)').run(1, 'synthetic-player');
  db.prepare('INSERT INTO login_accounts VALUES (?,?,?,?,?)').run(
    'http://localhost:5180/oidc',
    'synthetic-subject',
    1,
    1,
    1
  );
  const login = await createLogin(db, {
    issuer: 'http://localhost:5180/oidc',
    origin: 'http://localhost:5190',
  });
  // Repeated setup must be safe and preserve the existing account.
  await createLogin(db, {
    issuer: 'http://localhost:5180/oidc',
    origin: 'http://localhost:5190',
  });
  const hash = createHash('sha256')
    .update('synthetic-level-session')
    .digest('hex');
  db.prepare('INSERT INTO login_sessions VALUES (?,?,?)').run(
    hash,
    1,
    Date.now() + 60000
  );
  const app = express();
  app.use('/api/login', login.router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const get = async () =>
      (
        await fetch(
          `http://127.0.0.1:${server.address().port}/api/login/session`,
          { headers: { cookie: 'chess_session=synthetic-level-session' } }
        )
      ).json();
    let profile = await get();
    assert.equal(profile.verified_human, true);
    assert.equal(profile.kyc_level, undefined);
    for (const level of ['L1', 'L2']) {
      db.prepare('UPDATE login_accounts SET kyc_level=?').run(level);
      profile = await get();
      assert.equal(profile.kyc_level, level);
      assert.equal(profile.verification_sandbox, true);
    }
    db.prepare('UPDATE login_accounts SET kyc_level=?').run('invented');
    assert.equal((await get()).kyc_level, undefined);
    db.prepare(
      "UPDATE login_accounts SET verified_human=0,kyc_level='L2'"
    ).run();
    profile = await get();
    assert.equal(profile.verified_human, undefined);
    assert.equal(profile.kyc_level, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
