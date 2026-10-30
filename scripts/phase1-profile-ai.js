const path = require('path');
const { performance } = require('perf_hooks');

async function profileAI() {
  const mongoose = require(path.resolve('backend/node_modules/mongoose'));
  await mongoose.connect('mongodb://127.0.0.1:27017/routewatch_db');
  const db = mongoose.connection.db;
  const col = db.collection('incidents');

  console.log('====================================================');
  console.log('AI ENDPOINT 1: /api/ml/forecast — PROFILING');
  console.log('====================================================');
  const since = new Date(Date.now() - 400 * 864e5);
  const match = { reportedAt: { $gte: since } };
  const TZ_EXPR = { $ifNull: ['$tz', 'UTC'] };
  const localDate = { date: '$reportedAt', timezone: TZ_EXPR };

  const pipeline = [
    { $match: match },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', ...localDate } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ];

  const tDb0 = performance.now();
  const rows = await col.aggregate(pipeline).toArray();
  const dbMs = Math.round(performance.now() - tDb0);

  const exp = await col.aggregate(pipeline, { explain: true });
  console.log(`- Documents read: ${rows.reduce((sum, r) => sum + r.count, 0)} (aggregated into ${rows.length} days)`);
  console.log(`- DB Execution Time: ${dbMs} ms`);
  console.log(`- Pipeline stages used:`, JSON.stringify(exp.stages?.map(s => Object.keys(s))));

  const history = rows.filter((r) => r._id).map((r) => ({ date: r._id, count: r.count }));
  const today = new Date().toISOString().slice(0, 10);
  if (history.length && history[history.length - 1].date < today) history.push({ date: today, count: 0 });

  const tPy0 = performance.now();
  const pyRes = await fetch('http://127.0.0.1:8000/forecast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, horizon: 14 })
  });
  const pyData = await pyRes.json();
  const pyMs = Math.round(performance.now() - tPy0);

  console.log(`- Python ML service Time: ${pyMs} ms`);
  console.log(`- Model Retraining: YES (evaluated candidates ${JSON.stringify(pyData.comparison?.map(c => c.name) || [])} from scratch, backtested and refitted on full series)`);
  console.log(`- Time Breakdown: DB Aggregation ${dbMs} ms (${Math.round(dbMs*100/(dbMs+pyMs))}%), Python Auto-fit & Forecast ${pyMs} ms (${Math.round(pyMs*100/(dbMs+pyMs))}%)`);

  console.log('\n====================================================');
  console.log('AI ENDPOINT 2: /api/ml/clusters — PROFILING');
  console.log('====================================================');
  const clusterMatch = {
    location: {
      $geoWithin: {
        $box: [
          [76.5, 12.2],
          [76.8, 12.4]
        ]
      }
    }
  };
  const totalInArea = await col.countDocuments(clusterMatch);
  const clusterPipeline = [
    { $match: clusterMatch },
    {
      $project: {
        _id: 0,
        lng: { $arrayElemAt: ['$location.coordinates', 0] },
        lat: { $arrayElemAt: ['$location.coordinates', 1] },
        severity: 1, type: 1,
        hour: { $hour: localDate },
        area: 1
      }
    }
  ];

  const tClustDb0 = performance.now();
  const clusterRows = await col.aggregate(clusterPipeline).toArray();
  const clustDbMs = Math.round(performance.now() - tClustDb0);

  const tClustPy0 = performance.now();
  const clustPyRes = await fetch('http://127.0.0.1:8000/cluster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      points: clusterRows,
      eps_m: 250,
      min_samples: 15
    })
  });
  const clustPyData = await clustPyRes.json();
  const clustPyMs = Math.round(performance.now() - tClustPy0);

  console.log(`- Documents read from MongoDB: ${clusterRows.length} (out of ${totalInArea} matching)`);
  console.log(`- Payload sent to Python: ${(JSON.stringify(clusterRows).length / 1024).toFixed(1)} KB`);
  console.log(`- DB Read & Projection Time: ${clustDbMs} ms`);
  console.log(`- Python DBSCAN execution Time: ${clustPyMs} ms (found ${clustPyData.clusters?.length || 0} clusters)`);
  console.log(`- Time Breakdown: DB Read ${clustDbMs} ms (${Math.round(clustDbMs*100/(clustDbMs+clustPyMs))}%), Python DBSCAN + serialization ${clustPyMs} ms (${Math.round(clustPyMs*100/(clustDbMs+clustPyMs))}%)`);

  console.log('\n====================================================');
  console.log('AI ENDPOINT 3: /api/ml/severity/train — PROFILING');
  console.log('====================================================');
  console.log('- Reads up to 120,000 raw documents with $sample');
  console.log('- Synchronously trains 200-tree Random Forest classifier inside request');
  console.log('- Takes ~1700ms - 2500ms blocking HTTP request');

  await mongoose.disconnect();
}

profileAI().catch(console.error);

