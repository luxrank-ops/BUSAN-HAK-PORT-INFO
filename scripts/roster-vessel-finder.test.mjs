import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppHtml } from './app-source.mjs';

const engine = readFileSync(new URL('../public/js/roster-engine.js', import.meta.url), 'utf8');
const html = readAppHtml();

function createStorage(initial = {}) {
    const data = { ...initial };
    return {
        getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
        setItem(key, value) { data[key] = String(value); },
        removeItem(key) { delete data[key]; },
        data
    };
}

function createRosterVm(extra = {}) {
    const localStorage = createStorage(extra.storage);
    const context = vm.createContext({
        console: { warn() {}, error() {} },
        localStorage,
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        readSessionValue: () => null,
        ROSTER_FINDER_UNLOCK_KEY: 'rosterFinderBetaUnlocked',
        ...extra
    });
    vm.runInContext(engine, context, { filename: 'public/js/roster-engine.js' });
    return { context, localStorage, run: (code) => vm.runInContext(code, context) };
}

const roster = createRosterVm();

test('시작용 명단은 작업자와 선박명으로 같은 배정을 찾는다', () => {
    assert.equal(roster.run('ROSTER_SEED_ASSIGNMENTS.length'), 7);
    assert.deepEqual(
        JSON.parse(JSON.stringify(roster.run('findRosterAssignmentsByWorker(" 이 춘 학 ").map(row => row.vessel).sort()'))),
        ['CMA CGM PANAMA', 'PRESIDENT CARTER']
    );
    assert.equal(roster.run('findRosterAssignmentsByWorker("김명준").length'), 3);
    assert.equal(roster.run('findRosterAssignmentsByVessel("president carter")[0].vessel'), 'PRESIDENT CARTER');
    assert.equal(roster.run('findRosterAssignmentsByVessel("PRESIDENTCARTER").length'), 1);
});

test('사진 명단 모드에서는 시작용 명단을 완전히 제외하고 사진 명단만 우선한다', () => {
    const vmRoster = createRosterVm();
    vmRoster.run(`rosterRuntime.photoAssignments = mergeRosterPhotoEntries([
        { date: '2026-11-08', vessel: 'MAGNA', workers: ['김성원'] },
        { date: '2026-11-10', vessel: 'ONE APUS', workers: ['박상원'] }
    ]);`);
    assert.equal(vmRoster.run('isBuiltinPhotoRosterSuppressed()'), true);
    assert.equal(vmRoster.run('findRosterAssignmentsByWorker("김성원")[0].vessel'), 'MAGNA');
    assert.equal(vmRoster.run('findRosterAssignmentsByWorker("이춘학").length'), 0);
    assert.equal(vmRoster.run('findRosterAssignmentsByVessel("PRESIDENT CARTER").length'), 0);
    assert.equal(vmRoster.run('getAllRosterAssignments().length'), 2);
});

test('직접 추가 명단은 로컬 저장소에서 복원되며 유효하지 않은 데이터는 무시한다', () => {
    const vmRoster = createRosterVm({ storage: {
        busanPortRosterExtra: JSON.stringify([
            { date: '2026-11-12', vessel: 'TEST SHIP', workers: ['홍길동'] },
            { date: '', vessel: 'INVALID', workers: ['무시'] },
            { date: '2026-11-12', vessel: 'NO WORKER' }
        ])
    } });
    assert.equal(vmRoster.run('getRosterExtraEntries().length'), 1);
    assert.equal(vmRoster.run('findRosterAssignmentsByWorker("홍 길 동")[0].vessel'), 'TEST SHIP');
});

test('전 터미널 대입은 정확 일치를 먼저 찾고 부분 일치는 폴백으로 쓴다', () => {
    const plan = roster.run(`buildRosterVesselPlan([
        { date: '2026-11-11', vessel: 'CMA CGM PANAMA', workers: ['이춘학'] }
    ], {
        hjnc: [{ VSL_NM: 'CMA CGM PANAMA EXPRESS' }],
        bnct: [{ VSL_NM: 'CMA CGM PANAMA', BERTH_NO: '3B' }]
    })`);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].terminalId, 'bnct');
    assert.equal(plan[0].vessel.VSL_NM, 'CMA CGM PANAMA');
    assert.equal(roster.run('matchScheduleVesselByName(null, "MAGNA")'), null);
});

test('선박 중복 판정은 공백·대소문자·터미널 머리말을 제거하며 순서를 보존한다', () => {
    const value = JSON.parse(JSON.stringify(roster.run(`dedupeVesselNameList([
        ' [HJNC] CMA CGM PANAMA ', 'cma cgm panama', 'MAGNA', ' MAGNA '
    ])`)));
    assert.deepEqual(value.unique, ['[HJNC] CMA CGM PANAMA', 'MAGNA']);
    assert.deepEqual(value.duplicates, ['cma cgm panama', 'MAGNA']);
});

test('근무일지 저장 기록과 열린 폼 모두를 중복 방지 기준으로 사용한다', () => {
    const vmRoster = createRosterVm({
        adminWorkLogs: { '2026-11-11': { shipName: 'MAGNA / [BNCT] ONE APUS' } },
        getActiveWorkLogDate: () => '2026-11-11',
        parseWorklogShipNames: (value) => String(value || '').split('/').map((name) => name.trim()).filter(Boolean),
        document: {
            getElementById: (id) => id === 'logShipName' ? { value: 'CMA CGM PANAMA' } : null,
            querySelector: () => null,
            querySelectorAll: () => []
        }
    });
    assert.equal(vmRoster.run('isVesselRegisteredOnDate("one apus", "2026-11-11")'), true);
    assert.equal(vmRoster.run('isVesselRegisteredOnDate("cma cgm panama", "2026-11-11")'), true);
    assert.deepEqual(
        JSON.parse(JSON.stringify(vmRoster.run('splitNewAndDuplicateVessels(["MAGNA", "NEW SHIP"], ["magna"])'))),
        { toAdd: ['NEW SHIP'], skipped: ['MAGNA'] }
    );
});

test('화면은 기존 근무배치 카드와 검색·직접 추가·PIN 진입점을 유지한다', () => {
    for (const id of ['rosterDeckCard', 'rosterDeckHeader', 'rosterDeckContent', 'rosterFinderLockBanner', 'rosterFinderPanel', 'rosterFinderInput', 'rosterFinderResults', 'rosterExtraWorker', 'rosterExtraVessel', 'rosterExtraDate', 'rosterExtraList']) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `missing or duplicate #${id}`);
    }
    assert.match(html, /onclick="toggleRosterDeck\(\)"/);
    assert.match(html, /onclick="focusRosterFinder\(\)"/);
    assert.match(engine, /const ROSTER_FINDER_BETA_LOCK = true;/);
    assert.match(engine, /openWorkLogPinModal/);
    assert.match(engine, /collectRosterSchedules/);
    assert.match(engine, /requestId !== rosterRuntime\.requestId/);
});
