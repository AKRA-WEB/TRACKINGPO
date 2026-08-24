const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const loadingStart = html.indexOf('function showDataLoading(');
const loadingEnd = html.indexOf('\n    function showNotification', loadingStart);
const loadStart = html.indexOf('async function loadInitialData(');
const loadEnd = html.indexOf('\n    function processDataAndRender', loadStart);
assert.ok(loadingStart >= 0 && loadingEnd > loadingStart, 'PO loading-state functions must exist');
assert.ok(loadStart >= 0 && loadEnd > loadStart, 'PO loadInitialData must exist');

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); }
  };
}

const elements = new Map([
  ['data-loader', { classList: classList(['hidden']), setAttribute() {} }],
  ['data-loader-text', { innerText: '' }],
  ['data-loader-spinner', { classList: classList() }],
  ['data-loader-retry', { classList: classList(['hidden']) }]
]);
const context = vm.createContext({ console });
Object.assign(context, {
  document: { getElementById(id) { return elements.get(id) || { classList: classList(), innerText: '', setAttribute() {} }; } },
  appData: { prList: [], pendingPOs: [], grCompleted: [], apvList: [], vendors: [], products: [] },
  poMatchLoaded: false,
  poApvLoaded: false,
  poProductsLoaded: false,
  poSecondaryDataGeneration: 0,
  poActiveLoadGeneration: 0,
  poActiveDataRendered: false,
  initialDataPrefetch: null,
  PO_ACTIVE_CACHE_TTL: 1,
  PO_PRODUCTS_CACHE_TTL: 1,
  getCache() { return null; },
  setCache() {},
  showNotification() {},
  scheduleProductsBackground() {},
  processDataAndRender() {},
  async readApiCall() { return { success: false, message: 'session_not_ready' }; }
});
vm.runInContext(`${html.slice(loadingStart, loadingEnd)}\n${html.slice(loadStart, loadEnd)}`, context);

(async () => {
  await vm.runInContext('loadInitialData(false)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), false, 'cold-start failure must keep a full-page status visible');
  assert.equal(elements.get('data-loader-spinner').classList.contains('hidden'), true, 'failure state must stop the spinner');
  assert.equal(elements.get('data-loader-retry').classList.contains('hidden'), false, 'failure state must provide a retry action');
  assert.match(elements.get('data-loader-text').innerText, /ไม่สำเร็จ|เชื่อมต่อ/, 'failure state must explain that data did not load');

  context.readApiCall = async () => ({ success: true, prList: [], pendingPOs: [], vendors: [] });
  await vm.runInContext('loadInitialData(true)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), true, 'successful retry must dismiss the loading state');

  elements.get('data-loader').classList.add('hidden');
  context.getCache = key => key === 'CACHE_PO_ACTIVE_V3' ? { prList: [], pendingPOs: [], vendors: [] } : null;
  context.processDataAndRender = () => { throw new Error('corrupt cache shape'); };
  context.poActiveDataRendered = false;
  context.readApiCall = async () => ({ success: false, message: 'network_failed' });
  await vm.runInContext('loadInitialData(false)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), false, 'unusable cache plus network failure must not leave an endless spinner or empty shell');
  assert.equal(elements.get('data-loader-spinner').classList.contains('hidden'), true, 'unusable cache failure must stop the spinner');
  assert.equal(elements.get('data-loader-retry').classList.contains('hidden'), false, 'unusable cache failure must remain retryable');

  await vm.runInContext('loadInitialData(true)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), false, 'failed retry after unusable cache must keep the retryable error visible');
  assert.equal(elements.get('data-loader-retry').classList.contains('hidden'), false, 'failed retry after unusable cache must not expose an empty shell');

  elements.get('data-loader').classList.add('hidden');
  context.processDataAndRender = () => {};
  context.poActiveDataRendered = false;
  await vm.runInContext('loadInitialData(false)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), true, 'usable cached UI must remain available when its background refresh fails');
  console.log('PASS po-startup-loading-state: cold-start failures remain visible and retryable');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
