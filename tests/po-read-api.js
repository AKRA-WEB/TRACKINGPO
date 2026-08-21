const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('async function readApiCall');
const end = html.indexOf('\n    async function ', start + 1);

assert(start >= 0 && end > start, 'readApiCall must exist in index.html');
const functionSource = html.slice(start, end);

(async () => {
  // Test 1: getInitialData
  {
    let receivedPayload = null;
    let receivedToken = null;
    const context = vm.createContext({
      console,
      AppVersionGuard: { blockIfStale: async () => false },
      getSessionToken: () => 'token-123',
      AkraSupabasePO: {
        getInitialData: async (payload, token) => {
          receivedPayload = payload;
          receivedToken = token;
          return {
            pendingPOs: [{ uid: 'item-1', status: 'Pending GR' }],
            grCompleted: [{ uid: 'item-2', status: 'GR Completed' }],
            prList: [{ prId: 'PR-1' }],
            apvList: [{ uid: 'item-3' }],
            vendors: ['Vendor A']
          };
        }
      }
    });
    vm.runInContext(functionSource, context);
    const res = await vm.runInContext("readApiCall('getInitialData', { includeCompleted: true })", context);
    assert.strictEqual(res.success, true);
    assert.strictEqual(receivedToken, 'token-123');
    assert.strictEqual(receivedPayload.includeCompleted, true);
    assert.strictEqual(res.pendingPOs.length, 1);
    assert.strictEqual(res.grCompleted.length, 1);
    assert.strictEqual(res.prList.length, 1);
    assert.strictEqual(res.apvList.length, 1);
    assert.deepStrictEqual(res.vendors, ['Vendor A']);
  }

  // Test 2: getProducts
  {
    const context = vm.createContext({
      console,
      AppVersionGuard: { blockIfStale: async () => false },
      getSessionToken: () => 'token-123',
      AkraSupabasePO: {
        getProducts: async () => ({
          products: [
            { sku: 'SKU1', name: 'Product 1', vendor: 'Vendor 1' },
            { sku: 'SKU2', name: 'Product 2', default_vendor: 'Vendor 2' }
          ]
        })
      }
    });
    vm.runInContext(functionSource, context);
    const res = await vm.runInContext("readApiCall('getProducts')", context);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.products.length, 2);
    assert.strictEqual(JSON.stringify(res.vendors.sort()), JSON.stringify(['Vendor 1', 'Vendor 2']));
  }

  // Test 3: Stale version block
  {
    let called = false;
    const context = vm.createContext({
      console,
      AppVersionGuard: { blockIfStale: async () => true },
      getSessionToken: () => 'token-123',
      AkraSupabasePO: {
        getInitialData: async () => { called = true; return {}; }
      }
    });
    vm.runInContext(functionSource, context);
    const res = await vm.runInContext("readApiCall('getInitialData')", context);
    assert.strictEqual(res.success, false);
    assert.match(res.message, /เวอร์ชันใหม่/);
    assert.strictEqual(called, false);
  }

  // Test 4: Error handling fail-safe
  {
    const context = vm.createContext({
      console,
      AppVersionGuard: { blockIfStale: async () => false },
      getSessionToken: () => 'token-123',
      AkraSupabasePO: {
        getInitialData: async () => { throw new Error('database_unavailable'); }
      }
    });
    vm.runInContext(functionSource, context);
    const res = await vm.runInContext("readApiCall('getInitialData')", context);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.message, 'database_unavailable');
  }

  console.log('PASS po-read-api: readApiCall delegates to AkraSupabasePO, maps projections, checks stale version, and fails closed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
