import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// C-4 단기: 근무일지 내보내기/가져오기 검증
// · exportAllWorkLogsJson  : 전체 근무일지를 JSON으로 백업
// · importWorkLogsFromJson : JSON 백업 파일을 Firestore에 복원
const appMainCode = readFileSync(new URL('../public/js/app-main.js', import.meta.url), 'utf8');

test('근무일지 백업(JSON) 버튼과 복원(JSON) 버튼이 달력 아래에 있다', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    assert.match(html, /onclick="exportAllWorkLogsJson\(\)"/);
    assert.match(html, /onchange="importWorkLogsFromJson\(event\)"/);
    assert.match(html, /전체 근무일지 백업 \(JSON\)/);
    assert.match(html, /근무일지 복원 \(JSON\)/);
    assert.match(html, /accept="\.json"/);
});

test('exportAllWorkLogsJson 함수가 app-main.js 에 정의되어 있다', () => {
    assert.match(appMainCode, /async function exportAllWorkLogsJson\(\)/);
    assert.match(appMainCode, /workerId.*==.*currentWorkerId/);
    assert.match(appMainCode, /JSON\.stringify\(backup/);
    assert.match(appMainCode, /_근무일지_백업_/);
});

test('importWorkLogsFromJson 함수가 app-main.js 에 정의되어 있다', () => {
    assert.match(appMainCode, /async function importWorkLogsFromJson\(event\)/);
    assert.match(appMainCode, /JSON\.parse\(text\)/);
    assert.match(appMainCode, /db\.batch\(\)/);
    assert.match(appMainCode, /merge:\s*true/);
});

test('가져오기는 백업 파일의 workerId를 현재 로그인 workerId로 덮어쓴다', () => {
    // importWorkLogsFromJson 에서 workerId 재할당 로직 확인
    assert.match(appMainCode, /data\.workerId\s*=\s*currentWorkerId/);
});

test('내보내기는 삭제된 기록(deletedAt)을 제외한다', () => {
    assert.match(appMainCode, /if\s*\(data\.deletedAt\)\s*return/);
});

test('가져오기는 잘못된 JSON 파일에 대해 오류 안내를 제공한다', () => {
    assert.match(appMainCode, /올바른 근무일지 백업 파일이 아닙니다/);
    assert.match(appMainCode, /근무일지 복원에 실패했습니다/);
});

test('내보내기·가져오기 함수가 문법 오류 없이 동작한다', () => {
    // 필요한 함수를 추출하여 vm에서 실행 가능 여부 확인
    function extractFn(name) {
        const marker = appMainCode.indexOf(`async function ${name}(`);
        if (marker < 0) throw new Error(`function not found: ${name}`);
        const parenStart = appMainCode.indexOf('(', marker);
        let parenDepth = 0, bodyStart = -1;
        for (let i = parenStart; i < appMainCode.length; i++) {
            if (appMainCode[i] === '(') parenDepth++;
            else if (appMainCode[i] === ')') {
                parenDepth--;
                if (parenDepth === 0) { bodyStart = appMainCode.indexOf('{', i); break; }
            }
        }
        let depth = 0;
        for (let i = bodyStart; i < appMainCode.length; i++) {
            if (appMainCode[i] === '{') depth++;
            else if (appMainCode[i] === '}') {
                depth--;
                if (depth === 0) return appMainCode.slice(marker, i + 1);
            }
        }
        throw new Error(`unterminated: ${name}`);
    }

    const exportFn = extractFn('exportAllWorkLogsJson');
    const importFn = extractFn('importWorkLogsFromJson');

    // 문법 검사
    const context = vm.createContext({
        console, Date, JSON, Promise, Array, Object, String, Number, Boolean, RegExp,
        alert: () => {}, confirm: () => true,
        showToast: () => {},
        trackAppEvent: () => {},
        db: {
            collection: () => ({
                where: () => ({
                    where: () => ({ get: async () => ({ forEach: () => {} }) }),
                    get: async () => ({ forEach: () => {} })
                }),
                doc: () => ({})
            }),
            batch: () => ({ set() {}, commit: async () => {} })
        },
        firebase: { firestore: { FieldValue: { serverTimestamp: () => new Date() } } },
        currentWorkerId: 'testWorker',
        currentDate: new Date(),
        renderCalendar: () => {},
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
        document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
        Blob: class { constructor() {} },
        setTimeout, clearTimeout
    });
    vm.createContext(context);
    assert.doesNotThrow(() => vm.runInContext(exportFn, context));
    assert.doesNotThrow(() => vm.runInContext(importFn, context));
});
