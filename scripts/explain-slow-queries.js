const path = require('path');
const mongoose = require(path.resolve('backend/node_modules/mongoose'));

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/routewatch_db');
  const db = mongoose.connection.db;
  const col = db.collection('incidents');

  console.log('=== 1. Find reportedAt:-1 explain ===');
  const f = await col.find({}).sort({ reportedAt: -1 }).limit(6).explain('executionStats');
  console.log('Find stage:', f.executionStats?.executionStages?.stage);
  console.log('Docs examined:', f.executionStats?.totalDocsExamined, 'Returned:', f.executionStats?.nReturned);
  console.log('Execution time ms:', f.executionStats?.executionTimeMillis);
  console.log('Index:', f.executionStats?.executionStages?.inputStage?.indexName || 'reportedAt_1 or none');

  console.log('\n=== 2. Summary Aggregation explain ===');
  const s = await col.aggregate([
    {
      $facet: {
        total: [{ $count: 'n' }],
        highSeverity: [{ $match: { severity: { $in: ['High', 'Critical'] } } }, { $count: 'n' }],
        active: [{ $match: { status: { $in: ['Pending', 'Verified'] } } }, { $count: 'n' }]
      }
    }
  ], { explain: true });
  console.log('Summary explain stages count:', s.stages?.length || 1);
  const cursorStage = s.stages?.[0]?.['$cursor'];
  console.log('Cursor stage executionStats:', cursorStage?.executionStats || 'in-memory pipeline');

  console.log('\n=== 3. Temporal (month) Aggregation explain ===');
  const t = await col.aggregate([
    {
      $group: {
        _id: { $month: '$reportedAt' },
        count: { $sum: 1 }
      }
    }
  ], { explain: true });
  console.log('Temporal stages:', t.stages?.map(st => Object.keys(st)));

  await mongoose.disconnect();
}

run().catch(console.error);
