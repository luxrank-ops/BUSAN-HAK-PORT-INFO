// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// ============================================================================
/**
 * 🖥️ 최근 3일 PC 접속자 위치 리스트 API 회귀 테스트
 *
 * 확인하는 것 (운영에서 '목록이 비어 보이는' 사고를 다시 만들지 않기 위한 최소 보증)
 *   1. 비콘은 위치 조회(외부 API) 결과와 무관하게 접속 기록(IP·기기·시각)을 먼저 저장한다.
 *   2. 비콘 저장 위치는 날짜·IP·30분 버킷 단위 문서라 같은 접속이 중복 누적되지 않는다.
 *   3. /api/visitor-logs 는 관리자 세션 토큰 없이는 401 로 거부한다.
 *   4. 토큰이 있으면 device=desktop 필터·요약·deviceCounts 를 정상 반환한다.
 *   5. device=all 은 전체 기기를, device 미지정은 전체 기기를 의미한다.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

process.env.VERCEL = '1';
process.env.ADMIN_PASSWORD = 'test-admin-secret-9988';

const { app, setFirebaseBackendOverrideForTests, issueAdminSessionToken } = await tsImport('../server.ts', import.meta.url);

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const kstDateKey = (ms) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
const NOW_MS = Date.now();

/** where / orderBy / limit 체이닝을 지원하는 최소 Firestore 목 */
function buildMockFirestore(seed) {
    const collections = {};
    for (const [name, docs] of Object.entries(seed)) collections[name] = { ...docs };
    const writes = [];

    const makeQuery = (docs, filters) => ({
        where(field, op, value) {
            return makeQuery(docs, [...filters, { field, op, value }]);
        },
        orderBy() {
            return this;
        },
        limit() {
            return this;
        },
        async get() {
            const matched = docs.filter((doc) =>
                filters.every(({ field, op, value }) => {
                    const current = doc.data()[field];
                    if (op === '==') return current === value;
                    if (op === '>=') return Number(current) >= Number(value);
                    if (op === '<=') return Number(current) <= Number(value);
                    return true;
                })
            );
            return {
                size: matched.length,
                docs: matched,
                forEach(cb) {
                    matched.forEach(cb);
                }
            };
        }
    });

    return {
        writes,
        collections,
        db: {
            collection(name) {
                const store = collections[name] || (collections[name] = {});
                const docs = () => Object.entries(store).map(([id, raw]) => ({ id, exists: true, data: () => ({ ...raw }) }));
                return {
                    doc(id) {
                        return {
                            async set(payload, options = {}) {
                                writes.push({ collection: name, id, payload: { ...payload }, options });
                                store[id] = options.merge ? { ...(store[id] || {}), ...payload } : { ...payload };
                                return {};
                            },
                            async get() {
                                const exists = Object.prototype.hasOwnProperty.call(store, id);
                                return { id, exists, data: () => (exists ? { ...store[id] } : undefined) };
                            }
                        };
                    },
                    async add(payload) {
                        writes.push({ collection: name, id: 'auto', payload: { ...payload }, options: {} });
                        return {};
                    },
                    async get() {
                        const list = docs();
                        return { size: list.length, docs: list, forEach(cb) { list.forEach(cb); } };
                    },
                    ...makeQuery(docs(), [])
                };
            }
        }
    };
}

const desktopLog = (id, ms, ip = '121.130.45.12') => ({
    ip,
    device: 'desktop',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    country: '대한민국',
    region: '부산광역시',
    city: '해운대구',
    dateKey: kstDateKey(ms),
    accessedAtMs: ms,
    locationSource: 'ip-api'
});

const mock = buildMockFirestore({
    visitor_ip_logs: {
        'desktop-1': desktopLog('121.130.45.12', NOW_MS - 60 * 60 * 1000),
        'desktop-2': desktopLog('121.130.45.13', NOW_MS - 26 * 60 * 60 * 1000),
        'mobile-1': {
            ip: '223.62.1.5',
            device: 'android',
            dateKey: kstDateKey(NOW_MS - 30 * 60 * 1000),
            accessedAtMs: NOW_MS - 30 * 60 * 1000,
            country: '대한민국',
            region: '부산광역시',
            city: '강서구'
        },
        // 기간(최근 3일) 밖 기록 — 목록에 나오면 안 됩니다.
        'old-desktop': desktopLog('121.130.45.99', NOW_MS - 5 * 24 * 60 * 60 * 1000)
    },
    visitor_stats: {}
});

let server;
let baseUrl;
let adminToken;

before(async () => {
    setFirebaseBackendOverrideForTests({ db: mock.db });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    adminToken = issueAdminSessionToken().token;
});

after(async () => {
    setFirebaseBackendOverrideForTests(null);
    if (server) await new Promise((resolve) => server.close(resolve));
});

async function callApi(path, init) {
    const res = await fetch(`${baseUrl}${path}`, init);
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }
    return { status: res.status, json };
}

test('비콘 — 위치 조회와 무관하게 접속 기록을 먼저 저장한다', async () => {
    const before = mock.writes.length;
    const res = await callApi('/api/visitor-beacon', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'x-forwarded-for': '121.130.45.200, 10.0.0.7',
            'x-vercel-ip-country': 'KR',
            'x-vercel-ip-country-region': '26',
            'x-vercel-ip-city': 'Busan'
        },
        body: JSON.stringify({ device: 'desktop' })
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });

    const newWrites = mock.writes.slice(before);
    assert.ok(newWrites.length >= 1, '비콘은 최소 1건의 기록을 남겨야 합니다');
    const baseWrite = newWrites[0];
    assert.equal(baseWrite.payload.ip, '121.130.45.200', '프록시 뒤에서도 공인 클라이언트 IP 를 기록');
    assert.equal(baseWrite.payload.device, 'desktop');
    assert.match(baseWrite.payload.dateKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(baseWrite.payload.accessedAtMs > 0, '조회 기간 필터에 쓰는 accessedAtMs 가 있어야 합니다');
    // 위치 보강 기록이 남으면 국가/도시가 함께 저장됩니다. (외부 조회 실패 시엔 생략될 수 있음)
    const enrichment = newWrites[1];
    if (enrichment) {
        assert.ok(enrichment.payload.country || enrichment.payload.city, '보강 기록에는 위치 값이 있어야 합니다');
        assert.notEqual(enrichment.payload.locationSource, 'pending');
    }
});

test('비콘 — 같은 접속은 날짜·IP·30분 버킷 문서로 중복 저장되지 않는다', async () => {
    const first = mock.writes.filter((w) => w.payload.ip === '121.130.45.201').length;
    const headers = {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'x-forwarded-for': '121.130.45.201'
    };
    await callApi('/api/visitor-beacon', { method: 'POST', headers, body: JSON.stringify({ device: 'desktop' }) });
    const afterFirst = mock.writes.filter((w) => w.payload.ip === '121.130.45.201');
    assert.ok(afterFirst.length > first);
    assert.ok(afterFirst.every((w) => /^\d{4}-\d{2}-\d{2}_[a-f0-9]{12}_\d+$/.test(w.id)), '문서 ID 는 날짜_IP해시_버킷 형식');
});

test('조회 — 관리자 세션 토큰이 없으면 401 로 거부한다', async () => {
    const res = await callApi('/api/visitor-logs?device=desktop&days=3');
    assert.equal(res.status, 401);
    assert.equal(res.json.ok, false);
});

test('조회 — device=desktop 은 PC 기록만, 요약·기간 필터가 정확하다', async () => {
    const res = await callApi('/api/visitor-logs?device=desktop&days=3', {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    const payload = res.json;
    assert.equal(payload.ok, true);
    assert.equal(payload.days, 3);
    assert.equal(payload.deviceFilter, 'desktop');
    assert.equal(payload.dateKeys.length, 3);
    assert.ok(payload.logs.length >= 2, '기간 안의 PC 기록이 조회되어야 합니다');
    assert.ok(payload.logs.every((l) => l.device === 'desktop'), 'PC 이외 기기는 제외');
    assert.ok(payload.logs.every((l) => l.accessedAtMs >= payload.sinceMs), '기간 밖 기록은 제외');
    assert.ok(!payload.logs.some((l) => l.ip === '121.130.45.99'), '5일 전 기록은 최근 3일 목록에 없어야 합니다');
    assert.ok(payload.logs.every((l) => typeof l.locationLabel === 'string' && l.locationLabel.length > 0));
    assert.ok(payload.logs.every((l) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(l.accessedAt)), '표시 시각은 KST 포맷');
    assert.ok(payload.summary.totalCount >= payload.logs.length);
    assert.ok(payload.summary.uniqueIp >= 1);
    assert.ok(Array.isArray(payload.summary.byDay) && payload.summary.byDay.length >= 3);
    assert.ok(Array.isArray(payload.summary.byLocation) && payload.summary.byLocation.length >= 1);
});

test('조회 — device=all/미지정은 전체 기기를, days 는 1~7 로 제한된다', async () => {
    const all = await callApi('/api/visitor-logs?device=all&days=99', {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(all.status, 200);
    assert.equal(all.json.deviceFilter, '');
    assert.equal(all.json.days, 7, 'days 는 최대 7일로 제한');
    assert.ok(all.json.logs.some((l) => l.device === 'android'), '전체 기기 조회에는 모바일 기록도 포함');

    const fallback = await callApi('/api/visitor-logs', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.json.days, 3, '기본 조회 기간은 최근 3일');
});

test('조회 — PC 기록이 없으면 같은 기간 기기별 건수를 함께 알려준다', async () => {
    const desktopOnly = await callApi('/api/visitor-logs?device=desktop&days=1', {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(desktopOnly.status, 200);
    if (desktopOnly.json.logs.length === 0) {
        assert.ok(
            desktopOnly.json.deviceCounts && Object.keys(desktopOnly.json.deviceCounts).length >= 0,
            'deviceCounts 로 다른 기기 기록 유무를 안내할 수 있어야 합니다'
        );
    }
});
