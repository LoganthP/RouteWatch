// RouteWatch — format-agnostic streaming readers.
// Everything is streamed: memory stays flat whether the file is 1 MB or 10 GB.
// ZIP entries are read directly out of the archive — nothing is extracted to disk
// (except a nested .zip, which is spilled to a temp file because ZIP needs random access).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PassThrough } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createInterface } = require('node:readline');
const { StringDecoder } = require('node:string_decoder');
const yauzl = require('yauzl');
const { parse: csvParse } = require('csv-parse');
const sax = require('sax');
const ExcelJS = require('exceljs');
const shapefile = require('shapefile');

const FORMAT_BY_EXT = {
  csv: 'csv', tsv: 'csv', tab: 'csv', txt: 'csv', psv: 'csv',
  json: 'json', geojson: 'json', ndjson: 'ndjson', jsonl: 'ndjson',
  xlsx: 'xlsx', xlsm: 'xlsx', kml: 'kml', gpx: 'gpx', shp: 'shp', zip: 'zip',
};
const COMPANION_EXT = new Set(['dbf', 'shx', 'prj', 'cpg', 'sbn', 'sbx', 'qix', 'xml']);
const SKIP_REASON = {
  pdf: 'PDF tables cannot be read reliably — export the table to CSV/Excel first',
  xls: 'Legacy .xls is not supported — re-save as .xlsx or CSV',
  ipynb: 'Notebook file (code), not data', py: 'Source code, not data', md: 'Documentation',
  png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', docx: 'Word document', pptx: 'Presentation',
};

const extOf = (n) => path.extname(n).slice(1).toLowerCase();

/* ------------------------------------------------------------------ entries */

function openZip(file) {
  return new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => (e ? rej(e) : res(z))));
}

/**
 * Returns a flat list of data entries inside `filePath` (recurses into zips).
 * Each entry: { id, name, ext, format, size, open(): Promise<Readable>, skipped?, reason? }
 * Call `close()` when done.
 */
async function listEntries(filePath, displayName = path.basename(filePath)) {
  const closers = [];
  const entries = [];

  async function addFile(file, name, prefix) {
    const ext = extOf(name);
    if (ext === 'zip') return addZip(file, prefix ? `${prefix}/${name}` : name);
    const size = (await fsp.stat(file)).size;
    entries.push(makeEntry(prefix ? `${prefix}/${name}` : name, size, async () => fs.createReadStream(file)));
  }

  async function addZip(file, label) {
    const zip = await openZip(file);
    closers.push(() => zip.close());
    const zEntries = await new Promise((res, rej) => {
      const out = [];
      zip.on('entry', (e) => { out.push(e); zip.readEntry(); });
      zip.on('end', () => res(out));
      zip.on('error', rej);
      zip.readEntry();
    });
    for (const ze of zEntries) {
      const name = ze.fileName;
      if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
      const open = () => new Promise((res, rej) => zip.openReadStream(ze, (e, s) => (e ? rej(e) : res(s))));
      if (extOf(name) === 'zip') {
        const tmp = path.join(os.tmpdir(), `rw-${crypto.randomUUID()}.zip`);
        await pipeline(await open(), fs.createWriteStream(tmp));
        closers.push(() => fsp.rm(tmp, { force: true }));
        await addZip(tmp, `${label}/${name}`);
        continue;
      }
      entries.push(makeEntry(`${label}/${name}`, ze.uncompressedSize, open));
    }
  }

  await addFile(filePath, displayName, '');

  // Pair shapefile components (.shp + .dbf in the same folder)
  const byStem = new Map(entries.map((e) => [e.name.replace(/\.[^.]+$/, '').toLowerCase() + '.' + e.ext, e]));
  for (const e of entries) {
    if (e.ext === 'shp') {
      const stem = e.name.replace(/\.[^.]+$/, '').toLowerCase();
      e.dbf = byStem.get(`${stem}.dbf`) || null;
    }
    if (COMPANION_EXT.has(e.ext)) { e.skipped = true; e.companion = true; e.reason = 'Shapefile companion file'; }
  }
  entries.forEach((e, i) => { e.id = String(i); });

  return { entries, close: async () => { for (const c of closers.reverse()) await Promise.resolve(c()).catch(() => {}); } };
}

function makeEntry(name, size, open) {
  const ext = extOf(name);
  const format = FORMAT_BY_EXT[ext] || null;
  const e = { name, ext, format, size, open };
  if (!format) { e.skipped = true; e.reason = SKIP_REASON[ext] || `Unsupported file type .${ext || '(none)'}`; }
  if (size === 0) { e.skipped = true; e.reason = 'Empty file'; }
  return e;
}

/* ------------------------------------------------------------------ helpers */

/** Wraps a stream so we can count bytes for progress. */
function countingStream(src, onBytes) {
  const pt = new PassThrough({ highWaterMark: 1 << 20 });
  src.on('data', (c) => onBytes(c.length));
  src.on('error', (e) => pt.destroy(e));
  src.pipe(pt);
  return pt;
}

/** Reads the first `n` bytes of a stream as text (used for sniffing, opens a separate stream). */
async function peekText(entry, n = 65536) {
  const s = await entry.open();
  let buf = Buffer.alloc(0);
  for await (const c of s) { buf = Buffer.concat([buf, c]); if (buf.length >= n) break; }
  s.destroy();
  return buf.subarray(0, n).toString('utf8').replace(/^\uFEFF/, '');
}

function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = counts[0] * consistent;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** Makes header names unique and non-empty. */
function uniqueHeaders(raw) {
  const seen = new Map();
  return raw.map((h, i) => {
    let name = String(h ?? '').replace(/^\uFEFF/, '').trim() || `column_${i + 1}`;
    if (seen.has(name)) { const n = seen.get(name) + 1; seen.set(name, n); name = `${name}_${n}`; } else seen.set(name, 1);
    return name;
  });
}

/* ------------------------------------------------------------------ readers */

/**
 * async iterator of plain-object records for one entry.
 * Non-point geometries come through as `__geometry` (GeoJSON).
 * opts.onBytes(n) — progress hook; opts.limit — stop after N records (sampling).
 */
async function* readRecords(entry, opts = {}) {
  const { onBytes = () => {}, limit = Infinity, maxMs = Infinity } = opts;
  let count = 0;
  const started = Date.now();
  const gen = readerFor(entry, onBytes);
  try {
    for await (const rec of gen) {
      yield rec;
      if (++count >= limit || Date.now() - started > maxMs) break;
    }
  } finally {
    await gen.return?.();
  }
}

async function* readerFor(entry, onBytes) {
  switch (entry.format) {
    case 'csv': yield* readCsv(entry, onBytes); break;
    case 'json': yield* readJson(entry, onBytes); break;
    case 'ndjson': yield* readNdjson(entry, onBytes); break;
    case 'xlsx': yield* readXlsx(entry, onBytes); break;
    case 'kml': case 'gpx': yield* readXmlGeo(entry, onBytes); break;
    case 'shp': yield* readShp(entry, onBytes); break;
    default: throw new Error(`No reader for ${entry.name}`);
  }
}

async function* readCsv(entry, onBytes) {
  const head = await peekText(entry);
  const delimiter = entry.ext === 'tsv' || entry.ext === 'tab' ? '\t' : entry.ext === 'psv' ? '|' : sniffDelimiter(head);
  const src = countingStream(await entry.open(), onBytes);
  const parser = src.pipe(csvParse({
    delimiter, bom: true, columns: (h) => uniqueHeaders(h), relax_column_count: true, relax_quotes: true,
    skip_empty_lines: true, trim: true, skip_records_with_error: true,
  }));
  try { for await (const row of parser) yield row; } finally { src.destroy(); }
}

async function* readNdjson(entry, onBytes) {
  const src = countingStream(await entry.open(), onBytes);
  const rl = createInterface({ input: src, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      try { yield* normalizeJsonItem(JSON.parse(t)); } catch { /* bad line — skipped, counted as invalid upstream */ }
    }
  } finally { src.destroy(); }
}

async function* readJson(entry, onBytes) {
  const head = await peekText(entry, 262144);
  const first = head.trimStart()[0];
  // NDJSON saved as .json
  if (first === '{' && /}\s*\r?\n\s*{/.test(head.slice(0, 200000)) && !/"type"\s*:\s*"FeatureCollection"/.test(head)) {
    yield* readNdjson(entry, onBytes); return;
  }
  const key = first === '[' ? null
    : /"features"\s*:\s*\[/.test(head) ? 'features'
      : (head.match(/"(data|records|rows|items|results|incidents|accidents|elements|value)"\s*:\s*\[/) || [])[1];
  if (first !== '[' && !key) { // small single object — just parse it
    const s = await entry.open(); const parts = []; for await (const c of s) { parts.push(c); onBytes(c.length); }
    yield* normalizeJsonItem(JSON.parse(Buffer.concat(parts).toString('utf8').replace(/^\uFEFF/, '')));
    return;
  }
  const src = countingStream(await entry.open(), onBytes);
  try {
    for await (const text of splitJsonArray(src, key)) yield* normalizeJsonItem(JSON.parse(text));
  } finally { src.destroy(); }
}

/**
 * Fast streaming splitter: yields the raw JSON text of each element of the root array
 * (key = null) or of the array under root[key]. Elements are parsed with native JSON.parse,
 * ~20x faster than token-level streaming for big polygon GeoJSON, still O(element) memory.
 */
async function* splitJsonArray(stream, key) {
  const dec = new StringDecoder('utf8');
  let depth = 0, inStr = false, esc = false;
  let arrayDepth = -1;            // depth INSIDE the target array once found
  let lastKey = null, strBuf = '', awaitingArray = false;
  let elem = null, elemStart = 0;
  for await (const chunk of stream) {
    const t = dec.write(chunk);
    let i = 0;
    if (elem !== null) elemStart = 0;
    for (; i < t.length; i++) {
      const ch = t.charCodeAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (ch === 92) esc = true;            // \
        else if (ch === 34) { inStr = false; if (arrayDepth < 0 && depth === 1) lastKey = strBuf; }
        else if (arrayDepth < 0 && depth === 1 && strBuf.length < 64) strBuf += t[i];
        continue;
      }
      if (ch === 34) { inStr = true; strBuf = ''; continue; }
      if (arrayDepth < 0) {
        if (ch === 58 && depth === 1 && lastKey === key) { awaitingArray = true; continue; }   // :
        if (ch === 91 || ch === 123) {             // [ {
          depth++;
          if (ch === 91 && ((key === null && depth === 1) || awaitingArray)) { arrayDepth = depth; }
          awaitingArray = false;
        } else if (ch === 93 || ch === 125) depth--;
        else if (ch !== 32 && ch !== 10 && ch !== 13 && ch !== 9) awaitingArray = false;
        continue;
      }
      // inside the target array
      if (ch === 123 || ch === 91) {
        if (depth === arrayDepth && elem === null) { elem = ''; elemStart = i; }
        depth++;
      } else if (ch === 125 || ch === 93) {
        depth--;
        if (depth === arrayDepth && elem !== null) {
          elem += t.slice(elemStart, i + 1);
          yield elem; elem = null;
        } else if (depth < arrayDepth) { return; }  // end of target array
      }
    }
    if (elem !== null) elem += t.slice(elemStart);
  }
}

function* normalizeJsonItem(v) {
  if (v == null || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) yield* normalizeJsonItem(x); return; }
  if (v.type === 'FeatureCollection' && Array.isArray(v.features)) { for (const f of v.features) yield* normalizeJsonItem(f); return; }
  if (v.type === 'Feature') { yield { ...flatten(v.properties || {}), __geometry: v.geometry || null }; return; }
  yield flatten(v);
}

/** Flattens nested objects one level deep: {loc:{lat,lng}} -> {"loc.lat","loc.lng"}. Arrays stay as-is. */
function flatten(obj, prefix = '', out = {}, depth = 0) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && depth < 2 && v.type !== 'Point') flatten(v, key, out, depth + 1);
    else out[key] = v;
  }
  return out;
}

async function* readXlsx(entry, onBytes) {
  const src = countingStream(await entry.open(), onBytes);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(src, { sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit' });
  for await (const sheet of reader) {
    let headers = null;
    for await (const row of sheet) {
      const vals = (row.values || []).slice(1).map(cellValue);
      if (!headers) { if (vals.some((v) => v != null && v !== '')) headers = uniqueHeaders(vals); continue; }
      const rec = {};
      headers.forEach((h, i) => { rec[h] = vals[i] ?? null; });
      if (Object.values(rec).some((v) => v != null && v !== '')) yield rec;
    }
  }
}

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') return v.result ?? v.text ?? (Array.isArray(v.richText) ? v.richText.map((r) => r.text).join('') : null) ?? v.hyperlink ?? null;
  return v;
}

/** KML Placemarks and GPX wpt/trkpt/rtept, streamed with SAX. */
async function* readXmlGeo(entry, onBytes) {
  const src = countingStream(await entry.open(), onBytes);
  const sx = sax.createStream(false, { lowercase: true, trim: true });
  const queue = []; let done = false; let error = null; let wake = null;
  const notify = () => { if (wake) { const w = wake; wake = null; w(); } };

  let cur = null; let text = ''; let tagStack = []; let extKey = null;
  const isGpxPoint = (t) => t === 'wpt' || t === 'trkpt' || t === 'rtept';
  sx.on('opentag', (n) => {
    tagStack.push(n.name); text = '';
    if (n.name === 'placemark') cur = {};
    else if (isGpxPoint(n.name)) cur = { latitude: Number(n.attributes.lat), longitude: Number(n.attributes.lon), kind: n.name };
    else if (cur && (n.name === 'data' || n.name === 'simpledata')) extKey = n.attributes.name;
  });
  sx.on('text', (t) => { text += t; });
  sx.on('cdata', (t) => { text += t; });
  sx.on('closetag', (name) => {
    tagStack.pop();
    if (!cur) return;
    const t = text.trim(); text = '';
    if (name === 'coordinates' && cur.__coords == null) cur.__coords = t;
    else if (name === 'value' && extKey) { cur[extKey] = t; }
    else if (name === 'simpledata' && extKey) { cur[extKey] = t; extKey = null; }
    else if (name === 'data') extKey = null;
    else if (['name', 'description', 'time', 'when', 'ele', 'desc', 'type', 'cmt', 'sym', 'address', 'styleurl'].includes(name) && t) cur[name] = t;
    if (name === 'placemark' || isGpxPoint(name)) {
      if (cur.__coords) {
        const pts = cur.__coords.split(/\s+/).map((p) => p.split(',').map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite));
        if (pts.length === 1) { cur.longitude = pts[0][0]; cur.latitude = pts[0][1]; }
        else if (pts.length > 1) cur.__geometry = { type: 'LineString', coordinates: pts.map((p) => [p[0], p[1]]) };
        delete cur.__coords;
      }
      queue.push(cur); cur = null; if (queue.length > 2000) src.pause(); notify();
    }
  });
  sx.on('error', (e) => { error = e; notify(); });
  sx.on('end', () => { done = true; notify(); });
  src.pipe(sx);
  try {
    while (true) {
      if (queue.length) { yield queue.shift(); continue; }
      if (error) throw error;
      if (done) return;
      if (queue.length === 0) { src.resume(); await new Promise((r) => { wake = r; }); }
    }
  } finally { src.destroy(); }
}

async function* readShp(entry, onBytes) {
  const shpStream = countingStream(await entry.open(), onBytes);
  const dbfStream = entry.dbf ? await entry.dbf.open() : undefined;
  const source = await shapefile.open(shpStream, dbfStream, { encoding: 'utf-8' });
  try {
    while (true) {
      const r = await source.read();
      if (r.done) return;
      const f = r.value;
      yield { ...(f.properties || {}), __geometry: f.geometry };
    }
  } finally { shpStream.destroy(); dbfStream?.destroy(); }
}

module.exports = {
  listEntries,
  countingStream,
  readRecords,
};
