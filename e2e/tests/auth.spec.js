const { test, expect } = require('@playwright/test');
const { attachSafetyWatchers, captureScreenshot } = require('./helpers');

test.describe('Auth Flow', () => {
  test('Demo account buttons, wrong password, login, logout, and register', async ({ page }, testInfo) => {
    const safety = attachSafetyWatchers(page);

    // 1. Visit Login page
    await page.goto('/login');
    await page.waitForSelector('form');
    await captureScreenshot(page, testInfo.project.name, 'login');

    // 2. Test wrong password message
    await page.fill('input[type="email"]', 'admin@routewatch.local');
    await page.fill('input[type="password"]', 'WrongPassword123');
    await page.click('button[type="submit"]');
    await expect(page.locator('.border-coral\\/30').first()).toBeVisible({ timeout: 5000 });

    // 3. Demo Admin button
    const demoAdminBtn = page.locator('button:has-text("Admin demo")').first();
    await expect(demoAdminBtn).toBeVisible();
    await demoAdminBtn.click();
    await page.locator('button[type="submit"]:has-text("Sign in")').click();
    await expect(page).toHaveURL(/\/(?:#.*)?$/, { timeout: 10000 });
    await expect(page.locator('main')).toBeVisible();

    // 4. Sign out
    const menuBtn = page.locator('button[aria-label="Open menu"]');
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(400);
    }
    const signOutBtn = page.locator('button[aria-label="Sign out"]:visible');
    await signOutBtn.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });

    // 5. Register new user
    await page.click('text=Create an account');
    await expect(page).toHaveURL(/\/register/);
    await captureScreenshot(page, testInfo.project.name, 'register');

    const uniqueEmail = `test_user_${Date.now()}@routewatch.local`;
    await page.fill('input#name', 'Test Citizen');
    await page.fill('input#remail', uniqueEmail);
    await page.fill('input#rpass', 'UserPassword@123');
    await page.locator('button[type="submit"]:has-text("Create account")').click();
    await expect(page).toHaveURL(/\/(?:#.*)?$/, { timeout: 10000 });

    // 6. Sign out and test duplicate email registration
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(400);
    }
    await page.locator('button[aria-label="Sign out"]:visible').click();
    await page.goto('/register');
    await page.fill('input#name', 'Duplicate Citizen');
    await page.fill('input#remail', uniqueEmail);
    await page.fill('input#rpass', 'UserPassword@123');
    await page.locator('button[type="submit"]:has-text("Create account")').click();
    await expect(page.locator('.border-coral\\/30').first()).toBeVisible({ timeout: 5000 });

    await safety.assertClean();
  });
});
