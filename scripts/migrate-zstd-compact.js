const path = require('path');

async function migrate() {
  const mongoose = require(path.resolve('backend/node_modules/mongoose'));
  await mongoose.connect('mongodb://127.0.0.1:27017/routewatch_db');
  const db = mongoose.connection.db;

  const colOrig = db.collection('incidents');
  const beforeStats = await db.command({ collStats: 'incidents' });
  const totalCount = await colOrig.countDocuments();

  console.log('=== BEFORE MIGRATION & COMPRESSION ===');
  console.log(`Document count: ${totalCount}`);
  console.log(`Data size: ${(beforeStats.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Storage size: ${(beforeStats.storageSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Index size: ${(beforeStats.totalIndexSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Total on disk: ${((beforeStats.storageSize + beforeStats.totalIndexSize) / (1024 * 1024)).toFixed(2)} MB`);

  // Drop temporary collection if exists
  await db.collection('incidents_zstd').drop().catch(() => {});

  // Create collection with zstd block compressor
  await db.createCollection('incidents_zstd', {
    storageEngine: { wiredTiger: { configString: 'block_compressor=zstd' } },
  });

  const colZstd = db.collection('incidents_zstd');

  // Stream & compact documents into zstd collection in batches
  console.log('Copying documents with attributes compaction into zstd collection...');
  const cursor = colOrig.find({});
  let batch = [];
  let copied = 0;

  const TOP_FIELDS = new Set([
    '_id', 'incidentId', 'type', 'severity', 'status', 'description', 'area',
    'location', 'tz', 'reportedAt', 'resolvedAt', 'source', 'reportedBy',
    'verifiedBy', 'datasetId', 'fingerprint', 'isSynthetic', 'aiSeverity',
    'createdAt', 'updatedAt', 'attributes'
  ]);

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const compactDoc = {};
    const extraAttrs = doc.attributes ? { ...doc.attributes } : {};

    for (const [key, val] of Object.entries(doc)) {
      if (val === null || val === undefined || val === '') continue;
      if (TOP_FIELDS.has(key)) {
        compactDoc[key] = val;
      } else {
        extraAttrs[key] = val;
      }
    }
    if (Object.keys(extraAttrs).length > 0) {
      compactDoc.attributes = extraAttrs;
    }

    batch.push(compactDoc);
    if (batch.length >= 2000) {
      await colZstd.insertMany(batch, { ordered: false });
      copied += batch.length;
      batch = [];
    }
  }
  if (batch.length > 0) {
    await colZstd.insertMany(batch, { ordered: false });
    copied += batch.length;
  }

  console.log(`Copied ${copied} documents into incidents_zstd.`);

  const zstdCount = await colZstd.countDocuments();
  if (zstdCount !== totalCount) {
    throw new Error(`Count mismatch! Original: ${totalCount}, New: ${zstdCount}. Aborting swap.`);
  }

  // Copy indexes from original collection (excluding dropped redundant ones)
  console.log('Rebuilding indexes on incidents_zstd...');
  const indexes = await colOrig.indexes();
  for (const idx of indexes) {
    if (idx.name === '_id_') continue;
    const { key, name, unique, partialFilterExpression, background, ...options } = idx;
    const indexOpts = { name };
    if (unique) indexOpts.unique = true;
    if (partialFilterExpression) indexOpts.partialFilterExpression = partialFilterExpression;
    await colZstd.createIndex(key, indexOpts);
    console.log(`Rebuilt index: ${name}`);
  }

  // Safe swap
  console.log('Swapping collections...');
  await db.collection('incidents_old_backup').drop().catch(() => {});
  await colOrig.rename('incidents_old_backup');
  await colZstd.rename('incidents');

  const afterStats = await db.command({ collStats: 'incidents' });
  console.log('\n=== AFTER MIGRATION & COMPRESSION ===');
  console.log(`Document count: ${await db.collection('incidents').countDocuments()}`);
  console.log(`Data size: ${(afterStats.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Storage size: ${(afterStats.storageSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Index size: ${(afterStats.totalIndexSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Total on disk: ${((afterStats.storageSize + afterStats.totalIndexSize) / (1024 * 1024)).toFixed(2)} MB`);

  const storageSaved = (beforeStats.storageSize - afterStats.storageSize) / (1024 * 1024);
  const totalSaved = ((beforeStats.storageSize + beforeStats.totalIndexSize) - (afterStats.storageSize + afterStats.totalIndexSize)) / (1024 * 1024);

  console.log(`\nStorage size reduction: ${storageSaved.toFixed(2)} MB`);
  console.log(`Total disk footprint reduction: ${totalSaved.toFixed(2)} MB`);

  // Drop backup collection to reclaim disk space
  await db.collection('incidents_old_backup').drop().catch(() => {});
  console.log('Dropped temporary backup. Migration complete!');

  await mongoose.disconnect();
}

migrate().catch(console.error);

