// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/* 🌦️ 오늘 날씨 예보 플로팅 카드 (2026-11-26 이식 · 2026-11-28 강풍·안개·눈 확장)
   - 홈 진입 시 Open-Meteo(API 키 불필요 · CORS 허용 · CC BY 4.0)에서 부산항 오늘 예보를 읽어
     비 · 눈 · 안개 · 강풍이 예보된 날에만 화면 우하단에 카드를 띄웁니다.
   - 비 판정: WMO 비 계열 코드 OR 최대 강수확률 50% 이상 OR 예상 강수량 1mm 이상.
   - 눈 판정: WMO 눈 계열 코드(71·73·75·77·85·86).
   - 안개 판정: WMO 안개 계열 코드(45·48).
   - 강풍 판정: 일 최대 풍속·돌풍 중 큰 값이 10m/s 이상(강풍 주의) · 15m/s 이상(고소 작업 통제).
     기준은 기상 전광판(#weather-card)의 배지 로직과 동일합니다.
   - ✕ 로 닫으면 KST 날짜 키(hakport:rain-float-dismissed:YYYY-MM-DD)로 그날은 다시 뜨지 않습니다.
   - 네트워크 오류 · 8초 타임아웃 · 응답 형식 이상 → 아무것도 렌더하지 않습니다(조용한 실패).
   - 위치는 부산항(북항) 고정 좌표이며 geolocation 을 쓰지 않습니다(권한 요청 없음).
   - 스타일은 public/css/app.css 의 디자인 토큰만 참조합니다(.rain-float-*).
*/
(function () {
    'use strict';

    /* 부산항(북항) 고정 좌표 — 기상 전광판의 북항 지점(35.104, 129.042)과 같은 방향으로 맞춥니다. */
    var PORT = { latitude: 35.104, longitude: 129.042, timezone: 'Asia/Seoul' };
    var FORECAST_URL =
        'https://api.open-meteo.com/v1/forecast?latitude=' + PORT.latitude +
        '&longitude=' + PORT.longitude +
        '&daily=weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max' +
        '&wind_speed_unit=ms&timezone=Asia%2FSeoul&forecast_days=1';

    /* 이모티학(emotime:)과 충돌하지 않도록 학포트 전용 prefix */
    var DISMISS_PREFIX = 'hakport:rain-float-dismissed:';
    var TIMEOUT_MS = 8000;

    /* WMO weather interpretation codes */
    var RAIN_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
    var SNOW_CODES = [71, 73, 75, 77, 85, 86];
    var FOG_CODES = [45, 48];

    /* 항만 안전 기준 — 전광판 배지(10m/s 강풍 주의 · 15m/s 고소 작업 통제)와 동일 */
    var WIND_WATCH_MS = 10;
    var WIND_STOP_MS = 15;

    /* 학포트는 한국어 단일 로케일 — i18n 모듈 없이 ko 문구로 고정 */
    var COPY = {
        eyebrow: '오늘의 날씨 · 부산항',
        prob: '강수확률 최대',
        sum: '예상 강수량',
        speed: '최대 풍속',
        gust: '돌풍',
        watchNote: '강풍 주의 기준(10m/s)',
        stopNote: '고소 작업 통제 기준(15m/s)',
        windFallback: '작업 전 기상 전광판을 확인하세요',
        snowFallback: '눈이 올 수 있어요',
        fogFallback: '시야가 흐릴 수 있어요',
        fallback: '비가 올 수 있어요',
        cta: '부산항 기상 전광판 →',
        close: '오늘은 그만 보기',
        source: 'Open-Meteo · 부산항',
        license: 'CC BY 4.0',
        region: '부산항'
    };

    /* 알림 종류별 아이콘·제목·스크린리더 라벨 */
    var KIND_COPY = {
        rain: { icon: '☂️', title: '오늘 부산항에 비 소식이 있어요', aria: '비 예보 안내' },
        snow: { icon: '❄️', title: '오늘 부산항에 눈 소식이 있어요', aria: '눈 예보 안내' },
        fog: { icon: '🌫️', title: '오늘 부산항에 안개가 낄 수 있어요', aria: '안개 예보 안내' },
        wind: { icon: '💨', title: '오늘 부산항에 바람이 강해요', aria: '강풍 예보 안내' },
        windStop: { icon: '💨', title: '오늘 부산항에 강한 바람이 예보돼요', aria: '강풍 예보 안내' }
    };

    /* 카드가 여러 위험을 동시에 알릴 때 우선순위(안전 공지에 가까운 것부터) */
    var KIND_RANK = { windStop: 5, snow: 4, rain: 3, wind: 2, fog: 1 };

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

    function hasCode(list, code) {
        return typeof code === 'number' && list.indexOf(code) !== -1;
    }

    function isRainCode(code) {
        return hasCode(RAIN_CODES, code);
    }

    function isSnowCode(code) {
        return hasCode(SNOW_CODES, code);
    }

    function isFogCode(code) {
        return hasCode(FOG_CODES, code);
    }

    /** 비 예보로 볼지 판정 — 코드 / 확률 50% / 강수량 1mm 중 하나라도 해당되면 true */
    function isRainForecast(f) {
        if (!f) return false;
        if (isRainCode(f.weatherCode)) return true;
        if (typeof f.precipitationProbabilityMax === 'number' && f.precipitationProbabilityMax >= 50) return true;
        if (typeof f.precipitationSum === 'number' && f.precipitationSum >= 1) return true;
        return false;
    }

    /** 그날 가장 센 바람(풍속·돌풍 중 큰 값). 표시값과 판정값이 어긋나지 않도록 소수 1자리로 맞춥니다. */
    function windPeak(f) {
        if (!f) return null;
        var values = [];
        if (typeof f.windSpeedMax === 'number' && Number.isFinite(f.windSpeedMax)) values.push(f.windSpeedMax);
        if (typeof f.windGustMax === 'number' && Number.isFinite(f.windGustMax)) values.push(f.windGustMax);
        if (!values.length) return null;
        return Math.round(Math.max.apply(null, values) * 10) / 10;
    }

    /** 0 = 없음 · 1 = 강풍 주의(10m/s↑) · 2 = 고소 작업 통제(15m/s↑) */
    function windLevel(f) {
        var peak = windPeak(f);
        if (peak === null) return 0;
        if (peak >= WIND_STOP_MS) return 2;
        if (peak >= WIND_WATCH_MS) return 1;
        return 0;
    }

    /*
     * 오늘 카드로 알릴 위험을 고릅니다. 우선순위에 따라 주 종류 하나를 정하고,
     * 나머지는 상세 줄에서 함께 안내합니다.
     */
    function assessForecast(f) {
        if (!f) return null;
        var level = windLevel(f);
        var kinds = [];
        if (level === 2) kinds.push('windStop');
        else if (level === 1) kinds.push('wind');
        if (isSnowCode(f.weatherCode)) kinds.push('snow');
        if (isRainForecast(f)) kinds.push('rain');
        if (isFogCode(f.weatherCode)) kinds.push('fog');
        if (!kinds.length) return null;
        kinds.sort(function (a, b) { return KIND_RANK[b] - KIND_RANK[a]; });
        return { kind: kinds[0], kinds: kinds, windLevel: level };
    }

    /** 카드에 띄울 예보인지 — 비·눈·안개·강풍 중 하나라도 해당되면 true */
    function isWeatherAlert(f) {
        return Boolean(assessForecast(f));
    }

    /** 비·눈·안개 계열 날씨코드 → 짧은 라벨. 해당 없으면 null. */
    function weatherCodeLabel(code, locale) {
        if (typeof code !== 'number') return null;
        var ko = locale !== 'en';
        if ([51, 53, 55, 56, 57].indexOf(code) !== -1) return ko ? '이슬비' : 'Drizzle';
        if ([61, 63, 65].indexOf(code) !== -1) return ko ? '비' : 'Rain';
        if ([66, 67].indexOf(code) !== -1) return ko ? '어는비' : 'Freezing rain';
        if ([80, 81, 82].indexOf(code) !== -1) return ko ? '소나기' : 'Showers';
        if (code === 95) return ko ? '뇌우' : 'Thunderstorm';
        if (code === 96 || code === 99) return ko ? '뇌우·우박' : 'Thunderstorm w/ hail';
        if ([71, 73, 75, 77].indexOf(code) !== -1) return ko ? '눈' : 'Snow';
        if ([85, 86].indexOf(code) !== -1) return ko ? '소나기 눈' : 'Snow showers';
        if (code === 45) return ko ? '안개' : 'Fog';
        if (code === 48) return ko ? '서리 안개' : 'Rime fog';
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
            windSpeedMax: num(pick('wind_speed_10m_max')),
            windGustMax: num(pick('wind_gusts_10m_max')),
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

    /**
     * 스크롤 착지 보정 — 카드 상단이 고정 헤더·좌상단 방문자 배지 아래로 오게 합니다.
     * (scrollIntoView block:'start' 만 쓰면 y=0 에 붙어 배지가 카드 제목을 덮습니다)
     */
    function scrollUnderFixedHeader(card) {
        var offset = 0;
        try {
            var lookup = typeof document.querySelector === 'function' ? document.querySelector.bind(document) : null;
            var header = lookup ? lookup('header') : null;
            if (header && typeof header.getBoundingClientRect === 'function') {
                var headerRect = header.getBoundingClientRect();
                if (headerRect && headerRect.height > offset) offset = headerRect.height;
            }
            var badge = lookup ? lookup('.today-visitor-badge') : null;
            if (badge && typeof badge.getBoundingClientRect === 'function') {
                var badgeRect = badge.getBoundingClientRect();
                if (badgeRect && badgeRect.bottom > offset) offset = badgeRect.bottom;
            }
        } catch (e) { offset = 0; }

        try {
            if (typeof card.getBoundingClientRect === 'function' && typeof window.scrollTo === 'function') {
                var rect = card.getBoundingClientRect();
                var currentY = typeof window.pageYOffset === 'number' ? window.pageYOffset : 0;
                window.scrollTo({
                    top: Math.max(0, rect.top + currentY - offset - 8),
                    behavior: 'smooth'
                });
                return;
            }
        } catch (e) { /* 아래 scrollIntoView 로 폴백 */ }
        if (typeof card.scrollIntoView === 'function') {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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
            scrollUnderFixedHeader(card);
        } catch (e) { /* CTA 실패가 홈 렌더링에 영향을 주지 않게 합니다 */ }
    }

    function formatNumber(value, digits) {
        return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : null;
    }

    /** 날씨 사실 한 줄: 강수확률 · 강수량 · 코드 라벨 */
    function weatherDetailParts(forecast) {
        var parts = [];
        var prob = formatNumber(forecast.precipitationProbabilityMax, 0);
        var sum = formatNumber(forecast.precipitationSum, 1);
        var label = weatherCodeLabel(forecast.weatherCode, 'ko');
        if (prob !== null) parts.push(COPY.prob + ' ' + prob + '%');
        if (sum !== null) parts.push(COPY.sum + ' ' + sum + 'mm');
        if (label) parts.push(label);
        return parts;
    }

    /** 강풍 안내 한 줄: 최대 풍속 · 돌풍 · 기준 문구 */
    function windDetail(forecast, level) {
        if (!level) return '';
        var parts = [];
        var speed = formatNumber(forecast.windSpeedMax, 1);
        var gust = formatNumber(forecast.windGustMax, 1);
        if (speed !== null) parts.push(COPY.speed + ' ' + speed + 'm/s');
        if (gust !== null) parts.push(COPY.gust + ' ' + gust + 'm/s');
        parts.push(level >= 2 ? COPY.stopNote : COPY.watchNote);
        return parts.join(' · ');
    }

    function fallbackDetail(kind) {
        if (kind === 'snow') return COPY.snowFallback;
        if (kind === 'fog') return COPY.fogFallback;
        if (kind === 'wind' || kind === 'windStop') return COPY.windFallback;
        return COPY.fallback;
    }

    function buildCard(forecast) {
        var assessment = assessForecast(forecast);
        if (!assessment) return null;
        var kindCopy = KIND_COPY[assessment.kind];

        var card = el('div', 'rain-float');
        card.setAttribute('role', 'status');
        card.setAttribute('aria-live', 'polite');
        card.setAttribute('aria-label', kindCopy.aria);

        var box = el('div', 'rain-float-card');
        var head = el('div', 'rain-float-head');
        var icon = el('span', 'rain-float-icon', kindCopy.icon);
        icon.setAttribute('aria-hidden', 'true');

        var copy = el('div', 'rain-float-copy');
        copy.appendChild(el('p', 'rain-float-eyebrow', '☁️ ' + COPY.eyebrow));
        copy.appendChild(el('p', 'rain-float-title', kindCopy.title));

        var detail = weatherDetailParts(forecast).join(' · ') || fallbackDetail(assessment.kind);
        copy.appendChild(el('p', 'rain-float-detail', detail));

        var wind = windDetail(forecast, assessment.windLevel);
        if (wind) copy.appendChild(el('p', 'rain-float-wind', wind));

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
     * 예보를 조회해 오늘 알릴 날씨(비·눈·안개·강풍)가 있으면 카드를 붙입니다.
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
                var card = parsed ? buildCard(parsed) : null;
                if (!card) return null;
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
        PORT: PORT,
        FORECAST_URL: FORECAST_URL,
        TIMEOUT_MS: TIMEOUT_MS,
        COPY: COPY,
        KIND_COPY: KIND_COPY,
        RAIN_CODES: RAIN_CODES,
        SNOW_CODES: SNOW_CODES,
        FOG_CODES: FOG_CODES,
        WIND_WATCH_MS: WIND_WATCH_MS,
        WIND_STOP_MS: WIND_STOP_MS,
        kstTodayKey: kstTodayKey,
        rainFloatDismissKey: rainFloatDismissKey,
        isRainCode: isRainCode,
        isSnowCode: isSnowCode,
        isFogCode: isFogCode,
        isRainForecast: isRainForecast,
        isWeatherAlert: isWeatherAlert,
        windPeak: windPeak,
        windLevel: windLevel,
        assessForecast: assessForecast,
        weatherCodeLabel: weatherCodeLabel,
        rainCodeLabel: weatherCodeLabel,
        parseDailyForecast: parseDailyForecast,
        buildCard: buildCard,
        mountRainFloat: mountRainFloat
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { mountRainFloat(); }, { once: true });
    } else {
        mountRainFloat();
    }
})();
