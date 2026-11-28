import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { APP_ASSET_VERSION, readAppHtml, readAppFile } from './app-source.mjs';

// 📢 주소 이전 안내(2026-11-28 개정) 회귀 방지
// - 옛 주소(vercel.app) 접속자 : 상단 배너 + **닫기가 없는** 고정 안내창(12월 1일 종료)
// - 새 주소(workers.dev) 접속자 : 홈 화면 추가 권장 배너만 (고정창 절대 없음)
// - 도메인 판별·고정창 표시는 public/js/domain-migration.js 가 담당합니다.

const html = readAppHtml();
const js = readAppFile('public/js/domain-migration.js');
const css = readAppFile('public/css/app.css');
const sw = readAppFile('public/service-worker.js');

const NEW_HOST = 'busan-hak-port-info.luxrank.workers.dev';
const NEW_ORIGIN = `https://${NEW_HOST}`;
const LEGACY_HOST = 'busan-hak-port-info.vercel.app';

test('상단 공지 배너와 고정 안내창 마크업이 index.html 에 있다', () => {
    ['migrationNoticeBar', 'migrationBarTitle', 'migrationBarClose', 'migrationBarAction',
        'migrationModal', 'migrationModalTitle', 'migrationGoBtn', 'migrationCopyBtn'].forEach((id) => {
        assert.ok(html.includes(`id="${id}"`), `#${id} 가 index.html 에 없습니다`);
    });
    // 고정창은 처음에 숨김 상태로 시작해야 합니다(도메인 판별 후 JS 가 엽니다).
    assert.match(html, /id="migrationModal"[^>]*style="display:none;"/, '고정창 초기 상태는 display:none 이어야 합니다');
    assert.match(html, /id="migrationModal"[^>]*role="dialog"/, '고정창에 role="dialog" 가 필요합니다');
});

test('고정 안내창에는 닫기 수단(✕ · 닫기 · 오늘 하루 보지 않기)이 없다', () => {
    ['migrationModalClose', 'migrationCloseBtn', 'migrationHideToday'].forEach((id) => {
        assert.ok(!html.includes(`id="${id}"`), `옛 주소 고정창에 닫기 수단 #${id} 이 남아 있습니다`);
    });
    const modal = html.slice(html.indexOf('id="migrationModal"'), html.indexOf('id="imageModal"'));
    assert.ok(!modal.includes('✕'), '고정창에 ✕ 닫기 버튼이 있습니다');
    assert.ok(!modal.includes('오늘 하루 보지 않기'), "고정창에 '오늘 하루 보지 않기'가 있습니다");
    assert.ok(!js.includes('hakportMigrationPopupHideUntil'), '팝업 닫힘 상태 키가 남아 있습니다');
});

test('안내 문구에 새 주소·옛 주소·12월 1일 종료·새 주소 재설치 안내가 들어 있다', () => {
    assert.ok(html.includes(NEW_HOST), '새 주소가 마크업에 없습니다');
    assert.ok(html.includes(LEGACY_HOST), '옛 주소가 마크업에 없습니다');
    assert.ok(html.includes('2026년 12월 1일(화)'), '옛 주소 종료일(12월 1일)이 없습니다');
    assert.ok(!html.includes('12월 20일'), '옛 종료일(12월 20일) 문구가 남아 있습니다');
    assert.ok(html.includes('그대로 유지'), '기존 기록 유지 안내가 없습니다');
    assert.ok(html.includes('홈 화면에 추가(앱 설치)'), '새 주소 홈 화면 재설치 안내가 없습니다');
    assert.ok(html.includes('새 주소로 다시 설치'), '새 주소로 다시 설치 안내가 없습니다');
});

test('배너 닫힘 상태만 localStorage 에 저장한다', () => {
    assert.match(js, /localStorage\.setItem/);
    assert.match(js, /hakportMigrationBarHideUntil/, '배너 닫힘 키가 없습니다');
    assert.match(js, /setHours\(23, 59, 59/, "'오늘 하루'는 자정까지 유지되어야 합니다");
});

test('새 주소·개발 호스트에서는 고정창을 띄우지 않는다', () => {
    assert.ok(js.includes('workers.dev'), 'workers.dev 호스트 판별이 없습니다');
    assert.ok(js.includes('if (isNewHost() || !isLegacyHost())'), '새 주소·비옛주소 조기 반환이 없습니다');
    assert.ok(js.indexOf('if (isNewHost() || !isLegacyHost())') < js.indexOf('openLockModal();'), '고정창 호출 순서가 잘못되었습니다');
    // 닫기 관련 처리(키다운·배경 클릭)가 남아 있으면 안 됩니다.
    assert.ok(!/popupClose|addEventListener\('keydown'/.test(js), '고정창을 닫는 이벤트 처리가 남아 있습니다');
});

test('주소 복사는 클립보드 API 실패 시 폴백을 쓴다', () => {
    assert.match(js, /navigator\.clipboard\.writeText/);
    assert.match(js, /execCommand\('copy'\)/);
});

test('모듈이 버전 쿼리와 함께 로드되고 프리캐시에 포함된다', () => {
    assert.ok(html.includes(`<script src="./js/domain-migration.js?v=${APP_ASSET_VERSION}"></script>`), 'HTML 로드 태그');
    assert.ok(sw.includes(`"/js/domain-migration.js?v=${APP_ASSET_VERSION}"`), '서비스 워커 프리캐시');
});

test('배너·고정창 스타일이 토큰만 참조한다(원시 색상값 없음)', () => {
    const block = css.slice(css.indexOf('.migration-bar {'));
    assert.ok(block.length > 0, '주소 이전 안내 CSS 가 없습니다');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), 'CSS 에 하드코딩 색상값이 있습니다');
});

test('고정창은 긴급 공지·날씨 카드보다 위 레이어에 있다', () => {
    const modalZ = Number((css.match(/--z-modal:\s*(\d+)/) || [])[1]);
    const lockZ = Number((css.match(/--z-modal-lock:\s*(\d+)/) || [])[1]);
    assert.ok(modalZ > 0 && lockZ > 0, 'z-index 토큰이 없습니다');
    assert.ok(lockZ > modalZ, '고정창 z-index 가 일반 모달보다 위여야 합니다');
    assert.match(css, /\.migration-modal \{[^}]*z-index: var\(--z-modal-lock\)/);
});

/* ── 호스트별 동작: 가짜 DOM 으로 실제 스크립트를 실행해 확인 ────────────── */
function runMigrationScript(hostname, options = {}) {
    const elements = new Map();
    const makeClassList = () => {
        const set = new Set();
        return {
            set,
            add: (c) => set.add(c),
            remove: (c) => set.delete(c),
            contains: (c) => set.has(c),
            toggle: (c, force) => {
                if (force === undefined) { if (set.has(c)) set.delete(c); else set.add(c); }
                else if (force) set.add(c);
                else set.delete(c);
            }
        };
    };
    const makeEl = (id) => {
        const node = {
            id,
            textContent: '',
            href: '',
            style: {},
            attrs: {},
            listeners: {},
            classList: makeClassList(),
            setAttribute: (k, v) => { node.attrs[k] = String(v); },
            getAttribute: (k) => node.attrs[k],
            addEventListener: (type, fn) => { (node.listeners[type] = node.listeners[type] || []).push(fn); },
            focus: () => { node.focused = true; },
            contains: (target) => target === node
        };
        elements.set(id, node);
        return node;
    };
    ['migrationNoticeBar', 'migrationBarTitle', 'migrationBarDesc', 'migrationBarAction', 'migrationBarClose',
        'migrationModal', 'migrationModalTitle', 'migrationGoBtn', 'migrationCopyBtn'].forEach(makeEl);

    const body = { classList: makeClassList() };
    const docListeners = {};
    const storage = { ...(options.storage || {}) };
    const timeouts = [];
    const location = {
        hostname,
        pathname: options.pathname || '/',
        search: options.search || '',
        hash: options.hash || ''
    };
    const sandbox = {
        window: {
            location,
            setTimeout: (fn) => { timeouts.push(fn); return 0; }
        },
        document: {
            readyState: 'complete',
            body,
            getElementById: (id) => elements.get(id) || null,
            addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
            createElement: () => ({ style: {}, setAttribute: () => {} })
        },
        navigator: {},
        localStorage: {
            getItem: (k) => (k in storage ? storage[k] : null),
            setItem: (k, v) => { storage[k] = String(v); }
        }
    };
    vm.runInNewContext(js, sandbox, { filename: 'domain-migration.js' });
    return { elements, body, docListeners, storage, timeouts };
}

test('옛 주소(vercel.app) 접속 → 닫기 없는 고정창이 즉시 열리고 새 주소로 유도한다', () => {
    const run = runMigrationScript(LEGACY_HOST, { pathname: '/wage', search: '?tab=log', hash: '#today' });
    const modal = run.elements.get('migrationModal');
    const go = run.elements.get('migrationGoBtn');
    assert.equal(modal.style.display, 'flex', '옛 주소에서 고정창이 열려야 합니다');
    assert.equal(modal.getAttribute('aria-hidden'), 'false');
    assert.ok(modal.classList.contains('is-locked'), '고정창 잠금 클래스가 없습니다');
    assert.ok(run.body.classList.contains('migration-locked'), '뒤 화면 스크롤 잠금이 없습니다');
    assert.equal(go.href, `${NEW_ORIGIN}/wage?tab=log#today`, '지금 경로·쿼리·해시를 그대로 넘겨야 합니다');
    assert.equal(run.elements.get('migrationBarAction').href, `${NEW_ORIGIN}/wage?tab=log#today`);
    // 닫기 수단이 하나도 없어야 합니다: ✕·배경 클릭·ESC 어느 것도 고정창을 닫지 않습니다.
    assert.equal(modal.listeners.click, undefined, '고정창 배경 클릭 처리가 남아 있습니다');
    assert.equal(run.docListeners.keydown, undefined, 'ESC 키 처리가 남아 있습니다');
    assert.equal(modal.listeners.keydown, undefined);
});

test("옛 주소 접속 → '오늘 하루 보지 않기' 흔적이 있어도 고정창은 그대로 뜬다", () => {
    const future = String(Date.now() + 24 * 60 * 60 * 1000);
    const run = runMigrationScript(LEGACY_HOST, {
        storage: { hakportMigrationPopupHideUntil: future, hakportMigrationBarHideUntil: future }
    });
    assert.equal(run.elements.get('migrationModal').style.display, 'flex', '저장값 때문에 고정창이 숨으면 안 됩니다');
    // 배너만 저장값대로 접혀 있습니다.
    assert.ok(run.elements.get('migrationNoticeBar').classList.contains('is-hidden'));
});

test('새 주소(workers.dev) 접속 → 고정창 없이 홈 화면 추가 배너만 보인다', () => {
    const run = runMigrationScript(NEW_HOST);
    const modal = run.elements.get('migrationModal');
    assert.equal(modal.style.display, 'none', '새 주소에서는 고정창이 뜨면 안 됩니다');
    assert.ok(!modal.classList.contains('is-locked'));
    assert.ok(!run.body.classList.contains('migration-locked'), '새 주소에서 화면이 잠기면 안 됩니다');
    assert.equal(run.elements.get('migrationBarTitle').textContent, '✅ 새 주소로 접속 중입니다');
    assert.ok(run.elements.get('migrationBarAction').classList.contains('is-hidden'), '새 주소에서는 이동 버튼을 숨깁니다');
    assert.ok(!run.elements.get('migrationNoticeBar').classList.contains('is-hidden'));
});

test('개발용 호스트(localhost) → 고정창 없이 안내 배너만 보인다', () => {
    const run = runMigrationScript('localhost');
    assert.equal(run.elements.get('migrationModal').style.display, 'none');
    assert.ok(!run.body.classList.contains('migration-locked'));
    assert.ok(!run.elements.get('migrationNoticeBar').classList.contains('is-hidden'));
    assert.equal(run.elements.get('migrationBarAction').href, `${NEW_ORIGIN}/`);
});

test('알 수 없는 호스트(미리보기)도 화면을 잠그지 않는다', () => {
    const run = runMigrationScript('hakport-preview.example.com');
    assert.equal(run.elements.get('migrationModal').style.display, 'none');
    assert.ok(!run.body.classList.contains('migration-locked'));
});

test('비상용 보조 호스팅(web.app)은 잠그지 않는다 — 장애 시 대체 접속 경로 보존', () => {
    const run = runMigrationScript('busan-hak-port.web.app');
    assert.equal(run.elements.get('migrationModal').style.display, 'none');
    assert.ok(!run.body.classList.contains('migration-locked'));
});
