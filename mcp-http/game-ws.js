import WebSocket from 'ws';

// Per-agent persistent WebSocket connection for a chess room.
// Used by wait_for_opponent / wait_for_turn tools. Connections are pooled by
// (token, roomId) so different agents in the same room don't collide.

class GameConnection {
  constructor(wsUrl, roomId, token) {
    this.wsUrl = wsUrl;
    this.roomId = roomId;
    this.token = token;
    this.state = 'connecting';
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
      if (this._readyResolve) { this._readyResolve(); this._readyResolve = null; }
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
      } catch { /* ignore */ }
    });
    this.ws.on('error', () => { /* close handler reconnects */ });
    this.ws.on('close', () => {
      if (this.state === 'closed') return;
      this.state = 'reconnecting';
      this._reconnect();
    });
  }

  _reconnect() {
    if (this.state === 'closed') return;
    if (this.retryCount >= this.maxRetries) { this._fail(new Error('Max reconnection attempts exceeded')); return; }
    const delay = Math.min(1000 * 2 ** this.retryCount, 30000);
    this.retryCount++;
    this.readyPromise = new Promise((resolve) => { this._readyResolve = resolve; });
    setTimeout(() => { if (this.state !== 'closed') this._connect(); }, delay);
  }

  _fail(err) {
    this.state = 'closed';
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(err); }
    this.waiters = [];
    this.eventBuffer = [];
  }

  ready() {
    if (this.state === 'closed') return Promise.reject(new Error('Connection closed'));
    return this.readyPromise;
  }

  waitForEvent(eventNames, timeoutMs = 90000) {
    if (this.state === 'closed') return Promise.reject(new Error('Connection closed'));
    const idx = this.eventBuffer.findIndex((msg) => eventNames.includes(msg.event));
    if (idx >= 0) return Promise.resolve(this.eventBuffer.splice(idx, 1)[0]);
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
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(new Error('Connection closed')); }
    this.waiters = [];
    this.eventBuffer = [];
    if (this.ws) { this.ws.removeAllListeners(); this.ws.close(1000); }
  }
}

const connections = new Map();

function key(token, roomId) { return `${token}:${roomId}`; }

export function getConnection(roomId, wsUrl, token) {
  const k = key(token, roomId);
  const existing = connections.get(k);
  if (existing && existing.state !== 'closed') return existing;
  const conn = new GameConnection(wsUrl, roomId, token);
  connections.set(k, conn);
  return conn;
}

export function closeConnection(roomId, token) {
  const k = key(token, roomId);
  const conn = connections.get(k);
  if (conn) { conn.close(); connections.delete(k); }
}

export function closeAllConnections() {
  for (const conn of connections.values()) conn.close();
  connections.clear();
}
