import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
    readAppJs, readAppHtml, extractFunction as extractFunctionShared, extractDeclaration as extractDeclarationShared
} from './app-source.mjs';

// 📷 근무 배치 사진 → 명단 (기기 내 처리) 회귀 테스트
// - 사진은 서버로 가지 않고, 글자 인식도 브라우저 안에서만 실행되어야 합니다(프라이버시 고정).
// - 인식 글자 → 명단 변환 규칙(날짜 상속·선박명·시각·회사·지원·조·작업자 이름)을 고정합니다.
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

const PARSER_FUNCTIONS = [
    'normalizeRosterOcrText', 'formatRosterDateParts', 'extractRosterTextDate', 'extractRosterTextTime',
    'extractRosterVesselToken', 'extractRosterTextGroup', 'extractRosterTextCompany',
    'extractRosterTextSupport', 'isRosterWorkerNameToken', 'extractRosterWorkerTokens',
    'parseRosterPhotoText', 'normalizeRosterWorkerName', 'normalizeRosterVesselKey'
];

function setupParser() {
    const context = vm.createContext({ console });
    vm.runInContext('let rosterPhotoEntries = [];', context);
    vm.runInContext(extractDeclaration('ROSTER_PHOTO_KNOWN_COMPANIES') + ';', context);
    vm.runInContext(extractDeclaration('ROSTER_PHOTO_NOISE_WORDS') + ';', context);
    for (const fn of PARSER_FUNCTIONS) vm.runInContext(extractFunction(fn), context);
    return {
        context,
        parse: (text, options) => vm.runInContext(`parseRosterPhotoText(${JSON.stringify(text)}, ${JSON.stringify(options || {})})`, context)
    };
}

const SAMPLE_OCR = `2026. 11. 10 (화)
CMA CGM AUSTRAL   18:00  세정  BNCT 지원  ①
김명준 김민재2 조훈철 김근우1 김경찬 구자성 사승동 이재호
YM WAYFINDER  20:00  KML
이성 최준호 신승호 이재열 이종림 박세훈

2026. 11. 11 (수)
PRESIDENT CARTER 00:00 고려 BNCT 지원 ②
조훈철 오규환 신경호 김근우1 김경민1 남영우 김명준 박상원 이경덕 이춘학
WILLIAM 11:00 코엠
백상훈 박상준 곽민석 박규태
CMA CGM PANAMA 15:00 세정 BNCT 지원 ③
이경덕 김명준 박상원 이춘학 오용구
MAGNA 14:00 고려 ④
김치성 김봉준 임종호
ULTIMA 15:00 조영 ①
오경환 원지현 정영중`;

test('사진 글자 → 명단: 선박·날짜 상속·시각·회사·지원·조를 읽는다', () => {
    const parser = setupParser();
    const { entries, warnings } = parser.parse(SAMPLE_OCR, { defaultYear: 2026 });
    assert.equal(entries.length, 7);
    assert.equal(warnings.length, 0, `예상치 못한 경고: ${warnings.join(' / ')}`);
    const byVessel = Object.fromEntries(entries.map(e => [e.vessel, e]));
    assert.deepEqual(
        Object.keys(byVessel).sort(),
        ['CMA CGM AUSTRAL', 'CMA CGM PANAMA', 'MAGNA', 'PRESIDENT CARTER', 'ULTIMA', 'WILLIAM', 'YM WAYFINDER']
    );
    // 날짜 줄 다음의 선박 줄은 그 날짜를 이어받는다
    assert.equal(byVessel['CMA CGM AUSTRAL'].date, '2026-11-10');
    assert.equal(byVessel['YM WAYFINDER'].date, '2026-11-10');
    assert.equal(byVessel['PRESIDENT CARTER'].date, '2026-11-11');
    assert.equal(byVessel['ULTIMA'].date, '2026-11-11');
    // 시간·회사·지원·조
    assert.equal(byVessel['PRESIDENT CARTER'].time, '00:00');
    assert.equal(byVessel['PRESIDENT CARTER'].company, '고려');
    assert.equal(byVessel['PRESIDENT CARTER'].support, 'BNCT 지원');
    assert.equal(byVessel['PRESIDENT CARTER'].group, '2');
    assert.equal(byVessel['MAGNA'].group, '4');
    assert.equal(byVessel['ULTIMA'].company, '조영');
    // 이름은 뒤 줄까지 이어 붙는다
    assert.equal(byVessel['CMA CGM AUSTRAL'].workers.length, 8);
    assert.ok(byVessel['CMA CGM PANAMA'].workers.includes('이춘학'));
    // 끝에 붙은 번호(동명이인 구분)는 보존
    assert.ok(byVessel['CMA CGM AUSTRAL'].workers.includes('김민재2'));
    assert.ok(byVessel['CMA CGM AUSTRAL'].workers.includes('김근우1'));
});

test('사진 글자 → 명단: 시각·지원·터미널명·회사명은 작업자 이름으로 잡히지 않는다', () => {
    const parser = setupParser();
    const { entries } = parser.parse(SAMPLE_OCR, { defaultYear: 2026 });
    const carter = entries.find(e => e.vessel === 'PRESIDENT CARTER');
    for (const noise of ['BNCT', '지원', '고려', '00:00', '2']) {
        assert.ok(!carter.workers.includes(noise), `노이즈가 이름으로 들어감: ${noise}`);
    }
    for (const name of ['조훈철', '신경호', '이춘학', '이경덕']) {
        assert.ok(carter.workers.includes(name), `이름 누락: ${name}`);
    }
    // 다음 줄 이름은 다음 배(CMA CGM PANAMA)에 붙는다
    const panama = entries.find(e => e.vessel === 'CMA CGM PANAMA');
    assert.ok(panama.workers.includes('이춘학'));
    assert.ok(panama.workers.includes('오용구'));
});

test('사진 글자 → 명단: 날짜가 없으면 비워 두고 경고한다', () => {
    const parser = setupParser();
    const { entries, warnings } = parser.parse('PRESIDENT CARTER 00:00 고려\n이춘학 안영준', { defaultYear: 2026 });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].date, '');
    assert.ok(warnings.some(w => w.includes('날짜')));
    // 기준 날짜를 주면 그 날짜로 채운다
    const withDefault = parser.parse('PRESIDENT CARTER 00:00 고려\n이춘학', { defaultYear: 2026, defaultDate: '2026-11-11' });
    assert.equal(withDefault.entries[0].date, '2026-11-11');
});

test('사진 글자 → 명단: 선박명이 없거나 빈 글자면 결과 없이 안내한다', () => {
    const parser = setupParser();
    const empty = parser.parse('   \n\n  ');
    assert.equal(empty.entries.length, 0);
    assert.ok(empty.warnings.length > 0);
    const noVessel = parser.parse('2026. 11. 11\n이춘학 안영준 오용구');
    assert.equal(noVessel.entries.length, 0);
    assert.ok(noVessel.warnings.some(w => w.includes('선박명')));
});

test('사진 명단 병합: 같은 날짜·같은 배는 최신 정보로 덮어쓴다', () => {
    const context = vm.createContext({ console });
    vm.runInContext('let rosterPhotoEntries = [];', context);
    for (const fn of ['normalizeRosterWorkerName', 'normalizeRosterVesselKey', 'normalizeRosterPhotoEntry', 'mergeRosterPhotoEntries']) {
        vm.runInContext(extractFunction(fn), context);
    }
    const merged = vm.runInContext(`mergeRosterPhotoEntries([
        { date: '2026-11-11', vessel: 'PRESIDENT CARTER', workers: ['이춘학'] },
        { date: '2026-11-11', vessel: 'president  carter', workers: ['이춘학', '안영준'] },
        { date: '2026-11-12', vessel: 'PRESIDENT CARTER', workers: ['김명준'] }
    ])`, context);
    assert.equal(merged.length, 2, '같은 날짜·같은 배는 한 건으로 합쳐져야 합니다');
    assert.equal(merged[0].workers.length, 2);
    assert.equal(merged[1].date, '2026-11-12');
    assert.equal(merged[0].source, 'photo');
});

test('사진 명단이 기본 명단보다 우선하고, 같은 날짜의 기본 명단은 쓰지 않는다', () => {
    const context = vm.createContext({
        console,
        localStorage: { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } }
    });
    vm.runInContext(extractDeclaration('PHOTO_ROSTER_20261110') + ';', context);
    vm.runInContext(extractDeclaration('ROSTER_EXTRA_STORAGE_KEY') + ';', context);
    vm.runInContext('let rosterPhotoEntries = [{ date: "2026-11-11", vessel: "PRESIDENT CARTER", time: "00:00", company: "고려", support: "BNCT 지원", group: "2", workers: ["이춘학"] }];', context);
    for (const fn of ['normalizeRosterWorkerName', 'normalizeRosterVesselKey', 'getRosterExtraEntries', 'getPhotoRosterEntries', 'getAllRosterAssignments', 'findRosterAssignmentsByWorker']) {
        vm.runInContext(extractFunction(fn), context);
    }
    const all = vm.runInContext('getAllRosterAssignments()', context);
    const carter = all.filter(a => a.vessel === 'PRESIDENT CARTER' && a.date === '2026-11-11');
    assert.equal(carter.length, 1, '같은 날짜·같은 배가 두 번 들어가면 안 됩니다');
    assert.equal(carter[0].workers.length, 1, '사진 명단(최신)이 우선해야 합니다');
    // 새 사진으로 그 날짜를 올렸다면, 그 날짜의 기본(전사) 명단은 결과에서 빠진다
    const nov11Base = all.filter(a => a.date === '2026-11-11' && a.vessel !== 'PRESIDENT CARTER');
    assert.equal(nov11Base.length, 0, '같은 날짜 기본 명단이 섞이면 예전 근무가 계속 보입니다');
    // 사진 명단이 없는 다른 날짜의 기본 선박은 그대로 남는다 (fallback 유지)
    assert.ok(all.some(a => a.vessel === 'YM WAYFINDER'));
    assert.equal(vm.runInContext('findRosterAssignmentsByWorker("이춘학").length', context), 1);
});

test('새 사진 명단은 이전 사진 명단을 교체한다 (병합 아님)', () => {
    const context = vm.createContext({ console });
    vm.runInContext('let rosterPhotoEntries = [];', context);
    for (const fn of ['normalizeRosterWorkerName', 'normalizeRosterVesselKey', 'normalizeRosterPhotoEntry',
        'mergeRosterPhotoEntries', 'replaceRosterPhotoEntries', 'getPhotoRosterEntries']) {
        vm.runInContext(extractFunction(fn), context);
    }
    vm.runInContext('replaceRosterPhotoEntries([{ date: "2026-11-11", vessel: "OLD SHIP", workers: ["이춘학"] }])', context);
    assert.equal(vm.runInContext('getPhotoRosterEntries().length', context), 1);
    vm.runInContext('replaceRosterPhotoEntries([{ date: "2026-11-12", vessel: "NEW SHIP", workers: ["이춘학"] }])', context);
    const entries = vm.runInContext('JSON.parse(JSON.stringify(getPhotoRosterEntries()))', context);
    assert.equal(entries.length, 1, '이전 사진 명단이 남으면 예전 근무가 결과로 나옵니다');
    assert.equal(entries[0].vessel, 'NEW SHIP');
    // 같은 사진을 두 번 반영해도 중복되지 않는다
    vm.runInContext('replaceRosterPhotoEntries([{ date: "2026-11-12", vessel: "NEW SHIP", workers: ["이춘학"] }])', context);
    assert.equal(vm.runInContext('getPhotoRosterEntries().length', context), 1);
});

test('새 사진을 고르면 이전 인식 결과·검토 줄이 지워지고, 인식 직후 자동 반영된다', () => {
    const onSelect = extractFunction('handleRosterPhotoSelected');
    assert.ok(onSelect.includes('rosterPhotoParsedRows = []'), '이전 검토 줄을 비워야 합니다');
    assert.ok(onSelect.includes('rosterPhotoOcrText = ""'), '이전 인식 글자를 비워야 합니다');
    assert.ok(onSelect.includes('rosterPhotoRows'), '이전 검토 줄 UI 를 지워야 합니다');
    const parseFromBox = extractFunction('parseRosterPhotoTextFromBox');
    assert.ok(parseFromBox.includes('autoApplyRosterPhotoRows'), '인식 직후 바로 반영해야 예전 명단으로 검색되지 않습니다');
    const apply = extractFunction('applyRosterPhotoRoster');
    assert.ok(apply.includes('replaceRosterPhotoEntries'), '반영은 병합이 아니라 교체여야 합니다');
    assert.ok(apply.includes('rosterFinderResults'), '이전 검색 결과를 비워야 합니다');
});

test('프라이버시: 사진은 서버로 보내지 않고 기기에서만 처리한다', () => {
    const photoFns = [
        'openRosterPhotoPicker', 'handleRosterPhotoSelected', 'preprocessRosterPhotoForOcr',
        'runRosterPhotoOcr', 'loadRosterOcrScript', 'ensureRosterOcrEngine', 'clearRosterPhoto'
    ];
    const source = photoFns.map(extractFunction).join('\n');
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'FormData', 'sendBeacon', '/api/']) {
        assert.ok(!source.includes(forbidden), `사진 처리 코드에 서버 전송 흔적이 있습니다: ${forbidden}`);
    }
    // 저장은 명단 텍스트 전용 키로만, 이미지(dataURL)는 저장 금지
    const store = ['savePhotoRosterToDevice', 'loadPhotoRosterFromDevice', 'clearPhotoRosterFromDevice', 'clearRosterPhotoStorageOnly']
        .map(extractFunction).join('\n');
    assert.match(store, /ROSTER_PHOTO_STORAGE_KEY/);
    assert.ok(!/setItem\([^)]*objectUrl|setItem\([^)]*toDataURL|setItem\([^)]*dataUrl/i.test(store));
    // 사진은 objectURL 로만 다루고, 지울 때 즉시 해제
    assert.match(extractFunction('handleRosterPhotoSelected'), /URL\.createObjectURL/);
    assert.match(extractFunction('clearRosterPhoto'), /releaseRosterPhotoObjectUrl/);
    assert.match(extractFunction('releaseRosterPhotoObjectUrl'), /revokeObjectURL/);
    // 외부에서 받는 것은 글자 인식 엔진 하나뿐
    assert.match(appJs, /const ROSTER_OCR_SCRIPT_URL = "https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js@/);
});

test('프라이버시: 기기 저장은 "체크한 경우"에만 일어나고 사진은 저장되지 않는다', () => {
    const context = vm.createContext({
        console,
        localStorage: { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } }
    });
    vm.runInContext('let rosterPhotoEntries = []; let rosterPhotoPersist = false;', context);
    vm.runInContext(extractDeclaration('ROSTER_PHOTO_STORAGE_KEY') + ';', context);
    vm.runInContext(extractDeclaration('ROSTER_PHOTO_PERSIST_KEY') + ';', context);
    for (const fn of ['normalizeRosterWorkerName', 'normalizeRosterVesselKey', 'normalizeRosterPhotoEntry', 'mergeRosterPhotoEntries',
        'savePhotoRosterToDevice', 'loadPhotoRosterFromDevice', 'clearPhotoRosterFromDevice', 'getPhotoRosterEntries']) {
        vm.runInContext(extractFunction(fn), context);
    }
    vm.runInContext('rosterPhotoEntries = mergeRosterPhotoEntries([{ date: "2026-11-11", vessel: "PRESIDENT CARTER", workers: ["이춘학"] }])', context);
    assert.equal(vm.runInContext('savePhotoRosterToDevice()', context), true);
    const raw = context.localStorage._s[context.ROSTER_PHOTO_STORAGE_KEY ?? 'busanPortRosterPhoto'];
    assert.ok(raw && raw.includes('PRESIDENT CARTER'), '명단 텍스트는 저장됩니다');
    assert.ok(!raw.includes('data:image'), '사진 데이터는 저장되면 안 됩니다');
    assert.equal(context.localStorage._s['busanPortRosterPhotoPersist'], '1');
    // 지우면 저장본도 함께 사라진다
    vm.runInContext('clearPhotoRosterFromDevice()', context);
    assert.equal(context.localStorage._s['busanPortRosterPhoto'], undefined);
    assert.equal(vm.runInContext('getPhotoRosterEntries().length', context), 0);
});

test('화면: 사진 업로드 UI 와 안내 문구가 패널 안에 있고 id 는 하나뿐이다', () => {
    for (const id of ['rosterPhotoInput', 'rosterPhotoGalleryInput', 'rosterPhotoOcrBtn', 'rosterPhotoClearBtn', 'rosterPhotoStatus',
        'rosterPhotoPreviewWrap', 'rosterPhotoPreview', 'rosterPhotoTextDetails', 'rosterPhotoText',
        'rosterPhotoRows', 'rosterPhotoSaved']) {
        assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `duplicate #${id}`);
    }
    // 패널(잠금 뒤) 안에 있어야 한다
    const panelIdx = html.indexOf('id="rosterFinderPanel"');
    const photoIdx = html.indexOf('id="rosterPhotoInput"');
    const searchIdx = html.indexOf('id="rosterFinderInput"');
    assert.ok(panelIdx < photoIdx && photoIdx < searchIdx, '사진 UI 는 검색창 위, 패널 안에 있어야 합니다');
    // 촬영(카메라) 과 갤러리(앨범) 를 각각 열 수 있어야 한다
    assert.match(html, /id="rosterPhotoInput" accept="image\/\*" capture="environment"/);
    assert.match(html, /<input type="file" id="rosterPhotoGalleryInput" accept="image\/\*"\s*\n?\s*onchange="handleRosterPhotoSelected\(event\)">/);
    const galleryTag = html.slice(html.indexOf('id="rosterPhotoGalleryInput"') - 20, html.indexOf('id="rosterPhotoGalleryInput"') + 160);
    assert.ok(!galleryTag.includes('capture='), '갤러리 입력에는 capture 가 없어야 앨범에서 고를 수 있습니다');
    // 두 버튼 모두 같은 처리기를 쓴다
    assert.equal(html.split('onchange="handleRosterPhotoSelected(event)"').length - 1, 2);
    assert.ok(html.includes('🖼️ 갤러리에서 선택'), '갤러리 선택 버튼 문구');
    assert.match(appJs, /function openRosterGalleryPicker\(/);
    // 프라이버시 안내
    assert.ok(html.includes('서버로 전송되지 않고'), '프라이버시 안내 문구가 필요합니다');
    assert.ok(html.includes('사진 자체는 저장하지 않습니다'));
    // 사진 없이도 글자로 명단을 만들 수 있어야 한다
    assert.ok(html.includes('parseRosterPhotoTextFromBox()'));
    assert.match(appJs, /function applyRosterPhotoRoster\(/);
    assert.match(appJs, /function handleRosterPhotoSelected\(/);
});

test('사진 없이 붙여넣은 글자도 같은 변환기를 쓴다', () => {
    const parseFromBox = extractFunction('parseRosterPhotoTextFromBox');
    assert.ok(parseFromBox.includes('parseRosterPhotoText'), '붙여넣기 경로도 동일 파서 사용');
    assert.ok(parseFromBox.includes('rosterPhotoText'), '텍스트 입력칸을 읽는다');
    const ocr = extractFunction('runRosterPhotoOcr');
    assert.ok(ocr.includes('parseRosterPhotoTextFromBox'), '인식 후 자동으로 변환 단계로 넘어간다');
    assert.ok(ocr.includes('kor+eng'), '한글+영문 인식');
});
