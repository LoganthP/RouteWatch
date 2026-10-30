/** Regenerates the small test files used by `npm run test:api`. */
const fs = require('fs'); const path = require('path'); const ExcelJS = require('exceljs'); const PDF = require('pdfkit');
const D = __dirname;
const us = [['ID','Severity','Start_Time','Start_Lat','Start_Lng','Description','Street','City','County','State','Timezone'],
  ['A-1','3','2016-02-08 05:46:00','39.865147','-84.058723','Right lane blocked due to accident on I-70','I-70 E','Dayton','Montgomery','OH','US/Eastern'],
  ['A-2','2','2016-02-08 06:07:59','39.928059','-82.831184','Accident on Brice Rd','Brice Rd','Reynoldsburg','Franklin','OH','US/Eastern'],
  ['A-3','2','2016-02-08 06:49:27','39.063148','-84.032608','Accident on OH-32','State Route 32','Williamsburg','Clermont','OH','US/Eastern'],
  ['A-4','4','2016-02-08 07:23:34','39.747753','-84.205582','Fatal crash on I-75','I-75 S','Dayton','Montgomery','OH','US/Eastern'],
  ['A-5','3','not a date','39.627781','-84.188354','bad date row','Miamisburg Centerville Rd','Dayton','Montgomery','OH','US/Eastern'],
  ['A-6','2','2016-02-08 08:10:04','abc','','bad coordinates row','Main St','Nowhere','X','OH','US/Eastern']];
fs.writeFileSync(path.join(D, 'us_accidents_sample.csv'), us.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n'));
const scope = [['lat','lng','date','type','severity','State']];
for (let i = 0; i < 20; i++) scope.push([34 + i * 0.01, -118 - i * 0.01, `2024-0${1 + (i % 9)}-1${i % 9} 10:00`, i % 2 ? 'crash' : 'jam', 1 + (i % 4), i < 10 ? 'CA' : 'TX']);
fs.writeFileSync(path.join(D, 'scope.csv'), scope.map((r) => r.join(',')).join('\n'));
fs.writeFileSync(path.join(D, 'london.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-0.1278, 51.5074] }, properties: { type: 'Collision', severity: 'Serious', date: '2024-05-02 08:15' } },
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-0.1, 51.5], [-0.12, 51.52]] }, properties: { type: 'Roadworks', severity: 'Slight', date: '2024-05-03 17:40' } }] }));
fs.writeFileSync(path.join(D, 'points.kml'), '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Flooded underpass</name><TimeStamp><when>2024-07-10T14:00:00Z</when></TimeStamp><Point><coordinates>72.8777,19.0760,0</coordinates></Point></Placemark></Document></kml>');
fs.writeFileSync(path.join(D, 'track.gpx'), '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="-33.8688" lon="151.2093"><name>Pothole on George St</name><time>2024-08-01T01:00:00Z</time></wpt></gpx>');
fs.writeFileSync(path.join(D, 'coords.txt'), 'Crash near KR Circle at 12.3052, 76.6552 this morning\nnoise line without coordinates\nPothole reported 12.3101,76.6402\n');
// unique rows for the zip bundle (different places from the other fixtures)
fs.writeFileSync(path.join(D, 'bundle_part1.csv'), ['latitude,longitude,time,category,severity,city',
  '48.8566,2.3522,2024-04-01 08:30,Accident,3,Paris', '48.8606,2.3376,2024-04-02 18:05,Traffic jam,1,Paris', '48.8738,2.2950,2024-04-03 09:45,Pothole,2,Paris'].join('\n'));
fs.writeFileSync(path.join(D, 'bundle_part2.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [13.405, 52.52] }, properties: { kind: 'Unfall', priority: 'high', when: '2024-04-04T07:00:00Z' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [13.3777, 52.5163] }, properties: { kind: 'Baustelle', priority: 'low', when: '2024-04-05T12:00:00Z' } }] }));
fs.writeFileSync(path.join(D, 'fake.csv'), Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]));
(async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Incidents');
  ws.addRow(['Latitude', 'Longitude', 'Date', 'Category', 'Priority', 'City']);
  ws.addRow([12.9716, 77.5946, new Date(Date.UTC(2024, 0, 5, 18, 30)), 'Accident', 'High', 'Bengaluru']);
  ws.addRow([28.6139, 77.209, new Date(Date.UTC(2024, 1, 6, 9, 0)), 'Traffic jam', 'Low', 'Delhi']);
  ws.addRow([19.076, 72.8777, 45500, 'Pothole', 'Medium', 'Mumbai']);
  await wb.xlsx.writeFile(path.join(D, 'mixed.xlsx'));

  // 1. Multi-sheet with one empty sheet
  const wbMulti = new ExcelJS.Workbook();
  const ws1 = wbMulti.addWorksheet('FirstSheet');
  ws1.addRow(['Latitude', 'Longitude', 'Date', 'Type', 'Severity', 'City']);
  ws1.addRow([12.97, 77.59, '2024-03-01T10:00:00.000Z', 'Accident', 'High', 'Bengaluru']);
  ws1.addRow([12.98, 77.60, '2024-03-02T11:00:00.000Z', 'Hazard', 'Low', 'Bengaluru']);
  wbMulti.addWorksheet('EmptySheet'); // no rows
  const ws2 = wbMulti.addWorksheet('SecondSheet');
  ws2.addRow(['Latitude', 'Longitude', 'Date', 'Type', 'Severity', 'City']);
  ws2.addRow([13.00, 77.62, '2024-03-03T12:00:00.000Z', 'Congestion', 'Medium', 'Bengaluru']);
  await wbMulti.xlsx.writeFile(path.join(D, 'excel_multisheet.xlsx'));

  // 2. Header in row 3
  const wbRow3 = new ExcelJS.Workbook();
  const wsRow3 = wbRow3.addWorksheet('Data');
  wsRow3.addRow(['RouteWatch Incident Report Header', null, null]);
  wsRow3.addRow(['Generated: 2024-03-01', null, null]);
  wsRow3.addRow(['Latitude', 'Longitude', 'Date', 'Type', 'Severity', 'City']);
  wsRow3.addRow([12.3052, 76.6552, '2024-03-04T09:00:00.000Z', 'Accident', 'Critical', 'Mysuru']);
  wsRow3.addRow([12.3100, 76.6600, '2024-03-05T10:00:00.000Z', 'Hazard', 'Medium', 'Mysuru']);
  await wbRow3.xlsx.writeFile(path.join(D, 'excel_header_row3.xlsx'));

  // 3. Date serials and formulas
  const wbFormulas = new ExcelJS.Workbook();
  const wsFormulas = wbFormulas.addWorksheet('FormulasAndSerials');
  wsFormulas.addRow(['Latitude', 'Longitude', 'Date', 'Type', 'Severity', 'City']);
  wsFormulas.addRow([12.32, 76.64, 45350, { formula: 'CONCAT("Acc","ident")', result: 'Accident' }, 'High', 'Mysuru']);
  wsFormulas.addRow([12.33, 76.65, 45351, 'Hazard', { formula: 'UPPER("low")', result: 'Low' }, 'Mysuru']);
  await wbFormulas.xlsx.writeFile(path.join(D, 'excel_formulas_dates.xlsx'));

  // 4. Merged cells
  const wbMerged = new ExcelJS.Workbook();
  const wsMerged = wbMerged.addWorksheet('Merged');
  wsMerged.addRow(['Latitude', 'Longitude', 'Date', 'Type', 'Severity', 'City']);
  wsMerged.addRow([12.34, 76.66, '2024-03-06T08:00:00.000Z', 'Accident', 'High', 'Mysuru']);
  wsMerged.addRow([12.35, 76.67, '2024-03-07T09:00:00.000Z', 'Congestion', 'Low', 'Mysuru']);
  wsMerged.mergeCells('F2:F3'); // Merge City column for both rows
  await wbMerged.xlsx.writeFile(path.join(D, 'excel_merged.xlsx'));

  // 5. Corrupt file
  fs.writeFileSync(path.join(D, 'corrupt.xlsx'), Buffer.from('PK\x03\x04corrupted-excel-content-garbage-bytes-1234567890'));

  await new Promise((res) => { const d = new PDF(); const out = fs.createWriteStream(path.join(D, 'table.pdf')); d.pipe(out); d.fontSize(10).text('Incident report table'); d.text('Latitude, Longitude, Date, Type, Severity');
    [['12.3052','76.6552','2024-03-01 09:10','Accident','High'],['12.3008','76.6575','2024-03-02 18:20','Congestion','Low'],['12.3355','76.6655','2024-03-03 08:05','Hazard','Medium']].forEach((r) => d.text(r.join(', '))); d.end(); out.on('finish', res); });
  console.log('fixtures written (bundle.zip and evil.zip ship pre-built)');
})();
