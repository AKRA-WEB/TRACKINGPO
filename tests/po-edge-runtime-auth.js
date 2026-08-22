const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('=== Running Executable PO Edge Runtime Auth & Insights Tests ===\n');

const poApiSource = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'po-api', 'index.ts'), 'utf8');
const sharedJwtSource = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', '_shared', 'main-jwt.ts'), 'utf8')
  .replace(/^export\s+/gm, '');

// Strip TypeScript types to execute in Node VM
function transpileTsToJs(tsCode) {
  return tsCode
    .replace(/\r\n/g, '\n')
    .replace(/^import\b.*$/gm, '// $&')
    .replace(/^type\s+[A-Za-z0-9_]+\s*=.*$/gm, '// $&')
    .replace(/declare\s+const\s+Deno[\s\S]*?;\n\};/g, '// Deno')
    .replace(/new\s+Map<[^>\n]+>\(\)/g, 'new Map()')
    .replace(/new\s+Set<[^>\n]+>\(\)/g, 'new Set()')
    .replace(/\bas\s+[A-Za-z0-9_<>\[\]]+/g, '')
    .replace(/interface\s+[A-Za-z0-9_]+\s*\{[\s\S]*?\}/g, '')
    .replace(/\):\s*Promise<\{[\s\S]*?\}\s*>\s*\{/g, ') {')
    .replace(/\):\s*\{[\s\S]*?\}\s*\{/g, ') {')
    .replace(/\):\s*[A-Za-z0-9_<>\[\],| ]+\s*\{/g, ') {')
    .replace(/(function\s+[A-Za-z0-9_$]+\s*)\(([^)]*)\)/g, (m, fn, params) => {
      const cleaned = params.split(',').map(p => p.split(':')[0].trim()).join(', ');
      return fn + '(' + cleaned + ')';
    })
    .replace(/\(([A-Za-z0-9_$,\s:]+)\)\s*=>/g, (m, params) => {
      const cleaned = params.split(',').map(p => p.split(':')[0].trim()).join(', ');
      return '(' + cleaned + ') =>';
    })
    .replace(/\b(const|let|var)\s+([A-Za-z0-9_$]+)\s*:\s*[A-Za-z0-9_<>\[\],| ]+\s*=/g, '$1 $2 =')
    .replace(/catch\s*\(\s*([A-Za-z0-9_$]+)\s*:\s*[A-Za-z0-9_]+\s*\)/g, 'catch ($1)')
    .replace(/\)!([.;,\s\)])/g, ')$1')
    .replace(/([A-Za-z0-9_$]+)!([.;,\s\)])/g, '$1$2');
}

const jsCode = transpileTsToJs(`${sharedJwtSource}\n${poApiSource}`);

function createEdgeRuntime(mockDbState = {}) {
  const dbCalls = {
    restQueries: [],
    rpcCalls: []
  };

  let edgeHandler = null;

  const context = {
    console: console,
    URLSearchParams: URLSearchParams,
    URL: URL,
    Headers: Headers,
    Request: Request,
    Response: Response,
    Map: Map,
    Set: Set,
    Date: Date,
    JSON: JSON,
    Math: Math,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    RegExp: RegExp,
    Error: Error,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    atob: atob,
    btoa: btoa,
    crypto: globalThis.crypto,
    Deno: {
      env: {
        get: (k) => {
          if (k === 'MAIN_JWT_SECRET') return 'test-main-jwt-secret-at-least-32-characters';
          if (k === 'SUPABASE_URL') return 'https://mock-sb.app';
          if (k === 'PO_SUPABASE_SECRET_KEY') return 'sb_secret_test-server-key';
          if (k === 'PO_ALLOWED_ORIGINS') return 'https://akra-web.github.io';
          return '';
        }
      },
      serve: (handler) => {
        edgeHandler = handler;
      }
    },
    fetch: async (url, opts = {}) => {
      const urlStr = String(url);
      if (urlStr.includes('/rest/v1/rpc/')) {
        assert.equal(new Headers(opts.headers || {}).has('Authorization'), false, 'Modern Supabase secret keys must not be sent as bearer JWTs');
        const rpcName = urlStr.split('/rpc/')[1].split('?')[0];
        const body = opts.body ? JSON.parse(opts.body) : {};
        dbCalls.rpcCalls.push({ rpc: rpcName, body });
        if (rpcName === 'auth_validate_session_v1') {
          return {
            ok: true,
            headers: new Headers(),
            json: async () => ({ valid: mockDbState.sessionValid !== false })
          };
        }
        if (mockDbState.rpcError) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ message: mockDbState.rpcError })
          };
        }
        return {
          ok: true,
          json: async () => ({ success: true, result: 'mock_rpc_ok' })
        };
      }
      if (urlStr.includes('/rest/v1/')) {
        assert.equal(new Headers(opts.headers || {}).has('Authorization'), false, 'Modern Supabase secret keys must not be sent as bearer JWTs');
        const query = urlStr.split('/rest/v1/')[1];
        dbCalls.restQueries.push({ query, method: opts.method || 'GET' });

        // Mock table returns
        let data = [];
        if (query.startsWith('purchase_orders?')) {
          data = mockDbState.purchase_orders || [];
        } else if (query.startsWith('purchase_order_items?')) {
          data = mockDbState.purchase_order_items || [];
        } else if (query.startsWith('goods_receipts?')) {
          data = mockDbState.goods_receipts || [];
        } else if (query.startsWith('purchase_requests?')) {
          data = mockDbState.purchase_requests || [];
        } else if (query.startsWith('vendors?')) {
          data = mockDbState.vendors || [];
        } else if (query.startsWith('products?')) {
          data = mockDbState.products || [];
        }
        return {
          ok: true,
          headers: new Map([['content-range', `0-${data.length}/${data.length}`]]),
          json: async () => data
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
    },
    dbCalls
  };

  const vmContext = vm.createContext(context);
  vm.runInContext(jsCode, vmContext);

  async function handleRequest(action, data = {}, user = null, token = 'test-token') {
    if (user) {
      const { legacyToken, ...claims } = user;
      token = await vmContext.signMainJwt({
        ...claims,
        name: user.name || user.id,
        mustChangePassword: false,
        ...(legacyToken ? {} : {
          tokenVersion: 2,
          sessionVersion: user.sessionVersion || 1,
          authorizationRevision: user.authorizationRevision || 'revision-1'
        }),
        exp: Date.now() + 60000
      }, 'test-main-jwt-secret-at-least-32-characters');
    }
    const req = new Request('https://mock-sb.app/functions/v1/po-api', {
      method: 'POST',
      headers: {
        'Origin': 'https://akra-web.github.io',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, data, token })
    });
    const res = await edgeHandler(req);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  return { context: vmContext, dbCalls, handleRequest };
}

async function runTests() {
  console.log('Test 0: Testing forged JWT denial before database access...');
  {
    const runtime = createEdgeRuntime({ products: [{ id: 'p-forged', name: 'Forged Access' }] });
    const forgedPayload = Buffer.from(JSON.stringify({
      id: 'attacker',
      name: 'Attacker',
      roles: ['ADMIN'],
      perms: { 'app-po': ['read', 'createPO'] },
      exp: Date.now() + 60000
    })).toString('base64url');
    const result = await runtime.handleRequest('getProducts', {}, null, `e30.${forgedPayload}.forged`);
    assert.equal(result.status, 401, 'forged JWT must return HTTP 401');
    assert.equal(runtime.dbCalls.restQueries.length, 0, 'forged JWT must issue zero REST queries');
    assert.equal(runtime.dbCalls.rpcCalls.length, 0, 'forged JWT must issue zero RPC calls');
    console.log('  [PASS] Forged JWT is denied with zero database calls.');
  }

  // Test 1: Explicit-Empty Permissions Deny Read and Write with ZERO Database Calls
  console.log('Test 1: Testing explicit-empty perms [app-po: []] with ADMIN role (HTTP Handler)...');
  {
    const runtime = createEdgeRuntime();
    const userWithExplicitEmpty = {
      id: 'admin_empty',
      name: 'Admin Empty Perms',
      roles: ['ADMIN', 'SUPERVISOR'],
      perms: {
        'app-po': [] // explicit empty permission contract
      }
    };

    const actionsToTest = [
      { action: 'getInitialData', data: {} },
      { action: 'getProducts', data: {} },
      { action: 'getDeliveryInsights', data: {} },
      { action: 'createPO', data: { poNumber: 'PO-1' } },
      { action: 'updatePO', data: { refPrUid: 'PR-1' } },
      { action: 'deletePO', data: { poId: 'po-1' } },
      { action: 'closePO', data: { poId: 'po-1' } }
    ];

    for (const testItem of actionsToTest) {
      const initialDbRestCount = runtime.dbCalls.restQueries.length;
      const initialDbRpcCount = runtime.dbCalls.rpcCalls.length;

      const res = await runtime.handleRequest(testItem.action, testItem.data, userWithExplicitEmpty);

      assert.equal(res.status, 403, `Action ${testItem.action} MUST return HTTP status 403 on explicit-empty perms (got ${res.status})`);
      assert.equal(res.body.reason, 'permission_denied', `Action ${testItem.action} MUST return reason 'permission_denied'`);

      // CRITICAL ASSERTION: Prove ZERO database REST or RPC queries were issued
      const restDelta = runtime.dbCalls.restQueries.length - initialDbRestCount;
      const rpcDelta = runtime.dbCalls.rpcCalls.length - initialDbRpcCount;
      assert.equal(restDelta, 0, `Action ${testItem.action} MUST issue 0 REST queries on permission denial (got ${restDelta})`);
      assert.equal(rpcDelta, 0, `Action ${testItem.action} MUST issue 0 RPC calls on permission denial (got ${rpcDelta})`);
    }
    console.log('  [PASS] Explicit-empty permissions strictly return HTTP 403 and issue ZERO database calls.');
  }

  // Test 2: Legacy Token without app-po Contract allows fallback for ADMIN
  console.log('\nTest 2: Testing legacy token without app-po contract key for ADMIN role...');
  {
    const runtime = createEdgeRuntime({
      products: [{ id: 'p1', name: 'Product 1', is_active: true }]
    });
    const legacyAdminUser = {
      id: 'legacy_admin',
      name: 'Legacy Admin',
      roles: ['ADMIN'],
      perms: {}, // no app-po key at all
      legacyToken: true
    };

    const res = await runtime.handleRequest('getProducts', {}, legacyAdminUser);
    assert.equal(res.status, 200, 'Legacy ADMIN should return HTTP 200 via fallback');
    assert.ok(res.body.success, 'Legacy ADMIN should succeed getProducts');
    assert.ok(runtime.dbCalls.restQueries.length > 0, 'Database queries should be executed for authorized user');
    console.log('  [PASS] Legacy token correctly falls back to ADMIN role when app-po is undefined.');
  }

  console.log('\nTest 2B: Testing v2 token without an app-po permission contract...');
  {
    const runtime = createEdgeRuntime();
    const result = await runtime.handleRequest('getProducts', {}, {
      id: 'v2_admin_missing_contract',
      roles: ['ADMIN'],
      perms: {}
    });
    assert.equal(result.status, 403, 'v2 ADMIN without app-po grants must fail closed');
    assert.equal(result.body.reason, 'permission_denied');
    assert.equal(runtime.dbCalls.restQueries.length, 0, 'permission denial must issue zero REST queries');
    assert.equal(runtime.dbCalls.rpcCalls.length, 0, 'permission denial must issue zero RPC calls');
    console.log('  [PASS] v2 missing permission contract fails closed before database access.');
  }

  console.log('\nTest 2C: Testing revoked v2 session denial...');
  {
    const runtime = createEdgeRuntime({ sessionValid: false });
    const result = await runtime.handleRequest('getProducts', {}, {
      id: 'revoked_user',
      roles: ['USER'],
      perms: { 'app-po': ['read'] }
    });
    assert.equal(result.status, 401, 'revoked session must return HTTP 401');
    assert.equal(result.body.reason, 'invalid_or_expired_token');
    assert.equal(runtime.dbCalls.restQueries.length, 0, 'revoked session must not query domain tables');
    assert.deepEqual(
      runtime.dbCalls.rpcCalls.map(call => call.rpc),
      ['auth_validate_session_v1'],
      'revoked session may call only the private session validator'
    );
    console.log('  [PASS] Revoked v2 session is rejected before domain database access.');
  }

  // Test 3: Read-Only Granular Permission ['read'] allows read, denies write
  console.log('\nTest 3: Testing granular read-only permission [read]...');
  {
    const runtime = createEdgeRuntime({
      products: [{ id: 'p1', name: 'Product 1', is_active: true }]
    });
    const readOnlyUser = {
      id: 'readonly_usr',
      name: 'Read Only User',
      roles: ['USER'],
      perms: {
        'app-po': ['read']
      }
    };

    // Read should succeed
    const readRes = await runtime.handleRequest('getProducts', {}, readOnlyUser);
    assert.equal(readRes.status, 200, 'Read-only user should get HTTP 200 on getProducts');
    assert.ok(readRes.body.success, 'Read-only user should succeed on getProducts');

    // Write should fail with HTTP 403 and 0 RPC calls
    const initialRpcCount = runtime.dbCalls.rpcCalls.length;
    const writeRes = await runtime.handleRequest('createPO', { poNumber: 'PO-1' }, readOnlyUser);
    assert.equal(writeRes.status, 403, 'createPO must return HTTP 403 for read-only user');
    assert.equal(writeRes.body.reason, 'permission_denied', 'createPO must return reason permission_denied');
    assert.equal(runtime.dbCalls.rpcCalls.length - initialRpcCount, 0, '0 RPC calls must be made on write denial');
    console.log('  [PASS] Read-only permission correctly allows read and denies write with 0 RPC calls.');
  }

  // Test 4: Delivery Insights Calculation, Sample Count, and Null Rate
  console.log('\nTest 4: Testing Delivery Insights calculation with cancelled filter & honest sample rates...');
  {
    const mockPOs = [
      // Order 1: On-time (expected 2026-08-10, received 2026-08-09)
      {
        id: 'po-1',
        vendor_name: 'Vendor Best',
        expected_date: '2026-08-10',
        status: 'GR Completed',
        items: [{ id: 'poi-1', expected_date: '2026-08-10', status: 'GR Completed' }],
        receipts: [{ id: 'gr-1', ata_date: '2026-08-09', status: 'GR Completed', gr_items: [{ po_item_id: 'poi-1' }] }]
      },
      // Order 2: Late (expected 2026-08-10, received 2026-08-12)
      {
        id: 'po-2',
        vendor_name: 'Vendor Best',
        expected_date: '2026-08-10',
        status: 'GR Completed',
        items: [{ id: 'poi-2', expected_date: '2026-08-10', status: 'GR Completed' }],
        receipts: [{ id: 'gr-2', ata_date: '2026-08-12', status: 'GR Completed', gr_items: [{ po_item_id: 'poi-2' }] }]
      },
      // Order 3: Cancelled receipt (should be ignored, 0 sample)
      {
        id: 'po-3',
        vendor_name: 'Vendor Cancelled',
        expected_date: '2026-08-10',
        status: 'Completed',
        items: [{ id: 'poi-3', expected_date: '2026-08-10', status: 'Completed' }],
        receipts: [{ id: 'gr-3', ata_date: '2026-08-09', status: 'Cancelled', gr_items: [{ po_item_id: 'poi-3' }] }]
      },
      // Order 4: No receipts at all (0 sample)
      {
        id: 'po-4',
        vendor_name: 'Vendor No Receipt',
        expected_date: '2026-08-10',
        status: 'Completed',
        items: [{ id: 'poi-4', expected_date: '2026-08-10', status: 'Completed' }],
        receipts: []
      }
    ];

    const runtime = createEdgeRuntime({ purchase_orders: mockPOs });
    const authUser = { id: 'u1', roles: ['ADMIN'], perms: { 'app-po': ['read'] } };

    const result = await runtime.handleRequest('getDeliveryInsights', {}, authUser);
    assert.equal(result.status, 200, 'getDeliveryInsights must return HTTP 200');
    assert.ok(result.body.success, 'getDeliveryInsights must succeed');
    assert.ok(Array.isArray(result.body.insights), 'insights must be an array');

    const vendorBest = result.body.insights.find(i => i.vendor === 'Vendor Best');
    assert.ok(vendorBest, 'Vendor Best must be present');
    assert.equal(vendorBest.totalOrders, 2, 'Vendor Best total orders should be 2');
    assert.equal(vendorBest.sampleCount, 2, 'Vendor Best sample count should be 2');
    assert.equal(vendorBest.onTimeRate, 50, 'Vendor Best onTimeRate should be 50% (1 on-time out of 2 samples)');

    const vendorCancelled = result.body.insights.find(i => i.vendor === 'Vendor Cancelled');
    assert.ok(vendorCancelled, 'Vendor Cancelled must be present');
    assert.equal(vendorCancelled.sampleCount, 0, 'Cancelled receipts must NOT produce delivery samples');
    assert.equal(vendorCancelled.onTimeRate, null, '0 samples must return onTimeRate: null (never 100%)');

    const vendorNoReceipt = result.body.insights.find(i => i.vendor === 'Vendor No Receipt');
    assert.ok(vendorNoReceipt, 'Vendor No Receipt must be present');
    assert.equal(vendorNoReceipt.sampleCount, 0, 'No receipts must produce 0 samples');
    assert.equal(vendorNoReceipt.onTimeRate, null, '0 samples must return onTimeRate: null');

    console.log('  [PASS] Delivery insights correctly filter cancelled receipts and return null on 0 samples.');
  }

  // 5. Test Finding 1 & 7: getInitialData / getProducts response shapes & unmatched receipt isolation
  console.log('\nTest 5: Testing getInitialData and getProducts response structure & unmatched receipt isolation...');
  {
    const runtime = createEdgeRuntime({
      purchase_orders: [{ id: 'po-10', vendor_name: 'Vendor X', status: 'Pending GR', items: [] }],
      purchase_requests: [{ id: 'pr-10', status: 'Pending', items: [] }],
      vendors: [{ name: 'Vendor X' }],
      products: [{ id: 'prod-1', sku: 'SKU1', name: 'Product 1', is_active: true }]
    });
    const authUser = { id: 'u1', roles: ['ADMIN'], perms: { 'app-po': ['read'] } };

    // 5A: getInitialData returns both top-level and nested fields
    const initRes = await runtime.handleRequest('getInitialData', {}, authUser);
    assert.equal(initRes.status, 200, 'getInitialData must return 200');
    assert.ok(Array.isArray(initRes.body.pendingPOs), 'pendingPOs must be at top-level');
    assert.ok(Array.isArray(initRes.body.prList), 'prList must be at top-level');
    assert.ok(Array.isArray(initRes.body.grCompleted), 'grCompleted must be at top-level');
    assert.ok(Array.isArray(initRes.body.apvList), 'apvList must be at top-level');
    assert.ok(Array.isArray(initRes.body.vendors), 'vendors must be at top-level');
    assert.ok(initRes.body.data && Array.isArray(initRes.body.data.pendingPOs), 'data.pendingPOs must be present for backward compatibility');

    // 5B: getProducts returns both top-level and nested products
    const prodRes = await runtime.handleRequest('getProducts', {}, authUser);
    assert.equal(prodRes.status, 200, 'getProducts must return 200');
    assert.ok(Array.isArray(prodRes.body.products), 'products must be at top-level');
    assert.ok(prodRes.body.data && Array.isArray(prodRes.body.data.products), 'data.products must be present for compatibility');
    assert.equal(prodRes.body.products[0].sku, 'SKU1');

    // 5C: Unmatched receipt in Delivery Insights must NOT be falsely assigned
    const unmatchedRuntime = createEdgeRuntime({
      purchase_orders: [
        {
          id: 'po-unmatched',
          vendor_name: 'Vendor Unmatched',
          status: 'Completed',
          items: [{ id: 'poi-C', expected_date: '2026-08-01', status: 'Completed' }],
          // Receipt 1 belongs to item D, NOT item C!
          receipts: [{ id: 'gr-diff', ata_date: '2026-08-01', status: 'Completed', gr_items: [{ po_item_id: 'poi-D' }] }]
        }
      ]
    });
    const insightsRes = await unmatchedRuntime.handleRequest('getDeliveryInsights', {}, authUser);
    const unmatchStat = insightsRes.body.insights.find(i => i.vendor === 'Vendor Unmatched');
    assert.ok(unmatchStat, 'Vendor Unmatched must be present');
    assert.equal(unmatchStat.sampleCount, 0, 'Unmatched receipt item must NOT be falsely counted as a sample');
    assert.equal(unmatchStat.onTimeRate, null, 'Unmatched receipt must yield onTimeRate: null');

    console.log('  [PASS] Response shapes provide both top-level and nested properties; unmatched receipt ATA is not falsely inherited.');
  }

  // 6. Completed-item projection must round-trip the PO number from its matching receipt
  console.log('\nTest 6: Testing per-item receipt PO number projection...');
  {
    const runtime = createEdgeRuntime({
      purchase_orders: [{
        id: 'po-per-item',
        po_number: 'HEADER-LAST-VALUE',
        ref_pr_uid: 'shared-pr',
        vendor_name: 'Vendor Per Item',
        status: 'GR Completed',
        items: [
          { id: 'poi-per-a', product_name: 'Item A', po_qty: 1, status: 'GR Completed' },
          { id: 'poi-per-b', product_name: 'Item B', po_qty: 1, status: 'GR Completed' }
        ],
        receipts: [
          { id: 'gr-per-a', po_number: 'PO-ITEM-A', status: 'GR Completed', remark: 'Header remark', gr_items: [{ id: 'gri-a', po_item_id: 'poi-per-a', gr_qty: 1, remark: 'Item-specific Match remark' }] },
          { id: 'gr-per-b', po_number: 'PO-ITEM-B', status: 'GR Completed', gr_items: [{ id: 'gri-b', po_item_id: 'poi-per-b', gr_qty: 1 }] }
        ]
      }, {
        id: 'po-missing-receipt',
        po_number: 'PO-MISSING-RECEIPT',
        ref_pr_uid: 'missing-receipt',
        vendor_name: 'Vendor Missing',
        status: 'GR Completed',
        items: [{ id: 'poi-missing-receipt', product_name: 'Missing Receipt Item', po_qty: 1, status: 'GR Completed' }],
        receipts: []
      }]
    });
    const authUser = { id: 'u1', roles: ['ADMIN'], perms: { 'app-po': ['read'] } };
    const result = await runtime.handleRequest('getInitialData', { includeCompleted: true }, authUser);
    const decodedPurchaseOrderQueries = runtime.dbCalls.restQueries
      .filter(call => call.query.startsWith('purchase_orders?'))
      .map(call => decodeURIComponent(call.query));
    assert.ok(
      decodedPurchaseOrderQueries.some(query => query.includes('receipts:goods_receipts(id,legacy_uid,ref_po_uid,po_number,')),
      'getInitialData must request goods_receipts.po_number from PostgREST'
    );
    const itemA = result.body.grCompleted.find(item => item.uid === 'poi-per-a');
    const itemB = result.body.grCompleted.find(item => item.uid === 'poi-per-b');
    assert.equal(itemA.poNumber, 'PO-ITEM-A', 'Item A must use its matching receipt PO number');
    assert.equal(itemB.poNumber, 'PO-ITEM-B', 'Item B must use its matching receipt PO number');
    assert.equal(itemA.remark, 'Item-specific Match remark', 'Per-item Match remark must take precedence over the receipt header remark');
    assert.equal(result.body.grCompleted.some(item => item.uid === 'poi-missing-receipt'), false, 'Completed projection must omit an item without a matching receipt');
    console.log('  [PASS] Completed items retain distinct PO numbers from their matching receipts.');
  }

  // 7. Expected RPC conflicts must be safe; unknown failures must not expose database details
  console.log('\nTest 7: Testing safe RPC error responses...');
  {
    const authUser = { id: 'u1', roles: ['ADMIN'], perms: { 'app-po': ['closePO'] } };
    const conflictRuntime = createEdgeRuntime({
      rpcError: 'matching_receipt_item_required_exactly_once:40000000-0000-0000-0000-00000000004a'
    });
    const conflictResult = await conflictRuntime.handleRequest('closePO', {
      poId: 'po-1',
      items: [{ id: 'item-1' }]
    }, authUser);
    assert.equal(conflictResult.status, 409, 'Expected close conflict must return HTTP 409');
    assert.equal(conflictResult.body.reason, 'matching_receipt_item_required_exactly_once', 'Expected conflict must expose only its stable reason code');
    assert.equal(JSON.stringify(conflictResult.body).includes('40000000-0000-0000-0000-00000000004a'), false, 'Expected conflict must not expose internal item identifiers');

    const unknownRuntime = createEdgeRuntime({ rpcError: 'sensitive internal database detail' });
    const unknownResult = await unknownRuntime.handleRequest('closePO', {
      poId: 'po-1',
      items: [{ id: 'item-1' }]
    }, authUser);
    assert.equal(unknownResult.status, 500, 'Unknown database failure must return HTTP 500');
    assert.equal(unknownResult.body.reason, 'server_error', 'Unknown database failure must use a generic reason');
    assert.equal(JSON.stringify(unknownResult.body).includes('sensitive internal database detail'), false, 'Unknown database failure must not expose internal details');
    console.log('  [PASS] RPC conflicts and unknown failures return safe public errors.');
  }

  console.log('\n=== ALL Executable Edge Runtime Tests PASSED Successfully! ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Edge Runtime Test Suite Failed:', err);
  process.exit(1);
});
