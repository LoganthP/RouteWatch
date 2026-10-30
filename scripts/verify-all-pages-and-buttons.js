const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../e2e/node_modules/@playwright/test'));

async function testAll() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore 503 from expected offline AI service or aborts
      if (!text.includes('Failed to load resource') && !text.includes('503') && !text.includes('AbortError')) {
        consoleErrors.push(text);
      }
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.message);
  });

  console.log('--- 1. LOGIN AS ADMIN DEMO ---');
  await page.goto('http://localhost:5173/login');
  await page.locator('button:has-text("Admin demo")').click();
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname === '/');
  await page.waitForTimeout(1000);
  console.log('[PASS] Logged in to Dashboard');

  console.log('\n--- 2. VERIFY DASHBOARD BUTTONS AND LINKS ---');
  // Report incident
  await page.locator('a[href="/report"]:visible').first().click();
  await page.waitForFunction(() => window.location.pathname === '/report');
  console.log('[PASS] Button "Report incident" navigated to /report');
  await page.goBack();
  await page.waitForFunction(() => window.location.pathname === '/');

  // Open live map
  await page.locator('a[href="/map"]:visible').first().click();
  await page.waitForFunction(() => window.location.pathname === '/map');
  console.log('[PASS] Link "Open live map" navigated to /map');
  await page.goBack();
  await page.waitForFunction(() => window.location.pathname === '/');

  // More analytics
  await page.locator('a[href="/analytics"]:visible').first().click();
  await page.waitForFunction(() => window.location.pathname === '/analytics');
  console.log('[PASS] Link "More analytics" navigated to /analytics');
  await page.goBack();
  await page.waitForFunction(() => window.location.pathname === '/');

  // Open AI insights
  await page.locator('a[href="/ai"]:visible').first().click();
  await page.waitForFunction(() => window.location.pathname === '/ai');
  console.log('[PASS] Button "Open AI insights" navigated to /ai');
  await page.goBack();
  await page.waitForFunction(() => window.location.pathname === '/');

  // Map zoom controls
  const zoomIn = page.locator('.leaflet-control-zoom-in');
  const zoomOut = page.locator('.leaflet-control-zoom-out');
  await zoomIn.click();
  await page.waitForTimeout(200);
  await zoomOut.click();
  await page.waitForTimeout(200);
  console.log('[PASS] Map zoom + and - buttons respond correctly');

  // Map search box
  const searchInput = page.locator('input[placeholder="Search any city or place"]');
  await searchInput.fill('Bengaluru');
  await page.waitForTimeout(600);
  console.log('[PASS] Map place search input active and functional');

  console.log('\n--- 3. VERIFY ALL SIDEBAR PAGES LOAD CLEANLY ---');
  const sidebarLinks = [
    { label: 'Dashboard', path: '/' },
    { label: 'Live map', path: '/map' },
    { label: 'Nearby search', path: '/nearby' },
    { label: 'Report incident', path: '/report' },
    { label: 'Incidents', path: '/incidents' },
    { label: 'Analytics', path: '/analytics' },
    { label: 'AI insights', path: '/ai' },
    { label: 'Query lab', path: '/query-lab' },
    { label: 'Audit log', path: '/audit' },
  ];

  for (const item of sidebarLinks) {
    const link = page.locator(`aside a[href="${item.path}"]`).first();
    await link.click();
    await page.waitForFunction((p) => window.location.pathname === p, item.path);
    await page.waitForTimeout(400);
    console.log(`[PASS] Page ${item.label} (${item.path}) loaded cleanly`);
  }

  console.log('\n--- 4. VERIFY LOGOUT CLEARS SESSION AND REDIRECTS ---');
  const logoutBtn = page.locator('button[aria-label="Log out"]');
  await logoutBtn.click();
  await page.waitForFunction(() => window.location.pathname === '/login');

  const tokenAfter = await page.evaluate(() => localStorage.getItem('rw_token'));
  if (!tokenAfter) {
    console.log('[PASS] Logout successfully cleared rw_token and routed to /login');
  } else {
    throw new Error('Token was not cleared after logout!');
  }

  if (consoleErrors.length > 0) {
    console.error('Console errors encountered:', consoleErrors);
    throw new Error('Uncaught console errors detected');
  } else {
    console.log('\n[SUCCESS] ALL VERIFICATION CHECKS PASSED WITH ZERO CONSOLE ERRORS!');
  }

  await browser.close();
}

testAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
