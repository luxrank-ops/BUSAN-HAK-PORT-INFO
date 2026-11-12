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
        escapeShipCommentHtml: (value) => String(value || ''),
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

test('선박명 아래에 기록된 작업자 중 검색어와 맞는 이름과 해당 선박 명단 인원을 결과에 사용한다', () => {
    const row = {
        date: '2026-11-12',
        vessel: 'TEST SHIP',
        workers: ['홍길동', '홍길동2', '김철수']
    };
    const result = JSON.parse(JSON.stringify(roster.run(`(() => {
        const row = ${JSON.stringify(row)};
        const matched = findRosterWorkerNamesInAssignment(row, '홍 길 동');
        const html = rosterResultWorkerDescription(row, '홍길동');
        return { matched, html, workers: row.workers };
    })()`)));

    assert.deepEqual(result.matched, ['홍길동', '홍길동2']);
    assert.match(result.html, /찾은 작업자: 홍길동, 홍길동2/);
    assert.match(result.html, /해당 선박 검토 명단 3명/);
    assert.deepEqual(result.workers, ['홍길동', '홍길동2', '김철수'], '검색 결과가 사진 검토 명단을 고치거나 삭제하면 안 됩니다');
});

test('이름 일부를 검색하면 그 이름이 들어간 모든 배정을 한 번에 반환한다', () => {
    const matches = JSON.parse(JSON.stringify(roster.run('findRosterAssignmentsByWorker("김근우")')));
    assert.equal(matches.length, 5, '김근우와 김근우1이 들어간 5척을 모두 보여야 합니다');
    assert.deepEqual(matches.map((row) => row.vessel).sort(), ['CMA CGM AUSTRAL', 'CMA CGM PANAMA', 'PRESIDENT CARTER', 'ULTIMA', 'YM WAYFINDER']);

    // 작업자·선박명 양쪽에서 발견한 행은 합치지 않아, 같은 원문 행도 발견 경로별로 그대로 보입니다.
    const unionRoster = createRosterVm();
    unionRoster.run(`rosterRuntime.photoAssignments = mergeRosterPhotoEntries([
        { date: '2026-11-12', vessel: '김성원호', workers: ['김성원'] },
        { date: '2026-11-12', vessel: '다른 선박', workers: ['김성원'] },
        { date: '2026-11-13', vessel: '김성원2호', workers: ['다른 작업자'] }
    ]);`);
    const combined = JSON.parse(JSON.stringify(unionRoster.run('findAllRosterAssignments("김성원")')));
    assert.equal(combined.assignments.length, 4, '작업자 2행과 선박명 2행을 자동으로 합치지 않아야 합니다');
    assert.deepEqual(combined.assignments.map((row) => row.vessel).sort(), ['김성원2호', '김성원호', '김성원호', '다른 선박']);
    assert.equal(combined.mode, '작업자·선박');
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

test('사진 명단에서도 이수열이 배정된 모든 선박을 검색 결과로 반환한다', () => {
    const vmRoster = createRosterVm();
    vmRoster.run(`appendRosterPhotoEntries([
        { date: '2026-11-11', vessel: 'PRESIDENT CARTER', workers: ['이수열'] },
        { date: '2026-11-11', vessel: 'CMA CGM PANAMA', workers: ['이수열'] }
    ]);`);
    vmRoster.run(`appendRosterPhotoEntries([
        { date: '2026-11-11', vessel: 'SM LONG BEACH', workers: ['다른 작업자'] }
    ]);`);
    const found = JSON.parse(JSON.stringify(vmRoster.run('findAllRosterAssignments("이수열")')));
    assert.deepEqual(found.assignments.map((row) => row.vessel).sort(), ['CMA CGM PANAMA', 'PRESIDENT CARTER']);
    assert.equal(found.mode, '작업자');
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

test('직접 추가한 근무배치 행은 같은 날짜·선박·이름이라도 자동으로 제외하거나 합치지 않는다', () => {
    const fields = {
        rosterExtraWorker: { value: '' },
        rosterExtraVessel: { value: '' },
        rosterExtraDate: { value: '2026-11-12' }
    };
    const toasts = [];
    const vmRoster = createRosterVm({
        showToast: (message) => toasts.push(message),
        document: {
            getElementById: (id) => fields[id] || null,
            querySelector: () => null,
            querySelectorAll: () => []
        }
    });
    vmRoster.run('rosterRuntime.photoModeEngaged = true');
    const add = (worker, vessel) => {
        fields.rosterExtraWorker.value = worker;
        fields.rosterExtraVessel.value = vessel;
        fields.rosterExtraDate.value = '2026-11-12';
        vmRoster.run('addRosterExtraEntry()');
    };

    add('홍길동', 'SHIP ALPHA');
    add('홍 길 동', '[BNCT] ship alpha');
    add('홍길동', 'SHIP BRAVO');
    add('김철수', 'SHIP ALPHA');

    assert.equal(vmRoster.localStorage.data.busanPortRosterExtra ? JSON.parse(vmRoster.localStorage.data.busanPortRosterExtra).length : 0, 4);
    assert.equal(toasts.some((message) => message.includes('이미 있습니다')), false);
    const assignments = JSON.parse(JSON.stringify(vmRoster.run('getAllRosterAssignments()')));
    assert.equal(assignments.length, 4);
    assert.deepEqual(assignments.map((row) => row.vessel), ['SHIP ALPHA', '[BNCT] ship alpha', 'SHIP BRAVO', 'SHIP ALPHA']);
    assert.deepEqual(
        JSON.parse(JSON.stringify(vmRoster.run('findRosterAssignmentsByWorker("홍길동").map((row) => row.vessel).sort()'))),
        ['SHIP ALPHA', 'SHIP BRAVO', '[BNCT] ship alpha']
    );
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

test('임금·근무일지 공용 선박 목록 정리기는 공백·대소문자·터미널 머리말을 제거하며 순서를 보존한다', () => {
    const value = JSON.parse(JSON.stringify(roster.run(`dedupeVesselNameList([
        ' [HJNC] CMA CGM PANAMA ', 'cma cgm panama', 'MAGNA', ' MAGNA '
    ])`)));
    assert.deepEqual(value.unique, ['[HJNC] CMA CGM PANAMA', 'MAGNA']);
    assert.deepEqual(value.duplicates, ['cma cgm panama', 'MAGNA']);
});

test('근무배치 등록은 현재 날짜 근무일지에 같은 선박을 다시 넣지 않는다', () => {
    const fields = { logShipName: { value: '[BNCT] CMA CGM PANAMA' } };
    const toasts = [];
    const vmRoster = createRosterVm({
        MAX_WORK_VESSELS: 4,
        parseWorklogShipNames: (value) => String(value || '').split(/\s*\/\s*/).map((item) => item.trim()).filter(Boolean),
        getActiveWorkLogDate: () => '2026-11-11',
        syncWorklogDoubleOrderMemo() {},
        refreshWorklogVesselList() {},
        updateWorklogDoubleOrderStatus() {},
        showToast: (message) => toasts.push(message),
        document: {
            getElementById: (id) => fields[id] || null,
            querySelector: () => null,
            querySelectorAll: () => []
        }
    });
    const duplicate = vmRoster.run(`attachRosterResultToOpenLog({ assignment: { vessel: 'cma cgm panama' }, found: false })`);
    assert.equal(duplicate, false);
    assert.equal(fields.logShipName.value, '[BNCT] CMA CGM PANAMA');
    assert.match(toasts.at(-1), /2026-11-11 근무일지에 cma cgm panama은\(는\) 이미 입력되어 있어 중복 등록하지 않았습니다/);

    const added = vmRoster.run(`attachRosterResultToOpenLog({ assignment: { vessel: 'ONE APUS' }, found: false })`);
    assert.equal(added, true);
    assert.equal(fields.logShipName.value, '[BNCT] CMA CGM PANAMA / ONE APUS');
});

test('근무배치 원문은 근무일지와 비교해 자동 삭제하지 않는다', () => {
    assert.equal(engine.includes('function isVesselRegisteredOnDate'), false);
    assert.equal(engine.includes('function splitNewAndDuplicateVessels'), false);
    assert.equal(engine.includes('이미 등록되어 제외했습니다'), false);
});

test('화면은 기존 근무배치 카드와 검색·직접 추가·PIN 진입점을 유지한다', () => {
    for (const id of ['rosterDeckCard', 'rosterDeckHeader', 'rosterDeckContent', 'rosterFinderLockBanner', 'rosterFinderPanel', 'rosterFinderInput', 'rosterFinderResults', 'rosterExtraWorker', 'rosterExtraVessel', 'rosterExtraDate', 'rosterExtraList']) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `missing or duplicate #${id}`);
    }
    assert.match(html, /onclick="toggleRosterDeck\(\)"/);
    assert.match(html, /onclick="focusRosterFinder\(\)"/);
    assert.match(engine, /const ROSTER_FINDER_BETA_LOCK = true;/);
    assert.match(engine, /openWorkLogPinModal/);
    assert.match(html, /선박명 아래에 나열된 작업자 이름/);
    assert.match(engine, /function findRosterWorkerNamesInAssignment\(row, query\)/);
    assert.match(engine, /찾은 작업자:/);
    assert.match(engine, /해당 선박 검토 명단/);
    assert.match(engine, /const match = findAllRosterAssignments\(query\);/);
    assert.match(engine, /collectRosterSchedules/);
    assert.match(engine, /requestId !== rosterRuntime\.requestId/);
});
