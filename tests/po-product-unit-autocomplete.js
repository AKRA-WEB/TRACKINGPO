const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];

assert.ok(inlineScripts.length > 0, 'PO index.html must contain inline scripts');
inlineScripts.forEach((script, index) => {
  if (script[1].trim()) new vm.Script(script[1], { filename: `po-inline-${index}.js` });
});

function createElement(tagName = 'div') {
  const listeners = {};
  const classes = new Set();
  let html = '';
  return {
    tagName: tagName.toUpperCase(),
    value: '',
    className: '',
    children: [],
    parentElement: null,
    dataset: {},
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = String(value);
      if (html === '') this.children = [];
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

async function verifyFrontendUnitSearchAndSuggestion() {
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

  const fallbackClient = { searchProducts: async () => [] };
  const context = vm.createContext({
    window: {
      location: { href: 'https://akra-web.github.io/TrackingPO/', pathname: '/TrackingPO/', search: '' },
      history: { replaceState() {} },
      self: {},
      top: {},
      AkraSupabasePO: fallbackClient
    },
    document: documentMock,
    localStorage: { getItem: () => 'test-token', setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    URL,
    URLSearchParams,
    console,
    setTimeout: handler => { handler(); return 1; },
    clearTimeout() {},
    setInterval() {},
    lucide: { createIcons() {} },
    AkraSupabasePO: fallbackClient
  });

  vm.runInContext(inlineScripts[2][1], context);

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

  context.appData = {
    prList: [],
    pendingPOs: [],
    grCompleted: [],
    apvList: [],
    vendors: [],
    products: [
      {
        sku: 'SM18347403',
        name: 'Z/กะทิ แม่รัตน์ (กล่อง12x1L)',
        subname: '',
        unit: 'ลัง',
        default_vendor: 'กะทิทรายทอง',
        last_warehouse: 'W1'
      },
      {
        sku: 'SM100200',
        name: 'แป้งสาลี ตราพัดโบก (ถุง1kg)',
        subname: 'แป้งเค้ก',
        unit: 'ถุง',
        default_vendor: 'UFM'
      }
    ]
  };

  context.setupProductAutocompleteForPO(productInput);
  productInput.value = 'ลัง';
  productInput.dispatch('input');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(suggestionBox.children.length, 1, 'Searching by unit must return the carton product even when its name does not contain ลัง');
  assert.match(suggestionBox.children[0].innerHTML, /หน่วย:\s*ลัง/, 'The visible suggestion must label the product unit');
  assert.equal(suggestionBox.classList.contains('hidden'), false, 'Matching unit suggestions must be visible');

  suggestionBox.children[0].onmousedown({ preventDefault() {} });
  assert.equal(productInput.value, 'Z/กะทิ แม่รัตน์ (กล่อง12x1L)');
  assert.equal(skuInput.value, 'SM18347403');
  assert.equal(unitInput.value, 'ลัง');
}

async function verifyApiFallbackUnitSearch() {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.action, 'getProducts');
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          products: [
            { sku: 'SM18347403', name: 'Z/กะทิ แม่รัตน์ (กล่อง12x1L)', subname: '', unit: 'ลัง' },
            { sku: 'SM100200', name: 'แป้งสาลี ตราพัดโบก (ถุง1kg)', subname: 'แป้งเค้ก', unit: 'ถุง' }
          ]
        }
      })
    };
  };

  try {
    const clientPath = require.resolve('../js/supabase-po-client.js');
    delete require.cache[clientPath];
    const client = require(clientPath);
    const matches = await client.searchProducts('ลัง', 30, 'test-token');
    assert.deepEqual(matches.map(product => product.sku), ['SM18347403'], 'API fallback search must match the product unit');
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  await verifyFrontendUnitSearchAndSuggestion();
  console.log('[PASS] PO autocomplete finds products by unit and visibly labels the unit');
  await verifyApiFallbackUnitSearch();
  console.log('[PASS] PO API fallback search finds products by unit');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
