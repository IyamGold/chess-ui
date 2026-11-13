// Run with Vite on localhost:5190 (npm run dev or npm run dev:demo).
// Local visual/state checks. Synthetic API responses only; no identity-provider requests.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = 'http://localhost:5190';
const output = process.env.CHESS_PREVIEW_DIR || join(tmpdir(), 'chess-login-page-previews');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHESS_CHROMIUM_EXECUTABLE,
  headless: true,
});
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['mobile', 390, 844],
    ['small-mobile', 320, 568],
    ['tablet', 768, 1024],
    ['landscape', 844, 390],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width <= 760,
    });
    await context.route('**/api/login/session', (route) =>
      route.fulfill({ status: 401, json: { error: 'signed-out' } }),
    );
    const page = await context.newPage();
    await page.goto(base + '/login');
    const link = page.getByRole('link', { name: 'Continue with Login', exact: true });
    await expect(link).toHaveAttribute('href', '/api/login/start?fresh=1');
    await page.locator('.welcome-art img').evaluate((image) => image.decode());
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${name}: horizontal overflow`,
    );
    const box = await link.boundingBox();
    assert.ok(
      box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width,
      `${name}: action target sizing`,
    );
    // Short screens may scroll; the primary action must remain reachable and uncovered.
    await link.scrollIntoViewIfNeeded();
    assert.ok(
      await link.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return target?.closest('a') === element;
      }),
      `${name}: decorative art blocks the sign-in link`,
    );
    if (width === 390 || width === 1440) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    }
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let mode = 'loading';
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await context.route('**/api/login/session', async (route) => {
    if (mode === 'loading') await pending;
    if (mode === 'offline')
      return route.fulfill({ status: 502, contentType: 'text/html', body: 'Bad gateway' });
    return route.fulfill({ status: 401, json: { error: 'signed-out' } });
  });
  const page = await context.newPage();
  await page.goto(base + '/login');
  await expect(page.getByRole('button', { name: 'Checking session…', exact: true })).toBeDisabled();
  mode = 'offline';
  release();
  await expect(page.getByRole('alert')).toContainText('Sign-in is temporarily unavailable');
  await expect(page.getByRole('link', { name: 'Continue with Login', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${output}/unavailable.png`, fullPage: true });
  mode = 'ready';
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Continue with Login', exact: true })).toBeVisible();
  await page.goto(base + '/login?error=cancelled');
  await expect(page.getByRole('alert')).toContainText('Sign-in didn’t finish');
  await expect(page.getByRole('link', { name: 'Continue with Login', exact: true })).toBeVisible();
  await context.close();
  console.log(
    'PASS: desktop/mobile/tablet layout, touch targets, unobstructed Login link, loading, unavailable/retry recovery and cancelled sign-in.',
  );
} finally {
  await browser.close();
}
