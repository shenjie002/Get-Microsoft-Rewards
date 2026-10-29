const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('get-microsoft-rewards.user.js', 'utf8');

function harness(storage = new Map([['refresh_token', 'legacy-token'], ['Config.lastSignDate', 'legacy-date']])) {
    let cookie = '_U=account-A; other=123';
    const noop = () => {};
    const element = () => ({ textContent: '', style: {}, disabled: false, classList: { remove: noop }, replaceChildren: noop, appendChild: noop });
    const nodes = Object.fromEntries(['logBox', 'panel', 'account', 'points', 'pc', 'read', 'signStatus', 'level', 'pcBar', 'readBar', 'valPromo', 'btnAll', 'btnSearch', 'btnSign', 'btnRead', 'btnPromo', 'btnAuthSave'].map(k => [k, element()]));
    const context = vm.createContext({ GM_registerMenuCommand: () => {}, GM_xmlhttpRequest: options => { options.onerror(); }, document: { createElement: element }, crypto: webcrypto, TextEncoder, getCookies: async () => cookie, GM_getValue: (k, d) => storage.has(k) ? storage.get(k) : d, GM_setValue: (k, v) => storage.set(k, v), nodes, log: noop, state: { running: true, accessToken: 'old-token' }, dashboard: {} });
    const section = source.slice(source.indexOf('    let accountScope = null;'), source.indexOf('    // ========== 进度保存/恢复'));
    vm.runInContext(section + '\nglobalThis.api = { assertAccount, accountGet, accountSet, scopedKey, readAccountScope, dashboardIdentity, parseDashboard, pendingRequests };', context);
    return { context, storage, nodes, api: context.api, cookie: value => { cookie = value; } };
}

test('legacy credentials and records are not inherited; stored keys are scoped', async () => {
    const h = harness();
    await h.api.assertAccount();
    assert.equal(h.api.accountGet('refresh_token', ''), '');
    assert.equal(h.api.accountGet('Config.lastSignDate', ''), '');
    for (const key of ['refresh_token', 'auth_code', 'Config.lastSignDate', 'mr_search_progress', 'auto_run_today']) {
        h.api.accountSet(key, 'A');
        assert.equal(h.api.accountGet(key), 'A');
        assert.match(h.api.scopedKey(key), /^mr_account_v3:[a-f0-9]{64}:/);
        assert.ok(!h.api.scopedKey(key).includes('account-A'));
    }
});

test('cookie change stops tasks, clears memory, aborts requests and blocks storage', async () => {
    const h = harness();
    await h.api.assertAccount();
    let aborted = false;
    h.api.pendingRequests.add({ abort: () => { aborted = true; } });
    h.cookie('_U=account-B');
    await assert.rejects(h.api.assertAccount());
    assert.equal(h.context.state.running, false);
    assert.equal(h.context.state.accessToken, null);
    assert.equal(h.context.dashboard, null);
    assert.equal(aborted, true);
    assert.equal(h.nodes.btnAll.disabled, true);
    assert.throws(() => h.api.accountSet('refresh_token', 'late-A-response'));
    await assert.rejects(h.api.assertAccount());
});

test('new page for B sees no records from A; different account auto-run keys', async () => {
    const h = harness();
    await h.api.assertAccount();
    const aKey = h.api.scopedKey('auto_run_today');
    h.api.accountSet('refresh_token', 'A-token');
    const b = harness(h.storage);
    b.cookie('_U=account-B');
    await b.api.assertAccount();
    assert.notEqual(aKey, b.api.scopedKey('auto_run_today'));
    assert.equal(b.api.accountGet('refresh_token', ''), '');
});

test('missing or ambiguous identity fails closed', async () => {
    for (const cookie of ['', 'other=123', '_U=A; _U=B']) {
        const h = harness();
        h.cookie(cookie);
        await assert.rejects(h.api.assertAccount());
        assert.equal(h.nodes.btnAll.disabled, true);
    }
});

test('dashboard identity works without Cookie API and ignores display data', async () => {
    const h = harness();
    h.cookie('');
    h.context.GM_xmlhttpRequest = options => options.onload({ status: 200, responseText: 'var dashboard = {"userProfile":{"puid":"ABC123","name":"Alice"}}; var next = 1;' });
    await h.api.assertAccount();
    const first = h.api.scopedKey('refresh_token');
    h.context.GM_xmlhttpRequest = options => options.onload({ status: 200, responseText: 'var dashboard = {"userProfile":{"puid":"ABC123","name":"Updated"}}; var next = 1;' });
    await h.api.assertAccount();
    assert.equal(h.api.scopedKey('refresh_token'), first);
    h.context.GM_xmlhttpRequest = options => options.onload({ status: 200, responseText: 'var dashboard = {"userProfile":{"puid":"OTHER"}}; var next = 1;' });
    await assert.rejects(h.api.assertAccount());
});

test('dashboard parsing supports script end, nested JSON, braces and escaped quotes', () => {
    const h = harness();
    const profile = { puid: 'ABC', name: 'brace } and quote "', nested: { x: 1 } };
    for (const prefix of ['var dashboard', 'let dashboard', 'const dashboard', 'window.__INITIAL_STATE__']) {
        const html = `<script>${prefix} = ${JSON.stringify({ userProfile: profile })};</script>`;
        assert.equal(h.api.dashboardIdentity(html), 'puid:abc');
        assert.equal(h.api.parseDashboard(html).userProfile.name, profile.name);
    }
    assert.equal(h.api.parseDashboard('var dashboard = {broken};'), null);
});

test('Cookie API receives a normalized URL matching metadata paths', async () => {
    const urls = [];
    const cookieContext = vm.createContext({ URL, console, GM_cookie: (action, options, callback) => {
        assert.equal(action, 'list');
        urls.push(options.url);
        callback([{ name: '_U', value: 'test-only' }]);
    } });
    const start = source.indexOf('    function cookieUrl(url)');
    const end = source.indexOf('    function deleteCookie', start);
    vm.runInContext(source.slice(start, end), cookieContext);
    for (const host of ['rewards.bing.com', 'login.live.com', 'www.bing.com', 'cn.bing.com']) {
        assert.equal(await cookieContext.getCookies(`https://${host}`), '_U=test-only');
        assert.equal(urls.at(-1), `https://${host}/`);
        assert.ok(source.includes(`// @match        https://${host}/*`));
    }
    assert.ok(source.includes("GM_cookie('list', { url }, callback)"));
});

test('OAuth pending state rejects mismatch, expiration and malformed callbacks', () => {
    const context = vm.createContext({ Date });
    const start = source.indexOf('    const AUTH_PENDING_KEY');
    const end = source.indexOf('    // 回调页必须', start);
    vm.runInContext(source.slice(start, end), context);
    const now = Date.now();
    const pending = { state: 'random-state', scope: 'account-A', createdAt: now };
    assert.equal(context.validAuthPending(pending, 'random-state', now), true);
    assert.equal(context.validAuthPending(pending, 'wrong', now), false);
    assert.equal(context.validAuthPending(pending, null, now), false);
    assert.equal(context.validAuthPending(null, 'random-state', now), false);
    assert.equal(context.validAuthPending(pending, 'random-state', now + 600000), false);
    assert.equal(context.validAuthPending(pending, 'random-state', now - 1), false);
});

test('OAuth callback relays only bound results and skips task initialization', () => {
    const start = source.indexOf('    const AUTH_PENDING_KEY');
    const end = source.indexOf('    // 回调先在 document-start', start);
    for (const state of ['expected', 'wrong']) {
        const pending = { state: 'expected', scope: 'account-A', createdAt: Date.now() };
        const writes = new Map();
        const context = vm.createContext({ Date, URL,
            location: { hostname: 'login.live.com', pathname: '/oauth20_desktop.srf', href: `https://login.live.com/oauth20_desktop.srf?code=test-code&state=${state}` },
            GM_getValue: () => pending, GM_setValue: (k, v) => writes.set(k, v),
            history: { replaceState() {} }, document: { createElement: () => ({}), body: { appendChild() {} } }
        });
        vm.runInContext(`(function () { ${source.slice(start, end)} throw new Error('should return first'); })()`, context);
        assert.equal(writes.has('mr_oauth_result_v1'), state === 'expected');
        if (state === 'expected') assert.equal(writes.get('mr_oauth_result_v1').scope, 'account-A');
    }
});

test('OAuth callback captures immediately before DOM readiness', () => {
    const start = source.indexOf('    const AUTH_PENDING_KEY');
    const end = source.indexOf('    // 回调先在 document-start', start);
    const writes = new Map();
    let listenerAdded = false;
    const context = vm.createContext({ Date, URL,
        location: { hostname: 'login.live.com', pathname: '/oauth20_desktop.srf', href: 'https://login.live.com/oauth20_desktop.srf?code=short-lived&state=expected' },
        GM_getValue: () => ({ state: 'expected', scope: 'A', createdAt: Date.now() }),
        GM_setValue: (k, v) => writes.set(k, v), history: { replaceState() {} },
        document: { readyState: 'loading', body: null, documentElement: null,
            addEventListener: () => { listenerAdded = true; }, createElement: () => { throw new Error('DOM not ready'); } }
    });
    vm.runInContext(`(function () { ${source.slice(start, end)} })()`, context);
    assert.equal(writes.get('mr_oauth_result_v1').code, 'short-lived');
    assert.equal(listenerAdded, true);
    assert.ok(source.includes('// @run-at       document-start'));
});

test('cache reset removes credentials and progress but not unrelated storage', () => {
    const h = harness();
    h.storage.set('mr_account_v2:A:refresh_token', 'old');
    h.storage.set('mr_oauth_pending_v1', {});
    h.storage.set('unrelated', 'keep');
    h.context.AUTH_PENDING_KEY = 'mr_oauth_pending_v1';
    h.context.AUTH_RESULT_KEY = 'mr_oauth_result_v1';
    h.context.window = { confirm: () => true };
    h.context.GM_listValues = () => [...h.storage.keys()];
    h.context.GM_deleteValue = key => h.storage.delete(key);
    let reloaded = false;
    h.context.location = { reload: () => { reloaded = true; } };
    const session = { 'mr_account_v2:A:auto_run_today': '1', other: 'keep' };
    Object.defineProperties(session, {
        setItem: { value: (k, v) => { session[k] = v; } },
        removeItem: { value: k => { delete session[k]; } }
    });
    h.context.sessionStorage = session;
    h.context.clearAccountCache();
    assert.deepEqual([...h.storage.keys()], ['unrelated']);
    assert.equal(session.other, 'keep');
    assert.equal(session.mr_require_manual_start, '1');
    assert.equal(reloaded, true);
    assert.equal(h.context.state.running, false);
});

test('empty token initialization clears single-flight promise before later authorization', async () => {
    const store = new Map();
    const state = {};
    const context = vm.createContext({ state, Date, Promise, console,
        assertAccount: async () => {}, identitySource: 'cookie',
        accountGet: (k, d) => store.has(k) ? store.get(k) : d,
        accountSet: (k, v) => store.set(k, v), log: () => {}, nodes: { boxAuth: { style: {} } },
        gmRequest: async () => JSON.stringify({ access_token: 'test-token', expires_in: 3600 }),
        tokenFailureSummary: () => 'failure'
    });
    const start = source.indexOf('    async function getAccessToken(opts');
    const end = source.indexOf('    //签到', start);
    vm.runInContext(source.slice(start, end), context);
    assert.equal(await context.getAccessToken(), null);
    assert.equal(state.tokenPromise, null);
    store.set('auth_code', 'test-code');
    assert.equal(await context.getAccessToken({ forceRefresh: true }), 'test-token');
    assert.equal(state.tokenPromise, null);
    assert.equal(store.get('auth_code'), '');
});

test('token errors do not echo sensitive response fields', () => {
    const context = vm.createContext({ Set, JSON, Number });
    const start = source.indexOf('    function tokenFailureSummary');
    const end = source.indexOf('    // Token 获取', start);
    vm.runInContext(source.slice(start, end), context);
    const text = context.tokenFailureSummary({ status: 400, responseText: JSON.stringify({ error: 'invalid_grant', error_description: 'secret-code-and-email' }) });
    assert.ok(text.includes('invalid_grant'));
    assert.ok(!text.includes('secret-code-and-email'));
});

test('display names are not treated as identity', () => {
    const h = harness();
    assert.equal(h.api.dashboardIdentity('var dashboard = {"userProfile":{"name":"Alice","points":100}}; var next = 1;'), null);
});

test('Bing login is never used as Rewards identity', async () => {
    const h = harness();
    const visited = [];
    h.context.getCookies = async url => {
        visited.push(url);
        return url === 'https://www.bing.com/' ? '_U=old-bing-account' : 'MUID=device';
    };
    await assert.rejects(h.api.assertAccount());
    assert.deepEqual(visited, ['https://rewards.bing.com/']);
});

test('Rewards cookie disappearance does not switch to Bing identity', async () => {
    const h = harness();
    h.context.getCookies = async url => url === 'https://rewards.bing.com/' ? '_U=A' : '';
    await h.api.assertAccount();
    h.context.getCookies = async url => url === 'https://cn.bing.com/' ? '_U=B' : '';
    await assert.rejects(h.api.assertAccount());
});

test('unrelated cookie changes do not change account scope', async () => {
    const h = harness();
    await h.api.assertAccount();
    const before = h.api.scopedKey('refresh_token');
    h.cookie('other=456; _U=account-A');
    await h.api.assertAccount();
    assert.equal(h.api.scopedKey('refresh_token'), before);
});
