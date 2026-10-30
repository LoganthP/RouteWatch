const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, loginAsAdmin, captureScreenshot } = require('./helpers');

const ROUTES = ['/', '/map', '/nearby', '/report', '/incidents', '/analytics', '/query-lab', '/audit'];

test.describe('Layout & Responsive Navigation', () => {
  test('Direct URL navigation, back/forward, refresh, and mobile drawer', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    // 1. Direct URL navigation and refresh for every route
    for (const r of ROUTES) {
      await page.goto(r);
      await page.waitForLoadState('networkidle');
      await page.reload();
      await page.waitForLoadState('networkidle');
      await safety.assertClean();
    }

    // 2. Browser back and forward
    await page.goto('/');
    await page.goto('/map');
    await page.goBack();
    await expect(page).toHaveURL(/\/(?:#.*)?$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/map/);

    // 3. Mobile menu drawer test (if on mobile viewport)
    if (testInfo.project.name === 'mobile') {
      const openMenuBtn = page.locator('button[aria-label="Open menu"]');
      if (await openMenuBtn.isVisible()) {
        await openMenuBtn.click();
        await page.waitForTimeout(400);
        await captureScreenshot(page, testInfo.project.name, 'mobile_menu_open');

        // Close button
        const closeBtn = page.locator('button[aria-label="Close menu"]');
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await page.waitForTimeout(300);
        }
      }
    }

    await safety.assertClean();
  });
});
