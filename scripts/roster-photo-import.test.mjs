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

test('OCR 텍스트는 날짜 상속·선박·시간·회사·지원·조·작업자를 새 파이프라인으로 읽는다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`parseRosterPhotoText(${JSON.stringify(sample)}, { defaultYear: 2026 })`)));
    assert.equal(result.entries.length, 7);
    assert.deepEqual(result.warnings, []);
    const byVessel = Object.fromEntries(result.entries.map((entry) => [entry.vessel, entry]));
    assert.equal(byVessel['CMA CGM AUSTRAL'].date, '2026-11-10');
    assert.equal(byVessel['PRESIDENT CARTER'].date, '2026-11-11');
    assert.equal(byVessel['PRESIDENT CARTER'].time, '00:00');
    assert.equal(byVessel['PRESIDENT CARTER'].company, '고려');
    assert.equal(byVessel['PRESIDENT CARTER'].support, 'BNCT 지원');
    assert.equal(byVessel['PRESIDENT CARTER'].group, '2');
    assert.equal(byVessel['CMA CGM AUSTRAL'].workers.length, 8);
    assert.ok(byVessel['CMA CGM PANAMA'].workers.includes('이춘학'));
    assert.ok(byVessel['CMA CGM AUSTRAL'].workers.includes('김민재2'));
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

test('사진 명단은 같은 선박·같은 이름만 합치고, 같은 이름의 다른 선박은 보존한다', () => {
    const photo = createPhotoVm();
    const rows = JSON.parse(JSON.stringify(photo.run(`mergeRosterPhotoEntries([
        { date: '2026-11-11', vessel: 'PRESIDENT CARTER', workers: ['이춘학'] },
        { date: '2026-11-11', vessel: 'president  carter', workers: ['이춘학', '안영준'] },
        { date: '2026-11-11', vessel: 'CMA CGM PANAMA', workers: ['이춘학'] },
        { date: '2026-11-12', vessel: 'PRESIDENT CARTER', workers: ['김명준'] }
    ])`)));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0].workers, ['이춘학', '안영준']);
    assert.deepEqual(rows[1].workers, ['이춘학']);
    assert.equal(rows[1].vessel, 'CMA CGM PANAMA');
    assert.equal(rows[2].date, '2026-11-12');

    photo.run('replaceRosterPhotoEntries([{ date: "2026-11-11", vessel: "PRESIDENT CARTER", workers: ["이춘학"] }]); savePhotoRosterToDevice()');
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

test('화면은 카메라·갤러리·수정·기기저장 UI를 그대로 제공한다', () => {
    for (const id of ['rosterPhotoInput', 'rosterPhotoGalleryInput', 'rosterPhotoOcrBtn', 'rosterPhotoClearBtn', 'rosterPhotoStatus', 'rosterPhotoPreviewWrap', 'rosterPhotoPreview', 'rosterPhotoTextDetails', 'rosterPhotoText', 'rosterPhotoRows', 'rosterPhotoSaved']) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `missing or duplicate #${id}`);
    }
    assert.match(html, /id="rosterPhotoInput" accept="image\/\*" capture="environment"/);
    assert.match(html, /id="rosterPhotoGalleryInput" accept="image\/\*"/);
    assert.ok(html.includes('서버로 전송되지 않고'));
    assert.ok(html.includes('사진 자체는 저장하지 않습니다'));
    assert.match(html, /parseRosterPhotoTextFromBox\(\)/);
    assert.match(engine, /function applyRosterPhotoRoster\(/);
});
