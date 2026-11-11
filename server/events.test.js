const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
process.env.CHESS_DB_PATH = ':memory:';
const { createDb } = require('./db');
const { setupWebSocket } = require('./ws');
const { createRoomsRouter } = require('./routes/rooms');
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${server.address().port}`)
    )
  );
test('authenticated SSE crosses an HTTP-only proxy, broadcasts moves and closes expired sessions', async (t) => {
  const db = createDb();
  db.prepare('INSERT INTO users(id,username) VALUES(1,?)').run('synthetic');
  let valid = true;
  const login = {
    session: (req) =>
      valid && req.headers.cookie === 'synthetic=session' ? { id: 1 } : null,
  };
  const app = express(),
    server = http.createServer(app);
  app.use(express.json());
  const { broadcast, subscribe } = setupWebSocket(server, db, login);
  app.use(
    '/api/rooms',
    (req, res, next) => {
      const user = login.session(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      req.user = user;
      next();
    },
    createRoomsRouter(db, {
      broadcast,
      subscribe,
      getStockfishPlayer: () => null,
    })
  );
  const backend = await listen(server);
  // This proxy forwards streaming HTTP only. It has no upgrade handler.
  const proxy = http.createServer((req, res) => {
    const upstream = http.request(
      backend + req.url,
      { method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      }
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
    res.on('close', () => upstream.destroy());
  });
  const base = await listen(proxy);
  t.after(() => {
    proxy.closeAllConnections();
    proxy.close();
    server.closeAllConnections();
    server.close();
    db.close();
  });
  const headers = {
    Cookie: 'synthetic=session',
    'Content-Type': 'application/json',
  };
  const created = await (
    await fetch(base + '/api/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ opponent: 'human', color: 'white' }),
    })
  ).json();
  assert.equal(created.clock.whiteMs, 600000);
  assert.equal(
    (await fetch(base + `/api/rooms/${created.roomId}/events`)).status,
    401
  );
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await fetch(base + `/api/rooms/${created.roomId}/events`, {
    headers,
    signal: abort.signal,
  });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader(),
    decode = new TextDecoder();
  assert.match(decode.decode((await reader.read()).value), /ready/);
  broadcast(created.roomId, 'move', { move: 'e2e4', moveHistory: ['e2e4'] });
  assert.match(decode.decode((await reader.read()).value), /e2e4/);
  valid = false;
  broadcast(created.roomId, 'move', { move: 'secret' });
  assert.equal((await reader.read()).done, true);
});
