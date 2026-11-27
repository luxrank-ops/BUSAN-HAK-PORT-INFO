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

test('사진 검증·안전 URL 판별·중복/개수 제한이 안전하게 동작한다', () => {
    assert.equal(core.maxPhotos, 3);
    assert.equal(core.maxPhotoBytes, 10 * 1024 * 1024);
    assert.equal(core.localMineKey, 'hakportTerminalAsMineV1');
    assert.equal(core.isSafePhotoUrl('https://firebasestorage.googleapis.com/v0/b/x/o/p1.jpg'), true);
    assert.equal(core.isSafePhotoUrl('http://localhost:9199/v0/b/x/o/p1.jpg'), true);
    assert.equal(core.isSafePhotoUrl('javascript:alert(1)'), false);
    assert.equal(core.isSafePhotoUrl('data:image/jpeg;base64,abc'), false);

    assert.deepEqual(
        [...core.normalizeImageUrls([
            'https://a.com/1.jpg',
            'javascript:alert(1)',
            'https://a.com/1.jpg',
            'https://a.com/2.jpg',
            'https://a.com/3.jpg',
            'https://a.com/4.jpg'
        ])],
        ['https://a.com/1.jpg', 'https://a.com/2.jpg', 'https://a.com/3.jpg']
    );

    assert.equal(core.validatePhotoFile({ type: 'image/jpeg', size: 1024 }).ok, true);
    assert.equal(core.validatePhotoFile({ name: 'site.webp', type: '', size: 1024 }).ok, true);
    assert.equal(core.validatePhotoFile({ type: 'application/pdf', size: 1024 }).code, 'type');
    assert.equal(core.validatePhotoFile({ type: 'image/png', size: 11 * 1024 * 1024 }).code, 'size');
});

test('문서 정규화·터미널 필터·최신순 정렬·상대 시간이 규칙과 같은 모양으로 동작한다', () => {
    const doc = core.normalizeRequest('r1', {
        terminalId: 'dgt', type: 'repair', content: '크레인 와이어 점검 필요',
        author: '동원***', authorUid: 'uid-1', anonCode: 'B4M8', status: 'processing',
        imageUrls: ['https://a.com/1.jpg', 'javascript:alert(1)'],
        createdAtMs: 1000, updatedAtMs: 1500
    });
    assert.equal(doc.terminalLabel, '동원(DGT)');
    assert.equal(doc.typeLabel, '정비·수리');
    assert.equal(doc.statusLabel, '처리 중');
    assert.equal(doc.authorUid, 'uid-1');
    assert.deepEqual([...doc.imageUrls], ['https://a.com/1.jpg']);
    assert.equal(doc.updatedAtMs, 1500);
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
    assert.equal(core.isRecentPost(now - 30_000, now), true);
    assert.equal(core.isRecentPost(now - 23 * 3_600_000, now), true);
    assert.equal(core.isRecentPost(now - 25 * 3_600_000, now), false);
    assert.equal(core.isRecentPost(0, now), false);
    assert.equal(core.formatRelativeTime(now - 30_000, now), '방금');
    assert.equal(core.formatRelativeTime(now - 5 * 60_000, now), '5분 전');
    assert.equal(core.formatRelativeTime(now - 3 * 3_600_000, now), '3시간 전');
    assert.equal(core.formatRelativeTime(now - 2 * 86_400_000, now), '2일 전');
});

test('좋아요·댓글 검증 및 정규화가 안전하게 동작한다', () => {
    assert.equal(core.statusLabels.done, '조치완료');
    assert.equal(core.maxComment, 300);

    assert.equal(core.validateComment('   ').code, 'empty');
    assert.equal(core.validateComment('가'.repeat(301)).code, 'long');
    assert.equal(core.validateComment('  확인했습니다  ').content, '확인했습니다');

    const likes = core.normalizeLikedBy({ 'u-1': true, 'u-2': 'invalid', '': true });
    assert.deepEqual({ ...likes }, { 'u-1': true });
    assert.equal(core.countLikes(likes), 1);
    assert.equal(core.isLikedByUid(likes, 'u-1'), true);
    assert.equal(core.isLikedByUid(likes, 'u-2'), false);

    const req = core.normalizeRequest('r10', {
        terminalId: 'hjnc', type: 'as', content: '완료된 요청입니다',
        status: 'done', resolvedAtMs: 5000, likedBy: { 'u-1': true, 'u-2': true }, commentCount: 3,
        createdAtMs: 1000
    });
    assert.equal(req.statusLabel, '조치완료');
    assert.equal(req.resolvedAtMs, 5000);
    assert.equal(req.likeCount, 2);
    assert.equal(req.commentCount, 3);

    const cmt = core.normalizeComment('c1', 'r10', {
        content: '처리 완료했습니다', author: '한진***', anonCode: 'A2B3',
        authorUid: 'u-1', likedBy: { 'u-2': true }, createdAtMs: 2000
    });
    assert.equal(cmt.requestId, 'r10');
    assert.equal(cmt.likeCount, 1);
    assert.equal(cmt.content, '처리 완료했습니다');
});

test('HTML 카드: 터미널 A/S 요청과 생활영어 한문장 배치가 서로 바뀌었고 비밀번호 입력이 없다', () => {
    const noticeIdx = html.indexOf('<div id="notice-card"');
    const safetyIdx = html.indexOf('<div id="safety-card"');
    const boardIdx = html.indexOf('<div id="board-card"');
    const weatherIdx = html.indexOf('<div id="weather-card"');
    const englishIdx = html.indexOf('<div id="daily-field-english-card"');
    const guideIdx = html.indexOf('<div id="guide-card"');

    assert.ok(noticeIdx >= 0 && safetyIdx > noticeIdx && boardIdx > safetyIdx, 'safety-card 는 공지사항 다음, 왁자지껄 앞에 있어야 합니다');
    assert.ok(weatherIdx >= 0 && englishIdx > weatherIdx && guideIdx > englishIdx, '생활영어 한문장은 날씨 다음, 용어가이드 앞에 있어야 합니다');

    const card = html.slice(safetyIdx, boardIdx);
    assert.match(card, /터미널 시설·정비 A\/S 요청/);
    assert.match(card, /id="tasBadge"/, '새 게시물 NEW 배지가 필요합니다');
    assert.match(card, /id="tasCardSubMeta"/, '새 게시물 건수 안내 문구 영역이 필요합니다');
    assert.match(card, /id="terminalAsBoard"/);
    assert.match(card, /id="tasEditBanner"/, '수정 안내 배너가 필요합니다');
    assert.match(card, /id="tasCancelEdit"/, '수정 취소 버튼이 필요합니다');
    assert.match(card, /id="tasTerminalSelect"/, '터미널 선택이 필요합니다');
    assert.match(card, /id="tasTypeSelect"/, '요청 종류 선택이 필요합니다');
    assert.match(card, /id="tasContent"/, '요청 내용 입력이 필요합니다');
    assert.match(card, /id="tasPhotoInput"/, '사진 첨부 입력이 필요합니다');
    assert.match(card, /id="tasPhotoPreview"/, '사진 미리보기 영역이 필요합니다');
    assert.match(card, /id="tasAuthorPreview"/, '자동 생성 작성자 미리보기가 필요합니다');
    assert.match(card, /id="tasAnonCode"/, '랜덤 접수번호 표시가 필요합니다');
    assert.match(card, /id="tasFeed"/);
    assert.match(card, /id="tasFilter"/, '터미널별 보기 칩이 필요합니다');
    assert.match(card, /비밀번호 없음|무비번 접수/);
    assert.doesNotMatch(card, /type="password"|비밀번호 입력|tasPassword/i, '비밀번호 입력이 남아 있으면 안 됩니다');
    assert.doesNotMatch(card, /kkung|꿍꿍|끝말잇기|릴레이/, '옛 릴레이 문구가 남아 있으면 안 됩니다');
});

test('모듈은 Firestore terminal_as_requests 와 Storage terminal-as 를 연동하고 수정·삭제·조치완료·댓글·좋아요를 지원한다', () => {
    assert.equal(core.collection, 'terminal_as_requests');
    assert.match(script, /orderBy\('createdAtMs', 'desc'\)/);
    assert.match(script, /onSnapshot/);
    assert.match(script, /ensureAsAuth/);
    assert.match(script, /ensureAnonymousAuth/);
    assert.match(script, /\.doc\(docId\)\.set\(toFirestoreDoc\(onlineEntry\)\)/);
    assert.match(script, /\.doc\(targetId\)\.update\(/);
    assert.match(script, /\.doc\(entry\.id\)\.delete\(\)/);
    assert.match(script, /resolveAsRequest/);
    assert.match(script, /togglePostLike/);
    assert.match(script, /submitComment/);
    assert.match(script, /toggleCommentLike/);
    assert.match(script, /terminal-as\//);
    assert.match(script, /hakportTerminalAsLocalV1/);
    assert.match(script, /hakportTerminalAsMineV1/);
    assert.doesNotMatch(script, /kkung_chain|KkungKkungTtaCore|kkungNick|HANGUL_TRIPLE/);
});

test('블럭 색은 반짝이는 푸른색 중간톤 토큰만 쓰고 옛 릴레이 스타일이 남아 있지 않다', () => {
    assert.match(css, /#safety-card \{[^}]*animation: tasCardGlow/);
    assert.match(css, /#safety-card::after \{[^}]*animation: tasCardShine/);
    assert.match(css, /#safety-card > \.dash-header,[\s\S]*?linear-gradient\(125deg, var\(--blue-500\), var\(--blue-600\), var\(--sky-600\), var\(--blue-500\)\)/);
    assert.match(css, /\.tas-hero \{[^}]*background: linear-gradient\(135deg, var\(--blue-500\), var\(--blue-600\), var\(--sky-600\), var\(--blue-700\)\)/);
    assert.match(css, /\.tas-hero::before \{[^}]*animation: tasCardShine/);
    assert.match(css, /@keyframes tasBlockShimmer/);
    assert.match(css, /@keyframes tasCardGlow/);
    assert.match(css, /@keyframes tasCardShine/);
    assert.match(css, /\.tas-item-btn\.is-resolve/);
    assert.match(css, /\.tas-like-btn\.is-liked/);
    assert.match(css, /\.tas-comments-panel/);
    assert.match(css, /\.tas-card-new-badge/);
    assert.match(css, /\.tas-submit-button \{[^}]*background: linear-gradient\(135deg, var\(--blue-600\), var\(--blue-800\)\)/);
    assert.match(css, /\.tas-terminal-badge \{[^}]*background: var\(--blue-600\)/);
    assert.doesNotMatch(css, /\.kkung-/, '옛 릴레이 CSS 선택자가 남아 있으면 안 됩니다');
    assert.doesNotMatch(css, /#safety-card \.kkung/);
});

test('Firestore 규칙: 익명 로그인 접수·사진 3장·본인 수정/삭제·누구나 조치완료·좋아요·댓글 허용, 옛 릴레이 규칙이 없다', () => {
    assert.match(rules, /match \/terminal_as_requests\/\{requestId\} \{/);
    assert.match(rules, /allow get, list: if isSignedIn\(\);/);
    assert.match(rules, /allow create: if isSignedIn\(\) && isValidId\(requestId\) && isValidAsRequest\(incoming\(\)\)/);
    assert.match(rules, /allow update: if isSignedIn\(\) && isValidId\(requestId\) && \(\s*isAdmin\(\) \|\|\s*isValidAsAuthorUpdate\(\) \|\|\s*isValidAsResolveUpdate\(\) \|\|\s*isValidAsLikeToggle\(\) \|\|\s*isValidAsCommentCountChange\(\)\s*\);/);
    assert.match(rules, /allow delete: if isAdmin\(\) \|\| isAsAuthor\(\);/);
    assert.match(rules, /match \/comments\/\{commentId\} \{/);
    assert.match(rules, /function isAsAuthor\(\) \{/);
    assert.match(rules, /function isValidAsTerminalId\(val\) \{/);
    assert.match(rules, /'hjnc', 'bnct', 'dgt', 'bct', 'pnc', 'hpnt', 'pnit', 'bptc', 'hbct'/);
    assert.match(rules, /function isValidAsImageUrls\(data\) \{/);
    assert.match(rules, /function isValidAsAuthorUpdate\(\) \{/);
    assert.match(rules, /function isValidAsResolveUpdate\(\) \{/);
    assert.match(rules, /function isValidAsLikeToggle\(\) \{/);
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
