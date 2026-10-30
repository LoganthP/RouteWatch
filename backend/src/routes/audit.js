const router = require('express').Router();
const AuditLog = require('../models/AuditLog');
const { protect, adminOnly } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');

router.get('/', protect, adminOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const q = req.query.incidentId ? { incidentId: req.query.incidentId } : {};
  res.json(await AuditLog.find(q).sort({ createdAt: -1 }).limit(limit).lean());
}));

module.exports = router;
