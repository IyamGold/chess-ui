const { WebSocketServer } = require('ws');
const url = require('url');
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setupWebSocket(server, db, login = null) {
  const wss = new WebSocketServer({ noServer: true });

  // Track clients per room: Map<roomId, Set<{ ws, userId, username, role }>>
  const rooms = new Map();
  const streams = new Map();
  function subscribe(roomId, req, res) {
    if (!streams.has(roomId)) streams.set(roomId, new Set());
    const client = { req, res, userId: req.user.id };
    streams.get(roomId).add(client);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 1500\n\ndata: {"event":"ready"}\n\n');
    const heartbeat = setInterval(() => {
      if (login && !login.session(req)) return res.end();
      if (!res.write(': heartbeat\n\n')) res.end();
    }, 15000);
    heartbeat.unref();
    res.on('close', () => {
      clearInterval(heartbeat);
      streams.get(roomId)?.delete(client);
      if (!streams.get(roomId)?.size) streams.delete(roomId);
    });
  }

  const findUserByTokenHash = db.prepare(
    'SELECT id, username, token_expires_at FROM users WHERE token_hash = ?'
  );
  const findRoom = db.prepare('SELECT * FROM rooms WHERE id = ?');

  // Handle HTTP upgrade
  server.on('upgrade', (request, socket, head) => {
    const parsed = url.parse(request.url, true);
    const pathname = parsed.pathname;

    // Match /api/rooms/:id/ws
    const match = pathname.match(/^\/api\/rooms\/(\d+)\/ws$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const roomId = parseInt(match[1]);

    // Extract token from Sec-WebSocket-Protocol header (preferred) or query param (fallback)
    const protocols = (request.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
    const tokenFromProtocol = protocols.find(p => p.startsWith('token.'));
    const token = tokenFromProtocol ? tokenFromProtocol.slice(6) : parsed.query.token;

    let user;
    if (login) {
      if (request.headers.origin !== login.origin) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
      user=login.session(request);
      if(!user) {socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();return;}
    } else {
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const tokenHash = hashToken(token);
    user = findUserByTokenHash.get(tokenHash);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Check token expiry
    if (user.token_expires_at) {
      const expiresAt = new Date(user.token_expires_at + 'Z');
      if (expiresAt <= new Date()) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    }
    const room = findRoom.get(roomId);
    if (!room) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Determine role
    let role = 'spectator';
    if (user.id === room.white_user_id || user.id === room.black_user_id) {
      role = 'player';
    }

    // Accept the connection with the token protocol so the client handshake succeeds
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, { roomId, user, role, request });
    });
  });

  // Heartbeat: ping clients every 30s; terminate sockets that miss a pong.
  // Required because Railway/edge proxies silently close idle WebSockets.
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));
  server.on('close', () => {
    for (const clients of streams.values()) for (const client of clients) client.res.end();
    wss.close();
  });

  // Handle new connections
  wss.on('connection', (ws, { roomId, user, role, request }) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Add to room tracking
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }

    const client = { ws, userId: user.id, username: user.username, role, request };
    rooms.get(roomId).add(client);

    // Send joined confirmation to the new client
    ws.send(JSON.stringify({
      event: 'joined',
      data: {
        roomId,
        userId: user.id,
        username: user.username,
        role
      }
    }));

    // Notify others in the room
    broadcast(roomId, 'playerConnected', {
      userId: user.id,
      username: user.username,
      role
    }, user.id);

    // Handle disconnect
    ws.on('close', () => {
      const roomClients = rooms.get(roomId);
      if (roomClients) {
        roomClients.delete(client);
        if (roomClients.size === 0) {
          rooms.delete(roomId);
        }
      }

      broadcast(roomId, 'playerDisconnected', {
        userId: user.id,
        username: user.username
      });
    });

    // Handle errors
    ws.on('error', () => {
      console.error('Game WebSocket transport failed');
    });
  });

  // Broadcast to all clients in a room, optionally excluding a user
  function broadcast(roomId, event, data, excludeUserId) {
    const roomClients = rooms.get(roomId);
    for (const client of streams.get(roomId) || []) {
      if (login && !login.session(client.req)) { client.res.end(); continue; }
      if (!client.res.write(`data: ${JSON.stringify({ event, data })}\n\n`)) client.res.end();
    }
    if (!roomClients) return;

    const message = JSON.stringify({ event, data });

    for (const client of roomClients) {
      if(login && !login.session(client.request)) {client.ws.close(1008, 'Session expired');continue;}
      if (excludeUserId && client.userId === excludeUserId) continue;
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(message);
      }
    }
  }

  return { broadcast, subscribe };
}

module.exports = { setupWebSocket };
