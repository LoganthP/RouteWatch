// Shared enums used by schemas, validation, seed, importers and analytics.
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : d);

module.exports = {
  INCIDENT_TYPES: ['Accident', 'Congestion', 'Construction', 'Road Closure', 'Hazard', 'Other'],
  SEVERITIES: ['Low', 'Medium', 'High', 'Critical'],
  STATUSES: ['Pending', 'Verified', 'Resolved', 'Rejected'],
  SOURCES: ['User Report', 'Admin', 'Synthetic', 'Dataset Upload'],
  SEVERITY_WEIGHT: { Low: 1, Medium: 2, High: 3, Critical: 4 },
  // Per-document IANA zone; falls back to UTC for legacy rows
  TZ_EXPR: { $ifNull: ['$tz', 'UTC'] },

  LIMITS: {
    get maxUploadMB() { return num(process.env.MAX_UPLOAD_MB, 4096); },
    get maxZipEntries() { return num(process.env.MAX_ZIP_ENTRIES, 50); },
    get maxUncompressedMB() { return num(process.env.MAX_UNCOMPRESSED_MB, 8192); },
    get maxRowsAdmin() { return num(process.env.MAX_IMPORT_ROWS_ADMIN, 500000); },
    get maxRowsCitizen() { return num(process.env.MAX_IMPORT_ROWS_CITIZEN, 500); },
    get maxInMemoryMB() { return num(process.env.MAX_INMEMORY_MB, 200); },
    get quotaMB() { return num(process.env.DB_QUOTA_MB, 512); },
    get geocodeEnabled() { return String(process.env.GEOCODE_ENABLED ?? 'true') === 'true'; },
    get geocodeMax() { return num(process.env.GEOCODE_MAX_PER_IMPORT, 200); },
    chunkSize: 8 * 1024 * 1024,
  },
};
