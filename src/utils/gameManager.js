const DEFAULT_INDEX_KEY = 'chess_game_index';
const DEFAULT_GAME_PREFIX = 'chess_game_';

let currentUser = null;

export function setCurrentUser(accountAddress) {
  currentUser = accountAddress || null;
}

function getIndexKey() {
  return currentUser ? `chess_${currentUser}_index` : DEFAULT_INDEX_KEY;
}

function getGamePrefix() {
  return currentUser ? `chess_${currentUser}_game_` : DEFAULT_GAME_PREFIX;
}

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
    localStorage.setItem(getGamePrefix() + id, JSON.stringify(gameState));
    const index = getIndex();
    index.unshift({ id, createdAt: now, updatedAt: now, result: '*', moveCount: 0, engineColor });
    localStorage.setItem(getIndexKey(), JSON.stringify(index));
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
    localStorage.setItem(getGamePrefix() + gameState.id, JSON.stringify(updated));
    const index = getIndex();
    const entry = index.find(g => g.id === gameState.id);
    if (entry) {
      entry.updatedAt = now;
      entry.result = gameState.result;
      entry.moveCount = gameState.moveHistory.length;
      localStorage.setItem(getIndexKey(), JSON.stringify(index));
    }
  } catch (e) {
    console.error('Failed to save game:', e);
    alert('Could not save game. localStorage may be full.');
  }
}

export function loadGame(gameId) {
  const raw = localStorage.getItem(getGamePrefix() + gameId);
  if (!raw) return null;
  const state = JSON.parse(raw);
  state.movedPieces = new Set(state.movedPieces);
  return state;
}

export function listGames() {
  return getIndex();
}

export function deleteGame(gameId) {
  localStorage.removeItem(getGamePrefix() + gameId);
  const index = getIndex().filter(g => g.id !== gameId);
  localStorage.setItem(getIndexKey(), JSON.stringify(index));
}

export function clearAllGames() {
  const index = getIndex();
  index.forEach(g => localStorage.removeItem(getGamePrefix() + g.id));
  localStorage.removeItem(getIndexKey());
}

export function markGamePublished(gameId, txHash) {
  const raw = localStorage.getItem(getGamePrefix() + gameId);
  if (!raw) return;
  const state = JSON.parse(raw);
  state.txHash = txHash;
  localStorage.setItem(getGamePrefix() + gameId, JSON.stringify(state));

  const index = getIndex();
  const entry = index.find(g => g.id === gameId);
  if (entry) {
    entry.txHash = txHash;
    localStorage.setItem(getIndexKey(), JSON.stringify(index));
  }
}

function getIndex() {
  const raw = localStorage.getItem(getIndexKey());
  return raw ? JSON.parse(raw) : [];
}
