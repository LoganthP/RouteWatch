const mongoose = require('mongoose');
const Incident = require('../models/Incident');

/** Walks an explain plan and returns the stage chain, e.g. "FETCH › IXSCAN". */
function stageChain(plan) {
  const out = [];
  let node = plan?.queryPlan || plan;
  while (node) {
    if (node.stage) out.push(node.stage);
    node = node.inputStage || (node.inputStages && node.inputStages[0]) || node.queryPlan;
  }
  return out.join(' › ') || 'unknown';
}

function shape(label, explain) {
  const es = explain.executionStats || {};
  return {
    label,
    stages: stageChain(explain.queryPlanner?.winningPlan),
    nReturned: es.nReturned,
    docsExamined: es.totalDocsExamined,
    keysExamined: es.totalKeysExamined,
    timeMs: es.executionTimeMillis,
    usedIndex: /IXSCAN|GEO_NEAR/.test(stageChain(explain.queryPlanner?.winningPlan)),
  };
}

/**
 * Runs the same logical query with and without index support and returns
 * MongoDB explain("executionStats") metrics for comparison.
 */
async function compare({ lng = 76.6394, lat = 12.2958, radius = 2000 } = {}) {
  // use the native driver collection so explain()/hint() behave exactly like the shell
  const coll = mongoose.connection.db.collection(Incident.collection.collectionName);
  const total = await coll.estimatedDocumentCount();
  const radians = radius / 6378100; // Earth radius in metres
  const within = { location: { $geoWithin: { $centerSphere: [[lng, lat], radians] } } };
  const near = {
    location: { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radius } },
  };
  const attr = { severity: 'Critical', status: 'Pending' };

  // warm-up so the first measurement isn't penalised by cold cache
  await coll.find(within).limit(1).toArray();

  // run sequentially so timings don't compete with each other
  const nearIdx = await coll.find(near).explain('executionStats');
  const withinIdx = await coll.find(within).explain('executionStats');
  const withinScan = await coll.find(within).hint({ $natural: 1 }).explain('executionStats');
  const attrIdx = await coll.find(attr).explain('executionStats');
  const attrScan = await coll.find(attr).hint({ $natural: 1 }).explain('executionStats');

  return {
    collectionSize: total,
    params: { lng, lat, radius },
    geo: [
      shape('$near with 2dsphere index', nearIdx),
      shape('$geoWithin with 2dsphere index', withinIdx),
      shape('$geoWithin forced collection scan', withinScan),
    ],
    attribute: [
      shape('severity + status with compound index', attrIdx),
      shape('severity + status forced collection scan', attrScan),
    ],
  };
}

module.exports = { compare };
