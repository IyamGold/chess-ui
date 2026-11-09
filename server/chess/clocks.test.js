const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
process.env.CHESS_DB_PATH = ':memory:';
const { createDb } = require('../db');
const { createClocks, INITIAL_MS } = require('./clocks');
const { createRoomsRouter } = require('../routes/rooms');
const express = require('express');
async function fixture(t) {
  const db = createDb();
  let at = 1_000_000;
  const events = [];
  const broadcast = (...event) => events.push(event);
  const clocks = createClocks(db, { broadcast, now: () => at });
  db.prepare('INSERT INTO users(id,username) VALUES(1,?),(2,?),(3,?)').run(
    'white',
    'black',
    'spectator'
  );
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = {
      id: Number(req.headers['x-test-user'] || 1),
      username: 'test',
    };
    next();
  });
  let engine = async () => null;
  app.use(
    createRoomsRouter(db, {
      broadcast,
      clocks,
      getStockfishPlayer: () => ({ getBestMove: (...args) => engine(...args) }),
    })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const request = async (path, user = 1, data) => {
    const response = await fetch(base + path, {
      method: data ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': String(user),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const create = async (opponent = 'human', color = 'white') =>
    (await request('/', 1, { opponent, color, whiteMs: 9_999_999 })).body;
  const joinRoom = async (r) =>
    request('/join', 2, { inviteCode: r.inviteCode });
  return {
    db,
    clocks,
    events,
    request,
    create,
    joinRoom,
    advance: (ms) => {
      at += ms;
    },
    engine: (fn) => {
      engine = fn;
    },
  };
}
test('waiting clocks do not run; joining starts White at 10:00; only valid moves switch clocks', async (t) => {
  const f = await fixture(t),
    r = await f.create();
  f.advance(120000);
  let state = (await f.request('/' + r.roomId)).body;
  assert.equal(state.clock.whiteMs, INITIAL_MS);
  assert.equal(state.clock.running, null);
  await f.joinRoom(r);
  f.advance(12345);
  assert.equal(
    (await f.request('/' + r.roomId + '/move', 1, { move: 'e2e5' })).status,
    400
  );
  assert.equal(
    (await f.request('/' + r.roomId + '/move', 2, { move: 'e7e5' })).status,
    403
  );
  let moved = await f.request('/' + r.roomId + '/move', 1, {
    move: 'e2e4',
    clock: { whiteMs: INITIAL_MS },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.clock.whiteMs, INITIAL_MS - 12345);
  assert.equal(moved.body.clock.blackMs, INITIAL_MS);
  assert.equal(moved.body.clock.running, 'black');
  f.advance(5432);
  moved = await f.request('/' + r.roomId + '/move', 2, { move: 'e7e5' });
  assert.equal(moved.body.clock.blackMs, INITIAL_MS - 5432);
  assert.equal(moved.body.clock.whiteMs, INITIAL_MS - 12345);
  assert.equal(moved.body.clock.running, 'white');
  f.advance(1000);
  state = (await f.request('/' + r.roomId)).body;
  assert.equal(state.clock.whiteMs, INITIAL_MS - 13345);
  assert.equal(
    (await f.request('/' + r.roomId)).body.clock.whiteMs,
    state.clock.whiteMs,
    'reload must not reset'
  );
});
test('no moves or connected clients are needed to award a timeout; late moves cannot replace it', async (t) => {
  const f = await fixture(t),
    r = await f.create();
  await f.joinRoom(r);
  f.advance(INITIAL_MS);
  f.clocks.sweep();
  const state = (await f.request('/' + r.roomId)).body;
  assert.equal(state.result, '0-1');
  assert.equal(state.reason, 'timeout');
  assert.equal(state.clock.whiteMs, 0);
  assert.equal(state.clock.running, null);
  assert.equal(
    (await f.request('/' + r.roomId + '/move', 1, { move: 'e2e4' })).status,
    400
  );
  assert.equal(
    (await f.request('/' + r.roomId + '/resign', 2, {})).status,
    400
  );
  assert.equal(
    (await f.request('/' + r.roomId + '/draw', 2, { action: 'offer' })).status,
    409
  );
  f.advance(INITIAL_MS);
  f.clocks.sweep();
  assert.equal(f.events.filter((e) => e[1] === 'gameOver').length, 1);
});
test('Black can lose on time; spectators cannot pause or stop the clock', async (t) => {
  const f = await fixture(t),
    r = await f.create();
  await f.joinRoom(r);
  await f.request('/' + r.roomId + '/move', 1, { move: 'e2e4' });
  assert.equal(
    (await f.request('/' + r.roomId + '/resign', 3, {})).status,
    403
  );
  f.advance(INITIAL_MS + 1);
  const state = (await f.request('/' + r.roomId)).body;
  assert.equal(state.result, '1-0');
  assert.equal(state.clock.timeoutColor, 'black');
  assert.equal(state.clock.blackMs, 0);
});
test('draw, resignation and checkmate freeze clocks permanently', async (t) => {
  const f = await fixture(t);
  for (const end of ['draw', 'resign', 'mate']) {
    const r = await f.create();
    await f.joinRoom(r);
    f.advance(3000);
    if (end === 'draw') {
      await f.request('/' + r.roomId + '/draw', 1, { action: 'offer' });
      await f.request('/' + r.roomId + '/draw', 2, { action: 'accept' });
    }
    if (end === 'resign') await f.request('/' + r.roomId + '/resign', 1, {});
    if (end === 'mate')
      for (const [user, move] of [
        [1, 'f2f3'],
        [2, 'e7e5'],
        [1, 'g2g4'],
        [2, 'd8h4'],
      ])
        assert.equal(
          (await f.request('/' + r.roomId + '/move', user, { move })).status,
          200
        );
    const before = (await f.request('/' + r.roomId)).body;
    assert.equal(before.status, 'finished');
    assert.equal(before.clock.running, null);
    f.advance(INITIAL_MS + 1);
    f.clocks.sweep();
    const after = (await f.request('/' + r.roomId)).body;
    assert.equal(after.result, before.result);
    assert.equal(after.clock.whiteMs, before.clock.whiteMs);
    assert.equal(after.clock.blackMs, before.clock.blackMs);
  }
});
test('engine reply arriving after a timeout cannot change the board or result', async (t) => {
  const f = await fixture(t);
  let resolve, started;
  const ready = new Promise((r) => {
    started = r;
  });
  f.engine(() => {
    started();
    return new Promise((r) => {
      resolve = r;
    });
  });
  const r = await f.create('stockfish', 'black');
  await ready;
  f.advance(INITIAL_MS);
  f.clocks.sweep();
  resolve({ from: 'e2', to: 'e4', promotion: null });
  await new Promise((r) => setTimeout(r, 40));
  const state = (await f.request('/' + r.roomId)).body;
  assert.equal(state.result, '0-1');
  assert.equal(state.white, 'Stockfish');
  assert.equal(state.engineColor, 'white');
  assert.equal(state.moveHistory.length, 0);
  assert.equal(state.clock.whiteMs, 0);
});
test('restart keeps elapsed time and legacy rooms stay untimed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-clock-'));
  const Database = require('better-sqlite3');
  const template = createDb();
  const schema = template
    .prepare(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC"
    )
    .all();
  template.close();
  const filename = join(dir, 'state.db');
  let db = new Database(filename);
  // Use the production schema, including persisted clocks.
  for (const row of schema) db.exec(row.sql);
  db.prepare(
    "INSERT INTO rooms(id,invite_code,status) VALUES(1,'TEST','playing'),(2,'OLD','playing')"
  ).run();
  let at = 100000;
  let clocks = createClocks(db, { now: () => at });
  clocks.create(1, true);
  db.close();
  at += 120000;
  db = new Database(filename);
  clocks = createClocks(db, { now: () => at });
  assert.equal(clocks.read(1).whiteMs, 480000);
  assert.equal(clocks.read(2), null);
  at += 480000;
  clocks.sweep();
  assert.equal(
    db.prepare('SELECT result FROM rooms WHERE id=1').get().result,
    '0-1'
  );
  db.close();
  rmSync(dir, { recursive: true });
});
