const assert = require('assert');
const fs = require('fs');
const path = require('path');
const poClient = require('../js/supabase-po-client.js');

async function runTests() {
  console.log('=== TESTING PO SUPABASE API CLIENT CONTRACT ===\n');

  const clientSource = fs.readFileSync(path.join(__dirname, '../js/supabase-po-client.js'), 'utf8');

  // 1. Browser client must contain zero secrets
  assert.doesNotMatch(clientSource, /eyJ[a-zA-Z0-9_-]{20,}/, 'Client source must not contain hardcoded JWT or service_role key');
  assert.doesNotMatch(clientSource, /SUPABASE_SERVICE_ROLE_KEY/, 'Client source must not reference service_role key');

  // 2. Browser client must call only the authenticated Edge Function
  assert.match(clientSource, /https:\/\/hgxrrskztbpejirrdpbq\.supabase\.co\/functions\/v1\/po-api/, 'Client must route via po-api Edge Function');

  // 3. Unauthenticated call must fail-closed
  let threwNoToken = false;
  try {
    await poClient.getInitialData({}, '');
  } catch (err) {
    threwNoToken = true;
    assert.match(err.message, /เข้าสู่ระบบ|no_token/i, 'Must require user token');
  }
  assert.strictEqual(threwNoToken, true, 'Unauthenticated call must throw');

  console.log('PASS supabase-po-test: credential-free browser client calls only the authenticated PO Edge Function');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
