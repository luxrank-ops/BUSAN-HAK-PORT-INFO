/**
 * 🍱 전체 터미널 식단 업로드 (찾기 → 업로드 2버튼) 회귀 테스트
 *
 * 배경 (2026-11-17 현장 요청)
 *  · "학포트에서 전체 터미널 식단 업로드 비번을 9363 으로 변경해줘"
 *  · "업로드 방식을 찾기 / 업로드 버튼으로 변경하고, 버튼에 맞게 기능도 구현해줘"
 *
 * 고정하는 동작
 *  1) 식단 업로드 비밀번호는 9363 (클라이언트·서버 관리자 해시가 동일)
 *  2) 찾기 = 파일 선택창만 열고, 선택된 파일명·크기를 표시(저장 없음)
 *  3) 업로드 = 비밀번호 확인 → 이미지 검증 → Storage 저장 → settings 문서 갱신
 *  4) 미선택 안내 · 업로드 중 로딩/진행률 · 성공/실패 피드백
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readAppFile, extractFunction } from './app-source.mjs';

const html = readAppFile('public/index.html');
const appJs = readAppFile('public/js/app.js');
const leaderJs = readAppFile('public/js/leader-access.js');
const serverTs = readAppFile('server.ts');

// 평문 비밀번호가 테스트 파일에 남지 않도록 조립합니다.
const MEAL_PIN = ['93', '63'].join('');
const MEAL_PIN_HASH = crypto.createHash('sha256').update(MEAL_PIN, 'utf8').digest('hex');
const OLD_PIN = ['03', '46'].join('');
const OLD_PIN_HASH = crypto.createHash('sha256').update(OLD_PIN, 'utf8').digest('hex');

/** 작업 영역: 테스트마다 새 DOM·스텁으로 함수를 다시 조립합니다. */
function createMealHarness(options = {}) {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) {
            elements.set(id, {
                id,
                innerText: '',
                disabled: false,
                value: '',
                style: {},
                clicked: 0,
                click() { this.clicked += 1; }
            });
        }
        return elements.get(id);
    };
    ['hjncMealStatus', 'hjncMealFileName', 'hjncMealPickBtn', 'hjncMealUploadBtn', 'hjncMealFileInput', 'hjncMealImage']
        .forEach(element);

    const records = { alerts: [], toasts: [], storagePaths: [], settings: [] };
    const context = {
        document: { getElementById: (id) => (id ? element(id) : null) },
        alert: (msg) => records.alerts.push(String(msg)),
        showToast: (msg) => records.toasts.push(String(msg)),
        verifyAdmin: async () => {
            records.verifyAdminCalls = (records.verifyAdminCalls || 0) + 1;
            return options.verifyAdmin === false ? false : true;
        },
        currentMealTerminalId: options.terminalId || 'bnct',
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' } } },
        db: {
            collection: () => ({
                doc: (id) => ({
                    set: async (data) => { records.settings.push({ id, data }); }
                })
            })
        },
        storage: {
            ref: (path) => ({
                put: (file) => {
                    records.storagePaths.push(path);
                    const task = {
                        snapshot: { ref: { getDownloadURL: async () => `https://cdn.test/${encodeURIComponent(path)}` } },
                        on: (event, progress, error, complete) => {
                            progress({ bytesTransferred: 50, totalBytes: 100 });
                            complete();
                        }
                    };
                    return task;
                }
            })
        },
        console,
        Date,
        Math,
        Number,
        String,
        Boolean,
        Promise,
        setTimeout,
        encodeURIComponent,
        mealSelectedFile: null,
        mealUploadBusy: false
    };

    const source = [
        'let mealSelectedFile = null;',
        'let mealUploadBusy = false;',
        extractFunction(appJs, 'getTerminalMealDocumentId'),
        extractFunction(appJs, 'formatMealFileSize'),
        extractFunction(appJs, 'syncHjncMealUploadUI'),
        extractFunction(appJs, 'resetHjncMealUploadSelection'),
        extractFunction(appJs, 'pickHjncMealFile'),
        extractFunction(appJs, 'handleHjncMealFileSelected'),
        extractFunction(appJs, 'submitHjncMealUpload')
    ].join('\n');

    const sandbox = vm.createContext(context);
    vm.runInContext(source, sandbox, { filename: 'meal-upload.harness.js' });
    return { context, element, records };
}

test('식단 업로드 비밀번호: 클라이언트·서버 기본 해시가 9363 이다', () => {
    const clientHash = appJs.match(/const DEFAULT_ADMIN_PW_HASH = "([a-f0-9]{64})"/);
    const serverHash = serverTs.match(/export const DEFAULT_ADMIN_PW_HASH = '([a-f0-9]{64})'/);
    assert.ok(clientHash, 'public/js/app.js 의 DEFAULT_ADMIN_PW_HASH 를 찾을 수 없습니다');
    assert.ok(serverHash, 'server.ts 의 DEFAULT_ADMIN_PW_HASH 를 찾을 수 없습니다');
    assert.equal(clientHash[1], MEAL_PIN_HASH, '클라이언트 해시가 9363 이 아닙니다');
    assert.equal(serverHash[1], MEAL_PIN_HASH, '서버 해시가 9363 이 아닙니다');
    assert.notEqual(clientHash[1], OLD_PIN_HASH, '구 비밀번호 해시가 그대로 남아 있습니다');
    assert.notEqual(serverHash[1], OLD_PIN_HASH, '구 서버 비밀번호 해시가 그대로 남아 있습니다');
});

test('식단 업로드 검증은 관리자 세션(서버 발급) 경로를 그대로 사용한다', () => {
    const submit = extractFunction(appJs, 'submitHjncMealUpload');
    assert.ok(submit, 'submitHjncMealUpload 함수가 없습니다');
    assert.match(submit, /verifyAdmin\(\)/, '업로드 전 비밀번호 검증이 사라졌습니다');
});

test('비밀번호 평문이 배포 자산에 남아 있지 않다 (조장 접근 포함)', () => {
    assert.ok(!leaderJs.includes(MEAL_PIN), 'leader-access.js 에 비밀번호 평문이 남아 있습니다');
    assert.match(leaderJs, /LEADER_ACCESS_PW_HASH/);
    assert.match(leaderJs, /sha256Hex\(/);
    assert.ok(!appJs.includes(`=== "${MEAL_PIN}"`), 'app.js 에 비밀번호 평문 비교가 남아 있습니다');
});

test('모달 UI: 찾기·업로드 버튼과 파일명 표시, 업로드는 초기 비활성', () => {
    const modal = html.match(/<div id="hjncMealModal"[\s\S]*?<div id="privacyModal"/);
    assert.ok(modal, 'hjncMealModal 마크업을 찾을 수 없습니다');
    const markup = modal[0];
    assert.match(markup, /id="hjncMealPickBtn"[\s\S]{0,400}?onclick="pickHjncMealFile\(\)"/);
    assert.match(markup, /id="hjncMealUploadBtn"[\s\S]{0,400}?onclick="submitHjncMealUpload\(\)"/);
    assert.match(markup, /id="hjncMealUploadBtn"[^>]*disabled/, '업로드 버튼은 파일 선택 전 비활성이어야 합니다');
    assert.match(markup, /📂 찾기/);
    assert.match(markup, /⬆️ 업로드/);
    assert.match(markup, /id="hjncMealFileName"/);
    assert.match(markup, /id="hjncMealFileInput"[^>]*onchange="handleHjncMealFileSelected\(this\)"/);
    // 파일을 고르는 즉시 업로드하던 구 방식(파일 선택창 = 업로드)이 남아 있으면 안 됩니다.
    assert.ok(!/onchange="uploadHjncMealImage\(this\)"/.test(markup), '파일 선택 즉시 업로드 방식이 남아 있습니다');
});

test('찾기 버튼은 파일 선택창만 열고 저장하지 않는다', () => {
    const { context, element, records } = createMealHarness();
    context.pickHjncMealFile();
    assert.equal(element('hjncMealFileInput').clicked, 1, '찾기 클릭 시 파일 선택창이 열려야 합니다');
    assert.equal(records.storagePaths.length, 0, '찾기 단계에서 업로드가 일어나면 안 됩니다');
    assert.equal(records.settings.length, 0);
});

test('파일 선택: 파일명·크기 표시 + 업로드 버튼 활성화', () => {
    const { context, element } = createMealHarness();
    context.handleHjncMealFileSelected({ files: [{ name: '식단_11월.png', type: 'image/png', size: 2048 }] });
    assert.match(element('hjncMealFileName').innerText, /식단_11월\.png \(2KB\)/);
    assert.equal(element('hjncMealUploadBtn').disabled, false);
    assert.match(element('hjncMealStatus').innerText, /업로드.*버튼을 누르면/);
});

test('파일 선택: 이미지가 아니면 거부하고 업로드 버튼을 잠근다', () => {
    const { context, element, records } = createMealHarness();
    context.handleHjncMealFileSelected({ files: [{ name: '계약서.pdf', type: 'application/pdf', size: 1024 }] });
    assert.equal(element('hjncMealUploadBtn').disabled, true);
    assert.match(element('hjncMealFileName').innerText, /선택한 파일이 없습니다/);
    assert.equal(records.alerts.length, 1);
});

test('업로드: 파일 미선택이면 안내만 하고 비밀번호를 묻지 않는다', async () => {
    const { context, element, records } = createMealHarness();
    await context.submitHjncMealUpload();
    assert.match(element('hjncMealStatus').innerText, /'찾기'로 업로드할 사진을 먼저 선택/);
    assert.equal(records.verifyAdminCalls || 0, 0);
    assert.equal(records.storagePaths.length, 0);
});

test('업로드: 선택한 파일을 Storage 저장 후 settings 문서를 갱신하고 성공 피드백을 준다', async () => {
    const { context, element, records } = createMealHarness({ terminalId: 'bnct' });
    const file = { name: 'meal.png', type: 'image/png', size: 4096 };
    context.handleHjncMealFileSelected({ files: [file] });
    await context.submitHjncMealUpload();

    assert.equal(records.verifyAdminCalls, 1, '업로드 시 비밀번호 검증이 한 번 실행되어야 합니다');
    assert.equal(records.storagePaths.length, 1);
    assert.match(records.storagePaths[0], /^terminal-meals\/bnct\/\d+_meal\.png$/);
    assert.equal(records.settings.length, 1);
    assert.equal(records.settings[0].id, 'meal_bnct');
    assert.match(records.settings[0].data.imageUrl, /cdn\.test/);
    assert.equal(records.settings[0].data.updatedAt, 'SERVER_TS');
    assert.match(element('hjncMealStatus').innerText, /✅ 식단 이미지가 업데이트되었습니다/);
    assert.equal(element('hjncMealImage').style.display, 'block');
    assert.equal(element('hjncMealUploadBtn').disabled, true, '업로드 후 선택이 초기화되어야 합니다');
    assert.equal(element('hjncMealUploadBtn').innerText, '⬆️ 업로드');
    assert.equal(records.toasts.length, 1);
});

test('업로드: 비밀번호가 틀리면 저장하지 않는다', async () => {
    const { context, records } = createMealHarness({ verifyAdmin: false });
    context.handleHjncMealFileSelected({ files: [{ name: 'meal.png', type: 'image/png', size: 1024 }] });
    await context.submitHjncMealUpload();
    assert.equal(records.storagePaths.length, 0);
    assert.equal(records.settings.length, 0);
});

test('업로드: 실패하면 실패 문구를 남기고 선택 파일은 유지한다', async () => {
    const { context, element, records } = createMealHarness();
    context.storage.ref = () => ({
        put: () => ({
            snapshot: { ref: { getDownloadURL: async () => '' } },
            on: (_event, _progress, error) => { error(new Error('storage/unauthorized')); }
        })
    });
    context.handleHjncMealFileSelected({ files: [{ name: 'meal.jpg', type: 'image/jpeg', size: 1024 }] });
    await context.submitHjncMealUpload();
    assert.match(element('hjncMealStatus').innerText, /❌ 이미지 업로드에 실패/);
    assert.equal(element('hjncMealUploadBtn').disabled, false, '실패 후 재시도를 위해 버튼이 다시 활성이어야 합니다');
    assert.equal(records.settings.length, 0);
});
