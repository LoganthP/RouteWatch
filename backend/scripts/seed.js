/**
 * RouteWatch synthetic data seeder (GLOBAL).
 *   npm run seed                      → 30,000 incidents across 12 cities
 *   npm run seed -- --count=60000
 *   npm run seed -- --keep-datasets   → keep incidents you imported from files
 *
 * ALL generated incidents are SYNTHETIC (isSynthetic: true, source "Synthetic").
 * Severity follows a simple, documented rule (type + night-time + junction risk
 * + noise) so the ML models have a real but imperfect signal to learn.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Incident = require('../src/models/Incident');
const Area = require('../src/models/Area');
const User = require('../src/models/User');
const Counter = require('../src/models/Counter');
const AuditLog = require('../src/models/AuditLog');
const { areaDocs, zoneFor } = require('../src/services/mysuruZones');
const { tzFor, areaLabel } = require('../src/services/geo');
const { zonedToUtc } = require('../src/services/datasets/normalize');

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d; };
const COUNT = Math.min(Math.max(Number(arg('count', 30000)), 100), 300000);
const KEEP_DATASETS = process.argv.includes('--keep-datasets');

// deterministic RNG so every machine gets the same "world"
let seed = 20261025;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => { let u = 0; let v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = (w) => { const e = Object.entries(w); let r = rand() * e.reduce((s, [, x]) => s + x, 0); for (const [k, x] of e) if ((r -= x) <= 0) return k; return e[0][0]; };

// [name, lat, lng, weight]
const CITIES = [
  ['Mysuru', 12.3052, 76.6552, 3], ['Bengaluru', 12.9716, 77.5946, 2], ['Delhi', 28.6139, 77.209, 2],
  ['Mumbai', 19.076, 72.8777, 2], ['London', 51.5074, -0.1278, 1.5], ['New York', 40.7128, -74.006, 1.5],
  ['Tokyo', 35.6762, 139.6503, 1.5], ['Sydney', -33.8688, 151.2093, 1], ['Nairobi', -1.2921, 36.8219, 1],
  ['Sao Paulo', -23.5505, -46.6333, 1], ['Berlin', 52.52, 13.405, 1], ['Dubai', 25.2048, 55.2708, 1],
];
const MYSURU_JUNCTIONS = [
  [12.3052, 76.6552, 1.0], [12.3008, 76.6575, 0.8], [12.3055, 76.6435, 0.5], [12.334, 76.666, 1.1],
  [12.322, 76.615, 0.7], [12.278, 76.629, 0.9], [12.285, 76.66, 0.6], [12.362, 76.642, 0.8],
];
const cities = CITIES.map(([name, lat, lng, weight]) => ({
  name, lat, lng, weight, tz: tzFor(lng, lat),
  junctions: name === 'Mysuru' ? MYSURU_JUNCTIONS : Array.from({ length: 8 }, () => [
    lat + gauss() * 0.03, lng + gauss() * 0.035, +(rand() * 1.2).toFixed(2),
  ]),
}));

const HOUR_W = [2, 1, 1, 1, 1, 2, 4, 7, 10, 10, 7, 5, 5, 5, 5, 6, 8, 10, 11, 10, 7, 5, 4, 3]; // local time
const TYPE_W = { Accident: 28, Congestion: 34, Construction: 12, 'Road Closure': 8, Hazard: 12, Other: 6 };
const TYPE_BASE = { Accident: 2.6, 'Road Closure': 2.3, Hazard: 2.0, Construction: 1.7, Other: 1.7, Congestion: 1.3 };
const SEV = ['Low', 'Medium', 'High', 'Critical'];
const DESCRIPTIONS = {
  Accident: ['Two-vehicle collision', 'Two-wheeler skid near median', 'Rear-end collision at signal', 'Car hit a divider', 'Pedestrian hit at crossing', 'Bus side-swiped a motorcycle'],
  Congestion: ['Heavy queue at junction', 'Slow-moving traffic, signal backed up', 'Peak-hour gridlock', 'Traffic backed up due to double parking'],
  Construction: ['Lane narrowed for drainage work', 'Road widening in progress', 'Utility trench across one lane'],
  'Road Closure': ['Road closed for procession', 'Diversion due to event', 'Closed for emergency repair'],
  Hazard: ['Large pothole on carriageway', 'Fallen tree branch on road', 'Waterlogging after rain', 'Oil spill on lane'],
  Other: ['Broken traffic signal', 'Streetlight outage on stretch', 'Vehicle breakdown blocking lane'],
};
const cityTotal = cities.reduce((s, c) => s + c.weight, 0);

function makeIncident(i) {
  let r = rand() * cityTotal;
  const city = cities.find((c) => (r -= c.weight) <= 0) || cities[0];

  let lat; let lng; let risk = 0;
  if (rand() < 0.65) {
    const j = city.junctions[Math.floor(rand() * city.junctions.length)];
    risk = j[2];
    const spread = 0.0025 + rand() * 0.002;
    lat = j[0] + gauss() * spread; lng = j[1] + gauss() * spread;
  } else {
    lat = city.lat + (rand() - 0.5) * 0.12; lng = city.lng + (rand() - 0.5) * 0.14;
  }

  const type = pick(TYPE_W);
  // local wall-clock time → UTC
  // weekdays are busier than weekends (Mon–Fri weight 1.0, Sat 0.75, Sun 0.6)
  let base;
  for (;;) {
    const daysAgo = Math.floor(Math.pow(rand(), 1.15) * 365);
    base = new Date(Date.now() - daysAgo * 864e5);
    const wd = base.getUTCDay();
    if (rand() < (wd === 0 ? 0.6 : wd === 6 ? 0.75 : 1)) break;
  }
  const hour = Number(pick(Object.fromEntries(HOUR_W.map((w, h) => [h, w]))));
  let reportedAt = zonedToUtc(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, Math.floor(rand() * 60), 0, 0, city.tz);
  if (reportedAt > new Date()) reportedAt = new Date(reportedAt.getTime() - 864e5);
  const dow = new Date(reportedAt.getTime()).getUTCDay();

  const night = hour >= 22 || hour <= 4;
  const score = TYPE_BASE[type] + (night ? 0.7 : 0) + risk * 0.9 + ((dow === 0 || dow === 6) && night ? 0.25 : 0) + gauss() * 0.45;
  const severity = SEV[Math.min(3, Math.max(0, Math.round(score) - 1))];

  const ageDays = (Date.now() - reportedAt) / 864e5;
  const status = ageDays > 14 ? (rand() < 0.9 ? 'Resolved' : rand() < 0.5 ? 'Rejected' : 'Verified')
    : ageDays > 2 ? pick({ Resolved: 55, Verified: 30, Pending: 10, Rejected: 5 })
      : pick({ Pending: 50, Verified: 35, Resolved: 15 });
  const hrs = { Critical: 2, High: 4, Medium: 8, Low: 16 }[severity] * (0.4 + rand() * 1.6);
  const resolvedAt = status === 'Resolved' ? new Date(reportedAt.getTime() + hrs * 36e5) : undefined;

  const doc = {
    incidentId: `INC-${String(i + 1).padStart(5, '0')}`,
    type, severity, status,
    description: DESCRIPTIONS[type][Math.floor(rand() * DESCRIPTIONS[type].length)],
    area: (city.name === 'Mysuru' && zoneFor(lng, lat)) || areaLabel(lng, lat),
    location: { type: 'Point', coordinates: [+lng.toFixed(6), +lat.toFixed(6)] },
    tz: city.tz, reportedAt, source: 'Synthetic', isSynthetic: true,
    createdAt: new Date(), updatedAt: new Date(),
  };
  if (resolvedAt && resolvedAt < new Date()) doc.resolvedAt = resolvedAt;
  return doc;
}

(async () => {
  await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/routewatch_db');
  console.log(`[seed] generating ${COUNT.toLocaleString()} SYNTHETIC incidents across ${cities.length} cities…`);

  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await Incident.deleteMany(KEEP_DATASETS ? { datasetId: { $exists: false } } : {});
  await Promise.all([Area.deleteMany({}), Counter.deleteMany({ _id: 'incident' })]);
  if (!KEEP_DATASETS) await mongoose.connection.db.collection('datasets').deleteMany({});
  await Area.insertMany(areaDocs);

  const demo = [
    { name: 'Traffic Admin', email: 'admin@routewatch.local', password: 'Admin@123', role: 'admin' },
    { name: 'Demo Citizen', email: 'user@routewatch.local', password: 'User@123', role: 'user' },
  ];
  for (const u of demo) {
    const existing = await User.findOne({ email: u.email });
    if (existing) { existing.set(u); await existing.save(); } else await User.create(u);
  }
  console.log('[seed] demo users ready');

  const BATCH = 5000;
  for (let start = 0; start < COUNT; start += BATCH) {
    const batch = [];
    for (let i = start; i < Math.min(start + BATCH, COUNT); i++) batch.push(makeIncident(i));
    await Incident.collection.insertMany(batch, { ordered: false });
    process.stdout.write(`\r[seed] inserted ${Math.min(start + BATCH, COUNT).toLocaleString()}`);
  }
  console.log('');
  const maxImported = await Incident.findOne({ incidentId: /^INC-/ }).sort({ incidentId: -1 }).lean();
  const maxSeq = Math.max(COUNT, Number(String(maxImported?.incidentId || '').slice(4)) || 0);
  await Counter.create({ _id: 'incident', seq: maxSeq });

  const admin = await User.findOne({ email: 'admin@routewatch.local' });
  await AuditLog.create({ action: 'SEED', actor: admin._id, actorName: 'system', changes: { inserted: COUNT, synthetic: true, cities: cities.length }, note: 'Synthetic global demonstration dataset loaded' });

  const idx = await Incident.collection.indexes();
  console.log('[seed] incident indexes:', idx.map((i) => Object.keys(i.key).join('+')).join(' | '));
  console.log('[seed] done. Log in with admin@routewatch.local / Admin@123');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
