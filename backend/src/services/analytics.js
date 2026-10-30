const Incident = require('../models/Incident');
const { buildMatch } = require('../utils/filters');
const { SEVERITIES, TZ_EXPR } = require('../config/constants');
const { parseBbox } = require('./geo');
const swrCache = require('../utils/swrCache');

const countOf = (arr) => (arr && arr[0] ? arr[0].n : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function getCached(key) {
  const item = swrCache.get(key);
  return item ? item.data : null;
}

function setCached(key, data) {
  swrCache.set(key, data, 60000, 300000);
}

function clearCache() {
  swrCache.clear();
}

// $sum of 1 when severity === s
const sevCounters = () =>
  Object.fromEntries(SEVERITIES.map((s) => [s.toLowerCase(), { $sum: { $cond: [{ $eq: ['$severity', s] }, 1, 0] } }]));

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

const LNG = { $arrayElemAt: ['$location.coordinates', 0] };
const LAT = { $arrayElemAt: ['$location.coordinates', 1] };

/** Cell size in degrees: explicit `cell`, else ~40 columns across the viewport, else by zoom. */
function cellSize(q) {
  if (q.cell && Number(q.cell) > 0) return clamp(Number(q.cell), 0.0005, 10);
  const b = parseBbox(q.bbox);
  if (b) {
    const width = b.w <= b.e ? b.e - b.w : 360 - (b.w - b.e);
    return clamp(width / 40, 0.001, 10);
  }
  if (q.zoom !== undefined && Number.isFinite(Number(q.zoom))) return clamp(360 / 2 ** Number(q.zoom) / 6, 0.001, 10);
  return 0.005;
}

/* ---------------- Hotspots: grid-cell density (statistical baseline) ---------------- */
async function hotspots(q = {}) {
  const cacheKey = 'hotspots:' + JSON.stringify(q);

  return swrCache.getOrRevalidate(cacheKey, async () => {
    const match = buildMatch(q);
    const cell = cellSize(q);
    const limit = clamp(Number(q.limit) || 300, 1, 2000);

    const cells = await Incident.aggregate([
      { $match: match },
      {
        $project: {
          severity: 1, area: 1,
          x: { $floor: { $divide: [LNG, cell] } },
          y: { $floor: { $divide: [LAT, cell] } },
        },
      },
      {
        $group: {
          _id: { x: '$x', y: '$y' },
          count: { $sum: 1 },
          score: { $sum: sevWeightExpr },
          ...sevCounters(),
          areas: { $addToSet: '$area' },
        },
      },
      { $sort: { count: -1 } },
    ]).option({ maxTimeMS: 10000, allowDiskUse: true });

    const n = cells.length || 1;
    const mean = cells.reduce((s, c) => s + c.count, 0) / n;
    const std = Math.sqrt(cells.reduce((s, c) => s + (c.count - mean) ** 2, 0) / n);
    const threshold = Math.max(5, Math.ceil(mean + 2 * std)); // hotspot = >2σ above mean density

    return {
      cellSizeDeg: +cell.toFixed(5),
      cellSizeKm: +(cell * 111.32).toFixed(2),
      totalCells: cells.length,
      mean: +mean.toFixed(2),
      stdDev: +std.toFixed(2),
      threshold,
      hotspotCount: cells.filter((c) => c.count >= threshold).length,
      cells: cells.slice(0, limit).map((c) => ({
        center: [(c._id.x + 0.5) * cell, (c._id.y + 0.5) * cell], // [lng, lat]
        bounds: [[c._id.y * cell, c._id.x * cell], [(c._id.y + 1) * cell, (c._id.x + 1) * cell]],
        count: c.count,
        score: c.score,
        severity: { low: c.low, medium: c.medium, high: c.high, critical: c.critical },
        areas: c.areas.slice(0, 3),
        isHotspot: c.count >= threshold,
      })),
    };
  }, 60000, 300000);
}

/* ---------------- Summary (dashboard cards) ---------------- */
async function summary(q = {}) {
  const match = buildMatch(q);
  const isUnfiltered = Object.keys(match).length === 0;
  const cacheKey = 'summary:' + JSON.stringify(q);

  return swrCache.getOrRevalidate(cacheKey, async () => {
    if (isUnfiltered) {
      try {
        const { SummaryOverview } = require('../models/Summary');
        const doc = await SummaryOverview.findById('global').lean();
        if (doc && doc.summary && doc.summary.total > 0) {
          return doc.summary;
        }
      } catch (_) {}
    }

    let estimatedTotal = null;
    if (isUnfiltered) {
      try {
        estimatedTotal = await Incident.estimatedDocumentCount();
      } catch {
        estimatedTotal = null;
      }
    }
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const [r] = await Incident.aggregate([
      { $match: match },
      {
        $facet: {
          total: [{ $count: 'n' }],
          highSeverity: [{ $match: { severity: { $in: ['High', 'Critical'] } } }, { $count: 'n' }],
          active: [{ $match: { status: { $in: ['Pending', 'Verified'] } } }, { $count: 'n' }],
          pending: [{ $match: { status: 'Pending' } }, { $count: 'n' }],
          lastWeek: [{ $match: { reportedAt: { $gte: weekAgo } } }, { $count: 'n' }],
          bySeverity: [{ $group: { _id: '$severity', total: { $sum: 1 } } }],
          byStatus: [{ $group: { _id: '$status', total: { $sum: 1 } } }],
          byType: [{ $group: { _id: '$type', total: { $sum: 1 } } }, { $sort: { total: -1 } }],
          avgResolution: [
            { $match: { status: 'Resolved', resolvedAt: { $type: 'date' } } },
            { $group: { _id: null, ms: { $avg: { $subtract: ['$resolvedAt', '$reportedAt'] } } } },
          ],
        },
      },
    ]).option({ maxTimeMS: 10000, allowDiskUse: true });

    const toMap = (a) => Object.fromEntries((a || []).map((x) => [x._id, x.total]));
    const sevMap = toMap(r?.bySeverity);

    let hotspotZones = 0;
    try {
      const hs = await hotspots({ ...q, limit: 100 });
      hotspotZones = hs.hotspotCount;
    } catch {
      hotspotZones = 0;
    }

    const total = estimatedTotal !== null ? estimatedTotal : countOf(r?.total);

    return {
      total,
      highSeverity: countOf(r?.highSeverity),
      active: countOf(r?.active),
      pending: countOf(r?.pending),
      lastWeek: countOf(r?.lastWeek),
      hotspotZones,
      avgResolutionHours: r?.avgResolution?.[0] ? +(r.avgResolution[0].ms / 36e5).toFixed(1) : null,
      bySeverity: SEVERITIES.map((s) => ({ severity: s, total: sevMap[s] || 0 })),
      byStatus: toMap(r?.byStatus),
      byType: (r?.byType || []).map((x) => ({ type: x._id, total: x.total })),
    };
  }, 60000, 300000);
}

/* ---------------- Temporal analytics (each incident in its own local time) ---------------- */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function temporal(q = {}) {
  const match = buildMatch(q);
  const isUnfiltered = Object.keys(match).length === 0;
  const g = ['hour', 'dayOfWeek', 'month', 'day', 'weekhour'].includes(q.granularity) ? q.granularity : 'month';
  const cacheKey = `temporal:${g}:` + JSON.stringify(q);

  return swrCache.getOrRevalidate(cacheKey, async () => {
    if (isUnfiltered) {
      try {
        const { SummaryOverview } = require('../models/Summary');
        const doc = await SummaryOverview.findById('global').lean();
        if (doc && doc.temporal && doc.temporal[g]) {
          return doc.temporal[g];
        }
      } catch (_) {}
    }

    const date = { date: '$reportedAt', timezone: TZ_EXPR };

    if (g === 'weekhour') {
      const rows = await Incident.aggregate([
        { $match: match },
        { $group: { _id: { d: { $dayOfWeek: date }, h: { $hour: date } }, total: { $sum: 1 } } },
      ]).option({ maxTimeMS: 10000, allowDiskUse: true });
      const grid = DAYS.map((day) => ({ day, hours: Array(24).fill(0) }));
      rows.forEach((r) => { if (grid[r._id.d - 1]) grid[r._id.d - 1].hours[r._id.h] = r.total; });
      return { granularity: g, grid, max: rows.reduce((m, r) => Math.max(m, r.total), 0) };
    }

    const keyExpr =
      g === 'hour' ? { $hour: date }
      : g === 'dayOfWeek' ? { $dayOfWeek: date }
      : g === 'day' ? { $dateToString: { format: '%Y-%m-%d', ...date } }
      : { $dateToString: { format: '%Y-%m', ...date } };

    const rows = await Incident.aggregate([
      { $match: match },
      { $group: { _id: keyExpr, total: { $sum: 1 }, ...sevCounters() } },
      { $sort: { _id: 1 } },
    ]).option({ maxTimeMS: 10000, allowDiskUse: true });

    const blank = (label) => ({ label, total: 0, low: 0, medium: 0, high: 0, critical: 0 });
    const shape = (r, label) => ({ label, total: r.total, low: r.low, medium: r.medium, high: r.high, critical: r.critical });
    let series;
    if (g === 'hour') {
      const m = Object.fromEntries(rows.map((r) => [r._id, r]));
      series = Array.from({ length: 24 }, (_, h) => {
        const label = `${String(h).padStart(2, '0')}:00`;
        return m[h] ? shape(m[h], label) : blank(label);
      });
    } else if (g === 'dayOfWeek') {
      const m = Object.fromEntries(rows.map((r) => [r._id, r]));
      series = DAYS.map((d, i) => (m[i + 1] ? shape(m[i + 1], d) : blank(d)));
    } else {
      series = rows.filter((r) => r._id).map((r) => shape(r, r._id));
    }
    return { granularity: g, series, note: 'Hours and days are in each incident’s local time zone.' };
  }, 60000, 300000);
}

/* ---------------- Severity analytics ---------------- */
async function severity(q = {}) {
  const match = buildMatch(q);
  const isUnfiltered = Object.keys(match).length === 0;
  const cacheKey = 'severity:' + JSON.stringify(q);

  return swrCache.getOrRevalidate(cacheKey, async () => {
    if (isUnfiltered) {
      try {
        const { SummaryOverview } = require('../models/Summary');
        const doc = await SummaryOverview.findById('global').lean();
        if (doc && doc.severity) {
          return doc.severity;
        }
      } catch (_) {}
    }

    const [r] = await Incident.aggregate([
      { $match: match },
      {
        $facet: {
          distribution: [{ $group: { _id: '$severity', total: { $sum: 1 } } }],
          byType: [{ $group: { _id: '$type', total: { $sum: 1 }, ...sevCounters() } }, { $sort: { total: -1 } }],
        },
      },
    ]).option({ maxTimeMS: 10000, allowDiskUse: true });

    const dist = Object.fromEntries((r?.distribution || []).map((d) => [d._id, d.total]));
    return {
      distribution: SEVERITIES.map((s) => ({ severity: s, total: dist[s] || 0 })),
      byType: (r?.byType || []).map((t) => ({ type: t._id, total: t.total, low: t.low, medium: t.medium, high: t.high, critical: t.critical })),
    };
  }, 60000, 300000);
}

/* ---------------- Area ranking + dynamic area list ---------------- */
async function areas(q = {}) {
  const match = buildMatch(q);
  const isUnfiltered = Object.keys(match).length === 0;
  const limit = clamp(Number(q.limit) || 15, 1, 500);
  const cacheKey = `areas:${limit}:` + JSON.stringify(q);

  return swrCache.getOrRevalidate(cacheKey, async () => {
    if (isUnfiltered) {
      try {
        const { SummaryOverview } = require('../models/Summary');
        const doc = await SummaryOverview.findById('global').lean();
        if (doc && doc.areas && doc.areas.length) {
          return doc.areas.slice(0, limit);
        }
      } catch (_) {}
    }

    const rows = await Incident.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$area',
          total: { $sum: 1 },
          ...sevCounters(),
          riskScore: { $sum: sevWeightExpr },
          lng: { $avg: LNG }, lat: { $avg: LAT },
          w: { $min: LNG }, e: { $max: LNG }, s: { $min: LAT }, n: { $max: LAT },
          resolvedMs: {
            $avg: {
              $cond: [
                { $and: [{ $eq: ['$status', 'Resolved'] }, { $eq: [{ $type: '$resolvedAt' }, 'date'] }] },
                { $subtract: ['$resolvedAt', '$reportedAt'] },
                null,
              ],
            },
          },
        },
      },
      { $sort: { total: -1 } },
      { $limit: limit },
    ]).option({ maxTimeMS: 10000, allowDiskUse: true });

    return rows.map((r) => ({
      area: r._id || 'Unassigned',
      total: r.total,
      low: r.low, medium: r.medium, high: r.high, critical: r.critical,
      riskScore: r.riskScore,
      avgSeverity: r.total ? +(r.riskScore / r.total).toFixed(2) : 0,
      avgResolutionHours: r.resolvedMs ? +(r.resolvedMs / 36e5).toFixed(1) : null,
      center: [r.lng, r.lat],
      bbox: [r.w, r.s, r.e, r.n],
    }));
  }, 60000, 300000);
}

/* ---------------- Heatmap points (Grid aggregation, <5000 cells, <500 KB) ---------------- */
async function heatmap(q = {}) {
  const cacheKey = 'heatmap:' + JSON.stringify(q);

  return swrCache.getOrRevalidate(cacheKey, async () => {
    const match = buildMatch(q);
    const cell = cellSize(q);
    const limit = clamp(Number(q.limit) || 5000, 1, 5000);

    const grid = await Incident.aggregate([
      { $match: match },
      {
        $project: {
          severity: 1,
          x: { $floor: { $divide: [LNG, cell] } },
          y: { $floor: { $divide: [LAT, cell] } },
        },
      },
      {
        $group: {
          _id: { x: '$x', y: '$y' },
          weight: { $sum: sevWeightExpr },
          count: { $sum: 1 },
        },
      },
      { $sort: { weight: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          lat: { $round: [{ $add: [{ $multiply: ['$_id.y', cell] }, cell / 2] }, 5] },
          lon: { $round: [{ $add: [{ $multiply: ['$_id.x', cell] }, cell / 2] }, 5] },
          weight: { $min: [1, { $round: [{ $divide: ['$weight', 10] }, 2] }] },
        },
      },
    ]).option({ maxTimeMS: 10000, allowDiskUse: true });

    return grid.map((g) => [g.lat, g.lon, Math.max(0.25, g.weight)]);
  }, 60000, 300000);
}

/* ---------------- Data extent (for "fit to data") ---------------- */
async function bounds(q = {}) {
  const match = buildMatch(q);
  const isUnfiltered = Object.keys(match).length === 0;
  const cacheKey = 'bounds:' + JSON.stringify(q);

  return swrCache.getOrRevalidate(cacheKey, async () => {
    if (isUnfiltered) {
      try {
        const { SummaryOverview } = require('../models/Summary');
        const doc = await SummaryOverview.findById('global').lean();
        if (doc && doc.bounds) {
          return doc.bounds;
        }
      } catch (_) {}
    }

    const [r] = await Incident.aggregate([
      { $match: match },
      {
        $group: {
          _id: null, count: { $sum: 1 },
          w: { $min: LNG }, e: { $max: LNG }, s: { $min: LAT }, n: { $max: LAT },
          lng: { $avg: LNG }, lat: { $avg: LAT },
        },
      },
    ]).option({ maxTimeMS: 10000, allowDiskUse: true });

    if (!r || !r.count) return { count: 0, bbox: null, center: null };
    return { count: r.count, bbox: [r.w, r.s, r.e, r.n], center: [r.lng, r.lat] };
  }, 60000, 300000);
}

/* ---------------- Precomputed dashboard stats ---------------- */
const DashboardStats = require('../models/DashboardStats');

async function precomputeDashboardStats() {
  const [sum, tr, ht, ext, hspots, ar, rec] = await Promise.all([
    summary({}),
    temporal({ granularity: 'month' }),
    heatmap({ limit: 5000 }),
    bounds({}),
    hotspots({ limit: 40 }),
    areas({ limit: 5 }),
    Incident.find({}, {
      _id: 1, incidentId: 1, type: 1, severity: 1, status: 1, area: 1, location: 1, reportedAt: 1, description: 1,
    }).sort({ reportedAt: -1 }).limit(6).lean(),
  ]);

  const doc = await DashboardStats.findByIdAndUpdate(
    'global',
    {
      summary: sum,
      trend: tr,
      heat: ht,
      extent: ext,
      hot: hspots,
      areas: ar,
      recent: { items: rec, total: sum.total },
      updatedAt: new Date(),
    },
    { upsert: true, new: true }
  ).lean();

  return doc;
}

async function getDashboardStats() {
  let doc = await DashboardStats.findById('global').lean();
  if (!doc || !doc.summary) {
    doc = await precomputeDashboardStats();
  }
  return doc;
}

module.exports = {
  summary,
  hotspots,
  temporal,
  severity,
  areas,
  heatmap,
  bounds,
  cellSize,
  sevCounters,
  clearCache,
  precomputeDashboardStats,
  getDashboardStats,
};
