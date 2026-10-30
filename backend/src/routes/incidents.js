const router = require('express').Router();
const Incident = require('../models/Incident');
const Counter = require('../models/Counter');
const AuditLog = require('../models/AuditLog');
const { protect, adminOnly } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const { buildMatch } = require('../utils/filters');
const { validateIncident, parseLngLat, httpError } = require('../utils/validate');
const { resolveArea } = require('../services/areaResolver');
const { STATUSES, SEVERITIES } = require('../config/constants');
const { tzFor } = require('../services/geo');
const { cellSize, clearCache } = require('../services/analytics');

const emit = (req, event, payload) => {
  clearCache();
  try {
    const { notifyIncidentChanged } = require('../services/summaryService');
    notifyIncidentChanged();
  } catch (_) {}
  req.app.get('io')?.emit(event, payload);
  req.app.get('io')?.emit('incidents:changed', { event, payload });
};

const audit = (req, action, incidentId, changes, note) =>
  AuditLog.create({
    action, incidentId, changes, note,
    actor: req.user?._id, actorName: req.user?.name || 'system',
  });

/* GET /api/incidents — filtered, paginated list */
router.get('/', asyncHandler(async (req, res) => {
  const match = buildMatch(req.query);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 500);
  const sortField = ['reportedAt', 'severity', 'type', 'area', 'status'].includes(req.query.sort) ? req.query.sort : 'reportedAt';
  const dir = req.query.dir === 'asc' ? 1 : -1;

  const [items, total] = await Promise.all([
    Incident.find(match, {
      _id: 1, incidentId: 1, type: 1, severity: 1, status: 1, area: 1, location: 1, reportedAt: 1, description: 1, tz: 1, resolvedAt: 1, source: 1,
    })
      .sort({ [sortField]: dir, _id: dir })
      .skip((page - 1) * limit)
      .limit(limit)
      .maxTimeMS(10000)
      .lean(),
    Incident.countDocuments(match).maxTimeMS(10000),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
}));

/* GET /api/incidents/map — raw markers when zoomed in, server-side grid clusters when zoomed out */
router.get('/map', asyncHandler(async (req, res) => {
  const match = buildMatch(req.query);
  const zoom = Number(req.query.zoom);
  const isUnfiltered = Object.keys(match).length === 0;

  if (Number.isFinite(zoom) && zoom < 12) {
    if (isUnfiltered) {
      try {
        const { getMapGrid } = require('../services/summaryService');
        const grid = await getMapGrid(zoom, false);
        if (grid && grid.items && grid.items.length) {
          return res.json(grid);
        }
      } catch (_) {}
    }

    const cell = cellSize({ zoom });
    const clusters = await Incident.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            x: { $floor: { $divide: [{ $arrayElemAt: ['$location.coordinates', 0] }, cell] } },
            y: { $floor: { $divide: [{ $arrayElemAt: ['$location.coordinates', 1] }, cell] } },
          },
          count: { $sum: 1 },
          lng: { $avg: { $arrayElemAt: ['$location.coordinates', 0] } },
          lat: { $avg: { $arrayElemAt: ['$location.coordinates', 1] } },
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
    return res.json({ mode: 'clusters', items, total: items.reduce((s, c) => s + c.count, 0) });
  }

  const limit = Math.min(Number(req.query.limit) || 2500, 10000);
  const items = await Incident.find(match, {
    incidentId: 1, type: 1, severity: 1, status: 1, area: 1, location: 1, reportedAt: 1, description: 1,
  }).sort({ reportedAt: -1 }).limit(limit).maxTimeMS(10000).lean();
  res.json({ mode: 'points', items, limited: items.length === limit });
}));

/* GET /api/incidents/nearby?lng=&lat=&radius=2000 — $geoNear, distance-ordered */
router.get('/nearby', asyncHandler(async (req, res) => {
  const [lng, lat] = parseLngLat(req.query.lng, req.query.lat);
  const radius = Math.min(Math.max(Number(req.query.radius) || 2000, 50), 50000);
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  const { $or, ...rest } = buildMatch(req.query); // keep filters simple inside $geoNear.query

  const [r] = await Incident.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        key: 'location',
        distanceField: 'distance',
        maxDistance: radius,
        spherical: true,
        query: $or ? { ...rest, $or } : rest,
      },
    },
    {
      $facet: {
        items: [{ $limit: limit }],
        stats: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              avgDistance: { $avg: '$distance' },
              critical: { $sum: { $cond: [{ $eq: ['$severity', 'Critical'] }, 1, 0] } },
              high: { $sum: { $cond: [{ $eq: ['$severity', 'High'] }, 1, 0] } },
              active: { $sum: { $cond: [{ $in: ['$status', ['Pending', 'Verified']] }, 1, 0] } },
            },
          },
        ],
      },
    },
  ]).option({ maxTimeMS: 10000 });

  res.json({
    center: [lng, lat], radius,
    items: r.items,
    stats: r.stats[0] || { total: 0, avgDistance: 0, critical: 0, high: 0, active: 0 },
  });
}));

/* POST /api/incidents/within — incidents inside a GeoJSON polygon ($geoWithin) */
router.post('/within', asyncHandler(async (req, res) => {
  const geometry = req.body?.geometry;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw httpError(400, 'Send a GeoJSON Polygon in body.geometry.');
  }
  const match = { ...buildMatch(req.query), location: { $geoWithin: { $geometry: geometry } } };
  const items = await Incident.find(match).sort({ reportedAt: -1 }).limit(2000).maxTimeMS(10000).lean();
  res.json({ items, total: await Incident.countDocuments(match).maxTimeMS(10000) });
}));

/* GET /api/incidents/:id — by incidentId or Mongo _id */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const q = /^[a-f0-9]{24}$/i.test(id) ? { _id: id } : { incidentId: id };
  const doc = await Incident.findOne(q).populate('reportedBy', 'name').populate('verifiedBy', 'name').maxTimeMS(10000).lean();
  if (!doc) throw httpError(404, `Incident ${id} was not found.`);
  res.json(doc);
}));

/* POST /api/incidents — report a new incident (signed-in users) */
router.post('/', protect, asyncHandler(async (req, res) => {
  const data = validateIncident(req.body);
  const isAdmin = req.user.role === 'admin';
  const seq = await Counter.next('incident');

  const doc = await Incident.create({
    ...data,
    incidentId: `INC-${String(seq).padStart(5, '0')}`,
    area: data.area || (await resolveArea(data.location.coordinates)),
    tz: tzFor(...data.location.coordinates),
    aiSeverity: SEVERITIES.includes(req.body.aiSeverity) ? req.body.aiSeverity : undefined,
    status: isAdmin ? data.status || 'Verified' : 'Pending', // user reports wait for verification
    source: isAdmin ? 'Admin' : 'User Report',
    reportedBy: req.user._id,
    verifiedBy: isAdmin ? req.user._id : undefined,
  });

  await audit(req, 'CREATE', doc.incidentId, { type: doc.type, severity: doc.severity, status: doc.status });
  emit(req, 'incident:new', doc.toObject());
  res.status(201).json(doc);
}));

/* PATCH /api/incidents/:id — edit fields (admin) */
router.patch('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const updates = validateIncident(req.body, { partial: true });
  if (updates.location) {
    if (!req.body.area) updates.area = await resolveArea(updates.location.coordinates);
    updates.tz = tzFor(...updates.location.coordinates);
  }
  const before = await Incident.findOne({ incidentId: req.params.id }).lean();
  if (!before) throw httpError(404, `Incident ${req.params.id} was not found.`);
  if (updates.status === 'Resolved' && before.status !== 'Resolved') updates.resolvedAt = new Date();

  const doc = await Incident.findOneAndUpdate({ incidentId: req.params.id }, updates, { new: true, runValidators: true });
  const diff = Object.fromEntries(
    Object.keys(updates)
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(updates[k]))
      .map((k) => [k, { from: before[k], to: updates[k] }])
  );
  await audit(req, 'UPDATE', doc.incidentId, diff);
  emit(req, 'incident:updated', doc.toObject());
  res.json(doc);
}));

/* PATCH /api/incidents/:id/status — verify / resolve / reject (admin) */
router.patch('/:id/status', protect, adminOnly, asyncHandler(async (req, res) => {
  const { status, note } = req.body || {};
  if (!STATUSES.includes(status)) throw httpError(400, `status must be one of: ${STATUSES.join(', ')}`);
  const doc = await Incident.findOne({ incidentId: req.params.id });
  if (!doc) throw httpError(404, `Incident ${req.params.id} was not found.`);

  const from = doc.status;
  doc.status = status;
  if (status === 'Verified') doc.verifiedBy = req.user._id;
  if (status === 'Resolved') doc.resolvedAt = new Date();
  if (status !== 'Resolved') doc.resolvedAt = undefined;
  await doc.save();

  await audit(req, 'STATUS', doc.incidentId, { status: { from, to: status } }, note);
  emit(req, 'incident:updated', doc.toObject());
  res.json(doc);
}));

/* DELETE /api/incidents/:id (admin) */
router.delete('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const doc = await Incident.findOneAndDelete({ incidentId: req.params.id });
  if (!doc) throw httpError(404, `Incident ${req.params.id} was not found.`);
  await audit(req, 'DELETE', doc.incidentId, { snapshot: { type: doc.type, severity: doc.severity, area: doc.area } });
  emit(req, 'incident:deleted', { incidentId: doc.incidentId });
  res.json({ deleted: doc.incidentId });
}));

module.exports = router;
