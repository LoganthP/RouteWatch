/**
 * Column auto-detection and value normalisation for uploaded datasets.
 * Turns arbitrary rows into RouteWatch incident fields, or explains why a row was rejected.
 */
const crypto = require('crypto');
const { INCIDENT_TYPES, SEVERITIES, STATUSES } = require('../../config/constants');
const { tzFor, areaLabel } = require('../geo');

const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Field → header aliases (normalised). Earlier aliases win.
const ALIASES = {
  latitude: ['latitude', 'lat', 'startlat', 'latdd', 'gpslat', 'gpslatitude', 'ylat', 'y', 'lat', 'endlat'],
  longitude: ['longitude', 'lng', 'lon', 'long', 'startlng', 'startlon', 'londd', 'gpslon', 'gpslong', 'gpslongitude', 'xlon', 'x', 'endlng', 'endlon'],
  coordinates: ['coordinates', 'coords', 'latlng', 'latlon', 'latlong', 'geolocation', 'location', 'geo', 'point', 'position', 'gps', 'wkt', 'geometry'],
  type: ['type', 'incidenttype', 'eventtype', 'category', 'incidentcategory', 'accidenttype', 'crashtype', 'collisiontype', 'incident', 'event', 'kind'],
  severity: ['severity', 'severitylevel', 'priority', 'injuryseverity', 'crashseverity', 'accidentseverity', 'level', 'impact'],
  status: ['status', 'incidentstatus', 'state_status'],
  datetime: ['starttime', 'datetime', 'timestamp', 'reportedat', 'occurredat', 'eventtime', 'crashdate', 'accidentdate', 'date', 'time', 'when', 'createdat', 'created', 'gpxtime', 'kmltime'],
  timezone: ['timezone', 'tz', 'timezoneid', 'tzid'],
  description: ['description', 'desc', 'details', 'summary', 'remarks', 'notes', 'comment', 'comments', 'name'],
  area: ['city', 'area', 'locality', 'neighborhood', 'neighbourhood', 'district', 'ward', 'borough', 'zone', 'town'],
  region: ['state', 'statecode', 'province', 'region', 'county', 'country'],
  address: ['address', 'fulladdress', 'streetaddress', 'street', 'road', 'place', 'placename', 'landmark'],
};
const GEO_COLS = { __lat: 'latitude', __lng: 'longitude', __time: 'datetime', __name: 'description', __desc: 'description' };

/** Suggest a column for each field from the header list. Each column is used at most once. */
function suggestMapping(columns) {
  const used = new Set();
  const byKey = new Map(columns.map((c) => [key(c), c]));
  const m = { area: [] };
  for (const [col, field] of Object.entries(GEO_COLS)) {
    if (columns.includes(col) && !m[field]) { m[field] = col; used.add(col); }
  }
  for (const field of ['latitude', 'longitude', 'datetime', 'timezone', 'type', 'severity', 'status', 'description', 'coordinates', 'address']) {
    if (m[field]) continue;
    for (const alias of ALIASES[field]) {
      const col = byKey.get(alias);
      if (col && !used.has(col)) { m[field] = col; used.add(col); break; }
    }
  }
  // area: one local column + one broader region (e.g. "Dallas, TX")
  for (const group of [ALIASES.area, ALIASES.region]) {
    for (const alias of group) {
      const col = byKey.get(alias);
      if (col && !used.has(col)) { m.area.push(col); used.add(col); break; }
    }
  }
  if (m.latitude && m.longitude) delete m.coordinates;
  return m;
}

/* ---------------- numbers & coordinates ---------------- */
function toNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  return Number(s);
}

function dmsToDec(s) {
  const m = String(s).trim().match(/^(-?\d+(?:\.\d+)?)[°:\s]+(\d+(?:\.\d+)?)?['′:\s]*(\d+(?:\.\d+)?)?["″\s]*([NSEWnsew])?$/);
  if (!m) return NaN;
  let v = Math.abs(Number(m[1])) + (Number(m[2]) || 0) / 60 + (Number(m[3]) || 0) / 3600;
  if (String(m[1]).startsWith('-') || /[SWsw]/.test(m[4] || '')) v = -v;
  return v;
}

function coordValue(v) {
  const n = toNum(v);
  if (Number.isFinite(n)) return n;
  return dmsToDec(v);
}

/** Parse "lat, lng", "lat lng", "POINT(lng lat)", "(lat, lng)" → [lng, lat] */
function parsePair(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v) && v.length >= 2) return [Number(v[0]), Number(v[1])]; // GeoJSON order
  const s = String(v);
  const wkt = s.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (wkt) return [Number(wkt[1]), Number(wkt[2])];
  const m = s.match(/(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  return [Number(m[2]), Number(m[1])]; // text pairs are conventionally "lat, lng"
}

/** Validate / repair a [lng, lat] pair. Returns {coords} or {error}. */
function checkCoords(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { error: 'missing or non-numeric coordinates' };
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lng, lat] = [lat, lng]; // swapped columns
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: 'coordinates out of range' };
  if (lat === 0 && lng === 0) return { error: 'coordinates are 0,0 (missing value)' };
  return { coords: [+lng.toFixed(6), +lat.toFixed(6)] };
}

/* ---------------- categorical values ---------------- */
const TYPE_RULES = [
  ['Accident', /accident|crash|collision|wreck|roll ?over|overturn|fatal|injur|pedestrian|hit and run|rear[- ]?end|skid/],
  ['Road Closure', /closure|closed|road ?block|blocked|diversion|detour|barricade/],
  ['Construction', /construct|road ?work|works|maintenance|repair|widening|paving|lane narrow/],
  ['Congestion', /congestion|jam|traffic|queue|slow|gridlock|delay|heavy|stalled|backed up/],
  ['Hazard', /hazard|pothole|debris|flood|water|oil|tree|animal|cattle|fog|ice|snow|fire|spill|obstruct|weather|landslide|breakdown|disabled vehicle/],
];
function normType(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const s = String(v).trim();
  const exact = INCIDENT_TYPES.find((t) => t.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const low = s.toLowerCase();
  for (const [t, rx] of TYPE_RULES) if (rx.test(low)) return t;
  return fallback;
}

function normSeverity(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = toNum(v);
  if (Number.isFinite(n)) {
    if (n <= 1) return 'Low';
    if (n <= 4) return SEVERITIES[Math.round(n) - 1];
    if (n <= 10) return SEVERITIES[Math.min(3, Math.ceil((n / 10) * 4) - 1)];
    return fallback;
  }
  const s = String(v).toLowerCase();
  if (/critical|fatal|extreme|catastroph|severe injury|killed|death/.test(s)) return 'Critical';
  if (/high|major|severe|serious/.test(s)) return 'High';
  if (/medium|moderate|mid|average/.test(s)) return 'Medium';
  if (/low|minor|slight|light|property damage|pdo/.test(s)) return 'Low';
  return fallback;
}

function normStatus(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const s = String(v).toLowerCase();
  const exact = STATUSES.find((t) => t.toLowerCase() === s);
  if (exact) return exact;
  if (/resolv|clear|closed|done|complete|fixed/.test(s)) return 'Resolved';
  if (/reject|invalid|false|duplicate|spam/.test(s)) return 'Rejected';
  if (/verif|confirm|active|ongoing|open/.test(s)) return 'Verified';
  if (/pend|new|report|unverif/.test(s)) return 'Pending';
  return fallback;
}

/* ---------------- dates & time zones ---------------- */
const fmtCache = new Map();
function validTz(tz) {
  if (!tz) return false;
  if (fmtCache.has(tz)) return true;
  try {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
    return true;
  } catch { return false; }
}
function tzOffsetMs(utcMs, tz) {
  const parts = Object.fromEntries(fmtCache.get(tz).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
/** Wall-clock time in `tz` → UTC Date (DST-aware, two-pass). */
function zonedToUtc(y, mo, d, h, mi, s, ms, tz) {
  const guess = Date.UTC(y, mo, d, h, mi, s, ms);
  if (!tz || tz === 'UTC' || !validTz(tz)) return new Date(guess);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return new Date(t);
}

/**
 * Parse many date formats. Strings without an explicit offset are treated as
 * local wall-clock time in `tz`. Returns a Date or null.
 */
function parseDate(v, tz, dayFirst = true) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v)) return null; // exceljs gives wall time encoded as UTC
    return zonedToUtc(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds(), v.getUTCMilliseconds(), tz);
  }
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (n > 1e12 && n < 1e13) return new Date(n);           // epoch ms
    if (n > 1e9 && n < 1e10) return new Date(n * 1000);     // epoch seconds
    if (n > 20000 && n < 80000) {                           // Excel serial date
      const w = new Date(Math.round((n - 25569) * 864e5));
      return parseDate(w, tz, dayFirst);
    }
    if (/^\d{8}$/.test(String(v))) {                        // YYYYMMDD
      const s = String(v);
      return zonedToUtc(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), 0, 0, 0, 0, tz);
    }
    return null;
  }
  const s = String(v).trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && !isNaN(Date.parse(s))) return new Date(s); // explicit offset
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(AM|PM)?)?/i);
  if (m) {
    let h = +(m[4] || 0);
    if (m[8]) h = (h % 12) + (/pm/i.test(m[8]) ? 12 : 0);
    return zonedToUtc(+m[1], +m[2] - 1, +m[3], h, +(m[5] || 0), +(m[6] || 0), +String(m[7] || 0).slice(0, 3).padEnd(3, '0'), tz);
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (m) {
    let a = +m[1]; let b = +m[2]; let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let day; let mon;
    if (a > 12) { day = a; mon = b; } else if (b > 12) { day = b; mon = a; } else if (dayFirst) { day = a; mon = b; } else { day = b; mon = a; }
    let h = +(m[4] || 0);
    if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0);
    return zonedToUtc(y, mon - 1, day, h, +(m[5] || 0), +(m[6] || 0), 0, tz);
  }
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const d = new Date(t);
    return zonedToUtc(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), 0, tz);
  }
  return null;
}

/**
 * Normalise one raw row with a mapping. Returns {doc} or {error} or {needsGeocode}.
 * opts: { mapping, defaults:{type,severity,status}, tzMode:'auto'|'UTC'|IANA, dayFirst, forceStatus }
 */
function normalizeRow(raw, opts) {
  const m = opts.mapping || {};
  const get = (col) => (col ? raw[col] : undefined);

  let lng; let lat;
  if (m.latitude && m.longitude) { lat = coordValue(get(m.latitude)); lng = coordValue(get(m.longitude)); }
  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && m.coordinates) {
    const p = parsePair(get(m.coordinates));
    if (p) [lng, lat] = p;
  }
  let coords = null;
  let coordErr = null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const c = checkCoords(lng, lat);
    if (c.error) coordErr = c.error; else coords = c.coords;
  }
  if (!coords) {
    const addr = [get(m.address), ...(m.area || []).map(get)].filter((x) => x !== undefined && String(x).trim()).join(', ');
    if (addr && !coordErr) return { needsGeocode: addr.slice(0, 200) };
    return { error: coordErr || 'no coordinates and no address to geocode' };
  }
  return finishRow(raw, coords, opts);
}

/** Second half of normalisation once coordinates are known (also used after geocoding). */
function finishRow(raw, [lng, lat], opts) {
  const m = opts.mapping || {};
  const d = opts.defaults || {};
  const get = (col) => (col ? raw[col] : undefined);

  const rowTz = String(get(m.timezone) || '').trim();
  const locTz = tzFor(lng, lat);
  const parseTz = opts.tzMode === 'auto' || !opts.tzMode ? (validTz(rowTz) ? rowTz : locTz) : opts.tzMode;

  let reportedAt = null;
  if (m.datetime) {
    reportedAt = parseDate(get(m.datetime), parseTz, opts.dayFirst !== false);
    if (!reportedAt) return { error: `unreadable date "${String(get(m.datetime) ?? '').slice(0, 40)}"` };
    if (reportedAt.getTime() > Date.now() + 5 * 60e3) return { error: 'date is in the future' };
    if (reportedAt.getUTCFullYear() < 1970) return { error: 'date is before 1970' };
  } else {
    reportedAt = opts.importTime || new Date();
  }

  const type = normType(get(m.type), d.type || 'Other');
  const severity = normSeverity(get(m.severity), d.severity || 'Medium');
  const status = opts.forceStatus || normStatus(get(m.status), d.status || 'Verified');
  const areaParts = [...new Set((m.area || []).map(get).filter((x) => x !== undefined && x !== null && String(x).trim()).map((x) => String(x).trim()))];
  const area = (areaParts.join(', ') || areaLabel(lng, lat)).slice(0, 120);
  const description = String(get(m.description) ?? '').trim().slice(0, 500);

  const fingerprint = crypto.createHash('sha1')
    .update(`${lng.toFixed(5)}|${lat.toFixed(5)}|${reportedAt.getTime()}|${type}`).digest('hex').slice(0, 24);

  return {
    doc: {
      type, severity, status, description, area,
      location: { type: 'Point', coordinates: [lng, lat] },
      tz: validTz(rowTz) ? rowTz : locTz,
      reportedAt,
      resolvedAt: status === 'Resolved' ? reportedAt : undefined,
      fingerprint,
    },
  };
}

module.exports = {
  suggestMapping, normalizeRow, finishRow, parseDate, parsePair, checkCoords, normType, normSeverity, normStatus, validTz, zonedToUtc, ALIASES,
};
