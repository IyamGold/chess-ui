const { WebSocketServer } = require('ws');
const url = require('url');
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setupWebSocket(server, db) {
  const wss = new WebSocketServer({ noServer: true });

  // Track clients per room: Map<roomId, Set<{ ws, userId, username, role }>>
  const rooms = new Map();

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

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const tokenHash = hashToken(token);
    const user = findUserByTokenHash.get(tokenHash);
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
    const acceptProtocol = tokenFromProtocol || undefined;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, { roomId, user, role });
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

  wss.on('close', () => clearInterval(heartbeat));

  // Handle new connections
  wss.on('connection', (ws, { roomId, user, role }) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Add to room tracking
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }

    const client = { ws, userId: user.id, username: user.username, role };
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
    ws.on('error', (err) => {
      console.error(`WebSocket error for user ${user.id} in room ${roomId}:`, err.message);
    });
  });

  // Broadcast to all clients in a room, optionally excluding a user
  function broadcast(roomId, event, data, excludeUserId) {
    const roomClients = rooms.get(roomId);
    if (!roomClients) return;

    const message = JSON.stringify({ event, data });

    for (const client of roomClients) {
      if (excludeUserId && client.userId === excludeUserId) continue;
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(message);
      }
    }
  }

  return { broadcast };
}

module.exports = { setupWebSocket };
