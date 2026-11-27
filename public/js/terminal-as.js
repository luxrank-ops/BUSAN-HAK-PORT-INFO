// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/* 🛠️ 터미널 시설·정비 수리 / A/S 요청 게시판 (2026-11-27)
 *
 * 기존 '꿍꿍따 3글자 끝말잇기 댓글 릴레이'를 대체합니다.
 *  · 1·2·3항업 9개 터미널 중 **터미널을 골라** 시설/정비·수리/A/S 요청을 씁니다.
 *  · **비밀번호·닉네임 입력 없음** — 앱이 자동으로 붙는 익명 인증만 사용하고,
 *    작성자는 선택한 터미널 이름 + 마스킹(한진*** · 동원*** …)으로 자동 생성됩니다.
 *    글마다 랜덤 익명 코드(접수번호)가 함께 붙어 서로 구분됩니다.
 *  · 현장 사진 업로드(최대 3장) · 본인 작성 글 수정/삭제(무비밀번호) ·
 *    누구나 '조치 완료' 버튼 · 댓글(좋아요 포함) · 게시글 좋아요를 지원합니다.
 *  · Firestore `terminal_as_requests` + Firebase Storage `terminal-as/` 에 저장되어 실시간 공유됩니다.
 *    네트워크/인증이 닿지 않으면 이 브라우저 localStorage 에 임시 접수합니다(오프라인 표기).
 *  · 블럭 색은 푸른색 중간톤(--blue-500~--blue-700 계열) + 반짝이는 효과를 사용합니다.
 */
(function initTerminalAsBoard(global) {
    'use strict';

    /* ---- 운영 값 (firestore.rules 의 terminal_as_requests 규칙과 함께 바꿔야 합니다) ---- */
    const COLLECTION = 'terminal_as_requests';
    const COMMENTS_COLLECTION = 'comments';
    const STORAGE_DIR = 'terminal-as';
    const LOCAL_KEY = 'hakportTerminalAsLocalV1';
    const MINE_KEY = 'hakportTerminalAsMineV1';
    const MINE_COMMENTS_KEY = 'hakportTerminalAsMineCommentsV1';
    const FEED_LIMIT = 80;
    const HEAD_WATCH_LIMIT = 10;
    const PAGE_SIZE = 10;
    const NEW_POST_WINDOW_MS = 24 * 60 * 60 * 1000;
    const COMMENTS_LIMIT = 100;
    const MAX_TITLE = 80;
    const MAX_CONTENT = 500;
    const MAX_COMMENT = 300;
    const MAX_AUTHOR = 40;
    const MAX_LOCAL = 60;
    const MAX_OWNED_IDS = 120;
    const MAX_PHOTOS = 3;
    const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
    const FILTER_ALL = 'all';

    /* 1·2·3항업 9개 터미널 — app.js 의 TERMINAL_SCHEDULE_LIST 와 같은 이름을 씁니다. */
    const TERMINALS = Object.freeze([
        { id: 'hjnc', short: '한진', label: '한진(HJNC)', group: '3항업' },
        { id: 'bnct', short: '고려', label: '고려(BNCT)', group: '3항업' },
        { id: 'dgt', short: '동원', label: '동원(DGT)', group: '3항업' },
        { id: 'bct', short: 'BCT', label: '부산컨테이너(BCT)', group: '3항업' },
        { id: 'pnc', short: 'PNC', label: '부산신항만(PNC)', group: '2항업' },
        { id: 'hpnt', short: 'HMM', label: 'HMM 신항만(HPNT)', group: '2항업' },
        { id: 'pnit', short: '국제', label: '신항국제(PNIT)', group: '2항업' },
        { id: 'bptc', short: '북항', label: '북항 통합(BPTC)', group: '1항업' },
        { id: 'hbct', short: '허치슨', label: '허치슨(HBCT)', group: '1항업' }
    ]);

    const REQUEST_TYPES = Object.freeze([
        { id: 'facility', label: '시설', icon: '🏢' },
        { id: 'repair', label: '정비·수리', icon: '🔧' },
        { id: 'as', label: 'A/S', icon: '🛠️' },
        { id: 'other', label: '기타', icon: '📌' }
    ]);

    const STATUS_LABEL = Object.freeze({
        received: '접수',
        processing: '처리 중',
        done: '조치완료'
    });

    /* ==================================================================
       순수 로직 — DOM·Firestore 없이 단독 실행/테스트할 수 있습니다
       ================================================================== */

    function terminalById(id) {
        return TERMINALS.find(item => item.id === String(id || '')) || null;
    }

    function typeById(id) {
        return REQUEST_TYPES.find(item => item.id === String(id || '')) || null;
    }

    /** 헷갈리는 문자(0/O, 1/I)를 뺀 랜덤 4자리 익명 코드 */
    function makeAnonCode(random = Math.random) {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let out = '';
        for (let i = 0; i < 4; i += 1) {
            const value = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
            out += alphabet[Math.floor(value * alphabet.length)];
        }
        return out;
    }

    /**
     * 작성자는 사용자가 입력하지 않습니다.
     * 선택한 터미널 이름 + 마스킹(***)으로 자동 생성하고, 글마다 랜덤 익명 코드를 붙입니다.
     * 예) 한진*** (#K7Q2), 동원*** (#B4M8)
     */
    function buildAnonymousIdentity(terminalId, random = Math.random) {
        const terminal = terminalById(terminalId) || TERMINALS[0];
        return {
            author: terminal.short + '***',
            anonCode: makeAnonCode(random),
            terminalId: terminal.id,
            terminalLabel: terminal.label
        };
    }

    function isSafePhotoUrl(rawUrl, allowDataUrl = false) {
        const value = String(rawUrl || '').trim();
        if (!value || /[\u0000-\u001f\u007f]/.test(value)) return false;
        if (/^https?:\/\/\S+$/i.test(value) && value.length >= 8 && value.length <= 2000) {
            return true;
        }
        if (allowDataUrl && /^data:image\/(png|jpeg|jpg|webp|gif|bmp|avif);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
            return value.length <= 900000;
        }
        return false;
    }

    function normalizeImageUrls(raw, allowDataUrl = false) {
        const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const out = [];
        const seen = new Set();
        for (let i = 0; i < list.length && out.length < MAX_PHOTOS; i += 1) {
            const value = String(list[i] || '').trim();
            if (!isSafePhotoUrl(value, allowDataUrl) || seen.has(value)) continue;
            seen.add(value);
            out.push(value);
        }
        return out;
    }

    function isImageFile(file) {
        if (!file || typeof file !== 'object') return false;
        const mime = String(file.type || '').toLowerCase();
        if (mime.startsWith('image/')) return true;
        return /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/i.test(String(file.name || ''));
    }

    function validatePhotoFile(file) {
        if (!file || typeof file !== 'object') {
            return { ok: false, code: 'invalid', message: '첨부할 사진 파일을 선택해 주세요.' };
        }
        if (!isImageFile(file)) {
            return { ok: false, code: 'type', message: '이미지 파일(JPG·PNG·WebP 등)만 첨부할 수 있어요.' };
        }
        const size = Number(file.size || 0);
        if (size > MAX_PHOTO_BYTES) {
            return { ok: false, code: 'size', message: '사진 한 장당 10MB 이하만 첨부할 수 있어요.' };
        }
        return { ok: true };
    }

    function deriveTitleFromContent(content) {
        const firstLine = String(content == null ? '' : content)
            .split(/\r?\n/u)
            .map(line => line.replace(/\s+/gu, ' ').trim())
            .find(Boolean) || '';
        if (firstLine.length <= 44) return firstLine;
        return firstLine.slice(0, 44).trimEnd() + '…';
    }

    function validateRequest(payload) {
        const data = payload || {};
        const terminalId = String(data.terminalId || '').trim();
        const type = String(data.type || '').trim();
        const hasTitleField = Object.prototype.hasOwnProperty.call(data, 'title') && data.title !== undefined;
        const title = hasTitleField
            ? String(data.title == null ? '' : data.title).replace(/\s+/gu, ' ').trim()
            : '';
        const content = String(data.content == null ? '' : data.content)
            .replace(/\r\n?/gu, '\n')
            .replace(/[^\S\n]+/gu, ' ')
            .replace(/\n{3,}/gu, '\n\n')
            .trim();
        if (!terminalById(terminalId)) {
            return { ok: false, code: 'terminal', message: '요청할 터미널을 선택해 주세요.' };
        }
        if (!typeById(type)) {
            return { ok: false, code: 'type', message: '요청 종류(시설·정비·수리·A/S)를 골라 주세요.' };
        }
        if (hasTitleField) {
            if (!title) {
                return { ok: false, code: 'title_empty', message: '제목을 적어 주세요.' };
            }
            if (title.length < 2) {
                return { ok: false, code: 'title_short', message: '제목은 두 글자 이상 적어 주세요.' };
            }
            if (title.length > MAX_TITLE) {
                return { ok: false, code: 'title_long', message: `제목은 ${MAX_TITLE}자까지 적을 수 있어요.` };
            }
        }
        if (!content) {
            return { ok: false, code: 'empty', message: '요청 내용을 적어 주세요.' };
        }
        if (content.length < 2) {
            return { ok: false, code: 'short', message: '요청 내용을 두 글자 이상 적어 주세요.' };
        }
        if (content.length > MAX_CONTENT) {
            return { ok: false, code: 'long', message: `요청 내용은 ${MAX_CONTENT}자까지 적을 수 있어요.` };
        }
        return { ok: true, terminalId, type, title: title || deriveTitleFromContent(content), content };
    }

    function validateComment(rawText) {
        const content = String(rawText == null ? '' : rawText)
            .replace(/\s+/gu, ' ').trim();
        if (!content) {
            return { ok: false, code: 'empty', message: '댓글 내용을 적어 주세요.' };
        }
        if (content.length > MAX_COMMENT) {
            return { ok: false, code: 'long', message: `댓글은 ${MAX_COMMENT}자까지 적을 수 있어요.` };
        }
        return { ok: true, content };
    }

    function normalizeLikedBy(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const out = {};
        Object.keys(raw).forEach(key => {
            const uid = String(key || '').trim().slice(0, 128);
            if (uid && raw[key] === true) out[uid] = true;
        });
        return out;
    }

    function countLikes(likedBy) {
        return Object.keys(normalizeLikedBy(likedBy)).length;
    }

    function isLikedByUid(likedBy, uid) {
        const clean = String(uid || '').trim();
        if (!clean) return false;
        return normalizeLikedBy(likedBy)[clean] === true;
    }

    function readMillis(numVal, tsVal) {
        let millis = Number(numVal);
        if (!Number.isFinite(millis) || millis <= 0) {
            try {
                if (tsVal && typeof tsVal.toMillis === 'function') {
                    millis = Number(tsVal.toMillis());
                }
            } catch (_) { /* 무시 */ }
        }
        return (Number.isFinite(millis) && millis > 0) ? millis : 0;
    }

    function normalizeComment(id, requestId, data) {
        const d = data || {};
        const millis = readMillis(d.createdAtMs, d.createdAt) || Date.now();
        const updatedAtMs = readMillis(d.updatedAtMs, d.updatedAt);
        const likedBy = normalizeLikedBy(d.likedBy);
        return {
            id: String(id || ''),
            requestId: String(d.requestId || requestId || ''),
            content: String(d.content || '').slice(0, MAX_COMMENT),
            author: String(d.author || '익명***').slice(0, MAX_AUTHOR),
            anonCode: String(d.anonCode || '').slice(0, 12),
            authorUid: String(d.authorUid || '').slice(0, 128),
            likedBy,
            likeCount: Object.keys(likedBy).length,
            timestampMs: millis,
            updatedAtMs,
            edited: Boolean(updatedAtMs && updatedAtMs > millis),
            local: Boolean(d.local)
        };
    }

    function normalizeRequest(id, data) {
        const d = data || {};
        const terminal = terminalById(d.terminalId);
        const type = typeById(d.type);
        const isLocal = Boolean(d.local);
        const millis = readMillis(d.createdAtMs, d.createdAt) || Date.now();
        const updatedAtMs = readMillis(d.updatedAtMs, d.updatedAt);
        const resolvedAtMs = readMillis(d.resolvedAtMs, d.resolvedAt);

        const rawImages = Array.isArray(d.imageUrls) && d.imageUrls.length
            ? d.imageUrls
            : (d.imageUrl ? [d.imageUrl] : (isLocal && Array.isArray(d.pendingPhotoDataUrls) ? d.pendingPhotoDataUrls : []));

        const likedBy = normalizeLikedBy(d.likedBy);
        const localComments = isLocal && Array.isArray(d.localComments)
            ? d.localComments.map(item => normalizeComment(item && item.id, id, { ...item, local: true }))
            : [];
        const rawCommentCount = Math.floor(Number(d.commentCount) || 0);
        const commentCount = isLocal
            ? Math.max(localComments.length, Math.max(0, rawCommentCount))
            : Math.max(0, Math.min(2000, rawCommentCount));

        const status = STATUS_LABEL[d.status] ? d.status : 'received';
        const content = String(d.content || '').slice(0, MAX_CONTENT);
        const explicitTitle = String(d.title || '').replace(/\s+/gu, ' ').trim().slice(0, MAX_TITLE);
        const title = explicitTitle || deriveTitleFromContent(content) || '시설·정비 A/S 요청';

        return {
            id: String(id || ''),
            terminalId: terminal ? terminal.id : '',
            terminalShort: terminal ? terminal.short : String(d.terminalLabel || '기타').slice(0, 10),
            terminalLabel: terminal ? terminal.label : String(d.terminalLabel || '기타').slice(0, 40),
            type: type ? type.id : 'other',
            typeLabel: type ? type.label : '기타',
            typeIcon: type ? type.icon : '📌',
            title,
            hasExplicitTitle: Boolean(explicitTitle),
            content,
            author: String(d.author || '익명***').slice(0, MAX_AUTHOR),
            anonCode: String(d.anonCode || '').slice(0, 12),
            authorUid: String(d.authorUid || '').slice(0, 128),
            imageUrls: normalizeImageUrls(rawImages, isLocal),
            status,
            statusLabel: STATUS_LABEL[status] || '접수',
            resolvedAtMs,
            likedBy,
            likeCount: Object.keys(likedBy).length,
            commentCount,
            localComments,
            timestampMs: millis,
            updatedAtMs,
            edited: Boolean(updatedAtMs && updatedAtMs > millis),
            local: isLocal
        };
    }

    function filterRequests(list, terminalId) {
        const items = Array.isArray(list) ? list : [];
        if (!terminalId || terminalId === FILTER_ALL) return items.slice();
        return items.filter(item => item.terminalId === terminalId);
    }

    function sortRequests(list) {
        return (Array.isArray(list) ? list : []).slice()
            .sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0));
    }

    function isRecentPost(timestampMs, nowMs = Date.now()) {
        const ts = Number(timestampMs);
        const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
        if (!Number.isFinite(ts) || ts <= 0) return false;
        return (now - ts) < NEW_POST_WINDOW_MS;
    }

    function formatRelativeTime(timestampMs, nowMs) {
        const ts = Number(timestampMs);
        const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
        if (!Number.isFinite(ts) || ts <= 0) return '방금';
        const diff = Math.max(0, now - ts);
        if (diff < 60 * 1000) return '방금';
        if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}분 전`;
        if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}시간 전`;
        if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}일 전`;
        const date = new Date(ts);
        return `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, '0')}`;
    }

    /* ==================================================================
       저장소 (Firestore + Storage + 오프라인 임시 접수)
       ================================================================== */

    function asFirestore() {
        try {
            if (typeof db !== 'undefined' && db && typeof db.collection === 'function') return db;
        } catch (_) {}
        try {
            if (typeof global.db !== 'undefined' && global.db && typeof global.db.collection === 'function') return global.db;
        } catch (_) {}
        try {
            if (global.firebase && typeof global.firebase.firestore === 'function') return global.firebase.firestore();
        } catch (_) {}
        return null;
    }

    function asStorage() {
        try {
            if (typeof storage !== 'undefined' && storage && typeof storage.ref === 'function') return storage;
        } catch (_) {}
        try {
            if (typeof global.storage !== 'undefined' && global.storage && typeof global.storage.ref === 'function') return global.storage;
        } catch (_) {}
        try {
            if (global.firebase && typeof global.firebase.storage === 'function') return global.firebase.storage();
        } catch (_) {}
        return null;
    }

    function asAuth() {
        try {
            if (typeof auth !== 'undefined' && auth) return auth;
        } catch (_) {}
        try {
            if (typeof global.auth !== 'undefined' && global.auth) return global.auth;
        } catch (_) {}
        try {
            if (global.firebase && typeof global.firebase.auth === 'function') return global.firebase.auth();
        } catch (_) {}
        return null;
    }

    function serverTimestamp() {
        try {
            const firebase = global.firebase;
            return firebase && firebase.firestore && firebase.firestore.FieldValue
                ? firebase.firestore.FieldValue.serverTimestamp()
                : null;
        } catch (_) {
            return null;
        }
    }

    function fieldDelete() {
        try {
            const fv = global.firebase && global.firebase.firestore && global.firebase.firestore.FieldValue;
            if (fv && typeof fv.delete === 'function') return fv.delete();
        } catch (_) {}
        return { __deleteField: true };
    }

    function fieldIncrement(delta) {
        try {
            const fv = global.firebase && global.firebase.firestore && global.firebase.firestore.FieldValue;
            if (fv && typeof fv.increment === 'function') return fv.increment(delta);
        } catch (_) {}
        return null;
    }

    /** Firestore 문서 모양 — 로컬 임시 접수본을 그대로 다시 올릴 때도 이 모양을 씁니다. */
    function toFirestoreDoc(entry) {
        const doc = {
            terminalId: entry.terminalId,
            terminalLabel: entry.terminalLabel,
            type: entry.type,
            content: entry.content,
            author: entry.author,
            anonCode: entry.anonCode,
            status: 'received',
            createdAtMs: entry.createdAtMs
        };
        if (entry.title) doc.title = String(entry.title).slice(0, MAX_TITLE);
        if (entry.authorUid) doc.authorUid = String(entry.authorUid);
        const urls = normalizeImageUrls(entry.imageUrls, false);
        if (urls.length) doc.imageUrls = urls;
        if (Number(entry.updatedAtMs) > 0) doc.updatedAtMs = Number(entry.updatedAtMs);
        const stamp = serverTimestamp();
        if (stamp) doc.createdAt = stamp;
        return doc;
    }

    let currentAuthUid = '';

    function resolveCurrentUid(authUser) {
        if (authUser && authUser.uid) {
            currentAuthUid = String(authUser.uid);
            return currentAuthUid;
        }
        try {
            const authObj = asAuth();
            if (authObj && authObj.currentUser && authObj.currentUser.uid) {
                currentAuthUid = String(authObj.currentUser.uid);
                return currentAuthUid;
            }
        } catch (_) {}
        return currentAuthUid;
    }

    function isAdminSession() {
        try {
            if (typeof isAdminSessionVerified !== 'undefined' && isAdminSessionVerified) return true;
        } catch (_) {}
        try {
            if (global.isAdminSessionVerified) return true;
        } catch (_) {}
        const uid = resolveCurrentUid();
        return uid === 'admin_luxrank' || uid === 'luxrank_admin_uid';
    }

    /** 규칙이 isSignedIn() 을 요구하므로 쓰기 전에 자동 익명 인증을 확인합니다(비밀번호 없음). */
    async function ensureAsAuth() {
        try {
            let fn = null;
            try {
                if (typeof ensureAnonymousAuth === 'function') fn = ensureAnonymousAuth;
            } catch (_) {}
            if (!fn && typeof global.ensureAnonymousAuth === 'function') fn = global.ensureAnonymousAuth;
            if (fn) {
                const user = await fn();
                if (user) {
                    resolveCurrentUid(user);
                    return user;
                }
            }
            const authObj = asAuth();
            if (authObj && authObj.currentUser) {
                resolveCurrentUid(authObj.currentUser);
                return authObj.currentUser;
            }
        } catch (_) { /* 실패하면 오프라인 임시 접수로 넘어갑니다 */ }
        return null;
    }

    function compressPhotoIfPossible(file, options) {
        try {
            let fn = null;
            try {
                if (typeof compressImageForUpload === 'function') fn = compressImageForUpload;
            } catch (_) {}
            if (!fn && typeof global.compressImageForUpload === 'function') fn = global.compressImageForUpload;
            if (fn) return Promise.resolve(fn(file, options));
        } catch (_) {}
        return Promise.resolve(file);
    }

    function readFileAsDataUrl(file) {
        const Reader = (typeof FileReader !== 'undefined' ? FileReader : global.FileReader);
        if (typeof Reader !== 'function') return Promise.resolve('');
        return new Promise((resolve) => {
            try {
                const reader = new Reader();
                reader.onload = e => resolve(String((e && e.target && e.target.result) || ''));
                reader.onerror = () => resolve('');
                reader.readAsDataURL(file);
            } catch (_) {
                resolve('');
            }
        });
    }

    async function fileToCompactDataUrl(file) {
        const optimized = await compressPhotoIfPossible(file, {
            maxDimension: 900,
            targetMaxBytes: 220 * 1024,
            skipUnderBytes: 120 * 1024,
            force: true
        });
        const dataUrl = await readFileAsDataUrl(optimized || file);
        return isSafePhotoUrl(dataUrl, true) ? dataUrl : '';
    }

    function dataUrlToBlob(dataUrl) {
        const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(dataUrl || ''));
        if (!match) return null;
        try {
            const atobFn = typeof atob === 'function' ? atob : global.atob;
            const BlobCtor = typeof Blob === 'function' ? Blob : global.Blob;
            if (typeof atobFn !== 'function' || typeof BlobCtor !== 'function') return null;
            const binary = atobFn(match[2]);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            return new BlobCtor([bytes], { type: match[1] });
        } catch (_) {
            return null;
        }
    }

    async function uploadSinglePhoto(docId, fileOrBlob, originalName, index) {
        const storageObj = asStorage();
        if (!storageObj) throw new Error('storage-unavailable');
        const optimized = await compressPhotoIfPossible(fileOrBlob, {
            maxDimension: 1600,
            targetMaxBytes: 1.5 * 1024 * 1024
        });
        const target = optimized || fileOrBlob;
        const rawName = (target && target.name) || originalName || `photo_${index + 1}.jpg`;
        const safeName = String(rawName).replace(/[^\w.\-가-힣]/g, '_');
        const path = `${STORAGE_DIR}/${docId}/${Date.now()}_${index}_${safeName}`;
        const ref = storageObj.ref(path);
        const snap = await ref.put(target);
        const snapRef = (snap && snap.ref) ? snap.ref : ref;
        const url = await snapRef.getDownloadURL();
        if (!isSafePhotoUrl(url, false)) throw new Error('invalid-photo-url');
        return url;
    }

    async function uploadPendingPhotos(docId, photos, onProgress) {
        const urls = [];
        for (let i = 0; i < photos.length; i += 1) {
            if (typeof onProgress === 'function') onProgress(i + 1, photos.length);
            const item = photos[i];
            const url = await uploadSinglePhoto(docId, item.file, item.name, i);
            urls.push(url);
        }
        return urls;
    }

    function deleteStoragePhotoByUrl(url) {
        const safe = String(url || '').trim();
        if (!isSafePhotoUrl(safe, false) || !safe.includes(STORAGE_DIR)) return;
        try {
            const storageObj = asStorage();
            if (storageObj && typeof storageObj.refFromURL === 'function') {
                Promise.resolve(storageObj.refFromURL(safe).delete()).catch(() => {});
            }
        } catch (_) { /* 스토리지 정리는 최선 노력으로만 처리합니다 */ }
    }

    function readLocalRequests() {
        try {
            const raw = global.localStorage?.getItem(LOCAL_KEY);
            const parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed.slice(0, MAX_LOCAL) : [];
        } catch (_) {
            return [];
        }
    }

    function writeLocalRequests(list) {
        try {
            global.localStorage?.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, MAX_LOCAL)));
        } catch (_) { /* 저장 불가 브라우저에서는 이번 화면에서만 유지합니다 */ }
    }

    function saveLocalRequest(entry) {
        const list = readLocalRequests().filter(item => item && item.id !== entry.id);
        list.unshift(entry);
        writeLocalRequests(list);
    }

    function readIdSet(key) {
        try {
            const raw = global.localStorage?.getItem(key);
            const parsed = JSON.parse(raw || '[]');
            return new Set(Array.isArray(parsed) ? parsed.map(String).slice(0, MAX_OWNED_IDS) : []);
        } catch (_) {
            return new Set();
        }
    }

    function writeIdSet(key, setObj) {
        try {
            const list = Array.from(setObj).slice(-MAX_OWNED_IDS);
            global.localStorage?.setItem(key, JSON.stringify(list));
            return new Set(list);
        } catch (_) {
            return setObj;
        }
    }

    let ownedRequestIds = readIdSet(MINE_KEY);
    let ownedCommentIds = readIdSet(MINE_COMMENTS_KEY);

    function rememberOwnedId(id) {
        const clean = String(id || '').trim();
        if (!clean) return;
        ownedRequestIds.add(clean);
        ownedRequestIds = writeIdSet(MINE_KEY, ownedRequestIds);
    }

    function forgetOwnedId(id) {
        const clean = String(id || '').trim();
        if (!clean) return;
        ownedRequestIds.delete(clean);
        ownedRequestIds = writeIdSet(MINE_KEY, ownedRequestIds);
    }

    function rememberOwnedCommentId(id) {
        const clean = String(id || '').trim();
        if (!clean) return;
        ownedCommentIds.add(clean);
        ownedCommentIds = writeIdSet(MINE_COMMENTS_KEY, ownedCommentIds);
    }

    function forgetOwnedCommentId(id) {
        const clean = String(id || '').trim();
        if (!clean) return;
        ownedCommentIds.delete(clean);
        ownedCommentIds = writeIdSet(MINE_COMMENTS_KEY, ownedCommentIds);
    }

    function pendingLocalEntries() {
        return readLocalRequests().filter(item => item && item.local && String(item.id || '').length > 0);
    }

    /** 연결이 돌아오면 오프라인 임시 접수본을 같은 문서 ID로 다시 올립니다(중복 접수 방지). */
    async function flushLocalQueue(store) {
        const pending = pendingLocalEntries();
        if (!pending.length) return;
        const authUser = await ensureAsAuth();
        const uid = resolveCurrentUid(authUser);
        if (!uid) return;

        const uploaded = new Set();
        for (const item of pending) {
            try {
                let imageUrls = normalizeImageUrls(item.imageUrls, false);
                const pendingDataUrls = Array.isArray(item.pendingPhotoDataUrls) ? item.pendingPhotoDataUrls : [];
                if (pendingDataUrls.length) {
                    if (!asStorage()) continue;
                    const uploadedPhotos = [];
                    for (let i = 0; i < pendingDataUrls.length; i += 1) {
                        const blob = dataUrlToBlob(pendingDataUrls[i]);
                        if (!blob) continue;
                        const url = await uploadSinglePhoto(item.id, blob, `offline_${i + 1}.jpg`, i);
                        uploadedPhotos.push(url);
                    }
                    imageUrls = normalizeImageUrls(imageUrls.concat(uploadedPhotos), false);
                }
                const payload = {
                    ...item,
                    authorUid: uid,
                    imageUrls,
                    local: false
                };
                const docRef = store.collection(COLLECTION).doc(item.id);
                await docRef.set(toFirestoreDoc(payload));
                rememberOwnedId(item.id);

                if (item.status === 'done') {
                    try {
                        await docRef.update({
                            status: 'done',
                            resolvedAtMs: Number(item.resolvedAtMs || Date.now())
                        });
                    } catch (_) {}
                }

                const localComments = Array.isArray(item.localComments) ? item.localComments : [];
                if (localComments.length && typeof docRef.collection === 'function') {
                    let syncedComments = 0;
                    for (const comment of localComments) {
                        try {
                            const cid = String(comment.id || `c-${Date.now()}`);
                            await docRef.collection(COMMENTS_COLLECTION).doc(cid).set({
                                requestId: item.id,
                                content: String(comment.content || '').slice(0, MAX_COMMENT),
                                author: String(comment.author || item.author || '익명***').slice(0, MAX_AUTHOR),
                                anonCode: String(comment.anonCode || makeAnonCode()),
                                authorUid: uid,
                                createdAtMs: Number(comment.createdAtMs || comment.timestampMs || Date.now())
                            });
                            rememberOwnedCommentId(cid);
                            syncedComments += 1;
                        } catch (_) {}
                    }
                    if (syncedComments > 0) {
                        try {
                            await docRef.update({ commentCount: syncedComments });
                        } catch (_) {}
                    }
                }
                uploaded.add(item.id);
            } catch (_) { /* 다음 연결 때 다시 시도합니다 */ }
        }
        if (!uploaded.size) return;
        writeLocalRequests(readLocalRequests().filter(item => !uploaded.has(item.id)));
        localEntries = readLocalRequests().map(entry => normalizeRequest(entry.id, entry));
        renderAll();
    }

    function moderateAsText(content, author, categoryLabel) {
        try {
            if (typeof global.inspectCommunityContent === 'function') {
                const result = global.inspectCommunityContent({
                    text: content,
                    author: author,
                    category: categoryLabel || '터미널 시설·정비 A/S 요청'
                });
                if (result && typeof result === 'object') return result;
            }
        } catch (_) { /* 필터가 없으면 통과 */ }
        return { hidden: false, reason: null };
    }

    function notifyBlind(info) {
        try {
            if (typeof global.notifyAdminAutoBlind === 'function') global.notifyAdminAutoBlind(info);
        } catch (_) { /* 알림 실패는 접수를 막지 않습니다 */ }
    }

    function askConfirm(message) {
        let fn = null;
        try {
            if (typeof confirm === 'function') fn = confirm;
        } catch (_) {}
        if (!fn && typeof global.confirm === 'function') fn = global.confirm;
        return fn ? Boolean(fn(message)) : true;
    }

    function openPhotoModal(url) {
        if (!isSafePhotoUrl(url, true)) return;
        try {
            if (typeof resetPncBusModalState === 'function') resetPncBusModalState();
            else if (typeof global.resetPncBusModalState === 'function') global.resetPncBusModalState();
            else {
                ['modalImageTitle', 'modalImageStatus', 'pncBusFileInput', 'pncBusAdminBtn'].forEach(id => {
                    const node = byId(id);
                    if (node) node.classList.add('hidden');
                });
            }
        } catch (_) {}
        const modal = byId('imageModal');
        const img = byId('modalImage');
        if (modal && img) {
            img.src = url;
            modal.style.display = 'flex';
        }
    }

    /* ==================================================================
       화면 상태
       ================================================================== */

    let feedEntries = [];       // Firestore 최근 요청
    let headEntries = [];       // 접힌 상태에서도 새 게시물 감지용 최근 요약
    let feedLoaded = false;
    let localEntries = [];      // 오프라인 임시 접수
    let pendingPhotos = [];     // 새로 첨부한 사진 { id, file, name, size, previewUrl }
    let editingRequestId = null;
    let editingOriginalEntry = null;
    let editingExistingUrls = [];
    const openRequestIds = new Set();
    const openCommentIds = new Set();
    const commentsByRequest = new Map();
    const commentUnsubscribers = new Map();
    const draftCommentText = new Map();
    let unsubscribe = null;
    let headUnsubscribe = null;
    let visibilityObserver = null;
    let boardVisible = false;
    let isSubmitting = false;
    let isFormOpen = false;
    let currentPage = 1;
    let activeTerminal = FILTER_ALL;

    function byId(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (typeof text === 'string') node.textContent = text;
        return node;
    }

    function setStatus(message, tone = 'neutral') {
        const box = byId('tasStatus');
        if (!box) return;
        box.textContent = message;
        box.className = `tas-status is-${tone}`;
    }

    function setLiveBadge(isLive) {
        const badge = byId('tasLiveBadge');
        if (!badge) return;
        badge.textContent = isLive ? '🟢 실시간 공유 중' : '⚪ 오프라인 접수';
        badge.classList.toggle('is-live', Boolean(isLive));
    }

    function setBusy(busy, label) {
        const submit = byId('tasSubmit');
        if (!submit) return;
        submit.disabled = Boolean(busy);
        if (busy) {
            submit.textContent = label || (editingRequestId ? '수정 중…' : '접수 중…');
        } else {
            submit.textContent = editingRequestId ? '수정 저장' : '요청 접수';
        }
    }

    function updateAuthorPreview() {
        const preview = byId('tasAuthorPreview');
        const code = byId('tasAnonCode');
        const select = byId('tasTerminalSelect');
        const identity = buildAnonymousIdentity(select ? select.value : '');
        if (preview) preview.textContent = identity.author;
        if (code) {
            const preserved = editingOriginalEntry && editingOriginalEntry.anonCode
                ? editingOriginalEntry.anonCode
                : identity.anonCode;
            code.textContent = `#${preserved}`;
        }
    }

    function canManageEntry(entry) {
        if (!entry) return false;
        if (isAdminSession()) return true;
        if (entry.local) return true;
        const uid = resolveCurrentUid();
        if (uid && entry.authorUid && entry.authorUid === uid) return true;
        if (!entry.authorUid && ownedRequestIds.has(entry.id)) return true;
        if (!uid && entry.authorUid && ownedRequestIds.has(entry.id)) return true;
        return false;
    }

    function canManageComment(comment) {
        if (!comment) return false;
        if (isAdminSession()) return true;
        if (comment.local) return true;
        const uid = resolveCurrentUid();
        if (uid && comment.authorUid && comment.authorUid === uid) return true;
        if (!uid && ownedCommentIds.has(comment.id)) return true;
        return false;
    }

    function activeLikeUid(entryOrComment) {
        if (entryOrComment && entryOrComment.local) return resolveCurrentUid() || 'local-self';
        return resolveCurrentUid();
    }

    function renderPhotoPreview() {
        const box = byId('tasPhotoPreview');
        const countNode = byId('tasPhotoCount');
        const totalCount = editingExistingUrls.length + pendingPhotos.length;
        if (countNode) {
            countNode.textContent = totalCount ? `${totalCount}/${MAX_PHOTOS}장` : `(최대 ${MAX_PHOTOS}장)`;
        }
        if (!box) return;
        box.textContent = '';
        if (!totalCount) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        editingExistingUrls.forEach((url, idx) => {
            const card = el('div', 'tas-photo-thumb-wrap');
            const img = el('img', 'tas-photo-thumb');
            img.setAttribute('src', url);
            img.setAttribute('alt', `기존 현장 사진 ${idx + 1}`);
            img.addEventListener('click', () => openPhotoModal(url));
            const tag = el('span', 'tas-photo-tag', '기존');
            const removeBtn = el('button', 'tas-photo-remove', '×');
            removeBtn.setAttribute('type', 'button');
            removeBtn.setAttribute('aria-label', `기존 사진 ${idx + 1} 제거`);
            removeBtn.addEventListener('click', () => {
                editingExistingUrls.splice(idx, 1);
                renderPhotoPreview();
            });
            card.appendChild(img);
            card.appendChild(tag);
            card.appendChild(removeBtn);
            box.appendChild(card);
        });
        pendingPhotos.forEach((photo, idx) => {
            const card = el('div', 'tas-photo-thumb-wrap');
            if (photo.previewUrl) {
                const img = el('img', 'tas-photo-thumb');
                img.setAttribute('src', photo.previewUrl);
                img.setAttribute('alt', photo.name || `첨부 사진 ${idx + 1}`);
                img.addEventListener('click', () => openPhotoModal(photo.previewUrl));
                card.appendChild(img);
            } else {
                card.appendChild(el('span', 'tas-photo-placeholder', '📷'));
            }
            const label = el('span', 'tas-photo-tag', photo.name ? photo.name.slice(0, 10) : '새 사진');
            const removeBtn = el('button', 'tas-photo-remove', '×');
            removeBtn.setAttribute('type', 'button');
            removeBtn.setAttribute('aria-label', `첨부 사진 ${idx + 1} 제거`);
            removeBtn.addEventListener('click', () => {
                pendingPhotos = pendingPhotos.filter(item => item.id !== photo.id);
                renderPhotoPreview();
            });
            card.appendChild(label);
            card.appendChild(removeBtn);
            box.appendChild(card);
        });
    }

    function allEntries() {
        // Firestore 문서와 로컬 임시 접수를 합치고 같은 id 는 한 번만 보여줍니다.
        const merged = new Map();
        localEntries.forEach(entry => merged.set(entry.id, entry));
        (feedLoaded ? feedEntries : headEntries).forEach(entry => merged.set(entry.id, entry));
        return sortRequests(Array.from(merged.values()));
    }

    function updateCardNewBadge() {
        const entries = allEntries();
        const now = Date.now();
        const newCount = entries.filter(entry => isRecentPost(entry.timestampMs, now)).length;

        const badge = byId('tasBadge');
        if (badge) {
            badge.classList.toggle('hidden', newCount === 0);
            badge.textContent = 'NEW';
            if (newCount > 0) badge.setAttribute('aria-label', `새 게시물 ${newCount}건`);
            else badge.setAttribute('aria-label', '새 게시물');
        }
    }

    function setFormOpen(open, { focusTitle = false } = {}) {
        isFormOpen = Boolean(open);
        const form = byId('tasForm');
        const toggleBtn = byId('tasToggleFormBtn');
        if (form) {
            if (isFormOpen) form.classList.remove('hidden');
            else form.classList.add('hidden');
        }
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', isFormOpen ? 'true' : 'false');
            toggleBtn.textContent = isFormOpen
                ? (editingRequestId ? '✏️ 요청 수정 중 (접기)' : '✖️ 글쓰기 닫기')
                : '✍️ A/S 요청 글쓰기';
        }
        if (isFormOpen && focusTitle) {
            try {
                (byId('tasTitle') || byId('tasContent'))?.focus?.();
            } catch (_) {}
        }
    }

    function renderCommentsSection(entry) {
        const panel = el('div', 'tas-comments-panel');
        const list = el('ul', 'tas-comment-list');
        const comments = entry.local
            ? (entry.localComments || [])
            : (commentsByRequest.get(entry.id) || []);
        const likeUid = activeLikeUid(entry);

        if (!comments.length) {
            list.appendChild(el('li', 'tas-comment-empty', '아직 댓글이 없어요. 첫 댓글을 남겨 주세요.'));
        } else {
            comments.forEach(comment => {
                const row = el('li', 'tas-comment-item');
                const head = el('div', 'tas-comment-head');
                head.appendChild(el('span', 'tas-comment-author', comment.author));
                if (comment.anonCode) head.appendChild(el('span', 'tas-comment-code', `#${comment.anonCode}`));
                if (entry.authorUid && comment.authorUid && entry.authorUid === comment.authorUid) {
                    head.appendChild(el('span', 'tas-comment-writer-badge', '글쓴이'));
                }
                head.appendChild(el('span', 'tas-comment-time', formatRelativeTime(comment.timestampMs, Date.now())));
                row.appendChild(head);

                row.appendChild(el('p', 'tas-comment-text', comment.content));

                const foot = el('div', 'tas-comment-foot');
                const cLiked = isLikedByUid(comment.likedBy, likeUid);
                const cLikeCount = countLikes(comment.likedBy);
                const cLikeBtn = el(
                    'button',
                    'tas-comment-like-btn' + (cLiked ? ' is-liked' : ''),
                    cLikeCount ? `❤️ 좋아요 ${cLikeCount}` : '🤍 좋아요'
                );
                cLikeBtn.setAttribute('type', 'button');
                cLikeBtn.setAttribute('aria-pressed', cLiked ? 'true' : 'false');
                cLikeBtn.setAttribute('aria-label', `댓글 좋아요 ${cLikeCount}개`);
                cLikeBtn.addEventListener('click', () => void toggleCommentLike(entry, comment));
                foot.appendChild(cLikeBtn);

                if (canManageComment(comment)) {
                    const delBtn = el('button', 'tas-comment-del-btn', '🗑️ 삭제');
                    delBtn.setAttribute('type', 'button');
                    delBtn.setAttribute('aria-label', '댓글 삭제');
                    delBtn.addEventListener('click', () => void deleteComment(entry, comment));
                    foot.appendChild(delBtn);
                }
                row.appendChild(foot);
                list.appendChild(row);
            });
        }
        panel.appendChild(list);

        const form = el('form', 'tas-comment-form');
        form.setAttribute('autocomplete', 'off');
        const input = el('input', 'tas-comment-input');
        input.setAttribute('type', 'text');
        input.setAttribute('maxlength', String(MAX_COMMENT));
        input.setAttribute('placeholder', '댓글을 입력하세요 (비밀번호 없이 자동 작성)');
        input.setAttribute('aria-label', `${entry.terminalLabel} 요청 댓글 입력`);
        input.value = draftCommentText.get(entry.id) || '';
        input.addEventListener('input', () => {
            draftCommentText.set(entry.id, input.value);
        });

        const submitBtn = el('button', 'tas-comment-submit', '등록');
        submitBtn.setAttribute('type', 'submit');
        form.addEventListener('submit', e => {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            void submitComment(entry, input);
        });
        form.appendChild(input);
        form.appendChild(submitBtn);
        panel.appendChild(form);
        return panel;
    }

    function toggleRequestDetail(entry) {
        if (!entry || !entry.id) return;
        if (openRequestIds.has(entry.id)) {
            openRequestIds.delete(entry.id);
            openCommentIds.delete(entry.id);
            stopCommentSubscription(entry.id);
        } else {
            openRequestIds.add(entry.id);
            openCommentIds.add(entry.id);
            if (!entry.local) startCommentSubscription(entry.id);
        }
        renderFeed();
    }

    function renderDetailCard(entry, adminActive) {
        const isDone = entry.status === 'done';
        const card = el('div', 'tas-detail-card'
            + (entry.local ? ' is-local' : '')
            + (isDone ? ' is-done' : '')
            + (editingRequestId === entry.id ? ' is-editing' : ''));

        const top = el('div', 'tas-feed-top');
        top.appendChild(el('span', 'tas-terminal-badge', entry.terminalLabel));
        top.appendChild(el('span', 'tas-type-badge', `${entry.typeIcon} ${entry.typeLabel}`));
        if (isRecentPost(entry.timestampMs, Date.now())) {
            top.appendChild(el('span', 'badge-new', 'NEW'));
        }
        const statusText = isDone ? '✅ 조치완료' : entry.statusLabel;
        top.appendChild(el('span', 'tas-status-badge is-' + entry.status, statusText));
        card.appendChild(top);

        if (entry.title) {
            card.appendChild(el('h4', 'tas-detail-title', entry.title));
        }
        card.appendChild(el('p', 'tas-feed-content', entry.content));

        if (Array.isArray(entry.imageUrls) && entry.imageUrls.length) {
            const gallery = el('div', 'tas-feed-photos');
            entry.imageUrls.forEach((url, idx) => {
                const thumbBtn = el('button', 'tas-feed-photo-btn');
                thumbBtn.setAttribute('type', 'button');
                thumbBtn.setAttribute('aria-label', `현장 사진 ${idx + 1} 크게 보기`);
                const img = el('img', 'tas-feed-photo');
                img.setAttribute('src', url);
                img.setAttribute('loading', 'lazy');
                img.setAttribute('alt', `${entry.terminalLabel} 현장 사진 ${idx + 1}`);
                thumbBtn.appendChild(img);
                thumbBtn.addEventListener('click', () => openPhotoModal(url));
                gallery.appendChild(thumbBtn);
            });
            card.appendChild(gallery);
        }

        const bottom = el('div', 'tas-feed-bottom');
        bottom.appendChild(el('span', 'tas-feed-author', entry.author));
        if (entry.anonCode) bottom.appendChild(el('span', 'tas-feed-code', `#${entry.anonCode}`));
        if (entry.edited) bottom.appendChild(el('span', 'tas-feed-edited', '· 수정됨'));
        if (isDone && entry.resolvedAtMs) {
            bottom.appendChild(el('span', 'tas-feed-resolved', `· 완료 ${formatRelativeTime(entry.resolvedAtMs, Date.now())}`));
        }
        if (entry.local) bottom.appendChild(el('span', 'tas-feed-local', '📴 이 기기에만 저장'));
        bottom.appendChild(el('span', 'tas-feed-time', formatRelativeTime(entry.timestampMs, Date.now())));
        card.appendChild(bottom);

        /* ---- 누구나 누를 수 있는 좋아요 · 댓글 · 조치 완료 + 작성자/관리자 관리 바 ---- */
        const actions = el('div', 'tas-item-actions');
        const likeUid = activeLikeUid(entry);
        const postLiked = isLikedByUid(entry.likedBy, likeUid);
        const postLikes = countLikes(entry.likedBy);
        const likeBtn = el(
            'button',
            'tas-like-btn' + (postLiked ? ' is-liked' : ''),
            postLikes ? `❤️ 좋아요 ${postLikes}` : '🤍 좋아요'
        );
        likeBtn.setAttribute('type', 'button');
        likeBtn.setAttribute('aria-pressed', postLiked ? 'true' : 'false');
        likeBtn.setAttribute('aria-label', `${entry.terminalLabel} 요청 좋아요 ${postLikes}개`);
        likeBtn.addEventListener('click', () => void togglePostLike(entry));
        actions.appendChild(likeBtn);

        const loadedComments = commentsByRequest.get(entry.id);
        const cCount = entry.local
            ? (entry.localComments || []).length
            : (loadedComments ? loadedComments.length : entry.commentCount);
        const isCommentsOpen = openCommentIds.has(entry.id);
        const cmtBtn = el(
            'button',
            'tas-comment-toggle-btn' + (isCommentsOpen ? ' is-open' : ''),
            cCount ? `💬 댓글 ${cCount}` : '💬 댓글'
        );
        cmtBtn.setAttribute('type', 'button');
        cmtBtn.setAttribute('aria-expanded', isCommentsOpen ? 'true' : 'false');
        cmtBtn.setAttribute('aria-label', `${entry.terminalLabel} 요청 댓글 ${cCount}개`);
        cmtBtn.addEventListener('click', () => toggleComments(entry));
        actions.appendChild(cmtBtn);

        if (!isDone) {
            const resolveBtn = el('button', 'tas-item-btn is-resolve', '✅ 조치 완료');
            resolveBtn.setAttribute('type', 'button');
            resolveBtn.setAttribute('aria-label', `${entry.terminalLabel} 요청 조치 완료로 표시`);
            resolveBtn.addEventListener('click', () => void resolveAsRequest(entry));
            actions.appendChild(resolveBtn);
        } else {
            const doneBadgeBtn = el('button', 'tas-item-btn is-resolved-done', '✅ 조치완료됨');
            doneBadgeBtn.setAttribute('type', 'button');
            doneBadgeBtn.disabled = true;
            doneBadgeBtn.setAttribute('aria-label', '조치완료된 요청');
            actions.appendChild(doneBadgeBtn);
        }

        if (canManageEntry(entry)) {
            const manageGroup = el('div', 'tas-item-manage');
            if (adminActive && !entry.local) {
                const statusSel = el('select', 'tas-admin-status');
                statusSel.setAttribute('aria-label', '처리 상태 변경');
                Object.entries(STATUS_LABEL).forEach(([key, label]) => {
                    const opt = el('option', '', label);
                    opt.setAttribute('value', key);
                    statusSel.appendChild(opt);
                });
                statusSel.value = entry.status;
                statusSel.addEventListener('change', () => void updateAdminStatus(entry, statusSel.value));
                manageGroup.appendChild(statusSel);
            }
            const editBtn = el('button', 'tas-item-btn is-edit', '✏️ 수정');
            editBtn.setAttribute('type', 'button');
            editBtn.setAttribute('aria-label', `${entry.terminalLabel} 요청 수정`);
            editBtn.addEventListener('click', () => startEditRequest(entry));

            const delBtn = el('button', 'tas-item-btn is-delete', '🗑️ 삭제');
            delBtn.setAttribute('type', 'button');
            delBtn.setAttribute('aria-label', `${entry.terminalLabel} 요청 삭제`);
            delBtn.addEventListener('click', () => void deleteAsRequest(entry));

            manageGroup.appendChild(editBtn);
            manageGroup.appendChild(delBtn);
            actions.appendChild(manageGroup);
        }
        card.appendChild(actions);

        if (isCommentsOpen) {
            card.appendChild(renderCommentsSection(entry));
        }
        return card;
    }

    function renderPagination(totalItems) {
        const pager = byId('tasPagination');
        if (!pager) return;
        pager.textContent = '';
        const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
        if (totalPages <= 1) {
            pager.hidden = true;
            return;
        }
        pager.hidden = false;
        for (let page = 1; page <= totalPages; page += 1) {
            const btn = el('button', 'tas-page-btn' + (page === currentPage ? ' is-active' : ''), String(page));
            btn.setAttribute('type', 'button');
            btn.setAttribute('aria-label', `${page}페이지`);
            if (page === currentPage) btn.setAttribute('aria-current', 'page');
            btn.addEventListener('click', () => {
                currentPage = page;
                renderFeed();
            });
            pager.appendChild(btn);
        }
    }

    function renderFeed() {
        const feed = byId('tasFeed');
        if (!feed) return;
        feed.textContent = '';
        const visible = filterRequests(allEntries(), activeTerminal);
        const total = allEntries().length;
        const totalNode = byId('tasTotal');
        const terminalTotalNode = byId('tasTerminalTotal');
        const metaNode = byId('tasFeedMeta');
        if (totalNode) totalNode.textContent = String(total);
        if (terminalTotalNode) terminalTotalNode.textContent = String(visible.length);
        if (metaNode) {
            const label = activeTerminal === FILTER_ALL ? '전체 터미널' : (terminalById(activeTerminal)?.short || '터미널');
            metaNode.textContent = `${label} · ${visible.length}건 (제목 클릭 시 열람)`;
        }

        const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        renderPagination(visible.length);

        if (!visible.length) {
            const emptyRow = el('tr', 'tas-empty-row');
            const emptyCell = el('td', 'tas-feed-empty', '아직 접수된 요청이 없어요. 첫 요청을 남겨 주세요.');
            emptyCell.setAttribute('colspan', '4');
            emptyRow.appendChild(emptyCell);
            feed.appendChild(emptyRow);
            return;
        }

        const adminActive = isAdminSession();
        const start = (currentPage - 1) * PAGE_SIZE;
        const pageItems = visible.slice(start, start + PAGE_SIZE);
        const now = Date.now();

        pageItems.forEach(entry => {
            const isDone = entry.status === 'done';
            const isOpen = openRequestIds.has(entry.id);
            const row = el('tr', 'tas-board-row'
                + (isOpen ? ' is-open' : '')
                + (isDone ? ' is-done' : '')
                + (entry.local ? ' is-local' : ''));
            row.addEventListener('click', e => {
                // 버튼 내부 클릭과 이중 발화 방지
                if (e && e.target && e.target.closest && e.target.closest('.tas-row-title-btn')) return;
                toggleRequestDetail(entry);
            });

            const terminalTd = el('td', '');
            terminalTd.appendChild(el('span', 'tas-terminal-badge tas-table-terminal', entry.terminalShort || entry.terminalLabel));
            row.appendChild(terminalTd);

            const titleTd = el('td', '');
            const titleBtn = el('button', 'tas-row-title-btn');
            titleBtn.setAttribute('type', 'button');
            titleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            titleBtn.appendChild(el('span', 'tas-row-title-text', entry.title));
            if (Array.isArray(entry.imageUrls) && entry.imageUrls.length) {
                titleBtn.appendChild(el('span', 'tas-row-pill', entry.imageUrls.length > 1 ? `📷+${entry.imageUrls.length}` : '📷'));
            }
            if (isRecentPost(entry.timestampMs, now)) {
                titleBtn.appendChild(el('span', 'badge-new', 'NEW'));
            }
            const loadedComments = commentsByRequest.get(entry.id);
            const cCount = entry.local
                ? (entry.localComments || []).length
                : (loadedComments ? loadedComments.length : entry.commentCount);
            if (cCount > 0) {
                titleBtn.appendChild(el('span', 'tas-row-pill', `💬 ${cCount}`));
            }
            const postLikes = countLikes(entry.likedBy);
            if (postLikes > 0) {
                titleBtn.appendChild(el('span', 'tas-row-pill is-like', `❤️ ${postLikes}`));
            }
            titleBtn.appendChild(el('span', 'tas-row-arrow', isOpen ? '▲' : '▼'));
            titleBtn.addEventListener('click', () => toggleRequestDetail(entry));
            titleTd.appendChild(titleBtn);
            row.appendChild(titleTd);

            const dateTd = el('td', '');
            dateTd.appendChild(el('span', 'tas-row-date', formatRelativeTime(entry.timestampMs, now)));
            row.appendChild(dateTd);

            const statusTd = el('td', '');
            const statusBadgeText = isDone ? '✅ 완료' : entry.statusLabel;
            statusTd.appendChild(el('span', 'tas-status-badge is-' + entry.status, statusBadgeText));
            row.appendChild(statusTd);

            feed.appendChild(row);

            if (isOpen) {
                const detailRow = el('tr', 'tas-detail-row');
                const detailCell = el('td', '');
                detailCell.setAttribute('colspan', '4');
                detailCell.appendChild(renderDetailCard(entry, adminActive));
                detailRow.appendChild(detailCell);
                feed.appendChild(detailRow);
            }
        });
    }

    function renderFilter() {
        const box = byId('tasFilter');
        if (!box) return;
        box.textContent = '';
        const options = [{ id: FILTER_ALL, label: '전체' }].concat(
            TERMINALS.map(item => ({ id: item.id, label: item.short }))
        );
        options.forEach(option => {
            const button = el('button', 'tas-filter-chip' + (activeTerminal === option.id ? ' is-active' : ''), option.label);
            button.setAttribute('type', 'button');
            button.setAttribute('data-terminal', option.id);
            button.setAttribute('aria-pressed', activeTerminal === option.id ? 'true' : 'false');
            box.appendChild(button);
        });
    }

    function renderAll() {
        renderFilter();
        renderPhotoPreview();
        renderFeed();
        updateCardNewBadge();
    }

    /* ---------------- 조치 완료 · 좋아요 · 댓글 ---------------- */

    async function resolveAsRequest(entry) {
        if (!entry || entry.status === 'done') return;

        if (entry.local) {
            const resolvedAtMs = Date.now();
            const list = readLocalRequests().map(item => (
                item && item.id === entry.id
                    ? { ...item, status: 'done', resolvedAtMs }
                    : item
            ));
            writeLocalRequests(list);
            localEntries = list.map(item => normalizeRequest(item.id, item));
            renderFeed();
            setStatus('✅ 임시 접수를 조치완료로 표시했어요.', 'success');
            return;
        }

        const store = asFirestore();
        if (!store) {
            setStatus('❌ 오프라인 상태에서는 서버 요청을 조치완료 처리할 수 없어요.', 'error');
            return;
        }

        const prevEntry = entry;
        const resolvedAtMs = Date.now();
        feedEntries = feedEntries.map(item => (
            item.id === entry.id
                ? { ...item, status: 'done', statusLabel: STATUS_LABEL.done, resolvedAtMs }
                : item
        ));
        renderFeed();

        try {
            await ensureAsAuth();
            const payload = { status: 'done', resolvedAtMs };
            const stamp = serverTimestamp();
            if (stamp) payload.resolvedAt = stamp;
            await store.collection(COLLECTION).doc(entry.id).update(payload);
            setStatus(`✅ ${entry.terminalLabel} 요청이 조치완료로 표시되었어요.`, 'success');
        } catch (_) {
            feedEntries = feedEntries.map(item => (item.id === entry.id ? prevEntry : item));
            renderFeed();
            setStatus('❌ 조치완료 처리에 실패했어요. 네트워크 연결을 확인해 주세요.', 'error');
        }
    }

    async function togglePostLike(entry) {
        if (!entry) return;
        const store = asFirestore();
        if (entry.local) {
            const uid = activeLikeUid(entry);
            const nextLiked = !isLikedByUid(entry.likedBy, uid);
            const list = readLocalRequests().map(item => {
                if (!item || item.id !== entry.id) return item;
                const likedBy = normalizeLikedBy(item.likedBy);
                if (nextLiked) likedBy[uid] = true;
                else delete likedBy[uid];
                return { ...item, likedBy };
            });
            writeLocalRequests(list);
            localEntries = list.map(item => normalizeRequest(item.id, item));
            renderFeed();
            return;
        }
        if (!store) {
            setStatus('❌ 오프라인 상태에서는 좋아요를 반영할 수 없어요.', 'error');
            return;
        }

        const authUser = await ensureAsAuth();
        const uid = resolveCurrentUid(authUser);
        if (!uid) {
            setStatus('❌ 인증을 확인하지 못해 좋아요를 반영할 수 없어요.', 'error');
            return;
        }

        const prevLikes = normalizeLikedBy(entry.likedBy);
        const nextLiked = !isLikedByUid(prevLikes, uid);
        const nextMap = { ...prevLikes };
        if (nextLiked) nextMap[uid] = true;
        else delete nextMap[uid];

        feedEntries = feedEntries.map(item => (
            item.id === entry.id
                ? { ...item, likedBy: nextMap, likeCount: Object.keys(nextMap).length }
                : item
        ));
        renderFeed();

        try {
            const patch = nextLiked
                ? { [`likedBy.${uid}`]: true }
                : { [`likedBy.${uid}`]: fieldDelete() };
            await store.collection(COLLECTION).doc(entry.id).update(patch);
        } catch (_) {
            feedEntries = feedEntries.map(item => (
                item.id === entry.id
                    ? { ...item, likedBy: prevLikes, likeCount: Object.keys(prevLikes).length }
                    : item
            ));
            renderFeed();
            setStatus('❌ 좋아요 처리에 실패했어요. 잠시 후 다시 시도해 주세요.', 'error');
        }
    }

    function stopCommentSubscription(requestId) {
        const unsub = commentUnsubscribers.get(requestId);
        if (typeof unsub === 'function') {
            try { unsub(); } catch (_) {}
        }
        commentUnsubscribers.delete(requestId);
    }

    function stopAllCommentSubscriptions() {
        commentUnsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') {
                try { unsub(); } catch (_) {}
            }
        });
        commentUnsubscribers.clear();
    }

    function startCommentSubscription(requestId) {
        if (!requestId || commentUnsubscribers.has(requestId)) return;
        const store = asFirestore();
        if (!store) return;
        try {
            const docRef = store.collection(COLLECTION).doc(requestId);
            if (!docRef || typeof docRef.collection !== 'function') return;
            const colRef = docRef.collection(COMMENTS_COLLECTION);
            const query = (typeof colRef.orderBy === 'function')
                ? colRef.orderBy('createdAtMs', 'asc').limit(COMMENTS_LIMIT)
                : colRef;
            const unsub = query.onSnapshot(snapshot => {
                const list = [];
                if (snapshot && typeof snapshot.forEach === 'function') {
                    snapshot.forEach(docSnapshot => {
                        const data = docSnapshot.data() || {};
                        list.push(normalizeComment(docSnapshot.id, requestId, data));
                    });
                }
                list.sort((a, b) => Number(a.timestampMs || 0) - Number(b.timestampMs || 0));
                commentsByRequest.set(requestId, list);
                feedEntries = feedEntries.map(item => (
                    item.id === requestId ? { ...item, commentCount: list.length } : item
                ));
                renderFeed();
            }, () => { /* 댓글 구독 실패는 요청 목록 표시를 막지 않습니다 */ });
            if (typeof unsub === 'function') commentUnsubscribers.set(requestId, unsub);
        } catch (_) {}
    }

    function toggleComments(entry) {
        if (!entry || !entry.id) return;
        if (openCommentIds.has(entry.id)) {
            openCommentIds.delete(entry.id);
            stopCommentSubscription(entry.id);
        } else {
            openCommentIds.add(entry.id);
            if (!entry.local) startCommentSubscription(entry.id);
        }
        renderFeed();
    }

    async function submitComment(entry, inputEl) {
        if (!entry) return;
        const rawValue = inputEl && typeof inputEl === 'object' ? inputEl.value : inputEl;
        const check = validateComment(rawValue);
        if (!check.ok) {
            setStatus(check.message, 'error');
            return;
        }

        const terminalId = entry.terminalId || (byId('tasTerminalSelect')?.value) || TERMINALS[0].id;
        const identity = buildAnonymousIdentity(terminalId);
        const moderation = moderateAsText(check.content, identity.author, '터미널 시설·정비 A/S 댓글');
        if (moderation.hidden) {
            setStatus(`⚠️ ${moderation.reason || '금칙어/도배'} 감지로 댓글을 등록할 수 없어요.`, 'error');
            notifyBlind({
                category: '터미널 시설·정비 A/S 댓글',
                author: identity.author,
                text: check.content,
                reason: moderation.reason
            });
            return;
        }

        if (entry.local) {
            const comment = normalizeComment(`lc-${Date.now()}-${identity.anonCode}`, entry.id, {
                requestId: entry.id,
                content: check.content,
                author: identity.author,
                anonCode: identity.anonCode,
                createdAtMs: Date.now(),
                local: true
            });
            const list = readLocalRequests().map(item => {
                if (!item || item.id !== entry.id) return item;
                const nextComments = (Array.isArray(item.localComments) ? item.localComments : []).concat([comment]);
                return { ...item, localComments: nextComments, commentCount: nextComments.length };
            });
            writeLocalRequests(list);
            localEntries = list.map(item => normalizeRequest(item.id, item));
            draftCommentText.delete(entry.id);
            if (inputEl && typeof inputEl === 'object') inputEl.value = '';
            renderFeed();
            setStatus('💬 임시 요청에 댓글을 남겼어요.', 'success');
            return;
        }

        const store = asFirestore();
        if (!store) {
            setStatus('❌ 오프라인 상태에서는 댓글을 등록할 수 없어요.', 'error');
            return;
        }

        const authUser = await ensureAsAuth();
        const uid = resolveCurrentUid(authUser);
        if (!uid) {
            setStatus('❌ 인증을 확인하지 못해 댓글을 등록할 수 없어요.', 'error');
            return;
        }

        try {
            const docRef = store.collection(COLLECTION).doc(entry.id);
            const commentsRef = docRef.collection(COMMENTS_COLLECTION);
            const newCommentRef = commentsRef.doc();
            const cid = newCommentRef.id || `c-${Date.now()}-${identity.anonCode}`;
            const createdAtMs = Date.now();
            const commentDoc = {
                requestId: entry.id,
                content: check.content,
                author: identity.author,
                anonCode: identity.anonCode,
                authorUid: uid,
                createdAtMs
            };
            const stamp = serverTimestamp();
            if (stamp) commentDoc.createdAt = stamp;
            await newCommentRef.set(commentDoc);
            rememberOwnedCommentId(cid);

            const prevList = commentsByRequest.get(entry.id) || [];
            if (!prevList.some(item => item.id === cid)) {
                commentsByRequest.set(entry.id, prevList.concat([normalizeComment(cid, entry.id, commentDoc)]));
            }
            const nextCount = (commentsByRequest.get(entry.id) || []).length || (Number(entry.commentCount || 0) + 1);
            feedEntries = feedEntries.map(item => (
                item.id === entry.id ? { ...item, commentCount: nextCount } : item
            ));

            const inc = fieldIncrement(1);
            void docRef.update({ commentCount: inc !== null ? inc : nextCount }).catch(() => {});

            draftCommentText.delete(entry.id);
            if (inputEl && typeof inputEl === 'object') inputEl.value = '';
            renderFeed();
            setStatus('💬 댓글을 등록했어요.', 'success');
        } catch (_) {
            setStatus('❌ 댓글을 등록하지 못했어요. 네트워크 연결을 확인해 주세요.', 'error');
        }
    }

    async function toggleCommentLike(entry, comment) {
        if (!entry || !comment) return;
        if (entry.local || comment.local) {
            const uid = activeLikeUid(comment);
            const nextLiked = !isLikedByUid(comment.likedBy, uid);
            const list = readLocalRequests().map(item => {
                if (!item || item.id !== entry.id) return item;
                const nextComments = (Array.isArray(item.localComments) ? item.localComments : []).map(c => {
                    if (!c || c.id !== comment.id) return c;
                    const likedBy = normalizeLikedBy(c.likedBy);
                    if (nextLiked) likedBy[uid] = true;
                    else delete likedBy[uid];
                    return { ...c, likedBy };
                });
                return { ...item, localComments: nextComments };
            });
            writeLocalRequests(list);
            localEntries = list.map(item => normalizeRequest(item.id, item));
            renderFeed();
            return;
        }

        const store = asFirestore();
        if (!store) {
            setStatus('❌ 오프라인 상태에서는 댓글 좋아요를 반영할 수 없어요.', 'error');
            return;
        }

        const authUser = await ensureAsAuth();
        const uid = resolveCurrentUid(authUser);
        if (!uid) {
            setStatus('❌ 인증을 확인하지 못해 댓글 좋아요를 반영할 수 없어요.', 'error');
            return;
        }

        const prevLikes = normalizeLikedBy(comment.likedBy);
        const nextLiked = !isLikedByUid(prevLikes, uid);
        const nextMap = { ...prevLikes };
        if (nextLiked) nextMap[uid] = true;
        else delete nextMap[uid];

        const curList = commentsByRequest.get(entry.id) || [];
        commentsByRequest.set(entry.id, curList.map(c => (
            c.id === comment.id ? { ...c, likedBy: nextMap, likeCount: Object.keys(nextMap).length } : c
        )));
        renderFeed();

        try {
            const patch = nextLiked
                ? { [`likedBy.${uid}`]: true }
                : { [`likedBy.${uid}`]: fieldDelete() };
            await store.collection(COLLECTION).doc(entry.id)
                .collection(COMMENTS_COLLECTION).doc(comment.id)
                .update(patch);
        } catch (_) {
            commentsByRequest.set(entry.id, (commentsByRequest.get(entry.id) || []).map(c => (
                c.id === comment.id ? { ...c, likedBy: prevLikes, likeCount: Object.keys(prevLikes).length } : c
            )));
            renderFeed();
            setStatus('❌ 댓글 좋아요 처리에 실패했어요.', 'error');
        }
    }

    async function deleteComment(entry, comment) {
        if (!entry || !comment) return;
        if (!askConfirm('이 댓글을 삭제할까요?')) return;

        if (entry.local || comment.local) {
            const list = readLocalRequests().map(item => {
                if (!item || item.id !== entry.id) return item;
                const nextComments = (Array.isArray(item.localComments) ? item.localComments : [])
                    .filter(c => c && c.id !== comment.id);
                return { ...item, localComments: nextComments, commentCount: nextComments.length };
            });
            writeLocalRequests(list);
            localEntries = list.map(item => normalizeRequest(item.id, item));
            forgetOwnedCommentId(comment.id);
            renderFeed();
            setStatus('🗑️ 댓글을 삭제했어요.', 'neutral');
            return;
        }

        const store = asFirestore();
        if (!store) {
            setStatus('❌ 오프라인 상태에서는 댓글을 삭제할 수 없어요.', 'error');
            return;
        }

        try {
            await ensureAsAuth();
            const docRef = store.collection(COLLECTION).doc(entry.id);
            await docRef.collection(COMMENTS_COLLECTION).doc(comment.id).delete();
            forgetOwnedCommentId(comment.id);
            const nextComments = (commentsByRequest.get(entry.id) || []).filter(c => c.id !== comment.id);
            commentsByRequest.set(entry.id, nextComments);
            const nextCount = Math.max(0, nextComments.length || (Number(entry.commentCount || 1) - 1));
            feedEntries = feedEntries.map(item => (
                item.id === entry.id ? { ...item, commentCount: nextCount } : item
            ));
            const dec = fieldIncrement(-1);
            void docRef.update({ commentCount: dec !== null ? dec : nextCount }).catch(() => {});
            renderFeed();
            setStatus('🗑️ 댓글을 삭제했어요.', 'neutral');
        } catch (_) {
            setStatus('❌ 댓글을 삭제하지 못했어요. 작성 권한이나 네트워크를 확인해 주세요.', 'error');
        }
    }

    /* ---------------- 수정 / 삭제 ---------------- */

    function startEditRequest(entry) {
        if (!entry) return;
        editingRequestId = entry.id;
        editingOriginalEntry = entry;
        editingExistingUrls = normalizeImageUrls(entry.imageUrls, entry.local);
        pendingPhotos = [];

        const terminalSelect = byId('tasTerminalSelect');
        const typeSelect = byId('tasTypeSelect');
        const titleInput = byId('tasTitle');
        const contentInput = byId('tasContent');
        const banner = byId('tasEditBanner');
        const bannerText = byId('tasEditText');

        if (terminalSelect && terminalById(entry.terminalId)) terminalSelect.value = entry.terminalId;
        if (typeSelect && typeById(entry.type)) typeSelect.value = entry.type;
        if (titleInput) titleInput.value = entry.title || '';
        if (contentInput) contentInput.value = entry.content || '';
        if (banner) banner.hidden = false;
        if (bannerText) {
            bannerText.textContent = entry.anonCode
                ? `✏️ 요청 수정 중 (#${entry.anonCode})`
                : '✏️ 요청 수정 중';
        }
        setBusy(false);
        setFormOpen(true);
        updateAuthorPreview();
        renderAll();
        setStatus('제목이나 내용·사진·터미널을 수정한 뒤 [수정 저장]을 눌러 주세요.', 'neutral');
        try {
            byId('tasForm')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            (titleInput || contentInput)?.focus?.();
        } catch (_) {}
    }

    function cancelEditMode({ clearInputs = true } = {}) {
        editingRequestId = null;
        editingOriginalEntry = null;
        editingExistingUrls = [];
        pendingPhotos = [];
        const banner = byId('tasEditBanner');
        if (banner) banner.hidden = true;
        if (clearInputs) {
            const titleInput = byId('tasTitle');
            const contentInput = byId('tasContent');
            if (titleInput) titleInput.value = '';
            if (contentInput) contentInput.value = '';
        }
        setBusy(false);
        setFormOpen(false);
        updateAuthorPreview();
        renderAll();
    }

    async function deleteAsRequest(entry) {
        if (!entry || isSubmitting) return;
        if (!askConfirm('이 요청을 삭제할까요?\n삭제한 요청은 복구할 수 없어요.')) return;

        if (editingRequestId === entry.id) cancelEditMode({ clearInputs: true });

        if (entry.local) {
            writeLocalRequests(readLocalRequests().filter(item => item && item.id !== entry.id));
            localEntries = readLocalRequests().map(item => normalizeRequest(item.id, item));
            openRequestIds.delete(entry.id);
            openCommentIds.delete(entry.id);
            forgetOwnedId(entry.id);
            renderAll();
            setStatus('🗑️ 임시 접수를 삭제했어요.', 'neutral');
            return;
        }

        const store = asFirestore();
        if (!store) {
            setStatus('❌ 오프라인 상태에서는 서버 요청을 삭제할 수 없어요.', 'error');
            return;
        }

        isSubmitting = true;
        setBusy(true, '삭제 중…');
        try {
            await ensureAsAuth();
            await store.collection(COLLECTION).doc(entry.id).delete();
            (entry.imageUrls || []).forEach(deleteStoragePhotoByUrl);
            stopCommentSubscription(entry.id);
            commentsByRequest.delete(entry.id);
            openRequestIds.delete(entry.id);
            openCommentIds.delete(entry.id);
            feedEntries = feedEntries.filter(item => item.id !== entry.id);
            forgetOwnedId(entry.id);
            renderAll();
            setStatus('🗑️ 요청이 삭제되었습니다.', 'neutral');
        } catch (_) {
            setStatus('❌ 요청을 삭제하지 못했어요. 네트워크 연결이나 작성 권한을 확인해 주세요.', 'error');
        } finally {
            isSubmitting = false;
            setBusy(false);
        }
    }

    async function updateAdminStatus(entry, nextStatus) {
        if (!entry || !STATUS_LABEL[nextStatus] || !isAdminSession()) return;
        const store = asFirestore();
        if (!store) return;
        try {
            await ensureAsAuth();
            const updatedAtMs = Date.now();
            const payload = { status: nextStatus, updatedAtMs };
            if (nextStatus === 'done') payload.resolvedAtMs = updatedAtMs;
            const stamp = serverTimestamp();
            if (stamp) {
                payload.updatedAt = stamp;
                if (nextStatus === 'done') payload.resolvedAt = stamp;
            }
            await store.collection(COLLECTION).doc(entry.id).update(payload);
            feedEntries = feedEntries.map(item => (
                item.id === entry.id
                    ? {
                        ...item,
                        status: nextStatus,
                        statusLabel: STATUS_LABEL[nextStatus],
                        resolvedAtMs: nextStatus === 'done' ? updatedAtMs : item.resolvedAtMs,
                        updatedAtMs,
                        edited: true
                    }
                    : item
            ));
            renderAll();
            setStatus(`✅ 처리 상태를 [${STATUS_LABEL[nextStatus]}](으)로 바꿨어요.`, 'success');
        } catch (_) {
            setStatus('❌ 상태를 바꾸지 못했어요. 관리자 세션을 확인해 주세요.', 'error');
            renderFeed();
        }
    }

    /* ---------------- 사진 선택 ---------------- */

    async function onPhotoChange(event) {
        const input = event && event.target ? event.target : byId('tasPhotoInput');
        const files = input && input.files ? Array.from(input.files) : [];
        if (input) input.value = '';
        if (!files.length) return;

        const remaining = MAX_PHOTOS - (editingExistingUrls.length + pendingPhotos.length);
        if (remaining <= 0) {
            setStatus(`⚠️ 사진은 최대 ${MAX_PHOTOS}장까지 첨부할 수 있어요.`, 'error');
            return;
        }

        let added = 0;
        let truncated = false;
        for (const file of files) {
            if (editingExistingUrls.length + pendingPhotos.length >= MAX_PHOTOS) {
                truncated = true;
                break;
            }
            const check = validatePhotoFile(file);
            if (!check.ok) {
                setStatus(`⚠️ ${check.message}`, 'error');
                continue;
            }
            const previewUrl = await readFileAsDataUrl(file);
            pendingPhotos.push({
                id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                file,
                name: String(file.name || `photo_${pendingPhotos.length + 1}.jpg`),
                size: Number(file.size || 0),
                previewUrl
            });
            added += 1;
        }
        renderPhotoPreview();
        if (truncated) {
            setStatus(`⚠️ 사진은 최대 ${MAX_PHOTOS}장까지만 첨부돼요.`, 'error');
        } else if (added > 0) {
            setStatus(`📷 사진 ${added}장을 첨부했어요. (총 ${editingExistingUrls.length + pendingPhotos.length}/${MAX_PHOTOS}장)`, 'neutral');
        }
    }

    /* ---------------- 실시간 구독 ---------------- */

    function stopHeadWatcher() {
        if (typeof headUnsubscribe === 'function') {
            try { headUnsubscribe(); } catch (_) {}
        }
        headUnsubscribe = null;
    }

    function startHeadWatcher() {
        if (headUnsubscribe || unsubscribe) return;
        const store = asFirestore();
        if (!store) {
            updateCardNewBadge();
            return;
        }
        try {
            headUnsubscribe = store.collection(COLLECTION)
                .orderBy('createdAtMs', 'desc')
                .limit(HEAD_WATCH_LIMIT)
                .onSnapshot(snapshot => {
                    const entries = [];
                    if (snapshot && typeof snapshot.forEach === 'function') {
                        snapshot.forEach(docSnapshot => {
                            const data = docSnapshot.data() || {};
                            if (data.deletedAt || data.deleted || data.hidden) return;
                            entries.push(normalizeRequest(docSnapshot.id, data));
                        });
                    }
                    headEntries = sortRequests(entries);
                    feedLoaded = false;
                    updateCardNewBadge();
                    void flushLocalQueue(store);
                }, () => {
                    stopHeadWatcher();
                    updateCardNewBadge();
                });
        } catch (_) {
            stopHeadWatcher();
        }
    }

    function startSubscription() {
        stopHeadWatcher();
        if (unsubscribe) return;
        const store = asFirestore();
        if (!store) {
            setLiveBadge(false);
            setStatus('📴 오프라인 접수 모드입니다. 작성한 글은 이 브라우저에만 저장돼요.', 'neutral');
            renderAll();
            return;
        }
        try {
            unsubscribe = store.collection(COLLECTION)
                .orderBy('createdAtMs', 'desc')
                .limit(FEED_LIMIT)
                .onSnapshot(snapshot => {
                    const entries = [];
                    if (snapshot && typeof snapshot.forEach === 'function') {
                        snapshot.forEach(docSnapshot => {
                            const data = docSnapshot.data() || {};
                            if (data.deletedAt || data.deleted || data.hidden) return;
                            entries.push(normalizeRequest(docSnapshot.id, data));
                        });
                    }
                    feedEntries = sortRequests(entries);
                    headEntries = feedEntries.slice(0, HEAD_WATCH_LIMIT);
                    feedLoaded = true;
                    setLiveBadge(true);
                    openCommentIds.forEach(id => {
                        const target = feedEntries.find(item => item.id === id);
                        if (target && !target.local) startCommentSubscription(id);
                    });
                    renderAll();
                    void flushLocalQueue(store);
                }, error => {
                    try { console.warn('터미널 A/S 요청 구독 오류:', error); } catch (_) {}
                    stopSubscription();
                    setStatus('요청 목록을 불러오지 못했어요. 오프라인 접수는 계속 가능합니다.', 'error');
                    renderAll();
                });
        } catch (error) {
            setLiveBadge(false);
            setStatus('요청 목록을 불러오지 못했어요. 오프라인 접수는 계속 가능합니다.', 'error');
        }
    }

    function stopSubscription() {
        if (typeof unsubscribe === 'function') unsubscribe();
        unsubscribe = null;
        stopAllCommentSubscriptions();
        setLiveBadge(false);
    }

    function syncSubscription() {
        const pageVisible = (typeof document === 'undefined' || !document.hidden);
        if (!pageVisible) {
            stopSubscription();
            stopHeadWatcher();
            return;
        }
        if (boardVisible) {
            startSubscription();
        } else {
            stopSubscription();
            startHeadWatcher();
        }
    }

    function observeBoardVisibility() {
        const root = byId('terminalAsBoard');
        if (!root) return;
        if (typeof global.IntersectionObserver !== 'function') {
            boardVisible = true;
            syncSubscription();
            return;
        }
        visibilityObserver = new global.IntersectionObserver(entries => {
            boardVisible = entries.some(entry => entry.isIntersecting);
            syncSubscription();
        }, { threshold: 0.02 });
        visibilityObserver.observe(root);
        document.addEventListener('visibilitychange', () => syncSubscription());
    }

    /* ---------------- 글 작성 / 수정 저장 ---------------- */

    async function buildCompactDataUrls(photos) {
        const urls = [];
        for (const item of photos) {
            const dataUrl = item.previewUrl && isSafePhotoUrl(item.previewUrl, true) && item.previewUrl.length <= 280000
                ? item.previewUrl
                : await fileToCompactDataUrl(item.file);
            if (dataUrl) urls.push(dataUrl);
        }
        return urls;
    }

    async function submitAsRequest(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (isSubmitting) return;

        const terminalSelect = byId('tasTerminalSelect');
        const typeSelect = byId('tasTypeSelect');
        const titleInput = byId('tasTitle');
        const contentInput = byId('tasContent');
        if (!terminalSelect || !typeSelect || !contentInput) return;

        const check = validateRequest(titleInput ? {
            terminalId: terminalSelect.value,
            type: typeSelect.value,
            title: titleInput.value,
            content: contentInput.value
        } : {
            terminalId: terminalSelect.value,
            type: typeSelect.value,
            content: contentInput.value
        });
        if (!check.ok) {
            setStatus(check.message, 'error');
            return;
        }

        const terminal = terminalById(check.terminalId);
        const type = typeById(check.type);

        /* ---- 1) 수정 저장 모드 ---- */
        if (editingRequestId) {
            const targetId = editingRequestId;
            const orig = editingOriginalEntry || allEntries().find(item => item.id === targetId) || null;
            const authorName = `${terminal.short}***`;
            const moderation = moderateAsText(`${check.title}\n${check.content}`, authorName);
            if (moderation.hidden) {
                setStatus(`⚠️ ${moderation.reason || '금칙어/도배'} 감지로 수정할 수 없어요.`, 'error');
                notifyBlind({
                    category: '터미널 시설·정비 A/S 요청',
                    author: authorName,
                    text: `${check.title} - ${check.content}`,
                    reason: moderation.reason
                });
                return;
            }

            if (orig && orig.local) {
                const extraUrls = pendingPhotos.length ? await buildCompactDataUrls(pendingPhotos) : [];
                const mergedUrls = normalizeImageUrls(editingExistingUrls.concat(extraUrls), true);
                const updatedAtMs = Math.max(Date.now(), Number((orig && (orig.timestampMs || orig.createdAtMs)) || 0) + 1);
                const updatedLocal = {
                    ...(readLocalRequests().find(item => item && item.id === targetId) || orig),
                    id: targetId,
                    terminalId: terminal.id,
                    terminalLabel: terminal.label,
                    type: type.id,
                    title: check.title,
                    content: check.content,
                    author: authorName,
                    imageUrls: mergedUrls,
                    pendingPhotoDataUrls: mergedUrls.filter(url => url.startsWith('data:')),
                    createdAtMs: orig.timestampMs || orig.createdAtMs || Date.now(),
                    updatedAtMs,
                    local: true
                };
                saveLocalRequest(updatedLocal);
                localEntries = readLocalRequests().map(item => normalizeRequest(item.id, item));
                cancelEditMode({ clearInputs: true });
                setStatus('✅ 임시 접수 내용을 수정했어요.', 'success');
                return;
            }

            const store = asFirestore();
            if (!store) {
                setStatus('❌ 오프라인 상태에서는 서버 요청을 수정할 수 없어요.', 'error');
                return;
            }

            isSubmitting = true;
            setBusy(true, pendingPhotos.length ? '사진 업로드 중…' : '수정 중…');
            try {
                await ensureAsAuth();
                let uploadedUrls = [];
                if (pendingPhotos.length) {
                    uploadedUrls = await uploadPendingPhotos(targetId, pendingPhotos, (idx, total) => {
                        setBusy(true, `사진 업로드 중 (${idx}/${total})…`);
                    });
                }
                const finalUrls = normalizeImageUrls(editingExistingUrls.concat(uploadedUrls), false);
                const updatedAtMs = Math.max(Date.now(), Number((orig && (orig.timestampMs || orig.createdAtMs)) || 0) + 1);
                const updateDoc = {
                    terminalId: terminal.id,
                    terminalLabel: terminal.label,
                    type: type.id,
                    title: check.title,
                    content: check.content,
                    author: authorName,
                    imageUrls: finalUrls,
                    updatedAtMs
                };
                const stamp = serverTimestamp();
                if (stamp) updateDoc.updatedAt = stamp;
                await store.collection(COLLECTION).doc(targetId).update(updateDoc);

                const oldUrls = orig && Array.isArray(orig.imageUrls) ? orig.imageUrls : [];
                oldUrls.filter(url => !finalUrls.includes(url)).forEach(deleteStoragePhotoByUrl);

                feedEntries = feedEntries.map(item => (
                    item.id === targetId
                        ? normalizeRequest(targetId, {
                            ...item,
                            ...updateDoc,
                            createdAtMs: item.timestampMs
                        })
                        : item
                ));
                cancelEditMode({ clearInputs: true });
                setStatus(`✅ ${terminal.short} 요청을 수정했어요.`, 'success');
            } catch (error) {
                const msg = error && String(error.message || '').includes('storage')
                    ? '❌ 사진 업로드에 실패했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
                    : '❌ 요청을 수정하지 못했어요. 네트워크 연결이나 작성 권한을 확인해 주세요.';
                setStatus(msg, 'error');
            } finally {
                isSubmitting = false;
                setBusy(false);
            }
            return;
        }

        /* ---- 2) 신규 접수 모드 ---- */
        const identity = buildAnonymousIdentity(check.terminalId);
        const moderation = moderateAsText(`${check.title}\n${check.content}`, identity.author);
        if (moderation.hidden) {
            setStatus(`⚠️ ${moderation.reason || '금칙어/도배'} 감지로 접수할 수 없어요.`, 'error');
            notifyBlind({
                category: '터미널 시설·정비 A/S 요청',
                author: identity.author,
                text: `${check.title} - ${check.content}`,
                reason: moderation.reason
            });
            return;
        }

        const store = asFirestore();
        let docId = `local-${Date.now()}-${identity.anonCode}`;
        try {
            // Firestore 문서 ID를 미리 받아두면 오프라인 임시본과 온라인 문서가 같은 ID를 공유해
            // 연결 복구 후 스냅샷이 오면 자연스럽게 하나로 합쳐집니다(중복 접수 없음).
            if (store) docId = store.collection(COLLECTION).doc().id || docId;
        } catch (_) { /* 오프라인 접수 ID 유지 */ }

        const createdAtMs = Date.now();
        isSubmitting = true;
        setBusy(true, pendingPhotos.length ? '사진 업로드 중…' : '접수 중…');
        let savedOnline = false;
        let onlineEntry = null;
        try {
            const authUser = await ensureAsAuth();
            const uid = resolveCurrentUid(authUser);
            if (!store || !uid) throw new Error('offline');

            let uploadedUrls = [];
            if (pendingPhotos.length) {
                uploadedUrls = await uploadPendingPhotos(docId, pendingPhotos, (idx, total) => {
                    setBusy(true, `사진 업로드 중 (${idx}/${total})…`);
                });
            }

            onlineEntry = {
                id: docId,
                terminalId: terminal.id,
                terminalLabel: terminal.label,
                type: type.id,
                title: check.title,
                content: check.content,
                author: identity.author,
                anonCode: identity.anonCode,
                authorUid: uid,
                imageUrls: uploadedUrls,
                status: 'received',
                createdAtMs,
                local: false
            };
            await store.collection(COLLECTION).doc(docId).set(toFirestoreDoc(onlineEntry));
            savedOnline = true;
        } catch (_) {
            // 네트워크·인증·스토리지가 닿지 않아도 "비밀번호 없이 자유롭게" 쓸 수 있도록 임시 접수합니다.
            savedOnline = false;
        } finally {
            isSubmitting = false;
            setBusy(false);
        }

        rememberOwnedId(docId);
        if (savedOnline && onlineEntry) {
            writeLocalRequests(readLocalRequests().filter(item => item.id !== docId));
            localEntries = readLocalRequests().map(item => normalizeRequest(item.id, item));
            feedEntries = sortRequests([normalizeRequest(docId, onlineEntry)].concat(
                feedEntries.filter(item => item.id !== docId)
            ));
            setStatus(`✅ ${terminal.short} ${type.label} 요청이 접수됐어요. 모든 동료에게 공유됩니다.`, 'success');
        } else {
            const offlineDataUrls = pendingPhotos.length ? await buildCompactDataUrls(pendingPhotos) : [];
            const localEntry = {
                id: docId,
                terminalId: terminal.id,
                terminalLabel: terminal.label,
                type: type.id,
                title: check.title,
                content: check.content,
                author: identity.author,
                anonCode: identity.anonCode,
                imageUrls: offlineDataUrls,
                pendingPhotoDataUrls: offlineDataUrls,
                status: 'received',
                createdAtMs,
                local: true
            };
            saveLocalRequest(localEntry);
            localEntries = readLocalRequests().map(item => normalizeRequest(item.id, item));
            setStatus('📴 오프라인 접수됐어요. 이 기기에 저장되며 연결이 돌아오면 자동으로 올려요.', 'neutral');
        }

        pendingPhotos = [];
        editingExistingUrls = [];
        if (titleInput) titleInput.value = '';
        contentInput.value = '';
        currentPage = 1;
        openRequestIds.add(docId);
        setFormOpen(false);
        updateAuthorPreview();
        renderAll();
    }

    function onFilterClick(event) {
        const target = event && event.target;
        const button = target && typeof target.closest === 'function'
            ? target.closest('[data-terminal]')
            : null;
        if (!button) return;
        const id = button.getAttribute('data-terminal');
        activeTerminal = terminalById(id) ? id : FILTER_ALL;
        currentPage = 1;
        if (activeTerminal !== FILTER_ALL && !editingRequestId) {
            const select = byId('tasTerminalSelect');
            if (select) select.value = activeTerminal;
        }
        updateAuthorPreview();
        renderAll();
    }

    /* ---------------- 초기화 ---------------- */

    function populateSelects() {
        const terminalSelect = byId('tasTerminalSelect');
        if (terminalSelect && terminalSelect.options.length === 0) {
            const placeholder = el('option', '', '터미널을 선택해 주세요');
            placeholder.setAttribute('value', '');
            terminalSelect.appendChild(placeholder);
            const groups = {};
            TERMINALS.forEach(item => {
                if (!groups[item.group]) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.setAttribute('label', item.group);
                    groups[item.group] = optgroup;
                    terminalSelect.appendChild(optgroup);
                }
                const option = el('option', '', item.label);
                option.setAttribute('value', item.id);
                groups[item.group].appendChild(option);
            });
            terminalSelect.value = TERMINALS[0].id;
        }
        const typeSelect = byId('tasTypeSelect');
        if (typeSelect && typeSelect.options.length === 0) {
            REQUEST_TYPES.forEach(item => {
                const option = el('option', '', `${item.icon} ${item.label}`);
                option.setAttribute('value', item.id);
                typeSelect.appendChild(option);
            });
            typeSelect.value = REQUEST_TYPES[0].id;
        }
    }

    function attachAuthListener() {
        try {
            const authObj = asAuth();
            if (authObj && typeof authObj.onAuthStateChanged === 'function') {
                authObj.onAuthStateChanged(user => {
                    const prev = currentAuthUid;
                    const next = (user && user.uid) ? String(user.uid) : '';
                    currentAuthUid = next;
                    if (prev !== next) {
                        if (next) syncSubscription();
                        renderAll();
                    }
                });
            }
        } catch (_) {}
        void ensureAsAuth().then(user => {
            if (user && user.uid) {
                syncSubscription();
                renderAll();
            }
        });
    }

    function init() {
        // 마크업이 없는 배포본(테스트·관리자 화면 등)에서는 조용히 종료합니다.
        if (!byId('terminalAsBoard')) return;
        populateSelects();
        localEntries = readLocalRequests().map(item => normalizeRequest(item.id, item));

        const terminalSelect = byId('tasTerminalSelect');
        if (terminalSelect) terminalSelect.addEventListener('change', updateAuthorPreview);
        byId('tasToggleFormBtn')?.addEventListener('click', () => {
            if (isFormOpen && editingRequestId) {
                cancelEditMode({ clearInputs: true });
                setStatus('수정을 취소했어요.', 'neutral');
                return;
            }
            setFormOpen(!isFormOpen, { focusTitle: !isFormOpen });
        });
        byId('tasForm')?.addEventListener('submit', submitAsRequest);
        byId('tasFilter')?.addEventListener('click', onFilterClick);
        byId('tasPhotoInput')?.addEventListener('change', onPhotoChange);
        byId('tasCancelEdit')?.addEventListener('click', () => {
            cancelEditMode({ clearInputs: true });
            setStatus('수정을 취소했어요. 새 요청을 작성할 수 있습니다.', 'neutral');
        });

        setFormOpen(false);
        renderFilter();
        updateAuthorPreview();
        renderAll();
        attachAuthListener();
        observeBoardVisibility();
    }

    /* 순수 로직 + 쓰기 진입점은 회귀 테스트(scripts/terminal-as.test.mjs)가 재사용합니다. */
    global.TerminalAsCore = Object.freeze({
        terminals: TERMINALS,
        requestTypes: REQUEST_TYPES,
        statusLabels: STATUS_LABEL,
        collection: COLLECTION,
        commentsCollection: COMMENTS_COLLECTION,
        storageDir: STORAGE_DIR,
        localKey: LOCAL_KEY,
        mineKey: MINE_KEY,
        localMineKey: MINE_KEY,
        mineCommentsKey: MINE_COMMENTS_KEY,
        filterAll: FILTER_ALL,
        pageSize: PAGE_SIZE,
        maxTitle: MAX_TITLE,
        maxContent: MAX_CONTENT,
        maxComment: MAX_COMMENT,
        maxPhotos: MAX_PHOTOS,
        maxPhotoBytes: MAX_PHOTO_BYTES,
        newPostWindowMs: NEW_POST_WINDOW_MS,
        terminalById,
        typeById,
        makeAnonCode,
        buildAnonymousIdentity,
        deriveTitleFromContent,
        isSafePhotoUrl,
        normalizeImageUrls,
        validatePhotoFile,
        validateRequest,
        validateComment,
        normalizeLikedBy,
        countLikes,
        isLikedByUid,
        normalizeComment,
        normalizeRequest,
        filterRequests,
        sortRequests,
        isRecentPost,
        formatRelativeTime
    });
    global.submitTerminalAsRequest = submitAsRequest;
    global.refreshTerminalAsBoard = renderAll;

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
