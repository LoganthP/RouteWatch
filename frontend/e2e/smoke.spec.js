import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const SCREENSHOT_DIR = path.join(process.cwd(), 'e2e', 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

test.describe('RouteWatch End-to-End Smoke & System Verification', () => {
  let consoleErrors = [];
  let failedRequests = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    failedRequests = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore expected/benign network errors or map tile aborts
        if (!text.includes('Failed to load resource') && !text.includes('AbortError')) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    page.on('response', (res) => {
      if (res.status() >= 400 && !res.url().includes('/auth/login')) {
        failedRequests.push(`${res.status()} ${res.url()}`);
      }
    });
  });

  test('1. Authentication: Login as admin user', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();

    await page.fill('input[type="email"]', 'admin@routewatch.local');
    await page.fill('input[type="password"]', 'Admin@123');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL('/');
    await expect(page.locator('text=Today on the roads')).toBeVisible();

    // Verify token was stored
    const token = await page.evaluate(() => localStorage.getItem('rw_token'));
    expect(token).toBeTruthy();
  });

  test('2. Navigation & Error Verification on all 8 sidebar routes', async ({ page }) => {
    // Log in first
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@routewatch.local');
    await page.fill('input[type="password"]', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    const routes = [
      { path: '/', title: 'Today on the roads' },
      { path: '/map', title: 'Live map' },
      { path: '/nearby', title: 'Nearby search' },
      { path: '/report', title: 'Report an incident' },
      { path: '/incidents', title: 'Incidents' },
      { path: '/analytics', title: 'Analytics' },
      { path: '/query-lab', title: 'Query lab' },
      { path: '/audit', title: 'Audit log' },
    ];

    for (const r of routes) {
      if (r.path === '/') {
        await page.goto('/');
      } else {
        await page.click(`nav a[href="${r.path}"]`);
      }
      await expect(page.locator('main').locator(`text=${r.title}`).first()).toBeVisible({ timeout: 15000 });

      // Click safe tabs/buttons on the page (excluding map zoom controls)
      const buttons = await page.locator('main').locator('button:visible:not(.leaflet-control-zoom-in):not(.leaflet-control-zoom-out)').all();
      for (const btn of buttons.slice(0, 2)) {
        const text = await btn.innerText().catch(() => '');
        if (text && !['Delete', 'Purge', 'Sign out', '+', '−'].some((bad) => text.includes(bad))) {
          await btn.click({ timeout: 1500 }).catch(() => {});
        }
      }

      expect(consoleErrors).toHaveLength(0);
      expect(failedRequests).toHaveLength(0);
    }
  });

  test('3. Single Incident Report workflow with map pick', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@routewatch.local');
    await page.fill('input[type="password"]', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    await page.goto('/report');
    await page.waitForLoadState('networkidle');

    // Click map to pick location
    const map = page.locator('.leaflet-container');
    await expect(map).toBeVisible();
    await map.click({ position: { x: 200, y: 200 } });

    // Fill form
    await page.fill('textarea#desc', 'E2E Smoke test incident on major road');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'single_report_form.png') });

    // Submit report
    await page.click('button:has-text("Submit report")');

    // Confirm success message
    await expect(page.locator('text=Reported as')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'single_report_success.png') });
  });

  test('4. Upload Dataset Wizard End-to-End', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@routewatch.local');
    await page.fill('input[type="password"]', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    await page.goto('/report');
    await page.waitForLoadState('networkidle');

    // Click "Upload dataset" tab
    await page.click('button:has-text("Upload dataset")');
    await expect(page.locator('text=Drag and drop your dataset file here')).toBeVisible();

    // Verify dynamic Quota banner
    await expect(page.locator('text=Storage Quota:')).toBeVisible();
    await expect(page.locator('text=Max file size:')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'step1_upload_dropzone.png') });

    // Upload archive.zip (or sample fixture)
    const archivePath = 'C:\\Users\\logan\\Downloads\\archive.zip';
    const filePathToUpload = fs.existsSync(archivePath) ? archivePath : path.join(process.cwd(), '..', 'backend', 'test', 'fixtures', 'sample.geojson');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePathToUpload);

    // Step 2: Map columns & scope
    await expect(page.locator('text=Detected files & column mapping')).toBeVisible({ timeout: 60000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'step2_mapping_review.png') });

    // Test Back button
    await page.click('button:has-text("Back")');
    await expect(page.locator('text=Drag and drop your dataset file here')).toBeVisible();

    // Select file again (testing selection twice in a row)
    await fileInput.setInputFiles(filePathToUpload);
    await expect(page.locator('text=Detected files & column mapping')).toBeVisible({ timeout: 60000 });

    // Start import
    await page.click('button:has-text("Start import")');

    // Step 3: Live progress
    await expect(page.locator('text=Status:')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'step3_import_progress.png') });

    // Test navigation buttons
    await expect(page.locator('button:has-text("Start over")')).toBeVisible();
  });

  test('5. Logout and Token Expiry redirects to /login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@routewatch.local');
    await page.fill('input[type="password"]', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Clear token to simulate expiry
    await page.evaluate(() => {
      localStorage.removeItem('rw_token');
      window.dispatchEvent(new Event('rw:logout'));
    });

    await page.goto('/report');
    await page.waitForURL('**/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('6. Responsive Layout at 1280px and 390px viewport', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@routewatch.local');
    await page.fill('input[type="password"]', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Desktop: 1280px
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(desktopOverflow).toBeFalsy();

    // Mobile: 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(mobileOverflow).toBeFalsy();
  });
});
