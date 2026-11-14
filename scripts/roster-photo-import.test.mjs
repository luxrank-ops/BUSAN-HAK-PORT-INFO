import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppHtml } from './app-source.mjs';

const engine = readFileSync(new URL('../public/js/roster-engine.js', import.meta.url), 'utf8');
const html = readAppHtml();

function createPhotoVm(confirmResponse = true) {
    const data = {};
    const elements = new Map();
    const context = vm.createContext({
        console: { warn() {}, error() {} },
        localStorage: {
            getItem(key) { return data[key] ?? null; },
            setItem(key, value) { data[key] = String(value); },
            removeItem(key) { delete data[key]; }
        },
        document: { getElementById: (id) => elements.get(id) || null, querySelector: () => null, querySelectorAll: () => [] },
        window: { confirm: () => confirmResponse },
        ROSTER_FINDER_UNLOCK_KEY: 'rosterFinderBetaUnlocked',
        escapeShipCommentHtml: (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]),
        readSessionValue: () => null,
        showToast() {},
        trackAppEvent() {}
    });
    vm.runInContext(engine, context, { filename: 'public/js/roster-engine.js' });
    return { run: (code) => vm.runInContext(code, context), data, elements };
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
    assert.equal(byVessel['PRESIDENT CARTER'].sourceOcrVessel, 'PRESIDENT CARTER');
    assert.ok(byVessel['PRESIDENT CARTER'].sourceOcrLine.includes('PRESIDENT CARTER 00:00 고려 BNCT 지원'));
});

test('영문이 세로로 한 글자씩 분리 인식되면 각 글자를 선박명으로 만들지 않는다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`parseRosterPhotoText(${JSON.stringify(`2026. 11. 12\nP\nR\nE\nS\nI\nD\nE\nN\nT`)}, { defaultYear: 2026 })`)));
    assert.deepEqual(result.entries, []);
    assert.ok(photo.run(`pickVesselFromOcrLine('CMA CGM PANAMA')`) === 'CMA CGM PANAMA');
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

test('2열 반복 오더 표는 선박별 헤더와 그 아래 작업자 영역으로 나누고, 칸 안의 글자만 연결한다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        const width = 100;
        const height = 180;
        const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
        const paint = (x, y) => {
            const offset = (y * width + x) * 4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
            pixels[offset + 3] = 255;
        };
        [10, 20, 60, 70, 110, 120].forEach((y) => { for (let x = 5; x <= 95; x += 1) paint(x, y); });
        [5, 50, 95].forEach((x) => { for (let y = 10; y <= 170; y += 1) paint(x, y); });
        const regions = detectRosterTableRegions({ data: pixels }, width, height);
        const words = [
            { text: '김', bbox: { x0: 12, x1: 16, y0: 29, y1: 35 } },
            { text: '민', bbox: { x0: 18, x1: 22, y0: 29, y1: 35 } },
            { text: '재', bbox: { x0: 24, x1: 28, y0: 29, y1: 35 } },
            { text: '2_', bbox: { x0: 30, x1: 34, y0: 29, y1: 35 } },
            { text: '강', bbox: { x0: 37, x1: 41, y0: 29, y1: 35 } },
            { text: '무성', bbox: { x0: 42, x1: 47, y0: 29, y1: 35 } }
        ];
        return {
            regionCount: regions?.length,
            first: regions?.[0],
            workers: collectRosterTableWorkers(words, regions?.[0]?.workers),
            header: parseRosterTableHeader('11/8 | EA GATUN | 1600 | 웨 스턴', { defaultYear: 2026 })
        };
    })()`)));
    assert.equal(result.regionCount, 6);
    assert.equal(result.first.rowIndex, 0);
    assert.equal(result.first.columnIndex, 0);
    assert.deepEqual(result.workers, ['김민재2', '강무성']);
    assert.deepEqual(result.header, { date: '2026-11-08', vessel: 'EA GATUN', time: '16:00', company: '웨스턴' });
    assert.equal(photo.run(`detectRosterTableRegions({ data: new Uint8ClampedArray(100 * 180 * 4).fill(255) }, 100, 180)`), null);
});

test('표 헤더의 실제 잉크를 확인하고, 7칸 중 선박명이 읽힌 2칸만 검토 행으로 만든다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        const width = 120;
        const height = 50;
        const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
        for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
        const mark = (x, y) => {
            const offset = (y * width + x) * 4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
        };
        // 첫 헤더에는 글자 형태의 잉크를 넣고, 다른 빈 헤더에는 표면 노이즈 수준의 점만 둡니다.
        for (let y = 10; y < 18; y += 1) {
            for (let x = 10; x < 18; x += 1) mark(x, y);
            for (let x = 40; x < 48; x += 1) mark(x, y);
        }
        mark(80, 12);
        const regions = Array.from({ length: 7 }, (_, index) => ({ workers: { x: 0, y: 0, width: 100, height: 30 }, index }));
        const headers = [
            { date: '2026-11-12', vessel: 'PRESIDENT CARTER' },
            { date: '', vessel: '' }, { date: '', vessel: '' },
            { date: '', vessel: '' }, { date: '', vessel: '' },
            { date: '2026-11-12', vessel: 'CMA CGM PANAMA' }, { date: '', vessel: '' }
        ];
        const assignments = regions.map(() => []);
        return {
            firstHasInk: hasRosterTableHeaderInk({ data: pixels, width, height }, { x: 8, y: 8, width: 20, height: 12 }),
            blankHasInk: hasRosterTableHeaderInk({ data: pixels, width, height }, { x: 70, y: 8, width: 20, height: 12 }),
            entries: buildRosterTableOcrEntries(regions, headers, assignments).map((entry) => entry.vessel)
        };
    })()`)));
    assert.equal(result.firstHasInk, true);
    assert.equal(result.blankHasInk, false, '빈 헤더의 고립된 점은 선박 헤더 증거가 아니다');
    assert.deepEqual(result.entries, ['PRESIDENT CARTER', 'CMA CGM PANAMA']);
});

test('온라인 OCR도 표 헤더 좌표로 선박 행만 만들고 빈 칸의 잡음을 제외한다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        const regions = Array.from({ length: 8 }, (_, index) => {
            const row = Math.floor(index / 2);
            const column = index % 2;
            const x = column * 200;
            const y = row * 120;
            return { header: { x, y, width: 180, height: 40 }, workers: { x, y: y + 45, width: 180, height: 65 } };
        });
        const word = (text, x, y, confidence = 95) => ({ text, bbox: { x0: x, x1: x + Math.max(12, text.length * 8), y0: y, y1: y + 12 }, confidence });
        const words = [
            word('11/13', 8, 10), word('ONE', 55, 10), word('MADRID', 85, 10),
            word('11/13', 208, 10), word('NYK', 250, 10), word('PAULA', 280, 10), word('22:00', 330, 10), word('고려', 365, 10),
            word('I', 12, 130),
            word('원지현', 15, 65)
        ];
        return parseRosterCloudTableResult({ words, confidence: 92 }, regions, 2026);
    })()`)));
    assert.deepEqual(result.entries.map((entry) => entry.vessel), ['ONE MADRID', 'NYK PAULA']);
    assert.equal(result.entries[0].date, '2026-11-13');
    assert.equal(result.entries[1].time, '22:00');
    assert.deepEqual(result.entries[0].workers, ['원지현']);
    assert.match(result.rawText, /ONE MADRID/);
    assert.equal(result.entries[0].sourceOcrVessel, 'ONE MADRID');
    assert.match(result.entries[0].sourceOcrLine, /ONE MADRID/);
    assert.match(result.entries[0].sourceOcrLine, /원지현/);
});

test('좌표 OCR 단어를 줄·가로 순서로 원문 텍스트화한다', () => {
    const photo = createPhotoVm();
    const text = photo.run(`buildRosterOcrTextFromWords([
        { text: 'PRESIDENT', bbox: { x0: 10, y0: 10, x1: 70, y1: 20 } },
        { text: 'CARTER', bbox: { x0: 75, y0: 11, x1: 110, y1: 21 } },
        { text: '김명준', bbox: { x0: 10, y0: 34, x1: 50, y1: 44 } },
        { text: '이춘학', bbox: { x0: 58, y0: 35, x1: 95, y1: 45 } }
    ])`);
    assert.equal(text, 'PRESIDENT CARTER\n김명준 이춘학');
});

test('단계 요약은 OCR 원문 줄·표 칸·검토 행·스케줄 대조 수를 따로 표시한다', () => {
    const photo = createPhotoVm();
    const summary = photo.run(`(() => {
        rosterRuntime.recognizedText = '날짜\\nPRESIDENT CARTER\\n김명준';
        rosterRuntime.ocrAudit = { source: 'device-table', detectedRegionCount: 8, confidence: 87 };
        rosterRuntime.reviewRows = [{}, {}, {}];
        rosterRuntime.reviewVerifications = [{ status: 'verified' }, { status: 'candidate' }, { status: 'not-found' }];
        rosterRuntime.reviewVerificationState = 'ready';
        return rosterPhotoOcrAuditHtml();
    })()`);
    assert.match(summary, /OCR 원문 3줄/);
    assert.match(summary, /표 칸 감지 8개/);
    assert.match(summary, /검토표 선박 행 3척/);
    assert.match(summary, /스케줄 일치 1척 · 후보 1척 · 확인 필요 1척/);
    assert.match(summary, /OCR 신뢰도 87%/);
});

test('반복 표가 4행 이상이면 마지막 선박의 명단 칸을 앞 행에 합치지 않는다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        const width = 100;
        const height = 260;
        const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
        const paint = (x, y) => {
            const offset = (y * width + x) * 4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
            pixels[offset + 3] = 255;
        };
        [10, 20, 60, 70, 110, 120, 160, 170].forEach((y) => { for (let x = 5; x <= 95; x += 1) paint(x, y); });
        [5, 50, 95].forEach((x) => { for (let y = 10; y <= 250; y += 1) paint(x, y); });
        const regions = detectRosterTableRegions({ data: pixels }, width, height);
        const words = [
            { text: '김명준', bbox: { x0: 12, x1: 30, y0: 180, y1: 192 } },
            { text: '이춘학', bbox: { x0: 57, x1: 75, y0: 180, y1: 192 } }
        ];
        const allocation = assignRosterTableWordsToWorkerRegions(words, regions);
        return {
            regionCount: regions?.length,
            rows: regions?.map((region) => region.rowIndex),
            workersPerRegion: allocation.assigned.map((items, index) => collectRosterTableWorkers(items, regions[index].workers))
        };
    })()`)));
    assert.equal(result.regionCount, 8);
    assert.deepEqual(result.rows, [0, 0, 1, 1, 2, 2, 3, 3]);
    assert.deepEqual(result.workersPerRegion, [[], [], [], [], [], [], ['김명준'], ['이춘학']]);
});

test('겹친 선박 작업자 영역의 OCR 단어는 한 선박에만 귀속하고, 경계 단어는 자동 출력하지 않는다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        const regions = [
            { workers: { x: 0, y: 0, width: 100, height: 60 } },
            { workers: { x: 90, y: 0, width: 100, height: 60 } }
        ];
        const words = [
            { text: '김명준', bbox: { x0: 20, x1: 50, y0: 20, y1: 36 } },
            { text: '이춘학', bbox: { x0: 92, x1: 98, y0: 20, y1: 36 } }
        ];
        const allocation = assignRosterTableWordsToWorkerRegions(words, regions);
        return {
            perVessel: allocation.assigned.map((items, index) => collectRosterTableWorkers(items, regions[index].workers)),
            unassigned: allocation.unassigned.map((word) => word.text)
        };
    })()`)));
    assert.deepEqual(result.perVessel, [['김명준'], []]);
    assert.deepEqual(result.unassigned, ['이춘학'], '두 작업자 칸에 걸친 이름은 어느 선박에도 중복 출력하지 않는다');
});

test('원본 작업자 칸 수와 검토 출력 인원이 달라도 경고를 남기고 찾기·저장을 진행한다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        rosterRuntime.finderResults = [{ stale: true }];
        beginRosterPhotoReview({ entries: [{
            date: '2026-11-12', vessel: 'PRESIDENT CARTER', workers: ['이춘학', '김명준', '박상원'], sourceWorkerCount: 2, source: 'photo-table'
        }], warnings: [] });
        const beforeSave = getPhotoRosterEntries().length;
        const saved = applyRosterPhotoRoster();
        return {
            source: rosterRuntime.workerCountAudit.sourceCount,
            output: rosterRuntime.workerCountAudit.outputCount,
            verified: rosterRuntime.workerCountAudit.isVerified,
            beforeSave,
            saved,
            persisted: rosterRuntime.photoAssignments.length,
            staleFinderResults: rosterRuntime.finderResults.length,
            searchableOutputWorker: findRosterAssignmentsByWorker('박상원').length
        };
    })()`)));
    assert.deepEqual(result, { source: 2, output: 3, verified: false, beforeSave: 1, saved: true, persisted: 1, staleFinderResults: 0, searchableOutputWorker: 1 });
});

test('원본 작업자 칸 수와 출력 인원이 같으면 표 OCR 명단은 즉시 찾기에 반영한다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        beginRosterPhotoReview({ entries: [{
            date: '2026-11-12', vessel: 'PRESIDENT CARTER', workers: ['이춘학', '김명준'], sourceWorkerCount: 2, source: 'photo-table'
        }], warnings: [] });
        return {
            source: rosterRuntime.workerCountAudit.sourceCount,
            output: rosterRuntime.workerCountAudit.outputCount,
            verified: rosterRuntime.workerCountAudit.isVerified,
            vessels: getPhotoRosterEntries().map((row) => row.vessel)
        };
    })()`)));
    assert.deepEqual(result, { source: 2, output: 2, verified: true, vessels: ['PRESIDENT CARTER'] });
});

test('검토 행을 삭제해도 사진에서 센 원본 작업자 총수는 바뀌지 않는다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        beginRosterPhotoReview({ entries: [
            { date: '2026-11-12', vessel: 'PRESIDENT CARTER', workers: ['이춘학'], sourceWorkerCount: 1, source: 'photo-table' },
            { date: '2026-11-12', vessel: 'CMA CGM PANAMA', workers: ['김명준'], sourceWorkerCount: 1, source: 'photo-table' }
        ], warnings: [] });
        removeRosterPhotoRow(1);
        return {
            source: rosterRuntime.workerCountAudit.sourceCount,
            output: rosterRuntime.workerCountAudit.outputCount,
            verified: rosterRuntime.workerCountAudit.isVerified,
            searchable: rosterRuntime.searchableReviewAssignments.length
        };
    })()`)));
    assert.deepEqual(result, { source: 2, output: 1, verified: false, searchable: 1 });
});

test('표 OCR 원문을 다시 검토해도 선박별로 나눈 작업자 칸의 리터럴을 재파싱하지 않는다', () => {
    const photo = createPhotoVm();
    const parsed = JSON.parse(JSON.stringify(photo.run(`(() => {
        rosterRuntime.recognizedText = '표 OCR 원문';
        rosterRuntime.tableOcrParsed = {
            entries: [{ date: '2026-11-08', vessel: 'EA GATUN', time: '16:00', company: '웨스턴', workers: ['김', '김민재2', '강무성'], source: 'photo-table' }],
            warnings: ['검토 필요']
        };
        return parseRosterPhotoTextFromBox({ skipReview: true });
    })()`)));
    assert.deepEqual(parsed.entries[0].workers, ['김', '김민재2', '강무성']);
    assert.deepEqual(parsed.warnings, ['검토 필요']);
});

test('표 OCR 원문을 수정해 재파싱할 때 좌표 연결 손실을 먼저 알리고 취소할 수 있다', () => {
    const photo = createPhotoVm(false);
    photo.elements.set('rosterPhotoText', { value: '사용자가 수정한 텍스트' });
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        rosterRuntime.recognizedText = '기존 표 OCR 원문';
        rosterRuntime.tableOcrParsed = { entries: [{ vessel: 'PRESIDENT CARTER', workers: ['김명준'] }], warnings: [] };
        const parsed = parseRosterPhotoTextFromBox();
        return { parsed, tableDataPreserved: Boolean(rosterRuntime.tableOcrParsed) };
    })()`)));
    assert.deepEqual(result, { parsed: false, tableDataPreserved: true });
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

test('그림자처럼 영역별 밝기 차이가 큰 사진은 부분별 흑백 보정으로 양쪽 글자를 남긴다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        const width = 144;
        const height = 72;
        const pixels = new Uint8ClampedArray(width * height * 4);
        const paint = (x, y, value) => {
            const index = (y * width + x) * 4;
            pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
            pixels[index + 3] = 255;
        };
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const inLeftText = x >= 18 && x < 23;
                const inRightText = x >= 102 && x < 107;
                paint(x, y, x < width / 2 ? (inLeftText ? 180 : 230) : (inRightText ? 70 : 120));
            }
        }
        const before = { data: new Uint8ClampedArray(pixels) };
        const retryForShadow = getRosterOcrRetryProfile(before, width, height);
        const retryForEvenLight = getRosterOcrRetryProfile({ data: new Uint8ClampedArray(width * height * 4).fill(220) }, width, height);
        enhanceRosterOcrPixels({ data: pixels }, 'adaptive', width, height);
        const read = (x, y = 20) => pixels[(y * width + x) * 4];
        return {
            retryForShadow,
            retryForEvenLight,
            leftBackground: read(5),
            leftText: read(20),
            rightBackground: read(85),
            rightText: read(104)
        };
    })()`)));
    assert.equal(result.retryForShadow, 'adaptive');
    assert.equal(result.retryForEvenLight, 'binary');
    assert.deepEqual(
        [result.leftBackground, result.leftText, result.rightBackground, result.rightText],
        [255, 0, 255, 0],
        '밝은 면과 그림자 면 모두에서 바탕은 흰색·글자는 검은색으로 구분한다'
    );
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

test('OCR 원문을 보존하고 스케줄 선박 후보는 사용자 동의 때만 적용한다', () => {
    const photo = createPhotoVm();
    const schedules = {
        bnct: [
            { VSL_NM: 'CMA CGM PANAMA', ETB: '2026-11-11 10:00', ATD: '2026-11-12 15:00', BERTH_NO: '3B' },
            { VSL_NM: 'SCHEDULED LATER', ETB: '2026-11-14 09:00', ATD: '2026-11-15 19:00' }
        ],
        hjnc: [
            { VSL_NM: 'CMA CGM PANAMA EXPRESS', ETB: '2026-11-11 11:00', ATD: '2026-11-12 17:00' }
        ]
    };
    const verified = JSON.parse(JSON.stringify(photo.run(`verifyRosterPhotoVesselName(
        { date: '2026-11-11', vessel: 'CMA CGM PANAMA' }, ${JSON.stringify(schedules)}
    )`)));
    assert.equal(verified.status, 'verified');
    assert.equal(verified.matches[0].terminalId, 'bnct');

    const singleCandidateSchedules = { bnct: [schedules.bnct[0]] };
    const candidate = JSON.parse(JSON.stringify(photo.run(`verifyRosterPhotoVesselName(
        { date: '2026-11-11', vessel: 'CMA CGM PANAM' }, ${JSON.stringify(singleCandidateSchedules)}
    )`)));
    assert.equal(candidate.status, 'candidate');
    assert.equal(candidate.literalName, 'CMA CGM PANAM');
    assert.equal(candidate.matches[0].vessel.VSL_NM, 'CMA CGM PANAMA');
    const unchanged = JSON.parse(JSON.stringify(photo.run(`(() => {
        const rows = [{ date: '2026-11-11', vessel: 'CMA CGM PANAM' }];
        const checks = buildRosterPhotoVesselVerifications(rows, ${JSON.stringify(singleCandidateSchedules)});
        const confirmed = markUserConfirmedRosterPhotoScheduleNames(rows, checks);
        return { confirmed, vessel: rows[0].vessel, status: checks[0].status };
    })()`)));
    assert.deepEqual(unchanged, { confirmed: 0, vessel: 'CMA CGM PANAM', status: 'candidate' }, '스케줄 조회만으로 OCR 선박명을 바꾸지 않습니다');

    const applied = JSON.parse(JSON.stringify(photo.run(`(() => {
        rosterRuntime.reviewRows = [{ date: '2026-11-11', vessel: 'CMA CGM PANAM' }];
        rosterRuntime.reviewVerifications = ${JSON.stringify([candidate])};
        const ok = applyRosterPhotoScheduleName(0);
        return { ok, row: rosterRuntime.reviewRows[0], check: rosterRuntime.reviewVerifications[0] };
    })()`)));
    assert.equal(applied.ok, true);
    assert.equal(applied.row.vessel, 'CMA CGM PANAMA');
    assert.equal(applied.row.scheduleNameSource, 'CMA CGM PANAM');
    assert.equal(applied.check.status, 'user-confirmed');
    assert.equal(applied.check.literalName, 'CMA CGM PANAM');
    assert.equal(applied.check.officialName, 'CMA CGM PANAMA');

    const refreshed = JSON.parse(JSON.stringify(photo.run(`(() => {
        const rows = [{ date: '2026-11-11', vessel: 'CMA CGM PANAMA', scheduleNameSource: 'CMA CGM PANAM' }];
        const checks = buildRosterPhotoVesselVerifications(rows, ${JSON.stringify(singleCandidateSchedules)});
        const confirmed = markUserConfirmedRosterPhotoScheduleNames(rows, checks);
        return { confirmed, vessel: rows[0].vessel, status: checks[0].status, literalName: checks[0].literalName };
    })()`)));
    assert.deepEqual(refreshed, { confirmed: 1, vessel: 'CMA CGM PANAMA', status: 'user-confirmed', literalName: 'CMA CGM PANAM' }, '사용자가 적용한 경우 원문과 정식명을 함께 보존합니다');

    const ambiguous = JSON.parse(JSON.stringify(photo.run(`(() => {
        const rows = [{ date: '2026-11-11', vessel: 'CMA CGM PANAM' }];
        const checks = buildRosterPhotoVesselVerifications(rows, ${JSON.stringify(schedules)});
        const confirmed = markUserConfirmedRosterPhotoScheduleNames(rows, checks);
        return { confirmed, vessel: rows[0].vessel, status: checks[0].status };
    })()`)));
    assert.deepEqual(ambiguous, { confirmed: 0, vessel: 'CMA CGM PANAM', status: 'ambiguous' }, '복수 후보에서는 OCR 원문을 유지합니다');
    const candidateHtml = photo.run(`rosterPhotoVerificationHtml(${JSON.stringify(candidate)}, 0)`);
    assert.match(candidateHtml, /이 후보를 선박명에 적용/);
    assert.match(candidateHtml, /applyRosterPhotoScheduleName\(0\)/);

    assert.equal(photo.run(`verifyRosterPhotoVesselName({ date: '2026-11-11', vessel: 'SCHEDULED LATER' }, ${JSON.stringify(schedules)}).status`), 'date-mismatch');
    assert.equal(photo.run(`verifyRosterPhotoVesselName({ date: '', vessel: 'CMA CGM PANAMA' }, ${JSON.stringify(schedules)}).status`), 'needs-date');
    assert.equal(photo.run(`verifyRosterPhotoVesselName({ date: '2026-11-11', vessel: 'UNKNOWN VESSEL' }, ${JSON.stringify(schedules)}).status`), 'not-found');
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

test('근무배치 초기화는 OCR 검토·찾기만 비우고 저장한 사진·직접 명단은 보존한다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        rosterRuntime.photoModeEngaged = true;
        rosterRuntime.persistPhotoText = true;
        rosterRuntime.photoAssignments = [{ date: '2026-11-12', vessel: 'PRESIDENT CARTER', workers: ['이춘학'] }];
        rosterRuntime.searchableReviewAssignments = [{ date: '2026-11-12', vessel: 'MAGNA', workers: ['김명준'] }];
        rosterRuntime.reviewRows = [{ date: '2026-11-12', vessel: 'MAGNA', workers: ['김명준'] }];
        localStorage.setItem(ROSTER_STORAGE.photo, 'saved');
        localStorage.setItem(ROSTER_STORAGE.persist, '1');
        localStorage.setItem(ROSTER_STORAGE.manual, JSON.stringify([{ date: '2026-11-12', vessel: 'DIRECT SHIP', workers: ['직접입력'] }]));
        resetRosterFinder();
        return {
            photoModeEngaged: rosterRuntime.photoModeEngaged,
            photoAssignments: rosterRuntime.photoAssignments.length,
            searchableReviewAssignments: rosterRuntime.searchableReviewAssignments.length,
            reviewRows: rosterRuntime.reviewRows.length,
            manualAssignments: getRosterExtraEntries().length,
            persistedPhoto: localStorage.getItem(ROSTER_STORAGE.photo),
            persistedFlag: localStorage.getItem(ROSTER_STORAGE.persist)
        };
    })()`)));
    assert.deepEqual(result, {
        photoModeEngaged: false,
        photoAssignments: 1,
        searchableReviewAssignments: 0,
        reviewRows: 0,
        manualAssignments: 1,
        persistedPhoto: 'saved',
        persistedFlag: '1'
    });
});

test('사진 선택은 기기 내 OCR만 시작하고, 온라인 전송은 확인·인증 뒤에만 실행한다', () => {
    const photoSection = engine.slice(engine.indexOf('function handleRosterPhotoSelected'), engine.indexOf('function openRosterPhotoPicker'));
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'FormData', 'sendBeacon', '/api/']) {
        assert.equal(photoSection.includes(forbidden), false, `server upload trace: ${forbidden}`);
    }
    assert.match(photoSection, /URL\.createObjectURL/);
    assert.match(engine, /URL\.revokeObjectURL/);
    assert.match(engine, /tesseract\.js@5\.1\.1/);
    assert.match(engine, /"kor\+eng"/);
    const cloudRoutine = engine.slice(engine.indexOf('async function runRosterCloudOcr'), engine.indexOf('function beginRosterPhotoReview'));
    assert.ok(cloudRoutine.includes('window.confirm'));
    assert.ok(cloudRoutine.includes('X-Roster-Ocr-Consent'));
    assert.ok(cloudRoutine.includes('/api/roster-ocr'));
});

test('사진을 고르면 명단 읽기를 자동으로 시작하고 필요하면 다시 읽을 수 있다', () => {
    const photoSelected = engine.slice(engine.indexOf('function handleRosterPhotoSelected'), engine.indexOf('function openRosterPhotoPicker'));
    assert.match(photoSelected, /자동으로 사진에서 명단을 읽는 중입니다/);
    const ocrStart = photoSelected.indexOf('void runRosterPhotoOcr()');
    assert.ok(ocrStart >= 0, 'selecting a photo starts OCR without an extra button press');
    assert.ok(ocrStart > photoSelected.indexOf('URL.createObjectURL'), 'OCR begins only after the selected image is available to the preview');
    assert.match(html, /id="rosterPhotoOcrBtn"[^>]*>🔄 사진에서 명단 다시 읽기<\/button>/);
    assert.ok(html.includes('사진을 고르면 이 기기에서만 자동으로 글자를 읽어 명단으로 만들어 줍니다.'));
});

test('자동으로 읽은 사진 명단은 별도 적용 없이 이름·관련 단어·선박명으로 바로 찾을 수 있다', () => {
    const photo = createPhotoVm();
    const result = JSON.parse(JSON.stringify(photo.run(`(() => {
        beginRosterPhotoReview({ entries: [{
            date: '2026-11-12', vessel: 'PRESIDENT CARTER', company: '고려', support: 'BNCT 지원', workers: ['이춘학']
        }], warnings: [] });
        return {
            name: findAllRosterAssignments('춘학').assignments.map((row) => row.vessel),
            related: findAllRosterAssignments('고려').assignments.map((row) => row.vessel),
            vessel: findAllRosterAssignments('CARTER').assignments.map((row) => row.vessel),
            saved: rosterRuntime.photoAssignments.length
        };
    })()`)));
    assert.deepEqual(result.name, ['PRESIDENT CARTER']);
    assert.deepEqual(result.related, ['PRESIDENT CARTER']);
    assert.deepEqual(result.vessel, ['PRESIDENT CARTER']);
    assert.equal(result.saved, 0, '찾기에만 즉시 반영하며 기기 저장·임금·근무일지 등록은 자동 실행하지 않습니다');
});

test('화면은 카메라·갤러리·수정·기기저장 UI와 검토 후 적용 흐름을 제공한다', () => {
    for (const id of ['rosterPhotoInput', 'rosterPhotoGalleryInput', 'rosterPhotoOcrBtn', 'rosterPhotoClearBtn', 'rosterFinderResetBtn', 'rosterPhotoStatus', 'rosterPhotoPreviewWrap', 'rosterPhotoPreview', 'rosterPhotoTextDetails', 'rosterPhotoText', 'rosterPhotoOcrCopyBtn', 'rosterPhotoRows', 'rosterPhotoSaved', 'rosterPhotoCloudOcrBtn']) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `missing or duplicate #${id}`);
    }
    assert.match(html, /id="rosterPhotoInput" accept="image\/\*" capture="environment"/);
    assert.match(html, /id="rosterPhotoGalleryInput" accept="image\/\*"/);
    assert.match(html, /id="rosterFinderResetBtn"[^>]*onclick="resetRosterFinder\(\)"/);
    assert.ok(html.includes('기기 내 OCR을 기본으로 하고, 추출한 OCR 원문 텍스트를 먼저 보여 드립니다'));
    assert.ok(html.includes('확인 창에서 동의한 사진만 Google Cloud Vision에 전송됩니다'));
    assert.ok(html.includes('이름 보정·제목\/회사 제외·중복 제거 없이'));
    assert.ok(html.includes('1단계 · 추출한 OCR 원문 확인·복사'));
    assert.ok(html.includes('2단계 · 원문을 검토표로 읽기'));
    assert.ok(html.includes('OCR 원문 복사'));
    assert.ok(html.includes('2열 반복 표는 선박별 헤더와 작업자 칸을 따로 읽고, 빈 칸은 선박 행으로 만들지 않습니다'));
    assert.ok(html.includes('작업자 수 불일치가 있어도 검토·저장은 계속할 수 있습니다'));
    assert.ok(html.includes('사진에서 명단 다시 읽기'));
    assert.doesNotMatch(engine, /for \(const profile of \["adaptive", "binary"\]/);
    assert.ok(html.includes('날짜별 전 터미널 입·출항 스케줄은 선박명 대조용으로만 사용하고 후보는 자동 적용하지 않습니다'));
    assert.match(html, /parseRosterPhotoTextFromBox\(\)/);
    assert.match(engine, /function detectRosterTableRegions\(imageData, width, height\)/);
    assert.match(engine, /function rotateRosterCanvasForOcr\(sourceCanvas, degrees\)/);
    assert.match(engine, /if \(selected\.entryCount === 0\)/);
    assert.match(engine, /function hasRosterTableHeaderInk\(imageData, region\)/);
    assert.match(engine, /function buildRosterTableOcrEntries\(regions, headers, assignedWords\)/);
    assert.match(engine, /function parseRosterCloudTableResult\(result, regions, defaultYear\)/);
    assert.match(engine, /async function runRosterCloudOcr\(\)/);
    assert.match(engine, /X-Roster-Ocr-Consent/);
    assert.ok(html.includes('Google Cloud Vision'));
    assert.match(engine, /function collectRosterTableWorkers\(words, region\)/);
    assert.match(engine, /function recognizeRosterTablePhoto\(engine, sourceCanvas, imageData, regions, defaultYear\)/);
    assert.match(engine, /function verifyRosterPhotoVessels\(\)/);
    assert.match(engine, /function markUserConfirmedRosterPhotoScheduleNames\(rows, verifications\)/);
    assert.match(engine, /function applyRosterPhotoScheduleName\(index\)/);
    assert.match(engine, /function buildRosterOcrTextFromWords\(words\)/);
    assert.match(engine, /function rosterPhotoOcrAuditHtml\(\)/);
    assert.match(engine, /function syncRosterPhotoSearchEntries\(\)/);
    assert.match(engine, /function findRosterRelatedTermsInAssignment\(row, query\)/);
    assert.match(engine, /function applyRosterPhotoRoster\(\)/);
    const reviewStart = engine.slice(engine.indexOf('function beginRosterPhotoReview'), engine.indexOf('function parseRosterPhotoTextFromBox'));
    assert.match(reviewStart, /syncRosterPhotoSearchEntries\(\)/, 'OCR 결과는 별도 적용 없이 찾기에 바로 반영합니다');
    assert.match(reviewStart, /rosterFinderInput.*void searchRosterVessels\(\)/, '이미 입력한 찾기어는 OCR 완료 즉시 새 명단으로 다시 검색합니다');
    assert.doesNotMatch(reviewStart, /sendCalculatedWageToLog|attachRosterResultToOpenLog/, 'OCR 결과가 임금·근무일지에 자동 등록되면 안 됩니다');
});
