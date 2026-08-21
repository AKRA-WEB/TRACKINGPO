const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const poHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const poApiSource = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'po-api', 'index.ts'), 'utf8');

console.log('=== Running PO Frontend & Payload Executable Contract Tests ===\n');

// 1. Script Syntax Check: Compile every <script> block with node:vm
console.log('Test 1: Validating JavaScript syntax in PO/index.html...');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let scriptIndex = 0;
while ((match = scriptRegex.exec(poHtmlSource)) !== null) {
  scriptIndex++;
  const src = match[1];
  if (!src.trim()) continue;
  new vm.Script(src, { filename: `PO/index.html:script[${scriptIndex}]` });
}
console.log(`  [PASS] All ${scriptIndex} <script> blocks compiled with zero syntax errors.`);

// 2. Action coverage in po-api
console.log('\nTest 2: Verifying po-api action coverage...');
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
  assert.ok(hasAction, `po-api must support action: ${act}`);
}
console.log('  [PASS] po-api covers all required actions.');

// 3. Executable DOM and Payload Simulation
console.log('\nTest 3: Simulating PO frontend logic with executable mocks...');

// Create a minimal DOM and mock environment
function createMockEnvironment() {
  const elements = new Map();
  const listeners = new Map();
  const dispatchedActions = [];

  function querySelectorAllRecursive(node, selector, results) {
    if (!node) return;
    const parts = selector.split(/\s+/);
    const targetPart = parts[parts.length - 1];

    if (targetPart.startsWith('.')) {
      const cls = targetPart.slice(1);
      if (node.className && node.className.split(/\s+/).includes(cls)) {
        results.push(node);
      }
    } else if (targetPart.startsWith('#')) {
      const id = targetPart.slice(1);
      if (node.id === id) results.push(node);
    }
    for (const ch of (node.children || [])) {
      querySelectorAllRecursive(ch, selector, results);
    }
  }

  function parseHTMLToElements(html, parent) {
    const inputRegex = /<input\b([^>]*)>/gi;
    let m;
    while ((m = inputRegex.exec(html)) !== null) {
      const attrs = m[1];
      const classMatch = attrs.match(/class=["']([^"']*)["']/i);
      const valueMatch = attrs.match(/value=["']([^"']*)["']/i);
      const idMatch = attrs.match(/id=["']([^"']*)["']/i);
      const typeMatch = attrs.match(/type=["']([^"']*)["']/i);
      const inputEl = documentMock.createElement('input');
      if (idMatch) inputEl.id = idMatch[1];
      inputEl.className = classMatch ? classMatch[1] : '';
      inputEl.value = valueMatch ? valueMatch[1] : '';
      inputEl.type = typeMatch ? typeMatch[1] : 'text';
      parent.appendChild(inputEl);
      if (inputEl.id) elements.set(inputEl.id, inputEl);
    }
  }

  function getOrCreateElement(id) {
    if (!elements.has(id)) {
      const el = {
        id,
        value: '',
        innerText: '',
        _innerHTML: '',
        get innerHTML() { return this._innerHTML; },
        set innerHTML(val) {
          this._innerHTML = val;
          parseHTMLToElements(val, this);
        },
        className: '',
        parentElement: null,
        classList: {
          add: () => {},
          remove: () => {},
          contains: () => false,
          toggle: () => {}
        },
        children: [],
        dataset: {},
        appendChild(child) {
          this.children.push(child);
          child.parentElement = this;
        },
        querySelector(selector) {
          const res = [];
          querySelectorAllRecursive(this, selector, res);
          return res.length > 0 ? res[0] : null;
        },
        querySelectorAll(selector) {
          const results = [];
          querySelectorAllRecursive(this, selector, results);
          return results;
        },
        addEventListener(event, fn) {
          if (!listeners.has(id)) listeners.set(id, {});
          const elEvents = listeners.get(id);
          if (!elEvents[event]) elEvents[event] = [];
          elEvents[event].push(fn);
        },
        click() {
          const elEvents = listeners.get(id) || {};
          const fns = elEvents['click'] || [];
          for (const fn of fns) fn();
        }
      };
      elements.set(id, el);
    }
    return elements.get(id);
  }

  const documentMock = {
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {},
    getElementById(id) {
      return getOrCreateElement(id);
    },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        value: '',
        _innerHTML: '',
        get innerHTML() { return this._innerHTML; },
        set innerHTML(val) {
          this._innerHTML = val;
          parseHTMLToElements(val, this);
        },
        parentElement: null,
        children: [],
        classList: {
          add: () => {},
          remove: () => {},
          contains: () => false,
          toggle: () => {}
        },
        remove: () => {},
        appendChild(child) {
          this.children.push(child);
          child.parentElement = this;
        },
        querySelector(selector) {
          const res = [];
          querySelectorAllRecursive(this, selector, res);
          return res.length > 0 ? res[0] : null;
        },
        querySelectorAll(selector) {
          const results = [];
          querySelectorAllRecursive(this, selector, results);
          return results;
        },
        addEventListener(event, fn) {}
      };
      return el;
    },
    querySelectorAll(selector) {
      const results = [];
      for (const el of elements.values()) {
        querySelectorAllRecursive(el, selector, results);
      }
      return results;
    }
  };

  const context = {
    document: documentMock,
    window: {
      location: { search: '?sso=mock-token' },
      appSession: {
        roles: ['ADMIN'],
        perms: { 'app-po': ['approvePR', 'closePO', 'deletePO', 'createPO', 'updatePO', 'read'] }
      },
      addEventListener: (event, fn) => {},
      removeEventListener: () => {}
    },
    navigator: { userAgent: 'NodeTest' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    fetch: async () => ({
      ok: true,
      json: async () => ({ version: '20260821.02' }),
      text: async () => JSON.stringify({ version: '20260821.02' })
    }),
    AkraSupabasePO: {
      createPO: async (payload, token) => {
        dispatchedActions.push({ action: 'createPO', payload, token });
        return { success: true, message: 'Created' };
      },
      updatePO: async (payload, token) => {
        dispatchedActions.push({ action: 'updatePO', payload, token });
        return { success: true, message: 'Updated' };
      },
      deleteBill: async (payload, token) => {
        dispatchedActions.push({ action: 'deleteBill', payload, token });
        return { success: true, message: 'Deleted' };
      },
      approvePR: async (payload, token) => {
        dispatchedActions.push({ action: 'approvePR', payload, token });
        return { success: true, message: 'Approved' };
      },
      rejectPR: async (payload, token) => {
        dispatchedActions.push({ action: 'rejectPR', payload, token });
        return { success: true, message: 'Rejected' };
      },
      closePO: async (payload, token) => {
        dispatchedActions.push({ action: 'closePO', payload, token });
        return { success: true, message: 'Closed' };
      },
      getInitialData: async (payload, token) => {
        dispatchedActions.push({ action: 'getInitialData', payload, token });
        return {
          success: true,
          pendingPOs: [],
          grCompleted: [],
          prList: [],
          apvList: [],
          vendors: [],
          data: { pendingPOs: [], grCompleted: [], prList: [], apvList: [], vendors: [] }
        };
      },
      getProducts: async (payload, token) => {
        dispatchedActions.push({ action: 'getProducts', payload, token });
        return { success: true, products: [], data: { products: [] } };
      },
      getDeliveryInsights: async (payload, token) => {
        dispatchedActions.push({ action: 'getDeliveryInsights', payload, token });
        return { success: true, insights: [] };
      },
      searchProducts: async (query, limit, token) => {
        dispatchedActions.push({ action: 'searchProducts', query, limit, token });
        return { success: true, products: [] };
      }
    },
    console: console,
    lucide: { createIcons: () => {} },
    showNotification: () => {},
    showConfirmModal: (msg, onConfirm) => { onConfirm(); },
    prompt: () => 'Test Remark',
    can: () => true,
    getSessionToken: () => 'mock-jwt-token-12345',
    esc: s => s,
    usableBillRefUid: s => s,
    addCreatePoItemRow: () => {},
    dispatchedActions
  };

  return context;
}

async function runTests() {
  // 4. Test Finding 1: PR Parent ID & Multi-item PR handling
  console.log('Test 4: Executing PR decision actions (approve/reject/close)...');
  {
    const env = createMockEnvironment();

    const scriptMatch = poHtmlSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)[2];
    const scriptContent = scriptMatch.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');

    const vmContext = vm.createContext(env);
    vm.runInContext(`
      ${scriptContent}
      if (typeof AppVersionGuard !== 'undefined' && AppVersionGuard.start) {
        AppVersionGuard.start({ current: CURRENT_VERSION, readActions: ['getInitialData', 'getProducts', 'getDeliveryInsights'] });
      }
    `, vmContext);

    // Setup PR list with multi-item PR
    vmContext.appData = {
      prList: [
        { rowNumber: 1, uid: 'item-uuid-1', prId: 'pr-parent-uuid-1', prNumber: 'PR26-0001', requester: 'Buyer A', product: 'Product 1', quantity: 10, unit: 'ลัง', remark: 'Urgent' },
        { rowNumber: 2, uid: 'item-uuid-2', prId: 'pr-parent-uuid-1', prNumber: 'PR26-0001', requester: 'Buyer A', product: 'Product 2', quantity: 5, unit: 'กล่อง', remark: 'Urgent' }
      ],
      pendingPOs: [],
      grCompleted: [],
      apvList: [],
      products: [],
      vendors: []
    };

    function clickConfirmModal(env) {
      const btn = env.document.getElementById('btn-confirm-action');
      if (btn && btn.click) {
        btn.click();
      }
    }

    // 4A: Reject PR passes parent prId
    vmContext.rejectPR(1, 'item-uuid-1', 'pr-parent-uuid-1');
    clickConfirmModal(env);
    await new Promise(resolve => setTimeout(resolve, 20));

    const rejectAction = env.dispatchedActions.find(a => a.action === 'rejectPR');
    assert.ok(rejectAction, 'rejectPR action must be dispatched');
    assert.equal(rejectAction.payload.prId, 'pr-parent-uuid-1', 'rejectPR must carry parent prId');

    // 4B: Approve PR populates all sibling items
    vmContext.appData = {
      prList: [
        { rowNumber: 1, uid: 'item-uuid-1', prId: 'pr-parent-uuid-1', prNumber: 'PR26-0001', requester: 'Buyer A', product: 'Product 1', quantity: 10, unit: 'ลัง', remark: 'Urgent' },
        { rowNumber: 2, uid: 'item-uuid-2', prId: 'pr-parent-uuid-1', prNumber: 'PR26-0001', requester: 'Buyer A', product: 'Product 2', quantity: 5, unit: 'กล่อง', remark: 'Urgent' }
      ],
      pendingPOs: [],
      grCompleted: [],
      apvList: [],
      products: [],
      vendors: []
    };

    vmContext.approvePRToPOForm(1, 'item-uuid-1', 'pr-parent-uuid-1');
    const poForm = env.document.getElementById('form-create-po');
    assert.equal(poForm.dataset.prid, 'pr-parent-uuid-1', 'PO form must store parent prId');

    console.log('  [PASS] PR actions correctly target parent PR identity and handle multi-item PRs.');
  }

  // 5. Test Finding 2 & 4: Match Extra Items, QuickFill, and Close Payload
  console.log('\nTest 5: Executing Match groupGRData, addExtraGRItem, QuickFill, and confirmClosePO...');
  {
    const env = createMockEnvironment();
    const scriptMatch = poHtmlSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)[2];
    const scriptContent = scriptMatch.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');

    const vmContext = vm.createContext(env);
    vm.runInContext(`
      ${scriptContent}
      if (typeof AppVersionGuard !== 'undefined' && AppVersionGuard.start) {
        AppVersionGuard.start({ current: CURRENT_VERSION, readActions: ['getInitialData', 'getProducts', 'getDeliveryInsights'] });
      }
    `, vmContext);

    // Setup GR Completed with 1 regular item and 1 pre-existing extra item
    vmContext.appData = {
      prList: [],
      pendingPOs: [],
      apvList: [],
      products: [],
      vendors: [],
      grCompleted: [
        {
          rowNumber: 1,
          uid: 'item-uuid-1',
          poId: 'po-target-uuid-1',
          refPrUid: 'bill-ref-1',
          poNumber: '',
          vendor: 'Vendor A',
          warehouse: 'W1',
          product: 'Regular Product',
          quantity: 10,
          grQty: 10,
          unit: 'ชิ้น',
          isExtra: false
        },
        {
          rowNumber: 2,
          uid: 'extra-uuid-1',
          poId: 'po-target-uuid-1',
          refPrUid: 'bill-ref-1',
          poNumber: '',
          vendor: 'Vendor A',
          warehouse: 'W1',
          product: 'Existing Extra Product',
          quantity: 0,
          grQty: 2,
          unit: 'ชิ้น',
          isExtra: true
        }
      ]
    };

    // Execute groupGRData
    vmContext.groupGRData();
    const groups = Object.values(vmContext.groupedMatchData);
    assert.equal(groups.length, 1, 'Should produce 1 grouped match bill');
    assert.equal(groups[0].poId, 'po-target-uuid-1', 'Group must contain target poId');
    assert.equal(groups[0].items.length, 1, 'Group regular items length must be 1');
    assert.equal(groups[0].extraItems.length, 1, 'Group extra items length must be 1 (round-trip)');

    // Simulate DOM inputs for regular item with po-input-gIdx-0 class
    const poNumEl = env.document.getElementById('match-item-po-1');
    poNumEl.className = 'input-field po-input-gIdx-0';
    const quickFillEl = env.document.getElementById('quick-fill-po-0');
    quickFillEl.value = 'PO26-0001';

    // Test Quick Fill PO
    vmContext.applyQuickFillPO(0);
    assert.equal(poNumEl.value, 'PO26-0001', 'applyQuickFillPO must populate match-item-po-1 via po-input-gIdx-0');

    // Simulate regular item quantities and remarks
    const grQtyEl = env.document.getElementById('match-grqty-1');
    grQtyEl.value = '12';
    const remarkEl = env.document.getElementById('match-remark-1');
    remarkEl.value = 'Received 12 units';

    // Call addExtraGRItem(0) directly
    vmContext.addExtraGRItem(0);

    // Find the newly generated extra item row in DOM
    const extraRows = env.document.querySelectorAll('#match-items-group-0 .match-extra-row');
    assert.equal(extraRows.length, 1, 'addExtraGRItem must append exactly 1 match-extra-row');

    const createdExtraRow = extraRows[0];
    const prodInput = createdExtraRow.querySelector('.match-extra-product');
    const qtyInput = createdExtraRow.querySelector('.match-extra-qty');
    const unitInput = createdExtraRow.querySelector('.match-extra-unit');
    const locInput = createdExtraRow.querySelector('.match-extra-loc');
    const remInput = createdExtraRow.querySelector('.match-extra-remark');

    assert.ok(prodInput, 'addExtraGRItem must contain match-extra-product input');
    assert.ok(qtyInput, 'addExtraGRItem must contain match-extra-qty input');
    assert.ok(unitInput, 'addExtraGRItem must contain match-extra-unit input');
    assert.ok(locInput, 'addExtraGRItem must contain match-extra-loc input');
    assert.ok(remInput, 'addExtraGRItem must contain match-extra-remark input');

    // Fill in the extra item values
    prodInput.value = 'Newly Added Free Item';
    qtyInput.value = '3';
    unitInput.value = 'กล่อง';
    locInput.value = 'W1-A';
    remInput.value = 'Promotion gift';

    // Execute confirmClosePO
    vmContext.confirmClosePO(0);
    clickConfirmModal(env);
    await new Promise(resolve => setTimeout(resolve, 20));

    const closeAction = env.dispatchedActions.find(a => a.action === 'closePO');
    assert.ok(closeAction, 'closePO action must be dispatched');
    assert.equal(closeAction.payload.poId, 'po-target-uuid-1', 'closePO must carry poId');
    assert.equal(closeAction.payload.expectedItemCount, 1, 'closePO must carry expectedItemCount = 1');
    assert.equal(closeAction.payload.items.length, 1, 'closePO items length must match regular items');
    assert.equal(closeAction.payload.items[0].revisedGrQty, 12, 'revisedGrQty must be captured from DOM');
    assert.equal(closeAction.payload.items[0].matchRemark, 'Received 12 units', 'matchRemark must be captured from DOM');
    assert.equal(closeAction.payload.items[0].poNumber, 'PO26-0001', 'poNumber must be captured from DOM');

    // Verify extra items: includes 1 pre-existing + 1 DOM-added extra
    assert.equal(closeAction.payload.extraItems.length, 2, 'closePO extraItems must include both pre-existing and DOM-added extras');
    assert.equal(closeAction.payload.extraItems[1].productName, 'Newly Added Free Item', 'DOM extra item product name must be captured');
    assert.equal(closeAction.payload.extraItems[1].grQty, 3, 'DOM extra item grQty must be captured');
    assert.equal(closeAction.payload.extraItems[1].unit, 'กล่อง', 'DOM extra item unit must be captured');

    console.log('  [PASS] Match groupGRData, addExtraGRItem, QuickFill, and confirmClosePO correctly executed with zero errors.');
  }

  // 6. Test Finding 3: Full-Lifecycle Delete Payload
  console.log('\nTest 6: Executing deletePO action across lifecycles...');
  {
    const env = createMockEnvironment();
    const scriptMatch = poHtmlSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)[2];
    const scriptContent = scriptMatch.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');

    const vmContext = vm.createContext(env);
    vm.runInContext(`
      ${scriptContent}
      if (typeof AppVersionGuard !== 'undefined' && AppVersionGuard.start) {
        AppVersionGuard.start({ current: CURRENT_VERSION, readActions: ['getInitialData', 'getProducts', 'getDeliveryInsights'] });
      }
    `, vmContext);

    vmContext.appData = {
      prList: [],
      pendingPOs: [],
      grCompleted: [],
      apvList: [],
      products: [],
      vendors: []
    };

    function clickConfirmModal(env) {
      const btn = env.document.getElementById('btn-confirm-action');
      if (btn && btn.click) {
        btn.click();
      }
    }

    vmContext.deletePO({ poId: 'po-delete-target-uuid', poUids: [], expectedItemCount: 0, legacyBill: false });
    clickConfirmModal(env);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(env.dispatchedActions.filter(a => a.action === 'deleteBill').length, 0, 'deletePO must reject a missing canonical snapshot before dispatch');

    // Simulate deletePO call for a completed bill
    const deleteReq = {
      poId: 'po-delete-target-uuid',
      poUids: ['item-1', 'item-2'],
      refPrUid: 'PR-2026-DEL',
      expectedItemCount: 2,
      legacyBill: false
    };

    vmContext.deletePO(deleteReq);
    clickConfirmModal(env);
    await new Promise(resolve => setTimeout(resolve, 20));

    const delAction = env.dispatchedActions.find(a => a.action === 'deleteBill');
    assert.ok(delAction, 'deleteBill action must be dispatched');
    assert.equal(delAction.payload.poId, 'po-delete-target-uuid', 'deleteBill must pass poId');
    assert.equal(delAction.payload.refPrUid, 'PR-2026-DEL', 'deleteBill must pass refPrUid');
    assert.equal(delAction.payload.expectedItemCount, 2, 'deleteBill must pass expectedItemCount');
    assert.equal(delAction.payload.legacyBill, false, 'deleteBill must pass legacyBill flag');

    vmContext.appData.pendingPOs = [
      { uid: 'item-a', poId: 'po-a', refPrUid: 'shared-pr' },
      { uid: 'item-b', poId: 'po-b', refPrUid: 'shared-pr' }
    ];
    vmContext.appData.grCompleted = [
      { uid: 'item-a', poId: 'po-a', refPrUid: 'shared-pr' },
      { uid: 'item-b', poId: 'po-b', refPrUid: 'shared-pr' }
    ];
    vmContext.appData.apvList = [
      { uid: 'item-a', poId: 'po-a', refPrUid: 'shared-pr' },
      { uid: 'item-b', poId: 'po-b', refPrUid: 'shared-pr' }
    ];
    vmContext.removeDeletedBillFromLocalData({
      poId: 'po-a',
      poUids: ['item-a'],
      refPrUid: 'shared-pr',
      legacyBill: false
    });
    ['pendingPOs', 'grCompleted', 'apvList'].forEach(key => {
      assert.deepEqual(
        Array.from(vmContext.appData[key], item => item.poId),
        ['po-b'],
        `${key} must preserve a sibling PO that shares the same PR reference`
      );
    });

    console.log('  [PASS] deletePO carries the canonical snapshot and local cleanup preserves sibling POs.');
  }

  // 7. Test Finding 1: readApiCall getInitialData and getProducts response parsing
  console.log('\nTest 7: Testing readApiCall response shape compatibility...');
  {
    const env = createMockEnvironment();
    const scriptMatch = poHtmlSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)[2];
    const scriptContent = scriptMatch.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');

    const vmContext = vm.createContext(env);
    vm.runInContext(`
      ${scriptContent}
      if (typeof AppVersionGuard !== 'undefined' && AppVersionGuard.start) {
        AppVersionGuard.start({ current: CURRENT_VERSION, readActions: ['getInitialData', 'getProducts', 'getDeliveryInsights'] });
      }
    `, vmContext);

    // Mock AkraSupabasePO with nested data
    vmContext.AkraSupabasePO.getInitialData = async () => ({
      success: true,
      data: {
        pendingPOs: [{ id: 'po-1' }],
        grCompleted: [{ id: 'gr-1' }],
        prList: [{ id: 'pr-1' }],
        apvList: [{ id: 'apv-1' }],
        vendors: ['Vendor X']
      }
    });

    const initialRes = await vmContext.readApiCall('getInitialData', {});
    assert.equal(initialRes.success, true);
    assert.equal(initialRes.pendingPOs.length, 1);
    assert.equal(initialRes.grCompleted.length, 1);
    assert.equal(initialRes.prList.length, 1);
    assert.equal(initialRes.apvList.length, 1);
    assert.equal(initialRes.vendors[0], 'Vendor X');

    // Mock AkraSupabasePO getProducts with nested data
    vmContext.AkraSupabasePO.getProducts = async () => ({
      success: true,
      data: {
        products: [{ sku: 'SKU1', name: 'Prod 1', default_vendor: 'Vendor X' }]
      }
    });

    const prodRes = await vmContext.readApiCall('getProducts', {});
    assert.equal(prodRes.success, true);
    assert.equal(prodRes.products.length, 1);
    assert.equal(prodRes.vendors.length, 1);
    assert.equal(prodRes.vendors[0], 'Vendor X');

    console.log('  [PASS] readApiCall correctly parses both nested data and top-level response structures.');
  }

  // 8. PO and APV cards must remain isolated by canonical PO ID even when a PR reference is shared
  console.log('\nTest 8: Testing multi-PO grouping isolation...');
  {
    const env = createMockEnvironment();
    const scriptMatch = poHtmlSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)[2];
    const scriptContent = scriptMatch.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');
    const vmContext = vm.createContext(env);
    vm.runInContext(scriptContent, vmContext);

    const sharedRefItems = [
      { uid: 'poi-a', poId: 'po-a', refPrUid: 'shared-pr', poNumber: 'PO-A', vendor: 'Vendor A', poDate: '21/08/2026', warehouse: 'W1' },
      { uid: 'poi-b', poId: 'po-b', refPrUid: 'shared-pr', poNumber: 'PO-B', vendor: 'Vendor B', poDate: '21/08/2026', warehouse: 'W1' }
    ];

    const apvItems = sharedRefItems.concat([{ uid: 'extra-a', poId: 'po-a', refPrUid: 'shared-pr', poNumber: 'PO-A', vendor: 'Vendor A', isExtra: true }]);
    vmContext.appData = { pendingPOs: sharedRefItems, apvList: apvItems };
    vmContext.groupPOData();
    assert.equal(vmContext.groupedPOs.length, 2, 'PO dashboard must keep different poId values in separate groups');

    vmContext.groupAPVData();
    assert.equal(Object.keys(vmContext.groupedAPVData).length, 2, 'APV must keep different poId values in separate groups');
    const apvGroupA = vmContext.groupedAPVData['poid:po-a'];
    assert.equal(apvGroupA.items.length, 1, 'APV delete snapshot must contain only canonical PO items');
    assert.equal(apvGroupA.extraItems.length, 1, 'APV may retain receipt extras separately for display without deleting them as PO items');
    console.log('  [PASS] PO and APV grouping remain isolated by canonical poId.');
  }

  // 9. The current Edge delivery-insight response must render honest rates and unavailable samples
  console.log('\nTest 9: Testing delivery-insight UI contract...');
  {
    const env = createMockEnvironment();
    const scriptMatch = poHtmlSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)[2];
    const scriptContent = scriptMatch.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');
    const vmContext = vm.createContext(env);
    vm.runInContext(scriptContent, vmContext);

    vmContext.renderDeliveryInsights({
      success: true,
      insights: [
        { vendor: 'Vendor Rated', totalOrders: 2, sampleCount: 2, onTimeRate: 50 },
        { vendor: 'Vendor No Sample', totalOrders: 1, sampleCount: 0, onTimeRate: null }
      ]
    });
    const insightHtml = env.document.getElementById('delivery-insight-content').innerHTML;
    assert.ok(insightHtml.includes('50%'), 'Delivery insight UI must render the Edge on-time rate');
    assert.ok(insightHtml.includes('ข้อมูลไม่เพียงพอ'), 'Zero-sample vendors must render an unavailable state instead of 100%');
    console.log('  [PASS] Delivery insight UI renders the current Edge response without fabricated rates.');
  }

  console.log('\n=== ALL Executable Frontend Contract Tests PASSED with ZERO Errors! ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
