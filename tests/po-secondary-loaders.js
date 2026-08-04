const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(name) {
  const start = html.indexOf(`async function ${name}`);
  const end = html.indexOf('\n    async function ', start + 1);
  assert(start >= 0 && end > start, `${name} must exist in index.html`);
  return html.slice(start, end);
}

const matchSource = extract('ensureMatchLoaded');
const apvSource = extract('ensureApvLoaded');
const requests = [];
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', innerText: '' });
  return elements.get(id);
};
const context = vm.createContext({
  console,
  poMatchLoaded: false,
  poApvLoaded: false,
  poSecondaryDataGeneration: 0,
  appData: { grCompleted: [], apvList: [] },
  document: { getElementById: element },
  readApiCall: async (action, options) => {
    requests.push({ action, options: JSON.parse(JSON.stringify(options)) });
    if (options.includeMatch) return { success: true, grCompleted: [{ uid: 'MATCH' }] };
    return { success: true, apvList: [{ uid: 'APV' }] };
  },
  groupGRData: () => {},
  groupAPVData: () => {},
  groupedMatchData: { bill: {} },
  groupedAPVData: { bill: {} },
  renderTab3_Match: () => {},
  renderTab4_APV: () => {},
  lucide: { createIcons: () => {} }
});

vm.runInContext(`${matchSource}\n${apvSource}`, context);

(async () => {
  await vm.runInContext('ensureMatchLoaded()', context);
  await vm.runInContext('ensureApvLoaded()', context);

  assert.deepStrictEqual(requests[0].options, {
    includeProducts: false,
    includeCompleted: true,
    includeMatch: true,
    includeAPV: false
  });
  assert.deepStrictEqual(requests[1].options, {
    includeProducts: false,
    includeCompleted: true,
    includeMatch: false,
    includeAPV: true
  });
  assert.strictEqual(context.appData.grCompleted[0].uid, 'MATCH');
  assert.strictEqual(context.appData.apvList[0].uid, 'APV');
  assert.strictEqual(context.poMatchLoaded, true);
  assert.strictEqual(context.poApvLoaded, true);

  console.log('PASS po-secondary-loaders: Match and APV request independent payloads');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
