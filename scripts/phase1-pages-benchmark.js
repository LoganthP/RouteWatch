const path = require('path');
const { chromium } = require(path.resolve('e2e/node_modules/playwright'));

async function measurePages() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('Logging in...');
  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="email"]', 'admin@routewatch.local');
  await page.fill('input[type="password"]', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForURL('http://localhost:5173/');

  const pagesToMeasure = [
    { name: 'Dashboard', url: 'http://localhost:5173/', selector: '.font-display.font-extrabold' },
    { name: 'Live map', url: 'http://localhost:5173/map', selector: '.leaflet-container' },
    { name: 'Analytics', url: 'http://localhost:5173/analytics', selector: '.recharts-responsive-container, table, [role="region"]' },
    { name: 'Query lab', url: 'http://localhost:5173/query-lab', selector: 'table, thead, button:has-text("Run comparison")' },
    { name: 'AI insights', url: 'http://localhost:5173/ai', selector: 'canvas, svg, .text-xl, button' },
  ];

  const results = [];

  for (const p of pagesToMeasure) {
    const testPage = await context.newPage();

    // Track long tasks
    await testPage.addInitScript(() => {
      window.__longTasks = [];
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__longTasks.push({ duration: Math.round(entry.duration), startTime: Math.round(entry.startTime) });
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {}
    });

    const t0 = performance.now();
    await testPage.goto(p.url, { waitUntil: 'domcontentloaded' });
    await testPage.waitForSelector(p.selector, { timeout: 15000 }).catch(() => {});

    // Wait until spinners vanish or real data appears
    try {
      await testPage.waitForFunction(() => {
        const spinners = document.querySelectorAll('.animate-spin');
        return spinners.length === 0;
      }, { timeout: 10000 });
    } catch (_) {}

    const timeToFirstData = Math.round(performance.now() - t0);
    const longTasks = await testPage.evaluate(() => window.__longTasks || []);

    const totalLongTaskTime = longTasks.reduce((sum, t) => sum + t.duration, 0);
    results.push({
      page: p.name,
      timeToFirstDataMs: timeToFirstData,
      longTasksCount: longTasks.length,
      totalLongTaskMs: totalLongTaskTime,
      worstLongTaskMs: longTasks.length ? Math.max(...longTasks.map(t => t.duration)) : 0
    });
    console.log(`- ${p.name}: First Data in ${timeToFirstData} ms | Long Tasks: ${longTasks.length} (total ${totalLongTaskTime} ms, max ${longTasks.length ? Math.max(...longTasks.map(t => t.duration)) : 0} ms)`);
    await testPage.close();
  }

  console.log('\nPage Performance Measured Summary:');
  console.table(results);

  await browser.close();
}

measurePages().catch(console.error);
