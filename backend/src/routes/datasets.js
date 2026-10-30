const router = require('express').Router();
const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const Dataset = require('../models/Dataset');
const { protect, adminOnly } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const { httpError } = require('../utils/validate');
const { LIMITS, INCIDENT_TYPES, SEVERITIES, STATUSES } = require('../config/constants');
const F = require('../services/datasets/files');
const S = require('../services/datasets/sources');
const { suggestMapping, validTz } = require('../services/datasets/normalize');
const I = require('../services/datasets/importer');

const MB = 1024 * 1024;
const fmt = (b) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(2)} GB` : `${(b / MB).toFixed(1)} MB`);
const limiter = (max) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many upload requests. Wait a few minutes and try again.' } });
const io = (req) => req.app.get('io');
const SUPPORTED = ['csv', 'tsv', 'txt', 'xlsx', 'json', 'geojson', 'kml', 'gpx', 'pdf', 'zip'];

router.use(protect);

/* GET /api/datasets/limits — the frontend reads every limit from here */
router.get('/limits', (req, res) => res.json({
  maxUploadMB: LIMITS.maxUploadMB,
  maxRows: req.user.role === 'admin' ? LIMITS.maxRowsAdmin : LIMITS.maxRowsCitizen,
  maxInMemoryMB: LIMITS.maxInMemoryMB,
  chunkSize: LIMITS.chunkSize,
  quotaMB: LIMITS.quotaMB,
  geocodeEnabled: LIMITS.geocodeEnabled,
  geocodeMax: LIMITS.geocodeMax,
  formats: SUPPORTED,
  enums: { types: INCIDENT_TYPES, severities: SEVERITIES, statuses: STATUSES },
}));

router.get('/storage', asyncHandler(async (_req, res) => res.json(await I.storageInfo())));

/* ---------------- chunked, resumable upload ---------------- */
router.post('/upload/init', limiter(60), asyncHandler(async (req, res) => {
  const { filename, size } = req.body || {};
  const bytes = Number(size);
  if (!filename || !Number.isFinite(bytes) || bytes <= 0) throw httpError(400, 'filename and size are required.');
  const kind = F.kindOf(filename);
  if (!kind) throw httpError(400, `Unsupported file type. Use one of: ${SUPPORTED.join(', ')}.`);
  if (kind === 'xls') throw httpError(400, 'Legacy .xls files are not supported. Save it as .xlsx or .csv.');
  if (bytes > LIMITS.maxUploadMB * MB) throw httpError(413, `This file is ${fmt(bytes)}; the limit is ${fmt(LIMITS.maxUploadMB * MB)}.`);
  if (F.IN_MEMORY.has(kind) && bytes > LIMITS.maxInMemoryMB * MB) {
    throw httpError(413, `${kind.toUpperCase()} files over ${LIMITS.maxInMemoryMB} MB are not supported (this one is ${fmt(bytes)}). Convert it to CSV, which has no such limit.`);
  }
  const meta = await F.createSession({ filename, size: bytes, owner: req.user._id, chunkSize: LIMITS.chunkSize });
  res.status(201).json({ uploadId: meta.id, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks });
}));

async function ownSession(req) {
  const meta = await F.readSession(req.params.uploadId);
  if (!meta) throw httpError(404, 'Upload session not found or expired. Start the upload again.');
  if (meta.owner !== String(req.user._id)) throw httpError(403, 'This upload belongs to another user.');
  return meta;
}

router.get('/upload/:uploadId', asyncHandler(async (req, res) => {
  const meta = await ownSession(req);
  res.json({ uploadId: meta.id, totalChunks: meta.totalChunks, chunkSize: meta.chunkSize, received: await F.receivedChunks(meta.id) });
}));

router.put('/upload/:uploadId/chunk', limiter(5000),
  express.raw({ type: () => true, limit: `${Math.ceil(LIMITS.chunkSize / MB) + 1}mb` }),
  asyncHandler(async (req, res) => {
    const meta = await ownSession(req);
    const index = Number(req.query.index);
    if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) throw httpError(400, `Chunk index must be 0 to ${meta.totalChunks - 1}.`);
    const expected = index === meta.totalChunks - 1 ? meta.size - index * meta.chunkSize : meta.chunkSize;
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length !== expected) throw httpError(400, `Chunk ${index} should be ${expected} bytes but was ${body.length}.`);
    await F.writeChunk(meta, index, body);
    res.json({ ok: true, index });
  }));

router.delete('/upload/:uploadId', asyncHandler(async (req, res) => {
  await ownSession(req);
  await F.removeSession(req.params.uploadId);
  res.json({ cancelled: true });
}));

/* POST /upload/:id/complete — assemble, verify content, preview, create the Dataset */
router.post('/upload/:uploadId/complete', asyncHandler(async (req, res) => {
  const meta = await ownSession(req);
  const got = await F.receivedChunks(meta.id);
  if (got.length !== meta.totalChunks) {
    const missing = [];
    for (let i = 0; i < meta.totalChunks && missing.length < 20; i++) if (!got.includes(i)) missing.push(i);
    throw httpError(409, `Upload incomplete: missing chunks ${missing.join(', ')}.`, { missing });
  }
  const filePath = await F.finalizeSession(meta);
  try {
    const st = fs.statSync(filePath);
    if (st.size !== meta.size) throw httpError(400, `Assembled file is ${st.size} bytes, expected ${meta.size}.`);
    const bad = await F.verifyMagic(filePath, meta.kind);
    if (bad) throw httpError(400, bad);
    const { sources, warnings } = await S.describe(filePath, meta.filename, meta.kind, meta.size);
    const pv = await S.preview(sources);
    const preview = {
      ...pv,
      warnings,
      sources: sources.map((s) => ({ name: s.name, kind: s.kind, size: s.size })),
      suggestedMapping: suggestMapping(pv.columns),
    };
    const ds = await Dataset.create({
      name: path.basename(meta.filename).replace(/\.[^.]+$/, '').slice(0, 120) || 'Dataset',
      file: { name: meta.filename, size: meta.size, kind: meta.kind },
      sources: preview.sources,
      filePath, preview, status: 'uploaded',
      createdBy: req.user._id, createdByName: req.user.name,
    });
    res.status(201).json({ datasetId: ds._id, name: ds.name, preview });
  } catch (e) {
    await F.removeFile(filePath);
    throw e;
  }
}));

/* ---------------- datasets ---------------- */
router.get('/', asyncHandler(async (_req, res) => {
  res.json(await Dataset.find().sort({ createdAt: -1 }).limit(200).lean());
}));

const findDs = async (id, sel = '') => {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid dataset id.');
  const ds = await Dataset.findById(id).select(sel);
  if (!ds) throw httpError(404, 'Dataset not found.');
  return ds;
};

router.get('/:id', asyncHandler(async (req, res) => {
  const ds = await findDs(req.params.id, '+preview');
  res.json({ ...ds.toObject(), running: I.isRunning(ds._id) });
}));

/* POST /:id/import — start the background job */
router.post('/:id/import', asyncHandler(async (req, res) => {
  const ds = await findDs(req.params.id, '+filePath');
  if (ds.status !== 'uploaded') throw httpError(409, `This dataset is ${ds.status}. Upload the file again to import it again.`);
  if (!ds.filePath || !fs.existsSync(ds.filePath)) throw httpError(410, 'The uploaded file has expired (files are kept 24 hours). Upload it again.');
  if (String(ds.createdBy) !== String(req.user._id) && req.user.role !== 'admin') throw httpError(403, 'Only the uploader can import this dataset.');

  const { mapping = {}, defaults = {}, scope = {}, tzMode = 'auto', dayFirst = true, name } = req.body || {};
  const hasCoords = (mapping.latitude && mapping.longitude) || mapping.coordinates || mapping.address || (mapping.area || []).length;
  if (!hasCoords) throw httpError(400, 'Map latitude and longitude (or a coordinates, address or area column) before importing.');
  if (tzMode !== 'auto' && tzMode !== 'UTC' && !validTz(tzMode)) throw httpError(400, `Unknown time zone "${tzMode}".`);
  const d = {
    type: INCIDENT_TYPES.includes(defaults.type) ? defaults.type : 'Other',
    severity: SEVERITIES.includes(defaults.severity) ? defaults.severity : 'Medium',
    status: STATUSES.includes(defaults.status) ? defaults.status : 'Verified',
  };
  const roleMax = req.user.role === 'admin' ? LIMITS.maxRowsAdmin : LIMITS.maxRowsCitizen;
  const cleanScope = {
    limit: Math.max(1, Math.min(Number(scope.limit) || roleMax, roleMax)),
    sampling: ['first', 'every', 'random'].includes(scope.sampling) ? scope.sampling : 'first',
    everyN: Math.max(1, Math.min(Number(scope.everyN) || 1, 100000)),
    filters: scope.filters || {},
  };
  ds.set({ status: 'importing', mapping, scope: cleanScope, startedAt: new Date(), name: String(name || ds.name).slice(0, 120) });
  await ds.save();

  I.runImport({ datasetId: ds._id, user: req.user, io: io(req), options: { mapping, defaults: d, scope: cleanScope, tzMode, dayFirst } })
    .catch((e) => console.error('[import] crashed', e));
  res.status(202).json({ datasetId: ds._id, status: 'importing', limit: cleanScope.limit });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const ds = await findDs(req.params.id);
  if (!I.cancel(ds._id)) throw httpError(409, 'This dataset is not importing.');
  res.json({ cancelling: true });
}));

router.get('/:id/rejected.csv', asyncHandler(async (req, res) => {
  const ds = await findDs(req.params.id);
  const p = path.join(F.DIRS.reports, `${ds._id}.rejected.csv`);
  if (!fs.existsSync(p)) throw httpError(404, 'No rejected-rows file for this dataset.');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${F.safeName(ds.name)}-rejected-rows.csv"`);
  fs.createReadStream(p).pipe(res);
}));

router.delete('/:id', adminOnly, asyncHandler(async (req, res) => {
  const ds = await findDs(req.params.id, '+filePath');
  if (I.isRunning(ds._id)) throw httpError(409, 'Cancel the import before deleting this dataset.');
  if (ds.status === 'deleting') throw httpError(409, 'This dataset is already being deleted.');
  await F.removeFile(ds.filePath);
  ds.status = 'deleting';
  await ds.save();
  I.runDelete({ datasetId: ds._id, user: req.user, io: io(req) }).catch((e) => console.error('[delete] crashed', e));
  res.status(202).json({ deleting: true });
}));

module.exports = router;
