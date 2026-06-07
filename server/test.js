const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

// --- Config ---
const PORT = 3099;
const BASE = `http://localhost:${PORT}`;
const TEST_DB = path.join(__dirname, 'test-chess.db');

// --- Test counters ---
let passed = 0;
let failed = 0;
let serverProcess = null;

// --- Helpers ---

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  }
}

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      hostname: 'localhost',
      port: PORT,
      path: urlPath,
      headers: {},
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    if (body) options.headers['Content-Type'] = 'application/json';

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function post(urlPath, body, token) {
  return request('POST', urlPath, body, token);
}

function get(urlPath, token) {
  return request('GET', urlPath, null, token);
}

function connectWs(roomId, token) {
  // Use raw HTTP upgrade to avoid needing ws client in the test runner
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(
      `ws://localhost:${PORT}/api/rooms/${roomId}/ws?token=${token}`
    );
    const messages = [];
    ws.on('open', () => {});
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });
    ws.on('error', (err) => reject(err));
    // Resolve after first message (joined event)
    ws.once('message', () => {
      setTimeout(() => resolve({ ws, messages }), 50);
    });
  });
}

function connectWsRaw(roomId, token) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/rooms/${roomId}/ws?token=${token}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGVzdA==',
      },
    });
    req.on('upgrade', () => resolve({ upgraded: true }));
    req.on('response', (res) => resolve({ upgraded: false, status: res.statusCode }));
    req.on('error', () => resolve({ upgraded: false, status: 0 }));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Server lifecycle ---

function startServer() {
  return new Promise((resolve, reject) => {
    // Clean up any existing test DB
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(TEST_DB + ext); } catch {}
    }

    serverProcess = spawn('node', ['index.js'], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(PORT),
        CHESS_DB_PATH: TEST_DB,
        NODE_ENV: 'test',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      reject(new Error('Server did not start within 5s'));
    }, 5000);

    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      // Suppress server stderr unless debugging
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGINT');
    serverProcess = null;
  }
  // Clean up test DB
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch {}
  }
}

// --- Test suites ---

async function testHealth() {
  console.log('\n1. Health check');
  const res = await get('/api/health');
  assert(res.status === 200, 'GET /api/health → 200');
  assert(res.body.status === 'ok', 'status is "ok"');
}

async function testAuthSignup() {
  console.log('\n2. Auth — signup');

  const r1 = await post('/api/auth/signup', { username: 'alice' });
  assert(r1.status === 201, 'valid signup → 201');
  assert(typeof r1.body.token === 'string', 'response has token');
  assert(r1.body.username === 'alice', 'response has username');

  const r2 = await post('/api/auth/signup', { username: 'alice' });
  assert(r2.status === 409, 'duplicate username → 409');

  const r3 = await post('/api/auth/signup', { username: 'ab' });
  assert(r3.status === 400, 'too-short username → 400');

  const r4 = await post('/api/auth/signup', { username: 'bad user!' });
  assert(r4.status === 400, 'invalid chars → 400');
}

async function testPasskeyToken() {
  console.log('\n3. Auth — passkey token bridge');

  const r1 = await post('/api/auth/token', {
    passkeyAddress: '0xtest123',
    username: 'passkey-user',
  });
  assert(r1.status === 201, 'new passkey user → 201');
  assert(typeof r1.body.token === 'string', 'has token');

  const r2 = await post('/api/auth/token', {
    passkeyAddress: '0xtest123',
    username: 'passkey-user',
  });
  assert(r2.status === 200, 'same passkey again → 200');
  assert(r2.body.token === r1.body.token, 'same token returned');
}

async function testRoomCreation() {
  console.log('\n4. Room creation');

  // Create user for room tests
  const user = (await post('/api/auth/signup', { username: 'room-creator' })).body;

  const r1 = await post('/api/rooms', { color: 'white', opponent: 'human' }, user.token);
  assert(r1.status === 201, 'create room (white) → 201');
  assert(typeof r1.body.roomId === 'number', 'has roomId');
  assert(typeof r1.body.inviteCode === 'string', 'has inviteCode');
  assert(r1.body.color === 'white', 'color is "white"');

  const r2 = await post('/api/rooms', { color: 'random', opponent: 'human' }, user.token);
  assert(r2.status === 201, 'create room (random) → 201');
  assert(r2.body.color === 'white' || r2.body.color === 'black', 'color is white or black');

  const r3 = await post('/api/rooms', { color: 'white', opponent: 'stockfish' }, user.token);
  assert(r3.status === 201, 'stockfish room → 201 (WASM engine)');
}

async function testRoomJoin() {
  console.log('\n5. Room join');

  const white = (await post('/api/auth/signup', { username: 'join-white' })).body;
  const black = (await post('/api/auth/signup', { username: 'join-black' })).body;

  // Create a room as white
  const room = (await post('/api/rooms', { color: 'white', opponent: 'human' }, white.token)).body;

  // Join with black
  const r1 = await post('/api/rooms/join', { inviteCode: room.inviteCode }, black.token);
  assert(r1.status === 200, 'join by invite code → 200');
  assert(r1.body.color === 'black', 'opposite color assigned');

  // Non-existent code
  const r2 = await post('/api/rooms/join', { inviteCode: 'ZZZZZ99' }, black.token);
  assert(r2.status === 404, 'non-existent code → 404');

  // Already full
  const extra = (await post('/api/auth/signup', { username: 'join-extra' })).body;
  const r3 = await post('/api/rooms/join', { inviteCode: room.inviteCode }, extra.token);
  assert(r3.status === 400, 'join full room → 400');

  // Creator can't join own room
  const room2 = (await post('/api/rooms', { color: 'white', opponent: 'human' }, white.token)).body;
  const r4 = await post('/api/rooms/join', { inviteCode: room2.inviteCode }, white.token);
  assert(r4.status === 400, "creator can't join own room → 400");
}

async function testGameState() {
  console.log('\n6. Game state');

  const white = (await post('/api/auth/signup', { username: 'state-white' })).body;
  const black = (await post('/api/auth/signup', { username: 'state-black' })).body;

  const room = (await post('/api/rooms', { color: 'white', opponent: 'human' }, white.token)).body;
  await post('/api/rooms/join', { inviteCode: room.inviteCode }, black.token);

  const r = await get(`/api/rooms/${room.roomId}`, white.token);
  assert(r.status === 200, 'GET room → 200');
  assert(r.body.status === 'playing', 'status is "playing"');
  assert(r.body.fen.startsWith('rnbqkbnr/pppppppp/'), 'correct starting FEN');
  assert(Array.isArray(r.body.legalMoves) && r.body.legalMoves.length === 20, '20 legal moves at start');
  assert(r.body.myColor === 'white', 'myColor is correct');
}

async function testScholarsMate() {
  console.log("\n7. Scholar's Mate");

  const white = (await post('/api/auth/signup', { username: 'scholar-w' })).body;
  const black = (await post('/api/auth/signup', { username: 'scholar-b' })).body;

  const room = (await post('/api/rooms', { color: 'white', opponent: 'human' }, white.token)).body;
  await post('/api/rooms/join', { inviteCode: room.inviteCode }, black.token);
  const id = room.roomId;

  const m1 = await post(`/api/rooms/${id}/move`, { move: 'e2e4' }, white.token);
  assert(m1.status === 200 && m1.body.ok, '1. e2e4 → ok');

  const m2 = await post(`/api/rooms/${id}/move`, { move: 'e7e5' }, black.token);
  assert(m2.status === 200 && m2.body.ok, '1...e7e5 → ok');

  const m3 = await post(`/api/rooms/${id}/move`, { move: 'f1c4' }, white.token);
  assert(m3.status === 200 && m3.body.ok, '2. Bc4 → ok');

  const m4 = await post(`/api/rooms/${id}/move`, { move: 'b8c6' }, black.token);
  assert(m4.status === 200 && m4.body.ok, '2...Nc6 → ok');

  const m5 = await post(`/api/rooms/${id}/move`, { move: 'd1h5' }, white.token);
  assert(m5.status === 200 && m5.body.ok, '3. Qh5 → ok');

  const m6 = await post(`/api/rooms/${id}/move`, { move: 'g8f6' }, black.token);
  assert(m6.status === 200 && m6.body.ok, '3...Nf6 → ok');

  const m7 = await post(`/api/rooms/${id}/move`, { move: 'h5f7' }, white.token);
  assert(m7.status === 200, '4. Qxf7# → 200');
  assert(m7.body.gameOver === true, 'gameOver is true');
  assert(m7.body.result === '1-0', 'result is "1-0"');
  assert(m7.body.reason === 'checkmate', 'reason is "checkmate"');
}

async function testIllegalMoves() {
  console.log('\n8. Illegal moves');

  const white = (await post('/api/auth/signup', { username: 'illegal-w' })).body;
  const black = (await post('/api/auth/signup', { username: 'illegal-b' })).body;

  const room = (await post('/api/rooms', { color: 'white', opponent: 'human' }, white.token)).body;
  await post('/api/rooms/join', { inviteCode: room.inviteCode }, black.token);
  const id = room.roomId;

  // Illegal move: pawn can't jump 3 squares
  const r1 = await post(`/api/rooms/${id}/move`, { move: 'e2e5' }, white.token);
  assert(r1.status === 400, 'illegal move e2e5 → 400');
  assert(typeof r1.body.error === 'string', 'has error message');
  assert(Array.isArray(r1.body.legalMoves), 'has legalMoves');
  assert(r1.body.illegalMoveCount === 1, 'illegalMoveCount is 1');

  // Wrong turn
  const r2 = await post(`/api/rooms/${id}/move`, { move: 'e7e5' }, black.token);
  assert(r2.status === 403, 'wrong turn → 403');

  // Move after game over — use the Scholar's Mate room (already finished)
  // Create a new game, play to checkmate, then try another move
  const w2 = (await post('/api/auth/signup', { username: 'over-w' })).body;
  const b2 = (await post('/api/auth/signup', { username: 'over-b' })).body;
  const room2 = (await post('/api/rooms', { color: 'white', opponent: 'human' }, w2.token)).body;
  await post('/api/rooms/join', { inviteCode: room2.inviteCode }, b2.token);
  const id2 = room2.roomId;

  // Quick checkmate: Scholar's Mate
  await post(`/api/rooms/${id2}/move`, { move: 'e2e4' }, w2.token);
  await post(`/api/rooms/${id2}/move`, { move: 'e7e5' }, b2.token);
  await post(`/api/rooms/${id2}/move`, { move: 'f1c4' }, w2.token);
  await post(`/api/rooms/${id2}/move`, { move: 'b8c6' }, b2.token);
  await post(`/api/rooms/${id2}/move`, { move: 'd1h5' }, w2.token);
  await post(`/api/rooms/${id2}/move`, { move: 'g8f6' }, b2.token);
  await post(`/api/rooms/${id2}/move`, { move: 'h5f7' }, w2.token);

  const r3 = await post(`/api/rooms/${id2}/move`, { move: 'a7a6' }, b2.token);
  assert(r3.status === 400, 'move after game over → 400');
  assert(r3.body.error.includes('not in progress'), 'error says "not in progress"');
}

async function testCastling() {
  console.log('\n9. Castling');

  const white = (await post('/api/auth/signup', { username: 'castle-w' })).body;
  const black = (await post('/api/auth/signup', { username: 'castle-b' })).body;

  const room = (await post('/api/rooms', { color: 'white', opponent: 'human' }, white.token)).body;
  await post('/api/rooms/join', { inviteCode: room.inviteCode }, black.token);
  const id = room.roomId;

  // Clear kingside: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O
  await post(`/api/rooms/${id}/move`, { move: 'e2e4' }, white.token);
  await post(`/api/rooms/${id}/move`, { move: 'e7e5' }, black.token);
  await post(`/api/rooms/${id}/move`, { move: 'g1f3' }, white.token);
  await post(`/api/rooms/${id}/move`, { move: 'b8c6' }, black.token);
  await post(`/api/rooms/${id}/move`, { move: 'f1c4' }, white.token);
  await post(`/api/rooms/${id}/move`, { move: 'f8c5' }, black.token);

  const r = await post(`/api/rooms/${id}/move`, { move: 'e1g1' }, white.token);
  assert(r.status === 200 && r.body.ok, 'kingside castle e1g1 → ok');

  // Verify FEN: rank 1 should show rook on f1 and king on g1
  assert(r.body.fen.includes('RNBQ1RK1'), 'FEN shows rook on f1, king on g1 (RNBQ1RK1)');
}

async function testEnPassant() {
  console.log('\n10. En passant');

  const white = (await post('/api/auth/signup', { username: 'ep-white' })).body;
  const black = (await post('/api/auth/signup', { username: 'ep-black' })).body;

  const room = (await post('/api/rooms', { color: 'white', opponent: 'human' }, white.token)).body;
  await post('/api/rooms/join', { inviteCode: room.inviteCode }, black.token);
  const id = room.roomId;

  // 1.e4 a6 2.e5 d5 3.exd6 (en passant)
  await post(`/api/rooms/${id}/move`, { move: 'e2e4' }, white.token);
  await post(`/api/rooms/${id}/move`, { move: 'a7a6' }, black.token);
  await post(`/api/rooms/${id}/move`, { move: 'e4e5' }, white.token);
  await post(`/api/rooms/${id}/move`, { move: 'd7d5' }, black.token);

  const r = await post(`/api/rooms/${id}/move`, { move: 'e5d6' }, white.token);
  assert(r.status === 200 && r.body.ok, 'en passant e5d6 → ok');

  // Verify: d5 pawn should be gone (captured en passant), white pawn now on d6
  // FEN rank 5 (index 3 from left in FEN) should not have a pawn on d5
  assert(!r.body.fen.split(' ')[0].split('/')[3].includes('p'), 'captured pawn removed from rank 5');
}

async function testPromotion() {
  console.log('\n11. Promotion');

  const white = (await post('/api/auth/signup', { username: 'promo-w' })).body;
  const black = (await post('/api/auth/signup', { username: 'promo-b' })).body;

  const room = (await post('/api/rooms', { color: 'white', opponent: 'human' }, white.token)).body;
  await post('/api/rooms/join', { inviteCode: room.inviteCode }, black.token);
  const id = room.roomId;

  // Push white b-pawn to promotion:
  // 1.b4 h6 2.b5 h5 3.b6 h4 4.bxc7 h3 5.cxb8=Q
  await post(`/api/rooms/${id}/move`, { move: 'b2b4' }, white.token);
  await post(`/api/rooms/${id}/move`, { move: 'h7h6' }, black.token);
  await post(`/api/rooms/${id}/move`, { move: 'b4b5' }, white.token);
  await post(`/api/rooms/${id}/move`, { move: 'h6h5' }, black.token);
  await post(`/api/rooms/${id}/move`, { move: 'b5b6' }, white.token);
  await post(`/api/rooms/${id}/move`, { move: 'h5h4' }, black.token);
  await post(`/api/rooms/${id}/move`, { move: 'b6c7' }, white.token);
  await post(`/api/rooms/${id}/move`, { move: 'h4h3' }, black.token);

  // Try without promotion piece
  const r1 = await post(`/api/rooms/${id}/move`, { move: 'c7b8' }, white.token);
  assert(r1.status === 400, 'pawn promotion without piece → 400');
  assert(r1.body.error.includes('Promotion'), 'error mentions promotion');

  // Promote to queen
  const r2 = await post(`/api/rooms/${id}/move`, { move: 'c7b8q' }, white.token);
  assert(r2.status === 200 && r2.body.ok, 'c7b8q promote to queen → ok');

  // Verify: FEN rank 8 should have Q where the knight was (b8)
  const rank8 = r2.body.fen.split(' ')[0].split('/')[0];
  assert(rank8.includes('Q'), 'FEN rank 8 shows promoted queen');
}

async function testWebSocket() {
  console.log('\n12. WebSocket');

  const white = (await post('/api/auth/signup', { username: 'ws-white' })).body;
  const black = (await post('/api/auth/signup', { username: 'ws-black' })).body;

  const room = (await post('/api/rooms', { color: 'white', opponent: 'human' }, white.token)).body;
  await post('/api/rooms/join', { inviteCode: room.inviteCode }, black.token);
  const id = room.roomId;

  // Connect black's WebSocket
  const { ws, messages } = await connectWs(id, black.token);

  // Check joined event
  assert(messages.length >= 1, 'received message on connect');
  assert(messages[0].event === 'joined', '"joined" event on connect');
  assert(messages[0].data.role === 'player', 'role is "player"');

  // Make a move via HTTP and check WS receives it
  await post(`/api/rooms/${id}/move`, { move: 'e2e4' }, white.token);
  await sleep(200);

  const moveMsg = messages.find((m) => m.event === 'move');
  assert(moveMsg !== undefined, 'received "move" event via WS');
  assert(moveMsg && moveMsg.data.move === 'e2e4', 'move data is correct');

  ws.close();

  // Invalid token → connection rejected
  const result = await connectWsRaw(id, 'bad-token-xxx');
  assert(!result.upgraded, 'invalid token → connection rejected');
}

// Reaper unit test — runs in-process against a dedicated temp DB with
// controlled timestamps (no HTTP server / no waiting on intervals).
function testReaper() {
  console.log('\n13. Room reaper');

  const REAPER_DB = path.join(__dirname, 'test-reaper.db');
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(REAPER_DB + ext); } catch {}
  }

  // db.js captures CHESS_DB_PATH at require time, so set it before requiring.
  process.env.CHESS_DB_PATH = REAPER_DB;
  const { createDb } = require('./db');
  const { createReaper } = require('./reaper');
  const db = createDb();

  // gsUpdatedExpr controls game_states.updated_at — the "last move" time that
  // drives the abandoned-playing reap (see reaper.js).
  const seed = (code, status, createdExpr, gsUpdatedExpr) => {
    const info = db.prepare(
      `INSERT INTO rooms (invite_code, status, created_at, updated_at) VALUES (?, ?, ${createdExpr}, ${createdExpr})`
    ).run(code, status);
    const id = info.lastInsertRowid;
    db.prepare(
      `INSERT INTO game_states (room_id, board, current_turn, updated_at) VALUES (?, '[]', 'white', ${gsUpdatedExpr})`
    ).run(id);
    return id;
  };

  const staleWaiting = seed('REAP01', 'waiting', "datetime('now','-20 minutes')", "datetime('now','-20 minutes')");
  const freshWaiting = seed('KEEP01', 'waiting', "datetime('now')", "datetime('now')");
  // Abandoned: room joined 30d ago, last move 8d ago → reaped.
  const abandonedPlaying = seed('REAP02', 'playing', "datetime('now','-30 days')", "datetime('now','-8 days')");
  // Long-running but active: joined 30d ago, but a move 1h ago → kept.
  // (Guards against keying idle-time off rooms.updated_at, which isn't bumped per move.)
  const activePlaying = seed('KEEP02', 'playing', "datetime('now','-30 days')", "datetime('now','-1 hours')");
  const finished = seed('KEEP03', 'finished', "datetime('now','-60 days')", "datetime('now','-30 days')");

  const count = createReaper(db)();

  const roomExists = (id) => !!db.prepare('SELECT id FROM rooms WHERE id = ?').get(id);
  const stateExists = (id) => !!db.prepare('SELECT room_id FROM game_states WHERE room_id = ?').get(id);

  assert(count === 2, 'reaped exactly 2 rooms');
  assert(!roomExists(staleWaiting), 'stale waiting room (>15min) deleted');
  assert(!stateExists(staleWaiting), 'stale waiting game_state deleted (FK child)');
  assert(!roomExists(abandonedPlaying), 'abandoned playing room (>7d idle) deleted');
  assert(roomExists(freshWaiting), 'fresh waiting room kept');
  assert(roomExists(activePlaying), 'recently-active playing room kept');
  assert(roomExists(finished), 'finished room kept as history');

  db.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(REAPER_DB + ext); } catch {}
  }
}

// --- Main ---

async function main() {
  console.log('Starting chess server for testing...');

  try {
    await startServer();
    console.log(`Server running on port ${PORT}`);
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }

  try {
    await testHealth();
    await testAuthSignup();
    await testPasskeyToken();
    await testRoomCreation();
    await testRoomJoin();
    await testGameState();
    await testScholarsMate();
    await testIllegalMoves();
    await testCastling();
    await testEnPassant();
    await testPromotion();
    await testWebSocket();
    testReaper();
  } catch (err) {
    console.error('\n\x1b[31mUnexpected error:\x1b[0m', err);
    failed++;
  }

  // Summary
  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  if (failed === 0) {
    console.log(`\x1b[32m✓ All ${total} tests passed\x1b[0m`);
  } else {
    console.log(`\x1b[31m✗ ${failed}/${total} tests failed\x1b[0m`);
  }

  stopServer();
  process.exit(failed > 0 ? 1 : 0);
}

main();
