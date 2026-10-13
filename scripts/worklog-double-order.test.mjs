import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// 근무일지 입·출항 선박 달력 조회 · 더블오더(2척) 선택 · 작업 내용 자동 입력 검증.
// 실제 앱 코드(public/index.html 인라인 스크립트)에서 함수를 꺼내 가짜 DOM 위에서 실행한다.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunction(name) {
    // async 선언을 먼저 찾아야 `function name(` 이 `async function name(` 안에서 잘못 잡히지 않는다.
    let marker = html.indexOf(`async function ${name}(`);
    if (marker < 0) marker = html.indexOf(`function ${name}(`);
    if (marker < 0) throw new Error(`function not found: ${name}`);
    const open = html.indexOf('{', marker);
    let depth = 0;
    for (let i = open; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') {
            depth--;
            if (depth === 0) return html.slice(marker, i + 1);
        }
    }
    throw new Error(`unterminated function: ${name}`);
}

function extractLine(prefix) {
    const line = html.split('\n').find(l => l.startsWith(prefix));
    if (!line) throw new Error(`line not found: ${prefix}`);
    return line;
}

const FUNCTIONS = [
    'renderHjncScheduledShipsUI', 'loadHjncScheduledShipsForDate',
    'getWorklogScheduleDate', 'setWorklogScheduleDateInput', 'openWorklogScheduleDatePicker',
    'onWorklogScheduleDateChange', 'shiftWorklogScheduleDate', 'resetWorklogScheduleToLogDate',
    'parseWorklogShipNames', 'normalizeWorklogShipKey', 'getWorklogPickedNames', 'refreshWorklogVesselList',
    'resolveWorklogVesselMeta', 'buildWorklogDoubleOrderBlock', 'syncWorklogDoubleOrderMemo',
    'updateWorklogDoubleOrderStatus', 'toggleWorklogVesselPick', 'onWorklogShipNameEdited',
    'importWageVesselsToWorklog', 'clickDate',
    'getSelectedVesselPeriod', 'periodHours', 'getVesselScheduleDateTime', 'formatWageScheduleEvent',
    'extractDatePrefix', 'extractShortTime', 'isVesselActiveOnDate'
];
const DECLARATIONS = [
    'let worklogRenderedVessels = [];',
    'const worklogVesselMeta = new Map();',
    'const WORKLOG_DOUBLE_BLOCK_RE',
    'const hjncScheduleMonthCache = {};'
];

const SCHEDULE = [
    { VSL_NM: 'SHIP ALPHA', ATA: '2026-10-08 08:00', ATD: '2026-10-08 10:00', BERTH_NO: '1' },
    { VSL_NM: 'SHIP BETA', ATA: '2026-10-08 13:00', ATD: '2026-10-08 16:00', BERTH_NO: '2' },
    { VSL_NM: 'SHIP GAMMA', ATA: '2026-10-08 18:00', ATD: '2026-10-08 20:00', BERTH_NO: '3' }
];

function setup({ logDate = '2026-10-08', shipName = '', memo = '', wageVessels = [] } = {}) {
    const elements = {};
    const make = (id, value = '') => (elements[id] = {
        id, value, innerText: '', innerHTML: '', textContent: '', dataset: {},
        classList: {
            values: new Set(),
            add(n) { this.values.add(n); },
            remove(n) { this.values.delete(n); },
            contains(n) { return this.values.has(n); },
            toggle(n, force) { const on = force ?? !this.values.has(n); on ? this.values.add(n) : this.values.delete(n); }
        },
        style: { setProperty() {} },
        attrs: { 'data-date': logDate },
        getAttribute(name) { return this.attrs[name] ?? null; },
        setAttribute(name, value) { this.attrs[name] = String(value); },
        scrollHeight: 0, offsetHeight: 0, clientHeight: 0
    });
    ['logShipName', 'logMemo', 'worklogScheduleDatePicker', 'hjncScheduleBoxTitle',
        'hjncScheduledShipList', 'worklogDoubleOrderStatus', 'dailyLogForm', 'selectedDateText',
        'logWage1', 'logWage2', 'logCoworkers', 'logImagePreview', 'logImageInput'].forEach(id => make(id));
    elements.logShipName.value = shipName;
    elements.logMemo.value = memo;
    elements.worklogScheduleDatePicker.value = logDate;

    const toasts = [];
    const fetchCalls = [];
    const context = vm.createContext({
        document: { getElementById: id => elements[id] ?? null },
        Map, Number, String, Array, Object, Date, RegExp, JSON, Math,
        console: { error() {}, warn() {} },
        selectedScheduleTerminal: 'hjnc',
        selectedWageVessels: wageVessels,
        terminalQuickConfig: { hjnc: { schedule: '#', chart: '#' } },
        getTerminalMeta: () => ({ label: 'HJNC', color: '#ea580c', live: true, badge: 'HJNC' }),
        escapeShipCommentHtml: s => String(s ?? ''),
        renderTerminalScheduleTabBar() {},
        renderWorkLogQuickChips() {},
        adminWorkLogs: {},
        autoGrowWorkLogMemo() {},
        showToast: m => toasts.push(m),
        getAppLocalDateString: () => '2026-10-08',
        fetchHjncScheduleForMonth: async (ym, force, tid) => { fetchCalls.push([ym, tid]); return SCHEDULE; }
    });
    // 기존 상태 선언(let/const)과 필요한 함수만 옮긴다.
    const decls = DECLARATIONS.map(extractLine).join('\n');
    const fns = FUNCTIONS.map(extractFunction).join('\n');
    // 앱과 같이 캐시는 스크립트 안의 const 객체이므로, 그 객체에 이번 달 스케줄을 넣는다.
    vm.runInContext(`${decls}\n${fns}\nhjncScheduleMonthCache["hjnc_2026-10"] = ${JSON.stringify(SCHEDULE)};`, context);
    return { context, elements, toasts, fetchCalls };
}

function renderDay(app, date = '2026-10-08') {
    app.context.renderHjncScheduledShipsUI(date, SCHEDULE, 'hjnc');
}

test('the schedule date is a calendar input that is separate from the work-log date', () => {
    assert.match(html, /id="worklogScheduleDatePicker"[\s\S]*?type="date"|type="date"[\s\S]*?id="worklogScheduleDatePicker"/);
    assert.match(html, /onchange="onWorklogScheduleDateChange\(this\.value\)"/);
    assert.match(html, /onclick="shiftWorklogScheduleDate\(-1\)"/);
    assert.match(html, /onclick="shiftWorklogScheduleDate\(1\)"/);
    const { context, elements, fetchCalls } = setup({ logDate: '2026-10-08' });
    context.onWorklogScheduleDateChange('2026-10-09');
    assert.equal(elements.worklogScheduleDatePicker.value, '2026-10-09');
    assert.equal(elements.dailyLogForm.getAttribute('data-date'), '2026-10-08');
    assert.equal(fetchCalls.length, 1);
});

test('prev/next buttons move the schedule date one day at a time across month ends', () => {
    const { context, elements } = setup({ logDate: '2026-10-31' });
    context.shiftWorklogScheduleDate(1);
    assert.equal(elements.worklogScheduleDatePicker.value, '2026-11-01');
    context.shiftWorklogScheduleDate(-2);
    assert.equal(elements.worklogScheduleDatePicker.value, '2026-10-30');
});

test('touching a vessel selects it, a second touch makes a double order and fills the work content', () => {
    const app = setup({ memo: '오늘 메모' });
    const { context, elements, toasts } = app;
    renderDay(app);

    context.toggleWorklogVesselPick(0);
    assert.equal(elements.logShipName.value, 'SHIP ALPHA');
    assert.equal(elements.logMemo.value, '오늘 메모', 'a single vessel does not touch the work content');
    assert.match(elements.worklogDoubleOrderStatus.textContent, /1\/2/);

    context.toggleWorklogVesselPick(1);
    assert.equal(elements.logShipName.value, 'SHIP ALPHA / SHIP BETA');
    const memo = elements.logMemo.value;
    assert.match(memo, /^🚢 더블오더 작업 \(선박 2척 · 합계 5H\)\n/);
    assert.match(memo, /① SHIP ALPHA · 입항 2026-10-08 08:00 → 출항 2026-10-08 10:00 · 2H/);
    assert.match(memo, /② SHIP BETA · 입항 2026-10-08 13:00 → 출항 2026-10-08 16:00 · 3H/);
    assert.match(memo, /\n\n오늘 메모$/, 'the user text is kept below the block');
    assert.equal(elements.worklogDoubleOrderStatus.classList.contains('is-full'), true);
    assert.match(elements.hjncScheduledShipList.innerHTML, /\[1선박\] SHIP ALPHA/);
    assert.match(elements.hjncScheduledShipList.innerHTML, /\[2선박\] SHIP BETA/);
    assert.match(toasts.at(-1), /더블오더 2척 선택 완료/);
});

test('a vessel typed with a terminal prefix such as "[HJNC] " is still shown as picked', () => {
    const app = setup({ shipName: '[HJNC] SHIP ALPHA' });
    const { context, elements } = app;
    renderDay(app);
    assert.match(elements.hjncScheduledShipList.innerHTML, /class="hjnc-ship-chip is-picked"[^]*?SHIP ALPHA/);
    context.toggleWorklogVesselPick(0);
    assert.equal(elements.logShipName.value, '');
});

test('a third vessel is refused while two are picked', () => {
    const app = setup();
    const { context, elements, toasts } = app;
    renderDay(app);
    context.toggleWorklogVesselPick(0);
    context.toggleWorklogVesselPick(1);
    const before = elements.logMemo.value;
    context.toggleWorklogVesselPick(2);
    assert.equal(elements.logShipName.value, 'SHIP ALPHA / SHIP BETA');
    assert.equal(elements.logMemo.value, before);
    assert.match(toasts.at(-1), /2척까지/);
});

test('deselecting one vessel removes only the generated block and keeps the user text', () => {
    const app = setup({ memo: '사용자 메모' });
    const { context, elements } = app;
    renderDay(app);
    context.toggleWorklogVesselPick(0);
    context.toggleWorklogVesselPick(1);
    assert.match(elements.logMemo.value, /더블오더 작업/);
    context.toggleWorklogVesselPick(0);
    assert.equal(elements.logShipName.value, 'SHIP BETA');
    assert.equal(elements.logMemo.value, '사용자 메모');
});

test('re-syncing never duplicates the block', () => {
    const app = setup({ memo: '메모' });
    const { context, elements } = app;
    renderDay(app);
    context.toggleWorklogVesselPick(0);
    context.toggleWorklogVesselPick(1);
    const once = elements.logMemo.value;
    context.syncWorklogDoubleOrderMemo();
    context.syncWorklogDoubleOrderMemo();
    assert.equal(elements.logMemo.value, once);
    assert.equal(elements.logMemo.value.match(/더블오더 작업/g).length, 1);
});

test('typing two names in the ship field fills the work content on change', () => {
    const app = setup({ shipName: 'SHIP ALPHA / SHIP BETA', memo: '' });
    const { context, elements } = app;
    renderDay(app);
    context.onWorklogShipNameEdited();
    assert.match(elements.logMemo.value, /^🚢 더블오더 작업 \(선박 2척 · 합계 5H\)/);
    assert.match(elements.logMemo.value, /① SHIP ALPHA/);
    elements.logShipName.value = 'SHIP ALPHA';
    context.onWorklogShipNameEdited();
    assert.equal(elements.logMemo.value, '');
});

test('vessels without schedule times are flagged instead of getting fake hours', () => {
    const app = setup({ shipName: 'UNKNOWN SHIP / SHIP BETA', memo: '' });
    const { context, elements } = app;
    renderDay(app);
    context.onWorklogShipNameEdited();
    assert.match(elements.logMemo.value, /① UNKNOWN SHIP · 입·출항 시각 확인 필요/);
    assert.doesNotMatch(elements.logMemo.value, /합계/);
});

test('importing wage-calculator vessels fills the ship field, the calendar and the work content', () => {
    const wageVessels = [
        { name: 'SHIP GAMMA', vessel: SCHEDULE[2], date: '2026-10-08', terminalId: 'hjnc' },
        { name: 'SHIP ALPHA', vessel: SCHEDULE[0], date: '2026-10-08', terminalId: 'hjnc' }
    ];
    const { context, elements } = setup({ memo: '' , wageVessels });
    context.importWageVesselsToWorklog();
    assert.equal(elements.logShipName.value, 'SHIP GAMMA / SHIP ALPHA');
    assert.equal(elements.worklogScheduleDatePicker.value, '2026-10-08');
    assert.match(elements.logMemo.value, /① SHIP GAMMA · 입항 2026-10-08 18:00 → 출항 2026-10-08 20:00 · 2H/);
    assert.match(elements.logMemo.value, /② SHIP ALPHA · 입항 2026-10-08 08:00 → 출항 2026-10-08 10:00 · 2H/);
});

test('opening a work-log day moves the calendar to that day and keeps the saved double-order text', () => {
    const app = setup({ logDate: '2026-10-08' });
    const { context, elements } = app;
    context.adminWorkLogs['2026-10-12'] = { shipName: 'SHIP ALPHA / SHIP BETA', memo: '저장된 메모', wage1: 0, wage2: 0 };
    context.clickDate('2026-10-12');
    assert.equal(elements.dailyLogForm.getAttribute('data-date'), '2026-10-12');
    assert.equal(elements.worklogScheduleDatePicker.value, '2026-10-12');
    assert.equal(elements.logShipName.value, 'SHIP ALPHA / SHIP BETA');
    assert.match(elements.worklogDoubleOrderStatus.textContent, /2\/2/);
});

test('importing with no wage selection only shows a hint', () => {
    const { context, elements, toasts } = setup({ shipName: '' });
    context.importWageVesselsToWorklog();
    assert.equal(elements.logShipName.value, '');
    assert.match(toasts.at(-1), /임금계산기에서 입·출항 선박을 먼저 선택/);
});

test('the work-log box renders the calendar, the double-order status and the toggle handlers', () => {
    assert.match(html, /<div id="worklogDoubleOrderStatus"/);
    assert.match(html, /onclick="toggleWorklogVesselPick\(\$\{index\}\)"/);
    assert.match(html, /onclick="importWageVesselsToWorklog\(\)"/);
    assert.match(html, /placeholder="작업 선박명 \(2척 선택 시 더블오더\)" onchange="onWorklogShipNameEdited\(\)"/);
});
