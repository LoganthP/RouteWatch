const path = require('path');
const fs = require('fs');

async function prune() {
  const incidentFile = path.resolve('backend/src/models/Incident.js');
  let content = fs.readFileSync(incidentFile, 'utf8');

  // Remove redundant indexes in code
  content = content.replace(/\r?\nincidentSchema\.index\(\{\s*type:\s*1\s*\}\);/, '');
  content = content.replace(/\r?\nincidentSchema\.index\(\{\s*area:\s*1\s*\}\);/, '');
  content = content.replace(/\r?\nincidentSchema\.index\(\{\s*['"]source\.datasetId['"]:\s*1\s*\}\);/, '');

  fs.writeFileSync(incidentFile, content, 'utf8');
  console.log('Updated backend/src/models/Incident.js schema indexes.');

  const mongoose = require(path.resolve('backend/node_modules/mongoose'));
  await mongoose.connect('mongodb://127.0.0.1:27017/routewatch_db');
  const db = mongoose.connection.db;
  const col = db.collection('incidents');

  const beforeStats = await db.command({ collStats: 'incidents' });
  console.log(`Before index size: ${(beforeStats.totalIndexSize / (1024 * 1024)).toFixed(2)} MB`);

  const indexes = await col.indexes();
  const toDrop = ['type_1', 'area_1', 'source.datasetId_1'];
  for (const name of toDrop) {
    if (indexes.some(idx => idx.name === name)) {
      await col.dropIndex(name);
      console.log(`Dropped redundant index: ${name}`);
    } else {
      console.log(`Index ${name} not present or already dropped.`);
    }
  }

  const afterStats = await db.command({ collStats: 'incidents' });
  const freedBytes = beforeStats.totalIndexSize - afterStats.totalIndexSize;
  console.log(`After index size: ${(afterStats.totalIndexSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Index space freed: ${(freedBytes / (1024 * 1024)).toFixed(2)} MB (${freedBytes} bytes)`);

  await mongoose.disconnect();
}

prune().catch(console.error);

