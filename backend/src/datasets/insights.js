// RouteWatch — streaming insights. Computed WHILE importing, so insights for a
// 10-million-row dataset are ready the moment the import finishes (no heavy re-scan).
const { toNum, isBlank } = require('./mapping.js');

const MAX_DISTINCT = 500;     // per column; beyond this a column is "high cardinality"
const GRID = 0.01;            // ~1.1 km hotspot cells
const MAX_CELLS = 200000;

class ColumnStats {
  constructor() { this.count = 0; this.nulls = 0; this.numeric = 0; this.n = 0; this.mean = 0; this.m2 = 0; this.min = null; this.max = null; this.top = new Map(); this.highCardinality = false; }
  add(v) {
    this.count++;
    if (isBlank(v)) { this.nulls++; return; }
    const num = typeof v === 'object' ? null : toNum(v);
    if (num != null) {
      this.numeric++; this.n++;
      const d = num - this.mean; this.mean += d / this.n; this.m2 += d * (num - this.mean);
      if (this.min == null || num < this.min) this.min = num;
      if (this.max == null || num > this.max) this.max = num;
    }
    const key = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80);
    if (this.top.has(key)) this.top.set(key, this.top.get(key) + 1);
    else if (this.top.size < MAX_DISTINCT) this.top.set(key, 1);
    else this.highCardinality = true;
  }
  toJSON() {
    const nonNull = this.count - this.nulls;
    const isNumeric = nonNull > 0 && this.numeric / nonNull > 0.9;
    return {
      type: isNumeric ? 'number' : 'text',
      count: this.count, missing: this.nulls, missingPct: pct(this.nulls, this.count),
      distinct: this.highCardinality ? `>${MAX_DISTINCT}` : this.top.size,
      ...(isNumeric ? { min: this.min, max: this.max, mean: round(this.mean), std: round(this.n > 1 ? Math.sqrt(this.m2 / (this.n - 1)) : 0) } : {}),
      top: [...this.top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, count]) => ({ value, count })),
    };
  }
}

const inc = (map, k, by = 1) => { if (k == null) return; map.set(k, (map.get(k) || 0) + by); };
const topN = (map, n = 20) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));
const sorted = (map) => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, count]) => ({ key, count }));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const round = (n) => Math.round(n * 1000) / 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

class DatasetProfiler {
  constructor() {
    this.rows = 0; this.stored = 0; this.invalid = 0; this.duplicates = 0;
    this.invalidReasons = new Map();
    this.columns = new Map();
    this.byYear = new Map(); this.byMonth = new Map(); this.byHour = new Map(); this.byDow = new Map();
    this.bySeverity = new Map(); this.byType = new Map(); this.byArea = new Map(); this.byFile = new Map();
    this.cells = new Map(); this.cellsCapped = false;
    this.bbox = null; this.dateMin = null; this.dateMax = null;
    this.casualties = 0; this.withGeo = 0; this.withDate = 0; this.withTime = 0;
  }

  /** raw record (for column profiling) */
  observeRaw(rec) {
    this.rows++;
    for (const [k, v] of Object.entries(rec)) {
      if (k === '__geometry') continue;
      let c = this.columns.get(k);
      if (!c) { if (this.columns.size >= 300) continue; c = new ColumnStats(); this.columns.set(k, c); }
      c.add(v);
    }
  }

  invalidRow(reason) { this.invalid++; inc(this.invalidReasons, reason); }

  /** transformed document (for incident/record level insights) */
  observeDoc(doc, file) {
    inc(this.byFile, file);
    const coords = doc.location?.coordinates;
    if (coords) {
      this.withGeo++;
      const [lon, lat] = coords;
      if (!this.bbox) this.bbox = [lon, lat, lon, lat];
      else { const b = this.bbox; if (lon < b[0]) b[0] = lon; if (lat < b[1]) b[1] = lat; if (lon > b[2]) b[2] = lon; if (lat > b[3]) b[3] = lat; }
      const key = `${Math.floor(lat / GRID)}:${Math.floor(lon / GRID)}`;
      if (this.cells.has(key) || this.cells.size < MAX_CELLS) inc(this.cells, key); else this.cellsCapped = true;
    }
    const d = doc.occurredAt || doc.reportedAt;
    if (d instanceof Date) {
      this.withDate++;
      if (!this.dateMin || d < this.dateMin) this.dateMin = d;
      if (!this.dateMax || d > this.dateMax) this.dateMax = d;
      const iso = d.toISOString();
      const prec = doc.occurredAtPrecision || 'time';
      inc(this.byYear, iso.slice(0, 4));
      if (prec !== 'year') { inc(this.byMonth, iso.slice(0, 7)); inc(this.byDow, DOW[d.getUTCDay()]); }
      if (prec === 'time') { inc(this.byHour, d.getUTCHours()); this.withTime++; }
    }
    if (doc.severity) inc(this.bySeverity, doc.severity);
    const type = doc.type ?? doc.category; if (type != null && this.byType.size < 5000) inc(this.byType, String(type));
    if (doc.area != null && this.byArea.size < 20000) inc(this.byArea, String(doc.area));
    if (Number.isFinite(doc.casualties)) this.casualties += doc.casualties;
  }

  summary() {
    const hotspots = [...this.cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, count]) => {
      const [i, j] = k.split(':').map(Number);
      return { lat: round((i + 0.5) * GRID), lon: round((j + 0.5) * GRID), count };
    });
    const hours = sorted(this.byHour);
    const peakHour = hours.reduce((a, b) => (b.count > (a?.count ?? -1) ? b : a), null);
    const years = sorted(this.byYear);
    const trend = years.length >= 2 ? pct(years.at(-1).count - years[0].count, years[0].count) : null;
    const sev = topN(this.bySeverity, 10);
    const severe = sev.filter((s) => s.key === 'critical' || s.key === 'high').reduce((a, b) => a + b.count, 0);

    const highlights = [];
    if (this.stored) highlights.push(`${this.stored.toLocaleString('en-IN')} records imported${this.invalid ? `, ${this.invalid.toLocaleString('en-IN')} rows skipped (${topN(this.invalidReasons, 1)[0]?.key.replace(/_/g, ' ')})` : ''}.`);
    if (this.dateMin) highlights.push(`Covers ${this.dateMin.toISOString().slice(0, 10)} to ${this.dateMax.toISOString().slice(0, 10)}.`);
    if (peakHour) highlights.push(`Peak hour is ${String(peakHour.key).padStart(2, '0')}:00 with ${pct(peakHour.count, this.withTime)}% of timed records.`);
    if (sev.length && this.stored) highlights.push(`${pct(severe, this.stored)}% of records are high/critical severity.`);
    if (hotspots[0]) highlights.push(`Densest ~1 km cell is near ${hotspots[0].lat}, ${hotspots[0].lon} (${hotspots[0].count.toLocaleString('en-IN')} records).`);
    const dows = DOW.map((d) => [d, this.byDow.get(d) || 0]).sort((a, b) => b[1] - a[1]);
    if (dows[0][1]) highlights.push(`Busiest weekday: ${dows[0][0]} (${pct(dows[0][1], dows.reduce((a, b) => a + b[1], 0))}%).`);
    const topArea = topN(this.byArea, 1)[0];
    if (topArea) highlights.push(`Most affected area: ${topArea.key} (${topArea.count.toLocaleString('en-IN')}).`);
    if (trend != null) highlights.push(`Yearly volume changed ${trend > 0 ? '+' : ''}${trend}% from ${years[0].key} to ${years.at(-1).key}.`);
    const missingCols = [...this.columns.entries()].filter(([, c]) => c.count && c.nulls / c.count > 0.5).map(([k]) => k);
    if (missingCols.length) highlights.push(`Columns mostly empty (>50% missing): ${missingCols.slice(0, 6).join(', ')}${missingCols.length > 6 ? '…' : ''}.`);

    return {
      totals: { rowsRead: this.rows, stored: this.stored, invalid: this.invalid, duplicates: this.duplicates, withGeo: this.withGeo, withDate: this.withDate, withTime: this.withTime, casualties: this.casualties },
      invalidReasons: topN(this.invalidReasons, 10),
      dateRange: this.dateMin ? { from: this.dateMin, to: this.dateMax } : null,
      bbox: this.bbox,
      temporal: { byYear: years, byMonth: sorted(this.byMonth), byHour: hours, byDayOfWeek: DOW.map((d) => ({ key: d, count: this.byDow.get(d) || 0 })) },
      bySeverity: sev, byType: topN(this.byType), byArea: topN(this.byArea), byFile: topN(this.byFile, 50),
      hotspots, hotspotGridDeg: GRID, hotspotsTruncated: this.cellsCapped,
      columns: Object.fromEntries([...this.columns.entries()].map(([k, c]) => [k, c.toJSON()])),
      highlights,
    };
  }
}

module.exports = {
  DatasetProfiler,
};
