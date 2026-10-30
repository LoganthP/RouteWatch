async function benchmark() {
  console.log('--- Benchmarking Analytics Endpoints with 1.7M+ Documents ---');
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@routewatch.local', password: 'Admin@123' })
  });
  const { token } = await loginRes.json();
  const headers = { Authorization: 'Bearer ' + token };

  const endpoints = [
    '/api/analytics/summary',
    '/api/analytics/temporal',
    '/api/analytics/temporal?granularity=hour',
    '/api/analytics/temporal?granularity=dayOfWeek',
    '/api/analytics/temporal?granularity=weekhour',
    '/api/analytics/areas',
    '/api/analytics/hotspots',
    '/api/analytics/heatmap',
    '/api/analytics/bounds',
    '/api/incidents?limit=200',
  ];

  let allPassed = true;
  for (const ep of endpoints) {
    const start = performance.now();
    const res = await fetch('http://localhost:5000' + ep, { headers });
    const buffer = await res.arrayBuffer();
    const duration = performance.now() - start;
    const sizeKB = (buffer.byteLength / 1024).toFixed(1);
    const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(3);
    const passed = duration < 2000 && buffer.byteLength < 1048576;
    if (!passed) allPassed = false;

    console.log(
      `${ep.padEnd(42)} | status: ${res.status} | time: ${duration.toFixed(1).padStart(6)} ms | size: ${sizeKB.padStart(6)} KB | ${passed ? 'PASS' : 'FAIL'}`
    );
  }

  if (!allPassed) {
    console.error('\nOne or more endpoints failed performance criteria (< 2000 ms, < 1 MB)');
    process.exit(1);
  }
  console.log('\nAll analytics endpoints respond in < 2 seconds and < 1 MB!');
  process.exit(0);
}

benchmark().catch((e) => {
  console.error(e);
  process.exit(1);
});
