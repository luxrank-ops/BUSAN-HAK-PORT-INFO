import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppHtml } from './app-source.mjs';

const engine = readFileSync(new URL('../public/js/roster-engine.js', import.meta.url), 'utf8');
const html = readAppHtml();

function createPhotoVm() {
    const data = {};
    const context = vm.createContext({
        console: { warn() {}, error() {} },
        localStorage: {
            getItem(key) { return data[key] ?? null; },
            setItem(key, value) { data[key] = String(value); },
            removeItem(key) { delete data[key]; }
        },
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        ROSTER_FINDER_UNLOCK_KEY: 'rosterFinderBetaUnlocked',
        readSessionValue: () => null
    });
    vm.runInContext(engine, context, { filename: 'public/js/roster-engine.js' });
    return { run: (code) => vm.runInContext(code, context), data };
}

const sample = `2026. 11. 10 (화)
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

test('OCR 텍스트는 날짜·영문 선박으로 검토 행을 만들고, 한글 덩어리를 보정 없이 그대로 표시한다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`parseRosterPhotoText(${JSON.stringify(sample)}, { defaultYear: 2026 })`)));
    assert.equal(result.entries.length, 7);
    assert.ok(result.warnings.some((warning) => warning.includes('자동 보정·제외·중복 처리 없이')));
    const byVessel = Object.fromEntries(result.entries.map((entry) => [entry.vessel, entry]));
    assert.equal(byVessel['CMA CGM AUSTRAL'].date, '2026-11-10');
    assert.equal(byVessel['PRESIDENT CARTER'].date, '2026-11-11');
    assert.equal(byVessel['PRESIDENT CARTER'].time, '00:00');
    assert.equal(byVessel['PRESIDENT CARTER'].company, '고려');
    assert.equal(byVessel['PRESIDENT CARTER'].support, 'BNCT 지원');
    assert.equal(byVessel['PRESIDENT CARTER'].group, '2');
    assert.ok(byVessel['CMA CGM AUSTRAL'].workers.includes('세정'), '회사명도 자동 제외하지 않습니다');
    assert.ok(byVessel['CMA CGM AUSTRAL'].workers.includes('지원'), '메타데이터도 자동 제외하지 않습니다');
    assert.ok(byVessel['CMA CGM PANAMA'].workers.includes('이춘학'));
    assert.ok(byVessel['CMA CGM AUSTRAL'].workers.includes('김민재2'));
});

test('한 글자씩 띄운 이름은 자동 복구하지 않고 인식한 한글 덩어리 그대로 남긴다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`parseRosterPhotoText(${JSON.stringify(`2026. 11. 12
SM LONG BEACH 08:00
이 수 열 김 명 준 김 근 우 1`)}, { defaultYear: 2026 })`)));
    assert.deepEqual(result.entries[0].workers, ['이', '수', '열', '김', '명', '준', '김', '근', '우']);
});

test('제목·명단 머리말도 자동 제외하지 않고 검토표에 그대로 남긴다', () => {
    const photo = createPhotoVm();
    assert.deepEqual(
        JSON.parse(JSON.stringify(photo.run(`pickWorkersFromOcrLine(${JSON.stringify('근무 명단: 이 수 열')})`))),
        ['근무', '명단', '이', '수', '열']
    );
});

test('OCR 이미지 보정은 최대 변 길이를 지키고 대비·흑백 보정본을 만든다', () => {
    const photo = createPhotoVm();
    assert.equal(photo.run('getRosterOcrScale(600, 3000)'), 2000 / 3000);
    assert.equal(photo.run('getRosterOcrScale(600, 1200)'), 2000 / 1200);
    const enhanced = JSON.parse(JSON.stringify(photo.run(`(() => {
        const pixels = { data: new Uint8ClampedArray([20, 40, 60, 255, 220, 230, 240, 255]) };
        enhanceRosterOcrPixels(pixels, 'enhanced');
        return [...pixels.data];
    })()`)));
    assert.equal(enhanced[0], enhanced[1]);
    assert.equal(enhanced[1], enhanced[2]);
    const binary = JSON.parse(JSON.stringify(photo.run(`(() => {
        const pixels = { data: new Uint8ClampedArray([10, 10, 10, 255, 245, 245, 245, 255]) };
        enhanceRosterOcrPixels(pixels, 'binary');
        return [...pixels.data];
    })()`)));
    assert.ok(binary.slice(0, 3).every((value) => value === 0 || value === 255));
    assert.ok(binary.slice(4, 7).every((value) => value === 0 || value === 255));
    const whitePage = JSON.parse(JSON.stringify(photo.run(`(() => {
        const pixels = { data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]) };
        enhanceRosterOcrPixels(pixels, 'enhanced');
        return [...pixels.data];
    })()`)));
    assert.ok(whitePage.every((value, index) => index % 4 === 3 || value === 255));
});

test('OCR 결과가 날짜 또는 선박을 찾지 못하면 검토용 경고를 제공한다', () => {
    const photo = createPhotoVm();
    const noDate = photo.run(`parseRosterPhotoText('PRESIDENT CARTER 00:00 고려\\n이춘학 안영준', { defaultYear: 2026 })`);
    assert.equal(noDate.entries[0].date, '');
    assert.ok(noDate.warnings.some((warning) => warning.includes('날짜')));
    const noVessel = photo.run(`parseRosterPhotoText('2026. 11. 11\\n이춘학 안영준', { defaultYear: 2026 })`);
    assert.equal(noVessel.entries.length, 0);
    assert.ok(noVessel.warnings.some((warning) => warning.includes('선박명')));
});

test('선박 판독이 없는 한글 줄은 안전 차단 없이 현재 검토 행에 그대로 붙인다', () => {
    const photo = createPhotoVm();
    const parsed = JSON.parse(JSON.stringify(photo.run(`parseRosterPhotoText(${JSON.stringify(`2026. 11. 12
SM LONG BEACH 08:00
김성원
다음 선박
이수열`)}, { defaultYear: 2026 })`)));
    assert.deepEqual(parsed.entries[0].workers, ['김성원', '다음', '선박', '이수열']);
    assert.equal(parsed.warnings.some((warning) => warning.includes('앞선 선박')), false);
});

test('사진 명단은 같은 날짜·선박·이름도 자동으로 합치거나 제외하지 않는다', () => {
    const photo = createPhotoVm();
    const rows = JSON.parse(JSON.stringify(photo.run(`mergeRosterPhotoEntries([
        { date: '2026-11-11', vessel: 'PRESIDENT CARTER', workers: ['이춘학'] },
        { date: '2026-11-11', vessel: 'president  carter', workers: ['이춘학', '안영준'] },
        { date: '2026-11-11', vessel: 'CMA CGM PANAMA', workers: ['이춘학'] },
        { date: '2026-11-12', vessel: 'PRESIDENT CARTER', workers: ['김명준'] }
    ])`)));
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[0].workers, ['이춘학']);
    assert.deepEqual(rows[1].workers, ['이춘학', '안영준']);
    assert.equal(rows[1].vessel, 'president  carter');
    assert.equal(rows[2].vessel, 'CMA CGM PANAMA');
    assert.equal(rows[3].date, '2026-11-12');

    photo.run('replaceRosterPhotoEntries([{ date: "2026-11-11", vessel: "PRESIDENT CARTER", workers: ["이춘학"] }]); appendRosterPhotoEntries([{ date: "2026-11-11", vessel: "PRESIDENT CARTER", workers: ["이춘학"] }]); savePhotoRosterToDevice()');
    const accumulated = JSON.parse(JSON.stringify(photo.run('getPhotoRosterEntries()')));
    assert.deepEqual(accumulated.map((row) => row.vessel), ['PRESIDENT CARTER', 'PRESIDENT CARTER']);
    assert.ok(photo.data.busanPortRosterPhoto.includes('PRESIDENT CARTER'));
    assert.ok(!photo.data.busanPortRosterPhoto.includes('data:image'));
    assert.equal(photo.data.busanPortRosterPhotoPersist, '1');
    photo.run('clearPhotoRosterFromDevice()');
    assert.equal(photo.data.busanPortRosterPhoto, undefined);
});

test('사진 처리 경로는 이미지 업로드 API 없이 Object URL·캔버스·브라우저 OCR만 사용한다', () => {
    const photoSection = engine.slice(engine.indexOf('function handleRosterPhotoSelected'), engine.indexOf('function updateRosterPhotoRow'));
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'FormData', 'sendBeacon', '/api/']) {
        assert.equal(photoSection.includes(forbidden), false, `server upload trace: ${forbidden}`);
    }
    assert.match(photoSection, /URL\.createObjectURL/);
    assert.match(engine, /URL\.revokeObjectURL/);
    assert.match(engine, /tesseract\.js@5\.1\.1/);
    assert.match(engine, /"kor\+eng"/);
});

test('화면은 카메라·갤러리·수정·기기저장 UI와 검토 후 적용 흐름을 제공한다', () => {
    for (const id of ['rosterPhotoInput', 'rosterPhotoGalleryInput', 'rosterPhotoOcrBtn', 'rosterPhotoClearBtn', 'rosterPhotoStatus', 'rosterPhotoPreviewWrap', 'rosterPhotoPreview', 'rosterPhotoTextDetails', 'rosterPhotoText', 'rosterPhotoRows', 'rosterPhotoSaved']) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `missing or duplicate #${id}`);
    }
    assert.match(html, /id="rosterPhotoInput" accept="image\/\*" capture="environment"/);
    assert.match(html, /id="rosterPhotoGalleryInput" accept="image\/\*"/);
    assert.ok(html.includes('서버로 전송되지 않고'));
    assert.ok(html.includes('사진 자체는 저장하지 않습니다'));
    assert.ok(html.includes('이름 보정·제목\/회사 제외·중복 제거 없이'));
    assert.ok(html.includes('인식 내용 검토표로 보기'));
    assert.match(html, /parseRosterPhotoTextFromBox\(\)/);
    assert.match(engine, /function applyRosterPhotoRoster\(\)/);
    const parseFromTextBox = engine.slice(engine.indexOf('function parseRosterPhotoTextFromBox'), engine.indexOf('function renderRosterPhotoRows'));
    assert.doesNotMatch(parseFromTextBox, /applyRosterPhotoRoster\(/, 'OCR 결과는 검토 전 자동 적용하면 안 됩니다');
});
