import WebSocket from 'ws';

// --- Persistent WebSocket connection per game room ---

class GameConnection {
  constructor(wsUrl, roomId, token) {
    this.wsUrl = wsUrl;
    this.roomId = roomId;
    this.token = token;
    this.state = 'connecting'; // connecting | connected | reconnecting | closed
    this.eventBuffer = [];
    this.waiters = [];
    this.retryCount = 0;
    this.maxRetries = 5;
    this.ws = null;
    this._readyResolve = null;
    this.readyPromise = new Promise((resolve) => { this._readyResolve = resolve; });
    this._connect();
  }

  _connect() {
    const url = `${this.wsUrl}/api/rooms/${this.roomId}/ws`;
    this.ws = new WebSocket(url, [`token.${this.token}`]);

    this.ws.on('open', () => {
      this.state = 'connected';
      this.retryCount = 0;
      if (this._readyResolve) {
        this._readyResolve();
        this._readyResolve = null;
      }
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const idx = this.waiters.findIndex((w) => w.eventNames.includes(msg.event));
        if (idx >= 0) {
          const waiter = this.waiters.splice(idx, 1)[0];
          clearTimeout(waiter.timer);
          waiter.resolve(msg);
        } else {
          this.eventBuffer.push(msg);
          if (this.eventBuffer.length > 100) this.eventBuffer.shift();
        }
      } catch {
        // ignore malformed messages
      }
    });

    this.ws.on('error', () => {
      // close event always follows — reconnection handled there
    });

    this.ws.on('close', () => {
      if (this.state === 'closed') return;
      this.state = 'reconnecting';
      this._reconnect();
    });
  }

  _reconnect() {
    if (this.state === 'closed') return;
    if (this.retryCount >= this.maxRetries) {
      this._fail(new Error('Max reconnection attempts exceeded'));
      return;
    }
    const delay = Math.min(1000 * 2 ** this.retryCount, 30000);
    this.retryCount++;
    this.readyPromise = new Promise((resolve) => { this._readyResolve = resolve; });
    setTimeout(() => {
      if (this.state === 'closed') return;
      this._connect();
    }, delay);
  }

  _fail(err) {
    this.state = 'closed';
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.waiters = [];
    this.eventBuffer = [];
  }

  ready() {
    if (this.state === 'closed') return Promise.reject(new Error('Connection closed'));
    return this.readyPromise;
  }

  waitForEvent(eventNames, timeoutMs = 300000) {
    if (this.state === 'closed') {
      return Promise.reject(new Error('Connection closed'));
    }

    // Check buffer first
    const idx = this.eventBuffer.findIndex((msg) => eventNames.includes(msg.event));
    if (idx >= 0) {
      return Promise.resolve(this.eventBuffer.splice(idx, 1)[0]);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`Timed out waiting for events: ${eventNames.join(', ')}`));
      }, timeoutMs);
      this.waiters.push({ eventNames, resolve, reject, timer });
    });
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Connection closed'));
    }
    this.waiters = [];
    this.eventBuffer = [];
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close(1000);
    }
  }
}

// --- Connection registry ---

const connections = new Map();

export function getConnection(roomId, wsUrl, token) {
  const existing = connections.get(roomId);
  if (existing && existing.state !== 'closed') return existing;
  const conn = new GameConnection(wsUrl, roomId, token);
  connections.set(roomId, conn);
  return conn;
}

export function closeConnection(roomId) {
  const conn = connections.get(roomId);
  if (conn) {
    conn.close();
    connections.delete(roomId);
  }
}

export function closeAllConnections() {
  for (const [roomId, conn] of connections) {
    conn.close();
  }
  connections.clear();
}

// --- HTTP API client ---

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

  async refresh(oldToken) {
    const res = await fetch(`${this.serverUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${oldToken}`,
      },
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body.error || 'Refresh failed');
    return body;
  }

}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
