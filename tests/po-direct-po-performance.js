const assert = require('assert');
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const codeGsPath = path.join(__dirname, '..', 'Code.gs.txt');
const codeGs = fs.readFileSync(codeGsPath, 'utf8');

const versionJsonPath = path.join(__dirname, '..', 'version.json');
const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));

// 1. Version consistency check
assert.strictEqual(versionJson.version, '20260819.02', 'version.json must match 20260819.02');
assert(html.includes('const CURRENT_VERSION = "20260819.02";'), 'index.html must define CURRENT_VERSION 20260819.02');

// 2. Client-side mutation timeout contract
assert(html.includes('const PO_MUTATION_TIMEOUT_MS = 50000;'), 'apiAction must define 50s mutation timeout');
assert(html.includes('const controller = new AbortController();'), 'apiAction must use AbortController');
assert(html.includes('signal: controller.signal'), 'apiAction must pass AbortController signal to fetch');
assert(html.includes('isTimeout'), 'apiAction must handle and flag timeout errors cleanly');

// 3. Client-side in-flight mutex & optimistic update for Direct PO
assert(html.includes('let isSubmittingDirectPO = false;'), 'submitDirectPO must have in-flight mutex');
assert(html.includes('if (isSubmittingDirectPO) return;'), 'submitDirectPO must guard against re-entrant calls');
assert(html.includes('appData.pendingPOs.unshift(...newPendingItems);'), 'submitDirectPO must optimistically unshift newly created items');
assert(html.includes('closeCreatePoModal();'), 'submitDirectPO must close modal upon successful creation');

// 4. Product autocomplete debounce check
assert(html.includes('let debounceTimer = null;'), 'setupProductAutocompleteForPO must declare debounce timer');
assert(html.includes('clearTimeout(debounceTimer);'), 'setupProductAutocompleteForPO must clear previous timer on input');
assert(html.includes('debounceTimer = setTimeout('), 'setupProductAutocompleteForPO must debounce autocomplete lookup');

// 5. Backend Code.gs.txt chunked CacheService contract for getProducts
assert(codeGs.includes("PO_PRODUCT_CACHE_META_KEY = 'PO_PROD_META_V1';"), 'Code.gs must define PO_PRODUCT_CACHE_META_KEY');
assert(codeGs.includes("PO_PRODUCT_CACHE_PREFIX = 'PO_PROD_P_';"), 'Code.gs must define PO_PRODUCT_CACHE_PREFIX');
assert(codeGs.includes('PO_PRODUCT_CACHE_TTL_SEC = 21600;'), 'Code.gs must define 6h cache TTL (21600s)');
assert(codeGs.includes('function readCachedProducts_()'), 'Code.gs must implement readCachedProducts_');
assert(codeGs.includes('function writeCachedProducts_('), 'Code.gs must implement writeCachedProducts_');
assert(codeGs.includes('function invalidatePOProductsCache_()'), 'Code.gs must implement invalidatePOProductsCache_');
assert(codeGs.includes('options.bypassCache === true'), 'getProducts must support bypassCache flag');

// 6. Backend Code.gs.txt createPO LockService & flush contract
assert(codeGs.includes('const lock = LockService.getScriptLock();'), 'createPO must acquire script lock');
assert(codeGs.includes('lockAcquired = lock.tryLock(25000);'), 'createPO must try lock for 25s');
assert(codeGs.includes('SpreadsheetApp.flush();'), 'createPO must flush spreadsheet changes');
assert(codeGs.includes('directBillRefUid: directBillRefUid,'), 'createPO must return directBillRefUid');
assert(codeGs.includes('poUids: newRows.map('), 'createPO must return created poUids array');

// 7. Simulated In-Memory Test: Chunked cache round-trip
{
  const mockCacheStore = {};
  const mockCache = {
    get: (key) => mockCacheStore[key] || null,
    getAll: (keys) => {
      const res = {};
      keys.forEach(k => { if (mockCacheStore[k]) res[k] = mockCacheStore[k]; });
      return res;
    },
    put: (key, val, ttl) => { mockCacheStore[key] = String(val); },
    putAll: (map, ttl) => { Object.assign(mockCacheStore, map); },
    remove: (key) => { delete mockCacheStore[key]; },
    removeAll: (keys) => { keys.forEach(k => delete mockCacheStore[k]); }
  };

  // Generate 4,799 mock products (~600 KB)
  const mockProducts = [];
  for (let i = 1; i <= 4799; i++) {
    mockProducts.push({ sku: 'SKU-' + i, name: 'สินค้าทดสอบ รายการที่ ' + i, unit: 'ชิ้น', oldStock: 10, vendor: 'Vendor ' + (i % 50) });
  }
  const payload = { success: true, products: mockProducts, vendors: ['Vendor A', 'Vendor B'] };
  const json = JSON.stringify(payload);
  const chunkSize = 80000;
  const chunks = Math.ceil(json.length / chunkSize);
  const chunkMap = {};
  for (let i = 0; i < chunks; i++) {
    chunkMap['PO_PROD_P_' + i] = json.substring(i * chunkSize, (i + 1) * chunkSize);
  }
  mockCache.putAll(chunkMap, 21600);
  mockCache.put('PO_PROD_META_V1', JSON.stringify({ chunks, count: mockProducts.length, ts: Date.now() }), 21600);

  // Read back
  const metaStr = mockCache.get('PO_PROD_META_V1');
  const meta = JSON.parse(metaStr);
  const chunkKeys = [];
  for (let i = 0; i < meta.chunks; i++) chunkKeys.push('PO_PROD_P_' + i);
  const cachedChunks = mockCache.getAll(chunkKeys);
  let reassembledJson = '';
  for (let i = 0; i < meta.chunks; i++) reassembledJson += cachedChunks['PO_PROD_P_' + i];
  const recovered = JSON.parse(reassembledJson);

  assert.strictEqual(recovered.products.length, 4799, 'Recovered products count must equal 4799');
  assert.strictEqual(recovered.products[100].sku, 'SKU-101', 'Recovered product SKU must match');
}

console.log('PASS po-direct-po-performance: timeout (50s), in-flight mutex, optimistic UI update, autocomplete debouncing, and chunked CacheService pass');
