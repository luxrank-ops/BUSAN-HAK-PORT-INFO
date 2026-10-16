const CACHE_VERSION = "busan-hak-port-v2027.5";
// 실제로 화면에 로드되는 자산만 프리캐시합니다 (A-3).
// index.html 은 인라인 스타일·스크립트를 직접 담고 있어 css/app.css 와 js/ 모듈은
// 네트워크 요청이 발생하지 않습니다 → 매 설치마다 614KB 를 받던 낭비를 제거했습니다.
// 아이콘 512px(509KB)는 매니페스트가 필요할 때 브라우저가 요청하고, 그때 아래
// 정적 자산 캐시 규칙(cache-first + 백그라운드 갱신)이 자동으로 채웁니다.
const STATIC_PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.ico",
  "/icon-192.png",
  "/js/notifications.js"
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
