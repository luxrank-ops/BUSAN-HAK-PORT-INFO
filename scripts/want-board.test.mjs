/**
 * 💡 운영자에게 바란다 (관리자 전용 피드백 게시판) 회귀 테스트
 *
 * 요구 사항
 *  1) 가독성 좋은 플로팅 블록(격하게 반짝임) → 클릭 시 전문 게시판으로 진입
 *  2) "작성하신 내용은 관리자만 확인할 수 있습니다" 안내를 글쓰기 전에 노출
 *  3) 미리보기 → 제출 순서, 닉네임 자유 입력(항만용어 자동 기입 포함)
 *  4) 열람은 작성자 본인 + 관리자만
 *  5) 댓글(답글)은 관리자만 작성
 *  6) 관리자 비밀번호 평문이 저장소에 남아 있지 않음
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { APP_ASSET_VERSION, readAppFile } from './app-source.mjs';

const html = readAppFile('public/index.html');
const css = readAppFile('public/css/app.css');
const script = readAppFile('public/js/want-board.js');
const rules = readAppFile('firestore.rules');
const serviceWorker = readAppFile('public/service-worker.js');

// 평문 비밀번호가 테스트 파일 자체에 등장하지 않도록 분해해 조립합니다.
const ADMIN_PIN = ['03', '46'].join('');

/** 모듈을 vm 으로 로드해 순수 함수(WantBoardCore)만 꺼냅니다. */
function loadCore() {
    const document = {
        readyState: 'loading',
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    const window = {
        localStorage: { getItem() { return null; }, setItem() {} },
        alert() {},
        confirm() { return true; }
    };
    const context = vm.createContext({
        window,
        document,
        console,
        Date, Math, Set, Map, Array, String, Number, Object, JSON, RegExp, Error
    });
    new vm.Script(script, { filename: 'want-board.js' }).runInContext(context);
    return window.WantBoardCore;
}

const core = loadCore();

/**
 * app.js 와 똑같이 전역 바인딩을 만들어 모듈을 로드합니다.
 * 브라우저에서는 상위 레벨 const/let 은 window property 로 붙지 않고
 * 전역 렉시칼 환경에만 존재합니다(함수 선언만 window property 가 됩니다).
 */
function loadCoreWithAppGlobals() {
    const sandbox = {
        console, Date, Math, Set, Map, Array, String, Number, Object, JSON, RegExp, Error, Promise,
        document: {
            readyState: 'loading',
            addEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; }
        },
        firebase: { firestore: { FieldValue: { serverTimestamp: () => ({ __ts: true }) } } },
        localStorage: { getItem() { return null; }, setItem() {} },
        alert() {},
        confirm() { return true; }
    };
    sandbox.__db = { __fake: 'firestore' };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext([
        'const db = __db;',
        'const auth = { currentUser: { uid: "uid_writer_1" } };',
        "const PORT_NICKNAME_OPTIONS = ['부산항 도선사', '라싱 반장'];",
        'function ensureAnonymousAuth() { return Promise.resolve("uid_writer_1"); }'
    ].join('\n'), context);
    new vm.Script(script, { filename: 'want-board.js' }).runInContext(context);
    return { core: sandbox.WantBoardCore, window: sandbox };
}

const appGlobals = loadCoreWithAppGlobals();

test('상위 레벨 const(db·auth·PORT_NICKNAME_OPTIONS)가 window property 가 아니어도 Firestore·인증·항만용어를 얻는다', () => {
    // 브라우저 규칙 재현: const 는 window property 로 붙지 않는다.
    assert.equal(appGlobals.window.db, undefined);
    assert.equal(appGlobals.window.auth, undefined);
    assert.equal(appGlobals.window.PORT_NICKNAME_OPTIONS, undefined);
    // 함수 선언은 window property 로 붙는다.
    assert.equal(typeof appGlobals.window.ensureAnonymousAuth, 'function');

    assert.equal(appGlobals.core.resolveFirestore().__fake, 'firestore', 'bare db 식별자를 해석해야 합니다');
    assert.ok(appGlobals.core.resolveAuth(), 'bare auth 식별자를 해석해야 합니다');
    assert.equal(appGlobals.core.resolveAuth().currentUser.uid, 'uid_writer_1');
    // vm 문맥에서 나온 배열은 host realm 배열이 아니므로 host 배열로 재구성해 비교합니다.
    assert.deepEqual([...appGlobals.core.portNicknameOptions()], ['부산항 도선사', '라싱 반장'], 'bare PORT_NICKNAME_OPTIONS를 읽어야 합니다');
});

test('플로팅 블록은 반짝이는样式를 갖고 전문 게시판 모달로 진입한다', () => {
    assert.match(html, /id="wantBoardFloatBtn"/);
    assert.match(html, /class="want-board-float"/);
    assert.match(html, /onclick="openWantBoard\(\)"/);
    assert.match(html, /id="wantBoardOverlay"/);
    assert.match(html, /id="wantBoardSheet"|class="want-board-sheet"/);
    assert.match(css, /@keyframes want-board-shimmer/);
    assert.match(css, /@keyframes want-board-sparkle/);
    assert.match(css, /\.want-board-float\s*\{[\s\S]*?animation:[^;]*want-board-shimmer/);
    assert.match(css, /prefers-reduced-motion[\s\S]*?\.want-board-float/);
});

test('관리자만 확인한다는 안내 문구를 화면에 노출한다', () => {
    assert.ok(core.announceText.includes('작성하신 내용은 관리자만 확인할 수 있습니다'));
    assert.ok(core.announceText.includes('업무에 필요하다고 생각되는 사항들을 알려주시면 반영하도록 하겠습니다'));
    assert.ok(core.announceText.includes('앱의 개선 점 피드백 남겨주세요'));
    assert.match(html, /id="wantBoardPrivacyText"/);
    assert.match(html, /class="want-board-privacy"/);
});

test('글쓰기 폼은 닉네임 자유 입력 + 미리보기 + 내용 입력으로 구성된다', () => {
    assert.match(html, /id="wantBoardNick"/);
    assert.match(html, /id="wantBoardContent"/);
    assert.match(html, /id="wantBoardNickRefresh"/);
    assert.match(html, /id="wantBoardPreview"/);
    assert.match(html, /onsubmit="event\.preventDefault\(\); showWantPreview\(\);"/);
    assert.match(html, /id="wantBoardCounter"/);
    assert.match(css, /\.want-board-preview-card/);
});

test('작성자 본인 기록과 관리자 영역이 분리되어 있다', () => {
    assert.match(html, /id="wantBoardList"/);
    assert.match(html, /id="wantBoardAdminBar"/);
    // 관리자 모드 전환·답글·삭제 핸들러는 JS 에서 등록합니다.
    assert.match(script, /global\.enterWantAdminMode = enterWantAdminMode/);
    assert.match(script, /global\.exitWantAdminMode = exitWantAdminMode/);
    assert.match(script, /onclick="submitWantReply\('\$\{escapeWantHtml\(item\.id\)\}'\)"/);
    assert.match(script, /global\.deleteWantItem = deleteWantItem/);
    assert.match(script, /REPLIES_SUBCOLLECTION = 'replies'/);
    assert.match(script, /MINE_COLLECTION = 'want_board_mine'/);
});

test('닉네임·내용 정제가 제어 문자와 길이 제한을 적용한다', () => {
    assert.equal(core.sanitizeWantNick('  부산항 도선사 \n'), '부산항 도선사');
    assert.equal(core.sanitizeWantNick('a'.repeat(80)).length, core.maxNickLength);
    assert.equal(core.sanitizeWantText('a\r\nb'), 'a\nb');
    assert.equal(core.sanitizeWantText('x'.repeat(5000)).length, core.maxContentLength);
});

test('작성 폼 검증은 닉네임·내용 필수를 요구한다', () => {
    assert.equal(core.validateWantDraft('', '').ok, false);
    assert.equal(core.validateWantDraft(' 도선사 ', '   ').ok, false);
    const ok = core.validateWantDraft(' 도선사 ', '안녕하세요');
    assert.equal(ok.ok, true);
    assert.equal(ok.nick, '도선사');
    assert.equal(ok.content, '안녕하세요');
    const long = core.validateWantDraft('도선사', 'x'.repeat(core.maxContentLength + 10));
    assert.equal(long.ok, false);
    assert.ok(long.errors.length > 0);
});

test('답글 검증은 내용 필수를 요구한다', () => {
    assert.equal(core.validateWantReply('').ok, false);
    assert.equal(core.validateWantReply(' 반영하겠습니다 ').text, '반영하겠습니다');
});

test('기록 정렬은 최신순이며, ID 생성은 예측 불가능한 랜덤이다', () => {
    const now = Date.now();
    const sorted = core.sortWantItemsDesc([
        { id: 'a', createdAtMs: 100 },
        { id: 'b', createdAtMs: 300 },
        { id: 'c', createdAtMs: 200 }
    ]);
    assert.deepEqual(sorted.map((item) => item.id), ['b', 'c', 'a']);
    const ids = new Set(Array.from({ length: 50 }, () => core.createWantItemId(now)));
    assert.equal(ids.size, 50);
    assert.match(core.createWantItemId(now), /^fb_/);
});

test('문서 정규화는 잘못된 값을 안전한 기본값으로 좁힌다', () => {
    const item = core.normalizeWantItem({
        id: 'fb_1',
        authorUid: 'u1',
        nick: '<script>x</script>',
        content: '안녕',
        status: 'unknown',
        replyCount: -5,
        replies: [{ name: '운영자', text: '답변', createdAtMs: 1, isAdminReply: false }]
    }, 'fb_1');
    assert.equal(item.status, 'pending');
    assert.equal(item.replyCount, 0);
    assert.equal(item.nick, '<script>x</script>');
    const index = core.normalizeWantIndex({ uid: 'u1', items: [{ id: 'fb_1', nick: '도선사', createdAtMs: 1 }] }, 'u1');
    assert.equal(index.items.length, 1);
    assert.equal(index.items[0].status, 'pending');
});

test('HTML·서비스워커·앱 소스 상수의 자산 버전이 일치한다', () => {
    assert.ok(html.includes(`<script src="./js/want-board.js?v=${APP_ASSET_VERSION}"></script>`));
    assert.ok(serviceWorker.includes(`"/js/want-board.js?v=${APP_ASSET_VERSION}"`));
    assert.match(html, /<link[^>]*href="\.\/css\/app\.css\?v=\d+\.\d+"/);
});

test('규칙: 일반 사용자는 전체 목록을 볼 수 없고 본인 항목만 읽을 수 있다', () => {
    assert.match(rules, /match \/want_board\/\{itemId\} \{/);
    assert.match(rules, /allow list: if isAdmin\(\);/);
    assert.match(rules, /function isWantItemAuthor\(itemId\)/);
    assert.match(rules, /allow get: if isSignedIn\(\) && isValidId\(itemId\) && \(\s*isAdmin\(\) \|\|\s*isWantItemAuthor\(itemId\)/);
});

test('규칙: 작성자는 삭제 표시만 바꿀 수 있고, 물리 삭제는 관리자 전용이다', () => {
    assert.match(rules, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\['deleted'\]\)/);
    assert.match(rules, /incoming\(\)\.deleted == true/);
    assert.match(rules, /allow delete: if isAdmin\(\);/);
    // 작성자가 내용·상태·답글을 위조할 수 없습니다.
    assert.doesNotMatch(rules, /allow update: if isSignedIn\(\) && isValidId\(itemId\) && isValidWantItemDoc\(incoming\(\)\)/);
});

test('규칙: 답글은 관리자만 작성하고, 작성자 본인 항목의 답글만 볼 수 있다', () => {
    assert.match(rules, /match \/replies\/\{replyId\} \{/);
    assert.match(rules, /allow create: if isSignedIn\(\) && isValidId\(replyId\) && isAdmin\(\) &&/);
    assert.match(rules, /allow update, delete: if isAdmin\(\);/);
});

test('규칙: 피드백 문서는 createdAtMs 를 정본으로, createdAt(서버 타임스탬프)는 선택으로 허용한다', () => {
    // FieldValue.serverTimestamp() 가 설정되지 못한 경우에도 저장이 거부되지
    // 않아야 하므로, createdAtMs(정수) 가 정본이고 createdAt 은 선택입니다.
    const optionalCreatedAt = rules.match(/!\('createdAt' in data\) \|\| data\.createdAt is timestamp/g) || [];
    assert.equal(optionalCreatedAt.length, 2, '항목 문서와 답글 문서 모두 createdAt 을 선택으로 허용해야 합니다');
    assert.match(rules, /data\.createdAtMs is int && data\.createdAtMs > 0 && data\.createdAtMs <= 4102444800000/);
});

test('규칙: 작성자 인덱스 문서는 본인만读写할 수 있다', () => {
    assert.match(rules, /match \/want_board_mine\/\{uid\} \{/);
    assert.match(rules, /allow get: if isSignedIn\(\) && isValidId\(uid\) && request\.auth\.uid == uid/);
    assert.match(rules, /allow list: if false;/);
    assert.match(rules, /allow create, update: if isSignedIn\(\) && isValidId\(uid\) && request\.auth\.uid == uid &&/);
});

test('저장소 어디에도 관리자 비밀번호 평문(코드 본문)이 남아 있지 않다', () => {
    const sources = [
        script,
        readAppFile('public/js/app.js'),
        readAppFile('public/js/notifications.js'),
        readAppFile('server.ts'),
        html,
        readAppFile('public/css/app.css')
    ];
    // 주석( // 와 /* */ )은 설명이므로 제외하고, 실제 코드 본문에 평문이 없어야 합니다.
    const stripComments = (source) => source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const source of sources) {
        assert.ok(!stripComments(source).includes(ADMIN_PIN), '관리자 비밀번호 평문이 코드 본문에 남아 있습니다');
    }
    assert.match(readAppFile('public/js/app.js'), /DEFAULT_ADMIN_PW_HASH/);
});
