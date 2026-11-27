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
 *  · Firestore `terminal_as_requests` 에 저장되어 모든 동료에게 실시간 공유됩니다.
 *    네트워크/인증이 닿지 않으면 이 브라우저 localStorage 에 임시 접수합니다(오프라인 표기).
 *  · 블럭 색은 푸른색 중간톤(--blue-500~--blue-700 계열) 디자인 토큰만 사용합니다.
 */
(function initTerminalAsBoard(global) {
    'use strict';

    /* ---- 운영 값 (firestore.rules 의 terminal_as_requests 규칙과 함께 바꿔야 합니다) ---- */
    const COLLECTION = 'terminal_as_requests';
    const LOCAL_KEY = 'hakportTerminalAsLocalV1';
    const FEED_LIMIT = 80;
    const MAX_CONTENT = 500;
    const MAX_AUTHOR = 40;
    const MAX_LOCAL = 60;
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
        let millis = Number(d.createdAtMs);
        if (!Number.isFinite(millis) || millis <= 0) {
            try {
                if (d.createdAt && typeof d.createdAt.toMillis === 'function') {
                    millis = Number(d.createdAt.toMillis());
                }
            } catch (_) { /* 구버전 문서 호환 */ }
        }
        if (!Number.isFinite(millis) || millis <= 0) millis = Date.now();
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
            status: STATUS_LABEL[d.status] ? d.status : 'received',
            statusLabel: STATUS_LABEL[d.status] || '접수',
            timestampMs: millis,
            local: Boolean(d.local)
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
       저장소 (Firestore + 오프라인 임시 접수)
       ================================================================== */

    function asFirestore() {
        try {
            return (typeof db !== 'undefined' && db && typeof db.collection === 'function') ? db : null;
        } catch (_) {
            return null;
        }
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
        const stamp = serverTimestamp();
        if (stamp) doc.createdAt = stamp;
        return doc;
    }

    function pendingLocalEntries() {
        return readLocalRequests().filter(item => item && item.local && String(item.id || '').length > 0);
    }

    /** 연결이 돌아오면 오프라인 임시 접수본을 같은 문서 ID로 다시 올립니다(중복 접수 방지). */
    async function flushLocalQueue(store) {
        const pending = pendingLocalEntries();
        if (!pending.length) return;
        const uploaded = new Set();
        for (const item of pending) {
            try {
                await store.collection(COLLECTION).doc(item.id).set(toFirestoreDoc(item));
                uploaded.add(item.id);
            } catch (_) { /* 다음 연결 때 다시 시도합니다 */ }
        }
        if (!uploaded.size) return;
        writeLocalRequests(readLocalRequests().filter(item => !uploaded.has(item.id)));
        localEntries = readLocalRequests().map(entry => normalizeRequest(entry.id, entry));
        renderAll();
    }

    /** 규칙이 isSignedIn() 을 요구하므로 쓰기 전에 자동 익명 인증을 확인합니다(비밀번호 없음). */
    async function ensureAsAuth() {
        try {
            if (typeof global.ensureAnonymousAuth === 'function') {
                const user = await global.ensureAnonymousAuth();
                if (user) return user;
            }
            const firebase = global.firebase;
            if (firebase && typeof firebase.auth === 'function' && firebase.auth().currentUser) {
                return firebase.auth().currentUser;
            }
        } catch (_) { /* 실패하면 오프라인 임시 접수로 넘어갑니다 */ }
        return null;
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
        const list = readLocalRequests();
        list.unshift(entry);
        writeLocalRequests(list);
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

    /* ==================================================================
       화면 상태
       ================================================================== */

    let feedEntries = [];       // Firestore 최근 요청
    let localEntries = [];      // 오프라인 임시 접수
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

    function setBusy(busy) {
        const submit = byId('tasSubmit');
        if (submit) {
            submit.disabled = Boolean(busy);
            submit.textContent = busy ? '접수 중…' : '요청 접수';
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
        if (code) code.textContent = `#${identity.anonCode}`;
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
        visible.slice(0, FEED_LIMIT).forEach(entry => {
            const item = el('li', 'tas-feed-item' + (entry.local ? ' is-local' : ''));
            const top = el('div', 'tas-feed-top');
            const badge = el('span', 'tas-terminal-badge', entry.terminalLabel);
            const type = el('span', 'tas-type-badge', `${entry.typeIcon} ${entry.typeLabel}`);
            const status = el('span', 'tas-status-badge is-' + entry.status, entry.statusLabel);
            top.appendChild(badge);
            top.appendChild(type);
            top.appendChild(status);
            const body = el('p', 'tas-feed-content', entry.content);
            const bottom = el('div', 'tas-feed-bottom');
            bottom.appendChild(el('span', 'tas-feed-author', entry.author));
            if (entry.anonCode) bottom.appendChild(el('span', 'tas-feed-code', `#${entry.anonCode}`));
            if (entry.local) bottom.appendChild(el('span', 'tas-feed-local', '📴 이 기기에만 저장'));
            bottom.appendChild(el('span', 'tas-feed-time', formatRelativeTime(entry.timestampMs, Date.now())));
            item.appendChild(top);
            item.appendChild(body);
            item.appendChild(bottom);
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
        renderFeed();
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
                            if (data.deletedAt || data.hidden) return;
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

    /* ---------------- 글 작성 ---------------- */

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

        const terminal = terminalById(check.terminalId);
        const type = typeById(check.type);
        const store = asFirestore();
        let docId = `local-${Date.now()}-${identity.anonCode}`;
        try {
            // Firestore 문서 ID를 미리 받아두면 오프라인 임시본과 온라인 문서가 같은 ID를 공유해
            // 연결 복구 후 스냅샷이 오면 자연스럽게 하나로 합쳐집니다(중복 접수 없음).
            if (store) docId = store.collection(COLLECTION).doc().id || docId;
        } catch (_) { /* 오프라인 접수 ID 유지 */ }
        const entry = {
            id: docId,
            terminalId: terminal.id,
            terminalLabel: terminal.label,
            type: type.id,
            content: check.content,
            author: identity.author,
            anonCode: identity.anonCode,
            status: 'received',
            createdAtMs: Date.now(),
            local: true
        };
        saveLocalRequest(entry);
        localEntries = readLocalRequests().map(item => normalizeRequest(item.id, item));
        renderAll();

        isSubmitting = true;
        setBusy(true);
        let savedOnline = false;
        try {
            await ensureAsAuth();
            if (!store) throw new Error('firestore-unavailable');
            await store.collection(COLLECTION).doc(docId).set(toFirestoreDoc(entry));
            savedOnline = true;
            setStatus(`✅ ${terminal.short} ${type.label} 요청이 접수됐어요. 모든 동료에게 공유됩니다.`, 'success');
        } catch (error) {
            // 네트워크·인증이 닿지 않아도 "비밀번호 없이 자유롭게" 쓸 수 있도록 임시 접수합니다.
            setStatus('📴 오프라인 접수됐어요. 이 기기에 저장되며 연결이 돌아오면 자동으로 올려요.', 'neutral');
        } finally {
            isSubmitting = false;
            setBusy(false);
        }

        if (savedOnline) {
            // 온라인 접수 확인 후에는 로컬 임시본을 지우고 스냅샷 문서만 남깁니다.
            writeLocalRequests(readLocalRequests().filter(item => item.id !== docId));
            localEntries = readLocalRequests().map(item => normalizeRequest(item.id, item));
            feedEntries = sortRequests([normalizeRequest(docId, entry)].concat(
                feedEntries.filter(item => item.id !== docId)
            ));
        }
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
        if (activeTerminal !== FILTER_ALL) {
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

    function init() {
        // 마크업이 없는 배포본(테스트·관리자 화면 등)에서는 조용히 종료합니다.
        if (!byId('terminalAsBoard')) return;
        populateSelects();
        localEntries = readLocalRequests().map(item => normalizeRequest(item.id, item));

        const terminalSelect = byId('tasTerminalSelect');
        if (terminalSelect) terminalSelect.addEventListener('change', updateAuthorPreview);
        byId('tasForm')?.addEventListener('submit', submitAsRequest);
        byId('tasFilter')?.addEventListener('click', onFilterClick);

        renderFilter();
        updateAuthorPreview();
        renderAll();
        observeBoardVisibility();
    }

    /* 순수 로직 + 쓰기 진입점은 회귀 테스트(scripts/terminal-as.test.mjs)가 재사용합니다. */
    global.TerminalAsCore = Object.freeze({
        terminals: TERMINALS,
        requestTypes: REQUEST_TYPES,
        collection: COLLECTION,
        localKey: LOCAL_KEY,
        filterAll: FILTER_ALL,
        maxContent: MAX_CONTENT,
        terminalById,
        typeById,
        makeAnonCode,
        buildAnonymousIdentity,
        validateRequest,
        normalizeRequest,
        filterRequests,
        sortRequests,
        formatRelativeTime
    });
    global.submitTerminalAsRequest = submitAsRequest;

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
