import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readdirSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';
import { readAppFile, extractFunction } from './app-source.mjs';

process.env.VERCEL = '1';
process.env.ADMIN_PASSWORD = 'test-admin-secret-9988';

const serverModule = await tsImport('../server.ts', import.meta.url);
const {
    app,
    setFirebaseBackendOverrideForTests,
    issueAdminSessionToken,
    verifyAdminSessionToken,
    ADMIN_CUSTOM_TOKEN_UID
} = serverModule;

function buildMockFirestore(collectionsMap) {
    return {
        collection(colName) {
            const docsObj = collectionsMap[colName] || {};
            return {
                doc(docId) {
                    return {
                        async get() {
                            const exists = Object.prototype.hasOwnProperty.call(docsObj, docId);
                            return {
                                id: docId,
                                exists,
                                data: () => (exists ? { ...docsObj[docId] } : undefined)
                            };
                        }
                    };
                },
                async get() {
                    const docs = Object.entries(docsObj).map(([id, raw]) => ({
                        id,
                        exists: true,
                        data: () => ({ ...raw })
                    }));
                    return {
                        size: docs.length,
                        docs,
                        forEach(cb) {
                            docs.forEach(cb);
                        }
                    };
                }
            };
        }
    };
}

const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
const todayKey = `${kstNow.getUTCFullYear()}-${String(kstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(kstNow.getUTCDate()).padStart(2, '0')}`;
const sha256SampleHash = crypto.createHash('sha256').update('worker-pin-1234', 'utf8').digest('hex');

const mockDb = buildMockFirestore({
    settings: {},
    visitor_stats: {
        total: {
            count: 1542,
            unique: 418,
            devices: { android: 980, ios: 410, desktop: 152 },
            hours: { h00_06: 120, h06_12: 540, h12_18: 560, h18_24: 322 },
            blocks: { calc: 640, schedule: 510, worklog: 390 },
            terminals: { hjnc: 300, bnct: 240 },
            actions: { calc_run: 450, worklog_save: 280 },
            updatedAt: { toMillis: () => 1761000000000 }
        },
        [`daily-${todayKey}`]: {
            date: todayKey,
            count: 47,
            unique: 29,
            devices: { android: 31, ios: 12, desktop: 4 },
            hours: { h00_06: 5, h06_12: 18, h12_18: 16, h18_24: 8 },
            blocks: { calc: 21, schedule: 19 },
            terminals: { hjnc: 14 },
            actions: { calc_run: 15 },
            updatedAt: { toMillis: () => 1761003600000 }
        }
    },
    user_profiles: {
        '홍길동': {
            password: sha256SampleHash,
            createdAt: { toMillis: () => 1760900000000 }
        },
        '김항만': {
            password: 'legacy-plain-secret-never-leak',
            createdAt: { toMillis: () => 1760950000000 }
        }
    },
    work_logs: {
        '홍길동_2026-10-20': {
            workerId: '홍길동',
            date: '2026-10-20',
            shipName: 'HMM BUSAN',
            wage1: 210000,
            wage2: 95000,
            totalPay: 305000,
            memo: '1항차 라싱',
            timestamp: { toMillis: () => 1760960000000 }
        },
        '김항만_2026-10-21': {
            workerId: '김항만',
            date: '2026-10-21',
            shipName: 'MSC SEOUL',
            wage1: 240000,
            totalPay: 240000,
            memo: '주간 본선',
            timestamp: { toMillis: () => 1761010000000 }
        },
        '홍길동_2026-10-19_deleted': {
            workerId: '홍길동',
            date: '2026-10-19',
            shipName: 'DELETED VESSEL',
            totalPay: 999999,
            deletedAt: { toMillis: () => 1760970000000 }
        }
    },
    ships: {
        ship1: { name: 'HMM BUSAN' },
        ship2: { name: 'OLD SHIP', deletedAt: 1760000000000 }
    },
    posts: {
        post1: { title: '오늘 신항 날씨' }
    },
    notices: {
        notice1: { title: '안전모 착용 안내' }
    },
    archives: {
        arch1: { fileName: '단가표.pdf' },
        arch2: { fileName: '연락망.pdf' }
    }
});

const mintedCustomTokens = [];
const mockAuth = {
    async createCustomToken(uid) {
        mintedCustomTokens.push(uid);
        return `custom-jwt-for-${uid}`;
    }
};

let server;
let baseUrl = '';

before(async () => {
    setFirebaseBackendOverrideForTests({ db: mockDb, auth: mockAuth });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
    setFirebaseBackendOverrideForTests(null);
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('Vercel 2세그먼트 서버리스 진입점 3종이 모두 존재하며 Hobby 플랜 함수 한도(12개) 이하를 유지한다', () => {
    const apiFiles = readdirSync(new URL('../api', import.meta.url)).filter((f) => f.endsWith('.ts'));
    assert.ok(apiFiles.includes('analytics-summary.ts'));
    assert.ok(apiFiles.includes('auth-session.ts'));
    assert.ok(apiFiles.includes('admin-stats.ts'));
    assert.ok(
        apiFiles.length <= 12,
        `Vercel Hobby 플랜 함수 개수 한도(12개) 초과: 현재 ${apiFiles.length}개 (${apiFiles.join(', ')})`
    );

    // 배포는 규칙 → 색인 → 호스팅 순서의 개별 단계로 실행합니다.
    // (한 번에 묶으면 어느 단계에서 실패했는지 알 수 없어 규칙이 옛 버전으로 남습니다)
    const deployWorkflow = readAppFile('.github/workflows/deploy-firebase.yml');
    assert.match(deployWorkflow, /--only firestore:rules --project busan-hak-port/);
    assert.match(deployWorkflow, /--only firestore:indexes --project busan-hak-port/);
    assert.match(deployWorkflow, /--only hosting --project busan-hak-port/);
    assert.ok(
        deployWorkflow.indexOf('--only firestore:rules') < deployWorkflow.indexOf('--only hosting'),
        '보안 규칙을 호스팅보다 먼저 배포해야 합니다'
    );
});

test('CORS 정책은 Firebase Hosting(web.app) 및 Vercel 프리뷰 출처를 허용하고 외부 비인가 출처는 차단한다', async () => {
    const allowedWebApp = await fetch(`${baseUrl}/api/analytics-summary`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://busan-hak-port.web.app' }
    });
    assert.equal(allowedWebApp.status, 204);
    assert.equal(allowedWebApp.headers.get('access-control-allow-origin'), 'https://busan-hak-port.web.app');

    const allowedPreview = await fetch(`${baseUrl}/api/admin-stats`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://busan-hak-port-info-preview123.vercel.app' }
    });
    assert.equal(allowedPreview.status, 204);
    assert.equal(
        allowedPreview.headers.get('access-control-allow-origin'),
        'https://busan-hak-port-info-preview123.vercel.app'
    );

    const blockedEvil = await fetch(`${baseUrl}/api/admin-stats`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://attacker.example.com' }
    });
    assert.equal(blockedEvil.status, 204);
    assert.equal(blockedEvil.headers.get('access-control-allow-origin'), null);
});

test('POST /api/auth-session 은 관리자 검증 시 admin_luxrank 커스텀 토큰·HMAC 세션 토큰을 발급하고 오답은 401을 반환한다', async () => {
    const badRes = await fetch(`${baseUrl}/api/auth-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'admin', password: 'wrong-password' })
    });
    assert.equal(badRes.status, 401);

    const okRes = await fetch(`${baseUrl}/api/auth-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'admin', password: 'test-admin-secret-9988' })
    });
    assert.equal(okRes.status, 200);
    const body = await okRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.mode, 'admin');
    assert.equal(body.uid, ADMIN_CUSTOM_TOKEN_UID);
    assert.equal(body.customToken, `custom-jwt-for-${ADMIN_CUSTOM_TOKEN_UID}`);
    assert.equal(verifyAdminSessionToken(body.token), true);
    assert.equal(verifyAdminSessionToken(`${body.token}tampered`), false);

    const anonRes = await fetch(`${baseUrl}/api/auth-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'anonymous', clientId: 'device_busan_01' })
    });
    assert.equal(anonRes.status, 200);
    const anonBody = await anonRes.json();
    assert.equal(anonBody.ok, true);
    assert.equal(anonBody.uid, 'worker_device_busan_01');
    assert.equal(anonBody.customToken, 'custom-jwt-for-worker_device_busan_01');
});

test('/api/admin-stats 는 무인증 요청을 401로 차단하고, 유효 토큰에는 전체 근로자·활성 근무일지·방문통계를 비밀번호 유출 없이 반환한다', async () => {
    const unauthGet = await fetch(`${baseUrl}/api/admin-stats`);
    assert.equal(unauthGet.status, 401);

    const { token } = issueAdminSessionToken();
    const okRes = await fetch(`${baseUrl}/api/admin-stats`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(okRes.status, 200);
    const rawText = await okRes.text();

    // 어떠한 경우에도 비밀번호 해시나 평문이 직렬화된 JSON 응답에 포함되면 안 된다
    assert.equal(rawText.includes(sha256SampleHash), false);
    assert.equal(rawText.includes('legacy-plain-secret-never-leak'), false);
    assert.equal(rawText.includes('"password"'), false);

    const data = JSON.parse(rawText);
    assert.equal(data.ok, true);
    assert.equal(data.counts.workersCount, 2);
    assert.equal(data.counts.workLogsCount, 2); // 소프트 삭제 1건 제외!
    assert.equal(data.counts.shipsCount, 1); // 소프트 삭제 선박 1건 제외!
    assert.equal(data.counts.postsCount, 1);
    assert.equal(data.counts.noticesCount, 1);
    assert.equal(data.counts.archivesCount, 2);
    assert.equal(data.totalDoc.count, 1542);
    assert.equal(data.dailyDocsByDate[todayKey].count, 47);

    assert.equal(data.workerAccounts.length, 2);
    const hong = data.workerAccounts.find((w) => w.nick === '홍길동');
    const kim = data.workerAccounts.find((w) => w.nick === '김항만');
    assert.equal(hong.isSha256, true);
    assert.equal(hong.logCount, 1);
    assert.equal(hong.totalPay, 305000);
    assert.equal(kim.isSha256, false);
    assert.equal(kim.logCount, 1);
    assert.equal(kim.totalPay, 240000);

    assert.equal(data.workLogs.length, 2);
});

test('/api/analytics-summary 는 개인 식별 정보(PII) 없이 전체 집계 카운트와 방문 추이를 반환한다', async () => {
    const res = await fetch(`${baseUrl}/api/analytics-summary`);
    assert.equal(res.status, 200);
    const rawText = await res.text();
    assert.equal(rawText.includes('홍길동'), false);
    assert.equal(rawText.includes('김항만'), false);
    assert.equal(rawText.includes('workerAccounts'), false);

    const data = JSON.parse(rawText);
    assert.equal(data.ok, true);
    assert.equal(data.collections.workersCount, 2);
    assert.equal(data.collections.workLogsCount, 2);
    assert.equal(data.collections.archivesCount, 2);
    assert.equal(data.totalDoc.count, 1542);
    assert.equal(data.dailyDocsByDate[todayKey].count, 47);
});

test('클라이언트 app.js 는 익명 인증 비활성/권한 거부 환경에서도 서버 세션·통계 API를 통해 0명/0건 없이 복구된다', async () => {
    const appJs = readAppFile('public/js/app.js');
    const storageMap = new Map();
    const sessionStorageMock = {
        getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
        setItem: (k, v) => storageMap.set(k, String(v)),
        removeItem: (k) => storageMap.delete(k)
    };
    const localStorageMap = new Map();
    const localStorageMock = {
        getItem: (k) => (localStorageMap.has(k) ? localStorageMap.get(k) : null),
        setItem: (k, v) => localStorageMap.set(k, String(v)),
        removeItem: (k) => localStorageMap.delete(k)
    };

    const domElements = {
        statsDbContentGrid: { innerHTML: '', classList: { contains: () => true } },
        awlTableContainer: { innerHTML: '' },
        awlUpdatedTime: { innerText: '' }
    };

    let signedInUser = null;
    let sawAuthBeforeWorkLogQuery = false;

    const authMock = {
        get currentUser() {
            return signedInUser;
        },
        onAuthStateChanged(cb) {
            queueMicrotask(() => cb(signedInUser));
            return () => {};
        },
        async signInAnonymously() {
            const err = new Error('operation-not-allowed');
            err.code = 'auth/operation-not-allowed';
            throw err;
        },
        async signInWithCustomToken(jwt) {
            signedInUser = { uid: jwt.replace('custom-jwt-for-', '') };
            return { user: signedInUser };
        }
    };

    const strictClientDb = {
        collection(name) {
            if (name === 'work_logs') {
                const makeScopedQuery = () => ({
                    where: () => makeScopedQuery(),
                    orderBy: () => makeScopedQuery(),
                    limit: () => makeScopedQuery(),
                    async get() {
                        if (!signedInUser) {
                            const err = new Error('Missing or insufficient permissions.');
                            err.code = 'permission-denied';
                            throw err;
                        }
                        sawAuthBeforeWorkLogQuery = true;
                        const docs = [{ id: '홍길동_2026-10-20', data: () => ({ workerId: '홍길동', date: '2026-10-20', totalPay: 305000 }) }];
                        return {
                            docs,
                            forEach: (cb) => docs.forEach(cb)
                        };
                    }
                });
                return {
                    ...makeScopedQuery(),
                    async get() {
                        const err = new Error('Missing or insufficient permissions.');
                        err.code = 'permission-denied';
                        throw err;
                    }
                };
            }
            return {
                doc() {
                    return {
                        async get() {
                            const err = new Error('Missing or insufficient permissions.');
                            err.code = 'permission-denied';
                            throw err;
                        }
                    };
                },
                async get() {
                    const err = new Error('Missing or insufficient permissions.');
                    err.code = 'permission-denied';
                    throw err;
                }
            };
        }
    };

    const fnsToExtract = [
        'getOrCreateClientDeviceId',
        'getStoredAdminSessionToken',
        'saveAdminSessionToken',
        'hasServerBackedAdminAccess',
        'fetchPortApiJson',
        'ensureAnonymousAuth',
        'queryWorkLogsByDateRange',
        'verifyAdmin',
        'fetchServerAdminStatsPayload',
        'loadAndRenderVisitorStats',
        'loadAdminWorkLogDetail'
    ];
    const extractedCode = fnsToExtract.map((fn) => {
        const src = extractFunction(appJs, fn);
        assert.ok(src, `app.js 에 ${fn} 함수가 존재해야 합니다`);
        return src;
    }).join('\n\n');

    const sandbox = {
        window: {
            location: { origin: 'https://busan-hak-port.web.app' },
            crypto: crypto.webcrypto
        },
        document: {
            getElementById: (id) => domElements[id] || null
        },
        sessionStorage: sessionStorageMock,
        localStorage: localStorageMock,
        crypto: crypto.webcrypto,
        TextEncoder,
        fetch: (url, init) => {
            const resolvedUrl = String(url).startsWith('http') ? url : `https://busan-hak-port.web.app${url}`;
            if (resolvedUrl.startsWith('https://busan-hak-port.web.app/api/')) {
                return Promise.resolve(
                    new Response('<!DOCTYPE html><html><body>SPA fallback</body></html>', {
                        status: 200,
                        headers: { 'Content-Type': 'text/html; charset=utf-8' }
                    })
                );
            }
            return fetch(resolvedUrl, init);
        },
        console,
        Promise,
        Set,
        Map,
        Date,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        JSON,
        setTimeout,
        clearTimeout,
        auth: authMock,
        db: strictClientDb,
        ADMIN_UID_WHITELIST: ['admin_luxrank', 'luxrank_admin_uid'],
        ADMIN_EMAIL_WHITELIST: ['luxrank@gmail.com'],
        FALLBACK_PRODUCTION_API_ORIGIN: baseUrl,
        ADMIN_SESSION_TOKEN_KEY: 'busanPortAdminToken',
        ADMIN_SESSION_EXPIRY_KEY: 'busanPortAdminTokenExpiresAt',
        ANON_CLIENT_ID_KEY: 'busanHakPortClientId',
        DEFAULT_ADMIN_PW_HASH: '6cda3286b168d396ec539b002b14f58a6aebd453b6e5bc146c2d82dfd2614bc3',
        currentAuthUser: null,
        currentWorkerId: '홍길동',
        isAdminSessionVerified: false,
        authEnsureInFlightPromise: null,
        authInitialStateResolved: true,
        authInitialStatePromise: Promise.resolve(null),
        workLogScopedQueryUnavailable: false,
        allShipsData: [],
        allPostsData: [],
        cachedStatsModalData: { workerAccounts: [] },
        adminWorkLogDetailCache: { logs: [], loadedAt: 0 },
        getKstDateString: () => todayKey,
        getVisitorDateKey: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        STATS_BLOCK_META: [{ id: 'calc', label: '임금계산기' }],
        STATS_TERMINAL_META: [{ id: 'hjnc', label: 'HJNC' }],
        STATS_ACTION_META: [{ id: 'calc_run', label: '임금계산' }],
        isDeletedRecord: (d) => Boolean(d && d.deletedAt),
        prompt: () => 'test-admin-secret-9988',
        alert: () => {},
        showToast: () => {},
        setVisitorStatText: () => {},
        renderStatsBarRows: () => {},
        renderStatsBlockRanking: () => {},
        renderStatsTerminalRanking: () => {},
        renderStatsWorkerAccountList: () => {},
        setAdminWorkLogText: (id, txt) => {
            if (domElements[id]) domElements[id].innerText = txt;
        },
        formatAdminWorkLogDateTime: () => '2026-10-21 12:00',
        escapeShipCommentHtml: (s) => String(s),
        populateAdminWorkLogWorkerSelect: () => {},
        renderAdminWorkLogDetail: () => {}
    };

    vm.createContext(sandbox);
    vm.runInContext(extractedCode, sandbox);

    // 1) 익명 로그인이 비활성화된 상태에서도 queryWorkLogsByDateRange 호출 시 서버 커스텀 토큰으로 자동 로그인 후 조회 성공!
    const rangeSnap = await sandbox.queryWorkLogsByDateRange('2026-10-01', '2026-10-31');
    assert.equal(sawAuthBeforeWorkLogQuery, true);
    assert.equal(rangeSnap.docs.length, 1);
    assert.equal(signedInUser.uid.startsWith('worker_'), true);

    // 2) 관리자 인증 시 서버에서 admin_luxrank 커스텀 토큰 + HMAC 토큰을 받아 세션을 승격!
    const adminOk = await sandbox.verifyAdmin();
    assert.equal(adminOk, true);
    assert.equal(signedInUser.uid, 'admin_luxrank');
    assert.equal(sandbox.hasServerBackedAdminAccess(), true);

    // 3) 클라이언트 Firestore 가 전부 permission-denied 여도 서버 /api/admin-stats 로 2명·2건 완벽 복구!
    await sandbox.loadAndRenderVisitorStats();
    assert.match(domElements.statsDbContentGrid.innerHTML, /2명/);
    assert.match(domElements.statsDbContentGrid.innerHTML, /2건/);
    assert.equal(sandbox.cachedStatsModalData.workerAccounts.length, 2);

    // 4) 누적 근무일지 통합 상세보기도 0건이 아닌 실제 2건 로드!
    await sandbox.loadAdminWorkLogDetail(true);
    assert.equal(sandbox.adminWorkLogDetailCache.logs.length, 2);
    assert.match(domElements.awlUpdatedTime.innerText, /총 2건/);
});
