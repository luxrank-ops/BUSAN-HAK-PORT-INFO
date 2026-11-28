import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extractFunction, readAppCssRaw, readAppHtml, readAppJs } from './app-source.mjs';

function makeNoticeAndBoardEnv() {
    const registry = new Map();
    const makeClassList = (initial = []) => {
        const set = new Set(initial);
        return {
            add: (...names) => names.forEach(n => set.add(n)),
            remove: (...names) => names.forEach(n => set.delete(n)),
            contains: n => set.has(n),
            toggle: (n, force) => {
                const on = force === undefined ? !set.has(n) : Boolean(force);
                if (on) set.add(n); else set.delete(n);
                return on;
            }
        };
    };
    const makeEl = (id, attrs = {}) => {
        const el = {
            id, attrs, style: {}, value: '', innerText: '', scrollLeft: 0,
            classList: makeClassList((attrs.class || '').split(/\s+/).filter(Boolean))
        };
        let markup = '';
        Object.defineProperty(el, 'innerHTML', {
            get: () => markup,
            set: v => {
                markup = String(v);
                const tagRe = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
                let m;
                while ((m = tagRe.exec(markup))) {
                    const sub = {};
                    const attrRe = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
                    let a;
                    while ((a = attrRe.exec(m[2]))) sub[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
                    if (sub.id) registry.set(sub.id, makeEl(sub.id, sub));
                }
            }
        });
        return el;
    };
    const add = id => {
        const el = makeEl(id);
        registry.set(id, el);
        return el;
    };
    ['noticeList', 'noticePagination', 'noticeBadge', 'noticeCardSubMeta', 'boardList', 'pagination', 'boardBadge', 'boardCardSubMeta'].forEach(add);

    const document = {
        getElementById: id => registry.get(id) ?? null,
        querySelectorAll: selector => {
            if (selector === '#noticeList .board-content-row.show' || selector === '#boardList .board-content-row.show') {
                const prefix = selector.startsWith('#noticeList') ? 'n-' : 'p-';
                return [...registry.values()].filter(el => el.id.startsWith(prefix) && el.classList.contains('show'));
            }
            return [];
        }
    };
    const commentSnapshots = new Map();
    const commentSubCounts = new Map();
    const db = {
        collection: () => ({
            doc: id => ({
                collection: () => ({
                    orderBy: () => ({
                        onSnapshot: cb => {
                            commentSubCounts.set(id, (commentSubCounts.get(id) || 0) + 1);
                            commentSnapshots.set(id, cb);
                            return () => {};
                        }
                    })
                })
            })
        })
    };

    const js = readAppJs();
    const ctx = vm.createContext({
        document, db, console,
        window: {},
        postsPerPage: 5,
        allPostsData: [],
        allShipsData: [],
        commentUnsubscribes: {},
        boardCommentsById: {},
        editingBoardComment: null,
        escapeShipCommentHtml: v => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
        autoLink: v => String(v || ''),
        sanitizeSafeHttpUrl: v => String(v || ''),
        getPortNickname: () => '테스트닉',
        isDeletedRecord: d => Boolean(d && d.deletedAt)
    });
    const code = [
        'const PAGE_WINDOW = 2;',
        extractFunction(js, 'buildPaginationButtonsHtml'),
        'let currentNoticePage = 1;',
        'let noticeDirectorySnapshotLoaded = false;',
        'let postDirectorySnapshotLoaded = false;',
        extractFunction(js, 'renderNoticePagination'),
        extractFunction(js, 'renderNoticePage'),
        'let currentBoardPage = 1;',
        extractFunction(js, 'renderBoardPage'),
        extractFunction(js, 'renderPagination'),
        extractFunction(js, 'loadComments'),
        extractFunction(js, 'getShipRowSignature'),
        extractFunction(js, 'isShipViewCountOnlyChange'),
        extractFunction(js, 'syncBoardViewCountBadges'),
        extractFunction(js, 'applyNoticeDirectorySnapshot'),
        extractFunction(js, 'applyPostDirectorySnapshot')
    ].join('\n');
    vm.runInContext(code, ctx);
    return { ctx, document, commentSnapshots, commentSubCounts };
}

test('HTML 은 4개 일반 게시판을 board-table-wrap·board-pagination·board-composer 로 통일하고 safety-card 는 건드리지 않는다', () => {
    const html = readAppHtml();
    assert.match(html, /<div class="board-table-wrap">\s*<table class="board-table board-table-ship">[\s\S]*?<tbody id="shipList"><\/tbody>/);
    assert.match(html, /<div id="shipPagination" class="board-pagination"><\/div>/);
    assert.match(html, /<div class="board-table-wrap">\s*<table class="board-table board-table-notice">[\s\S]*?<tbody id="noticeList"><\/tbody>/);
    assert.match(html, /<div id="noticePagination" class="board-pagination"><\/div>/);
    assert.match(html, /<div class="board-table-wrap">\s*<table class="board-table board-table-board">[\s\S]*?<tbody id="boardList"><\/tbody>/);
    assert.match(html, /<div id="pagination" class="board-pagination"><\/div>/);
    assert.match(html, /<div class="board-table-wrap">\s*<table class="board-table board-table-archive">[\s\S]*?<tbody id="fileList"><\/tbody>/);
    assert.match(html, /id="shipForm" class="board-composer hidden"/);
    assert.match(html, /id="noticeForm" class="board-composer hidden"/);
    assert.match(html, /id="boardForm" class="board-composer hidden"/);
    assert.match(html, /id="archiveForm" class="board-composer hidden"/);
    // 기준이 된 A/S 게시판 마크업 보존
    assert.match(html, /<table class="board-table tas-board-table">[\s\S]*?<tbody id="tasFeed"><\/tbody>/);
});

test('CSS 는 board-content-box 의 white-space:normal·full-width comment-form·tas-board-table 비간섭을 유지한다', () => {
    const css = readAppCssRaw();
    assert.match(css, /\.board-content-box\s*\{[^}]*white-space:\s*normal;/);
    assert.match(css, /\.comment-form\s*\{[^}]*width:\s*100%;/);
    assert.match(css, /\.board-table:not\(\.tas-board-table\)\s+th\s*\{/);
    assert.match(css, /\.board-table:not\(\.tas-board-table\)\s+td\s*\{/);
    assert.match(css, /body\.dark-mode \.board-table-wrap/);
    assert.match(css, /body\.dark-mode \.board-comments-panel/);
});

test('공지사항과 자유게시판은 본문 공백을 정리하고 카드형 상세·페이지 버튼·빈 댓글 안내를 렌더링한다', () => {
    const { ctx, document, commentSnapshots } = makeNoticeAndBoardEnv();
    ctx.window.allNoticesCache = [{
        id: 'n1',
        title: '우선 안내',
        content: '\n\n  첫 공지 줄\r\n\r\n\r\n둘째 공지 줄  \n\n',
        isPriority: true,
        views: 4,
        timestamp: { toDate: () => new Date() }
    }];
    ctx.renderNoticePage(1);
    const noticeHtml = document.getElementById('noticeList').innerHTML;
    assert.match(noticeHtml, /id="row-n-n1" class="board-summary-row is-pinned"/);
    assert.match(noticeHtml, /<div class="board-detail-card is-pinned"><div class="board-detail-body">첫 공지 줄\n\n둘째 공지 줄<\/div>/);
    assert.match(noticeHtml, /id="view-detail-n-n1" class="board-detail-views">👁️ 조회수 4회<\/span>/);

    ctx.allPostsData = Array.from({ length: 6 }, (_, i) => ({
        id: `p${i + 1}`,
        title: `글 ${i + 1}`,
        nick: '테스터',
        content: i === 0 ? '\n\n  자유글 1줄\n\n\n\n2줄  \n\n' : '',
        views: 2,
        timestamp: { toDate: () => new Date() }
    }));
    ctx.renderBoardPage(1);
    const boardHtml = document.getElementById('boardList').innerHTML;
    assert.match(boardHtml, /id="row-p-p1" class="board-summary-row"/);
    assert.match(boardHtml, /<div class="board-detail-card"><div class="board-detail-body">자유글 1줄\n\n2줄<\/div>/);
    assert.match(boardHtml, /<div class="board-comments-panel"><div class="board-comments-title">💬 댓글<\/div>/);
    assert.match(document.getElementById('pagination').innerHTML, /<button type="button" class="page-num active"/);

    ctx.loadComments('p1');
    const cb = commentSnapshots.get('p1');
    cb([{ data: () => ({ name: 'A', text: '삭제됨', deletedAt: Date.now() }), id: 'c0' }]);
    assert.match(document.getElementById('cmt-list-p1').innerHTML, /class='comment-empty'>첫 댓글을 남겨보세요\./);
});

test('공지사항·자유게시판은 조회수만 바뀐 스냅샷에서 DOM과 댓글 구독을 유지하고 숫자만 갱신한다', () => {
    const { ctx, document, commentSubCounts } = makeNoticeAndBoardEnv();
    const tsMs = Date.now();
    const makeTs = () => ({ toDate: () => new Date(tsMs), toMillis: () => tsMs });
    const makeSnapshot = items => ({
        empty: items.length === 0,
        size: items.length,
        forEach: fn => items.forEach(({ id, ...data }) => fn({ id, data: () => data }))
    });

    // 공지사항 초기 스냅샷 후 행 열림 상태 설정
    ctx.applyNoticeDirectorySnapshot(makeSnapshot([
        { id: 'n1', title: '공지1', content: '본문', views: 3, timestamp: makeTs() }
    ]));
    document.getElementById('n-n1').classList.add('show');
    const noticeBadgeBefore = document.getElementById('view-badge-n-n1');

    // 공지 조회수만 변경된 스냅샷 -> 동일 요소 인스턴스 유지, 텍스트만 갱신
    ctx.applyNoticeDirectorySnapshot(makeSnapshot([
        { id: 'n1', title: '공지1', content: '본문', views: 4, timestamp: makeTs() }
    ]));
    assert.equal(document.getElementById('view-badge-n-n1'), noticeBadgeBefore);
    assert.equal(document.getElementById('view-badge-n-n1').innerText, '👁️ 4');
    assert.equal(document.getElementById('view-detail-n-n1').innerText, '👁️ 조회수 4회');
    assert.ok(document.getElementById('n-n1').classList.contains('show'));

    // 자유게시판 초기 스냅샷 후 행 열림 + 댓글 구독 + 댓글 입력 초안 작성
    ctx.applyPostDirectorySnapshot(makeSnapshot([
        { id: 'p1', nick: '작업자', title: '소통글', content: '내용', views: 5, timestamp: makeTs() }
    ]));
    document.getElementById('p-p1').classList.add('show');
    ctx.loadComments('p1');
    const draftInput = document.getElementById('cmt-txt-p1');
    draftInput.value = '입력 중이던 댓글';

    // 자유게시판 조회수만 변경된 스냅샷 -> 댓글 구독 재실행 없음, 입력 초안 보존
    ctx.applyPostDirectorySnapshot(makeSnapshot([
        { id: 'p1', nick: '작업자', title: '소통글', content: '내용', views: 6, timestamp: makeTs() }
    ]));
    assert.equal(commentSubCounts.get('p1'), 1, '조회수 스냅샷마다 댓글 구독을 재시작하면 안 됩니다');
    assert.equal(document.getElementById('cmt-txt-p1'), draftInput);
    assert.equal(document.getElementById('cmt-txt-p1').value, '입력 중이던 댓글');
    assert.equal(document.getElementById('view-badge-p-p1').innerText, '👁️ 6');
    assert.equal(document.getElementById('view-detail-p-p1').innerText, '👁️ 조회수 6회');
});
