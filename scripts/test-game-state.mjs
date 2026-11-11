import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshot, previewMove } from '../src/gameSnapshot.js';
test('late HTTP data cannot undo an engine move or a finished game', () => {
  const newer = {
    moveHistory: ['e2e4', 'e7e5'],
    board: [2],
    clock: { serverNow: 30 },
  };
  assert.equal(
    mergeSnapshot(newer, { moveHistory: ['e2e4'], board: [1] }),
    newer
  );
  assert.equal(
    mergeSnapshot(newer, {
      moveHistory: ['e2e4', 'e7e5'],
      clock: { serverNow: 20 },
    }),
    newer
  );
  const terminal = { ...newer, result: '1-0' };
  assert.equal(mergeSnapshot(terminal, newer), terminal);
  assert.equal(mergeSnapshot(newer, { drawOffer: 'white' }).drawOffer, 'white');
});
test('optimistic preview handles castling, en passant and promotion', () => {
  let b = Array(64).fill(0);
  b[60] = 1;
  b[63] = 4;
  let n = previewMove(b, 'e1g1');
  assert.equal(n[62], 1);
  assert.equal(n[61], 4);
  assert.equal(n[63], 0);
  assert.equal(b[60], 1);
  b = Array(64).fill(0);
  b[28] = 2;
  b[27] = -2;
  n = previewMove(b, 'e5d6');
  assert.equal(n[19], 2);
  assert.equal(n[27], 0);
  b = Array(64).fill(0);
  b[8] = 2;
  assert.equal(previewMove(b, 'a7a8q')[0], 6);
  b = Array(64).fill(0);
  b[55] = -2;
  assert.equal(previewMove(b, 'h2h1n')[63], -3);
});
