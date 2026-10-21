import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/js/kkung-game.js', import.meta.url), 'utf8');

function loadCore() {
    const document = {
        readyState: 'loading',
        addEventListener() {},
        getElementById() { return null; }
    };
    const window = {
        localStorage: {
            getItem() { return null; },
            setItem() {}
        }
    };
    const context = vm.createContext({ window, document, console, Date, Math, Set, Array, String, Number, JSON });
    new vm.Script(script, { filename: 'kkung-game.js' }).runInContext(context);
    return window.KkungKkungTtaCore;
}

const core = loadCore();

test('내장 사전은 중복 없는 한글 세 글자 단어로만 구성된다', () => {
    assert.ok(core.words.length >= 500, `어휘 수가 부족합니다: ${core.words.length}`);
    assert.equal(new Set(core.words).size, core.words.length, '사전 중복 단어가 있습니다');
    for (const word of core.words) assert.match(word, /^[가-힣]{3}$/u, `세 글자 한글 단어가 아닙니다: ${word}`);
});

test('끝 글자와 다음 단어 첫 글자를 정확하게 연결한다', () => {
    assert.equal(core.lastSyllable('고양이'), '이');
    assert.deepEqual(core.getPlayableWords('고양이').filter(word => word.startsWith('이')), core.getPlayableWords('고양이'));
    assert.ok(core.getPlayableWords('고양이').includes('이야기'));
    assert.ok(!core.getPlayableWords('고양이', ['이야기']).includes('이야기'));
});

test('세 글자·내장 사전·끝말 연결·중복 규칙을 각각 검증한다', () => {
    const valid = core.validateWord('이야기', '고양이', ['고양이']);
    assert.equal(valid.ok, true);
    assert.equal(valid.code, 'ok');
    assert.equal(valid.word, '이야기');
    assert.equal(core.validateWord('', '고양이').code, 'empty');
    assert.equal(core.validateWord('바나나', '고양이').code, 'chain');
    assert.equal(core.validateWord('이게뭐', '고양이').code, 'dictionary');
    assert.equal(core.validateWord('이야기책', '고양이').code, 'length');
    assert.equal(core.validateWord('이야기', '고양이', ['이야기']).code, 'duplicate');
});

test('시작 단어와 AI·힌트 추천은 현재 끝 글자에 맞는 미사용 단어를 고른다', () => {
    const starter = core.chooseStarterWord(() => 0);
    assert.ok(core.words.includes(starter));
    assert.ok(core.getPlayableWords(starter, [starter]).length > 0);

    const used = new Set([starter]);
    const aiWord = core.chooseAiWord(starter, used, 'normal', () => 0);
    assert.ok(aiWord);
    assert.equal(aiWord[0], core.lastSyllable(starter));
    assert.ok(!used.has(aiWord));

    const hint = core.chooseHint(starter, used, () => 0);
    assert.ok(hint);
    assert.equal(hint[0], core.lastSyllable(starter));
    assert.ok(!used.has(hint));
    assert.equal(core.chooseAiWord('사과즙', [], 'hard'), null);
});

test('안전 지침 카드가 끝말잇기 게임으로 바뀌고 기존 현장가이드 카드 위치는 유지된다', () => {
    const start = html.indexOf('<div id="safety-card"');
    const end = html.indexOf('<div id="guide-card"', start);
    assert.ok(start >= 0 && end > start, '현장가이드 내 카드 경계를 찾을 수 없습니다');
    const card = html.slice(start, end);
    assert.match(card, /꿍~꿍~따리~꿍꿍따♡/);
    assert.match(card, /id="kkungGame"/);
    assert.match(card, /data-kkung-mode="ai"/);
    assert.match(card, /data-kkung-mode="local"/);
    assert.match(card, /id="kkungWordInput"/);
    assert.doesNotMatch(card, /6단계: 중대 사고 발생 시 대처 매뉴얼/);
    assert.match(html, /<script src="\.\/js\/kkung-game\.js\?v=\d+\.\d+"><\/script>/);
});
