const CACHE_NAME = 'busan-hak-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// 설치 단계: 리소스 캐싱
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// 데이터 요청 시 캐시 우선 전략
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});