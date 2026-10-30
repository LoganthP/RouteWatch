const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

function parseNum(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function getLimits(userRole = 'citizen') {
  try {
    const envPath = path.resolve(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^DB_QUOTA_MB=(\d+)/m);
      if (match) process.env.DB_QUOTA_MB = match[1];
    }
  } catch {}

  const maxUploadMb = parseNum(process.env.MAX_UPLOAD_MB, 4096);
  const maxZipEntries = parseNum(process.env.MAX_ZIP_ENTRIES, 50);
  const maxUncompressedMb = parseNum(process.env.MAX_UNCOMPRESSED_MB, 8192);
  const maxImportRowsAdmin = parseNum(process.env.MAX_IMPORT_ROWS_ADMIN, 500000);
  const maxImportRowsCitizen = parseNum(process.env.MAX_IMPORT_ROWS_CITIZEN, 500);
  const dbQuotaMb = parseNum(process.env.DB_QUOTA_MB, 512);
  const chunkSize = 8 * 1024 * 1024; // 8 MB chunks
  const isAdmin = userRole === 'admin';

  return {
    maxUploadMb,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    maxZipEntries,
    maxUncompressedMb,
    maxUncompressedBytes: maxUncompressedMb * 1024 * 1024,
    maxImportRowsAdmin,
    maxImportRowsCitizen,
    maxImportRows: isAdmin ? maxImportRowsAdmin : maxImportRowsCitizen,
    dbQuotaMb,
    chunkSize,
    memoryParserMaxBytes: 200 * 1024 * 1024, // 200 MB max for in-memory parsers
  };
}

async function getDbStats() {
  const limits = getLimits();
  let storageSize = 0;
  let indexSize = 0;
  let dataSize = 0;

  try {
    if (mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db) {
      const stats = await mongoose.connection.db.stats();
      storageSize = stats.storageSize || 0;
      indexSize = stats.indexSize || 0;
      dataSize = stats.dataSize || 0;
    }
  } catch (err) {
    // If db.stats() is restricted, estimate based on document count
    try {
      const Incident = mongoose.model('Incident');
      const count = await Incident.estimatedDocumentCount();
      storageSize = count * 600;
      indexSize = count * 300;
    } catch {}
  }

  const storageMb = +(storageSize / (1024 * 1024)).toFixed(2);
  const indexMb = +(indexSize / (1024 * 1024)).toFixed(2);
  const dataMb = +(dataSize / (1024 * 1024)).toFixed(2);
  const totalUsedMb = +(storageMb + indexMb).toFixed(2);
  const quotaMb = limits.dbQuotaMb;
  const quotaEnabled = quotaMb > 0;
  const usagePercent = quotaEnabled ? +((totalUsedMb / quotaMb) * 100).toFixed(1) : 0;
  const warning = quotaEnabled && usagePercent >= 80;
  const quotaExceeded = quotaEnabled && totalUsedMb >= quotaMb;

  return {
    storageMb,
    indexMb,
    dataMb,
    totalUsedMb,
    quotaMb,
    quotaEnabled,
    usagePercent,
    warning,
    quotaExceeded,
  };
}

function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '0 B';
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  const gb = b / (1024 * 1024 * 1024);
  const gbFormatted = (Math.round(gb * 100) / 100).toFixed(2);
  return `${gbFormatted} GB`;
}

function cleanTempDir(dir, maxAgeMs = 3600 * 1000) {
  if (!fs.existsSync(dir)) return;
  const now = Date.now();

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          if (ent.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
        }
      } catch {}
    }
  } catch (err) {
    console.error(`[cleanup] Failed to clean ${dir}:`, err.message);
  }
}

const os = require('os');
const UPLOAD_DIR = process.env.TEMP_UPLOAD_DIR || path.join(os.tmpdir(), 'routewatch-uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
}

module.exports = {
  UPLOAD_DIR,
  getLimits,
  getDbStats,
  fmtBytes,
  cleanTempDir,
};
