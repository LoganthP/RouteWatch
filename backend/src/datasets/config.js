// RouteWatch — dataset storage configuration
// IMPORTANT: STORAGE_ROOT lives OUTSIDE ./src. `node --watch-path=./src` restarts the
// server whenever anything under src/ changes — writing upload chunks there kills the
// in-memory upload session mid-upload (one cause of the 404s on /chunk).
const path = require('node:path');

const MB = 1024 * 1024;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

const STORAGE_ROOT = path.resolve(process.env.DATASET_STORAGE_DIR || path.join(process.cwd(), 'storage'));
const UPLOAD_DIR = path.join(STORAGE_ROOT, 'uploads');   // in-progress chunk sessions
const DATASET_DIR = path.join(STORAGE_ROOT, 'datasets'); // assembled files

const LIMITS = {
  chunkSize: num(process.env.UPLOAD_CHUNK_MB, 8) * MB,
  maxFileBytes: num(process.env.UPLOAD_MAX_FILE_GB, 20) * 1024 * MB,
  quotaBytes: num(process.env.STORAGE_QUOTA_MB, 20480) * MB,     // stored raw files
  minFreeDiskBytes: num(process.env.MIN_FREE_DISK_MB, 1024) * MB, // keep this free on disk
  sessionTtlMs: num(process.env.UPLOAD_SESSION_TTL_H, 48) * 3600 * 1000,
  batchSize: num(process.env.IMPORT_BATCH_SIZE, 2000),
  maxGeometryBytes: 8 * MB, // keep well under MongoDB's 16 MB document limit
};

const COLLECTIONS = {
  incidents: process.env.INCIDENTS_COLLECTION || 'incidents',
  records: 'dataset_records', // non-incident rows (traffic counts, boundaries, anything else)
  datasets: 'datasets',
  jobs: 'import_jobs',
};

module.exports = {
  STORAGE_ROOT,
  UPLOAD_DIR,
  DATASET_DIR,
  LIMITS,
  COLLECTIONS,
};
