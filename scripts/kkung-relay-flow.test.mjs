import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAppFile } from './app-source.mjs';

/* 꿍꿍따 "댓글 릴레이" 화면 흐름 테스트 (2026-10-21 개편)
 *
 * scripts/kkung-relay.test.mjs 가 순수 로직(단어 검증·새 출발 조건)을 본다면,
 * 이 파일은 **실제 화면 흐름**을 아주 작은 DOM·Firestore 스텁으로 돌려 봅니다.
 *   카드 열림 → 구독 → 첫 릴레이 시작 → 댓글로 단어 이어쓰기 → 다른 동료 댓글 반영
 *   → 잘못 잇기/중복/금칙어 차단 → 막힌 릴레이 새 출발
 * Firestore 규칙 자체의 허용·거부는 scripts/rules/firestore-rules.emulator.test.mjs(CI)가 증명합니다.
 */

const script = readAppFile('public/js/kkung-relay.js');

const RELAY_IDS = [
    'kkungRelay', 'kkungDictionaryCount', 'kkungNick', 'kkungRelayForm', 'kkungSuggestBox',
    'kkungHintButton', 'kkungNewRoundButton', 'kkungRelayStatus', 'kkungLiveBadge',
    'kkungWordTotal', 'kkungMemberTotal', 'kkungRoundTitle', 'kkungLastWord',
    'kkungRequiredLetter', 'kkungFeedMeta', 'kkungNewRoundHint', 'kkungFeed',
    'kkungWordInput', 'kkungMemoInput', 'kkungSubmit'
];

/* ---------------- 아주 작은 DOM 스텁 ---------------- */

function makeElement(tag = 'div') {
    const classes = new Set();
    const element = {
        tagName: String(tag).toUpperCase(),
        children: [],
        attributes: {},
        listeners: {},
        value: '',
        disabled: false,
        hidden: false,
        focused: false,
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        _text: '',
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            toggle(name, force) {
                const on = force === undefined ? !classes.has(name) : Boolean(force);
                if (on) classes.add(name);
                else classes.delete(name);
                return on;
            },
            contains: (name) => classes.has(name)
        },
        get textContent() { return this._text; },
        set textContent(value) { this._text = String(value); this.children.length = 0; },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children.length = 0; this.children.push(...nodes); },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
        addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
        dispatchEvent(type, event = {}) {
            const detail = { target: this, preventDefault() {}, ...event };
            (this.listeners[type] || []).forEach(handler => handler(detail));
            return detail;
        },
        focus() { this.focused = true; },
        // 추천 칩 클릭(event.target.closest('[data-kkung-word]'))만 필요하므로 그 선택자만 지원합니다.
        closest(selector) {
            if (selector === '[data-kkung-word]') return this.getAttribute('data-kkung-word') === null ? null : this;
            return null;
        }
    };
    return element;
}

function makeDocument() {
    const elements = new Map();
    RELAY_IDS.forEach(id => elements.set(id, makeElement(id === 'kkungFeed' ? 'ol' : 'div')));
    return {
        readyState: 'complete',
        hidden: false,
        elements,
        getElementById(id) { return elements.get(id) || null; },
        createElement(tag) { return makeElement(tag); },
        addEventListener() {}
    };
}

/* ---------------- 아주 작은 Firestore 스텁 (kkung_chain 전용) ---------------- */

function createFakeFirestore() {
    const STATE_PATH = 'kkung_chain/active';
    let stateData = null;
    const stateListeners = [];
    const commentDocs = [];   // { id, data, seq }
    const commentListeners = [];
    let sequence = 0;

    const snapshotOf = (data) => ({ exists: Boolean(data), data: () => (data ? { ...data } : undefined) });

    const feedSnapshot = () => {
        const ordered = [...commentDocs].sort((a, b) => b.seq - a.seq).slice(0, 150);
        return { forEach: (handler) => ordered.forEach(item => handler({ id: item.id, data: () => ({ ...item.data }) })) };
    };

    const fireState = () => stateListeners.forEach(handler => handler(snapshotOf(stateData)));
    const fireFeed = () => commentListeners.forEach(handler => handler(feedSnapshot()));

    const commentsCollection = () => {
        const query = {
            orderBy() { return query; },
            limit() { return query; },
            onSnapshot(handler) {
                commentListeners.push(handler);
                handler(feedSnapshot());
                return () => {
                    const index = commentListeners.indexOf(handler);
                    if (index >= 0) commentListeners.splice(index, 1);
                };
            },
            doc(id) {
                const commentId = id || `auto-${++sequence}`;
                return { __id: commentId, __path: `${STATE_PATH}/comments/${commentId}` };
            }
        };
        return query;
    };

    const applyWrite = (operation) => {
        if (operation.ref.__path === STATE_PATH) {
            stateData = operation.type === 'update' ? { ...(stateData || {}), ...operation.data } : { ...operation.data };
            return;
        }
        const index = commentDocs.findIndex(item => item.id === operation.ref.__id);
        const record = { id: operation.ref.__id, data: { ...operation.data }, seq: ++sequence };
        if (index >= 0) commentDocs[index] = record;
        else commentDocs.push(record);
    };

    const stateRef = {
        __path: STATE_PATH,
        onSnapshot(handler) {
            stateListeners.push(handler);
            handler(snapshotOf(stateData));
            return () => {
                const index = stateListeners.indexOf(handler);
                if (index >= 0) stateListeners.splice(index, 1);
            };
        },
        collection(name) { return name === 'comments' ? commentsCollection() : null; }
    };

    const db = {
        collection(name) {
            if (name !== 'kkung_chain') throw new Error(`스텁은 kkung_chain 만 지원합니다: ${name}`);
            return { doc: (id) => (id === 'active' ? stateRef : null) };
        },
        async runTransaction(updateFunction) {
            const operations = [];
            const transaction = {
                async get(ref) {
                    if (ref.__path === STATE_PATH) return snapshotOf(stateData);
                    const found = commentDocs.find(item => item.id === ref.__id);
                    return snapshotOf(found ? found.data : null);
                },
                set(ref, data) { operations.push({ type: 'set', ref, data }); },
                update(ref, data) { operations.push({ type: 'update', ref, data }); }
            };
            await updateFunction(transaction);   // 중간에 던지면 아무것도 적용되지 않습니다(롤백)
            operations.forEach(applyWrite);
            fireState();
            fireFeed();
        }
    };

    return {
        db,
        getState: () => (stateData ? { ...stateData } : null),
        getComments: () => commentDocs.map(item => ({ id: item.id, ...item.data })),
        /** 다른 동료/관리자 동작을 흉내낼 때 쓰는 테스트 전용 주입 */
        setState(next, { silent = false } = {}) {
            stateData = next ? { ...next } : null;
            if (!silent) { fireState(); fireFeed(); }
        },
        addComment(data) {
            commentDocs.push({ id: `seed-${++sequence}`, data: { ...data }, seq: ++sequence });
            fireFeed();
        }
    };
}

/* ---------------- 모듈 부팅 ---------------- */

function bootRelay(options = {}) {
    const document = makeDocument();
    const store = createFakeFirestore();
    const storage = options.storage || new Map();
    const confirms = [];
    const blinds = [];

    const window = {
        localStorage: {
            getItem: (key) => (storage.has(key) ? storage.get(key) : null),
            setItem: (key, value) => storage.set(key, String(value))
        },
        firebase: {
            firestore: {
                FieldValue: { serverTimestamp: () => ({ toMillis: () => Date.now(), __serverTimestamp: true }) }
            }
        },
        confirm(message) { confirms.push(message); return options.confirmResult !== false; },
        getPortNickname: () => options.portNickname || '라싱반장',
        notifyAdminAutoBlind: (info) => blinds.push(info)
    };
    if (options.moderation) window.inspectCommunityContent = () => options.moderation;

    const context = vm.createContext({
        window,
        document,
        db: store.db,          // 화면 코드는 전역 `db`(app.js)를 그대로 사용합니다
        console: { log() {}, warn() {}, error() {} }
    });
    new vm.Script(script, { filename: 'kkung-relay.js' }).runInContext(context);

    const el = (id) => document.getElementById(id);
    const status = () => el('kkungRelayStatus').textContent;
    const collectText = (node) => [node._text || '', ...(node.children || []).map(collectText)].join(' ');
    const feedText = () => el('kkungFeed').children.map(collectText).join(' / ');

    return {
        window,
        document,
        store,
        storage,
        confirms,
        blinds,
        el,
        status,
        feedText,
        core: window.KkungKkungTtaCore,
        async postWord(word, { nick, memo } = {}) {
            if (nick !== undefined) el('kkungNick').value = nick;
            if (memo !== undefined) el('kkungMemoInput').value = memo;
            el('kkungWordInput').value = word;
            el('kkungRelayForm').dispatchEvent('submit');
            await settle();
        },
        async newRound() {
            await window.startNewKkungRound();
            await settle();
        },
        async hint() {
            el('kkungHintButton').dispatchEvent('click');
            await settle();
        }
    };
}

/** 쓰기 트랜잭션·스냅샷이 모두 반영되도록 이벤트 루프를 몇 바퀴 돌려 줍니다. */
async function settle(rounds = 4) {
    for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * 이어 쓸 수 있는 사전 단어 하나를 골라 줍니다.
 * 바로 막히는 단어(끝 글자로 시작하는 사전 단어가 없는 경우)는 고르지 않습니다 —
 * 그러면 "릴레이가 막혀 새 출발 가능" 상태가 되어 진행형 시나리오가 흔들립니다.
 */
function nextDictionaryWord(harness) {
    const state = harness.store.getState();
    const core = harness.core;
    const candidates = core.getPlayableWords(state.lastWord, state.usedWords)
        .filter(word => core.getPlayableWords(word, [...state.usedWords, word]).length > 0);
    assert.ok(candidates.length, '테스트 전제: 막히지 않게 이어갈 사전 단어가 있어야 합니다');
    return candidates[0];
}

/* ---------------- 흐름 테스트 ---------------- */

test('카드를 열면 릴레이를 구독하고, 아직 릴레이가 없으면 첫 출발을 안내한다', async () => {
    const harness = bootRelay();
    await settle();

    assert.equal(harness.el('kkungLiveBadge').textContent, '🟢 실시간 공유 중');
    assert.equal(harness.el('kkungNewRoundButton').textContent, '🎬 첫 릴레이 시작');
    assert.equal(harness.el('kkungRoundTitle').textContent, '릴레이 준비 중');
    assert.match(harness.status(), /첫 릴레이 시작/);
    assert.match(harness.feedText(), /릴레이가 시작되면/);
    assert.equal(harness.el('kkungNick').value, '라싱반장', '항만용어 닉네임이 자동 기입되어야 합니다');
    assert.match(harness.el('kkungDictionaryCount').textContent, /507/);
});

test('첫 릴레이를 시작하면 출발 단어가 상태 문서와 댓글 피드에 반영된다', async () => {
    const harness = bootRelay();
    await settle();

    await harness.newRound();

    const state = harness.store.getState();
    assert.ok(state, '상태 문서가 만들어져야 합니다');
    assert.equal(state.round, 1);
    assert.equal(state.wordCount, 0);
    assert.equal(state.lastWord, state.starterWord);
    assert.deepEqual([...state.usedWords], [state.starterWord]);
    assert.equal(harness.confirms.length, 1, '새 릴레이는 확인창을 거칩니다');

    assert.equal(harness.el('kkungRoundTitle').textContent, '릴레이 #1');
    assert.equal(harness.el('kkungLastWord').textContent, state.starterWord);
    assert.equal(harness.el('kkungRequiredLetter').textContent, harness.core.lastSyllable(state.starterWord));
    assert.match(harness.status(), /출발/);
    assert.equal(harness.el('kkungNewRoundButton').textContent, '🔁 새 출발');
});

test('댓글로 단어를 이어 쓰면 상태·피드·현황이 함께 갱신된다', async () => {
    const harness = bootRelay();
    await settle();
    await harness.newRound();

    const word = nextDictionaryWord(harness);
    await harness.postWord(word, { nick: '북항 포맨', memo: '다음 분 힘내세요!' });

    const state = harness.store.getState();
    assert.equal(state.lastWord, word);
    assert.equal(state.wordCount, 1);
    assert.deepEqual([...state.usedWords].slice(-1), [word]);
    assert.equal(state.lastNick, '북항 포맨');

    const comments = harness.store.getComments();
    assert.equal(comments.length, 1);
    assert.equal(comments[0].word, word);
    assert.equal(comments[0].name, '북항 포맨');
    assert.equal(comments[0].memo, '다음 분 힘내세요!');
    assert.equal(comments[0].round, 1);
    assert.equal(comments[0].prevWord, state.starterWord);

    assert.equal(harness.el('kkungWordTotal').textContent, '1');
    assert.equal(harness.el('kkungMemberTotal').textContent, '1');
    assert.equal(harness.el('kkungRequiredLetter').textContent, harness.core.lastSyllable(word));
    assert.match(harness.status(), new RegExp(`✅ “${word}” 남겼어요`));
    assert.equal(harness.el('kkungWordInput').value, '', '등록 후 입력창은 비워야 합니다');
    assert.equal(harness.el('kkungMemoInput').value, '');
    assert.equal(harness.storage.get('busanPortKkungRelayNickV1'), '북항 포맨', '닉네임은 브라우저에 저장됩니다');
    assert.match(harness.feedText(), new RegExp(word));
});

test('대전 방식과 달리 사전에 없는 실제 단어도 댓글로 이어 쓸 수 있다', async () => {
    const harness = bootRelay();
    await settle();
    await harness.newRound();
    harness.store.setState({ ...harness.store.getState(), lastWord: '고양이', usedWords: ['고양이'], starterWord: '고양이' });

    assert.ok(!harness.core.words.includes('이어폰'));
    await harness.postWord('이어폰');

    assert.equal(harness.store.getState().lastWord, '이어폰');
    assert.equal(harness.store.getComments().length, 1);
});

test('끝 글자를 잇지 않거나 이미 나온 단어는 댓글로 등록되지 않는다', async () => {
    const harness = bootRelay();
    await settle();
    await harness.newRound();
    harness.store.setState({ ...harness.store.getState(), lastWord: '고양이', starterWord: '고양이', usedWords: ['고양이', '이야기'] });

    await harness.postWord('');
    assert.match(harness.status(), /세 글자 단어를 적어 주세요/);

    await harness.postWord('바나나');
    assert.match(harness.status(), /“이”로 시작하는 단어를 적어 주세요/);

    await harness.postWord('이야기책');
    assert.match(harness.status(), /한글 세 글자 단어만/);

    await harness.postWord('이야기');
    assert.match(harness.status(), /이미 나온 단어/);

    assert.equal(harness.store.getComments().length, 0, '거절된 입력은 저장되면 안 됩니다');
    assert.equal(harness.store.getState().wordCount, 0);
});

test('금칙어·도배가 감지되면 저장하지 않고 관리자 알림만 보낸다', async () => {
    const harness = bootRelay({ moderation: { hidden: true, reason: '금칙어/비방 표현 감지' } });
    await settle();
    await harness.newRound();

    const word = nextDictionaryWord(harness);
    await harness.postWord(word, { memo: '씨발놈아' });

    assert.equal(harness.store.getComments().length, 0);
    assert.equal(harness.store.getState().wordCount, 0);
    assert.match(harness.status(), /금칙어\/비방 표현 감지/);
    assert.equal(harness.blinds.length, 1);
    assert.equal(harness.blinds[0].category, '꿍꿍따 릴레이');
});

test('다른 동료가 남긴 댓글이 실시간으로 화면에 반영된다', async () => {
    const harness = bootRelay();
    await settle();
    await harness.newRound();
    harness.store.setState({ ...harness.store.getState(), lastWord: '고양이', starterWord: '고양이', usedWords: ['고양이'] });

    harness.store.addComment({ round: 1, name: '신항 도선사', word: '이야기', prevWord: '고양이', memo: null, timestamp: { toMillis: () => Date.now() } });
    harness.store.setState({ ...harness.store.getState(), lastWord: '이야기', wordCount: 1, usedWords: ['고양이', '이야기'], lastNick: '신항 도선사' });
    await settle();

    assert.equal(harness.el('kkungLastWord').textContent, '이야기');
    assert.equal(harness.el('kkungRequiredLetter').textContent, '기');
    assert.match(harness.feedText(), /이야기/);
    assert.match(harness.feedText(), /신항 도선사/);
    assert.equal(harness.el('kkungMemberTotal').textContent, '1');
    assert.match(harness.el('kkungFeedMeta').textContent, /최근 신항 도선사/);
});

test('이어지는 중인 릴레이는 새 출발로 덮을 수 없고, 막히면 누구나 열 수 있다', async () => {
    const harness = bootRelay();
    await settle();
    await harness.newRound();

    const word = nextDictionaryWord(harness);
    await harness.postWord(word);
    const runningRound = harness.store.getState().round;

    // 방금 이어진 릴레이 → 화면이 먼저 막아줍니다(서버 60초 제한과 같은 방향)
    await harness.newRound();
    assert.match(harness.status(), /이어지는 중/);
    assert.equal(harness.store.getState().round, runningRound);

    // 이어갈 단어가 없는(막힌) 릴레이 → 새 출발 가능
    harness.store.setState({
        ...harness.store.getState(),
        lastWord: '사과즙',
        usedWords: [...harness.store.getState().usedWords, '사과즙'],
        updatedAt: { toMillis: () => Date.now() - 120000 }
    });
    await settle();
    assert.match(harness.el('kkungNewRoundHint').textContent, /막혔어요/);

    await harness.newRound();
    const next = harness.store.getState();
    assert.equal(next.round, runningRound + 1);
    assert.equal(next.wordCount, 0);
    assert.deepEqual([...next.usedWords], [next.starterWord]);
    assert.match(harness.status(), /릴레이 #2 출발/);
    assert.doesNotMatch(harness.feedText(), new RegExp(word), '지난 릴레이 댓글은 현재 릴레이에서 숨깁니다');
});

test('추천 단어 칩을 누르면 그대로 이어 쓸 수 있다', async () => {
    const harness = bootRelay();
    await settle();
    await harness.newRound();
    harness.store.setState({ ...harness.store.getState(), lastWord: '고양이', starterWord: '고양이', usedWords: ['고양이'] });

    await harness.hint();
    const box = harness.el('kkungSuggestBox');
    assert.equal(box.hidden, false);
    const chips = box.children.filter(node => node.getAttribute('data-kkung-word'));
    assert.equal(chips.length, 6);
    chips.forEach(chip => assert.equal(chip.getAttribute('data-kkung-word')[0], '이'));

    // 추천 칩 클릭은 컨테이너(이벤트 위임)에서 처리합니다.
    box.dispatchEvent('click', { target: chips[0] });
    assert.equal(harness.el('kkungWordInput').value, chips[0].getAttribute('data-kkung-word'));

    await harness.postWord(harness.el('kkungWordInput').value);
    assert.equal(harness.store.getComments().length, 1);
});

test('막힌 릴레이에서는 추천이 없음을 알리고 새 출발을 안내한다', async () => {
    const harness = bootRelay();
    await settle();
    await harness.newRound();
    harness.store.setState({ ...harness.store.getState(), lastWord: '사과즙', starterWord: '사과즙', usedWords: ['사과즙'] });

    await harness.hint();
    assert.equal(harness.el('kkungSuggestBox').hidden, true);
    assert.match(harness.status(), /추천 단어가 없어요/);
});

test('닉네임을 저장해 두면 다음 접속 때 자동으로 채워진다', async () => {
    const storage = new Map();
    const first = bootRelay({ storage });
    await settle();
    await first.newRound();
    await first.postWord(nextDictionaryWord(first), { nick: '북항 포맨' });
    assert.equal(storage.get('busanPortKkungRelayNickV1'), '북항 포맨');

    const second = bootRelay({ storage });
    await settle();
    assert.equal(second.el('kkungNick').value, '북항 포맨');
});

test('확인창에서 취소하면 릴레이가 그대로 유지된다', async () => {
    const harness = bootRelay({ confirmResult: false });
    await settle();
    harness.store.setState({
        round: 1, starterWord: '사과즙', lastWord: '사과즙', wordCount: 0,
        usedWords: ['사과즙'], lastNick: '라싱반장', updatedAt: { toMillis: () => Date.now() - 120000 }
    });
    await settle();

    await harness.newRound();
    assert.equal(harness.confirms.length, 1);
    assert.equal(harness.store.getState().round, 1, '취소하면 라운드가 바뀌면 안 됩니다');
    assert.equal(harness.store.getState().starterWord, '사과즙');
});
