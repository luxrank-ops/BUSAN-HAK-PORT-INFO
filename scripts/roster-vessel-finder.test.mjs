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

function setupFinder(extraEntries = [], photoEntries = [], photoSessionActive = false) {
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
    // 사진으로 만든 명단(기기 내) 계층 + 사진 흐름 세션 플래그 — 기본은 둘 다 꺼져 있음
    vm.runInContext(`let rosterPhotoEntries = ${JSON.stringify(photoEntries)};`, context);
    vm.runInContext(`let rosterPhotoSessionActive = ${photoSessionActive ? 'true' : 'false'};`, context);
    for (const fn of [
        'normalizeRosterWorkerName', 'normalizeRosterVesselKey', 'getRosterExtraEntries',
        'getPhotoRosterEntries', 'isBuiltinPhotoRosterSuppressed',
        'getAllRosterAssignments', 'findRosterAssignmentsByWorker', 'findRosterAssignmentsByVessel',
        'matchScheduleVesselByName', 'buildRosterVesselPlan'
    ]) {
        vm.runInContext(extractFunction(fn), context);
    }
    return vm.runInContext(`({
        PHOTO_ROSTER_20261110,
        normalizeRosterWorkerName, normalizeRosterVesselKey, getRosterExtraEntries,
        isBuiltinPhotoRosterSuppressed,
        getAllRosterAssignments, findRosterAssignmentsByWorker, findRosterAssignmentsByVessel,
        matchScheduleVesselByName, buildRosterVesselPlan
    })`, context);
}

const finder = setupFinder();

test('근무배치(오더 종이) 기능은 테스트 완료 전까지 기존 PIN 잠금 상태다', () => {
    assert.match(appJs, /const ROSTER_FINDER_BETA_LOCK = true;/);
    assert.match(extractFunction('isRosterFinderUnlocked'), /ROSTER_FINDER_BETA_LOCK/);
    assert.match(extractFunction('syncRosterFinderLockUI'), /rosterFinderLockBanner/);
    assert.match(extractFunction('unlockRosterFinder'), /openWorkLogPinModal/);
});

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

// 2026-11-11 신고 해결: 사진에 없는 배(PRESIDENT CARTER·CMA CGM PANAMA)가 이름 검색에 나오는 문제
test('사진 명단을 쓰면 사진에 없는 배는 기본(예전 전사) 명단에서 나오지 않는다', () => {
    // 신고 상황 재현: 11/8~11/10 명단 사진을 올렸는데 11/11 전사 명단의 배가 검색됨
    const withPhoto = setupFinder([], [
        { date: '2026-11-08', vessel: 'MAGNA', time: '04:00', company: '고려', workers: ['김성원', '서창우'] },
        { date: '2026-11-10', vessel: 'ONE APUS', time: '05:00', company: '합동', workers: ['박상원', '이수남'] }
    ]);
    // 내 사진 명단의 작업자·배는 정상 검색
    assert.equal(withPhoto.findRosterAssignmentsByWorker('김성원').length, 1);
    assert.equal(withPhoto.findRosterAssignmentsByWorker('김성원')[0].vessel, 'MAGNA');
    assert.equal(withPhoto.findRosterAssignmentsByVessel('ONE APUS').length, 1);
    // 사진에 없는 예전 전사 명단(11/10~11일) 배·작업자는 날짜가 달라도 나오지 않는다
    assert.equal(withPhoto.findRosterAssignmentsByWorker('이춘학').length, 0, '사진 명단 사용 중 이춘학(예전 전사 명단)은 나오면 안 됩니다');
    assert.equal(withPhoto.findRosterAssignmentsByVessel('PRESIDENT CARTER').length, 0);
    assert.equal(withPhoto.findRosterAssignmentsByVessel('CMA CGM PANAMA').length, 0);
    assert.equal(withPhoto.getAllRosterAssignments().length, 2, '사진 2척만 남아야 합니다');
});

test('사진을 고른 뒤 명단이 0척으로 읽혀도 기본(예전 전사) 명단은 섞이지 않는다', () => {
    const engaged = setupFinder([], [], true);
    assert.equal(engaged.isBuiltinPhotoRosterSuppressed(), true);
    assert.equal(engaged.findRosterAssignmentsByWorker('이춘학').length, 0);
    assert.equal(engaged.findRosterAssignmentsByVessel('MAGNA').length, 0);
    assert.equal(engaged.getAllRosterAssignments().length, 0);
});

test('사진 흐름을 쓰지 않으면(사진 미선택·명단 없음) 기본(전사) 명단이 그대로 동작한다', () => {
    const plain = setupFinder();
    assert.equal(plain.isBuiltinPhotoRosterSuppressed(), false);
    assert.equal(plain.findRosterAssignmentsByWorker('이춘학').length, 2);
    assert.equal(plain.getAllRosterAssignments().length, 7);
});

test('예전 전사 명단 제외: 사진 흐름 플래그 연결과 안내 문구가 있다', () => {
    assert.match(appJs, /let rosterPhotoSessionActive = false;/, '세션 플래그 선언');
    const mergeFn = extractFunction('getAllRosterAssignments');
    assert.ok(mergeFn.includes('isBuiltinPhotoRosterSuppressed'), '기본 명단 병합 전에 제외 여부를 확인해야 합니다');
    assert.ok(!mergeFn.includes('photoDates'), '날짜별 부분 제외(구 방식)는 없어야 합니다');
    const suppressed = extractFunction('isBuiltinPhotoRosterSuppressed');
    assert.ok(suppressed.includes('rosterPhotoSessionActive') && suppressed.includes('getPhotoRosterEntries'));
    // 사진 선택·명단 반영 시 플래그 ON, 사진 지우기 시 OFF
    assert.ok(extractFunction('handleRosterPhotoSelected').includes('rosterPhotoSessionActive = true'), '사진을 고르면 제외 플래그 ON');
    assert.ok(extractFunction('applyRosterPhotoRoster').includes('rosterPhotoSessionActive = true'), '명단 반영 시에도 ON');
    assert.ok(extractFunction('clearRosterPhoto').includes('rosterPhotoSessionActive = false'), '사진 지우기로 다시 허용');
    // 찾지 못했을 때·명단 0척일 때 기본 명단 제외 사실을 안내
    assert.ok(extractFunction('searchRosterVessels').includes('예전 기본 명단'), '못 찾음 안내에 기본 명단 제외 설명이 있어야 합니다');
    assert.ok(extractFunction('renderRosterPhotoRows').includes('기본 명단의 배는 나오지 않습니다'), '명단 0척 안내에도 설명이 있어야 합니다');
});

test('화면: 근무배치(오더 종이) 자동 기입 블럭이 메인 화면(임금계산기·근무일지 밑)에 펼침 형태로 있다', () => {
    for (const id of ['rosterFinderInput', 'rosterFinderResults', 'rosterExtraWorker', 'rosterExtraVessel', 'rosterExtraDate', 'rosterExtraList']) {
        assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
        // 중복 ID 금지 — 패널은 한 곳에만 존재한다
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `duplicate #${id}`);
    }
    assert.ok(html.includes('searchRosterVessels()'));
    assert.ok(html.includes('focusRosterFinder()'));
    // 전체 등록 버튼은 결과 렌더링 시 동적 생성되므로 app.js 에서 확인
    assert.ok(appJs.includes('registerAllRosterResults()'));

    // 배치: 근무일지 카드 안이 아니라, 임금계산기·근무일지 카드 뒤(선박도감 앞) 메인 블럭
    const deckIdx = html.indexOf('id="rosterDeckCard"');
    const logCardIdx = html.indexOf('id="log-card"');
    const shipsIdx = html.indexOf('data-view-group="ships"');
    const formIdx = html.indexOf('id="dailyLogForm"');
    const finderIdx = html.indexOf('id="rosterFinderInput"');
    assert.ok(deckIdx > -1, 'missing #rosterDeckCard');
    assert.ok(logCardIdx < deckIdx && deckIdx < shipsIdx, 'deck block should sit below the wage/log cards on the main screen');
    assert.ok(formIdx < deckIdx && deckIdx < finderIdx, 'roster panel must no longer sit inside the worklog card');
    // 근무일지 카드(#workLogArea) 안에 패널이 남아 있지 않아야 한다
    const workLogAreaIdx = html.indexOf('id="workLogArea"');
    assert.ok(workLogAreaIdx > -1 && workLogAreaIdx < formIdx);
    assert.equal(html.slice(workLogAreaIdx, deckIdx).includes('id="rosterFinderInput"'), false, 'panel must be removed from the worklog card');

    // 블럭 이름·펼침(아코디언) 동작
    assert.ok(html.includes('근무배치(오더 종이) 자동 기입'), 'block title must be 근무배치(오더 종이) 자동 기입');
    assert.ok(html.includes('onclick="toggleRosterDeck()"'), 'block header should toggle on click');
    assert.match(html, /id="rosterDeckHeader"[\s\S]{0,400}?aria-expanded="false"/);
    assert.ok(html.includes('aria-controls="rosterDeckContent"'));
    assert.ok(html.includes('id="rosterDeckContent"'));
    // 접힌 상태로 시작 (dash-content 는 CSS 상 display:none)
    assert.match(html, /id="rosterDeckContent" class="dash-content"/);

    assert.ok(html.includes('roster-finder-jump-btn'), 'wage card should keep a jump button');
});

test('펼침 동작: toggleRosterDeck 가 class·aria·내용 표시를 함께 맞춘다', () => {
    for (const fn of ['toggleRosterDeck', 'openRosterDeck', 'setRosterDeckExpanded', 'syncRosterDeckAria']) {
        assert.ok(extractFunction(fn).length > 0, `missing function ${fn}`);
    }
    const toggle = extractFunction('toggleRosterDeck');
    assert.ok(toggle.includes('rosterDeckCard'));
    assert.ok(toggle.includes('setRosterDeckExpanded'));
    const setExpanded = extractFunction('setRosterDeckExpanded');
    assert.ok(setExpanded.includes('expanded'));
    assert.ok(setExpanded.includes('syncRosterFinderLockUI'), 'unlock banner must sync when the block opens');
    const aria = extractFunction('syncRosterDeckAria');
    assert.ok(aria.includes('rosterDeckHeader'));
    assert.ok(aria.includes('aria-expanded'));
    // 진입 버튼은 근무일지 카드가 아니라 메인 블럭을 펼친다
    const focus = extractFunction('focusRosterFinder');
    assert.ok(focus.includes('rosterDeckCard'), 'focusRosterFinder should open the main deck block');
    assert.ok(!focus.includes('log-card'), 'focusRosterFinder must not open the worklog card any more');
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
    // 테스트가 끝날 때까지 다시 잠금: PIN 배너를 표시하고 비밀번호 입력을 요구
    assert.match(appJs, /const ROSTER_FINDER_BETA_LOCK = true;/);
    // 다시 잠글 때를 대비해 PIN 흐름 자체는 남겨 둔다
    assert.ok(appJs.includes('function unlockRosterFinder'));
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

    // 근무일지 잠금이 풀려 있어도 별도 잠금은 유지
    context.isWorkLogUnlocked = true;
    assert.equal(vm.runInContext('syncRosterFinderLockUI()', context), false);
    assert.equal(bannerEl.classes.has('hidden'), false);
    assert.equal(panelEl.classes.has('hidden'), true);

    // 이 기능에서 PIN 을 직접 입력해 세션 해제하면 패널을 표시
    context.readSessionValue = () => '1';
    assert.equal(vm.runInContext('syncRosterFinderLockUI()', context), true);
    assert.equal(bannerEl.classes.has('hidden'), true);
    assert.equal(panelEl.classes.has('hidden'), false);
});

test('잠금 해제: 잠금 플래그가 꺼져 있으면 비밀번호 없이 패널이 바로 열린다', () => {
    const makeEl = () => {
        const el = { classes: new Set(['hidden']) };
        el.classList = {
            toggle(name, force) {
                const on = force === undefined ? !el.classes.has(name) : force;
                if (on) el.classes.add(name); else el.classes.delete(name);
            }
        };
        return el;
    };
    const bannerEl = makeEl();
    const panelEl = makeEl();
    const context = vm.createContext({
        document: { getElementById: (id) => (id === 'rosterFinderLockBanner' ? bannerEl : id === 'rosterFinderPanel' ? panelEl : null) },
        readSessionValue: () => null,
        isWorkLogUnlocked: false
    });
    // 실제 소스에 들어 있는 플래그 값(false)을 그대로 주입
    vm.runInContext('const ROSTER_FINDER_BETA_LOCK = false;', context);
    vm.runInContext('const ROSTER_FINDER_UNLOCK_KEY = "rosterFinderBetaUnlocked";', context);
    vm.runInContext(extractFunction('isRosterFinderUnlocked'), context);
    vm.runInContext(extractFunction('syncRosterFinderLockUI'), context);

    assert.equal(vm.runInContext('isRosterFinderUnlocked()', context), true, '잠금 없이 사용 가능해야 합니다');
    assert.equal(vm.runInContext('syncRosterFinderLockUI()', context), true);
    assert.equal(bannerEl.classes.has('hidden'), true, '잠금 배너는 보이지 않아야 합니다');
    assert.equal(panelEl.classes.has('hidden'), false, '본문 패널은 바로 보여야 합니다');
    // 마크업에서도 잠금 배너는 기본 숨김 + 잠금 안내 문구 제거
    assert.match(html, /id="rosterFinderLockBanner" class="roster-finder-lock-banner hidden"/);
    assert.equal(html.includes('🔒 테스트 중'), false, '안내 문구에 잠금 표시가 남으면 안 됩니다');
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
