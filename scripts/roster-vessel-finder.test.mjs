import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
    readAppJs, readAppHtml, extractFunction as extractFunctionShared, extractDeclaration as extractDeclarationShared
} from './app-source.mjs';

// 🔍 이름으로 선박 찾기 — BAND 명단 사진(2026-11-10/11) 전사 데이터와
// 작업자 이름 → 배정 선박 → 전 터미널 스케줄 매칭 → 임금·일지 자동 등록 계획
// 순수 로직 회귀 테스트. DOM·Firestore·실시간 API 는 제외하고,
// 명단 조회·정규화·스케줄 매칭·등록 계획만 고정합니다.
const appJs = readAppJs();
const html = readAppHtml();

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

function setupFinder(extraEntries = []) {
    const context = vm.createContext({
        console,
        localStorage: {
            _store: { busanPortRosterExtra: JSON.stringify(extraEntries) },
            getItem(key) { return this._store[key] ?? null; },
            setItem(key, value) { this._store[key] = String(value); }
        }
    });
    vm.runInContext(extractDeclaration('PHOTO_ROSTER_20261110') + ';', context);
    vm.runInContext(extractDeclaration('ROSTER_EXTRA_STORAGE_KEY') + ';', context);
    for (const fn of [
        'normalizeRosterWorkerName', 'normalizeRosterVesselKey', 'getRosterExtraEntries',
        'getAllRosterAssignments', 'findRosterAssignmentsByWorker', 'findRosterAssignmentsByVessel',
        'matchScheduleVesselByName', 'buildRosterVesselPlan'
    ]) {
        vm.runInContext(extractFunction(fn), context);
    }
    return vm.runInContext(`({
        PHOTO_ROSTER_20261110,
        normalizeRosterWorkerName, normalizeRosterVesselKey, getRosterExtraEntries,
        getAllRosterAssignments, findRosterAssignmentsByWorker, findRosterAssignmentsByVessel,
        matchScheduleVesselByName, buildRosterVesselPlan
    })`, context);
}

const finder = setupFinder();

test('사진 명단이 7척으로 전사되어 있다', () => {
    assert.equal(finder.PHOTO_ROSTER_20261110.length, 7);
    const vessels = finder.PHOTO_ROSTER_20261110.map(a => a.vessel);
    assert.ok(vessels.includes('CMA CGM AUSTRAL'));
    assert.ok(vessels.includes('YM WAYFINDER'));
    assert.ok(vessels.includes('PRESIDENT CARTER'));
    assert.ok(vessels.includes('WILLIAM'));
    assert.ok(vessels.includes('CMA CGM PANAMA'));
    assert.ok(vessels.includes('MAGNA'));
    assert.ok(vessels.includes('ULTIMA'));
});

test('이춘학은 11/11 PRESIDENT CARTER + CMA CGM PANAMA 2척에 배정되어 있다', () => {
    const found = finder.findRosterAssignmentsByWorker('이춘학');
    assert.equal(found.length, 2);
    const vessels = found.map(a => a.vessel).sort();
    assert.equal(vessels.join('|'), 'CMA CGM PANAMA|PRESIDENT CARTER');
    assert.ok(found.every(a => a.date === '2026-11-11'));
    assert.ok(found.every(a => a.support === 'BNCT 지원'));
});

test('작업자 이름 정규화: 공백·띄어쓰기 차이를 무시한다', () => {
    assert.equal(finder.findRosterAssignmentsByWorker(' 이 춘 학 ').length, 2);
    assert.equal(finder.findRosterAssignmentsByWorker('없는사람').length, 0);
    assert.equal(finder.findRosterAssignmentsByWorker('').length, 0);
});

test('김명준은 3척(AUSTRAL·CARTER·PANAMA)에 배정되어 있다', () => {
    const found = finder.findRosterAssignmentsByWorker('김명준');
    assert.equal(found.length, 3);
});

test('선박명 검색: 대소문자·공백 차이를 무시하고 찾는다', () => {
    assert.equal(finder.findRosterAssignmentsByVessel('president carter').length, 1);
    assert.equal(finder.findRosterAssignmentsByVessel('PRESIDENTCARTER').length, 1);
    assert.equal(finder.findRosterAssignmentsByVessel('CMA CGM PANAMA')[0].vessel, 'CMA CGM PANAMA');
    assert.equal(finder.findRosterAssignmentsByVessel('없는배').length, 0);
});

test('스케줄 매칭: 정확 일치가 포함 일치보다 우선한다', () => {
    const vessels = [
        { VSL_NM: 'CMA CGM PANAMA EXPRESS', BERTH_NO: '3B' },
        { VSL_NM: 'CMA CGM PANAMA', BERTH_NO: '3B' }
    ];
    assert.equal(finder.matchScheduleVesselByName(vessels, 'CMA CGM PANAMA').BERTH_NO, '3B');
    assert.equal(finder.matchScheduleVesselByName(vessels, 'CMA CGM PANAMA').VSL_NM, 'CMA CGM PANAMA');
    assert.equal(finder.matchScheduleVesselByName(vessels, '없는배'), null);
    assert.equal(finder.matchScheduleVesselByName(null, 'CMA CGM PANAMA'), null);
});

test('등록 계획: 전 터미널에서 선박을 찾아 터미널을 함께 반환한다', () => {
    const assignments = finder.findRosterAssignmentsByWorker('이춘학');
    const plan = finder.buildRosterVesselPlan(assignments, {
        hjnc: [{ VSL_NM: 'OTHER SHIP' }],
        bnct: [
            { VSL_NM: 'PRESIDENT CARTER', BERTH_NO: '2B', ETB: '2026-11-11 00:00', ATD: '2026-11-11 12:00' },
            { VSL_NM: 'CMA CGM PANAMA', BERTH_NO: '3B', ETB: '2026-11-11 15:00', ATD: '2026-11-12 06:00' }
        ]
    });
    assert.equal(plan.length, 2);
    assert.ok(plan.every(p => p.found && p.terminalId === 'bnct'));
});

test('등록 계획: 스케줄에 없으면 missing 으로 표시한다 (이름만 등록 폴백)', () => {
    const assignments = finder.findRosterAssignmentsByWorker('이춘학');
    const plan = finder.buildRosterVesselPlan(assignments, { bnct: [] });
    assert.equal(plan.length, 2);
    assert.ok(plan.every(p => !p.found && p.vessel === null && p.terminalId === ''));
});

test('내 명단 추가 항목이 기본 명단과 합쳐져 조회된다', () => {
    const withExtra = setupFinder([
        { date: '2026-11-12', vessel: 'TEST SHIP', workers: ['홍길동'] }
    ]);
    assert.equal(withExtra.findRosterAssignmentsByWorker('홍길동').length, 1);
    assert.equal(withExtra.findRosterAssignmentsByWorker('홍길동')[0].vessel, 'TEST SHIP');
    // 기본 명단은 그대로 유지
    assert.equal(withExtra.findRosterAssignmentsByWorker('이춘학').length, 2);
});

test('화면: 임금계산기에 이름으로 선박 찾기 패널과 근무일지 진입 버튼이 있다', () => {
    for (const id of ['rosterFinderInput', 'rosterFinderResults', 'rosterExtraWorker', 'rosterExtraVessel', 'rosterExtraDate', 'rosterExtraList']) {
        assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
    }
    assert.ok(html.includes('searchRosterVessels()'));
    assert.ok(html.includes('focusRosterFinder()'));
    // 전체 등록 버튼은 결과 렌더링 시 동적 생성되므로 app.js 에서 확인
    assert.ok(appJs.includes('registerAllRosterResults()'));
});

test('자동 등록 함수가 임금·일지 기존 흐름을 재사용한다', () => {
    for (const fn of ['searchRosterVessels', 'renderRosterFinderResults', 'registerRosterResultToWage', 'registerRosterResultToWorkLog', 'registerAllRosterResults', 'focusRosterFinder', 'addRosterExtraEntry', 'deleteRosterExtraEntry', 'renderRosterExtraList']) {
        assert.ok(extractFunction(fn).length > 0, `missing function ${fn}`);
    }
    const registerAll = extractFunction('registerAllRosterResults');
    assert.ok(registerAll.includes('applyWageScheduleShip'), 'wage register should reuse applyWageScheduleShip');
    assert.ok(registerAll.includes('jumpToLogDate'), 'worklog register should reuse jumpToLogDate');
    assert.ok(registerAll.includes('calculateWage'), 'auto wage calc should reuse calculateWage');
    assert.ok(registerAll.includes('sendCalculatedWageToLog'), 'auto log transfer should reuse sendCalculatedWageToLog');
    const search = extractFunction('searchRosterVessels');
    assert.ok(search.includes('fetchHjncScheduleForMonth'), 'schedule lookup should reuse fetchHjncScheduleForMonth');
    assert.ok(search.includes('TERMINAL_SCHEDULE_LIST'), 'schedule lookup should search all terminals');
});
