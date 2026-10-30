const { SummaryOverview, SummaryMapGrid } = require('../models/Summary');
const Incident = require('../models/Incident');
const DashboardStats = require('../models/DashboardStats');
const swrCache = require('../utils/swrCache');
const { SEVERITIES, TZ_EXPR } = require('../config/constants');
const { cellSize, sevCounters } = require('./analytics');

const LNG = { $arrayElemAt: ['$location.coordinates', 0] };
const LAT = { $arrayElemAt: ['$location.coordinates', 1] };
const sevWeightExpr = {
  $switch: {
    branches: [
      { case: { $eq: ['$severity', 'Critical'] }, then: 4 },
      { case: { $eq: ['$severity', 'High'] }, then: 3 },
      { case: { $eq: ['$severity', 'Medium'] }, then: 2 },
    ],
    default: 1,
  },
};

/** Precompute grid clusters for a given zoom level */
async function precomputeGrid(zoom, bandId) {
  const cell = cellSize({ zoom });
  const clusters = await Incident.aggregate([
    {
      $group: {
        _id: {
          x: { $floor: { $divide: [LNG, cell] } },
          y: { $floor: { $divide: [LAT, cell] } },
        },
        count: { $sum: 1 },
        lng: { $avg: LNG },
        lat: { $avg: LAT },
        critical: { $sum: { $cond: [{ $eq: ['$severity', 'Critical'] }, 1, 0] } },
        high: { $sum: { $cond: [{ $eq: ['$severity', 'High'] }, 1, 0] } },
        medium: { $sum: { $cond: [{ $eq: ['$severity', 'Medium'] }, 1, 0] } },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 3000 },
  ]).option({ maxTimeMS: 10000, allowDiskUse: true });

  const items = clusters.map((c) => {
    const low = c.count - c.critical - c.high - c.medium;
    const counts = { Low: low, Medium: c.medium, High: c.high, Critical: c.critical };
    const dominant = SEVERITIES.reduce((a, b) => (counts[b] >= counts[a] ? b : a), 'Low');
    return { lng: c.lng, lat: c.lat, count: c.count, severity: dominant, critical: c.critical };
  });

  const total = items.reduce((s, c) => s + c.count, 0);

  await SummaryMapGrid.findByIdAndUpdate(
    bandId,
    { zoomBand: bandId, cell, items, total, updatedAt: new Date() },
    { upsert: true, new: true }
  );

  return { mode: 'clusters', items, total };
}

/** Precompute summary statistics across all collections */
async function refreshSummaries() {
  const analytics = require('./analytics');
  const t0 = Date.now();

  // 1. Run core analytics in parallel
  const [sum, trMonth, trHour, trDow, trDay, trWeekhour, ar, sev, bnds, hspots] = await Promise.all([
    analytics.summary({}),
    analytics.temporal({ granularity: 'month' }),
    analytics.temporal({ granularity: 'hour' }),
    analytics.temporal({ granularity: 'dayOfWeek' }),
    analytics.temporal({ granularity: 'day' }),
    analytics.temporal({ granularity: 'weekhour' }),
    analytics.areas({ limit: 20 }),
    analytics.severity({}),
    analytics.bounds({}),
    analytics.hotspots({ limit: 40 }),
  ]);

  // 2. Precompute map grid for macro and regional bands
  const [gridLow, gridMid] = await Promise.all([
    precomputeGrid(4, 'grid_low'),
    precomputeGrid(8, 'grid_mid'),
  ]);

  // 3. Persist summary_overview
  const overviewDoc = {
    summary: sum,
    temporal: {
      month: trMonth,
      hour: trHour,
      dayOfWeek: trDow,
      day: trDay,
      weekhour: trWeekhour,
    },
    areas: ar,
    severity: sev,
    bounds: bnds,
    hotspots: hspots,
    updatedAt: new Date(),
  };

  await SummaryOverview.findByIdAndUpdate('global', overviewDoc, { upsert: true, new: true });

  // 4. Update DashboardStats
  const rec = await Incident.find({}, {
    _id: 1, incidentId: 1, type: 1, severity: 1, status: 1, area: 1, location: 1, reportedAt: 1, description: 1,
  }).sort({ reportedAt: -1 }).limit(6).lean();

  await DashboardStats.findByIdAndUpdate(
    'global',
    {
      summary: sum,
      trend: trMonth,
      heat: await analytics.heatmap({ limit: 5000 }),
      extent: bnds,
      hot: hspots,
      areas: ar.slice(0, 5),
      recent: { items: rec, total: sum.total },
      updatedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  // 5. Populate SWR Cache with fresh precomputed data
  swrCache.set('summary:{}', sum, 120000, 600000);
  swrCache.set('temporal:{"granularity":"month"}', trMonth, 120000, 600000);
  swrCache.set('temporal:{"granularity":"hour"}', trHour, 120000, 600000);
  swrCache.set('temporal:{"granularity":"dayOfWeek"}', trDow, 120000, 600000);
  swrCache.set('temporal:{"granularity":"day"}', trDay, 120000, 600000);
  swrCache.set('temporal:{"granularity":"weekhour"}', trWeekhour, 120000, 600000);
  swrCache.set('areas:{}', ar, 120000, 600000);
  swrCache.set('severity:{}', sev, 120000, 600000);
  swrCache.set('bounds:{}', bnds, 120000, 600000);
  swrCache.set('map_grid:grid_low', gridLow, 120000, 600000);
  swrCache.set('map_grid:grid_mid', gridMid, 120000, 600000);

  console.log(`[summary] summaries & caches warmed in ${Date.now() - t0} ms`);
}

/** Get precomputed map grid or return null if zoom requires live query */
async function getMapGrid(zoom, hasFilters = false) {
  if (hasFilters) return null;
  const band = zoom < 6 ? 'grid_low' : zoom < 12 ? 'grid_mid' : null;
  if (!band) return null;

  return swrCache.getOrRevalidate(`map_grid:${band}`, async () => {
    const doc = await SummaryMapGrid.findById(band).lean();
    if (doc && doc.items?.length) {
      return { mode: 'clusters', items: doc.items, total: doc.total };
    }
    return precomputeGrid(zoom < 6 ? 4 : 8, band);
  }, 120000, 600000);
}

/** Get precomputed overview from SWR cache or DB */
async function getOverview() {
  return swrCache.getOrRevalidate('summary_overview', async () => {
    const doc = await SummaryOverview.findById('global').lean();
    return doc;
  }, 120000, 600000);
}

/** Triggered when an incident is created/updated/deleted or imported */
let refreshTimer = null;
function notifyIncidentChanged() {
  swrCache.invalidate(); // Mark in-memory caches stale
  // Debounce summary refresh by 2 seconds
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshSummaries().catch((e) => console.error('[summary] background refresh error:', e.message));
  }, 2000);
}

module.exports = {
  refreshSummaries,
  getMapGrid,
  getOverview,
  notifyIncidentChanged,
};

