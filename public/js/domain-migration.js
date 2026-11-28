// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/* 📢 주소 이전 안내 (2026-11-28 개정)
   - 새 주소: https://busan-hak-port-info.luxrank.workers.dev (Cloudflare Workers)
   - 옛 주소: https://busan-hak-port-info.vercel.app — 2026년 12월 1일(화)부터 종료
   - 옛 주소 접속자  → 닫기가 없는 고정 안내창(✕·배경 클릭·ESC·'오늘 하루 보지 않기' 모두 없음)
                       + 상단 배너. '새 주소로 바로 이동'은 지금 보던 경로·쿼리를 그대로 넘깁니다.
   - 새 주소 접속자  → 홈 화면 추가 권장 배너만. 고정 안내창은 절대 띄우지 않습니다.
   - 그 밖의 호스트(개발용 localhost·미리보기 등) → 배너만 보여 주고 고정창은 띄우지 않습니다.
   - 배너 닫힘 상태는 localStorage 에 저장합니다(저장 실패 시에도 화면은 정상 동작).
*/
(function () {
    'use strict';

    var NEW_ORIGIN = 'https://busan-hak-port-info.luxrank.workers.dev';
    var NEW_URL = NEW_ORIGIN + '/';
    var NEW_HOST = 'busan-hak-port-info.luxrank.workers.dev';
    var BAR_HIDE_KEY = 'hakportMigrationBarHideUntil';
    var NEW_HOST_BAR_HIDE_MS = 30 * 24 * 60 * 60 * 1000; // 새 주소 안내 배너는 30일간 접어 둡니다.
    var BODY_LOCK_CLASS = 'migration-locked';
    // 닫기 없는 고정 안내창을 띄우는 '옛 주소' 호스트. 여기 없는 호스트(dev·미리보기)는 잠그지 않습니다.
    var LEGACY_HOST_PATTERNS = [
        /(^|\.)vercel\.app$/i,
        /^busan-hak-port\.web\.app$/i,
        /^busan-hak-port\.firebaseapp\.com$/i
    ];

    function readExpiry(key) {
        try { return Number(localStorage.getItem(key)) || 0; } catch (e) { return 0; }
    }
    function writeExpiry(key, until) {
        try { localStorage.setItem(key, String(until)); } catch (e) { /* 저장이 막힌 브라우저는 이번 화면에서만 적용 */ }
    }
    function endOfToday() {
        var end = new Date();
        end.setHours(23, 59, 59, 999);
        return end.getTime();
    }
    function hostName() {
        return String((window.location && window.location.hostname) || '').toLowerCase();
    }
    function isNewHost() {
        var host = hostName();
        return host === NEW_HOST || /\.workers\.dev$/.test(host);
    }
    function isLegacyHost() {
        var host = hostName();
        for (var i = 0; i < LEGACY_HOST_PATTERNS.length; i += 1) {
            if (LEGACY_HOST_PATTERNS[i].test(host)) return true;
        }
        return false;
    }

    function el(id) { return document.getElementById(id); }

    /* ── 새 주소 링크: 지금 보던 경로·쿼리·해시를 그대로 넘깁니다 ── */
    function newAddressUrl() {
        var loc = window.location || {};
        var path = String(loc.pathname || '/');
        if (path.charAt(0) !== '/') path = '/' + path;
        return NEW_ORIGIN + path + String(loc.search || '') + String(loc.hash || '');
    }

    /* ── 주소 복사 (클립보드 API → execCommand 폴백) ── */
    function legacyCopy(text) {
        try {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.top = '-1000px';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            area.setSelectionRange(0, text.length);
            var ok = document.execCommand('copy');
            document.body.removeChild(area);
            return ok;
        } catch (e) {
            return false;
        }
    }
    function copyAddress(button) {
        var label = button ? button.textContent : '';
        var restore = function (message) {
            if (!button) return;
            button.textContent = message;
            button.classList.add('is-done');
            window.setTimeout(function () {
                button.textContent = label;
                button.classList.remove('is-done');
            }, 1800);
        };
        var succeed = function () { restore('복사됨 ✓'); };
        var fail = function () { restore('복사 실패 · 길게 눌러 복사'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(NEW_URL).then(succeed, function () {
                if (legacyCopy(NEW_URL)) succeed(); else fail();
            });
        } else if (legacyCopy(NEW_URL)) {
            succeed();
        } else {
            fail();
        }
    }

    /* ── 닫기 없는 고정 안내창 (옛 주소 전용) ────────────────────────────────
       열기만 있고 닫기는 없습니다. ✕ 버튼·배경 클릭·ESC·'오늘 하루 보지 않기'
       어느 것으로도 사라지지 않으며, '새 주소로 바로 이동'을 눌러야 풀립니다. */
    function focusPrimary() {
        var primary = el('migrationGoBtn');
        if (primary && typeof primary.focus === 'function') {
            try { primary.focus({ preventScroll: true }); } catch (e) { primary.focus(); }
        }
    }

    function openLockModal() {
        var modal = el('migrationModal');
        if (!modal) return;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('is-locked');
        if (document.body && document.body.classList) document.body.classList.add(BODY_LOCK_CLASS);
        focusPrimary();
    }

    /* ── 상단 배너 ── */
    function renderBar() {
        var bar = el('migrationNoticeBar');
        if (!bar) return;
        var onNewHost = isNewHost();
        bar.classList.toggle('is-new-host', onNewHost);
        var title = el('migrationBarTitle');
        var desc = el('migrationBarDesc');
        var action = el('migrationBarAction');
        if (onNewHost) {
            if (title) title.textContent = '✅ 새 주소로 접속 중입니다';
            if (desc) desc.textContent = '크롬 ⋮ 메뉴 → 홈 화면에 추가로 앱처럼 쓰세요 · 기존 기록 그대로';
            if (action) action.classList.add('is-hidden');
        } else {
            if (title) title.textContent = '📢 학포트 주소가 이전했습니다';
            if (desc) desc.textContent = '새 주소로 접속해 주세요 · 기존 계정·기록은 그대로 · 옛 주소는 12월 1일(화) 종료';
            if (action) {
                action.classList.remove('is-hidden');
                action.href = newAddressUrl();
            }
        }
        if (readExpiry(BAR_HIDE_KEY) > Date.now()) {
            bar.classList.add('is-hidden');
        } else {
            bar.classList.remove('is-hidden');
        }
    }

    function dismissBar() {
        var bar = el('migrationNoticeBar');
        if (bar) bar.classList.add('is-hidden');
        writeExpiry(BAR_HIDE_KEY, isNewHost() ? Date.now() + NEW_HOST_BAR_HIDE_MS : endOfToday());
    }

    /* ── 초기화 ── */
    function bindBar() {
        var barClose = el('migrationBarClose');
        if (barClose) barClose.addEventListener('click', dismissBar);
        var copyButton = el('migrationCopyBtn');
        if (copyButton) copyButton.addEventListener('click', function () { copyAddress(copyButton); });
    }

    /* 키보드로 뒤 화면에 빠져나가지 않도록 고정창 안에 머무르게 합니다. */
    function keepFocusInside(event) {
        var modal = el('migrationModal');
        if (!modal || !modal.classList.contains('is-locked')) return;
        if (!event.target || !modal.contains) return;
        if (modal.contains(event.target)) return;
        focusPrimary();
    }

    function init() {
        if (!el('migrationNoticeBar') || !el('migrationModal')) return;
        renderBar();
        bindBar();
        var modal = el('migrationModal');
        // 새 주소·그 밖의 호스트에서는 고정 안내창을 절대 띄우지 않습니다.
        if (isNewHost() || !isLegacyHost()) {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            modal.classList.remove('is-locked');
            if (document.body && document.body.classList) document.body.classList.remove(BODY_LOCK_CLASS);
            return;
        }
        var goButton = el('migrationGoBtn');
        if (goButton) goButton.href = newAddressUrl();
        openLockModal();
        document.addEventListener('focusin', keepFocusInside);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
