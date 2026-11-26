// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/* ☂️ 비 예보 플로팅 카드 (2026-11-26 · 이모티학 PR #117 → 학포트 이식)
   - 홈 진입 시 Open-Meteo(API 키 불필요 · CORS 허용 · CC BY 4.0)에서 부산 오늘 예보를 읽어
     '비가 예보된 날에만' 화면 우하단에 카드를 띄웁니다.
   - 비 판정: WMO 비 계열 코드 OR 최대 강수확률 50% 이상 OR 예상 강수량 1mm 이상.
   - ✕ 로 닫으면 KST 날짜 키(hakport:rain-float-dismissed:YYYY-MM-DD)로 그날은 다시 뜨지 않습니다.
   - 네트워크 오류 · 8초 타임아웃 · 응답 형식 이상 → 아무것도 렌더하지 않습니다(조용한 실패).
   - 위치는 부산 고정 좌표이며 geolocation 을 쓰지 않습니다(권한 요청 없음).
   - 스타일은 public/css/app.css 의 디자인 토큰만 참조합니다(.rain-float-*).
*/
(function () {
    'use strict';

    /* 부산(부산항) 대표 좌표 — 창원(이모티학 원본)에서 교체 */
    var BUSAN = { latitude: 35.1796, longitude: 129.0756, timezone: 'Asia/Seoul' };
    var FORECAST_URL =
        'https://api.open-meteo.com/v1/forecast?latitude=' + BUSAN.latitude +
        '&longitude=' + BUSAN.longitude +
        '&daily=weather_code,precipitation_probability_max,precipitation_sum' +
        '&timezone=Asia%2FSeoul&forecast_days=1';

    /* 이모티학(emotime:)과 충돌하지 않도록 학포트 전용 prefix */
    var DISMISS_PREFIX = 'hakport:rain-float-dismissed:';
    var TIMEOUT_MS = 8000;

    /* WMO weather interpretation codes 중 비 계열(이슬비·어는비·비·소나기·뇌우) */
    var RAIN_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];

    /* 학포트는 한국어 단일 로케일 — i18n 모듈 없이 ko 문구로 고정 */
    var COPY = {
        eyebrow: '오늘의 날씨 · 부산',
        title: '오늘 부산에 비 소식이 있어요',
        prob: '강수확률 최대',
        sum: '예상 강수량',
        fallback: '비가 올 수 있어요',
        cta: '부산항 기상 전광판 →',
        close: '오늘은 그만 보기',
        aria: '비 예보 안내',
        source: 'Open-Meteo · 부산',
        license: 'CC BY 4.0',
        region: '부산'
    };

    /** KST 기준 오늘 날짜 키 (YYYY-MM-DD) — '오늘 하루 숨기기' 판정에 사용 */
    function kstTodayKey(d) {
        // vm/iframe 등 다른 렐름에서 전달된 Date 도 getTime 으로 판별합니다.
        var date = d && typeof d.getTime === 'function' ? d : new Date();
        var formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        var parts = formatter.formatToParts(date);
        var value = function (type) {
            for (var i = 0; i < parts.length; i += 1) {
                if (parts[i].type === type) return parts[i].value;
            }
            return '';
        };
        var key = value('year') + '-' + value('month') + '-' + value('day');
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
        // Intl 구현이 드물게 다른 형식을 반환해도 KST(UTC+9, DST 없음)로 폴백합니다.
        return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    function rainFloatDismissKey(dateKey) {
        return DISMISS_PREFIX + dateKey;
    }

    function isRainCode(code) {
        return typeof code === 'number' && RAIN_CODES.indexOf(code) !== -1;
    }

    /** 비 예보로 볼지 판정 — 코드 / 확률 50% / 강수량 1mm 중 하나라도 해당되면 true */
    function isRainForecast(f) {
        if (!f) return false;
        if (isRainCode(f.weatherCode)) return true;
        if (typeof f.precipitationProbabilityMax === 'number' && f.precipitationProbabilityMax >= 50) return true;
        if (typeof f.precipitationSum === 'number' && f.precipitationSum >= 1) return true;
        return false;
    }

    /** 비 계열 날씨코드 → 짧은 라벨. 비 계열이 아니면 null. */
    function rainCodeLabel(code, locale) {
        if (typeof code !== 'number') return null;
        var ko = locale !== 'en';
        if ([51, 53, 55, 56, 57].indexOf(code) !== -1) return ko ? '이슬비' : 'Drizzle';
        if ([61, 63, 65].indexOf(code) !== -1) return ko ? '비' : 'Rain';
        if ([66, 67].indexOf(code) !== -1) return ko ? '어는비' : 'Freezing rain';
        if ([80, 81, 82].indexOf(code) !== -1) return ko ? '소나기' : 'Showers';
        if (code === 95) return ko ? '뇌우' : 'Thunderstorm';
        if (code === 96 || code === 99) return ko ? '뇌우·우박' : 'Thunderstorm w/ hail';
        return null;
    }

    /** Open-Meteo daily 응답 → 예보 값. 형식이 다르면 null(호출부는 아무것도 보여 주지 않음). */
    function parseDailyForecast(json) {
        if (!json || typeof json !== 'object') return null;
        var daily = json.daily;
        if (!daily || typeof daily !== 'object') return null;
        var pick = function (key) {
            var value = daily[key];
            return Object.prototype.toString.call(value) === '[object Array]' ? value[0] : undefined;
        };
        var num = function (v) {
            return typeof v === 'number' && Number.isFinite(v) ? v : null;
        };

        var time = pick('time');
        var dateKey = typeof time === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(time)
            ? time
            : kstTodayKey();
        // Open-Meteo 는 weather_code 를 쓰지만, 구버전 호환으로 weathercode 도 읽습니다.
        var code = pick('weather_code');
        if (code === undefined) code = pick('weathercode');

        return {
            dateKey: dateKey,
            precipitationProbabilityMax: num(pick('precipitation_probability_max')),
            precipitationSum: num(pick('precipitation_sum')),
            weatherCode: num(code)
        };
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (typeof text === 'string') node.textContent = text;
        return node;
    }

    function link(className, text, href) {
        var a = el('a', className, text);
        a.setAttribute('href', href);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        return a;
    }

    function hideCard(card) {
        if (!card) return;
        try {
            if (typeof card.remove === 'function') card.remove();
            else if (card.parentNode && typeof card.parentNode.removeChild === 'function') {
                card.parentNode.removeChild(card);
            }
        } catch (e) { /* 카드 제거 실패가 홈 화면을 막지 않게 합니다 */ }
    }

    function dismissCard(card) {
        try {
            window.localStorage.setItem(rainFloatDismissKey(kstTodayKey()), '1');
        } catch (e) { /* 프라이빗 모드 등 저장 불가 환경에서도 이번 화면에서는 닫힙니다 */ }
        hideCard(card);
    }

    /** CTA → 학포트의 기존 '📡 날씨 및 도선 상황' 카드(#weather-card)를 펼쳐 기상 전광판을 보여줍니다. */
    function openWeatherBoard() {
        try {
            var card = document.getElementById('weather-card');
            if (!card) return;
            var expanded = card.classList && typeof card.classList.contains === 'function'
                ? card.classList.contains('expanded')
                : false;
            if (!expanded && typeof window.toggleDashItem === 'function') {
                window.toggleDashItem('weather-card');
            }
            if (typeof card.scrollIntoView === 'function') {
                card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } catch (e) { /* CTA 실패가 홈 렌더링에 영향을 주지 않게 합니다 */ }
    }

    function buildCard(forecast) {
        var card = el('div', 'rain-float');
        card.setAttribute('role', 'status');
        card.setAttribute('aria-live', 'polite');
        card.setAttribute('aria-label', COPY.aria);

        var box = el('div', 'rain-float-card');
        var head = el('div', 'rain-float-head');
        var icon = el('span', 'rain-float-icon', '☂️');
        icon.setAttribute('aria-hidden', 'true');

        var copy = el('div', 'rain-float-copy');
        copy.appendChild(el('p', 'rain-float-eyebrow', '☁️ ' + COPY.eyebrow));
        copy.appendChild(el('p', 'rain-float-title', COPY.title));

        var prob = forecast.precipitationProbabilityMax;
        var sum = forecast.precipitationSum;
        var codeLabel = rainCodeLabel(forecast.weatherCode, 'ko');
        var detail = [
            typeof prob === 'number' ? COPY.prob + ' ' + Math.round(prob) + '%' : null,
            typeof sum === 'number' ? COPY.sum + ' ' + sum.toFixed(1) + 'mm' : null,
            codeLabel
        ].filter(function (part) { return Boolean(part); }).join(' · ') || COPY.fallback;
        copy.appendChild(el('p', 'rain-float-detail', detail));

        var close = el('button', 'rain-float-close', '✕');
        close.setAttribute('type', 'button');
        close.setAttribute('aria-label', COPY.close);
        close.setAttribute('title', COPY.close);
        close.addEventListener('click', function () { dismissCard(card); });

        head.appendChild(icon);
        head.appendChild(copy);
        head.appendChild(close);

        var foot = el('div', 'rain-float-foot');
        var source = el('div', 'rain-float-source');
        source.appendChild(link('rain-float-source-link', COPY.source, 'https://open-meteo.com/'));
        source.appendChild(el('span', 'rain-float-source-sep', '·'));
        source.appendChild(link('rain-float-license', COPY.license, 'https://creativecommons.org/licenses/by/4.0/'));

        var cta = el('button', 'rain-float-cta', COPY.cta);
        cta.setAttribute('type', 'button');
        cta.addEventListener('click', function () {
            openWeatherBoard();
            hideCard(card); // CTA 로 이동했으면 플로팅만 접습니다(당일 숨김 키는 저장하지 않음).
        });

        foot.appendChild(source);
        foot.appendChild(cta);
        box.appendChild(head);
        box.appendChild(foot);
        card.appendChild(box);
        return card;
    }

    /**
     * 예보를 조회해 비가 예보된 날에만 카드를 붙입니다.
     * 실패(네트워크·8초 타임아웃·형식 이상) 시에는 조용히 아무것도 하지 않습니다.
     * 반환값(Promise)은 회귀 테스트에서 렌더 여부를 확인하는 데 씁니다.
     */
    function mountRainFloat() {
        var today = kstTodayKey();
        try {
            if (window.localStorage.getItem(rainFloatDismissKey(today)) === '1') {
                return Promise.resolve(null);
            }
        } catch (e) { /* localStorage 를 못 쓰는 환경은 그냥 보여 줍니다 */ }

        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        // 느린 네트워크에서 홈 화면을 붙잡지 않도록 8초 안에 포기합니다.
        var timer = window.setTimeout(function () {
            if (controller) controller.abort();
        }, TIMEOUT_MS);
        var options = controller ? { signal: controller.signal } : undefined;

        return window.fetch(FORECAST_URL, options)
            .then(function (res) {
                if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : 'unknown'));
                return res.json();
            })
            .then(function (json) {
                var parsed = parseDailyForecast(json);
                if (!parsed || !isRainForecast(parsed)) return null;
                var card = buildCard(parsed);
                if (document.body && typeof document.body.appendChild === 'function') {
                    document.body.appendChild(card);
                }
                return card;
            })
            .catch(function () { return null; }) // 조용한 실패 — 토스트·콘솔 알림 없음
            .then(function (card) {
                window.clearTimeout(timer);
                return card || null;
            });
    }

    /* 순수 로직 + 마운트 진입점은 회귀 테스트(scripts/rain-float.test.mjs)가 재사용합니다. */
    window.HakportRainFloat = {
        BUSAN: BUSAN,
        FORECAST_URL: FORECAST_URL,
        TIMEOUT_MS: TIMEOUT_MS,
        COPY: COPY,
        kstTodayKey: kstTodayKey,
        rainFloatDismissKey: rainFloatDismissKey,
        isRainCode: isRainCode,
        isRainForecast: isRainForecast,
        rainCodeLabel: rainCodeLabel,
        parseDailyForecast: parseDailyForecast,
        mountRainFloat: mountRainFloat
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { mountRainFloat(); }, { once: true });
    } else {
        mountRainFloat();
    }
})();
