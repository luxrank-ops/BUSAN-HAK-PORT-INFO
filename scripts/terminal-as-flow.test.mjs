/**
 * 🛠️ 터미널 시설·정비 수리 / A/S 요청 화면 흐름 테스트 (2026-11-27)
 *
 * scripts/terminal-as.test.mjs 가 순수 로직을 본다면, 이 파일은 DOM·Firestore 스텁으로
 * 실제 화면 흐름(초기화 → 터미널 선택 → 접수 → 터미널 필터 → 오프라인 임시 접수)을 검증합니다.
 * 비밀번호·닉네임 입력 없이, 선택한 터미널 이름 기반 익명 작성자로 접수되는지 확인합니다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppFile } from './app-source.mjs';

const script = readAppFile('public/js/terminal-as.js');

const TAS_IDS = [
    'terminalAsBoard', 'tasTotal', 'tasTerminalTotal', 'tasLiveBadge', 'tasFilter',
    'tasFeedMeta', 'tasFeed', 'tasStatus', 'tasForm', 'tasTerminalSelect', 'tasTypeSelect',
    'tasContent', 'tasAuthorPreview', 'tasAnonCode', 'tasSubmit'
];

function makeClassList() {
    const set = new Set();
    return {
        add: (...names) => names.forEach(name => set.add(name)),
        remove: (...names) => names.forEach(name => set.delete(name)),
        toggle: (name, force) => { if (force === undefined ? !set.has(name) : force) set.add(name); else set.delete(name); },
        contains: name => set.has(name)
    };
}

function makeElement(tag = 'div', id = '') {
    const listeners = new Map();
    const attrs = new Map();
    const node = {
        tagName: String(tag).toUpperCase(),
        id,
        children: [],
        className: '',
        classList: makeClassList(),
        style: {},
        dataset: {},
        value: '',
        disabled: false,
        hidden: false,
        _text: '',
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        dispatchEvent(event) {
            const list = listeners.get(event.type) || [];
            list.forEach(fn => fn(event));
            return true;
        },
        closest(selector) {
            if (selector === '[data-terminal]' && this.getAttribute('data-terminal') !== null) return this;
            return null;
        }
    };
    // 실제 DOM select.options 처럼 optgroup 안의 option 까지 포함합니다.
    Object.defineProperty(node, 'options', {
        get() {
            const out = [];
            const walk = (parent) => (parent.children || []).forEach(child => {
                if (child.tagName === 'OPTION') out.push(child);
                else if (child.tagName === 'OPTGROUP') walk(child);
            });
            walk(node);
            return out;
        }
    });
    Object.defineProperty(node, 'textContent', {
        get() {
            if (node.children.length) return node.children.map(child => child.textContent).join('');
            return node._text;
        },
        set(value) {
            node._text = String(value);
            node.children = [];
        }
    });
    return node;
}

function collectText(node) {
    if (!node) return '';
    const own = node._text || '';
    const kids = (node.children || []).map(collectText).join(' ');
    return `${own} ${kids}`.trim();
}

/** 아주 작은 Firestore 스텁 (terminal_as_requests 전용) */
function makeFirestoreStub({ failWrites = false } = {}) {
    const docs = new Map();
    const listeners = new Set();
    let counter = 0;

    const snapshot = () => ({
        forEach(callback) {
            [...docs.entries()]
                .sort((a, b) => Number(b[1].createdAtMs || 0) - Number(a[1].createdAtMs || 0))
                .forEach(([id, data]) => callback({ id, data: () => data }));
        }
    });
    const notify = () => listeners.forEach(listener => listener(snapshot()));

    const collection = {
        orderBy() { return this; },
        limit() { return this; },
        onSnapshot(onNext, onError) {
            listeners.add(onNext);
            onNext(snapshot());
            return () => listeners.delete(onNext);
        },
        doc(id) {
            const docId = id || `doc-${++counter}`;
            return {
                id: docId,
                async set(data) {
                    if (failWrites) throw new Error('offline');
                    docs.set(docId, data);
                    notify();
                }
            };
        },
        async add(data) {
            if (failWrites) throw new Error('offline');
            const id = `doc-${++counter}`;
            docs.set(id, data);
            notify();
            return { id };
        }
    };

    return {
        docs,
        collection() { return collection; }
    };
}

function makeHarness({ failWrites = false } = {}) {
    const elements = new Map();
    TAS_IDS.forEach(id => elements.set(id, makeElement(id === 'tasFeed' ? 'ul' : 'div', id)));
    elements.get('tasTerminalSelect').tagName = 'SELECT';
    elements.get('tasTypeSelect').tagName = 'SELECT';
    elements.get('tasContent').tagName = 'TEXTAREA';

    const storage = new Map();
    const blinds = [];
    const db = makeFirestoreStub({ failWrites });

    const documentStub = {
        readyState: 'complete',
        hidden: false,
        getElementById(id) { return elements.get(id) || null; },
        createElement(tag) { return makeElement(tag); },
        addEventListener() {}
    };

    class IntersectionObserverStub {
        constructor(callback) { this.callback = callback; }
        observe() { this.callback([{ isIntersecting: true }]); }
        disconnect() {}
    }

    // 모듈은 window 를 전역으로 쓰므로 window 를 sandbox 자체로 둡니다.
    const sandbox = {
        document: documentStub,
        localStorage: {
            getItem: key => (storage.has(key) ? storage.get(key) : null),
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        IntersectionObserver: IntersectionObserverStub,
        db,
        firebase: { firestore: { FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } } },
        ensureAnonymousAuth: async () => ({ uid: 'anon-1' }),
        inspectCommunityContent: ({ text }) => (String(text).includes('금칙어')
            ? { hidden: true, reason: '금칙어 감지' }
            : { hidden: false, reason: null }),
        notifyAdminAutoBlind: info => blinds.push(info),
        console
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);

    new vm.Script(script, { filename: 'terminal-as.js' }).runInContext(context);

    const el = id => elements.get(id);
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const submit = async () => {
        el('tasForm').dispatchEvent({ type: 'submit', preventDefault() {} });
        await tick();
        await tick();
    };
    const feedText = () => el('tasFeed').children.map(collectText).join(' / ');

    return { window: sandbox, el, db, storage, blinds, submit, tick, feedText };
}

test('초기화: 9개 터미널 + 4개 종류가 채워지고 작성자는 한진*** 로 미리보기된다', () => {
    const harness = makeHarness();
    const terminalSelect = harness.el('tasTerminalSelect');
    // placeholder 1 + 터미널 9
    assert.equal(terminalSelect.options.length, 10);
    assert.equal(terminalSelect.value, 'hjnc');
    assert.equal(harness.el('tasTypeSelect').options.length, 4);
    assert.equal(harness.el('tasAuthorPreview').textContent, '한진***');
    assert.match(harness.el('tasAnonCode').textContent, /^#[A-Z2-9]{4}$/);
    assert.equal(harness.el('tasLiveBadge').textContent, '🟢 실시간 공유 중');
    assert.match(harness.feedText(), /아직 접수된 요청이 없어요/);
});

test('터미널을 바꾸면 작성자 미리보기가 동원*** 로 바뀌고, 접수하면 Firestore 에 익명으로 저장된다', async () => {
    const harness = makeHarness();
    const terminalSelect = harness.el('tasTerminalSelect');
    terminalSelect.value = 'dgt';
    terminalSelect.dispatchEvent({ type: 'change' });
    assert.equal(harness.el('tasAuthorPreview').textContent, '동원***');

    harness.el('tasTypeSelect').value = 'as';
    harness.el('tasContent').value = '3번 게이트 조명이 꺼졌어요';
    await harness.submit();

    assert.equal(harness.db.docs.size, 1);
    const saved = [...harness.db.docs.values()][0];
    assert.equal(saved.terminalId, 'dgt');
    assert.equal(saved.terminalLabel, '동원(DGT)');
    assert.equal(saved.type, 'as');
    assert.equal(saved.author, '동원***');
    assert.match(saved.anonCode, /^[A-Z2-9]{4}$/);
    assert.equal(saved.status, 'received');
    assert.equal(saved.content, '3번 게이트 조명이 꺼졌어요');
    assert.match(harness.el('tasStatus').textContent, /접수됐어요/);
    assert.equal(harness.el('tasContent').value, '', '접수 후 입력창은 비워야 합니다');
    assert.match(harness.feedText(), /3번 게이트 조명이 꺼졌어요/);
    assert.match(harness.feedText(), /동원\*\*\*/);
    assert.equal(harness.el('tasTotal').textContent, '1');
});

test('빈 내용·한 글자는 접수되지 않고 안내만 뜬다', async () => {
    const harness = makeHarness();
    harness.el('tasContent').value = '가';
    await harness.submit();
    assert.equal(harness.db.docs.size, 0);
    assert.match(harness.el('tasStatus').textContent, /두 글자 이상/);

    harness.el('tasContent').value = '   ';
    await harness.submit();
    assert.equal(harness.db.docs.size, 0);
    assert.match(harness.el('tasStatus').textContent, /적어 주세요/);
});

test('금칙어 감지 시 접수되지 않고 관리자 블라인드 알림이 남는다', async () => {
    const harness = makeHarness();
    harness.el('tasContent').value = '금칙어 포함 글입니다';
    await harness.submit();
    assert.equal(harness.db.docs.size, 0);
    assert.match(harness.el('tasStatus').textContent, /접수할 수 없어요/);
    assert.equal(harness.blinds.length, 1);
    assert.equal(harness.blinds[0].category, '터미널 시설·정비 A/S 요청');
});

test('터미널 칩으로 해당 터미널 요청만 모아 볼 수 있다', async () => {
    const harness = makeHarness();
    harness.el('tasTerminalSelect').value = 'dgt';
    harness.el('tasContent').value = '동원 크레인 점검 요청';
    await harness.submit();
    assert.match(harness.feedText(), /동원 크레인 점검 요청/);

    const filter = harness.el('tasFilter');
    const hanjinChip = filter.children.find(child => child.getAttribute('data-terminal') === 'hjnc');
    assert.ok(hanjinChip, '한진 칩이 필요합니다');
    filter.dispatchEvent({ type: 'click', target: hanjinChip });
    assert.match(harness.feedText(), /아직 접수된 요청이 없어요/);
    assert.equal(harness.el('tasTerminalSelect').value, 'hjnc', '칩 선택 시 작성 터미널도 함께 바뀝니다');
    assert.equal(harness.el('tasAuthorPreview').textContent, '한진***');

    const allChip = filter.children.find(child => child.getAttribute('data-terminal') === 'all');
    filter.dispatchEvent({ type: 'click', target: allChip });
    assert.match(harness.feedText(), /동원 크레인 점검 요청/);
});

test('오프라인이면 이 기기에 임시 접수하고 오프라인으로 표시한다', async () => {
    const harness = makeHarness({ failWrites: true });
    harness.el('tasTerminalSelect').value = 'hjnc';
    harness.el('tasContent').value = '한진 야드 조명 수리 요청';
    await harness.submit();

    assert.equal(harness.db.docs.size, 0, '쓰기가 실패하면 Firestore 에 없어야 합니다');
    assert.match(harness.el('tasStatus').textContent, /오프라인 접수됐어요/);
    assert.match(harness.feedText(), /한진 야드 조명 수리 요청/);
    assert.match(harness.feedText(), /이 기기에만 저장/);
    const saved = JSON.parse(harness.storage.get('hakportTerminalAsLocalV1') || '[]');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].author, '한진***');
    assert.equal(saved[0].local, true);
});
