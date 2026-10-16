#!/usr/bin/env node
/**
 * 🎨 디자인 토큰 적용 · 검증 · 문서 생성기
 *
 * 사용법
 *   node scripts/apply-design-tokens.mjs             # 토큰 적용 + 미러 동기화 + 리포트
 *   node scripts/apply-design-tokens.mjs --dry-run   # 파일 수정 없이 리포트만
 *   node scripts/apply-design-tokens.mjs --check     # 검증만 (불일치 시 종료코드 1)
 *   node scripts/apply-design-tokens.mjs --docs      # 가이드 문서의 토큰 부록 재생성
 *
 * 동작
 *   1) public/css/app.css 상단 TOKEN_CSS(:root 토큰) 블록을 삽입/갱신
 *      (A-1 · 2026-10-17 이후: 스타일 정본은 app.css, index.html 은 <link> 로만 참조)
 *   2) 하드코딩된 간격·라운드·타이포·색상·그림자·모션·Z축 값을 토큰 참조로 치환
 *      - 레이아웃에 영향을 주는 값(간격)은 "정확히 일치"할 때만 치환 (무회귀)
 *      - 라운드·그림자는 페인트 전용 속성이라 1px 스냅 허용
 *      - 타이포는 0.02rem(≈0.32px) 이내에서 스케일 단계로 정렬
 *   3) index.html 이 app.css 를 <link> 로 참조하고 인라인 <style> 이 없음을 검증
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { APP_JS_FILES, readAppFile } from './app-source.mjs';
import {
    TOKEN_CSS,
    TOKEN_MARKER_START,
    TOKEN_MARKER_END,
    SPACING_TOKENS,
    RADIUS_TOKENS,
    FONT_SIZE_TOKENS,
    FLUID_FONT_TOKENS,
    FONT_WEIGHT_TOKENS,
    LINE_HEIGHT_TOKENS,
    Z_INDEX_TOKENS,
    SHADOW_TOKENS,
    DURATION_TOKENS,
    COLOR_TOKENS,
    LENGTH_PROPS,
    ALL_RADIUS_PROPS,
    MOTION_PROPS,
    SECTION_TITLES
} from './design-tokens.mjs';

const INDEX_PATH = fileURLToPath(new URL('../public/index.html', import.meta.url));
const CSS_PATH = fileURLToPath(new URL('../public/css/app.css', import.meta.url));
const GUIDE_PATH = fileURLToPath(new URL('../docs/디자인_시스템_가이드.md', import.meta.url));

const DECL_RE = /([-a-zA-Z][-a-zA-Z0-9]*)\s*:\s*([^;{}]*?)(\s*!important)?(?=\s*[;}])/g;

/* A-1 (2026-10-17): 스타일 정본은 public/css/app.css.
 * 파일 형식 = 상단 헤더 블록 주석 + 스타일 본문. */
function splitCssFile(raw) {
    if (!raw.startsWith('/*')) return { header: '', body: raw };
    const end = raw.indexOf('*/');
    if (end < 0) return { header: '', body: raw };
    const header = raw.slice(0, end + 2);
    const body = raw.slice(end + 2).replace(/^\r?\n/, '');
    return { header, body };
}

function buildCssFile(header, css) {
    return `${header}\n${css.trim()}\n`;
}

/* ── 1. 안전 마스킹: 문자열·url() 내부는 치환 대상에서 제외 ── */
function mask(text) {
    const store = [];
    const masked = text.replace(/(url\([^)]*\)|"[^"]*"|'[^']*')/g, (match) => {
        store.push(match);
        return `\u0001${store.length - 1}\u0001`;
    });
    return { masked, store };
}

function unmask(text, store) {
    return text.replace(/\u0001(\d+)\u0001/g, (_, index) => store[Number(index)]);
}

function varOf(name) {
    return `var(${name})`;
}

/* ── 2. 값 변환 헬퍼 ── */
function mapSingleValue(value, map) {
    const token = map[value.trim()];
    return token ? varOf(token) : null;
}

function mapMultiValue(value, map) {
    const parts = value.trim().split(/\s+/);
    if (parts.some((part) => part.includes('('))) return null;
    const mapped = parts.map((part) => map[part]);
    if (mapped.some((token) => !token)) return null;
    return mapped.map(varOf).join(' ');
}

function collapseBoxShorthand(value) {
    if (value.includes('(') || value.includes('var(')) return null;
    let parts = value.trim().split(/\s+/);
    if (parts.length < 2 || parts.length > 4) return null;
    const original = parts.join(' ');
    let changed = false;
    // a b a b → a b / a b a → a b / a a → a  (박스 모델상 완전 동치)
    for (;;) {
        if (parts.length === 4 && parts[0] === parts[2] && parts[1] === parts[3]) {
            parts = [parts[0], parts[1]];
        } else if (parts.length === 4 && parts[1] === parts[3]) {
            parts = [parts[0], parts[1], parts[2]];
        } else if (parts.length === 3 && parts[0] === parts[2]) {
            parts = [parts[0], parts[1]];
        } else if (parts.length === 2 && parts[0] === parts[1]) {
            parts = [parts[0]];
        } else {
            break;
        }
        changed = true;
    }
    if (!changed) return null;
    return { value: parts.join(' '), original };
}

function tokenizeDurations(value, stats) {
    return value.replace(/(^|[\s,(])(\d*\.?\d+s)(?=[\s,)]|$)/g, (match, prefix, duration) => {
        const token = DURATION_TOKENS[duration];
        if (!token) return match;
        stats.duration += 1;
        return `${prefix}${varOf(token)}`;
    });
}

function tokenizeColors(value, stats) {
    return value.replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => {
        const token = COLOR_TOKENS[hex.toLowerCase()];
        if (!token) return hex;
        stats.color += 1;
        return varOf(token);
    });
}

/* ── 3. 선언 단위 변환 ── */
function transformDeclaration(property, rawValue, stats) {
    const value = rawValue.trim();
    let out = value;

    if (property.startsWith('--')) {
        // 컴포넌트 로컬 변수(예: --wage-ship-gap)의 정의도 토큰을 참조하도록 정리
        const spacingTarget = /-(gap|padding|margin)$/.test(property);
        const fontTarget = /font/.test(property);
        const single = spacingTarget
            ? mapSingleValue(out, SPACING_TOKENS)
            : fontTarget
              ? mapSingleValue(out, FONT_SIZE_TOKENS) || mapSingleValue(out, FLUID_FONT_TOKENS)
              : null;
        if (single) {
            stats.local += 1;
            out = single;
        }
    } else if (LENGTH_PROPS.includes(property)) {
        const collapsed = collapseBoxShorthand(out);
        if (collapsed) {
            stats.collapse += 1;
            out = collapsed.value;
        }
        // 단일 값 → 토큰, 다중 값(박스 숏핸드) → 구성 요소별 토큰 (0 은 관례상 원시값 유지)
        const single = mapSingleValue(out, SPACING_TOKENS);
        if (single) {
            stats.spacing += 1;
            out = single;
        } else {
            const parts = out.split(/\s+/);
            const mapped = parts.map((part) => (part === '0' ? '0' : SPACING_TOKENS[part] ? varOf(SPACING_TOKENS[part]) : null));
            if (parts.length > 1 && mapped.every(Boolean)) {
                stats.spacing += 1;
                out = mapped.join(' ');
            }
        }
    } else if (ALL_RADIUS_PROPS.includes(property)) {
        const mapped = mapMultiValue(out, RADIUS_TOKENS);
        if (mapped) {
            stats.radius += 1;
            out = mapped;
        }
    } else if (property === 'font-size') {
        if (FLUID_FONT_TOKENS[out]) {
            stats.font += 1;
            out = varOf(FLUID_FONT_TOKENS[out]);
        } else if (FONT_SIZE_TOKENS[out]) {
            stats.font += 1;
            out = varOf(FONT_SIZE_TOKENS[out]);
        }
    } else if (property === 'font-weight') {
        const mapped = mapSingleValue(out, FONT_WEIGHT_TOKENS);
        if (mapped) {
            stats.weight += 1;
            out = mapped;
        }
    } else if (property === 'line-height') {
        const mapped = mapSingleValue(out, LINE_HEIGHT_TOKENS);
        if (mapped) {
            stats.lineHeight += 1;
            out = mapped;
        }
    } else if (property === 'z-index') {
        const mapped = mapSingleValue(out, Z_INDEX_TOKENS);
        if (mapped) {
            stats.zIndex += 1;
            out = mapped;
        }
    } else if (property === 'box-shadow') {
        const mapped = mapSingleValue(out, SHADOW_TOKENS);
        if (mapped) {
            stats.shadow += 1;
            out = mapped;
        }
    } else if (MOTION_PROPS.includes(property)) {
        out = tokenizeDurations(out, stats);
    }

    out = tokenizeColors(out, stats);
    return out === value ? null : out;
}

function tokenizeBody(body) {
    const stats = {
        spacing: 0,
        local: 0,
        collapse: 0,
        radius: 0,
        font: 0,
        weight: 0,
        lineHeight: 0,
        zIndex: 0,
        shadow: 0,
        duration: 0,
        color: 0
    };
    const { masked, store } = mask(body);
    const replaced = masked.replace(DECL_RE, (match, property, rawValue, important) => {
        const next = transformDeclaration(property, rawValue, stats);
        if (next === null) return match;
        return `${property}: ${next}${important || ''}`;
    });
    return { css: unmask(replaced, store), stats };
}

/* ── 4. 토큰 블록 삽입/갱신 ── */
function stripTokenBlock(css) {
    const start = css.indexOf(TOKEN_MARKER_START);
    if (start < 0) return css;
    const end = css.indexOf(TOKEN_MARKER_END, start);
    if (end < 0) return css;
    return css.slice(0, start) + css.slice(end + TOKEN_MARKER_END.length);
}

function stripLegacyVariableRules(css) {
    // 기존 :root 변수 선언과 body.dark-mode 변수 전용 규칙은 토큰 블록으로 이전됩니다.
    let out = css.replace(/(^|\n)[ \t]*:root\s*\{[^}]*\}\s*(?=\n)/, '$1');
    out = out.replace(/(^|\n)[ \t]*body\.dark-mode\s*\{\s*--primary\s*:[^}]*\}\s*(?=\n)/, '$1');
    return out;
}

function buildStyleCss(styleBody) {
    const stripped = stripLegacyVariableRules(stripTokenBlock(styleBody));
    const { css: tokenized, stats } = tokenizeBody(stripped);
    const block = `${TOKEN_MARKER_START}${TOKEN_CSS}${TOKEN_MARKER_END}`;
    const merged = block + tokenized;
    return { css: merged, stats };
}

/* ── 5. 검증 (테스트에서도 재사용) ── */
/** 다크 모드에서 재정의(오버라이드)되는 시맨틱 토큰 — 중복 정의가 정상인 항목 */
function themeOverrideTokens() {
    const names = new Set();
    const darkIndex = TOKEN_CSS.indexOf('body.dark-mode');
    if (darkIndex < 0) return names;
    for (const match of TOKEN_CSS.slice(darkIndex).matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) names.add(match[1]);
    return names;
}

export function analyzeCss(css) {
    const overridable = themeOverrideTokens();
    const defined = new Set();
    const duplicates = [];
    for (const match of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
        if (defined.has(match[1]) && !overridable.has(match[1])) duplicates.push(match[1]);
        defined.add(match[1]);
    }
    const used = new Set();
    for (const match of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) used.add(match[1]);
    const unresolved = [...used].filter((name) => !defined.has(name)).sort();

    let depth = 0;
    let minDepth = 0;
    for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
        if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth < minDepth) minDepth = depth;
        }
    }

    const hexCounts = new Map();
    for (const match of css.matchAll(/#[0-9a-fA-F]{3,6}\b/g)) {
        const key = match[0].toLowerCase();
        hexCounts.set(key, (hexCounts.get(key) || 0) + 1);
    }
    const bodyStart = css.indexOf(TOKEN_MARKER_END);
    const outsideTokens = bodyStart < 0 ? css : css.slice(bodyStart + TOKEN_MARKER_END.length);
    const repeatedHardcodedColors = [...outsideTokens.matchAll(/#[0-9a-fA-F]{3,6}\b/g)]
        .map((match) => match[0].toLowerCase())
        .filter((hex) => (hexCounts.get(hex) || 0) >= 2);

    return {
        definedTokens: [...defined].sort(),
        duplicateDefinitions: duplicates,
        unresolved,
        braceBalance: depth,
        minDepth,
        repeatedHardcodedColors: [...new Set(repeatedHardcodedColors)].sort()
    };
}

export function parseTokenSections() {
    const sections = [];
    let current = null;
    let inRoot = false; // 정본 토큰은 :root 블록에만 정의합니다(다크 모드 블록은 역할 토큰 재정의).
    for (const rawLine of TOKEN_CSS.split('\n')) {
        const line = rawLine.trim();
        if (/^:root\s*\{$/.test(line)) {
            inRoot = true;
            continue;
        }
        if (inRoot && line === '}') {
            inRoot = false;
            current = null;
            continue;
        }
        const header = line.match(/^\/\* ── (\d+)\. (.+?) ── \*\/$/);
        if (header) {
            current = { index: Number(header[1]), title: header[2].replace(/\s*\(.*\)$/, ''), tokens: [] };
            sections.push(current);
            continue;
        }
        if (!inRoot) continue;
        const decl = line.match(/^(--[a-zA-Z0-9-]+):\s*(.+?);$/);
        if (decl && current) {
            current.tokens.push({ name: decl[1], value: decl[2] });
        }
    }
    return sections;
}

function readJsManagedVariables(sources) {
    const names = new Set();
    for (const source of sources) {
        for (const match of source.matchAll(/setProperty\(\s*['"](--[a-zA-Z0-9-]+)['"]/g)) names.add(match[1]);
    }
    return names;
}

export async function checkDesignTokens() {
    const html = await readFile(INDEX_PATH, 'utf8');
    const cssRaw = await readFile(CSS_PATH, 'utf8');
    const { body: styleBody } = splitCssFile(cssRaw);

    const errors = [];
    if (!cssRaw.startsWith('/*')) {
        errors.push('public/css/app.css 상단 헤더 주석이 없습니다. (A-1 이후 정본 파일 형식)');
    }
    if (/<style[\s>]/i.test(html)) {
        errors.push('index.html 에 인라인 <style> 블록이 있습니다 — public/css/app.css 로 이동해야 합니다.');
    }
    if (!/<link\b[^>]*\bhref="\.?\/css\/app\.css(?:\?[^"]*)?"/i.test(html)) {
        errors.push('index.html 이 public/css/app.css 를 <link rel="stylesheet"> 로 참조하지 않습니다.');
    }

    const { css: expected, stats } = buildStyleCss(styleBody);

    if (normalize(expected) !== normalize(styleBody)) {
        errors.push('public/css/app.css 가 토큰 적용 상태와 다릅니다. `npm run tokens:apply` 를 실행하세요.');
    }
    if (!styleBody.includes(TOKEN_MARKER_START)) {
        errors.push('public/css/app.css 에 디자인 토큰 블록이 없습니다.');
    }

    const analysis = analyzeCss(styleBody);
    // JS 가 setProperty 로 관리하는 변수는 CSS 내에 정의되지 않아도 됩니다 (런타임 주입).
    const jsVars = readJsManagedVariables([html, ...APP_JS_FILES.map((file) => readAppFile(file))]);
    const unresolved = analysis.unresolved.filter((name) => !jsVars.has(name));
    if (unresolved.length) {
        errors.push(`정의되지 않은 CSS 변수 참조: ${unresolved.join(', ')}`);
    }
    if (analysis.duplicateDefinitions.length) {
        errors.push(`중복 정의된 토큰: ${[...new Set(analysis.duplicateDefinitions)].join(', ')}`);
    }
    if (analysis.braceBalance !== 0 || analysis.minDepth < 0) {
        errors.push(`중괄호 불균형 (balance=${analysis.braceBalance}, minDepth=${analysis.minDepth})`);
    }
    if (analysis.repeatedHardcodedColors.length) {
        errors.push(
            `2회 이상 반복되는 하드코딩 색상이 남아 있습니다: ${analysis.repeatedHardcodedColors.join(', ')}`
        );
    }

    return {
        errors,
        stats,
        analysis,
        // 정본 토큰 수: 토큰 블록에 정의된 이름 기준
        tokenCount: parseTokenSections().reduce((sum, section) => sum + section.tokens.length, 0),
        localVarCount: analysis.definedTokens.filter((name) => !name.startsWith('--n-')).length,
        cssLength: cssRaw.length
    };
}

function normalize(text) {
    return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/* ── 6. 문서 부록 생성 ── */
async function generateDocs() {
    const guide = await readFile(GUIDE_PATH, 'utf8');
    const start = guide.indexOf('<!-- TOKEN-TABLES:START -->');
    const end = guide.indexOf('<!-- TOKEN-TABLES:END -->');
    if (start < 0 || end < 0) {
        throw new Error('가이드 문서에서 TOKEN-TABLES 마커를 찾을 수 없습니다.');
    }
    const sections = parseTokenSections();
    const parts = [];
    let total = 0;
    for (const section of sections) {
        const title = SECTION_TITLES[section.index] || section.title;
        parts.push(`### ${section.index}. ${title}\n`);
        parts.push('| 토큰 | 값 |');
        parts.push('| --- | --- |');
        for (const token of section.tokens) {
            total += 1;
            // 색상은 로컬 미리보기에서 스와치로, GitHub 등 정적 뷰어에서는 hex 텍스트로 표시됩니다.
            const swatch = /^#[0-9a-fA-F]{6}$/.test(token.value)
                ? `<span style="display:inline-block;width:14px;height:14px;border:1px solid var(--n-250);border-radius:4px;background:${token.value};vertical-align:middle"></span> \`${token.value}\``
                : `\`${token.value}\``;
            parts.push(`| \`${token.name}\` | ${swatch} |`);
        }
        parts.push('');
    }
    const endMarker = '<!-- TOKEN-TABLES:END -->';
    const table = `<!-- 자동 생성 영역 — 재생성: npm run tokens:docs -->\n\n총 **${total}개** 토큰이 정의되어 있습니다.\n\n${parts.join('\n')}`;
    const next = `${guide.slice(0, start)}<!-- TOKEN-TABLES:START -->\n\n${table}${endMarker}${guide.slice(end + endMarker.length)}`;
    await writeFile(GUIDE_PATH, next.replace(/\n{4,}/g, '\n\n\n'), 'utf8');
    return total;
}

/* ── 7. 실행 ── */
async function main() {
    const args = new Set(process.argv.slice(2));

    if (args.has('--docs')) {
        const total = await generateDocs();
        console.log(`📘 디자인 시스템 가이드 토큰 부록을 재생성했습니다. (${total}개 토큰)`);
        return;
    }

    if (args.has('--check')) {
        const result = await checkDesignTokens();
        if (result.errors.length) {
            console.error('❌ 디자인 토큰 검증 실패');
            result.errors.forEach((error) => console.error(`   · ${error}`));
            process.exitCode = 1;
            return;
        }
        console.log(`✅ 디자인 토큰 검증 통과 — 토큰 ${result.tokenCount}개 · 정본 ${result.cssLength} bytes · CSS 무결성 OK`);
        return;
    }

    const cssRaw = await readFile(CSS_PATH, 'utf8');
    if (!cssRaw.startsWith('/*')) {
        throw new Error('css/app.css 상단 헤더 주석이 없습니다. (A-1 이후 정본 파일 형식)');
    }
    const { header, body: styleBody } = splitCssFile(cssRaw);
    const { css: nextCss, stats } = buildStyleCss(styleBody);
    const nextCssFile = buildCssFile(header, nextCss);

    const changed = nextCssFile !== cssRaw;
    const totalTokens = parseTokenSections().reduce((sum, section) => sum + section.tokens.length, 0);

    if (args.has('--dry-run')) {
        console.log('🔍 모의 실행(dry-run) 리포트');
    } else {
        if (changed) await writeFile(CSS_PATH, nextCssFile, 'utf8');
        console.log('🎨 디자인 토큰 적용 완료');
    }

    console.log(`   · 정의된 토큰            : ${totalTokens}개`);
    console.log(`   · CSS 값 → 토큰 치환     : ${Object.values(stats).reduce((a, b) => a + b, 0)}건`);
    console.log(`     - 간격                 : ${stats.spacing}건 (숏핸드 축약 ${stats.collapse}건)`);
    console.log(`     - 색상                 : ${stats.color}건`);
    console.log(`     - 타이포 크기          : ${stats.font}건`);
    console.log(`     - 라운드               : ${stats.radius}건`);
    console.log(`     - 로컬 변수 정의       : ${stats.local}건`);
    console.log(`     - 그림자               : ${stats.shadow}건`);
    console.log(`     - 모션 지속시간        : ${stats.duration}건`);
    console.log(`     - 행간 / 굵기 / Z축    : ${stats.lineHeight} / ${stats.weight} / ${stats.zIndex}건`);
    console.log(`   · css/app.css 정본       : ${changed ? '갱신됨' : '변경 없음(멱등)'}`);

    const result = await checkDesignTokens();
    if (result.errors.length) {
        console.error('❌ 적용 후 검증 실패');
        result.errors.forEach((error) => console.error(`   · ${error}`));
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    });
}
