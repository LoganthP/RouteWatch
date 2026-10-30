const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, loginAsAdmin, captureScreenshot } = require('./helpers');

test.describe('AI Insights Page & ML Capabilities', () => {
  test('AI Service status, tabs switching, and feature execution', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    await page.goto('/ai');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('main', { timeout: 15000 });
    await captureScreenshot(page, testInfo.project.name, 'ai_insights_main');

    // 1. Verify ML service is reported online
    await expect(page.locator('text=Service is online').or(page.locator('text=Random Forest'))).toBeVisible({ timeout: 10000 });

    // 2. Switch tabs: Severity prediction
    const sevTab = page.locator('button[role="radio"]:has-text("Severity prediction")');
    if (await sevTab.isVisible()) {
      await sevTab.click();
      await page.waitForTimeout(400);
      await captureScreenshot(page, testInfo.project.name, 'ai_insights_severity');

      // Click "Predict severity" button
      const predictBtn = page.locator('button:has-text("Predict severity")');
      if (await predictBtn.isVisible()) {
        await predictBtn.click();
        await expect(page.locator('text=predicted').or(page.locator('text=confidence'))).toBeVisible({ timeout: 10000 });
      }
    }

    // 3. Switch tabs: 7-day forecast
    const forecastTab = page.locator('button[role="radio"]:has-text("Forecast")');
    if (await forecastTab.isVisible()) {
      await forecastTab.click();
      await page.waitForTimeout(400);
      await captureScreenshot(page, testInfo.project.name, 'ai_insights_forecast');
      await expect(page.locator('text=Forecast').first()).toBeVisible();
    }

    // 4. Switch tabs: DBSCAN clusters
    const clusterTab = page.locator('button[role="radio"]:has-text("DBSCAN"), button[role="radio"]:has-text("Clustering")').first();
    if (await clusterTab.isVisible()) {
      await clusterTab.click();
      await page.waitForTimeout(400);
      await captureScreenshot(page, testInfo.project.name, 'ai_insights_clusters');
      const runClustersBtn = page.locator('button:has-text("Find clusters")');
      if (await runClustersBtn.isVisible()) {
        await runClustersBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    await safety.assertClean();
  });
});

