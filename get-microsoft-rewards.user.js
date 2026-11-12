// ==UserScript==
// @name         Get Microsoft Rewards (修复/增强版)
// @namespace    https://github.com/Muverix/Get-Microsoft-Rewards
// @version      1.0.21
// @description  微软 Rewards 自动助手：集成本地自动搜索、每日活动与自动签到。基于原脚本二次开发，在 Gemini AI 辅助下优化多区域兼容与卡片过滤逻辑。
// @author       Muverix
// @license      MIT
// @icon         https://rewards.bing.com/rewardscdn/images/rewards.png
// @homepage     https://scriptcat.org/zh-CN/script-show-page/7354
// @supportURL   https://github.com/Muverix/Get-Microsoft-Rewards/issues
// @match        https://www.bing.com/*
// @match        https://cn.bing.com/*
// @match        https://rewards.bing.com/*
// @match        https://login.live.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_notification
// @grant        GM_cookie
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_log
// @connect      bing.com
// @connect      rewards.bing.com
// @connect      www.bing.com
// @connect      cn.bing.com
// @connect      login.live.com
// @connect      prod.rewardsplatform.microsoft.com
// @connect      hot.baiwumm.com
// @connect      hotapi.nntool.cc
// @connect      cnxiaobai.com
// @run-at       document-start
// ==/UserScript==

/* =========================================================================
 * 📜 版权声明与免责条款 (License & Disclaimer)
 * -------------------------------------------------------------------------
 * 1. 本脚本基于 QingJ 的开源项目《Get Microsoft Rewards》二次开发。
 * 2. 借助 Gemini AI，参考并融合了 liyan20001124-byte 的《微软积分商城签到（全能智能重构版）》的核心逻辑与优化思路。
 * 3. 本脚本遵循 MIT 开源许可协议，仅供个人学习研究与自动化测试使用。
 * 4. 作者不对使用本脚本可能产生的任何风险（如账号积分变动或风控等）承担任何法律责任，请合理使用。
 * ========================================================================= */

(async function () {
    'use strict';

    const AUTH_PENDING_KEY = 'mr_oauth_pending_v1';
    const AUTH_RESULT_KEY = 'mr_oauth_result_v1';
    const AUTH_TTL = 10 * 60 * 1000;

    function validAuthPending(pending, stateValue, now = Date.now()) {
        return !!pending && typeof stateValue === 'string' && stateValue.length > 0
            && pending.state === stateValue && typeof pending.scope === 'string'
            && typeof pending.createdAt === 'number' && now >= pending.createdAt
            && now - pending.createdAt < AUTH_TTL;
    }

    // 回调页必须在 UI、Cookie 身份检查和定时器之前处理。
    // 不在微软登录页面运行任务，也不输出含 code 的 URL。
    if (location.hostname === 'login.live.com') {
        if (location.pathname === '/oauth20_desktop.srf') {
            const callback = new URL(location.href);
            const pending = GM_getValue(AUTH_PENDING_KEY, null);
            const stateValue = callback.searchParams.get('state');
            if (validAuthPending(pending, stateValue)) {
                const code = callback.searchParams.get('code');
                const error = callback.searchParams.get('error');
                if (code || error) {
                    GM_setValue(AUTH_RESULT_KEY, { state: stateValue, scope: pending.scope,
                        code: code || '', failed: !!error, receivedAt: Date.now() });
                    try { history.replaceState(null, '', location.pathname); } catch { }
                    const showNotice = () => {
                        const notice = document.createElement('div');
                        notice.textContent = error ? '授权未完成，请返回 Rewards 页面重试。' : '授权结果已传回，请返回 Rewards 页面完成确认。此页面可以关闭。';
                        (document.body || document.documentElement)?.appendChild(notice);
                    };
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', showNotice, { once: true });
                    } else showNotice();
                }
            }
        }
        return;
    }

    // 回调先在 document-start 接收；普通页面等 DOM 就绪后再创建面板。
    if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }

    // ========== 配置 ==========
    const CONFIG = {
        pc: { minDelay: 15000, maxDelay: 30000 },
        mobile: { minDelay: 20000, maxDelay: 35000 },
        ua: {
            pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0',
            mobile: 'Mozilla/5.0 (Linux; Android 16; MEIZU 20 Build/BQ2A.251110.001-BP2A.250605.031.A3; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 BingSapphire/33.8.440724006'
        },
        mobileApi: {appId: 'SAAndroid/34.0.440821006'},
        read: { minDelay: 8000, maxDelay: 15000 },
        // 多个热搜API备用源
        hotApis: [
            { url: 'https://hot.baiwumm.com/api/', sources: ['weibo', 'douyin', 'baidu', 'zhihu', 'toutiao'] },
            { url: 'https://hotapi.nntool.cc/', sources: ['weibo', 'douyin', 'baidu', 'toutiao', 'zhihu'] },
            { url: 'https://cnxiaobai.com/DailyHotApi/', sources: ['weibo', 'douyin', 'baidu', 'toutiao'] }
        ],
        keywords: ["天气预报", "今日新闻", "体育赛事", "股票行情", "电影推荐", "科技资讯", "美食食谱", "旅游攻略"],
        // 暂停机制配置
        pause: {
            enabled: true,           // 是否启用暂停机制
            interval: 10,            // 每执行多少次搜索后暂停
            duration: 15 * 60 * 1000 // 暂停时长（毫秒），15分钟
        },
        // 自动执行配置：仅在 Rewards dashboard 页面首次加载时触发
        autoRun: {
            enabled: true,
            delay: 5000              // 等待页面数据和登录状态稳定后再启动
        }
    };

    // ========== 状态 ==========
    let state = {
        level: 1, points: 0,
        readRunning: false,
        pcCur: 0, pcMax: 0,
        mobileCur: 0, mobileMax: 0,
        promosTotal: 0, promosDone: 0,
        signDone: false, signPoints: -1,
        readCur: 0, readMax: 0,
        running: false,
        busyCount: 0, // 👈 补上此初始化
        accessToken: null,
        accessTokenExpiresAt: 0,
        updating: false,
        updatingPromise: null,
        // 新增：搜索进度和暂停状态
        searchCount: 0,           // 当前搜索计数（用于暂停判断）
        isPaused: false,          // 是否处于暂停状态
        pauseEndTime: 0,          // 暂停结束时间戳
        countdownStartTime: 0,    // 倒计时开始时间（精确计时）
        countdownDuration: 0,     // 倒计时总时长
        manualPaused: false,      // 手动暂停
        pausePromise: null,
        pauseResolver: null
    };
    let dashboard = null;
    let loginCookie = '';

    // 以 Rewards 登录 Cookie 的摘要隔离登录会话。不保存原始 Cookie；
    // 同一账号重新登录也可能得到新空间，宁可重新授权，不继承未知归属的缓存。
    let accountScope = null;
    let accountBlocked = false;
    let identityCheck = null;
    let identitySource = null;
    let cookieIdentityUrl = null;
    const identityCookieUrls = ['https://rewards.bing.com/'];
    const pendingRequests = new Set();

    // 不依赖 dashboard JSON 后面必须跟着 “; var”，并且不使用 eval。
    function parseDashboard(html) {
        const marker = /(?:\b(?:var|let|const)\s+dashboard|window\.__INITIAL_STATE__)\s*=\s*/g;
        let match;
        while ((match = marker.exec(html))) {
            const start = marker.lastIndex;
            if (html[start] !== '{') continue;
            let depth = 0, quoted = false, escaped = false;
            for (let i = start; i < html.length; i++) {
                const c = html[i];
                if (quoted) {
                    if (escaped) escaped = false;
                    else if (c === '\\') escaped = true;
                    else if (c === '"') quoted = false;
                } else if (c === '"') quoted = true;
                else if (c === '{') depth++;
                else if (c === '}' && --depth === 0) {
                    try { return JSON.parse(html.slice(start, i + 1)); } catch { break; }
                }
            }
        }
        return null;
    }

    let flightSnapshot = null;

    // Flight 数据只做 JSON 解析，身份只接受服务端头像属性中的微软用户路径。
    function parseFlightSnapshot(html) {
        if (typeof html !== 'string' || html.length > 5000000) return null;
        let stream = '';
        let found = false;
        const scripts = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
        let match;
        while ((match = scripts.exec(html))) {
            const push = match[1].trim().match(/^self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?$/);
            if (!push) continue;
            try {
                const chunk = JSON.parse(push[1]);
                if (chunk[0] === 1 && typeof chunk[1] === 'string') {
                    found = true;
                    stream += chunk[1];
                }
            } catch { /* 不执行脚本；未知编码留待后续适配。 */ }
        }
        if (!found) return null;
        const balances = new Set(), levels = new Set(), photoIds = new Set();
        let invalidPhoto = false;
        let dailyItems = null;
        let budget = 100000;
        function visit(value, depth = 0) {
            if (!value || typeof value !== 'object' || depth > 40 || --budget < 0) return;
            if (!Array.isArray(value)) {
                if (Object.hasOwn(value, 'profilePictureUrl')) {
                    try {
                        const url = new URL(value.profilePictureUrl);
                        const id = url.pathname.match(/^\/users\/0x([0-9a-f]{32})\/myprofile\/expressionprofile\/profilephoto:/i);
                        if (url.origin !== 'https://storage.live.com' || !id || /^0+$/.test(id[1])) invalidPhoto = true;
                        else photoIds.add(id[1].toLowerCase());
                    } catch { invalidPhoto = true; }
                }
                if (Number.isSafeInteger(value.balance) && value.balance >= 0
                    && Number.isSafeInteger(value.level) && value.level > 0) {
                    balances.add(value.balance);
                    levels.add(value.level);
                }
                if (Array.isArray(value.dailySetItems)) dailyItems = value.dailySetItems;
            }
            for (const child of Object.values(value)) visit(child, depth + 1);
        }
        for (const line of stream.split('\n')) {
            // 只读取独立 JSON 记录；不解引用、不执行模块或 Server Action。
            const record = line.match(/^[0-9a-f]+:([\[{][\s\S]*)$/i);
            if (record) {
                try { visit(JSON.parse(record[1])); } catch { }
            }
        }
        return {
            identity: budget >= 0 && !invalidPhoto && photoIds.size === 1 ? `flight-photo:${[...photoIds][0]}` : null,
            balance: balances.size === 1 ? [...balances][0] : null,
            level: levels.size === 1 ? [...levels][0] : null,
            dailyCount: dailyItems ? dailyItems.length : null
        };
    }

    // 优先使用服务端仪表板的稳定身份；兼容不能使用 GM_cookie 的环境。
    function dashboardIdentity(html) {
        const data = parseDashboard(html);
        if (!data) return null;
        const profile = data.userProfile || {};
        // 只接受明确的账号字段，不使用昵称、积分、活动 ID 等可能重复的数据。
        for (const key of ['puid', 'PUID', 'cid', 'CID', 'userId']) {
            const value = profile[key];
            if (typeof value === 'string' && value.trim()) return `${key.toLowerCase()}:${value.trim().toLowerCase()}`;
        }
        return null;
    }

    async function fetchIdentityHtml() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://rewards.bing.com/dashboard?mr_identity=${Date.now()}`,
                timeout: 15000,
                onload: r => r.status === 200 ? resolve(r.responseText) : reject(new Error(`身份检查 HTTP ${r.status}`)),
                onerror: () => reject(new Error('无法连接 Rewards 身份检查页面')),
                ontimeout: () => reject(new Error('Rewards 身份检查超时'))
            });
        });
    }

    async function readAccountScope() {
        let identity = null;
        // 首次选定来源后不切换来源，避免短暂接口异常造成错误账号空间。
        if (!identitySource || identitySource === 'dashboard' || identitySource === 'flight') {
            try {
                const html = await fetchIdentityHtml();
                identity = dashboardIdentity(html);
                flightSnapshot = parseFlightSnapshot(html);
                if (flightSnapshot) {
                    if (identitySource === 'dashboard') throw new Error('Rewards 页面身份来源已变化，请刷新后重新授权');
                    if (!flightSnapshot.identity) throw new Error('新版 Rewards 未返回唯一的微软用户头像身份；为避免串号，任务保持禁用');
                    identity = flightSnapshot.identity;
                    identitySource = 'flight';
                } else if (identitySource === 'flight') {
                    throw new Error('新版 Rewards 身份数据已消失，请刷新并检查登录');
                } else if (identity) identitySource = 'dashboard';
            } catch (e) {
                if (flightSnapshot || identitySource === 'dashboard' || identitySource === 'flight') throw e;
            }
            if (identitySource === 'dashboard' && !identity) throw new Error('仪表板未返回账号身份，请确认 Rewards 已登录');
        }
        if (!identity) {
            const urls = cookieIdentityUrl ? [cookieIdentityUrl] : identityCookieUrls;
            for (const url of urls) {
                const cookies = await getCookies(url);
                const values = [...new Set(cookies.split(';').map(s => s.trim())
                    .filter(s => s.startsWith('_U=')).map(s => s.slice(3)).filter(Boolean))];
                if (values.length > 1) throw new Error('同一站点存在多个不同的登录 Cookie，请退出多余会话后重新登录');
                if (values.length === 1) {
                    cookieIdentityUrl = url;
                    identity = `cookie:${url}:${values[0]}`;
                    identitySource = 'cookie';
                    break;
                }
            }
            if (!identity) {
                throw new Error('无法确认 Rewards 当前账号：页面身份字段无法解析，且 Rewards 下没有唯一登录凭证。已禁止回退使用 Bing 账号；不需要去 cn.bing.com 登录，请使用身份诊断继续排查 Rewards 页面');
            }
        }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }

    // 仅报告已知结构的存在性，不输出正文、脚本地址或属性值。
    function identityPageStructure(html) {
        const text = typeof html === 'string' ? html : '';
        return {
            htmlLength: text.length,
            scriptCount: (text.match(/<script\b/gi) || []).length,
            markers: {
                dashboardDeclaration: /\b(?:var|let|const)\s+dashboard\s*=/.test(text),
                dashboardProperty: /(?:window\.)?dashboard\s*=/.test(text),
                initialState: /__INITIAL_STATE__/.test(text),
                nextData: /__NEXT_DATA__/.test(text),
                nextFlight: /__next_f/.test(text),
                userProfile: /\buserProfile\b/.test(text),
                userStatus: /\buserStatus\b/.test(text),
                jsonParse: /JSON\.parse\s*\(/.test(text)
            },
            dashboardParsed: !!parseDashboard(text),
            flightParsed: !!parseFlightSnapshot(text),
            recognizedIdentity: !!dashboardIdentity(text) || !!parseFlightSnapshot(text)?.identity
        };
    }

    async function showIdentityDiagnostics() {
        const report = { version: '1.0.21', cookieApi: typeof GM_cookie };
        report.currentPage = {
            host: location.hostname,
            isDashboardPath: location.pathname === '/dashboard',
            structure: identityPageStructure(document.documentElement?.outerHTML || '')
        };
        nodes.panel.classList.remove('collapsed');
        nodes.diagnose.disabled = true;
        try {
            // 只输出结构和状态，不输出身份字段值、Cookie 值、Token 或页面正文。
            report.cookiesBySite = {};
            for (const url of identityCookieUrls) {
                report.cookiesBySite[url] = await new Promise(resolve => {
                const timer = setTimeout(() => resolve({ status: 'timeout' }), 5000);
                const done = value => { clearTimeout(timer); resolve(value); };
                try {
                    const callback = (cookies, error) => done({
                        status: error ? 'api-error' : 'ok',
                        names: [...new Set((cookies || []).map(c => c.name))],
                        loginCookieCount: (cookies || []).filter(c => c.name === '_U').length
                    });
                    if (typeof GM_cookie === 'function') GM_cookie('list', { url }, callback);
                    else if (typeof GM_cookie !== 'undefined' && typeof GM_cookie.list === 'function') GM_cookie.list({ url }, callback);
                    else done({ status: 'unsupported' });
                } catch { done({ status: 'api-exception' }); }
                });
            }
            report.identitySource = identitySource;
            report.cookieIdentitySite = cookieIdentityUrl;
            report.page = await new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: 'GET', url: 'https://rewards.bing.com/dashboard', timeout: 15000,
                    onload: r => {
                        const data = parseDashboard(r.responseText || '');
                        const keys = obj => obj && typeof obj === 'object' ? Object.keys(obj).slice(0, 60) : [];
                        let host = '';
                        try { host = new URL(r.finalUrl).hostname; } catch { }
                        resolve({ status: r.status, finalHost: host, structure: identityPageStructure(r.responseText), dashboardParsed: !!data,
                            recognizedIdentity: !!dashboardIdentity(r.responseText || '') || !!parseFlightSnapshot(r.responseText)?.identity,
                            rootFields: keys(data), profileFields: keys(data?.userProfile),
                            statusFields: keys(data?.userStatus), profileAttributeFields: keys(data?.userProfile?.attributes) });
                    },
                    onerror: () => resolve({ status: 'network-error' }),
                    ontimeout: () => resolve({ status: 'timeout' })
                });
            });
            const box = document.createElement('textarea');
            box.readOnly = true;
            box.style.cssText = 'width:100%;height:180px;box-sizing:border-box;font-size:11px';
            box.value = JSON.stringify(report, null, 2);
            nodes.diagnosticOutput.replaceChildren(box);
        } finally { nodes.diagnose.disabled = false; }
    }

    function blockAccount(reason) {
        if (accountBlocked) return;
        accountBlocked = true;
        state.running = false;
        state.accessToken = null;
        state.accessTokenExpiresAt = 0;
        if (state.pauseResolver) {
            state.pauseResolver();
            state.pauseResolver = null;
            state.pausePromise = null;
        }
        dashboard = null;
        for (const request of pendingRequests) request.abort();
        pendingRequests.clear();
        nodes.logBox.replaceChildren();
        nodes.panel.classList.remove('collapsed');
        nodes.account.textContent = '身份检查未通过';
        nodes.points.textContent = '-';
        nodes.pc.textContent = '-';
        nodes.read.textContent = '-';
        nodes.signStatus.textContent = '账号已变化';
        nodes.level.textContent = '-';
        nodes.pcBar.style.width = '0%';
        nodes.readBar.style.width = '0%';
        nodes.valPromo.textContent = '-';
        for (const button of [nodes.btnAll, nodes.btnSearch, nodes.btnSign, nodes.btnRead, nodes.btnPromo, nodes.btnAuthSave]) button.disabled = true;
        const notice = document.createElement('div');
        notice.textContent = flightSnapshot
            ? `ℹ️ ${reason}。任务不会提交。`
            : `⛔ 已停止任务：${reason || '登录身份无法确认'}。任务不会继续提交。`;
        nodes.logBox.appendChild(notice);
        if (flightSnapshot) {
            nodes.account.textContent = '新版 Rewards · 只读（身份未验证）';
            nodes.points.textContent = flightSnapshot.balance === null ? '-' : String(flightSnapshot.balance);
            nodes.level.textContent = flightSnapshot.level === null ? '-' : String(flightSnapshot.level);
            nodes.signStatus.textContent = '未适配';
            nodes.valPromo.textContent = '-';
            const detail = document.createElement('div');
            detail.textContent = '新版网页数据已读取；搜索、签到、阅读、活动及授权均保持禁用。此显示不表示账号身份已验证。';
            nodes.logBox.appendChild(detail);
        }
    }

    async function assertAccount() {
        if (accountBlocked) throw new Error('登录会话已失效，请刷新页面');
        if (!identityCheck) {
            identityCheck = (async () => {
                try {
                    const current = await readAccountScope();
                    if (accountScope && current !== accountScope) {
                        flightSnapshot = null;
                        throw new Error('微软登录身份已变化');
                    }
                    accountScope = current;
                } catch (e) {
                    blockAccount(e.message);
                    throw e;
                }
            })().finally(() => { identityCheck = null; });
        }
        await identityCheck;
    }

    function scopedKey(key) {
        if (!accountScope || accountBlocked) throw new Error('当前账号尚未确认，请刷新页面');
        return `mr_account_v3:${accountScope}:${key}`;
    }
    const accountGet = (key, fallback) => GM_getValue(scopedKey(key), fallback);
    const accountSet = (key, value) => GM_setValue(scopedKey(key), value);

    function clearAccountCache() {
        if (!window.confirm('将停止本页任务，并清除此脚本所有账号的本地授权、签到、搜索记录及待处理授权。不会删除微软账号、浏览器 Cookie 或服务端积分。请先关闭其他运行本脚本的标签页。继续？')) return;
        if (typeof GM_listValues !== 'function' || typeof GM_deleteValue !== 'function') {
            window.alert('缺少存储管理权限，请完整重新安装此版脚本（包括顶部 @grant 声明）。');
            return;
        }
        // 先锁住本页，避免在清理过程中继续提交或回写旧响应。
        blockAccount('正在清除本地缓存');
        const legacy = new Set(['refresh_token', 'auth_code', 'Config.lastSignDate', 'mr_search_progress', AUTH_PENDING_KEY, AUTH_RESULT_KEY]);
        for (const key of GM_listValues()) {
            if (key.startsWith('mr_account_v2:') || key.startsWith('mr_account_v3:') || legacy.has(key)) GM_deleteValue(key);
        }
        for (const key of Object.keys(sessionStorage)) {
            if (key.startsWith('mr_account_v2:') || key.startsWith('mr_account_v3:') || key.startsWith('mr_auto_run_started_')) sessionStorage.removeItem(key);
        }
        sessionStorage.setItem('mr_require_manual_start', '1');
        location.reload();
    }

    GM_registerMenuCommand('清除所有本地授权与任务缓存（切号排查）', clearAccountCache);

    // ========== 进度保存/恢复 ==========
    const STORAGE_KEY = 'mr_search_progress';

    function saveProgress() {
        const today = getDateHyphen();
        const data = {
            date: today,
            searchCount: state.searchCount
        };
        accountSet(STORAGE_KEY, JSON.stringify(data));
    }

    function loadProgress() {
    try {
        const saved = accountGet(STORAGE_KEY);
        if (!saved) return null;
        const data = JSON.parse(saved);
        if (data.date === getDateHyphen()) {
            state.searchCount = data.searchCount || 0;
            return data;
        } else {
            resetProgress(); // 👈 跨天重置本地和内存中的计数
        }
    } catch (e) { }
    return null;
}

    async function withAccessTokenRequest(requestFn) {
        // 1. 获取 Token，若为空尝试强制刷新一次
        let token = await getAccessToken();
        if (!token) {
            console.warn('[Rewards] 初始 Token 为空，尝试强制刷新...');
            token = await getAccessToken({ forceRefresh: true });
        }

        if (!token) {
            log('⚠️ 未获取到活动Token，请确认登录状态或刷新页面重试');
            return null;
        }

        try {
            const res = await requestFn(token);

            // 2. 检查返回结果字符串（适配 gmRequest 正常返回 401 错误 JSON 的情况）
            if (typeof res === 'string' && (res.includes('invalid_token') || res.includes('Unauthorized') || res.includes('\"code\":401'))) {
                console.warn('[Rewards] 响应中检测到 Token 失效，重新获取 Token 中...');
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                token = await getAccessToken({ forceRefresh: true });
                if (token) {
                    return await requestFn(token);
                }
            }
            return res;
        } catch (e) {
            // 3. 捕获网络层抛出的 401 异常
            const is401 = (e && e.status === 401) || 
                          (e && e.responseStatus === 401) || 
                          (e && e.message && (e.message.includes('401') || e.message.includes('Unauthorized')));

            if (is401) {
                console.warn('[Rewards] 捕获到网络层 401 异常，重新获取 Token 中...');
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                token = await getAccessToken({ forceRefresh: true });
                if (token) {
                    return await requestFn(token);
                }
            }
            throw e;
        }
    }
    function resetProgress() {
        state.searchCount = 0;
        accountSet(STORAGE_KEY, '');
    }

    // ========== 工具函数 ==========
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const randomPick = arr => arr[Math.floor(Math.random() * arr.length)];
    const randomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const uuid = () => crypto.randomUUID();
    const getDateStr = () => {
        const d = new Date();
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    };
    const getDateHyphen = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const isJSON = s => { try { JSON.parse(s); return true; } catch { return false; } };
    const generateDapiId = () => {
    const raw1 = uuid().replace(/-/g, '');
    const raw2 = uuid().replace(/-/g, '');
    return (raw1 + raw2).slice(0, 56);
    };

    // GM_xmlhttpRequest 封装
    async function gmRequest(options) {
        await assertAccount();
        const retries = options.retries ?? 2;
        const retryDelay = options.retryDelay ?? 1000;
        let attempt = 0;

        const shouldRetry = (err) => {
            const status = err?.status || 0;
            return status === 0 || status === 429 || status >= 500 || err?.message === 'Timeout';
        };

        while (true) {
            await assertAccount();
            try {
                return await new Promise((resolve, reject) => {
                    const request = GM_xmlhttpRequest({
                        timeout: 20000,
                        ...options,
                        onload: async xhr => {
                            pendingRequests.delete(request);
                            try { await assertAccount(); } catch (e) { reject(e); return; }
                            if (accountBlocked) return reject(new Error('账号已切换，丢弃旧响应'));
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve(options.returnUrl ? xhr.finalUrl : xhr.responseText);
                            } else if (xhr.status >= 300 && xhr.status < 400) {
                                const loc = xhr.responseHeaders.match(/Location:\s*(.*?)\s*[\r\n]/i);
                                resolve(loc ? loc[1] : xhr.responseText);
                            } else {
                                const err = new Error(`HTTP ${xhr.status}`);
                                err.status = xhr.status;
                                err.responseText = xhr.responseText;
                                err.finalUrl = xhr.finalUrl;
                                reject(err);
                            }
                        },
                        onabort: () => {
                            pendingRequests.delete(request);
                            reject(new Error('账号变化，请求已取消'));
                        },
                        onerror: () => {
                            pendingRequests.delete(request);
                            const err = new Error('Network Error');
                            err.status = 0;
                            reject(err);
                        },
                        ontimeout: () => {
                            pendingRequests.delete(request);
                            const err = new Error('Timeout');
                            err.status = 0;
                            reject(err);
                        }
                    });
                    pendingRequests.add(request);
                });
            } catch (e) {
                if (accountBlocked) throw e;
                if (attempt >= retries || !shouldRetry(e)) throw e;
                const delay = retryDelay * Math.pow(2, attempt);
                attempt++;
                await sleep(delay + randomRange(0, 250));
            }
        }
    }

    // 获取热搜词（支持多源自动切换）
    async function getHotQuery() {
        // 打乱API顺序，随机选择
        const apis = [...CONFIG.hotApis].sort(() => Math.random() - 0.5);

        for (const api of apis) {
            try {
                const src = randomPick(api.sources);
                const res = await gmRequest({ method: 'GET', url: api.url + src, timeout: 8000 });
                const data = JSON.parse(res);
                if (data.code === 200 && data.data?.length) {
                    const title = randomPick(data.data).title || '';
                    // 随机截取长度，更自然
                    const len = randomRange(8, 25);
                    return title.substring(0, len);
                }
            } catch { /* 尝试下一个API */ }
        }
        // 所有API都失败，使用本地关键词
        return `${randomPick(CONFIG.keywords)} ${Math.random().toString(36).slice(2, 6)}`;
    }

    // Cookie API 对 @match 做 URL 匹配时也需要路径，不能传无尾斜杠的裸域名。
    function cookieUrl(url) {
        return new URL(url).href;
    }

    // Cookie 管理
    function getCookies(url) {
        url = cookieUrl(url);
    return new Promise(resolve => {
        try {
            if (typeof GM_cookie === 'undefined') {
                console.warn('[Rewards] GM_cookie不存在');
                return resolve('');
            }

            const list = typeof GM_cookie === 'function'
                ? callback => GM_cookie('list', { url }, callback)
                : callback => GM_cookie.list({ url }, callback);
            list((cookies, error) => {
                if (error) {
                    console.warn('[Rewards] Cookie API 不可用:', String(error));
                    return resolve('');
                }
                if (!cookies || !cookies.length) {
                    console.warn('[Rewards] Cookie为空:', url);
                    return resolve('');
                }

                const str = cookies
                    .map(c => `${c.name}=${c.value}`)
                    .join('; ');

                //console.log('[Rewards] Cookie长度:', str.length, url);
                resolve(str);
            });

        } catch (e) {
            console.error('[Rewards] Cookie获取失败', e);
            resolve('');
        }
    });
}

    function deleteCookie(name, host = 'bing.com') {
        return new Promise(resolve => {
            if (typeof GM_cookie !== 'undefined') {
                GM_cookie('delete', { url: `https://${host}/`, name }, resolve);
            } else resolve();
        });
    }

    // ========== 样式 (极简版) ==========
    GM_addStyle(`
        #mr-panel {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #fff;
            border: 1px solid #e0e0e0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border-radius: 8px;
        }

        /* 收起状态 */
        #mr-panel.collapsed {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #fff;
            color: #0078d4;
            box-shadow: 0 4px 16px rgba(0,120,212,0.3);
            border: 1px solid #e0e0e0;
            transition: all 0.2s;
        }
        #mr-panel.collapsed:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(0,120,212,0.4); }
        #mr-panel.collapsed svg { width: 24px; height: 24px; fill: currentColor; }
        #mr-panel.collapsed #mr-container { display: none; }

        /* 展开状态 */
        #mr-panel:not(.collapsed) { width: 300px; }
        #mr-panel:not(.collapsed) svg { display: none; }

        #mr-header {
            padding: 12px 16px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f8f9fa;
            border-radius: 8px 8px 0 0;
        }
        #mr-title { font-weight: 600; font-size: 14px; color: #333; }
        #mr-close { cursor: pointer; color: #999; font-size: 18px; line-height: 1; }
        #mr-close:hover { color: #333; }

        #mr-body { padding: 16px; }

        .mr-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #555; }
        .mr-val { font-weight: 600; color: #333; }

        .mr-progress-bg { height: 4px; background: #eee; border-radius: 2px; margin-bottom: 12px; overflow: hidden; }
        .mr-bar { height: 100%; background: #0078d4; }

        .mr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px; }
        .mr-btn {
            border: 1px solid #d0d0d0;
            background: #fff;
            color: #333;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        }
        .mr-btn:hover { background: #f0f0f0; border-color: #bbb; }
        .mr-btn:active { background: #e5e5e5; }
        .mr-full { grid-column: span 2; background: #0078d4; color: #fff; border: none; }
        .mr-full:hover { background: #006abc; }

        /* Auth */
        #mr-auth { margin-bottom: 12px; padding: 10px; background: #fff8e1; border: 1px solid #ffe0b2; border-radius: 4px; }
        .mr-input { width: 100%; padding: 4px; border: 1px solid #ccc; font-size: 11px; margin: 4px 0; }

        /* Log */
        #mr-log {
            margin-top: 12px;
            height: 80px;
            background: #fafafa;
            border: 1px solid #eee;
            padding: 8px;
            font-size: 10px;
            color: #666;
            overflow-y: auto;
            font-family: monospace;
        }
    `);

    // ========== UI 结构 ==========
    const panel = document.createElement('div');
    panel.id = 'mr-panel';
    panel.className = 'collapsed'; // 默认折叠
    // 礼盒 SVG
    const svgIcon = `<svg viewBox="0 0 24 24"><path d="M20 6h-3V4c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v3h2v9c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-9h2V8c0-1.1-.9-2-2-2zm-9-2h2v2h-2V4zm0 16H6v-9h5v9zm6 0h-5v-9h5v9zm1.5-11H16V7h2v2zm-4.5 0h-2V7h2v2zm-4.5 0H7V7h2v2zm-3.5 0H4V7h1.5v2z"/></svg>`;

    panel.innerHTML = `
        ${svgIcon}
        <div id="mr-container">
            <div id="mr-header">
                <div id="mr-title"><span>🎁</span> Microsoft Rewards</div>
                <div id="mr-close">×</div>
            </div>

            <div id="mr-body">
                <!-- 状态 -->
                <div class="mr-row"><span>网页会话标记（非账号）</span><span id="mr-account">待确认</span></div>
                <div class="mr-row">
                    <span>等级 <span id="mr-level" style="font-weight:600">-</span></span>
                    <span style="color:#d83b01"><span id="mr-points">0</span> pts</span>
                </div>

                <!-- 进度 -->
                <div class="mr-row"><span>🔍 搜索进度</span><span id="mr-pc">0/0</span></div>
                <div class="mr-progress-bg"><div class="mr-bar" id="mr-pc-bar"></div></div>

                <div class="mr-row"><span>📅 每日签到</span><span id="mr-sign-status" style="font-weight:600">未签到</span></div>

                <div class="mr-row"><span>📖 阅读任务</span><span id="mr-read">0/0</span></div>
                <div class="mr-progress-bg"><div class="mr-bar" id="mr-read-bar" style="background:#ff8c00"></div></div>

                <!-- 授权 -->
                <div id="mr-auth" style="display:none">
                    <div style="font-weight:bold;margin-bottom:5px">⚠️ 需授权</div>
                    <button class="mr-btn" id="mr-auth-link" style="width:100%">🔗 授权当前账号（自动接收）</button>
                    <input type="text" id="mr-auth-in" class="mr-input" placeholder="粘贴URL...">
                    <button class="mr-btn" id="mr-auth-save" style="width:100%">保存</button>
                </div>

                <!-- 按钮 -->
                <div class="mr-grid">
                    <button id="btn-search" class="mr-btn">🔍 搜索</button>
                    <button id="btn-promo" class="mr-btn">🎯 活动 <span id="val-promo">0/0</span></button>
                    <button id="btn-sign" class="mr-btn">✅ 签到</button>
                    <button id="btn-read" class="mr-btn">📖 阅读</button>
                    <button id="btn-all" class="mr-btn mr-full">🚀 一键全部执行</button>
                </div>

                <button id="mr-diagnose" class="mr-btn" style="width:100%;margin-top:8px">🔎 身份诊断（不含凭证）</button>
                <button id="mr-clear-cache" class="mr-btn" style="width:100%;margin-top:8px">🧹 清除授权与缓存</button>
                <div id="mr-diagnostic-output"></div>
                <!-- 日志 -->
                <div id="mr-log"></div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // 元素引用
    const $ = id => document.querySelector(id);
    const nodes = {
        panel: $('#mr-panel'),
        close: $('#mr-close'),
        level: $('#mr-level'),
        points: $('#mr-points'),
        account: $('#mr-account'),
        pc: $('#mr-pc'),
        pcBar: $('#mr-pc-bar'),
        signStatus: $('#mr-sign-status'),
        read: $('#mr-read'),
        readBar: $('#mr-read-bar'),
        btnSearch: $('#btn-search'),
        btnPromo: $('#btn-promo'),
        valPromo: $('#val-promo'),
        btnSign: $('#btn-sign'),
        btnRead: $('#btn-read'),
        btnAll: $('#btn-all'),
        boxAuth: $('#mr-auth'),
        btnAuthLink: $('#mr-auth-link'),
        inAuth: $('#mr-auth-in'),
        btnAuthSave: $('#mr-auth-save'),
        diagnose: $('#mr-diagnose'),
        diagnosticOutput: $('#mr-diagnostic-output'),
        logBox: $('#mr-log')
    };

    $('#mr-clear-cache').onclick = clearAccountCache;
    nodes.diagnose.onclick = () => showIdentityDiagnostics().catch(() => {
        nodes.diagnosticOutput.textContent = '诊断请求失败，请检查扩展的网站访问权限和网络。';
    });

    // ========== 交互逻辑 ==========

    // 展开/收起
    nodes.panel.onclick = (e) => {
        if (nodes.panel.classList.contains('collapsed')) {
            nodes.panel.classList.remove('collapsed');
        }
    };
    nodes.close.onclick = (e) => {
        e.stopPropagation();
        nodes.panel.classList.add('collapsed');
    };

    const LOG_MAX_LINES = 200;
    const log = (msg) => {
        if (accountBlocked) return;
        const div = document.createElement('div');
        div.textContent = `[${new Date().toLocaleTimeString().slice(0, 5)}] ${msg}`;
        nodes.logBox.appendChild(div);
        while (nodes.logBox.childNodes.length > LOG_MAX_LINES) {
            nodes.logBox.removeChild(nodes.logBox.firstChild);
        }
        nodes.logBox.scrollTop = nodes.logBox.scrollHeight;
    };

    const updateAllButton = () => {
        if (!nodes.btnAll) return;
        if (accountBlocked) {
            nodes.btnAll.disabled = true;
            nodes.btnAll.textContent = '⛔ 请刷新页面';
            return;
        }
        if (state.manualPaused) {
            nodes.btnAll.textContent = '▶️ 继续执行';
        } else if (state.running || state.allRunning || state.busyCount > 0) {
            nodes.btnAll.textContent = '⏸️ 暂停执行';
        } else {
            nodes.btnAll.textContent = '🚀 一键全部执行';
        }
    };

    const setManualPause = (paused, opts = {}) => {
        if (paused === state.manualPaused) return;
        const silent = !!opts.silent;
        state.manualPaused = paused;
        if (paused) {
            if (!state.pausePromise) {
                state.pausePromise = new Promise(resolve => { state.pauseResolver = resolve; });
            }
        } else if (state.pauseResolver) {
            const resolve = state.pauseResolver;
            state.pauseResolver = null;
            state.pausePromise = null;
            resolve();
        }
        updateAllButton();
        if (!silent) {
            log(paused ? '⏸️ 已手动暂停' : '▶️ 已继续执行');
        }
    };

    const markBusy = (delta) => {
        state.busyCount = Math.max(0, state.busyCount + delta);
        updateAllButton();
    };

    const waitWhilePaused = async () => {
        await assertAccount();
        if (!state.manualPaused) return 0;
        if (!state.pausePromise) {
            state.pausePromise = new Promise(resolve => { state.pauseResolver = resolve; });
        }
        const start = Date.now();
        await state.pausePromise;
        await assertAccount();
        return Date.now() - start;
    };

    // 授权相关
    const AUTH_URL = 'https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&response_type=code&redirect_uri=https://login.live.com/oauth20_desktop.srf&prompt=select_account';

    let authPoll = null;
    let authReceiving = false;

    function confirmAuthorizationAccount() {
        nodes.panel.classList.remove('collapsed');
        const container = document.createElement('div');
        container.style.cssText = 'padding:10px;background:#fff8e1;margin-top:8px';
        const message = document.createElement('div');
        message.textContent = '已收到一次性授权码，但它不包含可直接显示的账号信息，当前脚本无法展示或自动核对授权账号。请根据刚才微软账号选择页的选择自行确认；不确定时取消并重新选择，勿依据本面板旧积分判断。';
        const yes = document.createElement('button');
        yes.className = 'mr-btn';
        yes.textContent = '我已在微软页面选择当前 Rewards 账号，继续';
        const no = document.createElement('button');
        no.className = 'mr-btn';
        no.textContent = '取消此次授权';
        container.append(message, yes, no);
        nodes.boxAuth.style.display = 'block';
        nodes.boxAuth.appendChild(container);
        log('📥 已收到授权结果，请在面板中确认账号一致后完成授权');
        return new Promise(resolve => {
            let timer;
            const finish = accepted => {
                clearInterval(timer);
                container.remove();
                resolve(accepted);
            };
            yes.onclick = () => finish(!accountBlocked);
            no.onclick = () => finish(false);
            const expiresAt = Date.now() + 5 * 60 * 1000;
            timer = setInterval(() => {
                if (accountBlocked || Date.now() >= expiresAt) finish(false);
            }, 1000);
        });
    }

    async function acceptAuthorization(code) {
        await assertAccount();
        accountSet('auth_code', code);
        accountSet('refresh_token', '');
        state.accessToken = null;
        state.accessTokenExpiresAt = 0;
        nodes.inAuth.value = '';
        log('🔑 正在兑换当前会话的授权...');
        // 等待可能仍在运行的初始化 Token 请求完成，避免吞掉刚接收的授权码。
        if (state.tokenPromise) await state.tokenPromise;
        await assertAccount();
        const token = await getAccessToken({ forceRefresh: true });
        if (token) {
            nodes.boxAuth.style.display = 'none';
            log('🎉 授权成功！可以点击一键全部执行。');
            await updateData();
        } else {
            nodes.boxAuth.style.display = 'block';
            log('❌ 授权兑换失败，请重新授权');
        }
    }

    nodes.btnAuthLink.onclick = async () => {
        // 同步打开空白页，避免 await 后被浏览器当成弹窗拦截。
        const popup = window.open('about:blank', '_blank');
        if (!popup) { log('⚠️ 请允许此页面打开授权弹窗'); return; }
        try {
            await assertAccount();
            const existing = GM_getValue(AUTH_PENDING_KEY, null);
            if (existing && validAuthPending(existing, existing.state)) {
                popup.close();
                log('⚠️ 已有授权流程，请完成它或等待 10 分钟后重试');
                return;
            }
            const pending = { state: crypto.randomUUID() + crypto.randomUUID(), scope: accountScope, createdAt: Date.now() };
            GM_setValue(AUTH_RESULT_KEY, null);
            GM_setValue(AUTH_PENDING_KEY, pending);
            const target = new URL(AUTH_URL);
            target.searchParams.set('state', pending.state);
            popup.location.href = target.href;
            log('🔗 请在新页面选择与 Rewards 一致的账号，授权结果将自动接收');
            clearInterval(authPoll);
            const finish = () => {
                clearInterval(authPoll);
                if (GM_getValue(AUTH_PENDING_KEY, null)?.state === pending.state) {
                    GM_setValue(AUTH_PENDING_KEY, null);
                    GM_setValue(AUTH_RESULT_KEY, null);
                }
            };
            authPoll = setInterval(async () => {
                if (authReceiving) return;
                if (accountBlocked || Date.now() - pending.createdAt >= AUTH_TTL) {
                    finish();
                    if (!accountBlocked) log('⚠️ 授权已超时，请重新点击授权按钮');
                    return;
                }
                const result = GM_getValue(AUTH_RESULT_KEY, null);
                if (!result || result.state !== pending.state || result.scope !== pending.scope) return;
                if (typeof result.receivedAt !== 'number' || result.receivedAt < pending.createdAt || result.receivedAt > Date.now()) return;
                authReceiving = true;
                try {
                    await assertAccount();
                    if (accountScope !== pending.scope) throw new Error('授权期间登录身份变化，结果已丢弃');
                    finish();
                    if (result.failed || !result.code) throw new Error('微软授权未完成，请重试');
                    if (!await confirmAuthorizationAccount()) {
                        log('ℹ️ 授权确认已取消或超时；尚未兑换 Token，请重新授权');
                        return;
                    }
                    await acceptAuthorization(result.code);
                } catch (e) {
                    finish();
                    log(`❌ 授权失败: ${e.message}`);
                } finally { authReceiving = false; }
            }, 1000);
        } catch (e) {
            popup.close();
            log(`❌ 无法开始授权: ${e.message}`);
        }
    };

    nodes.btnAuthSave.onclick = async () => {
        try { await assertAccount(); } catch (e) { log(e.message); return; }
        const val = nodes.inAuth.value.trim();
        try {
            const urlObj = new URL(val);
            if (urlObj.origin !== 'https://login.live.com' || urlObj.pathname !== '/oauth20_desktop.srf') {
                throw new Error('不是微软授权回调地址');
            }
            const code = urlObj.searchParams.get('code');
            
            if (code) {
                if (!await confirmAuthorizationAccount()) return;
                await acceptAuthorization(code);
            } else {
                log('❌ 格式错误：未在URL中找到 code 参数，请复制完整的白屏网址');
            }
        } catch (e) {
            log('❌ 格式错误：请直接粘贴你复制的完整网页链接 (https://...)');
        }
    };
    updateAllButton();

    // 不再静默抓取 OAuth Code：微软登录页可能保留另一个账号的会话。

    // ========== 核心逻辑 (简化版引用) ==========

    // 数据刷新
    // 统一获取 Token 的逻辑
    async function getSearchToken() {
        if (!state.searchToken) await updateData();
        return state.searchToken;
    }

    // 数据刷新函数（修复 allP 报错 + 本地签到日期双重校验）
    async function updateData() {
    if (state.updatingPromise) return state.updatingPromise;
    state.updating = true;
    state.updatingPromise = (async () => {
        try {
            const cookie = await getCookies('https://rewards.bing.com');

            let htmlRes = '';
            try {
                htmlRes = await gmRequest({
                    method: 'GET',
                    url: 'https://rewards.bing.com/',
                    headers: {
                        'User-Agent': CONFIG.ua.pc,
                        'Cookie': cookie,
                        'Referer': 'https://www.bing.com/'
                    }
                });

                const tokenMatch = htmlRes.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i)
                                || htmlRes.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/i)
                                || htmlRes.match(/RequestVerificationToken["']?\s*[:=]\s*["']([^"']+)["']/i)
                                || htmlRes.match(/"verificationToken"\s*:\s*["']([^"']+)["']/i);
                if (tokenMatch) {
                    state.searchToken = tokenMatch[1];
                }
            } catch (e) {}

            let dashData = null;

            if (htmlRes) dashData = parseDashboard(htmlRes);

            if (!dashData || !dashData.userProfile) {
                try {
                    const token = await getAccessToken();
                    if (token) {
                        const dapiRes = await gmRequest({
                            method: 'GET',
                            url: `https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613&_=${Date.now()}`,
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'X-Rewards-AppId': CONFIG.mobileApi.appId,
                                'X-Rewards-IsMobile': 'true'
                            }
                        });
                        const parsed = JSON.parse(dapiRes);
                        dashData = parsed.response?.dashboard || parsed.response || parsed;
                    }
                } catch (e) {
                    console.error('[Rewards] DAPI 请求错误:', e);
                }
            }

            if (!dashData && identitySource === 'flight' && flightSnapshot) {
                dashData = { balance: flightSnapshot.balance ?? 0, level: flightSnapshot.level ?? 1,
                    userProfile: {}, promotions: [] };
                log('ℹ️ 已读取新版网页积分；任务进度需要为当前 Rewards 账号完成授权后从移动接口读取');
            }
            if (!dashData) {
                if (authReceiving) {
                    log('ℹ️ 正在等待你确认授权账号；尚未兑换 Token，暂时无法读取接口数据');
                } else if (!state.accessToken) {
                    log('ℹ️ 网页数据结构未识别且尚无有效授权，请先完成面板授权；不代表网页未登录');
                } else {
                    log('⚠️ 无法获取 Rewards 数据：可能是接口或页面结构变化，请检查后再执行任务');
                }
                return;
            }

            await assertAccount();
            dashboard = dashData;

            // =========================================================================
            // 1. 解析等级与积分（捕获 profile.attributes.level）
            // =========================================================================
            const profile = dashData.userProfile || dashData.profile || {};
            const balance = dashData.balance;
            const userStatus = dashData.userStatus || dashData.status || {};

            if (typeof balance === 'number') {
                state.points = balance;
            } else if (balance && typeof balance === 'object') {
                state.points = balance.availablePoints ?? balance.points ?? 0;
            } else {
                state.points = profile.availablePoints ?? profile.points ?? dashData.availablePoints ?? 0;
            }

            //直接从 profile.attributes.level 获取新版等级代号（如 newLevel3）
            const rawLevelCandidate = 
                profile?.attributes?.level ||
                userStatus?.levelInfo?.activeLevel ||
                userStatus?.level ||
                (typeof balance === 'object' && balance?.levelInfo?.activeLevel) ||
                (typeof balance === 'object' && balance?.level) ||
                profile?.levelInfo?.activeLevel ||
                profile?.level ||
                dashData?.levelInfo?.activeLevel ||
                dashData?.level ||
                '';

            const rawLevelStr = String(rawLevelCandidate);

            // 🔍 控制台确认日志
            //console.log('[Rewards 最终等级匹配]: 捕获到等级代号 ->', rawLevelStr);

            // 微软新版体系精准匹配（newLevel3 / Level3 / Gold = 金牌）
            if (/Gold|金牌|Level3|newLevel3/i.test(rawLevelStr) || rawLevelStr === '3') {
                state.levelName = '🏅 金牌';
                state.level = 3;
            } else if (/Silver|银牌|Level2|newLevel2/i.test(rawLevelStr) || rawLevelStr === '2') {
                state.levelName = '🥈 银牌';
                state.level = 2;
            } else if (/Member|Bronze|会员|铜牌|Level1|newLevel1/i.test(rawLevelStr) || rawLevelStr === '1') {
                state.levelName = '🥉 会员';
                state.level = 1;
            } else {
                state.level = parseInt(rawLevelStr.replace(/\D/g, '')) || 1;
                state.levelName = rawLevelStr ? rawLevelStr : `Lv.${state.level}`;
            }
            // 2. 搜索进度解析
            let searchCur = 0, searchMax = 0;
            const candidateCounters = [];

            if (Array.isArray(dashData.counters)) candidateCounters.push(...dashData.counters);
            if (Array.isArray(dashData.userCounters)) candidateCounters.push(...dashData.userCounters);
            if (Array.isArray(dashData.userStatus?.counters)) candidateCounters.push(...dashData.userStatus.counters);

            const promos = [
                ...(Array.isArray(dashData.promotions) ? dashData.promotions : []),
                ...(Array.isArray(dashData.morePromotions) ? dashData.morePromotions : []),
                ...(Array.isArray(dashData.userStatus?.promotions) ? dashData.userStatus.promotions : [])
            ];

            promos.forEach(p => {
                const name = ((p.name || p.id || p.title || p.type || '') + '').toLowerCase();
                if (name.includes('search')) {
                    candidateCounters.push(p);
                }
            });

            candidateCounters.forEach(item => {
                if (!item || typeof item !== 'object') return;
                const cur = Number(item.pointProgress ?? item.progress ?? item.current ?? item.points ?? item.attributes?.progress) || 0;
                const max = Number(item.pointProgressMax ?? item.pointMax ?? item.max ?? item.maxPoints ?? item.attributes?.max) || 0;
                searchCur += cur;
                searchMax += max;
            });

            state.searchCur = searchCur;
            state.searchMax = searchMax > 0 ? searchMax : (searchCur > 0 ? searchCur : (state.level > 1 ? 90 : 60));
            state.pcCur = state.searchCur;
            state.pcMax = state.searchMax;

            // 3. 统一收集所有活动列表
            const today = getDateStr();
            const dailySet = dashData.dailySetPromotions?.[today] 
                          || Object.values(dashData.dailySetPromotions || {}).flat() 
                          || [];
            const morePromos = dashData.morePromotions || dashData.promotions || [];
            const activities = dashData.activities || [];

            const allP = [
                ...(Array.isArray(dailySet) ? dailySet : []),
                ...(Array.isArray(morePromos) ? morePromos : []),
                ...(Array.isArray(activities) ? activities : [])
            ];

            // 4. 签到状态解析
            const lastSignDate = accountGet("Config.lastSignDate", "");
            const isLocalSigned = lastSignDate === today;

            let isRemoteSigned = false;

            // A. 从签到活动卡片判断
            const checkInPromo = allP.find(p => {
                if (!p || typeof p !== 'object') return false;
                const str = JSON.stringify(p).toLowerCase();
                if (str.includes('fosbury')) return false;         
                return (
                    str.includes('checkin') ||
                    str.includes('signin') ||
                    str.includes('dailycheckin') ||
                    str.includes('签到')
                );
            });

            if (checkInPromo) {
                const cur = Number(
                    checkInPromo.pointProgress ??
                    checkInPromo.progress ??
                    checkInPromo.attributes?.progress ??
                    0
                );

                const max = Number(
                   checkInPromo.pointProgressMax ??
                   checkInPromo.max ??
                   checkInPromo.attributes?.max ??
                   0
               );

               const complete =
                   checkInPromo.complete === true ||
                   checkInPromo.complete === 'true' ||
                   checkInPromo.attributes?.complete === true ||
                   checkInPromo.attributes?.complete === 'true' ||
                   checkInPromo.attributes?.complete === 'True';
           
              // 只有明确完成，或者存在有效进度且达到最大值，才算签到
              if (complete || (max > 0 && cur >= max)) {
                  isRemoteSigned = true;
              }
            }

            // B. 只接受明确的 claimedToday
            if (!isRemoteSigned) {
                try {
                    const claimed =
                        dashData?.claimedToday === true ||
                        dashData?.claimedToday === 'true' ||
                        dashData?.userStatus?.claimedToday === true ||
                        dashData?.userStatus?.claimedToday === 'true';
                
                    if (claimed) {
                        isRemoteSigned = true;
                    }
                } catch (e) {}
            }

            // C. 本地记录只允许匹配“今天”
            state.checkedIn = isRemoteSigned || isLocalSigned;

            // =========================================================================
            // 5. 阅读任务与活动列表统计（优先从活动列表中提取真实进度，修复日志进度不一致问题）
            const readOfferId = 'ENUS_readarticle3_30points';
            const readPromo = allP.find(p => {
                if (!p || typeof p !== 'object') return false;
                const offerId = p.attributes?.offerid || p.offerid || '';
                return offerId === readOfferId || offerId.toLowerCase().includes('readarticle');
            });

            if (readPromo && readPromo.attributes) {
                state.readCur = parseInt(readPromo.attributes.progress) || 0;
                state.readMax = parseInt(readPromo.attributes.max) || 30;
            } else {
                if (state.readCur === undefined) state.readCur = 0;
                if (state.readMax === undefined) state.readMax = 30;
            }

            state.promosTotal = allP.length;
            state.promosDone = allP.filter(p => p.complete || p.attributes?.complete === 'true' || p.attributes?.complete === 'True').length;

            render();
            const newStatus = `${state.level}-${state.points}-${state.searchCur}-${state.searchMax}`;
            if (state.lastStatus !== newStatus) {
                log(`✓ 数据已更新: Lv.${state.level} ${state.points}pts`);
                state.lastStatus = newStatus;
            }
        } catch (e) {
            console.error('updateData error:', e);
            log(`⚠️ 获取数据出错: ${e.message}`);
        } finally {
            state.updating = false;
            state.updatingPromise = null;
        }
    })();
    return state.updatingPromise;
}
    // UI 渲染函数（精准适配原生节点映射）
    function render() {
        if (accountBlocked || !nodes.level) return;

        // 1. 等级与积分（优先显示金牌/银牌名称）
        nodes.account.textContent = accountScope ? `${identitySource === 'flight' ? '新版会话' : '会话'} ${accountScope.slice(0, 8)}` : '未确认';
        nodes.level.textContent = state.levelName || `Lv.${state.level}`;
        nodes.points.textContent = (state.points || 0).toLocaleString();
        // 2. 搜索进度
        const pcCur = state.searchCur ?? state.pcCur ?? 0;
        const pcMax = state.searchMax ?? state.pcMax ?? 60;
        if (nodes.pc) nodes.pc.textContent = `${pcCur}/${pcMax}`;
        if (nodes.pcBar) nodes.pcBar.style.width = pcMax ? `${(pcCur / pcMax) * 100}%` : '0%';

        // 3. 签到状态
        if (nodes.signStatus) {
            nodes.signStatus.textContent = state.checkedIn ? '已签到' : '未签到';
            nodes.signStatus.style.color = state.checkedIn ? '#107c41' : '#d83b01';
        }

        // 4. 阅读任务
        const readCur = state.readCur ?? 0;
        const readMax = state.readMax ?? 30;
        if (nodes.read) nodes.read.textContent = `${readCur}/${readMax}`;
        if (nodes.readBar) nodes.readBar.style.width = readMax ? `${(readCur / readMax) * 100}%` : '0%';

        // 5. 活动任务
        if (nodes.valPromo) {
            nodes.valPromo.textContent = `${state.promosDone || 0}/${state.promosTotal || 0}`;
        }
    }

    function tokenFailureSummary(error) {
        let data = {};
        try { data = JSON.parse(error.responseText || '{}'); } catch { }
        const allowed = new Set(['invalid_grant', 'invalid_request', 'invalid_client', 'unauthorized_client', 'access_denied', 'temporarily_unavailable', 'server_error', 'invalid_scope']);
        const code = allowed.has(data.error) ? data.error : 'unknown_error';
        const status = Number(error.status) || 0;
        const hints = {
            invalid_grant: '授权码可能已使用、过期或与请求不匹配，请重新发起授权',
            invalid_client: '客户端配置被拒绝，不能靠反复授权解决',
            invalid_scope: '微软接口不接受当前权限范围',
            unauthorized_client: '该客户端不允许此授权方式',
            access_denied: '微软拒绝授权'
        };
        return `HTTP ${status || '未知'} / ${code}：${hints[code] || '请检查网络或授权接口配置'}`;
    }

    // Token 获取
    // 获取/刷新 OAuth Access Token
    async function getAccessToken(opts = {}) {
        await assertAccount();
        const forceRefresh = !!opts.forceRefresh;
        const now = Date.now();

        if (!forceRefresh && state.accessToken && state.accessTokenExpiresAt && now < (state.accessTokenExpiresAt - 60000)) {
            return state.accessToken;
        }

        if (state.tokenPromise) {
            return state.tokenPromise;
        }

        state.tokenPromise = Promise.resolve().then(async () => {
            try {
                if (forceRefresh) {
                    state.accessToken = null;
                    state.accessTokenExpiresAt = 0;
                }

                let refreshToken = identitySource === 'dashboard' ? accountGet('refresh_token', '') : '';
                let body = '';

                if (refreshToken) {
                    body = `client_id=0000000040170455&refresh_token=${encodeURIComponent(refreshToken)}&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&grant_type=REFRESH_TOKEN`;
                } else {
                    log('🔑 正在获取微软活动 Token...');
                    
                    // 1. 尝试静默获取
                    // 新登录会话必须手动选择账号授权，不静默复用 login.live.com 的其他账号。
                    let code = null;
                    
                    // 2. 静默获取失败，检查是否有手动保存的 auth_code
                    if (!code) {
                        const savedCode = accountGet('auth_code', '');
                        if (savedCode) {
                            code = savedCode;
                            accountSet('auth_code', ''); // 授权码是一次性的，取出后立即清空
                            log('📥 已读取手动输入的授权码');
                        }
                    }

                    // 3. 仍然没有可用 code 时，弹出手动授权提示面板
                    if (!code) {
                        log('⚠️ 当前登录会话需重新授权，请选择与 Rewards 网页一致的微软账号');
                        if (nodes.boxAuth) nodes.boxAuth.style.display = 'block';
                        return null;
                    }

                    body = `client_id=0000000040170455&code=${encodeURIComponent(code)}&redirect_uri=https://login.live.com/oauth20_desktop.srf&grant_type=authorization_code`;
                }

                log('🔑 已发送授权兑换请求，等待微软响应...');
                const res = await gmRequest({
                    method: 'POST',
                    url: 'https://login.live.com/oauth20_token.srf',
                    retries: 0,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    data: body
                });

                await assertAccount();
                const data = typeof res === 'string' ? JSON.parse(res) : res;

                if (data.access_token) {
                    state.accessToken = data.access_token;
                    state.accessTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
                    if (data.refresh_token) {
                        accountSet('refresh_token', data.refresh_token);
                    }
                    log('🔑 活动 Token 建立成功');
                    return data.access_token;
                } else {
                    // 若旧 refresh_token 换取失败，清空并重新走 Code 授权
                    if (refreshToken) {
                        console.warn('[Rewards] RefreshToken 失效，尝试重新 Code 授权...');
                        accountSet('refresh_token', '');
                        state.tokenPromise = null;
                        return await getAccessToken({ forceRefresh: true });
                    }
                    log('⚠️ Token 获取失败: ' + tokenFailureSummary({ responseText: JSON.stringify(data) }));
                }
            } catch (e) {
                log('❌ 授权接口错误: ' + tokenFailureSummary(e));
            } finally {
                state.tokenPromise = null;
            }
            return null;
        });

        return state.tokenPromise;
    }
    //签到
    const runSign = async () => {
        nodes.btnSign.disabled = true;
        markBusy(1);
        await waitWhilePaused();
        log('⏳ 正在尝试 App 移动端签到...');

        const region = (state.country || dashboard?.userStatus?.country || 'cn').toLowerCase();

        // 优先获取动态 offerId，无则使用 Sapphire 默认 ID
        let offerId = "Gamification_Sapphire_DailyCheckIn";
        const allPromos = [
            ...(dashboard?.dailySetPromotions?.[getDateStr()] || []),
            ...(dashboard?.morePromotions || []),
            ...(dashboard?.activities || [])
        ];
        const targetPromo = allPromos.find(p => {
            const str = (JSON.stringify(p) || '').toLowerCase();
            return str.includes('checkin') || str.includes('签到') || str.includes('dailycheckin');
        });
        if (targetPromo) {
            offerId = targetPromo.offerId || targetPromo.id || targetPromo.offerid || offerId;
        }

        try {
            const res = await withAccessTokenRequest(token => gmRequest({
                method: 'POST',
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                headers: {
                    'content-type': 'application/json; charset=UTF-8',
                    'user-agent': CONFIG.ua.mobile,
                    'authorization': `Bearer ${token}`,
                    'x-rewards-appid': CONFIG.mobileApi.appId,
                    'x-rewards-ismobile': 'true',
                    'x-rewards-country': region,
                    'x-rewards-language': 'zh',
                    'x-rewards-partnerid': 'startapp',
                    'x-rewards-flights': 'rwgobig'
                },
                data: JSON.stringify({
                    amount: 1,
                    id: generateDapiId(),
                    type: 103,
                    country: region,
                    channel: 'SAAndroid',
                    attributes: {
                        offerid: offerId
                    }
                })
            }));

            if (res) {
                const data = typeof res === 'string' ? JSON.parse(res) : res;
                const response = data.response || {};
                const act = response.activity;

                const pts = Number(act?.p ?? act?.points ?? 0);
                const hasOfferId = act?.a?.offerid || act?.attributes?.offerid;

                if (act && pts > 0) {
                    log(`✅ App 签到成功 +${pts}分`);
                    accountSet("Config.lastSignDate", getDateStr());
                    state.checkedIn = true;
                    render();
                } else if (response.isDuplicate || (act && pts === 0 && hasOfferId)) {
                    log('ℹ️ 今日已经完成过签到');
                    accountSet("Config.lastSignDate", getDateStr());
                    state.checkedIn = true;
                    render();
                } else {
                    log('⚠️ 签到未成功触发，请稍后重试');
                    console.log('[Rewards 未成功签到响应]:', data);
                }
            } else {
                log('❌ 签到无响应');
            }

            await updateData();
        } catch (e) {
            log('❌ 签到出错: ' + e.message);
        } finally {
            nodes.btnSign.disabled = false;
            markBusy(-1);
        }
    };
    nodes.btnSign.onclick = runSign;

    
    // 阅读
    const runRead = async () => {
    nodes.btnRead.disabled = true;
    state.readRunning = true;
    markBusy(1);
    await waitWhilePaused();
    log('⏳ 开始阅读任务...');

    const region = (state.country || dashboard?.userStatus?.country || 'cn').toLowerCase();
    const readOfferId = 'ENUS_readarticle3_30points';

    try {
        // 2. 获取当前真实阅读进度
        const info = await withAccessTokenRequest(token => gmRequest({
            url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
            headers: {
                'authorization': `Bearer ${token}`,
                'user-agent': CONFIG.ua.mobile,
                'x-rewards-appid': CONFIG.mobileApi.appId,
                'x-rewards-ismobile': 'true',
                'x-rewards-country': region,
                'x-rewards-language': 'zh',
                'x-rewards-partnerid': 'startapp',
                'x-rewards-flights': 'rwgobig'
            }
        }));

        if (info) {
            const d = typeof info === 'string' ? JSON.parse(info) : info;
            const p = d.response?.promotions?.find(x => x.attributes?.offerid === readOfferId);

            if (p && p.attributes) {
                let cur = parseInt(p.attributes.progress) || 0;
                let max = parseInt(p.attributes.max) || 30;
                
                // 判断步长：若 max 为 30 则每篇 +3 分（共 10 篇）；若 max 为 10 则每篇 +1 分
                const step = max >= 30 ? 3 : 1;
                const totalArticles = Math.ceil(max / step);

                state.readCur = cur;
                state.readMax = max;
                render();

                if (cur >= max) {
                    log(`✅ 阅读任务已完成 (${cur}/${max})`);
                } else {
                    log(`📖 当前阅读进度 ${cur}/${max}，准备刷文章...`);

                    let currentArticleIdx = Math.floor(cur / step);
                    while (cur < max) {
                       // 方式一：改用已有的运行状态判定
                        if (!state.readRunning && !state.allRunning) break;

                        await waitWhilePaused();
                        currentArticleIdx++;
                        log(`📖 正在阅读第 ${currentArticleIdx}/${totalArticles} 篇文章 (进度: ${cur}/${max})...`);

                        const res = await withAccessTokenRequest(token => gmRequest({
                            method: 'POST',
                            url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                            headers: {
                                'content-type': 'application/json; charset=utf-8',
                                'user-agent': CONFIG.ua.mobile,
                                'authorization': `Bearer ${token}`,
                                'x-rewards-appid': CONFIG.mobileApi.appId,
                                'x-rewards-ismobile': 'true',
                                'x-rewards-country': region,
                                'x-rewards-language': 'zh',
                                'x-rewards-partnerid': 'startapp',
                                'x-rewards-flights': 'rwgobig'
                            },
                            data: JSON.stringify({
                                amount: 1,
                                country: region,
                                id: generateDapiId(),
                                type: 101,
                                channel: 'SAAndroid',
                                attributes: { offerid: readOfferId }
                            })
                        })).catch(() => null);

                        if (res) {
                            const resData = typeof res === 'string' ? JSON.parse(res) : res;
                            console.log(`[Rewards 阅读上报响应 ${currentArticleIdx}/${totalArticles}]:`, resData);

                            // 阅读成功后：进度 +step(3)，积分固定 +3
                            cur = Math.min(max, cur + step);
                            state.points = (state.points || 0) + 3;
                            state.readCur = cur;
                            render();

                            log(`🎉 第 ${currentArticleIdx}/${totalArticles} 篇阅读成功 (+3积分) | 进度: ${state.readCur}/${max} | 当前总积分: ${state.points}`);
                        } else {
                            log(`⚠️ 第 ${currentArticleIdx}/${totalArticles} 篇上报未收到有效响应，继续下一篇...`);
                        }

                        if (cur < max) {
                            // 👈 优化：使用 CONFIG 中的随机时间，并打印休眠日志
                            const readDelay = typeof randomRange === 'function' 
                                ? randomRange(CONFIG.read.minDelay, CONFIG.read.maxDelay) 
                                : 10000;
                            log(`☕ 随机等待 ${(readDelay / 1000).toFixed(1)} 秒...`);
                            await sleep(readDelay);
                        }
                    }

                    if (cur >= max) {
                        log(`✅ 阅读任务执行完毕 (最终进度: ${state.readCur}/${max})`);
                    } else {
                        log(`⏹️ 阅读任务已停止 (当前进度: ${state.readCur}/${max})`);
                    }
                }
            } else {
                log(`⚠️ 未找到阅读任务卡片 (offerid: ${readOfferId})`);
            }
        } else {
            log('❌ 获取阅读进度失败');
        }

        await updateData();
    } catch (e) {
        log('❌ 阅读出错: ' + e.message);
        console.error('[Rewards 阅读异常]:', e);
    } finally {
    state.readRunning = false;
    nodes.btnRead.disabled = false;
    markBusy(-1);
    }
};

nodes.btnRead.onclick = runRead;

    const runPromo = async () => {
        nodes.btnPromo.disabled = true;
        markBusy(1);
        await waitWhilePaused();
        log('⏳ 开始执行活动任务...');
        await updateData();

        // =========================================================================
        // 🌍 区域配置
        // -------------------------------------------------------------------------
        // 【修改说明】：
        // 1. 默认使用 state.country 或 dashboard.userStatus.country 获取当前区域，若未获取到则回退为 'cn'。
        // 2. 若需要强制锁定为 'cn'，可取消注释第一行并注释第二行。
        // =========================================================================
        //const customRegion = 'cn'; //锁定cn区域
        const customRegion = (state.country || dashboard?.userStatus?.country || 'cn').toLowerCase();// 自动全区域,失败回退cn区域


        const region = customRegion.toLowerCase();

        // 计算今日 YYYYMMDD 日期，用于拦截提前加载的未来每日任务
        const now = new Date();
        const todayYmd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

        const isTrue = (val) => {
            if (typeof val === 'boolean') return val;
            if (typeof val === 'string') return val.trim().toLowerCase() === 'true';
            return false;
        };

        // 1. 获取 Token
        let token = (typeof getSearchToken === 'function') ? await getSearchToken() : null;
        if (!token) token = state.searchToken;
        const accessToken = await getAccessToken();

        if (!token && !accessToken) {
            log('⚠️ 未获取到活动 Token，请刷新页面重试');
            nodes.btnPromo.disabled = false;
            markBusy(-1);
            return;
        }

        console.group('[Rewards 活动卡片诊断]');
        let rawTasks = [];

        // 递归挖掘任意对象中的卡片
        const extractCardsFromAnyObject = (obj, sourceName) => {
            if (!obj || typeof obj !== 'object') return;
            const found = [];
            const visited = new WeakSet();

            const search = (node) => {
                if (!node || typeof node !== 'object' || visited.has(node)) return;
                visited.add(node);

                const hasId = node.offerId || node.offerid || node.id || node.activityId;
                const hasAttr = node.title || node.name || node.points || node.pointProgressMax !== undefined || node.destinationUrl;

                if (hasId && hasAttr) {
                    found.push(node);
                    return;
                }

                if (Array.isArray(node)) {
                    for (const item of node) search(item);
                } else {
                    for (const key of Object.keys(node)) {
                        if (key.startsWith('jQuery') || key.startsWith('__')) continue;
                        search(node[key]);
                    }
                }
            };

            search(obj);
            if (found.length > 0) {
                console.log(`📌 从 [${sourceName}] 挖掘出 ${found.length} 个活动卡片数据`);
                rawTasks.push(...found);
            }
        };

        // 渠道 1：从本地 state / dashboard 提取
        if (typeof state !== 'undefined' && state.dashboard) extractCardsFromAnyObject(state.dashboard, "state.dashboard");
        if (typeof dashboard !== 'undefined' && dashboard) extractCardsFromAnyObject(dashboard, "全局 dashboard");

        // 渠道 2：通过 DAPI 移动端接口拉取
        if (accessToken) {
            try {
                const dapiRes = await gmRequest({
                    url: `https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&version=33.8.440724006`,
                    headers: {
                        'authorization': `Bearer ${accessToken}`,
                        'user-agent': CONFIG.ua.mobile,
                        'x-rewards-appid': CONFIG.mobileApi.appId,
                        'x-rewards-country': region
                    }
                });
                const dapiData = typeof dapiRes === 'string' ? JSON.parse(dapiRes) : dapiRes;
                if (dapiData?.response) {
                    extractCardsFromAnyObject(dapiData.response, "DAPI 接口 response");
                }
            } catch (e) {
                console.warn('⚠️ DAPI 请求失败:', e.message);
            }
        }

        // 2. 去重与精细化多重校验
        const seenIds = new Set();
        const taskList = [];

        for (const p of rawTasks) {
            if (!p) continue;

            const id = String(p.offerId || p.id || p.offerid || '');
            const title = p.title || p.name || p.description || '未命名活动';
            const progress = Number(p.pointProgress || 0);
            const max = Number(p.pointProgressMax || p.max || 0);

            if (!id || seenIds.has(id)) continue;

            // 规则 A：排除系统通知、漫游提示、每日签到卡片（需单独签到接口）及异常进度卡片
            const idUpper = id.toUpperCase();
            if (idUpper.includes('NOTIFICATION') || 
                idUpper.includes('ROAMING') || 
                idUpper.includes('CHECKIN') || 
                idUpper.includes('CHECK_IN') || 
                max > 100000) {
                console.log(`❌ [跳过-非通用任务/签到卡片] ${title} (id: ${id})`);
                continue;
            }

            // 规则 B：日期精准拦截（对于 DailySet 任务，拦截未到期的未来任务）
            const dateMatch = id.match(/20\d{6}/);
            if (dateMatch) {
                const cardDate = dateMatch[0];
                if (cardDate > todayYmd) {
                    console.log(`❌ [跳过-未来未到期任务] ${title} (id: ${id}, 日期: ${cardDate})`);
                    continue;
                }
            }

            // 规则 C：区域限制隔离（锁定 CN 时，跳过含有外区编码如 ENUS, US, JP 的任务）
            if (region === 'cn') {
                const nonCnRegex = /_(ENUS|US|UK|JP|DE|FR|CA|AU)_/i;
                if (nonCnRegex.test(id)) {
                    console.log(`❌ [跳过-外区任务] ${title} (id: ${id})`);
                    continue;
                }
            }

            // 规则 D：完成度及锁定校验
            const isCompleted = isTrue(p.complete) ||
                                isTrue(p.completed) ||
                                isTrue(p.isCompleted) ||
                                isTrue(p.attributes?.complete) ||
                                p.state === 'CLAIMED' ||
                                (max > 0 && progress >= max);

            if (isCompleted) {
                console.log(`❌ [跳过-已完成] ${title} (id: ${id}, 进度: ${progress}/${max})`);
                continue;
            }

            if (p.priority <= -2 || p.exclusiveLockedFeatureStatus === 'locked') {
                console.log(`❌ [跳过-已锁定] ${title} (id: ${id})`);
                continue;
            }

            seenIds.add(id);
            taskList.push(p);
            console.log(`✅ [待执行活动] ${title} (id: ${id}, 进度: ${progress}/${max})`);
        }

        console.groupEnd();

        if (taskList.length === 0) {
            log('✅ 所有活动已完成！');
            nodes.btnPromo.disabled = false;
            markBusy(-1);
            return;
        }

        log(`🎯 准备上报 ${taskList.length} 个未完成活动 (当前区域: ${region.toUpperCase()})`);

        let count = 0;
        const restInterval = randomRange(3, 5);

        for (const p of taskList) {
            await waitWhilePaused();
            try {
                const title = p.title || p.name || p.description || '活动任务';
                const offerId = p.offerId || p.id || p.offerid;
                const hash = p.hash || p.activityId || p.attributes?.hash || '1';

                log(`▶️ (${count + 1}/${taskList.length}) 执行: ${title}`);

                // 通道 1：Web 端标准 reportactivity
                if (token) {
                    const formData = new URLSearchParams({
                        id: offerId,
                        hash: hash,
                        timeZone: '480',
                        activityAmount: '1',
                        dbs: '0',
                        form: '',
                        type: '',
                        __RequestVerificationToken: token
                    });

                    await gmRequest({
                        method: 'POST',
                        url: 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'X-Requested-With': 'XMLHttpRequest',
                            'Referer': 'https://rewards.bing.com/'
                        },
                        data: formData.toString()
                    }).catch(() => null);
                }

                // 通道 2：DAPI 移动端 101 上报
                if (accessToken) {
                    await gmRequest({
                        method: 'POST',
                        url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                        headers: {
                            'content-type': 'application/json; charset=UTF-8',
                            'user-agent': CONFIG.ua.mobile,
                            'authorization': `Bearer ${accessToken}`,
                            'x-rewards-appid': CONFIG.mobileApi.appId,
                            'x-rewards-ismobile': 'true',
                            'x-rewards-country': region,
                            'x-rewards-language': 'zh',
                            'x-rewards-partnerid': 'startapp',
                            'x-rewards-flights': 'rwgobig'
                        },
                        data: JSON.stringify({
                            amount: 1,
                            country: region,
                            id: generateDapiId(),
                            type: 101,
                            channel: 'SAAndroid',
                            attributes: { offerid: offerId }
                        })
                    }).catch(() => null);
                }

                count++;

                // 防封随机延迟
                if (count < taskList.length) {
                    if (count % restInterval === 0) {
                        const restTime = randomRange(10000, 18000);
                        log(`☕ 间隔停顿 ${(restTime / 1000).toFixed(1)} 秒...`);
                        await sleep(restTime);
                    } else {
                        const baseDelay = randomRange(4500, 8500);
                        log(`⏳ 间隔等待 ${(baseDelay / 1000).toFixed(1)} 秒...`);
                        await sleep(baseDelay);
                    }
                }
            } catch (e) {
                log(`❌ 活动执行失败: ${e.message}`);
            }
        }

        log(`✅ 活动全部完成，成功提交 ${count} 个活动`);
        await updateData();
        nodes.btnPromo.disabled = false;
        markBusy(-1);
    };

    nodes.btnPromo.onclick = runPromo;

    // 搜索模块：重构版（动态判定合并后的总搜索进度）
    const runSearch = async () => {
        if (state.running) {
            state.running = false;
            if (state.manualPaused) setManualPause(false, { silent: true });
            nodes.btnSearch.textContent = '🔍 搜索';
            updateAllButton();
            return;
        }
        state.running = true;
        nodes.btnSearch.textContent = '⏹ 停止';
        updateAllButton();
        await waitWhilePaused();

        // 搜索前先同步一次最新数据
        await updateData();

        // 执行单次搜索与奖励触发
        const doSearch = async (query, isMobile = false) => {
            const host = isMobile ? 'cn.bing.com' : 'www.bing.com';
            const cookie = await getCookies(`https://${host}`);
            await waitWhilePaused();

            const ua = isMobile ? CONFIG.ua.mobile : CONFIG.ua.pc;
            const searchUrl = `https://${host}/search?q=${encodeURIComponent(query)}&form=QBLH`;

            try {
                // 1. 发送标准的 Bing 搜索请求
                const searchResult = await gmRequest({
                    url: searchUrl,
                    headers: {
                        'User-Agent': ua,
                        'Cookie': cookie,
                        'Referer': `https://${host}/?form=QBLH`
                    }
                });

                // 提取 IG 用于上报
                const igMatch = searchResult.match(/,IG:"([^"]+)"/) || searchResult.match(/"IG":"([^"]+)"/);
                const ig = igMatch ? igMatch[1] : crypto.randomUUID().replace(/-/g, '').toUpperCase();

                // 2. 使用微软 Rewards 专用侧边栏/头部埋点上报积分
                const reportHeaders = {
                    'User-Agent': ua,
                    'Cookie': cookie,
                    'Referer': searchUrl,
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                };

                // 触发奖励计数埋点
                await gmRequest({
                    method: 'POST',
                    url: `https://${host}/rewardsapp/ncheader?ver=88888888&IID=SERP.5047&IG=${ig}&ajaxreq=1`,
                    headers: reportHeaders,
                    data: 'wb=1%3bi%3d1%3bv%3d1'
                }).catch(() => {});

                // 触发活动报告接口
                await gmRequest({
                    method: 'POST',
                    url: `https://${host}/rewardsapp/reportActivity?IG=${ig}&IID=SERP.5047&q=${encodeURIComponent(query)}&ajaxreq=1`,
                    headers: reportHeaders,
                    data: `url=${encodeURIComponent(searchUrl)}&V=web`
                }).catch(() => {});

                log(`✓ 搜索: "${query.substring(0, 12)}..."`);
            } catch (e) {
                console.error('[Rewards] 搜索异常:', e);
                log(`✗ 搜索失败: ${e.message}`);
            }
        };
        // 精确等待函数（优化日志输出频率，彻底杜绝刷屏）
        const preciseWait = async (ms) => {
            state.countdownStartTime = Date.now();
            state.countdownDuration = ms;
            let endTime = Date.now() + ms;

            const totalSecs = Math.ceil(ms / 1000);
            if (totalSecs > 60) {
                const mins = (totalSecs / 60).toFixed(1);
                log(`⏳ 等待中，预计需要 ${mins} 分钟...`);
            } else if (totalSecs > 0) {
                log(`⏳ 等待 ${totalSecs} 秒...`);
            }

            while (Date.now() < endTime && state.running) {
                if (state.manualPaused) {
                    const pausedMs = await waitWhilePaused();
                    endTime += pausedMs;
                    state.countdownStartTime += pausedMs;
                    continue;
                }
                const remaining = Math.max(0, endTime - Date.now());
                await sleep(Math.min(500, remaining));
            }
            
            state.countdownStartTime = 0;
            state.countdownDuration = 0;
        };

        // 暂停检查函数（优化：如果已满直接跳过暂停）
        const checkPause = async () => {
            if (!CONFIG.pause.enabled) return;
            if (state.searchCur >= state.searchMax) return;

            state.searchCount++;
            saveProgress();

            if (state.searchCount % CONFIG.pause.interval === 0) {
                state.isPaused = true;
                const pauseMinutes = CONFIG.pause.duration / 60000;
                log(`⏸️ 已完成 ${state.searchCount} 次搜索，触发防风控暂停 ${pauseMinutes} 分钟...`);
                state.pauseEndTime = Date.now() + CONFIG.pause.duration;
                await preciseWait(CONFIG.pause.duration);
                state.isPaused = false;
                state.pauseEndTime = 0;
                log(`▶️ 暂停结束，继续搜索...`);
            }
        };

        loadProgress();

        // 动态判定搜索进度 (合并后的总搜索任务)
        if (state.searchCur < state.searchMax) {
            log(`💻 开始执行通用搜索，当前进度: ${state.searchCur}/${state.searchMax}`);
            let searchIndex = 0;

            while (state.searchCur < state.searchMax && state.running) {
                await waitWhilePaused();

                searchIndex++;
                const q = await getHotQuery();
                await doSearch(q, false);

                // 👈 核心修复：每次做完立即同步预估积分 (+3分/次)
                state.searchCur = Math.min(state.searchMax, state.searchCur + 3);
                render();
                await checkPause();
                if (!state.running) break;
                await preciseWait(randomRange(CONFIG.pc.minDelay, CONFIG.pc.maxDelay));

                // 降低更新频率，每 5 次搜索同步一次数据，避免进度丢失
                if (searchIndex % 5 === 0) {
                    log(`🔄 已完成 ${searchIndex} 次搜索，同步一次数据...`);
                    await updateData();
                }

                // 达到预估上限后，再检查服务器真实进度
                if (state.searchCur >= state.searchMax) {
                    if (searchIndex % 5 !== 0) {
                        log(`🔄 搜索达到预估上限，最后同步一次数据...`);
                        await updateData();
                    }
                    log(`🎉 搜索积分已达今日上限 (${state.searchCur}/${state.searchMax})！`);
                    break;
                }
            }
            log(`💻 搜索结束，共执行 ${searchIndex} 次搜索 (最终进度: ${state.searchCur}/${state.searchMax})`);
        } else {
            log('💻 今日搜索任务已全部完成');
        }

        state.running = false;
        nodes.btnSearch.textContent = '🔍 搜索';
        updateAllButton();
        saveProgress();
    };
    nodes.btnSearch.onclick = runSearch;

    nodes.btnAll.onclick = async () => {
        try { await assertAccount(); } catch (e) { log(e.message); return; }
        if (state.manualPaused || state.running || state.allRunning || state.busyCount > 0) {
            setManualPause(!state.manualPaused);
            return;
        }
        state.allRunning = true;
        updateAllButton();
        log('🚀 一键执行开始');
        try {
            await waitWhilePaused();
            await runSign();
            await runRead();
            await runPromo();
            await runSearch();
        } finally {
            state.allRunning = false;
            updateAllButton();
        }
    };

    // 页面启动后自动执行一次，避免刷新或脚本重新初始化时重复启动
    const autoRunAll = async () => {
        if (!CONFIG.autoRun?.enabled) return;
        if (identitySource === 'flight') {
            log('ℹ️ 新版页面默认不自动执行，请确认授权账号后手动启动');
            return;
        }
        if (identitySource !== 'dashboard') {
            nodes.panel.classList.remove('collapsed');
            log('⚠️ 尚未识别 Rewards 页面账号，禁止自动执行；本页需要明确选择 Rewards 账号重新授权后手动操作');
            return;
        }
        if (sessionStorage.getItem('mr_require_manual_start') === '1') {
            nodes.panel.classList.remove('collapsed');
            log('ℹ️ 缓存已清理，本标签页自动执行已关闭；请确认账号并重新授权后手动启动');
            return;
        }
        if (location.hostname !== 'rewards.bing.com' || !location.pathname.startsWith('/dashboard')) return;

        // sessionStorage 仅用于当前标签页，不是跨标签页的浏览器会话锁
        const autoRunKey = scopedKey('auto_run_' + getDateHyphen());
        if (sessionStorage.getItem(autoRunKey) === '1') {
            log('ℹ️ 当前标签页今天已自动启动过任务，可手动点击全部执行');
            return;
        }

        log(`⏳ ${CONFIG.autoRun.delay / 1000} 秒后自动开始执行...`);
        await sleep(CONFIG.autoRun.delay);
        if (state.manualPaused || state.running || state.allRunning || state.busyCount > 0) return;
        if (!dashboard || !state.accessToken || Date.now() >= state.accessTokenExpiresAt) {
            log('⚠️ 自动执行已跳过：请先完成登录或授权，再手动点击全部执行');
            return;
        }
        if (typeof nodes.btnAll?.onclick === 'function') {
            sessionStorage.setItem(autoRunKey, '1');
            nodes.panel.classList.remove('collapsed');
            await nodes.btnAll.onclick();
        }
    };

    // Init
    (async () => {
        try {
            await assertAccount();
            loginCookie = await getCookies('https://login.live.com');

            console.log('[Rewards] 登录Cookie长度:', loginCookie.length);
            await updateData();

            try {
                const info = await withAccessTokenRequest(token => gmRequest({
                    url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                    headers: { 
                        'Authorization': `Bearer ${token}`, 
                        'X-Rewards-AppId': CONFIG.mobileApi.appId, 
                        'X-Rewards-IsMobile': 'true' 
                    }
                }));
                if (info) {
                    const d = typeof info === 'string' ? JSON.parse(info) : info;
                    const p = d.response?.promotions?.find(x => x.attributes?.offerid === 'ENUS_readarticle3_30points');
                    if (p && p.attributes) { 
                        state.readCur = parseInt(p.attributes.progress) || 0; 
                        state.readMax = parseInt(p.attributes.max) || 30; 
                        render(); 
                    }
                }
            } catch { }
        } catch { }
        const hour = new Date().getHours();

        if (hour >= 0 && hour < 8) {
            log('⚠️ 当前时间 00:00-08:00，Rewards 每日任务可能尚未刷新');
            log('💡 建议北京时间 08:00 后运行脚本，避免任务进度显示异常');
        }
        log('🌟 脚本就绪 v1.0.21');
        await autoRunAll().catch(e => log(`❌ 自动执行出错: ${e.message}`));
    })();

    setInterval(() => {
        assertAccount().catch(() => {});
    }, 15000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) assertAccount().catch(() => {});
    });
    setInterval(updateData, 60000);

})();
