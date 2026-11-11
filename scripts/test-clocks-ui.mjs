// Browser checks use synthetic game snapshots; real clock decisions are tested on the server.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { INITIAL_BOARD } from '../src/constants.js';
const out = process.env.CHESS_PREVIEW_DIR || '/tmp/chess-clock-previews';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHESS_CHROMIUM_EXECUTABLE,
  headless: true,
});
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['mobile', 390, 844],
    ['small-mobile', 320, 740],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 760,
    });
    const page = await context.newPage();
    await page.clock.install();
    await page.routeWebSocket('**/api/rooms/*/ws', () => {});
    let moved = false,
      expired = false;
    const board = [...INITIAL_BOARD];
    const snapshot = () => ({
      roomId: 71,
      white: 'Maya',
      black: 'Gold',
      myColor: 'white',
      currentTurn: moved ? 'black' : 'white',
      status: expired ? 'finished' : 'playing',
      result: expired ? '1-0' : null,
      clock: {
        whiteMs: moved ? 598500 : 600000,
        blackMs: expired ? 0 : 600000,
        running: expired ? null : moved ? 'black' : 'white',
        serverNow: Date.now(),
        timeoutColor: expired ? 'black' : null,
      },
      board,
      moveHistory: moved ? ['e2e4'] : [],
      legalMoves: moved ? ['e7e5'] : ['e2e3', 'e2e4'],
    });
    await context.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/login/session')
        return route.fulfill({
          json: {
            id: 901,
            username: 'Maya',
            loginOrigin: 'https://demo.withlogin.com',
          },
        });
      if (path === '/api/rooms/71/move') {
        assert.equal(route.request().postDataJSON().move, 'e2e4');
        moved = true;
        board[36] = board[52];
        board[52] = 0;
        return route.fulfill({
          json: { ...snapshot(), ok: true, gameOver: false },
        });
      }
      if (path === '/api/rooms/71') return route.fulfill({ json: snapshot() });
      return route.fulfill({ status: 404, json: { error: 'preview-only' } });
    });
    await page.goto('http://localhost:5190/game/71');
    await expect(page.getByText('10:00', { exact: true })).toHaveCount(2);
    await expect(page.locator('[data-square="e1"] img')).toHaveAttribute(
      'src',
      '/pieces/white-king.png'
    );
    await expect(page.locator('[data-square="d1"] img')).toHaveAttribute(
      'src',
      '/pieces/white-queen.png'
    );
    await expect(page.locator('[data-square="e8"] img')).toHaveAttribute(
      'src',
      '/pieces/black-king.png'
    );
    await expect(page.locator('[data-square="d8"] img')).toHaveAttribute(
      'src',
      '/pieces/black-queen.png'
    );
    await page
      .locator('.chessboard')
      .evaluate(async (el) =>
        Promise.all([...el.querySelectorAll('img')].map((img) => img.decode()))
      );
    await page.clock.runFor(1500);
    await expect(page.locator('.match-player--you .match-clock')).toContainText(
      '9:59'
    );
    await expect(
      page.locator('.match-player--opponent .match-clock')
    ).toContainText('10:00');
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(
      page.locator('.match-player--opponent .match-clock')
    ).toHaveClass(/active/);
    await page.clock.runFor(2000);
    await expect(
      page.locator('.match-player--opponent .match-clock')
    ).toContainText('9:58');
    await expect(page.locator('.match-player--you .match-clock')).toContainText(
      '9:59'
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    );
    await page.screenshot({
      path: out + '/' + name + '-clocks.png',
      fullPage: true,
    });
    expired = true;
    await page.clock.fastForward(600200);
    await expect(
      page.getByText('White wins on time!', { exact: true })
    ).toBeVisible();
    await expect(page.getByText('0:00', { exact: true })).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Resign', exact: true })
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText('White wins on time!', { exact: true })
    ).toBeVisible();
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await context.route('**/api/login/session', async (route) => {
    await gate;
    return route.fulfill({ status: 401, json: { error: 'signed-out' } });
  });
  const page = await context.newPage();
  await page.goto('http://localhost:5190/');
  await expect(page.getByRole('status')).toHaveText('Getting your game ready');
  await expect(page.locator('.loading-knight')).toBeVisible();
  assert.equal(
    await page
      .locator('.loading-dots i')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    'none'
  );
  await page.screenshot({ path: out + '/mobile-loader.png', fullPage: true });
  release();
  await expect(
    page.getByRole('link', { name: 'Continue with Login', exact: true })
  ).toBeVisible();
  assert.equal(
    await page
      .locator('.welcome-page')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(0, 0, 0)'
  );
  await expect(page.locator('.welcome-footer')).not.toContainText('Unaudited');
  await page.screenshot({
    path: out + '/mobile-onboarding.png',
    fullPage: true,
  });
  await context.close();
  console.log(
    'PASS: both clocks, turn switching, frozen inactive time, timeout/refetch/reload, responsive board, loader, reduced motion and dark onboarding.'
  );
} finally {
  await browser.close();
}
