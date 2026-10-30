/**
 * Format readers. Every reader is an async generator of plain row objects
 * ({ columnName: value }). Point geometry is exposed as __lng / __lat.
 * CSV/TSV/TXT and XLSX stream; JSON/GeoJSON/KML/GPX/PDF are parsed in memory
 * (size-capped). ZIP entries are streamed one at a time.
 */
const fs = require('fs');
const { parse } = require('csv-parse');
const yauzl = require('yauzl');
const ExcelJS = require('exceljs');
const { XMLParser } = require('fast-xml-parser');
const { LIMITS } = require('../../config/constants');
const { kindOf, ARCHIVE_EXT, IN_MEMORY, DIRS } = require('./files');
const { readExcel } = require('./excel');

const MB = 1024 * 1024;
const userError = (msg) => Object.assign(new Error(msg), { status: 400 });

/* ---------------- ZIP ---------------- */
const openZip = (p) => new Promise((res, rej) => yauzl.open(p, { lazyEntries: true, autoClose: false }, (e, z) => (e ? rej(userError(`Could not open the zip: ${e.message}`)) : res(z))));

/** List supported entries in a zip with zip-slip / size / count protection. */
async function listZip(zipPath) {
  const zip = await openZip(zipPath);
  const entries = []; const warnings = [];
  let total = 0; let count = 0;
  try {
    await new Promise((resolve, reject) => {
      zip.on('entry', (e) => {
        const name = e.fileName;
        if (/\/$/.test(name) || /(^|\/)(__MACOSX|\.)/.test(name)) return zip.readEntry();
        if (name.includes('..') || name.startsWith('/') || /^[a-z]:/i.test(name)) return reject(userError(`Unsafe path inside zip: ${name}`));
        count += 1;
        if (count > LIMITS.maxZipEntries) return reject(userError(`The zip has more than ${LIMITS.maxZipEntries} files.`));
        total += e.uncompressedSize;
        if (total > LIMITS.maxUncompressedMB * MB) return reject(userError(`The zip expands to more than ${LIMITS.maxUncompressedMB} MB.`));
        const kind = kindOf(name);
        if (ARCHIVE_EXT.test(name)) warnings.push(`Skipped nested archive ${name}.`);
        else if (!kind || kind === 'zip') warnings.push(`Skipped unsupported file ${name}.`);
        else if (kind === 'xls') warnings.push(`Skipped ${name}: legacy .xls is not supported, save it as .xlsx or .csv.`);
        else if (IN_MEMORY.has(kind) && e.uncompressedSize > LIMITS.maxInMemoryMB * MB) warnings.push(`Skipped ${name}: ${kind} files over ${LIMITS.maxInMemoryMB} MB are not supported, convert to CSV.`);
        else entries.push({ name, kind, size: e.uncompressedSize });
        zip.readEntry();
      });
      zip.on('end', resolve);
      zip.on('error', (e) => reject(e.status ? e : userError(`Unsafe or damaged zip file: ${e.message}`)));
      zip.readEntry();
    });
  } finally { zip.close(); }
  return { entries, warnings };
}

/** Open a read stream for one zip entry (yauzl validates the real size against the header). */
async function openZipEntry(zipPath, entryName) {
  const zip = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    zip.on('entry', (e) => {
      if (e.fileName !== entryName) return zip.readEntry();
      zip.openReadStream(e, (err, stream) => {
        if (err) { zip.close(); return reject(err); }
        stream.on('close', () => zip.close());
        stream.on('end', () => zip.close());
        resolve(stream);
      });
    });
    zip.on('end', () => { zip.close(); reject(userError(`Entry ${entryName} not found in zip.`)); });
    zip.on('error', reject);
    zip.readEntry();
  });
}

/** Build source descriptors for an uploaded file. */
async function describe(filePath, fileName, fileKind, fileSize) {
  if (fileKind === 'zip') {
    const { entries, warnings } = await listZip(filePath);
    if (!entries.length) throw userError(`The zip has no supported files. ${warnings.join(' ')}`.trim());
    return {
      warnings,
      sources: entries.map((e) => ({ name: e.name, kind: e.kind, size: e.size, open: () => openZipEntry(filePath, e.name) })),
    };
  }
  if (fileKind === 'xls') throw userError('Legacy .xls files are not supported. Open it in Excel and save as .xlsx or .csv.');
  if (fileKind === 'xlsx') {
    const { sheets, warnings } = await readExcel(filePath);
    return {
      warnings,
      sources: sheets.map((sheet) => ({
        name: `${fileName} › ${sheet.name}`,
        kind: 'xlsx',
        size: fileSize,
        sheetName: sheet.name,
        headers: sheet.headers,
        rows: sheet.rows,
        filePath,
        open: async () => fs.createReadStream(filePath),
      })),
    };
  }
  if (IN_MEMORY.has(fileKind) && fileSize > LIMITS.maxInMemoryMB * MB) {
    throw userError(`${fileKind.toUpperCase()} files over ${LIMITS.maxInMemoryMB} MB are not supported. Convert it to CSV, which streams without a size limit.`);
  }
  return { warnings: [], sources: [{ name: fileName, kind: fileKind, size: fileSize, open: async () => fs.createReadStream(filePath) }] };
}

async function readAll(stream, capMB = LIMITS.maxInMemoryMB) {
  const chunks = []; let n = 0;
  for await (const c of stream) {
    n += c.length;
    if (n > capMB * MB) { stream.destroy(); throw userError(`File is larger than ${capMB} MB for this format. Convert it to CSV.`); }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readHead(stream, bytes = 65536) {
  const chunks = []; let n = 0;
  for await (const c of stream) { chunks.push(c); n += c.length; if (n >= bytes) break; }
  stream.destroy();
  return Buffer.concat(chunks).subarray(0, bytes).toString('utf8').replace(/^\uFEFF/, '');
}

/* ---------------- delimited text ---------------- */
const COORD_LINE = /(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})/;

function sniffDelimiter(head) {
  const lines = head.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ','; let bestScore = 0;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const min = Math.min(...counts);
    const score = min > 0 ? min * 10 - (Math.max(...counts) - min) : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return bestScore > 0 ? best : null;
}

async function* delimitedRows(source) {
  const head = await readHead(await source.open());
  const delimiter = source.kind === 'tsv' ? '\t' : sniffDelimiter(head);
  if (!delimiter) {
    // free text: one record per line containing a "lat, lng" pair
    yield* lineRows(await source.open());
    return;
  }
  const parser = (await source.open()).pipe(parse({
    columns: (hdr) => hdr.map((h, i) => String(h || '').trim() || `column_${i + 1}`),
    delimiter, bom: true, trim: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true,
  }));
  for await (const row of parser) yield row;
}

async function* lineRows(stream) {
  let rest = '';
  for await (const c of stream) {
    const parts = (rest + c.toString('utf8')).split(/\r?\n/);
    rest = parts.pop();
    for (const line of parts) {
      const m = line.match(COORD_LINE);
      if (m) yield { line: line.trim().slice(0, 500), __lat: m[1], __lng: m[2] };
    }
  }
  const m = rest.match(COORD_LINE);
  if (m) yield { line: rest.trim().slice(0, 500), __lat: m[1], __lng: m[2] };
}

/* ---------------- Excel (.xlsx, robust shared reader) ---------------- */
async function* xlsxRows(source) {
  if (source.rows) {
    for (const row of source.rows) yield row;
    return;
  }
  if (source.filePath) {
    const { sheets } = await readExcel(source.filePath);
    const target = (source.sheetName && sheets.find((s) => s.name === source.sheetName)) || sheets[0];
    if (target) {
      for (const row of target.rows) yield row;
    }
    return;
  }
  const tempPath = path.join(DIRS.uploads, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.xlsx`);
  const stream = await source.open();
  const out = fs.createWriteStream(tempPath);
  await new Promise((res, rej) => stream.pipe(out).on('finish', res).on('error', rej));
  try {
    const { sheets } = await readExcel(tempPath);
    for (const s of sheets) {
      for (const row of s.rows) yield row;
    }
  } finally {
    await fs.promises.unlink(tempPath).catch(() => {});
  }
}

/* ---------------- JSON / GeoJSON ---------------- */
function centroid(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') return geom.coordinates;
  const pts = [];
  const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk));
  if (geom.coordinates) walk(geom.coordinates);
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && Object.keys(v).length < 30 && prefix.split('.').length < 2) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

async function* jsonRows(source) {
  let data;
  try { data = JSON.parse((await readAll(await source.open())).toString('utf8').replace(/^\uFEFF/, '')); } catch (e) {
    // JSON Lines fallback
    const text = (await readAll(await source.open())).toString('utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    try { data = lines.map((l) => JSON.parse(l)); } catch { throw userError(`Invalid JSON: ${e.message}`); }
  }
  if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    for (const f of data.features) {
      const c = centroid(f.geometry);
      yield { ...flatten(f.properties || {}), ...(c ? { __lng: c[0], __lat: c[1] } : {}) };
    }
    return;
  }
  if (data && data.type === 'Feature') { const c = centroid(data.geometry); yield { ...flatten(data.properties), ...(c ? { __lng: c[0], __lat: c[1] } : {}) }; return; }
  let arr = Array.isArray(data) ? data : null;
  if (!arr && data && typeof data === 'object') arr = Object.values(data).find((v) => Array.isArray(v) && v.length && typeof v[0] === 'object');
  if (!arr) throw userError('The JSON does not contain a list of records or a GeoJSON FeatureCollection.');
  for (const r of arr) if (r && typeof r === 'object') yield flatten(r);
}

/* ---------------- KML / GPX ---------------- */
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, isArray: (n) => ['Placemark', 'wpt', 'trkpt', 'rtept', 'trk', 'trkseg', 'rte', 'Data', 'Folder', 'Document'].includes(n) });

function collect(node, name, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === name) (Array.isArray(v) ? v : [v]).forEach((x) => out.push(x));
    else if (typeof v === 'object') (Array.isArray(v) ? v : [v]).forEach((x) => collect(x, name, out));
  }
  return out;
}
const txt = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? (v['#text'] ?? '') : String(v));

async function* kmlRows(source) {
  const doc = xml.parse((await readAll(await source.open())).toString('utf8'));
  for (const pm of collect(doc, 'Placemark')) {
    const coordText = txt(collect(pm, 'coordinates')[0]);
    const first = coordText.trim().split(/\s+/)[0] || '';
    const [lng, lat] = first.split(',').map(Number);
    const row = { __name: txt(pm.name), __desc: txt(pm.description).replace(/<[^>]+>/g, ' ').trim() };
    if (Number.isFinite(lng) && Number.isFinite(lat)) Object.assign(row, { __lng: lng, __lat: lat });
    const when = txt(pm.TimeStamp?.when) || txt(pm.TimeSpan?.begin);
    if (when) row.__time = when;
    for (const d of collect(pm, 'Data')) row[d['@_name'] || 'data'] = txt(d.value);
    for (const sd of collect(pm, 'SimpleData')) row[sd['@_name'] || 'data'] = txt(sd);
    yield row;
  }
}

async function* gpxRows(source) {
  const doc = xml.parse((await readAll(await source.open())).toString('utf8'));
  for (const tag of ['wpt', 'rtept', 'trkpt']) {
    for (const p of collect(doc, tag)) {
      yield {
        __lat: Number(p['@_lat']), __lng: Number(p['@_lon']),
        __name: txt(p.name), __desc: txt(p.desc) || txt(p.cmt), __time: txt(p.time), __kind: tag,
        ...(p.type ? { type: txt(p.type) } : {}),
      };
    }
  }
}

/* ---------------- PDF (text layer only) ---------------- */
async function* pdfRows(source) {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js'); // direct path avoids the package's debug self-test
  const buf = await readAll(await source.open());
  let text;
  // copy into a fresh Uint8Array: small Node Buffers live at an offset inside a shared pool,
  // and PDF.js reads the underlying memory from offset 0 ("bad XRef entry")
  try { text = (await pdfParse(new Uint8Array(buf))).text || ''; } catch (e) { throw userError(`Could not read the PDF: ${e.message}`); }
  if (text.replace(/\s/g, '').length < 20) throw userError('This PDF has no text layer (it is probably scanned images). Export the table as CSV or Excel instead.');

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const splitters = [/\t/, /\s*\|\s*/, /\s*,\s*/, /\s{2,}/];
  let best = null;
  for (const rx of splitters) {
    const cells = lines.map((l) => l.split(rx));
    const freq = {};
    cells.forEach((c) => { if (c.length >= 3) freq[c.length] = (freq[c.length] || 0) + 1; });
    const [n, hits] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0] || [0, 0];
    if (hits > (best?.hits || 0)) best = { rx, n: Number(n), hits };
  }
  if (best && best.hits >= 3) {
    const rows = lines.map((l) => l.split(best.rx)).filter((c) => c.length === best.n);
    const headerIdx = rows.findIndex((c) => c.filter((x) => /[a-z]/i.test(x)).length >= Math.ceil(best.n / 2));
    const header = (headerIdx >= 0 ? rows[headerIdx] : rows[0].map((_, i) => `column_${i + 1}`)).map((h, i) => h.trim() || `column_${i + 1}`);
    for (const c of rows.slice(headerIdx >= 0 ? headerIdx + 1 : 0)) {
      if (c.join('|') === header.join('|')) continue; // repeated header on later pages
      const o = {}; header.forEach((h, i) => { o[h] = c[i]; });
      yield o;
    }
    return;
  }
  // no table: fall back to lines containing coordinates
  for (const line of lines) {
    const m = line.match(COORD_LINE);
    if (m) yield { line: line.slice(0, 500), __lat: m[1], __lng: m[2] };
  }
}

function rowsOf(source) {
  switch (source.kind) {
    case 'csv': case 'tsv': case 'txt': return delimitedRows(source);
    case 'xlsx': return xlsxRows(source);
    case 'json': case 'geojson': return jsonRows(source);
    case 'kml': return kmlRows(source);
    case 'gpx': return gpxRows(source);
    case 'pdf': return pdfRows(source);
    default: throw userError(`Unsupported format: ${source.kind}`);
  }
}

/** Preview: columns, up to 20 sample rows, and a row estimate. */
async function preview(sources) {
  let sample = []; let used = null; const cols = new Set();
  for (const s of sources) {
    const it = rowsOf(s);
    for await (const row of it) {
      sample.push(row);
      Object.keys(row).forEach((k) => cols.add(k));
      if (sample.length >= 20) break;
    }
    if (typeof it.return === 'function') await it.return();
    if (sample.length) { used = s; break; }
  }
  if (!sample.length) throw userError('No readable rows were found. Check that the file has a header row and data.');

  // estimate rows from bytes-per-row of the sample (streamed text formats)
  let estimatedRows = null;
  if (['csv', 'tsv', 'txt'].includes(used.kind)) {
    const head = await readHead(await used.open(), 262144);
    const lines = head.split(/\r?\n/).length - 1;
    const bytesPerRow = lines > 1 ? Buffer.byteLength(head) / lines : null;
    if (bytesPerRow) {
      estimatedRows = Math.round(sources.filter((s) => ['csv', 'tsv', 'txt'].includes(s.kind)).reduce((sum, s) => sum + s.size / bytesPerRow, 0));
    }
  }
  sample = sample.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
  return { columns: [...cols], sample, estimatedRows, previewSource: used.name };
}

module.exports = { describe, rowsOf, preview, userError };
