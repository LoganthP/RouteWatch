const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, loginAsAdmin, captureScreenshot } = require('./helpers');

test.describe('Query Lab Page', () => {
  test('Fresh page load without crash, map pick, radius buttons, and Run comparison', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    // 1. Fresh page load with NO data loaded yet (specifically verifying reported crash is fixed)
    await page.goto('/query-lab');
    await page.waitForLoadState('networkidle');
    await captureScreenshot(page, testInfo.project.name, 'querylab_fresh_load');

    // Verify center coordinates are safely displayed without throwing TypeError on toFixed
    await expect(page.locator('text=Run comparison')).toBeVisible();
    await expect(page.locator('text=Click the map to change the point')).toBeVisible();

    // 2. Pick a point by clicking the map
    const map = page.locator('.leaflet-container');
    const box = await map.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(500);
    }

    // 3. Test radius chips (1 km, 2 km, 5 km)
    const chip2k = page.locator('button.neu-chip:has-text("2 km")');
    if (await chip2k.isVisible()) {
      await chip2k.click();
      await page.waitForTimeout(300);
    }

    // 4. Click Run comparison button
    const runBtn = page.locator('button:has-text("Run comparison")');
    await runBtn.click();
    await page.waitForTimeout(1000);

    // Result blocks and charts
    await expect(page.locator('text=Geospatial search')).toBeVisible({ timeout: 15000 });
    await captureScreenshot(page, testInfo.project.name, 'querylab_results');

    await safety.assertClean();
  });
});
