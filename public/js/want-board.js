// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/* 💡 운영자에게 바란다 — 관리자 전용 피드백 게시판 (2026-10-25 추가)
 *
 *  · 왼쪽 아래 "격하게 반짝이는" 플로팅 블록을 터치하면 전문 게시판(전체 화면 모달)으로 들어갑니다.
 *  · 작성자는 닉네임만 입력하면 됩니다(항만용어 닉네임 자동 기입 + 자유 수정).
 *  · "작성하신 내용은 관리자만 확인할 수 있습니다" 안내를 글쓰기 전에 반드시 노출합니다.
 *  · 미리보기(Preview)를 먼저 보여주고, 확인된 내용만 제출합니다.
 *  · 열람 범위: 작성자 본인 + 관리자(비밀번호 0346)만 볼 수 있습니다.
 *  · 댓글(답글)은 관리자만 작성할 수 있습니다.
 *
 * 저장 구조 (firestore.rules 의 want_board 규칙과 반드시 함께 바꿔야 합니다)
 *   want_board/{itemId}                       · 한 건의 피드백 (authorUid · nick · content · status)
 *   want_board/{itemId}/replies/{replyId}     · 관리자 답글 (isAdminReply)
 *   want_board_mine/{uid}                     · 작성자 본인의提交 목록 인덱스
 *     → 일반 사용자는 컬렉션 목록(list) 조회가 아니라 자기 문서만 읽을 수 있습니다.
 */
(function initWantBoard(global) {
    'use strict';

    /* ---------------- 운영 값 ---------------- */
    const BOARD_COLLECTION = 'want_board';
    const MINE_COLLECTION = 'want_board_mine';
    const REPLIES_SUBCOLLECTION = 'replies';
    const MAX_NICK_LENGTH = 50;
    const MAX_CONTENT_LENGTH = 3000;
    const MAX_REPLY_LENGTH = 3000;
    const MAX_MY_ITEMS = 100;
    const MAX_REPLIES_PER_ITEM = 30;
    const SNIPPET_LENGTH = 60;
    const STATUS_PENDING = 'pending';
    const STATUS_REPLIED = 'replied';
    const STATUS_CLOSED = 'closed';
    const VALID_STATUSES = [STATUS_PENDING, STATUS_REPLIED, STATUS_CLOSED];
    const NICK_STORAGE_KEY = 'busanPortWantBoardNickV1';
    const ANNOUNCE_TEXT = [
        '작성하신 내용은 관리자만 확인할 수 있습니다.',
        '업무에 필요하다고 생각되는 사항들을 알려주시면 반영하도록 하겠습니다.',
        '앱의 개선 점 피드백 남겨주세요'
    ].join('\n');

    /* ==================================================================
       순수 로직 — DOM·Firestore 없이도 단독 실행/테스트할 수 있습니다
       ================================================================== */

    /** 닉네임 정제 — 줄바꿈·제어 문자 제거, 길이 제한 */
    function sanitizeWantNick(raw) {
        return String(raw || '')
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_NICK_LENGTH);
    }

    /** 본문 정제 — CRLF 를 LF 로 통일, 제어 문자 제거, 길이 제한 */
    function sanitizeWantText(raw, maxLength) {
        const limit = Number(maxLength) > 0 ? Number(maxLength) : MAX_CONTENT_LENGTH;
        return String(raw || '')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim()
            .slice(0, limit);
    }

    /** 작성 폼 검증 — 닉네임 + 내용 (길이 초과는 잘라내지 않고 안내합니다) */
    function validateWantDraft(nick, content) {
        const errors = [];
        const cleanNick = sanitizeWantNick(nick);
        const cleanContent = sanitizeWantText(content, MAX_CONTENT_LENGTH);
        if (!cleanNick) errors.push('닉네임을 입력해 주세요.');
        if (!cleanContent) errors.push('내용을 입력해 주세요.');
        if (String(content || '').trim().length > MAX_CONTENT_LENGTH) {
            errors.push(`내용은 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있습니다.`);
        }
        return { ok: errors.length === 0, nick: cleanNick, content: cleanContent, errors };
    }

    /** 답글 검증 */
    function validateWantReply(text) {
        const clean = sanitizeWantText(text, MAX_REPLY_LENGTH);
        if (!clean) return { ok: false, text: '', errors: ['답글 내용을 입력해 주세요.'] };
        return { ok: true, text: clean, errors: [] };
    }

    /** 생성 시간순 정렬 (가장 recent 가 앞) */
    function sortWantItemsDesc(items) {
        return (Array.isArray(items) ? items : [])
            .filter((item) => item && typeof item === 'object')
            .map((item, index) => ({ item, index }))
            .sort((a, b) => {
                const aMs = Number(a.item.createdAtMs) || 0;
                const bMs = Number(b.item.createdAtMs) || 0;
                if (aMs !== bMs) return bMs - aMs;
                return a.index - b.index;
            })
            .map((entry) => entry.item);
    }

    /** 문서 ID 생성 — 예측 불가능한 랜덤 ID */
    function createWantItemId(nowMs) {
        const rand = Math.random().toString(36).slice(2, 10);
        const time = String(Number(nowMs) || Date.now()).toString(36);
        return `fb_${time}${rand}`.slice(0, 40);
    }

    /** KST 날짜시각 포맷 */
    function formatWantDateTime(rawTs) {
        let ms = 0;
        try {
            if (rawTs && typeof rawTs.toMillis === 'function') ms = Number(rawTs.toMillis()) || 0;
            else if (rawTs && typeof rawTs.toDate === 'function') ms = rawTs.toDate().getTime();
            else if (typeof rawTs === 'number') ms = rawTs;
            else if (rawTs && typeof rawTs._seconds === 'number') ms = rawTs._seconds * 1000;
            else if (typeof rawTs === 'string' && rawTs.trim()) ms = Date.parse(rawTs.trim());
        } catch (_) {
            ms = 0;
        }
        if (!ms || Number.isNaN(ms)) return '-';
        const kst = new Date(ms + 9 * 60 * 60 * 1000);
        const pad = (value) => String(value).padStart(2, '0');
        return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
    }

    /** 상태 텍스트 */
    function wantStatusLabel(status) {
        if (status === STATUS_REPLIED) return '✅ 답변 완료';
        if (status === STATUS_CLOSED) return '🔒 종료';
        return '⏳ 접수 대기';
    }

    /** HTML 이스케이프 */
    function escapeWantHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /* ------------------------------------------------------------------
       오류 분류 — "Missing or insufficient permissions" 만 보고는 원인을 알 수 없어
       운영자·사용자가 바로 조치할 수 있도록 원인별 안내 문구로 바꿔 줍니다.
       (2026-10-28 운영자 신고: 제출 실패: Missing or insufficient permissions)
       ------------------------------------------------------------------ */

    /** Firestore 오류를 원인 종류로 분류합니다(순수 함수). */
    function classifyWantError(error) {
        const code = String((error && (error.code || error.status)) || '');
        const message = String((error && error.message) || '');
        const haystack = `${code} ${message}`;
        if (/permission-denied|insufficient permissions|insufficient_permissions/i.test(haystack)) return 'permission-denied';
        if (/unauthenticated|invalid-credential|auth\/user/i.test(haystack)) return 'unauthenticated';
        if (/failed-precondition|requires an index|index/i.test(haystack)) return 'index';
        if (/unavailable|network-request-failed|deadline-exceeded|timeout|offline/i.test(haystack)) return 'network';
        return 'unknown';
    }

    /**
     * 사용자에게 보여 줄 오류 문구를 만듭니다.
     * @param {*} error  Firestore 오류 객체
     * @param {string} action  '제출' · '답글 등록' · '삭제' · '기록 불러오기'
     */
    function describeWantFailure(error, action) {
        const label = String(action || '저장') + ' 실패';
        const kind = classifyWantError(error);
        const raw = String((error && error.message) || 'Unknown error');
        if (kind === 'permission-denied') {
            return [
                `${label}: 서버가 저장을 거부했습니다 (permission-denied).`,
                '운영 Firestore 보안 규칙(firestore.rules)이 아직 배포되지 않았을 가능성이 큽니다.',
                '운영자: GitHub → Actions → "Firebase 운영 배포" 워크플로우를 실행해 규칙을 배포해 주세요.',
                '규칙이 배포된 뒤에도 계속 실패하면 이 문구를 운영자에게 알려 주세요.'
            ].join('\n');
        }
        if (kind === 'unauthenticated') {
            return [`${label}: 로그인(세션)이 만료되었습니다. 앱을 새로고침한 뒤 다시 시도해 주세요.`, `(${raw})`].join('\n');
        }
        if (kind === 'index') {
            return [`${label}: 데이터베이스 색인(index)이 필요합니다. 운영자에게 알려 주세요.`, `(${raw})`].join('\n');
        }
        if (kind === 'network') {
            return [`${label}: 네트워크가 불안정합니다. 연결을 확인한 뒤 다시 시도해 주세요.`, `(${raw})`].join('\n');
        }
        return `${label}: ${raw}`;
    }

    /** 인덱스용 요약 생성 */
    function buildWantIndexItem(item) {
        const content = sanitizeWantText(item && item.content, MAX_CONTENT_LENGTH);
        return {
            id: String((item && item.id) || ''),
            nick: sanitizeWantNick((item && item.nick) || ''),
            snippet: content.length > SNIPPET_LENGTH ? `${content.slice(0, SNIPPET_LENGTH)}…` : content,
            status: VALID_STATUSES.indexOf(item && item.status) >= 0 ? item.status : STATUS_PENDING,
            replyCount: Math.max(0, Number((item && item.replyCount) || 0)),
            deleted: Boolean(item && item.deleted),
            createdAtMs: Number((item && item.createdAtMs) || 0) || Date.now()
        };
    }

    /** 문서 데이터를 안전한 아이템 객체로 정규화 */
    function normalizeWantItem(docData, fallbackId) {
        const src = docData || {};
        const status = VALID_STATUSES.indexOf(src.status) >= 0 ? src.status : STATUS_PENDING;
        const replies = Array.isArray(src.replies)
            ? src.replies.slice(-MAX_REPLIES_PER_ITEM).map((reply) => ({
                id: String((reply && reply.id) || ''),
                name: sanitizeWantNick((reply && reply.name) || '관리자'),
                text: sanitizeWantText((reply && reply.text) || '', MAX_REPLY_LENGTH),
                createdAtMs: Number((reply && reply.createdAtMs) || 0) || 0,
                createdAt: reply && reply.createdAt,
                isAdminReply: reply ? Boolean(reply.isAdminReply) : true
            }))
            : [];
        return {
            id: String(src.id || fallbackId || ''),
            authorUid: String(src.authorUid || ''),
            nick: sanitizeWantNick(src.nick),
            content: sanitizeWantText(src.content, MAX_CONTENT_LENGTH),
            createdAtMs: Number(src.createdAtMs) || 0,
            createdAt: src.createdAt,
            status,
            deleted: Boolean(src.deleted),
            replyCount: Math.max(0, Number(src.replyCount) || 0),
            replies
        };
    }

    /** 작성자 인덱스 문서를 정규화 */
    function normalizeWantIndex(docData, uid) {
        const src = docData || {};
        const items = Array.isArray(src.items)
            ? src.items
                .filter((entry) => entry && typeof entry === 'object')
                .map((entry) => ({
                    id: String(entry.id || ''),
                    nick: sanitizeWantNick(entry.nick),
                    snippet: sanitizeWantText(entry.snippet || '', SNIPPET_LENGTH + 4),
                    status: VALID_STATUSES.indexOf(entry.status) >= 0 ? entry.status : STATUS_PENDING,
                    replyCount: Math.max(0, Number(entry.replyCount) || 0),
                    deleted: Boolean(entry.deleted),
                    createdAtMs: Number(entry.createdAtMs) || 0
                }))
                .filter((entry) => entry.id)
            : [];
        return { uid: String(src.uid || uid || ''), items };
    }

    /* ==================================================================
       상태
       ================================================================== */
    let boardUid = '';
    let authReady = null;
    let myIndex = { uid: '', items: [] };
    let myItems = [];
    let itemUnsubscribers = {};
    let adminMode = false;
    let adminItems = [];
    let draft = { nick: '', content: '' };
    /** 내 기록(인덱스) 읽기 오류 — 목록 화면에 원인을 안내하기 위해 보관합니다. */
    let indexLoadError = null;

    function byId(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    /**
     * Firestore 인스턴스 해석
     *
     * app.js 는 `const db = firebase.firestore()` 로 선언합니다. 브라우저 classic script 규칙상
     * 상위 레벨 `const`/`let` 은 전역 렉시컬 환경에만 binding 되고 `window.db` property 로는
     * 붙지 않습니다. 그래서 `global.db` 로만 찾으면 항상 undefined 가 되어
     * "데이터베이스를 준비하지 못했어요" 가 뜨게 됩니다(2026-10-25 운영자 피드백).
     * 따라서 bare 식별자를 먼저 찾고, 없으면 `global.db` · `global.firebase.firestore()` 로 차례로 폴백합니다.
     */
    function getFirestore() {
        try {
            if (typeof db !== 'undefined' && db) return db;
        } catch (_) {
            // TDZ(선언 이전 참조) — 무시
        }
        try {
            if (typeof global.db !== 'undefined' && global.db) return global.db;
        } catch (_) {
            // 무시
        }
        try {
            if (typeof global.firebase !== 'undefined' && global.firebase && typeof global.firebase.firestore === 'function') {
                return global.firebase.firestore();
            }
        } catch (_) {
            // 무시
        }
        return null;
    }

    function getAuth() {
        try {
            if (typeof auth !== 'undefined' && auth) return auth;
        } catch (_) {
            // TDZ — 무시
        }
        try {
            if (typeof global.auth !== 'undefined' && global.auth) return global.auth;
        } catch (_) {
            // 무시
        }
        return null;
    }

    /** 익명 인증 함수 — 상위 레벨 함수 선언은 window property 로도 붙습니다. */
    function resolveAnonAuth() {
        try {
            if (typeof ensureAnonymousAuth === 'function') return ensureAnonymousAuth;
        } catch (_) {
            // 무시
        }
        try {
            if (typeof global.ensureAnonymousAuth === 'function') return global.ensureAnonymousAuth;
        } catch (_) {
            // 무시
        }
        return null;
    }

    function notifyAlert(message) {
        let fn = null;
        try {
            if (typeof alert === 'function') fn = alert;
        } catch (_) {
            // 무시
        }
        if (!fn) {
            try {
                if (typeof global.alert === 'function') fn = global.alert;
            } catch (_) {
                // 무시
            }
        }
        if (fn) fn(message);
    }

    function notifyConfirm(message) {
        let fn = null;
        try {
            if (typeof confirm === 'function') fn = confirm;
        } catch (_) {
            // 무시
        }
        if (!fn) {
            try {
                if (typeof global.confirm === 'function') fn = global.confirm;
            } catch (_) {
                // 무시
            }
        }
        // confirm 이 없으면 안전하게 "취소" 로 처리합니다.
        return fn ? Boolean(fn(message)) : false;
    }

    function notifyToast(message) {
        let fn = null;
        try {
            if (typeof showToast === 'function') fn = showToast;
        } catch (_) {
            // 무시
        }
        if (!fn) {
            try {
                if (typeof global.showToast === 'function') fn = global.showToast;
            } catch (_) {
                // 무시
            }
        }
        if (fn) fn(message);
    }

    /** 서버 타임스탬프 — Firebase SDK 가 없으면 없이 저장합니다(규칙은 createdAtMs 를 기준으로 합니다). */
    function wantServerTimestamp() {
        try {
            if (typeof firebase !== 'undefined' && firebase && firebase.firestore && firebase.firestore.FieldValue) {
                return firebase.firestore.FieldValue.serverTimestamp();
            }
        } catch (_) {
            // 무시
        }
        try {
            if (typeof global.firebase !== 'undefined' && global.firebase && global.firebase.firestore && global.firebase.firestore.FieldValue) {
                return global.firebase.firestore.FieldValue.serverTimestamp();
            }
        } catch (_) {
            // 무시
        }
        return null;
    }

    async function ensureBoardAuth() {
        const ensureAnon = resolveAnonAuth();
        if (ensureAnon) {
            await ensureAnon();
        }
        const auth = getAuth();
        const uid = auth && auth.currentUser ? String(auth.currentUser.uid || '') : '';
        if (!uid) {
            let fetchAnon = null;
            try {
                if (typeof fetchPortApiJson === 'function') fetchAnon = fetchPortApiJson;
            } catch (_) {
                // 무시
            }
            if (!fetchAnon) {
                try {
                    if (typeof global.fetchPortApiJson === 'function') fetchAnon = global.fetchPortApiJson;
                } catch (_) {
                    // 무시
                }
            }
            if (fetchAnon) {
                let clientId = '';
                try {
                    clientId = typeof getOrCreateClientDeviceId === 'function'
                        ? getOrCreateClientDeviceId()
                        : (typeof global.getOrCreateClientDeviceId === 'function' ? global.getOrCreateClientDeviceId() : 'dev_want');
                } catch (_) {
                    clientId = 'dev_want';
                }
                try {
                    const fallback = await fetchAnon('/api/auth-session', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: 'anonymous', clientId })
                    });
                    if (fallback && fallback.status === 200 && fallback.data && fallback.data.customToken && auth && typeof auth.signInWithCustomToken === 'function') {
                        const cred = await auth.signInWithCustomToken(fallback.data.customToken);
                        if (cred && cred.user) {
                            return String(cred.user.uid || '');
                        }
                    }
                } catch (_) {
                    // 폴백 실패 시 auth.currentUser 를 그대로 사용합니다.
                }
            }
        }
        return auth && auth.currentUser ? String(auth.currentUser.uid || '') : '';
    }

    /** 작성자 닉네임 — 항만용어 자동 기입 + 자유 수정 (마지막 입력값 저장) */
    function loadSavedWantNick() {
        try {
            const saved = String(global.localStorage && global.localStorage.getItem(NICK_STORAGE_KEY) || '').trim();
            if (saved && saved.length <= MAX_NICK_LENGTH) return saved;
        } catch (_) {
            // localStorage 사용 불가 환경에서도 동작하도록 continue
        }
        return '';
    }

    function saveWantNick(nick) {
        try {
            if (global.localStorage && global.localStorage.setItem) global.localStorage.setItem(NICK_STORAGE_KEY, String(nick || ''));
        } catch (_) {
            // 무시
        }
    }

    /** 항만용어 닉네임 후보 — app.js 의 상위 레벨 const 를 bare 식별자로 먼저 찾습니다. */
    function portNicknameOptions() {
        let options = [];
        try {
            if (typeof PORT_NICKNAME_OPTIONS !== 'undefined' && Array.isArray(PORT_NICKNAME_OPTIONS)) {
                options = PORT_NICKNAME_OPTIONS;
            }
        } catch (_) {
            // 무시
        }
        if (!options.length) {
            try {
                if (global.PORT_NICKNAME_OPTIONS && Array.isArray(global.PORT_NICKNAME_OPTIONS)) {
                    options = global.PORT_NICKNAME_OPTIONS;
                }
            } catch (_) {
                // 무시
            }
        }
        return options;
    }

    /** app.js 의 getPortNickname 가 있으면 거기에 위임합니다. */
    function resolvePortNickname(forceNew) {
        let fn = null;
        try {
            if (typeof getPortNickname === 'function') fn = getPortNickname;
        } catch (_) {
            // 무시
        }
        if (!fn) {
            try {
                if (typeof global.getPortNickname === 'function') fn = global.getPortNickname;
            } catch (_) {
                // 무시
            }
        }
        try {
            const nick = fn ? fn(Boolean(forceNew)) : '';
            return nick ? String(nick) : '';
        } catch (_) {
            return '';
        }
    }

    function pickWantNick(previousNick, options) {
        const list = Array.isArray(options) ? options : [];
        const filtered = list.filter((option) => option !== previousNick);
        const pool = filtered.length ? filtered : list;
        if (!pool.length) return previousNick || '익명';
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function getWantNick(forceNew) {
        const saved = loadSavedWantNick();
        if (!forceNew && saved) return saved;
        const fromApp = resolvePortNickname(forceNew);
        if (fromApp) {
            saveWantNick(fromApp);
            return fromApp;
        }
        const nick = pickWantNick(saved, portNicknameOptions());
        saveWantNick(nick);
        return nick;
    }

    /* ==================================================================
       화면 제어
       ================================================================== */

    function openWantBoard() {
        const overlay = byId('wantBoardOverlay');
        if (!overlay) return;
        overlay.classList.add('is-open');
        const float = byId('wantBoardFloatBtn');
        if (float) float.classList.add('is-hidden');
        renderWantPrivacy();
        void initWantBoardFlow();
    }

    function closeWantBoard() {
        const overlay = byId('wantBoardOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-open');
        const float = byId('wantBoardFloatBtn');
        if (float) float.classList.remove('is-hidden');
        stopWantItemListeners();
    }

    function renderWantPrivacy() {
        const box = byId('wantBoardPrivacyText');
        if (box) box.textContent = ANNOUNCE_TEXT;
    }

    function toggleWantForm() {
        const form = byId('wantBoardForm');
        if (!form) return;
        const isOpening = form.classList.contains('is-open');
        if (!isOpening) {
            closeWantPreview();
            if (!draft.nick) draft.nick = getWantNick(false);
            const nickInput = byId('wantBoardNick');
            if (nickInput) nickInput.value = draft.nick;
            const counter = byId('wantBoardCounter');
            if (counter) updateWantCounter();
        }
        form.classList.toggle('is-open');
        if (isOpening) {
            const nickInput = byId('wantBoardNick');
            if (nickInput) nickInput.focus();
        }
    }

    function refreshWantNick() {
        const nickInput = byId('wantBoardNick');
        if (!nickInput) return;
        const nick = getWantNick(true);
        nickInput.value = nick;
        draft.nick = nick;
        closeWantPreview();
    }

    function updateWantCounter() {
        const counter = byId('wantBoardCounter');
        if (!counter) return;
        const content = sanitizeWantText(byId('wantBoardContent') && byId('wantBoardContent').value, MAX_CONTENT_LENGTH);
        counter.textContent = `${content.length} / ${MAX_CONTENT_LENGTH}`;
    }

    function closeWantPreview() {
        const preview = byId('wantBoardPreview');
        if (!preview) return;
        preview.classList.remove('is-open');
        preview.innerHTML = '';
    }

    /** 미리보기 — 제출 전에 작성자가 확인할 수 있게 표시 */
    function showWantPreview() {
        const validation = validateWantDraft(
            byId('wantBoardNick') && byId('wantBoardNick').value,
            byId('wantBoardContent') && byId('wantBoardContent').value
        );
        if (!validation.ok) {
            notifyAlert(validation.errors.join('\n'));
            return false;
        }
        draft = { nick: validation.nick, content: validation.content };
        const preview = byId('wantBoardPreview');
        if (!preview) return false;
        preview.innerHTML = [
            '<p class="want-board-preview-label">👁️ 미리보기 — 이대로 제출됩니다</p>',
            '<div class="want-board-preview-card">',
            '  <div class="want-board-preview-meta">',
            `    <span>🏷️ ${escapeWantHtml(draft.nick)}</span>`,
            '    <span>🔒 관리자만 확인</span>',
            '  </div>',
            `  <p class="want-board-preview-body">${escapeWantHtml(draft.content)}</p>`,
            '</div>',
            '<div class="want-board-form-actions">',
            '  <button type="button" class="action-btn bg-submit" style="flex:2;" onclick="confirmWantPreview()">✓ 제출하기</button>',
            '  <button type="button" class="action-btn bg-cancel" style="flex:1;" onclick="showWantPreview()">✏️ 수정</button>',
            '  <button type="button" class="action-btn bg-cancel" style="flex:1;" onclick="closeWantFormAndPreview()">✕ 취소</button>',
            '</div>',
            '<p class="want-board-hint">※ 제출 후에는 수정·삭제가 불가능할 수 있습니다. 내용을 잘 확인해 주세요.</p>'
        ].join('');
        preview.classList.add('is-open');
        return true;
    }

    function closeWantFormAndPreview() {
        closeWantPreview();
        const form = byId('wantBoardForm');
        if (form) form.classList.remove('is-open');
        const content = byId('wantBoardContent');
        if (content) content.value = '';
        draft = { nick: '', content: '' };
        updateWantCounter();
    }

    /** 미리보기에서 확인 → 실제 저장 */
    async function confirmWantPreview() {
        const validation = validateWantDraft(draft.nick, draft.content);
        if (!validation.ok) {
            notifyAlert(validation.errors.join('\n'));
            return;
        }
        const db = getFirestore();
        if (!db) {
            notifyAlert('데이터베이스를 준비하지 못했어요. 앱을 새로고침해 주세요.');
            return;
        }
        const uid = boardUid || await ensureBoardAuth();
        if (!uid) {
            notifyAlert('로그인 상태가 아니어서 제출할 수 없습니다. 앱을 새로고침해 주세요.');
            return;
        }
        boardUid = uid;
        const itemId = createWantItemId(Date.now());
        const itemDoc = {
            id: itemId,
            authorUid: uid,
            nick: validation.nick,
            content: validation.content,
            createdAt: wantServerTimestamp(),
            createdAtMs: Date.now(),
            status: STATUS_PENDING,
            deleted: false,
            replyCount: 0
        };
        const button = byId('wantBoardPreviewSubmit');
        try {
            if (button) {
                button.disabled = true;
                button.innerText = '📝 전달 중...';
            }
            await commitWantItem(db, uid, itemId, itemDoc);
            draft = { nick: '', content: '' };
            closeWantFormAndPreview();
            notifyToast('📝 운영자에게 전달되었습니다.');
            await loadWantMyIndex();
        } catch (error) {
            // 원인별 안내(권한 거부 = 보안 규칙 미배포 가능성)를 그대로 노출하고,
            // 자세한 값은 콘솔에 남겨 운영자가 확인할 수 있게 합니다.
            try { console.warn('[want-board] 제출 실패', error); } catch (_) { /* 무시 */ }
            notifyAlert(describeWantFailure(error, '제출'));
        } finally {
            if (button) {
                button.disabled = false;
                button.innerText = '👁️ 미리보기';
            }
        }
    }

    /**
     * 피드백 문서 + 작성자 인덱스를 "한 번에" 저장합니다(원자적 쓰기).
     *
     * 이전 구현은 항목 저장 → 인덱스 저장을 순서대로 호출했기 때문에,
     * 두 번째 쓰기에서 권한 오류가 나면 항목만 남고 목록에는 보이지 않는
     * 반쪽 상태가 생겼습니다. 배치 쓰기로 묶어 그런 상태를 없앱니다.
     */
    async function commitWantItem(db, uid, itemId, itemDoc) {
        const indexRef = db.collection(MINE_COLLECTION).doc(uid);
        const items = await buildWantIndexItems(db, uid, [{ ...buildWantIndexItem({ ...itemDoc }), id: itemId }]);
        const itemRef = db.collection(BOARD_COLLECTION).doc(itemId);
        if (typeof db.batch === 'function') {
            const batch = db.batch();
            batch.set(itemRef, itemDoc);
            batch.set(indexRef, { uid, items }, { merge: true });
            await batch.commit();
            return;
        }
        // batch 를 지원하지 않는 아주 오래된 SDK 폴백
        await itemRef.set(itemDoc);
        await indexRef.set({ uid, items }, { merge: true });
    }

    /**
     * 인덱스에 넣을 목록을 만듭니다(최대 MAX_MY_ITEMS 개).
     * 인덱스 읽기는 실패해도 치명적이지 않으므로 최선 노력(best effort)으로 처리합니다.
     */
    async function buildWantIndexItems(db, uid, additions) {
        let existing = { uid, items: [] };
        try {
            const snapshot = await db.collection(MINE_COLLECTION).doc(uid).get();
            existing = normalizeWantIndex(snapshot.exists ? snapshot.data() : null, uid);
        } catch (_) {
            // 읽기 실패(권한·오프라인)해도 새 항목만 담아 저장을 시도합니다.
        }
        const byIdMap = new Map();
        existing.items.forEach((entry) => byIdMap.set(entry.id, entry));
        (Array.isArray(additions) ? additions : []).forEach((entry) => byIdMap.set(entry.id, entry));
        return Array.from(byIdMap.values())
            .filter((entry) => !entry.deleted)
            .slice(0, MAX_MY_ITEMS);
    }

    /** 인덱스 문서에 아이템을 추가 (최대 MAX_MY_ITEMS 개) */
    async function ensureWantIndexDoc(db, uid, additions) {
        const ref = db.collection(MINE_COLLECTION).doc(uid);
        const items = await buildWantIndexItems(db, uid, additions);
        await ref.set({ uid, items }, { merge: true });
    }

    /* ==================================================================
       작성자 본인 기록 로딩
       ================================================================== */

    function stopWantItemListeners() {
        Object.keys(itemUnsubscribers).forEach((id) => {
            try {
                const unsub = itemUnsubscribers[id];
                if (typeof unsub === 'function') unsub();
            } catch (_) {
                // 무시
            }
        });
        itemUnsubscribers = {};
    }

    async function initWantBoardFlow() {
        if (authReady) {
            boardUid = await authReady;
            await loadWantMyIndex();
            renderWantMyList();
            return;
        }
        authReady = ensureBoardAuth().then((uid) => {
            boardUid = uid;
            return uid;
        }).catch(() => '');
        boardUid = await authReady;
        if (!boardUid) {
            renderWantEmpty('로그인 상태가 아니어서 이용할 수 없습니다.\n앱을 새로고침해 주세요.');
            return;
        }
        await loadWantMyIndex();
        renderWantMyList();
    }

    async function loadWantMyIndex() {
        const db = getFirestore();
        const uid = boardUid || await ensureBoardAuth();
        boardUid = uid;
        if (!db || !uid) {
            myIndex = { uid: '', items: [] };
            return;
        }
        try {
            const snapshot = await db.collection(MINE_COLLECTION).doc(uid).get();
            myIndex = normalizeWantIndex(snapshot.exists ? snapshot.data() : null, uid);
            indexLoadError = null;
        } catch (error) {
            // 권한 거부(보안 규칙 미배포)를 조용히 삼키면 "기록이 없다"로만 보이므로
            // 원인을 보관해 두었다가 목록 화면에 안내합니다.
            indexLoadError = error || null;
            myIndex = { uid, items: [] };
            try { console.warn('[want-board] 내 기록 불러오기 실패', error); } catch (_) { /* 무시 */ }
        }
        await loadWantMyItems();
    }

    async function loadWantMyItems() {
        const db = getFirestore();
        stopWantItemListeners();
        myItems = [];
        if (indexLoadError) {
            renderWantEmpty(describeWantFailure(indexLoadError, '기록 불러오기'), { keepWriteButton: true });
            return;
        }
        if (!db) {
            renderWantMyList();
            return;
        }
        const ids = myIndex.items.map((entry) => entry.id);
        await Promise.all(ids.map(async (id) => {
            try {
                const snapshot = await db.collection(BOARD_COLLECTION).doc(id).get();
                if (!snapshot.exists) return;
                const data = snapshot.data();
                const item = normalizeWantItem(data, id);
                if (item.deleted) return;
                myItems.push(item);
                subscribeWantReplies(id, item);
            } catch (_) {
                // 권한 거부 등은 무시
            }
        }));
        renderWantMyList();
    }

    /** 답글 실시간 구독 (작성자는 자기 글의 답글만 볼 수 있습니다) */
    function subscribeWantReplies(itemId, item) {
        const db = getFirestore();
        if (!db) return;
        try {
            const ref = db.collection(BOARD_COLLECTION).doc(itemId).collection(REPLIES_SUBCOLLECTION);
            const unsub = ref.onSnapshot((snapshot) => {
                const replies = [];
                snapshot.forEach((doc) => {
                    const data = doc.data() || {};
                    replies.push({
                        id: doc.id,
                        name: sanitizeWantNick(data.name || '관리자'),
                        text: sanitizeWantText(data.text || '', MAX_REPLY_LENGTH),
                        createdAtMs: data.createdAtMs || (data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : 0) || 0,
                        createdAt: data.createdAt,
                        isAdminReply: data.isAdminReply !== false
                    });
                });
                const target = myItems.find((entry) => entry.id === itemId);
                if (target) {
                    target.replies = replies;
                    target.replyCount = replies.length;
                    if (replies.length > 0 && target.status === STATUS_PENDING) target.status = STATUS_REPLIED;
                    renderWantMyList();
                }
            }, () => {
                // offline — ignore
            });
            itemUnsubscribers[itemId] = unsub;
        } catch (_) {
            // ignore
        }
    }

    function renderWantEmpty(message, options) {
        const keepWriteButton = Boolean(options && options.keepWriteButton);
        const list = byId('wantBoardList');
        const adminBar = byId('wantBoardAdminBar');
        const writeBtn = byId('wantBoardWriteBtn');
        if (list) list.innerHTML = `<div class="want-board-empty">${escapeWantHtml(message)}</div>`;
        if (adminBar) adminBar.classList.add('hidden');
        // 권한 오류 안내일 때는 "희망 사항 남기기" 버튼을 숨기지 않습니다.
        if (writeBtn) writeBtn.style.display = keepWriteButton ? '' : 'none';
    }

    function renderWantMyList() {
        const list = byId('wantBoardList');
        if (!list) return;
        const adminBar = byId('wantBoardAdminBar');
        const writeBtn = byId('wantBoardWriteBtn');
        if (writeBtn) writeBtn.style.display = '';
        if (adminBar) adminBar.classList.toggle('hidden', !adminMode);

        if (adminMode) {
            renderWantAdminList();
            return;
        }
        const items = sortWantItemsDesc(myItems);
        if (!items.length) {
            list.innerHTML = '<div class="want-board-empty">아직 제출한 기록이 없습니다.\n아래 "✍️ 희망 사항 남기기"로 운영자에게 직접 전달해 보세요.</div>';
            return;
        }
        list.innerHTML = items.map((item) => wantItemHtml(item, { isAdmin: false })).join('');
    }

    function wantItemHtml(item, options) {
        const isAdmin = Boolean(options && options.isAdmin);
        const replies = Array.isArray(item.replies) ? item.replies : [];
        const statusClass = item.status === STATUS_REPLIED ? 'is-replied' : (item.status === STATUS_CLOSED ? 'is-closed' : '');
        const replyHtml = replies.length
            ? `<div class="want-board-replies">${replies.map((reply) => [
                '<div class="want-board-reply">',
                '  <div class="want-board-reply-head">',
                `    <span class="want-board-reply-name">${escapeWantHtml(reply.name)}${reply.isAdminReply ? ' · 운영자' : ''}</span>`,
                `    <span class="want-board-reply-time">${escapeWantHtml(formatWantDateTime(reply.createdAtMs || reply.createdAt))}</span>`,
                '  </div>',
                `  <p class="want-board-reply-text">${escapeWantHtml(reply.text)}</p>`,
                '</div>'
            ].join('')).join('')}</div>`
            : '';
        const adminActions = isAdmin
            ? `<div class="want-board-reply-input" contenteditable="true" data-want-reply-for="${escapeWantHtml(item.id)}" role="textbox" aria-label="답글 입력" data-placeholder="운영자 답글을 입력하세요..."></div>
               <div class="want-board-reply-actions">
                 <button type="button" class="action-btn bg-submit" style="flex:2;" onclick="submitWantReply('${escapeWantHtml(item.id)}')">📢 답글 등록</button>
                 <button type="button" class="action-btn bg-cancel" style="flex:1;" onclick="deleteWantItem('${escapeWantHtml(item.id)}', true)">🗑️ 삭제</button>
               </div>`
            : `<div class="want-board-item-actions">
                 <button type="button" class="mini-btn" onclick="deleteWantItem('${escapeWantHtml(item.id)}', false)">🗑️ 삭제</button>
               </div>`;
        return [
            '<article class="want-board-item">',
            '  <div class="want-board-item-head">',
            `    <span class="want-board-item-nick">${escapeWantHtml(item.nick || '익명')}</span>`,
            `    <span class="want-board-item-time">${escapeWantHtml(formatWantDateTime(item.createdAtMs || item.createdAt))}</span>`,
            `    <span class="want-board-item-status ${statusClass}">${escapeWantHtml(wantStatusLabel(item.status))}</span>`,
            '  </div>',
            `  <div class="want-board-item-body">${escapeWantHtml(item.content)}</div>`,
            replyHtml,
            adminActions,
            '</article>'
        ].join('');
    }

    async function deleteWantItem(itemId, isAdmin) {
        if (!notifyConfirm('이 기록을 삭제하시겠습니까?')) return;
        const db = getFirestore();
        if (!db) return;
        try {
            if (isAdmin) {
                await db.collection(BOARD_COLLECTION).doc(itemId).delete();
                const replies = await db.collection(BOARD_COLLECTION).doc(itemId).collection(REPLIES_SUBCOLLECTION).get();
                replies.forEach((reply) => {
                    void reply.ref.delete().catch(() => {});
                });
            } else {
                await db.collection(BOARD_COLLECTION).doc(itemId).update({ deleted: true });
                await updateWantIndexRemoval(itemId);
            }
            if (isAdmin) {
                await loadWantAdminItems();
            } else {
                await loadWantMyIndex();
            }
            notifyToast('삭제되었습니다.');
        } catch (error) {
            notifyAlert(describeWantFailure(error, '삭제'));
        }
    }

    async function updateWantIndexRemoval(itemId) {
        const db = getFirestore();
        const uid = boardUid;
        if (!db || !uid) return;
        try {
            const snapshot = await db.collection(MINE_COLLECTION).doc(uid).get();
            const index = normalizeWantIndex(snapshot.exists ? snapshot.data() : null, uid);
            index.items = index.items.filter((entry) => entry.id !== itemId);
            await db.collection(MINE_COLLECTION).doc(uid).set({ uid, items: index.items }, { merge: true });
        } catch (_) {
            // ignore
        }
    }

    /* ==================================================================
       관리자 영역 (비밀번호 0346 — verifyAdmin() 와 동일 검증)
       ================================================================== */

    async function enterWantAdminMode() {
        const ok = typeof global.verifyAdmin === 'function' ? await global.verifyAdmin(true) : false;
        if (!ok) return;
        adminMode = true;
        await loadWantAdminItems();
        renderWantMyList();
        renderWantAdminBar();
    }

    function exitWantAdminMode() {
        adminMode = false;
        adminItems = [];
        renderWantMyList();
        renderWantAdminBar();
    }

    function renderWantAdminBar() {
        const bar = byId('wantBoardAdminBar');
        if (!bar) return;
        if (adminMode) {
            bar.innerHTML = '<span class="want-board-admin-badge"><b>관리자 모드</b> · 모든 기록을 열람·답글할 수 있습니다.</span><button type="button" class="mini-btn" onclick="exitWantAdminMode()">종료</button>';
            bar.classList.remove('hidden');
        } else {
            bar.innerHTML = '<span class="want-board-admin-badge">🔒 일반 사용자 모드 · 본인이 작성한 기록만 보여집니다. <b>관리자</b>로 보기</span><button type="button" class="mini-btn" onclick="enterWantAdminMode()">관리자로 보기</button>';
            bar.classList.remove('hidden');
        }
    }

    async function loadWantAdminItems() {
        const db = getFirestore();
        if (!db) {
            adminItems = [];
            renderWantMyList();
            return;
        }
        try {
            const snapshot = await db.collection(BOARD_COLLECTION).get();
            const items = [];
            snapshot.forEach((doc) => {
                const data = doc.data() || {};
                if (data.deleted) return;
                items.push(normalizeWantItem(data, doc.id));
            });
            adminItems = sortWantItemsDesc(items);
            stopWantItemListeners();
            await Promise.all(adminItems.map(async (item) => {
                try {
                    const repliesSnapshot = await db.collection(BOARD_COLLECTION).doc(item.id).collection(REPLIES_SUBCOLLECTION).get();
                    const replies = [];
                    repliesSnapshot.forEach((replyDoc) => {
                        const replyData = replyDoc.data() || {};
                        replies.push({
                            id: replyDoc.id,
                            name: sanitizeWantNick(replyData.name || '관리자'),
                            text: sanitizeWantText(replyData.text || '', MAX_REPLY_LENGTH),
                            createdAtMs: replyData.createdAtMs || (replyData.createdAt && replyData.createdAt.toMillis ? replyData.createdAt.toMillis() : 0) || 0,
                            createdAt: replyData.createdAt,
                            isAdminReply: replyData.isAdminReply !== false
                        });
                    });
                    item.replies = replies;
                    item.replyCount = replies.length;
                    if (replies.length > 0 && item.status === STATUS_PENDING) item.status = STATUS_REPLIED;
                } catch (_) {
                    // ignore
                }
            }));
            renderWantAdminList();
        } catch (error) {
            notifyAlert(describeWantFailure(error, '기록 불러오기'));
        }
    }

    function renderWantAdminList() {
        const list = byId('wantBoardList');
        if (!list) return;
        if (!adminItems.length) {
            list.innerHTML = '<div class="want-board-empty">접수된 피드백이 없습니다.</div>';
            return;
        }
        list.innerHTML = adminItems.map((item) => wantItemHtml(item, { isAdmin: true })).join('');
    }

    async function submitWantReply(itemId) {
        const db = getFirestore();
        if (!db) return;
        const area = document.querySelector(`[data-want-reply-for="${itemId}"]`);
        const raw = area ? area.textContent : '';
        const validation = validateWantReply(raw);
        if (!validation.ok) {
            notifyAlert(validation.errors.join('\n'));
            return;
        }
        const uid = boardUid || await ensureBoardAuth();
        try {
            await db.collection(BOARD_COLLECTION).doc(itemId).collection(REPLIES_SUBCOLLECTION).add({
                itemId,
                authorUid: uid,
                name: '운영자',
                text: validation.text,
                createdAt: wantServerTimestamp(),
                createdAtMs: Date.now(),
                isAdminReply: true
            });
            if (area) area.textContent = '';
            notifyToast('📢 답글이 등록되었습니다.');
            await loadWantAdminItems();
        } catch (error) {
            notifyAlert(describeWantFailure(error, '답글 등록'));
        }
    }

    /* ==================================================================
       초기화
       ================================================================== */

    function bindWantBoardEvents() {
        const nick = byId('wantBoardNick');
        if (nick) nick.addEventListener('input', () => { draft.nick = nick.value; });
        const content = byId('wantBoardContent');
        if (content) content.addEventListener('input', updateWantCounter);
        const refreshBtn = byId('wantBoardNickRefresh');
        if (refreshBtn) refreshBtn.addEventListener('click', refreshWantNick);
    }

    function init() {
        if (!byId('wantBoardOverlay') && !byId('wantBoardFloatBtn')) return;
        renderWantPrivacy();
        bindWantBoardEvents();
        renderWantAdminBar();
    }

    global.WantBoardCore = Object.freeze({
        collection: BOARD_COLLECTION,
        mineCollection: MINE_COLLECTION,
        repliesSubcollection: REPLIES_SUBCOLLECTION,
        maxNickLength: MAX_NICK_LENGTH,
        maxContentLength: MAX_CONTENT_LENGTH,
        maxReplyLength: MAX_REPLY_LENGTH,
        maxMyItems: MAX_MY_ITEMS,
        maxRepliesPerItem: MAX_REPLIES_PER_ITEM,
        statuses: VALID_STATUSES.slice(),
        announceText: ANNOUNCE_TEXT,
        sanitizeWantNick,
        sanitizeWantText,
        validateWantDraft,
        validateWantReply,
        sortWantItemsDesc,
        createWantItemId,
        formatWantDateTime,
        wantStatusLabel,
        buildWantIndexItem,
        normalizeWantItem,
        normalizeWantIndex,
        escapeWantHtml,
        classifyWantError,
        describeWantFailure,
        resolveFirestore: getFirestore,
        resolveAuth: getAuth,
        portNicknameOptions,
        resolvePortNickname,
        notifyAlert,
        notifyConfirm,
        notifyToast
    });

    global.openWantBoard = openWantBoard;
    global.closeWantBoard = closeWantBoard;
    global.toggleWantBoard = function toggleWantBoard() {
        const overlay = byId('wantBoardOverlay');
        if (!overlay) return;
        if (overlay.classList.contains('is-open')) closeWantBoard();
        else openWantBoard();
    };
    global.toggleWantForm = toggleWantForm;
    global.refreshWantNick = refreshWantNick;
    global.showWantPreview = showWantPreview;
    global.confirmWantPreview = confirmWantPreview;
    global.closeWantFormAndPreview = closeWantFormAndPreview;
    global.deleteWantItem = deleteWantItem;
    global.enterWantAdminMode = enterWantAdminMode;
    global.exitWantAdminMode = exitWantAdminMode;
    global.submitWantReply = submitWantReply;

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
