const { WebSocketServer } = require('ws');
const url = require('url');

function setupWebSocket(server, db) {
  const wss = new WebSocketServer({ noServer: true });

  // Track clients per room: Map<roomId, Set<{ ws, userId, username, role }>>
  const rooms = new Map();

  const findUserByToken = db.prepare('SELECT id, username FROM users WHERE token = ?');
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
    const token = parsed.query.token;

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const user = findUserByToken.get(token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
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

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, { roomId, user, role });
    });
  });

  // Handle new connections
  wss.on('connection', (ws, { roomId, user, role }) => {
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
