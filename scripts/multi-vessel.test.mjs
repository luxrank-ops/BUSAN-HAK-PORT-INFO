import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('1. tax select removes 0% option and double-order block has flashing red hint', () => {
    const taxSelectMatch = html.match(/<select id="wageTaxType"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(taxSelectMatch, 'wageTaxType select exists');
    assert.doesNotMatch(taxSelectMatch[1], /공제 없음/);
    assert.match(taxSelectMatch[1], /value="0\.033"/);
    assert.match(taxSelectMatch[1], /value="0\.094"/);

    assert.match(html, /class="wage-action-grid"/);
    assert.match(html, /class="wage-double-card"/);
    assert.match(html, /class="wage-double-hint"[^>]*>\(2번째 작업선박 체크\)/);
    assert.match(html, /@keyframes double-order-flash/);
});

test('2. wage hours grid includes 7:3 per-vessel breakdown cards and square total hours block', () => {
    assert.match(html, /class="wage-hours-grid"/);
    assert.match(html, /class="wage-vessel-hours"/);
    assert.match(html, /⏱️ 선박별 자동계산/);
    assert.match(html, /id="wageHoursBreakdown"/);
    assert.match(html, /id="wageVessel1Name"/);
    assert.match(html, /id="wageVessel2Name"/);
    assert.match(html, /class="wage-hours-total"/);
    assert.match(html, /⏳ 총 근무시간/);
    assert.match(html, /function syncWageHoursBlockSize\(\)/);
});

test('3. selecting up to 2 vessels auto-checks double order, sums hours, and calculates segments for logWage1 & logWage2', async () => {
    const elements = {};
    const make = (id, value = '') => (elements[id] = {
        value,
        checked: false,
        readOnly: false,
        dataset: {},
        innerText: '',
        innerHTML: '',
        textContent: '',
        classList: {
            values: new Set(id === 'dailyLogForm' ? ['hidden'] : id === 'log-card' ? ['expanded'] : []),
            add(name) { this.values.add(name); },
            remove(name) { this.values.delete(name); },
            contains(name) { return this.values.has(name); }
        },
        getAttribute(name) { return name === 'data-date' ? this.date : null; },
        scrollIntoView() {}
    });

    [
        'wageTotalHours', 'wageHoursBreakdown', 'wageStartDate', 'wageStartHour',
        'wageEndDate', 'wageEndHour', 'role-skilled', 'role-onshore', 'wageHoliday',
        'wageWeekend', 'wageRain', 'wageHotTime', 'wageTaxType', 'wageHourly',
        'wageShipName', 'wageDoubleOrder', 'wageSpecBody', 'wageTotal',
        'wageResultTitle', 'wageResultBox', 'dailyLogForm', 'log-card', 'wage-card',
        'logWage1', 'logWage2', 'logShipName', 'logMemo', 'wageScheduleDatePicker',
        'wageAllowanceType', 'wageAllowanceHours'
    ].forEach(id => make(id));

    elements.wageTaxType.value = '0.033';
    elements.wageHourly.value = '10320';
    elements.wageStartDate.value = '2026-10-10';
    elements.wageEndDate.value = '2026-10-10';
    elements.wageStartHour.value = '8';
    elements.wageEndHour.value = '10';

    const messages = [];
    const logs = {};
    const scheduleVessels = [
        { VSL_NM: 'SHIP ALPHA', ATA: '2026-10-10 08:00', ATD: '2026-10-10 10:00', BERTH_NO: '1' },
        { VSL_NM: 'SHIP BETA', ATA: '2026-10-10 13:00', ATD: '2026-10-10 16:00', BERTH_NO: '2' },
        { VSL_NM: 'SHIP GAMMA', ATA: '2026-10-10 18:00', ATD: '2026-10-10 20:00', BERTH_NO: '3' }
    ];

    const terminalsCode = readFileSync(new URL('../public/js/terminals.js', import.meta.url), 'utf8');
    const wageCode = readFileSync(new URL('../public/js/wage.js', import.meta.url), 'utf8');

    const context = vm.createContext({
        document: { getElementById: id => elements[id] },
        localStorage: { getItem: () => 'hjnc', setItem() {} },
        currentWorkerId: 'worker',
        adminWorkLogs: logs,
        terminalQuickConfig: { hjnc: { schedule: '', chart: '' } },
        extractDatePrefix(str) {
            const m = String(str || '').match(/^(\d{4}-\d{2}-\d{2})/);
            return m ? m[1] : '';
        },
        extractShortTime(str) {
            const m = String(str || '').match(/(\d{2}:\d{2})/);
            return m ? m[1] : '';
        },
        isVesselActiveOnDate: () => true,
        escapeShipCommentHtml: s => String(s || ''),
        getAppLocalDateString: () => '2026-10-10',
        fetchHjncScheduleForMonth: async () => scheduleVessels,
        jumpToLogDate(date) {
            elements.dailyLogForm.date = date;
            elements.dailyLogForm.classList.remove('hidden');
        },
        toggleDashItem() {},
        trackAppEvent() {},
        showToast(msg) { messages.push(msg); },
        alert(msg) { messages.push(msg); },
        setTimeout() {},
        console: { error() {}, warn() {} }
    });

    vm.runInContext(`${terminalsCode}\n${wageCode}`, context);

    // Select 1st vessel (2 hours: 08~10)
    context.applyWageScheduleShip(scheduleVessels[0], '2026-10-10', 'hjnc');
    assert.equal(elements.wageShipName.value, 'SHIP ALPHA');
    assert.equal(elements.wageDoubleOrder.checked, false);
    assert.equal(elements.wageTotalHours.value, '2');
    assert.equal(elements.wageTotalHours.readOnly, false);

    // Select 2nd vessel (3 hours: 13~16) -> total 5 hours
    context.applyWageScheduleShip(scheduleVessels[1], '2026-10-10', 'hjnc');
    assert.equal(elements.wageShipName.value, 'SHIP ALPHA / SHIP BETA');
    assert.equal(elements.wageDoubleOrder.checked, true);
    assert.equal(String(elements.wageTotalHours.value), '5');
    assert.equal(elements.wageTotalHours.readOnly, true);

    // Attempt 3rd vessel -> blocked at 2 vessels
    context.applyWageScheduleShip(scheduleVessels[2], '2026-10-10', 'hjnc');
    assert.match(messages.at(-1), /최대 2척/);
    assert.equal(elements.wageShipName.value, 'SHIP ALPHA / SHIP BETA');

    // Calculate multi-vessel wage
    context.calculateWage();
    const calc = vm.runInContext('lastCalculatedWageData', context);
    assert.equal(calc.isMultiVessel, true);
    assert.equal(calc.isDoubleOrder, true);
    assert.equal(calc.segments.length, 2);
    assert.equal(calc.segments[0].name, 'SHIP ALPHA');
    assert.equal(calc.segments[0].hours, 2);
    assert.equal(calc.segments[1].name, 'SHIP BETA');
    assert.equal(calc.segments[1].hours, 3);
    assert.equal(calc.totalPay, calc.segments[0].totalPay + calc.segments[1].totalPay);

    // Send to work log -> fills logWage1 and logWage2 separately
    await context.sendCalculatedWageToLog();
    assert.equal(elements.logWage1.value, calc.segments[0].totalPay);
    assert.equal(elements.logWage2.value, calc.segments[1].totalPay);
    assert.equal(elements.logShipName.value, 'SHIP ALPHA / SHIP BETA');
    assert.match(elements.logMemo.value, /\[더블오더 · 임금 1 · SHIP ALPHA\]/);
    assert.match(elements.logMemo.value, /\[더블오더 · 임금 2 · SHIP BETA\]/);
});
