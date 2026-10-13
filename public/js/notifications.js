// notifications.js
let notiUnsubscribe = null;

function toggleNotificationPanel() {
    let panel = document.getElementById('notiPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'notiPanel';
        panel.style.cssText = `
            position: fixed; top: 60px; right: 10px; width: 300px; max-height: 400px;
            background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 9999;
            overflow-y: auto; display: none; padding: 10px; color: var(--text);
        `;
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
    } else {
        panel.style.display = 'none';
    }
}

function initNotifications(userId) {
    if (!userId) return;
    
    // 1. FCM Push 권한 요청 및 토큰 발급
    if ('Notification' in window && firebase.messaging) {
        const messaging = firebase.messaging();
        Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
                // 서버에서 환경변수로 등록한 VAPID 키를 가져옴
                fetch('/api/config').then(res => res.json()).then(config => {
                    const getTokenOptions = {};
                    if (config.vapidKey) getTokenOptions.vapidKey = config.vapidKey;

                    messaging.getToken(getTokenOptions)
                        .then((currentToken) => {
                            if (currentToken) {
                                // 토큰을 DB user_profiles에 저장
                                db.collection('user_profiles').doc(userId).set({ fcmToken: currentToken }, { merge: true });
                            }
                        }).catch((err) => {
                            console.log('FCM Token get error', err);
                        });
                }).catch(err => console.log('Config fetch error', err));
            }
        });

        messaging.onMessage((payload) => {
            console.log('Message received. ', payload);
            showToast(payload.notification.title + " - " + payload.notification.body);
        });
    }

    // 2. Firestore In-App Notification 리스너 등록
    if (notiUnsubscribe) notiUnsubscribe();
    notiUnsubscribe = db.collection('notifications')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .onSnapshot((snapshot) => {
            let unreadCount = 0;
            let html = '';
            
            if (snapshot.empty) {
                html = '<p style="color:var(--text-secondary); text-align:center; font-size:0.9rem;">알림이 없습니다.</p>';
            } else {
                snapshot.forEach(doc => {
                    const data = doc.data();
                    if (!data.read) unreadCount++;
                    const bg = data.read ? 'transparent' : 'rgba(37, 99, 235, 0.1)';
                    html += \`
                        <div style="padding: 10px; border-bottom: 1px solid var(--border); background: \${bg}; border-radius: 4px; margin-bottom: 5px;">
                            <div style="font-weight:bold; font-size:0.95rem; margin-bottom:4px;">\${data.title}</div>
                            <div style="font-size:0.85rem; color:var(--text-secondary);">\${data.body}</div>
                        </div>
                    \`;
                });
            }
            
            const listEl = document.getElementById('notiList');
            if (listEl) listEl.innerHTML = html;
            
            const badge = document.getElementById('notiBadge');
            if (badge) {
                if (unreadCount > 0) {
                    badge.style.display = 'inline-block';
                    badge.innerText = unreadCount;
                } else {
                    badge.style.display = 'none';
                }
            }
        });
}

function markAllNotisAsRead() {
    if (!currentWorkerId) return;
    db.collection('notifications')
        .where('userId', '==', currentWorkerId)
        .where('read', '==', false)
        .get()
        .then(snapshot => {
            const batch = db.batch();
            snapshot.forEach(doc => {
                batch.update(doc.ref, { read: true });
            });
            batch.commit();
        });
}
