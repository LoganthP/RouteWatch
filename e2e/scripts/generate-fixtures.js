const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { execSync } = require('child_process');

const fixturesDir = path.join(__dirname, '../fixtures');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

// 1. CSV with lat/lng
const validCsv = `Start_Lat,Start_Lng,Start_Time,Severity,Description,City,State
12.3052,76.6552,2024-03-01 08:30:00,3,Accident near City Center,Mysuru,KA
12.3110,76.6600,2024-03-01 09:15:00,2,Slow moving traffic,Mysuru,KA
12.2980,76.6450,2024-03-01 10:00:00,4,Multi-vehicle collision,Mysuru,KA
12.3150,76.6700,2024-03-01 11:20:00,1,Minor stall,Mysuru,KA
12.3020,76.6500,2024-03-01 12:45:00,3,Pothole hazard,Mysuru,KA
`;
fs.writeFileSync(path.join(fixturesDir, 'valid_coords.csv'), validCsv);

// 2. CSV with only addresses (no coordinates)
const addressCsv = `Street,City,State,Description,Severity,Reported_Time
Sayyaji Rao Road,Mysuru,KA,Road repair on Sayyaji Rao,2,2024-03-02 14:00:00
Ashoka Road,Mysuru,KA,Heavy congestion on Ashoka,3,2024-03-02 15:30:00
`;
fs.writeFileSync(path.join(fixturesDir, 'addresses_only.csv'), addressCsv);

// 3. XLSX
const wb = XLSX.utils.book_new();
const wsData = [
  ['Start_Lat', 'Start_Lng', 'Start_Time', 'Severity', 'Description', 'City'],
  [12.307, 76.658, '2024-03-03 10:00:00', 'Medium', 'Signal failure', 'Mysuru'],
  [12.312, 76.662, '2024-03-03 11:30:00', 'High', 'Water logging', 'Mysuru'],
];
const ws = XLSX.utils.aoa_to_sheet(wsData);
XLSX.utils.book_append_sheet(wb, ws, 'Incidents');
XLSX.writeFile(wb, path.join(fixturesDir, 'dataset.xlsx'));

// 4. GeoJSON
const geojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [76.6552, 12.3052] },
      properties: {
        type: 'Accident',
        severity: 'Critical',
        description: 'GeoJSON accident point',
        reportedAt: '2024-03-04T10:00:00Z',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [76.6600, 12.3110] },
      properties: {
        type: 'Hazard',
        severity: 'Medium',
        description: 'GeoJSON hazard point',
        reportedAt: '2024-03-04T12:00:00Z',
      },
    },
  ],
};
fs.writeFileSync(path.join(fixturesDir, 'features.geojson'), JSON.stringify(geojson, null, 2));

// 5. KML
const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>KML Incident 1</name>
      <description>Accident on main junction</description>
      <Point>
        <coordinates>76.6552,12.3052,0</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>KML Incident 2</name>
      <description>Road barrier broken</description>
      <Point>
        <coordinates>76.6600,12.3110,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
fs.writeFileSync(path.join(fixturesDir, 'places.kml'), kml);

// 6. ZIP of two CSVs
// Create two temp CSVs and zip them via powershell
const tempZipCsv1 = path.join(fixturesDir, 'batch1.csv');
const tempZipCsv2 = path.join(fixturesDir, 'batch2.csv');
fs.writeFileSync(tempZipCsv1, `Start_Lat,Start_Lng,Start_Time,Severity,Description\n12.305,76.655,2024-03-05 08:00:00,2,Batch 1 Incident\n`);
fs.writeFileSync(tempZipCsv2, `Start_Lat,Start_Lng,Start_Time,Severity,Description\n12.310,76.665,2024-03-05 09:00:00,3,Batch 2 Incident\n`);
const zipPath = path.join(fixturesDir, 'archive_multi.zip');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
try {
  execSync(`powershell -Command "Compress-Archive -Path '${tempZipCsv1}','${tempZipCsv2}' -DestinationPath '${zipPath}' -Force"`);
  fs.unlinkSync(tempZipCsv1);
  fs.unlinkSync(tempZipCsv2);
} catch (e) {
  console.error('Zip creation error:', e);
}

// 7. Minimal Text PDF with coordinates
const pdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 135 >> stream
BT
/F1 12 Tf
72 712 Td
(RouteWatch Coordinates Document) Tj
0 -20 Td
(Incident location: 12.3052 N, 76.6552 E - Reported 2024-03-06) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000430 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
509
%%EOF`;
fs.writeFileSync(path.join(fixturesDir, 'coordinates.pdf'), pdfContent);

// 8. Empty file
fs.writeFileSync(path.join(fixturesDir, 'empty.csv'), '');

// 9. Malformed CSV
const malformedCsv = `Start_Lat,Start_Lng,Description
12.3052,76.6552,"Unclosed string quote on line 2
12.3100,corrupted_number,Normal text
12.3150
`;
fs.writeFileSync(path.join(fixturesDir, 'malformed.csv'), malformedCsv);

// 10. Unsupported .exe renamed to .csv
const exeHeader = Buffer.from('4D5A90000300000004000000FFFF0000B8000000000000004000000000000000', 'hex');
fs.writeFileSync(path.join(fixturesDir, 'unsupported_binary.csv'), exeHeader);

// 11. Oversized CSV
// We create a mock oversized CSV (or larger CSV test)
const header = 'Start_Lat,Start_Lng,Start_Time,Severity,Description,City,State\n';
let rows = '';
for (let i = 0; i < 5000; i++) {
  rows += `12.${3000 + (i % 100)},76.${6500 + (i % 100)},2024-03-01 08:00:00,${(i % 4) + 1},Oversized row test ${i},Mysuru,KA\n`;
}
fs.writeFileSync(path.join(fixturesDir, 'oversized.csv'), header + rows);

console.log('Successfully generated all fixtures in e2e/fixtures:');
fs.readdirSync(fixturesDir).forEach((f) => console.log(' - ' + f));
