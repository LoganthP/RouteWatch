const fs = require('fs');
const path = require('path');
const { parse: parseCsvStream } = require('csv-parse');
const { parse: parseCsvSync } = require('csv-parse/sync');
const XLSX = require('xlsx');
const unzipper = require('unzipper');
const pdfParse = require('pdf-parse');
const { DOMParser } = require('@xmldom/xmldom');
const toGeoJSON = require('@tmcw/togeojson');
const tzLookup = require('tz-lookup');
const { INCIDENT_TYPES, SEVERITIES, STATUSES } = require('../config/constants');
const { fallbackLabel, geocodeForwardAsync } = require('./areaResolver');
const { getLimits, fmtBytes } = require('../config/uploadLimits');

// Magic bytes validation
function verifyMagicBytes(filePath, ext) {
  const buf = Buffer.alloc(8);
  const fd = fs.openSync(filePath, 'r');
  const bytesRead = fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  if (bytesRead < 4) return false;

  const hex = buf.toString('hex', 0, 4).toUpperCase();
  const textHead = buf.toString('utf8', 0, Math.min(bytesRead, 8));

  if (ext === 'pdf') {
    return textHead.startsWith('%PDF');
  }
  if (ext === 'zip' || ext === 'xlsx') {
    return hex.startsWith('504B0304') || hex.startsWith('504B0506') || hex.startsWith('504B0708');
  }
  if (ext === 'xls') {
    return hex.startsWith('D0CF11E0') || hex.startsWith('504B0304');
  }
  // Text-based files: csv, tsv, json, geojson, kml, gpx, txt
  for (let i = 0; i < bytesRead; i++) {
    const b = buf[i];
    if (b === 0) return false; // Null byte indicates binary
  }
  return true;
}

// Coordinate parsing (handles decimals, "lat,lng", and DMS)
function parseDMS(str) {
  const m = str.match(/([0-9.]+)\s*°?\s*([0-9.]+)?\s*'?\s*([0-9.]+)?\s*"?\s*([NSEW])/i);
  if (!m) return null;
  const deg = parseFloat(m[1]) || 0;
  const min = parseFloat(m[2]) || 0;
  const sec = parseFloat(m[3]) || 0;
  const dir = m[4].toUpperCase();
  let val = deg + min / 60 + sec / 3600;
  if (dir === 'S' || dir === 'W') val = -val;
  return val;
}

function parseCoordinates(rawLat, rawLng) {
  let lat = null;
  let lng = null;

  if (rawLat !== undefined && rawLng === undefined) {
    const s = String(rawLat).trim();
    if (/[NSEW]/i.test(s)) {
      const parts = s.split(/[,;|\s]+(?=[0-9])/);
      if (parts.length >= 2) {
        const d1 = parseDMS(parts[0]);
        const d2 = parseDMS(parts[1]);
        if (d1 !== null && d2 !== null) {
          if (/[NS]/i.test(parts[0])) { lat = d1; lng = d2; }
          else { lng = d1; lat = d2; }
        }
      }
    } else {
      const parts = s.split(/[,;\s]+/).map(Number).filter(Number.isFinite);
      if (parts.length >= 2) {
        lat = parts[0];
        lng = parts[1];
      }
    }
  } else {
    lat = typeof rawLat === 'string' && /[NSEW]/i.test(rawLat) ? parseDMS(rawLat) : Number(rawLat);
    lng = typeof rawLng === 'string' && /[NSEW]/i.test(rawLng) ? parseDMS(rawLng) : Number(rawLng);
  }

  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  // Swap-detect reversed coordinates: lat between 90..180 and lng between -90..90
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    const tmp = lat;
    lat = lng;
    lng = tmp;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
}

// Normalizers
const TYPE_SYNONYMS = {
  Accident: ['accident', 'crash', 'collision', 'hit', 'wreck', 'overturn', 'pileup', 'vehicular accident'],
  Congestion: ['congestion', 'jam', 'traffic', 'gridlock', 'slow', 'delay', 'queue', 'backup', 'bottleneck', 'heavy traffic'],
  Construction: ['construction', 'roadwork', 'road work', 'maintenance', 'repairs', 'resurfacing', 'road repair'],
  'Road Closure': ['road closure', 'closure', 'closed', 'blocked', 'blockage', 'diversion', 'detour', 'barricade'],
  Hazard: ['hazard', 'debris', 'pothole', 'waterlogging', 'flood', 'fallen tree', 'spill', 'obstacle', 'animal', 'cattle', 'oil spill'],
  Other: ['other', 'misc', 'general', 'signal broken', 'breakdown'],
};

function normalizeType(val, defaultVal = 'Accident') {
  if (!val) return defaultVal;
  const s = String(val).trim().toLowerCase();
  for (const [canonical, syns] of Object.entries(TYPE_SYNONYMS)) {
    if (canonical.toLowerCase() === s || syns.some((syn) => s.includes(syn))) {
      return canonical;
    }
  }
  return INCIDENT_TYPES.includes(val) ? val : defaultVal;
}

const SEV_SYNONYMS = {
  Critical: ['critical', 'fatal', 'severe', 'extreme', 'disaster', 'catastrophic', 'urgent', 'danger', 'level 4'],
  High: ['high', 'major', 'heavy', 'serious', 'level 3'],
  Medium: ['medium', 'moderate', 'average', 'med', 'normal', 'level 2'],
  Low: ['low', 'minor', 'slight', 'light', 'trivial', 'level 1'],
};

function normalizeSeverity(val, defaultVal = 'Medium') {
  if (val === undefined || val === null || val === '') return defaultVal;

  // Numeric 1-4 mapping
  const num = Number(val);
  if (Number.isInteger(num)) {
    if (num === 1) return 'Low';
    if (num === 2) return 'Medium';
    if (num === 3) return 'High';
    if (num === 4) return 'Critical';
  }

  const s = String(val).trim().toLowerCase();
  if (s === '1') return 'Low';
  if (s === '2') return 'Medium';
  if (s === '3') return 'High';
  if (s === '4') return 'Critical';

  for (const [canonical, syns] of Object.entries(SEV_SYNONYMS)) {
    if (canonical.toLowerCase() === s || syns.some((syn) => s.includes(syn))) {
      return canonical;
    }
  }
  return SEVERITIES.includes(val) ? val : defaultVal;
}

function normalizeStatus(val, defaultVal = 'Pending') {
  if (!val) return defaultVal;
  const s = String(val).trim().toLowerCase();
  for (const st of STATUSES) {
    if (st.toLowerCase() === s) return st;
  }
  return defaultVal;
}

const US_TZ_MAP = {
  'us/eastern': 'America/New_York',
  'us/central': 'America/Chicago',
  'us/mountain': 'America/Denver',
  'us/pacific': 'America/Los_Angeles',
  'us/alaska': 'America/Anchorage',
  'us/hawaii': 'Pacific/Honolulu',
  'est': 'America/New_York',
  'edt': 'America/New_York',
  'cst': 'America/Chicago',
  'cdt': 'America/Chicago',
  'mst': 'America/Denver',
  'mdt': 'America/Denver',
  'pst': 'America/Los_Angeles',
  'pdt': 'America/Los_Angeles',
};

function normalizeTimezone(rawTz, lat, lng) {
  if (rawTz) {
    const s = String(rawTz).trim();
    const lower = s.toLowerCase();
    if (US_TZ_MAP[lower]) return US_TZ_MAP[lower];
    try {
      Intl.DateTimeFormat(undefined, { timeZone: s });
      return s;
    } catch {}
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    try {
      const tz = tzLookup(lat, lng);
      if (tz) return tz;
    } catch {}
  }
  return 'UTC';
}

// Date parsing (handles ISO, standard US Accidents timestamps "YYYY-MM-DD HH:mm:ss[.SSS]", DD/MM/YYYY, epoch, Excel serials)
function parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw) ? null : raw;

  if (typeof raw === 'number' || /^\d+(\.\d+)?$/.test(String(raw).trim())) {
    const num = Number(raw);
    if (num > 20000 && num < 60000) {
      const d = new Date(Math.round((num - 25569) * 86400 * 1000));
      return isNaN(d) ? null : d;
    }
    if (num > 1e11) {
      const d = new Date(num);
      return isNaN(d) ? null : d;
    }
    if (num > 1e8) {
      const d = new Date(num * 1000);
      return isNaN(d) ? null : d;
    }
  }

  const s = String(raw).trim();

  // YYYY-MM-DD HH:mm:ss or YYYY-MM-DD HH:mm:ss.SSS
  const ymd = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?/);
  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10) - 1;
    const day = parseInt(ymd[3], 10);
    const hr = parseInt(ymd[4] || 0, 10);
    const min = parseInt(ymd[5] || 0, 10);
    const sec = parseInt(ymd[6] || 0, 10);
    const msStr = (ymd[7] || '0').slice(0, 3).padEnd(3, '0');
    const ms = parseInt(msStr, 10);
    const d = new Date(Date.UTC(year, month, day, hr, min, sec, ms));
    return isNaN(d) ? null : d;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10) - 1;
    const year = parseInt(dmy[3], 10);
    const hr = parseInt(dmy[4] || 0, 10);
    const min = parseInt(dmy[5] || 0, 10);
    const sec = parseInt(dmy[6] || 0, 10);
    const d = new Date(Date.UTC(year, month, day, hr, min, sec));
    return isNaN(d) ? null : d;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed)) {
    return parsed;
  }

  return null;
}

// Extended aliases map for US Accidents dataset and standard spatial datasets
const ALIASES = {
  latitude: [
    'start_lat', 'startlat', 'latitude', 'lat', 'y', 'geo_lat', 'coord_lat', 'latitude_deg', 'end_lat', 'endlat'
  ],
  longitude: [
    'start_lng', 'startlng', 'start_lon', 'start_long', 'longitude', 'long', 'lon', 'lng', 'x', 'geo_lng', 'geo_lon', 'coord_lng', 'end_lng', 'endlng'
  ],
  reportedAt: [
    'start_time', 'starttime', 'date', 'time', 'timestamp', 'datetime', 'reportedat', 'reported_at', 'occurred_at', 'created_at', 'end_time'
  ],
  description: [
    'description', 'details', 'desc', 'notes', 'comment', 'summary', 'info'
  ],
  area: [
    'city', 'area', 'county', 'state', 'place', 'zone', 'neighborhood', 'suburb', 'locality', 'district', 'ward'
  ],
  address: [
    'street', 'address', 'location', 'landmark', 'road', 'place_name'
  ],
  severity: [
    'severity', 'priority', 'level', 'impact', 'sev', 'urgency'
  ],
  type: [
    'type', 'incident_type', 'category', 'incident', 'event', 'accident_type', 'event_type'
  ],
  status: [
    'status', 'condition'
  ],
  timezone: [
    'timezone', 'time_zone', 'tz', 'tz_name'
  ],
  city: [
    'city', 'town', 'municipality'
  ],
  state: [
    'state', 'st', 'province', 'region'
  ],
  county: [
    'county', 'county_name'
  ],
};

function suggestMapping(columns) {
  const mapping = {};
  const lowerCols = columns.map((c) => ({
    original: c,
    clean: String(c).trim().toLowerCase().replace(/[^a-z0-9]/g, '_'),
  }));

  for (const [targetField, aliases] of Object.entries(ALIASES)) {
    const match = lowerCols.find((col) =>
      aliases.some((alias) =>
        col.clean === alias ||
        col.clean.split('_').includes(alias) ||
        (alias.length > 2 && col.clean.startsWith(alias))
      )
    );
    if (match) {
      mapping[targetField] = match.original;
    }
  }

  return mapping;
}

// Fast streaming preview of first 20 rows
async function previewCsvStream(filePath, originalFilename, fileSize, delimiter) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const records = [];
    let bytesRead = 0;
    const readStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

    const parser = parseCsvStream({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: delimiter || [',', '\t', ';'],
      relax_column_count: true,
    });

    readStream.on('data', (chunk) => {
      bytesRead += chunk.length;
    });

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        records.push(record);
        if (records.length >= 20) {
          finish();
          break;
        }
      }
    });

    parser.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(err);
      }
    });

    parser.on('end', () => {
      finish();
    });

    function cleanup() {
      try { readStream.destroy(); } catch {}
      try { parser.destroy(); } catch {}
    }

    function finish() {
      if (resolved) return;
      resolved = true;
      cleanup();

      if (records.length === 0) {
        return reject(new Error(`No data rows found in "${originalFilename}".`));
      }

      const columns = Object.keys(records[0]);
      const bytesPerSampleRow = Math.max(1, bytesRead / records.length);
      const estimatedRows = Math.max(records.length, Math.round(fileSize / bytesPerSampleRow));

      resolve({
        files: [{ name: originalFilename, type: path.extname(originalFilename).replace('.', '').toLowerCase() }],
        fileTypes: [path.extname(originalFilename).replace('.', '').toLowerCase()],
        columns,
        sampleRows: records.slice(0, 20),
        totalRows: estimatedRows,
        estimated: true,
        suggestedMapping: suggestMapping(columns),
      });
    }

    readStream.pipe(parser);
  });
}

async function previewZipStream(filePath, originalFilename, fileSize) {
  const limits = getLimits();
  const zipDir = await unzipper.Open.file(filePath);
  const entries = zipDir.files;

  if (entries.length > limits.maxZipEntries) {
    throw new Error(`Zip contains ${entries.length} files (maximum ${limits.maxZipEntries} allowed).`);
  }

  let targetEntry = null;
  let targetExt = '';

  for (const entry of entries) {
    if (entry.type === 'Directory') continue;
    const name = entry.path;
    if (name.includes('..') || path.isAbsolute(name)) {
      throw new Error(`Malicious zip entry detected: "${name}" (zip-slip path traversal).`);
    }
    const innerExt = path.extname(name).toLowerCase().replace('.', '');
    if (['zip', 'tar', 'gz'].includes(innerExt)) {
      throw new Error('Nested archive files are not allowed.');
    }
    if (['csv', 'tsv', 'txt'].includes(innerExt) && !targetEntry) {
      targetEntry = entry;
      targetExt = innerExt;
      break;
    }
  }

  if (!targetEntry) {
    throw new Error('No supported CSV, TSV, or plain text data file found in the zip archive.');
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    const records = [];
    let bytesRead = 0;
    const readStream = targetEntry.stream();

    const parser = parseCsvStream({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: targetExt === 'tsv' ? '\t' : [',', '\t', ';'],
      relax_column_count: true,
    });

    readStream.on('data', (c) => { bytesRead += c.length; });
    parser.on('readable', () => {
      let r;
      while ((r = parser.read()) !== null) {
        records.push(r);
        if (records.length >= 20) {
          finish();
          break;
        }
      }
    });
    parser.on('error', (e) => { if (!resolved) { resolved = true; finish(e); } });
    parser.on('end', () => finish());

    function finish(err) {
      if (resolved) return;
      resolved = true;
      try { readStream.destroy(); } catch {}
      try { parser.destroy(); } catch {}
      if (err) return reject(err);
      if (!records.length) return reject(new Error('Zip entry contains no data rows.'));

      const columns = Object.keys(records[0]);
      const avgBytesPerRow = Math.max(1, bytesRead / records.length);
      const uncompressedSize = targetEntry.uncompressedSize || fileSize * 2;
      const estimatedRows = Math.max(records.length, Math.round(uncompressedSize / avgBytesPerRow));

      resolve({
        files: [{ name: `${originalFilename} [${targetEntry.path}]`, type: `zip/${targetExt}` }],
        fileTypes: ['zip', targetExt],
        columns,
        sampleRows: records.slice(0, 20),
        totalRows: estimatedRows,
        estimated: true,
        suggestedMapping: suggestMapping(columns),
      });
    }

    readStream.pipe(parser);
  });
}

// General preview entrypoint
async function previewFile(filePath, originalFilename, fileSize) {
  const ext = path.extname(originalFilename).toLowerCase().replace('.', '');
  const limits = getLimits();

  if (!verifyMagicBytes(filePath, ext)) {
    throw new Error(`File "${originalFilename}" has an invalid signature or corrupted format for extension .${ext}`);
  }

  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    return previewCsvStream(filePath, originalFilename, fileSize, ext === 'tsv' ? '\t' : null);
  }

  if (ext === 'zip') {
    return previewZipStream(filePath, originalFilename, fileSize);
  }

  // In-memory parsers: enforce memory limit (200 MB)
  if (fileSize > limits.memoryParserMaxBytes) {
    throw new Error(
      `File size (${fmtBytes(fileSize)}) exceeds the 200 MB limit for ${ext.toUpperCase()} files. Memory-loaded formats cannot exceed 200 MB. Please convert this file to CSV for streaming upload.`
    );
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (json.length > 0) {
        const columns = Object.keys(json[0]);
        return {
          files: [{ name: originalFilename, type: ext }],
          fileTypes: [ext],
          columns,
          sampleRows: json.slice(0, 20),
          totalRows: json.length,
          estimated: false,
          suggestedMapping: suggestMapping(columns),
        };
      }
    }
    throw new Error('Excel workbook contains no data rows.');
  }

  if (ext === 'json' || ext === 'geojson') {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let rows = [];
    if (Array.isArray(content)) {
      rows = content;
    } else if (content.type === 'FeatureCollection' && Array.isArray(content.features)) {
      rows = content.features.map((f) => {
        const coords = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
        return {
          ...(f.properties || {}),
          ...(coords ? { longitude: coords[0], latitude: coords[1] } : {}),
        };
      });
    } else if (content.type === 'Feature') {
      const coords = content.geometry?.type === 'Point' ? content.geometry.coordinates : null;
      rows = [{
        ...(content.properties || {}),
        ...(coords ? { longitude: coords[0], latitude: coords[1] } : {}),
      }];
    }
    if (!rows.length) throw new Error('JSON contains no data rows.');
    const columns = Object.keys(rows[0]);
    return {
      files: [{ name: originalFilename, type: ext }],
      fileTypes: [ext],
      columns,
      sampleRows: rows.slice(0, 20),
      totalRows: rows.length,
      estimated: false,
      suggestedMapping: suggestMapping(columns),
    };
  }

  if (ext === 'kml' || ext === 'gpx') {
    const content = fs.readFileSync(filePath, 'utf8');
    const dom = new DOMParser().parseFromString(content);
    const geo = ext === 'kml' ? toGeoJSON.kml(dom) : toGeoJSON.gpx(dom);
    const rows = (geo.features || []).map((f) => {
      const coords = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
      return {
        ...(f.properties || {}),
        ...(coords ? { longitude: coords[0], latitude: coords[1] } : {}),
      };
    });
    if (!rows.length) throw new Error('Spatial file contains no point placemarks.');
    const columns = Object.keys(rows[0]);
    return {
      files: [{ name: originalFilename, type: ext }],
      fileTypes: [ext],
      columns,
      sampleRows: rows.slice(0, 20),
      totalRows: rows.length,
      estimated: false,
      suggestedMapping: suggestMapping(columns),
    };
  }

  if (ext === 'pdf') {
    const buf = fs.readFileSync(filePath);
    let lines = [];
    try {
      const pdfData = await pdfParse(buf);
      lines = (pdfData.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      throw new Error('Unable to extract text from PDF. Scanned PDFs without embedded text are unsupported.');
    }
    const rows = [];
    for (const line of lines) {
      const m = line.match(/([+-]?\d{1,3}\.\d+)[,\s|;]+([+-]?\d{1,3}\.\d+)/);
      if (m) {
        rows.push({
          latitude: m[1],
          longitude: m[2],
          description: line,
        });
      }
    }
    if (!rows.length) {
      throw new Error('No coordinates could be identified in the PDF text.');
    }
    const columns = ['latitude', 'longitude', 'description'];
    return {
      files: [{ name: originalFilename, type: ext }],
      fileTypes: [ext],
      columns,
      sampleRows: rows.slice(0, 20),
      totalRows: rows.length,
      estimated: false,
      suggestedMapping: suggestMapping(columns),
    };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}

module.exports = {
  verifyMagicBytes,
  parseCoordinates,
  parseDate,
  normalizeType,
  normalizeSeverity,
  normalizeStatus,
  normalizeTimezone,
  suggestMapping,
  previewFile,
};
