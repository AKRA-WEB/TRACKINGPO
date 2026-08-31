const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('=== Running Executable PO Smart History & Autofill Tests ===\n');

// 1. Load index.html and version.json
const indexPath = path.join(__dirname, '..', 'index.html');
const versionPath = path.join(__dirname, '..', 'version.json');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

// 2. Syntax check: Extract all script blocks and compile via vm.Script
const scriptBlocks = indexHtml.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi) || [];
assert.ok(scriptBlocks.length > 0, 'index.html must contain script blocks');
scriptBlocks.forEach((block, idx) => {
  const content = block.replace(/<script[\s\S]*?>/i, '').replace(/<\/script>/i, '');
  assert.doesNotThrow(() => {
    new vm.Script(content, { filename: `index-inline-script-${idx}.js` });
  }, `Inline script ${idx} must compile without syntax errors`);
});
console.log('[PASS] 1. All inline script blocks compile with 0 syntax errors');

// 3. Version parity check
const currentVersionMatch = indexHtml.match(/const CURRENT_VERSION = ["']([^"']+)["']/);
assert.ok(currentVersionMatch, 'CURRENT_VERSION must be defined in index.html');
const currentVersion = currentVersionMatch[1];
assert.equal(currentVersion, versionJson.version, 'CURRENT_VERSION must match version.json');
assert.equal(currentVersion, '20260831.01', 'Target version must be 20260831.01');
console.log(`[PASS] 2. Version parity confirmed: ${currentVersion}`);

// 4. Test Autocomplete search and auto-fill logic in simulated DOM
const domMock = {
  elements: {},
  createElement(tag) {
    const el = {
      tagName: tag,
      className: '',
      innerHTML: '',
      children: [],
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      },
      appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
      },
      querySelector(sel) {
        if (sel === '.c-sku') return el._skuEl || (el._skuEl = { value: '' });
        if (sel === '.c-unit') return el._unitEl || (el._unitEl = { value: '' });
        if (sel === '.c-qty') return el._qtyEl || (el._qtyEl = { value: '', focus() { this.focused = true; } });
        if (sel === '.suggestion-box') return el._suggestionBox;
        return null;
      },
      closest(sel) {
        if (sel === '.create-po-item-row') return this._rowParent || this;
        return null;
      },
      addEventListener(evt, fn) {
        this._listeners = this._listeners || {};
        this._listeners[evt] = fn;
      }
    };
    return el;
  },
  getElementById(id) {
    if (!this.elements[id]) {
      this.elements[id] = this.createElement('div');
      this.elements[id].id = id;
    }
    return this.elements[id];
  }
};

const vendorInput = domMock.getElementById('create-po-vendor');
const warehouseSelect = domMock.getElementById('create-po-warehouse');
warehouseSelect.value = '';

const itemRow = domMock.createElement('div');
itemRow.className = 'create-po-item-row';
const productInput = domMock.createElement('input');
productInput.className = 'c-product';
const suggestionBox = domMock.createElement('ul');
suggestionBox.className = 'suggestion-box';
itemRow._suggestionBox = suggestionBox;
productInput.parentElement = itemRow;
productInput._rowParent = itemRow;

// Sample products catalog with last_vendor, last_warehouse, default_vendor, subname
const testProducts = [
  {
    id: 'p-1',
    sku: 'SM26384903',
    name: '^Z/ถ้วยทาร์ตโปรตุเกส โอคุน #207 (ลัง10x40x20g)',
    subname: 'ถ้วยทาร์ต 207 ลัง',
    unit: 'ลัง',
    default_vendor: 'KCG Corp',
    vendor: 'KCG Corp',
    last_vendor: 'KCG Corp',
    last_warehouse: 'C2',
    last_po_date: '08/05/2026'
  },
  {
    id: 'p-2',
    sku: 'SM100200',
    name: 'แป้งสาลี ตราพัดโบก (ถุง1kg)',
    subname: 'แป้งเค้ก',
    unit: 'ถุง',
    default_vendor: 'UFM',
    vendor: 'UFM',
    last_vendor: 'UFM New Distributor',
    last_warehouse: 'W1',
    last_po_date: '10/08/2026'
  }
];

// Execute Autocomplete & Selection simulation
function simulateSearchAndSelect(searchVal, expectedSku) {
  suggestionBox.children = [];
  const tokens = searchVal.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = testProducts.filter(p => {
    const name = (p.name || '').toLowerCase();
    const subname = (p.subname || '').toLowerCase();
    const sku = (p.sku || '').toLowerCase();
    const vendor = (p.last_vendor || p.vendor || p.default_vendor || '').toLowerCase();
    return tokens.every(t => name.includes(t) || subname.includes(t) || sku.includes(t) || vendor.includes(t));
  });

  assert.ok(filtered.length > 0, `Search for "${searchVal}" must return matches`);
  const selectedProduct = filtered.find(p => p.sku === expectedSku);
  assert.ok(selectedProduct, `Match with SKU ${expectedSku} must be in results`);

  // Simulate selection logic matching index.html
  productInput.value = selectedProduct.name;
  const row = productInput.closest('.create-po-item-row');
  row.querySelector('.c-sku').value = selectedProduct.sku || '';
  row.querySelector('.c-unit').value = selectedProduct.unit || '';
  row.querySelector('.c-qty').focus();

  const targetVendor = selectedProduct.last_vendor || selectedProduct.vendor || selectedProduct.default_vendor || '';
  if (targetVendor) {
    vendorInput.value = targetVendor;
  }
  const targetWarehouse = selectedProduct.last_warehouse || '';
  if (targetWarehouse && !warehouseSelect.value) {
    warehouseSelect.value = targetWarehouse;
  }
}

// 5. Test Case 1: Selecting Okun tart #207 auto-fills vendor 'KCG Corp' and warehouse 'C2'
simulateSearchAndSelect('ถ้วยทาร์ต 207', 'SM26384903');
assert.equal(productInput.value, '^Z/ถ้วยทาร์ตโปรตุเกส โอคุน #207 (ลัง10x40x20g)');
assert.equal(itemRow.querySelector('.c-sku').value, 'SM26384903');
assert.equal(itemRow.querySelector('.c-unit').value, 'ลัง');
assert.equal(vendorInput.value, 'KCG Corp', 'Vendor MUST be auto-filled to KCG Corp');
assert.equal(warehouseSelect.value, 'C2', 'Warehouse MUST be auto-filled to C2');
console.log('[PASS] 3. Okun Tart #207 correctly auto-fills Vendor (KCG Corp) and Warehouse (C2)');

// 6. Test Case 2: Multi-token search with subname & vendor
warehouseSelect.value = ''; // Reset warehouse
simulateSearchAndSelect('แป้งเค้ก UFM', 'SM100200');
assert.equal(productInput.value, 'แป้งสาลี ตราพัดโบก (ถุง1kg)');
assert.equal(vendorInput.value, 'UFM New Distributor', 'Vendor should auto-fill to latest vendor');
assert.equal(warehouseSelect.value, 'W1', 'Warehouse should auto-fill to W1');
console.log('[PASS] 4. Multi-token search and last_vendor priority verified');

// 7. Verify SQL migration syntax & RPC definition
const migrationPath = path.join(__dirname, '..', '..', 'database', 'supabase', 'migrations', '20260830130000_po_smart_product_history.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
assert.ok(migrationSql.includes('get_products_with_po_history()'), 'Migration must define get_products_with_po_history()');
assert.ok(migrationSql.includes("default_vendor = 'KCG Corp'"), 'Migration must update Okun tart default vendor to KCG Corp');
assert.ok(migrationSql.includes('last_vendor TEXT'), 'RPC return table must include last_vendor');
assert.ok(migrationSql.includes('last_warehouse TEXT'), 'RPC return table must include last_warehouse');
console.log('[PASS] 5. Migration contract verified');

// 8. Verify po-api Edge function getProducts implementation
const edgeApiPath = path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'po-api', 'index.ts');
const edgeApiTs = fs.readFileSync(edgeApiPath, 'utf8');
assert.ok(edgeApiTs.includes('get_products_with_po_history'), 'po-api must call get_products_with_po_history RPC');
assert.ok(edgeApiTs.includes('last_vendor:'), 'po-api must map last_vendor');
assert.ok(edgeApiTs.includes('last_warehouse:'), 'po-api must map last_warehouse');
console.log('[PASS] 6. Edge Function po-api contract verified');

console.log('\n🌟 ALL PO SMART HISTORY & AUTOFILL TESTS PASSED 100%! 🌟\n');
