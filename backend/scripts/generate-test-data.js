const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const OUT_DIR = path.join(__dirname, '../uploads_temp/test_data');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const HEADER = 'ID,Severity,Start_Time,End_Time,Start_Lat,Start_Lng,End_Lat,End_Lng,Description,Street,City,County,State,Zipcode,Country,Timezone,Traffic_Signal,Junction,Crossing\n';

async function generateCsv(filename, targetBytes) {
  const filePath = path.join(OUT_DIR, filename);
  console.log(`[gen] Generating ${filename} (~${(targetBytes / (1024 * 1024)).toFixed(0)} MB)...`);
  const ws = fs.createWriteStream(filePath);
  ws.write(HEADER);

  let written = HEADER.length;
  let id = 1;

  const cities = [
    { city: 'Dayton', state: 'OH', county: 'Montgomery', lat: 39.7589, lng: -84.1916, tz: 'US/Eastern' },
    { city: 'Los Angeles', state: 'CA', county: 'Los Angeles', lat: 34.0522, lng: -118.2437, tz: 'US/Pacific' },
    { city: 'Houston', state: 'TX', county: 'Harris', lat: 29.7604, lng: -95.3698, tz: 'US/Central' },
    { city: 'Denver', state: 'CO', county: 'Denver', lat: 39.7392, lng: -104.9903, tz: 'US/Mountain' },
    { city: 'Miami', state: 'FL', county: 'Miami-Dade', lat: 25.7617, lng: -80.1918, tz: 'US/Eastern' },
  ];

  const BATCH_SIZE = 5000;
  while (written < targetBytes) {
    let chunk = '';
    for (let i = 0; i < BATCH_SIZE && written < targetBytes; i++) {
      const c = cities[id % cities.length];
      const sev = (id % 4) + 1; // 1, 2, 3, 4
      const lat = +(c.lat + (Math.sin(id) * 0.1)).toFixed(5);
      const lng = +(c.lng + (Math.cos(id) * 0.1)).toFixed(5);
      const date = `2023-03-${String((id % 28) + 1).padStart(2, '0')} ${String(id % 24).padStart(2, '0')}:${String(id % 60).padStart(2, '0')}:00.000`;
      const line = `A-${id},${sev},${date},${date},${lat},${lng},${lat},${lng},"Accident reported near ${c.city}",Main St,${c.city},${c.county},${c.state},90001,US,${c.tz},False,True,False\n`;
      chunk += line;
      written += line.length;
      id++;
    }
    const canContinue = ws.write(chunk);
    if (!canContinue) {
      await new Promise((r) => ws.once('drain', r));
    }
  }

  ws.end();
  await new Promise((r) => ws.on('finish', r));
  const finalStat = fs.statSync(filePath);
  console.log(`[gen] Created ${filename}: ${(finalStat.size / (1024 * 1024)).toFixed(2)} MB (${id.toLocaleString()} rows)`);
  return filePath;
}

async function generateSparseCsv(filename, targetBytes) {
  const filePath = path.join(OUT_DIR, filename);
  console.log(`[gen] Generating sparse ${filename} (~${(targetBytes / (1024 * 1024)).toFixed(0)} MB)...`);
  const ws = fs.createWriteStream(filePath);
  ws.write(HEADER);

  let written = HEADER.length;
  let id = 1;

  // Sparse lines with padding comments to reach 1 GB quickly without wasting CPU
  const pad = 'X'.repeat(400);
  const BATCH_SIZE = 2000;

  while (written < targetBytes) {
    let chunk = '';
    for (let i = 0; i < BATCH_SIZE && written < targetBytes; i++) {
      const sev = (id % 4) + 1;
      const lat = +(34.05 + (id % 100) * 0.001).toFixed(5);
      const lng = +(-118.24 + (id % 100) * 0.001).toFixed(5);
      const date = `2023-03-15 12:00:00`;
      const line = `SPARSE-${id},${sev},${date},${date},${lat},${lng},,,Incident details ${pad},Hwy 101,Los Angeles,Los Angeles,CA,90012,US,US/Pacific,False,False,False\n`;
      chunk += line;
      written += line.length;
      id++;
    }
    const canContinue = ws.write(chunk);
    if (!canContinue) {
      await new Promise((r) => ws.once('drain', r));
    }
  }

  ws.end();
  await new Promise((r) => ws.on('finish', r));
  const finalStat = fs.statSync(filePath);
  console.log(`[gen] Created ${filename}: ${(finalStat.size / (1024 * 1024)).toFixed(2)} MB (${id.toLocaleString()} rows)`);
  return filePath;
}

async function createZipArchive(csvPath, zipName) {
  console.log(`[gen] Packaging ${path.basename(csvPath)} into ${zipName}...`);
  const zipPath = path.join(OUT_DIR, zipName);
  const zip = new AdmZip();
  zip.addLocalFile(csvPath);
  zip.writeZip(zipPath);
  const finalStat = fs.statSync(zipPath);
  console.log(`[gen] Created ${zipName}: ${(finalStat.size / (1024 * 1024)).toFixed(2)} MB`);
  return zipPath;
}

async function main() {
  const file300 = await generateCsv('us_accidents_300mb.csv', 300 * 1024 * 1024);
  await createZipArchive(file300, 'us_accidents_300mb.zip');
  await generateSparseCsv('sparse_1gb.csv', 1024 * 1024 * 1024);
  console.log('[gen] All test files generated successfully!');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[gen] Error:', err);
    process.exit(1);
  });
}

module.exports = { OUT_DIR, generateCsv, generateSparseCsv, createZipArchive };
