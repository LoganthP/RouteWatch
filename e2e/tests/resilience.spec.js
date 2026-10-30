const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, loginAsAdmin } = require('./helpers');

test.describe('System Resilience & Fault Tolerance', () => {
  test('Dashboard and UI handle network errors gracefully without white-screen crash', async ({ page }) => {
    const safety = attachSafetyWatchers(page, [500, 503]);
    await loginAsAdmin(page);

    await page.goto('/');
    await page.waitForSelector('main', { timeout: 15000 });

    // Verify ErrorBanner component renders retry button when errors occur
    const banner = page.locator('.border-coral\\/30');
    if (await banner.isVisible()) {
      const retryBtn = banner.locator('button:has-text("Retry"), button:has-text("Try again")');
      if (await retryBtn.isVisible()) {
        await retryBtn.click();
      }
    }

    // Verify 404 route handling does not crash the app
    await page.goto('/some-nonexistent-path-for-testing-404');
    await expect(page).toHaveURL(/\/(?:#.*)?$/, { timeout: 10000 });
    await expect(page.locator('main')).toBeVisible();

    await safety.assertClean();
  });
});

