const express = require('express');
const path = require('node:path');
const cors = require('cors');
const http = require('http');
const rateLimit = require('express-rate-limit');
const { createLogin } = require('./login');
const { createDb } = require('./db');
const { authMiddleware } = require('./middleware/auth');
const { createAuthRouter } = require('./routes/auth');
const { createMcpAuthRouter } = require('./routes/mcp-auth');
const { requireServiceAuth } = require('./middleware/service-auth');
const { createRoomsRouter } = require('./routes/rooms');
const { createReaper } = require('./reaper');
const { setupWebSocket } = require('./ws');
const { createStockfishPlayer } = require('./chess/stockfishPlayer');

const PORT = process.env.PORT || 3001;
const PASSKEY_SERVER_URL =
  'PASSKEY_SERVER_URL' in process.env ? process.env.PASSKEY_SERVER_URL : 'http://localhost:3000';

async function main() {
  // Initialize database
  const db = createDb();

  const login = process.env.LOGIN_ISSUER
    ? await createLogin(db, {
        issuer: process.env.LOGIN_ISSUER,
        origin: process.env.CHESS_ORIGIN || 'http://localhost:5190',
        clientId: process.env.LOGIN_CLIENT_ID,
      })
    : null;

  const hosted = login?.origin === 'https://chess-demo.withlogin.com';
  if (process.env.CHESS_PUBLIC_DEMO === '1' && !hosted)
    throw new Error('Public Chess requires the approved HTTPS Login configuration.');
  if (
    hosted &&
    (process.env.CHESS_PUBLIC_DEMO !== '1' ||
      !process.env.CHESS_DB_PATH ||
      process.env.CHESS_DB_PATH === ':memory:')
  ) {
    throw new Error(
      'Hosted Chess requires CHESS_PUBLIC_DEMO=1 and CHESS_DB_PATH on a persistent volume.',
    );
  }

  // Initialize Stockfish (awaited so engine is ready before accepting requests)
  let stockfishPlayer = await createStockfishPlayer();

  // Create Express app
  const app = express();

  // Trust the first reverse proxy (Railway, etc.) so X-Forwarded-For is honored
  // and express-rate-limit can identify clients by real IP.
  app.set('trust proxy', 1);

  // Middleware
  app.use(express.json());
  const corsOrigins = login
    ? [login.origin]
    : process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  );

  // Never log raw URLs: OIDC callbacks contain authorization codes.
  if (login) {
    app.use('/api', (req, res, next) => {
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (req.headers.origin !== login.origin || !req.is('application/json'))
      ) {
        return res.status(403).json({ error: 'Request origin or content type rejected' });
      }
      next();
    });
    app.use('/api/login', login.router);
  }

  // Rate limiters
  const isTest = process.env.NODE_ENV === 'test';

  const signupLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Too many signup attempts. Try again in a minute.' },
  });

  const moveLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    keyGenerator: (req) => (req.user ? `user:${req.user.id}` : req.ip),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Too many moves. Slow down.' },
  });

  // Create HTTP server
  const server = http.createServer(app);

  // Setup WebSocket
  const { broadcast } = setupWebSocket(server, db, login);

  // Auth middleware instance
  const auth = login ? login.requireSession : authMiddleware(db);

  // Mount routes
  if (!login)
    app.use(
      '/api/auth',
      signupLimiter,
      createAuthRouter(db, { passkeyServerUrl: PASSKEY_SERVER_URL }),
    );

  // Internal service-auth routes — gated by shared secret, used by the MCP HTTP server.
  // Mounted at /api/internal to bypass the public /api/auth signup rate limit.
  if (!login) app.use('/api/internal', requireServiceAuth, createMcpAuthRouter(db));

  const roomsRouter = createRoomsRouter(db, {
    broadcast,
    getStockfishPlayer: () => stockfishPlayer,
  });
  app.use('/api/rooms/:id/move', auth, moveLimiter);
  app.use('/api/rooms', auth, roomsRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      stockfish: !!stockfishPlayer,
    });
  });

  if (hosted) {
    // API misses must never receive the SPA. Serve the same origin for cookies and WSS.
    app.use('/api', (_req, res) => res.status(404).json({ error: 'not-found' }));
    app.use(express.static(path.resolve(__dirname, '../dist')));
    app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, '../dist/index.html')));
  }

  // Room reaper: every 5 minutes, delete stale waiting rooms (>15 min) and
  // abandoned playing rooms (>7 days idle). Finished games are kept as history.
  const reapStaleRooms = createReaper(db);

  setInterval(() => {
    const count = reapStaleRooms();
    if (count > 0) {
      console.log(`Reaped ${count} stale room(s)`);
    }
  }, 5 * 60 * 1000);

  // Start server
  server.listen(PORT, hosted ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`Chess server listening on http://localhost:${PORT}`);
    console.log(
      login ? 'Login OIDC mode; HttpOnly game sessions enabled.' : 'Legacy agent test mode.',
    );
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    if (stockfishPlayer) stockfishPlayer.terminate();
    db.close();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(
    'Chess startup failed; check the approved configuration and installed dependencies.',
  );
  console.error(err);
  process.exit(1);
});
