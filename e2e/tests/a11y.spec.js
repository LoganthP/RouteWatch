const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { loginAsAdmin, attachSafetyWatchers, captureScreenshot } = require('./helpers');

test.describe('Accessibility Audits (WCAG 2.1 AA)', () => {
  test('Audit Login & Register pages', async ({ page }, testInfo) => {
    attachSafetyWatchers(page);

    await page.goto('/login');
    await page.waitForSelector('form');
    const loginResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast']) // Glassmorphism design tokens intentionally reviewed
      .analyze();

    expect(loginResults.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    await page.goto('/register');
    await page.waitForSelector('form');
    const registerResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    expect(registerResults.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await captureScreenshot(page, testInfo.project.name, 'a11y-auth-clean');
  });

  test('Audit Dashboard & Navigation accessibility', async ({ page }, testInfo) => {
    attachSafetyWatchers(page);
    await loginAsAdmin(page);

    const menuBtn = page.locator('button[aria-label="Open menu"]');
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(400);
    }
    await page.waitForSelector('[data-testid="sidebar-user-card"]:visible', { timeout: 10000 });

    const results = await new AxeBuilder({ page })
      .exclude('.leaflet-container') // Skip 3rd party tile images
      .exclude('.recharts-wrapper')  // Recharts SVG paths have sibling accessible text list
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast', 'svg-img-alt'])
      .analyze();

    const majorViolations = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(majorViolations).toEqual([]);
    await captureScreenshot(page, testInfo.project.name, 'a11y-dashboard-clean');
  });
});
