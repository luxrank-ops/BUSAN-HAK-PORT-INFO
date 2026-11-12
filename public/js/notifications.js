// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
// notifications.js - 실시간 알림 및 FCM 푸시 관리
let notiUnsubscribe = null;
let fcmInitPromise = null;
let fcmServiceWorkerRegistrationPromise = null;
let fcmMessagingInstance = null;
let fcmForegroundListenerAttached = false;
let fcmRegisteredUserId = "";
let fcmTokenOptions = null;

function escapeNotificationHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toggleNotificationPanel() {
    let panel = document.getElementById('notiPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'notiPanel';
        panel.style.cssText = [
            'position: fixed',
            'top: 60px',
            'right: 10px',
            'width: 300px',
            'max-height: 400px',
            'background: var(--surface)',
            'border: 1px solid var(--border)',
            'border-radius: 8px',
            'box-shadow: 0 4px 12px rgba(0,0,0,0.15)',
            'z-index: 9999',
            'overflow-y: auto',
            'display: none',
            'padding: 10px',
            'color: var(--text)'
        ].join('; ') + ';';

        const header = document.createElement('div');
        header.innerHTML = '<h3 style="margin:0 0 10px 0; border-bottom:1px solid var(--border); padding-bottom:5px;">알림 센터</h3>';
        panel.appendChild(header);

        const list = document.createElement('div');
        list.id = 'notiList';
        list.innerHTML = '<p style="color:var(--text-secondary); text-align:center; font-size:0.9rem;">알림이 없습니다.</p>';
        panel.appendChild(list);

        document.body.appendChild(panel);
    }

    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        markAllNotisAsRead();
        // ⚡ 지연 로드(A-2): 알림 패널을 여는 시점에 메신저 SDK를 준비합니다.
        if (typeof initMessagingPush === 'function') initMessagingPush();
    } else {
        panel.style.display = 'none';
    }
}

function reportNotificationFailure(scope, error, message) {
    try { console.warn(`[알림] ${scope}:`, error); } catch (_) {}
    if (typeof reportFailure === 'function') {
        reportFailure(scope, error, message);
    } else if (message && typeof showToast === 'function') {
        showToast(message);
    }
}

/**
 * 앱 셸 서비스 워커와 FCM 워커가 같은 루트 범위를 서로 덮어쓰지 않도록 분리합니다.
 * Firebase Messaging에는 명시적으로 이 등록 정보를 넘겨야 백그라운드 푸시를 안정적으로 받습니다.
 */
async function registerFcmServiceWorker() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return null;
    if (fcmServiceWorkerRegistrationPromise) return fcmServiceWorkerRegistrationPromise;
    const scope = '/firebase-cloud-messaging-push-scope';
    fcmServiceWorkerRegistrationPromise = (async () => {
        const existing = typeof navigator.serviceWorker.getRegistration === 'function'
            ? await navigator.serviceWorker.getRegistration(scope)
            : null;
        return existing || navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope });
    })().catch((error) => {
        fcmServiceWorkerRegistrationPromise = null;
        throw error;
    });
    return fcmServiceWorkerRegistrationPromise;
}

async function saveFcmToken(userId, token) {
    if (!token || typeof db === 'undefined' || !db || !db.collection) return false;
    await db.collection('user_profiles').doc(userId).set({
        fcmToken: token,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
}

function attachForegroundMessageHandler(messaging) {
    if (fcmForegroundListenerAttached || !messaging || typeof messaging.onMessage !== 'function') return;
    fcmForegroundListenerAttached = true;
    messaging.onMessage((payload) => {
        console.log('Message received: ', payload);
        const notification = payload?.notification || payload?.data || {};
        if (typeof showToast === 'function') {
            const title = String(notification.title || '새 알림');
            const body = String(notification.body || '');
            showToast(body ? `${title} - ${body}` : title);
        }
    });
}

async function initMessagingPush(userId) {
    const targetUser = userId || (typeof currentWorkerId !== 'undefined' ? currentWorkerId : null);
    if (!targetUser) return false;
    if (fcmRegisteredUserId === targetUser && fcmMessagingInstance) return true;
    if (fcmInitPromise) return fcmInitPromise;

    fcmInitPromise = (async () => {
        // ⚡ 지연 로드(A-2): 메신저 SDK가 아직 없으면 이 시점에 내려받습니다.
        if (typeof ensureFirebaseMessagingLoaded === 'function') {
            const sdkReady = await ensureFirebaseMessagingLoaded();
            if (!sdkReady) throw new Error('firebase-messaging SDK를 불러오지 못했습니다.');
        }
        if (typeof window === 'undefined' || !('Notification' in window) || typeof firebase === 'undefined' || !firebase.messaging) {
            throw new Error('이 브라우저는 웹 푸시 알림을 지원하지 않습니다.');
        }

        const permission = Notification.permission === 'granted'
            ? 'granted'
            : await Notification.requestPermission();
        if (permission !== 'granted') return false;

        const [config, registration] = await Promise.all([
            fetch('/api/config').then((res) => (
                res.ok && (res.headers.get('content-type') || '').includes('application/json')
                    ? res.json()
                    : null
            )),
            registerFcmServiceWorker()
        ]);
        if (!config?.vapidKey) throw new Error('서버의 Web Push VAPID 키가 설정되지 않았습니다.');
        if (!registration) throw new Error('FCM 서비스 워커를 등록하지 못했습니다.');

        const messaging = firebase.messaging();
        const getTokenOptions = {
            vapidKey: config.vapidKey,
            serviceWorkerRegistration: registration
        };
        const currentToken = await messaging.getToken(getTokenOptions);
        if (!currentToken) throw new Error('FCM 등록 토큰을 받지 못했습니다.');
        await saveFcmToken(targetUser, currentToken);

        fcmMessagingInstance = messaging;
        fcmRegisteredUserId = targetUser;
        fcmTokenOptions = getTokenOptions;
        attachForegroundMessageHandler(messaging);
        if (typeof messaging.onTokenRefresh === 'function') {
            messaging.onTokenRefresh(async () => {
                try {
                    const refreshedToken = await messaging.getToken(fcmTokenOptions || getTokenOptions);
                    if (refreshedToken && fcmRegisteredUserId) await saveFcmToken(fcmRegisteredUserId, refreshedToken);
                } catch (error) {
                    reportNotificationFailure('FCM 토큰 갱신 실패', error, '⚠️ 알림 등록을 갱신하지 못했습니다. 알림 버튼을 다시 눌러 주세요.');
                }
            });
        }
        return true;
    })().catch((error) => {
        reportNotificationFailure('FCM 푸시 초기화 실패', error, '⚠️ 푸시 알림을 준비하지 못했습니다. 브라우저 알림 권한과 네트워크를 확인해 주세요.');
        return false;
    }).finally(() => {
        fcmInitPromise = null;
    });
    return fcmInitPromise;
}

function initNotifications(userId) {
    if (!userId) return;

    // 2. Firestore In-App Notification 리스너 등록
    if (typeof db === 'undefined' || !db || !db.collection) return;
    if (notiUnsubscribe) {
        try { notiUnsubscribe(); } catch (_) {}
    }
    try {
        notiUnsubscribe = db.collection('notifications')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .onSnapshot((snapshot) => {
                let unreadCount = 0;
                let html = '';

                if (snapshot.empty) {
                    html = '<p style="color:var(--text-secondary); text-align:center; font-size:0.9rem; padding: 10px 0;">알림이 없습니다.</p>';
                } else {
                    snapshot.forEach(doc => {
                        const data = doc.data() || {};
                        if (!data.read) unreadCount++;
                        const bg = data.read ? 'transparent' : 'rgba(37, 99, 235, 0.1)';
                        const safeTitle = escapeNotificationHtml(data.title || '알림');
                        const safeBody = escapeNotificationHtml(data.body || '');
                        html += `
                            <div style="padding: 10px; border-bottom: 1px solid var(--border); background: ${bg}; border-radius: 4px; margin-bottom: 5px;">
                                <div style="font-weight:bold; font-size:0.95rem; margin-bottom:4px;">${safeTitle}</div>
                                <div style="font-size:0.85rem; color:var(--text-secondary);">${safeBody}</div>
                            </div>
                        `;
                    });
                }

                const listEl = document.getElementById('notiList');
                if (listEl) listEl.innerHTML = html;

                const badge = document.getElementById('notiBadge');
                if (badge) {
                    if (unreadCount > 0) {
                        badge.style.display = 'inline-block';
                        badge.innerText = String(unreadCount);
                    } else {
                        badge.style.display = 'none';
                    }
                }
            }, (err) => {
                console.warn('알림 리스너 오류:', err);
            });
    } catch (e) {
        console.warn('알림 구독 설정 실패:', e);
    }
}

function stopNotifications() {
    if (notiUnsubscribe) {
        try { notiUnsubscribe(); } catch (_) {}
        notiUnsubscribe = null;
    }
    // 다음 로그인은 토큰을 해당 계정에 다시 연결해야 합니다.
    fcmRegisteredUserId = "";
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('notiBadge');
    if (badge) badge.style.display = 'none';
    const list = document.getElementById('notiList');
    if (list) list.innerHTML = '<p style="color:var(--text-secondary); text-align:center; font-size:0.9rem; padding: 10px 0;">로그인 후 알림을 확인할 수 있습니다.</p>';
}

function markAllNotisAsRead() {
    if (typeof currentWorkerId === 'undefined' || !currentWorkerId || typeof db === 'undefined' || !db || !db.collection) return;
    const readTimestamp = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue)
        ? firebase.firestore.FieldValue.serverTimestamp()
        : new Date();
    db.collection('notifications')
        .where('userId', '==', currentWorkerId)
        .where('read', '==', false)
        .get()
        .then(snapshot => {
            if (snapshot.empty) return;
            const batch = db.batch();
            snapshot.forEach(doc => {
                batch.update(doc.ref, {
                    read: true,
                    readAt: readTimestamp
                });
            });
            return batch.commit();
        })
        .catch(err => console.warn('알림 읽기 조회/갱신 실패:', err));
}

if (typeof window !== 'undefined') {
    window.toggleNotificationPanel = toggleNotificationPanel;
    window.initNotifications = initNotifications;
    window.initMessagingPush = initMessagingPush;
    window.markAllNotisAsRead = markAllNotisAsRead;
    window.stopNotifications = stopNotifications;
}
