import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
    readAppJs, readAppHtml, readAppCssBody, readAppFile, APP_ASSET_VERSION,
    extractFunction as extractFunctionShared, extractDeclaration as extractDeclarationShared
} from './app-source.mjs';

// ⏱️ 내 근무시간 통계 (로그인 근무자) 회귀 테스트
// - 근무일지 카드의 "기간·키워드 검색" 자리를 근무시간 통계 블럭으로 교체했습니다.
// - 총근무시간 / 평일 / 주간 / 야간 / 주말·공휴일 5가지 집계 규칙을 고정합니다.
const appJs = readAppJs();
const html = readAppHtml();
const css = readAppCssBody();

function extractFunction(name) {
    const body = extractFunctionShared(appJs, name);
    if (body === null) throw new Error(`function not found: ${name}`);
    return body;
}
function extractDeclaration(name) {
    const body = extractDeclarationShared(appJs, name);
    if (body === null) throw new Error(`declaration not found: ${name}`);
    return body;
}

// ---- 순수 집계 함수 실행 환경 ----------------------------------------------
function setupStats() {
    const document = makeStubDocument();
    const context = vm.createContext({
        console, document, Number, String, Array, Object, Date, RegExp, Math, Set, Map,
        trackAppEvent: () => {}
    });
    vm.runInContext('let currentWorkerId = "이춘학";', context);
    for (const fn of ['extractWorkLogTimeAndWageMetrics', 'roundWorkHours1', 'buildWorkHourStats',
        'formatWorkHourValue', 'workHourStatsPercent', 'getWorkHourStatsRange', 'renderWorkHourStats',
        'syncWorkHourStatsAria', 'setWorkHourStatsExpanded', 'openWorkHourStats', 'toggleWorkHourStats']) {
        vm.runInContext(extractFunction(fn), context);
    }
    return {
        context,
        document,
        build: (logs) => vm.runInContext(`buildWorkHourStats(${JSON.stringify(logs)})`, context),
        render: (stats, meta) => vm.runInContext(
            `renderWorkHourStats(${JSON.stringify(stats)}, ${JSON.stringify(meta || {})})`, context),
        range: (period, isoDate) => vm.runInContext(
            `getWorkHourStatsRange(${JSON.stringify(period)}, new Date(${JSON.stringify(isoDate)}))`, context)
    };
}

function makeStubDocument() {
    const nodes = {};
    const make = (id) => ({
        id,
        innerText: '',
        style: {},
        attrs: {},
        _classes: new Set(),
        classList: {
            add: (c) => nodes[id]._classes.add(c),
            remove: (c) => nodes[id]._classes.delete(c),
            contains: (c) => nodes[id]._classes.has(c),
            toggle: (c, force) => {
                const on = force === undefined ? !nodes[id]._classes.has(c) : !!force;
                if (on) nodes[id]._classes.add(c); else nodes[id]._classes.delete(c);
                return on;
            }
        },
        setAttribute(k, v) { nodes[id].attrs[k] = v; },
        getAttribute(k) { return nodes[id].attrs[k] ?? null; }
    });
    return {
        nodes,
        getElementById(id) { if (!nodes[id]) nodes[id] = make(id); return nodes[id]; },
        querySelectorAll() { return []; }
    };
}

const LOG_DAY = {
    date: '2026-11-02', shipName: 'CMA CGM AUSTRAL', totalPay: 120000,
    memo: '[본선] 2026-11-02 08시~2026-11-02 20시 · 총 12H (주간 12H / 야간 0H / 주말·공휴일 0H)'
};
const LOG_WEEKEND = {
    date: '2026-11-07', shipName: 'MAGNA', totalPay: 90000,
    memo: '총 8H (주간 4H / 야간 4H / 주말·공휴일 8H)'
};

// ---- 1. 화면 구조 ----------------------------------------------------------
test('화면: 근무일지 카드의 기간·키워드 검색 자리가 근무시간 통계 블럭으로 바뀌었다', () => {
    assert.ok(html.includes('id="workHourStatsBox"'), 'missing #workHourStatsBox');
    for (const id of ['whStatTotal', 'whStatWeekday', 'whStatDay', 'whStatNight', 'whStatWeekend',
        'whStatWeekdayPct', 'whStatDayPct', 'whStatNightPct', 'whStatWeekendPct',
        'whStatTotalSub', 'whBarDay', 'whBarNight', 'workHourStatsRange', 'workHourStatsNote',
        'workHourStatsPeriodBar',
        'whStatTotalBreak', 'whStatWeekdayBreak', 'whStatDayBreak', 'whStatNightBreak', 'whStatWeekendBreak',
        'whQWeekdayDay', 'whQWeekdayNight', 'whQWeekendDay', 'whQWeekendNight', 'whQuadSum',
        'whStatQuadrantDetails', 'workHourStatsHeader', 'workHourStatsBody', 'workHourStatsHeadTotal']) {
        assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `duplicate #${id}`);
    }
    // 5개 항목 라벨
    for (const label of ['총근무시간', '평일 근무시간', '주간 근무시간', '야간 근무시간', '주말·공휴일 근무시간']) {
        assert.ok(html.includes(label), `missing label ${label}`);
    }
    // 기간 선택 4개
    assert.equal((html.match(/class="work-hours-period-btn/g) || []).length, 4);
    for (const period of ['month', 'prev', 'year', 'all']) {
        assert.ok(html.includes(`onclick="setWorkHourStatsPeriod('${period}')"`), `missing period ${period}`);
    }
    // 기존 기간·키워드 검색 UI 는 사라졌다 (중복·잔여 금지)
    for (const legacyId of ['logExtraLockBanner', 'logExtraFilterContent', 'logFilterStartDate',
        'logFilterEndDate', 'logFilterKeyword', 'logFilterResults']) {
        assert.equal(html.includes(`id="${legacyId}"`), false, `legacy UI remains: #${legacyId}`);
    }
    // 근무일지 카드 안(달력 위)에 위치
    const statsIdx = html.indexOf('id="workHourStatsBox"');
    const calendarIdx = html.indexOf('id="calendarGrid"');
    assert.ok(statsIdx > 0 && statsIdx < calendarIdx, 'stats block should sit above the calendar');
});

test('펼침: 근무시간 통계는 접힌 상태로 시작하고 헤더를 누르면 펼쳐진다', () => {
    // 기본은 접힘 — 블럭에 is-collapsed, 본문에 hidden, 헤더 aria-expanded=false
    assert.match(html, /id="workHourStatsBox" class="work-hours-box is-collapsed"/);
    assert.match(html, /id="workHourStatsBody" class="work-hours-body hidden"/);
    assert.match(html, /id="workHourStatsHeader"[\s\S]{0,300}?aria-expanded="false"/);
    assert.match(html, /id="workHourStatsHeader"[\s\S]{0,300}?aria-controls="workHourStatsBody"/);
    assert.ok(html.includes('onclick="toggleWorkHourStats()"'), '헤더 클릭으로 펼침');
    assert.ok(html.includes("onkeydown=\"if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleWorkHourStats();}\""));
    // 펼치면 보이는 내용은 전부 본문(#workHourStatsBody) 안에 있어야 한다
    const bodyStart = html.indexOf('id="workHourStatsBody"');
    const bodyEnd = html.indexOf('id="workHourStatsNote"', bodyStart);
    assert.ok(bodyStart > 0 && bodyEnd > bodyStart);
    for (const inner of ['workHourStatsPeriodBar', 'whStatTotal', 'whStatWeekday', 'whStatDay',
        'whStatNight', 'whStatWeekend', 'whStatQuadrantDetails']) {
        const idx = html.indexOf(`id="${inner}"`);
        assert.ok(idx > bodyStart, `#${inner} 는 접히는 본문 안에 있어야 합니다`);
    }
    // 헤더에는 접힌 상태에서도 보이는 요약(총 시간)이 있다
    const headStart = html.indexOf('id="workHourStatsHeader"');
    const headEnd = html.indexOf('id="workHourStatsBody"');
    const headHtml = html.slice(headStart, headEnd);
    assert.ok(headHtml.includes('id="workHourStatsHeadTotal"'), '헤더 요약(총 시간)');
    assert.ok(headHtml.includes('work-hours-chevron'), '펼침 표시(▼)');
});

test('스타일: 근무시간 통계는 디자인 토큰 클래스로만 그린다', () => {
    for (const cls of ['.work-hours-box', '.work-hours-grid', '.work-hours-card', '.work-hours-value',
        '.work-hours-period-btn.is-active', '.work-hours-bar', '.work-hours-note',
        '.work-hours-break', '.work-hours-quad', '.work-hours-quad-grid', '.work-hours-quad-cell',
        '.work-hours-head', '.work-hours-head-side', '.work-hours-head-total', '.work-hours-chevron',
        '.work-hours-body', '.work-hours-box:not(.is-collapsed) .work-hours-chevron']) {
        assert.ok(css.includes(cls), `missing css ${cls}`);
    }
    // 라이트/다크 모두 대응
    assert.ok((css.match(/body\.dark-mode \.work-hours-card/g) || []).length >= 1);
});

// ---- 2. 집계 규칙 ----------------------------------------------------------
test('집계: 총/주간/야간/주말·공휴일 합계와 근무일수·추정일수를 계산한다', () => {
    const stats = setupStats();
    const out = stats.build([LOG_DAY, LOG_WEEKEND]);
    assert.equal(out.days, 2);
    assert.equal(out.totalHours, 20, '12H + 8H');
    assert.equal(out.dayHours, 16, '주간 12H + 4H');
    assert.equal(out.nightHours, 4, '야간 0H + 4H');
    assert.equal(out.weekendHours, 8, '주말·공휴일 8H');
    assert.equal(out.weekdayHours, 12, '평일 = 평일주간 + 평일야간 (총 − 주말·공휴일)');
    assert.equal(out.weekdayHours, 12);
    assert.equal(out.totalPay, 210000);
    assert.equal(out.timeRecordedDays, 2);
    assert.equal(out.estimatedDays, 0);
});

test('4분면: 평일 = 평일주간 + 평일야간, 주말·공휴일 = 주말주간 + 주말야간 으로 나뉘고 4개 합이 총근무시간이다', () => {
    const stats = setupStats();
    const out = stats.build([LOG_DAY, LOG_WEEKEND]);
    // 평일 기록(12H 전부 주간) → 평일 주간 12 / 평일 야간 0
    assert.equal(out.weekdayDayHours, 12);
    assert.equal(out.weekdayNightHours, 0);
    // 토요일 기록(주간 4 / 야간 4) → 주말 주간 4 / 주말 야간 4
    assert.equal(out.weekendDayHours, 4);
    assert.equal(out.weekendNightHours, 4);
    // 파생 값 검산
    assert.equal(out.weekdayHours, out.weekdayDayHours + out.weekdayNightHours);
    assert.equal(out.weekendHours, out.weekendDayHours + out.weekendNightHours);
    assert.equal(out.dayHours, out.weekdayDayHours + out.weekendDayHours);
    assert.equal(out.nightHours, out.weekdayNightHours + out.weekendNightHours);
    assert.equal(out.totalHours, out.weekdayDayHours + out.weekdayNightHours + out.weekendDayHours + out.weekendNightHours);
    assert.equal(out.totalHours, out.weekdayHours + out.weekendHours);
    assert.equal(out.totalHours, out.dayHours + out.nightHours);
});

test('4분면: 어떤 조합에서도 (평일주간+평일야간)+(주말주간+주말야간) = 총 이 맞는다', () => {
    const stats = setupStats();
    const nightShift = {
        date: '2026-11-08', shipName: 'ULTIMA', totalPay: 150000,
        memo: '총 9H (주간 0H / 야간 9H / 주말·공휴일 9H)'
    };
    const mixed = {
        date: '2026-11-05', shipName: 'MAGNA', totalPay: 160000,
        memo: '총 12.5H (주간 9.5H / 야간 3H / 주말·공휴일 0H)'
    };
    const onlyPayWeekend = { date: '2026-11-07', shipName: 'WILLIAM', totalPay: 100000 };
    const sets = [
        [], [nightShift], [mixed], [onlyPayWeekend],
        [LOG_DAY, LOG_WEEKEND], [nightShift, mixed], [nightShift, mixed, onlyPayWeekend, LOG_DAY, LOG_WEEKEND]
    ];
    for (const logs of sets) {
        const out = stats.build(logs);
        const r = (v) => Math.round(v * 10) / 10;
        const quadSum = r(out.weekdayDayHours + out.weekdayNightHours + out.weekendDayHours + out.weekendNightHours);
        assert.equal(quadSum, r(out.totalHours), '4분면 합 = 총근무시간');
        assert.equal(r(out.weekdayHours + out.weekendHours), r(out.totalHours), '평일 + 주말 = 총');
        assert.equal(r(out.dayHours + out.nightHours), r(out.totalHours), '주간 + 야간 = 총');
        assert.equal(r(out.weekdayHours), r(out.weekdayDayHours + out.weekdayNightHours), '평일 = 평일주간 + 평일야간');
        assert.equal(r(out.weekendHours), r(out.weekendDayHours + out.weekendNightHours), '주말 = 주말주간 + 주말야간');
        assert.equal(r(out.dayHours), r(out.weekdayDayHours + out.weekendDayHours), '주간 = 평일주간 + 주말주간');
        assert.equal(r(out.nightHours), r(out.weekdayNightHours + out.weekendNightHours), '야간 = 평일야간 + 주말야간');
        for (const key of ['weekdayDayHours', 'weekdayNightHours', 'weekendDayHours', 'weekendNightHours']) {
            assert.ok(out[key] >= 0, `${key} 는 음수가 될 수 없습니다`);
        }
    }
});

test('4분면: 자정을 넘긴 근무(금 20시→토 04시)는 평일야간 4H + 주말야간 4H 로 정확히 갈린다', () => {
    const stats = setupStats();
    const out = stats.build([{
        date: '2026-11-06', totalPay: 150000,
        memo: '① ULTIMA 입항 2026-11-06 20:00 → 출항 2026-11-07 04:00 · 8H'
    }]);
    assert.equal(out.weekdayNightHours, 4, '금요일 20~24시');
    assert.equal(out.weekendNightHours, 4, '토요일 0~4시');
    assert.equal(out.weekdayDayHours, 0);
    assert.equal(out.weekendDayHours, 0);
    assert.equal(out.weekdayHours, 4);
    assert.equal(out.weekendHours, 4);
    assert.equal(out.dayHours, 0);
    assert.equal(out.nightHours, 8);
    assert.equal(out.totalHours, 8);
});

test('4분면: 주말 야간 근무는 주말야간에만 잡히고 평일 값은 0 이다', () => {
    const stats = setupStats();
    const out = stats.build([{
        date: '2026-11-08', shipName: 'ULTIMA', totalPay: 150000,
        memo: '총 9H (주간 0H / 야간 9H / 주말·공휴일 9H)'
    }]);
    assert.equal(out.weekendNightHours, 9);
    assert.equal(out.weekendDayHours, 0);
    assert.equal(out.weekdayDayHours, 0);
    assert.equal(out.weekdayNightHours, 0);
    assert.equal(out.nightHours, 9);
    assert.equal(out.weekdayHours, 0);
    assert.equal(out.weekendHours, 9);
});

test('집계: 평일 + 주말·공휴일 = 총근무시간, 주간 + 야간 ≤ 총근무시간 이 항상 성립한다', () => {
    const stats = setupStats();
    for (const logs of [[], [LOG_DAY], [LOG_WEEKEND], [LOG_DAY, LOG_WEEKEND]]) {
        const out = stats.build(logs);
        assert.equal(
            Math.round((out.weekdayHours + out.weekendHours) * 10),
            Math.round(out.totalHours * 10),
            '평일 + 주말 = 총'
        );
        assert.ok(out.dayHours + out.nightHours <= out.totalHours + 0.001, '주간 + 야간 ≤ 총');
        assert.ok(out.weekendHours >= 0 && out.weekdayHours >= 0);
    }
});

test('집계: 금액만 있는 기록은 시간을 추정하고 추정 일수로 표시한다', () => {
    const stats = setupStats();
    const out = stats.build([{ date: '2026-11-09', shipName: 'ULTIMA', totalPay: 120000 }]);
    assert.equal(out.days, 1);
    assert.ok(out.totalHours > 0, '급여 → 시간 추정');
    assert.equal(out.estimatedDays, 1);
    assert.equal(out.timeRecordedDays, 0);
    assert.equal(out.totalPay, 120000);
});

test('집계: 빈 기록은 근무일수에서 제외한다', () => {
    const stats = setupStats();
    const out = stats.build([{ date: '2026-11-03' }, null, { date: '2026-11-04', totalPay: 0 }]);
    assert.equal(out.days, 0);
    assert.equal(out.totalHours, 0);
    assert.equal(out.weekdayHours, 0);
});

test('집계: date→log 맵(Object)도 그대로 받는다', () => {
    const stats = setupStats();
    const asMap = { '2026-11-02': LOG_DAY, '2026-11-07': LOG_WEEKEND };
    const out = vm.runInContext(`buildWorkHourStats(${JSON.stringify(asMap)})`, stats.context);
    assert.equal(out.days, 2);
    assert.equal(out.totalHours, 20);
});

// ---- 3. 비율·표시 ----------------------------------------------------------
test('표시: 시간·비율 문자열', () => {
    const stats = setupStats();
    const fmt = (v) => vm.runInContext(`formatWorkHourValue(${v})`, stats.context);
    const pct = (a, b) => vm.runInContext(`workHourStatsPercent(${a}, ${b})`, stats.context);
    assert.equal(fmt(0), '0시간');
    assert.equal(fmt(12), '12시간');
    assert.equal(fmt(12.25), '12.3시간');
    assert.equal(fmt(128.5), '128.5시간');
    assert.equal(pct(12, 20), 60);
    assert.equal(pct(0, 0), 0, '0으로 나누지 않는다');
    assert.equal(pct(10, 8), 100, '100% 상한');
});

// ---- 4. 기간 범위 ----------------------------------------------------------
test('기간: 이번 달 / 지난 달 / 올해 / 전체 범위를 정확히 만든다', () => {
    const stats = setupStats();
    const month = stats.range('month', '2026-11-10T09:00:00');
    assert.deepEqual({ ...month }, {
        start: '2026-11-01', end: '2026-11-30', title: '2026년 11월', label: '2026.11.01 ~ 2026.11.30'
    });
    const prev = stats.range('prev', '2026-11-10T09:00:00');
    assert.equal(prev.start, '2026-10-01');
    assert.equal(prev.end, '2026-10-31');
    assert.equal(prev.title, '2026년 10월');
    const janPrev = stats.range('prev', '2026-01-15T09:00:00');
    assert.equal(janPrev.start, '2025-12-01', '1월의 지난 달 = 작년 12월');
    assert.equal(janPrev.end, '2025-12-31');
    const year = stats.range('year', '2026-11-10T09:00:00');
    assert.equal(year.start, '2026-01-01');
    assert.equal(year.end, '2026-12-31');
    const all = stats.range('all', '2026-11-10T09:00:00');
    assert.equal(all.start, '');
    assert.equal(all.end, '');
    // 윤년 2월
    const feb = stats.range('month', '2028-02-10T09:00:00');
    assert.equal(feb.end, '2028-02-29');
});

// ---- 5. 화면 반영 ----------------------------------------------------------
test('화면 반영: 5개 값·비율·기간·안내문을 DOM 에 쓴다', () => {
    const stats = setupStats();
    const out = stats.build([LOG_DAY, LOG_WEEKEND]);
    stats.render(out, { period: 'month', title: '2026년 11월', label: '2026.11.01 ~ 2026.11.30' });
    const nodes = stats.document.nodes;
    assert.equal(nodes.whStatTotal.innerText, '20시간');
    assert.equal(nodes.whStatWeekday.innerText, '12시간');
    assert.equal(nodes.whStatDay.innerText, '16시간');
    assert.equal(nodes.whStatNight.innerText, '4시간');
    assert.equal(nodes.whStatWeekend.innerText, '8시간');
    assert.equal(nodes.whStatTotalSub.innerText, '근무 2일');
    assert.equal(nodes.whStatWeekdayPct.innerText, '60%');
    assert.equal(nodes.whStatDayPct.innerText, '80%');
    assert.equal(nodes.whStatNightPct.innerText, '20%');
    assert.equal(nodes.whStatWeekendPct.innerText, '40%');
    assert.equal(nodes.whBarDay.style.width, '80.0%');
    assert.equal(nodes.whBarNight.style.width, '20.0%');
    assert.match(nodes.workHourStatsRange.innerText, /2026년 11월/);
    assert.match(nodes.workHourStatsRange.innerText, /근무 2일/);
    // 하위 분해 문구 — 화면에서 바로 검산할 수 있어야 합니다.
    assert.equal(nodes.whStatTotalBreak.innerText, '12 + 8 = 20시간');
    assert.equal(nodes.whStatWeekdayBreak.innerText, '☀️ 12 + 🌙 0');
    assert.equal(nodes.whStatDayBreak.innerText, '평일 12 + 주말 4');
    assert.equal(nodes.whStatNightBreak.innerText, '평일 0 + 주말 4');
    assert.equal(nodes.whStatWeekendBreak.innerText, '☀️ 4 + 🌙 4');
    // 4분면 자세히
    assert.equal(nodes.whQWeekdayDay.innerText, '12시간');
    assert.equal(nodes.whQWeekdayNight.innerText, '0시간');
    assert.equal(nodes.whQWeekendDay.innerText, '4시간');
    assert.equal(nodes.whQWeekendNight.innerText, '4시간');
    assert.match(nodes.whQuadSum.innerText, /20시간/);
    // 비율 짝은 100% 가 되어야 합니다.
    assert.equal(nodes.whStatWeekdayPct.innerText, '60%');
    assert.equal(nodes.whStatWeekendPct.innerText, '40%');
    assert.equal(nodes.whStatDayPct.innerText, '80%');
    assert.equal(nodes.whStatNightPct.innerText, '20%');
});

test('화면 반영: 추정 일수·오프라인 안내를 덧붙인다', () => {
    const stats = setupStats();
    const out = stats.build([{ date: '2026-11-09', shipName: 'ULTIMA', totalPay: 120000 }]);
    stats.render(out, { period: 'year', title: '2026년', label: '', offline: true });
    const note = stats.document.nodes.workHourStatsNote.innerText;
    assert.match(note, /불러온 기록만/);
    assert.match(note, /1일은 급여로 시간을 추정/);
    assert.match(stats.document.nodes.workHourStatsRange.innerText, /2026년/);
});

test('펼침 동작: 토글하면 class·hidden·aria-expanded 가 함께 바뀐다', () => {
    const stats = setupStats();
    const box = stats.document.getElementById('workHourStatsBox');
    const body = stats.document.getElementById('workHourStatsBody');
    const header = stats.document.getElementById('workHourStatsHeader');
    box.classList.add('is-collapsed');
    body.classList.add('hidden');

    const run = (code) => vm.runInContext(code, stats.context);

    run('toggleWorkHourStats()');
    assert.equal(box.classList.contains('is-collapsed'), false, '펼쳐짐');
    assert.equal(body.classList.contains('hidden'), false, '본문 표시');
    assert.equal(header.getAttribute('aria-expanded'), 'true');

    run('toggleWorkHourStats()');
    assert.equal(box.classList.contains('is-collapsed'), true, '접힘');
    assert.equal(body.classList.contains('hidden'), true, '본문 숨김');
    assert.equal(header.getAttribute('aria-expanded'), 'false');

    run('openWorkHourStats()');
    assert.equal(box.classList.contains('is-collapsed'), false, 'openWorkHourStats 는 항상 펼침');
    run('openWorkHourStats()');
    assert.equal(box.classList.contains('is-collapsed'), false, '이미 펼쳐져 있어도 유지');

    run('setWorkHourStatsExpanded(false)');
    assert.equal(box.classList.contains('is-collapsed'), true);
    assert.equal(header.getAttribute('aria-expanded'), 'false');
});

test('함수 배선: 기간 선택·갱신·캐시 무효화가 서로 연결되어 있다', () => {
    for (const fn of ['buildWorkHourStats', 'refreshWorkHourStats', 'setWorkHourStatsPeriod',
        'invalidateWorkHourStatsCache', 'renderWorkHourStats', 'getWorkHourStatsRange',
        'collectLoadedWorkLogsForStats', 'fetchWorkLogsForStats']) {
        assert.ok(extractFunction(fn).length > 0, `missing function ${fn}`);
    }
    for (const fn of ['toggleWorkHourStats', 'openWorkHourStats', 'setWorkHourStatsExpanded', 'syncWorkHourStatsAria']) {
        assert.ok(extractFunction(fn).length > 0, `missing function ${fn}`);
    }
    assert.ok(extractFunction('toggleWorkHourStats').includes('setWorkHourStatsExpanded'));
    assert.ok(extractFunction('syncWorkHourStatsAria').includes('aria-expanded'));
    const setter = extractFunction('setWorkHourStatsPeriod');
    assert.ok(setter.includes('refreshWorkHourStats'));
    assert.ok(setter.includes('WORK_HOUR_STATS_PERIODS'), '알 수 없는 기간은 무시해야 합니다');
    const refresh = extractFunction('refreshWorkHourStats');
    assert.ok(refresh.includes('currentWorkerId'), '로그인 여부를 확인해야 합니다');
    assert.ok(refresh.includes('fetchWorkLogsForStats'), '다른 기간은 서버 조회로 집계합니다');
    assert.ok(refresh.includes('workHourStatsCache'), '같은 기간 재조회를 캐시로 막습니다');
    // 달력 갱신 시 통계도 함께 갱신
    const renderCal = extractFunction('renderCalendar');
    assert.ok(renderCal.includes('refreshWorkHourStats'));
    assert.ok(renderCal.includes('invalidateWorkHourStatsCache'));
    // 잔여 코드 정리 확인 (죽은 검색 UI 함수 제거)
    assert.equal(appJs.includes('function applyWorkLogFilter'), false);
    assert.equal(appJs.includes('function searchWorkLogsRange'), false);
});

test('기간·키워드 검색: 화면·스크립트·스타일에서 완전히 삭제되었다', () => {
    // 1) 마크업에 검색 UI 의 흔적이 없다
    for (const legacyId of ['logExtraLockBanner', 'logExtraFilterContent', 'logFilterStartDate',
        'logFilterEndDate', 'logFilterKeyword', 'logFilterResults']) {
        assert.equal(html.includes(legacyId), false, `마크업에 잔여: ${legacyId}`);
    }
    // 2) 스크립트에 검색 관련 식별자·문구가 없다
    for (const token of ['logFilter', 'log-filter', 'applyWorkLogFilter', 'searchWorkLogsRange',
        '검색·상세'] ) {
        assert.equal(appJs.includes(token), false, `app.js 에 잔여: ${token}`);
        assert.equal(html.includes(token), false, `index.html 에 잔여: ${token}`);
    }
    // 3) 스타일시트에 죽은 클래스가 없다 (.log-filter-*, 달력 필터 강조)
    const css = readAppFile('public/css/app.css');
    for (const token of ['.log-filter-box', '.log-filter-results', '.log-filter-item',
        '.filter-match', '.filter-dim']) {
        assert.equal(css.includes(token), false, `app.css 에 잔여: ${token}`);
    }
    // 4) 잠금 해제 안내 문구도 검색을 언급하지 않는다
    assert.ok(appJs.includes('추가 기능(상세 통계)'), '잠금 해제 문구가 갱신되어야 합니다');
});

test('에셋 버전: index.html·service-worker 가 같은 버전을 쓴다', () => {
    assert.ok(html.includes(`app.js?v=${APP_ASSET_VERSION}`));
    assert.ok(html.includes(`app.css?v=${APP_ASSET_VERSION}`));
    const sw = readAppFile('public/service-worker.js');
    assert.ok(sw.includes(`busan-hak-port-v${APP_ASSET_VERSION}`), 'service-worker 캐시 버전');
    assert.ok(sw.includes(`/css/app.css?v=${APP_ASSET_VERSION}`), 'service-worker 프리캐시 목록');
});
