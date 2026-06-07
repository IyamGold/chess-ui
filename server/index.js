const express = require('express');
const cors = require('cors');
const http = require('http');
const rateLimit = require('express-rate-limit');
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
const PASSKEY_SERVER_URL = 'PASSKEY_SERVER_URL' in process.env ? process.env.PASSKEY_SERVER_URL : 'http://localhost:3000';

async function main() {
  // Initialize database
  const db = createDb();

  // Initialize Stockfish (awaited so engine is ready before accepting requests)
  let stockfishPlayer = await createStockfishPlayer();

  // Create Express app
  const app = express();

  // Trust the first reverse proxy (Railway, etc.) so X-Forwarded-For is honored
  // and express-rate-limit can identify clients by real IP.
  app.set('trust proxy', 1);

  // Middleware
  app.use(express.json());
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
  app.use(cors({
    origin: corsOrigins,
    credentials: true
  }));

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // Rate limiters
  const isTest = process.env.NODE_ENV === 'test';

  const signupLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Too many signup attempts. Try again in a minute.' }
  });

  const moveLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    keyGenerator: (req) => req.user ? `user:${req.user.id}` : req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Too many moves. Slow down.' }
  });

  // Create HTTP server
  const server = http.createServer(app);

  // Setup WebSocket
  const { broadcast } = setupWebSocket(server, db);

  // Auth middleware instance
  const auth = authMiddleware(db);

  // Mount routes
  app.use('/api/auth', signupLimiter, createAuthRouter(db, { passkeyServerUrl: PASSKEY_SERVER_URL }));

  // Internal service-auth routes — gated by shared secret, used by the MCP HTTP server.
  // Mounted at /api/internal to bypass the public /api/auth signup rate limit.
  app.use('/api/internal', requireServiceAuth, createMcpAuthRouter(db));

  const roomsRouter = createRoomsRouter(db, {
    broadcast,
    getStockfishPlayer: () => stockfishPlayer
  });
  app.use('/api/rooms', auth, roomsRouter);

  // Apply move-specific rate limiter to move endpoint
  app.use('/api/rooms/:id/move', moveLimiter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      stockfish: !!stockfishPlayer
    });
  });

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
  server.listen(PORT, () => {
    console.log(`Chess server listening on http://localhost:${PORT}`);
    console.log(`WebSocket available at ws://localhost:${PORT}/api/rooms/:id/ws?token=xxx`);
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

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
