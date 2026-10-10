import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const terminalsCode = readFileSync(new URL('../public/js/terminals.js', import.meta.url), 'utf8');
const wageCode = readFileSync(new URL('../public/js/wage.js', import.meta.url), 'utf8');

function setup() {
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
        'wageTotalHours', 'wageHoursBreakdown', 'wageVessel1Name', 'wageVessel1Hours',
        'wageVessel2Name', 'wageVessel2Hours', 'wageStartDate', 'wageStartHour',
        'wageEndDate', 'wageEndHour', 'role-skilled', 'role-onshore', 'wageHoliday',
        'wageWeekend', 'wageRain', 'wageHotTime', 'wageHourly',
        'wageShipName', 'wageDoubleOrder', 'wageSpecBody', 'wageTotal',
        'wageResultTitle', 'wageResultBox', 'dailyLogForm', 'log-card', 'wage-card',
        'logWage1', 'logWage2', 'logShipName', 'logMemo', 'wageScheduleDatePicker',
        'wageAllowanceType', 'wageAllowanceHours'
    ].forEach(id => make(id));

    elements.wageHourly.value = '10320';
    elements.wageStartDate.value = '2026-10-08';
    elements.wageEndDate.value = '2026-10-08';
    elements.wageStartHour.value = '8';
    elements.wageEndHour.value = '10';

    const messages = [];
    const logs = {};
    const scheduleVessels = [
        { VSL_NM: 'SHIP ALPHA', ATA: '2026-10-08 08:00', ATD: '2026-10-08 10:00', BERTH_NO: '1' },
        { VSL_NM: 'SHIP BETA', ATA: '2026-10-08 13:00', ATD: '2026-10-08 16:00', BERTH_NO: '2' },
        { VSL_NM: 'SHIP GAMMA', ATA: '2026-10-08 18:00', ATD: '2026-10-08 20:00', BERTH_NO: '3' }
    ];

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
        getAppLocalDateString: () => '2026-10-08',
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

    return { context, elements, messages, scheduleVessels };
}

test('no freelancer/insurance selector or withholding is applied to calculated wages', () => {
    assert.doesNotMatch(html, /id="wageTaxType"|프리랜서 \(3\.3%\)|4대 보험 \(9\.4%\)/);

    const { context, elements } = setup();
    elements.wageTotalHours.value = '2';
    elements.wageStartHour.value = '7';
    elements.wageEndHour.value = '9';

    context.calculateWage();

    assert.doesNotMatch(elements.wageSpecBody.innerHTML, /원천징수|공제액|보험/);
    assert.equal(elements.wageTotal.innerText, '20,640원');
});

test('double-order block has flashing red hint', () => {
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
    const { context, elements, messages, scheduleVessels } = setup();

    // Select 1st vessel (2 hours: 08~10)
    context.applyWageScheduleShip(scheduleVessels[0], '2026-10-08', 'hjnc');
    assert.equal(elements.wageShipName.value, 'SHIP ALPHA');
    assert.equal(elements.wageDoubleOrder.checked, false);
    assert.equal(elements.wageTotalHours.value, '2');
    assert.equal(elements.wageTotalHours.readOnly, false);

    // Select 2nd vessel (3 hours: 13~16) -> total 5 hours
    context.applyWageScheduleShip(scheduleVessels[1], '2026-10-08', 'hjnc');
    assert.equal(elements.wageShipName.value, 'SHIP ALPHA / SHIP BETA');
    assert.equal(elements.wageDoubleOrder.checked, true);
    assert.equal(String(elements.wageTotalHours.value), '5');
    assert.equal(elements.wageTotalHours.readOnly, true);

    // Attempt 3rd vessel -> blocked at 2 vessels
    context.applyWageScheduleShip(scheduleVessels[2], '2026-10-08', 'hjnc');
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
