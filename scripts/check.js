/**
 * Health check script: pings backend (:5000/api/health), ML service (:8000/health),
 * and frontend (:5173).
 *   npm run check
 */
const http = require('http');

function checkEndpoint(name, url, expectedPattern) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const ms = Date.now() - start;
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        let details = `HTTP ${res.statusCode}`;
        try {
          const json = JSON.parse(body);
          if (json.status) details += ` (status: ${json.status})`;
          if (json.db) details += ` (db: ${json.db})`;
          if (json.models_ready !== undefined) details += ` (models_ready: ${json.models_ready})`;
        } catch {
          if (body.includes('<title>') || body.includes('id="root"')) {
            details += ' (Vite App Ready)';
          }
        }
        resolve({ name, url, ok, statusCode: res.statusCode, ms, details });
      });
    });

    req.on('error', (err) => {
      resolve({ name, url, ok: false, statusCode: 0, ms: Date.now() - start, details: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ name, url, ok: false, statusCode: 0, ms: 3000, details: 'Connection Timed Out (3s)' });
    });
  });
}

async function main() {
  console.log('\n============================================================');
  console.log('              RouteWatch System Health Check                ');
  console.log('============================================================\n');

  const targets = [
    { name: 'Backend API  ', url: 'http://127.0.0.1:5000/api/health' },
    { name: 'ML Service   ', url: 'http://127.0.0.1:8000/health' },
    { name: 'Frontend App ', url: 'http://localhost:5173/' }
  ];

  let allOk = true;
  for (const t of targets) {
    const res = await checkEndpoint(t.name, t.url);
    const mark = res.ok ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[31m✖ FAIL\x1b[0m';
    console.log(`  ${mark}  ${t.name} -> ${res.url} [${res.ms}ms] - ${res.details}`);
    if (!res.ok) allOk = false;
  }

  console.log('\n------------------------------------------------------------');
  if (allOk) {
    console.log('\x1b[32m  All RouteWatch services are UP and HEALTHY.\x1b[0m\n');
    process.exit(0);
  } else {
    console.log('\x1b[31m  One or more services are DOWN or unreachable.\x1b[0m');
    console.log('  Run "npm run dev:all" to launch all services.\n');
    process.exit(1);
  }
}

main();
