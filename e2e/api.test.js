const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:5000/api';

const results = [];

function record(endpoint, testCase, expectedStatus, actualStatus, pass, details = '') {
  results.push({ endpoint, testCase, expectedStatus, actualStatus, pass, details });
  const mark = pass ? '✓ PASS' : '✗ FAIL';
  console.log(`${mark.padEnd(8)} [${String(actualStatus).padEnd(3)}] ${endpoint.padEnd(30)} - ${testCase}`);
}

async function run() {
  console.log('\n========================================================================');
  console.log(' RouteWatch Comprehensive API Resilience & Contract Test Suite');
  console.log('========================================================================\n');

  let adminToken = '';
  let citizenToken = '';

  // Helper request wrapper
  async function testReq({ method = 'get', url, data, params, token, expected, desc, validator }) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await axios({
        method,
        url: `${BASE_URL}${url}`,
        data,
        params,
        headers,
        validateStatus: () => true, // don't throw on 4xx/5xx
      });

      const statusMatch = Array.isArray(expected) ? expected.includes(res.status) : res.status === expected;
      let validBody = true;
      let details = '';

      // Contract rule: errors must return JSON { message } and NEVER a 500
      if (res.status >= 400) {
        if (!res.data || typeof res.data !== 'object' || !res.data.message) {
          validBody = false;
          details = 'Missing JSON { message } in error response';
        }
      }
      if (res.status === 500) {
        validBody = false;
        details = 'Received HTTP 500 Internal Server Error: ' + (res.data?.message || '');
      }
      if (validator && !validator(res)) {
        validBody = false;
        details = 'Custom validation failed';
      }

      const pass = statusMatch && validBody;
      record(url, desc, expected, res.status, pass, details);
      return res;
    } catch (err) {
      record(url, desc, expected, 'ERR', false, err.message);
      return null;
    }
  }

  // 1. Health
  await testReq({
    url: '/health',
    expected: 200,
    desc: 'Service health check',
    validator: (r) => r.data && r.data.ok === true,
  });

  // 2. Auth: Login
  const adminLogin = await testReq({
    method: 'post',
    url: '/auth/login',
    data: { email: 'admin@routewatch.local', password: 'Admin@123' },
    expected: 200,
    desc: 'Admin login with valid credentials',
    validator: (r) => r.data && r.data.token,
  });
  if (adminLogin?.data?.token) adminToken = adminLogin.data.token;

  const citizenLogin = await testReq({
    method: 'post',
    url: '/auth/login',
    data: { email: 'user@routewatch.local', password: 'User@123' },
    expected: 200,
    desc: 'Citizen login with valid credentials',
    validator: (r) => r.data && r.data.token,
  });
  if (citizenLogin?.data?.token) citizenToken = citizenLogin.data.token;

  await testReq({
    method: 'post',
    url: '/auth/login',
    data: { email: 'admin@routewatch.local', password: 'WrongPassword999' },
    expected: 401,
    desc: 'Login with invalid password',
  });

  await testReq({
    method: 'post',
    url: '/auth/login',
    data: {},
    expected: [400, 401],
    desc: 'Login with empty body',
  });

  await testReq({
    method: 'post',
    url: '/auth/login',
    data: { email: 'not-an-email', password: '' },
    expected: [400, 401],
    desc: 'Login with malformed email',
  });

  // 3. Auth: Register
  const testEmail = `qa_test_${Date.now()}@example.com`;
  await testReq({
    method: 'post',
    url: '/auth/register',
    data: { name: 'QA Tester', email: testEmail, password: 'Password@123' },
    expected: 201,
    desc: 'Register new valid user',
  });

  await testReq({
    method: 'post',
    url: '/auth/register',
    data: { name: 'QA Duplicate', email: testEmail, password: 'Password@123' },
    expected: [400, 409],
    desc: 'Register with duplicate email address',
  });

  await testReq({
    method: 'post',
    url: '/auth/register',
    data: { email: 'missing-pass@example.com' },
    expected: 400,
    desc: 'Register with missing required password and name',
  });

  // 4. Auth: Me
  await testReq({
    url: '/auth/me',
    token: adminToken,
    expected: 200,
    desc: 'Get profile with valid admin token',
  });

  await testReq({
    url: '/auth/me',
    token: citizenToken,
    expected: 200,
    desc: 'Get profile with valid citizen token',
  });

  await testReq({
    url: '/auth/me',
    token: 'invalid.jwt.token',
    expected: 401,
    desc: 'Get profile with malformed token',
  });

  await testReq({
    url: '/auth/me',
    expected: 401,
    desc: 'Get profile without authorization token',
  });

  // 5. Incidents: List & Query
  await testReq({
    url: '/incidents',
    expected: 200,
    desc: 'List incidents default params',
  });

  await testReq({
    url: '/incidents',
    params: { page: 1, limit: 10, sort: 'reportedAt', dir: 'asc' },
    expected: 200,
    desc: 'List incidents with pagination and ascending sort',
  });

  await testReq({
    url: '/incidents',
    params: { page: 'invalid', limit: -5, sort: 'unknownField' },
    expected: 200, // gracefully sanitized defaults
    desc: 'List incidents with malformed page, negative limit, unknown sort',
  });

  await testReq({
    url: '/incidents',
    params: { bbox: '76.6,12.3,76.7,12.4' },
    expected: 200,
    desc: 'List incidents with valid bounding box',
  });

  await testReq({
    url: '/incidents',
    params: { bbox: 'invalid,bbox,data' },
    expected: 200, // ignored and returns non-crashing result
    desc: 'List incidents with malformed bbox string',
  });

  await testReq({
    url: '/incidents',
    params: { bbox: '999,999,-999,-999' },
    expected: 200,
    desc: 'List incidents with out-of-range bbox coordinates',
  });

  await testReq({
    url: '/incidents',
    params: { datasetId: 'not-a-valid-objectid' },
    expected: 200,
    desc: 'List incidents with malformed datasetId ObjectId',
  });

  await testReq({
    url: '/incidents',
    params: { from: '2020-01-01', to: '2020-01-02' },
    expected: 200,
    desc: 'List incidents with empty filter results',
  });

  // 6. Incidents: Map & Cluster
  await testReq({
    url: '/incidents/map',
    expected: 200,
    desc: 'Get incidents for map rendering',
  });

  await testReq({
    url: '/incidents/map',
    params: { zoom: 11, bbox: '76.6,12.3,76.7,12.4' },
    expected: 200,
    desc: 'Get clustered incidents for zoom level 11',
  });

  await testReq({
    url: '/incidents/map',
    params: { limit: 9999999 },
    expected: 200,
    desc: 'Get incidents map with extreme limit (should cap safely)',
  });

  // 7. Incidents: Nearby & Compare
  await testReq({
    url: '/incidents/nearby',
    params: { lat: 12.3052, lng: 76.6552, radiusKm: 2 },
    expected: 200,
    desc: 'Nearby incidents search with valid lat/lng and 2km radius',
  });

  await testReq({
    url: '/incidents/nearby',
    params: { lat: 'NaN', lng: 'undefined' },
    expected: 400,
    desc: 'Nearby incidents with NaN lat/lng',
  });

  await testReq({
    url: '/incidents/nearby',
    params: {},
    expected: 400,
    desc: 'Nearby incidents with missing coordinates',
  });

  await testReq({
    url: '/incidents/nearby',
    params: { lat: 12.3, lng: 76.6, radiusKm: -10 },
    expected: 200, // clamped or returns empty safely
    desc: 'Nearby incidents with negative radius',
  });

  await testReq({
    url: '/analytics/performance',
    params: { lng: 76.6552, lat: 12.3052, radius: 2000 },
    expected: 200,
    desc: 'Performance executionStats comparison at valid coordinates',
  });

  // 8. Incidents: Create, Read, Update, Delete
  let createdIncidentId = '';
  const createRes = await testReq({
    method: 'post',
    url: '/incidents',
    token: citizenToken,
    data: {
      type: 'Accident',
      severity: 'High',
      description: 'API test incident creation',
      lat: 12.3052,
      lng: 76.6552,
      reportedAt: new Date().toISOString(),
    },
    expected: 201,
    desc: 'Create incident with valid payload by citizen',
    validator: (r) => r.data && r.data.incidentId,
  });
  if (createRes?.data?.incidentId) createdIncidentId = createRes.data.incidentId;

  await testReq({
    method: 'post',
    url: '/incidents',
    token: citizenToken,
    data: { type: 'Accident', severity: 'High' }, // missing lat/lng
    expected: 400,
    desc: 'Create incident with missing location coordinates',
  });

  await testReq({
    method: 'post',
    url: '/incidents',
    token: citizenToken,
    data: { lat: 999, lng: 999, type: 'Accident', severity: 'High' },
    expected: 400,
    desc: 'Create incident with invalid coordinates range (>90 lat)',
  });

  await testReq({
    method: 'post',
    url: '/incidents',
    data: { lat: 12.3, lng: 76.6, type: 'Accident', severity: 'High' },
    expected: 401,
    desc: 'Create incident without auth token',
  });

  if (createdIncidentId) {
    await testReq({
      url: `/incidents/${createdIncidentId}`,
      expected: 200,
      desc: 'Get incident by incidentId',
    });

    await testReq({
      method: 'patch',
      url: `/incidents/${createdIncidentId}/status`,
      token: citizenToken,
      data: { status: 'Verified' },
      expected: 403,
      desc: 'Citizen attempt to verify incident (forbidden)',
    });

    await testReq({
      method: 'patch',
      url: `/incidents/${createdIncidentId}/status`,
      token: adminToken,
      data: { status: 'Verified' },
      expected: 200,
      desc: 'Admin verify incident status',
    });

    await testReq({
      method: 'patch',
      url: `/incidents/${createdIncidentId}/status`,
      token: adminToken,
      data: { status: 'InvalidStatusName' },
      expected: 400,
      desc: 'Update incident with invalid status value',
    });

    await testReq({
      method: 'delete',
      url: `/incidents/${createdIncidentId}`,
      token: citizenToken,
      expected: 403,
      desc: 'Citizen attempt to delete incident (forbidden)',
    });

    await testReq({
      method: 'delete',
      url: `/incidents/${createdIncidentId}`,
      token: adminToken,
      expected: 200,
      desc: 'Admin delete incident',
    });
  }

  await testReq({
    url: '/incidents/NONEXISTENT-INCIDENT-999',
    expected: 404,
    desc: 'Get non-existent incident',
  });

  // 9. Analytics
  await testReq({
    url: '/analytics/summary',
    expected: 200,
    desc: 'Analytics summary stats',
  });

  await testReq({
    url: '/analytics/temporal',
    params: { granularity: 'hour' },
    expected: 200,
    desc: 'Analytics temporal by hour',
  });

  await testReq({
    url: '/analytics/temporal',
    params: { granularity: 'dayOfWeek' },
    expected: 200,
    desc: 'Analytics temporal by weekday',
  });

  await testReq({
    url: '/analytics/temporal',
    params: { granularity: 'month' },
    expected: 200,
    desc: 'Analytics temporal by month',
  });

  await testReq({
    url: '/analytics/temporal',
    params: { granularity: 'weekhour' },
    expected: 200,
    desc: 'Analytics temporal by weekhour matrix',
  });

  await testReq({
    url: '/analytics/temporal',
    params: { granularity: 'invalid_granularity' },
    expected: 400,
    desc: 'Analytics temporal with invalid granularity',
  });

  await testReq({
    url: '/analytics/severity',
    expected: 200,
    desc: 'Analytics severity mix and type grouping',
  });

  await testReq({
    url: '/analytics/areas',
    expected: 200,
    desc: 'Analytics areas ranking and risk scores',
  });

  await testReq({
    url: '/analytics/hotspots',
    params: { cell: 0.005 },
    expected: 200,
    desc: 'Analytics hotspots grid with 550m cell size',
  });

  await testReq({
    url: '/analytics/hotspots',
    params: { cell: 'bad_number' },
    expected: 200, // default fallback
    desc: 'Analytics hotspots with bad cell size string',
  });

  await testReq({
    url: '/analytics/heatmap',
    expected: 200,
    desc: 'Analytics density heatmap points',
  });

  await testReq({
    url: '/analytics/bounds',
    expected: 200,
    desc: 'Analytics geographic bounds and center',
    validator: (r) => r.data && Array.isArray(r.data.center),
  });

  // 10. Areas
  await testReq({
    url: '/areas',
    expected: 200,
    desc: 'List areas with boundaries',
  });

  await testReq({
    url: '/areas/Gokulam',
    expected: [200, 404],
    desc: 'Get specific area info',
  });

  await testReq({
    url: '/areas/NonExistentAreaName123',
    expected: 404,
    desc: 'Get non-existent area',
  });

  // 11. Datasets
  await testReq({
    url: '/datasets',
    expected: 200,
    desc: 'List uploaded datasets',
  });

  await testReq({
    url: '/datasets/limits',
    expected: 200,
    desc: 'Get dataset upload limits and database quota stats',
  });

  await testReq({
    url: '/datasets/sample-configs',
    expected: 200,
    desc: 'Get preset dataset configs',
  });

  await testReq({
    url: '/datasets/jobs/65f000000000000000000000',
    token: adminToken,
    expected: 404,
    desc: 'Get non-existent dataset import job',
  });

  await testReq({
    url: '/datasets/jobs/malformed-id',
    token: adminToken,
    expected: [400, 404],
    desc: 'Get dataset import job with malformed ID',
  });

  await testReq({
    url: '/datasets/65f000000000000000000000',
    expected: 404,
    desc: 'Get non-existent dataset record',
  });

  await testReq({
    method: 'delete',
    url: '/datasets/65f000000000000000000000',
    token: citizenToken,
    expected: 403,
    desc: 'Citizen delete dataset (forbidden)',
  });

  // 12. Reports export
  const csvRes = await testReq({
    url: '/reports/csv',
    params: { limit: 100 },
    expected: 200,
    desc: 'Export incidents as streaming CSV',
    validator: (r) => typeof r.data === 'string' && r.data.includes('incidentId'),
  });

  const pdfRes = await testReq({
    url: '/reports/pdf',
    expected: 200,
    desc: 'Export summary as PDF binary stream',
    validator: (r) => r.headers['content-type']?.includes('pdf') || String(r.data).slice(0, 5) === '%PDF-',
  });

  // 13. Audit Log
  await testReq({
    url: '/audit',
    token: adminToken,
    expected: 200,
    desc: 'Get audit log as admin',
  });

  await testReq({
    url: '/audit',
    token: citizenToken,
    expected: 403,
    desc: 'Get audit log as citizen (forbidden)',
  });

  await testReq({
    url: '/audit',
    expected: 401,
    desc: 'Get audit log without token',
  });

  // 14. 404 Not Found route
  await testReq({
    url: '/nonexistent-route-path',
    expected: 404,
    desc: 'Request unregistered route returns 404 with JSON { message }',
  });

  // Print results table
  console.log('\n========================================================================');
  console.log(' API TEST RESULTS SUMMARY');
  console.log('========================================================================\n');

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  console.log(`Total tests: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  console.log('| Endpoint | Test Case | Status | Expected | Result | Details |');
  console.log('|---|---|---|---|---|---|');
  results.forEach((r) => {
    const status = r.pass ? 'PASS' : '**FAIL**';
    console.log(`| \`${r.endpoint}\` | ${r.testCase} | ${r.actualStatus} | ${JSON.stringify(r.expectedStatus)} | ${status} | ${r.details || '-'} |`);
  });

  if (failed > 0) {
    console.error(`\nAPI Test suite completed with ${failed} failures.`);
    process.exit(1);
  } else {
    console.log('\nAll API tests PASSED with zero 500 errors and clean JSON contracts!');
  }
}

run();
