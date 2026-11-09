// Synthetic users and virtual passkeys only. Start Login and Chess before running.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: process.env.CHESS_CHROMIUM_EXECUTABLE,
  headless: true,
  args: ['--no-sandbox'],
});
const base = 'http://localhost:5190';
async function signup(label, contextOptions = {}) {
  const context = await browser.newContext(contextOptions),
    page = await context.newPage();
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = async () => false;
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: false,
    },
  });
  await page.goto(base);
  await page
    .getByRole('link', { name: 'Continue with Login', exact: true })
    .click();
  const email = `chess-${label}-${Date.now()}@example.com`;
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const outbox = await (
    await page.request.get('http://localhost:5180/api/dev/outbox')
  ).json();
  const code = outbox.emails
    .find((e) => e.to === email)
    ?.subject.match(/\d{6}/)?.[0];
  assert.ok(code);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.getByRole('button', { name: 'Allow and continue' }).click();
  await page
    .getByRole('heading', { name: 'Your Login account', exact: true })
    .waitFor();
  return page;
}
const post = (page, path, data) =>
  page.request.post(base + path, { headers: { Origin: base }, data });
async function move(page, from, to) {
  const source = page.locator(`[data-square="${from}"]`);
  const target = page.locator(`[data-square="${to}"]`);
  await expect(source).toHaveAttribute('aria-disabled', 'false');
  await source.click();
  await expect(source).toHaveAttribute('aria-pressed', 'true');
  await expect(target).toHaveClass(/valid-move/);
  await target.click();
  await expect(source).toHaveAttribute('aria-pressed', 'false');
}
try {
  // Regression: a static host's SPA fallback is not a working sign-in backend.
  const offline = await browser.newContext();
  await offline.route('**/api/login/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html>Chess SPA</html>',
    })
  );
  const offlinePage = await offline.newPage();
  await offlinePage.goto(base + '/login');
  await offlinePage
    .getByRole('alert')
    .filter({ hasText: 'Sign-in is temporarily unavailable' })
    .waitFor();
  assert.equal(
    await offlinePage
      .getByRole('link', { name: 'Continue with Login', exact: true })
      .count(),
    0
  );
  await offline.unroute('**/api/login/session');
  await offlinePage
    .getByRole('button', { name: 'Try again', exact: true })
    .click();
  await offlinePage
    .getByRole('link', { name: 'Continue with Login', exact: true })
    .waitFor();
  await offline.close();
  const a = await signup('white'),
    b = await signup('black', { hasTouch: true });
  const profile = await (
    await a.request.get(base + '/api/login/session')
  ).json();
  assert.ok(profile.username);
  assert.ok(!('verified_human' in profile));
  assert.equal(
    (
      await a.request.post(base + '/api/rooms', {
        headers: { Origin: 'http://evil.invalid' },
        data: { color: 'white', opponent: 'human' },
      })
    ).status(),
    403
  );
  const create = await post(a, '/api/rooms', {
    color: 'white',
    opponent: 'human',
  });
  assert.equal(create.status(), 201);
  const room = await create.json();
  assert.equal(
    (
      await post(b, '/api/rooms/join', { inviteCode: room.inviteCode })
    ).status(),
    200
  );
  await Promise.all([
    a.goto(base + `/game/${room.roomId}`),
    b.goto(base + `/game/${room.roomId}`),
  ]);
  const square = (page, name) => page.locator(`[data-square="${name}"]`);
  // A single click selects, another own piece switches, and a repeat/empty click clears.
  await square(a, 'e7').click();
  await expect(a.locator('.square.valid-move')).toHaveCount(0);
  await square(a, 'e2').click();
  await expect(square(a, 'e2')).toHaveAttribute('aria-pressed', 'true');
  await expect(square(a, 'e3')).toHaveClass(/valid-move/);
  await expect(square(a, 'e4')).toHaveClass(/valid-move/);
  await square(a, 'g1').click();
  await expect(square(a, 'g1')).toHaveAttribute('aria-pressed', 'true');
  await expect(square(a, 'f3')).toHaveClass(/valid-move/);
  await expect(square(a, 'e4')).not.toHaveClass(/valid-move/);
  await square(a, 'g1').click();
  await expect(a.locator('.square.valid-move')).toHaveCount(0);
  await square(a, 'e2').click();
  await square(a, 'e5').click();
  await expect(a.locator('.square.valid-move')).toHaveCount(0);

  await square(a, 'e2').click();
  assert.ok(
    await a
      .locator('.chessboard img')
      .evaluateAll((images) => images.every((image) => !image.draggable))
  );
  await a.evaluate(() => {
    window.__boardDragStarts = 0;
    document.addEventListener('dragstart', () => window.__boardDragStarts++);
  });
  const sourceBox = await square(a, 'e2').boundingBox();
  const targetBox = await square(a, 'e4').boundingBox();
  await a.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await a.mouse.down();
  await a.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    {
      steps: 8,
    }
  );
  await a.mouse.up();
  assert.equal(await a.evaluate(() => window.__boardDragStarts), 0);
  assert.equal(
    (await (await a.request.get(base + `/api/rooms/${room.roomId}`)).json())
      .moveHistory.length,
    0
  );
  await expect(square(a, 'e2').locator('img')).toHaveAttribute(
    'alt',
    'White Pawn'
  );
  await square(a, 'e2').click(); // Clear before checking native keyboard activation.
  await square(a, 'e2').focus();
  await a.keyboard.press('Space');
  await expect(square(a, 'e4')).toHaveClass(/valid-move/);
  await square(a, 'e4').focus();
  await a.keyboard.press('Enter');
  await expect(square(a, 'e4').locator('img')).toHaveAttribute(
    'alt',
    'White Pawn'
  );
  await square(a, 'd2').click({ force: true }); // Explicitly attempt a disabled turn; it must be ignored.
  await expect(a.locator('.square.valid-move')).toHaveCount(0);

  // Black's flipped board also moves with two taps, without a long press.
  await expect(square(b, 'e7')).toHaveAttribute('aria-disabled', 'false');
  await square(b, 'e7').tap();
  await expect(square(b, 'e7')).toHaveAttribute('aria-pressed', 'true');
  await expect(square(b, 'e5')).toHaveClass(/valid-move/);
  await square(b, 'e5').tap();
  await expect(square(b, 'e5').locator('img')).toHaveAttribute(
    'alt',
    'Black Pawn'
  );
  await a.reload(); // Resume an active game with the same HttpOnly session.
  await a.locator('[data-square="f1"]').waitFor();
  await move(a, 'f1', 'c4');
  await move(b, 'b8', 'c6');
  await move(a, 'd1', 'h5');
  await move(b, 'g8', 'f6');
  await move(a, 'h5', 'f7');
  await a.getByText('White wins!', { exact: false }).waitFor();
  assert.equal(
    (await (await b.request.get(base + `/api/rooms/${room.roomId}`)).json())
      .result,
    '1-0'
  );
  await b.reload();
  await b.getByText('White wins!', { exact: false }).waitFor();
  await expect(b.locator('.match-player .turn-dot')).toHaveCount(0);
  await expect(b.getByText(/pieces · Game finished/)).toHaveCount(2);
  const second = await (
    await post(a, '/api/rooms', { color: 'white', opponent: 'human' })
  ).json();
  await post(b, '/api/rooms/join', { inviteCode: second.inviteCode });
  await Promise.all([
    a.goto(base + `/game/${second.roomId}`),
    b.goto(base + `/game/${second.roomId}`),
  ]);
  await a.getByRole('button', { name: 'Offer draw', exact: true }).click();
  assert.equal(
    (
      await post(a, `/api/rooms/${second.roomId}/draw`, { action: 'accept' })
    ).status(),
    409
  );
  await b.getByRole('button', { name: 'Accept draw', exact: true }).click();
  await a.getByText('Draw!', { exact: true }).waitFor();
  await b.getByText('Draw!', { exact: true }).waitFor();
  const ai = await (
    await post(a, '/api/rooms', { color: 'white', opponent: 'stockfish' })
  ).json();
  await post(a, `/api/rooms/${ai.roomId}/move`, { move: 'e2e4' });
  let count = 0;
  for (let i = 0; i < 30; i++) {
    count = (
      await (await a.request.get(base + `/api/rooms/${ai.roomId}`)).json()
    ).moveHistory.length;
    if (count >= 2) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(count >= 2, 'Stockfish must reply');
  await a.goto(base + `/game/${ai.roomId}`);
  a.once('dialog', (dialog) => dialog.dismiss());
  await a.getByRole('button', { name: 'Resign', exact: true }).click();
  assert.equal(
    (await (await a.request.get(base + `/api/rooms/${ai.roomId}`)).json())
      .status,
    'playing'
  );
  a.once('dialog', (dialog) => dialog.accept());
  await a.getByRole('button', { name: 'Resign', exact: true }).click();
  await a.getByText('Black wins!', { exact: true }).waitFor();
  await expect(
    a.getByRole('button', { name: 'Resign', exact: true })
  ).toHaveCount(0);
  // Reach promotion using legal API moves, then exercise the two-click UI and choice.
  const promotion = await (
    await post(a, '/api/rooms', { color: 'white', opponent: 'human' })
  ).json();
  await post(b, '/api/rooms/join', { inviteCode: promotion.inviteCode });
  for (const [player, uci] of [
    [a, 'a2a4'],
    [b, 'h7h5'],
    [a, 'a4a5'],
    [b, 'h5h4'],
    [a, 'a5a6'],
    [b, 'h4h3'],
    [a, 'a6b7'],
    [b, 'h3g2'],
  ]) {
    assert.equal(
      (
        await post(player, `/api/rooms/${promotion.roomId}/move`, { move: uci })
      ).status(),
      200
    );
  }
  await a.goto(base + `/game/${promotion.roomId}`);
  await square(a, 'b7').click();
  await expect(square(a, 'a8')).toHaveClass(/valid-move/);
  await square(a, 'a8').click();
  await a
    .getByRole('button', { name: 'Promote to Knight', exact: true })
    .waitFor();
  assert.equal(
    (
      await (
        await a.request.get(base + `/api/rooms/${promotion.roomId}`)
      ).json()
    ).moveHistory.length,
    8
  );
  await a
    .getByRole('button', { name: 'Promote to Knight', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await a.request.get(base + `/api/rooms/${promotion.roomId}`)
          ).json()
        ).board[0]
    )
    .toBe(3);

  // New timed Stockfish matches use the same two-click interaction.
  await a.goto(base);
  await a.getByRole('button', { name: '+ New Game', exact: true }).click();
  await a.getByRole('button', { name: 'Start Game', exact: true }).click();
  await square(a, 'e2').click();
  await expect(square(a, 'e2')).toHaveAttribute('aria-pressed', 'true');
  await expect(square(a, 'e4')).toHaveClass(/valid-move/);
  await square(a, 'e4').click();
  await expect(square(a, 'e4').locator('img')).toHaveAttribute(
    'alt',
    'White Pawn'
  );
  await expect(square(a, 'e2')).toHaveAttribute('aria-pressed', 'false');

  await a.getByRole('button', { name: 'Open game menu', exact: true }).click();
  await a.getByRole('button', { name: 'Back to Games', exact: true }).click();
  await a.getByRole('button', { name: '+ New Game', exact: true }).click();
  await a.getByRole('button', { name: 'Black', exact: true }).click();
  await a.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(a.locator('.chessboard .square').first()).toHaveAttribute(
    'data-square',
    'h1'
  );
  await expect(a.locator('.match-player--you')).toContainText('Black pieces');
  await expect(a.locator('.match-player--you .turn-dot')).toBeVisible({
    timeout: 20000,
  });
  await square(a, 'e7').click();
  await expect(square(a, 'e5')).toHaveClass(/valid-move/);
  await square(a, 'e5').click();
  await expect(square(a, 'e5').locator('img')).toHaveAttribute(
    'alt',
    'Black Pawn'
  );
  await a.getByRole('button', { name: 'Open game menu', exact: true }).click();
  await a.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(a).toHaveURL(/\/login/);
  assert.equal((await a.request.get(base + '/api/rooms')).status(), 401);
  assert.ok(await b.evaluate(() => !localStorage.getItem('server_auth_token')));
  console.log(
    'PASS: API-misrouting recovery, Login/passkeys, optional KYC, cookie auth, Origin rejection, two-click mouse/touch/keyboard moves, no native drag, promotion, timed Stockfish matches in both colours, checkmate, reload, draw/resign controls, Stockfish, game menu and logout.'
  );
} finally {
  await browser.close();
}
