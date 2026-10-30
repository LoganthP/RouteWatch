const path = require('path');
const { chromium } = require(path.resolve('e2e/node_modules/playwright'));

async function measure() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('Logging in...');
  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="email"]', 'admin@routewatch.local');
  await page.fill('input[type="password"]', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForURL('http://localhost:5173/');

  // Measure Dashboard
  console.log('\n--- Measuring Dashboard (/) ---');
  let requests = [];
  let bytesTransferred = 0;
  let jsBytesTotal = 0;

  const pageDash = await context.newPage();
  pageDash.on('request', (req) => {
    req._start = performance.now();
  });
  pageDash.on('response', async (res) => {
    const duration = performance.now() - (res.request()._start || performance.now());
    let size = 0;
    try {
      const buffer = await res.body();
      size = buffer.length;
    } catch (_) {}
    bytesTransferred += size;
    if (res.url().endsWith('.js') || res.headers()['content-type']?.includes('javascript')) {
      jsBytesTotal += size;
    }
    requests.push({ url: res.url(), status: res.status(), duration: Math.round(duration), size });
  });

  const t0 = performance.now();
  await pageDash.goto('http://localhost:5173/');
  const tti = Math.round(performance.now() - t0);

  // Wait for cards to finish rendering (no spinner in cards)
  try {
    await pageDash.waitForFunction(() => {
      const spinners = document.querySelectorAll('.animate-spin');
      return spinners.length === 0;
    }, { timeout: 15000 });
  } catch (e) {
    console.log('Timeout waiting for spinners to clear or some spinners remained');
  }
  const fullLoad = Math.round(performance.now() - t0);

  requests.sort((a, b) => b.duration - a.duration);
  const slowest3Dash = requests.slice(0, 3);

  console.log('Dashboard Metrics:');
  console.log(`- Time to Interactive (TTI): ${tti} ms`);
  console.log(`- Time to Full Load: ${fullLoad} ms`);
  console.log(`- Total Requests: ${requests.length}`);
  console.log(`- Transferred Bytes: ${(bytesTransferred / 1024).toFixed(1)} KB`);
  console.log(`- JS Transferred Bytes: ${(jsBytesTotal / 1024).toFixed(1)} KB`);
  console.log('- Slowest 3 Requests:');
  for (const s of slowest3Dash) {
    console.log(`  * ${s.url} : ${s.duration} ms (${(s.size/1024).toFixed(1)} KB, status ${s.status})`);
  }

  // Measure Live Map FPS and metrics
  console.log('\n--- Measuring Live Map (/map) ---');
  requests = [];
  bytesTransferred = 0;
  const pageMap = await context.newPage();
  pageMap.on('request', (req) => { req._start = performance.now(); });
  pageMap.on('response', async (res) => {
    const duration = performance.now() - (res.request()._start || performance.now());
    let size = 0;
    try {
      const buffer = await res.body();
      size = buffer.length;
    } catch (_) {}
    bytesTransferred += size;
    requests.push({ url: res.url(), status: res.status(), duration: Math.round(duration), size });
  });

  const t0Map = performance.now();
  await pageMap.goto('http://localhost:5173/map');
  const ttiMap = Math.round(performance.now() - t0Map);
  await pageMap.waitForSelector('.leaflet-container');
  const fullLoadMap = Math.round(performance.now() - t0Map);

  // Measure FPS during 5 seconds of pan/zoom on the map
  console.log('Measuring FPS during 5s pan/zoom...');
  const fps = await pageMap.evaluate(async () => {
    return new Promise((resolve) => {
      let frameCount = 0;
      let start = performance.now();
      const mapEl = document.querySelector('.leaflet-container');

      function count() {
        frameCount++;
        if (performance.now() - start < 5000) {
          requestAnimationFrame(count);
        } else {
          resolve(Math.round(frameCount / 5));
        }
      }
      requestAnimationFrame(count);

      // Trigger synthetic mouse drag / zoom
      let step = 0;
      const interval = setInterval(() => {
        step++;
        if (mapEl) {
          mapEl.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 + (step * 5) % 300, clientY: 200 + (step * 5) % 200 }));
        }
        if (performance.now() - start >= 5000) clearInterval(interval);
      }, 50);
    });
  });

  requests.sort((a, b) => b.duration - a.duration);
  const slowest3Map = requests.slice(0, 3);

  console.log('Live Map Metrics:');
  console.log(`- Time to Interactive (TTI): ${ttiMap} ms`);
  console.log(`- Time to Full Load: ${fullLoadMap} ms`);
  console.log(`- Total Requests: ${requests.length}`);
  console.log(`- Transferred Bytes: ${(bytesTransferred / 1024).toFixed(1)} KB`);
  console.log(`- Average FPS (5s pan/zoom): ${fps} FPS`);
  console.log('- Slowest 3 Requests:');
  for (const s of slowest3Map) {
    console.log(`  * ${s.url} : ${s.duration} ms (${(s.size/1024).toFixed(1)} KB, status ${s.status})`);
  }

  await browser.close();
}

measure().catch(console.error);
