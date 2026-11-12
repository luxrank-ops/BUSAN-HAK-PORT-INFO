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
        readSessionValue: () => null,
        showToast() {},
        trackAppEvent() {}
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

test('원본 작업자 칸 수와 검토 출력 인원이 다르면 찾기와 저장을 보류한다', () => {
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
            staleFinderResults: rosterRuntime.finderResults.length
        };
    })()`)));
    assert.deepEqual(result, { source: 2, output: 3, verified: false, beforeSave: 0, saved: false, persisted: 0, staleFinderResults: 0 });
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
    assert.deepEqual(result, { source: 2, output: 1, verified: false, searchable: 0 });
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

test('사진 OCR 선박명은 단일 활성 입출항 스케줄 후보일 때만 정식명으로 자동 확정한다', () => {
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
    assert.equal(photo.run(`(() => { const row = { date: '2026-11-11', vessel: 'CMA CGM PANAM' }; verifyRosterPhotoVesselName(row, ${JSON.stringify(singleCandidateSchedules)}); return row.vessel; })()`), 'CMA CGM PANAM', '비교 함수 자체는 원문을 바꾸지 않습니다');
    const automatic = JSON.parse(JSON.stringify(photo.run(`(() => {
        const rows = [{ date: '2026-11-11', vessel: 'CMA CGM PANAM' }];
        const checks = buildRosterPhotoVesselVerifications(rows, ${JSON.stringify(singleCandidateSchedules)});
        const applied = applyUniqueRosterPhotoScheduleNames(rows, checks);
        return { applied, row: rows[0], check: checks[0] };
    })()`)));
    assert.equal(automatic.applied, 1);
    assert.equal(automatic.row.vessel, 'CMA CGM PANAMA');
    assert.equal(automatic.row.scheduleNameSource, 'CMA CGM PANAM');
    assert.equal(automatic.check.status, 'auto-corrected');
    assert.equal(automatic.check.officialName, 'CMA CGM PANAMA');
    const refreshed = JSON.parse(JSON.stringify(photo.run(`(() => {
        const rows = [{ date: '2026-11-11', vessel: 'CMA CGM PANAMA', scheduleNameSource: 'CMA CGM PANAM' }];
        const checks = buildRosterPhotoVesselVerifications(rows, ${JSON.stringify(singleCandidateSchedules)});
        const applied = applyUniqueRosterPhotoScheduleNames(rows, checks);
        return { applied, vessel: rows[0].vessel, status: checks[0].status, literalName: checks[0].literalName };
    })()`)));
    assert.deepEqual(refreshed, { applied: 0, vessel: 'CMA CGM PANAMA', status: 'auto-corrected', literalName: 'CMA CGM PANAM' }, '재확인해도 OCR 원문과 확정 근거를 보여 줍니다');

    const ambiguous = JSON.parse(JSON.stringify(photo.run(`(() => {
        const rows = [{ date: '2026-11-11', vessel: 'CMA CGM PANAM' }];
        const checks = buildRosterPhotoVesselVerifications(rows, ${JSON.stringify(schedules)});
        const applied = applyUniqueRosterPhotoScheduleNames(rows, checks);
        return { applied, vessel: rows[0].vessel, status: checks[0].status };
    })()`)));
    assert.deepEqual(ambiguous, { applied: 0, vessel: 'CMA CGM PANAM', status: 'ambiguous' }, '복수 후보는 자동 확정하면 안 됩니다');

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
    for (const id of ['rosterPhotoInput', 'rosterPhotoGalleryInput', 'rosterPhotoOcrBtn', 'rosterPhotoClearBtn', 'rosterFinderResetBtn', 'rosterPhotoStatus', 'rosterPhotoPreviewWrap', 'rosterPhotoPreview', 'rosterPhotoTextDetails', 'rosterPhotoText', 'rosterPhotoRows', 'rosterPhotoSaved']) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `missing or duplicate #${id}`);
    }
    assert.match(html, /id="rosterPhotoInput" accept="image\/\*" capture="environment"/);
    assert.match(html, /id="rosterPhotoGalleryInput" accept="image\/\*"/);
    assert.match(html, /id="rosterFinderResetBtn"[^>]*onclick="resetRosterFinder\(\)"/);
    assert.ok(html.includes('서버로 전송되지 않고'));
    assert.ok(html.includes('사진 자체는 저장하지 않습니다'));
    assert.ok(html.includes('이름 보정·제목\/회사 제외·중복 제거 없이'));
    assert.ok(html.includes('인식 내용 검토표로 보기'));
    assert.ok(html.includes('2열 반복 표는 선박별 헤더와 그 아래 작업자 칸을 따로 읽습니다'));
    assert.ok(html.includes('입·출항 스케줄로 선박명을 교차 확인'));
    assert.ok(html.includes('스케줄 정식명으로 자동 확정'));
    assert.ok(html.includes('복수 후보·날짜 불일치·미발견은 자동 변경하지 않습니다'));
    assert.match(html, /parseRosterPhotoTextFromBox\(\)/);
    assert.match(engine, /function detectRosterTableRegions\(imageData, width, height\)/);
    assert.match(engine, /function collectRosterTableWorkers\(words, region\)/);
    assert.match(engine, /function recognizeRosterTablePhoto\(engine, sourceCanvas, regions, defaultYear\)/);
    assert.match(engine, /function verifyRosterPhotoVessels\(\)/);
    assert.match(engine, /function applyUniqueRosterPhotoScheduleNames\(rows, verifications\)/);
    assert.match(engine, /function syncRosterPhotoSearchEntries\(\)/);
    assert.match(engine, /function findRosterRelatedTermsInAssignment\(row, query\)/);
    assert.match(engine, /function applyRosterPhotoRoster\(\)/);
    const reviewStart = engine.slice(engine.indexOf('function beginRosterPhotoReview'), engine.indexOf('function parseRosterPhotoTextFromBox'));
    assert.match(reviewStart, /syncRosterPhotoSearchEntries\(\)/, 'OCR 결과는 별도 적용 없이 찾기에 바로 반영합니다');
    assert.match(reviewStart, /rosterFinderInput.*void searchRosterVessels\(\)/, '이미 입력한 찾기어는 OCR 완료 즉시 새 명단으로 다시 검색합니다');
    assert.doesNotMatch(reviewStart, /sendCalculatedWageToLog|attachRosterResultToOpenLog/, 'OCR 결과가 임금·근무일지에 자동 등록되면 안 됩니다');
});
