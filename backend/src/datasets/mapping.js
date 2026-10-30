const { createHash } = require('node:crypto');
// RouteWatch — schema detection + row -> document transformation.
// Works on ANY tabular/geo record: it looks at header names AND the actual values,
// proposes a mapping, and the user can override it in step 2 ("Map columns & scope").

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const NAME_HINTS = {
  lat: [/^(lat|latitude|lat_?deg|y_?coord|start_lat|gps_lat|location_lat|loc_lat|.*_lat|lat_.*)$/, /latitude/],
  lon: [/^(lon|lng|long|longitude|lon_?deg|x_?coord|start_lng|start_lon|gps_lon|gps_lng|location_lng|location_lon|.*_lon|.*_lng|lon_.*|lng_.*)$/, /longitude/],
  point: [/^(location|coordinates|coords|geom|geometry|the_geom|wkt|point|latlng|lat_lon|lat_long|position|geo|gps)$/],
  date: [/^(date|datetime|date_time|timestamp|time_stamp|occurred(_at|_on)?|reported(_at|_on)?|incident_date|accident_date|crash_date|event_date|start_time|created(_at)?|when|time)$/, /date|timestamp|datetime/],
  time: [/^(time|hour|clock|crash_time|accident_time|incident_time|time_of_day)$/],
  year: [/^(year|yr|.*year)$/],
  severity: [/severity|injury_severity|crash_severity|sev$|^priority$|^level$|seriousness|degree/],
  type: [/^(type|incident_type|accident_type|crash_type|event_type|category|collision_type|cause|kind|class|nature|offense|offence|road_type)$/, /type|category|collision/],
  area: [/^(area|locality|district|local_authority|local_authority_district|zone|ward|borough|city|town|region|neighbourhood|neighborhood|county|municipality|police_station|station|street|road|road_name|address)$/, /authority|district|locality|area|ward|borough|city/],
  description: [/desc|narrative|summary|remark|note|detail|comment|text/],
  externalId: [/^(id|_id|uid|uuid|incident_id|accident_index|accident_id|crash_id|case_no|case_number|report_no|record_id|objectid|fid|ref|reference)$/, /(^|_)(id|index)$/],
  casualties: [/casualt|injur(ed|ies)|victims|killed|fatalit|deaths/],
  vehicles: [/vehicle|veh_count|units/],
};

const INCIDENT_WORDS = /accident|incident|crash|collision|casualt|crime|fatal|injur|emergency|event|hazard|violation|police|stats19|severity/;

const isBlank = (v) => v == null || v === '' || (typeof v === 'string' && /^(na|n\/a|null|none|nan|-|\?|undefined)$/i.test(v.trim()));
const toNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (isBlank(v)) return null;
  const n = Number(String(v).trim().replace(/,(?=\d{3}\b)/g, ''));
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------- dates */

const DATE_PATTERNS = [
  ['iso', /^\d{4}-\d{1,2}-\d{1,2}([ t]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?)?(z|[+-]\d{2}:?\d{2})?$/i],
  ['ymd_slash', /^\d{4}[/.]\d{1,2}[/.]\d{1,2}( \d{1,2}:\d{2}(:\d{2})?)?$/],
  ['xmy', /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}( \d{1,2}:\d{2}(:\d{2})?( ?[ap]m)?)?$/i], // dmy or mdy, resolved below
];

function detectDateFormat(values) {
  const vals = values.filter((v) => !isBlank(v)).slice(0, 500);
  if (!vals.length) return null;
  if (vals.every((v) => v instanceof Date)) return 'native';
  const nums = vals.map(toNum);
  if (nums.every((n) => n != null)) {
    if (nums.every((n) => n >= 1900 && n <= 2100 && Number.isInteger(n))) return 'year';
    if (nums.every((n) => n > 1e12 && n < 1e14)) return 'epoch_ms';
    if (nums.every((n) => n > 1e8 && n < 1e10)) return 'epoch_s';
    if (nums.every((n) => n > 20000 && n < 80000)) return 'excel';
    return null;
  }
  const strs = vals.map((v) => String(v).trim());
  for (const [fmt, re] of DATE_PATTERNS) {
    const hits = strs.filter((s) => re.test(s)).length;
    if (hits / strs.length < 0.8) continue;
    if (fmt !== 'xmy') return fmt;
    let firstOver12 = 0, secondOver12 = 0;
    for (const s of strs) {
      const [a, b] = s.split(/[/.\- ]/).map(Number);
      if (a > 12) firstOver12++; if (b > 12) secondOver12++;
    }
    return secondOver12 > firstOver12 ? 'mdy' : 'dmy'; // tie => dmy (India/UK default)
  }
  const parsed = strs.filter((s) => !Number.isNaN(Date.parse(s))).length;
  return parsed / strs.length >= 0.8 ? 'loose' : null;
}

function parseDate(v, fmt, timeV) {
  if (isBlank(v)) return null;
  let d = null;
  try {
    switch (fmt) {
      case 'native': d = v instanceof Date ? v : new Date(v); break;
      case 'year': { const y = toNum(v); d = y ? new Date(Date.UTC(y, 0, 1)) : null; break; }
      case 'epoch_ms': d = new Date(toNum(v)); break;
      case 'epoch_s': d = new Date(toNum(v) * 1000); break;
      case 'excel': d = new Date(Math.round((toNum(v) - 25569) * 86400000)); break;
      case 'iso': { const s = String(v).trim().replace(' ', 'T'); d = new Date(/z|[+-]\d{2}:?\d{2}$/i.test(s) || s.length <= 10 ? s : `${s}`); break; }
      case 'ymd_slash': { const [y, m, dd, ...rest] = String(v).trim().split(/[/. :]/).map(Number); d = new Date(Date.UTC(y, m - 1, dd, rest[0] || 0, rest[1] || 0, rest[2] || 0)); break; }
      case 'dmy': case 'mdy': {
        const s = String(v).trim();
        const [datePart, timePart = '', ampm = ''] = s.split(/\s+/);
        let [a, b, y] = datePart.split(/[/.-]/).map(Number);
        if (y < 100) y += y < 50 ? 2000 : 1900;
        const [day, mon] = fmt === 'dmy' ? [a, b] : [b, a];
        let [hh = 0, mm = 0, ss = 0] = timePart ? timePart.split(':').map(Number) : [];
        if (/pm/i.test(ampm + timePart) && hh < 12) hh += 12;
        if (/am/i.test(ampm + timePart) && hh === 12) hh = 0;
        d = new Date(Date.UTC(y, mon - 1, day, hh, mm, ss));
        if (d.getUTCDate() !== day) d = null; // 31/02 etc.
        break;
      }
      default: d = new Date(v);
    }
  } catch { d = null; }
  if (!d || Number.isNaN(d.getTime())) return null;
  if (!isBlank(timeV)) {
    const m = String(timeV).trim().match(/^(\d{1,2})[:.]?(\d{2})?(?::(\d{2}))?\s*([ap]m)?$/i);
    if (m) {
      let h = Number(m[1]); const mi = Number(m[2] || 0); const se = Number(m[3] || 0);
      if (m[4] && /pm/i.test(m[4]) && h < 12) h += 12;
      if (m[4] && /am/i.test(m[4]) && h === 12) h = 0;
      if (h < 24 && mi < 60) d.setUTCHours(h, mi, se, 0);
    }
  }
  const y = d.getUTCFullYear();
  return y >= 1900 && y <= 2100 ? d : null;
}

/* ------------------------------------------------------------- coordinates */

function parsePointString(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'object') {
    if (v.type === 'Point' && Array.isArray(v.coordinates)) return { lon: +v.coordinates[0], lat: +v.coordinates[1] };
    if (Array.isArray(v) && v.length >= 2) return { lon: +v[0], lat: +v[1] }; // GeoJSON order
    const lat = v.lat ?? v.latitude; const lon = v.lng ?? v.lon ?? v.longitude;
    return lat != null && lon != null ? { lat: +lat, lon: +lon } : null;
  }
  const s = String(v).trim();
  let m = s.match(/^POINT\s*Z?\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)/i);
  if (m) return { lon: +m[1], lat: +m[2] };
  m = s.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  if (m) { // "lat, lon" is the human convention
    const a = +m[1], b = +m[2];
    return Math.abs(a) <= 90 ? { lat: a, lon: b } : { lat: b, lon: a };
  }
  return null;
}

const validCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon)
  && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);

function centroidOf(geom) {
  if (!geom || !geom.coordinates) return null;
  if (geom.type === 'Point') return { lon: +geom.coordinates[0], lat: +geom.coordinates[1] };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c) => { if (typeof c[0] === 'number') { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]); } else c.forEach(walk); };
  walk(geom.coordinates);
  if (!Number.isFinite(minX)) return null;
  return { lon: (minX + maxX) / 2, lat: (minY + maxY) / 2, bbox: [minX, minY, maxX, maxY] };
}

/* ------------------------------------------------------------- proposal */

function scoreName(header, role) {
  const n = norm(header);
  const [strong, weak] = NAME_HINTS[role];
  if (strong.test(n)) return 2;
  if (weak && weak.test(n)) return 1;
  return 0;
}

function pick(headers, role, rows, valueTest) {
  let best = null, bestScore = 0;
  for (const h of headers) {
    const s = scoreName(h, role);
    if (!s) continue;
    let fit = 1;
    if (valueTest) {
      const vals = rows.map((r) => r[h]).filter((v) => !isBlank(v));
      if (!vals.length) continue;
      fit = vals.filter(valueTest).length / vals.length;
      if (fit < 0.7) continue;
    }
    const score = s * fit;
    if (score > bestScore) { best = h; bestScore = score; }
  }
  return best;
}

/**
 * Proposes a mapping for one entry from a sample of its records.
 * Returned object is exactly what the import endpoint accepts back (user may edit it).
 */
function proposeMapping(entryName, rows) {
  const headerSet = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (k !== '__geometry') headerSet.add(k);
  const headers = [...headerSet];
  const hasGeometry = rows.some((r) => r.__geometry);
  const geomTypes = [...new Set(rows.map((r) => r.__geometry?.type).filter(Boolean))];

  const lat = pick(headers, 'lat', rows, (v) => { const n = toNum(v); return n != null && n >= -90 && n <= 90; });
  const lon = pick(headers, 'lon', rows, (v) => { const n = toNum(v); return n != null && n >= -180 && n <= 180; });
  const point = !lat || !lon ? pick(headers, 'point', rows, (v) => !!parsePointString(v)) : null;

  // date: prefer a column whose values actually parse
  let date = null, dateFormat = null;
  const dateCandidates = headers.filter((h) => scoreName(h, 'date')).sort((a, b) => scoreName(b, 'date') - scoreName(a, 'date'));
  for (const h of dateCandidates) {
    const f = detectDateFormat(rows.map((r) => r[h]));
    if (f && f !== 'year') { date = h; dateFormat = f; break; }
  }
  if (!date) { // fall back to year-only column
    const y = headers.find((h) => scoreName(h, 'year') && detectDateFormat(rows.map((r) => r[h])) === 'year');
    if (y) { date = y; dateFormat = 'year'; }
  }
  const time = date && dateFormat !== 'iso' ? headers.find((h) => h !== date && scoreName(h, 'time') === 2
    && rows.filter((r) => /^\d{1,2}[:.]\d{2}/.test(String(r[h] ?? ''))).length / Math.max(1, rows.length) > 0.5) || null : null;

  const severity = pick(headers, 'severity', rows);
  const type = pick(headers, 'type', rows);
  const isCode = (v) => /^[A-Z]{1,3}\d{5,}$/.test(String(v).trim());
  const area = pick(headers, 'area', rows, (v) => typeof v === 'string' && v.length < 120 && toNum(v) == null && !isCode(v))
    || pick(headers, 'area', rows, (v) => typeof v === 'string' && v.length < 120 && toNum(v) == null);
  const description = pick(headers, 'description', rows, (v) => typeof v === 'string');
  let externalId = pick(headers, 'externalId', rows, null);
  if (externalId) {
    const vals = rows.map((r) => r[externalId]).filter((v) => !isBlank(v)).map(String);
    if (new Set(vals).size < vals.length * 0.99 || vals.some((v) => /\d\.\d+e\+\d+/i.test(v))) externalId = null;
  }
  const casualties = pick(headers, 'casualties', rows, (v) => toNum(v) != null);
  const vehicles = pick(headers, 'vehicles', rows, (v) => toNum(v) != null);

  // Severity normalisation proposal
  let severityMap = null;
  if (severity) {
    const distinct = [...new Set(rows.map((r) => r[severity]).filter((v) => !isBlank(v)).map(String))];
    severityMap = defaultSeverityMap(severity, distinct);
  }

  const hasLocation = !!((lat && lon) || point || hasGeometry);
  const nameText = norm(entryName) + ' ' + headers.map(norm).join(' ');
  const incidentLike = INCIDENT_WORDS.test(norm(entryName)) || (!!severity && !!date) || (!!type && !!date && /accident|incident|crash|collision/.test(nameText));
  const polygonal = geomTypes.some((t) => /Polygon|LineString/.test(t));

  let kind = 'records';
  if (hasLocation && incidentLike && !polygonal) kind = 'incidents';
  else if (polygonal) kind = 'boundaries';

  const warnings = [];
  if (!hasLocation) warnings.push('No coordinates detected — rows will be stored for analytics but will not appear on the map.');
  if (kind === 'incidents' && !date) warnings.push('No date column detected — temporal analytics will skip these rows.');
  if (severityMap?.__guessed) warnings.push(`Severity scale for "${severity}" was guessed — please confirm.`);

  return {
    kind, // 'incidents' | 'records' | 'boundaries' | 'skip'
    columns: { lat, lon, point, date, dateFormat, time, severity, type, area, description, externalId, casualties, vehicles },
    severityMap: severityMap ? Object.fromEntries(Object.entries(severityMap).filter(([k]) => k !== '__guessed')) : null,
    headers, geometryTypes: geomTypes, warnings,
  };
}

const SEVERITY_WORDS = [
  [/fatal|death|killed|critical|catastroph|major|serious_?injury|grievous|very_?high|^4$|^5$/i, 'critical'],
  [/serious|severe|high|injury|incapacit|grave/i, 'high'],
  [/slight|minor|moderate|medium|possible|non_?incapacit/i, 'medium'],
  [/low|property|pdo|no_?injury|damage_?only|none|trivial/i, 'low'],
];

function defaultSeverityMap(column, distinct) {
  const map = {};
  const numeric = distinct.every((d) => toNum(d) != null);
  if (numeric) {
    let nums = distinct.map(Number).sort((a, b) => a - b);
    const max = nums[nums.length - 1];
    // Rare levels (e.g. "fatal") are often missing from a sample — fill the integer scale.
    if (nums.every(Number.isInteger) && max <= 10) {
      const lo = Math.min(1, nums[0]);
      nums = Array.from({ length: max - lo + 1 }, (_, i) => lo + i);
    }
    // STATS19 (UK) uses 1=Fatal,2=Serious,3=Slight; most other scales (US-Accidents 1..4) grow with severity.
    const lowIsWorse = /accident_severity|casualty_severity/.test(norm(column)) && max <= 3;
    if (lowIsWorse) return { 1: 'critical', 2: 'high', 3: 'medium', __guessed: true }; // Fatal / Serious / Slight
    const levels = ['low', 'medium', 'high', 'critical'];
    const ordered = lowIsWorse ? [...nums].reverse() : nums;
    ordered.forEach((n, i) => {
      const idx = ordered.length === 1 ? 1 : Math.round((i / (ordered.length - 1)) * 3);
      map[String(n)] = levels[idx];
    });
    map.__guessed = true;
    return map;
  }
  for (const d of distinct.slice(0, 50)) {
    const hit = SEVERITY_WORDS.find(([re]) => re.test(norm(d)));
    map[d] = hit ? hit[1] : 'medium';
    if (!hit) map.__guessed = true;
  }
  return map;
}

/* ------------------------------------------------------------- transformer */

/**
 * Returns fn(record, ctx) -> { doc } | { invalid: reason }.
 * ctx = { datasetId, entryName, rowNumber }
 * Document shape (incidents) — adjust `toIncidentDoc` if your Incident model uses other field names.
 */
function buildTransformer(mapping) {
  const c = mapping.columns || {};
  const sevMap = mapping.severityMap || {};
  const used = new Set(Object.values(c).filter(Boolean));

  return (rec, ctx) => {
    let lat = null, lon = null, geometry = null, bbox = null;
    if (c.lat && c.lon) { lat = toNum(rec[c.lat]); lon = toNum(rec[c.lon]); }
    else if (c.point) { const p = parsePointString(rec[c.point]); if (p) ({ lat, lon } = p); }
    if ((lat == null || lon == null) && rec.__geometry) {
      const cen = centroidOf(rec.__geometry);
      if (cen) { lat = cen.lat; lon = cen.lon; bbox = cen.bbox || null; }
      if (rec.__geometry.type !== 'Point') geometry = rec.__geometry;
    }
    const hasGeo = validCoord(lat, lon);

    const occurredAt = c.date ? parseDate(rec[c.date], c.dateFormat, c.time ? rec[c.time] : null) : null;
    // How precise is the timestamp? Hour-of-day analytics must ignore 'day'/'year' values.
    let occurredAtPrecision = null;
    if (occurredAt) {
      const raw = rec[c.date];
      if (c.dateFormat === 'year') occurredAtPrecision = 'year';
      else if (c.time && !isBlank(rec[c.time])) occurredAtPrecision = 'time';
      else if (['epoch_s', 'epoch_ms'].includes(c.dateFormat) || (c.dateFormat === 'excel' && toNum(raw) % 1 !== 0)
        || /\d{1,2}:\d{2}/.test(String(raw)) || (raw instanceof Date && (raw.getUTCHours() || raw.getUTCMinutes()))) occurredAtPrecision = 'time';
      else occurredAtPrecision = 'day';
    }
    const rawSev = c.severity ? rec[c.severity] : null;
    const severity = isBlank(rawSev) ? null : (sevMap[String(rawSev)] || String(rawSev).toLowerCase());

    const attributes = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === '__geometry' || used.has(k) || isBlank(v)) continue;
      attributes[k.replace(/^\$/, '_').replace(/\./g, '_')] = typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) : v;
    }

    const ext = c.externalId && !isBlank(rec[c.externalId]) ? String(rec[c.externalId]) : null;
    // Dedupe key = hash of the row's content (NOT the id column: ids get mangled, e.g. Excel's "2.01E+07").
    // Identical rows collapse; re-running an import never creates duplicates.
    const hash = createHash('sha1').update(rowFingerprint(rec)).digest('base64url').slice(0, 22);
    const source = { datasetId: ctx.datasetId, file: ctx.entryName, row: ctx.rowNumber, key: `${ctx.datasetId}:${hash}`, externalId: ext };

    if (mapping.kind === 'incidents') {
      if (!hasGeo) return { invalid: 'missing_or_invalid_coordinates' };
      const incidentSeverity = severity || 'unknown';
      return {
        doc: {
          incidentId: `IMP-${source.key}`,
          location: { type: 'Point', coordinates: [round6(lon), round6(lat)] },
          occurredAt,
          occurredAtPrecision,
          reportedAt: occurredAt || new Date(),
          severity: incidentSeverity,
          type: c.type && !isBlank(rec[c.type]) ? String(rec[c.type]).trim() : 'Unspecified',
          area: c.area && !isBlank(rec[c.area]) ? String(rec[c.area]).trim() : null,
          description: c.description && !isBlank(rec[c.description]) ? String(rec[c.description]).slice(0, 2000) : null,
          casualties: c.casualties ? toNum(rec[c.casualties]) : null,
          vehicles: c.vehicles ? toNum(rec[c.vehicles]) : null,
          status: 'imported',
          datasetId: ctx.datasetId,
          attributes,
          source,
          createdAt: new Date(),
        },
      };
    }

    // records / boundaries — anything else, kept for profiling + optional map overlay
    const doc = {
      datasetId: ctx.datasetId, kind: mapping.kind, file: ctx.entryName,
      location: hasGeo ? { type: 'Point', coordinates: [round6(lon), round6(lat)] } : null,
      occurredAt, occurredAtPrecision, severity, category: c.type ? rec[c.type] ?? null : null, area: c.area ? rec[c.area] ?? null : null,
      attributes, source, createdAt: new Date(),
    };
    if (bbox) doc.bbox = bbox;
    if (geometry) {
      const size = JSON.stringify(geometry).length;
      if (size <= (ctx.maxGeometryBytes || 8e6)) doc.geometry = geometry; else doc.geometryOmitted = size;
    }
    return { doc };
  };
}

function rowFingerprint(rec) {
  let out = '';
  for (const k in rec) {
    const v = rec[k];
    out += k === '__geometry' ? JSON.stringify(v)?.slice(0, 4096) ?? '' : v instanceof Date ? v.toISOString() : String(v ?? '');
    out += '\u0001';
  }
  return out;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

module.exports = {
  detectDateFormat,
  parseDate,
  parsePointString,
  validCoord,
  proposeMapping,
  buildTransformer,
  toNum,
  isBlank,
};
