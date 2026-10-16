import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkDesignTokens, analyzeCss, parseTokenSections } from './apply-design-tokens.mjs';
import {
    SPACING_TOKENS,
    FONT_SIZE_TOKENS,
    RADIUS_TOKENS,
    COLOR_TOKENS,
    TOKEN_MARKER_START,
    TOKEN_MARKER_END,
    TOKEN_CSS
} from './design-tokens.mjs';

// 🎨 디자인 시스템 회귀 방지 테스트
// - 토큰이 단일 소스(scripts/design-tokens.mjs)에서 생성된 상태인지 검증합니다.
// - 하드코딩 값 재유입, 미정의 변수 참조, 미러(css/app.css) 불일치를 CI에서 차단합니다.

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const styleBody = html.match(/<style>([\s\S]*?)<\/style>/)[1];

test('디자인 토큰 검증(check)이 오류 없이 통과한다', async () => {
    const result = await checkDesignTokens();
    assert.deepEqual(result.errors, []);
    assert.ok(result.tokenCount > 100, `토큰 수가 너무 적습니다: ${result.tokenCount}`);
});

test('토큰 블록이 :root 단일 소스로 최상단에 존재한다', () => {
    assert.ok(styleBody.includes(TOKEN_MARKER_START), '토큰 시작 마커가 없습니다.');
    assert.ok(styleBody.includes(TOKEN_MARKER_END), '토큰 종료 마커가 없습니다.');
    const bodyStart = styleBody.indexOf(TOKEN_MARKER_START);
    const bodyEnd = styleBody.indexOf(TOKEN_MARKER_END);
    assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, '토큰 블록 순서가 올바르지 않습니다.');
    // 토큰 블록이 <style> 최상단(첫 규칙)에 위치해야 함
    const before = styleBody.slice(0, bodyStart).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    assert.equal(before, '', '토큰 블록 앞에 다른 CSS가 있으면 안 됩니다.');
});

test('필수 토큰 패밀리(색상·간격·타이포·라운드·그림자·모션·Z축)가 모두 정의되어 있다', () => {
    const sections = parseTokenSections();
    const indexes = sections.map((section) => section.index);
    for (const required of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
        assert.ok(indexes.includes(required), `토큰 섹션 ${required} 이(가) 없습니다.`);
    }
    const names = new Set(sections.flatMap((section) => section.tokens.map((token) => token.name)));
    for (const required of [
        '--primary',
        '--bg-color',
        '--card-bg',
        '--text-main',
        '--text-sub',
        '--border',
        '--sp-8',
        '--fs-3',
        '--fs-9',
        '--fw-black',
        '--lh-4',
        '--radius-lg',
        '--shadow-elev-1',
        '--dur-fast',
        '--z-modal',
        '--z-toast'
    ]) {
        assert.ok(names.has(required), `필수 토큰 누락: ${required}`);
    }
});

test('다크 모드는 시맨틱 토큰만 재정의한다', () => {
    const dark = TOKEN_CSS.slice(TOKEN_CSS.indexOf('body.dark-mode'));
    assert.match(dark, /--primary:\s*var\(--blue-400\)/);
    assert.match(dark, /--bg-color:\s*var\(--n-900\)/);
    assert.match(dark, /--text-main:\s*var\(--n-075\)/);
    // 팔레트(원시값) 토큰은 다크 모드에서 재정의하지 않는다.
    assert.doesNotMatch(dark, /--navy-900\s*:/);
    assert.doesNotMatch(dark, /--sp-\d+\s*:/);
});

test('CSS 무결성: 중괄호 균형 + 미정의 var() 참조 0건', () => {
    const analysis = analyzeCss(styleBody);
    assert.equal(analysis.braceBalance, 0, '중괄호가 균형을 이루지 않습니다.');
    assert.ok(analysis.minDepth >= 0, '닫는 중괄호가 더 많습니다.');
    assert.deepEqual(analysis.duplicateDefinitions, [], '중복 정의된 토큰이 있습니다.');
    // A-1(인라인 분리): setProperty 호출은 HTML 뿐 아니라 JS 파일에도 있을 수 있습니다.
    const jsDir = new URL('../public/js/', import.meta.url);
    const jsManaged = new Set();
    const allSources = [html];
    for (const entry of readdirSync(jsDir)) {
        if (entry.endsWith('.js')) allSources.push(readFileSync(new URL(entry, jsDir), 'utf8'));
    }
    for (const src of allSources) {
        for (const match of src.matchAll(/setProperty\(\s*['"](--[a-zA-Z0-9-]+)['"]/g)) jsManaged.add(match[1]);
    }
    const unresolved = analysis.unresolved.filter((name) => !jsManaged.has(name));
    assert.deepEqual(unresolved, [], `미정의 CSS 변수 참조: ${unresolved.join(', ')}`);
});

test('간격: 토큰이 존재하는 값이 하드코딩으로 남아 있지 않다', () => {
    const body = styleBody.slice(styleBody.indexOf(TOKEN_MARKER_END));
    const offenders = [];
    for (const match of body.matchAll(/(?<![-\w])(padding|margin|gap|row-gap|column-gap)\s*:\s*([^;{}]+?)(?=\s*[;}])/g)) {
        const value = match[2].trim().replace(/\s*!important$/, '');
        const parts = value.split(/\s+/);
        if (parts.every((part) => SPACING_TOKENS[part])) offenders.push(`${match[1]}: ${value}`);
    }
    assert.deepEqual(offenders, [], `토큰화되지 않은 간격 값: ${offenders.slice(0, 5).join(' / ')}`);
});

// 차기 스케일 정리 대상 — 0.02rem 초과 차이가 나 스냅하지 않고 유지 중인 값 (증가 금지)
const FONT_SIZE_EXCEPTIONS = ['0.65rem', '1.15rem', '1.16rem'];

test('타이포: 크기 값이 스케일 단계로 정렬되어 있다', () => {
    const body = styleBody.slice(styleBody.indexOf(TOKEN_MARKER_END));
    const rawSizes = [...body.matchAll(/font-size\s*:\s*([^;{}]+?)(?=\s*[;}])/g)]
        .map((match) => match[1].trim().replace(/\s*!important$/, ''))
        .filter((value) => /^[\d.]+rem$/.test(value) && !FONT_SIZE_EXCEPTIONS.includes(value));
    assert.deepEqual(rawSizes, [], `스케일로 정렬되지 않은 font-size: ${rawSizes.slice(0, 5).join(' / ')}`);
    assert.ok(FONT_SIZE_EXCEPTIONS.length <= 3, '스케일 예외가 늘어났습니다. 스케일 단계로 정렬하세요.');
    // 스냅 오차는 0.02rem(≈0.32px) 이내여야 한다.
    for (const [raw, token] of Object.entries(FONT_SIZE_TOKENS)) {
        const step = TOKEN_CSS.match(new RegExp(`${token}:\\s*([\\d.]+)rem`));
        assert.ok(step, `토큰 정의를 찾을 수 없습니다: ${token}`);
        assert.ok(
            Math.abs(parseFloat(step[1]) - parseFloat(raw)) <= 0.0201,
            `${raw} → ${token}(${step[1]}rem) 스냅 오차가 허용치를 초과했습니다.`
        );
    }
});

test('라운드·색상: 반복 하드코딩 값이 남아 있지 않다', () => {
    const body = styleBody.slice(styleBody.indexOf(TOKEN_MARKER_END));
    const rawRadii = [...body.matchAll(/border-radius\s*:\s*([^;{}]+?)(?=\s*[;}])/g)]
        .map((match) => match[1].trim().replace(/\s*!important$/, ''))
        .filter((value) => value.split(/\s+/).every((part) => RADIUS_TOKENS[part]));
    assert.deepEqual(rawRadii, [], `토큰화되지 않은 라운드 값: ${rawRadii.slice(0, 5).join(' / ')}`);

    const hexCounts = new Map();
    for (const match of body.matchAll(/#[0-9a-fA-F]{3,6}\b/g)) {
        const key = match[0].toLowerCase();
        hexCounts.set(key, (hexCounts.get(key) || 0) + 1);
    }
    const repeated = [...hexCounts].filter(([, count]) => count >= 2).map(([hex]) => hex);
    assert.deepEqual(repeated, [], `2회 이상 반복되는 하드코딩 색상: ${repeated.join(', ')}`);
    // 팔레트에 등록된 색상은 화면 코드에서 직접 쓰지 않는다.
    const paletteLeaks = [...hexCounts.keys()].filter((hex) => COLOR_TOKENS[hex] && hexCounts.get(hex) >= 1);
    assert.deepEqual(paletteLeaks, [], `팔레트 토큰으로 치환되어야 할 색상: ${paletteLeaks.join(', ')}`);
});

test('public/css/app.css 미러가 index.html 과 완전히 동일하다', async () => {
    const result = await checkDesignTokens();
    assert.ok(
        !result.errors.some((error) => error.includes('app.css')),
        'app.css 미러가 index.html 과 다릅니다. npm run tokens:apply 를 실행하세요.'
    );
});

test('admin.html 은 시스템과 동일한 이름·값의 색상 토큰을 사용한다', () => {
    const adminTokens = new Map();
    for (const match of adminHtml.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+?);/g)) {
        adminTokens.set(match[1], match[2].trim());
    }
    assert.ok(adminTokens.size >= 8, 'admin.html 에 토큰이 충분히 정의되어 있지 않습니다.');
    const systemTokens = new Map();
    for (const match of TOKEN_CSS.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+?);/g)) {
        systemTokens.set(match[1], match[2].trim());
    }
    for (const [name, value] of adminTokens) {
        if (!systemTokens.has(name)) continue;
        const systemValue = systemTokens.get(name);
        // 팔레트 참조(var(...)) 형태는 팔레트 원시값과 비교한다.
        const resolvedSystem = systemValue.replace(/var\((--[a-zA-Z0-9-]+)\)/g, (_, ref) => systemTokens.get(ref) ?? ref);
        assert.equal(
            value.toLowerCase(),
            resolvedSystem.toLowerCase(),
            `admin.html 의 ${name} 값(${value})이 시스템 토큰(${resolvedSystem})과 다릅니다.`
        );
    }
    assert.ok(
        [...adminTokens.keys()].some((name) => name.startsWith('--radius-')),
        'admin.html 에 라운드 토큰이 없습니다.'
    );
});

test('핵심 컴포넌트 스타일이 토큰화 이후에도 유지된다', () => {
    for (const selector of [
        'header {',
        '.today-visitor-badge {',
        '.bottom-nav {',
        '.modal-overlay {',
        '#toast {',
        '.worklog-action-row > .action-btn'
    ]) {
        assert.ok(styleBody.includes(selector), `핵심 셀렉터 누락: ${selector}`);
    }
    // 근무일지 3버튼 동일 크기 보장 규칙(기존 회귀 테스트와 연동)
    assert.match(styleBody, /\.worklog-action-row > \.action-btn \{[^}]*height: 52px/);
    // 반응형 분기 개수 보존
    const mediaCount = (styleBody.match(/@media/g) || []).length;
    assert.ok(mediaCount >= 13, `미디어 쿼리가 줄어들었습니다: ${mediaCount}`);
});

test('인라인 스타일 하드코딩 색상이 baseline 을 넘지 않는다', () => {
    // 부록 B(디자인 시스템 가이드)의 남은 정리 대상 — 증가만 차단하고, 감소는 허용합니다.
    const INLINE_COLOR_BASELINE = 459; // 2026-10-16 측정값
    const body = html.replace(/<style>[\s\S]*?<\/style>/, '');
    let count = 0;
    for (const match of body.matchAll(/style=\\?(["'])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
        const hexes = match[2].match(/#[0-9a-fA-F]{3,8}\b/g);
        if (hexes) count += hexes.length;
    }
    assert.ok(
        count <= INLINE_COLOR_BASELINE,
        `인라인 하드코딩 색상이 ${count}건으로 baseline(${INLINE_COLOR_BASELINE})을 초과했습니다. 토큰(var(--...)) 또는 공용 클래스를 사용하세요.`
    );
});
