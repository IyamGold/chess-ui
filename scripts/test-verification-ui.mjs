import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: process.env.CHESS_CHROMIUM_EXECUTABLE,
  headless: true,
});
try {
  for (const width of [1440, 390])
    for (const [claims, label] of [
      [{}, 'Not verified'],
      [
        { verified_human: true, kyc_level: 'L1', verification_sandbox: true },
        'L1 verified',
      ],
      [
        { verified_human: true, kyc_level: 'L2', verification_sandbox: true },
        'L2 verified',
      ],
      [
        { verified_human: true, verification_sandbox: true },
        'Verified human · Level not shared',
      ],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
      });
      await context.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/login/session')
          return route.fulfill({
            json: {
              id: 901,
              username: 'Maya',
              loginOrigin: 'https://demo.withlogin.com',
              ...claims,
            },
          });
        if (path === '/api/rooms')
          return route.fulfill({ json: { rooms: [] } });
        return route.fulfill({
          status: 404,
          json: { error: 'synthetic-test' },
        });
      });
      const page = await context.newPage();
      await page.goto('http://localhost:5190');
      await page
        .getByRole('button', { name: 'My account', exact: true })
        .click();
      const dialog = page.getByRole('region', {
        name: 'Your Login account',
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.verification-label')).toHaveText(label);
      if (claims.verification_sandbox)
        await expect(
          dialog.getByText('Sandbox result, not real-world verification.')
        ).toBeVisible();
      await expect(
        dialog.getByRole('link', { name: 'Refresh verification', exact: true })
      ).toHaveAttribute('href', '/api/login/start?fresh=1');
      await context.close();
      console.log(`${width}px: ${label} passed`);
    }
} finally {
  await browser.close();
}
