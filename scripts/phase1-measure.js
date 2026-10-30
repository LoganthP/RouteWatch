const path = require('path');
const { performance } = require('perf_hooks');

async function main() {
  const mongoose = require(path.resolve('backend/node_modules/mongoose'));
  await mongoose.connect('mongodb://127.0.0.1:27017/routewatch_db');
  const db = mongoose.connection.db;

  console.log('====================================================');
  console.log('1. MONGODB INSTANCE & DATABASE STATS');
  console.log('====================================================');

  const admin = db.admin();
  const buildInfo = await admin.buildInfo();
  let serverStatus = {};
  try { serverStatus = await admin.serverStatus(); } catch (_) {}
  const stats = await db.stats();

  console.log(`MongoDB URI: mongodb://127.0.0.1:27017/routewatch_db`);
  console.log(`Server Version: ${buildInfo.version}`);
  console.log(`Host / Process: ${serverStatus.host || '127.0.0.1'} (${serverStatus.process || 'mongod'})`);
  console.log(`Platform: ${buildInfo.buildEnvironment?.target_os || 'windows'} / local`);
  console.log(`Atlas vs Local: LOCAL MongoDB Community Server (not Atlas; no Atlas tier).`);
  console.log('\nDatabase stats (db.stats()):');
  console.log(JSON.stringify(stats, null, 2));

  console.log('\n====================================================');
  console.log('PER-COLLECTION STATS');
  console.log('====================================================');
  const collections = await db.listCollections().toArray();
  const colStats = [];
  for (const c of collections) {
    const cs = await db.command({ collStats: c.name });
    colStats.push({
      collection: c.name,
      count: cs.count,
      dataSizeMB: +(cs.size / (1024 * 1024)).toFixed(2),
      storageSizeMB: +(cs.storageSize / (1024 * 1024)).toFixed(2),
      indexSizeMB: +(cs.totalIndexSize / (1024 * 1024)).toFixed(2),
      avgObjSizeBytes: Math.round(cs.avgObjSize || 0)
    });
  }
  console.table(colStats);

  console.log('\n====================================================');
  console.log('INDEX DETAILS FOR INCIDENTS COLLECTION');
  console.log('====================================================');
  const incidentIndexes = await db.collection('incidents').indexes();
  console.log(JSON.stringify(incidentIndexes, null, 2));

  console.log('\n====================================================');
  console.log('2. ENDPOINT TIMINGS (MEDIAN OF 5 RUNS)');
  console.log('====================================================');

  const loginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@routewatch.local', password: 'Admin@123' })
  });
  const { token } = await loginRes.json();
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const endpoints = [
    // Dashboard
    { group: 'Dashboard', name: 'Dashboard Precomputed', path: '/api/dashboard', method: 'GET' },
    { group: 'Dashboard', name: 'Incidents Recent (limit=6)', path: '/api/incidents?limit=6', method: 'GET' },

    // Live Map
    { group: 'Live Map', name: 'Map Points (zoom 12, Mysuru)', path: '/api/incidents/map?zoom=12&bbox=76.5,12.2,76.8,12.4', method: 'GET' },
    { group: 'Live Map', name: 'Map Clusters (zoom 4, Global)', path: '/api/incidents/map?zoom=4', method: 'GET' },
    { group: 'Live Map', name: 'Hotspots (Mysuru)', path: '/api/analytics/hotspots?bbox=76.5,12.2,76.8,12.4&zoom=12', method: 'GET' },
    { group: 'Live Map', name: 'Heatmap (5k)', path: '/api/analytics/heatmap?limit=5000', method: 'GET' },
    { group: 'Live Map', name: 'Bounds', path: '/api/analytics/bounds', method: 'GET' },

    // Analytics
    { group: 'Analytics', name: 'Summary', path: '/api/analytics/summary', method: 'GET' },
    { group: 'Analytics', name: 'Temporal (hour)', path: '/api/analytics/temporal?granularity=hour', method: 'GET' },
    { group: 'Analytics', name: 'Temporal (dayOfWeek)', path: '/api/analytics/temporal?granularity=dayOfWeek', method: 'GET' },
    { group: 'Analytics', name: 'Temporal (month)', path: '/api/analytics/temporal?granularity=month', method: 'GET' },
    { group: 'Analytics', name: 'Temporal (day)', path: '/api/analytics/temporal?granularity=day', method: 'GET' },
    { group: 'Analytics', name: 'Temporal (weekhour)', path: '/api/analytics/temporal?granularity=weekhour', method: 'GET' },
    { group: 'Analytics', name: 'Areas', path: '/api/analytics/areas', method: 'GET' },
    { group: 'Analytics', name: 'Severity', path: '/api/analytics/severity', method: 'GET' },

    // Query Lab
    { group: 'Query Lab', name: 'Incidents (page 1, limit 100)', path: '/api/incidents?page=1&limit=100', method: 'GET' },

    // AI Insights
    { group: 'AI Insights', name: 'AI Status', path: '/api/ml/status', method: 'GET' },
    { group: 'AI Insights', name: 'AI Model Card', path: '/api/ml/severity/model', method: 'GET' },
    { group: 'AI Insights', name: 'AI Forecast (14d)', path: '/api/ml/forecast', method: 'POST', body: { horizon: 14 } },
    { group: 'AI Insights', name: 'AI Clusters (DBSCAN Mysuru)', path: '/api/ml/clusters', method: 'POST', body: { filters: { bbox: [76.5, 12.2, 76.8, 12.4] }, eps_m: 250, min_samples: 15 } },
    { group: 'AI Insights', name: 'AI Severity Predict', path: '/api/ml/severity/predict', method: 'POST', body: { lng: 76.65, lat: 12.31, type: 'Accident' } },
  ];

  const results = [];
  const slowQueries = [];

  for (const ep of endpoints) {
    const times = [];
    let sizeKb = '0';
    let status = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const res = await fetch('http://127.0.0.1:5000' + ep.path, {
        method: ep.method,
        headers,
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      status = res.status;
      const text = await res.text();
      const ms = Math.round(performance.now() - t0);
      times.push(ms);
      sizeKb = (text.length / 1024).toFixed(1);
    }
    times.sort((a, b) => a - b);
    const median = times[2];
    const p95 = times[4];
    results.push({ group: ep.group, name: ep.name, path: ep.path, status, median, p95, sizeKb, runs: times });
    if (median > 300) {
      slowQueries.push({ name: ep.name, path: ep.path, median });
    }
  }

  console.table(results.map(r => ({
    Group: r.group,
    Endpoint: r.name,
    'Median (ms)': r.median,
    'p95 (ms)': r.p95,
    'Size (KB)': r.sizeKb,
    Status: r.status,
    Runs: r.runs.join(', ')
  })));

  console.log('\nSlow endpoints (> 300 ms):', slowQueries);

  await mongoose.disconnect();
}

main().catch(console.error);

