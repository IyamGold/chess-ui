// Synthetic users and virtual passkeys only. Start Login and Chess before running.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: process.env.CHESS_CHROMIUM_EXECUTABLE,
  headless: true,
  args: ['--no-sandbox'],
});
const base = 'http://localhost:5190';
async function signup(label) {
  const context = await browser.newContext(),
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
  await page.getByRole('link', { name: 'Continue with Login', exact: true }).click();
  const email = `chess-${label}-${Date.now()}@example.com`;
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const outbox = await (await page.request.get('http://localhost:5180/api/dev/outbox')).json();
  const code = outbox.emails.find((e) => e.to === email)?.subject.match(/\d{6}/)?.[0];
  assert.ok(code);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.getByRole('button', { name: 'Allow and continue' }).click();
  await page.getByRole('heading', { name: 'Your Login account', exact: true }).waitFor();
  return page;
}
const post = (page, path, data) =>
  page.request.post(base + path, { headers: { Origin: base }, data });
async function move(page, from, to) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"].valid-move`).waitFor();
  await page.locator(`[data-square="${to}"]`).click();
}
try {
  // Regression: a static host's SPA fallback is not a working sign-in backend.
  const offline = await browser.newContext();
  await offline.route('**/api/login/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html>Chess SPA</html>',
    }),
  );
  const offlinePage = await offline.newPage();
  await offlinePage.goto(base + '/login');
  await offlinePage
    .getByRole('alert')
    .filter({ hasText: 'Sign-in is temporarily unavailable' })
    .waitFor();
  assert.equal(
    await offlinePage.getByRole('link', { name: 'Continue with Login', exact: true }).count(),
    0,
  );
  await offline.unroute('**/api/login/session');
  await offlinePage.getByRole('button', { name: 'Try again', exact: true }).click();
  await offlinePage.getByRole('link', { name: 'Continue with Login', exact: true }).waitFor();
  await offline.close();
  const a = await signup('white'),
    b = await signup('black');
  const profile = await (await a.request.get(base + '/api/login/session')).json();
  assert.ok(profile.username);
  assert.ok(!('verified_human' in profile));
  assert.equal(
    (
      await a.request.post(base + '/api/rooms', {
        headers: { Origin: 'http://evil.invalid' },
        data: { color: 'white', opponent: 'human' },
      })
    ).status(),
    403,
  );
  const create = await post(a, '/api/rooms', { color: 'white', opponent: 'human' });
  assert.equal(create.status(), 201);
  const room = await create.json();
  assert.equal((await post(b, '/api/rooms/join', { inviteCode: room.inviteCode })).status(), 200);
  await Promise.all([a.goto(base + `/game/${room.roomId}`), b.goto(base + `/game/${room.roomId}`)]);
  await move(a, 'e2', 'e4');
  await move(b, 'e7', 'e5');
  await a.reload(); // Resume an active game with the same HttpOnly session.
  await a.locator('[data-square="f1"]').waitFor();
  await move(a, 'f1', 'c4');
  await move(b, 'b8', 'c6');
  await move(a, 'd1', 'h5');
  await move(b, 'g8', 'f6');
  await move(a, 'h5', 'f7');
  await a.getByText('White wins!', { exact: false }).waitFor();
  assert.equal(
    (await (await b.request.get(base + `/api/rooms/${room.roomId}`)).json()).result,
    '1-0',
  );
  await b.reload();
  await b.getByText('White wins!', { exact: false }).waitFor();
  const second = await (await post(a, '/api/rooms', { color: 'white', opponent: 'human' })).json();
  await post(b, '/api/rooms/join', { inviteCode: second.inviteCode });
  assert.equal(
    (await post(a, `/api/rooms/${second.roomId}/draw`, { action: 'offer' })).status(),
    200,
  );
  assert.equal(
    (await post(a, `/api/rooms/${second.roomId}/draw`, { action: 'accept' })).status(),
    409,
  );
  assert.equal(
    (await post(b, `/api/rooms/${second.roomId}/draw`, { action: 'accept' })).status(),
    200,
  );
  const ai = await (await post(a, '/api/rooms', { color: 'white', opponent: 'stockfish' })).json();
  await post(a, `/api/rooms/${ai.roomId}/move`, { move: 'e2e4' });
  let count = 0;
  for (let i = 0; i < 30; i++) {
    count = (await (await a.request.get(base + `/api/rooms/${ai.roomId}`)).json()).moveHistory
      .length;
    if (count >= 2) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(count >= 2, 'Stockfish must reply');
  await post(a, '/api/login/logout', {});
  assert.equal((await a.request.get(base + '/api/rooms')).status(), 401);
  assert.ok(await b.evaluate(() => !localStorage.getItem('server_auth_token')));
  console.log(
    'PASS: API-misrouting recovery, Login/passkeys, optional KYC, cookie auth, Origin rejection, two-player UI checkmate, reload, draw agreement, Stockfish and logout.',
  );
} finally {
  await browser.close();
}
