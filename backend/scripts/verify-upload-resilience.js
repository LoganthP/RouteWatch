const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const BASE_URL = 'http://localhost:5000/api';

async function main() {
  console.log('=== ROUTEWATCH CHUNKED UPLOAD VERIFICATION ===\n');

  // 1. Authenticate as admin
  console.log('Logging in as admin@routewatch.local...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@routewatch.local', password: 'Admin@123' }),
  });
  if (!loginRes.ok) throw new Error(`Login failed with status ${loginRes.status}`);
  const { token } = await loginRes.json();
  console.log('✓ Admin authenticated successfully.\n');

  const authHeaders = {
    Authorization: `Bearer ${token}`,
  };

  // =========================================================================
  // CHECK E: Deliberately wrong uploadId & Auth verification
  // =========================================================================
  console.log('--- CHECK E: Deliberately wrong uploadId & Auth verification ---');

  // Missing auth token -> 401
  const noAuthRes = await fetch(`${BASE_URL}/datasets/upload/00000000-0000-0000-0000-000000000000/chunk?index=0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('chunk data'),
  });
  console.log(`Missing token status: ${noAuthRes.status} (expected 401)`);
  if (noAuthRes.status !== 401) throw new Error(`Expected 401, got ${noAuthRes.status}`);

  // Deliberately wrong UUID -> 404 with honest message
  const wrongUuid = '11111111-2222-3333-4444-555555555555';
  const wrongUuidRes = await fetch(`${BASE_URL}/datasets/upload/${wrongUuid}/chunk?index=0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders },
    body: Buffer.from('chunk data'),
  });
  const wrongUuidBody = await wrongUuidRes.json();
  console.log(`Wrong UUID status: ${wrongUuidRes.status} (expected 404), message: "${wrongUuidBody.message}"`);
  if (wrongUuidRes.status !== 404 || !wrongUuidBody.message.includes('Upload session not found or expired')) {
    throw new Error(`Unexpected response for wrong UUID: ${JSON.stringify(wrongUuidBody)}`);
  }

  // Non-UUID invalid param -> 404 with same message
  const badParamRes = await fetch(`${BASE_URL}/datasets/upload/not-a-valid-uuid/chunk?index=0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders },
    body: Buffer.from('chunk data'),
  });
  const badParamBody = await badParamRes.json();
  console.log(`Non-UUID param status: ${badParamRes.status} (expected 404), message: "${badParamBody.message}"`);
  if (badParamRes.status !== 404) throw new Error(`Expected 404, got ${badParamRes.status}`);

  console.log('✓ Check E passed.\n');

  // =========================================================================
  // CHECK D: Abort chunk mid-upload and retry
  // =========================================================================
  console.log('--- CHECK D: Abort chunk mid-upload and retry ---');

  const chunkPayloadSize = 1024 * 1024; // 1 MB
  const dummyChunk = crypto.randomBytes(chunkPayloadSize);

  const initDRes = await fetch(`${BASE_URL}/datasets/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      filename: 'abort_test.zip',
      fileSize: chunkPayloadSize,
      totalChunks: 1,
      mimeType: 'application/zip',
    }),
  });
  const initD = await initDRes.json();
  console.log(`Init session for abort test: ${initD.uploadId}`);

  // Abort request to simulate cancellation / loss
  const abortCtrl = new AbortController();
  abortCtrl.abort();
  let abortedSuccessfully = false;
  try {
    await fetch(`${BASE_URL}/datasets/upload/${initD.uploadId}/chunk?index=0`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders },
      body: dummyChunk,
      signal: abortCtrl.signal,
    });
  } catch (err) {
    abortedSuccessfully = true;
    console.log(`Chunk request aborted as intended (${err.name}: ${err.message})`);
  }
  if (!abortedSuccessfully) throw new Error('Abort did not trigger');

  // Retry chunk upload
  console.log('Retrying aborted chunk...');
  const retryRes = await fetch(`${BASE_URL}/datasets/upload/${initD.uploadId}/chunk?index=0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders },
    body: dummyChunk,
  });
  const retryBody = await retryRes.json();
  console.log(`Retry status: ${retryRes.status}, received: ${retryBody.received}, total: ${retryBody.totalReceived}`);
  if (retryRes.status !== 200 || !retryBody.received) throw new Error('Retry failed');

  // Cleanup abort session
  await fetch(`${BASE_URL}/datasets/upload/${initD.uploadId}`, { method: 'DELETE', headers: authHeaders });
  console.log('✓ Check D passed.\n');

  // =========================================================================
  // CHECK C: Touch source file during upload to force node --watch restart
  // =========================================================================
  console.log('--- CHECK C: Touch source file to force node --watch restart ---');

  const twoChunkSize = 8 * 1024 * 1024 * 2; // 16 MB (2 chunks of 8 MB)
  const initCRes = await fetch(`${BASE_URL}/datasets/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      filename: 'watch_restart_test.zip',
      fileSize: twoChunkSize,
      totalChunks: 2,
      mimeType: 'application/zip',
    }),
  });
  const initC = await initCRes.json();
  console.log(`Init session for restart test: ${initC.uploadId}`);

  // Upload chunk 0
  const chunk8MB = crypto.randomBytes(8 * 1024 * 1024);
  console.log('Uploading chunk 0 (8 MB)...');
  const c0Res = await fetch(`${BASE_URL}/datasets/upload/${initC.uploadId}/chunk?index=0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders },
    body: chunk8MB,
  });
  if (c0Res.status !== 200) throw new Error(`Chunk 0 failed with status ${c0Res.status}`);
  console.log('Chunk 0 uploaded successfully.');

  // Touch src/server.js to trigger node --watch restart
  console.log('Touching src/server.js to trigger node --watch restart...');
  const serverPath = path.join(__dirname, '../src/server.js');
  const now = new Date();
  fs.utimesSync(serverPath, now, now);

  console.log('Waiting 2 seconds for node --watch restart to complete...');
  await new Promise((r) => setTimeout(r, 2000));

  // Now upload chunk 1
  console.log('Uploading chunk 1 after server restart...');
  const c1Res = await fetch(`${BASE_URL}/datasets/upload/${initC.uploadId}/chunk?index=1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders },
    body: chunk8MB,
  });
  const c1Body = await c1Res.json();
  console.log(`Chunk 1 response status: ${c1Res.status}, body:`, c1Body);
  if (c1Res.status !== 200 || !c1Body.received) {
    throw new Error(`Upload failed after restart with status ${c1Res.status}`);
  }

  // Check session status on server
  const statusRes = await fetch(`${BASE_URL}/datasets/upload/${initC.uploadId}`, {
    headers: authHeaders,
  });
  const statusBody = await statusRes.json();
  console.log(`Session receivedChunks on server: [${statusBody.receivedChunks.join(', ')}], completed: ${statusBody.completed}`);
  if (!statusBody.completed || statusBody.receivedChunks.length !== 2) {
    throw new Error(`Session chunks mismatch: ${JSON.stringify(statusBody)}`);
  }

  // Cleanup session C
  await fetch(`${BASE_URL}/datasets/upload/${initC.uploadId}`, { method: 'DELETE', headers: authHeaders });
  console.log('✓ Check C passed (Upload survived node --watch restart without 404).\n');

  // =========================================================================
  // CHECK B: Real 150 MB ZIP upload, preview, and streaming import
  // =========================================================================
  console.log('--- CHECK B: Real 150 MB ZIP upload, preview, and streaming import ---');

  console.log('Generating 150 MB zip file in memory...');
  const zip = new AdmZip();
  let csvContent = 'title,type,severity,status,latitude,longitude,city,reportedAt\n';
  for (let i = 0; i < 100; i++) {
    const lat = 12.3052 + (i % 10) * 0.002;
    const lng = 76.6552 + (i % 10) * 0.002;
    csvContent += `Accident on Ring Road ${i},Accident,High,Open,${lat},${lng},Mysuru,2026-10-23T10:00:00Z\n`;
  }
  zip.addFile('incidents.csv', Buffer.from(csvContent, 'utf8'));

  // 150 MB of incompressible data so zip is >= 150 MB
  const filler = crypto.randomBytes(150 * 1024 * 1024);
  zip.addFile('data.raw', filler);
  const zipBuffer = zip.toBuffer();
  const zipSize = zipBuffer.length;
  console.log(`Generated zip size: ${(zipSize / (1024 * 1024)).toFixed(2)} MB (${zipSize} bytes)`);

  const chunkSize = 8 * 1024 * 1024;
  const totalChunks = Math.ceil(zipSize / chunkSize);
  console.log(`Total chunks: ${totalChunks} (chunk size: ${chunkSize} bytes)`);

  // Initialize upload session
  console.log('Initializing chunked upload session...');
  const initRes = await fetch(`${BASE_URL}/datasets/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      filename: 'verification_150mb.zip',
      fileSize: zipSize,
      totalChunks,
      mimeType: 'application/zip',
    }),
  });
  if (!initRes.ok) throw new Error(`Init failed: ${await initRes.text()}`);
  const { uploadId } = await initRes.json();
  console.log(`Upload initialized with uploadId: ${uploadId}`);

  // Upload all chunks
  const uploadStartTime = Date.now();
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(zipSize, start + chunkSize);
    const chunkSlice = zipBuffer.subarray(start, end);

    const chunkRes = await fetch(`${BASE_URL}/datasets/upload/${uploadId}/chunk?index=${i}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders },
      body: chunkSlice,
    });
    if (chunkRes.status !== 200) {
      throw new Error(`Chunk ${i} failed with status ${chunkRes.status}: ${await chunkRes.text()}`);
    }
    process.stdout.write(`\rUploaded chunk ${i + 1}/${totalChunks} (200 OK)`);
  }
  const uploadDuration = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
  console.log(`\nAll ${totalChunks} chunks uploaded in ${uploadDuration}s.`);

  // Complete assembly and request preview
  console.log('Finalizing assembly & verifying file (POST /complete)...');
  const completeRes = await fetch(`${BASE_URL}/datasets/upload/${uploadId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({}),
  });
  if (!completeRes.ok) throw new Error(`Complete failed: ${await completeRes.text()}`);
  const preview = await completeRes.json();
  console.log('✓ File assembly complete!');
  console.log(`Columns detected: [${preview.columns.join(', ')}]`);
  console.log(`Sample rows: ${preview.sampleRows.length}, Suggested mapping:`, preview.suggestedMapping);

  // Start background streaming import
  console.log('\nStarting streaming background import...');
  const importRes = await fetch(`${BASE_URL}/datasets/${uploadId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      mapping: preview.suggestedMapping || {
        title: 'title',
        type: 'type',
        severity: 'severity',
        status: 'status',
        latitude: 'latitude',
        longitude: 'longitude',
        city: 'city',
        reportedAt: 'reportedAt',
      },
      datasetName: '150MB Zip Test Dataset',
      scope: { rowLimit: 1000 },
    }),
  });
  if (importRes.status !== 202) throw new Error(`Import failed with status ${importRes.status}: ${await importRes.text()}`);
  const { jobId, datasetId } = await importRes.json();
  console.log(`Import job queued. Job ID: ${jobId}, Dataset ID: ${datasetId}`);

  // Poll job until complete
  console.log('Polling job progress...');
  let jobDone = false;
  let pollAttempts = 0;
  while (!jobDone && pollAttempts < 30) {
    await new Promise((r) => setTimeout(r, 500));
    const jobRes = await fetch(`${BASE_URL}/datasets/jobs/${jobId}`, { headers: authHeaders });
    const jobData = await jobRes.json();
    process.stdout.write(`\rStatus: ${jobData.status} | Processed: ${jobData.processed} | Imported: ${jobData.imported} | Rejected: ${jobData.rejected}`);
    if (jobData.status === 'Completed' || jobData.status === 'Partial') {
      jobDone = true;
      console.log(`\n✓ Import finished successfully with ${jobData.imported} rows imported, ${jobData.rejected} rejected.`);
    } else if (jobData.status === 'Failed' || jobData.status.startsWith('stopped:')) {
      throw new Error(`Job ended with error status: ${jobData.status}`);
    }
    pollAttempts++;
  }
  if (!jobDone) throw new Error('Job polling timed out');

  console.log('\n=== ALL CHECKS PASSED SUCCESSFULLY! ===');
}

main().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
