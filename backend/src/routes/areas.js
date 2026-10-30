const router = require('express').Router();
const Area = require('../models/Area');
const Incident = require('../models/Incident');
const { asyncHandler } = require('../middleware/error');
const { buildMatch } = require('../utils/filters');
const { httpError } = require('../utils/validate');
const A = require('../services/analytics');
const { bboxQuery } = require('../services/geo');

/**
 * GET /api/areas — areas derived from the data itself (any city, any country),
 * plus any stored named polygons. Each has a centre and bounding box.
 */
router.get('/', asyncHandler(async (req, res) => {
  const [dynamic, stored] = await Promise.all([
    A.areas({ ...req.query, limit: Number(req.query.limit) || 300 }),
    Area.find().sort({ name: 1 }).lean(),
  ]);
  const storedByName = Object.fromEntries(stored.map((a) => [a.name, a]));
  const items = dynamic.map((d) => ({
    name: d.area, total: d.total, center: d.center, bbox: d.bbox,
    boundary: storedByName[d.area]?.boundary || null,
  }));
  res.json(items);
}));

/* GET /api/areas/:name/incidents — stored polygon → $geoWithin; otherwise the area's own records + extent */
router.get('/:name/incidents', asyncHandler(async (req, res) => {
  const name = req.params.name;
  const stored = await Area.findOne({ name }).lean();
  let match;
  let boundary = null;
  let bbox = null;
  if (stored) {
    boundary = stored.boundary;
    match = { ...buildMatch(req.query), location: { $geoWithin: { $geometry: stored.boundary } } };
  } else {
    const [info] = await A.areas({ ...req.query, area: name, limit: 1 });
    if (!info) throw httpError(404, `No incidents found for area "${name}".`);
    bbox = info.bbox;
    const pad = 0.002;
    const [w, s, e, n] = bbox;
    boundary = { type: 'Polygon', coordinates: [[[w - pad, s - pad], [e + pad, s - pad], [e + pad, n + pad], [w - pad, n + pad], [w - pad, s - pad]]] };
    match = { ...buildMatch(req.query), location: bboxQuery({ w: w - pad, s: s - pad, e: e + pad, n: n + pad }) };
  }
  const [items, total] = await Promise.all([
    Incident.find(match).sort({ reportedAt: -1 }).limit(1500).lean(),
    Incident.countDocuments(match),
  ]);
  res.json({ area: { name, boundary, bbox, stored: !!stored }, items, total });
}));

module.exports = router;
