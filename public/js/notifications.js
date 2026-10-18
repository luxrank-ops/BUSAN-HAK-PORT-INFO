// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
// notifications.js - 실시간 알림 및 FCM 푸시 관리
let notiUnsubscribe = null;

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

async function initMessagingPush(userId) {
    const targetUser = userId || (typeof currentWorkerId !== 'undefined' ? currentWorkerId : null);
    if (!targetUser) return;

    // ⚡ 지연 로드(A-2): 메신저 SDK가 아직 없으면 이 시점에 내려받습니다.
    if (typeof ensureFirebaseMessagingLoaded === 'function') {
        const sdkReady = await ensureFirebaseMessagingLoaded();
        if (!sdkReady) return;
    }
    if (typeof window === 'undefined' || !('Notification' in window) || typeof firebase === 'undefined' || !firebase.messaging) return;

    try {
        const messaging = firebase.messaging();
        const permissionPromise = (Notification.permission === 'granted')
            ? Promise.resolve('granted')
            : Notification.requestPermission();
        permissionPromise.then((permission) => {
                if (permission === 'granted') {
                    fetch('/api/config')
                        .then(res => (res.ok && (res.headers.get('content-type') || '').includes('application/json')) ? res.json() : null)
                        .then(config => {
                            const getTokenOptions = {};
                            if (config && config.vapidKey) getTokenOptions.vapidKey = config.vapidKey;

                            messaging.getToken(getTokenOptions)
                                .then((currentToken) => {
                                    if (currentToken && typeof db !== 'undefined' && db && db.collection) {
                                        db.collection('user_profiles').doc(targetUser).set({
                                            fcmToken: currentToken,
                                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                                        }, { merge: true });
                                    }
                                }).catch((err) => {
                                    console.log('FCM Token get error:', err);
                                });
                        }).catch(err => console.log('Config fetch error:', err));
                }
            }).catch(err => console.log('Notification permission error:', err));

            messaging.onMessage((payload) => {
                console.log('Message received: ', payload);
                if (payload && payload.notification && typeof showToast === 'function') {
                    const msg = (payload.notification.title || '') + (payload.notification.body ? ' - ' + payload.notification.body : '');
                    showToast(msg);
                }
            });
    } catch (err) {
        console.warn('FCM Push 초기화 건너뜀:', err);
    }
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
}
