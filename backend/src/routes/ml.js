/**
 * AI / ML endpoints. Node gathers features from MongoDB (with the same filters
 * as every other page) and calls the Python ML service for the modelling.
 */
const router = require('express').Router();
const Incident = require('../models/Incident');
const MlModel = require('../models/MlModel');
const AuditLog = require('../models/AuditLog');
const { protect, adminOnly } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const { buildMatch } = require('../utils/filters');
const { httpError, parseLngLat } = require('../utils/validate');
const { TZ_EXPR, INCIDENT_TYPES } = require('../config/constants');
const { tzFor } = require('../services/geo');

const ML_URL = () => (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const OFFLINE_MSG = 'The AI service is not running. Start it in a new terminal: cd ml-service, activate the virtual environment, then run: uvicorn app:app --port 8000';

router.get('/health', async (_req, res) => {
  try {
    const r = await fetch(`${ML_URL()}/health`, { signal: AbortSignal.timeout(2000) });
    return res.json({ online: r.ok });
  } catch {
    return res.json({ online: false });
  }
});

async function ml(path, body, timeoutMs = 180000) {
  let res;
  try {
    res = await fetch(`${ML_URL()}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw httpError(503, e.name === 'TimeoutError' ? 'The AI service took too long. Try a smaller area or fewer incidents.' : OFFLINE_MSG, null, 'AI_OFFLINE');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join('; ') : 'AI service error';
    throw httpError(res.status >= 500 ? 502 : res.status, detail);
  }
  return data;
}

const localDate = { date: '$reportedAt', timezone: TZ_EXPR };

/** Sample up to `max` incidents matching the filters, with local-time features. */
async function features(q, max, extra = {}) {
  const match = buildMatch(q);
  const total = await Incident.countDocuments(match);
  const pipeline = [{ $match: match }];
  if (total > max) pipeline.push({ $sample: { size: max } });
  pipeline.push({
    $project: {
      _id: 0,
      lng: { $arrayElemAt: ['$location.coordinates', 0] },
      lat: { $arrayElemAt: ['$location.coordinates', 1] },
      severity: 1, type: 1,
      hour: { $hour: localDate },
      ...extra,
    },
  });
  const rows = await Incident.aggregate(pipeline).allowDiskUse(true);
  return { rows, total, sampled: total > max };
}

/* GET /api/ml/status */
router.get('/status', asyncHandler(async (_req, res) => {
  const latest = await MlModel.findOne({ kind: 'severity-rf' }).sort({ version: -1 }).lean();
  try {
    const h = await ml('/health', null, 5000);
    res.json({ online: true, severityModelLoaded: h.severity_model, latestModel: latest });
  } catch (e) {
    res.json({ online: false, message: e.message, latestModel: latest });
  }
}));

/* POST /api/ml/clusters — DBSCAN hotspots for the filtered / visible data */
router.post('/clusters', protect, asyncHandler(async (req, res) => {
  const q = { ...req.query, ...(req.body?.filters || {}) };
  const eps = Math.min(Math.max(Number(req.body?.eps_m) || 250, 10), 20000);
  const minSamples = Math.min(Math.max(Number(req.body?.min_samples) || 15, 2), 1000);
  const max = Math.min(Math.max(Number(req.body?.max_points) || 50000, 500), 100000);
  const { rows, total, sampled } = await features(q, max, { area: 1 });
  if (!rows.length) throw httpError(400, 'No incidents match these filters. Clear a filter or zoom out.');
  const result = await ml('/cluster', { points: rows, eps_m: eps, min_samples: minSamples });
  res.json({ ...result, totalMatching: total, sampled });
}));

/* POST /api/ml/severity/train — train + register a Random Forest (admin) */
router.post('/severity/train', protect, adminOnly, asyncHandler(async (req, res) => {
  const q = { ...(req.body?.filters || {}) };
  const max = Math.min(Math.max(Number(req.body?.max_rows) || 120000, 1000), 200000);
  const { rows, total, sampled } = await features(q, max, { dow: { $dayOfWeek: localDate }, month: { $month: localDate } });
  const result = await ml('/severity/train', {
    rows,
    n_estimators: Number(req.body?.n_estimators) || 200,
    max_depth: Number(req.body?.max_depth) || 16,
  }, 600000);
  const last = await MlModel.findOne({ kind: 'severity-rf' }).sort({ version: -1 }).lean();
  const doc = await MlModel.create({
    kind: 'severity-rf',
    version: (last?.version || 0) + 1,
    algorithm: result.algorithm,
    params: result.params,
    metrics: result.metrics,
    featureImportance: result.feature_importance,
    samples: result.samples,
    filters: { ...q, totalMatching: total, sampled },
    trainedBy: req.user.name,
    trainSeconds: result.train_seconds,
  });
  await AuditLog.create({ action: 'TRAIN_MODEL', actor: req.user._id, actorName: req.user.name, changes: { model: 'severity-rf', version: doc.version, accuracy: result.metrics.accuracy } });
  res.status(201).json(doc);
}));

/* GET /api/ml/severity/model — latest model card + history */
router.get('/severity/model', asyncHandler(async (_req, res) => {
  const versions = await MlModel.find({ kind: 'severity-rf' }).sort({ version: -1 }).limit(10).lean();
  res.json({ latest: versions[0] || null, history: versions.map((v) => ({ version: v.version, accuracy: v.metrics?.accuracy, macro_f1: v.metrics?.macro_f1, createdAt: v.createdAt })) });
}));

/** Local hour / weekday / month for a moment at a location. */
function localParts(date, lng, lat) {
  const tz = tzFor(lng, lat);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', hour: '2-digit', weekday: 'short', month: 'numeric',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) + 1;
  return { hour: Number(parts.hour) % 24, dow, month: Number(parts.month), tz };
}

/* POST /api/ml/severity/predict { lng, lat, type, datetime } */
router.post('/severity/predict', protect, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const [lng, lat] = parseLngLat(b.lng, b.lat);
  if (!INCIDENT_TYPES.includes(b.type)) throw httpError(400, `type must be one of: ${INCIDENT_TYPES.join(', ')}`);
  const when = b.datetime ? new Date(b.datetime) : new Date();
  if (isNaN(when)) throw httpError(400, 'datetime is not a valid date.');
  const p = localParts(when, lng, lat);
  const out = await ml('/severity/predict', { rows: [{ lat, lng, type: b.type, hour: p.hour, dow: p.dow, month: p.month }] }, 15000);
  res.json({ ...out.predictions[0], local: p });
}));

/* POST /api/ml/forecast { horizon, filters } — daily counts → Holt-Winters */
router.post('/forecast', protect, asyncHandler(async (req, res) => {
  const q = { ...req.query, ...(req.body?.filters || {}) };
  const horizon = Math.min(Math.max(Number(req.body?.horizon) || 14, 1), 90);
  const since = new Date(Date.now() - 400 * 864e5);
  const match = buildMatch(q);
  match.reportedAt = { ...(match.reportedAt || {}), $gte: match.reportedAt?.$gte && match.reportedAt.$gte > since ? match.reportedAt.$gte : since };
  const rows = await Incident.aggregate([
    { $match: match },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', ...localDate } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).allowDiskUse(true);
  const history = rows.filter((r) => r._id).map((r) => ({ date: r._id, count: r.count }));
  if (history.length < 3) throw httpError(400, 'Not enough daily history for these filters (need at least 3 days with incidents).');
  // close the series at "today" so recent quiet days count as zero
  const today = new Date().toISOString().slice(0, 10);
  if (history[history.length - 1].date < today) history.push({ date: today, count: 0 });
  res.json(await ml('/forecast', { history, horizon }));
}));

module.exports = router;
