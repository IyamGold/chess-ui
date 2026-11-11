import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { INITIAL_BOARD } from '../src/constants.js';
const browser = await chromium.launch({
  executablePath: process.env.CHESS_CHROMIUM_EXECUTABLE,
  headless: true,
});
const base = 'http://localhost:5190';
function snapshot(ply = 0) {
  const board = [...INITIAL_BOARD];
  if (ply > 0) {
    board[36] = board[52];
    board[52] = 0;
  }
  if (ply > 1) {
    board[28] = board[12];
    board[12] = 0;
  }
  return {
    roomId: 71,
    white: 'Maya',
    black: 'Stockfish',
    myColor: 'white',
    status: 'playing',
    result: null,
    board,
    currentTurn: ply % 2 ? 'black' : 'white',
    moveHistory: ['e2e4', 'e7e5'].slice(0, ply),
    legalMoves: ply === 0 ? ['e2e4'] : ply === 1 ? ['e7e5'] : ['g1f3'],
    clock: {
      whiteMs: 600000 - ply * 100,
      blackMs: 600000,
      running: ply % 2 ? 'black' : 'white',
      serverNow: 1000 + ply * 100,
    },
  };
}
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    await context.addInitScript(() => {
      window.streams = [];
      window.EventSource = class {
        constructor() {
          window.streams.push(this);
          setTimeout(() => this.onopen?.(), 0);
        }
        close() {
          this.closed = true;
        }
      };
      window.emitGame = (data) =>
        window.streams.at(-1).onmessage({ data: JSON.stringify(data) });
    });
    let state = snapshot(),
      failure = true,
      holdRead = null,
      holdPost = null,
      rejectMove = false,
      reads = 0;
    await context.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/login/session')
        return route.fulfill({
          json: {
            id: 901,
            username: 'Maya',
            loginOrigin: 'https://demo.withlogin.com',
          },
        });
      if (path === '/api/rooms/71') {
        reads++;
        if (failure)
          return route.fulfill({
            status: 503,
            contentType: 'text/html',
            body: 'temporarily unavailable',
          });
        const captured = structuredClone(state);
        if (holdRead)
          await new Promise((resolve) => {
            holdRead.resolve = resolve;
          });
        return route.fulfill({ json: captured }).catch(() => {});
      }
      if (path === '/api/rooms/71/move') {
        if (rejectMove)
          return route.fulfill({
            status: 409,
            json: { error: 'Move rejected; board restored.' },
          });
        state = snapshot(1);
        if (holdPost)
          await new Promise((resolve) => {
            holdPost.resolve = resolve;
          });
        return route.fulfill({ json: { ...snapshot(1), ok: true } });
      }
      return route.fulfill({ status: 404, json: { error: 'test-only' } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/game/71');
    await expect(page.getByRole('alert')).toContainText(
      'temporarily unavailable'
    );
    await expect(page.locator('.chessboard')).toHaveCount(0);
    failure = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.chessboard')).toBeVisible();
    await expect(page.locator('.match-clock')).toHaveCount(2);
    // A background read fails without destroying the board or showing a loader.
    failure = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('status')).toContainText(
      'temporarily unavailable'
    );
    await expect(page.locator('.chessboard')).toBeVisible();
    failure = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Retry', exact: true })
    ).toHaveCount(0);
    // A delayed old GET cannot undo a push received while it was in flight.
    holdRead = {};
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => !!holdRead.resolve).toBe(true);
    state = snapshot(2);
    await page.evaluate(
      (data) => window.emitGame({ event: 'move', data }),
      state
    );
    holdRead.resolve();
    holdRead = null;
    await expect(page.locator('[data-square="e5"] img')).toHaveAttribute(
      'src',
      '/pieces/black-pawn.png'
    );
    await page.waitForTimeout(150);
    await expect(page.locator('[data-square="e5"] img')).toHaveCount(1);
    // A late own-move acknowledgement cannot undo the faster engine response.
    state = snapshot();
    await page.reload();
    await expect(page.locator('[data-square="e2"] img')).toBeVisible();
    holdPost = {};
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect.poll(() => !!holdPost.resolve).toBe(true);
    state = snapshot(2);
    await page.evaluate(
      (data) => window.emitGame({ event: 'move', data }),
      state
    );
    holdPost.resolve();
    holdPost = null;
    await expect(page.locator('[data-square="e5"] img')).toHaveAttribute(
      'src',
      '/pieces/black-pawn.png'
    );
    await expect(page.locator('[data-square="g1"]')).toHaveAttribute(
      'aria-disabled',
      'false'
    );
    // Reconnect resyncs an opponent move missed while disconnected.
    state = snapshot();
    await page.reload();
    await expect(page.locator('[data-square="e2"] img')).toBeVisible();
    await page.evaluate(() => window.streams.at(-1).onerror());
    await expect(page.getByRole('status')).toContainText('Reconnecting');
    state = snapshot(2);
    await page.evaluate(() => window.streams.at(-1).onopen());
    await expect(page.locator('[data-square="e5"] img')).toBeVisible();
    // Rejected optimistic moves restore the authoritative board.
    state = snapshot();
    rejectMove = true;
    await page.reload();
    await expect(page.locator('[data-square="e2"] img')).toBeVisible();
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(page.getByRole('status')).toContainText('Move rejected');
    await expect(page.locator('[data-square="e2"] img')).toHaveAttribute(
      'src',
      '/pieces/white-pawn.png'
    );
    const idleReads = reads;
    await page.waitForTimeout(2200);
    assert.equal(reads, idleReads, 'no continuous GET polling');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${width}px: load retry, background failure, stale GET/POST, reconnect, rollback, no idle polling passed`
    );
  }
  const context = await browser.newContext();
  let creates = 0;
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/login/session')
      return route.fulfill({ json: { id: 901, username: 'Maya' } });
    if (path === '/api/health')
      return route.fulfill({ json: { status: 'ok', stockfish: true } });
    if (route.request().method() === 'POST') creates++;
    return route.fulfill({ json: { rooms: [] } });
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: /Play a friend/ }).click();
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(
    page.getByText(/Timed games are temporarily unavailable/)
  ).toBeVisible();
  assert.equal(
    creates,
    0,
    'an outdated API must not silently create an untimed new game'
  );
  await context.close();
  console.log('Old backend detected before creating a new match');
} finally {
  await browser.close();
}
