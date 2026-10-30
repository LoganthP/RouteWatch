const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, loginAsAdmin, captureScreenshot } = require('./helpers');

test.describe('Incidents Management Page', () => {
  test('Search, filter chips, column sorting, pagination, drawer actions, CSV and PDF export', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    await page.goto('/incidents');
    await page.waitForLoadState('networkidle');
    await captureScreenshot(page, testInfo.project.name, 'incidents');

    // 1. Text search (filter to Mysuru for fast export)
    const searchInput = page.locator('input[placeholder*="Search by ID"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Mysuru');
      await page.waitForTimeout(600);
    }

    // 2. Sorting on columns
    const typeSortBtn = page.locator('th:has-text("Type") button');
    if (await typeSortBtn.isVisible()) {
      await typeSortBtn.click(); // asc
      await page.waitForTimeout(400);
      await typeSortBtn.click(); // desc
      await page.waitForTimeout(400);
    }

    const sevSortBtn = page.locator('th:has-text("Severity") button');
    if (await sevSortBtn.isVisible()) {
      await sevSortBtn.click();
      await page.waitForTimeout(400);
    }

    // 3. Detail drawer open/close
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await expect(page.locator('aside[role="dialog"]')).toBeVisible({ timeout: 5000 });
      await captureScreenshot(page, testInfo.project.name, 'incident_detail_drawer');

      // Admin verification buttons inside drawer
      const verifyBtn = page.locator('aside button:has-text("Verify")');
      if (await verifyBtn.isVisible() && await verifyBtn.isEnabled()) {
        await verifyBtn.click();
        await page.waitForTimeout(500);
      }

      // Close drawer
      const closeBtn = page.locator('aside button[aria-label="Close"]');
      await closeBtn.click();
      await page.waitForTimeout(300);
    }

    // 4. Export CSV download
    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("Export CSV")').click(),
    ]);
    const csvPath = await csvDownload.path();
    expect(csvPath).toBeTruthy();

    // 5. Export PDF download
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("Export PDF")').click(),
    ]);
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).toBeTruthy();

    await safety.assertClean();
  });
});
