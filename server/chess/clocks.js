// Server-authoritative 10+0 clocks. Wall-clock deadlines survive reconnects and restarts.
const INITIAL_MS = 10 * 60 * 1000;
function createClocks(db, { broadcast = () => {}, now = Date.now } = {}) {
  const find = db.prepare('SELECT * FROM room_clocks WHERE room_id=?');
  const room = db.prepare('SELECT status FROM rooms WHERE id=?');
  const write = db.prepare(
    'UPDATE room_clocks SET white_ms=?, black_ms=?, active_color=?, started_at=?, timeout_color=? WHERE room_id=?'
  );
  const read = (id, at = now()) => {
    const c = find.get(id);
    if (!c) return null; // Older games remain untimed; never silently reset a game in progress.
    const elapsed = c.started_at === null ? 0 : Math.max(0, at - c.started_at);
    return {
      whiteMs: Math.max(
        0,
        c.white_ms - (c.active_color === 'white' ? elapsed : 0)
      ),
      blackMs: Math.max(
        0,
        c.black_ms - (c.active_color === 'black' ? elapsed : 0)
      ),
      running: c.active_color,
      serverNow: at,
      timeoutColor: c.timeout_color,
    };
  };
  const expire = db.transaction((id, at = now()) => {
    const c = read(id, at);
    if (!c?.running || room.get(id)?.status !== 'playing') return false;
    if ((c.running === 'white' ? c.whiteMs : c.blackMs) > 0) return false;
    const result = c.running === 'white' ? '0-1' : '1-0';
    write.run(c.whiteMs, c.blackMs, null, null, c.running, id);
    db.prepare(
      "UPDATE rooms SET status='finished', result=?, updated_at=datetime('now') WHERE id=?"
    ).run(result, id);
    db.prepare('DELETE FROM draw_offers WHERE room_id=?').run(id);
    broadcast(id, 'gameOver', {
      result,
      reason: 'timeout',
      clock: read(id, at),
    });
    return true;
  });
  const due =
    db.prepare(`SELECT room_id FROM room_clocks WHERE active_color IS NOT NULL AND
    started_at + CASE active_color WHEN 'white' THEN white_ms ELSE black_ms END <= ?`);
  return {
    now,
    read,
    expire,
    create(id, playing) {
      db.prepare(
        'INSERT INTO room_clocks (room_id,white_ms,black_ms,active_color,started_at) VALUES (?,?,?,?,?)'
      ).run(
        id,
        INITIAL_MS,
        INITIAL_MS,
        playing ? 'white' : null,
        playing ? now() : null
      );
    },
    start(id) {
      db.prepare(
        "UPDATE room_clocks SET active_color='white', started_at=? WHERE room_id=? AND started_at IS NULL AND timeout_color IS NULL"
      ).run(now(), id);
    },
    switchTurn(id, at, finished = false) {
      const c = read(id, at);
      if (!c) return;
      write.run(
        c.whiteMs,
        c.blackMs,
        finished ? null : c.running === 'white' ? 'black' : 'white',
        finished ? null : at,
        c.timeoutColor,
        id
      );
    },
    stop(id, at = now()) {
      const c = read(id, at);
      if (c) write.run(c.whiteMs, c.blackMs, null, null, c.timeoutColor, id);
    },
    sweep() {
      const at = now();
      for (const row of due.all(at)) expire(row.room_id, at);
    },
  };
}
module.exports = { createClocks, INITIAL_MS };
