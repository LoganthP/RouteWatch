const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../e2e/node_modules/@playwright/test'));

const SCREENSHOT_DIR = path.resolve(__dirname, '../frontend/e2e/screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { width: 1920, height: 1080, name: '1920x1080' },
  { width: 1366, height: 768, name: '1366x768' },
  { width: 1280, height: 720, name: '1280x720' },
  { width: 390, height: 844, name: '390x844' }, // mobile
];

const ZOOMS = [0.9, 1.0, 1.25, 1.5];

async function verify() {
  const browser = await chromium.launch();
  console.log('--- STARTING SIDEBAR VIEWPORT & ZOOM VERIFICATION ---');
  let failures = 0;

  // Log in once to retrieve admin token
  const initPage = await browser.newPage();
  await initPage.goto('http://localhost:5173/login');
  await initPage.fill('#email', 'admin@routewatch.local');
  await initPage.fill('#password', 'Admin@123');
  await initPage.click('button[type="submit"]');
  await initPage.waitForURL('http://localhost:5173/', { timeout: 15000 });
  const token = await initPage.evaluate(() => localStorage.getItem('rw_token'));
  await initPage.close();

  for (const vp of VIEWPORTS) {
    for (const zoom of ZOOMS) {
      const zoomPct = Math.round(zoom * 100);
      const testName = `vp_${vp.name}_zoom_${zoomPct}`;
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: zoom,
      });
      const page = await context.newPage();
      if (token) {
        await page.addInitScript((t) => localStorage.setItem('rw_token', t), token);
      }

      try {
        await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);

        const isMobile = vp.width < 1024;

        if (isMobile) {
          // Open mobile drawer
          const menuBtn = page.locator('button[aria-label="Open menu"]');
          if (await menuBtn.isVisible()) {
            await menuBtn.click();
            await page.waitForTimeout(400);
          }
        }

        const sidebar = page.locator('[data-testid="sidebar-glass"]:visible').first();
        await sidebar.waitFor({ state: 'visible', timeout: 5000 });

        const sidebarBox = await sidebar.boundingBox();
        const userCard = page.locator('[data-testid="sidebar-user-card"]:visible').first();
        const userCardBox = await userCard.boundingBox();

        if (!sidebarBox || !userCardBox) {
          throw new Error(`Bounding boxes not found for ${testName}`);
        }

        // Account card must sit fully INSIDE the sidebar
        // Note: 2px tolerance for subpixel anti-aliasing
        const isInsideTop = userCardBox.y >= sidebarBox.y - 2;
        const isInsideBottom = (userCardBox.y + userCardBox.height) <= (sidebarBox.y + sidebarBox.height + 2);
        const isInsideLeft = userCardBox.x >= sidebarBox.x - 2;
        const isInsideRight = (userCardBox.x + userCardBox.width) <= (sidebarBox.x + sidebarBox.width + 2);

        const screenshotPath = path.join(SCREENSHOT_DIR, `sidebar_${testName}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });

        if (isInsideBottom && isInsideTop && isInsideLeft && isInsideRight) {
          console.log(`[PASS] ${testName}: Account card fully contained! (Card bottom: ${Math.round(userCardBox.y + userCardBox.height)} <= Sidebar bottom: ${Math.round(sidebarBox.y + sidebarBox.height)})`);
        } else {
          console.error(`[FAIL] ${testName}: Overlap! UserCard: [t=${Math.round(userCardBox.y)}, b=${Math.round(userCardBox.y + userCardBox.height)}, l=${Math.round(userCardBox.x)}, r=${Math.round(userCardBox.x + userCardBox.width)}], Sidebar: [t=${Math.round(sidebarBox.y)}, b=${Math.round(sidebarBox.y + sidebarBox.height)}, l=${Math.round(sidebarBox.x)}, r=${Math.round(sidebarBox.x + sidebarBox.width)}]`);
          failures++;
        }
      } catch (err) {
        console.error(`[ERROR] ${testName}: ${err.message}`);
        failures++;
      } finally {
        await context.close();
      }
    }
  }

  await browser.close();
  if (failures > 0) {
    console.error(`\nCompleted with ${failures} failure(s).`);
    process.exit(1);
  } else {
    console.log('\nAll 16 viewport & zoom containment tests PASSED successfully!');
  }
}

verify().catch(console.error);
