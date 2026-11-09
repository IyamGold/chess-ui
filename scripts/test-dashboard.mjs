// Run with Vite on localhost:5190. All profiles, rooms and saved games are synthetic.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INITIAL_BOARD } from '../src/constants.js';
const base = 'http://localhost:5190';
const output =
  process.env.CHESS_PREVIEW_DIR || join(tmpdir(), 'chess-dashboard-previews');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHESS_CHROMIUM_EXECUTABLE,
  headless: true,
});
const timestamp = '2026-11-09T10:00:00Z';
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
    ['small-mobile', 320, 740],
    ['tablet', 768, 1024],
    ['landscape', 844, 390],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width <= 760,
      reducedMotion: 'reduce',
    });
    let profile = {
      id: 901,
      username: 'maya',
      loginOrigin: 'https://demo.withlogin.com',
      verified_human: true,
      verification_sandbox: true,
    };
    let rooms = [];
    let failedList = false;
    let joins = 0;
    let logouts = 0;
    let logoutFails = true;
    const room = (id, status = 'playing', color = 'black') => ({
      roomId: id,
      board: INITIAL_BOARD,
      status,
      myColor: color,
      currentTurn: 'white',
      legalMoves: ['e2e3', 'e2e4'],
      moveHistory: [],
      moveCount: 0,
      white: 'alex',
      black: 'maya',
      inviteCode: 'ROOK42',
      updatedAt: timestamp,
    });
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (path === '/api/login/session')
        return profile
          ? route.fulfill({ json: profile })
          : route.fulfill({ status: 401, json: { error: 'signed-out' } });
      if (path === '/api/login/logout') {
        logouts++;
        if (logoutFails)
          return route.fulfill({ status: 503, json: { error: 'try-again' } });
        profile = null;
        return route.fulfill({ json: { ok: true } });
      }
      if (path === '/api/login/profile') {
        const data = request.postDataJSON();
        assert.equal(data.username, 'MayaMoves');
        profile = { ...profile, username: data.username };
        return route.fulfill({ json: { ok: true } });
      }
      if (path === '/api/rooms' && request.method() === 'GET')
        return failedList
          ? route.fulfill({
              status: 503,
              json: { error: 'temporarily-unavailable' },
            })
          : route.fulfill({ json: { rooms } });
      if (path === '/api/rooms' && request.method() === 'POST') {
        assert.deepEqual(request.postDataJSON(), {
          color: 'black',
          opponent: 'human',
        });
        rooms.push(room(812, 'waiting'));
        return route.fulfill({
          status: 201,
          json: { roomId: 812, inviteCode: 'ROOK42' },
        });
      }
      if (path === '/api/rooms/join') {
        joins++;
        const data = request.postDataJSON();
        if (data.inviteCode !== 'ROOK42')
          return route.fulfill({
            status: 404,
            json: { error: 'Invite code not found' },
          });
        rooms.push(room(902));
        return route.fulfill({ json: { roomId: 902, color: 'black' } });
      }
      const match = /^\/api\/rooms\/(\d+)$/.exec(path);
      if (match)
        return route.fulfill({
          json: room(
            Number(match[1]),
            match[1] === '812' ? 'waiting' : 'playing'
          ),
        });
      return route.fulfill({ status: 404, json: { error: 'not-found' } });
    });
    const page = await context.newPage();
    await page.routeWebSocket('**/api/rooms/*/ws', () => {});
    const backToGames = async () => {
      if (
        await page
          .getByRole('button', { name: 'Open game menu', exact: true })
          .isVisible()
      ) {
        await page
          .getByRole('button', { name: 'Open game menu', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Back to Games', exact: true })
          .click();
      } else
        await page
          .getByRole('button', { name: 'Chess home', exact: true })
          .click();
    };
    await page.goto(base);
    await page
      .getByText('Your first move is waiting.', { exact: true })
      .waitFor();
    await page.locator('.lobby-hero img').evaluate((image) => image.decode());
    const headline = await page.locator('#lobby-title').evaluate((element) => ({
      color: getComputedStyle(element).color,
      size: parseFloat(getComputedStyle(element).fontSize),
    }));
    assert.equal(headline.color, 'rgb(255, 255, 255)');
    assert.ok(headline.size >= 30, `${name}: headline styling was overridden`);
    assert.equal(
      await page
        .locator('.chess-app')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      'rgb(0, 0, 0)'
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      `${name}: lobby horizontal overflow`
    );
    if (width <= 760) {
      await expect(page.locator('.chess-topbar')).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'My games', exact: true })
      ).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'My account', exact: true })
      ).toBeVisible();
      assert.equal(
        await page
          .locator('.chess-navigation')
          .evaluate((el) => getComputedStyle(el).borderBottomWidth),
        '0px'
      );
      const red = await page
        .locator('.mobile-logout')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.equal(red, 'rgb(229, 29, 54)');
    }
    assert.match(
      await page
        .locator('.chess-app')
        .evaluate((el) => getComputedStyle(el).fontFamily),
      /DM Sans/
    );
    await page.screenshot({
      path: join(output, `${name}.png`),
      fullPage: true,
    });

    await page.getByRole('button', { name: /Play a friend/ }).click();
    await expect(
      page.getByRole('button', { name: 'Friend online', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Black', exact: true }).click();
    await page.getByRole('button', { name: 'Start Game', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Waiting for Opponent', exact: true })
      .waitFor();
    await expect(page.getByText('ROOK42', { exact: true })).toBeVisible();
    await backToGames();
    await page.getByRole('button', { name: /Have an invite code/ }).click();
    await page.getByLabel('Invite Code', { exact: true }).fill('wrong');
    await page.getByLabel('Invite Code', { exact: true }).press('Enter');
    await expect(page.getByRole('alert')).toContainText(
      'Invite code not found'
    );
    await page.getByLabel('Invite Code', { exact: true }).fill('rook42');
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await page
      .getByRole('group', { name: 'Chess board', exact: true })
      .waitFor();
    assert.equal(joins, 2, 'Each join submission should run once');
    const board = await page.locator('.chessboard').boundingBox();
    assert.ok(
      board.x >= 0 && board.x + board.width <= width,
      `${name}: board exceeds viewport`
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      `${name}: board horizontal overflow`
    );
    await expect(page.locator('.chessboard .square')).toHaveCount(64);
    assert.ok(
      Math.abs(board.width - board.height) < 2,
      'Board must remain square'
    );
    await expect(page.locator('.match-player')).toHaveCount(2);
    await expect(page.getByText('Untimed', { exact: true })).toHaveCount(2);
    await expect(page.locator('.match-player--you')).toContainText('maya');
    await expect(page.locator('.match-player--you')).toContainText(
      'Black pieces'
    );
    await expect(page.locator('.chessboard .square').first()).toHaveAttribute(
      'data-square',
      'h1'
    );
    await expect(page.locator('.board-coordinate.file')).toHaveText([
      'h',
      'g',
      'f',
      'e',
      'd',
      'c',
      'b',
      'a',
    ]);
    await expect(
      page.getByRole('link', { name: 'Login wallet', exact: true })
    ).toHaveAttribute('href', 'https://demo.withlogin.com/');
    await page.screenshot({
      path: join(output, `${name}-board.png`),
      fullPage: true,
    });
    const menu = page.getByRole('button', {
      name: 'Open game menu',
      exact: true,
    });
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await page.getByRole('button', { name: 'My account', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByText('Edit player name', { exact: true }).click();
    await page.getByLabel('Player name', { exact: true }).fill('MayaMoves');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText(
      'Name saved.'
    );
    await expect(
      page.getByRole('dialog').getByText('MayaMoves', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Send a private tip/ })
    ).toHaveAttribute('href', 'https://demo.withlogin.com/#transfer-h');
    await expect(
      page.getByRole('link', { name: 'Refresh verification', exact: true })
    ).toHaveAttribute('href', '/api/login/start?fresh=1');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Open game menu', exact: true })
    ).toBeFocused();
    rooms.push({ ...room(903, 'finished'), result: '1-0', moveCount: 24 });
    await page.evaluate(
      ({ timestamp, board }) => {
        localStorage.setItem(
          'chess_901_index',
          JSON.stringify([
            {
              id: 'sample-local',
              result: '*',
              moveCount: 0,
              engineColor: 'black',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ])
        );
        localStorage.setItem(
          'chess_901_game_sample-local',
          JSON.stringify({
            id: 'sample-local',
            board,
            currentTurn: 'white',
            engineColor: 'black',
            result: '*',
            createdAt: timestamp,
            updatedAt: timestamp,
            moveHistory: [],
            enPassantTarget: null,
            movedPieces: [],
            halfMoveClock: 0,
            positionHistory: [],
          })
        );
      },
      { timestamp, board: INITIAL_BOARD }
    );
    await backToGames();
    await expect(page.locator('.game-card')).toHaveCount(4);
    await page.getByRole('button', { name: 'Finished', exact: true }).click();
    await expect(page.locator('.game-card')).toHaveCount(1);
    await page
      .getByRole('button', { name: 'In progress', exact: true })
      .click();
    await expect(page.locator('.game-card')).toHaveCount(3);
    await page.getByRole('button', { name: 'All games', exact: true }).click();
    await expect(page.locator('.game-card')).toHaveCount(4);
    if (name === 'desktop') {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: join(output, 'desktop-with-games.png'),
        fullPage: true,
      });
    }
    await page
      .getByRole('button', {
        name: 'Open saved game sample-local',
        exact: true,
      })
      .click();
    await page
      .getByRole('group', { name: 'Chess board', exact: true })
      .waitFor();
    await expect(page.locator('.match-player--opponent')).toContainText(
      'Stockfish'
    );
    await expect(page.locator('.match-player--you')).toContainText('MayaMoves');
    await page.locator('[data-square="e2"]').click();
    await expect(page.locator('[data-square="e4"]')).toHaveClass(/valid-move/);
    await page.locator('[data-square="e4"]').click();
    await expect(page.locator('[data-square="e2"] img')).toHaveCount(0);
    await expect(page.locator('[data-square="e4"] img')).toHaveCount(1);
    await backToGames();
    await page
      .getByRole('button', {
        name: 'Delete saved game sample-local',
        exact: true,
      })
      .click();
    await expect(page.locator('.game-card')).toHaveCount(3);

    // Failed list loads must not be presented as an empty history.
    failedList = true;
    await page.getByRole('button', { name: /Play the computer/ }).click();
    await expect(
      page.getByRole('button', { name: 'Computer (Stockfish)', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Your online games couldn’t load'
    );
    failedList = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.locator('.game-card')).toHaveCount(3);
    await expect(page.getByRole('alert')).toHaveCount(0);
    profile = {
      id: 901,
      username: 'MayaMoves',
      loginOrigin: 'https://demo.withlogin.com',
    };
    await page.reload();
    await expect(
      page.getByText('Verification optional', { exact: true })
    ).toBeVisible();
    await expect(page.getByText('Verified human', { exact: true })).toHaveCount(
      0
    );
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not sign out');
    await expect(
      page.getByText('Verification optional', { exact: true })
    ).toBeVisible();
    logoutFails = false;
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    assert.equal(logouts, 2);
    await context.close();
  }
  console.log(
    'PASS: dark desktop/mobile dashboard and focused gameplay, navigation, computer/friend setup, join validation, waiting room, responsive boards, profile updates, wallet links, resume/delete/filter games, failed-list recovery and optional KYC.'
  );
} finally {
  await browser.close();
}
