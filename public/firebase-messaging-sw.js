// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

const firebaseConfig = {
  apiKey: "AIzaSyBWFZr9TE9yybZJCJjEXSsv1YCpGkVb0kA",
  authDomain: "busan-hak-port.firebaseapp.com",
  projectId: "busan-hak-port",
  storageBucket: "busan-hak-port.firebasestorage.app",
  messagingSenderId: "616469111502",
  appId: "1:616469111502:web:6f3c94b15e444e04c7669f"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  // payload.notification 이 이미 포함된 메시지는 Firebase Messaging SDK 가 백그라운드에서
  // 자동으로 알림을 표시하므로, 중복 showNotification 호출을 방지합니다.
  // data-only 푸시일 때만 안전하게 직접 showNotification 을 호출합니다.
  if (payload && payload.notification) {
    return;
  }
  const data = (payload && payload.data) || {};
  const notificationTitle = String(data.title || '부산학 항만 작업 가이드');
  const notificationOptions = {
    body: String(data.body || data.message || '새 알림이 도착했습니다.'),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      url: String(data.url || '/'),
      type: String(data.type || '')
    }
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i += 1) {
        const client = clientList[i];
        if (client && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
