import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { createDb, startCleanup } from './db.js';
import { createDiscoveryRouter } from './oauth/discovery.js';
import { createRegisterRouter } from './oauth/register.js';
import { createAuthorizeRouter } from './oauth/authorize.js';
import { createTokenRouter } from './oauth/token.js';
import { createRevokeRouter } from './oauth/revoke.js';
import { createConsentProxyRouter } from './oauth/consent-proxy.js';
import { bearerMiddleware, handleMcpRequest } from './mcp-handler.js';
import { closeAllConnections } from './game-ws.js';

async function main() {
  const db = createDb();
  startCleanup(db);

  const app = express();
  app.set('trust proxy', 1);

  // Discovery + .well-known are public; serve before any other middleware.
  app.use(createDiscoveryRouter());

  // CORS for the consent UI domain (lookup + complete are called from the browser).
  const consentOrigin = new URL(config.consentUiUrl).origin;
  const corsOptions = {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin === consentOrigin || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      cb(null, false);
    },
    credentials: false,
  };

  // OAuth body endpoints expect form-encoded (per spec) or JSON; accept both.
  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: false }));

  // Request logging.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const dur = Date.now() - start;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${dur}ms`);
    });
    next();
  });

  // OAuth routes. CORS is applied to anything the browser calls (lookup,
  // complete, token, revoke, consent proxies). DCR + the top-level /authorize
  // GET don't need CORS — DCR is server-to-server, and /authorize is a
  // top-level navigation, not a fetch.
  app.use(createRegisterRouter(db));
  app.use(cors(corsOptions), createAuthorizeRouter(db));
  app.use(cors(corsOptions), createTokenRouter(db));
  app.use(cors(corsOptions), createRevokeRouter(db));
  app.use(cors(corsOptions), createConsentProxyRouter(db));

  // Health check.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // MCP endpoint (bearer-protected, stateless).
  app.post('/mcp', bearerMiddleware(db), handleMcpRequest);
  app.get('/mcp', bearerMiddleware(db), handleMcpRequest);
  app.delete('/mcp', bearerMiddleware(db), handleMcpRequest);

  // Generic error handler so unhandled exceptions don't crash the process.
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'internal_error' });
  });

  const server = app.listen(config.port, () => {
    console.log(`MCP HTTP server listening on ${config.baseUrl} (port ${config.port})`);
  });

  const shutdown = () => {
    console.log('Shutting down...');
    closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
