const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('async function loadInitialData(');
const end = html.indexOf('\n    function processDataAndRender', start);
const matchStart = html.indexOf('async function ensureMatchLoaded');
const matchEnd = html.indexOf('\n    async function ensureApvLoaded', matchStart);

assert(start >= 0 && end > start, 'loadInitialData must exist in index.html');
assert(matchStart >= 0 && matchEnd > matchStart, 'ensureMatchLoaded must exist in index.html');
const functionSource = html.slice(start, end);
const ensureMatchSource = html.slice(matchStart, matchEnd);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function runScenario(isManualRefresh) {
  const renderStates = [];
  const context = vm.createContext({ console });
  vm.runInContext(`
    var appData = {
      prList: [], pendingPOs: [], vendors: [], products: [],
      grCompleted: [{ uid: 'MATCH' }], apvList: [{ uid: 'APV' }]
    };
    var poMatchLoaded = true;
    var poApvLoaded = true;
    var poProductsLoaded = true;
    var poSecondaryDataGeneration = 0;
    var poActiveLoadGeneration = 0;
    var poActiveDataRendered = false;
    var initialDataPrefetch = null;
    const PO_ACTIVE_CACHE_TTL = 1;
    const PO_PRODUCTS_CACHE_TTL = 1;
    var renderStates = [];
    function getCache() { return null; }
    function setCache() {}
    function showDataLoading() {}
    function hideDataLoading() {}
    function showNotification() {}
    function scheduleProductsBackground() {}
    function processDataAndRender() {
      renderStates.push({ match: poMatchLoaded, apv: poApvLoaded });
    }
    async function readApiCall() {
      return { success: true, prList: [], pendingPOs: [], vendors: [] };
    }
    ${functionSource}
  `, context);

  await vm.runInContext(`loadInitialData(${isManualRefresh ? 'true' : 'false'})`, context);
  renderStates.push(...JSON.parse(JSON.stringify(context.renderStates)));
  return { context, renderStates };
}

async function runSecondaryInvalidationRace() {
  const match = deferred();
  const context = vm.createContext({ console, matchPromise: match.promise });
  vm.runInContext(`
    var appData = { prList: [], pendingPOs: [], vendors: [], products: [], grCompleted: [], apvList: [] };
    var poMatchLoaded = false;
    var poApvLoaded = false;
    var poProductsLoaded = true;
    var poSecondaryDataGeneration = 0;
    var poActiveLoadGeneration = 0;
    var poActiveDataRendered = false;
    var initialDataPrefetch = null;
    var groupedMatchData = {};
    const PO_ACTIVE_CACHE_TTL = 1;
    const PO_PRODUCTS_CACHE_TTL = 1;
    const PERF_MODE = false;
    const elements = new Map();
    var document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { innerHTML: '', innerText: '' }); return elements.get(id); } };
    var lucide = { createIcons() {} };
    function getCache() { return null; }
    function setCache() {}
    function showDataLoading() {}
    function hideDataLoading() {}
    function showNotification() {}
    function scheduleProductsBackground() {}
    function processDataAndRender() {}
    function groupGRData() {}
    function renderTab3_Match() {}
    async function readApiCall(action, data) {
      if (data && data.includeMatch === true) return matchPromise;
      return { success: true, prList: [], pendingPOs: [], vendors: [] };
    }
    ${ensureMatchSource}
    ${functionSource}
  `, context);

  const matchTask = vm.runInContext('ensureMatchLoaded()', context);
  await vm.runInContext('loadInitialData(true)', context);
  match.resolve({ success: true, grCompleted: [{ uid: 'STALE-MATCH' }] });
  await matchTask;
  return context;
}

async function runActiveLatestWinsRace() {
  const startup = deferred();
  const manual = deferred();
  const context = vm.createContext({ console, activePromises: [startup.promise, manual.promise] });
  vm.runInContext(`
    var appData = { prList: [], pendingPOs: [], vendors: [], products: [], grCompleted: [], apvList: [] };
    var poMatchLoaded = false;
    var poApvLoaded = false;
    var poProductsLoaded = true;
    var poSecondaryDataGeneration = 0;
    var poActiveLoadGeneration = 0;
    var poActiveDataRendered = false;
    var initialDataPrefetch = null;
    const PO_ACTIVE_CACHE_TTL = 1;
    const PO_PRODUCTS_CACHE_TTL = 1;
    function getCache() { return null; }
    function setCache() {}
    function showDataLoading() {}
    function hideDataLoading() {}
    function showNotification() {}
    function scheduleProductsBackground() {}
    function processDataAndRender() {}
    async function readApiCall() { return activePromises.shift(); }
    ${functionSource}
  `, context);

  const startupTask = vm.runInContext('loadInitialData(false)', context);
  const manualTask = vm.runInContext('loadInitialData(true)', context);
  manual.resolve({ success: true, prList: [], pendingPOs: [{ uid: 'NEW' }], vendors: [] });
  await manualTask;
  startup.resolve({ success: true, prList: [], pendingPOs: [{ uid: 'OLD' }], vendors: [] });
  await startupTask;
  return context;
}

(async () => {
  const startup = await runScenario(false);
  assert.strictEqual(startup.context.poMatchLoaded, true, 'startup active response must preserve a completed Match loader');
  assert.strictEqual(startup.context.poApvLoaded, true, 'startup active response must preserve a completed APV loader');
  assert.deepStrictEqual(startup.renderStates.at(-1), { match: true, apv: true });

  const manual = await runScenario(true);
  assert.strictEqual(manual.context.poMatchLoaded, false, 'manual refresh must invalidate Match data');
  assert.strictEqual(manual.context.poApvLoaded, false, 'manual refresh must invalidate APV data');
  assert.strictEqual(manual.context.appData.grCompleted.length, 0);
  assert.strictEqual(manual.context.appData.apvList.length, 0);

  const secondaryRace = await runSecondaryInvalidationRace();
  assert.strictEqual(secondaryRace.poMatchLoaded, false, 'manual refresh must invalidate an older in-flight Match read');
  assert.strictEqual(secondaryRace.appData.grCompleted.length, 0, 'stale Match response must not repopulate refreshed data');

  const activeRace = await runActiveLatestWinsRace();
  assert.strictEqual(activeRace.appData.pendingPOs[0].uid, 'NEW', 'older startup response must not overwrite a newer manual refresh');

  console.log('PASS po-startup-secondary-race: latest active read wins and manual refresh invalidates in-flight secondary reads');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
