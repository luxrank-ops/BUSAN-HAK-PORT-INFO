import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppJs, extractFunction } from './app-source.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
// A-1 (2026-10-17): 앱 로직은 인라인 스크립트에서 public/js/* 로 이동 — 함수 추출은 통합 JS 에서.
const appJs = readAppJs();
const segmentFn = appJs.split('function calculateWageSegment(')[1].split('function calculateWage() {')[0];
const calculator = appJs.split('function calculateWage() {')[1].split('function onWageShipNameChange(')[0];
const transfer = appJs.split('let wageToLogTransferPending = false;')[1].split('async function sendWorkLogShipToWage(')[0];
const activeWorkLogDate = extractFunction(appJs, 'getActiveWorkLogDate');
const wageLogTargetDate = extractFunction(appJs, 'getWageLogTargetDate');
assert.ok(segmentFn && calculator && transfer && activeWorkLogDate && wageLogTargetDate, 'calculator, date routing and transfer code found');

function setup({ doubleOrder = false, savedLog = null, sameDateDraft = false } = {}) {
    const elements = {};
    const make = (id, value = '') => elements[id] = {
        value, checked: false, dataset: {}, innerText: '', innerHTML: '',
        classList: {
            values: new Set(id === 'dailyLogForm' ? ['hidden'] : id === 'log-card' ? ['expanded'] : []),
            add(name) { this.values.add(name); },
            remove(name) { this.values.delete(name); },
            contains(name) { return this.values.has(name); }
        },
        getAttribute(name) { return name === 'data-date' ? this.date : null; }
    };
    for (const id of ['wageTotalHours', 'wageStartDate', 'wageStartHour', 'wageEndDate', 'wageEndHour',
        'role-skilled', 'role-onshore', 'wageHoliday', 'wageWeekend', 'wageRain', 'wageHotTime',
        'wageTaxType', 'wageHourly', 'wageShipName', 'wageDoubleOrder', 'wageSpecBody', 'wageTotal',
        'wageResultTitle', 'wageResultBox', 'dailyLogForm', 'log-card', 'logWage1', 'logWage2',
        'logShipName', 'logMemo']) make(id);
    Object.assign(elements.wageTotalHours, { value: '2' });
    elements.wageStartDate.value = elements.wageEndDate.value = '2026-10-10';
    elements.wageStartHour.value = '8';
    elements.wageEndHour.value = '10';
    elements.wageHourly.value = '10320';
    elements.wageShipName.value = 'SECOND SHIP';
    elements.wageDoubleOrder.checked = doubleOrder;
    if (sameDateDraft) {
        elements.dailyLogForm.date = '2026-10-10';
        elements.dailyLogForm.classList.remove('hidden');
        elements.logShipName.value = 'FIRST SHIP';
        elements.logWage1.value = '50000';
        elements.logMemo.value = '첫 번째 작업';
    }
    let fetchCount = 0;
    let jumpCount = 0;
    let lastJumpDate = '';
    const messages = [];
    const logs = {};
    const readPaths = [];
    const context = vm.createContext({
        document: { getElementById: id => elements[id] },
        currentWorkerId: 'worker', adminWorkLogs: logs, selectedWageScheduleShipName: '',
        selectedWageVessels: [],
        selectedScheduleTerminal: 'HJNC',
        getAppLocalDateString: () => '2026-10-26',
        periodHours: () => 2,
        getSelectedVesselPeriod: () => ({ hours: 2 }),
        updateWageHoursBreakdown() {},
        escapeShipCommentHtml: s => String(s || ''),
        db: { collection: collectionName => ({ doc: docId => ({ get: async () => {
            fetchCount++;
            readPaths.push(`${collectionName}/${docId}`);
            return { exists: !!savedLog, data: () => savedLog };
        } }) }) },
        jumpToLogDate(date) {
            jumpCount++;
            lastJumpDate = date;
            const record = logs[date];
            elements.dailyLogForm.date = date;
            elements.dailyLogForm.classList.remove('hidden');
            elements.logWage1.value = record?.wage1 || '';
            elements.logWage2.value = record?.wage2 || '';
            elements.logShipName.value = record?.shipName || '';
            elements.logMemo.value = record?.memo || '';
        },
        toggleDashItem() {}, trackAppEvent() {}, showToast(message) { messages.push(message); }, highlightSeasonRow() {},
        getSeasonScheduleByMonth: () => ({ dayStart: 7, dayEnd: 17 }),
        isWeekendOrPublicHolidayDate: () => false,
        renderRow: (label, amount) => `${label}: ${amount}`,
        setTimeout() {}, console: { error() {} }
    });
    vm.runInContext(`let lastCalculatedWageData = null; ${activeWorkLogDate}\n${wageLogTargetDate}\nfunction calculateWageSegment(${segmentFn}function calculateWage() {${calculator}let wageToLogTransferPending = false;${transfer}`, context);
    return {
        elements, context, messages,
        get fetchCount() { return fetchCount; },
        get jumpCount() { return jumpCount; },
        get lastJumpDate() { return lastJumpDate; },
        readPaths
    };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('normal calculation leaves log untouched until explicitly transferred to wage 1', async () => {
    const app = setup({ sameDateDraft: true });
    app.context.calculateWage();
    await flush();
    assert.equal(app.elements.logWage1.value, '50000');
    assert.equal(app.elements.logWage2.value, '');
    assert.equal(app.elements.wageResultTitle.innerText, '📋 임금 산정 내역서');
    await app.context.sendCalculatedWageToLog();
    assert.equal(app.elements.logWage1.value, 20640);
    assert.equal(app.elements.logWage2.value, '');
});

test('the active work-log day is preserved when the selected vessel has an earlier arrival date', async () => {
    const app = setup();
    app.elements.dailyLogForm.date = '2026-10-25';
    app.elements.dailyLogForm.classList.remove('hidden');
    app.elements.wageStartDate.value = '2026-10-01';
    app.elements.wageEndDate.value = '2026-10-01';
    app.context.selectedWageVessels.push({ name: 'VESSEL', date: '2026-10-24' });

    app.context.calculateWage();
    const calculated = vm.runInContext('lastCalculatedWageData', app.context);
    assert.equal(calculated.date, '2026-10-01', 'ATA/ATD remain the wage calculation period');
    assert.equal(calculated.workLogDate, '2026-10-25', 'the open work-log day is the destination');

    await app.context.sendCalculatedWageToLog();
    assert.equal(app.jumpCount, 0, 'do not jump away from an explicitly selected work-log day');
    assert.equal(app.elements.dailyLogForm.date, '2026-10-25');
    assert.equal(app.elements.logShipName.value, 'VESSEL');
    assert.equal(app.elements.logWage1.value, 20640);
});

test('with no active work-log form, the selected schedule day wins over a stale hidden date and ATA', async () => {
    const app = setup();
    app.elements.dailyLogForm.date = '2026-10-01'; // hidden stale value from an earlier visit
    app.elements.wageStartDate.value = '2026-10-01'; // vessel arrival date
    app.elements.wageEndDate.value = '2026-10-01';
    app.context.selectedWageVessels.push({ name: 'VESSEL', date: '2026-10-25' });

    app.context.calculateWage();
    const calculated = vm.runInContext('lastCalculatedWageData', app.context);
    assert.equal(calculated.workLogDate, '2026-10-25');

    await app.context.sendCalculatedWageToLog();
    assert.equal(app.jumpCount, 1);
    assert.equal(app.lastJumpDate, '2026-10-25');
    assert.equal(app.elements.dailyLogForm.date, '2026-10-25');
    assert.equal(app.elements.logShipName.value, 'VESSEL');
});

test('double-order lookup uses the work date, not the vessel arrival date', async () => {
    const app = setup({ doubleOrder: true, savedLog: {
        shipName: 'FIRST SHIP', wage1: 50000, wage2: 0, memo: '첫 번째 작업'
    } });
    app.elements.dailyLogForm.date = '2026-10-01'; // stale and hidden
    app.elements.wageStartDate.value = '2026-10-01'; // ship ATA
    app.elements.wageEndDate.value = '2026-10-01';
    app.context.selectedWageVessels.push({ name: 'SECOND SHIP', date: '2026-10-25' });

    app.context.calculateWage();
    await flush();

    assert.deepEqual(app.readPaths, ['work_logs/worker_2026-10-25']);
    assert.equal(app.lastJumpDate, '2026-10-25');
    assert.equal(app.elements.logWage1.value, 50000);
    assert.equal(app.elements.logWage2.value, 20640);
    assert.equal(app.elements.logShipName.value, 'FIRST SHIP / SECOND SHIP');
});

test('double order calculation adds second ship and wage 2 without losing saved first order', async () => {
    const app = setup({ doubleOrder: true, savedLog: {
        shipName: 'FIRST SHIP', wage1: 50000, wage2: 0, memo: '첫 번째 작업'
    } });
    app.context.calculateWage();
    await flush();
    assert.equal(app.fetchCount, 1);
    assert.equal(app.elements.logWage1.value, 50000);
    assert.equal(app.elements.logWage2.value, 20640);
    assert.equal(app.elements.logShipName.value, 'FIRST SHIP / SECOND SHIP');
    assert.match(app.elements.logMemo.value, /^첫 번째 작업\n\[더블오더 · 임금 2 · SECOND SHIP\]/);
    assert.match(app.elements.wageResultTitle.innerText, /더블오더.*임금 2/);
    assert.equal(app.jumpCount, 1);
    await app.context.sendCalculatedWageToLog();
    assert.equal(app.elements.logShipName.value, 'FIRST SHIP / SECOND SHIP');
    assert.equal(app.elements.logMemo.value.match(/더블오더/g).length, 1);
});

test('double order keeps unsaved first-order draft on the selected date', async () => {
    const app = setup({ doubleOrder: true, sameDateDraft: true });
    app.context.calculateWage();
    await flush();
    assert.equal(app.fetchCount, 0);
    assert.equal(app.jumpCount, 0);
    assert.equal(app.elements.logWage1.value, '50000');
    assert.equal(app.elements.logWage2.value, 20640);
    assert.equal(app.elements.logShipName.value, 'FIRST SHIP / SECOND SHIP');
});

test('double order on a new date fills wage 2 only and labels the memo', async () => {
    const app = setup({ doubleOrder: true });
    app.context.calculateWage();
    await flush();
    assert.equal(app.elements.logWage1.value, '');
    assert.equal(app.elements.logWage2.value, 20640);
    assert.equal(app.elements.logShipName.value, 'SECOND SHIP');
    assert.match(app.elements.logMemo.value, /^\[더블오더 · 임금 2 · SECOND SHIP\]/);
});

test('a newer calculation replaces a pending transfer without mixing ships', async () => {
    const app = setup({ doubleOrder: true, savedLog: {
        shipName: 'FIRST SHIP', wage1: 50000, memo: '첫 번째 작업'
    } });
    let finishFirst;
    const originalGet = app.context.db.collection().doc().get;
    app.context.db.collection = () => ({ doc: () => ({ get: () => {
        if (!finishFirst) return new Promise(resolve => { finishFirst = resolve; });
        return originalGet();
    } }) });
    app.context.calculateWage();
    app.elements.wageShipName.value = 'THIRD SHIP';
    app.context.calculateWage();
    finishFirst({ exists: true, data: () => ({ shipName: 'FIRST SHIP' }) });
    await flush();
    assert.equal(app.elements.logShipName.value, 'FIRST SHIP / THIRD SHIP');
    assert.doesNotMatch(app.elements.logMemo.value, /SECOND SHIP/);
});

test('failed log lookup never overwrites the first ship with an empty form', async () => {
    const app = setup({ doubleOrder: true });
    app.context.db.collection = () => ({ doc: () => ({ get: () => Promise.reject(new Error('offline')) }) });
    app.context.calculateWage();
    await flush();
    assert.equal(app.jumpCount, 0);
    assert.equal(app.elements.logWage2.value, '');
    assert.match(app.messages.at(-1), /불러오지 못했습니다/);
});

test('checkbox is placed between calculate and reset buttons', () => {
    assert.match(html, /onclick="calculateWage\(\)"[^]*?id="wageDoubleOrder"[^]*?onclick="resetWageForm\(\)"/);
});
