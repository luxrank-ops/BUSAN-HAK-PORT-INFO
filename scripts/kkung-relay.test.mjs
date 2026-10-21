import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_ASSET_VERSION, readAppFile } from './app-source.mjs';

/* 꿍꿍따 "댓글 릴레이" 회귀 테스트 (2026-10-21 개편)
 *
 * 개편 방향: AI·2인 대전(승부) 게임이 아니라, 동료들이 시간 날 때마다
 * 댓글로 세 글자 단어를 이어 쓰는 릴레이입니다.
 * 그래서 아래 두 가지를 함께 고정합니다.
 *   1) 릴레이 규칙(끝 글자 잇기·중복 금지·새 출발 조건) 이 제대로 동작하는가
 *   2) 대전 방식의 잔재(턴 타이머·AI·점수판·승패 화면)가 다시 살아나지 않는가
 */

const html = readAppFile('public/index.html');
const script = readAppFile('public/js/kkung-relay.js');
const rules = readAppFile('firestore.rules');
const serviceWorker = readAppFile('public/service-worker.js');

function loadCore() {
    const document = {
        readyState: 'loading',
        hidden: false,
        addEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; }
    };
    const window = {
        localStorage: {
            getItem() { return null; },
            setItem() {}
        }
    };
    const context = vm.createContext({
        window,
        document,
        console,
        Date,
        Math,
        Set,
        Array,
        String,
        Number,
        Object,
        JSON
    });
    new vm.Script(script, { filename: 'kkung-relay.js' }).runInContext(context);
    return window.KkungKkungTtaCore;
}

const core = loadCore();

/** 테스트용 상태 문서 (Firestore 문서와 동일한 형태) */
function state(overrides = {}) {
    const { updatedAtMs = Date.now(), ...rest } = overrides;
    return core.normalizeRelayState({
        round: 1,
        starterWord: '고양이',
        lastWord: '고양이',
        wordCount: 0,
        usedWords: ['고양이'],
        lastNick: '라싱반장',
        updatedAt: updatedAtMs === null ? null : { toMillis: () => updatedAtMs },
        ...rest
    });
}

test('추천용 내장 사전은 중복 없는 한글 세 글자 단어로만 구성된다', () => {
    assert.ok(core.words.length >= 500, `어휘 수가 부족합니다: ${core.words.length}`);
    assert.equal(new Set(core.words).size, core.words.length, '사전 중복 단어가 있습니다');
    for (const word of core.words) assert.match(word, /^[가-힣]{3}$/u, `세 글자 한글 단어가 아닙니다: ${word}`);
});

test('끝 글자와 다음 단어 첫 글자를 정확하게 연결한다', () => {
    assert.equal(core.lastSyllable('고양이'), '이');
    assert.ok(core.getPlayableWords('고양이').includes('이야기'));
    assert.ok(!core.getPlayableWords('고양이', ['이야기']).includes('이야기'));
    assert.equal(core.getPlayableWords('사과즙').length, 0, '“즙”으로 시작하는 사전 단어는 없어 막힘 판정에 씁니다');
});

test('릴레이 댓글 검증: 세 글자 한글·끝말 잇기·중복만 본다 (사전 밖 단어도 허용)', () => {
    const valid = core.validateRelayWord('이야기', '고양이', ['고양이']);
    assert.equal(valid.ok, true);
    assert.equal(valid.code, 'ok');
    assert.equal(valid.word, '이야기');

    assert.equal(core.validateRelayWord('', '고양이').code, 'empty');
    assert.equal(core.validateRelayWord('  ', '고양이').code, 'empty');
    assert.equal(core.validateRelayWord('바나나', '고양이').code, 'chain');
    assert.equal(core.validateRelayWord('이야기책', '고양이').code, 'length');
    assert.equal(core.validateRelayWord('abc', '고양이').code, 'length');
    assert.equal(core.validateRelayWord('이야기', '고양이', ['고양이', '이야기']).code, 'duplicate');

    // 대전 방식과 달리 "내장 사전 단어만" 조건은 없습니다 — 실제 단어는 댓글로 남길 수 있어야 합니다.
    assert.ok(!core.words.includes('이어폰'), '테스트 전제: “이어폰”은 내장 사전에 없는 단어여야 합니다');
    const outsideDictionary = core.validateRelayWord('이어폰', '고양이', ['고양이']);
    assert.equal(outsideDictionary.ok, true, '사전 밖 단어를 막으면 릴레이가 너무 답답해집니다');
    assert.equal(outsideDictionary.word, '이어폰');

    // 공백·붙여쓰기 관용 입력은 정리해서 받아들입니다.
    assert.equal(core.validateRelayWord(' 이야기 ', '고양이', ['고양이']).word, '이야기');
});

test('이어갈 단어 추천은 막혔을 때 도움이 되는 사전 단어만 골라준다', () => {
    const picks = core.suggestRelayWords('고양이', ['고양이'], 6, () => 0.5);
    assert.equal(picks.length, 6);
    assert.equal(new Set(picks).size, picks.length, '추천에 중복이 있으면 안 됩니다');
    for (const word of picks) {
        assert.equal(word[0], '이', '끝 글자로 시작하는 단어만 추천해야 합니다');
        assert.ok(core.words.includes(word));
    }
    assert.equal(core.suggestRelayWords('사과즙', [], 6).length, 0, '막힌 글자는 추천이 없습니다');
    assert.equal(core.suggestRelayWords('고양이', [], 999).length, core.getPlayableWords('고양이').length);
});

test('새 릴레이 출발 단어는 바로 이어 쓸 수 있는 사전 단어에서 고른다', () => {
    const starter = core.chooseStarterWord(() => 0);
    assert.ok(core.words.includes(starter));
    assert.match(starter, /^[가-힣]{3}$/u);
    assert.ok(core.getPlayableWords(starter, [starter]).length > 0, '출발 단어가 바로 막히면 안 됩니다');
});

test('릴레이 상태 문서를 만들고 다시 읽을 수 있다 (Firestore 왕복)', () => {
    const created = core.createRelayState('부산항', 3, '라싱반장');
    assert.equal(created.round, 3);
    assert.equal(created.starterWord, '부산항');
    assert.equal(created.lastWord, '부산항');
    assert.equal(created.wordCount, 0);
    assert.deepEqual([...created.usedWords], ['부산항']);
    assert.equal(created.lastNick, '라싱반장');

    const restored = core.normalizeRelayState({ ...created, updatedAt: { toMillis: () => 1760000000000 } });
    assert.equal(restored.round, 3);
    assert.equal(restored.updatedAtMs, 1760000000000);

    // 비정상·누락 값이 와도 화면이 깨지지 않도록 안전한 기본값으로 정리합니다.
    const broken = core.normalizeRelayState({ round: '7', wordCount: null, usedWords: 'x', lastWord: 'abcd' });
    assert.equal(broken.round, 7);
    assert.equal(broken.wordCount, 0);
    assert.equal(broken.usedWords.length, 0);
    assert.equal(broken.lastWord, '');
    assert.equal(broken.updatedAtMs, null);
});

test('새 출발은 "막힘 · 30개 완료 · 12시간 방치"일 때만 허용된다', () => {
    const now = 1760000000000;

    // 아직 릴레이가 없으면 첫 릴레이를 열 수 있습니다.
    assert.equal(core.canStartNewRound(null, { nowMs: now }).allowed, true);

    // 이어질 단어가 없어 막힌 릴레이
    const stuck = state({ lastWord: '사과즙', usedWords: ['고양이', '사과즙'] });
    assert.equal(core.canStartNewRound(stuck, { nowMs: now }).allowed, true);

    // 30개를 채운 릴레이
    const finished = state({ wordCount: core.roundTargetWords });
    assert.equal(core.canStartNewRound(finished, { nowMs: now }).allowed, true);

    // 12시간 넘게 멈춘 릴레이
    const idle = state({ wordCount: 2, updatedAtMs: now - core.roundIdleResetMs - 1000 });
    assert.equal(core.canStartNewRound(idle, { nowMs: now }).allowed, true);

    // 지금 막 이어진 릴레이는 아무나 갈아엎을 수 없습니다 (트롤 방지)
    const running = state({ wordCount: 2, updatedAtMs: now - 60000 });
    const gate = core.canStartNewRound(running, { nowMs: now });
    assert.equal(gate.allowed, false);
    assert.match(gate.reason, /새 출발할 수 없|이어지는 중/);
});

test('참여 인원 집계와 상대 시각 표기가 댓글 릴레이 기준으로 동작한다', () => {
    const entries = [
        { name: '라싱반장' }, { name: '라싱반장' }, { name: '북항 포맨' }, { name: '' }
    ];
    assert.equal(core.countParticipants(entries), 2);
    assert.equal(core.countParticipants([]), 0);

    const now = 1760000000000;
    assert.equal(core.formatRelativeTime(null, now), '방금 전');
    assert.equal(core.formatRelativeTime(now - 30000, now), '방금 전');
    assert.equal(core.formatRelativeTime(now - 5 * 60000, now), '5분 전');
    assert.equal(core.formatRelativeTime(now - 3 * 3600000, now), '3시간 전');
    assert.match(core.formatRelativeTime(now - 3 * 86400000, now), /^\d{2}\.\d{2}$/u);
});

test('카드 마크업이 대전 게임이 아니라 댓글 릴레이(피드+작성창)로 바뀌었다', () => {
    const start = html.indexOf('<div id="safety-card"');
    const end = html.indexOf('<div id="guide-card"', start);
    assert.ok(start >= 0 && end > start, '현장가이드 내 카드 경계를 찾을 수 없습니다');
    const card = html.slice(start, end);

    assert.match(card, /꿍~꿍~따리~꿍꿍따♡/);
    assert.match(card, /id="kkungRelay"/);
    assert.match(card, /id="kkungFeed"/, '이어진 댓글 목록이 필요합니다');
    assert.match(card, /id="kkungRelayForm"/);
    assert.match(card, /id="kkungWordInput"/);
    assert.match(card, /id="kkungNick"/, '댓글 작성자 닉네임 입력이 필요합니다');
    assert.match(card, /id="kkungMemoInput"/, '한 줄 메모(선택) 입력이 필요합니다');
    assert.match(card, /id="kkungNewRoundButton"/, '막혔을 때 새 릴레이를 여는 버튼이 필요합니다');
    assert.match(card, /id="kkungSuggestBox"/, '이어갈 단어 추천 영역이 필요합니다');
    assert.match(card, /id="kkungRelayStatus"[^>]*aria-live="polite"/);
    assert.match(card, /시간 날 때/u, '카드 설명에 "시간 날 때" 릴레이 방식이 드러나야 합니다');

    // 대전(승부) 방식 잔재 금지
    assert.doesNotMatch(card, /data-kkung-mode/, 'AI/2인 모드 선택이 남아 있으면 안 됩니다');
    assert.doesNotMatch(card, /AI 대결|AI 대전|누구와 대결/u);
    assert.doesNotMatch(card, /kkungTimer/, '턴 제한 시간 바가 남아 있으면 안 됩니다');
    assert.doesNotMatch(card, /kkungResult|승리|한 판/u, '승패 결과 화면이 남아 있으면 안 됩니다');
    assert.doesNotMatch(card, /kkungPlayers|kkungDifficulty|kkungPlayerOne/);
    assert.doesNotMatch(card, /6단계: 중대 사고 발생 시 대처 매뉴얼/);
});

test('릴레이 모듈은 Firestore kkung_chain 을 실시간 구독하고 트랜잭션으로 이어 쓴다', () => {
    assert.equal(core.collection, 'kkung_chain');
    assert.equal(core.docId, 'active');
    assert.match(rules, /match \/kkung_chain\/active \{/, '릴레이용 보안 규칙이 필요합니다');

    assert.match(script, /onSnapshot/, '다른 동료가 남긴 댓글을 실시간으로 받아야 합니다');
    assert.match(script, /runTransaction/, '동시에 같은 단어를 잇는 사고를 트랜잭션으로 막아야 합니다');
    assert.match(script, /orderBy\('timestamp', 'desc'\)/);
    assert.match(script, /IntersectionObserver/, '카드를 볼 때만 구독해 읽기 비용을 아껴야 합니다');

    // 대전 방식 코드 금지
    assert.doesNotMatch(script, /chooseAiWord|TURN_SECONDS|isAiThinking|finishRound/);
    assert.doesNotMatch(script, /setInterval/, '턴 타이머가 없으므로 주기 실행도 없어야 합니다');
    assert.ok(!existsSync(new URL('../public/js/kkung-game.js', import.meta.url)), '옛 대전 게임 파일이 남아 있으면 안 됩니다');
});

test('릴레이 운영값이 화면 코드와 보안 규칙에서 일치한다', () => {
    // 규칙의 단어 상한(500)은 화면 상한보다 커야 화면이 먼저 안내할 수 있습니다.
    assert.ok(core.maxUsedWords <= 500, `화면 단어 상한(${core.maxUsedWords})이 규칙 상한(500)을 넘습니다`);
    assert.match(rules, /data\.usedWords\.size\(\) <= 500/);
    assert.match(rules, /data\.wordCount >= 0 && data\.wordCount <= 500/);
    assert.match(rules, /request\.time\.toMillis\(\) > before\.updatedAt\.toMillis\(\) \+ 60000/, '새 출발 60초 간격 제한이 필요합니다');
    assert.match(rules, /isValidKkungWord\(data\.word\)/, '댓글 단어는 세 글자 한글만 허용해야 합니다');
    assert.match(rules, /match \/comments\/\{commentId\} \{[\s\S]*?allow update, delete: if isAdmin\(\);/, '릴레이 댓글 수정·삭제는 관리자 전용이어야 합니다');
    assert.equal(core.roundTargetWords, 30);
    assert.equal(core.roundIdleResetMs, 12 * 60 * 60 * 1000);
});

test('릴레이 자산 버전이 HTML·서비스워커·앱 소스 상수에서 모두 일치한다', () => {
    assert.ok(html.includes(`<script src="./js/kkung-relay.js?v=${APP_ASSET_VERSION}"></script>`));
    assert.ok(serviceWorker.includes(`"/js/kkung-relay.js?v=${APP_ASSET_VERSION}"`));
    assert.ok(!html.includes('kkung-game.js'), '옛 모듈 참조가 남아 있으면 안 됩니다');
    assert.ok(!serviceWorker.includes('kkung-game.js'));
});
