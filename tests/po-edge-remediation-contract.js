const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const poClientSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-po-client.js'), 'utf8');
const poHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const poApiSource = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'po-api', 'index.ts'), 'utf8');

console.log('=== Running PO Edge Remediation Contract Tests ===\n');

// 1. Check if po-api has full action coverage and RPC delegation
const requiredActions = [
  'getInitialData',
  'getProducts',
  'getDeliveryInsights',
  'createPO',
  'updatePO',
  'deleteBill',
  'deletePO',
  'approvePR',
  'rejectPR',
  'closePO'
];

for (const act of requiredActions) {
  const hasAction = poApiSource.includes(`action === '${act}'`) || poApiSource.includes(`action === "${act}"`);
  console.log(`PO API Action [${act}]: ${hasAction ? 'FOUND' : 'MISSING (Failing Regression)'}`);
}

// 2. Check granular authorization enforcement in po-api
const hasGranularAuth = poApiSource.includes('hasPermission') || poApiSource.includes('authorizeAction');
console.log(`\nPO API Granular Authorization: ${hasGranularAuth ? 'FOUND' : 'MISSING (Failing Regression)'}`);

// 3. Check if po-api delegates to atomic RPCs instead of raw REST multi-step mutations
const rpcs = [
  'po_create_direct_v1',
  'po_update_v1',
  'po_delete_v1',
  'po_decision_pr_v1',
  'po_close_v1'
];

for (const rpc of rpcs) {
  const hasRpc = poApiSource.includes(rpc);
  console.log(`PO API RPC delegation [${rpc}]: ${hasRpc ? 'FOUND' : 'MISSING (Failing Regression)'}`);
}

// 4. Check client methods in supabase-po-client.js
const requiredClientMethods = [
  'getProducts',
  'updatePO',
  'approvePR',
  'rejectPR',
  'closePO',
  'deleteBill'
];

for (const method of requiredClientMethods) {
  const hasMethod = poClientSource.includes(`${method}(`) || poClientSource.includes(`${method}:`);
  console.log(`PO Client Method [${method}]: ${hasMethod ? 'FOUND' : 'MISSING (Failing Regression)'}`);
}

console.log('\n=== Contract Check Finished ===');
