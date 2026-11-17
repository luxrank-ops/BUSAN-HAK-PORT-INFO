import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

/**
 * 근무배치 사진 OCR — 작업자 칸 2열 분리 (2026-11-17)
 *
 * 한 선박의 작업자 칸은 이름이 2열로 인쇄됩니다(원문자 ①·②가 열 머리에 붙습니다).
 * 칸을 통째로 읽어 이름이 적게 나오면 열 사이 여백을 찾아 좌·우를 따로 확대해 읽습니다.
 * 이 테스트는 "어디서 나눌지"와 "나눠 읽은 이름을 어떻게 합칠지"를 고정합니다.
 */
const engine = readFileSync(new URL('../public/js/roster-engine.js', import.meta.url), 'utf8');

function createEngineContext(documentOverrides = {}) {
    const context = vm.createContext({
        console: { warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            ...documentOverrides
        },
        window: {},
        readSessionValue: () => null,
        showToast() {},
        trackAppEvent() {}
    });
    vm.runInContext(engine, context, { filename: 'public/js/roster-engine.js' });
    return context;
}

/** 흰 바탕에 지정한 세로 구간만 어두운 글자(잉크)로 칠한 가짜 작업자 칸 캔버스 */
function buildCellCanvas(width, height, inkRanges) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (const [from, to] of inkRanges) {
        for (let y = 0; y < height; y += 3) {
            for (let x = Math.max(0, from); x < Math.min(width, to); x += 1) {
                const offset = (y * width + x) * 4;
                data[offset] = 25;
                data[offset + 1] = 25;
                data[offset + 2] = 25;
            }
        }
    }
    return {
        width,
        height,
        getContext: () => ({ getImageData: () => ({ width, height, data }) })
    };
}

test('2열로 인쇄된 작업자 칸은 열 사이 여백에서 나눈다', () => {
    const context = createEngineContext();
    const findSplit = vm.runInContext('findRosterWorkerCellColumnSplit', context);
    const canvas = buildCellCanvas(400, 400, [[20, 150], [250, 380]]);
    const split = findSplit(canvas);
    assert.ok(Math.abs(split - 200) <= 4, `분할 지점이 가운데 여백이어야 합니다: ${split}`);
});

test('한 열로 가득 찬 칸은 나누지 않는다', () => {
    const context = createEngineContext();
    const findSplit = vm.runInContext('findRosterWorkerCellColumnSplit', context);
    assert.equal(findSplit(buildCellCanvas(400, 400, [[10, 390]])), -1);
    // 한쪽에만 이름이 있으면 2열 표가 아닙니다.
    assert.equal(findSplit(buildCellCanvas(400, 400, [[10, 150]])), -1);
});

test('픽셀을 읽을 수 없으면 나누지 않는다', () => {
    const context = createEngineContext();
    const findSplit = vm.runInContext('findRosterWorkerCellColumnSplit', context);
    assert.equal(findSplit({ width: 0, height: 0 }), -1);
    assert.equal(findSplit({
        width: 400,
        height: 400,
        getContext: () => ({ getImageData: () => { throw new Error('tainted'); } })
    }), -1);
});

test('나눠 읽기는 열 캔버스를 만들어 좌표 그대로 잘라 넘긴다', async () => {
    const drawn = [];
    const context = createEngineContext({
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => ({
                imageSmoothingEnabled: false,
                imageSmoothingQuality: "",
                drawImage: (...args) => drawn.push(args)
            }),
            toDataURL: () => "data:image/png;base64,STUB"
        })
    });
    const readColumn = vm.runInContext('readRosterWorkerColumnNames', context);
    const recognize = async () => ({
        data: {
            words: [
                { text: '원지현', bbox: { x0: 10, y0: 10, x1: 90, y1: 30 } },
                { text: '강남오', bbox: { x0: 10, y0: 50, x1: 90, y1: 70 } }
            ]
        }
    });
    const names = await readColumn({ recognize }, { width: 600, height: 400 }, 0, 300);
    assert.deepEqual(Array.from(names), ['원지현', '강남오']);
    assert.equal(drawn.length, 1);
    assert.equal(drawn[0][1], 0, '왼쪽 열은 x=0 에서 시작');
    assert.equal(drawn[0][3], 300, '왼쪽 열 폭은 분할 지점까지');
});

test('이름 뒤 구분 숫자는 남기고 중복 이름은 한 번만 쓴다', () => {
    const context = createEngineContext();
    const dedupe = vm.runInContext('dedupeRosterWorkerNames', context);
    assert.deepEqual(Array.from(dedupe(['김유신1', '김유신1', '오용구', '', '김경민1'])), ['김유신1', '오용구', '김경민1']);
});
