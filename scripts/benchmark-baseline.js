const { performance } = require('perf_hooks');

async function benchmark() {
  const loginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@routewatch.local', password: 'Admin@123' })
  });
  const { token } = await loginRes.json();
  const headers = { Authorization: 'Bearer ' + token };

  const endpoints = [
    { name: 'Dashboard Precomputed', path: '/api/dashboard' },
    { name: 'Summary', path: '/api/analytics/summary' },
    { name: 'Temporal (hour)', path: '/api/analytics/temporal?granularity=hour' },
    { name: 'Temporal (dayOfWeek)', path: '/api/analytics/temporal?granularity=dayOfWeek' },
    { name: 'Temporal (month)', path: '/api/analytics/temporal?granularity=month' },
    { name: 'Temporal (day)', path: '/api/analytics/temporal?granularity=day' },
    { name: 'Temporal (weekhour)', path: '/api/analytics/temporal?granularity=weekhour' },
    { name: 'Areas', path: '/api/analytics/areas' },
    { name: 'Hotspots (Mysuru)', path: '/api/analytics/hotspots?bbox=76.5,12.2,76.8,12.4&limit=40' },
    { name: 'Hotspots (London)', path: '/api/analytics/hotspots?bbox=-0.5,51.3,0.3,51.7&limit=40' },
    { name: 'Hotspots (Global)', path: '/api/analytics/hotspots?limit=40' },
    { name: 'Heatmap (5k)', path: '/api/analytics/heatmap?limit=5000' },
    { name: 'Heatmap (20k)', path: '/api/analytics/heatmap?limit=20000' },
    { name: 'Bounds', path: '/api/analytics/bounds' },
    { name: 'Incidents (limit=6)', path: '/api/incidents?limit=6' },
  ];

  console.log('| Endpoint | Runs (ms) | Median (ms) | p95 (ms) | Size (KB) |');
  console.log('|:---|:---:|:---:|:---:|:---:|');

  const results = [];

  for (const ep of endpoints) {
    const times = [];
    let sizeKb = '0';
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const res = await fetch('http://127.0.0.1:5000' + ep.path, { headers });
      const text = await res.text();
      const ms = Math.round(performance.now() - t0);
      times.push(ms);
      sizeKb = (text.length / 1024).toFixed(1);
    }
    times.sort((a, b) => a - b);
    const median = times[2];
    const p95 = times[4]; // 5th item in 5 runs is approx p95 / max
    results.push({ name: ep.name, path: ep.path, times, median, p95, sizeKb });
    console.log(`| ${ep.name} (\`${ep.path}\`) | [${times.join(', ')}] | ${median} ms | ${p95} ms | ${sizeKb} KB |`);
  }
}

benchmark().catch(console.error);

