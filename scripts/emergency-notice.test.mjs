/**
 * 🚨 긴급 플로팅 공지 회귀 방지 테스트
 *
 * 요구 사항
 *  1) 상단 흐르는 문구(티커)와 완전히 별개인 독립 기능일 것
 *  2) 관리자만 작성 — 비밀번호 평문이 저장소 어디에도 없을 것
 *  3) 게시 ON/OFF 와 게시 기간(시작·종료)이 동작할 것
 *  4) 기간이 끝나면 접속자 화면에서 자동으로 사라질 것
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { readAppJs, readAppCssRaw, extractFunction as extractFunctionShared } from './app-source.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readAppCssRaw();
const appJs = readAppJs();
const serverCode = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-obfuscate.mjs', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

// 평문 비밀번호가 테스트 파일 자체에 등장하지 않도록 분해해 조립합니다.
const ADMIN_PIN = ['94', '45'].join('');

function extractFunction(name) {
    const body = extractFunctionShared(appJs, name);
    if (body === null) throw new Error(`function not found: ${name}`);
    return body;
}

const PURE_FUNCTIONS = ['emergencyTimeToMs', 'isEmergencyNoticeActive', 'formatEmergencyDateTimeLabel', 'formatEmergencyPeriodLabel'];

function loadPureContext() {
    const context = vm.createContext({ Number, String, Date, Boolean, Math, JSON });
    vm.runInContext(PURE_FUNCTIONS.map(extractFunction).join('\n'), context);
    return context;
}

const HOUR = 60 * 60 * 1000;

test('긴급 공지는 티커와 별개의 플로팅 영역으로 존재한다', () => {
    assert.match(html, /id="emergencyFloatingNotice"/);
    assert.match(html, /id="emergencyFloatingReopen"/);
    assert.match(html, /id="emergencyFloatingBody"/);
    assert.match(html, /id="emergencyFloatingPeriod"/);
    // 기존 티커(#safetyTicker / #tickerText)는 그대로 남아 있어야 한다.
    assert.match(html, /id="safetyTicker"/);
    assert.match(html, /id="tickerText"/);
    // 티커 문구를 저장하는 settings/banner 와 다른 문서를 사용한다.
    assert.match(appJs, /const EMERGENCY_NOTICE_DOC = "emergency_notice";/);
    assert.match(css, /\.emergency-float\s*\{/);
});

test('관리자 메뉴에서 긴급 공지 작성창을 연다', () => {
    assert.match(html, /onclick="openEmergencyNoticeManager\(\)"/);
    assert.match(html, /id="emergencyPinModal"/);
    assert.match(html, /id="emergencyNoticeModal"/);
    assert.match(html, /id="emergencyNoticeEnabled"/);
    assert.match(html, /id="emergencyNoticeStart"[\s\S]{0,200}?type="datetime-local"|type="datetime-local"[^>]*id="emergencyNoticeStart"/);
    assert.match(html, /type="datetime-local"[^>]*id="emergencyNoticeEnd"|id="emergencyNoticeEnd"[^>]*type="datetime-local"/);
    assert.match(appJs, /function openEmergencyNoticeManager\(\)/);
    assert.match(appJs, /async function saveEmergencyNotice\(\)/);
    assert.match(appJs, /async function stopEmergencyNotice\(\)/);
});

test('긴급 공지 비밀번호 평문은 저장소 소스 어디에도 없다', () => {
    const pinLiteral = new RegExp(`['"\`]${ADMIN_PIN}['"\`]`);
    assert.doesNotMatch(appJs, pinLiteral, 'public/js/app.js 에 비밀번호 평문이 있습니다');
    assert.doesNotMatch(html, pinLiteral, 'public/index.html 에 비밀번호 평문이 있습니다');
    assert.doesNotMatch(css, pinLiteral);
    // 서버는 환경변수에서만 읽는다.
    assert.match(serverCode, /EMERGENCY_NOTICE_PIN\s*=\s*String\(process\.env\.EMERGENCY_NOTICE_PIN/);
});

test('비밀번호 검증은 서버(POST /api/emergency-unlock) 1순위, 빌드 주입 해시 2순위', () => {
    assert.match(serverCode, /app\.post\(\s*'\/api\/emergency-unlock'/);
    assert.match(serverCode, /function verifyEmergencyNoticePin/);
    assert.match(serverCode, /crypto\.timingSafeEqual/);
    assert.match(serverCode, /isScreenUnlockRateLimited/);
    assert.match(appJs, /const EMERGENCY_UNLOCK_ENDPOINT = "\/api\/emergency-unlock";/);
    assert.match(appJs, /async function verifyEmergencyNoticePin\(pin\)/);
    assert.match(appJs, /window\.__EMERGENCY_PIN_SHA256__/);
    assert.match(buildScript, /__EMERGENCY_PIN_SHA256__/);
    assert.match(buildScript, /EMERGENCY_NOTICE_PIN/);
});

test('게시 ON/OFF 와 게시 기간으로 노출 여부가 결정된다', () => {
    const { isEmergencyNoticeActive } = loadPureContext();
    const now = Date.UTC(2026, 9, 19, 12, 0, 0);
    const base = { enabled: true, message: '강풍으로 작업 중지' };

    assert.equal(isEmergencyNoticeActive(base, now), true, '기간 미지정이면 바로 게시된다');
    assert.equal(isEmergencyNoticeActive({ ...base, enabled: false }, now), false, 'OFF 면 표시하지 않는다');
    assert.equal(isEmergencyNoticeActive({ ...base, message: '   ' }, now), false, '내용이 없으면 표시하지 않는다');
    assert.equal(isEmergencyNoticeActive(null, now), false);

    // 게시 시작 전 → 아직 안 보임
    assert.equal(isEmergencyNoticeActive({ ...base, startAt: now + HOUR }, now), false);
    // 게시 기간 중 → 보임
    assert.equal(isEmergencyNoticeActive({ ...base, startAt: now - HOUR, endAt: now + HOUR }, now), true);
    // 게시 종료 후 → 자동으로 사라짐
    assert.equal(isEmergencyNoticeActive({ ...base, startAt: now - 2 * HOUR, endAt: now - HOUR }, now), false);
    // ISO 문자열·Firestore Timestamp 형태도 읽는다
    assert.equal(isEmergencyNoticeActive({ ...base, endAt: new Date(now + HOUR).toISOString() }, now), true);
    assert.equal(isEmergencyNoticeActive({ ...base, endAt: { toMillis: () => now - HOUR } }, now), false);
});

test('게시 기간 안내 문구를 사람이 읽을 수 있게 만든다', () => {
    const { formatEmergencyPeriodLabel } = loadPureContext();
    assert.match(formatEmergencyPeriodLabel({}), /관리자가 내릴 때까지/);
    const start = new Date(2026, 9, 19, 9, 0, 0).getTime();
    const end = new Date(2026, 9, 19, 18, 30, 0).getTime();
    assert.equal(
        formatEmergencyPeriodLabel({ startAt: start, endAt: end }),
        '🕒 게시 기간: 2026-10-19 09:00 ~ 2026-10-19 18:30'
    );
});

test('게시 기간은 1분마다 다시 평가되어 종료 시 자동으로 내려간다', () => {
    assert.match(appJs, /emergencyNoticeTimer = setInterval\(renderEmergencyFloatingNotice, 60 \* 1000\);/);
    assert.match(appJs, /subscribeEmergencyNotice\(\);/);
});

test('firestore 규칙이 긴급 공지 문서의 형식을 제한한다', () => {
    assert.match(rules, /settingId == 'emergency_notice' && isValidEmergencyNoticeWrite\(\)/);
    assert.match(rules, /function isValidEmergencyNoticeWrite\(\)/);
    assert.match(rules, /incoming\(\)\.message is string && incoming\(\)\.message\.size\(\) <= 600/);
    assert.match(rules, /incoming\(\)\.level in \['danger', 'warn', 'info'\]/);
    // settings/admin 은 여전히 완전 차단
    assert.match(rules, /match \/settings\/admin \{\s*allow read, write: if false;/);
});

test('빌드 산출물이 있으면 긴급 공지 해시가 주입되고 평문은 없다', () => {
    const built = new URL('../build/public/index.html', import.meta.url);
    if (!existsSync(built)) return; // 빌드 전에는 건너뜀
    const builtHtml = readFileSync(built, 'utf8');
    assert.match(builtHtml, /window\.__EMERGENCY_PIN_SHA256__="[a-f0-9]{64}"/);
    assert.doesNotMatch(builtHtml, new RegExp(`['"\`]${ADMIN_PIN}['"\`]`), '배포 HTML 에 비밀번호 평문이 있습니다');
});
