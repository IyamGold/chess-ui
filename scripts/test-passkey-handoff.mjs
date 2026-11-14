// Real local Login + Chess services, synthetic accounts, virtual passkeys only.
// Never point the fixture DB at a real account database.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
const fixturePath = process.env.CHESS_TEST_LOGIN_DB;
assert.ok(
  fixturePath &&
    resolve(fixturePath).startsWith(
      join(tmpdir(), 'chess-passkey-validation-')
    ) &&
    basename(fixturePath) === 'login.sqlite',
  'Use a dedicated /tmp/chess-passkey-validation-*/login.sqlite synthetic fixture'
);
const db = new DatabaseSync(fixturePath);
const browser = await chromium.launch({
  executablePath: process.env.CHESS_CHROMIUM_EXECUTABLE,
  headless: true,
});
const base = 'http://localhost:5190',
  login = 'http://localhost:5180';
const chessIds = new Set();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: 900 },
      }),
      page = await context.newPage();
    await page.addInitScript(() => {
      PublicKeyCredential.isConditionalMediationAvailable = async () => false;
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send(
      'WebAuthn.addVirtualAuthenticator',
      {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
          hasPrf: false,
        },
      }
    );
    let authentications = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/login/verify')
        authentications++;
    });
    await page.goto(base);
    const continueLink = () =>
      page.getByRole('link', { name: 'Continue with Login', exact: true });
    await expect(continueLink()).toHaveAttribute(
      'href',
      '/api/login/start?fresh=1'
    );
    await continueLink().click();
    await expect(
      page.getByRole('heading', { name: 'Confirm it’s you', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign in with passkey', exact: true })
    ).toBeVisible();
    const email = `chess-fresh-${width}-${Date.now()}@example.com`;
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    let code;
    await expect
      .poll(async () => {
        const outbox = await (
          await page.request.get(login + '/api/dev/outbox')
        ).json();
        code = outbox.emails
          .find((entry) => entry.to === email)
          ?.subject.match(/\d{6}/)?.[0];
        return !!code;
      })
      .toBe(true);
    await page.getByLabel('6-digit code').fill(code);
    await page
      .getByRole('button', { name: 'Allow and continue', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Your Login account', exact: true })
    ).toBeVisible();
    const original = await (
      await page.request.get(base + '/api/login/session')
    ).json();
    assert.ok(Number.isSafeInteger(original.id));
    assert.ok(
      !chessIds.has(original.id),
      'different Login users must have distinct Chess profiles'
    );
    chessIds.add(original.id);
    assert.ok(!('email' in original));
    await expect(page.locator('.player-card .verification-label')).toHaveText(
      'Not verified'
    );
    await page.getByRole('button', { name: 'My account', exact: true }).click();
    await page.getByText('Edit player name', { exact: true }).click();
    const name = `chess-${width}-${Date.now().toString(36)}`;
    await page.getByLabel('Player name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(page.getByText('Name saved.', { exact: true })).toBeVisible();
    const user = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    assert.ok(user);
    const setLevel = (level) =>
      db
        .prepare(
          'INSERT INTO kyc_status(user_id,level,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET level=excluded.level,updated_at=excluded.updated_at'
        )
        .run(user.id, level, Date.now());
    setLevel('L1');
    const logout = async () => {
      const response = await page.request.post(base + '/api/login/logout', {
        headers: { Origin: base },
        data: {},
      });
      assert.equal(response.status(), 200);
      await page.goto(base + '/login');
      await expect(continueLink()).toBeVisible();
    };
    await logout();
    assert.equal(
      (await page.request.get(login + '/api/me')).status(),
      200,
      'Login still remembers its session'
    );
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId,
      enabled: false,
    });
    await continueLink().click();
    await expect(
      page.getByRole('heading', { name: 'Confirm it’s you', exact: true })
    ).toBeVisible();
    assert.equal(
      (await page.request.get(base + '/api/login/session')).status(),
      401,
      'remembered Login must not silently create a Chess session'
    );
    const interaction = new URL(page.url()).searchParams.get('interaction');
    assert.ok(interaction);
    const premature = await page.request.get(
      login + `/oidc/interaction/${interaction}/complete`
    );
    assert.equal(
      premature.status(),
      401,
      'old authentication must not complete a fresh request'
    );
    await page
      .getByRole('button', {
        name: 'Cancel and go back to the app',
        exact: true,
      })
      .click();
    await expect(continueLink()).toBeVisible();
    assert.equal(
      (await page.request.get(base + '/api/login/session')).status(),
      401
    );
    for (const level of ['L1', 'L2']) {
      setLevel(level);
      await continueLink().click();
      await expect(
        page.getByRole('heading', { name: 'Confirm it’s you', exact: true })
      ).toBeVisible();
      await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
        authenticatorId,
        enabled: true,
      });
      const before = authentications;
      await page
        .getByRole('button', { name: 'Sign in with passkey', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Your Login account', exact: true })
      ).toBeVisible();
      assert.ok(
        authentications > before,
        'a new actual passkey authentication occurred'
      );
      const profile = await (
        await page.request.get(base + '/api/login/session')
      ).json();
      assert.equal(profile.id, original.id);
      assert.equal(profile.username, name);
      assert.equal(profile.kyc_level, level);
      assert.ok(!('email' in profile));
      await expect(page.locator('.player-card .verification-label')).toHaveText(
        level === 'L1' ? 'L1 possibly human' : 'L2 verified human'
      );
      await expect(page.locator('.player-card')).not.toContainText(email);
      if (level === 'L1') await logout();
    }
    await context.close();
    console.log(
      `PASS ${width}px: signup, real fresh passkey, remembered-session refusal, cancellation, stable Chess account/name, private email and L1/L2`
    );
  }
} finally {
  await browser.close();
  db.close();
}
