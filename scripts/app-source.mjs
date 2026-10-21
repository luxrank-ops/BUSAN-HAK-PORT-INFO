/**
 * 📦 앱 소스 통합 리더 (A-1 · 2026-10-17)
 *
 * 인라인 스크립트·스타일을 외부 파일로 분리한 이후, 테스트가 앱 코드를
 * 읽는 방식을 하나로 통일합니다.
 *
 * - HTML 마크업   : public/index.html
 * - 전역 스크립트 : public/js/* (아래 APP_JS_FILES 순서 = index.html 로드 순서)
 * - 전역 스타일   : public/css/app.css (디자인 토큰 정본 스타일)
 *
 * 주의: APP_JS_FILES 순서는 index.html 의 <script src> 태그 순서와 반드시
 * 일치해야 합니다 (상위 선언 가시성·TDZ 때문). app-split.test.mjs 가 고정합니다.
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);

/** index.html 의 전역 스크립트 로드 순서 (notifications → app → 조장 → 선박 → 탭뷰 → 꿍꿍따) */
export const APP_JS_FILES = [
    'public/js/notifications.js',
    'public/js/app.js',
    'public/js/leader-access.js',
    'public/js/ships-board.js',
    'public/js/tab-views.js',
    'public/js/kkung-game.js'
];

/** A-1 분리 버전 — index.html 의 ?v= 파라미터 · service-worker 캐시 버전을 함께 올려야 합니다. */
export const APP_ASSET_VERSION = '2027.11';

export function readAppFile(relativePath) {
    return readFileSync(new URL(`./${relativePath}`, ROOT), 'utf8');
}

/** HTML 마크업(스크립트·스타일 블록이 제거된 인라인 코드 없음) */
export function readAppHtml() {
    return readAppFile('public/index.html');
}

/** 전역 스타일 정본 (상단 헤더 주석 포함) */
export function readAppCssRaw() {
    return readAppFile('public/css/app.css');
}

/**
 * 전역 스타일 본문 — 상단 헤더 주석(파일 첫 블록 주석)을 제외한 CSS.
 * apply-design-tokens.mjs 와 동일 규칙으로 분리합니다.
 */
export function readAppCssBody() {
    const raw = readAppCssRaw();
    const end = raw.indexOf('*/');
    if (end < 0) return raw;
    return raw.slice(end + 2).replace(/^\r?\n/, '');
}

/** 로드 순서로 이어붙인 전역 스크립트 전체 (함수·변수 추출·정적 검사용) */
export function readAppJs() {
    return APP_JS_FILES.map(readAppFile).join('\n');
}

/**
 * 소스에서 top-level 함수 선언을 잘라냅니다 (중괄호 균형 기준).
 * `async function name(` / `function name(` 둘 다 지원합니다.
 * 파라미터 기본값에 `{}` 가 있어도 (예: `function f(x = {})`) 본문 중괄호를
 * 찾도록, 먼저 파라미터 괄호(`(...)` ) 균형까지 건너뜁니다.
 */
export function extractFunction(source, name) {
    let marker = source.indexOf(`async function ${name}(`);
    if (marker < 0) marker = source.indexOf(`function ${name}(`);
    if (marker < 0) return null;
    const parenOpen = source.indexOf('(', marker);
    if (parenOpen < 0) return null;
    // 파라미터 괄호 균형 (문자열 인식)
    let parenDepth = 0;
    let inStr = null;
    let i = parenOpen;
    for (; i < source.length; i++) {
        const c = source[i];
        if (inStr) {
            if (c === '\\') i += 1;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if (c === '(') parenDepth += 1;
        else if (c === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) break;
        }
    }
    const open = source.indexOf('{', i + 1);
    if (open < 0) return null;
    let depth = 0;
    for (i = open; i < source.length; i++) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(marker, i + 1);
        }
    }
    return null;
}

/**
 * top-level `const|let|var name = ...;` 문장을 잘라냅니다 (괄호 균형 기준).
 * 여러 줄 배열·오브젝트 리터럴도 통째로 가져옵니다.
 */
export function extractDeclaration(source, name) {
    const re = new RegExp(`(?:^|[;\\n])\\s*(?:const|let|var)\\s+${name}\\s*=`);
    const match = re.exec(source);
    if (!match) return null;
    const start = match.index + match[0].search(/(?:const|let|var)\s+/);
    let depth = 0;
    let inStr = null;
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (inStr) {
            if (c === '\\') i += 1;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if (c === '{' || c === '[' || c === '(') depth += 1;
        else if (c === '}' || c === ']' || c === ')') depth -= 1;
        else if (c === ';' && depth === 0) return source.slice(start, i + 1);
    }
    return null;
}
