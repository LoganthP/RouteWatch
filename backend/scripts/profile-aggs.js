const mongoose = require('mongoose');
const Incident = require('../src/models/Incident');

async function testPerf() {
  await mongoose.connect('mongodb://127.0.0.1:27017/routewatch_db');
  const count = await Incident.estimatedDocumentCount();
  console.log('Testing aggregation timings on', count, 'documents...');

  // 1. bySeverity
  console.time('bySeverity');
  const sev = await Incident.aggregate([
    { $group: { _id: '$severity', total: { $sum: 1 } } }
  ]).allowDiskUse(true);
  console.timeEnd('bySeverity');
  console.log('bySeverity:', sev);

  // 2. byStatus
  console.time('byStatus');
  const st = await Incident.aggregate([
    { $group: { _id: '$status', total: { $sum: 1 } } }
  ]).allowDiskUse(true);
  console.timeEnd('byStatus');

  // 3. byType
  console.time('byType');
  const tp = await Incident.aggregate([
    { $group: { _id: '$type', total: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: 10 }
  ]).allowDiskUse(true);
  console.timeEnd('byType');

  // 4. Temporal month with $project
  console.time('temporal-month');
  const temp = await Incident.aggregate([
    { $project: { reportedAt: 1, severity: 1 } },
    { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$reportedAt' } },
        total: { $sum: 1 }
    }},
    { $sort: { _id: 1 } }
  ]).allowDiskUse(true);
  console.timeEnd('temporal-month');
  console.log('temporal rows:', temp.length);

  // 5. Areas
  console.time('areas');
  const ar = await Incident.aggregate([
    { $project: { area: 1, severity: 1 } },
    { $group: { _id: '$area', total: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: 15 }
  ]).allowDiskUse(true);
  console.timeEnd('areas');
  console.log('areas:', ar.length);

  process.exit(0);
}
testPerf();
