import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { APP_JS_FILES, readAppJs, readAppFile, readAppCssRaw, extractFunction as extractFunctionShared } from './app-source.mjs';

// 근무일지 입력 폼 '초기화' 버튼(resetWorkLogForm) 검증.
// 임금계산기의 초기화(resetWageForm)와 같이, 저장된 기록은 건드리지 않고 입력란만 비우는지 확인한다.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
// A-1 (2026-10-17): 앱 로직은 인라인 스크립트에서 public/js/* 로 이동 — 함수 추출은 통합 JS 에서.
const appJs = readAppJs();
const css = readAppCssRaw();

function extractFunction(name) {
    const body = extractFunctionShared(appJs, name);
    if (body === null) throw new Error(`function not found: ${name}`);
    return body;
}

const FIELD_IDS = ['logShipName', 'logWage1', 'logWage2', 'logCoworkers', 'logMemo'];

function setup({ hidden = false, filled = false, confirmYes = true, withImagePreview = false } = {}) {
    const elements = {};
    const make = (id, value = '') => (elements[id] = {
        id, value, innerText: '', innerHTML: '', textContent: '', src: '',
        classList: {
            values: new Set(hidden ? ['hidden'] : []),
            add(n) { this.values.add(n); },
            remove(n) { this.values.delete(n); },
            contains(n) { return this.values.has(n); }
        },
        style: { display: withImagePreview && id === 'logImagePreview' ? 'block' : 'none', setProperty() {} }
    });
    [...FIELD_IDS, 'dailyLogForm', 'logImagePreview', 'logImageInput', 'quickCoworkerChipRow', 'worklogDoubleOrderStatus'].forEach(id => make(id));
    if (filled) {
        elements.logShipName.value = 'SHIP ALPHA / SHIP BETA';
        elements.logWage1.value = '120000';
        elements.logWage2.value = '90000';
        elements.logCoworkers.value = '재경, 성철';
        elements.logMemo.value = '🚢 더블오더 작업 (선박 2척 · 합계 5H)\n\n오늘 메모';
        elements.logImageInput.value = 'C:\\fakepath\\site.jpg';
    }

    const confirmCalls = [];
    const toasts = [];
    const synced = [];
    const context = vm.createContext({
        document: { getElementById: id => elements[id] ?? null },
        String, Array, Object,
        confirm: msg => { confirmCalls.push(msg); return confirmYes; },
        showToast: m => toasts.push(m),
        autoGrowWorkLogMemo(el) { if (el) el.grown = true; },
        syncCoworkerSelectionUI() { synced.push(true); },
        updateWorklogDoubleOrderStatus() { elements.worklogDoubleOrderStatus.updated = true; }
    });
    vm.runInContext(extractFunction('resetWorkLogForm'), context);
    return { context, elements, confirmCalls, toasts, synced };
}

test('the work-log form has an 초기화 button next to 저장하기 and 삭제', () => {
    assert.match(html, /onclick="resetWorkLogForm\(\)"[^>]*>초기화</);
    const row = html.match(/<div class="worklog-action-row">[\s\S]*?<\/div>/);
    assert.ok(row, 'save/reset/delete button row not found');
    const order = ['trySaveWorkLog()', 'resetWorkLogForm()', 'deleteWorkLog()'];
    const at = order.map(fn => row[0].indexOf(fn));
    assert.ok(at.every(i => i >= 0), 'all three actions must be in the same row');
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'order must be 저장하기 → 초기화 → 삭제');
});

test('the three action buttons are the same size (one shared rule, no per-button inline size)', () => {
    const row = html.match(/<div class="worklog-action-row">[\s\S]*?<\/div>/);
    assert.ok(row, 'save/reset/delete button row not found');
    const buttons = [...row[0].matchAll(/<button[^>]*>/g)].map(match => match[0]);
    assert.equal(buttons.length, 3, 'the row holds 저장하기 · 초기화 · 삭제');
    for (const markup of buttons) {
        assert.match(markup, /class="action-btn/, 'every button keeps the shared action-btn style');
        assert.doesNotMatch(markup, /style="[^"]*(flex|padding|margin|height|width)/, 'a button must not override its size inline');
    }
    // A-1 (2026-10-17): 스타일 룰은 index.html 에서 css/app.css 로 이동
    assert.match(
        css,
        /\.worklog-action-row > \.action-btn \{[^}]*flex: 1 1 0;[^}]*height: 52px;/,
        'one rule must give all three buttons the same width and height'
    );
});

test('reset clears every work-log input, the photo picker and shows a toast', () => {
    const { context, elements, confirmCalls, toasts, synced } = setup({ filled: true, withImagePreview: true });
    context.resetWorkLogForm();
    for (const id of FIELD_IDS) assert.equal(elements[id].value, '', `${id} must be emptied`);
    assert.equal(elements.logImageInput.value, '', 'the photo picker must be emptied');
    assert.equal(elements.logImagePreview.src, '', 'the photo preview must be released');
    assert.equal(elements.logImagePreview.style.display, 'none', 'the photo preview must be hidden');
    assert.equal(elements.logMemo.grown, true, 'the memo box must shrink back');
    assert.equal(synced.length, 1, 'coworker chips must re-sync');
    assert.equal(elements.worklogDoubleOrderStatus.updated, true, 'double-order status line must refresh');
    assert.equal(confirmCalls.length, 1, 'a confirm is required when the form has content');
    assert.match(confirmCalls[0], /초기화|지우고/);
    assert.match(toasts.at(-1), /초기화되었습니다/);
});

test('declining the confirm keeps the entered content untouched', () => {
    const { context, elements, toasts } = setup({ filled: true, confirmYes: false });
    context.resetWorkLogForm();
    assert.equal(elements.logShipName.value, 'SHIP ALPHA / SHIP BETA');
    assert.equal(elements.logMemo.value, '🚢 더블오더 작업 (선박 2척 · 합계 5H)\n\n오늘 메모');
    assert.equal(elements.logCoworkers.value, '재경, 성철');
    assert.equal(elements.logImageInput.value, 'C:\\fakepath\\site.jpg');
    assert.equal(toasts.length, 0, 'no toast when the user cancels');
});

test('an empty form resets without any confirm dialog', () => {
    const { context, elements, confirmCalls, toasts } = setup({ filled: false });
    context.resetWorkLogForm();
    assert.equal(confirmCalls.length, 0, 'no confirm for an already-empty form');
    assert.match(toasts.at(-1), /초기화되었습니다/);
});

test('a hidden (closed) form is ignored entirely', () => {
    const { context, elements, confirmCalls, toasts } = setup({ hidden: true, filled: true });
    context.resetWorkLogForm();
    assert.equal(confirmCalls.length, 0);
    assert.equal(toasts.length, 0);
    assert.equal(elements.logShipName.value, 'SHIP ALPHA / SHIP BETA', 'content must survive when the form is closed');
});

test('A-1: reset 로직은 전역 스크립트(app.js)에 단일 사본으로 유지된다', () => {
    assert.match(appJs, /function resetWorkLogForm\(\)/);
    assert.match(appJs, /logShipName', 'logWage1', 'logWage2', 'logCoworkers', 'logMemo/);
    assert.match(appJs, /근무일지 입력 내용이 초기화되었습니다/);
    // 분리 이전에는 인라인+모듈 2벌이 갈라져 있었지만, 이제 app.js 가 정본입니다.
    // 다른 전역 스크립트에 사본이 생기면 동기화 회귀가 되므로 차단합니다.
    const copies = APP_JS_FILES
        .filter((file) => file.endsWith('app.js') === false)
        .filter((file) => readAppFile(file).includes('function resetWorkLogForm()'));
    assert.deepEqual(copies, [], `resetWorkLogForm 사본이 다른 전역 스크립트에 있습니다: ${copies.join(', ')}`);
});
