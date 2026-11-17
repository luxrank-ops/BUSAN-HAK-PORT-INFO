import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

/**
 * 근무배치 사진 OCR — 밴드 앱 캡처본 대응 (2026-11-17)
 *
 * 실제 근무배치 사진은 네이버 밴드 앱 화면을 그대로 캡처해 위아래가 어두운 앱 UI로 덮여 있습니다.
 * 그 상태로 대비를 늘리면 종이의 회색 격자선까지 흰색으로 날아가 표 칸이 0개가 되고(실측 이름 0/96),
 * 종이만 잘라 내면 같은 사진에서 선박 4척·이름 73/96을 읽습니다.
 * 이 테스트는 그 "어디를 종이로 보는지"를 고정합니다.
 */
const engine = readFileSync(new URL('../public/js/roster-engine.js', import.meta.url), 'utf8');

function createEngineContext() {
    const context = vm.createContext({
        console: { warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        window: {},
        readSessionValue: () => null,
        showToast() {},
        trackAppEvent() {}
    });
    vm.runInContext(engine, context, { filename: 'public/js/roster-engine.js' });
    return context;
}

/** 배경(밝기 background) 위에 종이 사각형(밝기 paper)을 칠한 가짜 이미지 */
function buildPhoto(width, height, paper, background) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const inside = x >= paper.x && x < paper.x + paper.width && y >= paper.y && y < paper.y + paper.height;
            const value = inside ? paper.value : background;
            const offset = (y * width + x) * 4;
            data[offset] = value;
            data[offset + 1] = value;
            data[offset + 2] = value;
            data[offset + 3] = 255;
        }
    }
    return { width, height, data };
}

test('어두운 앱 UI로 덮인 캡처본은 밝은 종이 영역만 잘라 낸다', () => {
    const context = createEngineContext();
    const findBounds = vm.runInContext('findRosterPaperBounds', context);
    // 위아래 25%가 어두운 밴드 UI, 종이는 가운데 60% 높이
    const photo = buildPhoto(400, 800, { x: 30, y: 200, width: 340, height: 480, value: 185 }, 31);
    const bounds = findBounds(photo, 400, 800);
    assert.ok(bounds, '종이 영역을 찾아야 합니다');
    assert.ok(Math.abs(bounds.x - 30) <= 6, `왼쪽 경계: ${bounds.x}`);
    assert.ok(Math.abs(bounds.y - 200) <= 6, `위쪽 경계: ${bounds.y}`);
    assert.ok(Math.abs(bounds.width - 340) <= 12, `폭: ${bounds.width}`);
    assert.ok(Math.abs(bounds.height - 480) <= 12, `높이: ${bounds.height}`);
});

test('종이가 사진을 가득 채우면 자르지 않는다', () => {
    const context = createEngineContext();
    const findBounds = vm.runInContext('findRosterPaperBounds', context);
    const photo = buildPhoto(400, 800, { x: 0, y: 0, width: 400, height: 800, value: 190 }, 190);
    assert.equal(findBounds(photo, 400, 800), null);
    assert.equal(findBounds({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, 0, 0), null);
});

test('표 날짜 칸이 뭉개져도 11/13을 1/13으로 낮추지 않는다', () => {
    const context = createEngineContext();
    const readDate = vm.runInContext('readRosterTableHeaderDate', context);
    assert.equal(readDate('11/13] NYK PAULA 21:00', 2026), '2026-11-13');
    assert.equal(readDate('11/131', 2026), '2026-11-13', '날짜 뒤 잡음 숫자는 날짜로 봅니다');
    assert.equal(readDate('「 [1113] ONE MADRID KML', 2026), '2026-11-13', '구분선이 사라진 4자리도 날짜로 봅니다');
    assert.equal(readDate('21:00', 2026), '');
});

test('작업 메모는 작업자 칸 이름으로 올리지 않고, 일반 OCR 원문은 그대로 둔다', () => {
    const context = createEngineContext();
    // 원문 경로는 예전처럼 보정 없이 그대로 (기존 동작 유지)
    const raw = (line) => JSON.parse(JSON.stringify(vm.runInContext('pickWorkersFromOcrLine', context)(line)));
    const names = (line) => JSON.parse(JSON.stringify(vm.runInContext('readRosterWorkerCellNames', context)(line)));
    assert.deepEqual(raw('원지현 19:00 벌크선적 42BAY'), ['원지현', '벌크선적']);
    // 표의 작업자 칸 경로만 작업 메모를 이름에서 뺍니다
    assert.deepEqual(names('원지현 19:00 벌크선적 42BAY 벨트56'), ['원지현']);
    assert.deepEqual(names('김경민1 남영우 11/14 15:00추가'), ['김경민1', '남영우']);
});

test('띄엄띄엄 인식된 이름 글자는 한 이름으로 잇고, 이름 사이 간격은 나눈다', () => {
    const context = createEngineContext();
    const collect = vm.runInContext('collectRosterWorkerCellNames', context);
    // 실제 사진의 단어 좌표: 이름 안 글자 간격 10~19px, 이름 사이 간격 40px, 글자 높이 34px
    const words = [
        { text: '원', bbox: { x0: 3, y0: 29, x1: 31, y1: 63 } },
        { text: '지', bbox: { x0: 50, y0: 30, x1: 87, y1: 62 } },
        { text: '현', bbox: { x0: 87, y0: 14, x1: 113, y1: 72 } },
        { text: '오', bbox: { x0: 141, y0: 30, x1: 166, y1: 57 } },
        { text: '규', bbox: { x0: 181, y0: 28, x1: 204, y1: 60 } },
        { text: '환', bbox: { x0: 221, y0: 28, x1: 239, y1: 61 } },
        { text: '김', bbox: { x0: 1160, y0: 78, x1: 1180, y1: 111 } },
        { text: '경', bbox: { x0: 1197, y0: 78, x1: 1218, y1: 111 } },
        { text: '민', bbox: { x0: 1234, y0: 78, x1: 1252, y1: 109 } },
        { text: '1', bbox: { x0: 1263, y0: 81, x1: 1270, y1: 105 } },
        { text: '19:00', bbox: { x0: 1494, y0: 84, x1: 1623, y1: 131 } }
    ];
    assert.deepEqual(JSON.parse(JSON.stringify(collect(words))), ['원지현', '오규환', '김경민1']);
});

test('Vision에 보낸 사진 배율만큼 표 영역 좌표도 함께 옮긴다', () => {
    const context = createEngineContext();
    const scale = vm.runInContext('scaleRosterTableRegions', context);
    const regions = [{
        index: 0,
        rowIndex: 0,
        columnIndex: 0,
        header: { x: 10, y: 20, width: 400, height: 50 },
        workers: { x: 10, y: 70, width: 400, height: 300 }
    }];
    const half = JSON.parse(JSON.stringify(scale(regions, 0.5)));
    assert.deepEqual(half[0].header, { x: 5, y: 10, width: 200, height: 25 });
    assert.deepEqual(half[0].workers, { x: 5, y: 35, width: 200, height: 150 });
    assert.equal(scale(regions, 1), regions, '배율이 같으면 그대로 씁니다');
});
