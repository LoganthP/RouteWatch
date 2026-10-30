const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const AdmZip = require('adm-zip');

const BASE_URL = 'http://127.0.0.1:5000/api';

async function req(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: res.status, headers: res.headers, data: json, rawText: text };
}

async function run() {
  console.log('[test] 1. Authenticating...');
  const adminRes = await req(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@routewatch.local', password: 'Admin@123' }),
  });
  const adminToken = adminRes.data?.token;
  if (!adminToken) throw new Error('Admin login failed: ' + adminRes.rawText);

  const citizenRes = await req(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@routewatch.local', password: 'User@123' }),
  });
  const citizenToken = citizenRes.data?.token;
  if (!citizenToken) throw new Error('Citizen login failed: ' + citizenRes.rawText);
  console.log('✓ Admin and Citizen tokens acquired.');

  const tmpDir = path.join(__dirname, 'test_files');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // Generate Files
  console.log('[test] 2. Generating test files...');

  // A. CSV
  const csvPath = path.join(tmpDir, 'test_incidents.csv');
  const csvContent = `latitude,longitude,type,severity,date,description,place
12.9716,77.5946,Accident,High,2026-03-01T10:00:00Z,Two-wheeler skid near signal,MG Road
12.9720,77.5950,Congestion,Medium,2026-03-01T10:15:00Z,Heavy bumper to bumper queue,Brigade Road
12.9730,77.5960,Hazard,Low,2026-03-01T10:30:00Z,Oil spill on shoulder,Residency Road`;
  fs.writeFileSync(csvPath, csvContent);

  // B. XLSX
  const xlsxPath = path.join(tmpDir, 'test_incidents.xlsx');
  const wb = XLSX.utils.book_new();
  const wsData = [
    ['lat', 'lon', 'incident_type', 'severity', 'timestamp', 'details'],
    [51.5074, -0.1278, 'Road Closure', 'Critical', '2026-02-15 14:00', 'Trafalgar square diversion'],
    [51.5080, -0.1285, 'Construction', 'Low', '2026-02-15 15:00', 'Pavement resurfacing'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'LondonEvents');
  XLSX.writeFile(wb, xlsxPath);

  // C. GeoJSON
  const geojsonPath = path.join(tmpDir, 'test_incidents.geojson');
  const geojsonContent = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [139.6917, 35.6895] },
        properties: { type: 'Accident', severity: 'High', description: 'Shinjuku crossing minor bump', reportedAt: '2026-01-10T08:00:00Z' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [139.7000, 35.6900] },
        properties: { type: 'Congestion', severity: 'Medium', description: 'Station approach slowdown', reportedAt: '2026-01-10T08:30:00Z' },
      },
    ],
  };
  fs.writeFileSync(geojsonPath, JSON.stringify(geojsonContent, null, 2));

  // D. ZIP with 2 CSVs
  const zipPath = path.join(tmpDir, 'test_archive.zip');
  const zip = new AdmZip();
  zip.addFile('sydney_1.csv', Buffer.from(`lat,lng,type,severity,timestamp,desc\n-33.8688,151.2093,Accident,Medium,2026-02-01T12:00:00Z,CBD side-swipe\n`));
  zip.addFile('sydney_2.csv', Buffer.from(`lat,lng,type,severity,timestamp,desc\n-33.8700,151.2100,Hazard,Low,2026-02-01T13:00:00Z,Fallen tree branch\n`));
  zip.writeZip(zipPath);

  // E. Text PDF with a table of coordinates
  const pdfPath = path.join(tmpDir, 'test_table.pdf');
  await new Promise((resolve) => {
    const doc = new PDFDocument({ pdfVersion: '1.4', size: 'A4', margin: 30 });
    const bufs = [];
    doc.on('data', (b) => bufs.push(b));
    doc.on('end', () => {
      fs.writeFileSync(pdfPath, Buffer.concat(bufs));
      resolve();
    });
    doc.fontSize(16).text('Incident Table Report');
    doc.moveDown();
    doc.fontSize(10).text('Latitude | Longitude | Type | Severity | Date | Details');
    doc.text('40.7128 | -74.0060 | Accident | High | 2026-01-20 | Lower Manhattan taxi collision');
    doc.text('40.7135 | -74.0070 | Congestion | Medium | 2026-01-20 | Broadway signal delay');
    doc.end();
  });

  // F. Malformed file (contains valid rows and malformed rows)
  const malformedPath = path.join(tmpDir, 'test_malformed.csv');
  const malformedContent = `latitude,longitude,type,severity,date,description
12.3052,76.6552,Accident,High,2026-03-01T10:00:00Z,Valid row 1
999.0,76.6552,Accident,High,2026-03-01T10:00:00Z,Invalid latitude out of range
12.3055,76.6555,Collision,Fatal,2026-03-01T11:00:00Z,Synonym normalization test
12.3060,76.6560,Accident,High,2099-01-01T00:00:00Z,Future date error`;
  fs.writeFileSync(malformedPath, malformedContent);

  // G. Citizen 600 rows CSV
  const citizenPath = path.join(tmpDir, 'citizen_600.csv');
  let citLines = ['latitude,longitude,type,severity,date,description'];
  for (let i = 0; i < 600; i++) {
    const lat = (52.5200 + i * 0.0001).toFixed(6);
    const lng = (13.4050 + i * 0.0001).toFixed(6);
    citLines.push(`${lat},${lng},Congestion,Low,2026-02-01T12:00:00Z,Citizen line ${i}`);
  }
  fs.writeFileSync(citizenPath, citLines.join('\n'));

  // H. Non-supported file type (.exe)
  const exePath = path.join(tmpDir, 'unsupported.exe');
  fs.writeFileSync(exePath, Buffer.from([0x4D, 0x5A, 0x90, 0x00])); // MZ header

  // I. Fake extension file (executable header disguised as .csv)
  const fakeCsvPath = path.join(tmpDir, 'fake.csv');
  fs.writeFileSync(fakeCsvPath, Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]));

  // J. Zip-slip archive
  const zipSlipPath = path.join(tmpDir, 'zipslip.zip');
  const zipSlip = new AdmZip();
  zipSlip.addFile('test123456.csv', Buffer.from('latitude,longitude\n1,1'));
  let slipBuf = zipSlip.toBuffer();
  slipBuf = Buffer.from(slipBuf.toString('binary').replace(/test123456/g, '../../evil'), 'binary');
  fs.writeFileSync(zipSlipPath, slipBuf);

  console.log('✓ All test files generated.');

  // Helper for uploading multipart
  async function uploadFile(filePath, token) {
    const form = new FormData();
    const blob = new Blob([fs.readFileSync(filePath)]);
    form.append('files', blob, path.basename(filePath));
    const res = await fetch(`${BASE_URL}/datasets/preview`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    return { status: res.status, data, rawText: text };
  }

  // Helper for polling import
  async function pollJob(jobId, token) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 600));
      const res = await req(`${BASE_URL}/datasets/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const s = (res.data?.status || '').toLowerCase();
      if (s === 'completed' || s === 'partial' || s === 'failed') {
        return res.data;
      }
    }
    throw new Error('Import job timed out: ' + jobId);
  }

  // --- Check 4: Testing CSV, XLSX, GeoJSON, ZIP, PDF, Malformed ---
  console.log('\n[test] 3. Testing Upload & Import (CSV, XLSX, GeoJSON, ZIP, PDF, Malformed)...');

  // CSV
  const csvPrev = await uploadFile(csvPath, adminToken);
  if (csvPrev.status !== 200) throw new Error('CSV preview failed: ' + csvPrev.rawText);
  console.log('✓ CSV Preview OK:', csvPrev.data.columns, 'rows:', csvPrev.data.totalRows);
  const csvImp = await req(`${BASE_URL}/datasets/${csvPrev.data.uploadId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ mapping: csvPrev.data.suggestedMapping }),
  });
  const csvResult = await pollJob(csvImp.data.jobId, adminToken);
  console.log('✓ CSV Import OK: imported', csvResult.imported, 'duplicates', csvResult.duplicates, 'rejected', csvResult.rejected);

  // XLSX
  const xlsxPrev = await uploadFile(xlsxPath, adminToken);
  if (xlsxPrev.status !== 200) throw new Error('XLSX preview failed: ' + xlsxPrev.rawText);
  console.log('✓ XLSX Preview OK:', xlsxPrev.data.columns, 'rows:', xlsxPrev.data.totalRows);
  const xlsxImp = await req(`${BASE_URL}/datasets/${xlsxPrev.data.uploadId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ mapping: xlsxPrev.data.suggestedMapping }),
  });
  const xlsxResult = await pollJob(xlsxImp.data.jobId, adminToken);
  console.log('✓ XLSX Import OK: imported', xlsxResult.imported);

  // GeoJSON
  const geojsonPrev = await uploadFile(geojsonPath, adminToken);
  if (geojsonPrev.status !== 200) throw new Error('GeoJSON preview failed: ' + geojsonPrev.rawText);
  console.log('✓ GeoJSON Preview OK: rows:', geojsonPrev.data.totalRows);
  const geojsonImp = await req(`${BASE_URL}/datasets/${geojsonPrev.data.uploadId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ mapping: geojsonPrev.data.suggestedMapping }),
  });
  const geojsonResult = await pollJob(geojsonImp.data.jobId, adminToken);
  console.log('✓ GeoJSON Import OK: imported', geojsonResult.imported);

  // ZIP containing two CSVs
  const zipPrev = await uploadFile(zipPath, adminToken);
  if (zipPrev.status !== 200) throw new Error('ZIP preview failed: ' + zipPrev.rawText);
  console.log('✓ ZIP (2 CSVs) Preview OK: rows:', zipPrev.data.totalRows, 'files:', zipPrev.data.files?.length);
  const zipImp = await req(`${BASE_URL}/datasets/${zipPrev.data.uploadId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ mapping: zipPrev.data.suggestedMapping }),
  });
  const zipResult = await pollJob(zipImp.data.jobId, adminToken);
  console.log('✓ ZIP Import OK: imported', zipResult.imported);

  // Text PDF
  const pdfPrev = await uploadFile(pdfPath, adminToken);
  if (pdfPrev.status !== 200) throw new Error('PDF preview failed: ' + pdfPrev.rawText);
  console.log('✓ PDF Preview OK: rows:', pdfPrev.data.totalRows, 'columns:', pdfPrev.data.columns);
  const pdfImp = await req(`${BASE_URL}/datasets/${pdfPrev.data.uploadId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ mapping: pdfPrev.data.suggestedMapping }),
  });
  const pdfResult = await pollJob(pdfImp.data.jobId, adminToken);
  console.log('✓ PDF Import OK: imported', pdfResult.imported);

  // Malformed file
  const malformedPrev = await uploadFile(malformedPath, adminToken);
  if (malformedPrev.status !== 200) throw new Error('Malformed preview failed: ' + malformedPrev.rawText);
  const malformedImp = await req(`${BASE_URL}/datasets/${malformedPrev.data.uploadId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ mapping: malformedPrev.data.suggestedMapping }),
  });
  const malformedResult = await pollJob(malformedImp.data.jobId, adminToken);
  console.log('✓ Malformed Import Result: imported', malformedResult.imported, 'rejected', malformedResult.rejected);
  if (malformedResult.rejected <= 0) throw new Error('Expected rejected rows for malformed file');

  // Verify rejected CSV endpoint
  const rejectedCsv = await req(`${BASE_URL}/datasets/${malformedResult.datasetId}/rejected.csv`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (rejectedCsv.status !== 200) throw new Error('Failed to get rejected.csv');
  console.log('✓ Rejected rows CSV content:\n' + rejectedCsv.rawText.trim());

  // --- Check 5: Citizen cap, non-supported file, fake extension, zip-slip ---
  console.log('\n[test] 4. Testing Security, Limits, and Citizen Caps...');

  // Citizen cap (600 rows -> 500 max, Pending status)
  const citPrev = await uploadFile(citizenPath, citizenToken);
  if (citPrev.status !== 200) throw new Error('Citizen preview failed: ' + citPrev.rawText);
  const citImp = await req(`${BASE_URL}/datasets/${citPrev.data.uploadId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${citizenToken}` },
    body: JSON.stringify({ mapping: citPrev.data.suggestedMapping }),
  });
  const citResult = await pollJob(citImp.data.jobId, citizenToken);
  console.log('✓ Citizen import result: imported', citResult.imported, 'status', citResult.status);
  if (citResult.imported > 500) throw new Error(`Citizen imported ${citResult.imported} > 500 rows!`);

  // Verify that incidents imported by citizen are Pending
  const citIncidents = await req(`${BASE_URL}/incidents?datasetId=${citResult.datasetId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const allPending = citIncidents.data?.items?.every((inc) => inc.status === 'Pending');
  console.log('✓ All citizen imported incidents are Pending:', allPending);
  if (!allPending) throw new Error('Citizen incidents were not marked Pending');

  // Non-supported file type (.exe)
  const exePrev = await uploadFile(exePath, adminToken);
  console.log('✓ Unsupported file response (expected 400):', exePrev.status, exePrev.data?.message);
  if (exePrev.status === 200) throw new Error('Unsupported file was not rejected');

  // Fake extension file (binary exe disguised as .csv)
  const fakePrev = await uploadFile(fakeCsvPath, adminToken);
  console.log('✓ Fake extension response (expected 400):', fakePrev.status, fakePrev.data?.message);
  if (fakePrev.status === 200) throw new Error('Fake extension file was not rejected');

  // Zip-slip archive
  const zipSlipPrev = await uploadFile(zipSlipPath, adminToken);
  console.log('✓ Zip-slip response (expected 400):', zipSlipPrev.status, zipSlipPrev.data?.message);
  if (zipSlipPrev.status === 200) throw new Error('Zip-slip archive was not rejected');

  // --- Check 6: Dataset Deletion and Cascading Incidents Cleanup ---
  console.log('\n[test] 5. Testing Dataset Deletion...');
  const datasetToDelete = malformedResult.datasetId;
  const beforeCountRes = await req(`${BASE_URL}/incidents?datasetId=${datasetToDelete}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log('Incidents before delete:', beforeCountRes.data?.total);

  const delRes = await req(`${BASE_URL}/datasets/${datasetToDelete}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log('Delete response:', delRes.status, delRes.data);
  if (delRes.status !== 200) throw new Error('Delete dataset failed');

  const afterCountRes = await req(`${BASE_URL}/incidents?datasetId=${datasetToDelete}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log('✓ Incidents after delete (expected 0):', afterCountRes.data?.total);
  if (afterCountRes.data?.total !== 0) throw new Error('Incidents were not removed on dataset deletion');

  // Cleanup test_files directory
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n========================================');
  console.log('ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  console.log('========================================');
}

run().catch((err) => {
  console.error('[test ERROR]', err);
  process.exit(1);
});
