const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8');
const prSource = fs.readFileSync(path.join(__dirname, '..', '..', 'PR', 'Code.gs.txt'), 'utf8');

function makeSheet(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getLastColumn: () => 15,
    getRange: () => ({ getValues: () => rows })
  };
}

function poRow(uid, ref, status, date) {
  return [uid, ref, date, `PO-${uid}`, 'Vendor', 'W1', `SKU-${uid}`, `Product ${uid}`, 1, 'EA', '', status, ''];
}

function grRow(uid, poUid, status, ata) {
  return [`GR-${uid}`, poUid, new Date('2026-08-01'), ata, 'Receiver', `SKU-${uid}`, `Product ${uid}`, 1, 'EA', 'A1', '', 1, '', status, ''];
}

function createRuntime(runtimeSource = source) {
  let formatDateCalls = 0;
  const sheets = {
    Vendor: makeSheet([['V-1', 'Vendor']]),
    PR: makeSheet([]),
    PO: makeSheet([
      poRow('ACTIVE', 'BILL-A', 'Pending GR', new Date('2026-08-01')),
      poRow('MATCH', 'BILL-M', 'GR Completed', new Date('2026-07-02')),
      poRow('APV', 'BILL-P', 'PO Closed - Ready for APV', new Date('2026-07-01'))
    ]),
    GR: makeSheet([
      grRow('ACTIVE', 'ACTIVE', 'Draft GR', new Date('2026-08-02')),
      grRow('MATCH', 'MATCH', 'GR Completed', new Date('2026-07-03')),
      grRow('APV', 'APV', 'GR Completed', new Date('2026-07-02'))
    ])
  };
  const context = vm.createContext({
    console,
    Date,
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => sheets[name] || null }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Utilities: {
      formatDate: () => { formatDateCalls += 1; return '03/08/2026'; },
      getUuid: () => 'fixture-uuid'
    }
  });
  vm.runInContext(runtimeSource, context, { filename: 'Code.gs.txt' });
  return { context, getFormatDateCalls: () => formatDateCalls };
}

function call(runtime, options) {
  runtime.context.__options = options;
  return vm.runInContext('getInitialData(__options)', runtime.context);
}

const legacy = createRuntime();
const legacyResult = call(legacy, { includeProducts: false });
assert.strictEqual(legacyResult.grCompleted.length, 1, 'legacy completed read should retain Match rows');
assert.strictEqual(legacyResult.apvList.length, 1, 'legacy completed read should retain APV rows');

const match = createRuntime();
const matchResult = call(match, { includeProducts: false, includeCompleted: true, includeMatch: true, includeAPV: false });
assert.strictEqual(matchResult.grCompleted.length, 1);
assert.strictEqual(matchResult.apvList, undefined, 'Match-only response should omit APV payload');

const apv = createRuntime();
const apvResult = call(apv, { includeProducts: false, includeCompleted: true, includeMatch: false, includeAPV: true });
assert.strictEqual(apvResult.grCompleted, undefined, 'APV-only response should omit completed GR payload');
assert.strictEqual(apvResult.apvList.length, 1);
assert.strictEqual(apv.getFormatDateCalls(), 4, 'APV-only read should hydrate active rows plus only the selected APV row/details');

const prApv = createRuntime(prSource);
const prApvResult = call(prApv, { includeProducts: false, includeCompleted: true, includeMatch: false, includeAPV: true });
assert.strictEqual(JSON.stringify(prApvResult), JSON.stringify(apvResult), 'PR mirror must preserve the same scoped APV response');
assert.strictEqual(prApv.getFormatDateCalls(), 4, 'PR mirror must preserve bounded hydration');

console.log('PASS po-read-performance: legacy/scoped Match/APV contracts and PR mirror');
