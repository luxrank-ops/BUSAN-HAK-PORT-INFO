import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
    readAppJs, extractFunction as extractFunctionShared, extractDeclaration as extractDeclarationShared
} from './app-source.mjs';

// 🔍 선박 검색 — 한글 초성·영문 이니셜 매칭 (선박명_효율입력_제안서 후속 제안 #1)
// "ㅎㅁ" → "HMM ROTTERDAM", "ㅎㅈㅊ" → "한진초원" 처럼 초성만으로 후보를 찾는
// matchesShipQuery 회귀 테스트. 기존 부분문자열 검색 동작도 함께 고정합니다.
const appJs = readAppJs();
const shipsBoardJs = readFileSync(new URL('../public/js/ships-board.js', import.meta.url), 'utf8');

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

function setupMatcher() {
    const context = vm.createContext({ console });
    for (const decl of ['HANGUL_CHO_LIST', 'CHO_TO_LATIN_PATTERN']) {
        vm.runInContext(extractDeclaration(decl) + ';', context);
    }
    for (const fn of ['getHangulChosung', 'matchesShipQuery']) {
        vm.runInContext(extractFunction(fn), context);
    }
    return vm.runInContext('({ getHangulChosung, matchesShipQuery })', context);
}

const matcher = setupMatcher();
const matches = (query, haystack) => matcher.matchesShipQuery(query, haystack);

test('빈 쿼리는 전체를 통과시킨다 (기존 동작)', () => {
    assert.equal(matches('', 'HMM ROTTERDAM'), true);
    assert.equal(matches('   ', '한진초원'), true);
});

test('기존 부분문자열 검색은 대소문자·공백을 무시하고 유지된다', () => {
    assert.equal(matches('rot', 'HMM ROTTERDAM'), true);
    assert.equal(matches('hmm rot', 'HMM ROTTERDAM'), true);
    assert.equal(matches('한진', '한진초원'), true);
    assert.equal(matches('#오토콘', 'HMM ROTTERDAM #오토콘 #더블콘'), true);
    assert.equal(matches('2509e', 'ONE FANTASTIC 3B ONE 2509E'), true);
});

test('제안서 예시: "ㅎㅁ" 으로 "HMM ROTTERDAM" 을 찾는다', () => {
    assert.equal(matches('ㅎㅁ', 'HMM ROTTERDAM'), true);
});

test('한글 자음이 섞인 쿼리도 영문 이니셜로 매칭된다', () => {
    assert.equal(matches('Hㅁ', 'HMM ROTTERDAM'), true);
});

test('한글 선박명은 초성 연속 일치로 검색된다', () => {
    assert.equal(matches('ㅎㅈㅊ', '한진초원'), true);
    assert.equal(matches('ㅎㅈㅊㅇ', '한진초원'), true);
});

test('영문 선박명은 단어 첫 글자 이니셜로도 검색된다', () => {
    // "ㅎㄹ" → H + R ("HMM ROTTERDAM")
    assert.equal(matches('ㅎㄹ', 'HMM ROTTERDAM'), true);
    // "ㅁㅅ" → M + S ("MAERSK SEATTLE")
    assert.equal(matches('ㅁㅅ', 'MAERSK SEATTLE'), true);
});

test('무관한 후보는 초성으로도 매칭되지 않는다 (오탐 방지)', () => {
    assert.equal(matches('ㅎㅁ', '한진초원'), false);
    assert.equal(matches('ㅎㅁ', 'ONE FANTASTIC'), false);
    assert.equal(matches('ㅇㅍ', 'HMM ROTTERDAM'), false);
});

test('완성형 한글 쿼리는 부분문자열 검색만 사용한다 (영문 오탐 방지)', () => {
    // "\uC100\uC2DC" 의 초성 확장이 "ESSEN" 의 SS 오탐까지 붙잡지 않아야 한다
    assert.equal(matches('\uC100\uC2DC', 'MAERSK ESSEN 오토콘 사용'), false);
    assert.equal(matches('\uC100\uC2DC', 'YM WELLNESS 예전 작업 메모'), false);
    assert.equal(matches('\uC100\uC2DC', 'HANJIN BUSAN 육상 \uC100\uC2DC 대기 길어짐'), true);
    // 단일 음절 쿼리도 기존 부분문자열 동작 유지
    assert.equal(matches('시', '수동콘 사용'), false);
    assert.equal(matches('사용', '수동콘 사용'), true);
});

test('한글이 없는 쿼리는 기존 부분문자열만 사용한다', () => {
    assert.equal(matches('HMM', 'HMM ROTTERDAM'), true);
    assert.equal(matches('ZZZ', 'HMM ROTTERDAM'), false);
});

test('getHangulChosung 은 한글 음절을 초성으로 변환한다', () => {
    assert.equal(matcher.getHangulChosung('한진초원'), 'ㅎㅈㅊㅇ');
    assert.equal(matcher.getHangulChosung('HMM ROTTERDAM'), 'HMM ROTTERDAM');
});

test('getFilteredShipList 이 matchesShipQuery 로 검색한다 (배선 확인)', () => {
    const fnBody = extractFunction('getFilteredShipList');
    assert.match(fnBody, /matchesShipQuery\(/);
    assert.doesNotMatch(fnBody, /hay\.includes\(searchTerm\)/);
});

test('전체 선박 검색(ships-board)도 matchesShipQuery 를 사용한다 (배선 확인)', () => {
    assert.match(shipsBoardJs, /matchesShipQuery\(/);
});

test('getFilteredShipList 통합: 초성 검색으로 선박이 필터링된다', () => {
    const elements = new Map();
    const documentStub = {
        getElementById: id => {
            if (!elements.has(id)) elements.set(id, { value: '' });
            return elements.get(id);
        }
    };
    documentStub.getElementById('shipDifficultyFilter').value = '0';
    const context = vm.createContext({ document: documentStub, console });
    for (const decl of ['HANGUL_CHO_LIST', 'CHO_TO_LATIN_PATTERN']) {
        vm.runInContext(extractDeclaration(decl) + ';', context);
    }
    for (const fn of ['getHangulChosung', 'matchesShipQuery', 'getShipDisplayName',
        'getShipMemoText', 'getShipLegacyOnshoreText', 'extractShipTags',
        'getShipSearchHaystack', 'getFilteredShipList']) {
        vm.runInContext(extractFunction(fn), context);
    }
    vm.runInContext(`
        var activeShipFilterTags = [];
        var allShipsData = [
            { name: "HMM ROTTERDAM", onboardFeat: "3B 선석" },
            { name: "한진초원", onboardFeat: "터미널 5" },
            { name: "ONE FANTASTIC", onboardFeat: "2509E 항차" }
        ];
    `, context);

    const filter = q => {
        documentStub.getElementById('shipSearch').value = q;
        // vm 크로스 리름 배열 → 호스트 배열 복사 (deepEqual 프로토타입 비교 회피)
        return Array.from(vm.runInContext('getFilteredShipList().map(s => s.name)', context));
    };

    assert.deepEqual(filter('ㅎㅁ'), ['HMM ROTTERDAM']);
    assert.deepEqual(filter('ㅎㅈㅊ'), ['한진초원']);
    assert.deepEqual(filter('한진'), ['한진초원']);
    assert.deepEqual(filter(''), ['HMM ROTTERDAM', '한진초원', 'ONE FANTASTIC']);
    assert.deepEqual(filter('없는배'), []);
});
