const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const screenshotsDir = path.join(__dirname, '../screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

function attachSafetyWatchers(page, allowedStatus = []) {
  const errors = [];
  const networkErrors = [];

  page.on('pageerror', (err) => {
    errors.push(`Page error: ${err.message}\n${err.stack}`);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore normal expected network errors if any
      if (!text.includes('Failed to load resource') && !text.includes('401 (Unauthorized)')) {
        errors.push(`Console error: ${text}`);
      }
    }
  });

  page.on('response', (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && !allowedStatus.includes(status)) {
      // Don't fail for intentionally tested 400/401/404 during invalid logins/queries
      if (!url.includes('/api/auth/login') && !url.includes('/api/auth/register') && !url.includes('/favicon')) {
        networkErrors.push(`Network ${status} on ${url}`);
      }
    }
  });

  return {
    async assertClean() {
      const crashed = await page.locator('text=RouteWatch crashed').count();
      if (crashed > 0) {
        throw new Error('CRASH DETECTED: "RouteWatch crashed" banner found on page!');
      }
      if (errors.length > 0) {
        throw new Error(`Uncaught runtime errors detected:\n${errors.join('\n')}`);
      }
    },
    errors,
    networkErrors,
  };
}

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  const demoAdminBtn = page.locator('button:has-text("Admin")').first();
  if (await demoAdminBtn.isVisible()) {
    await demoAdminBtn.click();
    await page.locator('button[type="submit"]:has-text("Sign in")').click();
  } else {
    await page.fill('input[type="email"]', 'admin@routewatch.local');
    await page.fill('input[type="password"]', 'Admin@123');
    await page.locator('button[type="submit"]:has-text("Sign in")').click();
  }
  await expect(page).toHaveURL(/\/(?:#.*)?$/, { timeout: 15000 });
  await page.waitForSelector('main', { timeout: 10000 });
}

async function loginAsCitizen(page) {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  const demoCitizenBtn = page.locator('button:has-text("Citizen")').first();
  if (await demoCitizenBtn.isVisible()) {
    await demoCitizenBtn.click();
    await page.locator('button[type="submit"]:has-text("Sign in")').click();
  } else {
    await page.fill('input[type="email"]', 'user@routewatch.local');
    await page.fill('input[type="password"]', 'User@123');
    await page.locator('button[type="submit"]:has-text("Sign in")').click();
  }
  await expect(page).toHaveURL(/\/(?:#.*)?$/, { timeout: 15000 });
  await page.waitForSelector('main', { timeout: 10000 });
}

async function captureScreenshot(page, projectName, pageName) {
  const dir = path.join(screenshotsDir, projectName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await page.screenshot({ path: path.join(dir, `${pageName}.png`), fullPage: false });
}

module.exports = {
  attachSafetyWatchers,
  loginAsAdmin,
  loginAsCitizen,
  captureScreenshot,
};
