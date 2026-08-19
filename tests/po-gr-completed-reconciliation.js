const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8');

function makeSheet(rows) {
  let values = rows.slice();
  return {
    getLastRow: () => values.length + 1,
    getLastColumn: () => 15,
    getRange: (startRow, startCol, numRows, numCols) => ({
      getValues: () => values,
      getValue: () => (values[startRow - 2] ? values[startRow - 2][startCol - 1] : ''),
      setValue: (val) => {
        if (values[startRow - 2]) values[startRow - 2][startCol - 1] = val;
      }
    })
  };
}

function poRow(uid, ref, status, date) {
  return [uid, ref, date, `PO-${uid}`, 'Vendor', 'W1', `SKU-${uid}`, `Product ${uid}`, 1, 'EA', '', status, ''];
}

function grRow(uid, poUid, status, ata) {
  return [`GR-${uid}`, poUid, new Date('2026-08-01'), ata, 'Receiver', `SKU-${uid}`, `Product ${uid}`, 1, 'EA', 'A1', '', 1, '', status, ''];
}

function createRuntime(customSheets = {}, cacheData = null) {
  let lockAcquired = false;
  let lockReleased = false;
  let cachePuts = {};
  const defaultSheets = {
    Vendor: makeSheet([['V-1', 'Vendor']]),
    PR: makeSheet([]),
    PO: makeSheet([
      poRow('PO-TRIM-1 ', 'BILL-1', 'Pending GR', new Date('2026-08-01')),
      poRow('PO-COMP-1', 'BILL-2', 'Completed', new Date('2026-08-01')),
      poRow('PO-APV-1', 'BILL-3', 'PO Closed - Ready for APV', new Date('2026-08-01'))
    ]),
    GR: makeSheet([
      grRow('GR-1', ' PO-TRIM-1', 'GR Completed', new Date('2026-08-02'))
    ])
  };
  const sheets = Object.assign({}, defaultSheets, customSheets);

  const context = vm.createContext({
    console,
    Date,
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: name => sheets[name] || null
      }),
      flush: () => {}
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cacheData && cacheData[key] ? cacheData[key] : null,
        put: (key, val) => { cachePuts[key] = val; },
        remove: () => {}
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { lockAcquired = true; return true; },
        waitLock: () => { lockAcquired = true; return true; },
        releaseLock: () => { lockReleased = true; }
      })
    },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Utilities: {
      formatDate: () => '03/08/2026',
      getUuid: () => 'fixture-uuid'
    }
  });
  vm.runInContext(source, context, { filename: 'Code.gs.txt' });
  return { context, getLockState: () => ({ lockAcquired, lockReleased }) };
}

// 1. Test poEffectiveStatus_ unit behavior
const rt = createRuntime();
assert.strictEqual(vm.runInContext("poEffectiveStatus_('Completed', '')", rt.context), 'GR Completed', 'poStatus Completed should normalize to GR Completed');
assert.strictEqual(vm.runInContext("poEffectiveStatus_('GR Completed ', '')", rt.context), 'GR Completed', 'poStatus with whitespace should normalize');
assert.strictEqual(vm.runInContext("poEffectiveStatus_('Pending GR', 'Completed ')", rt.context), 'GR Completed', 'latestGRStatus Completed with whitespace should normalize');
assert.strictEqual(vm.runInContext("poEffectiveStatus_('Pending GR', 'GR Completed')", rt.context), 'GR Completed');
assert.strictEqual(vm.runInContext("poEffectiveStatus_('Pending GR', 'Draft GR')", rt.context), 'Draft GR');
assert.strictEqual(vm.runInContext("poEffectiveStatus_('PO Closed - Ready for APV', 'GR Completed')", rt.context), 'PO Closed - Ready for APV');

// 2. Test getInitialData trims UIDs when joining PO and GR sheets
const readRes = vm.runInContext("getInitialData({ includeProducts: false, includeMatch: true, includeAPV: true })", rt.context);
assert(readRes.success, 'getInitialData should succeed');
assert.strictEqual(readRes.pendingPOs.length, 0, 'PO with GR Completed in GR sheet (with whitespace) should NOT be in pendingPOs');
assert.strictEqual(readRes.grCompleted.length, 2, 'Should have 2 grCompleted items (PO-TRIM-1 joined with GR, and PO-COMP-1 with status Completed)');

// 3. Test bypassCache flag
const cachedStale = JSON.stringify({ success: true, pendingPOs: [{ uid: 'STALE' }] });
const cachedRt = createRuntime({}, { 'PO_INITIAL_LEAN_V3': cachedStale });

const cachedResult = vm.runInContext("getInitialData({ includeProducts: false, includeCompleted: false })", cachedRt.context);
assert.strictEqual(cachedResult.pendingPOs[0].uid, 'STALE', 'Default lean mode reads from script cache');

const bypassResult = vm.runInContext("getInitialData({ includeProducts: false, includeCompleted: false, bypassCache: true })", cachedRt.context);
assert.notStrictEqual(bypassResult.pendingPOs[0] && bypassResult.pendingPOs[0].uid, 'STALE', 'bypassCache: true must skip script cache');

console.log('PASS po-gr-completed-reconciliation: UID trimming, symmetric status, and cache bypass pass');
