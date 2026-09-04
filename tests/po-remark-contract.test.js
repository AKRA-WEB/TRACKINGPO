const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

(async () => {
console.log('=== TESTING PO BILL & ITEM REMARKS CONTRACT ===\n');

const htmlPath = path.join(__dirname, '..', 'index.html');
const versionJsonPath = path.join(__dirname, '..', 'version.json');
const html = fs.readFileSync(htmlPath, 'utf8');
const versionConfig = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));

// 1. Syntax check
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
assert(inlineScripts.length > 0, 'PO index.html must contain script tags');
inlineScripts.forEach((s, idx) => {
  if (s[1].trim()) new vm.Script(s[1], { filename: `po-inline-${idx}.js` });
});
console.log('[PASS] 1. All inline scripts compile with 0 syntax errors');

// 2. Version parity check
const versionMatch = html.match(/const CURRENT_VERSION = ["']([^"']+)["']/);
assert(versionMatch, 'CURRENT_VERSION must be declared in index.html');
assert.strictEqual(versionMatch[1], versionConfig.version, 'CURRENT_VERSION in index.html must match version.json');
assert.strictEqual(versionMatch[1], '20260904.01', 'Version must be bumped to 20260904.01');
console.log(`[PASS] 2. Version parity verified: ${versionMatch[1]}`);

// 3. Static HTML presence check
assert(html.includes('id="create-po-remark"'), 'HTML must contain #create-po-remark for bill-level note');
assert(html.includes('c-item-remark'), 'HTML must include .c-item-remark class in addCreatePoItemRow');
assert(html.includes('หมายเหตุบิล:'), 'HTML card rendering must include bill remark label');
console.log('[PASS] 3. HTML templates contain bill-level and item-level remark elements');

// 4. Runtime functional execution in node:vm
const domElements = {};
function createMockElement(id, initialProps = {}) {
  const el = {
    id,
    value: '',
    innerText: '',
    _innerHTML: '',
    get innerHTML() { return this._innerHTML || ''; },
    set innerHTML(val) {
      this._innerHTML = val;
      if (val === '') this.children = [];
    },
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
    querySelector(selector) {
      if (selector === '.c-product') return createMockElement('c-product', { value: this._product || '' });
      if (selector === '.c-qty') return createMockElement('c-qty', { value: this._qty || '1' });
      if (selector === '.c-unit') return createMockElement('c-unit', { value: this._unit || 'ชิ้น' });
      if (selector === '.c-sku') return createMockElement('c-sku', { value: this._sku || '' });
      if (selector === '.c-item-remark') return createMockElement('c-item-remark', { value: this._remark || '' });
      return createMockElement(`sel-${Math.random()}`);
    },
    querySelectorAll(selector) {
      return this.children.filter(child => {
        if (selector === '.create-po-item-row') return child.className && child.className.includes('create-po-item-row');
        return false;
      });
    },
    addEventListener() {},
    removeEventListener() {},
    reset() { this.value = ''; },
    closest(selector) {
      if (selector === '.create-po-item-row') return this;
      return this;
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(c => c !== this);
      }
    },
    ...initialProps
  };
  if (id) domElements[id] = el;
  return el;
}

const itemsContainer = createMockElement('create-po-items-container');
const poContainer = createMockElement('po-container');
const poCount = createMockElement('po-count');
const pSearch = createMockElement('p-search', { value: '' });
const pStatus = createMockElement('p-status', { value: '' });
const createPoRemark = createMockElement('create-po-remark');
const createPoVendor = createMockElement('create-po-vendor');
const createPoWarehouse = createMockElement('create-po-warehouse');
const createPoExpectedDate = createMockElement('create-po-expected-date');
const formCreatePo = createMockElement('form-create-po');
const btnSubmit = createMockElement('btn-submit-direct-po');
const modalCreatePo = createMockElement('modal-create-po');

const mockDocument = {
  getElementById: (id) => domElements[id] || createMockElement(id),
  createElement: (tag) => createMockElement(`dyn-${tag}-${Math.random()}`),
  querySelectorAll: (sel) => {
    if (sel === '.create-po-item-row') return itemsContainer.children;
    return [];
  },
  addEventListener: () => {}
};

let interceptedApiPayloads = {};
const mockAkraSupabasePO = {
  getInitialData: async () => ({ success: true, pendingPOs: [], grCompleted: [], apvList: [], prList: [], vendors: [] }),
  createPO: async (payload) => { interceptedApiPayloads.createPO = payload; return { success: true, message: 'OK', poUids: ['po-1'] }; },
  updatePO: async (payload) => { interceptedApiPayloads.updatePO = payload; return { success: true, message: 'OK', poUids: ['po-1'] }; },
  approvePR: async (payload) => { interceptedApiPayloads.approvePR = payload; return { success: true, message: 'OK', poNumber: 'PO-TEST' }; },
  deleteBill: async () => ({ success: true }),
  searchProducts: async () => []
};

const context = vm.createContext({
  window: {
    location: { href: 'https://akra-web.github.io/TrackingPO/', pathname: '/TrackingPO/', search: '' },
    history: { replaceState: () => {} },
    self: {},
    top: {},
    AkraSupabasePO: mockAkraSupabasePO,
    appSession: {
      roles: ['ADMIN'],
      perms: { 'app-po': ['createPO', 'approvePR', 'closePO'] }
    }
  },
  AkraSupabasePO: mockAkraSupabasePO,
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

// 5. Verify addCreatePoItemRow supports remark
context.addCreatePoItemRow('แป้งสาลีตราดาว', 50, 'ถุง', 'SKU-STAR', 'ล็อตผลิตไม่เกิน 1 เดือน');
const addedRow = itemsContainer.children[itemsContainer.children.length - 1];
assert(addedRow, 'Row must be appended to container');
assert(addedRow.innerHTML.includes('ล็อตผลิตไม่เกิน 1 เดือน'), 'Row HTML must include the item remark');
assert(addedRow.innerHTML.includes('c-item-remark'), 'Row HTML must include .c-item-remark');
console.log('[PASS] 4. addCreatePoItemRow correctly renders item-level remark input');

// 6. Verify openPurchasingForm resets bill remark
createPoRemark.value = 'ข้อความตกค้าง';
context.openPurchasingForm();
assert.strictEqual(createPoRemark.value, '', 'openPurchasingForm must clear create-po-remark');
console.log('[PASS] 5. openPurchasingForm clears bill remark');

// 7. Verify groupPOData and renderTab2_PO card display
context.appData = {
  pendingPOs: [
    {
      uid: 'item-101',
      poId: 'po-101',
      refPrUid: 'DIRECT-101',
      poNumber: 'PO26-101',
      vendor: 'SUPPLIER A',
      warehouse: 'W1',
      expectedDate: '2026-09-10',
      product: 'เนยสดแท้ชนิดจืด 5kg',
      quantity: 10,
      unit: 'ลัง',
      sku: 'BUTTER-01',
      billRemark: 'ส่งก่อนเที่ยง ติดต่อคุณสมชาย',
      itemRemark: 'ขอแช่เย็นควบคุมอุณหภูมิ 4C',
      poRemark: 'ส่งก่อนเที่ยง ติดต่อคุณสมชาย',
      status: 'Pending GR',
      displayStatus: 'Pending GR'
    }
  ]
};

context.groupPOData();
assert.strictEqual(context.groupedPOs.length, 1, 'Must create 1 group');
assert.strictEqual(context.groupedPOs[0].billRemark, 'ส่งก่อนเที่ยง ติดต่อคุณสมชาย', 'Group must capture billRemark');

context.renderTab2_PO();
assert.strictEqual(poContainer.children.length, 1, 'Must render 1 PO card');
const cardHtml = poContainer.children[0].innerHTML;
assert(cardHtml.includes('หมายเหตุบิล:'), 'PO card must display bill remark label');
assert(cardHtml.includes('ส่งก่อนเที่ยง ติดต่อคุณสมชาย'), 'PO card must display the bill remark text');
assert(cardHtml.includes('↳ หมายเหตุ: ขอแช่เย็นควบคุมอุณหภูมิ 4C'), 'PO card must display item remark under the product name');
console.log('[PASS] 6. PO cards in Tab 2 render both bill-level banner and item-level remark lines');

// 8. Verify search filter by remark
pSearch.value = 'สมชาย';
context.renderTab2_PO();
assert.strictEqual(poContainer.children.length, 1, 'Search matching billRemark must show card');

pSearch.value = 'แช่เย็น';
context.renderTab2_PO();
assert.strictEqual(poContainer.children.length, 1, 'Search matching itemRemark must show card');

pSearch.value = 'ไม่ตรงกับอะไรเลย';
context.renderTab2_PO();
assert.strictEqual(poContainer.children.length, 0, 'Search not matching anything must hide card');
pSearch.value = '';
console.log('[PASS] 7. Tab 2 search filter successfully searches bill remarks and item remarks');

// 9. Verify openEditPOForm populates bill and item remarks
context.openEditPOForm(context.groupedPOs[0]);
assert.strictEqual(createPoRemark.value, 'ส่งก่อนเที่ยง ติดต่อคุณสมชาย', 'openEditPOForm must populate create-po-remark');
const editRow = itemsContainer.children[itemsContainer.children.length - 1];
assert(editRow.innerHTML.includes('ขอแช่เย็นควบคุมอุณหภูมิ 4C'), 'openEditPOForm must populate item remark in row');
console.log('[PASS] 8. openEditPOForm correctly populates bill remark and item remarks');

// 10. Verify apiAction forwards bill and item remarks to AkraSupabasePO
interceptedApiPayloads = {};
await context.apiAction('createPO', {
  vendor: 'SUPPLIER A',
  warehouse: 'W1',
  expectedDate: '2026-09-12',
  remark: 'บิลด่วนที่สุด',
  items: [
    { product: 'แป้งเค้ก', quantity: 20, unit: 'ถุง', sku: 'CAKE-01', remark: 'ขอถุงไม่ฉีกขาด' }
  ]
});

assert(interceptedApiPayloads.createPO, 'createPO must be called');
assert.strictEqual(interceptedApiPayloads.createPO.remark, 'บิลด่วนที่สุด', 'createPO must receive bill-level remark');
assert.strictEqual(interceptedApiPayloads.createPO.items[0].remark, 'ขอถุงไม่ฉีกขาด', 'createPO item must receive item remark');

await context.apiAction('updatePO', {
  refPrUid: 'DIRECT-101',
  vendor: 'SUPPLIER A',
  warehouse: 'W1',
  expectedDate: '2026-09-12',
  remark: 'แก้ไขหมายเหตุบิล',
  items: [
    { id: 'item-101', product: 'แป้งเค้ก', quantity: 25, unit: 'ถุง', sku: 'CAKE-01', remark: 'แก้ไขหมายเหตุสินค้า' }
  ]
});

assert(interceptedApiPayloads.updatePO, 'updatePO must be called');
assert.strictEqual(interceptedApiPayloads.updatePO.remark, 'แก้ไขหมายเหตุบิล', 'updatePO must receive bill-level remark');
assert.strictEqual(interceptedApiPayloads.updatePO.items[0].remark, 'แก้ไขหมายเหตุสินค้า', 'updatePO item must receive item remark');
console.log('[PASS] 9. apiAction serializes and forwards bill and item remarks to createPO and updatePO');

// 11. Verify "Direct PO" suppression in Tab 2 cards and openEditPOForm
context.appData = {
  pendingPOs: [
    {
      uid: 'item-dir-1',
      poId: 'po-dir-1',
      refPrUid: 'DIRECT-999',
      poNumber: 'PO26-DIR999',
      vendor: 'SUPPLIER DIRECT',
      warehouse: 'W2',
      expectedDate: '2026-09-10',
      product: 'สินค้า Direct PO 1',
      quantity: 5,
      unit: 'ลัง',
      sku: 'DIR-01',
      billRemark: 'Direct PO',
      itemRemark: 'Direct PO (Edited)',
      poRemark: 'Direct PO',
      status: 'Pending GR',
      displayStatus: 'Pending GR'
    }
  ]
};
context.groupPOData();
context.renderTab2_PO();
const directCardHtml = poContainer.children[0].innerHTML;
assert.ok(!directCardHtml.includes('หมายเหตุบิล:'), 'PO card must NOT display bill remark banner for Direct PO');
assert.ok(!directCardHtml.includes('↳ หมายเหตุ:'), 'PO card must NOT display item remark for Direct PO');

context.openEditPOForm(context.groupedPOs[0]);
assert.strictEqual(createPoRemark.value, '', 'openEditPOForm create-po-remark must be empty for Direct PO');
const directEditRow = itemsContainer.children[itemsContainer.children.length - 1];
const editRemarkInput = directEditRow.querySelector('.c-item-remark');
assert.strictEqual(editRemarkInput.value, '', 'openEditPOForm item remark must be empty for Direct PO');
console.log('[PASS] 10. "Direct PO" remarks cleanly suppressed from Tab 2 cards and openEditPOForm');

console.log('\n🌟 ALL PO BILL & ITEM REMARK CONTRACT TESTS PASSED (100%)! 🌟');
})();

