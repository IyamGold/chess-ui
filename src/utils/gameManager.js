const INDEX_KEY = 'chess_game_index';
const GAME_PREFIX = 'chess_game_';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createGame(engineColor) {
  const id = generateId();
  const now = new Date().toISOString();
  const gameState = {
    id,
    board: null, // null = use INITIAL_BOARD default
    currentTurn: 'white',
    moveHistory: [],
    enPassantTarget: null,
    movedPieces: [],
    halfMoveClock: 0,
    positionHistory: [],
    engineColor,
    result: '*',
    createdAt: now,
    updatedAt: now,
  };

  try {
    localStorage.setItem(GAME_PREFIX + id, JSON.stringify(gameState));
    const index = getIndex();
    index.unshift({ id, createdAt: now, updatedAt: now, result: '*', moveCount: 0, engineColor });
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (e) {
    console.error('Failed to save game:', e);
    alert('Could not save game. localStorage may be full.');
  }

  return gameState;
}

export function saveGame(gameState) {
  const now = new Date().toISOString();
  const updated = { ...gameState, updatedAt: now, movedPieces: [...gameState.movedPieces] };

  try {
    localStorage.setItem(GAME_PREFIX + gameState.id, JSON.stringify(updated));
    const index = getIndex();
    const entry = index.find(g => g.id === gameState.id);
    if (entry) {
      entry.updatedAt = now;
      entry.result = gameState.result;
      entry.moveCount = gameState.moveHistory.length;
      localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    }
  } catch (e) {
    console.error('Failed to save game:', e);
    alert('Could not save game. localStorage may be full.');
  }
}

export function loadGame(gameId) {
  const raw = localStorage.getItem(GAME_PREFIX + gameId);
  if (!raw) return null;
  const state = JSON.parse(raw);
  state.movedPieces = new Set(state.movedPieces);
  return state;
}

export function listGames() {
  return getIndex();
}

export function deleteGame(gameId) {
  localStorage.removeItem(GAME_PREFIX + gameId);
  const index = getIndex().filter(g => g.id !== gameId);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function clearAllGames() {
  const index = getIndex();
  index.forEach(g => localStorage.removeItem(GAME_PREFIX + g.id));
  localStorage.removeItem(INDEX_KEY);
}

export function markGamePublished(gameId, txHash) {
  const raw = localStorage.getItem(GAME_PREFIX + gameId);
  if (!raw) return;
  const state = JSON.parse(raw);
  state.txHash = txHash;
  localStorage.setItem(GAME_PREFIX + gameId, JSON.stringify(state));

  const index = getIndex();
  const entry = index.find(g => g.id === gameId);
  if (entry) {
    entry.txHash = txHash;
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  }
}

function getIndex() {
  const raw = localStorage.getItem(INDEX_KEY);
  return raw ? JSON.parse(raw) : [];
}
