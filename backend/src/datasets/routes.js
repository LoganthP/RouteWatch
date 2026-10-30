// RouteWatch — /api/datasets router.
// Mount BEFORE any global body parser that might read octet-stream bodies:
//   app.use('/api/datasets', requireAuth, createDatasetRouter({ db, io }));
const express = require('express');
const {
  HttpError, ensureDirs, getLimits, initUpload, uploadStatus, writeChunk, completeUpload,
  abortUpload, removeDatasetFiles, sweepExpired,
} = require('./uploadStore.js');
const {
  configureImporter, ensureIndexes, recoverInterrupted, inspectDataset, enqueueImport,
  cancelImport, importState, purgeDatasetDocs,
} = require('./importer.js');
const { COLLECTIONS } = require('./config.js');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function createDatasetRouter({ db, io }) {
  await ensureDirs();
  configureImporter({ db, io });
  await ensureIndexes(db);
  await recoverInterrupted(db);
  await sweepExpired();
  setInterval(() => sweepExpired().catch(() => {}), 60 * 60 * 1000).unref();

  const r = express.Router();
  const datasets = db.collection(COLLECTIONS.datasets);
  const json = express.json({ limit: '2mb' });
  const publicDs = ({ filePath, ...d }) => d; // never leak server paths

  r.get('/limits', wrap(async (_req, res) => res.json(await getLimits())));

  r.get('/', wrap(async (_req, res) => {
    const list = await datasets.find({}, { projection: { insights: 0, entries: 0, selections: 0, filePath: 0 } })
      .sort({ createdAt: -1 }).limit(200).toArray();
    res.json({ datasets: list, ...importState() });
  }));

  /* ---------- chunked upload ---------- */
  r.post('/upload/init', json, wrap(async (req, res) => res.json(await initUpload(req.body || {}))));
  r.get('/upload/:uploadId', wrap(async (req, res) => res.json(await uploadStatus(req.params.uploadId))));
  r.put('/upload/:uploadId/chunk', wrap(async (req, res) => {
    req.setTimeout(10 * 60 * 1000);
    res.json(await writeChunk(req.params.uploadId, req.query.index, req));
  }));
  r.delete('/upload/:uploadId', wrap(async (req, res) => res.json(await abortUpload(req.params.uploadId))));

  r.post('/upload/:uploadId/complete', json, wrap(async (req, res) => {
    const done = await completeUpload(req.params.uploadId);
    const doc = {
      _id: done.datasetId, name: req.body?.name || done.fileName, fileName: done.fileName, size: done.size,
      mimeType: done.mimeType, filePath: done.filePath, status: 'uploaded', createdAt: new Date(),
      createdBy: req.user?.id || req.user?._id || null,
    };
    await datasets.insertOne(doc);
    // Inspect right away so step 2 ("Map columns & scope") has proposals ready.
    const inspected = await inspectDataset(done.datasetId);
    res.status(201).json({ dataset: publicDs({ ...doc, status: 'inspected' }), entries: inspected.entries });
  }));

  /* ---------- per-dataset ---------- */
  r.get('/:id', wrap(async (req, res) => {
    const d = await datasets.findOne({ _id: req.params.id }, { projection: { filePath: 0 } });
    if (!d) throw new HttpError(404, 'Dataset not found');
    res.json(d);
  }));
  r.post('/:id/inspect', wrap(async (req, res) => res.json(await inspectDataset(req.params.id))));
  r.post('/:id/import', json, wrap(async (req, res) => res.status(202).json(await enqueueImport(req.params.id, req.body?.selections))));
  r.post('/:id/cancel', wrap(async (req, res) => res.json({ cancelled: cancelImport(req.params.id) })));
  r.get('/:id/insights', wrap(async (req, res) => {
    const d = await datasets.findOne({ _id: req.params.id }, { projection: { insights: 1, status: 1, progress: 1, name: 1 } });
    if (!d) throw new HttpError(404, 'Dataset not found');
    res.json(d);
  }));
  r.delete('/:id', wrap(async (req, res) => {
    cancelImport(req.params.id);
    const removed = req.query.keepData === 'true' ? null : await purgeDatasetDocs(req.params.id);
    await removeDatasetFiles(req.params.id);
    await datasets.deleteOne({ _id: req.params.id });
    res.json({ deleted: req.params.id, removed });
  }));

  /* ---------- errors: always JSON, always a useful message ---------- */
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, _next) => {
    const status = err.status || (err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_PREMATURE_CLOSE' ? 499 : 500);
    if (status >= 500) console.error('[datasets]', req.method, req.originalUrl, err.code ?? '', err.message);
    if (res.headersSent) return;
    res.status(status).json({ error: err.message || 'Unexpected error', code: err.code || null, ...(err.missing ? { missing: err.missing } : {}) });
  });
  return r;
}

module.exports = {
  createDatasetRouter,
};
