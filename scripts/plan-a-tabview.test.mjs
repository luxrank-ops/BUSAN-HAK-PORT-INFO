import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// [방안 A] 5대 핵심 탭 뷰 하이브리드 검증.
// - 최초 접속: 기존 원본 메인 화면(legacy) 유지
// - 원본에서 기능 클릭 → 방안 A 탭 뷰로 전환
// - 하단 5탭 내비게이션 / 임금·일지 서브탭 / 탭 간 기능 점프 / 원본 홈 복귀
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
// A-1(인라인 분리): 함수 코드가 외부 JS 파일로 이동했습니다.
const appMainCode = readFileSync(new URL('../public/js/app-main.js', import.meta.url), 'utf8');
const tabControllerCode = readFileSync(new URL('../public/js/tab-controller.js', import.meta.url), 'utf8');
// 검색 대상: app-main.js + tab-controller.js (탭 뷰 함수·상수는 tab-controller 에 있음)
const combinedJsCode = appMainCode + '\n' + tabControllerCode;

function extractFunction(name) {
    let marker = combinedJsCode.indexOf(`async function ${name}(`);
    if (marker < 0) marker = combinedJsCode.indexOf(`function ${name}(`);
    if (marker < 0) throw new Error(`function not found: ${name}`);
    // Skip parameter list (may contain default-value braces)
    const parenStart = combinedJsCode.indexOf('(', marker);
    let parenDepth = 0, bodyStart = -1;
    for (let i = parenStart; i < combinedJsCode.length; i++) {
        if (combinedJsCode[i] === '(') parenDepth++;
        else if (combinedJsCode[i] === ')') {
            parenDepth--;
            if (parenDepth === 0) { bodyStart = combinedJsCode.indexOf('{', i); break; }
        }
    }
    if (bodyStart < 0) throw new Error(`could not find function body: ${name}`);
    let depth = 0;
    for (let i = bodyStart; i < combinedJsCode.length; i++) {
        if (combinedJsCode[i] === '{') depth++;
        else if (combinedJsCode[i] === '}') {
            depth--;
            if (depth === 0) return combinedJsCode.slice(marker, i + 1);
        }
    }
    throw new Error(`unterminated function: ${name}`);
}

function extractConstObject(name) {
    const marker = combinedJsCode.indexOf(`const ${name} =`);
    if (marker < 0) throw new Error(`const not found: ${name}`);
    const eqPos = combinedJsCode.indexOf('=', marker);
    const open = combinedJsCode.indexOf('{', eqPos);
    let depth = 0;
    for (let i = open; i < combinedJsCode.length; i++) {
        if (combinedJsCode[i] === '{') depth++;
        else if (combinedJsCode[i] === '}') {
            depth--;
            if (depth === 0) return combinedJsCode.slice(marker, i + 1) + ';';
        }
    }
    throw new Error(`unterminated const: ${name}`);
}

function makeClassList(initial = []) {
    const set = new Set(initial);
    return {
        add(...n) { n.forEach(x => set.add(x)); },
        remove(...n) { n.forEach(x => set.delete(x)); },
        contains(n) { return set.has(n); },
        toggle(n, force) {
            const on = force === undefined ? !set.has(n) : !!force;
            if (on) set.add(n); else set.delete(n);
            return on;
        }
    };
}

function makeEl(id, { classes = [], group = '', parent = null } = {}) {
    const el = {
        id,
        classList: makeClassList(classes),
        dataset: {},
        style: {},
        attrs: {},
        parentElement: parent,
        offsetHeight: 60,
        getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
        setAttribute(n, v) { this.attrs[n] = v; },
        closest() { return null; }
    };
    if (group) el.attrs['data-view-group'] = group;
    return el;
}

function setup({ startView = 'legacy', startTab = '', startSub = '' } = {}) {
    const body = makeEl('body');
    body.dataset.appView = startView;
    if (startTab) body.dataset.appTab = startTab;
    if (startSub) body.dataset.appSubTab = startSub;

    const elements = {};
    const add = (el) => { elements[el.id] = el; return el; };

    const wageGrid = add(makeEl('wageGrid', { group: 'wage-log', parent: body }));
    const wageCard = add(makeEl('wage-card', { parent: wageGrid }));
    const logCard = add(makeEl('log-card', { parent: wageGrid }));
    const t3 = add(makeEl('t3wrap', { group: 'ships', parent: body }));
    const t2 = add(makeEl('t2wrap', { group: 'ships', parent: body }));
    const t1 = add(makeEl('t1wrap', { group: 'ships', parent: body }));
    const t3c = add(makeEl('t3-content', { parent: t3 }));
    const t2c = add(makeEl('t2-content', { parent: t2 }));
    const t1c = add(makeEl('t1-content', { parent: t1 }));
    const shipCard = add(makeEl('ship-card', { group: 'ships', parent: body }));
    const noticeCard = add(makeEl('notice-card', { group: 'community', parent: body }));
    const boardCard = add(makeEl('board-card', { group: 'community', parent: body }));
    const archiveCard = add(makeEl('archive-card', { group: 'community', parent: body }));
    const englishCard = add(makeEl('daily-field-english-card', { group: 'guide', parent: body }));
    const safetyCard = add(makeEl('safety-card', { group: 'guide', parent: body }));
    const guideCard = add(makeEl('guide-card', { group: 'guide', parent: body }));
    const weatherCard = add(makeEl('weather-card', { group: 'home', parent: body }));
    const privacyCard = add(makeEl('privacy-center-card', { group: 'home', parent: body }));
    const manualCard = add(makeEl('main-manual-card', { group: 'home', parent: body }));

    const toolbar = add(makeEl('tabViewToolbar'));
    toolbar.style.display = 'none';
    const title = add(makeEl('tabViewTitle'));
    title.textContent = '';
    const hint = add(makeEl('tabViewHint'));
    hint.textContent = '';
    const subWrap = add(makeEl('wageLogSubTabs'));
    subWrap.style.display = 'none';
    const subBtns = ['wage', 'log', 'report'].map(s => {
        const b = makeEl(`sub-${s}`, { classes: s === 'wage' ? ['active'] : [] });
        b.attrs['data-subtab'] = s;
        return b;
    });

    const navItems = ['nav-home', 'nav-wage', 'nav-ships', 'nav-community', 'nav-guide']
        .map((id, i) => makeEl(id, { classes: i === 0 ? ['active'] : [] }));

    const groups = [wageGrid, t3, t2, t1, shipCard, noticeCard, boardCard, archiveCard, englishCard, safetyCard, guideCard, weatherCard, privacyCard, manualCard];
    const header = makeEl('header');

    const toasts = [];
    const toggled = [];
    const calls = { scrollToTop: 0, history: 0, scrollTo: 0 };

    const documentStub = {
        body,
        documentElement: { style: { setProperty() {} } },
        readyState: 'complete',
        getElementById: id => elements[id] ?? null,
        querySelector: sel => (sel === 'body > header' ? header : null),
        querySelectorAll: sel => {
            if (sel === '[data-view-group]') return groups;
            if (sel === '#wageLogSubTabs .tab-sub-btn') return subBtns;
            if (sel === '.bottom-nav .nav-item') return navItems;
            return [];
        },
        addEventListener() {}
    };

    const context = vm.createContext({
        console,
        JSON,
        Date,
        Math,
        document: documentStub,
        window: {
            addEventListener() {},
            scrollTo() { calls.scrollTo++; }
        },
        showToast: m => toasts.push(m),
        scheduleAppHistoryRecord() { calls.history++; },
        scrollToTop() { calls.scrollToTop++; },
        // 실제 앱의 토글 동작을 단순화: 다른 카드를 모두 접고 대상만 펼침
        toggleDashItem(id) {
            toggled.push(id);
            Object.values(elements).forEach(el => {
                if (el && el.id && el.id.endsWith('-card')) el.classList.remove('expanded');
            });
            const target = elements[id];
            if (target) {
                target.classList.add('expanded');
                if (typeof sandbox.syncBottomNavActive === 'function') sandbox.syncBottomNavActive(id);
            }
        }
    });

    const consts = ['PLAN_A_TAB_META', 'PLAN_A_CARD_TABS', 'PLAN_A_DEFAULT_FOCUS'].map(extractConstObject).join('\n');
    const fns = [
        'getAppView', 'isElementHiddenInLayout', 'syncTabChromeOffset', 'applyPlanAViewLayout',
        'focusPlanACard', 'scrollToWorkLogReport', 'openShipsSectionsForOverview',
        'switchPlanATab', 'planANavTap', 'switchWageLogSubTab', 'goHomeView', 'planARouteCardOpen',
        'syncBottomNavActive', 'stepBackActiveUIInPlace'
    ].map(extractFunction).join('\n');
    vm.runInContext(`${consts}\n${fns}`, context);

    const sandbox = context;
    return { context, elements, body, groups, subBtns, navItems, toasts, toggled, calls };
}

function activeNavIds(app) {
    return app.navItems.filter(n => n.classList.contains('active')).map(n => n.id);
}

function hiddenGroups(app) {
    return app.groups.filter(g => g.classList.contains('view-hidden')).map(g => g.id);
}

// ---------- 구조 검증 ----------

test('구조: 최초 진입 화면은 기존 원본 메인 화면(legacy)이다', () => {
    assert.match(html, /<body data-app-view="legacy">/);
    assert.match(html, /id="tabViewToolbar"[\s\S]*?onclick="goHomeView\(\)"/);
});

test('구조: 하단 내비게이션은 방안 A 5탭이다', () => {
    assert.match(html, /id="nav-home"[\s\S]{0,200}?onclick="goHomeView\(\)"/);
    assert.match(html, /id="nav-wage"[\s\S]{0,200}?onclick="planANavTap\('wage-log'\)"/);
    assert.match(html, /id="nav-ships"[\s\S]{0,200}?onclick="planANavTap\('ships'\)"/);
    assert.match(html, /id="nav-community"[\s\S]{0,200}?onclick="planANavTap\('community'\)"/);
    assert.match(html, /id="nav-guide"[\s\S]{0,200}?onclick="planANavTap\('guide'\)"/);
    assert.equal((html.match(/class="nav-item/g) || []).length, 5);
});

test('구조: 임금·일지 서브탭 3개(임금계산기/근무일지 달력/월간 정산 리포트)', () => {
    assert.match(html, /data-subtab="wage"[\s\S]{0,80}?switchWageLogSubTab\('wage'\)/);
    assert.match(html, /data-subtab="log"[\s\S]{0,80}?switchWageLogSubTab\('log'\)/);
    assert.match(html, /data-subtab="report"[\s\S]{0,80}?switchWageLogSubTab\('report'\)/);
});

test('구조: 기존 카드가 방안 A 탭 그룹에 올바르게 배정되어 있다', () => {
    assert.match(html, /id="wage-card"[\s\S]{0,200}?data-view-group="wage-log"|data-view-group="wage-log"[\s\S]{0,400}?id="wage-card"/);
    assert.equal((html.match(/data-view-group="ships"/g) || []).length, 4);
    assert.equal((html.match(/data-view-group="community"/g) || []).length, 3);
    assert.equal((html.match(/data-view-group="guide"/g) || []).length, 3);
    assert.equal((html.match(/data-view-group="home"/g) || []).length, 3);
    // 기존 아코디언 헤더는 그대로 유지 (기존 사용자 동선 보존)
    assert.match(html, /onclick="toggleDashItem\('wage-card'\)"/);
    assert.match(html, /onclick="toggleDashItem\('log-card'\)"/);
    assert.match(html, /onclick="toggleDashItem\('ship-card'\)"/);
});

test('구조: toggleDashItem에 하이브리드 라우팅 훅이 연결되어 있다', () => {
    // A-1(인라인 분리): 함수 정의는 외부 JS 파일로 이동
    assert.match(combinedJsCode, /function toggleDashItem\(id\) \{[\s\S]{0,500}?planARouteCardOpen\(id, card\)/);
    assert.match(combinedJsCode, /function stepBackActiveUIInPlace\(\) \{[\s\S]{0,400}?goHomeView\(\{ skipHistory: true \}\)/);
    assert.match(combinedJsCode, /appView: \(document\.body && document\.body\.dataset && document\.body\.dataset\.appView\) \|\| 'legacy'/);
});

// ---------- 동작 검증 (가짜 DOM 위에서 실제 컨트롤러 함수 실행) ----------

test('동작: 원본 홈에서 임금계산기 클릭 → [임금·일지] 탭(임금계산기 서브탭)으로 전환', () => {
    const app = setup();
    const routed = vm.runInContext(`planARouteCardOpen('wage-card', document.getElementById('wage-card'))`, app.context);
    assert.equal(routed, true);
    assert.equal(app.body.dataset.appView, 'tab');
    assert.equal(app.body.dataset.appTab, 'wage-log');
    assert.equal(app.body.dataset.appSubTab, 'wage');
    assert.ok(app.elements['wage-card'].classList.contains('expanded'));
    assert.ok(app.elements['log-card'].classList.contains('view-hidden'));
    assert.ok(!app.elements['wage-card'].classList.contains('view-hidden'));
    assert.deepEqual(activeNavIds(app), ['nav-wage']);
    assert.ok(app.toasts.some(m => m.includes('임금·일지')), '탭 이동 안내 토스트가 표시되어야 합니다');
});

test('동작: 원본 홈에서 근무일지 클릭 → [임금·일지] 탭(근무일지 달력 서브탭)으로 전환', () => {
    const app = setup();
    vm.runInContext(`planARouteCardOpen('log-card', document.getElementById('log-card'))`, app.context);
    assert.equal(app.body.dataset.appSubTab, 'log');
    assert.ok(app.elements['log-card'].classList.contains('expanded'));
    assert.ok(app.elements['wage-card'].classList.contains('view-hidden'));
    assert.deepEqual(activeNavIds(app), ['nav-wage']);
});

test('동작: 홈 전용 카드(날씨/보안/설명서)는 원본 홈에서 제자리에서 펼쳐진다', () => {
    const app = setup();
    assert.equal(vm.runInContext(`planARouteCardOpen('weather-card', document.getElementById('weather-card'))`, app.context), false);
    assert.equal(vm.runInContext(`planARouteCardOpen('privacy-center-card', document.getElementById('privacy-center-card'))`, app.context), false);
    assert.equal(vm.runInContext(`planARouteCardOpen('main-manual-card', document.getElementById('main-manual-card'))`, app.context), false);
    assert.equal(app.body.dataset.appView, 'legacy', '홈 전용 카드는 뷰를 전환하면 안 됩니다');
    assert.deepEqual(hiddenGroups(app), [], '원본 홈에서는 모든 그룹이 보여야 합니다');
});

test('동작: 이미 펼쳐진 카드를 다시 누르면 기존처럼 닫기(토글)로 유지된다', () => {
    const app = setup();
    app.elements['weather-card'].classList.add('expanded');
    assert.equal(vm.runInContext(`planARouteCardOpen('weather-card', document.getElementById('weather-card'))`, app.context), false);
    // 핵심 기능 카드도 펼쳐져 있으면 라우팅하지 않고 닫기로 넘긴다
    app.elements['wage-card'].classList.add('expanded');
    assert.equal(vm.runInContext(`planARouteCardOpen('wage-card', document.getElementById('wage-card'))`, app.context), false);
});

test('동작: 하단 탭으로 커뮤니티 진입 시 왁자지껄(톡톡)이 기본 포커스', () => {
    const app = setup();
    vm.runInContext(`planANavTap('community')`, app.context);
    assert.equal(app.body.dataset.appView, 'tab');
    assert.equal(app.body.dataset.appTab, 'community');
    assert.ok(app.elements['board-card'].classList.contains('expanded'));
    assert.ok(!app.elements['notice-card'].classList.contains('view-hidden'));
    assert.ok(!app.elements['board-card'].classList.contains('view-hidden'));
    assert.ok(!app.elements['archive-card'].classList.contains('view-hidden'));
    assert.ok(app.elements['wageGrid'].classList.contains('view-hidden'), '다른 탭 그룹은 숨겨져야 합니다');
    assert.deepEqual(activeNavIds(app), ['nav-community']);
    assert.ok(app.toasts.length === 0, '하단 탭 직접 이동은 토스트를 띄우지 않습니다');
});

test('동작: 선박도감 탭 진입 시 터미널 스케줄 섹션이 접혀 있으면 한 번에 펼쳐진다', () => {
    const app = setup();
    const t3c = app.elements['t3-content'];
    t3c.classList.add('collapsed');
    app.elements['t2-content'].classList.add('collapsed');
    app.elements['t1-content'].classList.add('collapsed');
    vm.runInContext(`planANavTap('ships')`, app.context);
    assert.equal(app.body.dataset.appTab, 'ships');
    assert.ok(!t3c.classList.contains('collapsed'));
    assert.ok(!app.elements['t2-content'].classList.contains('collapsed'));
    assert.ok(!app.elements['t1-content'].classList.contains('collapsed'));
    assert.ok(app.elements['ship-card'].classList.contains('expanded'));
});

test('동작: 임금·일지 서브탭 전환 (임금계산기 ↔ 근무일지 달력 ↔ 월간 정산 리포트)', () => {
    const app = setup();
    vm.runInContext(`switchPlanATab('wage-log', 'wage', null, { silent: true })`, app.context);
    assert.ok(app.elements['wage-card'].classList.contains('expanded'));
    assert.ok(app.elements['log-card'].classList.contains('view-hidden'));

    vm.runInContext(`switchWageLogSubTab('log')`, app.context);
    assert.equal(app.body.dataset.appSubTab, 'log');
    assert.ok(app.elements['log-card'].classList.contains('expanded'));
    assert.ok(app.elements['wage-card'].classList.contains('view-hidden'));

    vm.runInContext(`switchWageLogSubTab('report')`, app.context);
    assert.equal(app.body.dataset.appSubTab, 'report');
    assert.ok(app.elements['log-card'].classList.contains('expanded'));
    assert.ok(app.elements['wage-card'].classList.contains('view-hidden'));
    // 서브탭 버튼 active 상태 동기화
    assert.deepEqual(
        app.subBtns.filter(b => b.classList.contains('active')).map(b => b.getAttribute('data-subtab')),
        ['report']
    );
});

test('동작: 탭 뷰에서 다른 탭 소속 기능 호출 시 해당 탭으로 자동 점프 (계산 결과 → 근무일지)', () => {
    const app = setup({ startView: 'tab', startTab: 'ships', startSub: '' });
    vm.runInContext(`applyPlanAViewLayout()`, app.context);
    const routed = vm.runInContext(`planARouteCardOpen('log-card', document.getElementById('log-card'))`, app.context);
    assert.equal(routed, true);
    assert.equal(app.body.dataset.appTab, 'wage-log');
    assert.equal(app.body.dataset.appSubTab, 'log');
    assert.ok(app.elements['log-card'].classList.contains('expanded'));
});

test('동작: 탭 뷰에서 홈 전용 카드가 필요하면 원본 홈으로 복귀 후 펼쳐진다', () => {
    const app = setup({ startView: 'tab', startTab: 'guide' });
    vm.runInContext(`applyPlanAViewLayout()`, app.context);
    const routed = vm.runInContext(`planARouteCardOpen('weather-card', document.getElementById('weather-card'))`, app.context);
    assert.equal(routed, false, '라우팅 대신 홈 복귀 후 기존 토글로 이어집니다');
    assert.equal(app.body.dataset.appView, 'legacy');
    assert.equal(app.calls.scrollToTop, 1, '홈 복귀 시 기존 홈 동작(전체 접기)이 실행되어야 합니다');
});

test('동작: 🏠 홈 복귀 시 원본 화면 + 전체 그룹 표시 + 홈 내비 활성', () => {
    const app = setup({ startView: 'tab', startTab: 'community' });
    vm.runInContext(`applyPlanAViewLayout()`, app.context);
    vm.runInContext(`goHomeView()`, app.context);
    assert.equal(app.body.dataset.appView, 'legacy');
    assert.equal(app.body.dataset.appTab, undefined);
    assert.equal(app.body.dataset.appSubTab, undefined);
    assert.deepEqual(hiddenGroups(app), []);
    assert.equal(app.elements['tabViewToolbar'].style.display, 'none');
    assert.deepEqual(activeNavIds(app), ['nav-home']);
    assert.equal(app.calls.scrollToTop, 1);
});

test('동작: 홈화면에서 임금계산기·근무일지 등 블럭들을 펼쳤다가 다시 눌러 접으면 홈화면(legacy)으로 복귀한다', () => {
    const cardIds = [
        'wage-card',
        'log-card',
        'ship-card',
        'notice-card',
        'board-card',
        'archive-card',
        'safety-card',
        'guide-card',
        'daily-field-english-card'
    ];

    for (const cardId of cardIds) {
        const app = setup();
        // 1. 홈화면에서 블록 클릭하여 펼침 → 탭 뷰 전환 + 해당 카드 확장
        const opened = vm.runInContext(`planARouteCardOpen('${cardId}', document.getElementById('${cardId}'))`, app.context);
        assert.equal(opened, true, `${cardId} 펼침 시 탭 뷰로 전환되어야 합니다`);
        assert.equal(app.body.dataset.appView, 'tab');
        assert.ok(app.elements[cardId].classList.contains('expanded'), `${cardId}가 펼쳐져 있어야 합니다`);

        // 2. 펼쳐진 블록 헤더를 다시 클릭하여 접음 → 카드 접힘 + 원본 홈 화면(legacy) 복귀
        const collapsed = vm.runInContext(`planARouteCardOpen('${cardId}', document.getElementById('${cardId}'))`, app.context);
        assert.equal(collapsed, true, `${cardId} 접기 시 홈 복귀 라우팅이 처리되어야 합니다`);
        assert.equal(app.body.dataset.appView, 'legacy', `${cardId} 접기 후 홈화면(legacy)으로 복귀해야 합니다`);
        assert.equal(app.body.dataset.appTab, undefined);
        assert.equal(app.body.dataset.appSubTab, undefined);
        assert.ok(!app.elements[cardId].classList.contains('expanded'), `${cardId}가 접혀 있어야 합니다`);
        assert.deepEqual(hiddenGroups(app), [], '홈화면 복귀 후 모든 블록 그룹이 표시되어야 합니다');
        assert.equal(app.elements['tabViewToolbar'].style.display, 'none');
        assert.deepEqual(activeNavIds(app), ['nav-home']);
    }
});

test('동작: 탭 뷰 상태에서 뒤로가기(stepBack)가 원본 홈으로 복귀한다', () => {
    const app = setup({ startView: 'tab', startTab: 'guide' });
    const stepped = vm.runInContext(`stepBackActiveUIInPlace()`, app.context);
    assert.equal(stepped, true);
    assert.equal(app.body.dataset.appView, 'legacy');
});
