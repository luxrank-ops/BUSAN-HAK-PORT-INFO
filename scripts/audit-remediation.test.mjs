/**
 * 전체 품질 감사(docs/inspections/full-audit-2026-11-26.md) Phase 1~3 조치 회귀 테스트
 *
 * Phase 1: P0-1~P0-6, P1-4, P1-5, P1-9 (보안/인증/Firestore 규칙/운영자에게 바란다/XSS/백도어 제거)
 * Phase 2: P1-1~P1-3, P1-6~P1-8, P1-10~P1-13, P2-2~P2-5 (임금계산기·달력·2027/CF Workers/서버리스 안정성)
 * Phase 3: P2-1, P2-6~P2-12, P3-1~P3-5 (PWA·FCM·정적 폴백·백업/TTL·지연 구독·CI·위생)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readAppHtml, APP_ASSET_VERSION } from './app-source.mjs';

const ROOT = new URL('..', import.meta.url);
const readText = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const serverCode = readText('server.ts');
const rulesCode = readText('firestore.rules');
const appJs = readText('public/js/app.js');
const wantBoardJs = readText('public/js/want-board.js');
const shipsBoardJs = readText('public/js/ships-board.js');
const notificationsJs = readText('public/js/notifications.js');
const rosterEngineJs = readText('public/js/roster-engine.js');
const fcmSwJs = readText('public/firebase-messaging-sw.js');
const swJs = readText('public/service-worker.js');
const workerIndexTs = readText('worker/index.ts');
const cfFirestoreTs = readText('worker/cf/firestore.ts');
const cfStorageTs = readText('worker/cf/storage.ts');
const cfMessagingTs = readText('worker/cf/messaging.ts');
const buildObfuscateMjs = readText('scripts/build-obfuscate.mjs');
const buildWorkerMjs = readText('scripts/build-worker.mjs');

function runTsxJson(snippet, extraEnv = {}) {
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', '-e', snippet],
    {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, NODE_ENV: 'test', ...extraEnv },
      encoding: 'utf8',
      timeout: 30000
    }
  );
  if (res.status !== 0) {
    throw new Error(`tsx 실행 실패 (status=${res.status})\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`);
  }
  const line = res.stdout.trim().split('\n').filter(Boolean).pop() || '{}';
  return JSON.parse(line);
}

// ============================================================================
// PHASE 1 — 보안 · 인증 · Firestore 규칙 · 운영자에게 바란다 · XSS · 백도어 제거
// ============================================================================

test('[Phase 1 · P0-1/P1-9] 토큰 서명 키가 용도별 분리되고 기본 PIN/관리자 비밀번호 백도어가 비활성화된다', () => {
  // 1) 소스 레벨 검증: 9445 하드코딩 서명 폴백 제거 & verifyAdmin 기본 해시 OR 조건 제거
  assert.doesNotMatch(serverCode, /getScreenUnlockTokenSecret\(\)\s*:\s*string[\s\S]{0,400}'9445'/);
  assert.match(serverCode, /ADMIN_SESSION_SECRET/);
  assert.match(serverCode, /EPHEMERAL_RUNTIME_TOKEN_SECRET/);
  assert.doesNotMatch(appJs, /inputHash\s*===\s*DEFAULT_ADMIN_PW_HASH\s*\|\||\b\|\|\s*inputHash\s*===\s*DEFAULT_ADMIN_PW_HASH/);
  assert.match(buildObfuscateMjs, /explicitScreenPin\s*\?\s*''\s*:\s*DEFAULT_SCREEN_LOCK_PIN/);

  // 2) 런타임 검증: SCREEN_LOCK_PIN / ADMIN_PASSWORD 명시 시 기본값(9445/9363) 거부
  const out = runTsxJson(`
    (async () => {
      const mod = await import('./server.ts');
      const okNewPin = mod.verifyScreenLockPin('7788');
      const rejectDefaultPin = mod.verifyScreenLockPin('9445');
      const okNewAdmin = await mod.verifyAdminPassword('CustomAdmin!2026');
      const rejectDefaultAdmin = await mod.verifyAdminPassword('9363');
      const adminTok = mod.issueAdminSessionToken();
      const adminOk = mod.verifyAdminSessionToken(adminTok.token);
      const adminAsEmergencyUnlock = mod.verifyEmergencyUnlockToken(adminTok.token);
      console.log(JSON.stringify({
        okNewPin, rejectDefaultPin, okNewAdmin, rejectDefaultAdmin, adminOk, adminAsEmergencyUnlock
      }));
    })();
  `, {
    SCREEN_LOCK_PIN: '7788',
    ADMIN_PASSWORD: 'CustomAdmin!2026',
    ADMIN_SESSION_SECRET: 'secret-admin-only-key-1234',
    SCREEN_UNLOCK_TOKEN_SECRET: 'secret-screen-only-key-5678'
  });

  assert.equal(out.okNewPin, true, '명시된 SCREEN_LOCK_PIN 은 통과해야 합니다');
  assert.equal(out.rejectDefaultPin, false, 'SCREEN_LOCK_PIN 이 설정되면 기본값 9445 는 거부되어야 합니다');
  assert.equal(out.okNewAdmin, true, '명시된 ADMIN_PASSWORD 는 통과해야 합니다');
  assert.equal(out.rejectDefaultAdmin, false, 'ADMIN_PASSWORD 가 설정되면 기본값 9363 은 거부되어야 합니다');
  assert.equal(out.adminOk, true, '관리자 토큰은 관리자 검증을 통과해야 합니다');
  assert.equal(out.adminAsEmergencyUnlock, false, '관리자 토큰은 긴급 공지 잠금 해제 토큰 검증을 통과하지 않아야 합니다');
});

test('[Phase 1 · P0-2/P0-3/P0-4/P0-5] /api/auth-session worker 로그인·갱신·익명 HMAC UID 및 PUT /api/emergency-notifications 동작 검증', () => {
  const out = runTsxJson(`
    (async () => {
      const http = await import('node:http');
      const crypto = await import('node:crypto');
      const mod = await import('./server.ts');
      const store = new Map();
      const makeDocRef = (col, id) => ({
        id,
        async get() {
          const key = col + '/' + id;
          return { exists: store.has(key), id, data: () => store.get(key) };
        },
        async set(data, opts) {
          const key = col + '/' + id;
          const prev = opts && opts.merge ? (store.get(key) || {}) : {};
          store.set(key, { ...prev, ...data });
        },
        async update(data) {
          const key = col + '/' + id;
          store.set(key, { ...(store.get(key) || {}), ...data });
        }
      });
      const fakeDb = {
        collection(col) {
          return {
            doc: (id) => makeDocRef(col, id),
            async get() { return { size: 0, docs: [], forEach() {} }; }
          };
        },
        async runTransaction(fn) { return fn({ get: (r) => r.get(), create: (r, d) => r.set(d) }); }
      };
      const minted = [];
      const fakeAuth = {
        async createCustomToken(uid, claims) {
          minted.push({ uid, claims: claims || null });
          return 'fake-ct:' + uid;
        }
      };
      mod.setFirebaseBackendOverrideForTests({ db: fakeDb, auth: fakeAuth });

      const srv = http.createServer(mod.app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const port = srv.address().port;
      const reqJson = async (method, path, body, headers = {}) => {
        const res = await fetch('http://127.0.0.1:' + port + path, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body ? JSON.stringify(body) : undefined
        });
        return { status: res.status, data: await res.json().catch(() => null) };
      };

      // 1) 익명 UID HMAC 파생 — clientId 그대로 노출/사칭 불가
      const anon = await reqJson('POST', '/api/auth-session', { mode: 'anonymous', clientId: 'victim_uid_1234' });
      // 2) 미등록 사용자 login -> 404, 이후 register -> Custom Token(workerId claim) + workerSessionToken 발급
      const notFoundLogin = await reqJson('POST', '/api/auth-session', { mode: 'worker', action: 'login', nick: '김항만', password: 'pw1234' });
      const reg = await reqJson('POST', '/api/auth-session', { mode: 'worker', action: 'register', nick: '김항만', password: 'pw1234' });
      // 3) 기존 닉네임 타 비밀번호 덮어쓰기 차단 (401)
      const dupReg = await reqJson('POST', '/api/auth-session', { mode: 'worker', action: 'register', nick: '김항만', password: 'pw9999' });
      // 4) 비밀번호 오답 차단 (401)
      const badLogin = await reqJson('POST', '/api/auth-session', { mode: 'worker', action: 'login', nick: '김항만', password: 'wrong' });
      // 5) 정상 로그인 + worker-refresh
      const okLogin = await reqJson('POST', '/api/auth-session', { mode: 'worker', action: 'login', nick: '김항만', password: 'pw1234' });
      const refreshed = await reqJson('POST', '/api/auth-session', { mode: 'worker-refresh', token: okLogin.data.token });
      // 6) PUT /api/emergency-notifications 무인증 차단(401) vs 관리자 토큰 저장(200)
      const emUnauth = await reqJson('PUT', '/api/emergency-notifications', { enabled: true, title: '가짜공지', message: '피싱' });
      const adminTok = mod.issueAdminSessionToken().token;
      const emAdmin = await reqJson('PUT', '/api/emergency-notifications', { enabled: true, title: '강풍주의', message: '안전유의', level: 'danger', revision: 12345 }, { Authorization: 'Bearer ' + adminTok });

      srv.close();
      console.log(JSON.stringify({
        anonUid: anon.data?.uid,
        notFoundStatus: notFoundLogin.status,
        regStatus: reg.status,
        regClaim: minted[1]?.claims,
        dupStatus: dupReg.status,
        badLoginStatus: badLogin.status,
        okLoginStatus: okLogin.status,
        refreshStatus: refreshed.status,
        refreshNick: refreshed.data?.nick,
        storedPwIsSha256: /^[a-f0-9]{64}$/.test(String(store.get('user_profiles/김항만')?.password || '')),
        emUnauthStatus: emUnauth.status,
        emAdminStatus: emAdmin.status,
        storedNoticeTitle: store.get('settings/emergency_notice')?.title || ''
      }));
    })();
  `, {
    ADMIN_SESSION_SECRET: 'test-admin-secret-9999'
  });

  assert.match(out.anonUid, /^worker_[a-f0-9]{24}$/, '익명 UID는 HMAC 파생 불투명 식별자여야 합니다');
  assert.notEqual(out.anonUid, 'worker_victim_uid_1234');
  assert.equal(out.notFoundStatus, 404, '미등록 닉네임 로그인은 404로 안내되어야 합니다');
  assert.equal(out.regStatus, 200);
  assert.deepEqual(out.regClaim, { workerId: '김항만' }, '근무자 Custom Token은 workerId 클레임을 포함해야 합니다');
  assert.equal(out.dupStatus, 401, '기존 닉네임에 다른 비밀번호로 재가입 시도는 401로 차단되어야 합니다');
  assert.equal(out.badLoginStatus, 401, '틀린 비밀번호는 401로 거부되어야 합니다');
  assert.equal(out.okLoginStatus, 200);
  assert.equal(out.refreshStatus, 200);
  assert.equal(out.refreshNick, '김항만');
  assert.equal(out.storedPwIsSha256, true, '비밀번호는 SHA-256 해시로 저장되어야 합니다');
  assert.equal(out.emUnauthStatus, 401, '무인증 긴급 공지 저장은 401로 차단되어야 합니다');
  assert.equal(out.emAdminStatus, 200, '관리자 인증 긴급 공지 저장은 200이어야 합니다');
  assert.equal(out.storedNoticeTitle, '강풍주의');
});

test('[Phase 1 · P0-3/P0-4/P0-5] firestore.rules 가 소유자 클레임·관리자 전용 긴급공지·URL 스킴·알림 격리를 강제한다', () => {
  assert.match(rulesCode, /function isWorkerSelf\(workerId\)/);
  assert.match(rulesCode, /request\.auth\.token\.workerId == workerId/);
  assert.match(rulesCode, /function isValidHttpUrl\(val\)/);
  assert.match(rulesCode, /val\.matches\('\^https\?:\/\/\.\+'\)/);
  assert.match(rulesCode, /match \/work_logs\/\{logId\}[\s\S]*?isWorkerSelf\(existing\(\)\.workerId\)/);
  assert.match(rulesCode, /match \/user_profiles\/\{nick\}[\s\S]*?allow create: if isAdmin\(\);/);
  assert.match(rulesCode, /match \/settings\/\{settingId\}[\s\S]*?isAdmin\(\)/);
  assert.match(rulesCode, /match \/notifications\/\{notiId\}[\s\S]*?isWorkerSelf\(existing\(\)\.workerId\)|match \/notifications\/\{notiId\}[\s\S]*?request\.auth\.uid/);
  assert.match(rulesCode, /isValidHttpUrl\(data\.url\)/);
});

test('[Phase 1 · P0-6/P1-5/P1-4] want-board 관리자 바/미리보기 수정/답글 상태 갱신 및 관리자 모달 XSS 차단', () => {
  // P0-6: renderWantEmpty / renderWantMyList 가 adminBar 를 숨기지 않고 renderWantAdminBar() 호출
  assert.doesNotMatch(wantBoardJs, /adminBar\.classList\.toggle\('hidden',\s*!adminMode\)/);
  assert.match(wantBoardJs, /function renderWantMyList[\s\S]{0,600}renderWantAdminBar\(\)/);
  // P1-5: 미리보기 수정 버튼이 closeWantPreview() 호출 & 전역 노출 + 답글 부모 상태 갱신
  assert.match(wantBoardJs, /onclick="closeWantPreview\(\)"/);
  assert.match(wantBoardJs, /global\.closeWantPreview\s*=\s*closeWantPreview/);
  assert.match(wantBoardJs, /status:\s*STATUS_REPLIED/);
  assert.doesNotMatch(wantBoardJs, /0346/);

  // P1-4: 관리자 근무일지 모달에 인라인 onclick 문자열 삽입 제거 + data-* / sanitizeSafeHttpUrl 적용
  assert.doesNotMatch(appJs, /onclick="filterAdminWorkLogByWorker\('/);
  assert.doesNotMatch(appJs, /onclick="setAdminWorkLogKeyword\('/);
  assert.match(appJs, /data-worker-id=/);
  assert.match(appJs, /data-keyword=/);
  assert.match(appJs, /function sanitizeSafeHttpUrl/);
});

// ============================================================================
// PHASE 2 — 임금계산기 · 달력 · 2027 · CF Workers · 서버리스 성능/안정성
// ============================================================================

test('[Phase 2 · P1-1/P1-2/P1-3] 말일(31일) 월 이동, 소수점 시간(8.5H) 정밀 계산, 2026-06-03 공휴일 및 2027 최저시급(10,700원)', () => {
  // 1) WAGE_HOURLY_BY_YEAR[2027] === 10700 및 공휴일 정합성
  assert.match(appJs, /2027:\s*10700/);
  assert.match(appJs, /2026-06-03/);
  assert.match(appJs, /2027-02-07/);
  assert.match(appJs, /2027-12-27/);
  assert.doesNotMatch(appJs, /['"]2026-09-28['"]/, '2026-09-28은 공식 대체공휴일이 아니므로 제거되어야 합니다');

  // 2) VM 에서 changeMonth, changeLeaderMonth, calculateWageSegment 직접 실행 검증
  const extractFn = (src, name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} 함수를 찾을 수 없습니다`);
    let depth = 0;
    let bodyStart = src.indexOf('{', start);
    for (let i = bodyStart; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error(`${name} 함수 본문 닫힘을 찾을 수 없습니다`);
  };

  const publicHolidaysMatch = appJs.match(/const publicHolidays = \[[\s\S]*?\];/);
  assert.ok(publicHolidaysMatch);

  const rendered = [];
  const leaderRendered = [];
  const sandbox = {
    Date, Math, Number, String, Array, Set, Boolean, isNaN,
    currentDate: new Date(2026, 2, 31), // 2026-03-31
    leaderCurrentDate: new Date(2026, 0, 31), // 2026-01-31
    renderCalendar: (y, m) => rendered.push([y, m]),
    renderLeaderCalendar: (y, m) => leaderRendered.push([y, m]),
    renderRow: (label, amt) => `${label}:${amt}`
  };
  vm.createContext(sandbox);
  vm.runInContext([
    publicHolidaysMatch[0],
    extractFn(appJs, 'getSeasonScheduleByMonth'),
    extractFn(appJs, 'isWeekendOrPublicHolidayDate'),
    extractFn(appJs, 'changeMonth'),
    extractFn(appJs, 'changeLeaderMonth'),
    extractFn(appJs, 'calculateWageSegment')
  ].join('\n'), sandbox);

  // P1-1: 2026-03-31 +1개월 -> 2026년 4월(index 3), 건너뛰어 5월이 되면 안 됨
  sandbox.changeMonth(1);
  assert.deepEqual(rendered[0], [2026, 3], '3월 31일에서 +1개월 이동 시 4월이어야 합니다');
  // 2026-01-31 +1개월 -> 2026년 2월(index 1)
  sandbox.changeLeaderMonth(1);
  assert.deepEqual(leaderRendered[0], [2026, 1], '1월 31일에서 +1개월 이동 시 2월이어야 합니다');

  // P1-2: 8.5시간 평일 주간(08:00~16:30, 2026-03-04 수요일) -> 9H가 아니라 정확히 8.5H!
  const frac = sandbox.calculateWageSegment(
    { startDate: '2026-03-04', endDate: '2026-03-04', startHour: 8, endHour: 16, hours: 8.5 },
    { baseRate: 10320, skilled: false }
  );
  assert.equal(frac.dayHours, 8.5, '소수점 8.5시간은 8.5H로 정확히 계산되어야 합니다');
  assert.equal(frac.nightHours, 0);
  assert.equal(frac.totalPay, Math.round(8.5 * 10320));

  // P1-2 경계 교차: 16:00부터 4.5시간 (3월: 주간 08~18시 -> 주간 2H + 야간 2.5H)
  const cross = sandbox.calculateWageSegment(
    { startDate: '2026-03-04', endDate: '2026-03-04', startHour: 16, endHour: 20, hours: 4.5 },
    { baseRate: 10320, skilled: false }
  );
  assert.equal(cross.dayHours, 2);
  assert.equal(cross.nightHours, 2.5);
  assert.equal(cross.totalPay, Math.round(2 * 10320 + 2.5 * 10320 * 1.5));

  // P1-3: 2026-06-03 지방선거일 공휴일 자동 인식
  const electionDay = sandbox.calculateWageSegment(
    { startDate: '2026-06-03', endDate: '2026-06-03', startHour: 8, endHour: 16, hours: 8 },
    { baseRate: 10320, skilled: false }
  );
  assert.equal(electionDay.autoWeekendHolidayHours, 8, '2026-06-03 지방선거일은 공휴일로 자동 인정되어야 합니다');
});

test('[Phase 2 · P1-6/P2-5] Cloudflare Workers Firestore/Storage/Messaging 어댑터 정합성 검증', () => {
  const out = runTsxJson(`
    (async () => {
      const fsMod = await import('./worker/cf/firestore.ts');
      const db = new fsMod.Firestore();
      const ref = db.collection('posts').doc('p1');
      const subRef = ref.collection('comments').doc('c1');

      // 1) transform-only merge -> updateMask 없이 transform write 사용
      const wTransformOnly = db.buildSetWrite(ref, { views: fsMod.FieldValue.increment(1), updatedAt: fsMod.FieldValue.serverTimestamp() }, true);
      // 2) 일반 필드 + delete + transform 혼합 -> updateMask 에는 일반 필드와 delete 필드만 포함 (transform 제외!)
      const wMixed = db.buildUpdateWrite(ref, {
        title: 'ok',
        obsolete: fsMod.FieldValue.delete(),
        views: fsMod.FieldValue.increment(1)
      });
      // 3) nested dot-path snapshot.get('a.b')
      const snap = new fsMod.DocumentSnapshot('p1', true, {
        fields: {
          nested: { mapValue: { fields: { count: { integerValue: '42' } } } }
        }
      }, ref);

      console.log(JSON.stringify({
        subPath: subRef.path,
        hasTransformOnly: Boolean(wTransformOnly.transform && !wTransformOnly.update),
        mixedMask: wMixed.updateMask?.fieldPaths || [],
        mixedHasExistsPrecondition: wMixed.currentDocument?.exists === true,
        mixedTransformsLen: (wMixed.updateTransforms || []).length,
        nestedGet: snap.get('nested.count')
      }));
    })();
  `);

  assert.equal(out.subPath, 'posts/p1/comments/c1', 'DocumentReference.collection() 서브컬렉션 경로 지원');
  assert.equal(out.hasTransformOnly, true, 'transform 전용 쓰기는 updateMask 충돌 없는 transform write 여야 합니다');
  assert.deepEqual(out.mixedMask.sort(), ['obsolete', 'title'], 'updateMask 에는 값 필드와 delete 필드만 포함되고 transform 필드는 제외되어야 합니다');
  assert.equal(out.mixedHasExistsPrecondition, true, 'update()는 currentDocument.exists=true 를 설정해야 합니다');
  assert.equal(out.mixedTransformsLen, 1);
  assert.equal(out.nestedGet, 42, 'DocumentSnapshot.get()은 중첩 점 경로를 지원해야 합니다');

  // _listAll() limit 반영 및 Storage/Messaging 어댑터 보강 확인
  assert.match(cfFirestoreTs, /:beginTransaction/);
  assert.match(cfFirestoreTs, /Math\.min\(1000,\s*remaining\)/);
  assert.match(cfStorageTs, /uploadType=multipart/);
  assert.match(cfStorageTs, /async delete\(/);
  assert.match(cfStorageTs, /async getFiles\(/);
  assert.match(cfMessagingTs, /messaging\/registration-token-not-registered/);
  assert.match(cfMessagingTs, /responses:\s*SendResponse\[\]/);
});

test('[Phase 2 · P1-7/P1-8/P1-10/P1-11/P1-12/P1-13/P2-2/P2-3/P2-4] 서버리스 안정성·JSON 에러·CORS·보안 헤더·영속화 검증', () => {
  // P1-8: vercel.json 전체 함수 maxDuration 60
  const vercel = JSON.parse(readText('vercel.json'));
  assert.equal(vercel.functions['api/[...path].ts'].maxDuration, 60);
  assert.equal(vercel.functions['api/*.ts'].maxDuration, 60);
  assert.equal(vercel.functions['api/cron/*.ts'].maxDuration, 60);

  // P2-2: public/_headers 존재 및 필수 보안·캐시 헤더 선언
  assert.ok(existsSync(new URL('../public/_headers', import.meta.url)));
  const cfHeaders = readText('public/_headers');
  assert.match(cfHeaders, /X-Content-Type-Options:\s*nosniff/);
  assert.match(cfHeaders, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
  assert.match(cfHeaders, /\/service-worker\.js[\s\S]*?Cache-Control:\s*no-cache/);
  assert.match(cfHeaders, /\/firebase-messaging-sw\.js[\s\S]*?Cache-Control:\s*no-cache/);

  // P2-4: worker/index.ts 보안 헤더 래퍼 & server.ts CF 헤더 지원
  assert.match(workerIndexTs, /withSecurityHeaders/);
  assert.match(serverCode, /cf-ipcountry/);
  assert.match(serverCode, /cf-connecting-ip/);

  // P1-7: 순수 crypto JWT-Bearer 토큰 발급기
  assert.match(serverCode, /async function getServiceAccountAccessToken\(/);
  // P1-10: analytics-summary 캐시 + .count()
  assert.match(serverCode, /ANALYTICS_SUMMARY_CACHE_TTL_MS/);
  assert.match(serverCode, /getFastCollectionCount/);
  // P1-11: KST 범위 계산 + 병렬 스크래핑 + 배치 캐시
  assert.match(serverCode, /function buildKstDateRange\(/);
  assert.match(serverCode, /Promise\.allSettled\(\s*SUPPORTED_TERMINALS\.map/);
  assert.match(serverCode, /flushCacheWrites/);
  // P1-13: 일일 점검 Firestore 영속화
  assert.match(serverCode, /DAILY_INSPECTION_COLLECTION/);
  assert.match(serverCode, /loadDailyInspectionSummary/);

  // P1-12 + P2-3 런타임 테스트: 잘못된 JSON -> 400 JSON, 4KB 초과 -> 413 JSON, workers.dev CORS + PUT 허용
  const out = runTsxJson(`
    (async () => {
      const http = await import('node:http');
      const mod = await import('./server.ts');
      const srv = http.createServer(mod.app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const port = srv.address().port;
      const base = 'http://127.0.0.1:' + port;

      const badJsonRes = await fetch(base + '/api/screen-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid-json'
      });
      const badJsonCt = badJsonRes.headers.get('content-type') || '';
      const badJsonBody = await badJsonRes.json().catch(() => null);

      const bigRes = await fetch(base + '/api/screen-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: 'x'.repeat(8000) })
      });
      const bigBody = await bigRes.json().catch(() => null);

      const corsRes = await fetch(base + '/api/emergency-notifications', {
        method: 'OPTIONS',
        headers: { Origin: 'https://busan-hak-port-info.luxrank.workers.dev' }
      });

      srv.close();
      console.log(JSON.stringify({
        badJsonStatus: badJsonRes.status,
        badJsonIsJson: badJsonCt.includes('application/json'),
        badJsonError: badJsonBody?.error,
        bigStatus: bigRes.status,
        bigError: bigBody?.error,
        corsOrigin: corsRes.headers.get('access-control-allow-origin'),
        corsMethods: corsRes.headers.get('access-control-allow-methods')
      }));
    })();
  `);

  assert.equal(out.badJsonStatus, 400);
  assert.equal(out.badJsonIsJson, true, '잘못된 JSON 오류는 HTML이 아닌 JSON이어야 합니다');
  assert.equal(out.badJsonError, 'invalid_json');
  assert.equal(out.bigStatus, 413);
  assert.equal(out.bigError, 'payload_too_large');
  assert.equal(out.corsOrigin, 'https://busan-hak-port-info.luxrank.workers.dev');
  assert.match(out.corsMethods || '', /\bPUT\b/);
});

// ============================================================================
// PHASE 3 — PWA · FCM · 정적 폴백 · totalPay:0 · 지연 구독 · 백업/TTL · CI · 위생
// ============================================================================

test('[Phase 3 · P2-1/P2-6/P2-7/P2-8/P2-9/P2-10/P2-11/P2-12/P3] PWA/FCM/폴백/지연구독/TTL/CI/버전 동기화 검증', () => {
  // P2-1: Node 정적 서빙에서 서비스 워커·매니페스트 no-cache 보장
  assert.match(serverCode, /service-worker\\\.js\|firebase-messaging-sw\\\.js\|manifest\\\.json\|index\\\.html[\s\S]{0,120}no-cache/);

  // P2-6: FCM SW 중복 알림 방지 + notificationclick 핸들러 + 서버 만료 토큰 정리
  assert.match(fcmSwJs, /if \(payload && payload\.notification\)/);
  assert.match(fcmSwJs, /addEventListener\('notificationclick'/);
  assert.match(serverCode, /fcmToken:\s*FieldValue\.delete\(\)/);

  // P2-7: 정적 호스팅 폴백 API 지원 (app.js, notifications.js, roster-engine.js)
  assert.match(notificationsJs, /FALLBACK_PRODUCTION_API_ORIGIN.*\/api\/config/);
  assert.match(rosterEngineJs, /async function fetchRosterApi\(/);
  assert.match(appJs, /FALLBACK_PRODUCTION_API_ORIGIN\}\$\{scheduleQueryPath\}/);

  // P2-8: adminStatsHandler 명시적 totalPay: 0 보존
  assert.match(serverCode, /d\.totalPay != null && Number\.isFinite\(Number\(d\.totalPay\)\)/);

  // P2-9: 미열람 알림 TTL(90일) + visitor_ip_logs TTL(30일) + 확장 백업 컬렉션(비밀번호 제외)
  assert.match(serverCode, /UNREAD_NOTIFICATION_TTL_DAYS = 90/);
  assert.match(serverCode, /VISITOR_IP_LOG_TTL_DAYS = 30/);
  assert.match(serverCode, /EXTENDED_BACKUP_COLLECTIONS/);

  // P2-10: 자유게시판 댓글 지연 구독 (toggleBoardRow 에서만 loadComments 호출) + 컬렉션 limit
  assert.match(appJs, /\} else if \(id\.startsWith\("p-"\)\) \{[\s\S]{0,160}loadComments\(/);
  assert.match(appJs, /db\.collection\("notices"\)\.orderBy\("timestamp","desc"\)\.limit\(100\)/);
  assert.match(appJs, /db\.collection\("posts"\)\.orderBy\("timestamp","desc"\)\.limit\(200\)/);
  assert.match(appJs, /db\.collection\("archives"\)\.orderBy\("timestamp","desc"\)\.limit\(200\)/);

  // P2-11: ships-board.js 소프트삭제 필터링
  assert.match(shipsBoardJs, /if \(!data \|\| data\.deletedAt\) return;/);
  assert.match(shipsBoardJs, /if \(data && data\.deletedAt\)/);

  // P2-12: CI 빌드·CF 번들 검증 + weekly-self-check 실패 노출 + daily-inspection 최신화
  const ciYml = readText('.github/workflows/ci.yml');
  const weeklyYml = readText('.github/workflows/weekly-self-check.yml');
  const dailyInsp = readText('scripts/daily-inspection.mjs');
  assert.match(ciYml, /npm run build && npm run build:cf/);
  assert.doesNotMatch(weeklyYml, /continue-on-error:\s*true/);
  assert.match(dailyInsp, /public\/_headers/);
  assert.match(dailyInsp, /worker\/cf\/firestore\.ts/);
  assert.match(dailyInsp, /PUT \/api\/emergency-notifications/);

  // P3-1 / P3-3 / P3-4 / P3-5: README 구 비밀번호 제거, CF minify, manifest Network-First, 버전 동기화
  const readme = readText('README.md');
  assert.doesNotMatch(readme, /0346/);
  assert.match(buildWorkerMjs, /minify:\s*true/);
  assert.match(swJs, /url\.pathname === "\/manifest\.json"/);
  assert.equal(APP_ASSET_VERSION, '2027.93');
  assert.ok(readAppHtml().includes(`?v=${APP_ASSET_VERSION}`));
  assert.ok(swJs.includes(`busan-hak-port-v${APP_ASSET_VERSION}`));
});
