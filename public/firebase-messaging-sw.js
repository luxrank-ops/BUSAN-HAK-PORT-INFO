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
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon-192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
