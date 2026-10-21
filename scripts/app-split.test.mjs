import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { readAppHtml, readAppCssRaw, readAppJs } from './app-source.mjs';

// A-1 (2026-10-17): index.html 의 인라인 스타일·스크립트를 외부 파일로 분리한 것의 회귀 방지.
// - HTML 은 마크업만 남기고, 모든 로직·스타일은 public/js/* 와 public/css/app.css
// - ?v= 버전 쿼리 + service-worker.js 프리캐시가 1:1 로 일치해야 함
// - 전역 스크립트 나열 순서가 유지되어야 함(notifications → app → 나머지)

const html = readAppHtml();
const css = readAppCssRaw();
const appAll = readAppJs();

test('index.html 에 인라인 스크립트가 없다(2KB 이하만 허용)', () => {
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        .map((m) => m[1].trim())
        .filter((body) => body.length > 0);
    const oversized = inlineScripts.filter((body) => body.length > 2000);
    assert.equal(oversized.length, 0, `인라인 스크립트가 ${oversized.length}개 남았습니다(2KB 초과)`);
});

test('index.html 에 인라인 <style> 블록이 없다', () => {
    const inlineStyles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
    assert.equal(inlineStyles.length, 0, '모든 스타일은 public/css/app.css 로 옮겨야 합니다');
    const cssRef = html.match(/<link[^>]*href="([^"]*app\.css[^"]*)"/);
    assert.ok(cssRef, 'css/app.css 링크가 HTML 에 없습니다');
    assert.match(cssRef[1], /\?v=\d+\.\d+$/, `app.css 에 ?v= 버전 쿼리가 필요합니다: ${cssRef[1]}`);
});

test('전역 스크립트 파일이 모두 존재하고 HTML 에 load 순서대로 참조된다', () => {
    const expectedOrder = [
        'public/js/notifications.js',
        'public/js/app.js',
        'public/js/leader-access.js',
        'public/js/ships-board.js',
        'public/js/tab-views.js',
        'public/js/kkung-game.js'
    ];
    const positions = expectedOrder.map((file) => {
        const content = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.ok(content.trim().length > 0, `${file} 가 비어 있습니다`);
        const rel = file.replace('public/', ''); // js/xxx.js
        const tag = html.indexOf(`src="./${rel}`);
        assert.ok(tag >= 0, `${file} 이 HTML 에 참조되지 않습니다`);
        return tag;
    });
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, '로드 순서가 유지되어야 합니다');
});

test('public/js 에 죽은 모듈이 없다 — HTML 이 참조하는 파일만 존재해야 한다', () => {
    const onDisk = readdirSync(new URL('../public/js/', import.meta.url)).filter((f) => f.endsWith('.js'));
    const referenced = onDisk.filter((f) => html.includes(`src="./js/${f}`));
    assert.deepEqual(referenced, onDisk, 'HTML 이 참조하지 않는 js 파일이 있습니다(사본/폐기물)');
});

test('전역 스크립트 전체가 합쳐져도 문법 오류가 없다(브라우저에서 같이 실행되기 때문)', () => {
    assert.ok(appAll.length > 100_000, '통합 전역 스크립트가 너무 짧습니다 — 추출이 깨졌을 수 있음');
    // eslint-disable-next-line no-new
    new vm.Script(appAll, { filename: 'combined-global.js' });
    // css 도 토큰 블록과 함께 합쳐져야 합니다(app.css = 토큰 정본 + 인라인 분체)
    assert.match(css, /--navy-900/);
});

test('service-worker.js 프리캐시와 HTML 의 css/js 참조가 1:1 로 일치한다', () => {
    const sw = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');
    const swListBlock = sw.match(/const STATIC_PRECACHE_ASSETS = \[([\s\S]*?)\];/);
    assert.ok(swListBlock, 'STATIC_PRECACHE_ASSETS 를 찾지 못했습니다');
    const swCssJs = [...swListBlock[1].matchAll(/"(\/(?:css|js)\/[^"]+)"/g)].map((m) => m[1]);
    const htmlCssJs = [...html.matchAll(/(?:href|src)="(\.\/(?:css|js)\/[^"]+)"/g)].map((m) => `/${m[1].slice(2)}`);
    assert.deepEqual([...swCssJs].sort(), [...htmlCssJs].sort(),
        '프리캐시 목록과 HTML 참조가 다릅니다. 버전 변경 시 양쪽을 같이 올려야 합니다.');
    // 버전 쿼리가 실제로 붙어 있어야 immutable 캐시가 유효합니다
    for (const url of htmlCssJs) {
        assert.match(url, /\?v=\d+\.\d+$/, `${url} 에 ?v= 버전 쿼리가 없습니다`);
    }
});

test('index.html 이 마크업만 담고(175KB 선) 전역 로직은 app.js 가 담고 있다', () => {
    // 분리 전 index.html 은 830KB 였습니다. 마크업만 남으면 200KB 를 넘어서면 안 됩니다.
    assert.ok(Buffer.byteLength(html, 'utf8') < 200_000,
        `index.html 이 ${Buffer.byteLength(html, 'utf8')}B 로 너무 큽니다 — 인라인 코드가 다시 들어온 것 같습니다.`);
    assert.ok(appAll.length > Buffer.byteLength(html, 'utf8'), '전역 로직은 app.js 쪽에 더 많이 있어야 합니다');
});
