(function (root) {
  'use strict';

  var CONSENT_KEY = 'busanHakPort.analytics';
  var LEGACY_CONSENT_KEY = 'maeumjeongwon.analytics';
  var ALLOWED_KEYS = { page: true, item: true, feature: true, method: true };
  var VALUE_RE = /^[a-z0-9_-]{1,40}$/i;
  var gaLoaded = false;
  var staticPageTracked = false;

  function gaId() {
    var fromConfig = (root.MJ_CONFIG && root.MJ_CONFIG.gaId) || (root.PORT_CONFIG && root.PORT_CONFIG.gaId);
    if (fromConfig) return String(fromConfig).trim();
    var meta = root.document && root.document.querySelector && root.document.querySelector('meta[name="mj-ga-id"]');
    return (meta && meta.getAttribute('content') || '').trim();
  }

  function isNative() {
    return Boolean(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform());
  }

  function pageInfo() {
    var b = root.document && root.document.body;
    if (!b || !b.getAttribute) return null;
    var page = b.getAttribute('data-mj-page');
    if (!page) return null;
    return { page: page, item: b.getAttribute('data-mj-item') || '' };
  }

  function readConsent() {
    try {
      var raw = root.localStorage.getItem(CONSENT_KEY);
      if (raw === null) raw = root.localStorage.getItem(LEGACY_CONSENT_KEY);
      if (raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
    } catch (e) {}
    return null;
  }

  function writeConsent(v) {
    try {
      var val = v === true ? 'true' : 'false';
      root.localStorage.setItem(CONSENT_KEY, val);
      root.localStorage.setItem(LEGACY_CONSENT_KEY, val);
    } catch (e) {}
  }

  function canLoad(opts) {
    if (!opts || opts.consent !== true) return false;
    if (opts.native) return false;
    var id = String(opts.gaId || '').trim();
    return /^G-[A-Z0-9]{4,}$/.test(id);
  }

  function sanitize(params) {
    var clean = {};
    if (!params || typeof params !== 'object') return clean;
    Object.keys(params).forEach(function (k) {
      if (!ALLOWED_KEYS[k]) return;
      var val = String(params[k] || '').trim();
      if (VALUE_RE.test(val)) {
        clean[k] = val;
      }
    });
    return clean;
  }

  function loadGA(id) {
    if (!id || gaLoaded || !root.document) return;
    gaLoaded = true;
    root.dataLayer = root.dataLayer || [];
    root.gtag = root.gtag || function () {
      root.dataLayer.push(arguments);
    };
    root.gtag('js', new Date());
    root.gtag('config', id, {
      anonymize_ip: true,
      send_page_view: false
    });

    if (!root.document.querySelector('script[data-mj-gtag]')) {
      var s = root.document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
      s.setAttribute('data-mj-gtag', id);
      if (root.document.head) {
        root.document.head.appendChild(s);
      }
    }
  }

  function track(eventName, params) {
    if (readConsent() !== true) return;
    var id = gaId();
    if (!canLoad({ consent: true, gaId: id, native: isNative() })) return;
    if (!gaLoaded) loadGA(id);
    if (typeof root.gtag === 'function') {
      root.gtag('event', String(eventName || 'event'), sanitize(params));
    }
  }

  function trackStaticPage() {
    if (staticPageTracked) return;
    if (readConsent() !== true) return;
    var info = pageInfo();
    if (!info) return;
    staticPageTracked = true;
    track('page_view', info);
  }

  function hideBanner() {
    if (!root.document) return;
    var el = root.document.getElementById('mjConsentBanner');
    if (el) el.style.display = 'none';
  }

  function showBanner() {
    if (!root.document || !root.document.body) return;
    var el = root.document.getElementById('mjConsentBanner');
    if (!el) {
      el = root.document.createElement('div');
      el.id = 'mjConsentBanner';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', '분석 쿠키 동의 설정');
      el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:max(76px,env(safe-area-inset-bottom)+66px);max-width:560px;margin:0 auto;background:#0f172a;color:#f8fafc;border:1.5px solid #3b82f6;border-radius:12px;padding:12px 14px;z-index:4500;box-shadow:0 8px 24px rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:0.82rem;font-weight:700;';
      el.innerHTML =
        '<div style="flex:1 1 220px;line-height:1.45;">📊 서비스 품질 개선을 위해 익명 방문·이용 통계(GA4) 분석을 사용합니다. 동의하시나요?</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button type="button" data-mj-consent="accept" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:0.78rem;font-weight:900;cursor:pointer;">허용</button>' +
          '<button type="button" data-mj-consent="reject" style="background:#334155;color:#cbd5e1;border:1px solid #475569;border-radius:8px;padding:7px 12px;font-size:0.78rem;font-weight:800;cursor:pointer;">허용 안 함</button>' +
        '</div>';
      root.document.body.appendChild(el);

      el.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest && ev.target.closest('[data-mj-consent]');
        if (!btn) return;
        var action = btn.getAttribute('data-mj-consent');
        setConsent(action === 'accept');
        hideBanner();
      });
    } else {
      el.style.display = 'flex';
    }
  }

  function bindStaticUi() {
    if (!root.document) return;
    var links = root.document.querySelectorAll('[data-mj-consent-open]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('data-mj-bound') === '1') continue;
      links[i].setAttribute('data-mj-bound', '1');
      links[i].addEventListener('click', function (ev) {
        ev.preventDefault();
        showBanner();
      });
    }
  }

  function setConsent(v) {
    writeConsent(v);
    if (v === true && canLoad({ consent: true, gaId: gaId(), native: isNative() })) {
      loadGA(gaId());
      trackStaticPage();
    }
  }

  function init() {
    var consent = readConsent();
    if (canLoad({ consent: consent === true, gaId: gaId(), native: isNative() })) loadGA(gaId());
    if (!root.document || !root.document.body) return;
    trackStaticPage();
    bindStaticUi();
    if (pageInfo()) {
      if (consent === null && gaId() && !isNative()) showBanner();
    }
  }

  var api = {
    gaId: gaId,
    pageInfo: pageInfo,
    readConsent: readConsent,
    writeConsent: writeConsent,
    setConsent: setConsent,
    canLoad: canLoad,
    sanitize: sanitize,
    loadGA: loadGA,
    track: track,
    trackStaticPage: trackStaticPage,
    showBanner: showBanner,
    hideBanner: hideBanner,
    init: init
  };

  root.MJAnalytics = api;
  root.PortAnalytics = api;

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
