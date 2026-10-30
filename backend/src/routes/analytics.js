const router = require('express').Router();
const { asyncHandler } = require('../middleware/error');
const A = require('../services/analytics');
const { compare } = require('../services/performance');
const { parseLngLat } = require('../utils/validate');

router.get('/dashboard', asyncHandler(async (_req, res) => res.json(await A.getDashboardStats())));
router.get('/summary', asyncHandler(async (req, res) => res.json(await A.summary(req.query))));
router.get('/hotspots', asyncHandler(async (req, res) => res.json(await A.hotspots(req.query))));
router.get('/temporal', asyncHandler(async (req, res) => res.json(await A.temporal(req.query))));
router.get('/severity', asyncHandler(async (req, res) => res.json(await A.severity(req.query))));
router.get('/areas', asyncHandler(async (req, res) => res.json(await A.areas(req.query))));
router.get('/heatmap', asyncHandler(async (req, res) => res.json(await A.heatmap(req.query))));
router.get('/bounds', asyncHandler(async (req, res) => res.json(await A.bounds(req.query))));

/* GET /api/analytics/performance?lng=&lat=&radius= — explain("executionStats") comparison */
router.get('/performance', asyncHandler(async (req, res) => {
  let lng; let lat;
  if (req.query.lng !== undefined && req.query.lat !== undefined) [lng, lat] = parseLngLat(req.query.lng, req.query.lat);
  else {
    const b = await A.bounds({});
    [lng, lat] = b.center || [76.6394, 12.2958];
  }
  const radius = Math.min(Math.max(Number(req.query.radius) || 2000, 100), 20000);
  res.json(await compare({ lng, lat, radius }));
}));

module.exports = router;
