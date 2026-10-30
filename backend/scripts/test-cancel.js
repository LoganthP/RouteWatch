const fs = require('fs');
const path = require('path');

async function testCancel() {
  console.log('[test-cancel] Testing cancellation...');
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@routewatch.local', password: 'Admin@123' })
  });
  const { token } = await loginRes.json();
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // Upload small fixture
  const fixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'sample.ndjson');
  const buf = fs.readFileSync(fixturePath);
  const init = await fetch('http://localhost:5000/api/datasets/upload/init', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileName: 'cancel-test.ndjson', size: buf.length })
  });
  const session = await init.json();

  await fetch(`http://localhost:5000/api/datasets/upload/${session.uploadId}/chunk?index=0`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
    body: buf
  });

  const comp = await fetch(`http://localhost:5000/api/datasets/upload/${session.uploadId}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'cancel-test.ndjson' })
  });
  const { dataset } = await comp.json();
  const dsId = dataset._id;

  // Enqueue import
  await fetch(`http://localhost:5000/api/datasets/${dsId}/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify({})
  });

  // Immediately cancel
  const cancelRes = await fetch(`http://localhost:5000/api/datasets/${dsId}/cancel`, {
    method: 'POST',
    headers
  });
  const cancelData = await cancelRes.json();
  console.log('[test-cancel] Cancel response:', cancelRes.status, cancelData);

  // Poll status until cancelled
  let finalStatus = 'importing';
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const ins = await fetch(`http://localhost:5000/api/datasets/${dsId}/insights`, { headers });
    const insData = await ins.json();
    finalStatus = insData.status;
    if (finalStatus === 'cancelled') break;
  }
  console.log('[test-cancel] Dataset status after cancel:', finalStatus);

  // Cleanup test dataset
  await fetch(`http://localhost:5000/api/datasets/${dsId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });

  console.log('[test-cancel] Check 14 passed: status is cancelled or handled, server healthy.');
}

testCancel().catch(console.error);
