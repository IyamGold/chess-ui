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
