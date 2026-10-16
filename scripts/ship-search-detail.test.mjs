import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// 🚢 작업 선박 정보: 검색 → 목록의 선박 클릭 시 상세 내용이 사라지고 전체 선박 목록이 보이던 버그 회귀 테스트.
// 원인: 선박을 펼치면 조회수(views)가 +1 저장되고, 즉시 도착하는 ships 실시간 스냅샷에서
//       filteredShips = allShipsData 로 검색 조건을 버린 채 전체 목록 1페이지를 다시 그렸다.
//       → 전체 목록 1페이지(최신 5척)에 없는 예전(업데이트 이전 등록) 선박은 펼친 내용이 사라졌다.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
// A-1(인라인 분리): 함수 코드가 app-main.js 로 이동했습니다.
const appMainCode = readFileSync(new URL('../public/js/app-main.js', import.meta.url), 'utf8');

function extractFunction(name) {
    let marker = appMainCode.indexOf(`async function ${name}(`);
    if (marker < 0) marker = appMainCode.indexOf(`function ${name}(`);
    if (marker < 0) throw new Error(`function not found: ${name}`);
    const open = appMainCode.indexOf('{', marker);
    let depth = 0;
    for (let i = open; i < appMainCode.length; i++) {
        if (appMainCode[i] === '{') depth++;
        else if (appMainCode[i] === '}') {
            depth--;
            if (depth === 0) return appMainCode.slice(marker, i + 1);
        }
    }
    throw new Error(`unterminated function: ${name}`);
}

const SHIP_FUNCTIONS = [
    'getShipDisplayName', 'getShipMemoText', 'getShipLegacyOnshoreText', 'toShipDate', 'extractShipTags',
    'getShipSearchHaystack', 'getFilteredShipList', 'filterShips', 'escapeShipCommentHtml', 'renderShipCommentMarkup',
    'renderShipPage', 'incrementBoardItemViewCount', 'toggleBoardRow', 'loadShipComments',
    'getShipRowSignature', 'isShipViewCountOnlyChange', 'syncShipViewCountBadges', 'applyShipDirectorySnapshot',
    // D-2: 소프트 삭제 표시(deletedAt) 판별 헬퍼
    'isDeletedRecord'
];

// innerHTML 로 생성된 id 요소를 추적하는 최소한의 가짜 DOM (클래스·값·텍스트만 지원)
function createFakeDocument() {
    const registry = new Map();
    const makeClassList = initial => {
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
    const detach = el => {
        for (const child of el.children) {
            detach(child);
            if (registry.get(child.id) === child) registry.delete(child.id);
        }
        el.children = [];
    };
    const parseInto = (parent, markup) => {
        const tagRe = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
        let m;
        while ((m = tagRe.exec(markup))) {
            const attrs = {};
            const attrRe = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
            let a;
            while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
            if (!attrs.id) continue;
            const child = makeElement(attrs.id, m[1], attrs);
            child.parent = parent;
            parent.children.push(child);
            registry.set(child.id, child);
        }
    };
    function makeElement(id, tag = 'div', attrs = {}) {
        const el = {
            id, tagName: tag.toUpperCase(), attrs, children: [], parent: null,
            style: {}, value: attrs.value ?? '', innerText: '', textContent: '', title: '', scrollLeft: 0,
            classList: makeClassList((attrs.class || '').split(/\s+/).filter(Boolean)),
            getAttribute: n => (n in attrs ? attrs[n] : null)
        };
        let markup = '';
        Object.defineProperty(el, 'innerHTML', {
            get: () => markup,
            set: v => { markup = String(v); detach(el); parseInto(el, markup); }
        });
        return el;
    }
    const descendants = el => el.children.flatMap(c => [c, ...descendants(c)]);
    const addStatic = (id, attrs = {}) => {
        const el = makeElement(id, 'div', attrs);
        registry.set(id, el);
        return el;
    };
    const document = {
        getElementById: id => registry.get(id) ?? null,
        querySelectorAll(selector) {
            const m = selector.match(/^#([\w-]+)\s+((?:\.[\w-]+)+)$/);
            if (!m) throw new Error(`unsupported selector: ${selector}`);
            const root = registry.get(m[1]);
            if (!root) return [];
            const classes = m[2].split('.').filter(Boolean);
            return descendants(root).filter(el => classes.every(c => el.classList.contains(c)));
        }
    };
    return { document, addStatic };
}

const DAY = 24 * 60 * 60 * 1000;

function seedShips(now) {
    const fresh = ['MSC AURORA', 'EVER GIVEN', 'ONE APUS', 'MAERSK ESSEN', 'CMA CGM JULES'].map((name, i) => ({
        id: `new${i + 1}`, shipName: name, onboardFeat: `${name} 오토콘 사용`, difficulty: 3, tags: ['#오토콘'],
        views: 2, password: 'a'.repeat(64), ts: now - (i + 1) * DAY
    }));
    // 업데이트 이전 등록 선박: difficulty/tags/views 없음, 평문 비밀번호
    const legacy = ['HMM ALGECIRAS', 'HYUNDAI PRIDE', 'COSCO SHIPPING', 'YM WELLNESS', 'KMTC SEOUL', 'SINOKOR TOKYO', 'PAN CONTINENTAL']
        .map((name, i) => ({ id: `old${i + 1}`, shipName: name, onboardFeat: `${name} 예전 작업 메모`, password: '1234', ts: now - (40 + i * 20) * DAY }));
    return [...fresh, ...legacy];
}

function setup() {
    const now = Date.now();
    const { document, addStatic } = createFakeDocument();
    ['shipList', 'shipPagination', 'shipCardSubMeta', 'shipBadge'].forEach(id => addStatic(id));
    const search = addStatic('shipSearch');
    const difficulty = addStatic('shipDifficultyFilter');
    difficulty.value = '0';

    const writes = [];
    const commentSubscriptions = [];
    const db = {
        collection: name => ({
            doc: id => ({
                update: data => { writes.push({ name, id, data }); return Promise.resolve(); },
                collection: () => ({
                    orderBy: () => ({
                        onSnapshot: () => { commentSubscriptions.push(id); return () => {}; }
                    })
                })
            })
        })
    };
    let fullListRenders = 0;
    const context = vm.createContext({
        document, console, db,
        firebase: { firestore: { FieldValue: { increment: n => ({ __increment: n }) } } },
        scheduleAppHistoryRecord: () => {},
        loadAndSearchAllShips: () => { fullListRenders++; },
        postsPerPage: 5
    });
    vm.runInContext(`
        var allShipsData = [], filteredShips = [], activeShipFilterTags = [], allPostsData = [];
        var currentShipPage = 1, shipDirectorySnapshotLoaded = false;
        var shipCommentUnsubscribes = {}, shipCommentsById = {}, editingShipComment = null;
        var makeTimestamp = ms => ({ toDate: () => new Date(ms), toMillis: () => ms });
    `, context);
    for (const name of SHIP_FUNCTIONS) vm.runInContext(extractFunction(name), context);

    // Firestore 서버 상태 (timestamp 내림차순 정렬 = orderBy("timestamp","desc"))
    let docs = seedShips(now);
    const emit = () => {
        const sorted = [...docs].sort((a, b) => b.ts - a.ts);
        const snapshot = {
            forEach: fn => sorted.forEach(({ id, ts, ...data }) => {
                fn({ id, data: () => ({ ...data, timestamp: data.timestamp ?? context.makeTimestamp(ts) }) });
            })
        };
        context.applyShipDirectorySnapshot(snapshot);
    };
    // Firestore 의 지연 보상처럼: 로컬 조회수 쓰기 → 즉시 스냅샷
    const flushViewWrites = () => {
        for (const w of writes.splice(0)) {
            const target = docs.find(d => d.id === w.id);
            if (w.name === 'ships' && target && w.data.views?.__increment) target.views = (target.views || 0) + w.data.views.__increment;
        }
        emit();
    };
    const rowsShown = () => document.querySelectorAll('#shipList .board-content-row')
        .map(el => el.id);
    return {
        context, document, search, writes, commentSubscriptions, emit, flushViewWrites, rowsShown,
        get fullListRenders() { return fullListRenders; },
        get docs() { return docs; },
        set docs(v) { docs = v; },
        now
    };
}

test('검색한 예전(업데이트 이전) 선박을 클릭하면 조회수 스냅샷 이후에도 상세 내용과 검색 결과가 유지된다', () => {
    const t = setup();
    t.emit();
    assert.deepEqual(t.rowsShown(), ['s-new1', 's-new2', 's-new3', 's-new4', 's-new5'], '초기 1페이지 = 최신 5척');

    t.search.value = 'HMM ALGECIRAS';
    t.context.filterShips();
    assert.deepEqual(t.rowsShown(), ['s-old1']);

    t.context.toggleBoardRow('s-old1');
    const rowBefore = t.document.getElementById('s-old1');
    assert.ok(rowBefore.classList.contains('show'));
    assert.deepEqual(t.writes.map(w => `${w.name}/${w.id}`), ['ships/old1'], '조회수 +1 저장');
    const rendersBefore = t.fullListRenders;

    t.flushViewWrites(); // 조회수 변경으로 즉시 도착하는 실시간 스냅샷

    const rowAfter = t.document.getElementById('s-old1');
    assert.ok(rowAfter, '상세 행이 사라지지 않아야 함');
    assert.ok(rowAfter.classList.contains('show'), '상세 내용이 펼쳐진 상태로 유지되어야 함');
    assert.equal(rowAfter, rowBefore, '조회수만 바뀐 경우 목록을 다시 그리지 않음');
    assert.deepEqual(t.rowsShown(), ['s-old1'], '검색 결과가 전체 목록으로 돌아가면 안 됨');
    assert.deepEqual([...t.context.filteredShips].map(s => s.id), ['old1']);
    assert.equal(t.document.getElementById('view-badge-s-old1').innerText, '👁️ 1');
    assert.equal(t.document.getElementById('view-detail-s-old1').innerText, '👁️ 조회수 1회');
    assert.deepEqual(t.commentSubscriptions, ['old1'], '댓글 구독을 끊었다 다시 연결하지 않음');
    assert.equal(t.fullListRenders, rendersBefore, '전체 목록 표도 다시 그리지 않음(스크롤 유지)');
});

test('다른 사용자의 조회수 변경은 숫자만 갱신하고 작성 중인 댓글·펼친 상세를 건드리지 않는다', () => {
    const t = setup();
    t.emit();
    t.search.value = 'KMTC';
    t.context.filterShips();
    t.context.toggleBoardRow('s-old5');
    t.flushViewWrites();
    const draft = t.document.getElementById('ship-comment-text-old5');
    draft.value = '라싱바 무거움 주의';

    t.docs.find(d => d.id === 'new1').views += 1;
    t.docs.find(d => d.id === 'old5').views += 1;
    t.emit();

    assert.equal(t.document.getElementById('ship-comment-text-old5'), draft);
    assert.equal(draft.value, '라싱바 무거움 주의');
    assert.ok(t.document.getElementById('s-old5').classList.contains('show'));
    assert.equal(t.document.getElementById('view-badge-s-old5').innerText, '👁️ 2');
    assert.deepEqual(t.rowsShown(), ['s-old5']);
});

test('신규 선박 등록 등 내용이 바뀐 스냅샷에서도 검색 조건과 펼친 선박을 유지한다', () => {
    const t = setup();
    t.emit();
    t.search.value = 'SINOKOR';
    t.context.filterShips();
    t.context.toggleBoardRow('s-old6');
    t.flushViewWrites();

    t.docs = [...t.docs, { id: 'brandnew', shipName: 'WAN HAI 301', onboardFeat: '신규', difficulty: 2, tags: [], views: 0, ts: Date.now() }];
    t.emit();

    assert.deepEqual(t.rowsShown(), ['s-old6'], '검색 결과 유지');
    assert.ok(t.document.getElementById('s-old6').classList.contains('show'), '펼친 상세 유지');
    assert.equal(t.commentSubscriptions.filter(id => id === 'old6').length, 2, '다시 그린 뒤 댓글 구독 복구');
    assert.match(t.document.getElementById('shipCardSubMeta').innerText, /13척/);
});

test('검색 없이 펼친 선박이 신규 등록으로 다음 페이지로 밀려나면 그 페이지를 유지한다', () => {
    const t = setup();
    t.emit();
    t.context.toggleBoardRow('s-new5');
    t.flushViewWrites();

    t.docs = [...t.docs, { id: 'brandnew', shipName: 'WAN HAI 301', onboardFeat: '신규', views: 0, ts: Date.now() }];
    t.emit();

    assert.equal(t.context.currentShipPage, 2);
    assert.ok(t.document.getElementById('s-new5')?.classList.contains('show'));
});

test('태그·난이도 필터도 스냅샷 이후 유지된다', () => {
    const t = setup();
    t.emit();
    t.docs.find(d => d.id === 'old4').tags = ['#통로협소'];
    t.emit();
    vm.runInContext('activeShipFilterTags = ["#통로협소"];', t.context);
    t.context.filterShips();
    assert.deepEqual(t.rowsShown(), ['s-old4']);
    t.context.toggleBoardRow('s-old4');
    t.flushViewWrites();
    assert.deepEqual(t.rowsShown(), ['s-old4']);
    assert.ok(t.document.getElementById('s-old4').classList.contains('show'));
});

test('조회수 외 필드가 바뀌거나 순서·개수가 바뀌면 조회수 전용 변경으로 보지 않는다', () => {
    const t = setup();
    const ts = t.context.makeTimestamp(1000);
    const a = { id: 'a', shipName: 'A', onboardFeat: 'x', views: 1, timestamp: ts, tags: ['#오토콘'] };
    const b = { id: 'b', shipName: 'B', onboardFeat: 'y', timestamp: ts };
    const fn = t.context.isShipViewCountOnlyChange;
    assert.equal(fn([a, b], [{ ...a, views: 5 }, { ...b, views: 1 }]), true);
    assert.equal(fn([a, b], [{ ...a, timestamp: t.context.makeTimestamp(1000) }, b]), true, '같은 시각의 새 Timestamp 객체');
    assert.equal(fn([a, b], [{ ...a, onboardFeat: 'changed' }, b]), false);
    assert.equal(fn([a, b], [{ ...a, tags: ['#수동콘'] }, b]), false);
    assert.equal(fn([a, b], [{ ...a, timestamp: t.context.makeTimestamp(2000) }, b]), false);
    assert.equal(fn([a, b], [b, a]), false);
    assert.equal(fn([a, b], [a]), false);
});

test('예전 필드(content·onshoreFeat)에 저장된 내용도 상세에 표시되고 검색된다', () => {
    const t = setup();
    t.docs = [...t.docs, {
        id: 'legacyA', shipName: 'HANJIN BUSAN', content: '본선 3번 해치 브릿지 높음', onshoreFeat: '육상 섀시 대기 길어짐',
        date: '2026. 1. 25. 오후 5:01:00', ts: Date.parse('2026-01-25T08:01:00Z')
    }];
    t.emit();
    t.search.value = '섀시';
    t.context.filterShips();
    assert.deepEqual(t.rowsShown(), ['s-legacyA']);
    const detailHtml = t.document.getElementById('shipList').innerHTML;
    assert.match(detailHtml, /본선 3번 해치 브릿지 높음/);
    assert.match(detailHtml, /육상 작업 특징/);
    assert.match(detailHtml, /육상 섀시 대기 길어짐/);
    assert.equal(t.context.getShipMemoText({ onboardFeat: '', content: '내용' }), '내용');
    assert.equal(t.context.getShipMemoText({ onboardFeat: '본선', content: '내용' }), '본선');
});

test('형식이 다른 예전 timestamp 값이 있어도 목록 갱신이 멈추지 않는다', () => {
    const t = setup();
    t.docs = [
        ...t.docs,
        { id: 'w1', shipName: 'WEIRD STRING', onboardFeat: 'a', timestamp: '2026-02-01T00:00:00Z', ts: 1 },
        { id: 'w2', shipName: 'WEIRD MAP', onboardFeat: 'b', timestamp: { seconds: 1767225600, nanoseconds: 0 }, ts: 2 },
        { id: 'w3', shipName: 'WEIRD NUMBER', onboardFeat: 'c', timestamp: 1767225600000, ts: 3 },
        { id: 'w4', shipName: 'WEIRD JUNK', onboardFeat: 'd', timestamp: 'not a date', ts: 4 }
    ];
    assert.doesNotThrow(() => t.emit());
    t.search.value = 'WEIRD';
    assert.doesNotThrow(() => t.context.filterShips());
    const listHtml = t.document.getElementById('shipList').innerHTML;
    assert.match(listHtml, /2026\/02\/01/);
    assert.match(listHtml, /WEIRD JUNK/);
});

test('ships 실시간 구독은 검색 조건을 버리는 대신 applyShipDirectorySnapshot 으로 처리한다', () => {
    const listenerLine = appMainCode.split('\n').find(line => line.includes('db.collection("ships").orderBy("timestamp","desc").onSnapshot('));
    assert.ok(listenerLine, 'ships 실시간 구독 코드가 있어야 함');
    assert.match(listenerLine, /applyShipDirectorySnapshot\(s\)/);
    const codeOnly = appMainCode.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(codeOnly, /filteredShips\s*=\s*allShipsData\s*;/, '스냅샷에서 검색 결과를 전체 목록으로 덮어쓰지 않아야 함');
});


test('필수 장비 신규 콘 태그(외줄콘/더블콘/주먹콘/손가락콘/현대콘/춘학 사랑해콘)가 올바르게 추출·필터·검색된다', () => {
    const t = setup();
    t.docs = [
        ...t.docs,
        { id: 'tag1', shipName: 'CONE VESSEL 1', onboardFeat: '외줄콘 및 주먹콘 사용', views: 0, ts: 10 },
        { id: 'tag2', shipName: 'CONE VESSEL 2', onboardFeat: '더블콘과 손가락콘 주의', views: 0, ts: 9 },
        { id: 'tag3', shipName: 'CONE VESSEL 3', onboardFeat: '현대콘 작업 선박', views: 0, ts: 8 },
        { id: 'tag4', shipName: 'CONE VESSEL 4', onboardFeat: '춘학 사랑해콘 장비', views: 0, ts: 7, tags: ['#춘학 사랑해콘'] }
    ];
    t.emit();

    // extractShipTags 검증
    const s1 = t.docs.find(d => d.id === 'tag1');
    const tags1 = t.context.extractShipTags(s1);
    assert.ok(tags1.includes('#외줄콘'), '외줄콘 태그 추출');
    assert.ok(tags1.includes('#주먹콘'), '주먹콘 태그 추출');

    const s4 = t.docs.find(d => d.id === 'tag4');
    const tags4 = t.context.extractShipTags(s4);
    assert.ok(tags4.includes('#춘학 사랑해콘'), '춘학 사랑해콘 태그 확인');

    // 태그 필터 검증
    vm.runInContext('activeShipFilterTags = ["#춘학 사랑해콘"];', t.context);
    t.context.filterShips();
    assert.deepEqual(t.rowsShown(), ['s-tag4']);

    // 검색어 공백 유무 호환 검증 (춘학사랑해콘 검색)
    vm.runInContext('activeShipFilterTags = [];', t.context);
    t.search.value = '춘학사랑해콘';
    t.context.filterShips();
    assert.deepEqual(t.rowsShown(), ['s-tag4']);
});


// D-2: 소프트 삭제(deletedAt)된 선박은 목록에서 사라지고, 남은 선박은 그대로 유지된다.
test('소프트 삭제된 선박은 목록에서 제외된다', () => {
    const t = setup();
    t.emit();
    const before = t.rowsShown();
    const totalBefore = t.context.allShipsData.length;
    assert.ok(before.length >= 2, '테스트 전제: 선박이 2척 이상이어야 한다');
    const removedId = before[0];
    const removedDocId = removedId.replace(/^s-/, '');

    // 화면의 삭제 동작과 동일한 형태의 소프트 삭제 표시를 서버 문서에 반영한다.
    const target = t.docs.find(d => d.id === removedDocId);
    assert.ok(target, '삭제 대상 선박 문서를 찾아야 한다');
    target.deletedAt = t.now;
    t.emit();

    const after = t.rowsShown();
    assert.ok(!after.includes(removedId), '삭제 표시된 선박은 목록에서 빠져야 한다');
    assert.equal(t.context.allShipsData.length, totalBefore - 1, '전체 목록에서도 1척 줄어야 한다');
    assert.ok(
        !t.context.allShipsData.some(ship => ship.id === removedDocId),
        'allShipsData 에도 삭제된 선박이 남지 않아야 한다'
    );
    assert.equal(t.document.getElementById('shipCardSubMeta').innerText, `등록 선박 ${totalBefore - 1}척 · 장비 도감`);
});
