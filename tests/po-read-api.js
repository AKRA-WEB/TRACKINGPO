const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('async function readApiCall');
const end = html.indexOf('\n    async function ', start + 1);

assert(start >= 0 && end > start, 'readApiCall must exist in index.html');
const functionSource = html.slice(start, end);

async function runScenario(responses) {
  const requests = [];
  const timeouts = [];
  const context = vm.createContext({
    console,
    AbortController,
    setTimeout: (callback, ms) => {
      timeouts.push(ms);
      return setTimeout(callback, ms);
    },
    clearTimeout,
    DATA_SCRIPT_URL: 'https://fixture.invalid/exec',
    AppVersionGuard: { blockIfStale: async () => false },
    getSessionToken: () => 'fixture-token',
    delay: async () => {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  });
  vm.runInContext(functionSource, context);
  context.__payload = { includeCompleted: false };
  const result = await vm.runInContext("readApiCall('getInitialData', __payload)", context);
  return { result, requests, timeouts };
}

(async () => {
  const httpRetry = await runScenario([
    { ok: false, status: 404, text: async () => '<html>temporary</html>' },
    { ok: true, status: 200, text: async () => JSON.stringify({ success: true, value: 'http-retry' }) }
  ]);
  assert.strictEqual(httpRetry.requests.length, 2);
  assert.strictEqual(httpRetry.result.value, 'http-retry');

  const jsonRetry = await runScenario([
    { ok: true, status: 200, text: async () => '<html>temporary</html>' },
    { ok: true, status: 200, text: async () => JSON.stringify({ success: true, value: 'json-retry' }) }
  ]);
  assert.strictEqual(jsonRetry.requests.length, 2);
  assert.strictEqual(jsonRetry.result.value, 'json-retry');
  const requestBody = JSON.parse(jsonRetry.requests[0].options.body);
  assert.strictEqual(requestBody.action, 'getInitialData');
  assert.strictEqual(requestBody.token, 'fixture-token');

  const exhausted = await runScenario([
    new Error('NETWORK_FAILURE'),
    { ok: false, status: 503, text: async () => 'temporary' }
  ]);
  assert.strictEqual(exhausted.requests.length, 2);
  assert.strictEqual(exhausted.result.success, false);
  assert.match(exhausted.result.message, /ลองใหม่/);
  assert.deepStrictEqual(exhausted.timeouts, [60000, 60000], 'each read attempt must have a bounded timeout');
  assert(exhausted.requests.every(request => request.options.signal), 'each read attempt must pass an abort signal');

  console.log('PASS po-read-api: bounded reads retry once, retain request contract, and fail safely after exhaustion');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
