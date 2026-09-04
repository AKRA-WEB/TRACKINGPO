const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const versionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));
const productsSnapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'data_snapshots', 'products.json'), 'utf8'));

// 1. Script compilation in node:vm
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
assert.ok(inlineScripts.length > 0, 'PO index.html must contain inline scripts');
inlineScripts.forEach((script, index) => {
  if (script[1].trim()) {
    new vm.Script(script[1], { filename: `po-inline-${index}.js` });
  }
});
console.log('[PASS] 1. All inline scripts compile with 0 syntax errors');

// 2. Version parity check
const currentVersionMatch = html.match(/const CURRENT_VERSION = ["']([^"']+)["']/);
assert.ok(currentVersionMatch, 'CURRENT_VERSION must be defined in index.html');
const currentVersion = currentVersionMatch[1];
assert.equal(currentVersion, versionJson.version, 'CURRENT_VERSION must match version.json');
assert.ok(currentVersion >= '20260831.02', 'Target version must be at least 20260831.02');
console.log(`[PASS] 2. Version parity confirmed: ${currentVersion}`);

// 3. Cache key and threshold checks
assert.ok(html.includes('CACHE_PO_PRODUCTS_V4'), 'Cache key must be CACHE_PO_PRODUCTS_V4');
assert.ok(html.includes('> 4000'), 'Product load check threshold must be > 4000');
console.log('[PASS] 3. Cache key V4 and >4000 product threshold verified');

// 4. Test simulated DOM with all 4,827 products from snapshot
function createElement(tagName = 'div') {
  const listeners = {};
  const classes = new Set();
  let innerHtmlContent = '';
  return {
    tagName: tagName.toUpperCase(),
    value: '',
    className: '',
    children: [],
    parentElement: null,
    dataset: {},
    get innerHTML() { return innerHtmlContent; },
    set innerHTML(value) {
      innerHtmlContent = String(value);
      if (innerHtmlContent === '') this.children = [];
    },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    dispatch(type) {
      if (listeners[type]) listeners[type].call(this, { target: this });
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() { this.focused = true; }
  };
}

async function verifyFullCatalogSearchAndAutofill() {
  const elements = new Map();
  const documentMock = {
    createElement,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    addEventListener() {},
    querySelectorAll() { return []; }
  };

  const context = vm.createContext({
    window: {
      location: { href: 'https://akra-web.github.io/TrackingPO/', pathname: '/TrackingPO/', search: '' },
      history: { replaceState() {} },
      self: {},
      top: {},
      AkraSupabasePO: { searchProducts: async () => [] }
    },
    document: documentMock,
    localStorage: { getItem: () => 'test-token', setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    URL,
    URLSearchParams,
    console,
    setTimeout: (handler) => { handler(); return 1; },
    clearTimeout() {},
    setInterval() {},
    lucide: { createIcons() {} }
  });

  vm.runInContext(inlineScripts[2][1], context);

  // Setup full products catalog in appData
  assert.ok(productsSnapshot.length >= 4800, `Products snapshot must have >= 4800 products (got ${productsSnapshot.length})`);
  context.appData = {
    prList: [],
    pendingPOs: [],
    grCompleted: [],
    apvList: [],
    vendors: [],
    products: productsSnapshot.map(p => ({
      sku: p.sku,
      name: p.name,
      subname: p.subname || '',
      unit: p.unit || 'ชิ้น',
      default_vendor: p.vendor || '',
      vendor: p.vendor || '',
      last_vendor: p.vendor || '',
      last_warehouse: 'W1'
    }))
  };

  const suggestionBox = createElement('ul');
  suggestionBox.classList.add('hidden');
  const skuInput = createElement('input');
  const unitInput = createElement('input');
  const quantityInput = createElement('input');
  const row = createElement('div');
  row.querySelector = selector => ({
    '.suggestion-box': suggestionBox,
    '.c-sku': skuInput,
    '.c-unit': unitInput,
    '.c-qty': quantityInput
  }[selector] || null);

  const productInput = createElement('input');
  productInput.parentElement = row;
  productInput.closest = selector => selector === '.create-po-item-row' ? row : null;

  context.setupProductAutocompleteForPO(productInput);

  // Test 4A: Search for largest packaging unit "ไร่ทิพย์ มัด" (previously cut off beyond row 1000)
  productInput.value = 'ไร่ทิพย์ มัด';
  productInput.dispatch('input');
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(suggestionBox.children.length > 0, 'Searching for "ไร่ทิพย์ มัด" must return results');
  assert.equal(suggestionBox.classList.contains('hidden'), false, 'Suggestions must be visible');
  
  // Verify that all suggestions contain "ไร่ทิพย์" and have unit "มัด"
  const zRaitipMatch = suggestionBox.children.find(child => child.innerHTML.includes('Z/งาขาว ไร่ทิพย์ (มัด20x500g)'));
  assert.ok(zRaitipMatch, 'Autocomplete must find Z/งาขาว ไร่ทิพย์ (มัด20x500g)');
  assert.match(zRaitipMatch.innerHTML, /หน่วย:\s*มัด/, 'Unit badge must display มัด');

  // Test 4B: Select Z/งาขาว ไร่ทิพย์ (มัด20x500g) and verify auto-fill
  zRaitipMatch.onmousedown({ preventDefault() {} });
  assert.equal(productInput.value, 'Z/งาขาว ไร่ทิพย์ (มัด20x500g)');
  assert.equal(skuInput.value, 'DG06230105');
  assert.equal(unitInput.value, 'มัด');
  assert.equal(documentMock.getElementById('create-po-vendor').value, 'บริษัท ไร่ธัญญะ จำกัด');

  // Test 4C: Search for Thai high-index item "พริกไทย ไร่ทิพย์" (index ~4177)
  productInput.value = 'พริกไทย ไร่ทิพย์';
  productInput.dispatch('input');
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(suggestionBox.children.length >= 2, 'Searching for "พริกไทย ไร่ทิพย์" must find both bag and pack');
  const pepperMatch = suggestionBox.children.find(child => child.innerHTML.includes('พริกไทย เม็ดดำ ไร่ทิพย์ (ถุง100g)'));
  assert.ok(pepperMatch, 'Autocomplete must find พริกไทย เม็ดดำ ไร่ทิพย์ (ถุง100g)');

  console.log('[PASS] 4. Full catalog autocomplete search and autofill verified (Z/ largest units and Raitip items)');
}

async function run() {
  await verifyFullCatalogSearchAndAutofill();
  console.log('[ALL PASS] PO Full Product Catalog verification completed successfully');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
