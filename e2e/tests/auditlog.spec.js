const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, loginAsAdmin, loginAsCitizen, captureScreenshot } = require('./helpers');

test.describe('Audit Log & Role Access', () => {
  test('Admin can view audit log; Citizen is redirected away', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);

    // 1. Admin access
    await loginAsAdmin(page);
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("Audit log")')).toBeVisible();
    await captureScreenshot(page, testInfo.project.name, 'audit_admin');

    // 2. Sign out
    const menuBtn = page.locator('button[aria-label="Open menu"]');
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(400);
    }
    await page.locator('button[aria-label="Sign out"]:visible').click();
    await expect(page).toHaveURL(/\/login/);

    // 3. Citizen access attempt -> redirected to /
    await loginAsCitizen(page);
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/(?:#.*)?$/); // redirected to dashboard!

    await safety.assertClean();
  });
});
