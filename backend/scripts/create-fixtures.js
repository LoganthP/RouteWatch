const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

async function createFixtures() {
  const dir = path.join(__dirname, '..', 'test', 'fixtures');
  fs.mkdirSync(dir, { recursive: true });

  // 1. 0-byte file
  fs.writeFileSync(path.join(dir, 'empty.csv'), '');

  // 2. .exe file
  fs.writeFileSync(path.join(dir, 'bad.exe'), Buffer.from('MZ\x90\x00\x03\x00\x00\x00'));

  // 3. corrupt zip
  fs.writeFileSync(path.join(dir, 'corrupt.zip'), Buffer.from('PK\x03\x04corrupted_zip_data_that_fails_unzipping'));

  // 4. CSV with no coordinates
  fs.writeFileSync(
    path.join(dir, 'no_coords.csv'),
    'id,title,description,date\n1,Event A,Some description,2024-01-01\n2,Event B,Another description,2024-01-02\n'
  );

  // 5. CSV with BOM and semicolons
  const bom = '\uFEFF';
  fs.writeFileSync(
    path.join(dir, 'semicolon_bom.csv'),
    bom + 'id;latitude;longitude;date;severity\n1;51.5074;-0.1278;2024-01-01;High\n2;51.5100;-0.1300;2024-01-02;Low\n'
  );

  // 6. sample.xlsx
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Incidents');
  ws.columns = [
    { header: 'id', key: 'id' },
    { header: 'latitude', key: 'lat' },
    { header: 'longitude', key: 'lon' },
    { header: 'severity', key: 'sev' },
    { header: 'date', key: 'date' },
  ];
  ws.addRow({ id: 1, lat: 51.5074, lon: -0.1278, sev: 'High', date: '2024-01-01' });
  ws.addRow({ id: 2, lat: 51.512, lon: -0.131, sev: 'Low', date: '2024-01-02' });
  await wb.xlsx.writeFile(path.join(dir, 'sample.xlsx'));

  // 7. sample.geojson
  fs.writeFileSync(
    path.join(dir, 'sample.geojson'),
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 1, type: 'Accident', severity: 'High' }, geometry: { type: 'Point', coordinates: [-0.12, 51.5] } },
        { type: 'Feature', properties: { id: 2, type: 'Congestion', severity: 'Low' }, geometry: { type: 'Point', coordinates: [-0.14, 51.52] } },
      ],
    })
  );

  // 8. sample.kml
  fs.writeFileSync(
    path.join(dir, 'sample.kml'),
    '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Incident 1</name><Point><coordinates>-0.12,51.5,0</coordinates></Point></Placemark></Document></kml>'
  );

  // 9. sample.gpx
  fs.writeFileSync(
    path.join(dir, 'sample.gpx'),
    '<?xml version="1.0"?><gpx version="1.1"><wpt lat="51.5" lon="-0.12"><name>Incident 1</name></wpt></gpx>'
  );

  // 10. sample.ndjson
  fs.writeFileSync(
    path.join(dir, 'sample.ndjson'),
    '{"id":1,"latitude":51.5,"longitude":-0.12,"severity":"High","date":"2024-01-01"}\n{"id":2,"latitude":51.52,"longitude":-0.14,"severity":"Low","date":"2024-01-02"}\n'
  );

  // 11. invalid.json
  fs.writeFileSync(path.join(dir, 'invalid.json'), '{"unclosed": true, broken: [');

  console.log('[create-fixtures] All 11 fixtures created successfully in test/fixtures');
}

createFixtures().catch(console.error);
