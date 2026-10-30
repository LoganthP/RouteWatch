const { test, expect } = require('@playwright/test');
const path = require('path');
const { attachSafetyWatchers, loginAsAdmin, captureScreenshot } = require('./helpers');

test.describe('Report Incident & Dataset Upload Page', () => {
  test('Single incident submission and error validation', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    await page.goto('/report');
    await page.waitForLoadState('networkidle');
    await captureScreenshot(page, testInfo.project.name, 'report_single');

    // 1. Submit without clicking map -> expect error
    await page.locator('button[type="submit"]:has-text("Submit report")').click();
    await expect(page.locator('text=mark where the incident happened')).toBeVisible({ timeout: 5000 });

    // 2. Click map to place pin
    const map = page.locator('.leaflet-container');
    await map.scrollIntoViewIfNeeded();
    await map.click({ position: { x: 180, y: 240 }, force: true });
    await page.waitForTimeout(500);

    // 3. Select type and severity
    const hazardBtn = page.locator('button:has-text("Hazard")');
    if (await hazardBtn.isVisible()) await hazardBtn.click();

    const highSevBtn = page.locator('button:has-text("High")');
    if (await highSevBtn.isVisible()) await highSevBtn.click();

    // 4. Fill description
    await page.fill('textarea#desc', 'E2E Automated test report - road hazard');

    // 5. Submit report
    await page.locator('button[type="submit"]:has-text("Submit report")').click();
    await expect(page.locator('text=was saved in').first()).toBeVisible({ timeout: 10000 });

    await safety.assertClean();
  });

  test('Dataset upload wizard with fixture files, mapping, preview, and datasets list', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    await page.goto('/report');
    await page.waitForLoadState('networkidle');

    // Switch to Upload dataset tab
    await page.locator('button[role="radio"]:has-text("Upload dataset")').click();
    await page.waitForTimeout(500);
    await captureScreenshot(page, testInfo.project.name, 'report_upload_wizard');

    // Upload valid CSV fixture
    const fixturePath = path.join(__dirname, '../fixtures/valid_coords.csv');
    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    await page.waitForTimeout(500);

    // Click "Upload and preview" to trigger chunk upload and preview assembly
    const nextBtn = page.locator('button:has-text("Upload and preview")');
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();

    // Wait for step 2 (Column mapping & scope)
    await expect(page.locator('text=Which column holds what?')).toBeVisible({ timeout: 20000 });
    await captureScreenshot(page, testInfo.project.name, 'report_upload_mapping');

    // Verify sample preview table is rendered
    await expect(page.locator('text=First rows of')).toBeVisible();

    // Trigger import (Step 3)
    const importBtn = page.locator('button:has-text("Start import")').first();
    await expect(importBtn).toBeVisible({ timeout: 10000 });
    await importBtn.click();

    // Wait for Import finished or result card
    await expect(page.locator('text=Import finished').first()).toBeVisible({ timeout: 35000 });
    await captureScreenshot(page, testInfo.project.name, 'report_upload_completed');

    // Verify datasets list is displayed below
    await expect(page.locator('text=Imported datasets').first()).toBeVisible();

    await safety.assertClean();
  });
});
