const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')).version;

assert(html.includes(`const CURRENT_VERSION = "${version}"`), 'PO index.html and version.json must match');
assert(html.includes('APP_ID: "app-tracking"'), 'PO frontend must verify the stable Main AppConfig entry id');
const authStart = source.indexOf('function requireAuth(');
const authEnd = source.indexOf('\n// ==========================================', authStart);
const authSource = source.slice(authStart, authEnd);

assert(authStart >= 0, 'PO backend must define requireAuth');
assert(
  authSource.includes('encodeURIComponent(opts.appId)'),
  'shared backend authorization must request the app id declared by each protected action'
);
assert(authSource.includes('opts.permAppId || opts.appId'), 'shared backend must keep entry app ids separate from permission namespaces');

const context = vm.createContext({
  console,
  JSON,
  encodeURIComponent,
  UrlFetchApp: {
    fetch() {
      return {
        getContentText() {
          return JSON.stringify({
            valid: true,
            user: { name: 'Fixture', roles: ['Cashier'], perms: { 'app-po': ['createPO'] }, mustChangePassword: true }
          });
        }
      };
    }
  }
});
vm.runInContext(source, context);
const backendDenied = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.createPO, {})`, context);
assert.strictEqual(backendDenied.error.reason, 'mandatory_password_change_required', 'PO backend mutations must reject mandatory-password sessions');

const requestedUrls = [];
let grPerms = ['receiveGR'];
let grRoles = ['WAREHOUSE'];
let poPerms = ['createPO'];
let poRoles = ['Cashier'];
context.UrlFetchApp.fetch = url => {
  requestedUrls.push(url);
  const isGr = url.includes('appId=app-gr');
  return {
    getContentText() {
      return JSON.stringify({
        valid: true,
        user: isGr
          ? { name: 'Warehouse', roles: grRoles, perms: { 'app-gr': grPerms }, mustChangePassword: false }
          : { name: 'PO User', roles: poRoles, perms: { 'app-po': poPerms }, mustChangePassword: false }
      });
    }
  };
};

const grReceiveAllowed = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.bulkReceivePO, { targetStatus: 'Pending Review' })`, context);
assert(grReceiveAllowed.user, 'GR receive must authorize through app-gr without requiring app-po access');
assert(requestedUrls.at(-1).includes('appId=app-gr'), 'GR receive must ask Main for app-gr access');

grPerms = ['approveGR'];
const grPendingApprovalAllowed = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.bulkReceivePO, { targetStatus: 'Pending Review' })`, context);
assert(grPendingApprovalAllowed.user, 'GR Pending must allow approveGR as well as receiveGR');

grPerms = [];
const grPendingDenied = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.bulkReceivePO, { targetStatus: 'Pending Review' })`, context);
assert.strictEqual(grPendingDenied.error.reason, 'permission_denied', 'GR Pending must reject a non-privileged role without receiveGR or approveGR');

grRoles = ['SUPERVISOR'];
const grPrivilegedWithoutPermission = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.bulkReceivePO, { targetStatus: 'Pending Review' })`, context);
assert.strictEqual(grPrivilegedWithoutPermission.error.reason, 'permission_denied', 'GR Pending must reject a privileged role after its final granular permission is removed');

grRoles = ['WAREHOUSE'];
grPerms = ['approveGR'];
const grCompletedDenied = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.bulkReceivePO, { targetStatus: 'GR Completed' })`, context);
assert.strictEqual(grCompletedDenied.error.reason, 'permission_denied', 'GR Completed must reject approveGR without a privileged role');

grRoles = ['SUPERVISOR'];
const grCompletedAllowed = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.bulkReceivePO, { targetStatus: 'GR Completed' })`, context);
assert(grCompletedAllowed.user, 'GR Completed must allow a Supervisor with approveGR');
assert.strictEqual(vm.runInContext('PROTECTED_ACTIONS.recallGR.appId', context), 'app-gr', 'GR recall must also verify app-gr rather than app-po');

grPerms = ['receiveGR'];
const grCompletedWithoutApproval = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.bulkReceivePO, { targetStatus: 'GR Completed' })`, context);
assert.strictEqual(grCompletedWithoutApproval.error.reason, 'permission_denied', 'GR Completed must reject a Supervisor without approveGR');

const grRecallWithoutApproval = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.recallGR, {})`, context);
assert.strictEqual(grRecallWithoutApproval.error.reason, 'permission_denied', 'GR recall must reject a Supervisor without approveGR');

grPerms = ['approveGR'];
const grRecallAllowed = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.recallGR, {})`, context);
assert(grRecallAllowed.user, 'GR recall must allow a Supervisor with approveGR');

grRoles = ['WAREHOUSE'];
const grRecallNonPrivileged = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.recallGR, {})`, context);
assert.strictEqual(grRecallNonPrivileged.error.reason, 'permission_denied', 'GR recall must reject approveGR without a privileged role');

const poCreateAllowed = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.createPO, {})`, context);
assert(poCreateAllowed.user, 'PO create must authorize through app-tracking entry and app-po/createPO permission');
assert(requestedUrls.at(-1).includes('appId=app-tracking'), 'PO mutations must ask Main for the registered TrackingPO app id');
assert.strictEqual(vm.runInContext('PROTECTED_ACTIONS.createPO.permAppId', context), 'app-po', 'PO granular permissions must remain in the app-po namespace');

poRoles = ['SUPERVISOR'];
poPerms = [];
const poCreateWithoutPermission = vm.runInContext(`requireAuth('fixture-token', PROTECTED_ACTIONS.createPO, {})`, context);
assert.strictEqual(poCreateWithoutPermission.error.reason, 'permission_denied', 'PO create must reject a privileged role after its final granular permission is removed');

const helperStart = html.indexOf('function isVerifiedAppSession(');
const helperEnd = html.indexOf('\n    }', helperStart) + '\n    }'.length;
assert(helperStart >= 0, 'PO frontend must define a testable verified-session guard');
const frontend = vm.createContext({ result: null });
vm.runInContext(`${html.slice(helperStart, helperEnd)}; result = isVerifiedAppSession({ valid: true, user: { mustChangePassword: true } });`, frontend);
assert.strictEqual(frontend.result, false, 'PO frontend must not expose authenticated UI for mandatory-password sessions');

console.log('PASS po-auth-contract: password fail-closed and shared PO/GR app-permission routing pass');
