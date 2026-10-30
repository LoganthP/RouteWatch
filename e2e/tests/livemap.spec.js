const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, loginAsAdmin, captureScreenshot } = require('./helpers');

test.describe('Live Map Page', () => {
  test('Layer toggles, zoom/pan, filter chips, area select, place search, and fit to data', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    await page.goto('/map');
    await page.waitForSelector('.leaflet-container', { timeout: 15000 });
    await captureScreenshot(page, testInfo.project.name, 'livemap');

    // 1. Layer toggles in every combination
    const markerChip = page.locator('button.neu-chip:has-text("Incidents")').first();
    const heatChip = page.locator('button.neu-chip:has-text("Density heatmap")').first();
    const gridChip = page.locator('button.neu-chip:has-text("Hotspot grid")').first();
    const zonesChip = page.locator('button.neu-chip:has-text("Area outlines")').first();

    // Toggle heatmap on
    await heatChip.click();
    await page.waitForTimeout(300);

    // Toggle hotspot grid on
    await gridChip.click();
    await page.waitForTimeout(300);

    // Toggle area boundaries on
    await zonesChip.click();
    await page.waitForTimeout(300);

    // Toggle markers off
    await markerChip.click();
    await page.waitForTimeout(300);

    // Toggle markers back on, heat off
    await markerChip.click();
    await heatChip.click();
    await page.waitForTimeout(300);

    // 2. Scope toggle: visible area
    const visibleBtn = page.locator('button:has-text("visible area")');
    if (await visibleBtn.isVisible()) {
      await visibleBtn.click();
      await page.waitForTimeout(500);
      await visibleBtn.click();
      await page.waitForTimeout(500);
    }

    // 3. Place search box
    const searchInput = page.locator('input[placeholder*="Search address"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('Gokulam');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      await searchInput.fill('');
    }

    // 4. Fit to data button
    const fitBtn = page.locator('button:has-text("Fit to data")');
    if (await fitBtn.isVisible()) {
      await fitBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    // 5. Test filter chips in FilterBar (Type, Severity, Status)
    const accidentChip = page.locator('button.neu-chip:has-text("Accident")').first();
    if (await accidentChip.isVisible()) {
      await accidentChip.click();
      await page.waitForTimeout(300);
      await accidentChip.click(); // toggle off
    }

    const criticalChip = page.locator('button.neu-chip:has-text("Critical")').first();
    if (await criticalChip.isVisible()) {
      await criticalChip.click();
      await page.waitForTimeout(300);
      await criticalChip.click();
    }

    // Area select
    const areaSelect = page.locator('select').first();
    if (await areaSelect.isVisible()) {
      const options = await areaSelect.locator('option').allInnerTexts();
      if (options.length > 1) {
        await areaSelect.selectOption({ index: 1 });
        await page.waitForTimeout(400);
        await areaSelect.selectOption({ index: 0 }); // back to all
      }
    }

    // 6. Map Zoom / Pan
    const mapContainer = page.locator('.leaflet-container');
    await expect(mapContainer).toBeVisible();

    // Zoom in and out
    const zoomIn = page.locator('.leaflet-control-zoom-in');
    const zoomOut = page.locator('.leaflet-control-zoom-out');
    if (await zoomIn.isVisible()) {
      await zoomIn.click({ force: true });
      await page.waitForTimeout(300);
      await zoomOut.click({ force: true });
      await page.waitForTimeout(300);
    }

    await safety.assertClean();
  });
});
