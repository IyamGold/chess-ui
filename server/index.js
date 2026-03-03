const express = require('express');
const cors = require('cors');
const http = require('http');
const rateLimit = require('express-rate-limit');
const { createDb } = require('./db');
const { authMiddleware } = require('./middleware/auth');
const { createAuthRouter } = require('./routes/auth');
const { createRoomsRouter } = require('./routes/rooms');
const { setupWebSocket } = require('./ws');
const { createStockfishPlayer } = require('./chess/stockfishPlayer');

const PORT = process.env.PORT || 3001;

async function main() {
  // Initialize database
  const db = createDb();

  // Initialize Stockfish (awaited so engine is ready before accepting requests)
  let stockfishPlayer = await createStockfishPlayer();

  // Create Express app
  const app = express();

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
  app.use('/api/auth', signupLimiter, createAuthRouter(db));

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

  // Room expiry: every 5 minutes, delete stale waiting rooms
  // Delete game_states first (child FK), then rooms (parent)
  const findStaleRooms = db.prepare(`
    SELECT id FROM rooms
    WHERE status = 'waiting'
    AND created_at < datetime('now', '-15 minutes')
  `);
  const deleteGameStateByRoom = db.prepare('DELETE FROM game_states WHERE room_id = ?');
  const deleteRoomById = db.prepare('DELETE FROM rooms WHERE id = ?');

  const expireStaleRooms = db.transaction(() => {
    const stale = findStaleRooms.all();
    for (const row of stale) {
      deleteGameStateByRoom.run(row.id);
      deleteRoomById.run(row.id);
    }
    return stale.length;
  });

  setInterval(() => {
    const count = expireStaleRooms();
    if (count > 0) {
      console.log(`Expired ${count} stale waiting room(s)`);
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
