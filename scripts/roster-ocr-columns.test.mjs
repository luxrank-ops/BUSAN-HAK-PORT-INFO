import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

/**
 * 근무배치 사진 OCR — 좌우 열 분할 폴백 (2026-11-17)
 *
 * 표 격자선이 기울면 detectRosterTableRegions 가 실패해 통짜 인식으로 떨어지고,
 * 두 열이 한 줄로 섞여 이름 대부분을 잃습니다(실측 12/87). 그래서 통짜 인식이
 * 부족할 때만 글자가 없는 세로 여백을 찾아 좌우를 나눠 읽습니다.
 * 이 테스트는 그 "어디서 나눌지"를 고르는 순수 함수를 고정합니다.
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

/** 흰 바탕(또는 어두운 책상 배경)에 잉크 세로 구간을 칠한 가짜 ImageData */
function buildImageData(width, height, inkRanges, backgroundColor = 255) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
        data[index] = backgroundColor;
        data[index + 1] = backgroundColor;
        data[index + 2] = backgroundColor;
        data[index + 3] = 255;
    }
    for (const [from, to] of inkRanges) {
        for (let y = 0; y < height; y += 1) {
            for (let x = Math.max(0, from); x < Math.min(width, to); x += 1) {
                const offset = (y * width + x) * 4;
                data[offset] = 20;
                data[offset + 1] = 20;
                data[offset + 2] = 20;
            }
        }
    }
    return { width, height, data };
}

/** 종이(밝은) 영역만 남기고 바깥을 어두운 책상으로 칠합니다. */
function withDarkDesk(image, paper) {
    const { width, height, data } = image;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (x >= paper[0] && x <= paper[1]) continue;
            const offset = (y * width + x) * 4;
            data[offset] = 60;
            data[offset + 1] = 60;
            data[offset + 2] = 60;
        }
    }
    return image;
}

test('두 열 표는 가운데 세로 여백에서 좌우로 나눈다', () => {
    const context = createEngineContext();
    const findSplits = vm.runInContext('findRosterColumnSplits', context);
    const splits = findSplits(buildImageData(400, 300, [[40, 180], [220, 360]]), 400, 300);
    assert.equal(splits.length, 1, '두 열 표는 분할 지점이 하나여야 합니다');
    assert.ok(Math.abs(splits[0] - 200) <= 2, `분할 지점이 가운데 여백이어야 합니다: ${splits[0]}`);
});

test('여백이 뚜렷하지 않으면 종이 가운데에서 나눈다', () => {
    const context = createEngineContext();
    const findSplits = vm.runInContext('findRosterColumnSplits', context);
    // 책상 위에 놓인 종이: 사진 가장자리는 어둡고 종이는 40~300 사이에만 있습니다.
    const photo = withDarkDesk(buildImageData(400, 300, [[60, 290]]), [40, 300]);
    const splits = findSplits(photo, 400, 300);
    assert.equal(splits.length, 1);
    assert.ok(Math.abs(splits[0] - 170) <= 4, `사진이 아니라 종이의 가운데여야 합니다: ${splits[0]}`);
    assert.equal(findSplits({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, 0, 0).length, 0,
        '픽셀을 읽을 수 없으면 분할하지 않습니다');
});

test('열 분할 읽기는 왼쪽→오른쪽 순서로 원문을 이어 붙인다', async () => {
    const drawn = [];
    let call = 0;
    const context = vm.createContext({
        console: { warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => ({
                width: 0,
                height: 0,
                getContext: () => ({
                    imageSmoothingEnabled: false,
                    imageSmoothingQuality: "",
                    drawImage: (...args) => drawn.push(args)
                })
            })
        },
        window: {},
        readSessionValue: () => null,
        showToast() {},
        trackAppEvent() {}
    });
    vm.runInContext(engine, context, { filename: 'public/js/roster-engine.js' });
    const recognize = async () => ({ text: `STRIP-${++call}`, confidence: 80 });
    const canvas = { width: 1000, height: 800 };
    const result = await vm.runInContext('recognizeRosterPhotoColumns', context)(recognize, canvas, [480]);
    assert.equal(result.text, 'STRIP-1\nSTRIP-2', '열 순서대로 이어 붙여야 합니다');
    assert.equal(result.confidence, 80);
    assert.equal(drawn.length, 2, '두 열을 각각 그려 읽어야 합니다');
    assert.equal(drawn[0][1], 0, '첫 열은 0에서 시작');
    assert.equal(drawn[1][1], 480, '둘째 열은 분할 지점에서 시작');

    const tooNarrow = await vm.runInContext('recognizeRosterPhotoColumns', context)(recognize, canvas, [80]);
    assert.equal(tooNarrow, null, '나눈 폭이 너무 좁으면 통짜 인식 결과를 그대로 씁니다');
});

test('열 분할 폴백은 표준 인식이 부족할 때만 쓰인다', () => {
    const context = createEngineContext();
    const shouldRetry = vm.runInContext('shouldRetryRosterOcr', context);
    assert.equal(shouldRetry({ text: '', entryCount: 0, workerCount: 0 }), true);
    assert.equal(shouldRetry({ text: 'x', entryCount: 3, workerCount: 2 }), true, '작업자 4명 미만은 재시도');
    assert.equal(shouldRetry({ text: 'x', entryCount: 3, workerCount: 12 }), false, '충분히 읽힌 결과는 그대로 씁니다');
});
