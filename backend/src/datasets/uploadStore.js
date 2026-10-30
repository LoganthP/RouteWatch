// RouteWatch — resumable chunked upload store.
// Design rules that fix the "missing chunks" bug:
//  * Every chunk is its own file, written to a temp name then atomically renamed.
//    There is NO shared manifest that parallel PUTs read-modify-write (that race loses chunks).
//  * Session state is derived from the files on disk, so it survives server restarts.
//  * init() with the same fingerprint RESUMES the existing session instead of creating a new
//    empty one (the old client re-inited and then skipped chunks it had sent to the OLD session).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { once } = require('node:events');
const { UPLOAD_DIR, DATASET_DIR, STORAGE_ROOT, LIMITS } = require('./config.js');

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const ID_RE = /^[a-f0-9-]{36}$/;
const sessionDir = (id) => {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid upload id');
  return path.join(UPLOAD_DIR, id);
};
const chunkPath = (id, i) => path.join(sessionDir(id), `${String(i).padStart(6, '0')}.part`);
const safeName = (n) => (path.basename(String(n || 'dataset')).replace(/[^\w.\- ()]+/g, '_').slice(0, 180) || 'dataset');

async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj));
  await fsp.rename(tmp, file);
}

async function dirSize(dir) {
  let total = 0;
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

async function ensureDirs() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(DATASET_DIR, { recursive: true });
}

async function storageUsage() {
  const used = await dirSize(DATASET_DIR) + await dirSize(UPLOAD_DIR);
  let freeDisk = null;
  try { const s = await fsp.statfs(STORAGE_ROOT); freeDisk = s.bavail * s.bsize; } catch { /* older Node */ }
  return { usedBytes: used, quotaBytes: LIMITS.quotaBytes, freeDiskBytes: freeDisk };
}

async function getLimits() {
  const u = await storageUsage();
  return {
    chunkSize: LIMITS.chunkSize,
    maxFileBytes: LIMITS.maxFileBytes,
    ...u,
    supportedFormats: ['csv', 'tsv', 'txt', 'json', 'ndjson', 'geojson', 'xlsx', 'kml', 'gpx', 'shp (+dbf)', 'zip (any of these, nested ok)'],
  };
}

async function readMeta(id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid upload id');
  try { return JSON.parse(await fsp.readFile(path.join(sessionDir(id), 'meta.json'), 'utf8')); }
  catch { return null; }
}

async function receivedChunks(id) {
  const files = await fsp.readdir(sessionDir(id)).catch(() => []);
  return files.filter((f) => f.endsWith('.part')).map((f) => Number(f.slice(0, 6))).sort((a, b) => a - b);
}

async function initUpload({ fileName, size, fingerprint, mimeType, chunkSize }) {
  size = Number(size);
  if (!fileName || !Number.isFinite(size) || size <= 0) throw new HttpError(400, 'fileName and size are required');
  if (size > LIMITS.maxFileBytes) throw new HttpError(413, `File exceeds the ${(LIMITS.maxFileBytes / 2 ** 30).toFixed(1)} GB limit`);

  // Resume: same fingerprint (name+size+lastModified) => same session.
  const fp = crypto.createHash('sha1').update(String(fingerprint || `${fileName}:${size}`)).digest('hex');
  const dirs = await fsp.readdir(UPLOAD_DIR).catch(() => []);
  for (const d of dirs) {
    if (!ID_RE.test(d)) continue;
    const m = await readMeta(d);
    if (m && m.fingerprint === fp && m.size === size && Date.now() - m.updatedAt < LIMITS.sessionTtlMs) {
      return { ...publicSession(m), received: await receivedChunks(d), resumed: true };
    }
  }

  const { usedBytes, freeDiskBytes } = await storageUsage();
  if (usedBytes + size > LIMITS.quotaBytes) {
    throw new HttpError(507, `Storage quota exceeded: ${(usedBytes / 2 ** 20).toFixed(0)} MB used of ${(LIMITS.quotaBytes / 2 ** 20).toFixed(0)} MB. Delete an old dataset first.`);
  }
  if (freeDiskBytes != null && freeDiskBytes - size * 2 < LIMITS.minFreeDiskBytes) {
    throw new HttpError(507, 'Not enough free disk space on the server for this file');
  }

  const cs = Math.min(Math.max(Number(chunkSize) || LIMITS.chunkSize, 1024 * 1024), 64 * 1024 * 1024);
  const meta = {
    uploadId: crypto.randomUUID(), fileName: safeName(fileName), mimeType: mimeType || null, size,
    chunkSize: cs, totalChunks: Math.ceil(size / cs), fingerprint: fp, createdAt: Date.now(), updatedAt: Date.now(),
  };
  await fsp.mkdir(sessionDir(meta.uploadId), { recursive: true });
  await writeJsonAtomic(path.join(sessionDir(meta.uploadId), 'meta.json'), meta);
  return { ...publicSession(meta), received: [], resumed: false };
}

const publicSession = (m) => ({ uploadId: m.uploadId, fileName: m.fileName, size: m.size, chunkSize: m.chunkSize, totalChunks: m.totalChunks });

async function uploadStatus(id) {
  const meta = await readMeta(id);
  if (!meta) throw new HttpError(404, 'Upload session not found or expired', { code: 'SESSION_GONE' });
  const received = await receivedChunks(id);
  return { ...publicSession(meta), received, missing: missingOf(meta, received) };
}

const missingOf = (meta, received) => {
  const have = new Set(received);
  const out = [];
  for (let i = 0; i < meta.totalChunks; i++) if (!have.has(i)) out.push(i);
  return out;
};

/** Streams the request body straight to disk — never buffers 8 MB per request in memory. */
async function writeChunk(id, index, req) {
  const meta = await readMeta(id);
  if (!meta) throw new HttpError(404, 'Upload session not found or expired', { code: 'SESSION_GONE' });
  index = Number(index);
  if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
    throw new HttpError(400, `Chunk index must be 0..${meta.totalChunks - 1}`);
  }
  const expected = index === meta.totalChunks - 1 ? meta.size - index * meta.chunkSize : meta.chunkSize;
  const final = chunkPath(id, index);
  const tmp = `${final}.${crypto.randomUUID()}.tmp`;

  let bytes = 0;
  const counter = new Transform({
    transform(c, _e, cb) {
      bytes += c.length;
      if (bytes > expected) return cb(new HttpError(400, `Chunk ${index} larger than expected (${expected} bytes)`));
      cb(null, c);
    },
  });
  try {
    await pipeline(req, counter, fs.createWriteStream(tmp));
    if (bytes !== expected) throw new HttpError(400, `Chunk ${index} incomplete: got ${bytes} of ${expected} bytes`);
    await fsp.rename(tmp, final); // atomic — a chunk either fully exists or not at all
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  meta.updatedAt = Date.now();
  await writeJsonAtomic(path.join(sessionDir(id), 'meta.json'), meta).catch(() => {});
  const received = await receivedChunks(id);
  return { uploadId: id, index, bytes, received: received.length, totalChunks: meta.totalChunks };
}

/** Concatenates chunks into storage/datasets/<datasetId>/<fileName>. */
async function completeUpload(id) {
  const meta = await readMeta(id);
  if (!meta) throw new HttpError(404, 'Upload session not found or expired', { code: 'SESSION_GONE' });
  const received = await receivedChunks(id);
  const missing = missingOf(meta, received);
  if (missing.length) throw new HttpError(409, `Missing ${missing.length} chunk(s)`, { code: 'MISSING_CHUNKS', missing });

  const datasetId = crypto.randomUUID();
  const outDir = path.join(DATASET_DIR, datasetId);
  await fsp.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, meta.fileName);
  const out = fs.createWriteStream(outFile);
  try {
    for (let i = 0; i < meta.totalChunks; i++) {
      for await (const c of fs.createReadStream(chunkPath(id, i), { highWaterMark: 1 << 20 })) {
        if (!out.write(c)) await once(out, 'drain');
      }
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    const { size } = await fsp.stat(outFile);
    if (size !== meta.size) throw new HttpError(500, `Assembled file is ${size} bytes, expected ${meta.size}`);
  } catch (err) {
    out.destroy();
    await fsp.rm(outDir, { recursive: true, force: true });
    throw err;
  }
  await fsp.rm(sessionDir(id), { recursive: true, force: true });
  return { datasetId, filePath: outFile, fileName: meta.fileName, size: meta.size, mimeType: meta.mimeType };
}

async function abortUpload(id) {
  await fsp.rm(sessionDir(id), { recursive: true, force: true });
  return { uploadId: id, aborted: true };
}

async function removeDatasetFiles(datasetId) {
  if (!ID_RE.test(datasetId)) throw new HttpError(400, 'Invalid dataset id');
  await fsp.rm(path.join(DATASET_DIR, datasetId), { recursive: true, force: true });
}

/** Removes abandoned sessions + leftover .tmp files. Safe to call any time. */
async function sweepExpired() {
  const dirs = await fsp.readdir(UPLOAD_DIR).catch(() => []);
  for (const d of dirs) {
    if (!ID_RE.test(d)) continue;
    const m = await readMeta(d);
    if (!m || Date.now() - m.updatedAt > LIMITS.sessionTtlMs) {
      await fsp.rm(path.join(UPLOAD_DIR, d), { recursive: true, force: true });
    }
  }
}

module.exports = {
  HttpError,
  ensureDirs,
  storageUsage,
  getLimits,
  initUpload,
  uploadStatus,
  writeChunk,
  completeUpload,
  abortUpload,
  removeDatasetFiles,
  sweepExpired,
};
