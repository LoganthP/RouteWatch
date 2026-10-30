// RouteWatch — E2E upload test script.
// Tests chunked resumable upload with simulated network failures and abort/resume.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Parse command line arguments
const args = process.argv.slice(2);
function getArg(name, def = null) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return def;
}

const failRate = parseFloat(getArg('fail-rate', '0'));
const abortAt = parseFloat(getArg('abort-at', '0'));
const filePath = getArg('file', 'C:\\Users\\logan\\Downloads\\archive.zip');
const baseUrl = getArg('url', 'http://localhost:5000');
const email = getArg('email', 'admin@routewatch.local');
const password = getArg('password', 'Admin@123');

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log(`[e2e-upload] Starting E2E upload test for ${filePath}`);
  console.log(`[e2e-upload] Options: fail-rate=${failRate}, abort-at=${abortAt}%`);

  if (!fs.existsSync(filePath)) {
    console.error(`[e2e-upload] File not found: ${filePath}`);
    process.exit(1);
  }

  const stat = await fsp.stat(filePath);
  const totalSize = stat.size;
  console.log(`[e2e-upload] Source file size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);

  console.log('[e2e-upload] Calculating SHA-256 of source file...');
  const srcHash = await sha256File(filePath);
  console.log(`[e2e-upload] Source SHA-256: ${srcHash}`);

  // 1. Authenticate
  console.log(`[e2e-upload] Logging in to ${baseUrl} as ${email}...`);
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    const errText = await loginRes.text();
    console.error(`[e2e-upload] Login failed (${loginRes.status}): ${errText}`);
    process.exit(1);
  }
  const { token } = await loginRes.json();
  const headers = { Authorization: `Bearer ${token}` };
  console.log('[e2e-upload] Logged in successfully.');

  // 2. Initialize upload session
  const fileName = path.basename(filePath);
  const fingerprint = `${fileName}:${totalSize}:${stat.mtimeMs}`;

  console.log('[e2e-upload] Initializing upload session...');
  const initRes = await fetch(`${baseUrl}/api/datasets/upload/init`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, size: totalSize, fingerprint }),
  });
  if (!initRes.ok) {
    console.error(`[e2e-upload] Init failed (${initRes.status}): ${await initRes.text()}`);
    process.exit(1);
  }
  let session = await initRes.json();
  let uploadId = session.uploadId;
  const chunkSize = session.chunkSize;
  const totalChunks = session.totalChunks;
  console.log(`[e2e-upload] Session initialized: id=${uploadId}, chunkSize=${chunkSize}, chunks=${totalChunks}`);

  // 3. Upload loop with simulated failure and abort
  let hasAborted = false;
  let simulatedFailures = 0;

  for (let round = 1; round <= 5; round++) {
    // Query status from server
    const statusRes = await fetch(`${baseUrl}/api/datasets/upload/${uploadId}`, { headers });
    if (!statusRes.ok) {
      console.error(`[e2e-upload] Status check failed (${statusRes.status}): ${await statusRes.text()}`);
      process.exit(1);
    }
    const status = await statusRes.json();
    const missing = status.missing || [];
    console.log(`[e2e-upload] Round ${round}: received=${status.received.length}/${totalChunks}, missing=${missing.length}`);

    if (missing.length === 0) break;

    for (const index of missing) {
      const start = index * chunkSize;
      const end = Math.min(totalSize, start + chunkSize);
      const chunkBytes = end - start;

      // Check abort condition
      if (abortAt > 0 && !hasAborted) {
        const percent = (start / totalSize) * 100;
        if (percent >= abortAt) {
          console.log(`[e2e-upload] Simulating abort at ${percent.toFixed(1)}% (abort-at=${abortAt}%)...`);
          hasAborted = true;
          await sleep(1000);
          console.log('[e2e-upload] Resuming session after abort...');
          // Re-init with same fingerprint -> resumes existing session
          const resumeRes = await fetch(`${baseUrl}/api/datasets/upload/init`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName, size: totalSize, fingerprint }),
          });
          session = await resumeRes.json();
          uploadId = session.uploadId;
          break; // restart status check
        }
      }

      // Read chunk from disk
      const chunkBuffer = Buffer.alloc(chunkBytes);
      const fd = await fsp.open(filePath, 'r');
      await fd.read(chunkBuffer, 0, chunkBytes, start);
      await fd.close();

      // Check simulated fail-rate
      if (failRate > 0 && Math.random() < failRate) {
        simulatedFailures++;
        console.log(`[e2e-upload] [SIMULATED FAILURE] Intentionally failing chunk ${index} (rate=${failRate})`);
        continue; // skip sending chunk in this round
      }

      const putRes = await fetch(`${baseUrl}/api/datasets/upload/${uploadId}/chunk?index=${index}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        body: chunkBuffer,
      });

      if (!putRes.ok) {
        console.warn(`[e2e-upload] Chunk ${index} PUT returned ${putRes.status}`);
      }
    }
  }

  console.log(`[e2e-upload] Chunk uploading complete (simulated failures: ${simulatedFailures}, aborted: ${hasAborted})`);

  // 4. Complete upload
  console.log('[e2e-upload] Calling /complete to assemble and inspect file...');
  const completeRes = await fetch(`${baseUrl}/api/datasets/upload/${uploadId}/complete`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fileName }),
  });
  if (!completeRes.ok) {
    console.error(`[e2e-upload] Complete failed (${completeRes.status}): ${await completeRes.text()}`);
    process.exit(1);
  }
  const completeData = await completeRes.json();
  const datasetId = completeData.dataset?._id || completeData.datasetId;
  console.log(`[e2e-upload] Assembled datasetId: ${datasetId}, entries: ${completeData.entries?.length || 0}`);

  // 5. Verify byte identity (SHA-256 equal)
  const serverFilePath = path.join('storage', 'datasets', datasetId, fileName);
  console.log(`[e2e-upload] Checking server copy at ${serverFilePath}...`);
  if (!fs.existsSync(serverFilePath)) {
    console.error(`[e2e-upload] Server file not found at ${serverFilePath}`);
    process.exit(1);
  }
  const serverHash = await sha256File(serverFilePath);
  console.log(`[e2e-upload] Source SHA-256: ${srcHash}`);
  console.log(`[e2e-upload] Server SHA-256: ${serverHash}`);

  if (srcHash !== serverHash) {
    console.error('[e2e-upload] SHA-256 MISMATCH! File corruption detected!');
    process.exit(1);
  }
  console.log('[e2e-upload] SUCCESS: Source and server copy are byte-identical!');

  // 6. Trigger import
  console.log(`[e2e-upload] Triggering import for dataset ${datasetId}...`);
  const importRes = await fetch(`${baseUrl}/api/datasets/${datasetId}/import`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!importRes.ok) {
    console.error(`[e2e-upload] Import trigger failed (${importRes.status}): ${await importRes.text()}`);
    process.exit(1);
  }
  console.log('[e2e-upload] Import job enqueued. Polling /insights for progress...');

  let importDone = false;
  let lastPercent = -1;
  const importStart = Date.now();

  while (!importDone) {
    await sleep(1500);
    const insightsRes = await fetch(`${baseUrl}/api/datasets/${datasetId}/insights`, { headers });
    if (!insightsRes.ok) continue;
    const data = await insightsRes.json();
    const p = data.progress || {};
    const status = data.status;

    if (p.percent !== lastPercent) {
      lastPercent = p.percent;
      const elapsed = ((Date.now() - importStart) / 1000).toFixed(1);
      console.log(`[e2e-upload] Status: ${status} | ${p.percent || 0}% | stored: ${p.stored || 0} | invalid: ${p.invalid || 0} | dups: ${p.duplicates || 0} (${elapsed}s)`);
    }

    if (status === 'ready') {
      importDone = true;
      console.log('\n================== IMPORT COMPLETED ==================');
      console.log(`Total Stored: ${data.insights?.totals?.stored || p.stored}`);
      console.log(`Total Duplicates: ${data.insights?.totals?.duplicates || p.duplicates}`);
      console.log(`Total Invalid: ${data.insights?.totals?.invalid || p.invalid}`);
      console.log('Highlights:');
      (data.insights?.highlights || []).forEach((h) => console.log(`  * ${h}`));
      console.log('======================================================\n');
      break;
    } else if (status === 'failed' || status === 'interrupted' || status === 'cancelled') {
      console.error(`[e2e-upload] Import terminated with status: ${status}, error: ${data.error || 'unknown'}`);
      process.exit(1);
    }
  }

  console.log('[e2e-upload] All verification steps passed successfully.');
  process.exit(0);
}

run().catch((err) => {
  console.error('[e2e-upload] Unhandled error:', err);
  process.exit(1);
});
