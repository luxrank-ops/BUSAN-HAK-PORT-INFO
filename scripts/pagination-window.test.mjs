import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extractDeclaration, extractFunction, readAppJs, readAppCssRaw, readAppHtml } from './app-source.mjs';

/**
 * 🧭 압축 페이지 번호 (2026-11-28)
 *
 * 등록 선박 800척대 → 160여 페이지여도 페이지 버튼이 화면을 덮지 않도록
 * 1페이지·마지막 페이지 + 현재 페이지 앞뒤 PAGE_WINDOW 개만 렌더합니다.
 * (사용자 신고: 선박도감 하단에 1~45… 숫자 버튼이 세로로 계속 쌓임)
 */

function loadBuilder() {
    const js = readAppJs();
    const context = vm.createContext({ console });
    vm.runInContext(extractDeclaration(js, 'PAGE_WINDOW') + ';', context);
    const fn = extractFunction(js, 'buildPaginationButtonsHtml');
    assert.ok(fn, 'buildPaginationButtonsHtml 함수가 있어야 합니다');
    vm.runInContext(fn, context);
    return context.buildPaginationButtonsHtml;
}

/** 마크업에서 "◀ [1] [2] … [9] ▶" 형태의 요약 문자열을 만듭니다 */
function summarize(markup) {
    return String(markup)
        .replace(/<button[^>]*class="page-num[^"]*"[^>]*>(\d+)<\/button>/g, '[$1]')
        .replace(/<button[^>]*class="page-nav[^"]*"[^>]*>([^<]*)<\/button>/g, '$1')
        .replace(/<span class="page-gap"[^>]*>…<\/span>/g, '…')
        .replace(/\s+/g, ' ')
        .replace(/(◀|▶|\])\s*\[/g, '$1 [')
        .replace(/\]\s*(…|▶)/g, '] $1')
        .replace(/…\s*\[/g, '… [')
        .trim();
}

test('페이지 번호는 1·마지막·현재 주변(PAGE_WINDOW)만 렌더하고 나머지는 …로 접는다', () => {
    const build = loadBuilder();
    assert.equal(summarize(build(163, 1, 'renderShipPage')), '◀ [1] [2] [3] … [163] ▶');
    assert.equal(summarize(build(163, 45, 'renderShipPage')), '◀ [1] … [43] [44] [45] [46] [47] … [163] ▶');
    assert.equal(summarize(build(163, 163, 'renderShipPage')), '◀ [1] … [161] [162] [163] ▶');
});

test('전체 페이지가 적으면 생략 없이 모두 보여 준다', () => {
    const build = loadBuilder();
    assert.equal(summarize(build(3, 2, 'renderNoticePage')), '◀ [1] [2] [3] ▶');
    assert.equal(summarize(build(10, 5, 'renderBoardPage')), '◀ [1] … [3] [4] [5] [6] [7] … [10] ▶');
});

test('페이지가 1개 이하면 버튼을 그리지 않고, 첫/마지막 페이지에서는 이동 버튼이 비활성화된다', () => {
    const build = loadBuilder();
    assert.equal(build(1, 1, 'renderShipPage'), '');
    assert.equal(build(0, 0, 'renderShipPage'), '');
    const first = build(20, 1, 'renderShipPage');
    assert.match(first, /class="page-nav is-disabled" disabled/);
    assert.doesNotMatch(first.split('page-gap')[0], /page-nav" onclick="renderShipPage\(0\)"/);
    const last = build(20, 20, 'renderShipPage');
    assert.match(last, /is-disabled/);
});

test('버튼은 화면의 실제 렌더 함수를 onclick 으로 호출하고 현재 페이지만 active 다', () => {
    const build = loadBuilder();
    const markup = build(50, 7, 'renderShipPage');
    assert.match(markup, /onclick="renderShipPage\(8\)"/);
    assert.match(markup, /class="page-num active"[^>]*aria-current="page">7<\/button>/);
    assert.equal((markup.match(/class="page-num active"/g) || []).length, 1);
    assert.doesNotMatch(markup, /onclick="renderShipPage\(undefined\)"/);
});

test('선박도감·공지사항·자유게시판이 모두 공통 압축 페이지 함수를 사용한다', () => {
    const js = readAppJs();
    assert.match(js, /pagination\.innerHTML = buildPaginationButtonsHtml\(totalPages, p, "renderShipPage"\)/);
    assert.match(js, /el\.innerHTML = buildPaginationButtonsHtml\(total, curr, "renderNoticePage"\)/);
    assert.match(js, /el\.innerHTML = buildPaginationButtonsHtml\(total, curr, "renderBoardPage"\)/);
    // 무한 루프로 전 페이지 버튼을 만들던 이전 패턴이 남아 있으면 안 됩니다.
    assert.doesNotMatch(js, /for \(let page = 1; page <= totalPages; page\+\+\) \{\s*pageHtml\.push/);
});

test('CSS 는 ◀ ▶ 이동 버튼과 … 생략 표시 스타일(다크 모드 포함)을 가진다', () => {
    const css = readAppCssRaw();
    assert.match(css, /\.board-pagination \.page-nav\s*\{[^}]*min-height:\s*34px;/);
    assert.match(css, /\.board-pagination \.page-nav\.is-disabled\s*\{[^}]*pointer-events:\s*none;/);
    assert.match(css, /\.board-pagination \.page-gap\s*\{/);
    assert.match(css, /body\.dark-mode \.board-pagination \.page-nav\s*\{/);
});

test('페이지 영역 마크업은 3개 게시판 모두 유지된다', () => {
    const html = readAppHtml();
    assert.match(html, /<div id="shipPagination" class="board-pagination"><\/div>/);
    assert.match(html, /<div id="noticePagination" class="board-pagination"><\/div>/);
    assert.match(html, /<div id="pagination" class="board-pagination"><\/div>/);
});
