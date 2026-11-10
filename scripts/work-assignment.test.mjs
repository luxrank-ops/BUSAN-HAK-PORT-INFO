import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppJs, readAppHtml, readAppFile, extractDeclaration, extractFunction } from './app-source.mjs';

const appJs = readAppJs();
const html = readAppHtml();
const css = readAppFile('public/css/app.css');

function sourceOf(name) {
    const source = extractFunction(appJs, name);
    if (!source) throw new Error(`function not found: ${name}`);
    return source;
}

function assignmentHelpers() {
    const context = vm.createContext({});
    vm.runInContext(extractDeclaration(appJs, 'WORK_ASSIGNMENT_MAX_SHIPS'), context);
    vm.runInContext(sourceOf('normalizeWorkAssignmentList'), context);
    vm.runInContext(sourceOf('normalizeWorkAssignmentShips'), context);
    vm.runInContext(sourceOf('normalizeWorkAssignmentCoworkers'), context);
    return vm.runInContext('({ normalizeWorkAssignmentShips, normalizeWorkAssignmentCoworkers })', context);
}

test('사진 OCR·전사 명단·이름 검색 기반 근무배치 코드는 완전히 제거됐다', () => {
    for (const retired of [
        'ROSTER_PHOTO_', 'ROSTER_FINDER_', 'rosterFinder', 'rosterPhoto',
        'parseRosterPhotoText', 'runRosterPhotoOcr', 'tesseract'
    ]) {
        assert.equal(appJs.includes(retired), false, `app.js에 폐기 코드가 남았습니다: ${retired}`);
        assert.equal(html.includes(retired), false, `index.html에 폐기 코드가 남았습니다: ${retired}`);
        assert.equal(css.includes(retired), false, `app.css에 폐기 코드가 남았습니다: ${retired}`);
    }
});

test('선박 입력은 구분자를 허용하고 중복을 없앤 뒤 최대 4척만 유지한다', () => {
    const helpers = assignmentHelpers();
    assert.deepEqual(
        Array.from(helpers.normalizeWorkAssignmentShips(' MAERSK A / ONE HAMBURG, maerska; HMM STAR\nCMA CGM ')),
        ['MAERSK A', 'ONE HAMBURG', 'HMM STAR', 'CMA CGM']
    );
    assert.deepEqual(Array.from(helpers.normalizeWorkAssignmentShips('A / B / C / D / E')), ['A', 'B', 'C', 'D']);
    assert.deepEqual(Array.from(helpers.normalizeWorkAssignmentShips('')), []);
});

test('동료 입력도 중복을 정리해 근무일지에 안전하게 합칠 수 있다', () => {
    const helpers = assignmentHelpers();
    assert.deepEqual(
        Array.from(helpers.normalizeWorkAssignmentCoworkers('재경, 성철 / 재경\n민수')),
        ['재경', '성철', '민수']
    );
});

test('새 작업 배정 화면은 직접 입력·검토·연결 흐름과 접근성 정보를 제공한다', () => {
    for (const id of [
        'workAssignmentDeck', 'workAssignmentDeckHeader', 'workAssignmentDeckContent',
        'workAssignmentDate', 'workAssignmentTerminal', 'workAssignmentShips',
        'workAssignmentCoworkers', 'workAssignmentMemo', 'workAssignmentSummary',
        'workAssignmentStatus'
    ]) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id}가 한 번 있어야 합니다`);
    }
    assert.match(html, /aria-controls="workAssignmentDeckContent"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /onclick="applyWorkAssignmentToLog\(\)"/);
    assert.match(html, /onclick="applyWorkAssignmentToWage\(\)"/);
    assert.match(html, /onclick="openWorkAssignmentDesk\(\)"/);
    assert.ok(html.includes('초안은 현재 기기에만 저장됩니다'));
});

test('근무일지와 임금계산기는 기존 검증된 연결 경로를 재사용한다', () => {
    const toLog = sourceOf('applyWorkAssignmentToLog');
    const toWage = sourceOf('applyWorkAssignmentToWage');
    assert.match(toLog, /validateWorkAssignment/);
    assert.match(toLog, /jumpToLogDate/);
    assert.match(toLog, /selectScheduleTerminal/);
    assert.match(toLog, /onWorklogShipNameEdited/);
    assert.match(toLog, /syncCoworkerSelectionUI/);
    assert.match(toWage, /applyWorkAssignmentToLog/);
    assert.match(toWage, /sendWorkLogShipToWage/);
});

test('작업 배정 초안은 브라우저 전용 키로만 저장하고 비우기 동작을 제공한다', () => {
    assert.match(appJs, /const WORK_ASSIGNMENT_DRAFT_KEY = "busanPortWorkAssignmentDraftV1"/);
    assert.match(sourceOf('persistWorkAssignmentDraft'), /localStorage\.setItem/);
    assert.match(sourceOf('clearWorkAssignmentDraft'), /localStorage\.removeItem/);
    assert.match(sourceOf('initializeWorkAssignmentDesk'), /localStorage\.getItem/);
});
