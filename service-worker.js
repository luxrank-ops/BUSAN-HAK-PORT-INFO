const CACHE_NAME = "hak-port-cache-v1";

const ASSETS = [
  "/BUSAN-HAK-PORT-INFO/",
  "/BUSAN-HAK-PORT-INFO/index.html",
  "/BUSAN-HAK-PORT-INFO/manifest.json",
  "/BUSAN-HAK-PORT-INFO/icons/icon-192.png",
  "/BUSAN-HAK-PORT-INFO/icons/icon-512.png"
];

// 설치 단계
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

// 요청 가로채기
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});

