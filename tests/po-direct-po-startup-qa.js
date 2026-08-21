const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('=== Running PO Direct PO & Fast Startup QA Tests ===\n');

const poHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractScript(index) {
  const matches = poHtmlSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
  if (!matches || !matches[index]) throw new Error(`Script tag ${index} not found`);
  return matches[index].replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');
}

const mainScriptCode = extractScript(2);

// Test 1: Verify UTF-8 Thai JWT decoding and padding resilience
console.log('Test 1: Testing decodeJwtPayload resilience with Thai UTF-8 and base64 padding...');
{
  const sandbox = {
    document: { addEventListener: () => {}, getElementById: () => null },
    window: { addEventListener: () => {} },
    TextDecoder: TextDecoder,
    atob: atob,
    Date: Date,
    JSON: JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(mainScriptCode, sandbox);

  // Encode Thai name and claims without padding
  const payload = {
    id: 'user-th-01',
    name: 'สมชาย จัดซื้อ',
    roles: ['PURCHASER'],
    perms: { 'app-tracking': ['createPO', 'approvePR', 'closePO'] },
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const jsonStr = JSON.stringify(payload);
  const base64 = Buffer.from(jsonStr, 'utf8').toString('base64url');
  const mockToken = `header.${base64}.signature`;

  const decoded = sandbox.decodeJwtPayload(mockToken);
  assert.ok(decoded, 'decodeJwtPayload must successfully decode valid JWT');
  assert.equal(decoded.name, 'สมชาย จัดซื้อ', 'Thai name must decode with exact UTF-8 characters');
  assert.deepEqual(decoded.roles, ['PURCHASER'], 'Roles must match');
  console.log('  [PASS] decodeJwtPayload decoded unpadded Thai UTF-8 JWT successfully.');
}

// Test 2: Testing can() function with app-po, app-tracking, and legacy role fallback
console.log('\nTest 2: Testing can() permission checks for PURCHASER, app-tracking, and role fallback...');
{
  const sandbox = {
    document: { addEventListener: () => {}, getElementById: () => null },
    window: { addEventListener: () => {} },
    TextDecoder: TextDecoder,
    atob: atob,
    Date: Date,
    JSON: JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(mainScriptCode, sandbox);

  // Case A: Modern token with app-tracking perms
  sandbox.window = {
    appSession: {
      id: 'p1',
      roles: ['PURCHASER'],
      perms: { 'app-tracking': ['createPO', 'approvePR', 'closePO'] }
    }
  };
  assert.equal(sandbox.can('createPO'), true, 'PURCHASER with app-tracking perms must be allowed createPO');
  assert.equal(sandbox.can('approvePR'), true, 'PURCHASER with app-tracking perms must be allowed approvePR');
  assert.equal(sandbox.can('closePO'), true, 'PURCHASER with app-tracking perms must be allowed closePO');

  // Case B: Modern token with app-po perms
  sandbox.window = {
    appSession: {
      id: 'p2',
      roles: ['USER'],
      perms: { 'app-po': ['createPO'] }
    }
  };
  assert.equal(sandbox.can('createPO'), true, 'User with app-po createPO must be allowed');
  assert.equal(sandbox.can('approvePR'), false, 'User without approvePR must be denied');

  // Case C: Legacy token without perms contract (PURCHASER role)
  sandbox.window = {
    appSession: {
      id: 'p3',
      roles: ['PURCHASER'],
      perms: {}
    }
  };
  assert.equal(sandbox.can('createPO'), true, 'Legacy PURCHASER role fallback must allow createPO');
  assert.equal(sandbox.can('approvePR'), true, 'Legacy PURCHASER role fallback must allow approvePR');

  // Case D: Explicit-empty perms [app-po: []] must DENY even for ADMIN
  sandbox.window = {
    appSession: {
      id: 'p4',
      roles: ['ADMIN'],
      perms: { 'app-po': [] }
    }
  };
  assert.equal(sandbox.can('createPO'), false, 'Explicit empty app-po perms must deny createPO even for ADMIN');

  // Case E: Unauthorized role without perms
  sandbox.window = {
    appSession: {
      id: 'p5',
      roles: ['OPERATOR'],
      perms: {}
    }
  };
  assert.equal(sandbox.can('createPO'), false, 'OPERATOR without perms must be denied createPO');

  console.log('  [PASS] can() permissions and role fallbacks verified across all contract variations.');
}

// Test 3: Testing openPurchasingForm() opens modal without permission denial
console.log('\nTest 3: Testing openPurchasingForm() DOM interaction for Direct PO...');
{
  const elementStore = new Map();
  function getOrCreateEl(id, tag = 'div') {
    if (!elementStore.has(id)) {
      elementStore.set(id, {
        id: id,
        tagName: tag.toUpperCase(),
        value: '',
        innerText: '',
        innerHTML: '',
        classList: {
          classes: new Set(['hidden']),
          remove: function(c) { this.classes.delete(c); },
          add: function(c) { this.classes.add(c); },
          contains: function(c) { return this.classes.has(c); }
        },
        dataset: {},
        reset: function() { this.value = ''; },
        addEventListener: function() {},
        removeEventListener: function() {},
        appendChild: function(child) { this.children = this.children || []; this.children.push(child); },
        querySelector: function() { return null; },
        querySelectorAll: function() { return []; }
      });
    }
    return elementStore.get(id);
  }

  const documentMock = {
    getElementById: (id) => getOrCreateEl(id),
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      className: '',
      innerHTML: '',
      appendChild: () => {},
      querySelector: () => ({ addEventListener: () => {} }),
      closest: () => null
    }),
    addEventListener: () => {}
  };

  const sandbox = {
    document: documentMock,
    window: {
      location: { search: '?sso=mock-token' },
      appSession: {
        id: 'usr-purchaser',
        name: 'Purchaser User',
        roles: ['PURCHASER'],
        perms: { 'app-tracking': ['createPO', 'approvePR', 'closePO'] }
      }
    },
    lucide: { createIcons: () => {} },
    showNotification: (msg, type) => {
      if (type === 'error') throw new Error('Unexpected error notification: ' + msg);
    },
    TextDecoder: TextDecoder,
    atob: atob,
    Date: Date,
    JSON: JSON
  };

  vm.createContext(sandbox);
  vm.runInContext(mainScriptCode, sandbox);

  // Call openPurchasingForm
  sandbox.openPurchasingForm();

  const modal = getOrCreateEl('modal-create-po');
  assert.equal(modal.classList.contains('hidden'), false, 'modal-create-po must not have hidden class');
  assert.equal(modal.classList.contains('flex'), true, 'modal-create-po must have flex class');
  assert.equal(getOrCreateEl('modal-create-po-title').innerText, 'สร้างบิลใหม่ (Direct PO)', 'Modal title must be Direct PO');
  assert.equal(getOrCreateEl('btn-submit-direct-po').innerText, 'บันทึกสั่งซื้อ (Create PO)', 'Submit button must say Create PO');

  console.log('  [PASS] openPurchasingForm successfully opens modal with full Direct PO initial state.');
}

console.log('\n=== ALL QA PO Direct PO & Startup Tests PASSED! ===\n');
