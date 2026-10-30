/**
 * Background import job: stream rows → normalise → filter/sample → batch insert.
 * Progress goes to Socket.IO and the Dataset document; cancellation and the
 * storage guard are checked between batches.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Incident = require('../../models/Incident');
const Dataset = require('../../models/Dataset');
const Counter = require('../../models/Counter');
const AuditLog = require('../../models/AuditLog');
const { LIMITS, SEVERITY_WEIGHT } = require('../../config/constants');
const { describe, rowsOf } = require('./sources');
const { normalizeRow, finishRow, suggestMapping } = require('./normalize');
const { geocode } = require('./geocode');
const { DIRS, removeFile } = require('./files');
const { bounds, clearCache } = require('../analytics');

const BATCH = 2000;
const MAX_REJECT_LINES = 50000;
const jobs = new Map(); // datasetId → { cancel }

async function storageMB() {
  const st = await mongoose.connection.db.stats();
  return ((st.dataSize || 0) + (st.indexSize || 0)) / (1024 * 1024);
}

async function storageInfo() {
  const usedMB = await storageMB();
  const count = await Incident.estimatedDocumentCount();
  const st = await mongoose.connection.db.command({ collStats: Incident.collection.collectionName }).catch(() => null);
  const perDoc = st && count ? ((st.size || 0) + (st.totalIndexSize || 0)) / count : 450;
  return {
    usedMB: +usedMB.toFixed(2),
    quotaMB: LIMITS.quotaMB,
    percent: LIMITS.quotaMB ? +((usedMB / LIMITS.quotaMB) * 100).toFixed(1) : null,
    incidents: count,
    bytesPerIncident: Math.round(perDoc || 450),
  };
}

function inScope(doc, raw, f = {}) {
  if (f.from && doc.reportedAt < new Date(f.from)) return false;
  if (f.to) { const t = new Date(f.to); if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) t.setUTCHours(23, 59, 59, 999); if (doc.reportedAt > t) return false; }
  if (f.minSeverity && SEVERITY_WEIGHT[doc.severity] < (SEVERITY_WEIGHT[f.minSeverity] || 0)) return false;
  if (Array.isArray(f.bbox) && f.bbox.length === 4) {
    const [w, s, e, n] = f.bbox.map(Number); const [x, y] = doc.location.coordinates;
    if (y < s || y > n) return false;
    if (w <= e ? x < w || x > e : x < w && x > e) return false;
  }
  if (f.column && Array.isArray(f.values) && f.values.length) {
    const v = String(raw[f.column] ?? '').trim().toLowerCase();
    if (!f.values.some((x) => String(x).trim().toLowerCase() === v)) return false;
  }
  return true;
}

async function runImport({ datasetId, user, io, options }) {
  const job = { cancel: false };
  jobs.set(String(datasetId), job);
  const ds = await Dataset.findById(datasetId).select('+filePath');
  const isAdmin = user.role === 'admin';
  const roleMax = isAdmin ? LIMITS.maxRowsAdmin : LIMITS.maxRowsCitizen;
  const scope = options.scope || {};
  const limit = Math.max(1, Math.min(Number(scope.limit) || roleMax, roleMax));
  const sampling = ['first', 'every', 'random'].includes(scope.sampling) ? scope.sampling : 'first';
  const everyN = Math.max(1, Number(scope.everyN) || 1);
  const normOpts = {
    mapping: options.mapping,
    defaults: options.defaults,
    tzMode: options.tzMode || 'auto',
    dayFirst: options.dayFirst !== false,
    forceStatus: isAdmin ? null : 'Pending',
    importTime: new Date(),
  };

  const rejectPath = path.join(DIRS.reports, `${datasetId}.rejected.csv`);
  const rejectOut = fs.createWriteStream(rejectPath);
  rejectOut.write('row,source,reason,data\n');
  const p = { rowsRead: 0, imported: 0, skipped: 0, duplicates: 0, geocoded: 0, rate: 0, phase: 'reading' };
  let rejectLines = 0;
  const reject = (row, src, reason, raw) => {
    p.skipped += 1;
    if (rejectLines >= MAX_REJECT_LINES) return;
    rejectLines += 1;
    const data = JSON.stringify(raw).slice(0, 300).replace(/"/g, '""');
    rejectOut.write(`${row},"${String(src).replace(/"/g, '""')}","${reason.replace(/"/g, '""')}","${data}"\n`);
  };

  const started = Date.now();
  let lastEmit = 0; let lastSave = 0; let stopReason = null;
  const emit = async (force = false) => {
    const now = Date.now();
    p.rate = Math.round(p.rowsRead / Math.max(1, (now - started) / 1000));
    if (force || now - lastEmit > 800) { lastEmit = now; io?.emit('dataset:progress', { datasetId: String(datasetId), status: 'importing', progress: p }); }
    if (force || now - lastSave > 3000) { lastSave = now; await Dataset.updateOne({ _id: datasetId }, { progress: p }); }
  };

  const seen = new Set();
  const coll = Incident.collection;
  let batch = [];
  let accepted = 0; let candidate = 0; let geocodes = 0;
  const reservoir = [];

  const flush = async () => {
    if (!batch.length) return;
    const docs = batch; batch = [];
    const end = await Counter.findOneAndUpdate({ _id: 'incident' }, { $inc: { seq: docs.length } }, { new: true, upsert: true });
    let seq = end.seq - docs.length;
    const now = new Date();
    for (const d of docs) {
      seq += 1;
      Object.assign(d, {
        incidentId: `INC-${String(seq).padStart(5, '0')}`,
        datasetId: ds._id, source: 'Dataset Upload', reportedBy: user._id, isSynthetic: false, createdAt: now, updatedAt: now,
      });
      if (!d.resolvedAt) delete d.resolvedAt;
    }
    try {
      const r = await coll.insertMany(docs, { ordered: false });
      p.imported += r.insertedCount;
    } catch (e) {
      const inserted = e.result?.insertedCount ?? e.insertedCount ?? 0;
      p.imported += inserted;
      const errs = e.writeErrors ? (Array.isArray(e.writeErrors) ? e.writeErrors : Object.values(e.writeErrors)) : [];
      const dup = errs.filter((w) => (w.code ?? w.err?.code) === 11000).length;
      p.duplicates += dup;
      p.skipped += Math.max(0, docs.length - inserted - dup);
      if (!errs.length) throw e;
    }
    if (LIMITS.quotaMB > 0 && (await storageMB()) >= LIMITS.quotaMB * 0.8) {
      stopReason = `stopped: storage limit (80% of ${LIMITS.quotaMB} MB reached)`;
    }
    await emit();
  };

  let status = 'completed'; let note = null;
  try {
    const { sources } = await describe(ds.filePath, ds.file.name, ds.file.kind, ds.file.size);
    const autoMapped = [];
    outer: for (const src of sources) {
      let opts = null;
      for await (const raw of rowsOf(src)) {
        p.rowsRead += 1;
        if (job.cancel || stopReason) break outer;
        if (!opts) {
          // Files inside one zip can have different columns: keep the user's mapping when it fits,
          // otherwise auto-detect this file's own columns.
          const cols = Object.keys(raw);
          const m = options.mapping || {};
          const fits = (m.latitude && m.longitude && cols.includes(m.latitude) && cols.includes(m.longitude))
            || (m.coordinates && cols.includes(m.coordinates))
            || (m.address && cols.includes(m.address));
          opts = fits ? normOpts : { ...normOpts, mapping: suggestMapping(cols) };
          if (!fits) autoMapped.push(src.name);
        }
        let res = normalizeRow(raw, opts);
        if (res.needsGeocode) {
          if (!LIMITS.geocodeEnabled) { reject(p.rowsRead, src.name, 'no coordinates (address geocoding is disabled)', raw); continue; }
          if (geocodes >= LIMITS.geocodeMax) { reject(p.rowsRead, src.name, `no coordinates; geocoding limit of ${LIMITS.geocodeMax} per import reached`, raw); continue; }
          geocodes += 1;
          const c = await geocode(res.needsGeocode);
          if (!c) { reject(p.rowsRead, src.name, `address not found: ${res.needsGeocode}`, raw); continue; }
          p.geocoded += 1;
          res = finishRow(raw, c, opts);
        }
        if (res.error) { reject(p.rowsRead, src.name, res.error, raw); continue; }
        const doc = res.doc;
        if (!inScope(doc, raw, scope.filters)) continue;
        if (seen.has(doc.fingerprint)) { p.duplicates += 1; continue; }

        candidate += 1;
        if (sampling === 'every' && (candidate - 1) % everyN !== 0) continue;
        if (sampling === 'random') {
          // reservoir sampling (Algorithm R) keeps a uniform sample of `limit` rows
          if (reservoir.length < limit) reservoir.push(doc);
          else { const j = Math.floor(Math.random() * candidate); if (j < limit) reservoir[j] = doc; }
          if (p.rowsRead % 5000 === 0) await emit();
          continue;
        }
        seen.add(doc.fingerprint);
        batch.push(doc);
        accepted += 1;
        if (batch.length >= BATCH) await flush();
        if (accepted >= limit) break outer;
        if (p.rowsRead % 5000 === 0) await emit();
      }
    }
    if (sampling === 'random' && !job.cancel) {
      p.phase = 'writing';
      for (const d of reservoir) {
        if (job.cancel || stopReason) break;
        if (seen.has(d.fingerprint)) { p.duplicates += 1; continue; }
        seen.add(d.fingerprint);
        batch.push(d);
        if (batch.length >= BATCH) await flush();
      }
    }
    if (!job.cancel && !stopReason) await flush();
    if (autoMapped.length) note = `Columns were auto-detected for: ${autoMapped.slice(0, 5).join(', ')}${autoMapped.length > 5 ? '…' : ''}.`;
    if (job.cancel) { status = 'cancelled'; note = 'Cancelled by user. Rows imported before cancelling are kept with this dataset.'; }
    else if (stopReason) { status = 'stopped'; note = stopReason; }
    else if (!p.imported && !p.duplicates) { status = 'failed'; note = 'No rows could be imported. Download the rejected rows to see why.'; }
    else if (!p.imported && p.duplicates) note = `All ${p.duplicates} rows were already in the database (duplicates are skipped).`;
  } catch (e) {
    status = 'failed';
    note = e.status ? e.message : `Import failed: ${e.message}`;
    if (!e.status) console.error('[import]', e);
  } finally {
    await new Promise((r) => rejectOut.end(r));
    jobs.delete(String(datasetId));
    await removeFile(ds.filePath);
  }

  const b = await bounds({ dataset: String(datasetId) });
  p.phase = 'done';
  await Dataset.updateOne({ _id: datasetId }, {
    status, statusNote: note, progress: p, bbox: b.bbox || undefined, rejectedCount: p.skipped,
    finishedAt: new Date(), filePath: null,
  });
  await AuditLog.create({
    action: 'IMPORT', actor: user._id, actorName: user.name,
    changes: { dataset: ds.name, status, imported: p.imported, skipped: p.skipped, duplicates: p.duplicates },
    note: note || undefined,
  });
  clearCache();
  io?.emit('dataset:progress', { datasetId: String(datasetId), status, progress: p });
  io?.emit('dataset:imported', { datasetId: String(datasetId), name: ds.name, status, imported: p.imported, bbox: b.bbox });
  io?.emit('incidents:changed', { kind: 'dataset', datasetId: String(datasetId), imported: p.imported });
  return { status, progress: p };
}

/** Delete a dataset's incidents in batches without blocking the API. */
async function runDelete({ datasetId, user, io }) {
  const ds = await Dataset.findById(datasetId);
  if (!ds) return;
  let deleted = 0;
  for (;;) {
    const ids = await Incident.find({ datasetId: ds._id }, { _id: 1 }).limit(10000).lean();
    if (!ids.length) break;
    const r = await Incident.deleteMany({ _id: { $in: ids.map((x) => x._id) } });
    deleted += r.deletedCount;
    io?.emit('dataset:progress', { datasetId: String(datasetId), status: 'deleting', progress: { deleted } });
  }
  await Dataset.deleteOne({ _id: ds._id });
  await removeFile(path.join(DIRS.reports, `${datasetId}.rejected.csv`));
  await AuditLog.create({ action: 'DELETE_DATASET', actor: user?._id, actorName: user?.name || 'system', changes: { dataset: ds.name, deleted } });
  clearCache();
  io?.emit('dataset:deleted', { datasetId: String(datasetId), deleted });
  io?.emit('incidents:changed', { kind: 'dataset-deleted', datasetId: String(datasetId), deleted });
}

const cancel = (id) => { const j = jobs.get(String(id)); if (j) j.cancel = true; return !!j; };
const isRunning = (id) => jobs.has(String(id));

module.exports = { runImport, runDelete, cancel, isRunning, storageInfo };
