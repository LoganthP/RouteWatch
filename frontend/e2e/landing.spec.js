import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const SCREENSHOT_DIR = path.join(process.cwd(), 'e2e', 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

test.describe('RouteWatch Landing Page Verification', () => {
  let consoleErrors = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore benign network aborts from cancelled tile fetching
        if (!text.includes('Failed to load resource') && !text.includes('AbortError')) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });
  });

  test('1. Page loads with no console errors and renders main landmarks', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);

    // Verify title and semantic landmarks
    await expect(page).toHaveTitle(/RouteWatch/);
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();

    // Verify exactly one H1 exists on the page
    const h1s = await page.locator('h1').all();
    expect(h1s.length).toBe(1);
    await expect(page.locator('h1')).toContainText('roads keep going wrong');

    // Verify zero console errors
    expect(consoleErrors).toEqual([]);
  });

  test('2. Logged-out navigation and hero CTAs point to login with next parameter', async ({ page }) => {
    // Ensure clean logged-out state
    await page.goto(`${BASE_URL}/`);
    await page.evaluate(() => localStorage.removeItem('rw_token'));
    await page.reload();

    const nav = page.locator('nav[aria-label="RouteWatch Landing Navigation"]');
    await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Get started' })).toBeVisible();

    // Check Hero CTAs
    const exploreCta = page.getByRole('link', { name: 'Explore the live map' });
    const uploadCta = page.getByRole('link', { name: 'Upload a dataset' });

    await expect(exploreCta).toHaveAttribute('href', '/login?next=/map');
    await expect(uploadCta).toHaveAttribute('href', '/login?next=/report?tab=upload');

    // Nav anchor links exist
    await expect(nav.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '#features');
    await expect(nav.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#how-it-works');
    await expect(nav.getByRole('link', { name: 'AI' })).toHaveAttribute('href', '#ai');
    await expect(nav.getByRole('link', { name: 'Live data' })).toHaveAttribute('href', '#live-data');
    await expect(nav.getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '#faq');
  });

  test('3. Login honors next parameter and Back to home links work', async ({ page }) => {
    // Visit /login?next=/map
    await page.goto(`${BASE_URL}/login?next=/map`);
    await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();

    // Test Back to home
    await page.click('text=← Back to home');
    await expect(page).toHaveURL(`${BASE_URL}/`);

    // Return to login with next=/map and log in
    await page.goto(`${BASE_URL}/login?next=/map`);
    await page.fill('input#email', 'admin@routewatch.local');
    await page.fill('input#password', 'Admin@123');
    await page.click('button[type="submit"]');

    // Should honor next and navigate to /map
    await page.waitForURL('**/map');
    expect(page.url()).toContain('/map');
  });

  test('4. Logged-in landing page displays Open dashboard and direct CTAs', async ({ page }) => {
    // Log in first
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input#email', 'admin@routewatch.local');
    await page.fill('input#password', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');

    // Visit landing page while authenticated
    await page.goto(`${BASE_URL}/`);

    const nav = page.locator('nav[aria-label="RouteWatch Landing Navigation"]');
    await expect(nav.getByRole('link', { name: 'Open dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Sign in' })).not.toBeVisible();

    // Check Hero CTAs point directly to destination
    const exploreCta = page.getByRole('link', { name: 'Explore the live map' });
    const uploadCta = page.getByRole('link', { name: 'Upload a dataset' });

    await expect(exploreCta).toHaveAttribute('href', '/map');
    await expect(uploadCta).toHaveAttribute('href', '/report?tab=upload');

    // Click Open dashboard
    await nav.getByRole('link', { name: 'Open dashboard' }).click();
    await page.waitForURL('**/dashboard');
    expect(page.url()).toContain('/dashboard');
  });

  test('5. Live data stats count-up works when backend is UP', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    const liveSection = page.locator('#live-data');
    await liveSection.scrollIntoViewIfNeeded();
    await expect(liveSection).toBeVisible();

    // Wait for the stat values to load and count up from 0
    const firstStat = liveSection.locator('p.font-display').first();
    await expect(firstStat).not.toHaveText('—', { timeout: 6000 });
    await expect(firstStat).not.toHaveText('0', { timeout: 6000 });

    const statElements = await liveSection.locator('p.font-display').allInnerTexts();
    expect(statElements.length).toBe(4);
  });

  test('6. Live data stats show tasteful "—" placeholders when backend is DOWN', async ({ page }) => {
    // Intercept /api/public/stats to simulate backend failure
    await page.route('**/api/public/stats', (route) => {
      route.abort('failed');
    });

    await page.goto(`${BASE_URL}/#live-data`);
    const liveSection = page.locator('#live-data');
    await expect(liveSection).toBeVisible();

    // Should display graceful "—" placeholders without throwing an alert or crashing
    const statElements = await liveSection.locator('p.font-display').allInnerTexts();
    expect(statElements.length).toBe(4);
    for (const val of statElements) {
      expect(val).toBe('—');
    }

    // Still no uncaught page error
    expect(consoleErrors).toEqual([]);
  });

  test('7. Accessible FAQ accordion expands and collapses', async ({ page }) => {
    await page.goto(`${BASE_URL}/#faq`);
    const faqSection = page.locator('#faq');
    await expect(faqSection).toBeVisible();

    const firstFaqButton = faqSection.locator('button[id^="faq-btn-"]').first();
    await expect(firstFaqButton).toHaveAttribute('aria-expanded', 'false');

    // Click to open
    await firstFaqButton.click();
    await expect(firstFaqButton).toHaveAttribute('aria-expanded', 'true');
    const panelId = await firstFaqButton.getAttribute('aria-controls');
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('CSV, Excel');

    // Click to close
    await firstFaqButton.click();
    await expect(firstFaqButton).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).not.toBeVisible();
  });

  test('8. Mobile menu toggles and responsiveness at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/`);

    const openMenuBtn = page.getByRole('button', { name: 'Open navigation menu' });
    await expect(openMenuBtn).toBeVisible();

    // Open mobile menu
    await openMenuBtn.click();
    const mobileDrawer = page.locator('#mobile-nav-menu');
    await expect(mobileDrawer).toBeVisible();
    await expect(mobileDrawer.getByRole('link', { name: 'Features' })).toBeVisible();

    // Click link inside drawer closes drawer
    await mobileDrawer.getByRole('link', { name: 'Features' }).click();
    await expect(mobileDrawer).not.toBeVisible();

    // Capture screenshot at 390px width
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'landing-mobile-390.png'),
      fullPage: true,
    });
  });

  test('9. Capture full-page desktop screenshot at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');

    // Capture screenshot at 1440px width
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'landing-desktop-1440.png'),
      fullPage: true,
    });
  });

  test('10. Multi-breakpoint verification: 390, 768, 1024, 1366, 1920 px with no horizontal overflow', async ({ page }) => {
    const widths = [390, 768, 1024, 1366, 1920];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState('domcontentloaded');

      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizontalScroll, `Horizontal overflow detected at ${w}px`).toBe(false);
    }
  });
});
