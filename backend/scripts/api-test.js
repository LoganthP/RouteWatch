/**
 * End-to-end API test. Start the backend (and ideally the ML service) first:
 *   npm run test:api
 * Optional: API_URL=http://localhost:5000 FIXTURES=./scripts/fixtures
 */
const fs = require('fs');
const path = require('path');

const API = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '') + '/api';
const FIX = path.resolve(process.env.FIXTURES || path.join(__dirname, 'fixtures'));
const results = [];
let token = ''; let citizen = '';

async function call(method, url, { body, auth = token, raw, headers = {} } = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, data, type };
}

async function check(name, fn) {
  const t = Date.now();
  try { const note = await fn(); results.push({ test: name, result: 'PASS', ms: Date.now() - t, note: note || '' }); }
  catch (e) { results.push({ test: name, result: 'FAIL', ms: Date.now() - t, note: String(e.message).slice(0, 140) }); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const expectStatus = (r, s) => expect(r.status === s, `expected ${s}, got ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(file, auth = token) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const init = await call('POST', '/datasets/upload/init', { body: { filename: file, size: buf.length }, auth });
  if (init.status !== 201) return init;
  const { uploadId, chunkSize, totalChunks } = init.data;
  for (let i = 0; i < totalChunks; i++) {
    const r = await call('PUT', `/datasets/upload/${uploadId}/chunk?index=${i}`, { raw: buf.subarray(i * chunkSize, (i + 1) * chunkSize), auth, headers: { 'Content-Type': 'application/octet-stream' } });
    if (r.status !== 200) return r;
  }
  return call('POST', `/datasets/upload/${uploadId}/complete`, { auth });
}

async function importAndWait(id, body, auth = token) {
  const r = await call('POST', `/datasets/${id}/import`, { body, auth });
  expectStatus(r, 202);
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const d = await call('GET', `/datasets/${id}`, { auth });
    if (!['importing', 'uploaded'].includes(d.data.status)) return d.data;
  }
  throw new Error('import did not finish in 60s');
}

(async () => {
  await check('health', async () => { const r = await call('GET', '/health'); expectStatus(r, 200); expect(r.data.db === 'connected', 'db not connected'); });
  await check('login wrong password → 401', async () => expectStatus(await call('POST', '/auth/login', { body: { email: 'admin@routewatch.local', password: 'nope' } }), 401));
  await check('login admin', async () => { const r = await call('POST', '/auth/login', { body: { email: 'admin@routewatch.local', password: 'Admin@123' } }); expectStatus(r, 200); token = r.data.token; });
  await check('login citizen', async () => { const r = await call('POST', '/auth/login', { body: { email: 'user@routewatch.local', password: 'User@123' } }); expectStatus(r, 200); citizen = r.data.token; });
  await check('me with bad token → 401', async () => expectStatus(await call('GET', '/auth/me', { auth: 'garbage' }), 401));
  await check('register duplicate → 409', async () => expectStatus(await call('POST', '/auth/register', { body: { name: 'x', email: 'admin@routewatch.local', password: '123456' } }), 409));

  let bounds;
  await check('bounds span several continents', async () => { const r = await call('GET', '/analytics/bounds'); expectStatus(r, 200); bounds = r.data; expect(r.data.bbox && r.data.bbox[2] - r.data.bbox[0] > 100, 'bbox too small'); return `${r.data.count} incidents`; });
  await check('summary', async () => { const r = await call('GET', '/analytics/summary'); expectStatus(r, 200); expect(r.data.total > 0, 'no data'); });
  await check('summary empty filter has zeros', async () => { const r = await call('GET', '/analytics/summary?from=2001-01-01&to=2001-01-02'); expectStatus(r, 200); expect(r.data.total === 0 && r.data.bySeverity.length === 4, 'not zeroed'); });
  await check('hotspots Mysuru bbox', async () => { const r = await call('GET', '/analytics/hotspots?bbox=76.5,12.2,76.8,12.4&zoom=12'); expectStatus(r, 200); expect(r.data.cells.length > 0, 'no cells'); return `${r.data.hotspotCount} hotspots`; });
  await check('hotspots London bbox', async () => { const r = await call('GET', '/analytics/hotspots?bbox=-0.4,51.3,0.2,51.7'); expectStatus(r, 200); expect(r.data.cells.length > 0, 'no cells'); });
  await check('antimeridian bbox', async () => { const r = await call('GET', '/analytics/summary?bbox=170,-50,-170,-30'); expectStatus(r, 200); });
  await check('bad bbox ignored', async () => expectStatus(await call('GET', '/analytics/summary?bbox=a,b,c'), 200));
  for (const g of ['hour', 'dayOfWeek', 'month', 'day', 'weekhour', 'bogus']) {
    await check(`temporal ${g}`, async () => expectStatus(await call('GET', `/analytics/temporal?granularity=${g}`), 200));
  }
  await check('local-time rush hour in Tokyo', async () => {
    const r = await call('GET', '/analytics/temporal?granularity=hour&bbox=139.3,35.4,140,36');
    const peak = r.data.series.reduce((a, b) => (b.total > a.total ? b : a));
    expect(['07:00', '08:00', '09:00', '16:00', '17:00', '18:00', '19:00', '20:00'].includes(peak.label), `peak ${peak.label}`);
    return `peak ${peak.label} local`;
  });
  await check('severity', async () => expectStatus(await call('GET', '/analytics/severity'), 200));
  await check('areas', async () => { const r = await call('GET', '/analytics/areas?limit=5'); expectStatus(r, 200); expect(r.data[0].bbox, 'no bbox'); });
  await check('heatmap', async () => { const r = await call('GET', '/analytics/heatmap?limit=100'); expectStatus(r, 200); expect(r.data.length === 100, 'wrong size'); });
  await check('performance default point', async () => { const r = await call('GET', '/analytics/performance'); expectStatus(r, 200); expect(r.data.geo[0].usedIndex, 'no index'); });
  await check('performance bad coords → 400', async () => expectStatus(await call('GET', '/analytics/performance?lng=999&lat=0'), 400));

  await check('incidents list', async () => { const r = await call('GET', '/incidents?limit=5&sort=severity&dir=asc'); expectStatus(r, 200); expect(r.data.items.length === 5, 'len'); });
  await check('incidents NaN paging', async () => expectStatus(await call('GET', '/incidents?page=abc&limit=xyz'), 200));
  await check('map clusters at zoom 3', async () => { const r = await call('GET', '/incidents/map?zoom=3'); expectStatus(r, 200); expect(r.data.mode === 'clusters', 'mode'); });
  await check('map points at zoom 14', async () => { const r = await call('GET', '/incidents/map?zoom=14&bbox=76.6,12.28,76.7,12.33'); expectStatus(r, 200); expect(r.data.mode === 'points', 'mode'); });
  await check('nearby', async () => { const r = await call('GET', '/incidents/nearby?lng=76.6552&lat=12.3052&radius=2000'); expectStatus(r, 200); expect(r.data.items.length > 0, 'empty'); });
  await check('nearby missing coords → 400', async () => expectStatus(await call('GET', '/incidents/nearby'), 400));
  await check('get unknown incident → 404', async () => expectStatus(await call('GET', '/incidents/INC-99999999'), 404));
  await check('areas list', async () => { const r = await call('GET', '/areas'); expectStatus(r, 200); expect(r.data.length > 10, 'few areas'); });
  await check('area incidents (stored polygon)', async () => expectStatus(await call('GET', `/areas/${encodeURIComponent('Vijayanagar')}/incidents`), 200));
  await check('area incidents (dynamic)', async () => expectStatus(await call('GET', `/areas/${encodeURIComponent('London Central')}/incidents`), 200));
  await check('area unknown → 404', async () => expectStatus(await call('GET', '/areas/Nowhere%20Land/incidents'), 404));

  let created;
  await check('create incident without auth → 401', async () => expectStatus(await call('POST', '/incidents', { body: {}, auth: '' }), 401));
  await check('create invalid → 400', async () => expectStatus(await call('POST', '/incidents', { body: { type: 'X', severity: 'Y' } }), 400));
  await check('create incident (Nairobi)', async () => {
    const r = await call('POST', '/incidents', { body: { type: 'Hazard', severity: 'High', description: 'API test', location: { type: 'Point', coordinates: [36.82, -1.29] } } });
    expectStatus(r, 201); created = r.data; expect(r.data.tz === 'Africa/Nairobi', `tz ${r.data.tz}`); return `${r.data.incidentId} in ${r.data.area}`;
  });
  await check('citizen cannot change status → 403', async () => expectStatus(await call('PATCH', `/incidents/${created.incidentId}/status`, { body: { status: 'Resolved' }, auth: citizen }), 403));
  await check('admin resolve', async () => { const r = await call('PATCH', `/incidents/${created.incidentId}/status`, { body: { status: 'Resolved' } }); expectStatus(r, 200); expect(r.data.resolvedAt, 'no resolvedAt'); });
  await check('admin delete', async () => expectStatus(await call('DELETE', `/incidents/${created.incidentId}`), 200));
  await check('audit log (admin)', async () => expectStatus(await call('GET', '/audit?limit=5'), 200));
  await check('audit log citizen → 403', async () => expectStatus(await call('GET', '/audit', { auth: citizen }), 403));
  await check('CSV export', async () => { const r = await call('GET', '/reports/csv?severity=Critical&bbox=76.5,12.2,76.8,12.4'); expectStatus(r, 200); expect(r.data.startsWith('incidentId,'), 'not csv'); });
  await check('PDF export', async () => { const res = await fetch(`${API}/reports/pdf?type=Accident`, { headers: { Authorization: `Bearer ${token}` } }); expect(res.status === 200 && (await res.arrayBuffer()).byteLength > 1000, 'pdf'); });

  /* ---------------- datasets ---------------- */
  await check('limits', async () => { const r = await call('GET', '/datasets/limits'); expectStatus(r, 200); expect(r.data.maxUploadMB > 1000, 'limit'); });
  await check('storage', async () => { const r = await call('GET', '/datasets/storage'); expectStatus(r, 200); return `${r.data.usedMB} MB used`; });
  await check('upload too large → 413 with size', async () => { const r = await call('POST', '/datasets/upload/init', { body: { filename: 'big.csv', size: 5.2 * 1024 ** 4 } }); expectStatus(r, 413); expect(/GB/.test(r.data.message), r.data.message); });
  await check('unsupported type → 400', async () => expectStatus(await call('POST', '/datasets/upload/init', { body: { filename: 'x.exe', size: 10 } }), 400));
  await check('unknown session → 404 with clear message', async () => { const r = await call('PUT', '/datasets/upload/00000000-0000-4000-8000-000000000000/chunk?index=0', { raw: Buffer.from('x'), headers: { 'Content-Type': 'application/octet-stream' } }); expectStatus(r, 404); expect(/Upload session not found/.test(r.data.message), r.data.message); });
  await check('fake csv (exe) rejected', async () => { const r = await upload('fake.csv'); expectStatus(r, 400); });
  await check('zip-slip rejected', async () => { const r = await upload('evil.zip'); expectStatus(r, 400); });
  await check('wrong chunk size → 400', async () => {
    const init = await call('POST', '/datasets/upload/init', { body: { filename: 'a.csv', size: 100 } });
    const r = await call('PUT', `/datasets/upload/${init.data.uploadId}/chunk?index=0`, { raw: Buffer.from('short'), headers: { 'Content-Type': 'application/octet-stream' } });
    expectStatus(r, 400);
  });
  await check('resume: status lists received chunks', async () => {
    const buf = Buffer.alloc(9 * 1024 * 1024, 65);
    const init = await call('POST', '/datasets/upload/init', { body: { filename: 'r.csv', size: buf.length } });
    await call('PUT', `/datasets/upload/${init.data.uploadId}/chunk?index=1`, { raw: buf.subarray(8 * 1024 * 1024), headers: { 'Content-Type': 'application/octet-stream' } });
    const s = await call('GET', `/datasets/upload/${init.data.uploadId}`);
    expect(JSON.stringify(s.data.received) === '[1]', JSON.stringify(s.data));
    const c = await call('POST', `/datasets/upload/${init.data.uploadId}/complete`);
    expectStatus(c, 409);
    await call('DELETE', `/datasets/upload/${init.data.uploadId}`);
  });

  const imported = {};
  for (const [file, opts, expectMin] of [
    ['us_accidents_sample.csv', { defaults: { type: 'Accident' } }, 3],
    ['mixed.xlsx', {}, 3],
    ['london.geojson', {}, 2],
    ['bundle.zip', {}, 5], // two files with different columns → per-file mapping
    ['table.pdf', {}, 3],
    ['points.kml', {}, 1],
    ['track.gpx', {}, 1],
    ['coords.txt', {}, 2],
  ]) {
    await check(`upload + import ${file}`, async () => {
      const up = await upload(file); expectStatus(up, 201);
      const mapping = up.data.preview.suggestedMapping;
      const ds = await importAndWait(up.data.datasetId, { mapping, ...opts, scope: { limit: 100000 } });
      expect(['completed'].includes(ds.status), `${ds.status}: ${ds.statusNote}`);
      expect(ds.progress.imported >= expectMin, `imported ${ds.progress.imported}`);
      imported[file] = ds;
      return `${ds.progress.imported} imported, ${ds.progress.skipped} rejected`;
    });
  }
  await check('re-import same file counts duplicates', async () => {
    const up = await upload('us_accidents_sample.csv');
    const ds = await importAndWait(up.data.datasetId, { mapping: up.data.preview.suggestedMapping, defaults: { type: 'Accident' }, scope: {} });
    expect(ds.progress.duplicates >= 3, `dups ${ds.progress.duplicates}`); imported.dup = ds;
  });
  await check('scope: column filter + every Nth', async () => {
    const up = await upload('scope.csv');
    const ds = await importAndWait(up.data.datasetId, { mapping: up.data.preview.suggestedMapping, scope: { sampling: 'every', everyN: 2, filters: { column: 'State', values: ['CA'] } } });
    expect(ds.progress.imported === 5, `imported ${ds.progress.imported}`); imported.scope = ds;
  });
  await check('scope: random sample limit', async () => {
    const up = await upload('scope.csv');
    const ds = await importAndWait(up.data.datasetId, { mapping: up.data.preview.suggestedMapping, scope: { sampling: 'random', limit: 7 } });
    // rows already imported by the previous test are skipped as duplicates
    expect(ds.progress.imported + ds.progress.duplicates === 7, `imported ${ds.progress.imported} + dup ${ds.progress.duplicates}`); imported.random = ds;
  });
  await check('citizen import capped + Pending', async () => {
    const up = await upload('scope.csv', citizen);
    const ds = await importAndWait(up.data.datasetId, { mapping: up.data.preview.suggestedMapping, scope: { limit: 999999, sampling: 'first' } }, citizen);
    const one = await call('GET', `/incidents?dataset=${ds._id}&limit=1`);
    expect(one.data.items[0].status === 'Pending', 'not pending'); imported.citizen = ds;
  });

  /* ---------------- Robust Excel Tests ---------------- */
  await check('excel: multi-sheet with empty sheet', async () => {
    const up = await upload('excel_multisheet.xlsx');
    expectStatus(up, 201);
    expect(up.data.preview.sources.length === 2, `expected 2 sources, got ${up.data.preview.sources.length}`);
    expect(up.data.preview.warnings.some((w) => w.includes('EmptySheet')), 'warning missing');
    const ds = await importAndWait(up.data.datasetId, { mapping: up.data.preview.suggestedMapping });
    expect(ds.status === 'completed', ds.statusNote);
    expect(ds.progress.imported >= 3, `imported ${ds.progress.imported}`);
    imported.excelMulti = ds;
    return `2 sheets loaded, 1 empty sheet skipped; ${ds.progress.imported} imported`;
  });

  await check('excel: header in row 3', async () => {
    const up = await upload('excel_header_row3.xlsx');
    expectStatus(up, 201);
    expect(up.data.preview.columns.includes('Latitude') && up.data.preview.columns.includes('City'), 'header mismatch');
    const ds = await importAndWait(up.data.datasetId, { mapping: up.data.preview.suggestedMapping });
    expect(ds.status === 'completed', ds.statusNote);
    expect(ds.progress.imported === 2, `imported ${ds.progress.imported}`);
    imported.excelRow3 = ds;
    return 'detected row 3 headers; 2 imported';
  });

  await check('excel: formulas and date serials', async () => {
    const up = await upload('excel_formulas_dates.xlsx');
    expectStatus(up, 201);
    const ds = await importAndWait(up.data.datasetId, { mapping: up.data.preview.suggestedMapping });
    expect(ds.status === 'completed', ds.statusNote);
    expect(ds.progress.imported === 2, `imported ${ds.progress.imported}`);
    imported.excelFormulas = ds;
    return 'formulas evaluated, date serials converted';
  });

  await check('excel: merged cells', async () => {
    const up = await upload('excel_merged.xlsx');
    expectStatus(up, 201);
    const ds = await importAndWait(up.data.datasetId, { mapping: up.data.preview.suggestedMapping });
    expect(ds.status === 'completed', ds.statusNote);
    expect(ds.progress.imported === 2, `imported ${ds.progress.imported}`);
    imported.excelMerged = ds;
    return 'merged cells resolved to master values';
  });

  await check('excel: corrupt file rejected cleanly', async () => {
    const up = await upload('corrupt.xlsx');
    expectStatus(up, 400);
    expect(/corrupt|damaged|excel/i.test(up.data.message || up.data.error), up.data.message);
    return 'corrupt .xlsx returned 400';
  });

  await check('excel: 60 MB streaming reader path', async () => {
    const crypto = require('crypto');
    const ExcelJS = require('exceljs');
    const { readExcel } = require('../src/services/datasets/excel');
    const p = path.join(FIX, 'test_60mb.xlsx');
    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: p, useStyles: false, useSharedStrings: false });
      const sheet = workbook.addWorksheet('StreamSheet');
      sheet.addRow(['Latitude', 'Longitude', 'Date', 'Type', 'Severity', 'City', 'Data']);
      const pool = [];
      for (let i = 0; i < 1000; i++) pool.push(crypto.randomBytes(1000).toString('hex'));
      for (let i = 0; i < 55000; i++) {
        sheet.addRow([12.30, 76.65, '2024-05-01', 'Accident', 'High', 'Mysuru', pool[i % pool.length]]).commit();
      }
      sheet.commit();
      await workbook.commit();
      const st = fs.statSync(p);
      expect(st.size > 50 * 1024 * 1024, `size was ${(st.size / 1024 / 1024).toFixed(1)} MB`);
      const res = await readExcel(p);
      expect(res.sheets.length === 1, 'sheets length');
      expect(res.sheets[0].rows.length === 55000, `rows count ${res.sheets[0].rows.length}`);
      return `exercised streaming path on ${(st.size / 1024 / 1024).toFixed(1)} MB file (55,000 rows)`;
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });
  await check('dataset filter on analytics', async () => { const id = imported['bundle.zip']?._id; const r = await call('GET', `/analytics/summary?dataset=${id}`); expect(r.data.total === imported['bundle.zip'].progress.imported, `total ${r.data.total}`); });
  await check('rejected rows CSV', async () => { const r = await call('GET', `/datasets/${imported['us_accidents_sample.csv']._id}/rejected.csv`); expectStatus(r, 200); expect(r.data.split('\n').length >= 3, 'no rows'); });
  await check('citizen cannot delete dataset → 403', async () => expectStatus(await call('DELETE', `/datasets/${imported.scope._id}`, { auth: citizen }), 403));
  await check('delete datasets (batched)', async () => {
    for (const ds of Object.values(imported).filter(Boolean)) expectStatus(await call('DELETE', `/datasets/${ds._id}`), 202);
    for (let i = 0; i < 40; i++) { await sleep(300); const r = await call('GET', '/datasets'); if (!r.data.length) break; }
    const left = await call('GET', '/incidents?dataset=' + imported['us_accidents_sample.csv']._id);
    expect(left.data.total === 0, `left ${left.data.total}`);
  });

  /* ---------------- ML ---------------- */
  const st = await call('GET', '/ml/status');
  if (!st.data.online) {
    results.push({ test: 'ML service', result: 'SKIP', ms: 0, note: 'ML service offline: start it to test AI endpoints' });
  } else {
    await check('ML: DBSCAN clusters (Mysuru)', async () => { const r = await call('POST', '/ml/clusters', { body: { eps_m: 250, min_samples: 15, filters: { bbox: '76.5,12.2,76.8,12.4' } } }); expectStatus(r, 200); expect(r.data.n_clusters > 0, 'no clusters'); return `${r.data.n_clusters} clusters, silhouette ${r.data.silhouette}`; });
    await check('ML: empty filter → 400', async () => expectStatus(await call('POST', '/ml/clusters', { body: { filters: { from: '2001-01-01', to: '2001-01-02' } } }), 400));
    await check('ML: citizen cannot train → 403', async () => expectStatus(await call('POST', '/ml/severity/train', { body: {}, auth: citizen }), 403));
    await check('ML: train Random Forest', async () => { const r = await call('POST', '/ml/severity/train', { body: { max_rows: 30000, n_estimators: 120 } }); expectStatus(r, 201); const m = r.data.metrics; expect(m.accuracy > m.baseline_accuracy, `acc ${m.accuracy} <= baseline ${m.baseline_accuracy}`); return `acc ${m.accuracy} vs baseline ${m.baseline_accuracy}, macro-F1 ${m.macro_f1}`; });
    await check('ML: predict', async () => { const r = await call('POST', '/ml/severity/predict', { body: { lng: 76.6552, lat: 12.3052, type: 'Accident', datetime: new Date().toISOString() } }); expectStatus(r, 200); expect(r.data.severity && r.data.local.tz === 'Asia/Kolkata', JSON.stringify(r.data)); return `${r.data.severity} (${Math.round(r.data.confidence * 100)}%)`; });
    await check('ML: predict bad type → 400', async () => expectStatus(await call('POST', '/ml/severity/predict', { body: { lng: 1, lat: 1, type: 'Meteor' } }), 400));
    await check('ML: forecast', async () => { const r = await call('POST', '/ml/forecast', { body: { horizon: 14 } }); expectStatus(r, 200); expect(r.data.forecast.length === 14, 'len'); return `${r.data.method}; backtest MAE ${r.data.backtest?.mae} vs naive ${r.data.backtest?.naive_mae}`; });
    await check('ML: model card', async () => { const r = await call('GET', '/ml/severity/model'); expectStatus(r, 200); expect(r.data.latest, 'no model'); });
  }
  await check('unknown route → 404 JSON', async () => { const r = await call('GET', '/nope'); expectStatus(r, 404); expect(r.data.message, 'no message'); });

  console.table(results);
  const failed = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
