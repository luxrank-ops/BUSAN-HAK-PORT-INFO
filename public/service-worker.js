// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
const CACHE_VERSION = "busan-hak-port-v2027.7";
// 실제로 화면에 로드되는 자산만 프리캐시합니다 (A-3).
// A-1 (2026-10-17): index.html 의 인라인 스타일·스크립트를 외부 파일(css/app.css + js/*) 로
// 분리했습니다. ?v= 버전 쿼리와 server.ts 의 immutable 헤더가 함께 작용해 변경이 없으면
// 재다운로드가 없고, 버전이 바뀌면 아래 프리캐시 목록이 갱신됩니다.
// 프리캐시 경로가 HTML 이 참조하는 ?v= 값과 1:1 로 일치해야 합니다.
// (scripts/app-split.test.mjs 가 검증합니다.)
// 아이콘 512px(509KB)는 매니페스트가 필요할 때 브라우저가 요청하고, 그때 아래
// 정적 자산 캐시 규칙(cache-first + 백그라운드 갱신)이 자동으로 채웁니다.
const STATIC_PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.ico",
  "/icon-192.png",
  "/css/app.css?v=2027.7",
  "/js/notifications.js?v=2027.7",
  "/js/app.js?v=2027.7",
  "/js/leader-access.js?v=2027.7",
  "/js/ships-board.js?v=2027.7",
  "/js/tab-views.js?v=2027.7"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await Promise.allSettled(
        STATIC_PRECACHE_ASSETS.map((url) =>
          fetch(url, { cache: "reload" }).then((res) => {
            if (res && res.ok) return cache.put(url, res);
          })
        )
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Skip Firestore / Auth / Storage / Google AdSense / Weather API dynamic endpoints
  if (
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("identitytoolkit.googleapis.com") ||
    url.hostname.includes("securetoken.googleapis.com") ||
    url.hostname.includes("firebasestorage.googleapis.com") ||
    url.hostname.includes("googlesyndication.com") ||
    url.hostname.includes("doubleclick.net") ||
    url.hostname.includes("open-meteo.com")
  ) {
    return;
  }

  // 1) Navigation requests (HTML): Network-First with Offline Cache Fallback
  if (req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(req, copy);
              if (url.pathname === "/" || url.pathname === "/index.html") {
                cache.put("/index.html", copy.clone());
              }
            });
          }
          return networkRes;
        })
        .catch(async () => {
          const cached =
            (await caches.match(req)) ||
            (await caches.match("/index.html")) ||
            (await caches.match("/"));
          return cached || Response.error();
        })
    );
    return;
  }

  // 2) Same-origin static assets (CSS, JS, images, manifest) & CDN static libs (Firebase SDK, Pretendard, D3):
  // Cache-First with background Stale-While-Revalidate update
  const isSameOriginStatic =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/css/") ||
      url.pathname.startsWith("/js/") ||
      /\.(css|js|png|jpg|jpeg|gif|ico|svg|webp|json)$/i.test(url.pathname));

  const isTrustedStaticCdn =
    url.hostname === "www.gstatic.com" ||
    url.hostname === "cdn.jsdelivr.net";

  if (isSameOriginStatic || isTrustedStaticCdn) {
    event.respondWith(
      caches.match(req).then((cachedRes) => {
        const fetchPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes && (networkRes.ok || networkRes.type === "opaque")) {
              const copy = networkRes.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
            }
            return networkRes;
          })
          .catch(() => cachedRes);

        return cachedRes || fetchPromise;
      })
    );
  }
});
