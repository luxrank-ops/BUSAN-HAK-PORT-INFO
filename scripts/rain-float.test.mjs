/**
 * 🌦️ 비·눈·안개·강풍 예보 플로팅 카드 회귀 방지 테스트
 *
 * 출처: 이모티학 PR #117(머지 994b0f4) → PR #140(리버트 e3c9de4) 기능을 학포트로 이식.
 * 인수인계 문서 docs/hakport-weather-float.md 의 '검증 체크리스트' 8가지를 그대로 고정하고,
 * 2026-11-28 강풍 · 안개 · 눈 확장분(항만 안전 기준 10m/s 주의 / 15m/s 통제)을 추가로 고정합니다.
 *
 *  1) [61, 80%, 3.2mm] → 표시   2) [3, 65%, 0mm] → 표시   3) [2, 10%, 1.4mm] → 표시
 *  4) [2, 10%, 0mm] → 미표시   5) [95, 30%, 0.2mm] → 표시
 *  6) daily 없음/null → 미표시  7) 레거시 weathercode 파싱  8) 오늘 닫힘 키 → 미표시
 *  9) 강풍(풍속·돌풍 10m/s↑) 표시 · 15m/s↑ 통제 문구   10) 눈(71·73·75·77·85·86) 표시
 * 11) 안개(45·48) 표시  12) 여러 위험 동시 → 우선순위(통제급 강풍 > 눈 > 비 > 강풍 주의 > 안개)
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
        getBoundingClientRect() { return node.rect || { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 }; },
        scrollIntoView(options) { node.scrolled = options || {}; }
    };
    return node;
}

function daily(code, prob, sum, key, windSpeed, gust) {
    const block = {
        time: ['2026-11-26'],
        precipitation_probability_max: [prob],
        precipitation_sum: [sum]
    };
    block[key || 'weather_code'] = [code];
    if (typeof windSpeed === 'number') block.wind_speed_10m_max = [windSpeed];
    if (typeof gust === 'number') block.wind_gusts_10m_max = [gust];
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
    weatherCard.rect = typeof opts.cardTop === 'number'
        ? { top: opts.cardTop, bottom: opts.cardTop + 400, height: 400, left: 0, right: 390, width: 390 }
        : undefined;
    const document = {
        readyState: 'loading', // 자동 마운트는 등록만 하고 테스트가 mountRainFloat() 를 직접 호출
        body,
        createElement: (tag) => makeEl(tag),
        getElementById: (id) => (id === 'weather-card' ? weatherCard : null),
        querySelector: opts.querySelector || (() => null),
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
        toggleDashItem: (id) => { toggled.push(id); weatherCard.classList.add('expanded'); },
        pageYOffset: typeof opts.pageYOffset === 'number' ? opts.pageYOffset : 0
    };
    if (typeof opts.scrollTo === 'function') window.scrollTo = opts.scrollTo;

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
    assert.match(text, /오늘 부산항에 비 소식이 있어요/);
    assert.match(text, /강수확률 최대 80%/);
    assert.match(text, /예상 강수량 3\.2mm/);
    assert.match(text, /비/);
    assert.match(text, /Open-Meteo · 부산항/);
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

/* ────────────────── 2-1. 강풍 · 눈 · 안개 확장 (2026-11-28) ────────────────── */

const jsonOf = (payload) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });

function mountWith(payload) {
    const env = makeEnv({ fetch: jsonOf(payload) });
    return env.api.mountRainFloat().then((card) => ({ env, card }));
}

test('강풍 판정: 최대 풍속·돌풍 10m/s↑ 주의, 15m/s↑ 고소 작업 통제(전광판 기준과 동일)', () => {
    const { api } = makeEnv();
    const of = (code, prob, sum, speed, gust) => api.parseDailyForecast(daily(code, prob, sum, null, speed, gust));
    assert.equal(api.windLevel(of(3, 0, 0, 8.4, 9.9)), 0, '10m/s 미만은 알림 없음');
    assert.equal(api.windLevel(of(3, 0, 0, 7, 9.9)), 0, '돌풍 9.9m/s 도 미만');
    assert.equal(api.windLevel(of(3, 0, 0, 7, 10)), 1, '돌풍만 10m/s 이어도 주의');
    assert.equal(api.windLevel(of(3, 0, 0, 11.2, 13.4)), 1);
    assert.equal(api.windLevel(of(3, 0, 0, 12, 15)), 2, '15m/s 는 통제');
    assert.equal(api.windLevel(of(3, 0, 0, 16.3, 17.9)), 2);
    // 표시값과 판정값을 맞춥니다(9.96 → 10.0 표시 → 주의).
    assert.equal(api.windPeak(of(3, 0, 0, 9.96, null)), 10);
    assert.equal(api.windLevel(of(3, 0, 0, 9.96, null)), 1);
    // 풍속 필드가 없으면 판정하지 않습니다.
    assert.equal(api.windPeak(of(3, 0, 0)), null);
    assert.equal(api.windLevel(of(3, 0, 0)), 0);
    assert.equal(api.isWeatherAlert(of(3, 0, 0, 8.4, 9.9)), false);
    assert.equal(api.isWeatherAlert(of(3, 0, 0, 10, 11)), true);
});

test('강풍 카드: 주의(10m/s↑)에서는 풍속·돌풍과 주의 기준을 알린다', async () => {
    const { card } = await mountWith(daily(3, 5, 0, null, 11.2, 14.6));
    assert.ok(card, '강풍 예보인데 카드가 없습니다');
    const text = allText(card);
    assert.equal(card.attrs['aria-label'], '강풍 예보 안내');
    assert.match(text, /오늘 부산항에 바람이 강해요/);
    assert.match(text, /최대 풍속 11\.2m\/s/);
    assert.match(text, /돌풍 14\.6m\/s/);
    assert.match(text, /강풍 주의 기준\(10m\/s\)/);
    assert.doesNotMatch(text, /고소 작업 통제/);
});

test('강풍 카드: 15m/s 이상이면 고소 작업 통제 문구로 알린다', async () => {
    const { card } = await mountWith(daily(3, 5, 0, null, 13.4, 17.2));
    assert.ok(card);
    const text = allText(card);
    assert.match(text, /오늘 부산항에 강한 바람이 예보돼요/);
    assert.match(text, /고소 작업 통제 기준\(15m\/s\)/);
});

test('눈 코드(71·73·75·77·85·86)는 눈 알림으로, 안개 코드(45·48)는 안개 알림으로 뜬다', async () => {
    for (const code of [71, 73, 75, 77, 85, 86]) {
        const { card } = await mountWith(daily(code, 0, 0));
        assert.ok(card, `눈 코드 ${code} 에 카드가 없습니다`);
        assert.equal(card.attrs['aria-label'], '눈 예보 안내');
        assert.match(allText(card), /오늘 부산항에 눈 소식이 있어요/);
        assert.match(allText(card), /눈/);
    }
    for (const code of [45, 48]) {
        const { card } = await mountWith(daily(code, 0, 0));
        assert.ok(card, `안개 코드 ${code} 에 카드가 없습니다`);
        assert.equal(card.attrs['aria-label'], '안개 예보 안내');
        assert.match(allText(card), /안개/);
    }
    // 구름 한 점 없는 날씨코드(0·2·3)는 그대로 미표시입니다.
    for (const code of [0, 2, 3]) {
        const { card } = await mountWith(daily(code, 10, 0));
        assert.equal(card, null, `날씨코드 ${code} 는 알림 대상이 아닙니다`);
    }
});

test('날씨코드 라벨: 눈·안개 계열도 한국어/영어 라벨을 돌려준다', () => {
    const { api } = makeEnv();
    assert.equal(api.weatherCodeLabel(71, 'ko'), '눈');
    assert.equal(api.weatherCodeLabel(73, 'en'), 'Snow');
    assert.equal(api.weatherCodeLabel(86, 'ko'), '소나기 눈');
    assert.equal(api.weatherCodeLabel(45, 'ko'), '안개');
    assert.equal(api.weatherCodeLabel(48, 'en'), 'Rime fog');
    assert.equal(api.rainCodeLabel(65, 'ko'), '비');
    assert.equal(api.isSnowCode(85), true);
    assert.equal(api.isFogCode(48), true);
    assert.equal(api.isRainCode(45), false);
});

test('여러 위험이 겹치면 통제급 강풍 > 눈 > 비 > 강풍 주의 > 안개 순으로 제목을 고른다', () => {
    const { api } = makeEnv();
    const of = (code, prob, sum, speed, gust) => api.parseDailyForecast(daily(code, prob, sum, null, speed, gust));
    assert.equal(api.assessForecast(of(61, 90, 5, 16, 20)).kind, 'windStop');
    assert.equal(api.assessForecast(of(71, 40, 0, 4, 6)).kind, 'snow');
    assert.equal(api.assessForecast(of(71, 40, 0, 12, 13)).kind, 'snow', '눈이 강풍 주의보다 먼저');
    assert.equal(api.assessForecast(of(61, 90, 5, 11, 12)).kind, 'rain', '비가 강풍 주의보다 먼저');
    assert.equal(api.assessForecast(of(45, 10, 0, 11, 12)).kind, 'wind', '강풍 주의가 안개보다 먼저');
    assert.equal(api.assessForecast(of(2, 10, 0, 4, 6)), null);
    const kinds = api.assessForecast(of(63, 80, 4, 10.5, 12)).kinds;
    assert.deepEqual(Array.from(kinds), ['rain', 'wind'], '동시 위험은 모두 기록합니다');
});

test('비 카드에도 강풍이면 풍속 줄이 함께 붙고, 바람이 약하면 붙지 않는다', async () => {
    const calm = await mountWith(daily(61, 80, 3.2, null, 6.1, 8.2));
    assert.ok(calm.card);
    assert.match(allText(calm.card), /오늘 부산항에 비 소식이 있어요/);
    assert.doesNotMatch(allText(calm.card), /최대 풍속/);
    const stormy = await mountWith(daily(63, 90, 8.4, null, 10.4, 12.9));
    assert.ok(stormy.card);
    const text = allText(stormy.card);
    assert.match(text, /오늘 부산항에 비 소식이 있어요/);
    assert.match(text, /최대 풍속 10\.4m\/s · 돌풍 12\.9m\/s · 강풍 주의 기준\(10m\/s\)/);
});

test('CTA 착지: 고정 헤더·방문자 배지·긴급 공지 아래로 스크롤한다(배지가 제목을 덮지 않게)', async () => {
    const scrolls = [];
    const env = makeEnv({
        cardTop: 900,
        pageYOffset: 100,
        scrollTo: (opts2) => scrolls.push(opts2),
        querySelector: (sel) => {
            if (sel === 'header') return { getBoundingClientRect: () => ({ height: 62, bottom: 62 }) };
            if (sel === '.today-visitor-badge') return { getBoundingClientRect: () => ({ bottom: 46 }) };
            if (sel === '#emergencyFloatingNotice') {
                return { classList: { contains: () => false }, getBoundingClientRect: () => ({ bottom: 460 }) };
            }
            return null;
        }
    });
    const card = await env.api.mountRainFloat();
    card.children[0].children[1].children[1].dispatch('click'); // foot → cta
    assert.equal(scrolls.length, 1, 'window.scrollTo 로 착지하지 않았습니다');
    // 900(카드 상단) + 100(현재 스크롤) - 460(긴급 공지 하단) - 8(여백)
    assert.equal(scrolls[0].top, 532);
    assert.equal(scrolls[0].behavior, 'smooth');
    assert.equal(env.weatherCard.scrolled, null, 'scrollTo 가 되면 scrollIntoView 를 쓰지 않습니다');
});

/* ───────────────────────── 3. 학포트 적응 · 배선 ───────────────────────── */

test('지역은 부산항(북항) 고정 좌표(35.104, 129.042)이고 강풍 필드를 함께 조회한다', () => {
    const { api } = makeEnv();
    assert.equal(api.PORT.latitude, 35.104);
    assert.equal(api.PORT.longitude, 129.042);
    assert.match(api.FORECAST_URL, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    assert.match(api.FORECAST_URL, /latitude=35\.104/);
    assert.match(api.FORECAST_URL, /longitude=129\.042/);
    assert.match(api.FORECAST_URL, /daily=weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max/);
    // Open-Meteo 기본 풍속 단위는 km/h — 전광판 기준(10·15m/s)과 맞추려면 ms 로 요청해야 합니다.
    assert.match(api.FORECAST_URL, /wind_speed_unit=ms/);
    assert.match(api.FORECAST_URL, /timezone=Asia%2FSeoul/);
    assert.match(api.FORECAST_URL, /forecast_days=1/);
    assert.match(js, /부산항/);
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
    // 2026-11-28: 내비(65px) · '운영자에게 바란다'(~125px) · 🚨 다시 보기(~130px) 위로 분리
    assert.match(block, /bottom: max\(140px, env\(safe-area-inset-bottom\) \+ 130px\)/);
    assert.match(block, /z-index: var\(--z-visitor-badge\)/);
    assert.match(block, /body\.dark-mode \.rain-float-card/);
    assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(block, /animation: none/);
    assert.match(block, /min-width: 768px/);
    // PC·태블릿 분기가 다시 bottom 을 덮어 내비를 가리지 않아야 합니다.
    const desktopRule = block.slice(block.indexOf('@media (min-width: 768px)'), block.indexOf('(orientation: landscape) and (max-height: 560px)'));
    assert.doesNotMatch(desktopRule, /bottom:/, '≥768px 분기가 bottom 을 덮으면 하단 내비를 가립니다');
    // 짧은 가로 화면은 카드를 압축해 내비 바로 위에 붙입니다(상단 헤더·티커 회피).
    const landscapeRule = block.slice(block.indexOf('(orientation: landscape) and (max-height: 560px)'));
    assert.match(landscapeRule, /bottom: max\(calc\(52px \+ var\(--sp-8\)\)/);
    assert.match(block, /rain-float-wind/);
    // 안전 공지(긴급 공지 패널·다시 보기 버튼)는 예보 카드보다 위 레이어여야 합니다.
    const reopenRule = css.slice(css.indexOf('.emergency-float-reopen {'), css.indexOf('.emergency-admin-state {'));
    assert.match(reopenRule, /z-index: var\(--z-modal\)/);
    const noticeRule = css.slice(css.indexOf('.emergency-float {'), css.indexOf('.emergency-float.is-hidden'));
    assert.match(noticeRule, /z-index: var\(--z-modal\)/);
});
