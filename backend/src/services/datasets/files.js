/**
 * Disk layout, upload sessions (persisted on disk so restarts never lose them),
 * file-type sniffing and housekeeping.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../.data'));
const DIRS = { uploads: path.join(ROOT, 'uploads'), datasets: path.join(ROOT, 'datasets'), reports: path.join(ROOT, 'reports') };
Object.values(DIRS).forEach((d) => fs.mkdirSync(d, { recursive: true }));

const EXT_KIND = {
  csv: 'csv', tsv: 'tsv', txt: 'txt', json: 'json', geojson: 'geojson', kml: 'kml', gpx: 'gpx',
  xlsx: 'xlsx', xls: 'xls', pdf: 'pdf', zip: 'zip',
};
const ARCHIVE_EXT = /\.(zip|rar|7z|gz|tgz|tar|bz2|xz)$/i;
const IN_MEMORY = new Set(['json', 'geojson', 'kml', 'gpx', 'pdf']);

const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
const kindOf = (name) => EXT_KIND[extOf(name)] || null;
const safeName = (name) => String(name).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'upload';
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));

/** Check the real file content matches the claimed type. Returns error string or null. */
async function verifyMagic(filePath, kind) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    const head = buf.subarray(0, bytesRead);
    if (!bytesRead) return 'The file is empty.';
    const hex = head.subarray(0, 4).toString('hex');
    if (hex.startsWith('4d5a') || hex === '7f454c46') return 'Executable files are not allowed.';
    if (hex === 'd0cf11e0') {
      if (kind === 'xlsx') return 'Password-protected Excel files are not supported. Remove the password and try again.';
      return 'Legacy .xls files are not supported. Save it as .xlsx or .csv.';
    }
    if (kind === 'xls') return 'Legacy .xls files are not supported. Save it as .xlsx or .csv.';
    if (kind === 'zip' || kind === 'xlsx') return hex === '504b0304' ? null : `This is not a real ${kind.toUpperCase()} file (content does not match the extension).`;
    if (kind === 'pdf') return head.subarray(0, 5).toString() === '%PDF-' ? null : 'This is not a real PDF file.';
    // text formats: reject binary content
    const nul = head.indexOf(0);
    if (nul !== -1 && !(head[0] === 0xff || head[0] === 0xfe)) return 'This file contains binary data, not text. Check the format.';
    return null;
  } finally { await fh.close(); }
}

/* ---------------- upload sessions ---------------- */
const sessionDir = (id) => path.join(DIRS.uploads, id);

async function createSession({ filename, size, owner, chunkSize }) {
  const id = crypto.randomUUID();
  const dir = sessionDir(id);
  await fsp.mkdir(path.join(dir, 'chunks'), { recursive: true });
  const meta = {
    id, filename: safeName(filename), kind: kindOf(filename), size, chunkSize,
    totalChunks: Math.max(1, Math.ceil(size / chunkSize)), owner: String(owner), createdAt: Date.now(),
  };
  await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta));
  await fsp.writeFile(path.join(dir, 'data.part'), '');
  return meta;
}

async function readSession(id) {
  if (!isUuid(id)) return null;
  try { return JSON.parse(await fsp.readFile(path.join(sessionDir(id), 'meta.json'), 'utf8')); } catch { return null; }
}

async function receivedChunks(id) {
  try {
    return (await fsp.readdir(path.join(sessionDir(id), 'chunks'))).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  } catch { return []; }
}

/** Write one chunk at its byte offset (idempotent, safe for parallel/retried chunks). */
async function writeChunk(meta, index, buf) {
  const fh = await fsp.open(path.join(sessionDir(meta.id), 'data.part'), 'r+');
  try {
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await fh.write(buf, off, buf.length - off, index * meta.chunkSize + off);
      off += bytesWritten;
    }
  } finally { await fh.close(); }
  await fsp.writeFile(path.join(sessionDir(meta.id), 'chunks', String(index)), '');
}

async function finalizeSession(meta) {
  const dest = path.join(DIRS.datasets, `${meta.id}.${extOf(meta.filename)}`);
  await fsp.rename(path.join(sessionDir(meta.id), 'data.part'), dest);
  await removeSession(meta.id);
  return dest;
}

const removeSession = (id) => (isUuid(id) ? fsp.rm(sessionDir(id), { recursive: true, force: true }) : null);
const removeFile = (p) => (p ? fsp.rm(p, { force: true }).catch(() => {}) : null);

/** Delete stale upload sessions (>24h) and orphaned dataset files. */
async function sweep(activeFiles = new Set()) {
  const now = Date.now();
  for (const [dir, ttl] of [[DIRS.uploads, 24 * 36e5], [DIRS.datasets, 24 * 36e5]]) {
    let names = [];
    try { names = await fsp.readdir(dir); } catch { continue; }
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        const st = await fsp.stat(p);
        if (now - st.mtimeMs > ttl && !activeFiles.has(p)) await fsp.rm(p, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }
}

module.exports = {
  DIRS, ROOT, kindOf, extOf, safeName, isUuid, ARCHIVE_EXT, IN_MEMORY, verifyMagic,
  createSession, readSession, receivedChunks, writeChunk, finalizeSession, removeSession, removeFile, sweep,
};
