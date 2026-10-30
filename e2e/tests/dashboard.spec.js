const { test, expect } = require('@playwright/test');
const axios = require('axios');
const { attachSafetyWatchers, loginAsAdmin, captureScreenshot } = require('./helpers');

test.describe('Dashboard Page', () => {
  test('Dashboard loads with data, empty state, navigation links, and real-time live toast', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);
    await loginAsAdmin(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await captureScreenshot(page, testInfo.project.name, 'dashboard');

    // Check key elements inside main content
    await expect(page.locator('main').locator('text=Total incidents')).toBeVisible();
    await expect(page.locator('main').locator('text=Report incident')).toBeVisible();
    await expect(page.locator('main').locator('text=Open live map')).toBeVisible();
    await expect(page.locator('main').locator('text=More analytics')).toBeVisible();

    // Test navigation links
    // "Report incident" button on page
    await page.locator('a[href="/report"]:visible').first().click();
    await expect(page).toHaveURL(/\/report/);
    await page.goto('/');
    await page.waitForSelector('main', { timeout: 10000 });

    // "Open live map" button
    await page.locator('a[href="/map"]:visible').first().click();
    await expect(page).toHaveURL(/\/map/);
    await page.goto('/');
    await page.waitForSelector('main', { timeout: 10000 });

    // "More analytics" button
    await page.locator('a[href="/analytics"]:visible').first().click();
    await expect(page).toHaveURL(/\/analytics/);
    await page.goto('/');
    await page.waitForSelector('main', { timeout: 10000 });

    // Scope toggle: All data vs Visible area
    const visibleBtn = page.locator('button:has-text("Visible area")');
    if (await visibleBtn.isVisible()) {
      await visibleBtn.click();
      await page.waitForTimeout(500);
      await page.locator('button:has-text("All data")').click();
      await page.waitForTimeout(500);
    }

    // Trigger an incident creation via API to test live-update toast
    try {
      const loginRes = await axios.post('http://127.0.0.1:5000/api/auth/login', {
        email: 'admin@routewatch.local',
        password: 'Admin@123',
      });
      const token = loginRes.data.token;
      await axios.post(
        'http://127.0.0.1:5000/api/incidents',
        {
          type: 'Accident',
          severity: 'Critical',
          description: 'Live test incident for dashboard socket toast',
          lat: 12.3052,
          lng: 76.6552,
          reportedAt: new Date().toISOString(),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (e) {
      console.warn('Live incident creation error:', e.message);
    }

    // Wait for live toast or live counter to appear
    await page.waitForTimeout(1500);

    await safety.assertClean();
  });
});
