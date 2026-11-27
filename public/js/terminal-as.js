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
 *  · 현장 사진 업로드(최대 3장) · 본인 작성 글 수정/삭제(무비밀번호)를 지원합니다.
 *  · Firestore `terminal_as_requests` + Firebase Storage `terminal-as/` 에 저장되어 실시간 공유됩니다.
 *    네트워크/인증이 닿지 않으면 이 브라우저 localStorage 에 임시 접수합니다(오프라인 표기).
 *  · 블럭 색은 푸른색 중간톤(--blue-500~--blue-700 계열) + 반짝이는 효과를 사용합니다.
 */
(function initTerminalAsBoard(global) {
    'use strict';

    /* ---- 운영 값 (firestore.rules 의 terminal_as_requests 규칙과 함께 바꿔야 합니다) ---- */
    const COLLECTION = 'terminal_as_requests';
    const STORAGE_DIR = 'terminal-as';
    const LOCAL_KEY = 'hakportTerminalAsLocalV1';
    const MINE_KEY = 'hakportTerminalAsMineV1';
    const FEED_LIMIT = 80;
    const MAX_CONTENT = 500;
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
        done: '완료'
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

    function validateRequest(payload) {
        const data = payload || {};
        const terminalId = String(data.terminalId || '').trim();
        const type = String(data.type || '').trim();
        const content = String(data.content == null ? '' : data.content)
            .replace(/\s+/gu, ' ').trim();
        if (!terminalById(terminalId)) {
            return { ok: false, code: 'terminal', message: '요청할 터미널을 선택해 주세요.' };
        }
        if (!typeById(type)) {
            return { ok: false, code: 'type', message: '요청 종류(시설·정비·수리·A/S)를 골라 주세요.' };
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
        return { ok: true, terminalId, type, content };
    }

    function normalizeRequest(id, data) {
        const d = data || {};
        const terminal = terminalById(d.terminalId);
        const type = typeById(d.type);
        const isLocal = Boolean(d.local);
        let millis = Number(d.createdAtMs);
        if (!Number.isFinite(millis) || millis <= 0) {
            try {
                if (d.createdAt && typeof d.createdAt.toMillis === 'function') {
                    millis = Number(d.createdAt.toMillis());
                }
            } catch (_) { /* 구버전 문서 호환 */ }
        }
        if (!Number.isFinite(millis) || millis <= 0) millis = Date.now();

        let updatedAtMs = Number(d.updatedAtMs);
        if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
            try {
                if (d.updatedAt && typeof d.updatedAt.toMillis === 'function') {
                    updatedAtMs = Number(d.updatedAt.toMillis());
                }
            } catch (_) { /* 무시 */ }
        }
        if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) updatedAtMs = 0;

        const rawImages = Array.isArray(d.imageUrls) && d.imageUrls.length
            ? d.imageUrls
            : (d.imageUrl ? [d.imageUrl] : (isLocal && Array.isArray(d.pendingPhotoDataUrls) ? d.pendingPhotoDataUrls : []));

        return {
            id: String(id || ''),
            terminalId: terminal ? terminal.id : '',
            terminalLabel: terminal ? terminal.label : String(d.terminalLabel || '기타').slice(0, 40),
            type: type ? type.id : 'other',
            typeLabel: type ? type.label : '기타',
            typeIcon: type ? type.icon : '📌',
            content: String(d.content || '').slice(0, MAX_CONTENT),
            author: String(d.author || '익명***').slice(0, MAX_AUTHOR),
            anonCode: String(d.anonCode || '').slice(0, 12),
            authorUid: String(d.authorUid || '').slice(0, 128),
            imageUrls: normalizeImageUrls(rawImages, isLocal),
            status: STATUS_LABEL[d.status] ? d.status : 'received',
            statusLabel: STATUS_LABEL[d.status] || '접수',
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

    /** Firestore 문서 모양 — 로컬 임시 접수본을 그대로 다시 올릴 때도 이 모양을 씁니다. */
    function toFirestoreDoc(entry) {
        const doc = {
            terminalId: entry.terminalId,
            terminalLabel: entry.terminalLabel,
            type: entry.type,
            content: entry.content,
            author: entry.author,
            anonCode: entry.anonCode,
            status: entry.status,
            createdAtMs: entry.createdAtMs
        };
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

    function readOwnedIds() {
        try {
            const raw = global.localStorage?.getItem(MINE_KEY);
            const parsed = JSON.parse(raw || '[]');
            return new Set(Array.isArray(parsed) ? parsed.map(String).slice(0, MAX_OWNED_IDS) : []);
        } catch (_) {
            return new Set();
        }
    }

    let ownedRequestIds = readOwnedIds();

    function rememberOwnedId(id) {
        const clean = String(id || '').trim();
        if (!clean) return;
        ownedRequestIds.add(clean);
        try {
            const list = Array.from(ownedRequestIds).slice(-MAX_OWNED_IDS);
            ownedRequestIds = new Set(list);
            global.localStorage?.setItem(MINE_KEY, JSON.stringify(list));
        } catch (_) {}
    }

    function forgetOwnedId(id) {
        const clean = String(id || '').trim();
        if (!clean) return;
        ownedRequestIds.delete(clean);
        try {
            global.localStorage?.setItem(MINE_KEY, JSON.stringify(Array.from(ownedRequestIds)));
        } catch (_) {}
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
                await store.collection(COLLECTION).doc(item.id).set(toFirestoreDoc(payload));
                rememberOwnedId(item.id);
                uploaded.add(item.id);
            } catch (_) { /* 다음 연결 때 다시 시도합니다 */ }
        }
        if (!uploaded.size) return;
        writeLocalRequests(readLocalRequests().filter(item => !uploaded.has(item.id)));
        localEntries = readLocalRequests().map(entry => normalizeRequest(entry.id, entry));
        renderAll();
    }

    function moderateAsText(content, author) {
        try {
            if (typeof global.inspectCommunityContent === 'function') {
                const result = global.inspectCommunityContent({
                    text: content,
                    author: author,
                    category: '터미널 시설·정비 A/S 요청'
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
    let localEntries = [];      // 오프라인 임시 접수
    let pendingPhotos = [];     // 새로 첨부한 사진 { id, file, name, size, previewUrl }
    let editingRequestId = null;
    let editingOriginalEntry = null;
    let editingExistingUrls = [];
    let unsubscribe = null;
    let visibilityObserver = null;
    let boardVisible = false;
    let isSubmitting = false;
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
        const node = byId('tasStatus');
        if (!node) return;
        node.textContent = message;
        node.classList.remove('is-error', 'is-success', 'is-neutral');
        node.classList.add(tone === 'error' || tone === 'success' ? `is-${tone}` : 'is-neutral');
    }

    function setLiveBadge(live) {
        const badge = byId('tasLiveBadge');
        if (!badge) return;
        badge.textContent = live ? '🟢 실시간 공유 중' : '⚪ 오프라인 접수';
        badge.classList.toggle('is-live', Boolean(live));
    }

    function setBusy(busy, label) {
        const submit = byId('tasSubmit');
        if (submit) {
            submit.disabled = Boolean(busy);
            if (busy) {
                submit.textContent = label || (editingRequestId ? '수정 중…' : '접수 중…');
            } else {
                submit.textContent = editingRequestId ? '수정 저장' : '요청 접수';
            }
        }
    }

    function currentIdentity() {
        const select = byId('tasTerminalSelect');
        const id = select ? String(select.value || '') : '';
        return buildAnonymousIdentity(id);
    }

    function updateAuthorPreview() {
        const node = byId('tasAuthorPreview');
        const code = byId('tasAnonCode');
        const identity = currentIdentity();
        if (node) node.textContent = identity.author;
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
        feedEntries.forEach(entry => merged.set(entry.id, entry));
        return sortRequests(Array.from(merged.values()));
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
            metaNode.textContent = `${label} · 최근 ${visible.length}건`;
        }
        if (!visible.length) {
            const empty = el('li', 'tas-feed-empty', '아직 접수된 요청이 없어요. 첫 요청을 남겨 주세요.');
            feed.appendChild(empty);
            return;
        }
        const adminActive = isAdminSession();
        visible.slice(0, FEED_LIMIT).forEach(entry => {
            const item = el('li', 'tas-feed-item'
                + (entry.local ? ' is-local' : '')
                + (editingRequestId === entry.id ? ' is-editing' : ''));
            const top = el('div', 'tas-feed-top');
            const badge = el('span', 'tas-terminal-badge', entry.terminalLabel);
            const type = el('span', 'tas-type-badge', `${entry.typeIcon} ${entry.typeLabel}`);
            const status = el('span', 'tas-status-badge is-' + entry.status, entry.statusLabel);
            top.appendChild(badge);
            top.appendChild(type);
            top.appendChild(status);
            item.appendChild(top);

            const body = el('p', 'tas-feed-content', entry.content);
            item.appendChild(body);

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
                item.appendChild(gallery);
            }

            const bottom = el('div', 'tas-feed-bottom');
            bottom.appendChild(el('span', 'tas-feed-author', entry.author));
            if (entry.anonCode) bottom.appendChild(el('span', 'tas-feed-code', `#${entry.anonCode}`));
            if (entry.edited) bottom.appendChild(el('span', 'tas-feed-edited', '· 수정됨'));
            if (entry.local) bottom.appendChild(el('span', 'tas-feed-local', '📴 이 기기에만 저장'));
            bottom.appendChild(el('span', 'tas-feed-time', formatRelativeTime(entry.timestampMs, Date.now())));
            item.appendChild(bottom);

            if (canManageEntry(entry)) {
                const actions = el('div', 'tas-item-actions');
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
                    actions.appendChild(statusSel);
                }
                const editBtn = el('button', 'tas-item-btn is-edit', '✏️ 수정');
                editBtn.setAttribute('type', 'button');
                editBtn.setAttribute('aria-label', `${entry.terminalLabel} 요청 수정`);
                editBtn.addEventListener('click', () => startEditRequest(entry));

                const delBtn = el('button', 'tas-item-btn is-delete', '🗑️ 삭제');
                delBtn.setAttribute('type', 'button');
                delBtn.setAttribute('aria-label', `${entry.terminalLabel} 요청 삭제`);
                delBtn.addEventListener('click', () => void deleteAsRequest(entry));

                actions.appendChild(editBtn);
                actions.appendChild(delBtn);
                item.appendChild(actions);
            }
            feed.appendChild(item);
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
        const contentInput = byId('tasContent');
        const banner = byId('tasEditBanner');
        const bannerText = byId('tasEditText');

        if (terminalSelect && terminalById(entry.terminalId)) terminalSelect.value = entry.terminalId;
        if (typeSelect && typeById(entry.type)) typeSelect.value = entry.type;
        if (contentInput) contentInput.value = entry.content || '';
        if (banner) banner.hidden = false;
        if (bannerText) {
            bannerText.textContent = entry.anonCode
                ? `✏️ 요청 수정 중 (#${entry.anonCode})`
                : '✏️ 요청 수정 중';
        }
        setBusy(false);
        updateAuthorPreview();
        renderAll();
        setStatus('내용이나 사진·터미널을 수정한 뒤 [수정 저장]을 눌러 주세요.', 'neutral');
        try {
            byId('tasForm')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            contentInput?.focus?.();
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
            const contentInput = byId('tasContent');
            if (contentInput) contentInput.value = '';
        }
        setBusy(false);
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
            const stamp = serverTimestamp();
            if (stamp) payload.updatedAt = stamp;
            await store.collection(COLLECTION).doc(entry.id).update(payload);
            feedEntries = feedEntries.map(item => (
                item.id === entry.id
                    ? { ...item, status: nextStatus, statusLabel: STATUS_LABEL[nextStatus], updatedAtMs, edited: true }
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

    function startSubscription() {
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
                    setLiveBadge(true);
                    renderAll();
                    void flushLocalQueue(store);
                }, error => {
                    try { console.warn('터미널 A/S 요청 구독 오류:', error); } catch (_) {}
                    setLiveBadge(false);
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
        setLiveBadge(false);
    }

    function syncSubscription() {
        const shouldRun = boardVisible && (typeof document === 'undefined' || !document.hidden);
        if (shouldRun) startSubscription();
        else stopSubscription();
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
        const contentInput = byId('tasContent');
        if (!terminalSelect || !typeSelect || !contentInput) return;

        const check = validateRequest({
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
            const moderation = moderateAsText(check.content, authorName);
            if (moderation.hidden) {
                setStatus(`⚠️ ${moderation.reason || '금칙어/도배'} 감지로 수정할 수 없어요.`, 'error');
                notifyBlind({
                    category: '터미널 시설·정비 A/S 요청',
                    author: authorName,
                    text: check.content,
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
        const moderation = moderateAsText(check.content, identity.author);
        if (moderation.hidden) {
            setStatus(`⚠️ ${moderation.reason || '금칙어/도배'} 감지로 접수할 수 없어요.`, 'error');
            notifyBlind({
                category: '터미널 시설·정비 A/S 요청',
                author: identity.author,
                text: check.content,
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
        contentInput.value = '';
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
                    if (prev !== next) renderFeed();
                });
            }
        } catch (_) {}
        void ensureAsAuth().then(user => {
            if (user && user.uid) renderFeed();
        });
    }

    function init() {
        // 마크업이 없는 배포본(테스트·관리자 화면 등)에서는 조용히 종료합니다.
        if (!byId('terminalAsBoard')) return;
        populateSelects();
        localEntries = readLocalRequests().map(item => normalizeRequest(item.id, item));

        const terminalSelect = byId('tasTerminalSelect');
        if (terminalSelect) terminalSelect.addEventListener('change', updateAuthorPreview);
        byId('tasForm')?.addEventListener('submit', submitAsRequest);
        byId('tasFilter')?.addEventListener('click', onFilterClick);
        byId('tasPhotoInput')?.addEventListener('change', onPhotoChange);
        byId('tasCancelEdit')?.addEventListener('click', () => {
            cancelEditMode({ clearInputs: true });
            setStatus('수정을 취소했어요. 새 요청을 작성할 수 있습니다.', 'neutral');
        });

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
        collection: COLLECTION,
        storageDir: STORAGE_DIR,
        localKey: LOCAL_KEY,
        mineKey: MINE_KEY,
        localMineKey: MINE_KEY,
        filterAll: FILTER_ALL,
        maxContent: MAX_CONTENT,
        maxPhotos: MAX_PHOTOS,
        maxPhotoBytes: MAX_PHOTO_BYTES,
        terminalById,
        typeById,
        makeAnonCode,
        buildAnonymousIdentity,
        isSafePhotoUrl,
        normalizeImageUrls,
        validatePhotoFile,
        validateRequest,
        normalizeRequest,
        filterRequests,
        sortRequests,
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
