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
let notiSubscriptionVersion = 0;
// 알림 창은 처음 열 때 만들어지므로, 그 전에 받은 최신 스냅샷을 보관했다가 창 생성 즉시 그려 줍니다.
let notiLastSnapshot = null;
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
        SCHEDULE_CHANGE: "선박 일정 변경",
        OPERATIONAL_NOTICE: "안전·운영 공지",
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
                    <p>선박 일정 변경과 안전·운영 소식을 알려드립니다.</p>
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
    if (notiLastSnapshot) renderNotificationRows(notiLastSnapshot);
    return panel;
}

/**
 * 🔔 종 배지: 알림 센터에 들어 있는 알림 개수(읽음 포함)를 항상 숫자로 보여 줍니다.
 * - 안 읽은 알림이 하나라도 있으면 빨간색 + 깜빡임(has-unread)
 * - 모두 읽었으면 회색 숫자(is-read)로 남겨 "알림 내용이 있다"는 것만 알려 줍니다.
 * - 알림이 하나도 없을 때만 배지를 숨깁니다.
 * @param {number} totalCount 알림 센터에 보이는 알림 수
 * @param {number} unreadCount 그중 안 읽은 알림 수
 * @param {boolean} [hasMore] 화면 표시 한도(20건)를 넘는 알림이 더 있는지
 */
function updateNotificationBadge(totalCount, unreadCount, hasMore = false) {
    const total = Math.max(0, Number(totalCount) || 0);
    const unread = Math.min(total, Math.max(0, Number(unreadCount) || 0));
    const label = hasMore ? `${total}+` : (total > 99 ? '99+' : String(total));
    const badge = document.getElementById('notiBadge');
    if (badge) {
        badge.hidden = total === 0;
        badge.textContent = label;
        badge.classList.toggle('has-unread', unread > 0);
        badge.classList.toggle('is-read', total > 0 && unread === 0);
    }
    const toggle = document.getElementById('notiToggle');
    if (toggle && typeof toggle.setAttribute === 'function') {
        const title = total === 0
            ? '알림 센터'
            : `알림 센터 · 알림 ${label}개${unread > 0 ? ` (새 알림 ${unread}개)` : ''}`;
        toggle.setAttribute('title', title);
    }
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

function notificationCreatedAtMs(data) {
    const value = data?.createdAt || data?.createdAtMs;
    if (value?.toMillis) return Number(value.toMillis()) || 0;
    if (value?.toDate) return value.toDate().getTime() || 0;
    if (value instanceof Date) return value.getTime() || 0;
    if (typeof value === 'number') return value;
    const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
}

const NOTIFICATION_VISIBLE_LIMIT = 20;

function allNotificationDocs(snapshot) {
    const docs = [];
    snapshot?.forEach?.((doc) => docs.push(doc));
    return docs;
}

function visibleNotificationDocs(snapshot) {
    const docs = allNotificationDocs(snapshot);
    // 복합 인덱스가 아직 만들어지는 동안의 대체 조회도 화면에서는 최신 20건처럼 보입니다.
    return docs.sort((left, right) => {
        const diff = notificationCreatedAtMs(right?.data?.()) - notificationCreatedAtMs(left?.data?.());
        return diff || String(right?.id || '').localeCompare(String(left?.id || ''));
    }).slice(0, NOTIFICATION_VISIBLE_LIMIT);
}

function renderNotificationRows(snapshot) {
    let unreadCount = 0;
    let html = '';
    const docs = visibleNotificationDocs(snapshot);
    // 복합 색인 대체 조회(제한 없음)일 때만 20건을 넘는 알림이 더 있는지 알 수 있습니다.
    const hasMore = allNotificationDocs(snapshot).length > docs.length;
    if (!docs.length) {
        html = '<div class="noti-empty-state"><span aria-hidden="true">✨</span><strong>도착한 알림이 없습니다.</strong><p>새 소식이 생기면 이 창으로 바로 알려드릴게요.</p></div>';
    } else {
        docs.forEach((doc) => {
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
    updateNotificationBadge(docs.length, unreadCount, hasMore);
    const summary = document.getElementById('notiPanelUnread');
    if (summary) {
        const totalLabel = `알림 ${docs.length}${hasMore ? '+' : ''}개`;
        summary.textContent = !docs.length
            ? '새 알림 없음'
            : (unreadCount > 0 ? `${totalLabel} · 새 알림 ${unreadCount}개` : `${totalLabel} · 모두 확인함`);
    }
    return unreadCount;
}

function showIncomingNotification(data) {
    const title = String(data?.title || '새 알림');
    const body = String(data?.body || '알림 센터에서 내용을 확인해 주세요.');
    // 자동으로 패널을 띄우거나 토스트를 보여주는 것만으로는 사용자가 알림을 확인한 것이 아닙니다.
    // 사용자가 직접 열었거나 이미 패널을 보고 있을 때에만 미확인 알림을 읽음 처리합니다.
    const panelWasAlreadyOpen = notificationPanelIsOpen();
    openNotificationPanel({ markRead: panelWasAlreadyOpen });
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

function notificationNeedsIndexFallback(error) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return code === 'failed-precondition' || /index/.test(message);
}

function subscribeToNotifications(userId, version, useFallbackQuery) {
    if (version !== notiSubscriptionVersion || String(userId) !== notiActiveUserId) return;
    try {
        let query = db.collection('notifications').where('userId', '==', userId);
        // userId + createdAt 복합 인덱스가 배포되기 전에도 알림 창이 끊기지 않도록,
        // 실패 시에는 userId 단일 조건으로 실시간 구독 후 브라우저에서 최신 순으로 정렬합니다.
        if (!useFallbackQuery) query = query.orderBy('createdAt', 'desc').limit(20);
        const unsubscribe = query.onSnapshot((snapshot) => {
            if (version !== notiSubscriptionVersion || String(userId) !== notiActiveUserId) return;
            const isInitialSnapshot = !notiInitialSnapshotLoaded;
            const additions = !isInitialSnapshot && typeof snapshot.docChanges === 'function'
                ? snapshot.docChanges().filter((change) => change.type === 'added')
                : [];
            notiLastSnapshot = snapshot;
            renderNotificationRows(snapshot);
            notiInitialSnapshotLoaded = true;

            additions.forEach((change) => {
                const id = String(change.doc?.id || '');
                if (id && notiAnnouncedIds.has(id)) return;
                if (id) notiAnnouncedIds.add(id);
                showIncomingNotification(change.doc?.data?.() || {});
            });
        }, (error) => {
            if (version !== notiSubscriptionVersion || String(userId) !== notiActiveUserId) return;
            if (!useFallbackQuery && notificationNeedsIndexFallback(error)) {
                try { console.warn('[알림] 복합 인덱스가 준비될 때까지 대체 실시간 조회를 사용합니다.', error); } catch (_) {}
                try { notiUnsubscribe?.(); } catch (_) {}
                notiUnsubscribe = null;
                notiInitialSnapshotLoaded = false;
                notiAnnouncedIds = new Set();
                subscribeToNotifications(userId, version, true);
                return;
            }
            reportNotificationFailure('알림 센터 연결 실패', error, '⚠️ 알림 센터를 실시간으로 연결하지 못했습니다.');
        });
        if (version === notiSubscriptionVersion) notiUnsubscribe = unsubscribe;
        else {
            try { unsubscribe?.(); } catch (_) {}
        }
    } catch (error) {
        if (!useFallbackQuery && notificationNeedsIndexFallback(error)) {
            subscribeToNotifications(userId, version, true);
            return;
        }
        reportNotificationFailure('알림 구독 설정 실패', error, '⚠️ 알림 센터를 준비하지 못했습니다.');
    }
}

async function initNotifications(userId) {
    if (!userId) return;
    if (typeof db === 'undefined' || !db || !db.collection) return;
    const version = ++notiSubscriptionVersion;
    if (notiUnsubscribe) {
        try { notiUnsubscribe(); } catch (_) {}
        notiUnsubscribe = null;
    }
    notiActiveUserId = String(userId);
    notiInitialSnapshotLoaded = false;
    notiAnnouncedIds = new Set();
    notiLastSnapshot = null;

    // 기존 로그인 정보(localStorage)가 먼저 복원되어도 Firestore 구독은 인증 완료 뒤에 시작합니다.
    try {
        if (typeof ensureAnonymousAuth === 'function') await ensureAnonymousAuth();
    } catch (error) {
        try { console.warn('[알림] Firebase 인증 준비 실패:', error); } catch (_) {}
    }
    if (version !== notiSubscriptionVersion || notiActiveUserId !== String(userId)) return;
    subscribeToNotifications(userId, version, false);
}

function stopNotifications() {
    // 인증 대기 중이던 이전 구독이 로그아웃 뒤 다시 붙지 않도록 무효화합니다.
    notiSubscriptionVersion += 1;
    if (notiUnsubscribe) {
        try { notiUnsubscribe(); } catch (_) {}
        notiUnsubscribe = null;
    }
    notiActiveUserId = "";
    notiInitialSnapshotLoaded = false;
    notiAnnouncedIds = new Set();
    notiLastSnapshot = null;
    // 다음 로그인은 토큰을 해당 계정에 다시 연결해야 합니다.
    fcmRegisteredUserId = "";
    if (typeof document === 'undefined') return;
    closeNotificationPanel();
    updateNotificationBadge(0, 0);
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
