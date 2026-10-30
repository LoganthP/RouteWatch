/**
 * One-time upgrade for databases created by RouteWatch v1:
 * fills the per-incident time zone and replaces the old "Outer Mysuru" area label.
 *   npm run backfill
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Incident = require('../src/models/Incident');
const { tzFor, areaLabel } = require('../src/services/geo');

(async () => {
  await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/routewatch_db');
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  const cursor = Incident.find({ $or: [{ tz: { $exists: false } }, { tz: null }, { area: 'Outer Mysuru' }] }, { location: 1, area: 1 }).lean().cursor();
  let ops = []; let n = 0;
  for await (const d of cursor) {
    const [lng, lat] = d.location.coordinates;
    const set = { tz: tzFor(lng, lat) };
    if (d.area === 'Outer Mysuru' || !d.area) set.area = areaLabel(lng, lat);
    ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: set } } });
    if (ops.length === 2000) { await Incident.bulkWrite(ops, { ordered: false }); n += ops.length; ops = []; process.stdout.write(`\r[backfill] ${n}`); }
  }
  if (ops.length) { await Incident.bulkWrite(ops, { ordered: false }); n += ops.length; }
  console.log(`\n[backfill] updated ${n} incidents`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
