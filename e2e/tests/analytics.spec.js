const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, loginAsAdmin, captureScreenshot } = require('./helpers');

test.describe('Analytics Page', () => {
  test('Granularity buttons, cell size buttons, charts, hotspots, and area ranking', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');
    await captureScreenshot(page, testInfo.project.name, 'analytics');

    // 1. Granularity buttons (By hour, By weekday, By month)
    const byWeekday = page.locator('button.neu-chip:has-text("By weekday")');
    const byMonth = page.locator('button.neu-chip:has-text("By month")');
    const byHour = page.locator('button.neu-chip:has-text("By hour")');

    if (await byWeekday.isVisible()) {
      await byWeekday.click();
      await page.waitForTimeout(400);
      await byMonth.click();
      await page.waitForTimeout(400);
      await byHour.click();
      await page.waitForTimeout(400);
    }

    // 2. Cell size buttons (330 m, 550 m, 1.1 km)
    const btn330m = page.locator('button.neu-chip:has-text("330 m")');
    const btn1km = page.locator('button.neu-chip:has-text("1.1 km")');
    const btn550m = page.locator('button.neu-chip:has-text("550 m")');

    if (await btn330m.isVisible()) {
      await btn330m.click();
      await page.waitForTimeout(400);
      await btn1km.click();
      await page.waitForTimeout(400);
      await btn550m.click();
      await page.waitForTimeout(400);
    }

    // 3. Hotspots table and area ranking table
    await expect(page.locator('text=Weekday and hour pattern')).toBeVisible();
    await expect(page.locator('text=Area ranking')).toBeVisible();

    await safety.assertClean();
  });
});
