/**
 * Prints explain("executionStats") comparisons for indexed vs collection-scan queries.
 * Usage: npm run benchmark
 *        npm run benchmark -- --lng=76.6552 --lat=12.3052 --radius=2000
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const { compare } = require('../src/services/performance');

const arg = (n, d) => Number((process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1]) || d;

(async () => {
  await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/routewatch_db');
  const r = await compare({ lng: arg('lng', 76.6552), lat: arg('lat', 12.3052), radius: arg('radius', 2000) });
  console.log(`\nCollection size: ${r.collectionSize.toLocaleString()} documents`);
  console.log(`Point [${r.params.lng}, ${r.params.lat}]  radius ${r.params.radius} m\n`);
  const row = (x) => ({
    query: x.label, plan: x.stages, returned: x.nReturned, docsExamined: x.docsExamined,
    keysExamined: x.keysExamined, ms: x.timeMs,
  });
  console.log('Geospatial queries');
  console.table(r.geo.map(row));
  console.log('Attribute filter (severity=Critical, status=Pending)');
  console.table(r.attribute.map(row));
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
