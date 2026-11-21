// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/* 📢 주소 이전 안내 (2026-11-22)
   - 새 주소: https://busan-hak-port-info.luxrank.workers.dev (Cloudflare Workers)
   - 기존 주소: https://busan-hak-port-info.vercel.app (2026-12-20 일요일까지 병행 운영)
   - 기존 주소 접속자  → 상단 공지 배너 + 접속 안내 팝업 ('오늘 하루 보지 않기'까지)
   - 새 주소 접속자    → 홈 화면 추가 권장 배너만 (이전 팝업은 띄우지 않음)
   - 배너/팝업 닫기 상태는 localStorage 에 저장합니다(저장 실패 시에도 화면은 정상 동작).
*/
(function () {
    'use strict';

    var NEW_URL = 'https://busan-hak-port-info.luxrank.workers.dev/';
    var NEW_HOST = 'busan-hak-port-info.luxrank.workers.dev';
    var BAR_HIDE_KEY = 'hakportMigrationBarHideUntil';
    var POPUP_HIDE_KEY = 'hakportMigrationPopupHideUntil';
    var NEW_HOST_BAR_HIDE_MS = 30 * 24 * 60 * 60 * 1000; // 새 주소 안내 배너는 30일간 접어 둡니다.

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
    function isNewHost() {
        var host = String((window.location && window.location.hostname) || '').toLowerCase();
        return host === NEW_HOST || /\.workers\.dev$/.test(host);
    }

    function el(id) { return document.getElementById(id); }

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

    /* ── 팝업 ── */
    var lastFocused = null;

    function popupOpen() {
        var modal = el('migrationModal');
        if (!modal) return;
        lastFocused = document.activeElement;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        var primary = el('migrationGoBtn');
        if (primary && typeof primary.focus === 'function') {
            try { primary.focus({ preventScroll: true }); } catch (e) { primary.focus(); }
        }
    }

    function popupClose(saveForToday) {
        var modal = el('migrationModal');
        if (!modal) return;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        if (saveForToday) writeExpiry(POPUP_HIDE_KEY, endOfToday());
        if (lastFocused && typeof lastFocused.focus === 'function') {
            try { lastFocused.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
        }
        lastFocused = null;
    }

    function shouldSaveForToday() {
        var check = el('migrationHideToday');
        return !!(check && check.checked);
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
            if (desc) desc.textContent = '새 주소로 접속해 주세요 · 기존 계정·기록은 그대로 · 기존 주소는 12월 20일(일)까지';
            if (action) {
                action.classList.remove('is-hidden');
                action.href = NEW_URL;
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
    function bind() {
        var barClose = el('migrationBarClose');
        if (barClose) barClose.addEventListener('click', dismissBar);

        var copyButton = el('migrationCopyBtn');
        if (copyButton) copyButton.addEventListener('click', function () { copyAddress(copyButton); });

        var closeButton = el('migrationCloseBtn');
        if (closeButton) closeButton.addEventListener('click', function () { popupClose(shouldSaveForToday()); });

        var xButton = el('migrationModalClose');
        if (xButton) xButton.addEventListener('click', function () { popupClose(shouldSaveForToday()); });

        var overlay = el('migrationModal');
        if (overlay) {
            overlay.addEventListener('click', function (event) {
                if (event.target === overlay) popupClose(shouldSaveForToday());
            });
        }
        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            var modal = el('migrationModal');
            if (modal && modal.style.display === 'flex') popupClose(shouldSaveForToday());
        });
    }

    function init() {
        if (!el('migrationNoticeBar') || !el('migrationModal')) return;
        renderBar();
        bind();
        // 이미 새 주소로 들어온 근로자에게 "이전하세요" 팝업을 다시 띄우지 않습니다.
        if (isNewHost()) return;
        if (readExpiry(POPUP_HIDE_KEY) > Date.now()) return;
        window.setTimeout(popupOpen, 700);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
