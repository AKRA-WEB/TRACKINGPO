const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('=== TESTING PO TAB 2 SEARCH & EDIT BILL IDENTIFIER CONTRACT ===\n');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// 1. Syntax check
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
assert(inlineScripts.length > 0, 'PO index.html must contain scripts');
inlineScripts.forEach((s, idx) => {
  if (s[1].trim()) new vm.Script(s[1], { filename: `po-inline-${idx}.js` });
});
console.log('[PASS] 1. All inline scripts in index.html compile with 0 syntax errors');

// 2. DOM & Execution Mock
const domElements = {};
function createMockElement(id, initialProps = {}) {
  const el = {
    id,
    value: '',
    innerText: '',
    innerHTML: '',
    className: '',
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) { if (force !== undefined) { if (force) this.add(c); else this.remove(c); } else { if (this.contains(c)) this.remove(c); else this.add(c); } }
    },
    dataset: {},
    children: [],
    appendChild(child) { this.children.push(child); },
    setAttribute() {},
    getAttribute() {},
    querySelector: () => createMockElement(`sel-${Math.random()}`),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    reset() {},
    ...initialProps
  };
  domElements[id] = el;
  return el;
}

const mockDocument = {
  getElementById: (id) => domElements[id] || createMockElement(id),
  createElement: (tag) => createMockElement(`dyn-${tag}-${Math.random()}`),
  addEventListener: () => {}
};

const context = vm.createContext({
  window: {
    location: { href: 'https://akra-web.github.io/TrackingPO/', pathname: '/TrackingPO/', search: '' },
    history: { replaceState: () => {} },
    self: {},
    top: {}
  },
  document: mockDocument,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  URL,
  URLSearchParams,
  console,
  setTimeout: (fn) => fn(),
  clearTimeout: () => {},
  setInterval: () => {},
  lucide: { createIcons: () => {} }
});

const scriptContent = inlineScripts[2][1];
vm.runInContext(scriptContent, context);

// Setup mock PO test data with 3 distinct bills
context.appData = {
  pendingPOs: [
    // Bill 1 (index 0 in groupedPOs)
    {
      uid: 'po-item-1',
      poId: 'po-id-1',
      refPrUid: 'DIRECT-1',
      poNumber: 'PO26-0001',
      vendor: 'VENDOR A (APPLE)',
      warehouse: 'W1',
      expectedDate: '2026-08-25',
      product: 'น้ำส้มแอปเปิ้ล 100%',
      quantity: 10,
      unit: 'ลัง',
      sku: 'SKU-001',
      status: 'Pending GR',
      displayStatus: 'Pending GR'
    },
    // Bill 2 (index 1 in groupedPOs)
    {
      uid: 'po-item-2',
      poId: 'po-id-2',
      refPrUid: 'DIRECT-2',
      poNumber: 'PO26-0002',
      vendor: 'VENDOR B (BANANA)',
      warehouse: 'W2',
      expectedDate: '2026-08-26',
      product: 'กล้วยหอมทองอบกรอบ',
      quantity: 20,
      unit: 'ถุง',
      sku: 'SKU-002',
      status: 'Pending GR',
      displayStatus: 'Pending GR'
    },
    // Bill 3 (index 2 in groupedPOs)
    {
      uid: 'po-item-3',
      poId: 'po-id-3',
      refPrUid: 'DIRECT-3',
      poNumber: 'PO26-0003',
      vendor: 'VENDOR C (CHERRY)',
      warehouse: 'W3',
      expectedDate: '2026-08-27',
      product: 'แยมเชอร์รี่สดแท้',
      quantity: 50,
      unit: 'กระปุก',
      sku: 'SKU-003',
      status: 'Pending GR',
      displayStatus: 'Pending GR'
    }
  ]
};

// 3. Group PO data
context.groupPOData();
assert.strictEqual(context.groupedPOs.length, 3, 'Must have 3 grouped PO bills');
console.log('[PASS] 2. groupPOData created 3 distinct bills with stable keys');

// 4. Test Search & Filter: Search for "เชอร์รี่" (Cherry - which is in Bill 3)
const searchInput = mockDocument.getElementById('p-search');
searchInput.value = 'เชอร์รี่';

const statusSelect = mockDocument.getElementById('p-status');
statusSelect.value = 'ALL';

context.renderTab2_PO();

const poContainer = mockDocument.getElementById('po-container');
assert.strictEqual(poContainer.children.length, 1, 'Search for "เชอร์รี่" must return exactly 1 filtered card');
console.log('[PASS] 3. Filtered PO container contains 1 matching card (Bill 3)');

// 5. Inspect the generated card HTML
const card = poContainer.children[0];
assert(card.innerHTML.includes('แยมเชอร์รี่สดแท้'), 'Filtered card must display product from Bill 3');
assert(card.innerHTML.includes('VENDOR C (CHERRY)'), 'Filtered card must display vendor from Bill 3');

// Extract the onclick handler argument for openEditPOForm from the card's innerHTML
const editButtonMatch = card.innerHTML.match(/openEditPOForm\(([^)]+)\)/);
assert(editButtonMatch, 'Card must have an openEditPOForm button');
const editTargetArg = JSON.parse(editButtonMatch[1].replace(/&quot;/g, '"'));

console.log(`  -> Edit button calls openEditPOForm("${editTargetArg}")`);

// Execute openEditPOForm with the argument from the filtered card
context.openEditPOForm(editTargetArg);

// 6. Verify that the opened edit modal displays Bill 3, NOT Bill 1 (which was index 0 in groupedPOs)
const modalTitle = mockDocument.getElementById('modal-create-po-title').innerText;
const vendorInput = mockDocument.getElementById('create-po-vendor').value;
const form = mockDocument.getElementById('form-create-po');

assert.strictEqual(modalTitle, 'แก้ไขบิลสั่งซื้อ (PO26-0003)', 'Modal title must match Bill 3 (PO26-0003)');
assert.strictEqual(vendorInput, 'VENDOR C (CHERRY)', 'Vendor input must match Bill 3 (VENDOR C)');
assert.strictEqual(form.dataset.oldUids, JSON.stringify(['po-item-3']), 'Form oldUids must match Bill 3 item UID');
assert.strictEqual(form.dataset.poNumber, 'PO26-0003', 'Form poNumber must match Bill 3');

console.log('[PASS] 4. openEditPOForm successfully resolved the exact filtered Bill 3 (VENDOR C) without any index collision!');

console.log('\n🌟 PO SEARCH & EDIT CONTRACT TESTS PASSED 100%! 🌟');
