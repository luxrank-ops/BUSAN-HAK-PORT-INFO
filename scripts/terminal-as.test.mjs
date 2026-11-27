/**
 * 🛠️ 터미널 시설·정비 수리 / A/S 요청 게시판 회귀 테스트 (2026-11-27)
 *
 * 기존 꿍꿍따 끝말잇기 릴레이를 대체한 기능입니다.
 *  · 순수 로직(TerminalAsCore): 터미널 목록, 익명 작성자 생성, 입력 검증, 정규화, 필터, 정렬
 *  · 정적 연결: HTML 카드 마크업, 스크립트/서비스워커 등록, 푸른색 중간톤 CSS,
 *    Firestore 규칙, 카드 라벨/탭 안내, README, 옛 모듈·옛 테스트 제거
 *
 * 화면 흐름(Firestore 스텁으로 접수·필터·오프라인 임시 접수까지)은
 * scripts/terminal-as-flow.test.mjs 가 다룹니다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { APP_ASSET_VERSION, readAppFile, readAppHtml } from './app-source.mjs';

const script = readAppFile('public/js/terminal-as.js');
const html = readAppHtml();
const css = readAppFile('public/css/app.css');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const serviceWorker = readAppFile('public/service-worker.js');
const appJs = readAppFile('public/js/app.js');
const tabViews = readAppFile('public/js/tab-views.js');

/** document 없이 순수 로직만 로드합니다 (init 은 마크업이 없어 조용히 종료됩니다). */
function loadCore() {
    const window = {};
    const context = vm.createContext({ window, console });
    context.window = window;
    context.globalThis = context;
    new vm.Script(script, { filename: 'terminal-as.js' }).runInContext(context);
    return window.TerminalAsCore;
}

const core = loadCore();

test('터미널 목록은 1·2·3항업 9개이며 앱 스케줄 목록과 같은 이름이다', () => {
    assert.equal(core.terminals.length, 9);
    // vm 다른 realm 에서 만든 배열이라 spread 로 같은 realm 배열로 바꿔 비교합니다.
    assert.deepEqual(
        [...core.terminals.map(t => t.id)],
        ['hjnc', 'bnct', 'dgt', 'bct', 'pnc', 'hpnt', 'pnit', 'bptc', 'hbct']
    );
    assert.equal(core.terminalById('hjnc').short, '한진');
    assert.equal(core.terminalById('dgt').short, '동원');
    assert.equal(core.terminalById('unknown'), null);
    assert.equal(core.collection, 'terminal_as_requests');
    assert.equal(core.localKey, 'hakportTerminalAsLocalV1');
});

test('작성자는 입력 없이 터미널 이름 + 마스킹으로 자동 생성되고 글마다 랜덤 코드가 붙는다', () => {
    const hanjin = core.buildAnonymousIdentity('hjnc', () => 0);
    assert.equal(hanjin.author, '한진***');
    assert.equal(hanjin.terminalLabel, '한진(HJNC)');
    assert.match(hanjin.anonCode, /^[A-Z2-9]{4}$/);
    assert.doesNotMatch(hanjin.anonCode, /[01IO]/, '헷갈리는 문자(0/O, 1/I)는 쓰지 않습니다');

    const dongwon = core.buildAnonymousIdentity('dgt', () => 0.999999);
    assert.equal(dongwon.author, '동원***');
    assert.equal(dongwon.terminalLabel, '동원(DGT)');

    // 알 수 없는 터미널이면 첫 터미널로 안전하게 떨어집니다.
    assert.equal(core.buildAnonymousIdentity('nope', () => 0).author, '한진***');
    assert.equal(core.makeAnonCode(() => 0), 'AAAA');
});

test('요청 검증: 터미널·종류·내용(2~500자)을 모두 확인한다', () => {
    const valid = core.validateRequest({ terminalId: 'hjnc', type: 'as', content: '  3번 게이트 조명이 꺼졌어요  ' });
    assert.equal(valid.ok, true);
    assert.equal(valid.terminalId, 'hjnc');
    assert.equal(valid.type, 'as');
    assert.equal(valid.content, '3번 게이트 조명이 꺼졌어요');
    assert.equal(core.validateRequest({ terminalId: '', type: 'as', content: '내용입니다' }).code, 'terminal');
    assert.equal(core.validateRequest({ terminalId: 'hjnc', type: 'nope', content: '내용입니다' }).code, 'type');
    assert.equal(core.validateRequest({ terminalId: 'hjnc', type: 'as', content: '   ' }).code, 'empty');
    assert.equal(core.validateRequest({ terminalId: 'hjnc', type: 'as', content: '가' }).code, 'short');
    assert.equal(core.validateRequest({ terminalId: 'hjnc', type: 'as', content: '가'.repeat(501) }).code, 'long');
    assert.equal(core.validateRequest(null).ok, false);
});

test('문서 정규화·터미널 필터·최신순 정렬·상대 시간이 규칙과 같은 모양으로 동작한다', () => {
    const doc = core.normalizeRequest('r1', {
        terminalId: 'dgt', type: 'repair', content: '크레인 와이어 점검 필요',
        author: '동원***', anonCode: 'B4M8', status: 'processing', createdAtMs: 1000
    });
    assert.equal(doc.terminalLabel, '동원(DGT)');
    assert.equal(doc.typeLabel, '정비·수리');
    assert.equal(doc.statusLabel, '처리 중');
    assert.equal(doc.timestampMs, 1000);
    assert.equal(doc.local, false);

    // Firestore Timestamp 형태(createdAt.toMillis)도 읽습니다.
    const legacy = core.normalizeRequest('r2', {
        terminalId: 'hjnc', type: 'facility', content: '조명 고장', author: '한진***',
        createdAt: { toMillis: () => 2000 }
    });
    assert.equal(legacy.timestampMs, 2000);
    assert.equal(legacy.status, 'received');

    const list = [
        core.normalizeRequest('a', { terminalId: 'hjnc', type: 'as', content: '가나다', author: '한진***', createdAtMs: 10 }),
        core.normalizeRequest('b', { terminalId: 'dgt', type: 'as', content: '라마바', author: '동원***', createdAtMs: 30 }),
        core.normalizeRequest('c', { terminalId: 'hjnc', type: 'as', content: '마바사', author: '한진***', createdAtMs: 20 })
    ];
    assert.deepEqual(core.sortRequests(list).map(x => x.id), ['b', 'c', 'a']);
    assert.deepEqual(core.filterRequests(list, 'hjnc').map(x => x.id), ['a', 'c']);
    assert.equal(core.filterRequests(list, 'all').length, 3);
    assert.equal(core.filterRequests(list, '').length, 3);

    const now = 1_700_000_000_000;
    assert.equal(core.formatRelativeTime(now - 30_000, now), '방금');
    assert.equal(core.formatRelativeTime(now - 5 * 60_000, now), '5분 전');
    assert.equal(core.formatRelativeTime(now - 3 * 3_600_000, now), '3시간 전');
    assert.equal(core.formatRelativeTime(now - 2 * 86_400_000, now), '2일 전');
});

test('HTML 카드: 터미널 선택·종류·내용 입력과 익명 미리보기가 있고 비밀번호 입력이 없다', () => {
    const start = html.indexOf('<div id="safety-card"');
    const end = html.indexOf('<div id="guide-card"', start);
    assert.ok(start >= 0 && end > start, 'safety-card 블록을 찾지 못했습니다');
    const card = html.slice(start, end);
    assert.match(card, /터미널 시설·정비 A\/S 요청/);
    assert.match(card, /id="terminalAsBoard"/);
    assert.match(card, /id="tasTerminalSelect"/, '터미널 선택이 필요합니다');
    assert.match(card, /id="tasTypeSelect"/, '요청 종류 선택이 필요합니다');
    assert.match(card, /id="tasContent"/, '요청 내용 입력이 필요합니다');
    assert.match(card, /id="tasAuthorPreview"/, '자동 생성 작성자 미리보기가 필요합니다');
    assert.match(card, /id="tasAnonCode"/, '랜덤 접수번호 표시가 필요합니다');
    assert.match(card, /id="tasFeed"/);
    assert.match(card, /id="tasFilter"/, '터미널별 보기 칩이 필요합니다');
    assert.match(card, /비밀번호 없음|무비번 접수/);
    assert.doesNotMatch(card, /type="password"|비밀번호 입력|tasPassword/i, '비밀번호 입력이 남아 있으면 안 됩니다');
    assert.doesNotMatch(card, /kkung|꿍꿍|끝말잇기|릴레이/, '옛 릴레이 문구가 남아 있으면 안 됩니다');
});

test('모듈은 Firestore terminal_as_requests 를 실시간 구독하고 익명 인증 후 같은 ID로 저장한다', () => {
    assert.equal(core.collection, 'terminal_as_requests');
    assert.match(script, /orderBy\('createdAtMs', 'desc'\)/);
    assert.match(script, /onSnapshot/);
    assert.match(script, /ensureAsAuth/);
    assert.match(script, /ensureAnonymousAuth/);
    assert.match(script, /\.doc\(docId\)\.set\(toFirestoreDoc\(entry\)\)/);
    assert.match(script, /hakportTerminalAsLocalV1/);
    assert.doesNotMatch(script, /kkung_chain|KkungKkungTtaCore|kkungNick|HANGUL_TRIPLE/);
});

test('블럭 색은 푸른색 중간톤 토큰만 쓰고 옛 릴레이 스타일이 남아 있지 않다', () => {
    assert.match(css, /\.tas-hero \{[^}]*background: linear-gradient\(135deg, var\(--blue-500\), var\(--blue-700\)\)/);
    assert.match(css, /\.tas-submit-button \{[^}]*background: linear-gradient\(135deg, var\(--blue-600\), var\(--blue-800\)\)/);
    assert.match(css, /\.tas-terminal-badge \{[^}]*background: var\(--blue-600\)/);
    assert.doesNotMatch(css, /\.kkung-/, '옛 릴레이 CSS 선택자가 남아 있으면 안 됩니다');
    assert.doesNotMatch(css, /#safety-card \.kkung/);
});

test('Firestore 규칙: 익명 로그인 접수 + 관리자만 수정·삭제, 옛 릴레이 규칙이 없다', () => {
    assert.match(rules, /match \/terminal_as_requests\/\{requestId\} \{/);
    assert.match(rules, /allow get, list: if isSignedIn\(\);/);
    assert.match(rules, /allow create: if isSignedIn\(\) && isValidId\(requestId\) && isValidAsRequest\(incoming\(\)\)/);
    assert.match(rules, /allow update, delete: if isAdmin\(\);/);
    assert.match(rules, /function isValidAsTerminalId\(val\) \{/);
    assert.match(rules, /'hjnc', 'bnct', 'dgt', 'bct', 'pnc', 'hpnt', 'pnit', 'bptc', 'hbct'/);
    assert.match(rules, /data\.content is string && data\.content\.size\(\) >= 2 && data\.content\.size\(\) <= 500/);
    assert.match(rules, /incoming\(\)\.status == 'received'/);
    assert.doesNotMatch(rules, /match \/kkung_chain\//, '옛 릴레이 규칙이 남아 있으면 안 됩니다');
    assert.doesNotMatch(rules, /isValidKkungWord/);
});

test('카드 라벨·탭 안내·README·등록 파일이 새 기능으로 모두 맞는다', () => {
    assert.match(appJs, /\{ id: "safety-card", label: "🛠️ 터미널 시설·정비 A\/S 요청", color: "#2563eb" \}/);
    assert.match(tabViews, /터미널 시설·정비 A\/S 요청 · 현장 실무 용어 가이드/);
    assert.match(readme, /터미널 시설·정비 수리 \/ A\/S 요청/);
    assert.match(readme, /한진\*\*\* · 동원\*\*\*/);
    assert.match(readme, /terminal_as_requests/);
    assert.doesNotMatch(readme, /꿍꿍따|kkung_chain/);
    assert.ok(html.includes(`<script src="./js/terminal-as.js?v=${APP_ASSET_VERSION}"></script>`));
    assert.ok(serviceWorker.includes(`"/js/terminal-as.js?v=${APP_ASSET_VERSION}"`));
    assert.ok(!html.includes('kkung-relay.js'), '옛 모듈 참조가 남아 있으면 안 됩니다');
    assert.ok(!serviceWorker.includes('kkung-relay.js'));
    assert.ok(!existsSync(new URL('../public/js/kkung-relay.js', import.meta.url)), '옛 모듈 파일이 남아 있으면 안 됩니다');
    assert.ok(!existsSync(new URL('./kkung-relay.test.mjs', import.meta.url)), '옛 테스트가 남아 있으면 안 됩니다');
    assert.ok(!existsSync(new URL('./kkung-relay-flow.test.mjs', import.meta.url)), '옛 흐름 테스트가 남아 있으면 안 됩니다');
});
