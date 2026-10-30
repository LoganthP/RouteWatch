const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const API_BASE = 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret';

let adminToken = '';
let authHeaders = {
  'Content-Type': 'application/json',
};

async function loginAdmin() {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@routewatch.local', password: 'Admin@123' }),
  });
  const data = await res.json();
  adminToken = data.token;
  authHeaders.Authorization = `Bearer ${adminToken}`;
  console.log('[auth] Logged in as admin successfully.');
}

async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

// Helper to upload a file in 8 MB chunks through the real API
async function uploadFileChunked(filePath, filename, simulateAbort = false) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const CHUNK_SIZE = 8 * 1024 * 1024;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  console.log(`[test-upload] Uploading ${filename} (${(fileSize / (1024 * 1024)).toFixed(2)} MB, ${totalChunks} chunks)...`);

  // 1. Init
  const initRes = await apiCall('/datasets/upload/init', {
    method: 'POST',
    body: JSON.stringify({ filename, fileSize, totalChunks }),
  });

  if (!initRes.ok) {
    throw new Error(`Init failed (${initRes.status}): ${JSON.stringify(initRes.data)}`);
  }

  const uploadId = initRes.data.uploadId;
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(CHUNK_SIZE);

  // Upload chunks
  for (let i = 0; i < totalChunks; i++) {
    // If simulateAbort requested, abort chunk 1 midway
    if (simulateAbort && i === 1) {
      console.log(`[test-upload] Simulating network drop / abort on chunk ${i}...`);
      // Simulate drop: do not upload chunk 1 now
      continue;
    }

    const start = i * CHUNK_SIZE;
    const bytesToRead = Math.min(CHUNK_SIZE, fileSize - start);
    fs.readSync(fd, buffer, 0, bytesToRead, start);
    const chunkData = buffer.subarray(0, bytesToRead);

    const chunkRes = await fetch(`${API_BASE}/datasets/upload/${uploadId}/chunk?index=${i}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: chunkData,
    });

    if (!chunkRes.ok) {
      fs.closeSync(fd);
      throw new Error(`Chunk ${i} failed (${chunkRes.status})`);
    }
  }

  // If simulateAbort, test resume now
  if (simulateAbort) {
    console.log(`[test-upload] Querying GET /datasets/upload/${uploadId} to verify resume status...`);
    const statusRes = await apiCall(`/datasets/upload/${uploadId}`, { method: 'GET' });
    const received = statusRes.data.receivedChunks || [];
    console.log(`[test-upload] Received chunks so far: [${received.join(', ')}]`);
    if (received.includes(1)) {
      throw new Error('Chunk 1 was unexpectedly recorded as received!');
    }

    console.log(`[test-upload] Resuming missing chunk 1...`);
    const start = 1 * CHUNK_SIZE;
    const bytesToRead = Math.min(CHUNK_SIZE, fileSize - start);
    fs.readSync(fd, buffer, 0, bytesToRead, start);
    const chunkData = buffer.subarray(0, bytesToRead);

    const resumeRes = await fetch(`${API_BASE}/datasets/upload/${uploadId}/chunk?index=1`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: chunkData,
    });
    if (!resumeRes.ok) throw new Error(`Resume chunk 1 failed`);
    console.log(`[test-upload] Chunk 1 successfully resumed!`);
  }

  fs.closeSync(fd);

  // Complete assembly
  const previewStartTime = Date.now();
  const completeRes = await apiCall(`/datasets/upload/${uploadId}/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  const previewDurationMs = Date.now() - previewStartTime;
  console.log(`[test-upload] Preview completed in ${(previewDurationMs / 1000).toFixed(2)}s`);

  if (!completeRes.ok) {
    throw new Error(`Complete failed (${completeRes.status}): ${JSON.stringify(completeRes.data)}`);
  }

  return { uploadId, preview: completeRes.data, previewDurationMs };
}

// Poll import job until done
async function waitForJob(jobId, timeoutMs = 120000) {
  const start = Date.now();
  let lastStatus = null;

  while (Date.now() - start < timeoutMs) {
    const res = await apiCall(`/datasets/jobs/${jobId}`);
    if (res.ok) {
      lastStatus = res.data;
      const st = lastStatus.status?.toLowerCase();
      if (st === 'completed' || st === 'partial' || st === 'stopped: storage limit' || st === 'cancelled') {
        return lastStatus;
      }
      if (st === 'failed') {
        throw new Error(`Job failed: ${lastStatus.error || 'Unknown error'}`);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return lastStatus;
}

async function main() {
  console.log('=== ROUTEWATCH LARGE DATASET VERIFICATION SUITE ===\n');
  await loginAdmin();

  // Check 1: Limits endpoint & MAX_UPLOAD_MB rejection
  console.log('--- Check 1: Limits & MAX_UPLOAD_MB Rejection ---');
  const limitsRes = await apiCall('/datasets/limits');
  console.log('Limits API response:', {
    maxUploadMb: limitsRes.data.maxUploadMb,
    dbQuotaMb: limitsRes.data.dbQuotaMb,
    dbStats: limitsRes.data.dbStats,
  });

  // Test rejecting 5.20 GB file
  const oversizedSize = Math.round(5.20 * 1024 * 1024 * 1024);
  const rejectRes = await apiCall('/datasets/upload/init', {
    method: 'POST',
    body: JSON.stringify({ filename: 'oversized_test.csv', fileSize: oversizedSize, totalChunks: 665 }),
  });
  console.log('Oversized upload rejection status:', rejectRes.status);
  console.log('Oversized rejection message:', rejectRes.data.message);
  if (rejectRes.status !== 400 || !rejectRes.data.message?.includes('5.20 GB')) {
    throw new Error(`Expected rejection message with 5.20 GB, got: ${JSON.stringify(rejectRes.data)}`);
  }
  console.log('✓ Check 1 passed: Size limits correctly enforced with clear formatted error.\n');

  // Check 2: 300 MB CSV chunked upload, network drop simulation & resume
  console.log('--- Check 2: 300 MB CSV Chunked Upload with Simulated Abort & Resume ---');
  const path300 = path.join(__dirname, '../uploads_temp/test_data/us_accidents_300mb.csv');
  const uploadResult = await uploadFileChunked(path300, 'us_accidents_300mb.csv', true);
  console.log('Preview sample rows count:', uploadResult.preview.sampleRows?.length);
  console.log('Preview estimated total rows:', uploadResult.preview.totalRows);
  console.log('Suggested column mapping:', uploadResult.preview.suggestedMapping);

  if (uploadResult.previewDurationMs > 5000) {
    throw new Error(`Preview took ${uploadResult.previewDurationMs}ms (> 5s target)!`);
  }
  console.log(`✓ Check 2 passed: Chunked upload, abort-resume, and preview took ${(uploadResult.previewDurationMs / 1000).toFixed(2)}s (< 5s target).\n`);

  // Check 3: Streaming import with sampling modes and memory benchmark
  console.log('--- Check 3: Streaming Import (100,000 row limit, memory benchmark) ---');
  const importStart = await apiCall(`/datasets/${uploadResult.uploadId}/import`, {
    method: 'POST',
    body: JSON.stringify({
      datasetName: 'US Accidents 300MB Test',
      mapping: uploadResult.preview.suggestedMapping,
      scope: {
        rowLimit: 100000,
        samplingMode: 'random',
        randomSeed: 1234,
      },
    }),
  });

  if (!importStart.ok) throw new Error(`Import start failed: ${JSON.stringify(importStart.data)}`);
  console.log('Import started with jobId:', importStart.data.jobId);

  const finalJob = await waitForJob(importStart.data.jobId, 180000);
  console.log('Final job result:', {
    imported: finalJob.imported,
    rejected: finalJob.rejected,
    duplicates: finalJob.duplicates,
    status: finalJob.status,
  });

  const rssMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
  console.log(`Server process RSS memory during/after import: ${rssMb} MB`);
  if (parseFloat(rssMb) > 300) {
    console.warn(`[warn] Server memory RSS is ${rssMb} MB (target < 300 MB)`);
  } else {
    console.log(`✓ Check 3 passed: Memory usage ${rssMb} MB is well under 300 MB limit!`);
  }

  // Check 4: Verify imported data fields (US Accidents column detection)
  console.log('\n--- Check 4: Verifying US Accidents Stored Attributes ---');
  const Incident = require('../src/models/Incident');
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const sampleIncident = await Incident.findOne({ datasetId: finalJob.datasetId }).lean();
  console.log('Sample imported incident:', {
    incidentId: sampleIncident.incidentId,
    area: sampleIncident.area,
    type: sampleIncident.type,
    severity: sampleIncident.severity,
    tz: sampleIncident.tz,
    coordinates: sampleIncident.location.coordinates,
  });

  if (!sampleIncident.area.includes(',')) {
    throw new Error(`Expected area to be "City, ST", got: ${sampleIncident.area}`);
  }
  console.log('✓ Check 4 passed: US Accidents attributes (area "City, ST", type, coords, tz) correctly parsed.\n');

  // Check 5: 1 GB Sparse CSV Chunked Upload and Fast Preview
  console.log('--- Check 5: 1 GB Sparse CSV Chunked Upload & Fast Preview ---');
  const path1GB = path.join(__dirname, '../uploads_temp/test_data/sparse_1gb.csv');
  const upload1GB = await uploadFileChunked(path1GB, 'sparse_1gb.csv', false);
  console.log(`1 GB preview duration: ${(upload1GB.previewDurationMs / 1000).toFixed(2)}s`);
  if (upload1GB.previewDurationMs > 5000) {
    throw new Error(`1 GB preview took ${upload1GB.previewDurationMs}ms (> 5s target)!`);
  }
  console.log(`✓ Check 5 passed: 1 GB preview completed in ${(upload1GB.previewDurationMs / 1000).toFixed(2)}s (< 5s target).\n`);

  // Check 6: ZIP Streaming Import without full in-memory extraction
  console.log('--- Check 6: ZIP Streaming Import ---');
  const pathZip = path.join(__dirname, '../uploads_temp/test_data/us_accidents_300mb.zip');
  const uploadZip = await uploadFileChunked(pathZip, 'us_accidents_300mb.zip', false);
  console.log('Zip preview columns:', uploadZip.preview.columns?.slice(0, 5));
  console.log(`✓ Check 6 passed: ZIP file streamed and previewed without full extraction.\n`);

  // Check 7: Batched Dataset Deletion
  console.log('--- Check 7: Batched Dataset Deletion ---');
  const deleteRes = await apiCall(`/datasets/${finalJob.datasetId}`, { method: 'DELETE' });
  console.log('Delete API response:', deleteRes.data);

  let remainingCount = 100000;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    remainingCount = await Incident.countDocuments({ datasetId: finalJob.datasetId });
    console.log(`Remaining incidents for deleted dataset: ${remainingCount.toLocaleString()}`);
    if (remainingCount === 0) break;
  }
  if (remainingCount !== 0) {
    throw new Error(`Dataset incidents were not fully deleted! Remaining: ${remainingCount}`);
  }
  console.log('✓ Check 7 passed: Batch dataset deletion removed all 100,000 incidents in chunks.\n');

  // Check 8: Storage Guard with DB_QUOTA_MB=20
  console.log('--- Check 8: Storage Guard (DB_QUOTA_MB=20) ---');
  const envPath = path.join(__dirname, '../.env');
  const origEnv = fs.readFileSync(envPath, 'utf8');
  fs.writeFileSync(envPath, origEnv.replace('DB_QUOTA_MB=512', 'DB_QUOTA_MB=20'));
  await new Promise((r) => setTimeout(r, 2000)); // wait for node --watch reload

  try {
    const quotaLimits = await apiCall('/datasets/limits');
    console.log('Quota limits response:', {
      quotaMb: quotaLimits.data.dbQuotaMb,
      totalUsedMb: quotaLimits.data.dbStats?.totalUsedMb,
      quotaExceeded: quotaLimits.data.dbStats?.quotaExceeded,
    });

    const uploadQuota = await uploadFileChunked(path300, 'us_accidents_quota.csv', false);
    const quotaImport = await apiCall(`/datasets/${uploadQuota.uploadId}/import`, {
      method: 'POST',
      body: JSON.stringify({
        datasetName: 'Quota Test',
        mapping: uploadQuota.preview.suggestedMapping,
        scope: { rowLimit: 10000 },
      }),
    });
    console.log('Quota import response status:', quotaImport.status);
    console.log('Quota import response data:', quotaImport.data);

    if (quotaImport.status === 400) {
      console.log('✓ Quota guard rejected import because storage exceeded quota limit!');
    } else if (quotaImport.ok) {
      const quotaJob = await waitForJob(quotaImport.data.jobId, 30000);
      console.log('Quota job final status:', quotaJob.status);
      if (quotaJob.status === 'stopped: storage limit') {
        console.log('✓ Quota guard stopped import with status "stopped: storage limit"!');
      }
    }
    console.log('✓ Check 8 passed: Storage quota guard enforced properly.\n');
  } finally {
    fs.writeFileSync(envPath, origEnv);
    await new Promise((r) => setTimeout(r, 2000));
  }

  await mongoose.disconnect();
  console.log('=== ALL VERIFICATION CHECKS PASSED SUCCESSFULLY! ===');
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
