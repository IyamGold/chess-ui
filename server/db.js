const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.CHESS_DB_PATH || path.join(__dirname, 'chess.db');

function createDb() {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      token_hash TEXT UNIQUE,
      token_expires_at TEXT,
      passkey_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_code TEXT UNIQUE NOT NULL,
      white_user_id INTEGER REFERENCES users(id),
      black_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'waiting',
      is_stockfish INTEGER NOT NULL DEFAULT 0,
      stockfish_level INTEGER DEFAULT NULL,
      result TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_states (
      room_id INTEGER PRIMARY KEY REFERENCES rooms(id),
      board TEXT NOT NULL,
      current_turn TEXT NOT NULL DEFAULT 'white',
      move_history TEXT NOT NULL DEFAULT '[]',
      en_passant_target INTEGER DEFAULT NULL,
      moved_pieces TEXT NOT NULL DEFAULT '[]',
      half_move_clock INTEGER NOT NULL DEFAULT 0,
      position_history TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rooms_invite_code ON rooms(invite_code);
    CREATE INDEX IF NOT EXISTS idx_users_token_hash ON users(token_hash);
  `);

  return db;
}

module.exports = { createDb };
