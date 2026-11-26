/**
 * ☂️ 비 예보 플로팅 카드 회귀 방지 테스트
 *
 * 출처: 이모티학 PR #117(머지 994b0f4) → PR #140(리버트 e3c9de4) 기능을 학포트로 이식.
 * 인수인계 문서 docs/hakport-weather-float.md 의 '검증 체크리스트' 8가지를 그대로 고정합니다.
 *
 *  1) [61, 80%, 3.2mm] → 표시   2) [3, 65%, 0mm] → 표시   3) [2, 10%, 1.4mm] → 표시
 *  4) [2, 10%, 0mm] → 미표시   5) [95, 30%, 0.2mm] → 표시
 *  6) daily 없음/null → 미표시  7) 레거시 weathercode 파싱  8) 오늘 닫힘 키 → 미표시
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
    APP_JS_FILES,
    APP_ASSET_VERSION,
    readAppHtml,
    readAppCssRaw,
    readAppFile
} from './app-source.mjs';

const js = readAppFile('public/js/rain-float.js');
const html = readAppHtml();
const css = readAppCssRaw();
const sw = readAppFile('public/service-worker.js');
const appJs = readAppFile('public/js/app.js');
const validateSrc = readFileSync(new URL('../scripts/validate.mjs', import.meta.url), 'utf8');
const buildSrc = readFileSync(new URL('../scripts/build-obfuscate.mjs', import.meta.url), 'utf8');

/* ── 최소 DOM 스텁: 실제 렌더·닫기·CTA 흐름을 브라우저 없이 검증 ── */
function makeEl(tag) {
    const listeners = {};
    const node = {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        children: [],
        attrs: {},
        parentNode: null,
        removed: false,
        scrolled: null,
        classList: {
            names: new Set(),
            add(name) { this.names.add(name); },
            remove(name) { this.names.delete(name); },
            contains(name) { return this.names.has(name); }
        },
        setAttribute(key, value) { node.attrs[key] = String(value); },
        getAttribute(key) { return node.attrs[key]; },
        appendChild(child) { node.children.push(child); child.parentNode = node; return child; },
        removeChild(child) {
            const index = node.children.indexOf(child);
            if (index >= 0) node.children.splice(index, 1);
            child.parentNode = null;
            return child;
        },
        addEventListener(type, fn) { listeners[type] = fn; },
        dispatch(type) { if (listeners[type]) listeners[type]({ type }); },
        remove() { node.removed = true; if (node.parentNode) node.parentNode.removeChild(node); },
        querySelector() { return null; },
        scrollIntoView(options) { node.scrolled = options || {}; }
    };
    return node;
}

function daily(code, prob, sum, key) {
    const block = {
        time: ['2026-11-26'],
        precipitation_probability_max: [prob],
        precipitation_sum: [sum]
    };
    block[key || 'weather_code'] = [code];
    return { daily: block };
}

function makeEnv(options) {
    const opts = options || {};
    const appended = [];
    const timers = [];
    const cleared = [];
    const toggled = [];
    const fetchCalls = [];

    const body = makeEl('body');
    body.appendChild = function (child) {
        appended.push(child);
        child.parentNode = body;
        return child;
    };
    const weatherCard = makeEl('div');
    const document = {
        readyState: 'loading', // 자동 마운트는 등록만 하고 테스트가 mountRainFloat() 를 직접 호출
        body,
        createElement: (tag) => makeEl(tag),
        getElementById: (id) => (id === 'weather-card' ? weatherCard : null),
        addEventListener: () => {}
    };
    const storage = {
        data: Object.assign({}, opts.storage || {}),
        getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; },
        setItem(key, value) { this.data[key] = String(value); }
    };
    const window = {
        localStorage: storage,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout: (id) => { cleared.push(id); },
        fetch: (url, options2) => {
            fetchCalls.push({ url, options: options2 });
            return (opts.fetch || (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(daily(61, 80, 3.2)) })))();
        },
        toggleDashItem: (id) => { toggled.push(id); weatherCard.classList.add('expanded'); }
    };

    const context = vm.createContext({ window, document, AbortController });
    vm.runInContext(js, context);
    return {
        api: window.HakportRainFloat,
        appended,
        timers,
        cleared,
        toggled,
        fetchCalls,
        storage,
        weatherCard
    };
}

function allText(node) {
    if (!node) return '';
    let out = typeof node.textContent === 'string' ? node.textContent : '';
    for (const child of node.children || []) out += ' ' + allText(child);
    return out;
}

/* ───────────────────────── 1. 비 판정 8가지 ───────────────────────── */

test('검증 1~5: 비 판정 임계값(코드 · 50% · 1mm)이 원본과 동일하다', () => {
    const { api } = makeEnv();
    const cases = [
        { json: daily(61, 80, 3.2), expected: true, why: '날씨코드 비(61)' },
        { json: daily(3, 65, 0), expected: true, why: '강수확률 ≥ 50' },
        { json: daily(2, 10, 1.4), expected: true, why: '강수량 ≥ 1mm' },
        { json: daily(2, 10, 0), expected: false, why: '맑음 · 낮은 확률 · 강수량 0' },
        { json: daily(95, 30, 0.2), expected: true, why: '뇌우(95)' }
    ];
    for (const item of cases) {
        const parsed = api.parseDailyForecast(item.json);
        assert.ok(parsed, `${item.why}: 파싱 실패`);
        assert.equal(api.isRainForecast(parsed), item.expected, item.why);
    }
    // 값이 모르는(null) 경우에도 NaN 으로 오판정하지 않는다.
    assert.equal(api.isRainForecast(api.parseDailyForecast({ daily: { time: ['2026-11-26'] } })), false);
});

test('검증 6: daily 가 없거나 null·문자열이면 파싱 결과가 null 이다', () => {
    const { api } = makeEnv();
    assert.equal(api.parseDailyForecast({}), null);
    assert.equal(api.parseDailyForecast({ daily: null }), null);
    assert.equal(api.parseDailyForecast({ daily: 'oops' }), null);
    assert.equal(api.parseDailyForecast(null), null);
    assert.equal(api.parseDailyForecast('not json'), null);
    // daily 는 있어도 배열 값이 없으면 전부 null → 비 판정 false
    const empty = api.parseDailyForecast({ daily: {} });
    assert.equal(empty.weatherCode, null);
    assert.equal(empty.precipitationProbabilityMax, null);
    assert.equal(empty.precipitationSum, null);
    assert.equal(api.isRainForecast(empty), false);
});

test('검증 7: 레거시 키 weathercode 도 읽고, 숫자가 아니면 무시한다', () => {
    const { api } = makeEnv();
    assert.equal(api.parseDailyForecast(daily(61, 10, 0, 'weathercode')).weatherCode, 61);
    assert.equal(api.parseDailyForecast({ daily: { weather_code: ['61'] } }).weatherCode, null);
    assert.equal(api.parseDailyForecast({ daily: { weather_code: [NaN] } }).weatherCode, null);
    assert.equal(api.parseDailyForecast({ daily: { weather_code: [Infinity] } }).weatherCode, null);
});

test('검증 8: 오늘 닫힘 키가 있으면 fetch 조차 하지 않고 아무것도 렌더하지 않는다', async () => {
    const today = makeEnv().api.kstTodayKey();
    const key = 'hakport:rain-float-dismissed:' + today;
    const env = makeEnv({ storage: { [key]: '1' } });
    const card = await env.api.mountRainFloat();
    assert.equal(card, null);
    assert.equal(env.appended.length, 0, '카드가 렌더되었습니다');
    assert.equal(env.fetchCalls.length, 0, '닫힘 상태인데도 예보를 요청했습니다');
});

/* ───────────────────────── 2. 렌더 · 닫기 · 실패 ───────────────────────── */

test('비 예보 응답이면 카드가 만들어지고 내용·출처·CTA 가 모두 들어간다', async () => {
    const env = makeEnv();
    const card = await env.api.mountRainFloat();
    assert.ok(card, '카드가 없습니다');
    assert.equal(env.appended.length, 1);
    assert.equal(card.attrs.role, 'status');
    assert.equal(card.attrs['aria-live'], 'polite');
    assert.equal(card.attrs['aria-label'], '비 예보 안내');
    const text = allText(card);
    assert.match(text, /오늘 부산에 비 소식이 있어요/);
    assert.match(text, /강수확률 최대 80%/);
    assert.match(text, /예상 강수량 3\.2mm/);
    assert.match(text, /비/);
    assert.match(text, /Open-Meteo · 부산/);
    assert.match(text, /CC BY 4\.0/);
    assert.match(text, /부산항 기상 전광판/);
    // 8초 타임아웃이 걸리고 응답 후 정리된다.
    assert.equal(env.timers.length, 1);
    assert.equal(env.timers[0].ms, 8000);
    assert.equal(env.cleared.length, 1);
});

test('✕ 로 닫으면 KST 오늘 키를 저장하고 카드를 제거한다(다음 날 재확인)', async () => {
    const env = makeEnv();
    const card = await env.api.mountRainFloat();
    const close = card.children[0].children[0].children[2]; // head → icon/copy/close
    assert.equal(close.className, 'rain-float-close');
    close.dispatch('click');
    const today = env.api.kstTodayKey();
    assert.equal(env.storage.getItem('hakport:rain-float-dismissed:' + today), '1');
    assert.equal(card.removed, true, '카드가 화면에서 제거되지 않았습니다');
});

test('CTA 는 기존 #weather-card 를 펼치고 플로팅만 접는다(당일 숨김 키는 저장하지 않음)', async () => {
    const env = makeEnv();
    const card = await env.api.mountRainFloat();
    const foot = card.children[0].children[1];
    const cta = foot.children[1];
    assert.equal(cta.className, 'rain-float-cta');
    cta.dispatch('click');
    assert.deepEqual(env.toggled, ['weather-card']);
    assert.ok(env.weatherCard.scrolled, 'weather-card 로 스크롤하지 않았습니다');
    assert.equal(card.removed, true);
    assert.equal(Object.keys(env.storage.data).length, 0, 'CTA 가 닫힘 키를 저장하면 안 됩니다');
});

test('비가 아니거나 실패(네트워크·HTTP·형식)하면 조용히 아무것도 렌더하지 않는다', async () => {
    const scenarios = [
        () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(daily(2, 10, 0)) }),
        () => Promise.reject(new Error('offline')),
        () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
        () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ error: true }) }),
        () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) })
    ];
    for (const fetch of scenarios) {
        const env = makeEnv({ fetch });
        const card = await env.api.mountRainFloat();
        assert.equal(card, null);
        assert.equal(env.appended.length, 0);
        assert.equal(env.cleared.length, 1, '타임아웃 타이머가 정리되지 않았습니다');
    }
});

test('KST 날짜 키 · 스토리지 prefix · 코드 라벨이 원본 규칙을 따른다', () => {
    const { api } = makeEnv();
    // UTC 15:30 = KST 다음 날 00:30 → 자정 경계가 KST 기준이어야 합니다.
    assert.equal(api.kstTodayKey(new Date('2026-11-26T15:30:00Z')), '2026-11-27');
    assert.equal(api.kstTodayKey(new Date('2026-11-26T00:00:00Z')), '2026-11-26');
    assert.match(api.kstTodayKey(), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(api.rainFloatDismissKey('2026-11-26'), 'hakport:rain-float-dismissed:2026-11-26');
    assert.equal(api.isRainCode(51), true);
    assert.equal(api.isRainCode(3), false);
    assert.equal(api.isRainCode(null), false);
    assert.equal(api.rainCodeLabel(61, 'ko'), '비');
    assert.equal(api.rainCodeLabel(61, 'en'), 'Rain');
    assert.equal(api.rainCodeLabel(95, 'ko'), '뇌우');
    assert.equal(api.rainCodeLabel(2, 'ko'), null);
});

/* ───────────────────────── 3. 학포트 적응 · 배선 ───────────────────────── */

test('지역은 창원이 아니라 부산(35.1796, 129.0756) 고정 좌표다', () => {
    const { api } = makeEnv();
    assert.equal(api.BUSAN.latitude, 35.1796);
    assert.equal(api.BUSAN.longitude, 129.0756);
    assert.match(api.FORECAST_URL, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    assert.match(api.FORECAST_URL, /latitude=35\.1796/);
    assert.match(api.FORECAST_URL, /longitude=129\.0756/);
    assert.match(api.FORECAST_URL, /daily=weather_code,precipitation_probability_max,precipitation_sum/);
    assert.match(api.FORECAST_URL, /timezone=Asia%2FSeoul/);
    assert.match(api.FORECAST_URL, /forecast_days=1/);
    assert.match(js, /부산/);
    assert.doesNotMatch(js, /35\.227|128\.6816|CHANGWON/, '원본(창원) 좌표가 남아 있습니다');
    assert.doesNotMatch(js, /['"]emotime:/, '원본 스토리지 prefix 가 남아 있습니다');
    assert.doesNotMatch(js, /navigator\.geolocation|getCurrentPosition\s*\(/, '권한 요청 없이 동작해야 합니다');
    assert.doesNotMatch(js, /showToast|reportFailure|alert\(|console\./, '실패는 조용해야 합니다');
    assert.match(js, /8000/);
});

test('CTA 는 /brief 가 아니라 학포트의 #weather-card(날씨및도선 상황)를 연다', () => {
    assert.match(js, /getElementById\('weather-card'\)/);
    assert.match(js, /toggleDashItem\('weather-card'\)/);
    assert.match(appJs, /id === "weather-card"/);
    assert.match(html, /id="weather-card"/);
    assert.doesNotMatch(js, /\/brief/);
    assert.match(js, /https:\/\/open-meteo\.com\//);
    assert.match(js, /creativecommons\.org\/licenses\/by\/4\.0/);
});

test('모듈이 자산 버전과 함께 로드되고 프리캐시·빌드·검증 목록에 모두 등록된다', () => {
    assert.ok(APP_JS_FILES.includes('public/js/rain-float.js'), 'app-source.mjs APP_JS_FILES');
    assert.ok(html.includes(`<script src="./js/rain-float.js?v=${APP_ASSET_VERSION}"></script>`), 'index.html 로드 태그');
    assert.ok(html.includes(`css/app.css?v=${APP_ASSET_VERSION}`), 'CSS 버전 쿼리');
    assert.ok(sw.includes(`"/js/rain-float.js?v=${APP_ASSET_VERSION}"`), '서비스 워커 프리캐시');
    assert.ok(sw.includes(`busan-hak-port-v${APP_ASSET_VERSION}`), '서비스 워커 캐시 버전');
    assert.ok(sw.includes('url.hostname.includes("open-meteo.com")'), '외부 예보 요청은 SW 캐시 대상이 아닙니다');
    assert.match(validateSrc, /'public\/js\/rain-float\.js'/);
    assert.match(buildSrc, /'js\/rain-float\.js'/);
});

test('카드 스타일은 디자인 토큰만 참조하고 다크모드·모션·하단 내비 회피를 유지한다', () => {
    const block = css.slice(css.indexOf('.rain-float {'));
    assert.ok(block.length > 0, '.rain-float CSS 가 없습니다');
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, '하드코딩 색상이 있습니다');
    assert.match(block, /bottom: max\(84px, env\(safe-area-inset-bottom\) \+ 74px\)/);
    assert.match(block, /z-index: var\(--z-visitor-badge\)/);
    assert.match(block, /body\.dark-mode \.rain-float-card/);
    assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(block, /animation: none/);
    assert.match(block, /min-width: 768px/);
});
