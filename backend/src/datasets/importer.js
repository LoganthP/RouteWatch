// RouteWatch — dataset inspection + background import queue.
// * One import runs at a time (keeps MongoDB and the API responsive while importing).
// * Reads -> transforms -> insertMany(ordered:false) in batches, awaiting each batch
//   (natural back-pressure: memory stays flat for any file size).
// * Every document has a unique source.key, so re-running/resuming an import never duplicates.
// * Progress is pushed over Socket.IO ("dataset:progress") and persisted on the dataset doc.
const { listEntries, readRecords } = require('./readers.js');
const { proposeMapping, buildTransformer } = require('./mapping.js');
const { DatasetProfiler } = require('./insights.js');
const { COLLECTIONS, LIMITS } = require('./config.js');

let ctx = { db: null, io: null };
const queue = [];
let running = null;

function configureImporter({ db, io }) { ctx = { db, io }; }

async function ensureIndexes(db) {
  const inc = db.collection(COLLECTIONS.incidents);
  const rec = db.collection(COLLECTIONS.records);
  await Promise.all([
    inc.createIndex({ location: '2dsphere' }),
    inc.createIndex({ occurredAt: -1 }),
    inc.createIndex({ severity: 1, occurredAt: -1 }),
    inc.createIndex({ area: 1 }),
    inc.createIndex({ type: 1 }),
    inc.createIndex({ 'source.datasetId': 1 }),
    inc.createIndex({ 'source.key': 1 }, { unique: true, partialFilterExpression: { 'source.key': { $type: 'string' } } }),
    rec.createIndex({ datasetId: 1, kind: 1 }),
    rec.createIndex({ location: '2dsphere' }, { sparse: true }),
    rec.createIndex({ 'source.key': 1 }, { unique: true }),
    db.collection(COLLECTIONS.datasets).createIndex({ createdAt: -1 }),
  ].map((p) => p.catch((e) => console.warn('[datasets] index warning:', e.message))));
}

/** Startup recovery: anything left "importing" by a crash/restart becomes "interrupted" (retryable). */
async function recoverInterrupted(db) {
  await db.collection(COLLECTIONS.datasets).updateMany(
    { status: { $in: ['importing', 'queued', 'inspecting'] } },
    { $set: { status: 'interrupted', error: 'Server restarted during processing — press Retry; already-imported rows are kept and not duplicated.' } },
  );
}

const emit = (event, payload) => { try { ctx.io?.emit(event, payload); } catch { /* ignore */ } };
const datasets = () => ctx.db.collection(COLLECTIONS.datasets);

/* --------------------------------------------------------------- inspect */

/** Lists entries + samples each one + proposes a mapping. Fast: reads only the head of each file. */
async function inspectDataset(datasetId) {
  const ds = await datasets().findOne({ _id: datasetId });
  if (!ds) throw Object.assign(new Error('Dataset not found'), { status: 404 });
  await datasets().updateOne({ _id: datasetId }, { $set: { status: 'inspecting' } });
  const { entries, close } = await listEntries(ds.filePath, ds.fileName);
  try {
    const out = [];
    for (const e of entries) {
      const base = { id: e.id, name: e.name, format: e.format, size: e.size, skipped: !!e.skipped, reason: e.reason || null };
      if (e.companion) continue;
      if (e.skipped) { out.push(base); continue; }
      try {
        const rows = [];
        for await (const r of readRecords(e, { limit: 1000, maxMs: 5000 })) rows.push(r);
        if (!rows.length) { out.push({ ...base, skipped: true, reason: 'No readable rows found' }); continue; }
        const proposal = proposeMapping(e.name, rows);
        const sample = rows.slice(0, 5).map((r) => { const { __geometry, ...rest } = r; return __geometry ? { ...rest, __geometry: __geometry.type } : rest; });
        out.push({ ...base, proposal, sample, estimatedRows: estimateRows(e, rows) });
      } catch (err) {
        out.push({ ...base, skipped: true, reason: `Could not read file: ${err.message}` });
      }
    }
    await datasets().updateOne({ _id: datasetId }, { $set: { entries: out, status: 'inspected', inspectedAt: new Date() } });
    return { datasetId, entries: out };
  } catch (err) {
    await datasets().updateOne({ _id: datasetId }, { $set: { status: 'failed', error: err.message } });
    throw err;
  } finally { await close(); }
}

function estimateRows(entry, rows) {
  if (entry.format !== 'csv' || rows.length < 50) return null;
  const avg = rows.reduce((a, r) => a + Object.values(r).join(',').length + 2, 0) / rows.length;
  return Math.round(entry.size / avg);
}

/* --------------------------------------------------------------- import */

/**
 * selections: [{ entryId, mapping? }] — mapping defaults to the proposal from inspect.
 * Omit selections to import every non-skipped entry with its proposal.
 */
async function enqueueImport(datasetId, selections) {
  const ds = await datasets().findOne({ _id: datasetId });
  if (!ds) throw Object.assign(new Error('Dataset not found'), { status: 404 });
  if (!ds.entries) throw Object.assign(new Error('Dataset not inspected yet'), { status: 409 });
  if (['queued', 'importing'].includes(ds.status)) throw Object.assign(new Error('Import already in progress'), { status: 409 });

  const byId = new Map(ds.entries.map((e) => [e.id, e]));
  const picks = (selections?.length ? selections : ds.entries.filter((e) => !e.skipped).map((e) => ({ entryId: e.id })))
    .map((s) => {
      const e = byId.get(String(s.entryId));
      if (!e || e.skipped) return null;
      const mapping = s.mapping ? { ...e.proposal, ...s.mapping, columns: { ...e.proposal.columns, ...(s.mapping.columns || {}) } } : e.proposal;
      return mapping.kind === 'skip' ? null : { entryId: e.id, name: e.name, mapping };
    }).filter(Boolean);
  if (!picks.length) throw Object.assign(new Error('Nothing selected to import'), { status: 400 });

  await datasets().updateOne({ _id: datasetId }, { $set: { status: 'queued', selections: picks, error: null, progress: null } });
  queue.push(datasetId);
  emit('dataset:progress', { datasetId, status: 'queued', position: queue.length });
  setImmediate(pump);
  return { datasetId, status: 'queued', files: picks.length };
}

function cancelImport(datasetId) {
  if (running?.datasetId === datasetId) { running.cancelled = true; return true; }
  const i = queue.indexOf(datasetId);
  if (i >= 0) { queue.splice(i, 1); datasets().updateOne({ _id: datasetId }, { $set: { status: 'cancelled' } }); return true; }
  return false;
}

const importState = () => ({ running: running?.datasetId || null, queued: [...queue] });

async function pump() {
  if (running || !queue.length) return;
  const datasetId = queue.shift();
  running = { datasetId, cancelled: false };
  try { await runImport(running); }
  catch (err) {
    console.error('[datasets] import failed', datasetId, err.code ?? '', err.message); // message only: bulk errors can be MBs
    await datasets().updateOne({ _id: datasetId }, { $set: { status: 'failed', error: err.message, finishedAt: new Date() } }).catch(() => {});
    emit('dataset:progress', { datasetId, status: 'failed', error: err.message });
  } finally { running = null; setImmediate(pump); }
}

async function runImport(job) {
  const { datasetId } = job;
  const ds = await datasets().findOne({ _id: datasetId });
  const { entries, close } = await listEntries(ds.filePath, ds.fileName);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const profilers = { incidents: new DatasetProfiler(), records: new DatasetProfiler(), boundaries: new DatasetProfiler() };
  const all = () => Object.values(profilers);
  const sum = (k) => all().reduce((a, p) => a + p[k], 0);
  const totalBytes = ds.selections.reduce((a, s) => a + (byName.get(s.name)?.size || 0), 0) || 1;
  let bytesDone = 0; let lastEmit = 0;
  const startedAt = new Date();
  await datasets().updateOne({ _id: datasetId }, { $set: { status: 'importing', startedAt } });

  const progress = async (file, force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 750) return;
    lastEmit = now;
    const elapsed = (now - startedAt.getTime()) / 1000;
    const p = {
      datasetId, status: 'importing', file,
      percent: Math.min(99.9, Math.round((bytesDone / totalBytes) * 1000) / 10),
      rowsRead: sum('rows'), stored: sum('stored'), invalid: sum('invalid'), duplicates: sum('duplicates'),
      rowsPerSec: elapsed ? Math.round(sum('rows') / elapsed) : 0,
      etaSec: bytesDone ? Math.round((elapsed / bytesDone) * (totalBytes - bytesDone)) : null,
    };
    emit('dataset:progress', p);
    await datasets().updateOne({ _id: datasetId }, { $set: { progress: p } }).catch(() => {});
  };

  try {
    for (const sel of ds.selections) {
      const entry = byName.get(sel.name);
      if (!entry) { profilers.incidents.invalidRow('file_missing_from_archive'); continue; }
      const profiler = profilers[sel.mapping.kind] || profilers.records;
      const transform = buildTransformer(sel.mapping);
      const coll = ctx.db.collection(sel.mapping.kind === 'incidents' ? COLLECTIONS.incidents : COLLECTIONS.records);
      let batch = []; let rowNumber = 0;

      const insert = async (docs) => {
        try {
          const r = await coll.insertMany(docs, { ordered: false });
          profiler.stored += r.insertedCount;
        } catch (err) {
          const writeErrors = err.writeErrors ? (Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors]) : [];
          if (!writeErrors.length && err.code !== 11000) throw err; // connection-level failure → job fails, retry is safe
          profiler.stored += err.insertedCount ?? err.result?.insertedCount ?? 0;
          for (const we of writeErrors) {
            if ((we.code ?? we.err?.code) === 11000) profiler.duplicates++;
            else profiler.invalidRow(`db_rejected_${we.code ?? 'unknown'}`);
          }
        }
      };
      // One batch is written while the next one is parsed (uses a 2nd CPU core when available).
      let pending = null;
      const flush = async (final = false) => {
        if (pending) { await pending; pending = null; }
        if (batch.length) { const docs = batch; batch = []; pending = insert(docs); pending.catch(() => {}); }
        if (final && pending) { await pending; pending = null; }
      };

      for await (const rec of readRecords(entry, { onBytes: (n) => { bytesDone += n; } })) {
        if (job.cancelled) break;
        rowNumber++;
        profiler.observeRaw(rec);
        const res = transform(rec, { datasetId, entryName: entry.name, rowNumber, maxGeometryBytes: LIMITS.maxGeometryBytes });
        if (res.invalid) { profiler.invalidRow(res.invalid); continue; }
        profiler.observeDoc(res.doc, entry.name);
        batch.push(res.doc);
        if (batch.length >= LIMITS.batchSize) { await flush(); await progress(entry.name); }
      }
      await flush(true);
      await progress(entry.name, true);
      if (job.cancelled) break;
    }
  } finally { await close(); }

  const byKind = Object.fromEntries(Object.entries(profilers).filter(([, p]) => p.rows).map(([k, p]) => [k, p.summary()]));
  const totals = { rowsRead: sum('rows'), stored: sum('stored'), invalid: sum('invalid'), duplicates: sum('duplicates') };
  // `primary` = what dashboards should show: incidents if any, else whatever was imported.
  const primary = byKind.incidents ? 'incidents' : Object.keys(byKind)[0] || null;
  const insights = { totals, primary, byKind, ...(primary ? byKind[primary] : {}), totals };
  const status = job.cancelled ? 'cancelled' : 'ready';
  await datasets().updateOne({ _id: datasetId }, {
    $set: { status, insights, finishedAt: new Date(), progress: { percent: 100, ...totals } },
  });
  emit('dataset:progress', { datasetId, status, percent: 100, ...totals });
  emit('incidents:changed', { datasetId }); // let dashboards refetch
}

/** Removes a dataset's imported documents (in chunks so it never blocks the DB). */
async function purgeDatasetDocs(datasetId) {
  const r1 = await ctx.db.collection(COLLECTIONS.incidents).deleteMany({ 'source.datasetId': datasetId });
  const r2 = await ctx.db.collection(COLLECTIONS.records).deleteMany({ datasetId });
  return { incidents: r1.deletedCount, records: r2.deletedCount };
}

module.exports = {
  configureImporter,
  ensureIndexes,
  recoverInterrupted,
  inspectDataset,
  enqueueImport,
  cancelImport,
  importState,
  purgeDatasetDocs,
};
