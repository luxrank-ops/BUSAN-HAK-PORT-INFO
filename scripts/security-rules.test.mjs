/**
 * 🔐 보안 규칙 정적 검증 (E-4 보조)
 *
 * 에뮬레이터 없이도 CI에서 항상 도는 안전망입니다.
 * 규칙 파일에서 "반드시 있어야 하는 보호 장치"가 사라지면 실패합니다.
 * (실제 동작 검증은 `npm run test:rules` 가 에뮬레이터로 수행합니다.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAppJs } from './app-source.mjs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
// A-1 (2026-10-17): 화면 코드 검사 대상 = index.html 인라인 스크립트 → public/js/* 통합 소스
const appJs = readAppJs();

/** 컬렉션 블록 본문만 잘라낸다 (중첩 블록은 중괄호 균형으로 처리) */
function blockBody(source, header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, `규칙 블록을 찾지 못했습니다: ${header}`);
    // match 줄의 마지막 '{' 가 블록 시작점입니다 (경로 패턴의 {logId} 등은 제외).
    const lineEnd = source.indexOf('\n', start);
    const open = source.lastIndexOf('{', lineEnd);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error(`블록이 닫히지 않았습니다: ${header}`);
}

test('근무일지(work_logs)는 물리 삭제가 관리자 전용이고 소유자·날짜 변경이 막혀 있다', () => {
    const body = blockBody(rules, 'match /work_logs/{logId}');
    assert.match(body, /allow delete: if isAdmin\(\);/, '물리 삭제는 관리자만 가능해야 합니다');
    assert.match(body, /incoming\(\)\.workerId == existing\(\)\.workerId/, '소유자 바꿔치기를 막아야 합니다');
    assert.match(body, /incoming\(\)\.date == existing\(\)\.date/, '날짜 바꿔치기를 막아야 합니다');
    assert.doesNotMatch(body, /allow delete: if isSignedIn\(\)/, '인증만 되면 삭제되던 예전 규칙이 남아 있으면 안 됩니다');
});

test('게시판·댓글은 물리 삭제가 관리자 전용으로 바뀌었다', () => {
    const posts = blockBody(rules, 'match /posts/{postId}');
    assert.match(posts, /allow delete: if isAdmin\(\);/, '게시글 물리 삭제는 관리자 전용이어야 합니다');
    assert.doesNotMatch(posts, /allow delete: if isSignedIn\(\)/);

    const comments = blockBody(rules, 'match /comments/{commentId}');
    assert.match(comments, /allow delete: if isAdmin\(\);/);

    const ships = blockBody(rules, 'match /ships/{shipId}');
    assert.match(ships, /allow delete: if isAdmin\(\);/);
});

test('수정 시 비밀번호를 바꿀 수 없다 (글 잠금 공격 차단)', () => {
    assert.match(rules, /incoming\(\)\.password == existing\(\)\.password/, '비밀번호 고정 조건이 필요합니다');
    const posts = blockBody(rules, 'match /posts/{postId}');
    assert.match(posts, /isValidBoardPost\(incoming\(\)\) && incoming\(\)\.password == existing\(\)\.password/);
});

test('소프트 삭제는 삭제 표시 필드만 바꿀 수 있다', () => {
    assert.match(rules, /function isValidSoftDelete\(\)/);
    assert.match(
        rules,
        /hasOnly\(\['deletedAt', 'deletedBy'\]\)/,
        '소프트 삭제는 deletedAt·deletedBy 외 필드를 함께 바꾸면 거부되어야 합니다'
    );
});

test('관리자 문서는 스스로 만들 수 없다 (권한 상승 차단)', () => {
    const admins = blockBody(rules, 'match /admins/{adminUid}');
    assert.match(admins, /allow write: if isAdmin\(\);/);
    assert.doesNotMatch(admins, /allow create: if isSignedIn\(\)/);
    const settingsAdmin = blockBody(rules, 'match /settings/admin');
    assert.match(settingsAdmin, /allow read, write: if false;/);
});

test('자동 업데이트 공지 문서 ID가 화면 코드와 규칙에서 일치한다', () => {
    const ruleIds = [...rules.matchAll(/'(update_\d{4}_\d{2}_\d{2}_[a-z0-9_]+)'/g)].map(m => m[1]);
    const codeIds = [...appJs.matchAll(/"(update_\d{4}_\d{2}_\d{2}_[a-z0-9_]+)"/g)].map(m => m[1]);
    assert.ok(codeIds.length > 0, '화면 코드에서 자동 공지 문서 ID를 찾지 못했습니다');
    codeIds.forEach(id => {
        assert.ok(ruleIds.includes(id), `규칙에 없는 자동 공지 ID 입니다(저장 거부됨): ${id}`);
    });
});

test('화면 코드는 게시판·근무일지에서 물리 삭제를 쓰지 않고 소프트 삭제를 쓴다', () => {
    assert.match(appJs, /function softDeletePayload\(\)/);
    assert.match(appJs, /deletedAt: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);

    const forbidden = [
        /collection\(["']work_logs["']\)\.doc\([^)]*\)\.delete\(\)/,
        /collection\(["']posts["']\)\.doc\([^)]*\)\.delete\(\)/,
        /collection\(["']ships["']\)\.doc\([^)]*\)\.delete\(\)/
    ];
    forbidden.forEach(pattern => {
        assert.doesNotMatch(appJs, pattern, `물리 삭제 호출이 남아 있습니다: ${pattern}`);
    });

    const softDeleteCalls = appJs.match(/\.update\(softDeletePayload\(\)\)/g) || [];
    assert.ok(softDeleteCalls.length >= 5, `소프트 삭제 호출이 부족합니다(현재 ${softDeleteCalls.length}건)`);
});

test('근무일지 조회는 본인 범위로 좁히고, 삭제된 기록은 목록에서 제외한다', () => {
    assert.match(appJs, /async function queryWorkLogsByDateRange\(/);
    // 규칙이 workerId 조건을 요구하므로, 목록 조회에는 항상 workerId 조건이 붙어야 합니다.
    assert.match(appJs, /collection\("work_logs"\)\.where\("workerId", "==", currentWorkerId\)/);
    assert.doesNotMatch(appJs, /let q = db\.collection\("work_logs"\);/);
    // 인덱스가 없을 때의 대체 조회도 workerId 조건을 유지하고 날짜는 화면에서 거릅니다.
    assert.match(appJs, /buildQuery\(false\)/);
    assert.match(appJs, /function isDeletedRecord\(/);

    const scopedCalls = appJs.match(/queryWorkLogsByDateRange\(/g) || [];
    assert.ok(scopedCalls.length >= 4, `본인 범위 조회 적용 지점이 부족합니다(정의 1 + 호출 3 이상 필요, 현재 ${scopedCalls.length}건)`);

    const deletedGuards = appJs.match(/isDeletedRecord\(/g) || [];
    assert.ok(deletedGuards.length >= 8, `삭제 표시 필터가 부족합니다(현재 ${deletedGuards.length}건)`);
});

test('규칙 파일은 기본 차단(Default Deny) 구조를 유지한다', () => {
    assert.match(rules, /match \/\{document=\*\*\}/);
    assert.match(rules, /allow read, write: if false;/);
    assert.match(rules, /rules_version = '2';/);
});

test('꿍꿍따 댓글 릴레이(kkung_chain)는 "이어쓰기·새 출발" 형태만 허용하고 댓글 정리는 관리자 전용이다', () => {
    const relay = blockBody(rules, 'match /kkung_chain/active');
    // 대전(승부)이 아니라 릴레이이므로, 상태 문서 갱신은 "단어 1개 이어쓰기(+1)"와
    // "새 출발(라운드 +1 · 0개 초기화 · 60초 간격)" 두 형태로 제한해 점수·라운드 조작을 막습니다.
    assert.match(relay, /isKkungWordAppend\(incoming\(\), existing\(\)\)/);
    assert.match(relay, /isKkungNewRound\(incoming\(\), existing\(\)\)/);
    assert.match(relay, /allow delete: if isAdmin\(\);/);
    assert.doesNotMatch(relay, /allow create, update, delete: if isSignedIn\(\)/);
    assert.match(relay, /allow update, delete: if isAdmin\(\);/, '이어 쓴 단어 댓글은 작성자도 수정·삭제할 수 없어야 합니다');
    assert.match(rules, /function isValidKkungWord\(val\) \{\s*return val is string && val\.matches\('\^\[가-힣\]\{3\}\$'\);/);
    assert.match(rules, /request\.time\.toMillis\(\) > before\.updatedAt\.toMillis\(\) \+ 60000/);

    // 화면 코드도 같은 컬렉션·문서를 보고, 쓰기 전에 익명 인증(isSignedIn 규칙)을 확인합니다.
    assert.match(appJs, /RELAY_COLLECTION = 'kkung_chain'/);
    assert.match(appJs, /RELAY_DOC_ID = 'active'/);
    assert.match(appJs, /ensureRelayAuth/);
    assert.doesNotMatch(appJs, /chooseAiWord|TURN_SECONDS|isAiThinking/, '대전(AI 승부) 코드가 남아 있으면 안 됩니다');
});

test('규칙 파일에 보안 규칙 언어가 지원하지 않는 람다(=>)가 없어야 한다 (배포 거부 방지)', () => {
    // 2026-10-28 사고: want_board 인덱스 검사에 `data.items.all(item => ...)` 를 썼는데,
    // 보안 규칙 언어에는 리스트 반복(람다) 문법이 없어 규칙 전체가 컴파일 실패했습니다.
    // 그 결과 2026-10-26 배포가 실패하고 운영에는 옛 규칙(기본 거부)이 남아
    // "제출 실패: Missing or insufficient permissions" 가 발생했습니다.
    const codeOnly = rules
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(codeOnly, /=>/, '보안 규칙 언어에는 람다(=>) 문법이 없습니다. 반복 검사는 지원되는 연산(hasAll·size·diff 등)으로 바꾸세요.');
    // 반복을 흉내 낸 이름들도 함께 막습니다(같은 컴파일 오류를 냅니다).
    assert.doesNotMatch(codeOnly, /\.(all|exists|filter|map)\(\s*[A-Za-z_]\w*\s*(,|\))/, '리스트 반복 메서드(all/exists/filter/map)는 규칙 언어에 없습니다.');
});

test('규칙 파일의 중괄호·괄호 짝이 맞는다 (문법 오류 조기 발견)', () => {
    // 주석과 문자열 리터럴(정규식 패턴 등)은 제외하고 구조만 셉니다.
    const codeOnly = rules
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']]) {
        let depth = 0;
        for (const ch of codeOnly) {
            if (ch === open) depth++;
            else if (ch === close) depth--;
            assert.ok(depth >= 0, `${close} 가 먼저 닫혔습니다`);
        }
        assert.equal(depth, 0, `${open}${close} 짝이 맞지 않습니다`);
    }
});
