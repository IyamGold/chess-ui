import WebSocket from 'ws';

export class ChessApiClient {
  constructor(serverUrl) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.wsUrl = this.serverUrl.replace(/^http/, 'ws');
  }

  async signup(username) {
    const res = await fetch(`${this.serverUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body.error || 'Signup failed');
    return body;
  }

  async createRoom(token, color) {
    const res = await fetch(`${this.serverUrl}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ color }),
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body.error || 'Failed to create room');
    return body;
  }

  async joinRoom(token, inviteCode) {
    const res = await fetch(`${this.serverUrl}/api/rooms/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ inviteCode }),
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body.error || 'Failed to join room');
    return body;
  }

  async getRoomState(token, roomId) {
    const res = await fetch(`${this.serverUrl}/api/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body.error || 'Failed to get room state');
    return body;
  }

  async submitMove(token, roomId, move) {
    const res = await fetch(`${this.serverUrl}/api/rooms/${roomId}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ move }),
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body.error || 'Move failed', body);
    return body;
  }

  async resign(token, roomId) {
    const res = await fetch(`${this.serverUrl}/api/rooms/${roomId}/resign`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body.error || 'Resign failed');
    return body;
  }

  waitForEvent(token, roomId, targetEvents, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.wsUrl}/api/rooms/${roomId}/ws?token=${token}`;
      const ws = new WebSocket(wsUrl);

      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out waiting for events: ${targetEvents.join(', ')}`));
      }, timeoutMs);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (targetEvents.includes(msg.event)) {
            clearTimeout(timer);
            ws.close();
            resolve(msg);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      ws.on('close', (code) => {
        clearTimeout(timer);
        // Only reject if we haven't resolved yet
        if (code !== 1000) {
          reject(new Error(`WebSocket closed unexpectedly (code ${code})`));
        }
      });
    });
  }
}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
