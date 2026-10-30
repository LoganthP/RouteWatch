const router = require('express').Router();
const Incident = require('../models/Incident');
const Dataset = require('../models/Dataset');
const { temporal } = require('../services/analytics');
const swrCache = require('../utils/swrCache');
const { asyncHandler } = require('../middleware/error');

/**
 * Public unauthenticated endpoints for RouteWatch landing page.
 * Cached for 5 minutes (300,000 ms).
 * Aggregated, non-personal data only.
 */
router.get('/stats', asyncHandler(async (_req, res) => {
  const cacheKey = 'public:landing:stats';

  const data = await swrCache.getOrRevalidate(cacheKey, async () => {
    // 1. Total incidents
    let totalIncidents = 0;
    try {
      totalIncidents = await Incident.estimatedDocumentCount();
      if (!totalIncidents) {
        totalIncidents = await Incident.countDocuments();
      }
    } catch {
      totalIncidents = await Incident.countDocuments().catch(() => 0);
    }

    // 2. Areas / countries covered
    let areasCovered = 0;
    try {
      const distinctAreas = await Incident.distinct('area');
      areasCovered = distinctAreas.filter(Boolean).length;
    } catch {
      areasCovered = 0;
    }

    // 3. Datasets imported
    let datasetsImported = 0;
    try {
      datasetsImported = await Dataset.countDocuments({ status: 'completed' });
      if (datasetsImported === 0) {
        datasetsImported = await Dataset.countDocuments();
      }
    } catch {
      datasetsImported = 0;
    }

    // 4. Most common incident hour
    let mostCommonHour = null;
    let mostCommonHourFormatted = '—';
    try {
      const hourly = await temporal({ granularity: 'hour' });
      if (hourly?.series?.length) {
        let maxRow = hourly.series[0];
        for (const row of hourly.series) {
          if ((row.total || 0) > (maxRow.total || 0)) {
            maxRow = row;
          }
        }
        if (maxRow && maxRow.total > 0) {
          mostCommonHourFormatted = maxRow.label; // e.g. "17:00"
          const parsedH = parseInt(maxRow.label.split(':')[0], 10);
          mostCommonHour = isNaN(parsedH) ? 17 : parsedH;
        }
      }
    } catch {
      mostCommonHour = 17;
      mostCommonHourFormatted = '17:00';
    }

    // 5. Recent anonymised incidents for ticker
    let recentTicker = [];
    try {
      recentTicker = await Incident.find(
        {},
        { _id: 1, type: 1, area: 1, severity: 1, reportedAt: 1 }
      )
        .sort({ reportedAt: -1 })
        .limit(20)
        .lean();
    } catch {
      recentTicker = [];
    }

    return {
      totalIncidents,
      areasCovered,
      datasetsImported,
      mostCommonHour,
      mostCommonHourFormatted,
      recentTicker: (recentTicker || []).map((item) => ({
        id: item._id,
        type: item.type,
        area: item.area || 'Unknown area',
        severity: item.severity,
        reportedAt: item.reportedAt,
      })),
      cachedAt: new Date().toISOString(),
    };
  }, 300000, 600000); // 5 min fresh, 10 min max

  // HTTP Cache-Control header for 5 minutes
  res.set('Cache-Control', 'public, max-age=300');
  res.json(data);
}));

/* Standalone ticker endpoint for convenience */
router.get('/ticker', asyncHandler(async (_req, res) => {
  const cacheKey = 'public:landing:ticker';
  const data = await swrCache.getOrRevalidate(cacheKey, async () => {
    const items = await Incident.find(
      {},
      { _id: 1, type: 1, area: 1, severity: 1, reportedAt: 1 }
    )
      .sort({ reportedAt: -1 })
      .limit(30)
      .lean();
    return items.map((i) => ({
      id: i._id,
      type: i.type,
      area: i.area || 'Unknown area',
      severity: i.severity,
      reportedAt: i.reportedAt,
    }));
  }, 120000, 300000);

  res.set('Cache-Control', 'public, max-age=120');
  res.json(data);
}));

module.exports = router;

