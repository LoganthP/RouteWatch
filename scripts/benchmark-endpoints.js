const http = require('http');

async function run() {
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@routewatch.local', password: 'Admin@123' })
  });
  const loginData = await loginRes.json();
  const headers = { Authorization: 'Bearer ' + loginData.token };

  const endpoints = [
    ['Summary', '/api/analytics/summary'],
    ['Temporal (month)', '/api/analytics/temporal?granularity=month'],
    ['Heatmap (grid)', '/api/analytics/heatmap?limit=5000'],
    ['Bounds', '/api/analytics/bounds'],
    ['Hotspots (40)', '/api/analytics/hotspots?limit=40'],
    ['Areas (5)', '/api/analytics/areas?limit=5'],
    ['Incidents (6)', '/api/incidents?limit=6'],
    ['AI Health', '/api/ai/health'],
  ];

  console.log('| Endpoint | Status | Duration (ms) | Response Size |');
  console.log('|:---|:---:|:---:|:---:|');

  for (const [name, url] of endpoints) {
    const start = performance.now();
    const res = await fetch('http://localhost:5000' + url, { headers });
    const text = await res.text();
    const ms = Math.round(performance.now() - start);
    const kb = (text.length / 1024).toFixed(1);
    console.log(`| ${name} (\`${url}\`) | ${res.status} | ${ms} ms | ${kb} KB |`);
  }
}

run().catch(console.error);

