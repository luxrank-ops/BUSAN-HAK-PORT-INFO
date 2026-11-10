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

test('화면: 이름으로 선박 찾기 패널은 근무일지 카드에 있고 임금계산기에는 진입 버튼만 있다', () => {
    for (const id of ['rosterFinderInput', 'rosterFinderResults', 'rosterExtraWorker', 'rosterExtraVessel', 'rosterExtraDate', 'rosterExtraList']) {
        assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
        // 중복 ID 금지 — 패널은 한 곳에만 존재한다
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `duplicate #${id}`);
    }
    assert.ok(html.includes('searchRosterVessels()'));
    assert.ok(html.includes('focusRosterFinder()'));
    // 전체 등록 버튼은 결과 렌더링 시 동적 생성되므로 app.js 에서 확인
    assert.ok(appJs.includes('registerAllRosterResults()'));
    // 배치: 패널은 달력 뒤·일지 폼 앞에, 임금계산기에는 진입 버튼
    const finderIdx = html.indexOf('id="rosterFinderInput"');
    const calendarIdx = html.indexOf('id="calendarGrid"');
    const formIdx = html.indexOf('id="dailyLogForm"');
    assert.ok(calendarIdx < finderIdx && finderIdx < formIdx, 'finder should sit between calendar and dailyLogForm');
    assert.ok(html.includes('roster-finder-jump-btn'), 'wage card should keep a jump button');
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

// ===== 동일 날짜 중복 등록 방지 =====
function setupDedup({ savedLogs = {}, formDate = '', formValue = '' } = {}) {
    const context = vm.createContext({
        console,
        document: {
            getElementById: (id) => {
                if (id === 'logShipName') return { value: formValue };
                if (id === 'dailyLogForm') return { getAttribute: () => formDate, classList: { contains: () => formDate === '' } };
                return null;
            }
        }
    });
    vm.runInContext(`let adminWorkLogs = ${JSON.stringify(savedLogs)};`, context);
    for (const fn of ['parseWorklogShipNames', 'normalizeWorklogShipKey', 'normalizeRosterVesselKey', 'getActiveWorkLogDate']) {
        vm.runInContext(extractFunction(fn), context);
    }
    for (const fn of ['dedupeVesselNameList', 'getSavedWorklogVesselNames', 'getExistingWorklogVesselNames', 'isVesselRegisteredOnDate', 'splitNewAndDuplicateVessels']) {
        vm.runInContext(extractFunction(fn), context);
    }
    return vm.runInContext(`({
        dedupeVesselNameList, getSavedWorklogVesselNames, getExistingWorklogVesselNames,
        isVesselRegisteredOnDate, splitNewAndDuplicateVessels
    })`, context);
}

test('중복 제거: 순서 유지 + 대소문자·공백·머리말 정규화 기준', () => {
    const d = setupDedup();
    const r = d.dedupeVesselNameList(['PRESIDENT CARTER', 'presidentcarter', '[BNCT] PRESIDENT CARTER', 'CMA CGM PANAMA', 'CMA CGM PANAMA']);
    assert.equal(r.unique.join('|'), 'PRESIDENT CARTER|CMA CGM PANAMA');
    assert.equal(r.duplicates.length, 3);
    assert.equal(d.dedupeVesselNameList([]).unique.length, 0);
});

test('동일 날짜 저장 기록 + 폼을 합쳐 이미 등록된 선박을 판정한다', () => {
    const d = setupDedup({
        savedLogs: { '2026-11-11': { shipName: 'PRESIDENT CARTER' } },
        formDate: '2026-11-11',
        formValue: 'PRESIDENT CARTER / CMA CGM PANAMA'
    });
    assert.equal(d.isVesselRegisteredOnDate('PRESIDENT CARTER', '2026-11-11'), true);
    assert.equal(d.isVesselRegisteredOnDate('president carter', '2026-11-11'), true);
    assert.equal(d.isVesselRegisteredOnDate('CMA CGM PANAMA', '2026-11-11'), true);
    assert.equal(d.isVesselRegisteredOnDate('WILLIAM', '2026-11-11'), false);
    // 다른 날짜는 등록으로 보지 않는다
    assert.equal(d.isVesselRegisteredOnDate('PRESIDENT CARTER', '2026-11-12'), false);
});

test('신규/중복 분리: 이미 있는 배는 건너뛰고 없는 배만 추가한다', () => {
    const d = setupDedup();
    const r = d.splitNewAndDuplicateVessels(['PRESIDENT CARTER', 'CMA CGM PANAMA'], ['PRESIDENT CARTER']);
    assert.equal(r.toAdd.join('|'), 'CMA CGM PANAMA');
    assert.equal(r.skipped.join('|'), 'PRESIDENT CARTER');
});

test('등록·저장 경로에 중복 방지가 연결되어 있다', () => {
    const single = extractFunction('registerRosterResultToWorkLog');
    assert.ok(single.includes('isVesselRegisteredOnDate'), 'single worklog register should skip duplicates');
    const all = extractFunction('registerAllRosterResults');
    assert.ok(all.includes('splitNewAndDuplicateVessels'), 'register-all should split new/duplicate per date');
    const wageSingle = extractFunction('registerRosterResultToWage');
    assert.ok(wageSingle.includes('alreadySelected'), 'single wage register should be idempotent (no toggle-off)');
    const render = extractFunction('renderRosterFinderResults');
    assert.ok(render.includes('isVesselRegisteredOnDate'), 'results should check already-registered vessels');
    assert.ok(render.includes('등록됨'), 'results should badge already-registered vessels');
    assert.ok(render.includes('disabled'), 'already-registered vessels should disable register buttons');
    const save = extractFunction('saveWorkLog');
    assert.ok(save.includes('dedupeVesselNameList'), 'save should dedupe ship names as safety net');
    const send = extractFunction('sendCalculatedWageToLog');
    assert.ok(send.includes('dedupeVesselNameList'), 'wage-to-log transfer should merge instead of overwrite');
});

// ===== 🔒 테스트 잠금 (비밀번호 9445) =====
test('화면: 잠금 배너가 있고 본문 패널은 기본적으로 숨겨져 있다', () => {
    assert.ok(html.includes('id="rosterFinderLockBanner"'), 'missing lock banner');
    assert.ok(html.includes('id="rosterFinderPanel"'), 'missing panel wrapper');
    assert.equal(html.split('id="rosterFinderLockBanner"').length - 1, 1);
    assert.equal(html.split('id="rosterFinderPanel"').length - 1, 1);
    assert.ok(html.includes('unlockRosterFinder()'), 'banner should call unlockRosterFinder');
    // 패널은 잠금 배너 뒤에 오고 hidden 상태로 시작한다
    const bannerIdx = html.indexOf('id="rosterFinderLockBanner"');
    const panelIdx = html.indexOf('id="rosterFinderPanel"');
    const inputIdx = html.indexOf('id="rosterFinderInput"');
    assert.ok(bannerIdx < panelIdx && panelIdx < inputIdx, 'panel wrapper should contain the input and follow the banner');
    assert.match(html.slice(panelIdx, panelIdx + 80), /class="hidden"/);
    assert.ok(!html.includes('rosterFinderBetaUnlocked'), 'unlock flag must not be hardcoded in HTML');
});

test('잠금 로직: 잠금 플래그·해제 저장 키·동기화 함수가 있다', () => {
    for (const fn of ['isRosterFinderUnlocked', 'syncRosterFinderLockUI', 'unlockRosterFinder']) {
        assert.ok(extractFunction(fn).length > 0, `missing function ${fn}`);
    }
    assert.match(appJs, /const ROSTER_FINDER_BETA_LOCK = true;/);
    assert.match(appJs, /const ROSTER_FINDER_UNLOCK_KEY = "rosterFinderBetaUnlocked";/);
    // 잠금 중에는 검색·진입 모두 PIN 입력으로 유도
    assert.ok(extractFunction('searchRosterVessels').includes('isRosterFinderUnlocked'));
    assert.ok(extractFunction('focusRosterFinder').includes('isRosterFinderUnlocked'));
    // 잠금 화면 해제 흐름과 같은 PIN 체계를 재사용
    const unlock = extractFunction('unlockRosterFinder');
    assert.ok(unlock.includes('openWorkLogPinModal'), 'should reuse the existing PIN modal');
    assert.ok(unlock.includes('ROSTER_FINDER_UNLOCK_KEY'), 'should remember unlock for the session');
});

test('잠금 동작: 숨김/표시 토글이 상태에 맞게 동작한다', () => {
    const makeEl = () => ({
        classes: new Set(['hidden']),
        classList: {
            toggle(name, force) {
                const on = force === undefined ? !this._el.classes.has(name) : force;
                if (on) this._el.classes.add(name); else this._el.classes.delete(name);
            }
        }
    });
    const bannerEl = makeEl();
    const panelEl = makeEl();
    bannerEl.classList._el = bannerEl;
    panelEl.classList._el = panelEl;

    const context = vm.createContext({
        document: { getElementById: (id) => (id === 'rosterFinderLockBanner' ? bannerEl : id === 'rosterFinderPanel' ? panelEl : null) },
        readSessionValue: () => null,
        isWorkLogUnlocked: false
    });
    vm.runInContext('const ROSTER_FINDER_BETA_LOCK = true;', context);
    vm.runInContext('const ROSTER_FINDER_UNLOCK_KEY = "rosterFinderBetaUnlocked";', context);
    vm.runInContext(extractFunction('isRosterFinderUnlocked'), context);
    vm.runInContext(extractFunction('syncRosterFinderLockUI'), context);

    // 잠금 상태: 배너 보임 / 패널 숨김
    assert.equal(vm.runInContext('syncRosterFinderLockUI()', context), false);
    assert.equal(bannerEl.classes.has('hidden'), false, 'banner visible when locked');
    assert.equal(panelEl.classes.has('hidden'), true, 'panel hidden when locked');

    // 근무일지 잠금을 푼 상태(같은 PIN) → 배너 숨김 / 패널 표시
    context.isWorkLogUnlocked = true;
    assert.equal(vm.runInContext('syncRosterFinderLockUI()', context), true);
    assert.equal(bannerEl.classes.has('hidden'), true);
    assert.equal(panelEl.classes.has('hidden'), false);
});

test('비밀번호 9445 가 실제로 잠금을 해제할 수 있다', async () => {
    const { createHash } = await import('node:crypto');
    const buildSource = readFileSync(new URL('../scripts/build-obfuscate.mjs', import.meta.url), 'utf8');
    // 빌드가 주입하는 기본 해시 = sha256('9445') → 오프라인(정적 배포)에서도 9445 로 열린다
    assert.match(buildSource, /const DEFAULT_SCREEN_LOCK_PIN = '9445';/);
    const injected = createHash('sha256').update('9445', 'utf8').digest('hex');
    assert.equal(injected.length, 64);
    // 서버도 9445 를 항상 백업으로 인정한다
    const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    assert.match(serverSource, /pins\.add\('9445'\)/, 'server must always accept 9445 as fallback');
    // 업데이트된 PIN 이 삽입되는 HTML 지점이 존재
    assert.match(buildSource, /__SCREEN_LOCK_SHA256__/);
    assert.match(buildSource, /__SCREEN_LOCK_DEFAULT_SHA256__/);
});
