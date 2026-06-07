// Room reaper — deletes rooms that are safe to discard so the DB doesn't grow
// unbounded. Two categories are reaped:
//   1. 'waiting' rooms older than 15 min — an opponent never joined.
//   2. 'playing' rooms with no move for 7 days — the game was abandoned
//      mid-play. Idle time is measured by game_states.updated_at, which the
//      move endpoint bumps on every move (rooms.updated_at is NOT bumped per
//      move, so it would wrongly reap long-running active games).
// 'finished' rooms are NEVER deleted: they are game history (and may be
// published on-chain).
//
// game_states must be deleted before its parent room (FK constraint).

const WAITING_TTL = '-15 minutes';
const ABANDONED_PLAYING_TTL = '-7 days';

function createReaper(db) {
  const findStaleWaiting = db.prepare(`
    SELECT id FROM rooms
    WHERE status = 'waiting' AND created_at < datetime('now', ?)
  `);
  const findAbandonedPlaying = db.prepare(`
    SELECT r.id FROM rooms r
    JOIN game_states gs ON gs.room_id = r.id
    WHERE r.status = 'playing' AND gs.updated_at < datetime('now', ?)
  `);
  const deleteGameState = db.prepare('DELETE FROM game_states WHERE room_id = ?');
  const deleteRoom = db.prepare('DELETE FROM rooms WHERE id = ?');

  const reap = db.transaction(() => {
    const stale = [
      ...findStaleWaiting.all(WAITING_TTL),
      ...findAbandonedPlaying.all(ABANDONED_PLAYING_TTL),
    ];
    for (const row of stale) {
      deleteGameState.run(row.id);
      deleteRoom.run(row.id);
    }
    return stale.length;
  });

  return reap;
}

module.exports = { createReaper };
