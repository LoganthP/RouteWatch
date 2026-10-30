const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, loginAsAdmin, captureScreenshot } = require('./helpers');

test.describe('Nearby Search Page', () => {
  test('Both tabs (radius & area), distance buttons, slider, severity chips, map clicks, and area selection', async ({ page, context }, testInfo) => {
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    await page.goto('/nearby');
    await page.waitForLoadState('networkidle');
    await captureScreenshot(page, testInfo.project.name, 'nearby');

    // 1. Radius Mode: 1 / 2 / 5 km buttons
    const btn1k = page.locator('button.neu-chip:has-text("1 km")');
    const btn2k = page.locator('button.neu-chip:has-text("2 km")');
    const btn5k = page.locator('button.neu-chip:has-text("5 km")');

    if (await btn1k.isVisible()) {
      await btn1k.click();
      await page.waitForTimeout(400);
      await btn5k.click();
      await page.waitForTimeout(400);
      await btn2k.click();
      await page.waitForTimeout(400);
    }

    // Slider (range: 250 to 10000, step 250)
    const slider = page.locator('input[type="range"]');
    if (await slider.isVisible()) {
      await slider.fill('3000');
      await page.waitForTimeout(400);
    }

    // Severity chips
    const critChip = page.locator('button.neu-chip:has-text("Critical")');
    if (await critChip.isVisible()) {
      await critChip.click();
      await page.waitForTimeout(400);
      await critChip.click();
    }

    // Active only toggle
    const activeChip = page.locator('button.neu-chip:has-text("Active only")');
    if (await activeChip.isVisible()) {
      await activeChip.click();
      await page.waitForTimeout(400);
      await activeChip.click();
    }

    // Click map to pick point
    const map = page.locator('.leaflet-container');
    if (await map.isVisible()) {
      const box = await map.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(500);
      }
    }

    // 2. Area Mode tab ("By area")
    const areaTab = page.locator('button:has-text("By area")').first();
    if (await areaTab.isVisible()) {
      await areaTab.click();
      await page.waitForTimeout(600);

      // Area select in ZoneMode
      const zoneSelect = page.locator('select').first();
      if (await zoneSelect.isVisible()) {
        const count = await zoneSelect.locator('option').count();
        if (count > 1) {
          await zoneSelect.selectOption({ index: 1 });
          await page.waitForTimeout(500);
        }
      }

      // Switch back to Point + radius tab ("Radius point")
      const radiusTab = page.locator('button:has-text("Radius point")').first();
      await radiusTab.click();
      await page.waitForTimeout(400);
    }

    await safety.assertClean();
  });
});
