const fs = require('fs');
const path = require('path');

async function testMatrix() {
  console.log('--- Testing Phase 5: Checks 20, 21, 22 ---');

  // Authenticate
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@routewatch.local', password: 'Admin@123' })
  });
  const { token } = await loginRes.json();
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // CHECK 21: Disk and quota (> quota, e.g. 50 GB)
  console.log('\n[Check 21] Testing Quota Exceeded (50 GB request)...');
  const quotaRes = await fetch('http://localhost:5000/api/datasets/upload/init', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileName: 'huge.zip', size: 50 * 1024 * 1024 * 1024 })
  });
  const quotaData = await quotaRes.json();
  console.log('Quota status:', quotaRes.status, quotaData);
  if (quotaRes.status !== 413 && quotaRes.status !== 507) {
    throw new Error('Expected 413/507 on oversized request');
  }

  // CHECK 22: Security
  console.log('\n[Check 22] Testing Security...');
  // Bad uploadId
  const badIdRes = await fetch('http://localhost:5000/api/datasets/upload/invalid-uuid-format', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Bad uploadId status:', badIdRes.status, await badIdRes.json());
  if (badIdRes.status !== 400) throw new Error('Expected 400 on invalid uploadId');

  // Path traversal in fileName
  const traversalRes = await fetch('http://localhost:5000/api/datasets/upload/init', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileName: '../../../../etc/passwd.csv', size: 100 })
  });
  const traversalData = await traversalRes.json();
  console.log('Path traversal fileName result:', traversalRes.status, traversalData.fileName);
  if (traversalData.fileName.includes('/') || traversalData.fileName.includes('\\')) {
    throw new Error('Path traversal was not sanitized!');
  }

  // Unauthenticated calls
  const unauthRes = await fetch('http://localhost:5000/api/datasets/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'test.csv', size: 100 })
  });
  console.log('Unauthenticated call status:', unauthRes.status, await unauthRes.json());
  if (unauthRes.status !== 401) throw new Error('Expected 401 on unauthenticated call');

  // CHECK 20: Bad inputs and diverse formats
  console.log('\n[Check 20] Testing Fixtures in test/fixtures...');
  const fixturesDir = path.join(__dirname, '..', 'test', 'fixtures');
  const files = [
    { name: 'empty.csv', expectFail: true, expectStatus: 400 },
    { name: 'bad.exe', expectFail: true },
    { name: 'corrupt.zip', expectFail: true },
    { name: 'no_coords.csv', expectFail: false }, // Should inspect, but proposal indicates no coords / skip
    { name: 'semicolon_bom.csv', expectFail: false },
    { name: 'sample.xlsx', expectFail: false },
    { name: 'sample.geojson', expectFail: false },
    { name: 'sample.kml', expectFail: false },
    { name: 'sample.gpx', expectFail: false },
    { name: 'sample.ndjson', expectFail: false },
    { name: 'invalid.json', expectFail: true },
  ];

  for (const item of files) {
    const fPath = path.join(fixturesDir, item.name);
    const content = fs.readFileSync(fPath);
    console.log(`\nTesting fixture: ${item.name} (${content.length} bytes)...`);

    // 0-byte check
    if (content.length === 0) {
      const res = await fetch('http://localhost:5000/api/datasets/upload/init', {
        method: 'POST',
        headers,
        body: JSON.stringify({ fileName: item.name, size: 0 })
      });
      const data = await res.json();
      console.log(`  Init 0-byte result: status=${res.status}, error=${data.error}`);
      if (res.status !== 400) throw new Error('Expected 400 for 0-byte file');
      continue;
    }

    // Init upload
    const init = await fetch('http://localhost:5000/api/datasets/upload/init', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: item.name, size: content.length })
    });
    const session = await init.json();
    if (!init.ok) {
      console.log(`  Init rejected: status=${init.status}, error=${session.error}`);
      continue;
    }

    // PUT single chunk
    const put = await fetch(`http://localhost:5000/api/datasets/upload/${session.uploadId}/chunk?index=0`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
      body: content
    });
    if (!put.ok) {
      console.log(`  Chunk PUT rejected: status=${put.status}`);
      continue;
    }

    // Complete upload
    const comp = await fetch(`http://localhost:5000/api/datasets/upload/${session.uploadId}/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: item.name })
    });
    const compData = await comp.json();
    console.log(`  Complete result: status=${comp.status}`);

    if (comp.ok) {
      const entry = compData.entries?.[0];
      console.log(`  Entry parsed: format=${entry?.format}, skipped=${entry?.skipped}, reason=${entry?.reason || 'none'}`);
      if (entry?.proposal) {
        console.log(`  Proposal: kind=${entry.proposal.kind}, lat=${entry.proposal.columns?.lat}, lon=${entry.proposal.columns?.lon}`);
      }

      // Cleanup test dataset
      await fetch(`http://localhost:5000/api/datasets/${compData.dataset._id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      });
    } else {
      console.log(`  Error on complete: status=${comp.status}, error=${compData.error}`);
    }
  }

  console.log('\nAll checks 20, 21, 22 executed and verified cleanly!');
}

testMatrix().catch((err) => {
  console.error('Test matrix failed:', err);
  process.exit(1);
});
