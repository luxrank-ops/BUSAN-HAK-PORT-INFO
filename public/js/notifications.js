// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
// notifications.js - 실시간 알림 및 FCM 푸시 관리
let notiUnsubscribe = null;
let notiActiveUserId = "";
let notiInitialSnapshotLoaded = false;
let notiAnnouncedIds = new Set();
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

function notificationTypeLabel(type) {
    const labels = {
        SCHEDULE_CHANGE: "운항 시간 변경",
        AUTO_BLIND: "운영 알림"
    };
    return labels[String(type || "")] || "새 알림";
}

function notificationTimeLabel(value) {
    let date = null;
    if (value?.toDate) date = value.toDate();
    else if (value instanceof Date) date = value;
    else if (typeof value === "number") date = new Date(value);
    else if (typeof value === "string" && value) date = new Date(value);
    if (!date || Number.isNaN(date.getTime())) return "방금 도착";

    const elapsed = Math.max(0, Date.now() - date.getTime());
    if (elapsed < 60_000) return "방금 도착";
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
    const today = new Date();
    const sameDay = date.getFullYear() === today.getFullYear()
        && date.getMonth() === today.getMonth()
        && date.getDate() === today.getDate();
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return sameDay ? `오늘 ${time}` : `${date.getMonth() + 1}.${date.getDate()} ${time}`;
}

function notificationPanelIsOpen() {
    return Boolean(document.getElementById('notiPanel')?.classList.contains('is-open'));
}

function updateNotificationToggle(open) {
    const toggle = document.getElementById('notiToggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? '알림 센터 닫기' : '알림 센터 열기');
}

function ensureNotificationPanel() {
    let panel = document.getElementById('notiPanel');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = 'notiPanel';
    panel.className = 'noti-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'notiPanelTitle');
    panel.innerHTML = `
        <div class="noti-panel-head">
            <div class="noti-panel-title-wrap">
                <span class="noti-panel-icon" aria-hidden="true">🔔</span>
                <div>
                    <h2 id="notiPanelTitle">알림 센터</h2>
                    <p>내 근무와 운영 소식을 바로 알려드립니다.</p>
                </div>
            </div>
            <button type="button" class="noti-panel-close" onclick="closeNotificationPanel()" aria-label="알림 창 닫기">✕</button>
        </div>
        <div class="noti-panel-summary">
            <span id="notiPanelUnread" class="noti-panel-unread">새 알림 없음</span>
            <span class="noti-panel-summary-hint">열면 읽음으로 표시됩니다.</span>
        </div>
        <div id="notiList" class="noti-list" aria-live="polite">
            <div class="noti-empty-state"><span aria-hidden="true">✨</span><strong>도착한 알림이 없습니다.</strong><p>새 소식이 생기면 이 창으로 바로 알려드릴게요.</p></div>
        </div>`;
    document.body.appendChild(panel);
    return panel;
}

function openNotificationPanel(options = {}) {
    const panel = ensureNotificationPanel();
    panel.classList.add('is-open');
    updateNotificationToggle(true);
    if (options.markRead !== false) markAllNotisAsRead();
    if (options.prepareMessaging && typeof initMessagingPush === 'function') initMessagingPush();
    return panel;
}

function closeNotificationPanel() {
    const panel = document.getElementById('notiPanel');
    if (panel) panel.classList.remove('is-open');
    updateNotificationToggle(false);
}

function toggleNotificationPanel() {
    if (notificationPanelIsOpen()) {
        closeNotificationPanel();
        return;
    }
    // ⚡ 지연 로드(A-2): 사용자가 알림 버튼을 열 때만 메신저 SDK를 준비합니다.
    openNotificationPanel({ markRead: true, prepareMessaging: true });
}

function renderNotificationRows(snapshot) {
    let unreadCount = 0;
    let html = '';
    if (snapshot.empty) {
        html = '<div class="noti-empty-state"><span aria-hidden="true">✨</span><strong>도착한 알림이 없습니다.</strong><p>새 소식이 생기면 이 창으로 바로 알려드릴게요.</p></div>';
    } else {
        snapshot.forEach((doc) => {
            const data = doc.data() || {};
            const isUnread = !data.read;
            if (isUnread) unreadCount += 1;
            const safeTitle = escapeNotificationHtml(data.title || '알림');
            const safeBody = escapeNotificationHtml(data.body || '내용이 없습니다.');
            const safeType = escapeNotificationHtml(notificationTypeLabel(data.type));
            const timeLabel = escapeNotificationHtml(notificationTimeLabel(data.createdAt || data.createdAtMs));
            html += `
                <article class="noti-item${isUnread ? ' is-unread' : ''}">
                    <span class="noti-item-dot" aria-hidden="true"></span>
                    <div class="noti-item-content">
                        <div class="noti-item-meta"><span class="noti-item-type">${safeType}</span><time>${timeLabel}</time></div>
                        <h3>${safeTitle}</h3>
                        <p>${safeBody}</p>
                    </div>
                </article>`;
        });
    }

    const list = document.getElementById('notiList');
    if (list) list.innerHTML = html;
    const badge = document.getElementById('notiBadge');
    if (badge) {
        badge.classList.toggle('has-unread', unreadCount > 0);
        badge.hidden = unreadCount === 0;
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    }
    const summary = document.getElementById('notiPanelUnread');
    if (summary) summary.textContent = unreadCount > 0 ? `새 알림 ${unreadCount}개` : '새 알림 없음';
    return unreadCount;
}

function showIncomingNotification(data) {
    const title = String(data?.title || '새 알림');
    const body = String(data?.body || '알림 센터에서 내용을 확인해 주세요.');
    openNotificationPanel({ markRead: true });
    if (typeof showToast === 'function') showToast(`🔔 ${title}${body ? ` · ${body}` : ''}`);
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
        showIncomingNotification(notification);
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
    if (typeof db === 'undefined' || !db || !db.collection) return;
    if (notiUnsubscribe) {
        try { notiUnsubscribe(); } catch (_) {}
    }
    notiActiveUserId = String(userId);
    notiInitialSnapshotLoaded = false;
    notiAnnouncedIds = new Set();

    try {
        notiUnsubscribe = db.collection('notifications')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .onSnapshot((snapshot) => {
                const isInitialSnapshot = !notiInitialSnapshotLoaded;
                const additions = !isInitialSnapshot && typeof snapshot.docChanges === 'function'
                    ? snapshot.docChanges().filter((change) => change.type === 'added')
                    : [];
                renderNotificationRows(snapshot);
                notiInitialSnapshotLoaded = true;

                additions.forEach((change) => {
                    const id = String(change.doc?.id || '');
                    if (id && notiAnnouncedIds.has(id)) return;
                    if (id) notiAnnouncedIds.add(id);
                    showIncomingNotification(change.doc?.data?.() || {});
                });
            }, (error) => {
                reportNotificationFailure('알림 센터 연결 실패', error, '⚠️ 알림 센터를 실시간으로 연결하지 못했습니다.');
            });
    } catch (error) {
        reportNotificationFailure('알림 구독 설정 실패', error, '⚠️ 알림 센터를 준비하지 못했습니다.');
    }
}

function stopNotifications() {
    if (notiUnsubscribe) {
        try { notiUnsubscribe(); } catch (_) {}
        notiUnsubscribe = null;
    }
    notiActiveUserId = "";
    notiInitialSnapshotLoaded = false;
    notiAnnouncedIds = new Set();
    // 다음 로그인은 토큰을 해당 계정에 다시 연결해야 합니다.
    fcmRegisteredUserId = "";
    if (typeof document === 'undefined') return;
    closeNotificationPanel();
    const badge = document.getElementById('notiBadge');
    if (badge) {
        badge.hidden = true;
        badge.classList.remove('has-unread');
    }
    const list = document.getElementById('notiList');
    if (list) list.innerHTML = '<div class="noti-empty-state"><span aria-hidden="true">🔒</span><strong>로그인 후 알림을 확인할 수 있습니다.</strong></div>';
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
        .then((snapshot) => {
            if (snapshot.empty) return;
            const batch = db.batch();
            snapshot.forEach((doc) => {
                batch.update(doc.ref, {
                    read: true,
                    readAt: readTimestamp
                });
            });
            return batch.commit();
        })
        .catch((error) => console.warn('알림 읽기 조회/갱신 실패:', error));
}

if (typeof window !== 'undefined') {
    window.toggleNotificationPanel = toggleNotificationPanel;
    window.openNotificationPanel = openNotificationPanel;
    window.closeNotificationPanel = closeNotificationPanel;
    window.initNotifications = initNotifications;
    window.initMessagingPush = initMessagingPush;
    window.markAllNotisAsRead = markAllNotisAsRead;
    window.stopNotifications = stopNotifications;
    window.addEventListener?.('keydown', (event) => {
        if (event.key === 'Escape' && notificationPanelIsOpen()) closeNotificationPanel();
    });
}
