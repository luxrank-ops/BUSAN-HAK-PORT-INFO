// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================

const firebaseConfig = { apiKey: "AIzaSyBWFZr9TE9yybZJCJjEXSsv1YCpGkVb0kA", authDomain: "busan-hak-port.firebaseapp.com", projectId: "busan-hak-port", storageBucket: "busan-hak-port.firebasestorage.app", messagingSenderId: "616469111502", appId: "1:616469111502:web:6f3c94b15e444e04c7669f", measurementId: "G-QQ728TDFJ2" };
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const db = firebase.firestore(); const storage = firebase.storage();

/* ══════════════════════════════════════════════════════════════════════
   Phase 0 개선 헬퍼 (2026-10-16) — 화면 디자인 변경 없음
   · reportFailure        : 조용히 삼켜지던 실패를 콘솔+기존 토스트로 알림
   · formatScheduleSource : 선석 스케줄이 실시간인지 저장본인지 기준 시각 표기
   · ensureFirebaseMessagingLoaded / ensureD3LibraryLoaded : 무거운 SDK 지연 로드
   ══════════════════════════════════════════════════════════════════════ */
let isScheduleFailureReported = false;

function reportFailure(scope, err, userMessage = "") {
    try { console.warn(`[${scope}] 처리 실패:`, err); } catch (e) {}
    if (userMessage && typeof showToast === "function") showToast(userMessage);
}

function formatScheduleSourceLine(info) {
    if (!info) return "";
    const pad = n => String(n).padStart(2, "0");
    if (info.source === "live") {
        const d = info.updatedAt ? new Date(info.updatedAt) : new Date();
        return `\n기준: 실시간 조회 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    if (!info.updatedAt) return "\n기준: 저장된 스케줄 (갱신 시각 미상)";
    const d = new Date(info.updatedAt);
    if (!d || isNaN(d.getTime())) return "\n기준: 저장된 스케줄";
    return `\n기준: 저장된 스케줄 (${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 저장)`;
}

/* 🗑️ 소프트 삭제 (D-2): 남의 기록을 되돌릴 수 없게 지우지 못하도록 삭제 표시만 남깁니다.
   물리 삭제(delete)는 규칙상 관리자 전용이며, 화면은 이 표시로 목록에서 감춥니다. */
function softDeletePayload() {
    return {
        deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
        deletedBy: (typeof currentWorkerId !== "undefined" && currentWorkerId) ? currentWorkerId : "unknown"
    };
}
function isDeletedRecord(data) {
    return Boolean(data && data.deletedAt);
}

/* 🔎 근무일지 조회 (D-1·A-8): 본인 workerId 로 좁혀 읽어 개인정보·읽기 비용을 줄입니다.
   복합 인덱스가 아직 배포되지 않은 환경에서는 기존 방식으로 자동 대체됩니다. */
let workLogScopedQueryUnavailable = false;
async function queryWorkLogsByDateRange(startDate, endDate, limitCount = 500) {
    await ensureAnonymousAuth();
    const buildQuery = (withDateRange) => {
        // 규칙상 work_logs 목록 조회에는 workerId 조건이 반드시 있어야 합니다(없으면 권한 거부).
        let q = db.collection("work_logs").where("workerId", "==", currentWorkerId);
        if (withDateRange) {
            if (startDate) q = q.where("date", ">=", startDate);
            if (endDate) q = q.where("date", "<=", endDate);
        }
        return q.limit(limitCount);
    };
    if (!workLogScopedQueryUnavailable) {
        try {
            return await buildQuery(true).get();
        } catch (e) {
            const errCode = String((e && e.code) || "");
            if (errCode !== "permission-denied") {
                workLogScopedQueryUnavailable = true;
                try { console.warn("[근무일지 본인 조회] 복합 인덱스 미배포로 대체 조회로 전환:", e && e.message); } catch (_) {}
                if (!localStorage.getItem("workLogIndexNoticeShown")) {
                    try { localStorage.setItem("workLogIndexNoticeShown", "1"); } catch (_) {}
                    if (typeof showToast === "function") showToast("ℹ️ 근무일지 조회를 대체 방식으로 전환했습니다. (관리자: 인덱스 배포 필요)");
                }
            }
        }
    }
    // 대체 조회: workerId 조건만 걸어 본인 것만 받고(기본 인덱스로 충분), 날짜 범위는 화면에서 거릅니다.
    const snap = await buildQuery(false).get();
    const scopedDocs = snap.docs.filter((docItem) => {
        const dateStr = String((docItem.data() || {}).date || "");
        if (!dateStr) return false;
        if (startDate && dateStr < startDate) return false;
        if (endDate && dateStr > endDate) return false;
        return true;
    });
    return { docs: scopedDocs, size: scopedDocs.length, empty: scopedDocs.length === 0, forEach: (fn) => scopedDocs.forEach(fn) };
}

let __d3SdkPromise = null;
function ensureD3LibraryLoaded() {
    if (typeof window.d3 !== "undefined") return Promise.resolve(window.d3);
    if (__d3SdkPromise) return __d3SdkPromise;
    __d3SdkPromise = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js";
        script.async = true;
        script.onload = () => resolve(window.d3 || true);
        script.onerror = () => { __d3SdkPromise = null; resolve(null); };
        document.head.appendChild(script);
    });
    return __d3SdkPromise;
}

let __fcmSdkPromise = null;
function ensureFirebaseMessagingLoaded() {
    if (window.firebase && firebase.messaging) return Promise.resolve(true);
    if (__fcmSdkPromise) return __fcmSdkPromise;
    __fcmSdkPromise = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js";
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => { __fcmSdkPromise = null; resolve(false); };
        document.head.appendChild(script);
    });
    return __fcmSdkPromise;
}

// 🔔 알림 버튼 최초 터치: 사용자 제스처 안에서 권한을 묻고, 그 뒤 SDK를 받아 원래 동작을 실행합니다.
let __fcmGatePassed = false;
document.addEventListener("click", async (ev) => {
    const target = ev.target;
    const trigger = target && target.closest ? target.closest("[data-lazy-messaging]") : null;
    if (!trigger) return;
    if (__fcmGatePassed || (window.firebase && firebase.messaging)) return;
    ev.preventDefault();
    ev.stopPropagation();
    try {
        if ("Notification" in window && Notification.permission === "default" && typeof Notification.requestPermission === "function") {
            Notification.requestPermission().catch(() => {});
        }
    } catch (e) {}
    const loaded = await ensureFirebaseMessagingLoaded();
    __fcmGatePassed = true;
    if (!loaded) reportFailure("알림 SDK", new Error("firebase-messaging 로드 실패"), "⚠️ 알림 기능을 준비하지 못했습니다. 네트워크 상태를 확인해 주세요.");
    trigger.click();
}, true);
const auth = typeof firebase.auth === "function" ? firebase.auth() : null;
db.enablePersistence({ synchronizeTabs: true }).catch(err => { console.warn("Persistence Error:", err.code); });

// 🔐 익명 인증 자동 연결 + 정적 호스팅·비활성 콘솔 폴백(Custom Token) 및 관리자 토큰 관리
let currentAuthUser = null;
const ADMIN_UID_WHITELIST = [
    "admin_luxrank",
    "luxrank_admin_uid"
];
const ADMIN_EMAIL_WHITELIST = [
    "luxrank@gmail.com"
];
// 노출된 구 비밀번호(0346) 차단 및 SHA-256 해시 검증 상수
const DEFAULT_ADMIN_PW_HASH = "6cda3286b168d396ec539b002b14f58a6aebd453b6e5bc146c2d82dfd2614bc3";
const FALLBACK_PRODUCTION_API_ORIGIN = "https://busan-hak-port-info.vercel.app";
const ADMIN_SESSION_TOKEN_KEY = "busanPortAdminToken";
const ADMIN_SESSION_EXPIRY_KEY = "busanPortAdminTokenExpiresAt";
const ANON_CLIENT_ID_KEY = "busanHakPortClientId";
let isAdminSessionVerified = sessionStorage.getItem("busanPortAdminVerified") === "1";

function getOrCreateClientDeviceId() {
    try {
        const saved = localStorage.getItem(ANON_CLIENT_ID_KEY);
        if (saved && /^[a-zA-Z0-9_-]{8,64}$/.test(saved)) return saved;
        const generated = "dev_" + Math.random().toString(36).slice(2, 12) + "_" + Date.now().toString(36);
        localStorage.setItem(ANON_CLIENT_ID_KEY, generated);
        return generated;
    } catch (e) {
        return "dev_" + Math.random().toString(36).slice(2, 12);
    }
}

function getStoredAdminSessionToken() {
    try {
        const token = sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY) || "";
        const expRaw = Number(sessionStorage.getItem(ADMIN_SESSION_EXPIRY_KEY) || "0");
        if (!token) return "";
        if (expRaw > 0 && Date.now() >= expRaw) {
            sessionStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
            sessionStorage.removeItem(ADMIN_SESSION_EXPIRY_KEY);
            return "";
        }
        return token;
    } catch (e) {
        return "";
    }
}

function saveAdminSessionToken(token, expiresAt) {
    try {
        if (token) {
            sessionStorage.setItem(ADMIN_SESSION_TOKEN_KEY, String(token));
            if (expiresAt) sessionStorage.setItem(ADMIN_SESSION_EXPIRY_KEY, String(expiresAt));
        }
    } catch (e) {}
}

function hasServerBackedAdminAccess() {
    const uid = auth && auth.currentUser ? String(auth.currentUser.uid || "") : "";
    if (ADMIN_UID_WHITELIST.includes(uid)) return true;
    const email = auth && auth.currentUser && auth.currentUser.email ? String(auth.currentUser.email).toLowerCase() : "";
    if (email && auth.currentUser.emailVerified && ADMIN_EMAIL_WHITELIST.includes(email)) return true;
    return Boolean(getStoredAdminSessionToken());
}

/**
 * 동일 출처(/api/...)를 1순위로 호출하고, 정적 호스팅(Firebase Hosting·GitHub Pages 등 HTML 응답)
 * 또는 프리뷰 환경의 Firebase Admin 미초기화(503) 시 운영 API 서버로 안전하게 재시도합니다.
 */
async function fetchPortApiJson(apiPath, initOptions = {}) {
    const tryOnce = async (baseOrigin) => {
        const url = baseOrigin ? `${baseOrigin}${apiPath}` : apiPath;
        const res = await fetch(url, initOptions);
        const ctype = String(res.headers.get("content-type") || "").toLowerCase();
        if (!ctype.includes("application/json")) {
            return { nonJson: true, status: res.status, data: null };
        }
        const data = await res.json().catch(() => null);
        return { nonJson: false, status: res.status, data };
    };

    let primary = null;
    try {
        primary = await tryOnce("");
    } catch (err) {
        primary = { networkError: true, status: 0, data: null };
    }

    if (primary && !primary.nonJson && !primary.networkError) {
        // 명시적 인증·입력·속도제한 응답(400/401/429)이나 정상(200)은 즉시 반환합니다.
        if (
            primary.status === 200 ||
            primary.status === 400 ||
            primary.status === 401 ||
            primary.status === 429
        ) {
            return primary;
        }
    }

    const currentOrigin = typeof window !== "undefined" && window.location ? String(window.location.origin || "") : "";
    if (!currentOrigin || currentOrigin === FALLBACK_PRODUCTION_API_ORIGIN) {
        return primary;
    }

    try {
        return await tryOnce(FALLBACK_PRODUCTION_API_ORIGIN);
    } catch (err) {
        return primary;
    }
}

let authInitialStateResolved = false;
let authEnsureInFlightPromise = null;
const authInitialStatePromise = auth
    ? new Promise((resolve) => {
        let settled = false;
        const finish = (u) => {
            if (settled) return;
            settled = true;
            authInitialStateResolved = true;
            resolve(u || null);
        };
        try {
            const unsub = auth.onAuthStateChanged((user) => {
                currentAuthUser = user || null;
                if (typeof unsub === "function") {
                    try { unsub(); } catch (_) {}
                }
                finish(currentAuthUser);
            });
            setTimeout(() => finish(auth.currentUser || null), 800);
        } catch (e) {
            finish(null);
        }
    })
    : Promise.resolve(null);

async function ensureAnonymousAuth() {
    if (!auth) return null;
    if (auth.currentUser) {
        currentAuthUser = auth.currentUser;
        return currentAuthUser;
    }
    if (authEnsureInFlightPromise) {
        return authEnsureInFlightPromise;
    }
    authEnsureInFlightPromise = (async () => {
        try {
            if (!authInitialStateResolved) {
                const restored = await authInitialStatePromise;
                if (restored || auth.currentUser) {
                    currentAuthUser = auth.currentUser || restored;
                    return currentAuthUser;
                }
            }
            try {
                const cred = await auth.signInAnonymously();
                if (cred && cred.user) {
                    currentAuthUser = cred.user;
                    return currentAuthUser;
                }
            } catch (anonErr) {
                // Firebase 콘솔에서 익명 인증(signInAnonymously)이 꺼져 있는 경우
                // 서버 Custom Token(/api/auth-session)으로 즉시 서명 로그인하여 isSignedIn() 을 보장합니다.
                if (typeof auth.signInWithCustomToken === "function") {
                    const fallback = await fetchPortApiJson("/api/auth-session", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            mode: "anonymous",
                            clientId: getOrCreateClientDeviceId()
                        })
                    });
                    if (fallback && fallback.status === 200 && fallback.data && fallback.data.customToken) {
                        const customCred = await auth.signInWithCustomToken(fallback.data.customToken);
                        if (customCred && customCred.user) {
                            currentAuthUser = customCred.user;
                            return currentAuthUser;
                        }
                    }
                }
            }
            return auth.currentUser || null;
        } catch (e) {
            return auth.currentUser || null;
        } finally {
            authEnsureInFlightPromise = null;
        }
    })();
    return authEnsureInFlightPromise;
}
if (auth) {
    auth.onAuthStateChanged(user => {
        currentAuthUser = user || null;
        if (!user && authInitialStateResolved) {
            ensureAnonymousAuth();
        }
    });
}

async function sha256Hex(str) {
    const text = String(str ?? "").trim();
    if (window.crypto && window.crypto.subtle) {
        const buf = new TextEncoder().encode(text);
        const hashBuf = await window.crypto.subtle.digest("SHA-256", buf);
        return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    // 구형 환경 폴백 (순수 JS SHA-256)
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    const mathPow = Math.pow, maxWord = mathPow(2, 32);
    let result = "", words = [], asciiBitLength = text.length * 8;
    let hash = [], k = [], primeCounter = 0, isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
            for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
            hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
            k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
    }
    let ascii = unescape(encodeURIComponent(text)) + "\x80";
    while ((ascii.length % 64) - 56) ascii += "\x00";
    for (let i = 0; i < ascii.length; i++) {
        let j = ascii.charCodeAt(i);
        words[i >> 2] |= j << ((3 - (i % 4)) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (let j = 0; j < words.length;) {
        let w = words.slice(j, (j += 16)), oldHash = hash.slice(0);
        for (let i = 0; i < 64; i++) {
            let w15 = w[i - 15], w2 = w[i - 2];
            let a = hash[0], e = hash[4];
            let temp1 = hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] + (w[i] = i < 16 ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
            let temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
            hash = [(temp1 + temp2) | 0].concat(hash);
            hash[4] = (hash[4] + temp1) | 0;
            hash.pop();
        }
        for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i++) {
        for (let j = 3; j + 1; j--) {
            let b = (hash[i] >> (j * 8)) & 255;
            result += (b < 16 ? 0 : "") + b.toString(16);
        }
    }
    return result;
}

async function verifyPasswordMatch(inputPw, storedPwOrHash) {
    if (!inputPw || !storedPwOrHash) return false;
    const trimmed = String(inputPw).trim();
    const stored = String(storedPwOrHash).trim();
    const inputHash = await sha256Hex(trimmed);
    if (stored.length === 64 && /^[a-f0-9]{64}$/i.test(stored)) {
        return inputHash.toLowerCase() === stored.toLowerCase();
    }
    return trimmed === stored;
}

let allPostsData=[], allShipsData=[], filteredShips=[], adminWorkLogs={};
let currentDate = new Date(); let currentWorkerId = localStorage.getItem('myWorkerId'); 
let commentUnsubscribes = {}; let shipCommentUnsubscribes = {}; let shipCommentsById = {}; let editingShipComment = null; let selectedCommentFiles = {}; let selectedShipCommentFiles = {}; let visitorCountPromise = null; const postsPerPage = 5; let globalTickerData = { adminMessage: "", userMessages: [] };
let currentEditPostId = null;

async function safeGet(ref) { if (!ref) return null; try { return await ref.get(); } catch (e) { return null; } }
async function verifyAdmin(forcePrompt = false) {
    await ensureAnonymousAuth();
    if (!forcePrompt && isAdminSessionVerified && hasServerBackedAdminAccess()) return true;

    const inputPw = prompt("관리자 비밀번호(또는 관리자 이메일:비밀번호)를 입력하세요:");
    if (!inputPw) return false;
    const raw = inputPw.trim();

    // 1) 이메일:비밀번호 형식 입력 시 Firebase Auth 관리자 전용 계정 로그인 시도
    if (auth && raw.includes(":") && raw.includes("@")) {
        const sepIdx = raw.indexOf(":");
        const email = raw.slice(0, sepIdx).trim();
        const pass = raw.slice(sepIdx + 1).trim();
        try {
            const cred = await auth.signInWithEmailAndPassword(email, pass);
            if (cred.user && (ADMIN_UID_WHITELIST.includes(cred.user.uid) || ADMIN_EMAIL_WHITELIST.includes((cred.user.email || "").toLowerCase()))) {
                isAdminSessionVerified = true;
                try { sessionStorage.setItem("busanPortAdminVerified", "1"); } catch (e) {}
                return true;
            }
        } catch (e) {
            alert("⚠️ 관리자 계정 인증에 실패했습니다.");
            return false;
        }
    }

    // 2) 서버 관리자 인증(1순위): 비밀번호 검증 후 admin_luxrank Custom Token + 서명 관리자 토큰 발급
    try {
        const serverAuth = await fetchPortApiJson("/api/auth-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "admin", password: raw })
        });
        if (serverAuth && serverAuth.status === 429) {
            alert("⚠️ 시도 횟수가 초과되었습니다. 잠시 후 다시 시도해 주세요.");
            return false;
        }
        if (serverAuth && serverAuth.status === 401) {
            alert("⚠️ 비밀번호가 틀렸습니다.");
            return false;
        }
        if (serverAuth && serverAuth.status === 200 && serverAuth.data && serverAuth.data.ok) {
            if (serverAuth.data.token) {
                saveAdminSessionToken(serverAuth.data.token, serverAuth.data.expiresAt);
            }
            if (serverAuth.data.customToken && auth && typeof auth.signInWithCustomToken === "function") {
                try {
                    const adminCred = await auth.signInWithCustomToken(serverAuth.data.customToken);
                    if (adminCred && adminCred.user) {
                        currentAuthUser = adminCred.user;
                    }
                } catch (customErr) {
                    console.warn("관리자 Custom Token 로그인 폴백:", customErr && customErr.message);
                }
            }
            isAdminSessionVerified = true;
            try { sessionStorage.setItem("busanPortAdminVerified", "1"); } catch (e) {}
            return true;
        }
    } catch (e) {
        // 오프라인·로컬 개발 환경에서는 아래 로컬 SHA-256 검증으로 안전하게 폴백
    }

    // 3) 로컬 SHA-256 해시 폴백 검증 (서버 연결 불가 환경 대비)
    const inputHash = await sha256Hex(raw);
    let targetHash = DEFAULT_ADMIN_PW_HASH;
    try {
        const doc = await safeGet(db.collection("settings").doc("admin"));
        if (doc && doc.exists) {
            const d = doc.data() || {};
            if (d.passwordHash) {
                targetHash = String(d.passwordHash).trim().toLowerCase();
            } else if (d.password) {
                const saved = String(d.password).trim();
                targetHash = (/^[a-f0-9]{64}$/i.test(saved)) ? saved.toLowerCase() : (await sha256Hex(saved));
            }
        }
    } catch (e) {
        // Firestore 규칙에 의해 settings/admin 읽기가 차단된 경우 targetHash(SHA-256)로 검증
    }

    if (inputHash === targetHash || inputHash === DEFAULT_ADMIN_PW_HASH) {
        isAdminSessionVerified = true;
        try { sessionStorage.setItem("busanPortAdminVerified", "1"); } catch (e) {}
        return true;
    }
    alert("⚠️ 비밀번호가 틀렸습니다.");
    return false;
}
function getVisitorDateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function detectVisitorDeviceKey() {
    const ua = navigator.userAgent || "";
    if (/android/i.test(ua)) return "android";
    if (/iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return "ios";
    return "desktop";
}
function detectVisitorHourSlot(date = new Date()) {
    const h = date.getHours();
    if (h < 6) return "h00_06";
    if (h < 12) return "h06_12";
    if (h < 18) return "h12_18";
    return "h18_24";
}
function trackAppEvent(category, key) {
    if (!category || !key || typeof db === "undefined") return;
    try {
        const dateKey = getVisitorDateKey();
        const inc = firebase.firestore.FieldValue.increment(1);
        const ts = firebase.firestore.FieldValue.serverTimestamp();
        const payload = { [category]: { [key]: inc }, updatedAt: ts };
        db.collection("visitor_stats").doc("total").set(payload, { merge: true }).catch(() => {});
        db.collection("visitor_stats").doc(`daily-${dateKey}`).set({ date: dateKey, ...payload }, { merge: true }).catch(() => {});
    } catch (e) {}
}
const STATS_BLOCK_META = [
    { id: "wage-card", label: "🧮 임금계산기", color: "#2563eb" },
    { id: "log-card", label: "📅 근무일지", color: "#059669" },
    { id: "t3-content", label: "🚢 3항업 (신항 남측)", color: "#1e3a8a" },
    { id: "t2-content", label: "🏗️ 2항업 (신항 북측)", color: "#0284c7" },
    { id: "t1-content", label: "⚓ 1항업 (북항)", color: "#334155" },
    { id: "ship-card", label: "🚢 작업 선박 정보(안전수칙/작업 정보 등록및검색)", color: "#0ea5e9" },
    { id: "notice-card", label: "📢 공지사항", color: "#ef4444" },
    { id: "daily-field-english-card", label: "🔤 오늘의 현장 영어 한문장", color: "#0284c7" },
    { id: "board-card", label: "💬 스트레스 해소(톡톡)", color: "#6366f1" },
    { id: "archive-card", label: "📂 자료실 (셔틀버스 시간표 등)", color: "#eab308" },
    { id: "weather-card", label: "📡 날씨 및 도선 상황", color: "#06b6d4" },
    { id: "safety-card", label: "🎮 꿍꿍따 미니게임", color: "#10b981" },
    { id: "guide-card", label: "📖 현장 실무 용어 가이드", color: "#8b5cf6" },
    { id: "privacy-center-card", label: "🛡️ 실전 보안 가이드", color: "#64748b" },
    { id: "main-manual-card", label: "🔅 앱 공유 · 사용 설명서", color: "#f59e0b" }
];
const STATS_TERMINAL_META = [
    { id: "hjnc", label: "한진신항만 (HJNC · 3항업)", color: "#f97316" },
    { id: "bnct", label: "고려신항만 (BNCT · 3항업)", color: "#2563eb" },
    { id: "dgt", label: "동원글로벌 (DGT · 3항업)", color: "#0d9488" },
    { id: "bct", label: "부산컨테이너 (BCT · 3항업)", color: "#16a34a" },
    { id: "pnc", label: "부산신항만 (PNC · 2항업)", color: "#0284c7" },
    { id: "hpnt", label: "HMM 신항만 (HPNT · 2항업)", color: "#4f46e5" },
    { id: "pnit", label: "신항국제 (PNIT · 2항업)", color: "#7c3aed" },
    { id: "bptc", label: "북항 통합 (BPTC · 1항업)", color: "#475569" },
    { id: "hbct", label: "허치슨 (HBCT · 1항업)", color: "#dc2626" }
];
const STATS_ACTION_META = [
    { id: "wage_calc", label: "🧮 임금 계산 실행" },
    { id: "wage_to_log", label: "✨ 일지로 임금 전송" },
    { id: "log_save", label: "💾 근무일지 저장" },
    { id: "excel_dl", label: "📊 엑셀(CSV) 저장" },
    { id: "receipt_share", label: "📸 명세서 저장·공유" },
    { id: "meal_view", label: "🍱 터미널 식단 조회" },
    { id: "bay_plan", label: "🧩 베이 플랜 조회" },
    { id: "bus_view", label: "🚌 셔틀 시간표 조회" },
    { id: "leader_cal", label: "📅 조장 근무표 조회" },
    { id: "promo_share", label: "📤 홍보글 복사·공유" }
];
let cachedStatsModalData = { totalDoc: {}, todayDoc: {}, currentBlockMode: "total", reportText: "" };

function trackVisitorSession() {
    if (visitorCountPromise) return visitorCountPromise;
    const now = new Date();
    const dateKey = getVisitorDateKey(now);
    const sessionKey = "busanHakPortVisitorCounted";
    const uniqueDailyKey = "busanHakPortUniqueVisitorDate";
    const uniqueEverKey = "busanHakPortUniqueVisitorEver";

    let canStoreSession = true;
    try {
        // 자정 경계 해결: 세션 키에 날짜(dateKey)를 저장하여 자정이 지나면 새 날짜로 정상 집계
        const savedSessionVal = sessionStorage.getItem(sessionKey);
        if (savedSessionVal === dateKey || savedSessionVal === `pending:${dateKey}`) {
            return Promise.resolve();
        }
        sessionStorage.setItem(sessionKey, `pending:${dateKey}`);
    } catch (error) {
        canStoreSession = false;
    }

    // 새 탭 중복 해결: localStorage 기반으로 오늘 순 방문자(unique) 여부 판별
    let isNewDailyUnique = false;
    let isNewEverUnique = false;
    try {
        if (localStorage.getItem(uniqueDailyKey) !== dateKey) {
            isNewDailyUnique = true;
        }
        if (localStorage.getItem(uniqueEverKey) !== "1") {
            isNewEverUnique = true;
        }
    } catch (e) {}

    const devKey = detectVisitorDeviceKey();
    const hourKey = detectVisitorHourSlot(now);
    const totalRef = db.collection("visitor_stats").doc("total");
    const dailyRef = db.collection("visitor_stats").doc(`daily-${dateKey}`);
    const inc = firebase.firestore.FieldValue.increment(1);
    const ts = firebase.firestore.FieldValue.serverTimestamp();

    visitorCountPromise = (async () => {
        await ensureAnonymousAuth();
        return db.runTransaction(async transaction => {
            const totalSnapshot = await transaction.get(totalRef);
            const dailySnapshot = await transaction.get(dailyRef);
            const totalData = totalSnapshot.exists ? (totalSnapshot.data() || {}) : {};
            const dailyData = dailySnapshot.exists ? (dailySnapshot.data() || {}) : {};
            const totalCount = Number(totalData.count) || 0;
            const dailyCount = Number(dailyData.count) || 0;
            const totalUnique = Number(totalData.unique) || 0;
            const dailyUnique = Number(dailyData.unique) || 0;

            const totalPayload = {
                count: totalCount + 1,
                devices: { [devKey]: inc },
                hours: { [hourKey]: inc },
                updatedAt: ts
            };
            if (isNewEverUnique) {
                totalPayload.unique = totalUnique + 1;
            } else if (typeof totalData.unique === "undefined" && isNewDailyUnique) {
                totalPayload.unique = totalUnique + 1;
            }

            const dailyPayload = {
                date: dateKey,
                count: dailyCount + 1,
                unique: isNewDailyUnique ? (dailyUnique + 1) : Math.max(dailyUnique, 1),
                devices: { [devKey]: inc },
                hours: { [hourKey]: inc },
                updatedAt: ts
            };

            transaction.set(totalRef, totalPayload, { merge: true });
            transaction.set(dailyRef, dailyPayload, { merge: true });
        });
    })().then(() => {
        if (canStoreSession) sessionStorage.setItem(sessionKey, dateKey);
        try {
            if (isNewDailyUnique) localStorage.setItem(uniqueDailyKey, dateKey);
            if (isNewEverUnique) localStorage.setItem(uniqueEverKey, "1");
        } catch (e) {}
    }).catch(error => {
        if (canStoreSession) sessionStorage.removeItem(sessionKey);
        console.warn("방문자 수 집계 오류:", error);
    }).finally(() => {
        visitorCountPromise = null;
    });
    return visitorCountPromise;
}

/* ==================================================================
   📊 오늘 · 누적 방문자 실시간 상시 플로팅 배지 (화면 좌측 상단)
   - visitor_stats/daily-{dateKey} 및 visitor_stats/total 실시간 리스너 연동
   - 자정 경계(dateKey) 변경 시 자동 재구독 → 항상 "오늘" & "누적" 실시간 표시
   - 화면 스크롤 시에도 좌측 상단 상시 플로팅 유지
   ================================================================== */
let todayVisitorBadgeUnsub = null;
let totalVisitorBadgeUnsub = null;
let todayVisitorBadgeDateKey = "";
let todayVisitorBadgeRetry = 0;
let totalVisitorBadgeRetry = 0;
let todayVisitorBadgeInitialized = false;
let latestTodayVisitorCount = null;
let latestTotalVisitorCount = null;
let latestVisitorUpdatedAt = null;

function getTodayVisitorBadgeEls() {
    const badge = document.getElementById("todayVisitorBadge");
    if (!badge) return null;
    return {
        badge,
        count: document.getElementById("todayVisitorBadgeCount"),
        totalCount: document.getElementById("totalVisitorBadgeCount")
    };
}

function setTodayVisitorBadgeState(state) {
    const els = getTodayVisitorBadgeEls();
    if (!els) return;
    if (state === "error") {
        els.badge.classList.remove("is-loading");
        els.badge.classList.add("is-error");
        if (els.count && latestTodayVisitorCount === null) els.count.innerText = "-";
        if (els.totalCount && latestTotalVisitorCount === null) els.totalCount.innerText = "-";
        els.badge.title = "방문자 집계를 불러오지 못했습니다. (네트워크·인증 상태 확인 후 자동 재시도)";
        return;
    }
    if (state === "loading") {
        els.badge.classList.remove("is-error");
        els.badge.classList.add("is-loading");
    }
}

function updateVisitorBadgeTooltipAndAria() {
    const els = getTodayVisitorBadgeEls();
    if (!els) return;
    const todaySafe = Math.max(0, Number(latestTodayVisitorCount) || 0);
    const totalSafe = Math.max(todaySafe, Number(latestTotalVisitorCount) || 0);
    let timeLabel = "";
    try {
        const updated = latestVisitorUpdatedAt && typeof latestVisitorUpdatedAt.toDate === "function" ? latestVisitorUpdatedAt.toDate() : null;
        if (updated) {
            timeLabel = ` · ${String(updated.getHours()).padStart(2, "0")}:${String(updated.getMinutes()).padStart(2, "0")} 기준`;
        }
    } catch (e) {}
    els.badge.title = `👥 오늘 방문자 ${todaySafe.toLocaleString()}명 / 🏆 누적 방문자 ${totalSafe.toLocaleString()}명 (세션 기준)${timeLabel} · 클릭 시 안내/통계`;
    els.badge.setAttribute("aria-label", `오늘 방문자 ${todaySafe.toLocaleString()}명, 누적 방문자 ${totalSafe.toLocaleString()}명`);
}

function renderTodayVisitorBadgeValue(count, updatedAt) {
    const els = getTodayVisitorBadgeEls();
    if (!els) return;
    const safeCount = Math.max(0, Number(count) || 0);
    latestTodayVisitorCount = safeCount;
    if (updatedAt) latestVisitorUpdatedAt = updatedAt;
    if (els.count) els.count.innerText = safeCount.toLocaleString();
    if (els.totalCount && latestTotalVisitorCount !== null && latestTotalVisitorCount < safeCount) {
        els.totalCount.innerText = safeCount.toLocaleString();
    }
    els.badge.classList.remove("is-loading", "is-error");
    updateVisitorBadgeTooltipAndAria();
}

function renderTotalVisitorBadgeValue(totalCount, updatedAt) {
    const els = getTodayVisitorBadgeEls();
    if (!els) return;
    const todaySafe = Math.max(0, Number(latestTodayVisitorCount) || 0);
    const safeTotal = Math.max(todaySafe, Number(totalCount) || 0);
    latestTotalVisitorCount = safeTotal;
    if (updatedAt) latestVisitorUpdatedAt = updatedAt;
    if (els.totalCount) els.totalCount.innerText = safeTotal.toLocaleString();
    els.badge.classList.remove("is-loading", "is-error");
    updateVisitorBadgeTooltipAndAria();
}

async function fallbackLoadVisitorBadgeFromServer() {
    try {
        const resp = await fetchPortApiJson("/api/analytics-summary");
        if (resp && resp.status === 200 && resp.data && resp.data.ok && resp.data.summary) {
            renderTotalVisitorBadgeValue(resp.data.summary.totalVisitors, null);
            renderTodayVisitorBadgeValue(resp.data.summary.todayVisitors, null);
        }
    } catch (e) {}
}

function startTotalVisitorBadgeListener() {
    const els = getTodayVisitorBadgeEls();
    if (!els || totalVisitorBadgeUnsub) return;
    if (typeof db === "undefined" || !db) return;
    try {
        totalVisitorBadgeUnsub = db.collection("visitor_stats").doc("total").onSnapshot(snapshot => {
            totalVisitorBadgeRetry = 0;
            const data = snapshot.exists ? (snapshot.data() || {}) : {};
            renderTotalVisitorBadgeValue(data.count, data.updatedAt);
        }, async error => {
            console.warn("누적 방문자 배지 갱신 실패:", error && error.message);
            totalVisitorBadgeUnsub = null;
            await ensureAnonymousAuth();
            await fallbackLoadVisitorBadgeFromServer();
            if (totalVisitorBadgeRetry < 3) {
                totalVisitorBadgeRetry += 1;
                setTimeout(() => {
                    startTotalVisitorBadgeListener();
                }, 3000 * totalVisitorBadgeRetry);
            }
        });
    } catch (error) {
        console.warn("누적 방문자 배지 연결 오류:", error && error.message);
        void fallbackLoadVisitorBadgeFromServer();
    }
}

function startTodayVisitorBadgeListener() {
    const els = getTodayVisitorBadgeEls();
    if (!els) return;
    startTotalVisitorBadgeListener();
    const dateKey = getVisitorDateKey();
    if (todayVisitorBadgeDateKey === dateKey && todayVisitorBadgeUnsub) return;

    todayVisitorBadgeDateKey = dateKey;
    if (todayVisitorBadgeUnsub) {
        try { todayVisitorBadgeUnsub(); } catch (e) {}
        todayVisitorBadgeUnsub = null;
    }
    if (typeof db === "undefined" || !db) { setTodayVisitorBadgeState("error"); return; }

    setTodayVisitorBadgeState("loading");
    try {
        todayVisitorBadgeUnsub = db.collection("visitor_stats").doc(`daily-${dateKey}`).onSnapshot(snapshot => {
            todayVisitorBadgeRetry = 0;
            const data = snapshot.exists ? (snapshot.data() || {}) : {};
            renderTodayVisitorBadgeValue(data.count, data.updatedAt);
        }, async error => {
            console.warn("오늘 방문자 배지 갱신 실패:", error && error.message);
            todayVisitorBadgeUnsub = null;
            setTodayVisitorBadgeState("error");
            await ensureAnonymousAuth();
            await fallbackLoadVisitorBadgeFromServer();
            // 익명 인증 지연·일시적 네트워크 오류 대비 자동 재시도 (최대 3회)
            if (todayVisitorBadgeRetry < 3) {
                todayVisitorBadgeRetry += 1;
                setTimeout(() => {
                    if (todayVisitorBadgeDateKey === getVisitorDateKey()) startTodayVisitorBadgeListener();
                }, 3000 * todayVisitorBadgeRetry);
            }
        });
    } catch (error) {
        console.warn("오늘 방문자 배지 연결 오류:", error && error.message);
        setTodayVisitorBadgeState("error");
        void fallbackLoadVisitorBadgeFromServer();
    }
}

function initTodayVisitorBadge() {
    const badgeEl = document.getElementById("todayVisitorBadge");
    if (!badgeEl) return;
    // body 직속으로 이동하여 모달·스크롤·스태킹 컨텍스트 영향 없이 항상 좌측 상단 플로팅 보장
    if (badgeEl.parentElement && badgeEl.parentElement.tagName === "HEADER") {
        document.body.appendChild(badgeEl);
    }
    startTodayVisitorBadgeListener();
    if (todayVisitorBadgeInitialized) return;
    todayVisitorBadgeInitialized = true;

    const syncScrollFloatingState = () => {
        const b = document.getElementById("todayVisitorBadge");
        if (!b) return;
        b.classList.toggle("is-scrolled", window.scrollY > 12);
    };
    window.addEventListener("scroll", syncScrollFloatingState, { passive: true });
    syncScrollFloatingState();

    // 탭 복귀 시: 자정이 지났으면 새 날짜로 재구독, 끊긴 리스너는 자동 복구
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        if (todayVisitorBadgeDateKey !== getVisitorDateKey()) todayVisitorBadgeRetry = 0;
        startTodayVisitorBadgeListener();
    });
    // 절전·시계 변경 대비 1분 주기 날짜 경계 점검
    setInterval(() => {
        if (todayVisitorBadgeDateKey && todayVisitorBadgeDateKey !== getVisitorDateKey()) {
            todayVisitorBadgeRetry = 0;
            startTodayVisitorBadgeListener();
        }
    }, 60000);
}

function onTodayVisitorBadgeClick() {
    // 관리자 세션이면 바로 상세 통계, 일반 방문자는 현재 오늘·누적 집계 수치 안내
    if (isAdminSessionVerified) { openVisitorStats(); return; }
    const countEl = document.getElementById("todayVisitorBadgeCount");
    const totalEl = document.getElementById("totalVisitorBadgeCount");
    const countText = countEl ? countEl.innerText : "-";
    const totalText = totalEl ? totalEl.innerText : "-";
    showToast(`🟢 오늘 방문자 ${countText}명 · 🏆 총 누적 ${totalText}명 (실시간 집계 중)`);
}

function switchBlockRankMode(mode) {
    cachedStatsModalData.currentBlockMode = mode;
    const btnTotal = document.getElementById("blockRankTabTotal");
    const btnToday = document.getElementById("blockRankTabToday");
    if (btnTotal) btnTotal.classList.toggle("active", mode === "total");
    if (btnToday) btnToday.classList.toggle("active", mode === "today");
    renderStatsBlockRanking(cachedStatsModalData.totalDoc, cachedStatsModalData.todayDoc, mode);
}
function renderStatsBlockRanking(totalDoc, todayDoc, mode = "total") {
    const listEl = document.getElementById("statsBlockRankingList");
    if (!listEl) return;
    const totalBlocks = (totalDoc && totalDoc.blocks) || {};
    const todayBlocks = (todayDoc && todayDoc.blocks) || {};
    const items = STATS_BLOCK_META.map(m => {
        const tCnt = Number(totalBlocks[m.id]) || 0;
        const dCnt = Number(todayBlocks[m.id]) || 0;
        return {
            ...m,
            totalCount: tCnt,
            todayCount: dCnt,
            activeCount: mode === "today" ? dCnt : tCnt
        };
    }).sort((a, b) => b.activeCount - a.activeCount || b.totalCount - a.totalCount);

    const sumActive = items.reduce((acc, x) => acc + x.activeCount, 0);
    const maxActive = Math.max(items[0]?.activeCount || 0, 1);

    listEl.innerHTML = items.map((item, idx) => {
        const pctOfTotal = sumActive > 0 ? Math.round((item.activeCount / sumActive) * 100) : 0;
        const barWidth = item.activeCount > 0 ? Math.max(4, Math.round((item.activeCount / maxActive) * 100)) : 0;
        const medal = idx === 0 && item.activeCount > 0 ? "🥇 " : idx === 1 && item.activeCount > 0 ? "🥈 " : idx === 2 && item.activeCount > 0 ? "🥉 " : `${idx + 1}위. `;
        const subText = mode === "today"
            ? `오늘 ${item.todayCount.toLocaleString()}회 (${pctOfTotal}%) · 누적 ${item.totalCount.toLocaleString()}회`
            : `누적 ${item.totalCount.toLocaleString()}회 (${pctOfTotal}%) · 오늘 ${item.todayCount.toLocaleString()}회`;
        return `<div class="stats-rank-row">
            <div class="stats-rank-top">
                <span style="color:var(--text-main); font-weight:${idx < 3 && item.activeCount > 0 ? '900' : '800'};">${medal}${item.label}</span>
                <span style="color:${item.activeCount > 0 ? 'var(--primary)' : 'var(--text-sub)'}; font-variant-numeric:tabular-nums;">${subText}</span>
            </div>
            <div class="stats-rank-bar-bg">
                <div class="stats-rank-bar-fill" style="width:${barWidth}%; background:${item.color};"></div>
            </div>
        </div>`;
    }).join("");
}
function renderStatsTerminalRanking(totalDoc, todayDoc) {
    const listEl = document.getElementById("statsTerminalRankingList");
    if (!listEl) return;
    const totalTerms = (totalDoc && totalDoc.terminals) || {};
    const todayTerms = (todayDoc && todayDoc.terminals) || {};
    const items = STATS_TERMINAL_META.map(m => ({
        ...m,
        totalCount: Number(totalTerms[m.id]) || 0,
        todayCount: Number(todayTerms[m.id]) || 0
    })).sort((a, b) => b.totalCount - a.totalCount || b.todayCount - a.todayCount);

    const sumTotal = items.reduce((a, b) => a + b.totalCount, 0);
    const maxTotal = Math.max(items[0]?.totalCount || 0, 1);

    listEl.innerHTML = items.map((item, idx) => {
        const pct = sumTotal > 0 ? Math.round((item.totalCount / sumTotal) * 100) : 0;
        const barW = item.totalCount > 0 ? Math.max(4, Math.round((item.totalCount / maxTotal) * 100)) : 0;
        const rankPrefix = idx === 0 && item.totalCount > 0 ? "🥇 " : idx === 1 && item.totalCount > 0 ? "🥈 " : idx === 2 && item.totalCount > 0 ? "🥉 " : `${idx + 1}. `;
        return `<div class="stats-rank-row">
            <div class="stats-rank-top">
                <span>${rankPrefix}${item.label}</span>
                <span style="color:var(--primary); font-variant-numeric:tabular-nums;">누적 ${item.totalCount.toLocaleString()}회 (${pct}%) · 오늘 ${item.todayCount}회</span>
            </div>
            <div class="stats-rank-bar-bg">
                <div class="stats-rank-bar-fill" style="width:${barW}%; background:${item.color};"></div>
            </div>
        </div>`;
    }).join("");
}
async function openVisitorStats() {
    try {
        if (!(await verifyAdmin(true))) return;
        await trackVisitorSession();
        const modal = document.getElementById("visitorStatsModal");
        modal.style.display = "flex";
        await loadAndRenderVisitorStats();
    } catch (error) {
        alert("방문자 통계를 불러오지 못했습니다: " + error.message);
    }
}
async function refreshVisitorStatsModal() {
    showToast("🔄 최신 운영 통계를 불러오는 중...");
    await loadAndRenderVisitorStats();
    showToast("✅ 실시간 통계가 갱신되었습니다.");
}
async function fetchServerAdminStatsPayload() {
    const adminToken = getStoredAdminSessionToken();
    if (!adminToken) return null;
    try {
        const resp = await fetchPortApiJson("/api/admin-stats", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${adminToken}`
            }
        });
        if (resp && resp.status === 200 && resp.data && resp.data.ok) {
            return resp.data;
        }
    } catch (e) {
        console.warn("서버 관리자 통계 API 폴백 전환:", e && e.message);
    }
    return null;
}

async function loadAndRenderVisitorStats() {
    const todayCountEl = document.getElementById("todayVisitorCount");
    const yesterdayCountEl = document.getElementById("yesterdayVisitorCount");
    const weekCountEl = document.getElementById("weekVisitorCount");
    const totalCountEl = document.getElementById("totalVisitorCount");
    if (todayCountEl) todayCountEl.innerText = "...";
    if (totalCountEl) totalCountEl.innerText = "...";

    await ensureAnonymousAuth();

    const now = new Date();
    const dayKeys = [];
    const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        dayKeys.push({
            key: getVisitorDateKey(d),
            shortDate: `${d.getMonth() + 1}/${d.getDate()}`,
            dayName: dayLabels[d.getDay()],
            isToday: i === 0
        });
    }

    // 1순위: 서버 Admin SDK(/api/admin-stats)로 보안 규칙을 우회해 전체 통계를 일괄 조회
    const serverAdminPayload = await fetchServerAdminStatsPayload();
    let serverSummaryPayload = null;

    let totalDoc = null;
    let dailyDocs = null;

    if (serverAdminPayload && serverAdminPayload.totalDoc && serverAdminPayload.dailyDocsByDate) {
        totalDoc = serverAdminPayload.totalDoc;
        dailyDocs = dayKeys.map(dk => serverAdminPayload.dailyDocsByDate[dk.key] || {});
    } else {
        try {
            const [totalSnap, ...dailySnaps] = await Promise.all([
                db.collection("visitor_stats").doc("total").get(),
                ...dayKeys.map(dk => db.collection("visitor_stats").doc(`daily-${dk.key}`).get())
            ]);
            totalDoc = totalSnap.exists ? totalSnap.data() : {};
            dailyDocs = dailySnaps.map(s => (s.exists ? s.data() : {}));
        } catch (visitorErr) {
            const summaryResp = await fetchPortApiJson("/api/analytics-summary");
            if (summaryResp && summaryResp.status === 200 && summaryResp.data && summaryResp.data.ok) {
                serverSummaryPayload = summaryResp.data;
                totalDoc = summaryResp.data.totalDoc || {};
                const byDate = summaryResp.data.dailyDocsByDate || {};
                dailyDocs = dayKeys.map(dk => byDate[dk.key] || {});
            } else {
                throw visitorErr;
            }
        }
    }

    const todayDoc = dailyDocs[6] || {};
    const yesterdayDoc = dailyDocs[5] || {};

    cachedStatsModalData.totalDoc = totalDoc;
    cachedStatsModalData.todayDoc = todayDoc;

    const todayVisitors = Number(todayDoc.count) || 0;
    const yesterdayVisitors = Number(yesterdayDoc.count) || 0;
    const totalVisitors = Number(totalDoc.count) || 0;
    const weekVisitors = dailyDocs.reduce((acc, d) => acc + (Number(d.count) || 0), 0);
    const weekAvg = Math.round(weekVisitors / 7);

    const todayUniqueRaw = Number(todayDoc.unique) || 0;
    const todayUniqueVisitors = todayUniqueRaw > 0 ? Math.min(todayUniqueRaw, Math.max(todayVisitors, todayUniqueRaw)) : (todayVisitors > 0 ? 1 : 0);
    const totalUniqueRaw = Number(totalDoc.unique) || 0;
    const weekUniqueSum = dailyDocs.reduce((acc, d) => acc + (Number(d.unique) || 0), 0);
    const totalUniqueVisitors = Math.max(totalUniqueRaw, weekUniqueSum, todayUniqueVisitors);
    const repeatSessions = Math.max(0, todayVisitors - todayUniqueVisitors);
    const returnRatePct = todayVisitors > 0 ? Math.round((repeatSessions / todayVisitors) * 100) : 0;

    if (todayCountEl) todayCountEl.innerText = `${todayVisitors.toLocaleString()}명`;
    if (yesterdayCountEl) yesterdayCountEl.innerText = `${yesterdayVisitors.toLocaleString()}명`;
    if (weekCountEl) weekCountEl.innerText = `${weekVisitors.toLocaleString()}명`;
    if (totalCountEl) totalCountEl.innerText = `${totalVisitors.toLocaleString()}명`;

    const todayUniqueEl = document.getElementById("todayUniqueVisitorCount");
    const todayReturnRateEl = document.getElementById("todayReturnRateVal");
    const totalUniqueSubEl = document.getElementById("totalUniqueSummarySub");
    if (todayUniqueEl) todayUniqueEl.innerText = `${todayUniqueVisitors.toLocaleString()}명 (순 방문자)`;
    if (todayReturnRateEl) todayReturnRateEl.innerText = `다중 탭·재방문율: ${returnRatePct}% (재방문 ${repeatSessions}세션)`;
    if (totalUniqueSubEl) totalUniqueSubEl.innerText = `누적 순 방문자(기기 기준): ${totalUniqueVisitors.toLocaleString()}명 · 자정 경계(dateKey) 분리 적용`;

    const diffBadge = document.getElementById("todayVisitorDiffBadge");
    if (diffBadge) {
        const diff = todayVisitors - yesterdayVisitors;
        if (yesterdayVisitors === 0 && todayVisitors > 0) {
            diffBadge.innerText = `▲ +${todayVisitors}명`;
            diffBadge.style.color = "#16a34a";
        } else if (diff > 0) {
            diffBadge.innerText = `전일 대비 ▲ +${diff}명`;
            diffBadge.style.color = "#16a34a";
        } else if (diff < 0) {
            diffBadge.innerText = `전일 대비 ▼ ${diff}명`;
            diffBadge.style.color = "#dc2626";
        } else {
            diffBadge.innerText = "전일과 동일";
            diffBadge.style.color = "var(--text-sub)";
        }
    }

    const weekAvgEl = document.getElementById("weekAvgVisitorSub");
    if (weekAvgEl) weekAvgEl.innerText = `최근 7일 일평균: ${weekAvg.toLocaleString()}명`;

    let peakDay = { label: "-", count: 0 };
    dayKeys.forEach((dk, idx) => {
        const c = Number(dailyDocs[idx]?.count) || 0;
        if (c >= peakDay.count) peakDay = { label: `${dk.shortDate}(${dk.dayName})`, count: c };
    });
    const peakDayEl = document.getElementById("peakDayVisitorSub");
    if (peakDayEl) peakDayEl.innerText = `최고: ${peakDay.label} (${peakDay.count}명)`;

    const sumObjValues = obj => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const todayBlockClicks = sumObjValues(todayDoc.blocks) + sumObjValues(todayDoc.terminals);
    const totalBlockClicks = sumObjValues(totalDoc.blocks) + sumObjValues(totalDoc.terminals);
    const todayClickSub = document.getElementById("todayClickSummarySub");
    const totalClickSub = document.getElementById("totalClickSummarySub");
    if (todayClickSub) todayClickSub.innerText = `오늘 메뉴·터미널 클릭: ${todayBlockClicks.toLocaleString()}회`;
    if (totalClickSub) totalClickSub.innerText = `누적 메뉴·터미널 클릭: ${totalBlockClicks.toLocaleString()}회`;

    // 7일 추이 차트 렌더링
    const chartEl = document.getElementById("stats7DayChart");
    const labelsEl = document.getElementById("stats7DayLabels");
    const max7Day = Math.max(...dailyDocs.map(d => Number(d.count) || 0), 1);
    if (chartEl && labelsEl) {
        chartEl.innerHTML = dayKeys.map((dk, idx) => {
            const c = Number(dailyDocs[idx]?.count) || 0;
            const hPct = c > 0 ? Math.max(8, Math.round((c / max7Day) * 78)) : 4;
            return `<div class="stats-7day-col">
                <span style="font-size:0.68rem; font-weight:900; color:${dk.isToday ? '#d97706' : 'var(--primary)'}; margin-bottom:3px;">${c}</span>
                <div class="stats-7day-bar ${dk.isToday ? 'is-today' : ''}" style="height:${hPct}px;"></div>
            </div>`;
        }).join("");
        labelsEl.innerHTML = dayKeys.map(dk => `<div style="color:${dk.isToday ? '#d97706' : 'var(--text-sub)'}; font-weight:${dk.isToday ? '900' : '800'};">${dk.shortDate}<br>(${dk.isToday ? '오늘' : dk.dayName})</div>`).join("");
    }

    // 블럭 클릭 순위 & 터미널 순위 렌더링
    renderStatsBlockRanking(totalDoc, todayDoc, cachedStatsModalData.currentBlockMode || "total");
    renderStatsTerminalRanking(totalDoc, todayDoc);

    // 주요 기능 사용 횟수 렌더링
    const actionGridEl = document.getElementById("statsActionUsageGrid");
    if (actionGridEl) {
        const tActions = totalDoc.actions || {};
        const dActions = todayDoc.actions || {};
        actionGridEl.innerHTML = STATS_ACTION_META.map(a => {
            const tVal = Number(tActions[a.id]) || 0;
            const dVal = Number(dActions[a.id]) || 0;
            return `<div class="stats-mini-item">
                <span style="color:var(--text-main);">${a.label}</span>
                <span style="color:var(--primary); font-variant-numeric:tabular-nums;">${dVal} / <b>${tVal.toLocaleString()}회</b></span>
            </div>`;
        }).join("");
    }

    // 접속 기기 및 시간대 분포 렌더링
    const devHourBox = document.getElementById("statsDeviceAndHourBox");
    if (devHourBox) {
        const devs = totalDoc.devices || {};
        const andCnt = Number(devs.android) || 0;
        const iosCnt = Number(devs.ios) || 0;
        const pcCnt = Number(devs.desktop) || 0;
        const devRecordedTotal = andCnt + iosCnt + pcCnt;
        const devSum = Math.max(devRecordedTotal, 1);

        const hrs = totalDoc.hours || {};
        const h0 = Number(hrs.h00_06) || 0;
        const h6 = Number(hrs.h06_12) || 0;
        const h12 = Number(hrs.h12_18) || 0;
        const h18 = Number(hrs.h18_24) || 0;
        const hrRecordedTotal = h0 + h6 + h12 + h18;
        const hrSum = Math.max(hrRecordedTotal, 1);

        const sampleRatioPct = totalVisitors > 0 ? ((devRecordedTotal / totalVisitors) * 100).toFixed(1) : "0.0";
        const isLowSample = totalVisitors > devRecordedTotal;
        const sampleWarningBanner = `
            <div style="background:${isLowSample ? '#fffbeb' : '#f0fdf4'}; border:1px solid ${isLowSample ? '#fcd34d' : '#86efac'}; border-radius:8px; padding:7px 10px; margin-bottom:8px; font-size:0.73rem; line-height:1.45; color:${isLowSample ? '#92400e' : '#065f46'}; font-weight:800;">
                <div>⚠️ 표본 안내: <b>기기 ${devRecordedTotal.toLocaleString()}건 · 시간대 ${hrRecordedTotal.toLocaleString()}건 / 전체 ${totalVisitors.toLocaleString()}세션 (${sampleRatioPct}%) — 참고용</b></div>
                <div style="font-size:0.7rem; color:${isLowSample ? '#b45309' : '#047857'}; margin-top:2px;">📌 구버전(v2026) 기간에는 총 방문 수(count)만 기록되었으며, <b>10/06(v2027 배포) 이후부터 기기·시간대·순 방문자가 정상 집계</b>됩니다.</div>
            </div>
        `;

        devHourBox.innerHTML = `
            ${sampleWarningBanner}
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; text-align:center; margin-bottom:8px;">
                <div style="background:rgba(16,185,129,0.08); border:1px solid #a7f3d0; border-radius:8px; padding:6px 4px;">
                    <div style="font-size:0.7rem; font-weight:800; color:#065f46;">🤖 안드로이드</div>
                    <div style="font-size:0.9rem; font-weight:900; color:#047857; margin-top:2px;">${andCnt.toLocaleString()}명 (${andCnt ? Math.round((andCnt/devSum)*100) : 0}%)</div>
                </div>
                <div style="background:rgba(59,130,246,0.08); border:1px solid #bfdbfe; border-radius:8px; padding:6px 4px;">
                    <div style="font-size:0.7rem; font-weight:800; color:#1e40af;">🍎 아이폰(iOS)</div>
                    <div style="font-size:0.9rem; font-weight:900; color:#1d4ed8; margin-top:2px;">${iosCnt.toLocaleString()}명 (${iosCnt ? Math.round((iosCnt/devSum)*100) : 0}%)</div>
                </div>
                <div style="background:rgba(100,116,139,0.08); border:1px solid #cbd5e1; border-radius:8px; padding:6px 4px;">
                    <div style="font-size:0.7rem; font-weight:800; color:#334155;">💻 PC · 기타</div>
                    <div style="font-size:0.9rem; font-weight:900; color:#475569; margin-top:2px;">${pcCnt.toLocaleString()}명 (${pcCnt ? Math.round((pcCnt/devSum)*100) : 0}%)</div>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; text-align:center;">
                <div style="background:var(--bg-color); border:1px solid var(--border); border-radius:6px; padding:5px 2px;">
                    <div style="font-size:0.66rem; color:var(--text-sub); font-weight:800;">🌙 00~06시</div>
                    <div style="font-size:0.8rem; font-weight:900; color:var(--primary); margin-top:2px;">${h0}회 (${h0 ? Math.round((h0/hrSum)*100) : 0}%)</div>
                </div>
                <div style="background:var(--bg-color); border:1px solid var(--border); border-radius:6px; padding:5px 2px;">
                    <div style="font-size:0.66rem; color:var(--text-sub); font-weight:800;">☀️ 06~12시</div>
                    <div style="font-size:0.8rem; font-weight:900; color:#2563eb; margin-top:2px;">${h6}회 (${h6 ? Math.round((h6/hrSum)*100) : 0}%)</div>
                </div>
                <div style="background:var(--bg-color); border:1px solid var(--border); border-radius:6px; padding:5px 2px;">
                    <div style="font-size:0.66rem; color:var(--text-sub); font-weight:800;">🌤️ 12~18시</div>
                    <div style="font-size:0.8rem; font-weight:900; color:#d97706; margin-top:2px;">${h12}회 (${h12 ? Math.round((h12/hrSum)*100) : 0}%)</div>
                </div>
                <div style="background:var(--bg-color); border:1px solid var(--border); border-radius:6px; padding:5px 2px;">
                    <div style="font-size:0.66rem; color:var(--text-sub); font-weight:800;">🌉 18~24시</div>
                    <div style="font-size:0.8rem; font-weight:900; color:#7c3aed; margin-top:2px;">${h18}회 (${h18 ? Math.round((h18/hrSum)*100) : 0}%)</div>
                </div>
            </div>
        `;
    }

    // 앱 DB 누적 콘텐츠 현황 조회
    const dbGridEl = document.getElementById("statsDbContentGrid");
    if (dbGridEl) {
        let workersCnt = 0, logsCnt = 0, noticesCnt = 0, archivesCnt = 0;
        let serverShipsCnt = null, serverPostsCnt = null;
        let workerAccounts = [];
        const workerLogSummary = {};

        if (serverAdminPayload && serverAdminPayload.counts) {
            workersCnt = Number(serverAdminPayload.counts.workersCount) || 0;
            logsCnt = Number(serverAdminPayload.counts.workLogsCount) || 0;
            noticesCnt = Number(serverAdminPayload.counts.noticesCount) || 0;
            archivesCnt = Number(serverAdminPayload.counts.archivesCount) || 0;
            serverShipsCnt = Number(serverAdminPayload.counts.shipsCount) || 0;
            serverPostsCnt = Number(serverAdminPayload.counts.postsCount) || 0;
            workerAccounts = Array.isArray(serverAdminPayload.workerAccounts) ? serverAdminPayload.workerAccounts : [];
            cachedStatsModalData.workerAccounts = workerAccounts;

            if (Array.isArray(serverAdminPayload.workLogs)) {
                adminWorkLogDetailCache.logs = serverAdminPayload.workLogs;
                adminWorkLogDetailCache.loadedAt = Date.now();
            }
        } else {
            try {
                const hasNoticesCache = Array.isArray(window.allNoticesCache);
                const hasArchivesCache = typeof window.allArchivesCount === "number";
                const [uSnap, lSnap, nSnap, aSnap] = await Promise.all([
                    db.collection("user_profiles").get(),
                    db.collection("work_logs").get(),
                    hasNoticesCache ? Promise.resolve(null) : db.collection("notices").get(),
                    hasArchivesCache ? Promise.resolve(null) : db.collection("archives").get()
                ]);
                workersCnt = uSnap.size;
                noticesCnt = hasNoticesCache ? window.allNoticesCache.length : (nSnap ? nSnap.size : 0);
                archivesCnt = hasArchivesCache ? window.allArchivesCount : (aSnap ? aSnap.size : 0);

                let activeLogsCnt = 0;
                lSnap.forEach(doc => {
                    const d = doc.data() || {};
                    if (isDeletedRecord(d)) return;
                    activeLogsCnt += 1;
                    const wid = String(d.workerId || "").trim() || (doc.id.includes("_") ? doc.id.split("_")[0] : "");
                    if (!wid) return;
                    if (!workerLogSummary[wid]) {
                        workerLogSummary[wid] = { count: 0, totalPay: 0, lastDate: "", lastSavedMs: 0 };
                    }
                    workerLogSummary[wid].count += 1;
                    const pay = Number(d.totalPay) || ((Number(d.wage1) || 0) + (Number(d.wage2) || 0) + (Number(d.wage3) || 0) + (Number(d.wage4) || 0));
                    workerLogSummary[wid].totalPay += pay;
                    const dateStr = String(d.date || "");
                    if (dateStr && (!workerLogSummary[wid].lastDate || dateStr > workerLogSummary[wid].lastDate)) {
                        workerLogSummary[wid].lastDate = dateStr;
                    }
                    const tsMs = d.timestamp && typeof d.timestamp.toMillis === "function" ? d.timestamp.toMillis() : 0;
                    if (tsMs > workerLogSummary[wid].lastSavedMs) {
                        workerLogSummary[wid].lastSavedMs = tsMs;
                    }
                });
                logsCnt = activeLogsCnt;

                uSnap.forEach(doc => {
                    const d = doc.data() || {};
                    const nick = doc.id;
                    let createdMs = 0;
                    let createdStr = "날짜 기록 없음";
                    const rawTs = d.createdAt || d.timestamp || d.updatedAt;
                    if (rawTs && typeof rawTs.toDate === "function") {
                        const dt = rawTs.toDate();
                        createdMs = dt.getTime();
                        createdStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
                    } else if (typeof rawTs === "string" && rawTs.trim()) {
                        createdStr = rawTs.trim();
                    }
                    const logStat = workerLogSummary[nick] || { count: 0, totalPay: 0, lastDate: "-", lastSavedMs: 0 };
                    const pwStr = String(d.password || "");
                    const isSha256 = /^[a-f0-9]{64}$/i.test(pwStr);
                    workerAccounts.push({
                        nick,
                        createdMs,
                        createdStr,
                        logCount: logStat.count,
                        totalPay: logStat.totalPay,
                        lastDate: logStat.lastDate || "-",
                        lastSavedMs: logStat.lastSavedMs,
                        isSha256
                    });
                });

                workerAccounts.sort((a, b) => (b.createdMs - a.createdMs) || (b.lastSavedMs - a.lastSavedMs) || (b.logCount - a.logCount) || a.nick.localeCompare(b.nick, "ko"));
                cachedStatsModalData.workerAccounts = workerAccounts;
            } catch (clientDbErr) {
                console.warn("클라이언트 DB 현황 조회 폴백(/api/analytics-summary):", clientDbErr && clientDbErr.message);
                try {
                    if (!serverSummaryPayload) {
                        const summaryResp = await fetchPortApiJson("/api/analytics-summary");
                        if (summaryResp && summaryResp.status === 200 && summaryResp.data && summaryResp.data.ok) {
                            serverSummaryPayload = summaryResp.data;
                        }
                    }
                    if (serverSummaryPayload && serverSummaryPayload.collections) {
                        const cols = serverSummaryPayload.collections;
                        workersCnt = Number(cols.workersCount) || 0;
                        logsCnt = Number(cols.workLogsCount) || 0;
                        noticesCnt = Number(cols.noticesCount) || (Array.isArray(window.allNoticesCache) ? window.allNoticesCache.length : 0);
                        archivesCnt = Number(cols.archivesCount) || (typeof window.allArchivesCount === "number" ? window.allArchivesCount : 0);
                        serverShipsCnt = Number(cols.shipsCount) || 0;
                        serverPostsCnt = Number(cols.postsCount) || 0;
                    }
                } catch (e2) {}
            }
        }
        const shipsCnt = Array.isArray(allShipsData) && allShipsData.length > 0 ? allShipsData.length : (serverShipsCnt ?? 0);
        const postsCnt = Array.isArray(allPostsData) && allPostsData.length > 0 ? allPostsData.length : (serverPostsCnt ?? 0);
        dbGridEl.innerHTML = `
            <div class="stats-mini-item"><span>🚢 등록 선박 도감</span><b style="color:#0284c7;">${shipsCnt.toLocaleString()}척</b></div>
            <div class="stats-mini-item"><span>💬 자유게시판 게시글</span><b style="color:#4f46e5;">${postsCnt.toLocaleString()}건</b></div>
            <div class="stats-mini-item tap-effect" onclick="toggleStatsWorkerAccountList()" title="클릭하여 가입 근로자 계정 상세 정보 보기" style="cursor:pointer; border:1.5px solid #10b981; background:rgba(16,185,129,0.08);">
                <span>👤 가입 근로자 계정 <span style="font-size:0.65rem; color:#047857; text-decoration:underline;">(상세 ▼)</span></span>
                <b style="color:#047857;">${workersCnt.toLocaleString()}명</b>
            </div>
            <div class="stats-mini-item tap-effect" onclick="openAdminWorkLogDetailFromStats()" title="클릭하여 누적 근무일지 전체 상세 목록 보기" style="cursor:pointer; border:1.5px solid #f59e0b; background:rgba(245,158,11,0.1);">
                <span>📅 누적 근무일지 기록 <span style="font-size:0.65rem; color:#b45309; text-decoration:underline;">(상세 ↗)</span></span>
                <b style="color:#d97706;">${logsCnt.toLocaleString()}건</b>
            </div>
            <div class="stats-mini-item"><span>📢 등록 공지사항</span><b style="color:#dc2626;">${noticesCnt.toLocaleString()}건</b></div>
            <div class="stats-mini-item"><span>📂 자료실 업로드 파일</span><b style="color:var(--primary);">${archivesCnt.toLocaleString()}개</b></div>
        `;
        const detailBox = document.getElementById("statsWorkerAccountDetailBox");
        if (detailBox && !detailBox.classList.contains("hidden")) {
            renderStatsWorkerAccountList();
        }
    }

    const timeEl = document.getElementById("visitorStatsUpdatedTime");
    if (timeEl) {
        timeEl.innerText = `기준 시각: ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    }

    // 복사할 요약 텍스트 생성
    const topBlocks = STATS_BLOCK_META
        .map(m => ({ label: m.label, cnt: Number((totalDoc.blocks || {})[m.id]) || 0 }))
        .sort((a, b) => b.cnt - a.cnt)
        .slice(0, 5);
    const topTerms = STATS_TERMINAL_META
        .map(m => ({ label: m.label, cnt: Number((totalDoc.terminals || {})[m.id]) || 0 }))
        .sort((a, b) => b.cnt - a.cnt)
        .slice(0, 3);

    cachedStatsModalData.reportText = [
        `📊 [BUSAN HAK PORT 통합 운영 통계 리포트]`,
        `• 조회 일시: ${timeEl ? timeEl.innerText.replace('기준 시각: ', '') : ''}`,
        `• 오늘 방문자: ${todayVisitors.toLocaleString()}명 / 순 방문자: ${todayUniqueVisitors.toLocaleString()}명 (다중 탭·재방문율 ${returnRatePct}%)`,
        `• 어제 방문자: ${yesterdayVisitors.toLocaleString()}명`,
        `• 최근 7일 방문자: ${weekVisitors.toLocaleString()}명 (일평균 ${weekAvg.toLocaleString()}명)`,
        `• 총 누적 방문자: ${totalVisitors.toLocaleString()}명 (누적 순 방문자: ${totalUniqueVisitors.toLocaleString()}명)`,
        `• 기기·시간대 표본 안내: 10/06(v2027) 이후 정상 집계 적용`,
        `• 인기 클릭 블록 TOP 5: ` + topBlocks.map((b, i) => `${i+1}위 ${b.label}(${b.cnt}회)`).join(", "),
        `• 인기 터미널 TOP 3: ` + topTerms.map((t, i) => `${i+1}위 ${t.label}(${t.cnt}회)`).join(", ")
    ].join("\n");
}
function copyVisitorStatsReport() {
    const txt = cachedStatsModalData.reportText;
    if (!txt) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => showToast("📋 운영 통계 리포트가 클립보드에 복사되었습니다!"));
    } else {
        const ta = document.createElement("textarea");
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showToast("📋 운영 통계 리포트가 복사되었습니다!");
    }
}
function toggleStatsWorkerAccountList(forceOpen) {
    const box = document.getElementById("statsWorkerAccountDetailBox");
    if (!box) return;
    const willOpen = typeof forceOpen === "boolean" ? forceOpen : box.classList.contains("hidden");
    box.classList.toggle("hidden", !willOpen);
    if (willOpen) {
        renderStatsWorkerAccountList();
        setTimeout(() => box.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
    }
}
function renderStatsWorkerAccountList() {
    const container = document.getElementById("statsWorkerAccountListContainer");
    const titleEl = document.getElementById("statsWorkerAccountTitle");
    if (!container) return;
    const allList = Array.isArray(cachedStatsModalData.workerAccounts) ? cachedStatsModalData.workerAccounts : [];
    const q = (document.getElementById("statsWorkerSearchInput")?.value || "").trim().toLowerCase();
    const filtered = q ? allList.filter(w => w.nick.toLowerCase().includes(q) || w.createdStr.toLowerCase().includes(q)) : allList;

    if (titleEl) {
        titleEl.innerText = `👤 가입 근로자 계정 상세 (${filtered.length}명 / 총 ${allList.length}명)`;
    }
    if (filtered.length === 0) {
        container.innerHTML = `<div style="padding:18px; text-align:center; font-size:0.8rem; color:var(--text-sub); font-weight:800;">조회된 가입 근로자 계정이 없습니다.</div>`;
        return;
    }

    const escapeTxt = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const rows = filtered.map((w, idx) => `
        <tr style="border-bottom:1px solid var(--border); background:${idx % 2 === 1 ? 'rgba(10,27,63,0.025)' : 'transparent'};">
            <td style="padding:7px 6px; text-align:center; font-weight:800; color:var(--text-sub); font-size:0.73rem;">${idx + 1}</td>
            <td style="padding:7px 6px; font-weight:900; color:var(--primary); font-size:0.8rem;">
                <div>👤 ${escapeTxt(w.nick)}</div>
                <div style="font-size:0.65rem; color:${w.isSha256 ? '#047857' : '#d97706'}; font-weight:700; margin-top:1px;">${w.isSha256 ? '🔒 암호화(SHA-256)' : '🔑 일반 저장'}</div>
            </td>
            <td style="padding:7px 6px; text-align:center; font-size:0.73rem; font-weight:800; color:var(--text-main);">
                <div>${escapeTxt(w.createdStr)}</div>
                <div style="font-size:0.66rem; color:var(--text-sub); margin-top:1px;">최근 기록: ${escapeTxt(w.lastDate)}</div>
            </td>
            <td style="padding:7px 6px; text-align:right; font-size:0.75rem; font-weight:900; color:#047857; font-variant-numeric:tabular-nums;">
                <div>${w.logCount.toLocaleString()}건</div>
                <div style="font-size:0.66rem; color:#2563eb; font-weight:800; margin-top:1px;">${w.totalPay.toLocaleString()}원</div>
            </td>
        </tr>
    `).join("");

    container.innerHTML = `
        <table style="width:100%; border-collapse:collapse; text-align:left;">
            <thead style="position:sticky; top:0; background:var(--primary); color:#ffffff; font-size:0.72rem; font-weight:900; z-index:2;">
                <tr>
                    <th style="padding:6px; width:36px; text-align:center;">No.</th>
                    <th style="padding:6px;">닉네임 (ID) · 보안</th>
                    <th style="padding:6px; text-align:center;">가입 일시 / 최근 근무일</th>
                    <th style="padding:6px; text-align:right;">일지 수 / 누적액</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}
function closeVisitorStats() { document.getElementById("visitorStatsModal").style.display = "none"; }

/* ==================================================================
   📅 누적 근무일지 통합 상세보기 (관리자 · 통합 조회 모달)
   ================================================================== */
const adminWorkLogDetailCache = {
    logs: [],
    loadedAt: 0,
    reportText: ""
};

function setAdminWorkLogText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function formatAdminWorkLogDateTime(ts) {
    if (!ts) return "-";
    try {
        const dt = typeof ts.toDate === "function" ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
        if (isNaN(dt.getTime())) return "-";
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
    } catch (e) {
        return "-";
    }
}

async function openAdminWorkLogDetail(initialWorker = "") {
    if (!(await verifyAdmin())) return;
    showAdminWorkLogModal(initialWorker);
}

async function openAdminWorkLogDetailFromStats(initialWorker = "") {
    if ((!isAdminSessionVerified || !hasServerBackedAdminAccess()) && !(await verifyAdmin())) return;
    showAdminWorkLogModal(initialWorker);
}

function showAdminWorkLogModal(initialWorker = "") {
    const modal = document.getElementById("adminWorkLogModal");
    if (!modal) return;
    modal.style.display = "flex";
    loadAdminWorkLogDetail(false, initialWorker);
}

function closeAdminWorkLogDetail() {
    const modal = document.getElementById("adminWorkLogModal");
    if (modal) modal.style.display = "none";
}

async function loadAdminWorkLogDetail(forceRefresh = false, initialWorker = "") {
    const tableWrap = document.getElementById("awlTableContainer");
    if (tableWrap && (forceRefresh || adminWorkLogDetailCache.logs.length === 0)) {
        tableWrap.innerHTML = `<div style="padding:24px; text-align:center; font-size:0.84rem; font-weight:800; color:var(--text-sub);">⏳ 누적 근무일지 데이터를 불러오는 중입니다...</div>`;
    }

    if (forceRefresh || adminWorkLogDetailCache.logs.length === 0 || (Date.now() - adminWorkLogDetailCache.loadedAt > 60000)) {
        try {
            await ensureAnonymousAuth();
            let items = null;
            const serverAdminPayload = await fetchServerAdminStatsPayload();
            if (serverAdminPayload && Array.isArray(serverAdminPayload.workLogs)) {
                items = serverAdminPayload.workLogs;
                if (Array.isArray(serverAdminPayload.workerAccounts)) {
                    cachedStatsModalData.workerAccounts = serverAdminPayload.workerAccounts;
                }
            } else {
                const snap = await db.collection("work_logs").get();
                items = [];
                snap.forEach(doc => {
                    const d = doc.data() || {};
                    if (isDeletedRecord(d)) return;
                    const docId = doc.id || "";
                    const wid = String(d.workerId || "").trim() || (docId.includes("_") ? docId.split("_")[0] : "미지정");
                    const dateStr = String(d.date || "").trim() || (docId.includes("_") ? docId.split("_").slice(1).join("_") : "-");
                    const wage1 = Number(d.wage1) || 0;
                    const wage2 = Number(d.wage2) || 0;
                    const wage3 = Number(d.wage3) || 0;
                    const wage4 = Number(d.wage4) || 0;
                    const totalPay = Number(d.totalPay) || (wage1 + wage2 + wage3 + wage4);
                    const savedMs = d.timestamp && typeof d.timestamp.toMillis === "function" ? d.timestamp.toMillis() : 0;
                    const savedStr = formatAdminWorkLogDateTime(d.timestamp);
                    items.push({
                        id: docId,
                        workerId: wid,
                        date: dateStr,
                        shipName: String(d.shipName || "").trim(),
                        wage1,
                        wage2,
                        wage3,
                        wage4,
                        totalPay,
                        coworkers: String(d.coworkers || "").trim(),
                        memo: String(d.memo || "").trim(),
                        imageUrl: String(d.imageUrl || "").trim(),
                        savedMs,
                        savedStr
                    });
                });
            }
            adminWorkLogDetailCache.logs = items;
            adminWorkLogDetailCache.loadedAt = Date.now();
            const now = new Date();
            setAdminWorkLogText(
                "awlUpdatedTime",
                `기준 시각: ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} · 총 ${items.length.toLocaleString()}건`
            );
        } catch (err) {
            console.error("누적 근무일지 상세 조회 오류:", err);
            if (tableWrap) {
                tableWrap.innerHTML = `<div style="padding:20px; text-align:center; font-size:0.82rem; font-weight:800; color:var(--danger);">⚠️ 누적 근무일지 조회에 실패했습니다: ${escapeShipCommentHtml(err.message || "알 수 없는 오류")}</div>`;
            }
            return;
        }
    }

    const nowTime = new Date(adminWorkLogDetailCache.loadedAt || Date.now());
    setAdminWorkLogText(
        "awlUpdatedTime",
        `기준 시각: ${nowTime.getFullYear()}-${String(nowTime.getMonth() + 1).padStart(2, "0")}-${String(nowTime.getDate()).padStart(2, "0")} ${String(nowTime.getHours()).padStart(2, "0")}:${String(nowTime.getMinutes()).padStart(2, "0")}:${String(nowTime.getSeconds()).padStart(2, "0")} · 총 ${adminWorkLogDetailCache.logs.length.toLocaleString()}건`
    );

    populateAdminWorkLogWorkerSelect(initialWorker);
    renderAdminWorkLogDetail();
}

function populateAdminWorkLogWorkerSelect(initialWorker = "") {
    const sel = document.getElementById("awlWorkerSelect");
    if (!sel) return;
    const prevVal = initialWorker !== "" ? initialWorker : sel.value;
    const counts = {};
    adminWorkLogDetailCache.logs.forEach(item => {
        counts[item.workerId] = (counts[item.workerId] || 0) + 1;
    });
    const sortedWorkers = Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], "ko"));
    sel.innerHTML = `<option value="">👤 전체 근로자 (${sortedWorkers.length}명 · ${adminWorkLogDetailCache.logs.length}건)</option>` +
        sortedWorkers.map(([wid, cnt]) => {
            const safeWid = escapeShipCommentHtml(wid);
            return `<option value="${safeWid}">${safeWid} (${cnt}건)</option>`;
        }).join("");
    if (prevVal && counts[prevVal]) {
        sel.value = prevVal;
    } else if (initialWorker === "") {
        sel.value = "";
    }
}

function getAdminWorkLogFiltered() {
    const workerFilter = (document.getElementById("awlWorkerSelect")?.value || "").trim();
    const sortMode = document.getElementById("awlSortSelect")?.value || "date_desc";
    const startDate = (document.getElementById("awlStartDate")?.value || "").trim();
    const endDate = (document.getElementById("awlEndDate")?.value || "").trim();
    const kw = (document.getElementById("awlKeywordInput")?.value || "").trim().toLowerCase();

    const filtered = adminWorkLogDetailCache.logs.filter(item => {
        if (workerFilter && item.workerId !== workerFilter) return false;
        if (startDate && item.date < startDate) return false;
        if (endDate && item.date > endDate) return false;
        if (kw) {
            const hay = `${item.workerId} ${item.date} ${item.shipName} ${item.coworkers} ${item.memo} ${item.totalPay}`.toLowerCase();
            if (!hay.includes(kw)) return false;
        }
        return true;
    });

    filtered.sort((a, b) => {
        if (sortMode === "date_asc") return a.date.localeCompare(b.date) || (a.savedMs - b.savedMs);
        if (sortMode === "saved_desc") return (b.savedMs - a.savedMs) || b.date.localeCompare(a.date);
        if (sortMode === "pay_desc") return (b.totalPay - a.totalPay) || b.date.localeCompare(a.date);
        if (sortMode === "pay_asc") return (a.totalPay - b.totalPay) || b.date.localeCompare(a.date);
        return b.date.localeCompare(a.date) || (b.savedMs - a.savedMs);
    });

    return filtered;
}

function filterAdminWorkLogByWorker(workerId) {
    const sel = document.getElementById("awlWorkerSelect");
    if (!sel) return;
    sel.value = sel.value === workerId ? "" : workerId;
    renderAdminWorkLogDetail();
}

function filterAdminWorkLogByKeyword(keyword) {
    const input = document.getElementById("awlKeywordInput");
    if (!input) return;
    input.value = input.value === keyword ? "" : keyword;
    renderAdminWorkLogDetail();
}

function resetAdminWorkLogFilters() {
    const wSel = document.getElementById("awlWorkerSelect");
    const sSel = document.getElementById("awlSortSelect");
    const sDate = document.getElementById("awlStartDate");
    const eDate = document.getElementById("awlEndDate");
    const kw = document.getElementById("awlKeywordInput");
    if (wSel) wSel.value = "";
    if (sSel) sSel.value = "date_desc";
    if (sDate) sDate.value = "";
    if (eDate) eDate.value = "";
    if (kw) kw.value = "";
    renderAdminWorkLogDetail();
}

function renderAdminWorkLogDetail() {
    const allLogs = adminWorkLogDetailCache.logs || [];
    const filtered = getAdminWorkLogFiltered();

    let sumPay = 0, sumW1 = 0, sumW2 = 0, sumW3 = 0, sumW4 = 0, photoCnt = 0;
    const workerMap = {};
    const shipMap = {};
    const dateSet = new Set();
    let minDate = "", maxDate = "";

    filtered.forEach(item => {
        sumPay += item.totalPay;
        sumW1 += item.wage1;
        sumW2 += item.wage2;
        sumW3 += Number(item.wage3) || 0;
        sumW4 += Number(item.wage4) || 0;
        if (item.imageUrl) photoCnt += 1;
        if (item.date && item.date !== "-") {
            dateSet.add(item.date);
            if (!minDate || item.date < minDate) minDate = item.date;
            if (!maxDate || item.date > maxDate) maxDate = item.date;
        }
        if (!workerMap[item.workerId]) {
            workerMap[item.workerId] = { count: 0, pay: 0 };
        }
        workerMap[item.workerId].count += 1;
        workerMap[item.workerId].pay += item.totalPay;

        if (item.shipName) {
            if (!shipMap[item.shipName]) {
                shipMap[item.shipName] = { count: 0, pay: 0 };
            }
            shipMap[item.shipName].count += 1;
            shipMap[item.shipName].pay += item.totalPay;
        }
    });

    const uniqueWorkers = Object.keys(workerMap).length;
    const uniqueShips = Object.keys(shipMap).length;
    const avgPay = filtered.length > 0 ? Math.round(sumPay / filtered.length) : 0;

    setAdminWorkLogText("awlKpiCount", `${filtered.length.toLocaleString()}건`);
    setAdminWorkLogText("awlKpiCountSub", `전체 ${allLogs.length.toLocaleString()}건 중 ${filtered.length.toLocaleString()}건 표시`);
    setAdminWorkLogText("awlKpiTotalPay", `${sumPay.toLocaleString()}원`);
    setAdminWorkLogText("awlKpiSplitSub", `임금1: ${sumW1.toLocaleString()}원 · 임금2: ${sumW2.toLocaleString()}원 · 임금3: ${sumW3.toLocaleString()}원 · 임금4: ${sumW4.toLocaleString()}원`);
    setAdminWorkLogText("awlKpiWorkers", `${uniqueWorkers.toLocaleString()}명 / ${dateSet.size.toLocaleString()}일`);
    setAdminWorkLogText("awlKpiAvgSub", `건당 평균: ${avgPay.toLocaleString()}원`);
    setAdminWorkLogText("awlKpiShips", `${uniqueShips.toLocaleString()}척 / 📷 ${photoCnt.toLocaleString()}건`);
    setAdminWorkLogText("awlKpiRangeSub", minDate && maxDate ? `기간: ${minDate} ~ ${maxDate}` : "기간: 기록 없음");

    const topWorkers = Object.entries(workerMap)
        .sort((a, b) => (b[1].count - a[1].count) || (b[1].pay - a[1].pay))
        .slice(0, 5);
    const workerTopEl = document.getElementById("awlWorkerTopList");
    if (workerTopEl) {
        if (topWorkers.length === 0) {
            workerTopEl.innerText = "데이터 없음";
        } else {
            workerTopEl.innerHTML = topWorkers.map(([wid, st], i) => {
                const safeWid = escapeShipCommentHtml(wid);
                const jsWid = wid.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                return `<div style="display:flex; justify-content:space-between; gap:4px; cursor:pointer; padding:1px 0;" onclick="filterAdminWorkLogByWorker('${jsWid}')">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${i + 1}. <b style="color:var(--primary); text-decoration:underline;">${safeWid}</b></span>
                    <span style="color:#047857; font-weight:800; flex-shrink:0;">${st.count}건 · ${(st.pay / 10000).toFixed(0)}만</span>
                </div>`;
            }).join("");
        }
    }

    const topShips = Object.entries(shipMap)
        .sort((a, b) => (b[1].count - a[1].count) || (b[1].pay - a[1].pay))
        .slice(0, 5);
    const shipTopEl = document.getElementById("awlShipTopList");
    if (shipTopEl) {
        if (topShips.length === 0) {
            shipTopEl.innerText = "데이터 없음";
        } else {
            shipTopEl.innerHTML = topShips.map(([sname, st], i) => {
                const safeShip = escapeShipCommentHtml(sname);
                const jsShip = sname.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                return `<div style="display:flex; justify-content:space-between; gap:4px; cursor:pointer; padding:1px 0;" onclick="filterAdminWorkLogByKeyword('${jsShip}')">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${i + 1}. <b style="color:#1d4ed8; text-decoration:underline;">${safeShip}</b></span>
                    <span style="color:#c2410c; font-weight:800; flex-shrink:0;">${st.count}회</span>
                </div>`;
            }).join("");
        }
    }

    const tableWrap = document.getElementById("awlTableContainer");
    if (tableWrap) {
        if (filtered.length === 0) {
            tableWrap.innerHTML = `<div style="padding:22px; text-align:center; font-size:0.82rem; font-weight:800; color:var(--text-sub);">조건에 일치하는 근무일지 기록이 없습니다.</div>`;
        } else {
            const rowsHtml = filtered.map((item, idx) => {
                const safeWid = escapeShipCommentHtml(item.workerId);
                const jsWid = item.workerId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                const safeDate = escapeShipCommentHtml(item.date);
                const safeShip = escapeShipCommentHtml(item.shipName || "선박 미입력");
                const safeCw = escapeShipCommentHtml(item.coworkers || "");
                const safeMemo = escapeShipCommentHtml(item.memo || "");
                const safeSaved = escapeShipCommentHtml(item.savedStr);
                const jsImg = item.imageUrl ? item.imageUrl.replace(/\\/g, "\\\\").replace(/'/g, "\\'") : "";
                return `<tr>
                    <td style="text-align:center; font-weight:800; color:var(--text-sub); width:34px;">${idx + 1}</td>
                    <td style="white-space:nowrap;">
                        <div style="font-weight:900; color:var(--primary);">${safeDate}</div>
                        <span class="awl-worker-chip" onclick="filterAdminWorkLogByWorker('${jsWid}')" title="이 근로자만 필터">👤 ${safeWid}</span>
                        <div style="font-size:0.64rem; color:var(--text-sub); margin-top:2px;">저장: ${safeSaved}</div>
                    </td>
                    <td>
                        <div style="font-weight:900; color:#1d4ed8;">🚢 ${safeShip}</div>
                        ${safeCw ? `<div style="font-size:0.71rem; color:#047857; font-weight:800; margin-top:2px;">👥 동료: ${safeCw}</div>` : ""}
                        ${safeMemo ? `<div style="font-size:0.71rem; color:var(--text-main); margin-top:2px; white-space:pre-wrap; word-break:break-word;">📝 ${safeMemo}</div>` : ""}
                        ${item.imageUrl ? `<span class="awl-photo-badge" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src='${jsImg}';">📷 현장사진 보기</span>` : ""}
                    </td>
                    <td style="text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums;">
                        <div style="font-weight:900; color:#c2410c; font-size:0.8rem;">${item.totalPay.toLocaleString()}원</div>
                        <div style="font-size:0.66rem; color:var(--text-sub); font-weight:700; margin-top:2px;">1: ${item.wage1.toLocaleString()}</div>
                        <div style="font-size:0.66rem; color:var(--text-sub); font-weight:700;">2: ${item.wage2.toLocaleString()}</div>
                        ${Number(item.wage3) ? `<div style="font-size:0.66rem; color:var(--text-sub); font-weight:700;">3: ${Number(item.wage3).toLocaleString()}</div>` : ""}
                        ${Number(item.wage4) ? `<div style="font-size:0.66rem; color:var(--text-sub); font-weight:700;">4: ${Number(item.wage4).toLocaleString()}</div>` : ""}
                    </td>
                </tr>`;
            }).join("");

            tableWrap.innerHTML = `<table class="awl-table">
                <thead>
                    <tr>
                        <th style="width:34px; text-align:center;">No.</th>
                        <th style="width:118px;">근무일 · 근로자</th>
                        <th>선박명 · 동료 · 작업 메모</th>
                        <th style="width:92px; text-align:right;">정산 금액</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>`;
        }
    }

    adminWorkLogDetailCache.reportText = [
        `📅 [BUSAN HAK PORT 누적 근무일지 상세 분석 리포트]`,
        `• 조회 건수: ${filtered.length.toLocaleString()}건 (전체 ${allLogs.length.toLocaleString()}건)`,
        `• 조회 기간: ${minDate && maxDate ? `${minDate} ~ ${maxDate}` : "전체"}`,
        `• 참여 근로자: ${uniqueWorkers.toLocaleString()}명 / 활동 일수: ${dateSet.size.toLocaleString()}일`,
        `• 합산 금액: ${sumPay.toLocaleString()}원 (임금1: ${sumW1.toLocaleString()}원 / 임금2: ${sumW2.toLocaleString()}원 / 임금3: ${sumW3.toLocaleString()}원 / 임금4: ${sumW4.toLocaleString()}원 / 건당 평균: ${avgPay.toLocaleString()}원)`,
        `• 근로자 TOP 5: ` + (topWorkers.map(([w, st], i) => `${i + 1}위 ${w}(${st.count}건·${(st.pay / 10000).toFixed(0)}만)`).join(", ") || "없음"),
        `• 작업 선박 TOP 5: ` + (topShips.map(([s, st], i) => `${i + 1}위 ${s}(${st.count}회)`).join(", ") || "없음")
    ].join("\n");
}

function downloadAdminWorkLogCsv() {
    const filtered = getAdminWorkLogFiltered();
    if (filtered.length === 0) {
        showToast("⚠️ 저장할 근무일지 데이터가 없습니다.");
        return;
    }
    const csvEscape = val => `"${String(val ?? "").replace(/"/g, '""')}"`;
    const headers = ["No", "근무일", "근로자(ID)", "선박명", "임금1(원)", "임금2(원)", "임금3(원)", "임금4(원)", "총액(원)", "동반근무자", "작업메모", "사진여부", "저장일시"];
    const lines = [headers.map(csvEscape).join(",")];
    filtered.forEach((item, idx) => {
        lines.push([
            idx + 1,
            item.date,
            item.workerId,
            item.shipName,
            item.wage1,
            item.wage2,
            Number(item.wage3) || 0,
            Number(item.wage4) || 0,
            item.totalPay,
            item.coworkers,
            item.memo.replace(/\r?\n/g, " "),
            item.imageUrl ? "Y" : "N",
            item.savedStr
        ].map(csvEscape).join(","));
    });
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const todayStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `부산항_누적근무일지_상세_${todayStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`📊 누적 근무일지 ${filtered.length.toLocaleString()}건이 CSV(엑셀)로 저장되었습니다.`);
}

function copyAdminWorkLogReport() {
    const txt = adminWorkLogDetailCache.reportText;
    if (!txt) {
        showToast("⚠️ 복사할 리포트 내용이 없습니다.");
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => showToast("📋 누적 근무일지 분석 리포트가 복사되었습니다!"));
    } else {
        const ta = document.createElement("textarea");
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showToast("📋 누적 근무일지 분석 리포트가 복사되었습니다!");
    }
}

// 🔐 화면 잠금(보안 비밀번호) — PIN 은 더 이상 소스에 두지 않습니다.
//   1순위: 서버 검증 POST /api/screen-unlock (PIN 은 서버 환경변수 SCREEN_LOCK_PIN)
//   2순위: 정적 호스팅·오프라인 대비, 빌드 시 주입된 해시와 비교
//   ※ 실제 데이터 보호는 firestore.rules 의 isAdmin() 이 담당합니다. 이 잠금은 화면 UX용입니다.
const SCREEN_UNLOCK_ENDPOINT = "/api/screen-unlock";
const SCREEN_UNLOCK_TOKEN_KEY = "workLogUnlockToken";
const SCREEN_UNLOCK_EXPIRY_KEY = "workLogUnlockExpiry";
const SCREEN_UNLOCK_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

/** PIN 정규화 — 전각 숫자·공백을 반각·무공백으로 통일해 모바일 오타를 방지합니다. */
function normalizePinInput(raw) {
    let s = String(raw || "").trim();
    s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    s = s.replace(/\s+/g, "");
    return s;
}
/** 빌드가 주입한 화면 잠금 PIN 해시 후보 (현재 PIN + 기본 9445 백업) */
function getScreenLockHashCandidates() {
    if (typeof window === "undefined") return [];
    const raw = [
        window.__SCREEN_LOCK_SHA256__,
        window.__SCREEN_LOCK_DEFAULT_SHA256__
    ];
    const unique = [];
    raw.forEach(v => {
        const h = String(v || "").trim().toLowerCase();
        if (/^[a-f0-9]{64}$/.test(h) && !unique.includes(h)) unique.push(h);
    });
    return unique;
}

function readSessionValue(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
}
function writeSessionValue(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { }
}
function isStoredUnlockValid() {
    const token = readSessionValue(SCREEN_UNLOCK_TOKEN_KEY);
    const expiry = Number(readSessionValue(SCREEN_UNLOCK_EXPIRY_KEY) || 0);
    if (!token || !expiry) return false;
    if (expiry <= Date.now()) return false;
    return true;
}
let isWorkLogUnlocked = isStoredUnlockValid() || readSessionValue("workLogPinUnlocked") === "1";
let pendingWorkLogAction = null;

/**
 * 입력한 PIN 을 서버에서 검증합니다.
 * 서버가 응답하지 않으면(정적 호스팅·오프라인) 빌드 시 주입된 해시로 대체 검증합니다.
 * @returns {Promise<{ok: boolean, token?: string, expiresAt?: number}>}
 */
async function verifyScreenLockPin(pin) {
    const value = normalizePinInput(pin);
    if (!value) return { ok: false, reason: "empty" };

    // 1순위 — 서버 검증 (PIN 평문은 서버 환경변수에만 존재)
    let rateLimited = false;
    try {
        const res = await fetch(SCREEN_UNLOCK_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: value })
        });
        if (res) {
            if (res.ok) {
                const data = await res.json().catch(() => null);
                if (data && data.ok === true) {
                    const expiresAt = Number(data.expiresAt) || (Date.now() + SCREEN_UNLOCK_TTL_MS);
                    return { ok: true, token: String(data.token || "server"), expiresAt };
                }
            }
            // 서버가 명확히 거부했다면 폴백하지 않고 그대로 실패 (서버가 정답을 아는 쪽)
            if (res.status === 401 || res.status === 400) return { ok: false, reason: "invalid_pin" };
            if (res.status === 429) rateLimited = true;
        }
    } catch (e) {
        // 네트워크 오류·정적 호스팅 환경 → 아래 폴백으로 진행
    }

    // 2순위 — 빌드 시 주입된 해시와 비교 (scripts/build-obfuscate.mjs 가 주입)
    const candidates = getScreenLockHashCandidates();
    if (candidates.length > 0) {
        try {
            const digest = String(await sha256Hex(value) || "").toLowerCase();
            if (digest && candidates.includes(digest)) {
                return { ok: true, token: "local", expiresAt: Date.now() + SCREEN_UNLOCK_TTL_MS };
            }
        } catch (e) { }
        return { ok: false, reason: rateLimited ? "rate_limited" : "invalid_pin" };
    }

    // 서버도 없고 주입된 해시도 없는 배포(예: 원본 public/ 을 그대로 정적 배포)는
    // 잠금을 풀 방법이 없습니다. 조용히 실패하지 않고 원인을 알립니다.
    return { ok: false, reason: rateLimited ? "rate_limited" : "no_verifier" };
}
function syncWorkLogExtraUnlockUI() {
    const lockBanner = document.getElementById("logExtraLockBanner");
    const filterContent = document.getElementById("logExtraFilterContent");
    const statsSummary = document.getElementById("monthlyStatsSummary");
    const d3LockBanner = document.getElementById("d3ChartLockBanner");
    const d3ChartSection = document.getElementById("monthlyD3ChartSection");
    const shipLockBanner = document.getElementById("shipExtraLockBanner");
    const shipFilterBarArea = document.getElementById("shipFilterBarArea");
    const shipFullListLockBanner = document.getElementById("shipFullListLockBanner");
    const shipFullListSection = document.getElementById("shipFullListSection");
    const wageReceiptLockBanner = document.getElementById("wageReceiptLockBanner");
    const wageReceiptShareActions = document.getElementById("wageReceiptShareActions");
    const coworkerLockBanner = document.getElementById("coworkerLockBanner");
    const coworkerUnlockedArea = document.getElementById("coworkerUnlockedArea");
    if (isWorkLogUnlocked) {
        if (lockBanner) lockBanner.style.display = "none";
        if (filterContent) filterContent.classList.remove("hidden");
        if (statsSummary) statsSummary.classList.remove("hidden");
        if (d3LockBanner) d3LockBanner.style.display = "none";
        if (d3ChartSection) d3ChartSection.classList.remove("hidden");
        if (shipLockBanner) shipLockBanner.style.display = "none";
        if (shipFilterBarArea) shipFilterBarArea.classList.remove("hidden");
        if (shipFullListLockBanner) shipFullListLockBanner.style.display = "none";
        if (shipFullListSection) shipFullListSection.classList.remove("hidden");
        if (wageReceiptLockBanner) wageReceiptLockBanner.style.display = "none";
        if (wageReceiptShareActions) wageReceiptShareActions.classList.remove("hidden");
        if (coworkerLockBanner) coworkerLockBanner.style.display = "none";
        if (coworkerUnlockedArea) coworkerUnlockedArea.classList.remove("hidden");
        renderWorkLogQuickChips();
        updateMonthlyGoalGaugeUI(latestMonthlyStatsCache.total, latestMonthlyStatsCache.days);
        loadAndRenderYearlyD3Chart(currentDate.getFullYear());
        if (typeof loadAndSearchAllShips === "function") {
            loadAndSearchAllShips(document.getElementById('shipSearch')?.value || '');
        }
    } else {
        if (lockBanner) lockBanner.style.display = "flex";
        if (filterContent) filterContent.classList.add("hidden");
        if (statsSummary) statsSummary.classList.add("hidden");
        if (d3LockBanner) d3LockBanner.style.display = "flex";
        if (d3ChartSection) d3ChartSection.classList.add("hidden");
        if (shipLockBanner) shipLockBanner.style.display = "flex";
        if (shipFilterBarArea) shipFilterBarArea.classList.add("hidden");
        if (shipFullListLockBanner) shipFullListLockBanner.style.display = "flex";
        if (shipFullListSection) shipFullListSection.classList.add("hidden");
        if (wageReceiptLockBanner) wageReceiptLockBanner.style.display = "flex";
        if (wageReceiptShareActions) wageReceiptShareActions.classList.add("hidden");
        if (coworkerLockBanner) coworkerLockBanner.style.display = "flex";
        if (coworkerUnlockedArea) coworkerUnlockedArea.classList.add("hidden");
    }
}
function openWorkLogPinModal(onUnlock) {
    pendingWorkLogAction = onUnlock || null;
    const modal = document.getElementById("workLogPinModal");
    const input = document.getElementById("workLogPinInput");
    if (input) input.value = "";
    if (modal) {
        modal.style.display = "flex";
        setTimeout(() => input && input.focus(), 50);
    }
}
function closeWorkLogPinModal() {
    const modal = document.getElementById("workLogPinModal");
    if (modal) modal.style.display = "none";
    pendingWorkLogAction = null;
}
async function submitWorkLogPin() {
    const input = document.getElementById("workLogPinInput");
    const val = (input ? input.value : "").trim();
    if (!val) {
        showToast("⚠️ 비밀번호를 입력해 주세요.");
        if (input) input.focus();
        return;
    }
    const result = await verifyScreenLockPin(val);
    if (result && result.ok) {
        isWorkLogUnlocked = true;
        writeSessionValue("workLogPinUnlocked", "1");
        writeSessionValue(SCREEN_UNLOCK_TOKEN_KEY, result.token || "server");
        writeSessionValue(SCREEN_UNLOCK_EXPIRY_KEY, String(result.expiresAt || (Date.now() + SCREEN_UNLOCK_TTL_MS)));
        syncWorkLogExtraUnlockUI();
        const callback = pendingWorkLogAction;
        closeWorkLogPinModal();
        showToast("🔓 추가 기능(검색·상세 통계) 잠금이 해제되었습니다.");
        if (typeof callback === "function") callback();
    } else {
        const reason = (result && result.reason) || "invalid_pin";
        if (reason === "rate_limited") {
            showToast("⚠️ 시도 횟수가 초과되었습니다. 잠시 후 다시 시도해 주세요.");
        } else if (reason === "no_verifier") {
            showToast("⚠️ 잠금을 확인할 수 없습니다. 운영자에게 문의해 주세요. (luxrank@gmail.com)");
            try {
                console.error("[보안] 화면 잠금 검증 수단이 없습니다 — 서버(/api/screen-unlock) 응답과 빌드 해시가 모두 없습니다. 압축 빌드(build/public)가 배포되었는지 확인하세요.");
            } catch (e) { }
        } else {
            showToast("⚠️ 비밀번호가 일치하지 않습니다.");
        }
        if (input) {
            input.value = "";
            input.focus();
        }
    }
}
function syncBottomNavActive(activeCardId) {
    const bodyDatas = (document.body && document.body.dataset) || {};
    const currentView = bodyDatas.appView || 'legacy';
    let targetNavId = 'nav-home';
    if (currentView === 'tab') {
        // 방안 A 탭 뷰: 현재 선택된 탭을 하단 내비에 표시
        const navByTab = {
            'wage-log': 'nav-wage',
            'ships': 'nav-ships',
            'community': 'nav-community',
            'guide': 'nav-guide'
        };
        targetNavId = navByTab[bodyDatas.appTab] || 'nav-home';
    }
    // 원본 홈(legacy) 뷰에서는 항상 🏠 홈 탭이 활성 상태를 유지합니다.
    document.querySelectorAll('.bottom-nav .nav-item').forEach(el => {
        el.classList.toggle('active', el.id === targetNavId);
    });
}
function openDatePicker(inputId, event) {
    if (event) {
        const tgt = event.target;
        if (tgt && (tgt.tagName === 'SELECT' || tgt.tagName === 'OPTION' || tgt.closest('select'))) {
            return;
        }
    }
    const input = document.getElementById(inputId);
    if (!input) return;
    try {
        if (typeof input.showPicker === 'function') {
            input.showPicker();
            return;
        }
    } catch (e) {}
    input.focus();
    try { input.click(); } catch (e) {}
}
const WAGE_HOURLY_BY_YEAR = {
    2020: 8590,
    2021: 8720,
    2022: 9160,
    2023: 9620,
    2024: 9860,
    2025: 10030,
    2026: 10320
};

function syncWageHourlyYearLabel(dateStr) {
    const raw = String(
        dateStr ||
        document.getElementById('wageStartDate')?.value ||
        document.getElementById('wageScheduleDatePicker')?.value ||
        ''
    ).trim();
    const yearMatch = raw.match(/^(\d{4})/);
    const yearNum = yearMatch ? parseInt(yearMatch[1], 10) : 2026;
    const validYear = (Number.isFinite(yearNum) && yearNum >= 1900 && yearNum <= 2100) ? yearNum : 2026;
    const labelEl = document.getElementById('wageHourlyLabel');
    if (labelEl) {
        labelEl.textContent = `${validYear}년 시급`;
    }
    const hourlyInput = document.getElementById('wageHourly');
    if (hourlyInput && !hourlyInput.dataset.userModified && WAGE_HOURLY_BY_YEAR[validYear]) {
        hourlyInput.value = String(WAGE_HOURLY_BY_YEAR[validYear]);
    }
}

function onWageDateChange(which) {
    const sdEl = document.getElementById('wageStartDate');
    const edEl = document.getElementById('wageEndDate');
    if (!sdEl || !edEl) return;
    if (sdEl.value) {
        syncWageHourlyYearLabel(sdEl.value);
        const m = parseInt(sdEl.value.split('-')[1], 10);
        if (m >= 1 && m <= 12) {
            highlightSeasonRow(m);
            if (which === 'start') {
                applySeasonDefaultHours(m, false);
            }
        }
        if (which === 'start') {
            if (!edEl.value || edEl.value < sdEl.value) {
                edEl.value = sdEl.value;
            }
            if (typeof setWageScheduleDate === 'function') {
                setWageScheduleDate(sdEl.value);
            }
            if (typeof loadWageScheduledShipsForDate === 'function') {
                loadWageScheduledShipsForDate(sdEl.value, false);
            }
        }
        autoFillWeekendHoliday();
        if (typeof refreshWageWorkHours === 'function') refreshWageWorkHours();
        if (typeof invalidateCalculatedWage === 'function') invalidateCalculatedWage();
    } else if (which === 'end' && edEl.value) {
        syncWageHourlyYearLabel(edEl.value);
    }
}
function filterGuide() {
    const q = (document.getElementById('guideSearch')?.value || '').trim().toLowerCase();
    const rows = document.querySelectorAll('#guideBody tr');
    rows.forEach(row => {
        const text = (row.innerText || '').toLowerCase();
        row.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
}
function filterGuideByCategory(cat) {
    const searchInput = document.getElementById('guideSearch');
    if (searchInput) {
        searchInput.value = cat;
        filterGuide();
    }
}
function toggleTickerMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('tickerHoverMenu');
    if (!menu) return;
    const isShown = menu.style.display === 'flex';
    menu.style.display = isShown ? 'none' : 'flex';
}
document.addEventListener('click', () => {
    const menu = document.getElementById('tickerHoverMenu');
    if (menu && menu.style.display === 'flex') {
        menu.style.display = '';
    }
});
function toggleDashItem(id) {
    const card = document.getElementById(id);
    if (!card) return;

    /* [방안 A 하이브리드 라우팅]
       - 원본 홈(legacy)에서 핵심 기능 카드 클릭 → 해당 방안 A 탭 뷰로 전환
       - 탭 뷰에서 다른 탭 소속 카드가 필요하면 → 해당 탭으로 자동 점프
       - 홈 전용 카드(날씨/보안/설명서)는 원본 홈에서 기존처럼 제자리 펼침 */
    if (typeof planARouteCardOpen === "function") {
        const routed = planARouteCardOpen(id, card);
        if (routed) return;
    }

    const isExpanded = card.classList.contains("expanded");

    document.querySelectorAll(".dash-card").forEach(item => {
        if (
            item.id === "daily-field-english-card" &&
            item.classList.contains("expanded")
        ) {
            pauseDailyFieldEnglish();
        }

        item.classList.remove("expanded");

        const content = item.querySelector(".dash-content");
        if (content) content.style.display = "none";
    });

    if (!isExpanded) {
        card.classList.add("expanded");

        const content = card.querySelector(".dash-content");
        if (content) content.style.display = "block";

        trackAppEvent("blocks", id);
        syncBottomNavActive(id);

        if (id === "daily-field-english-card") {
            initializeDailyFieldEnglish();
        } else if (id === "log-card") {
            syncWorkLogExtraUnlockUI();
            renderCalendar(currentDate.getFullYear(), currentDate.getMonth());
            const formEl = document.getElementById("dailyLogForm");
            if (formEl && !formEl.getAttribute("data-date")) {
                const nowObj = new Date();
                const todayStr = `${nowObj.getFullYear()}-${String(nowObj.getMonth() + 1).padStart(2, "0")}-${String(nowObj.getDate()).padStart(2, "0")}`;
                clickDate(todayStr);
            }
        } else if (id === "ship-card" || id === "wage-card") {
            syncWorkLogExtraUnlockUI();
            if (id === "wage-card") {
                if (typeof syncWageHoursBlockSize === "function") {
                    syncWageHoursBlockSize();
                    setTimeout(syncWageHoursBlockSize, 40);
                }
                renderTerminalScheduleTabBar();
                const wageDate = typeof getWageScheduleDate === "function"
                    ? getWageScheduleDate()
                    : document.getElementById("wageStartDate")?.value;
                if (wageDate && typeof loadWageScheduledShipsForDate === "function") {
                    loadWageScheduledShipsForDate(wageDate, false);
                }
            }
        } else if (id === "weather-card") {
            fetchBusanPortLiveWeather(false);
        }
        if (["board-card", "ship-card", "archive-card"].includes(id)) {
            setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        }
    } else {
        if (typeof goHomeView === "function") {
            goHomeView({ skipHistory: true });
        } else {
            syncBottomNavActive("nav-home");
        }
    }
    scheduleAppHistoryRecord();
}
function toggleSection(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('collapsed');
    const isExpanded = !el.classList.contains('collapsed');
    el.style.border = isExpanded ? '2px solid var(--primary)' : '1px solid var(--border)';
    const parentCard = el.closest('.card');
    if (parentCard) parentCard.classList.toggle('active-work-section', isExpanded);
    if (isExpanded) {
        trackAppEvent('blocks', id);
    } else if (typeof getAppView === 'function' && getAppView() === 'tab' && typeof goHomeView === 'function') {
        const anyCardOpen = Boolean(document.querySelector('.dash-card.expanded'));
        const anySecOpen = ['t1-content', 't2-content', 't3-content'].some(secId => {
            const s = document.getElementById(secId);
            return s && !s.classList.contains('collapsed');
        });
        if (!anyCardOpen && !anySecOpen) {
            goHomeView();
            return;
        }
    }
    scheduleAppHistoryRecord();
}
function toggleContent(id){
    const e = document.getElementById(id);
    if (!e) return;
    const isOpening = e.style.display !== 'block';
    e.style.display = isOpening ? 'block' : 'none';
    const parentBlock = e.closest('.terminal-block');
    if (parentBlock) {
        parentBlock.classList.toggle('active-block', isOpening);
    }
    if (isOpening && id.startsWith('term-')) {
        trackAppEvent('terminals', id.replace('term-', ''));
    }
    scheduleAppHistoryRecord();
}
function toggleHidden(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden');
    if (id === 'shipForm' && !el.classList.contains('hidden')) {
        initShipFormSchedulePicker();
    }
    scheduleAppHistoryRecord();
}
function toggleDarkMode(){ document.body.classList.toggle('dark-mode'); }
function scrollToTop(){
    document.querySelectorAll(".dash-card.expanded").forEach(item => {
        if (item.id === "daily-field-english-card") pauseDailyFieldEnglish();
        item.classList.remove("expanded");
        const content = item.querySelector(".dash-content");
        if (content) content.style.display = "none";
    });
    ["t1-content", "t2-content", "t3-content"].forEach(secId => {
        const secEl = document.getElementById(secId);
        if (secEl && !secEl.classList.contains("collapsed")) {
            secEl.classList.add("collapsed");
            secEl.style.border = "1px solid var(--border)";
            const parentCard = secEl.closest(".card");
            if (parentCard) parentCard.classList.remove("active-work-section");
        }
    });
    syncBottomNavActive('nav-home');
    window.scrollTo({top:0, behavior:'smooth'});
    scheduleAppHistoryRecord();
}
function showToast(m){const t=document.getElementById("toast"); t.innerText=m; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),3000);}

/* ==================================================================
   🔙 브라우저/모바일 뒤로가기(History API) 이전 작업 상태 복원 매니저
   ================================================================== */
const APP_MODAL_IDS = [
    "imageModal",
    "workLogPinModal",
    "loginModal",
    "vesselInfoLinkModal",
    "hjncMealModal",
    "leaderCalendarModal",
    "tickerManageModal",
    "privacyModal",
    "adminWorkLogModal",
    "visitorStatsModal"
];
const APP_SECTION_IDS = ["t1-content", "t2-content", "t3-content"];
const APP_TERM_IDS = [
    "term-hjnc", "term-bnct", "term-dgt", "term-bct",
    "term-pnc", "term-hpnt", "term-pnit",
    "term-bptc", "term-hbct"
];
const APP_FORM_IDS = ["boardForm", "noticeForm", "shipForm", "archiveForm", "dailyLogForm", "coworkerRosterPanel"];

let appHistoryStack = [];
let isRestoringAppHistory = false;
let appHistoryRecordTimer = null;
let lastBackExitPromptAt = 0;

function captureCurrentAppUIState() {
    let expandedCard = null;
    document.querySelectorAll(".dash-card.expanded").forEach(el => {
        if (el.id) expandedCard = el.id;
    });

    const openSections = APP_SECTION_IDS.filter(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains("collapsed");
    });

    const openTerms = APP_TERM_IDS.filter(id => {
        const el = document.getElementById(id);
        return el && el.style.display === "block";
    });

    const openModals = APP_MODAL_IDS.filter(id => {
        const el = document.getElementById(id);
        return el && el.style.display === "flex";
    });

    const openForms = APP_FORM_IDS.filter(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains("hidden");
    });

    const openBoardRows = [];
    document.querySelectorAll(".board-content-row.show").forEach(el => {
        if (el.id) openBoardRows.push(el.id);
    });

    const logDate = document.getElementById("dailyLogForm")?.getAttribute("data-date") || "";
    const wageResultVisible = Boolean(
        document.getElementById("wageResultBox") &&
        !document.getElementById("wageResultBox").classList.contains("hidden")
    );

    return {
        expandedCard,
        openSections,
        openTerms,
        openModals,
        openForms,
        openBoardRows,
        logDate,
        wageResultVisible,
        appView: (document.body && document.body.dataset && document.body.dataset.appView) || 'legacy',
        appTab: (document.body && document.body.dataset && document.body.dataset.appTab) || '',
        appSubTab: (document.body && document.body.dataset && document.body.dataset.appSubTab) || ''
    };
}

function isAppUIStateHome(state) {
    if (!state) return true;
    return (
        (state.appView || 'legacy') !== 'tab' &&
        !state.expandedCard &&
        (!state.openSections || state.openSections.length === 0) &&
        (!state.openTerms || state.openTerms.length === 0) &&
        (!state.openModals || state.openModals.length === 0) &&
        (!state.openBoardRows || state.openBoardRows.length === 0)
    );
}

function serializeAppUIState(state) {
    return JSON.stringify(state || {});
}

function scheduleAppHistoryRecord() {
    if (isRestoringAppHistory) return;
    if (appHistoryRecordTimer) clearTimeout(appHistoryRecordTimer);
    appHistoryRecordTimer = setTimeout(() => {
        recordAppHistoryState();
    }, 40);
}

function recordAppHistoryState() {
    if (isRestoringAppHistory) return;
    const current = captureCurrentAppUIState();
    const currentJson = serializeAppUIState(current);
    const topState = appHistoryStack.length > 0 ? appHistoryStack[appHistoryStack.length - 1] : null;
    if (topState && serializeAppUIState(topState) === currentJson) {
        return;
    }
    appHistoryStack.push(current);
    if (appHistoryStack.length > 40) {
        appHistoryStack.shift();
    }
    try {
        window.history.pushState({ busanPortIdx: appHistoryStack.length - 1 }, "");
    } catch (e) {}
}

function applyAppUIState(targetState) {
    if (!targetState) return;
    isRestoringAppHistory = true;
    try {
        // 1. 모달 상태 복원
        APP_MODAL_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const shouldOpen = Array.isArray(targetState.openModals) && targetState.openModals.includes(id);
            el.style.display = shouldOpen ? "flex" : "none";
        });

        // 2. 대시보드 카드 확장 상태 복원
        const currentExpanded = document.querySelector(".dash-card.expanded")?.id || null;
        if (currentExpanded !== targetState.expandedCard) {
            document.querySelectorAll(".dash-card").forEach(item => {
                if (item.id === "daily-field-english-card" && item.classList.contains("expanded")) {
                    pauseDailyFieldEnglish();
                }
                item.classList.remove("expanded");
                const content = item.querySelector(".dash-content");
                if (content) content.style.display = "none";
            });

            if (targetState.expandedCard) {
                const targetCard = document.getElementById(targetState.expandedCard);
                if (targetCard) {
                    targetCard.classList.add("expanded");
                    const content = targetCard.querySelector(".dash-content");
                    if (content) content.style.display = "block";
                    syncBottomNavActive(targetState.expandedCard);

                    if (targetState.expandedCard === "daily-field-english-card") {
                        initializeDailyFieldEnglish();
                    } else if (targetState.expandedCard === "log-card") {
                        syncWorkLogExtraUnlockUI();
                        renderCalendar(currentDate.getFullYear(), currentDate.getMonth());
                    } else if (targetState.expandedCard === "ship-card" || targetState.expandedCard === "wage-card") {
                        syncWorkLogExtraUnlockUI();
                    } else if (targetState.expandedCard === "weather-card") {
                        fetchBusanPortLiveWeather(false);
                    }
                }
            } else {
                syncBottomNavActive("nav-home");
            }
        }

        // 3. 1·2·3항업 섹션 아코디언 상태 복원
        APP_SECTION_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const shouldOpen = Array.isArray(targetState.openSections) && targetState.openSections.includes(id);
            el.classList.toggle("collapsed", !shouldOpen);
            el.style.border = shouldOpen ? "2px solid var(--primary)" : "1px solid var(--border)";
            const parentCard = el.closest(".card");
            if (parentCard) parentCard.classList.toggle("active-work-section", shouldOpen);
        });

        // 4. 개별 터미널 블록 확장 상태 복원
        APP_TERM_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const shouldOpen = Array.isArray(targetState.openTerms) && targetState.openTerms.includes(id);
            el.style.display = shouldOpen ? "block" : "none";
            const parentBlock = el.closest(".terminal-block");
            if (parentBlock) parentBlock.classList.toggle("active-block", shouldOpen);
        });

        // 5. 글쓰기/등록 폼 상태 복원
        APP_FORM_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const shouldOpen = Array.isArray(targetState.openForms) && targetState.openForms.includes(id);
            el.classList.toggle("hidden", !shouldOpen);
        });
        if (targetState.expandedCard === "log-card" && targetState.logDate) {
            const prevLogDate = document.getElementById("dailyLogForm")?.getAttribute("data-date");
            if (prevLogDate !== targetState.logDate && Array.isArray(targetState.openForms) && targetState.openForms.includes("dailyLogForm")) {
                clickDate(targetState.logDate);
            }
        }

        // 5-2. [방안 A] 원본 홈 / 탭 뷰 상태 복원
        try {
            const restoreView = targetState.appView === 'tab' ? 'tab' : 'legacy';
            document.body.dataset.appView = restoreView;
            if (targetState.appTab) document.body.dataset.appTab = targetState.appTab;
            else delete document.body.dataset.appTab;
            if (targetState.appSubTab) document.body.dataset.appSubTab = targetState.appSubTab;
            else delete document.body.dataset.appSubTab;
            if (typeof applyPlanAViewLayout === 'function') applyPlanAViewLayout();
            syncBottomNavActive(targetState.expandedCard || '');
        } catch (e) { console.warn('탭 뷰 상태 복원 오류:', e); }

        // 6. 임금계산기 결과창 표시 여부 복원
        const wageResultBox = document.getElementById("wageResultBox");
        if (wageResultBox) {
            wageResultBox.classList.toggle("hidden", !targetState.wageResultVisible);
        }

        // 7. 게시판/공지/선박 상세 행 펼침 상태 복원
        document.querySelectorAll(".board-content-row").forEach(row => {
            const shouldShow = Array.isArray(targetState.openBoardRows) && targetState.openBoardRows.includes(row.id);
            row.classList.toggle("show", shouldShow);
            if (shouldShow && row.id && row.id.startsWith("s-")) {
                loadShipComments(row.id.slice(2));
            }
        });
    } finally {
        setTimeout(() => {
            isRestoringAppHistory = false;
        }, 50);
    }
}

function stepBackActiveUIInPlace() {
    // 0순위: [방안 A] 탭 뷰에 있으면 원본 홈 화면으로 복귀
    if ((document.body && document.body.dataset && document.body.dataset.appView) === 'tab') {
        if (typeof goHomeView === 'function') {
            goHomeView({ skipHistory: true });
        } else {
            document.body.dataset.appView = 'legacy';
        }
        return true;
    }
    // 1순위: 열려 있는 모달 닫기
    for (const modalId of APP_MODAL_IDS) {
        const el = document.getElementById(modalId);
        if (el && el.style.display === "flex") {
            el.style.display = "none";
            return true;
        }
    }
    // 2순위: 열려 있는 작성/수정 폼 닫기
    for (const formId of ["boardForm", "noticeForm", "shipForm", "archiveForm", "coworkerRosterPanel"]) {
        const el = document.getElementById(formId);
        if (el && !el.classList.contains("hidden")) {
            el.classList.add("hidden");
            return true;
        }
    }
    // 3순위: 펼쳐진 게시글/공지/선박 본문 행 닫기
    const openRows = document.querySelectorAll(".board-content-row.show");
    if (openRows.length > 0) {
        openRows[openRows.length - 1].classList.remove("show");
        return true;
    }
    // 4순위: 임금계산기 결과창 닫기
    const wageResult = document.getElementById("wageResultBox");
    if (wageResult && !wageResult.classList.contains("hidden")) {
        wageResult.classList.add("hidden");
        return true;
    }
    // 5순위: 펼쳐진 개별 터미널 닫기
    for (let i = APP_TERM_IDS.length - 1; i >= 0; i--) {
        const el = document.getElementById(APP_TERM_IDS[i]);
        if (el && el.style.display === "block") {
            toggleContent(APP_TERM_IDS[i]);
            return true;
        }
    }
    // 6순위: 펼쳐진 대시보드 카드 또는 항업 섹션 닫기
    const expandedCard = document.querySelector(".dash-card.expanded");
    if (expandedCard && expandedCard.id) {
        toggleDashItem(expandedCard.id);
        return true;
    }
    for (let i = APP_SECTION_IDS.length - 1; i >= 0; i--) {
        const el = document.getElementById(APP_SECTION_IDS[i]);
        if (el && !el.classList.contains("collapsed")) {
            toggleSection(APP_SECTION_IDS[i]);
            return true;
        }
    }
    return false;
}

function initAppHistoryNavigation() {
    const initialState = captureCurrentAppUIState();
    appHistoryStack = [initialState];
    try {
        // 기본 베이스 상태와 가드 엔트리를 등록하여 뒤로가기 시 앱이 즉시 종료되지 않도록 보호
        window.history.replaceState({ busanPortBase: true, busanPortIdx: 0 }, "");
        window.history.pushState({ busanPortIdx: 0 }, "");
    } catch (e) {}

    window.addEventListener("popstate", () => {
        if (isRestoringAppHistory) return;

        const liveState = captureCurrentAppUIState();
        const liveJson = serializeAppUIState(liveState);
        const topState = appHistoryStack.length > 0 ? appHistoryStack[appHistoryStack.length - 1] : null;

        // 기록되지 않은 모달/폼/행이 열려 있었다면 우선 이전 상태로 되돌림
        if (topState && serializeAppUIState(topState) !== liveJson) {
            applyAppUIState(topState);
            try {
                window.history.pushState({ busanPortIdx: appHistoryStack.length - 1 }, "");
            } catch (e) {}
            return;
        }

        if (appHistoryStack.length > 1) {
            appHistoryStack.pop();
            const prevState = appHistoryStack[appHistoryStack.length - 1];
            applyAppUIState(prevState);
            // 스택이 바닥(0)에 도달했으면 앱 종료 방지를 위해 가드 엔트리 유지
            if (appHistoryStack.length === 1) {
                try {
                    window.history.pushState({ busanPortIdx: 0 }, "");
                } catch (e) {}
            }
            return;
        }

        // 히스토리 스택에 1개만 남았더라도 현재 열린 UI가 있다면 단계적으로 닫기
        if (!isAppUIStateHome(liveState) && stepBackActiveUIInPlace()) {
            const updatedState = captureCurrentAppUIState();
            appHistoryStack = [updatedState];
            try {
                window.history.pushState({ busanPortIdx: 0 }, "");
            } catch (e) {}
            return;
        }

        // 이미 초기 홈 화면인 경우: 한 번에 종료되지 않도록 가드 재등록 및 안내
        const now = Date.now();
        if (now - lastBackExitPromptAt < 2200) {
            // 2.2초 내 연속 2회 뒤로가기 시 기본 브라우저 이전 동작 허용
            window.history.back();
            return;
        }
        lastBackExitPromptAt = now;
        try {
            window.history.pushState({ busanPortIdx: 0 }, "");
        } catch (e) {}
        window.scrollTo({ top: 0, behavior: "smooth" });
        showToast("🏠 메인 홈 화면입니다. 앱을 나가시려면 뒤로가기를 한 번 더 누르세요.");
    });

    // 모달 열림/닫힘 등 스타일 변경 시 자동으로 히스토리에 기록되도록 MutationObserver 연결
    if (typeof MutationObserver !== "undefined") {
        const modalObserver = new MutationObserver(() => {
            if (!isRestoringAppHistory) scheduleAppHistoryRecord();
        });
        APP_MODAL_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) modalObserver.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
        });
        APP_FORM_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) modalObserver.observe(el, { attributes: true, attributeFilter: ["class", "data-date"] });
        });
        const wageResultBox = document.getElementById("wageResultBox");
        if (wageResultBox) {
            modalObserver.observe(wageResultBox, { attributes: true, attributeFilter: ["class"] });
        }
    }
}

function renderMainTickerText(message) {
    const ticker = document.getElementById("tickerText");
    if (!ticker) return;
    const text = message || "🚨 안전 제일! 오늘도 무사고!";
    const duration = Math.ceil(Math.max(20, Math.min(120, Array.from(text).length * 0.75)) / 1.44);
    ticker.style.setProperty("--main-ticker-duration", `${duration}s`);
    ticker.innerHTML = "";
    for (let copy = 0; copy < 2; copy++) {
        const item = document.createElement("span");
        item.innerText = text;
        if (copy > 0) item.setAttribute("aria-hidden", "true");
        ticker.appendChild(item);
    }
}
function loadBanner(){ db.collection('settings').doc('banner').onSnapshot((doc) => { if(!doc.exists) { renderMainTickerText(""); return; } globalTickerData = doc.data(); let msg = ""; if(globalTickerData.adminMessage) msg += `📢 ${globalTickerData.adminMessage}   ///   `; if(globalTickerData.userMessages && globalTickerData.userMessages.length > 0) { msg += globalTickerData.userMessages.map((m,i) => `${i+1}. ${m}`).join("   ///   "); } renderMainTickerText(msg); }, (err) => { console.warn("배너 로드 오류:", err); }); }
function writeUserTicker(){ const m = prompt("현장 안전 문구를 입력하세요:"); if(!m) return; let msgs = globalTickerData.userMessages || []; msgs.unshift(m); if(msgs.length > 3) msgs = msgs.slice(0, 3); db.collection('settings').doc('banner').set({ userMessages: msgs }, { merge: true }).then(() => showToast("등록되었습니다.")).catch((e) => alert("실패: " + e.message)); }
async function setAdminTicker(){ if(await verifyAdmin()){ const m = prompt("관리자 공지 문구를 입력하세요:"); if(m) db.collection('settings').doc('banner').set({adminMessage:m}, {merge:true}); } }
async function openTickerManager(){ if(await verifyAdmin()){ document.getElementById('tickerManageModal').style.display='flex'; renderTickerList(); } }
function renderTickerList() { const listContainer = document.getElementById('tickerListContainer'); listContainer.innerHTML = ''; const data = globalTickerData; let hasData = false; if (data.adminMessage) { hasData = true; listContainer.innerHTML += `<div class="ticker-manage-item" style="display:flex; align-items:center; gap:5px;"><span style="color:red; flex:1; font-weight:800;">📢 [관리자] ${escapeShipCommentHtml(data.adminMessage)}</span><button onclick="editTickerMsg('admin', 0)" class="mini-btn" style="background:var(--primary-light); color:white;">수정</button><button onclick="deleteTickerMsg('admin', 0)" class="mini-btn btn-del-mini">삭제</button></div>`; } if (data.userMessages) { data.userMessages.forEach((m, i) => { hasData = true; listContainer.innerHTML += `<div class="ticker-manage-item" style="display:flex; align-items:center; gap:5px;"><span style="flex:1; font-weight:700;">${i + 1}. ${escapeShipCommentHtml(m)}</span><button onclick="editTickerMsg('user', ${i})" class="mini-btn" style="background:var(--primary-light); color:white;">수정</button><button onclick="deleteTickerMsg('user', ${i})" class="mini-btn btn-del-mini">삭제</button></div>`; }); } if (!hasData) listContainer.innerHTML = '<div style="padding:10px; text-align:center; font-weight:700;">등록된 내용이 없습니다.</div>'; }
async function editTickerMsg(type, index) {
    if (type === 'admin') {
        const current = globalTickerData.adminMessage || "";
        const next = prompt("수정할 관리자 공지 문구를 입력하세요:", current);
        if (next === null) return;
        if (!next.trim()) return alert("문구를 입력해 주세요.");
        globalTickerData.adminMessage = next.trim();
        await db.collection('settings').doc('banner').set({ adminMessage: next.trim() }, { merge: true });
        renderTickerList();
        showToast("수정되었습니다.");
    } else if (Array.isArray(globalTickerData.userMessages) && globalTickerData.userMessages[index] !== undefined) {
        const current = globalTickerData.userMessages[index] || "";
        const next = prompt("수정할 현장 안전 문구를 입력하세요:", current);
        if (next === null) return;
        if (!next.trim()) return alert("문구를 입력해 주세요.");
        globalTickerData.userMessages[index] = next.trim();
        await db.collection('settings').doc('banner').set({ userMessages: globalTickerData.userMessages }, { merge: true });
        renderTickerList();
        showToast("수정되었습니다.");
    }
}
function openAllBayPlan() {
    trackAppEvent('actions', 'bay_plan');
    window.open("http://112.163.71.98:8080/webits/bayplan", "_blank"); 
}
const terminalTickerLabels = { t1: "1항업", t2: "2항업", t3: "3항업" };
function renderSectionTickerText(sectionId, message) {
    const ticker = document.getElementById(`${sectionId}TickerText`);
    if (!ticker) return;
    const text = message ? `📢 ${message}` : `${terminalTickerLabels[sectionId]} 공지사항이 없습니다.`;
    const duration = Math.ceil(Math.max(20, Math.min(120, Array.from(text).length * 0.75)) / 1.44);
    ticker.style.setProperty("--terminal-ticker-duration", `${duration}s`);
    ticker.innerHTML = "";
    for (let copy = 0; copy < 2; copy++) {
        const item = document.createElement("span");
        item.innerText = text;
        if (copy > 0) item.setAttribute("aria-hidden", "true");
        ticker.appendChild(item);
    }
}
function loadSectionTicker(sectionId) {
    const tickerId = `${sectionId}TickerText`;
    db.collection("settings").doc(`${sectionId}_ticker`).onSnapshot(snapshot => {
        const message = snapshot.exists ? String(snapshot.data().message || "").trim() : "";
        renderSectionTickerText(sectionId, message);
    }, error => {
        const ticker = document.getElementById(tickerId);
        renderSectionTickerText(sectionId, `${terminalTickerLabels[sectionId]} 티커를 불러오지 못했습니다.`);
        console.error(`${terminalTickerLabels[sectionId]} 티커 로드 오류:`, error);
    });
}
async function openSectionTickerManager(sectionId) {
    if (!(await verifyAdmin())) return;
    const sectionLabel = terminalTickerLabels[sectionId];
    if (!sectionLabel) return;
    const tickerRef = db.collection("settings").doc(`${sectionId}_ticker`);
    try {
        const snapshot = await tickerRef.get();
        const currentMessage = snapshot.exists ? String(snapshot.data().message || "").trim() : "";
        if (!currentMessage) {
            const message = prompt(`${sectionLabel} 티커에 등록할 문구를 입력하세요:`);
            if (message === null) return;
            if (!message.trim()) return alert("티커 문구를 입력해 주세요.");
            await tickerRef.set({ message: message.trim(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            showToast(`${sectionLabel} 티커가 등록되었습니다.`);
            return;
        }
        const action = prompt(`[${sectionLabel}] 현재 티커 문구:\n${currentMessage}\n\n1. 수정\n2. 삭제\n취소하려면 취소를 누르세요.`, "1");
        if (action === "1") {
            const message = prompt("수정할 티커 문구를 입력하세요:", currentMessage);
            if (message === null) return;
            if (!message.trim()) return alert("티커 문구를 입력해 주세요.");
            await tickerRef.set({ message: message.trim(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            showToast(`${sectionLabel} 티커가 수정되었습니다.`);
        } else if (action === "2" && confirm(`${sectionLabel} 티커를 삭제할까요?`)) {
            await tickerRef.delete();
            showToast(`${sectionLabel} 티커가 삭제되었습니다.`);
        }
    } catch (error) {
        alert(`${sectionLabel} 티커 관리 실패: ` + error.message);
    }
}
let currentMealTerminalId = "hjnc";
const terminalMealTargets = [
    { id: "bnct", label: "부산신항컨테이너터미널(BNCT) 식단" },
    { id: "dgt", label: "동원글로벌터미널부산(DGT) 식단" },
    { id: "bct", label: "부산컨테이너터미널(BCT) 식단" },
    { id: "pnc", label: "부산신항만(PNC) 식단" },
    { id: "hpnt", label: "HMM PSA 신항만(HPNT) 식단" },
    { id: "pnit", label: "부산신항국제터미널(PNIT) 식단" },
    { id: "bptc", label: "신선대감만터미널(BPTC) 식단" },
    { id: "hbct", label: "허치슨포트부산(HBCT) 식단" }
];
const officialTerminalNames = {
    hjnc: "한진부산컨테이너터미널(HJNC)",
    bnct: "부산신항컨테이너터미널(BNCT)",
    dgt: "동원글로벌터미널부산(DGT)",
    bct: "부산컨테이너터미널(BCT)",
    pnc: "부산신항만(PNC)",
    hpnt: "HMM PSA 신항만(HPNT)",
    pnit: "부산신항국제터미널(PNIT)",
    bptc: "신선대감만터미널(BPTC)",
    hbct: "허치슨포트부산(HBCT)"
};
const officialTerminalShortNames = {
    hjnc: "한진",
    bnct: "고려",
    dgt: "동원",
    bct: "BCT"
};
const terminalQuickConfig = {
    hjnc: {
        short: "한진(HJNC)",
        schedule: "https://www.hjnc.co.kr/esvc/vessel/berthScheduleT",
        chart: "https://www.hjnc.co.kr/esvc/vessel/berthScheduleG",
        status: "https://www.hjnc.co.kr/esvc/vessel/vesselStatus",
        mealLabel: "한진 식단",
        bayplan: "http://bayplan.hjnc.co.kr"
    },
    bnct: {
        short: "고려(BNCT)",
        schedule: "https://info.bnctkorea.com/esvc/vessel/berthScheduleT",
        chart: "https://info.bnctkorea.com/esvc/vessel/berthScheduleG",
        status: "https://info.bnctkorea.com/esvc/vessel/vesselStatus",
        mealLabel: "부산신항컨테이너터미널(BNCT) 식단"
    },
    dgt: {
        short: "동원(DGT)",
        schedule: "https://www.dgtbusan.com/DGT/esvc/vessel/berthScheduleT",
        chart: "https://www.dgtbusan.com/DGT/esvc/vessel/berthScheduleG",
        status: "https://www.dgtbusan.com/DGT/esvc/vessel/vesselStatus",
        mealLabel: "동원글로벌터미널부산(DGT) 식단"
    },
    bct: {
        short: "BCT",
        schedule: "https://info.bct2-4.com/infoservice/index.html",
        chart: "https://info.bct2-4.com/infoservice/index.html",
        status: "https://info.bct2-4.com/infoservice/index.html",
        mealLabel: "부산컨테이너터미널(BCT) 식단"
    },
    pnc: {
        short: "PNC(부산신항만)",
        schedule: "https://svc.pncport.com/info/CMS/Ship/Info.pnc?mCode=MN014",
        chart: "https://svc.pncport.com/info/CMS/Ship/ShipBerthC.pnc?mCode=MN019",
        status: "https://svc.pncport.com/info/CMS/Ship/ShipVslStatus.pnc?mCode=MN020",
        mealLabel: "부산신항만(PNC) 식단",
        bus: true
    },
    hpnt: {
        short: "HMM(HPNT)",
        schedule: "https://www.hpnt.co.kr/infoservice/vessel/vslScheduleList.jsp",
        chart: "https://www.hpnt.co.kr/infoservice/vessel/vslScheduleChart.jsp",
        status: "https://www.hpnt.co.kr/infoservice/vessel/vslWorkStatus.jsp",
        mealLabel: "HMM PSA 신항만(HPNT) 식단"
    },
    pnit: {
        short: "신항국제(PNIT)",
        schedule: "https://www.pnitl.com/infoservice/vessel/vslScheduleList.jsp",
        chart: "https://www.pnitl.com/infoservice/vessel/vslScheduleChart.jsp",
        status: "https://www.pnitl.com/infoservice/vessel/vslWorkStatus.jsp",
        mealLabel: "부산신항국제터미널(PNIT) 식단"
    },
    bptc: {
        short: "신선대감만(BPTC)",
        schedule: "http://info.bptc.co.kr:9084/content/sw/frame/berth_status_text_frame_sw_kr.jsp?p_id=BETX_SH_KR&snb_num=2&snb_div=service",
        chart: "http://info.bptc.co.kr:9084/content/sw/frame/berth_status_text_frame_sw_kr.jsp?p_id=BETX_SH_KR&snb_num=2&snb_div=service",
        status: "http://info.bptc.co.kr:9084/content/index.jsp#03",
        mealLabel: "신선대감만터미널(BPTC) 식단"
    },
    hbct: {
        short: "허치슨(HBCT)",
        schedule: "https://custom.hktl.com/jsp/T01/sunsuk.jsp",
        chart: "https://custom.hktl.com/jsp/T01/sunsuk.jsp",
        status: "https://custom.hktl.com/jsp/T03/bonsun.jsp",
        mealLabel: "허치슨포트부산(HBCT) 식단"
    }
};
let favoriteTerminals = [];
try {
    const savedFavs = JSON.parse(localStorage.getItem("busanPortFavTerminals") || "[]");
    if (Array.isArray(savedFavs)) favoriteTerminals = savedFavs.filter(id => terminalQuickConfig[id]);
} catch (e) {
    favoriteTerminals = [];
}
function toggleFavoriteTerminal(id, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const idx = favoriteTerminals.indexOf(id);
    if (idx >= 0) {
        favoriteTerminals.splice(idx, 1);
        showToast(`☆ ${terminalQuickConfig[id]?.short || id} 단골 터미널 해제`);
    } else {
        favoriteTerminals.push(id);
        showToast(`⭐ ${terminalQuickConfig[id]?.short || id} 상단 단골 터미널로 고정됨!`);
    }
    try {
        localStorage.setItem("busanPortFavTerminals", JSON.stringify(favoriteTerminals));
    } catch (e) {}
    applyOfficialTerminalNames();
    renderFavoriteQuickBar();
}
function renderFavoriteQuickBar() {
    const bar = document.getElementById("favoriteQuickBar");
    if (!bar) return;
    if (!favoriteTerminals.length) {
        bar.classList.add("hidden");
        bar.innerHTML = "";
        return;
    }
    bar.classList.remove("hidden");
    const itemsHtml = favoriteTerminals.map(id => {
        const cfg = terminalQuickConfig[id];
        if (!cfg) return "";
        const extraBtns = [];
        if (cfg.bayplan) {
            extraBtns.push(`<a href="${cfg.bayplan}" target="_blank" class="fav-quick-btn extra">🧩 베이</a>`);
        }
        if (cfg.bus) {
            extraBtns.push(`<button type="button" class="fav-quick-btn extra" onclick="openBusSchedule()">🚌 셔틀</button>`);
        }
        const nameMatch = cfg.short.match(/^(.+?)(\(.+\))$/);
        const nameHtml = nameMatch
            ? `<span class="fav-quick-name-text"><span class="fav-quick-name-main">${nameMatch[1]}</span><span class="fav-quick-name-sub">${nameMatch[2]}</span></span>`
            : `<span class="fav-quick-name-text"><span class="fav-quick-name-main">${cfg.short}</span></span>`;
        return `<div class="fav-quick-item">
            <div class="fav-quick-name">
                <button type="button" class="fav-star-btn is-fav" title="즐겨찾기 해제" onclick="toggleFavoriteTerminal('${id}', event)">⭐</button>
                ${nameHtml}
            </div>
            <div class="fav-quick-actions">
                <a href="${cfg.schedule}" target="_blank" class="fav-quick-btn" onclick="trackAppEvent('terminals','${id}')">스케줄</a>
                <a href="${cfg.chart}" target="_blank" class="fav-quick-btn" onclick="trackAppEvent('terminals','${id}')">차트</a>
                <a href="${cfg.status}" target="_blank" class="fav-quick-btn" onclick="trackAppEvent('terminals','${id}')">현황</a>
                ${extraBtns.join("")}
                <button type="button" class="fav-quick-btn meal" onclick="openHjncMealModal('${id}', '${cfg.mealLabel}')">🍱 식단</button>
            </div>
        </div>`;
    }).join("");
    bar.innerHTML = `<div class="fav-quick-header">
        <span>⭐ 내 단골 터미널 빠른 실행 바</span>
        <span style="font-size:0.72rem; color:var(--text-sub); font-weight:700;">별표(⭐) 터치 시 해제</span>
    </div>${itemsHtml}`;
}
function applyOfficialTerminalNames() {
    Object.entries(officialTerminalNames).forEach(([id, name]) => {
        const terminal = document.getElementById(`term-${id}`);
        const header = terminal && terminal.previousElementSibling;
        if (header) {
            const isFav = favoriteTerminals.includes(id);
            const starBtn = `<button type="button" class="fav-star-btn ${isFav ? 'is-fav' : ''}" title="단골 터미널 즐겨찾기" onclick="toggleFavoriteTerminal('${id}', event)">⭐</button>`;
            const shortName = officialTerminalShortNames[id];
            if (shortName) {
                header.innerHTML = `<span style="display:flex; align-items:center; gap:4px;">${starBtn}<span class="term-short-name">${shortName}</span></span><span class="term-full-name">${name} ▼</span>`;
            } else {
                header.innerHTML = `<span style="display:flex; align-items:center; gap:6px;">${starBtn}<span>${name}</span></span><span>▼</span>`;
            }
        }
    });
    renderFavoriteQuickBar();
}
function appendTerminalMealBlocks() {
    terminalMealTargets.forEach(({ id, label }) => {
        const terminal = document.getElementById(`term-${id}`);
        if (!terminal || terminal.querySelector(".terminal-meal-block")) return;
        const block = document.createElement("div");
        block.className = "terminal-meal-block";
        block.style.cssText = "width:100%; margin-top:8px;";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "terminal-btn hjnc-meal-button";
        button.innerText = `✨ ${label} ✨`;
        button.onclick = () => openHjncMealModal(id, label);
        block.appendChild(button);
        terminal.appendChild(block);
    });
}
function getTerminalMealDocumentId(terminalId) {
    return terminalId === "hjnc" ? "hjnc_meal" : `meal_${terminalId}`;
}
function openHjncMealModal(terminalId = "hjnc", label = "한진 식단") {
    currentMealTerminalId = terminalId;
    trackAppEvent('actions', 'meal_view');
    trackAppEvent('terminals', terminalId);
    document.getElementById("hjncMealTitle").innerText = `🍱 ${label}`;
    document.getElementById("hjncMealModal").style.display = "flex";
    loadHjncMealImage();
}
function closeHjncMealModal() {
    document.getElementById("hjncMealModal").style.display = "none";
}
async function loadHjncMealImage() {
    const status = document.getElementById("hjncMealStatus");
    const image = document.getElementById("hjncMealImage");
    image.style.display = "none";
    status.innerText = "식단 이미지를 불러오는 중...";
    try {
        const snapshot = await db.collection("settings").doc(getTerminalMealDocumentId(currentMealTerminalId)).get();
        const imageUrl = snapshot.exists ? snapshot.data().imageUrl : "";
        if (!imageUrl) {
            status.innerText = "이 세션에 등록된 식단 이미지가 없습니다.";
            return;
        }
        image.src = imageUrl;
        image.style.display = "block";
        status.innerText = "";
    } catch (error) {
        status.innerText = "식단 이미지를 불러오지 못했습니다.";
        console.error("터미널 식단 불러오기 오류:", error);
    }
}
async function requestHjncMealUpload() {
    if (!(await verifyAdmin())) return;
    const input = document.getElementById("hjncMealFileInput");
    input.value = "";
    input.click();
}
async function uploadHjncMealImage(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const status = document.getElementById("hjncMealStatus");
    status.innerText = "이미지 업로드 중...";
    try {
        const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = currentMealTerminalId === "hjnc" ? "hjnc-meals" : `terminal-meals/${currentMealTerminalId}`;
        const upload = await storage.ref(`${storagePath}/${Date.now()}_${safeFileName}`).put(file);
        const imageUrl = await upload.ref.getDownloadURL();
        await db.collection("settings").doc(getTerminalMealDocumentId(currentMealTerminalId)).set({ imageUrl, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        const image = document.getElementById("hjncMealImage");
        image.src = imageUrl;
        image.style.display = "block";
        status.innerText = "식단 이미지가 업데이트되었습니다.";
    } catch (error) {
        status.innerText = "이미지 업로드에 실패했습니다.";
        alert("식단 이미지 업로드 실패: " + error.message);
    } finally {
        input.value = "";
    }
}
async function deleteTickerMsg(type, index){ if(!confirm("삭제하시겠습니까?")) return; if(type === 'admin') { delete globalTickerData.adminMessage; await db.collection('settings').doc('banner').update({ adminMessage: firebase.firestore.FieldValue.delete() }); } else { globalTickerData.userMessages.splice(index, 1); await db.collection('settings').doc('banner').update({ userMessages: globalTickerData.userMessages }); } renderTickerList(); showToast("삭제되었습니다."); }
function downloadWorkLogsExcel() { if (!currentWorkerId || Object.keys(adminWorkLogs).length === 0) { return alert("다운로드할 근무 기록 데이터가 없습니다."); } trackAppEvent('actions', 'excel_dl'); let csvContent = "\uFEFF날짜,배 이름,임금 1,임금 2,임금 3,임금 4,총임금,근무자,메모\n"; const sortedDates = Object.keys(adminWorkLogs).sort(); sortedDates.forEach(date => { const d = adminWorkLogs[date]; const ship = d.shipName || ""; const w1 = d.wage1 || 0; const w2 = d.wage2 || 0; const w3 = d.wage3 || 0; const w4 = d.wage4 || 0; const total = d.totalPay || (Number(w1) + Number(w2) + Number(w3) + Number(w4)); const workers = (d.coworkers || "").replace(/,/g, " "); const memo = (d.memo || "").replace(/\n/g, " ").replace(/,/g, " "); csvContent += `${date},${ship},${w1},${w2},${w3},${w4},${total},${workers},${memo}\n`; }); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); const monthTitle = document.getElementById('calMonthYear').innerText; link.href = url; link.download = `${currentWorkerId}_${monthTitle}_근무기록.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link); showToast("📊 엑셀 파일이 다운로드 폴더에 저장되었습니다!"); }
let latestMonthlyStatsCache = { total: 0, w1Sum: 0, w2Sum: 0, w3Sum: 0, w4Sum: 0, days: 0, avg: 0 };
let monthlyGoalAmount = Number(localStorage.getItem("busanPortMonthlyGoal")) || 4500000;
function updateMonthlyGoalGaugeUI(currentTotal = 0, currentDays = 0) {
    const goalTextEl = document.getElementById("monthlyGoalAmountText");
    const fillEl = document.getElementById("monthlyGoalProgressFill");
    const pctEl = document.getElementById("monthlyGoalPercentText");
    const remainEl = document.getElementById("monthlyGoalRemainText");
    if (!goalTextEl || !fillEl || !pctEl || !remainEl) return;
    const goal = Math.max(100000, Number(monthlyGoalAmount) || 4500000);
    goalTextEl.innerText = `목표: ${goal.toLocaleString()}원`;
    const pct = Math.min(100, Math.round((currentTotal / goal) * 100));
    const rawPct = Math.round((currentTotal / goal) * 100);
    fillEl.style.width = `${pct}%`;
    pctEl.innerText = `달성률 ${rawPct}% (${currentDays}일 출근)`;
    if (currentTotal >= goal) {
        const over = currentTotal - goal;
        remainEl.innerText = `🎉 목표 달성 완료! (+${over.toLocaleString()}원 초과 달성)`;
        remainEl.style.color = "#047857";
    } else {
        const remain = goal - currentTotal;
        const avgPerDay = currentDays > 0 ? Math.round(currentTotal / currentDays) : 220000;
        const estDays = Math.max(1, Math.ceil(remain / Math.max(avgPerDay, 100000)));
        remainEl.innerText = `${remain.toLocaleString()}원 남음 (약 ${estDays}일 출근 필요)`;
        remainEl.style.color = "var(--text-sub)";
    }
}
function changeMonthlyGoalAmount() {
    if (!isWorkLogUnlocked) {
        openWorkLogPinModal(() => changeMonthlyGoalAmount());
        return;
    }
    const currentMan = Math.round((Number(monthlyGoalAmount) || 4500000) / 10000);
    const input = prompt("이번 달 목표 수입 금액을 '만 원' 단위로 입력해 주세요 (예: 450):", String(currentMan));
    if (input === null) return;
    const parsedMan = parseFloat(input.replace(/,/g, "").trim());
    if (isNaN(parsedMan) || parsedMan <= 0) {
        alert("올바른 숫자를 입력해 주세요.");
        return;
    }
    monthlyGoalAmount = Math.round(parsedMan * 10000);
    try { localStorage.setItem("busanPortMonthlyGoal", String(monthlyGoalAmount)); } catch (e) {}
    updateMonthlyGoalGaugeUI(latestMonthlyStatsCache.total, latestMonthlyStatsCache.days);
    showToast(`🎯 이번 달 목표 수입이 ${monthlyGoalAmount.toLocaleString()}원으로 설정되었습니다!`);
}
const hjncScheduleMonthCache = {};
// 근무일지 입·출항 선박 목록 상태: 현재 화면에 그려진 선박과, 선택된 선박의 입·출항 시각 정보
let worklogRenderedVessels = [];
const worklogVesselMeta = new Map();
// 작업 내용에 자동 입력한 '더블오더 작업' 블록(헤더 + ①② 줄)을 찾는 패턴
const WORKLOG_DOUBLE_BLOCK_RE = /🚢 (?:더블|트리플|쿼드|멀티)오더 작업 \(선박 [2-4]척[^\n]*\n(?:[①②③④] [^\n]*(?:\n|$))*\n?/;
const TERMINAL_SCHEDULE_LIST = [
    { id: "hjnc", group: "3항업", label: "한진(HJNC)", badge: "HJNC", color: "#ea580c", live: true },
    { id: "bnct", group: "3항업", label: "고려(BNCT)", badge: "BNCT", color: "#2563eb", live: true },
    { id: "dgt",  group: "3항업", label: "동원(DGT)",  badge: "DGT",  color: "#059669", live: true },
    { id: "bct",  group: "3항업", label: "BCT",        badge: "BCT",  color: "#7c3aed", live: false },
    { id: "pnc",  group: "2항업", label: "PNC",        badge: "PNC",  color: "#0284c7", live: false },
    { id: "hpnt", group: "2항업", label: "HMM(HPNT)",  badge: "HPNT", color: "#dc2626", live: true },
    { id: "pnit", group: "2항업", label: "국제(PNIT)", badge: "PNIT", color: "#0d9488", live: true },
    { id: "bptc", group: "1항업", label: "북항(BPTC)", badge: "BPTC", color: "#4f46e5", live: true },
    { id: "hbct", group: "1항업", label: "허치슨(HBCT)", badge: "HBCT", color: "#b45309", live: true }
];
let selectedScheduleTerminal = localStorage.getItem("busanPortScheduleTerminal") || "hjnc";
if (!TERMINAL_SCHEDULE_LIST.some(t => t.id === selectedScheduleTerminal)) {
    selectedScheduleTerminal = "hjnc";
}
function getTerminalMeta(tid) {
    return TERMINAL_SCHEDULE_LIST.find(t => t.id === tid) || TERMINAL_SCHEDULE_LIST[0];
}
function updateTerminalScheduleLinksUI() {
    const cfg =
        terminalQuickConfig[selectedScheduleTerminal] || terminalQuickConfig.hjnc;
    const meta = getTerminalMeta(selectedScheduleTerminal);

    const schedLink = document.getElementById("terminalScheduleOrigLink");
    const chartLink = document.getElementById("terminalChartOrigLink");
    if (schedLink && cfg) schedLink.href = cfg.schedule;
    if (chartLink && cfg) chartLink.href = cfg.chart;
    const shipSchedLink = document.getElementById("shipFormScheduleOrigLink");
    const shipChartLink = document.getElementById("shipFormChartOrigLink");
    if (shipSchedLink && cfg) shipSchedLink.href = cfg.schedule;
    if (shipChartLink && cfg) shipChartLink.href = cfg.chart;

    const wageSchedLink =
        document.getElementById("wageTerminalScheduleOrigLink");
    const wageChartLink =
        document.getElementById("wageTerminalChartOrigLink");
    const wageTerminalLabel =
        document.getElementById("wageTerminalActiveLabel");

    if (wageSchedLink && cfg) {
        wageSchedLink.href = cfg.schedule;
        wageSchedLink.textContent = `🗓️ ${meta.badge} 스케줄 열기 ↗`;
        wageSchedLink.style.background = meta.color;
        wageSchedLink.onclick = () =>
            trackAppEvent("terminals", selectedScheduleTerminal);
    }

    if (wageChartLink && cfg) {
        wageChartLink.href = cfg.chart;
        wageChartLink.textContent = `📊 ${meta.badge} 차트 열기 ↗`;
        wageChartLink.onclick = () =>
            trackAppEvent("terminals", selectedScheduleTerminal);
    }

    if (wageTerminalLabel) {
        wageTerminalLabel.textContent = `현재 선택: ${meta.label}`;
    }
}
function renderTerminalScheduleTabBar() {
    const html = TERMINAL_SCHEDULE_LIST.map(t => {
        const isActive = t.id === selectedScheduleTerminal;
        return `<button type="button"
            class="term-sched-tab-btn ${isActive ? 'active' : ''}"
            aria-pressed="${isActive}"
            title="${t.label} 스케줄·차트 선택"
            style="${isActive ? `background:${t.color}; border-color:${t.color};` : ''}"
            onclick="selectScheduleTerminal('${t.id}')">
            ${t.label}
        </button>`;
    }).join("");

    const bar = document.getElementById("terminalScheduleTabBar");
    if (bar) bar.innerHTML = html;

    const shipBar = document.getElementById("shipFormScheduleTabBar");
    if (shipBar) shipBar.innerHTML = html;

    const wageBar = document.getElementById("wageTerminalScheduleTabBar");
    if (wageBar) wageBar.innerHTML = html;

    updateTerminalScheduleLinksUI();
}
function selectScheduleTerminal(terminalId) {
    if (!TERMINAL_SCHEDULE_LIST.some(t => t.id === terminalId)) return;
    selectedScheduleTerminal = terminalId;
    try { localStorage.setItem("busanPortScheduleTerminal", terminalId); } catch (e) {}
    trackAppEvent("terminals", terminalId);
    renderTerminalScheduleTabBar();
    const curDate = getWorklogScheduleDate() || document.getElementById("dailyLogForm")?.getAttribute("data-date");
    if (curDate && !document.getElementById("dailyLogForm")?.classList.contains("hidden")) {
        loadHjncScheduledShipsForDate(curDate, false);
    }
    const shipFormEl = document.getElementById("shipForm");
    const shipDate = document.getElementById("shipFormScheduleDate")?.value;
    if (shipFormEl && !shipFormEl.classList.contains("hidden") && shipDate) {
        loadShipFormScheduledShipsForDate(shipDate, false);
    }
    const wageDate = typeof getWageScheduleDate === "function"
        ? getWageScheduleDate()
        : document.getElementById("wageStartDate")?.value;
    if (wageDate && typeof loadWageScheduledShipsForDate === "function") {
        loadWageScheduledShipsForDate(wageDate, false);
    }
}
let selectedWageScheduleShipName = "";
let selectedWageVessels = [];

/* ===== 당일 작업 선박 최대 4척(멀티오더) 공통 상수·헬퍼 =====
   2척 = 더블오더 · 3척 = 트리플오더 · 4척 = 쿼드오더 */
const MAX_WORK_VESSELS = 4;
const MULTI_ORDER_LABELS = ["단일 작업", "단일 작업", "더블오더", "트리플오더", "쿼드오더"];
const VESSEL_ORDER_MARKS = ["①", "②", "③", "④"];

function getMultiOrderLabel(count) {
    const n = Math.max(0, Math.min(MAX_WORK_VESSELS, Number(count) || 0));
    return MULTI_ORDER_LABELS[n] || "멀티오더";
}

function invalidateCalculatedWage() {
    lastCalculatedWageData = null;
    document.getElementById("wageResultBox")?.classList.add("hidden");
}

function periodHours(startDate, startHour, endDate, endHour) {
    if (!startDate || !endDate) return 0;
    const sh = parseInt(startHour, 10);
    const eh = parseInt(endHour, 10);
    if (!Number.isInteger(sh) || !Number.isInteger(eh)) return 0;
    const startAt = new Date(`${startDate}T${String(sh).padStart(2, "0")}:00:00`);
    const endAt = new Date(`${endDate}T${String(eh).padStart(2, "0")}:00:00`);
    const diffMs = endAt.getTime() - startAt.getTime();
    return diffMs > 0 ? Math.floor(diffMs / (1000 * 60 * 60)) : 0;
}

function getSelectedVesselPeriod(vessel, fallbackDate = "") {
    if (!vessel) {
        return {
            startDate: fallbackDate,
            endDate: fallbackDate,
            startHour: null,
            endHour: null,
            hours: 0,
            arrival: null,
            departure: null
        };
    }
    const arrival = getVesselScheduleDateTime(vessel, ["ATA", "ETB", "ATW"]);
    const departure = getVesselScheduleDateTime(vessel, ["ATD", "ATC"]);
    const startDate = arrival?.date || fallbackDate;
    const endDate = departure?.date || startDate;
    const startHour = arrival?.time ? parseInt(arrival.time.slice(0, 2), 10) : null;
    const endHour = departure?.time ? parseInt(departure.time.slice(0, 2), 10) : null;
    const validStart = Number.isInteger(startHour) && startHour >= 0 && startHour <= 23 ? startHour : null;
    const validEnd = Number.isInteger(endHour) && endHour >= 0 && endHour <= 23 ? endHour : null;
    const hours = (validStart !== null && validEnd !== null)
        ? periodHours(startDate, validStart, endDate, validEnd)
        : 0;
    return {
        startDate,
        endDate,
        startHour: validStart,
        endHour: validEnd,
        hours,
        arrival,
        departure
    };
}

function syncWageHoursBlockSize() {
    if (typeof document === "undefined" || typeof document.querySelector !== "function") return;
    const grid = document.querySelector("#wage-card .wage-hours-grid");
    if (!grid) return;

    const dateInput = document.getElementById("wageStartDate");
    const shipInput = document.getElementById("wageShipName");
    const hourlyInput = document.getElementById("wageHourly");
    const dateRect = dateInput && typeof dateInput.getBoundingClientRect === "function" ? dateInput.getBoundingClientRect() : null;
    const fallbackRect = (shipInput && typeof shipInput.getBoundingClientRect === "function" ? shipInput.getBoundingClientRect() : null) ||
        (hourlyInput && typeof hourlyInput.getBoundingClientRect === "function" ? hourlyInput.getBoundingClientRect() : null);

    const rowHeight = (dateRect && dateRect.height > 0) ? dateRect.height : ((fallbackRect && fallbackRect.height > 0) ? fallbackRect.height : 42);
    const refWidth = (dateRect && dateRect.width > 0) ? dateRect.width : ((fallbackRect && fallbackRect.width > 0) ? fallbackRect.width : 200);

    // 정사각형의 최소 한 변: 날짜칸 높이 2개 + 선박 블록 사이 간격
    const minimumSide = rowHeight * 2 + 4;
    const available = grid.getBoundingClientRect?.().width ||
        grid.parentElement?.getBoundingClientRect?.().width ||
        grid.closest?.(".dash-content")?.getBoundingClientRect?.().width ||
        grid.closest?.(".calc-layout")?.getBoundingClientRect?.().width ||
        refWidth + minimumSide + 6;

    // 기본은 가로폭의 30%. 좁으면 날짜칸 기준 최소 높이를 우선
    const side = Math.max(minimumSide, (available - 6) * 0.3);
    grid.style?.setProperty("--wage-date-height", `${rowHeight}px`);
    grid.style?.setProperty("--wage-total-side", `${side}px`);

    const timeButton = document.querySelector("#wage-card .calc-left .action-btn") || document.querySelector("#wage-card .wage-action-grid .action-btn");
    if (timeButton && typeof getComputedStyle === "function") {
        grid.style?.setProperty("--wage-hours-font", getComputedStyle(timeButton).fontSize);
    }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("resize", syncWageHoursBlockSize);
}

/**
 * 선박별 자동계산 블록(1~4번) 노출 제어.
 * 평소에는 1·2번만 보이고, 선박을 3척 또는 4척 선택하면 3·4번 블록이 나타납니다.
 * 보이는 블록은 CSS(grid-auto-rows:1fr + 고정 높이)로 총 근무시간 정사각형 높이를 균등 분할합니다.
 */
function syncWageVesselSlotVisibility(selectedCount) {
    const visible = Math.max(2, Math.min(MAX_WORK_VESSELS, Number(selectedCount) || 0));
    for (let slot = 1; slot <= MAX_WORK_VESSELS; slot++) {
        const card = document.getElementById(`wageVessel${slot}Card`);
        if (card && card.classList) card.classList.toggle("is-slot-hidden", slot > visible);
    }
    const pair = document.getElementById("wageHoursBreakdown");
    if (pair && pair.classList) pair.classList.toggle("is-compact", visible > 2);
    return visible;
}

/** 선택된 선박(최대 4척)의 화면 표기용 이름·시간 목록 */
function getWageVesselSlotRows() {
    const firstHours = periodHours(
        document.getElementById("wageStartDate")?.value,
        document.getElementById("wageStartHour")?.value,
        document.getElementById("wageEndDate")?.value,
        document.getElementById("wageEndHour")?.value
    );
    const manualTotal = parseFloat(document.getElementById("wageTotalHours")?.value) || 0;

    if (selectedWageVessels.length === 0) {
        const shipInputVal = document.getElementById("wageShipName")?.value.trim() || "";
        return [{ name: shipInputVal || "미선택", hours: manualTotal || firstHours }];
    }

    return selectedWageVessels.slice(0, MAX_WORK_VESSELS).map((item, index) => {
        if (index === 0) {
            const hours = selectedWageVessels.length > 1 ? firstHours : (manualTotal || firstHours);
            return { name: item.name || "1번 선박", hours };
        }
        const period = getSelectedVesselPeriod(item.vessel, item.date);
        return { name: item.name || `${index + 1}번 선박`, hours: period.hours };
    });
}

function updateWageHoursBreakdown() {
    syncWageHoursBlockSize();
    const rows = getWageVesselSlotRows();

    for (let slot = 1; slot <= MAX_WORK_VESSELS; slot++) {
        const nameEl = document.getElementById(`wageVessel${slot}Name`);
        const hoursEl = document.getElementById(`wageVessel${slot}Hours`);
        if (!nameEl || !hoursEl) continue;
        const row = rows[slot - 1];
        if (row) {
            nameEl.textContent = row.name || `${slot}번 선박`;
            hoursEl.textContent = row.hours > 0 ? `${row.hours}시간` : "확인 필요";
        } else {
            nameEl.textContent = "미선택";
            hoursEl.textContent = "-";
        }
    }

    syncWageVesselSlotVisibility(selectedWageVessels.length);
}

function refreshWageWorkHours() {
    const total = document.getElementById("wageTotalHours");

    if (selectedWageVessels.length > 1) {
        const first = periodHours(
            document.getElementById("wageStartDate")?.value,
            document.getElementById("wageStartHour")?.value,
            document.getElementById("wageEndDate")?.value,
            document.getElementById("wageEndHour")?.value
        );
        // 2~4번 선박은 스케줄 입·출항 시각으로 각각 계산해 합산합니다.
        const restHours = selectedWageVessels.slice(1).map(item =>
            getSelectedVesselPeriod(item.vessel, item.date).hours
        );
        const allValid = first > 0 && restHours.every(hours => hours > 0);

        if (total) {
            total.value = allValid ? first + restHours.reduce((sum, hours) => sum + hours, 0) : "";
            total.readOnly = true;
        }
    } else if (total) {
        total.readOnly = false;
        if (selectedWageVessels.length === 1) {
            const first = periodHours(
                document.getElementById("wageStartDate")?.value,
                document.getElementById("wageStartHour")?.value,
                document.getElementById("wageEndDate")?.value,
                document.getElementById("wageEndHour")?.value
            );
            total.value = first > 0 ? String(first) : "";
        }
    }

    updateWageHoursBreakdown();
}

function getWageScheduleDate() {
    const dateInput = document.getElementById("wageScheduleDatePicker");
    if (!dateInput) return getAppLocalDateString();

    if (!dateInput.value) {
        dateInput.value = getAppLocalDateString();
    }
    return dateInput.value;
}

function setWageScheduleDate(dateStr) {
    const normalizedDate = String(dateStr || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return false;

    const parsedDate = new Date(`${normalizedDate}T00:00:00Z`);
    if (
        !Number.isFinite(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== normalizedDate
    ) return false;

    const dateInput = document.getElementById("wageScheduleDatePicker");
    if (dateInput) dateInput.value = normalizedDate;
    if (typeof syncWageHourlyYearLabel === "function") {
        syncWageHourlyYearLabel(normalizedDate);
    }
    return true;
}

function openWageScheduleDatePicker() {
    const dateInput = document.getElementById("wageScheduleDatePicker");
    if (!dateInput) return;
    if (!dateInput.value) {
        dateInput.value = getAppLocalDateString();
    }
    if (typeof dateInput.showPicker === "function") {
        try {
            dateInput.showPicker();
        } catch (e) {}
    }
}

function onWageScheduleDateChange(dateStr) {
    if (!setWageScheduleDate(dateStr)) return;

    const meta = getTerminalMeta(selectedScheduleTerminal);
    const titleEl = document.getElementById("wageTerminalScheduleTitle");
    if (titleEl) {
        titleEl.textContent =
            `⚓ ${dateStr} ${meta.label} 입항·작업 선박 조회 중...`;
    }

    showToast(`📅 ${dateStr} ${meta.label} 스케줄로 이동합니다.`);
    loadWageScheduledShipsForDate(dateStr, false);
}

function getVesselScheduleDateTime(vessel, fields) {
    let dateOnly = null;

    for (const field of fields) {
        const rawValue = String(vessel?.[field] || "").trim();
        const date = extractDatePrefix(rawValue);
        if (!date) continue;

        const time = extractShortTime(rawValue);
        if (time) return { date, time };
        if (!dateOnly) dateOnly = { date, time: "" };
    }

    return dateOnly;
}

function formatWageScheduleEvent(eventTime) {
    if (!eventTime) return "정보 없음";
    return eventTime.time
        ? `${eventTime.date} ${eventTime.time}`
        : `${eventTime.date} 시간 미정`;
}

function renderWageScheduledShipsUI(
    dateStr,
    allVessels,
    terminalId = selectedScheduleTerminal
) {
    const titleEl = document.getElementById("wageTerminalScheduleTitle");
    const listEl = document.getElementById("wageTerminalScheduledShipList");
    if (!titleEl || !listEl || !dateStr) return;

    const meta = getTerminalMeta(terminalId);
    const cfg = terminalQuickConfig[terminalId] || terminalQuickConfig.hjnc;
    const matched = (allVessels || [])
        .filter(v => isVesselActiveOnDate(v, dateStr));

    const seen = new Set();
    const uniqueMatched = [];

    matched.forEach(v => {
        const name = String(v.VSL_NM || "").trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        uniqueMatched.push(v);
    });

    titleEl.textContent =
        `⚓ ${dateStr} ${meta.label} 입·출항 선박 (${uniqueMatched.length}척)`;

    // 앱 내 선박 목록을 제공하지 않는 터미널은 기존 원본 페이지로 안내
    if (!meta.live) {
        listEl.innerHTML = `<div class="wage-terminal-external-actions">
            <span class="wage-terminal-schedule-message">
                📌 ${meta.label} 터미널은 앱 내 선박 목록 대신 전용 스케줄·차트 페이지에서 확인할 수 있습니다.
            </span>
            <a href="${cfg.schedule}" target="_blank"
               rel="noopener noreferrer"
               style="background:${meta.color};"
               onclick="trackAppEvent('terminals','${terminalId}')">
                🗓️ ${meta.label} 스케줄 열기 ↗
            </a>
            <a href="${cfg.chart}" target="_blank"
               rel="noopener noreferrer"
               style="background:#0f172a;"
               onclick="trackAppEvent('terminals','${terminalId}')">
                📊 ${meta.label} 차트 열기 ↗
            </a>
        </div>`;
        return;
    }

    if (uniqueMatched.length === 0) {
        listEl.innerHTML = `<span class="wage-terminal-schedule-message">
            ${dateStr}에 조회된 ${meta.label} 입항·접안 선박이 없습니다.
        </span>`;
        return;
    }

    listEl.innerHTML = uniqueMatched.map((vessel, index) => {
        const name = String(vessel.VSL_NM || "").trim();
        const safeName = escapeShipCommentHtml(name);
        const berth = escapeShipCommentHtml(vessel.BERTH_NO || "-");
        const ptnr = escapeShipCommentHtml(vessel.PTNR_CODE || "");
        const arrival = getVesselScheduleDateTime(
            vessel, ["ATA", "ETB", "ATW"]
        );
        const departure = getVesselScheduleDateTime(
            vessel, ["ATD", "ATC"]
        );
        const arrivalLabel = formatWageScheduleEvent(arrival);
        const departureLabel = formatWageScheduleEvent(departure);
        const selectedIndex = selectedWageVessels.findIndex(item => item.name === name);
        const isSelected = selectedIndex >= 0 || (selectedWageVessels.length === 0 && selectedWageScheduleShipName === name);
        const selectedStyle = isSelected
            ? `background:${meta.color}; color:#ffffff; border-color:${meta.color};`
            : `border-color:${meta.color};`;
        const timeStyle = isSelected
            ? "color:#ffedd5;"
            : `color:${meta.color};`;
        const orderBadge = selectedIndex >= 0 ? `[${selectedIndex + 1}선박] ` : "";

        return `<button type="button"
            class="hjnc-ship-chip wage-schedule-ship-chip ${isSelected ? 'selected' : ''}"
            data-wage-vessel-index="${index}"
            aria-pressed="${isSelected}"
            style="${selectedStyle}">
            <span class="hjnc-berth-tag"
                  style="${isSelected
                    ? `background:#ffffff; color:${meta.color};`
                    : `background:${meta.color}; color:#ffffff;`}">
                ${berth}
            </span>
            <span>🚢 ${orderBadge}${safeName}</span>
            ${ptnr
                ? `<span style="font-size:0.66rem; color:${isSelected ? '#fed7aa' : '#64748b'}; font-weight:800;">(${ptnr})</span>`
                : ""}
            <span class="wage-terminal-schedule-time" style="${timeStyle}">
                입항 ${arrivalLabel} · 출항 ${departureLabel}
            </span>
        </button>`;
    }).join("");

    listEl.querySelectorAll("[data-wage-vessel-index]").forEach(button => {
        const index = Number(button.dataset.wageVesselIndex);
        button.onclick = () =>
            applyWageScheduleShip(uniqueMatched[index], dateStr, terminalId);
    });
}

async function loadWageScheduledShipsForDate(dateStr, forceRefresh = false) {
    const titleEl = document.getElementById("wageTerminalScheduleTitle");
    const listEl = document.getElementById("wageTerminalScheduledShipList");
    if (!titleEl || !listEl || !dateStr) return;

    setWageScheduleDate(dateStr);
    renderTerminalScheduleTabBar();

    const terminalId = selectedScheduleTerminal;
    const meta = getTerminalMeta(terminalId);
    const yearMonth = dateStr.slice(0, 7);

    if (!meta.live) {
        renderWageScheduledShipsUI(dateStr, [], terminalId);
        return;
    }

    titleEl.textContent = `⚓ ${dateStr} ${meta.label} 선박 스케줄 조회 중...`;
    listEl.innerHTML =
        `<span class="wage-terminal-schedule-message">${meta.label} 당일 입·출항 선박을 불러오는 중입니다...</span>`;

    const allVessels = await fetchHjncScheduleForMonth(
        yearMonth,
        forceRefresh,
        terminalId
    );

    const currentDate = getWageScheduleDate();
    if (currentDate !== dateStr || selectedScheduleTerminal !== terminalId) return;

    renderWageScheduledShipsUI(dateStr, allVessels, terminalId);
}

async function refreshWageScheduleForSelectedDate() {
    // 갱신은 날짜 선택 상태를 오늘로 되돌린 뒤 오늘 스케줄을 강제로 다시 조회합니다.
    const dateStr = getAppLocalDateString();
    setWageScheduleDate(dateStr);

    const yearMonth = dateStr.slice(0, 7);
    delete hjncScheduleMonthCache[`${selectedScheduleTerminal}_${yearMonth}`];

    const meta = getTerminalMeta(selectedScheduleTerminal);
    showToast(`🔄 ${dateStr} ${meta.label} 오늘 선박 스케줄을 갱신합니다...`);
    await loadWageScheduledShipsForDate(dateStr, true);
}

function applyVesselPeriodToWageInputs(vessel, fallbackDate) {
    const period = getSelectedVesselPeriod(vessel, fallbackDate);
    const startDateInput = document.getElementById("wageStartDate");
    const endDateInput = document.getElementById("wageEndDate");
    const startHourInput = document.getElementById("wageStartHour");
    const endHourInput = document.getElementById("wageEndHour");

    if (startDateInput && period.startDate) {
        startDateInput.value = period.startDate;
        if (typeof syncWageHourlyYearLabel === "function") {
            syncWageHourlyYearLabel(period.startDate);
        }
    }
    if (endDateInput && period.endDate) endDateInput.value = period.endDate;
    if (startHourInput && period.startHour !== null) {
        startHourInput.value = String(period.startHour);
    }
    if (endHourInput && period.endHour !== null) {
        endHourInput.value = String(period.endHour);
    }

    const month = parseInt((period.startDate || "").split("-")[1], 10);
    if (month >= 1 && month <= 12) highlightSeasonRow(month);

    if (period.hours > 0 && period.startDate && period.startHour !== null) {
        const startAt = new Date(
            `${period.startDate}T${String(period.startHour).padStart(2, "0")}:00:00`
        );
        autoFillWeekendHoliday(startAt, period.hours);
    }
    return period;
}

function applyWageScheduleShip(
    vessel,
    dateStr,
    terminalId = selectedScheduleTerminal
) {
    if (!vessel) return;

    const name = String(vessel.VSL_NM || "").trim();
    if (!name) return;

    const index = selectedWageVessels.findIndex(item => item.name === name);
    if (index >= 0) {
        selectedWageVessels.splice(index, 1); // 다시 누르면 선택 해제
    } else if (selectedWageVessels.length >= MAX_WORK_VESSELS) {
        return showToast(`⚠️ 선박은 최대 ${MAX_WORK_VESSELS}척까지 선택할 수 있습니다.`);
    } else {
        selectedWageVessels.push({ name, vessel, date: dateStr, terminalId });
    }

    const names = selectedWageVessels.map(item => item.name);
    selectedWageScheduleShipName = names.join(" / ");

    const wageShipNameInput = document.getElementById("wageShipName");
    if (wageShipNameInput) wageShipNameInput.value = names.join(" / ");

    const doubleOrderInput = document.getElementById("wageDoubleOrder");
    if (doubleOrderInput) doubleOrderInput.checked = names.length >= 2;

    invalidateCalculatedWage();

    if (selectedWageVessels.length > 0) {
        const firstEntry = selectedWageVessels[0];
        applyVesselPeriodToWageInputs(firstEntry.vessel, firstEntry.date);
    } else {
        const totalHoursInput = document.getElementById("wageTotalHours");
        if (totalHoursInput) {
            totalHoursInput.value = "";
            totalHoursInput.readOnly = false;
        }
    }

    refreshWageWorkHours();

    if (selectedWageVessels.length === 0) {
        showToast(`🚢 ${name} 선박 선택이 해제되었습니다.`);
    } else if (selectedWageVessels.length === 1) {
        const firstEntry = selectedWageVessels[0];
        const firstPeriod = getSelectedVesselPeriod(firstEntry.vessel, firstEntry.date);
        const startLabel = formatWageScheduleEvent(
            firstPeriod.arrival || { date: firstPeriod.startDate, time: "" }
        );
        const endLabel = formatWageScheduleEvent(firstPeriod.departure);
        const missingTimes = [];
        if (!firstPeriod.arrival?.time) missingTimes.push("입항 시각");
        if (!firstPeriod.departure?.time) missingTimes.push("출항 시각");
        const timingNote = missingTimes.length
            ? ` · ${missingTimes.join("·")} 직접 확인`
            : (!firstPeriod.hours ? " · 시각 순서·분 단위 확인 필요" : "");
        const calcNote = firstPeriod.hours > 0 ? ` · ${firstPeriod.hours}시간 자동 계산` : "";
        showToast(
            `🚢 ${firstEntry.name} 선택 · 시작 ${startLabel} · 종료 ${endLabel}${calcNote}${timingNote}`
        );
    } else {
        const count = selectedWageVessels.length;
        const orderLabel = getMultiOrderLabel(count);
        const totalVal = document.getElementById("wageTotalHours")?.value;
        const missingNames = selectedWageVessels.slice(1)
            .filter(item => !getSelectedVesselPeriod(item.vessel, item.date).hours)
            .map(item => item.name);
        const missingNote = missingNames.length
            ? ` · ${missingNames.join("·")} 입·출항 시각 확인 필요`
            : "";
        showToast(
            `🚢 ${orderLabel} ${count}척 선택 (${names.join(" / ")})` +
            `${totalVal ? ` · 합산 ${totalVal}시간` : ""}${missingNote}`
        );
    }

    const activeDate = getWageScheduleDate() || dateStr;
    const cacheKey = `${terminalId}_${activeDate.slice(0, 7)}`;
    const cachedVessels = hjncScheduleMonthCache[cacheKey];
    if (cachedVessels) {
        renderWageScheduledShipsUI(activeDate, cachedVessels, terminalId);
    } else {
        loadWageScheduledShipsForDate(activeDate, false);
    }
}
function initShipFormSchedulePicker() {
    const dateInput = document.getElementById("shipFormScheduleDate");
    if (!dateInput) return;
    if (!dateInput.value) {
        const nowObj = new Date();
        dateInput.value = `${nowObj.getFullYear()}-${String(nowObj.getMonth() + 1).padStart(2, "0")}-${String(nowObj.getDate()).padStart(2, "0")}`;
    }
    renderTerminalScheduleTabBar();
    loadShipFormScheduledShipsForDate(dateInput.value, false);
}
function onShipFormScheduleDateChange(dateStr) {
    if (!dateStr) return;
    loadShipFormScheduledShipsForDate(dateStr, false);
}
async function refreshShipFormScheduleForSelectedDate() {
    const dateStr = document.getElementById("shipFormScheduleDate")?.value;
    if (!dateStr) return;
    const yearMonth = dateStr.slice(0, 7);
    const cacheKey = `${selectedScheduleTerminal}_${yearMonth}`;
    delete hjncScheduleMonthCache[cacheKey];
    const meta = getTerminalMeta(selectedScheduleTerminal);
    showToast(`🔄 ${meta.label} 선석 배정 현황을 새로고침합니다...`);
    await loadShipFormScheduledShipsForDate(dateStr, true);
}
function renderShipFormScheduledShipsUI(dateStr, allVessels, terminalId = selectedScheduleTerminal) {
    const titleEl = document.getElementById("shipFormScheduleTitle");
    const listEl = document.getElementById("shipFormScheduledShipList");
    if (!titleEl || !listEl || !dateStr) return;

    renderTerminalScheduleTabBar();
    const meta = getTerminalMeta(terminalId);
    const cfg = terminalQuickConfig[terminalId] || terminalQuickConfig.hjnc;
    const currentValue = (document.getElementById("shipName")?.value || "").trim().toUpperCase();
    const matched = (allVessels || []).filter(v => isVesselActiveOnDate(v, dateStr));
    const seen = new Set();
    const uniqueMatched = [];
    matched.forEach(v => {
        const name = String(v.VSL_NM || "").trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        uniqueMatched.push(v);
    });

    const sourceLine = formatScheduleSourceLine(hjncScheduleSourceInfo[`${terminalId}_${dateStr.slice(0, 7)}`]);
    titleEl.innerText = `⚓ ${dateStr} ${meta.label} 입항·작업 선박 (${uniqueMatched.length}척)${sourceLine}`;

    if (uniqueMatched.length === 0) {
        if (!meta.live) {
            listEl.innerHTML = `<div style="display:flex; flex-direction:column; gap:5px; width:100%; background:rgba(255,255,255,0.75); padding:7px 9px; border-radius:8px; border:1px dashed #cbd5e1;">
                <span style="font-size:0.74rem; color:var(--text-main); font-weight:800;">📌 <b>${meta.label}</b> 터미널은 전용 보안·외부 뷰어 페이지로 제공됩니다.</span>
                <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                    <a href="${cfg.schedule}" target="_blank" onclick="trackAppEvent('terminals','${terminalId}')" style="background:${meta.color}; color:#fff; padding:4px 10px; border-radius:6px; font-size:0.73rem; font-weight:900; text-decoration:none;">🔗 ${meta.label} 선석 스케줄 열기 ↗</a>
                    <a href="${cfg.chart}" target="_blank" onclick="trackAppEvent('terminals','${terminalId}')" style="background:#0f172a; color:#fff; padding:4px 10px; border-radius:6px; font-size:0.73rem; font-weight:900; text-decoration:none;">📊 선석 차트 열기 ↗</a>
                    <button type="button" onclick="applyShipFormQuickChip('[${meta.badge}] ')" style="background:#ffffff; color:${meta.color}; border:1.5px solid ${meta.color}; padding:3px 9px; border-radius:6px; font-size:0.72rem; font-weight:900; cursor:pointer;">✏️ [${meta.badge}] 머리말 입력</button>
                </div>
            </div>`;
            return;
        }
        listEl.innerHTML = `<div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px; width:100%;">
            <span style="font-size:0.74rem; color:var(--text-sub); font-weight:700;">해당 날짜(${dateStr})에 조회된 ${meta.label} 입항·접안 선박이 없습니다.</span>
            <a href="${cfg.schedule}" target="_blank" class="term-sched-source-link" onclick="trackAppEvent('terminals','${terminalId}')" style="background:${meta.color}; color:#fff; padding:3px 8px; border-radius:6px; font-size:0.7rem; font-weight:800; text-decoration:none;">🔗 ${meta.label} 스케줄 원본 열기 ↗</a>
        </div>`;
        return;
    }

    listEl.innerHTML = uniqueMatched.map(v => {
        const name = String(v.VSL_NM || "").trim();
        const safeName = escapeShipCommentHtml(name);
        const jsSafeName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const berth = escapeShipCommentHtml(v.BERTH_NO || "-");
        const ptnr = escapeShipCommentHtml(v.PTNR_CODE || "");
        const arrDate = extractDatePrefix(v.ATA || v.ETB);
        const arrTime = extractShortTime(v.ATA || v.ETB);
        const depTime = extractShortTime(v.ATD);
        const timeBadge = arrDate === dateStr && arrTime
            ? `입항 ${arrTime}`
            : (depTime ? `~출항 ${depTime}` : "작업 중");
        const isSelected = currentValue === name.toUpperCase() || currentValue === `[${meta.badge}] ${name.toUpperCase()}`;
        const selectedStyle = isSelected ? `background:${meta.color}; color:#ffffff; border-color:${meta.color};` : "";
        const timeStyle = isSelected ? "color:#ffedd5;" : "";
        return `<button type="button" class="hjnc-ship-chip" style="${selectedStyle}" onclick="applyShipFormQuickChip('${jsSafeName}', '${berth}', '${ptnr}', '${meta.badge}')">
            <span class="hjnc-berth-tag" style="${isSelected ? `background:#ffffff; color:${meta.color};` : `background:${meta.color}; color:#ffffff;`}">${berth}</span>
            <span>🚢 ${safeName}</span>
            ${ptnr ? `<span style="font-size:0.66rem; color:${isSelected ? '#fed7aa' : '#64748b'}; font-weight:800;">(${ptnr})</span>` : ""}
            <span class="hjnc-time-tag" style="${timeStyle}">${timeBadge}</span>
        </button>`;
    }).join("");
}
async function loadShipFormScheduledShipsForDate(dateStr, forceRefresh = false) {
    const titleEl = document.getElementById("shipFormScheduleTitle");
    const listEl = document.getElementById("shipFormScheduledShipList");
    if (!titleEl || !listEl || !dateStr) return;

    renderTerminalScheduleTabBar();
    const tid = selectedScheduleTerminal;
    const meta = getTerminalMeta(tid);
    const yearMonth = dateStr.slice(0, 7);

    if (!meta.live) {
        renderShipFormScheduledShipsUI(dateStr, [], tid);
        return;
    }

    titleEl.innerText = `⚓ ${dateStr} ${meta.label} 입항·접안 예정 선박 조회 중...`;
    listEl.innerHTML = `<span style="font-size:0.74rem; color:var(--text-sub); font-weight:700;">${meta.label} 선석 배정 현황 데이터를 불러오는 중입니다...</span>`;

    const allVessels = await fetchHjncScheduleForMonth(yearMonth, forceRefresh, tid);
    const currentSelected = document.getElementById("shipFormScheduleDate")?.value;
    if ((currentSelected && currentSelected !== dateStr) || selectedScheduleTerminal !== tid) return;

    renderShipFormScheduledShipsUI(dateStr, allVessels, tid);
}
function applyShipFormQuickChip(shipName, berthNo = "", ptnrCode = "", termBadge = "") {
    const input = document.getElementById("shipName");
    if (!input) return;
    input.value = shipName;
    if (typeof checkShipDuplicateInline === "function") checkShipDuplicateInline(shipName);
    if (shipName.endsWith(" ")) input.focus();
    const shipDate = document.getElementById("shipFormScheduleDate")?.value;
    if (shipDate) {
        const ym = shipDate.slice(0, 7);
        const cacheKey = `${selectedScheduleTerminal}_${ym}`;
        if (hjncScheduleMonthCache[cacheKey]) {
            renderShipFormScheduledShipsUI(shipDate, hjncScheduleMonthCache[cacheKey], selectedScheduleTerminal);
        }
    }
    const termPrefix = termBadge ? `[${termBadge}] ` : "";
    const extraInfo = berthNo ? ` (${berthNo}선석${ptnrCode ? ' · ' + ptnrCode : ''})` : "";
    showToast(`🚢 ${termPrefix}'${shipName.trim()}'${extraInfo} 선박명이 신규 등록 칸에 입력되었습니다.`);
}
function extractDatePrefix(dtStr) {
    if (!dtStr || typeof dtStr !== "string") return "";
    const m = dtStr.trim().match(/^(\d{4})[-./](\d{2})[-./](\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : dtStr.trim().slice(0, 10);
}
function extractShortTime(dtStr) {
    if (!dtStr || typeof dtStr !== "string") return "";
    const parts = dtStr.trim().split(/\s+/);
    return parts[1] ? parts[1].slice(0, 5) : "";
}
function isVesselActiveOnDate(vessel, dateStr) {
    if (!vessel || !dateStr) return false;
    const etbDate = extractDatePrefix(vessel.ETB);
    const ataDate = extractDatePrefix(vessel.ATA);
    const atdDate = extractDatePrefix(vessel.ATD);
    const atwDate = extractDatePrefix(vessel.ATW);
    const atcDate = extractDatePrefix(vessel.ATC);

    if (etbDate === dateStr || ataDate === dateStr || atdDate === dateStr || atwDate === dateStr || atcDate === dateStr) {
        return true;
    }
    const startD = ataDate || etbDate || atwDate;
    const endD = atdDate || atcDate || startD;
    if (startD && endD && startD <= dateStr && dateStr <= endD) {
        return true;
    }
    return false;
}
/* 🕒 선석 스케줄 데이터 출처 기록 (C-2): 실시간 조회인지 저장본인지 화면에 함께 표시 */
const hjncScheduleSourceInfo = {};
function getScheduleDocKey(terminalId, yearMonth) {
    return terminalId === "hjnc" ? yearMonth : `${terminalId}_${yearMonth}`;
}
async function fetchHjncScheduleForMonth(yearMonth, forceRefresh = false, terminalId = selectedScheduleTerminal) {
    const tid = (terminalId || "hjnc").toLowerCase();
    const cacheKey = `${tid}_${yearMonth}`;
    if (!forceRefresh && hjncScheduleMonthCache[cacheKey] && hjncScheduleMonthCache[cacheKey].length > 0) {
        return hjncScheduleMonthCache[cacheKey];
    }
    const [yStr, mStr] = yearMonth.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const prevD = new Date(y, m - 1, -2);
    const nextD = new Date(y, m, 3);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const startDate = fmt(prevD);
    const endDate = fmt(nextD);
    const docKey = getScheduleDocKey(tid, yearMonth);

    let vessels = [];

    // 1순위: Firestore(hjnc_schedules)에서 즉시 로드
    if (!forceRefresh) {
        try {
            const snap = await db.collection("hjnc_schedules").doc(docKey).get();
            if (snap.exists) {
                const data = snap.data() || {};
                if (typeof data.vesselsJson === "string" && data.vesselsJson.length > 2) {
                    vessels = JSON.parse(data.vesselsJson);
                } else if (Array.isArray(data.vessels)) {
                    vessels = data.vessels;
                }
                hjncScheduleSourceInfo[cacheKey] = { source: "cache", updatedAt: (typeof data.updatedAt === "string" ? data.updatedAt : null) };
            }
        } catch (e) {
            reportFailure("저장된 선석 스케줄", e);
        }
    }

    // 백그라운드 또는 강제 새로고침 시 실시간 /api/terminal-schedule 동기화
    const syncFromLiveApi = async () => {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8500);
            const res = await fetch(`/api/terminal-schedule?terminal=${encodeURIComponent(tid)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, {
                signal: controller.signal
            });
            clearTimeout(timer);
            const contentType = res.headers.get("content-type") || "";
            if (res.ok && contentType.includes("application/json")) {
                const json = await res.json();
                if (json && Array.isArray(json.vessels) && json.vessels.length > 0) {
                    const slim = json.vessels.map(v => ({
                        TERMINAL: v.TERMINAL || tid.toUpperCase(),
                        VSL_NM: v.VSL_NM || "",
                        BERTH_NO: v.BERTH_NO || "",
                        PTNR_CODE: v.PTNR_CODE || "",
                        VOY_NO: v.VOY_NO || "",
                        ETB: v.ETB || "",
                        ATA: v.ATA || "",
                        ATW: v.ATW || "",
                        ATC: v.ATC || "",
                        ATD: v.ATD || ""
                    }));
                    hjncScheduleMonthCache[cacheKey] = slim;
                    hjncScheduleSourceInfo[cacheKey] = { source: "live", updatedAt: new Date().toISOString() };
                    db.collection("hjnc_schedules").doc(docKey).set({
                        terminal: tid,
                        yearMonth,
                        vesselsJson: JSON.stringify(slim),
                        count: slim.length,
                        updatedAt: new Date().toISOString()
                    }, { merge: true }).catch((e) => { reportFailure("선석 스케줄 저장", e); });
                    isScheduleFailureReported = false;
                    return slim;
                }
            }
        } catch (e) {
            if (!isScheduleFailureReported) {
                isScheduleFailureReported = true;
                reportFailure("실시간 선석 스케줄", e, "⚠️ 실시간 선석 정보를 불러오지 못했습니다. 저장된 스케줄로 표시합니다.");
            }
        }
        return null;
    };

    if (vessels.length > 0 && !forceRefresh) {
        hjncScheduleMonthCache[cacheKey] = vessels;
        syncFromLiveApi().then(updated => {
            if (updated && updated.length > 0 && selectedScheduleTerminal === tid) {
                const curDate = getWorklogScheduleDate() || document.getElementById("dailyLogForm")?.getAttribute("data-date");
                if (curDate && curDate.startsWith(yearMonth)) {
                    renderHjncScheduledShipsUI(curDate, updated, tid);
                }
                const shipDate = document.getElementById("shipFormScheduleDate")?.value;
                const shipFormEl = document.getElementById("shipForm");
                if (shipFormEl && !shipFormEl.classList.contains("hidden") && shipDate && shipDate.startsWith(yearMonth)) {
                    renderShipFormScheduledShipsUI(shipDate, updated, tid);
                }
                const wageDate = document.getElementById("wageStartDate")?.value;
                if (wageDate && wageDate.startsWith(yearMonth)) {
                    renderWageScheduledShipsUI(wageDate, updated, tid);
                }
            }
        });
        return vessels;
    }

    const liveVessels = await syncFromLiveApi();
    if (liveVessels && liveVessels.length > 0) {
        return liveVessels;
    }

    // 강제 새로고침 실패 시 Firestore 폴백
    try {
        const snap = await db.collection("hjnc_schedules").doc(docKey).get();
        if (snap.exists) {
            const data = snap.data() || {};
            if (typeof data.vesselsJson === "string") {
                vessels = JSON.parse(data.vesselsJson);
            } else if (Array.isArray(data.vessels)) {
                vessels = data.vessels;
            }
            if (vessels.length > 0) hjncScheduleMonthCache[cacheKey] = vessels;
        }
    } catch (e) {
        reportFailure("선석 스케줄 폴백", e);
    }

    return vessels;
}
async function refreshHjncScheduleForSelectedDate() {
    const dateStr = getWorklogScheduleDate() || document.getElementById("dailyLogForm")?.getAttribute("data-date");
    if (!dateStr) return;
    const yearMonth = dateStr.slice(0, 7);
    const cacheKey = `${selectedScheduleTerminal}_${yearMonth}`;
    delete hjncScheduleMonthCache[cacheKey];
    const meta = getTerminalMeta(selectedScheduleTerminal);
    showToast(`🔄 ${meta.label} 선석 배정 현황을 새로고침합니다...`);
    await loadHjncScheduledShipsForDate(dateStr, true);
}
function renderHjncScheduledShipsUI(dateStr, allVessels, terminalId = selectedScheduleTerminal) {
    worklogRenderedVessels = [];
    const titleEl = document.getElementById("hjncScheduleBoxTitle");
    const listEl = document.getElementById("hjncScheduledShipList");
    if (!titleEl || !listEl || !dateStr) return;

    renderTerminalScheduleTabBar();
    const meta = getTerminalMeta(terminalId);
    const cfg = terminalQuickConfig[terminalId] || terminalQuickConfig.hjnc;
    const pickedNames = getWorklogPickedNames();
    const matched = (allVessels || []).filter(v => isVesselActiveOnDate(v, dateStr));
    const seen = new Set();
    const uniqueMatched = [];
    matched.forEach(v => {
        const name = String(v.VSL_NM || "").trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        uniqueMatched.push(v);
    });

    const sourceLine = formatScheduleSourceLine(hjncScheduleSourceInfo[`${terminalId}_${dateStr.slice(0, 7)}`]);
    titleEl.innerText = `⚓ ${dateStr} ${meta.label}\n입항·작업 선박 (${uniqueMatched.length}척) — 터치: 선택·해제 (최대 ${MAX_WORK_VESSELS}척 멀티오더)${sourceLine}`;

    if (uniqueMatched.length === 0) {
        if (!meta.live) {
            listEl.innerHTML = `<div style="display:flex; flex-direction:column; gap:5px; width:100%; background:rgba(255,255,255,0.75); padding:7px 9px; border-radius:8px; border:1px dashed #cbd5e1;">
                <span style="font-size:0.74rem; color:var(--text-main); font-weight:800;">📌 <b>${meta.label}</b> 터미널은 전용 보안·외부 뷰어 페이지로 제공됩니다.</span>
                <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                    <a href="${cfg.schedule}" target="_blank" onclick="trackAppEvent('terminals','${terminalId}')" style="background:${meta.color}; color:#fff; padding:4px 10px; border-radius:6px; font-size:0.73rem; font-weight:900; text-decoration:none;">🔗 ${meta.label} 선석 스케줄 열기 ↗</a>
                    <a href="${cfg.chart}" target="_blank" onclick="trackAppEvent('terminals','${terminalId}')" style="background:#0f172a; color:#fff; padding:4px 10px; border-radius:6px; font-size:0.73rem; font-weight:900; text-decoration:none;">📊 선석 차트 열기 ↗</a>
                    <button type="button" onclick="applyQuickShipChip('[${meta.badge}] ')" style="background:#ffffff; color:${meta.color}; border:1.5px solid ${meta.color}; padding:3px 9px; border-radius:6px; font-size:0.72rem; font-weight:900; cursor:pointer;">✏️ [${meta.badge}] 머리말 입력</button>
                </div>
            </div>`;
            return;
        }
        listEl.innerHTML = `<div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px; width:100%;">
            <span style="font-size:0.74rem; color:var(--text-sub); font-weight:700;">해당 날짜(${dateStr})에 조회된 ${meta.label} 입항·접안 선박이 없습니다.</span>
            <a href="${cfg.schedule}" target="_blank" class="term-sched-source-link" onclick="trackAppEvent('terminals','${terminalId}')" style="background:${meta.color}; color:#fff; padding:3px 8px; border-radius:6px; font-size:0.7rem; font-weight:800; text-decoration:none;">🔗 ${meta.label} 스케줄 원본 열기 ↗</a>
        </div>`;
        return;
    }

    worklogRenderedVessels = uniqueMatched.map(v => ({
        name: String(v.VSL_NM || "").trim(),
        vessel: v,
        dateStr,
        terminalId
    }));
    // 이미 선택된 선박은 최신 스케줄 시각으로 갱신해 두어야 작업 내용 계산에 반영된다.
    worklogRenderedVessels.forEach(item => {
        const key = normalizeWorklogShipKey(item.name);
        if (pickedNames.includes(key)) {
            worklogVesselMeta.set(key, { name: item.name, vessel: item.vessel, date: dateStr, terminalId });
        }
    });

    listEl.innerHTML = uniqueMatched.map((v, index) => {
        const name = String(v.VSL_NM || "").trim();
        const safeName = escapeShipCommentHtml(name);
        const berth = escapeShipCommentHtml(v.BERTH_NO || "-");
        const ptnr = escapeShipCommentHtml(v.PTNR_CODE || "");
        const arrDate = extractDatePrefix(v.ATA || v.ETB);
        const arrTime = extractShortTime(v.ATA || v.ETB);
        const depTime = extractShortTime(v.ATD);
        const timeBadge = arrDate === dateStr && arrTime
            ? `입항 ${arrTime}`
            : (depTime ? `~출항 ${depTime}` : "작업 중");
        const pickedIndex = pickedNames.indexOf(normalizeWorklogShipKey(name));
        const isSelected = pickedIndex >= 0;
        const selectedStyle = isSelected ? `background:${meta.color}; color:#ffffff; border-color:${meta.color};` : "";
        const timeStyle = isSelected ? "color:#ffedd5;" : "";
        const orderBadge = isSelected ? `[${pickedIndex + 1}선박] ` : "";
        return `<button type="button" class="hjnc-ship-chip${isSelected ? " is-picked" : ""}" style="${selectedStyle}" aria-pressed="${isSelected}" onclick="toggleWorklogVesselPick(${index})">
            <span class="hjnc-berth-tag" style="${isSelected ? `background:#ffffff; color:${meta.color};` : `background:${meta.color}; color:#ffffff;`}">${berth}</span>
            <span>🚢 ${orderBadge}${safeName}</span>
            ${ptnr ? `<span style="font-size:0.66rem; color:${isSelected ? '#fed7aa' : '#64748b'}; font-weight:800;">(${ptnr})</span>` : ""}
            <span class="hjnc-time-tag" style="${timeStyle}">${timeBadge}</span>
        </button>`;
    }).join("");
    updateWorklogDoubleOrderStatus();
}
async function loadHjncScheduledShipsForDate(dateStr, forceRefresh = false) {
    const titleEl = document.getElementById("hjncScheduleBoxTitle");
    const listEl = document.getElementById("hjncScheduledShipList");
    if (!titleEl || !listEl || !dateStr) return;

    renderTerminalScheduleTabBar();
    const tid = selectedScheduleTerminal;
    const meta = getTerminalMeta(tid);
    const yearMonth = dateStr.slice(0, 7);

    if (!meta.live) {
        renderHjncScheduledShipsUI(dateStr, [], tid);
        return;
    }

    titleEl.innerText = `⚓ ${dateStr} ${meta.label}\n입항·접안 예정 선박 조회 중...`;
    listEl.innerHTML = `<span style="font-size:0.74rem; color:var(--text-sub); font-weight:700;">${meta.label} 선석 배정 현황 데이터를 불러오는 중입니다...</span>`;

    const allVessels = await fetchHjncScheduleForMonth(yearMonth, forceRefresh, tid);
    const currentSelected = getWorklogScheduleDate();
    if ((currentSelected && currentSelected !== dateStr) || selectedScheduleTerminal !== tid) return;

    renderHjncScheduledShipsUI(dateStr, allVessels, tid);
}
const HANJIN_COWORKER_ROSTER = [
    // 상단 좌측 (5명)
    { code: "1509", name: "천태운", group: "top" },
    { code: "1542", name: "김성철", group: "top" },
    { code: "1703", name: "최경용", group: "top" },
    { code: "1674", name: "김찬일", group: "top" },
    { code: "1702", name: "박환태", group: "top" },
    // 상단 우측 (5명)
    { code: "1621", name: "황인섭", group: "top" },
    { code: "1644", name: "박재경", group: "top" },
    { code: "1546", name: "박홍근", group: "top" },
    { code: "1558", name: "임정윤", group: "top" },
    { code: "1515", name: "김민재", group: "top" },
    // 하단 좌측 (1~51, 51명)
    { code: "1570", name: "원지현", group: "left" },
    { code: "1651", name: "이종림", group: "left" },
    { code: "1596", name: "최정한", group: "left" },
    { code: "1519", name: "신승호", group: "left" },
    { code: "1517", name: "박상원", group: "left" },
    { code: "1514", name: "김영수3", group: "left" },
    { code: "1525", name: "이경덕", group: "left" },
    { code: "1573", name: "이성", group: "left" },
    { code: "1572", name: "변근식", group: "left" },
    { code: "1577", name: "김성원", group: "left" },
    { code: "1522", name: "오규환", group: "left" },
    { code: "1532", name: "정영중", group: "left" },
    { code: "1549", name: "양기택", group: "left" },
    { code: "1543", name: "이재열", group: "left" },
    { code: "1547", name: "박상준", group: "left" },
    { code: "1548", name: "장영근", group: "left" },
    { code: "1556", name: "최동일", group: "left" },
    { code: "1552", name: "이부원", group: "left" },
    { code: "1557", name: "강남오", group: "left" },
    { code: "1562", name: "서창우", group: "left" },
    { code: "1608", name: "신경호", group: "left" },
    { code: "1591", name: "최준호", group: "left" },
    { code: "1593", name: "남영우", group: "left" },
    { code: "1609", name: "백상훈", group: "left" },
    { code: "1590", name: "오경환", group: "left" },
    { code: "1626", name: "이승환2", group: "left" },
    { code: "1602", name: "김경민1", group: "left" },
    { code: "1606", name: "강무성", group: "left" },
    { code: "1607", name: "이준필", group: "left" },
    { code: "1613", name: "박세훈", group: "left" },
    { code: "1640", name: "김명준", group: "left" },
    { code: "1648", name: "김치성", group: "left" },
    { code: "1647", name: "노익곤", group: "left" },
    { code: "1658", name: "박규태", group: "left" },
    { code: "1659", name: "김봉준", group: "left" },
    { code: "1667", name: "김성연", group: "left" },
    { code: "1666", name: "곽민석", group: "left" },
    { code: "1675", name: "김동근", group: "left" },
    { code: "1680", name: "김광명", group: "left" },
    { code: "1685", name: "박진우", group: "left" },
    { code: "1682", name: "정진희", group: "left" },
    { code: "1699", name: "임종호", group: "left" },
    { code: "1696", name: "김근우", group: "left" },
    { code: "1698", name: "조훈철", group: "left" },
    { code: "1704", name: "전상진", group: "left" },
    { code: "1705", name: "백승윤", group: "left" },
    { code: "1706", name: "이수남", group: "left" },
    { code: "1707", name: "김단우", group: "left" },
    { code: "1708", name: "최승훈", group: "left" },
    { code: "1710", name: "김민재2", group: "left" },
    { code: "1711", name: "김근우1", group: "left" },
    // 하단 우측 (1~48, 48명)
    { code: "1575", name: "최정열", group: "right" },
    { code: "1587", name: "윤일언", group: "right" },
    { code: "1527", name: "이봉호", group: "right" },
    { code: "1531", name: "김영민1", group: "right" },
    { code: "1554", name: "김영구", group: "right" },
    { code: "1610", name: "김경찬", group: "right" },
    { code: "1600", name: "최병섭", group: "right" },
    { code: "1642", name: "박창훈", group: "right" },
    { code: "1604", name: "오세민", group: "right" },
    { code: "1614", name: "설석종", group: "right" },
    { code: "1635", name: "허영구", group: "right" },
    { code: "1615", name: "박성용", group: "right" },
    { code: "1616", name: "강진명", group: "right" },
    { code: "1653", name: "이성현", group: "right" },
    { code: "1627", name: "신철구", group: "right" },
    { code: "1636", name: "황인기", group: "right" },
    { code: "1637", name: "구자성", group: "right" },
    { code: "1639", name: "사승동", group: "right" },
    { code: "1646", name: "최영용", group: "right" },
    { code: "1649", name: "노경민", group: "right" },
    { code: "1656", name: "김정희", group: "right" },
    { code: "1661", name: "이춘학", group: "right" },
    { code: "1650", name: "윤상건", group: "right" },
    { code: "1662", name: "이정식", group: "right" },
    { code: "1655", name: "김찬우1", group: "right" },
    { code: "1664", name: "정현철", group: "right" },
    { code: "1665", name: "김영현", group: "right" },
    { code: "1687", name: "고덕화", group: "right" },
    { code: "1683", name: "윤승주", group: "right" },
    { code: "1691", name: "김종성", group: "right" },
    { code: "1686", name: "강성빈", group: "right" },
    { code: "1652", name: "박현대", group: "right" },
    { code: "1693", name: "유동석", group: "right" },
    { code: "1694", name: "김유신1", group: "right" },
    { code: "1695", name: "김찬구", group: "right" },
    { code: "1668", name: "이수열", group: "right" },
    { code: "1697", name: "성민근", group: "right" },
    { code: "1586", name: "안영준", group: "right" },
    { code: "1641", name: "오용구", group: "right" },
    { code: "1709", name: "이재호", group: "right" },
    { code: "9533", name: "정철화", group: "right" },
    { code: "9534", name: "여상규", group: "right" },
    { code: "9535", name: "하승환", group: "right" },
    { code: "9536", name: "이준수", group: "right" },
    { code: "9537", name: "윤동환", group: "right" },
    { code: "9538", name: "이현재", group: "right" },
    { code: "9539", name: "김창홍", group: "right" },
    { code: "9540", name: "이재원", group: "right" }
];
const HANGUL_CHO_LIST = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function getHangulChosung(str) {
    return Array.from(String(str || "")).map(ch => {
        const code = ch.charCodeAt(0) - 0xAC00;
        if (code >= 0 && code <= 11171) {
            return HANGUL_CHO_LIST[Math.floor(code / 588)] || ch;
        }
        return ch;
    }).join("");
}
let selectedCoworkerFilter = "all";
function getSelectedCoworkerList() {
    const raw = (document.getElementById("logCoworkers")?.value || "").trim();
    if (!raw) return [];
    return raw.split(/[,]+/).map(s => s.trim()).filter(Boolean);
}
function toggleCoworkerRosterPanel(forceOpen) {
    if (!isWorkLogUnlocked) {
        openWorkLogPinModal(() => toggleCoworkerRosterPanel(true));
        return;
    }
    const panel = document.getElementById("coworkerRosterPanel");
    if (!panel) return;
    const willOpen = typeof forceOpen === "boolean" ? forceOpen : panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !willOpen);
    renderWorkLogQuickChips();
    if (willOpen) {
        renderCoworkerFilterBar();
        renderCoworkerRosterGrid();
    }
}
function selectCoworkerFilter(filterKey) {
    selectedCoworkerFilter = filterKey;
    renderCoworkerFilterBar();
    renderCoworkerRosterGrid();
}
function resetCoworkerRosterFilter() {
    selectedCoworkerFilter = "all";
    const searchEl = document.getElementById("coworkerSearchInput");
    if (searchEl) searchEl.value = "";
    renderCoworkerFilterBar();
    renderCoworkerRosterGrid();
}
function clearSelectedCoworkers() {
    const input = document.getElementById("logCoworkers");
    if (!input) return;
    input.value = "";
    syncCoworkerSelectionUI();
    showToast("👥 근무자 입력란을 비웠습니다.");
}
function renderCoworkerFilterBar() {
    const bar = document.getElementById("coworkerFilterBar");
    if (!bar) return;
    const tabs = [
        { key: "all", label: `전체 (${HANJIN_COWORKER_ROSTER.length})` },
        { key: "top", label: "상단 (10)" },
        { key: "left", label: "좌측 (51)" },
        { key: "right", label: "우측 (48)" },
        { key: "ㄱ", label: "ㄱ" },
        { key: "ㄴ", label: "ㄴ" },
        { key: "ㅂ", label: "ㅂ" },
        { key: "ㅅ", label: "ㅅ" },
        { key: "ㅇ", label: "ㅇ" },
        { key: "ㅈ", label: "ㅈ" },
        { key: "ㅊ", label: "ㅊ" },
        { key: "ㅎ", label: "ㅎ" },
        { key: "etc", label: "기타" }
    ];
    bar.innerHTML = tabs.map(t => {
        const active = selectedCoworkerFilter === t.key ? "active" : "";
        return `<button type="button" class="coworker-filter-tab ${active}" onclick="selectCoworkerFilter('${t.key}')">${t.label}</button>`;
    }).join("");
}
function renderCoworkerRosterGrid() {
    const grid = document.getElementById("coworkerRosterGrid");
    if (!grid) return;
    const query = (document.getElementById("coworkerSearchInput")?.value || "").trim();
    const selectedList = getSelectedCoworkerList();
    const mainChoSet = new Set(["ㄱ","ㄴ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅎ"]);

    const filtered = HANJIN_COWORKER_ROSTER.filter(item => {
        if (query) {
            const cho = getHangulChosung(item.name);
            if (!item.name.includes(query) && !item.code.includes(query) && !cho.includes(query)) {
                return false;
            }
        }
        if (selectedCoworkerFilter === "all") return true;
        if (["top", "left", "right"].includes(selectedCoworkerFilter)) {
            return item.group === selectedCoworkerFilter;
        }
        const firstCho = getHangulChosung(item.name.charAt(0));
        if (selectedCoworkerFilter === "etc") {
            return !mainChoSet.has(firstCho);
        }
        return firstCho === selectedCoworkerFilter;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:14px 6px; font-size:0.78rem; color:var(--text-sub); font-weight:700;">검색 조건에 맞는 인원이 없습니다.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(item => {
        const isSelected = selectedList.includes(item.name);
        const safeName = escapeShipCommentHtml(item.name);
        const jsSafeName = item.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        return `<button type="button" class="coworker-member-btn ${isSelected ? 'selected' : ''}" onclick="applyQuickCoworkerChip('${jsSafeName}')">
            <span>${isSelected ? '✓ ' : '+ '}${safeName}</span>
            <span class="coworker-member-code">${item.code}</span>
        </button>`;
    }).join("");
}
function syncCoworkerSelectionUI() {
    renderWorkLogQuickChips();
    const panel = document.getElementById("coworkerRosterPanel");
    if (panel && !panel.classList.contains("hidden")) {
        renderCoworkerRosterGrid();
    }
}
function renderWorkLogQuickChips(dateStr) {
    const targetDate = getWorklogScheduleDate() || dateStr || document.getElementById("dailyLogForm")?.getAttribute("data-date") || "";
    if (targetDate) {
        loadHjncScheduledShipsForDate(targetDate);
    }
    const cwRow = document.getElementById("quickCoworkerChipRow");
    if (!cwRow) return;

    const cwFreq = {};
    Object.values(adminWorkLogs || {}).forEach(log => {
        if (!log) return;
        const cw = (log.coworkers || "").trim();
        if (cw) {
            cw.split(/[,/\s]+/).map(x => x.trim()).filter(Boolean).forEach(name => {
                if (name === "개굴") return;
                cwFreq[name] = (cwFreq[name] || 0) + 2;
            });
        }
    });
    ["재경", "성철"].forEach(name => {
        if (!cwFreq[name]) cwFreq[name] = 1;
    });
    delete cwFreq["개굴"];

    const topCws = Object.entries(cwFreq).sort((a, b) => b[1] - a[1]).slice(0, 7).map(x => x[0]);
    const selectedList = getSelectedCoworkerList();
    const panelOpen = !document.getElementById("coworkerRosterPanel")?.classList.contains("hidden");

    cwRow.innerHTML =
        `<span style="font-size:0.72rem; color:var(--text-sub); font-weight:800; align-self:center; margin-right:2px;">👥 동료 추가:</span>` +
        topCws.map(name => {
            const safe = escapeShipCommentHtml(name);
            const jsSafe = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            const isSel = selectedList.includes(name);
            return `<button type="button" class="quick-chip-btn ${isSel ? 'selected' : ''}" onclick="applyQuickCoworkerChip('${jsSafe}')">${isSel ? '✓' : '+'} ${safe}</button>`;
        }).join("") +
        `<button type="button" class="quick-chip-btn" style="background:${panelOpen ? 'var(--primary)' : '#eff6ff'}; color:${panelOpen ? '#ffffff' : '#1d4ed8'}; border-color:#60a5fa; font-weight:900;" onclick="toggleCoworkerRosterPanel()">📋 작업자 선택 (${HANJIN_COWORKER_ROSTER.length}명) ${panelOpen ? '▲' : '▼'}</button>`;
}
/* ===== 근무일지: 입·출항 선박 달력 조회 · 멀티오더(2~4척) 선택 · 작업 내용 자동 입력 ===== */
function getWorklogScheduleDate() {
    return document.getElementById("worklogScheduleDatePicker")?.value || "";
}
function setWorklogScheduleDateInput(dateStr) {
    const normalized = String(dateStr || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
    const input = document.getElementById("worklogScheduleDatePicker");
    if (input) input.value = normalized;
    return true;
}
function openWorklogScheduleDatePicker() {
    const input = document.getElementById("worklogScheduleDatePicker");
    if (!input) return;
    if (!input.value) {
        input.value = document.getElementById("dailyLogForm")?.getAttribute("data-date") || getAppLocalDateString();
    }
    if (typeof input.showPicker === "function") {
        try { input.showPicker(); } catch (e) {}
    }
}
function onWorklogScheduleDateChange(dateStr) {
    if (!setWorklogScheduleDateInput(dateStr)) return;
    showToast(`📅 ${dateStr} 입·출항 선박 스케줄을 조회합니다.`);
    loadHjncScheduledShipsForDate(dateStr, false);
}
function shiftWorklogScheduleDate(delta) {
    const base = getWorklogScheduleDate()
        || document.getElementById("dailyLogForm")?.getAttribute("data-date")
        || getAppLocalDateString();
    const [y, m, d] = base.split("-").map(Number);
    const nextStr = new Date(Date.UTC(y, m - 1, d + (Number(delta) || 0))).toISOString().slice(0, 10);
    setWorklogScheduleDateInput(nextStr);
    loadHjncScheduledShipsForDate(nextStr, false);
}
function parseWorklogShipNames(value) {
    return String(value || "").split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
}
// 비교용 선박명: "[HJNC] " 같은 터미널 머리말을 떼고 대문자로 맞춘다.
function normalizeWorklogShipKey(name) {
    return String(name || "").trim().replace(/^\[[^\]]+\]\s*/, "").trim().toUpperCase();
}
function getWorklogPickedNames() {
    return parseWorklogShipNames(document.getElementById("logShipName")?.value).map(normalizeWorklogShipKey);
}
/**
 * 근무일지 임금3·임금4 입력칸 노출 제어.
 * 기본은 임금1·임금2만 보이고, 선박을 3~4척 선택하면 임금3·임금4가 나타납니다.
 * 이미 값이 들어 있는 슬롯은 선박 수와 무관하게 계속 보여 줍니다(값 분실 방지).
 */
function syncWorklogWageSlotVisibility(vesselCount) {
    const row = document.getElementById("worklogWageExtraRow");
    const hint = document.getElementById("worklogWageSlotHint");
    if (!row) return 2;
    const count = Math.max(0, Math.min(MAX_WORK_VESSELS, Number(vesselCount) || 0));
    const hasWage3 = Boolean(String(document.getElementById("logWage3")?.value || "").trim());
    const hasWage4 = Boolean(String(document.getElementById("logWage4")?.value || "").trim());
    const show = count >= 3 || hasWage3 || hasWage4;
    if (row.classList) row.classList.toggle("is-slot-hidden", !show);
    if (hint && hint.classList) {
        hint.classList.toggle("is-slot-hidden", !show);
        if (show) {
            hint.textContent = count >= 3
                ? `🚢 ${getMultiOrderLabel(count)}(${count}척) 작업 · 임금1~임금${Math.max(count, hasWage4 ? 4 : 3)}을 선박별로 입력하세요.`
                : "🚢 임금3·임금4에 입력된 금액이 있어 계속 표시합니다. 비우면 다시 숨겨집니다.";
        }
    }
    return show ? MAX_WORK_VESSELS : 2;
}

function refreshWorklogVesselList() {
    const dateStr = getWorklogScheduleDate();
    if (!dateStr) return;
    const cached = hjncScheduleMonthCache[`${selectedScheduleTerminal}_${dateStr.slice(0, 7)}`];
    if (cached) renderHjncScheduledShipsUI(dateStr, cached, selectedScheduleTerminal);
    else updateWorklogDoubleOrderStatus();
}
function resolveWorklogVesselMeta(name) {
    const key = normalizeWorklogShipKey(name);
    if (!key) return null;
    if (worklogVesselMeta.has(key)) return worklogVesselMeta.get(key);
    // 목록에서 고르지 않고 이름을 직접 입력한 경우, 현재 조회 날짜의 스케줄에서 시각을 찾는다.
    const dateStr = getWorklogScheduleDate();
    const cached = dateStr ? hjncScheduleMonthCache[`${selectedScheduleTerminal}_${dateStr.slice(0, 7)}`] : null;
    const found = (cached || []).find(v => normalizeWorklogShipKey(v?.VSL_NM) === key);
    if (!found) return null;
    const meta = { name: String(found.VSL_NM).trim(), vessel: found, date: dateStr, terminalId: selectedScheduleTerminal };
    worklogVesselMeta.set(key, meta);
    return meta;
}
function buildWorklogDoubleOrderBlock(names) {
    const circled = VESSEL_ORDER_MARKS;
    const items = names.slice(0, MAX_WORK_VESSELS).map(name => {
        const meta = resolveWorklogVesselMeta(name);
        return { name, period: meta ? getSelectedVesselPeriod(meta.vessel, meta.date) : null };
    });
    const allHours = items.every(item => item.period && item.period.hours > 0);
    const totalHours = allHours ? items.reduce((sum, item) => sum + item.period.hours, 0) : 0;
    const header = `🚢 ${getMultiOrderLabel(items.length)} 작업 (선박 ${items.length}척${totalHours > 0 ? ` · 합계 ${totalHours}H` : ""})`;
    const lines = items.map((item, index) => {
        if (!item.period) return `${circled[index]} ${item.name} · 입·출항 시각 확인 필요`;
        const arrival = formatWageScheduleEvent(item.period.arrival);
        const departure = formatWageScheduleEvent(item.period.departure);
        const hoursLabel = item.period.hours > 0 ? `${item.period.hours}H` : "시간 확인 필요";
        return `${circled[index]} ${item.name} · 입항 ${arrival} → 출항 ${departure} · ${hoursLabel}`;
    });
    return [header, ...lines].join("\n");
}
// 배 이름이 2~4척이면 작업 내용 맨 위에 멀티오더(더블·트리플·쿼드) 블록을 넣고, 아니면 기존 블록만 제거한다.
// 사용자가 직접 쓴 작업 내용은 그대로 둔다.
function syncWorklogDoubleOrderMemo() {
    const memo = document.getElementById("logMemo");
    if (!memo) return;
    const names = parseWorklogShipNames(document.getElementById("logShipName")?.value);
    const original = memo.value;
    const withoutBlock = original.replace(WORKLOG_DOUBLE_BLOCK_RE, "");
    let nextValue = withoutBlock;
    if (names.length >= 2 && names.length <= MAX_WORK_VESSELS) {
        const block = buildWorklogDoubleOrderBlock(names);
        const rest = withoutBlock.replace(/^\n+/, "");
        nextValue = rest ? `${block}\n\n${rest}` : block;
    } else if (withoutBlock !== original) {
        nextValue = withoutBlock.replace(/^\n+/, "");
    }
    if (nextValue === original) return;
    memo.value = nextValue;
    autoGrowWorkLogMemo(memo);
}
function updateWorklogDoubleOrderStatus() {
    const el = document.getElementById("worklogDoubleOrderStatus");
    if (!el) return;
    const names = parseWorklogShipNames(document.getElementById("logShipName")?.value);
    let text;
    if (names.length === 0) {
        text = `🔀 멀티오더: 입·출항 선박을 2~${MAX_WORK_VESSELS}척 선택하면 작업 내용에 입·출항 시각과 근무시간이 자동 입력됩니다.`;
    } else if (names.length === 1) {
        text = `🔀 더블오더 선택 1/2 · ${names[0]} · 한 척 더 선택해 주세요.`;
    } else if (names.length <= MAX_WORK_VESSELS) {
        text = `🔀 ${getMultiOrderLabel(names.length)} 선택 ${names.length}/${names.length} · ${names.join(" · ")} · 작업 내용 자동 입력됨`;
    } else {
        text = `⚠️ 선박은 최대 ${MAX_WORK_VESSELS}척까지 입력할 수 있습니다. 배 이름을 ${MAX_WORK_VESSELS}척 이하로 줄여 주세요.`;
    }
    el.textContent = text;
    el.classList.toggle("is-full", names.length >= 2 && names.length <= MAX_WORK_VESSELS);
    syncWorklogWageSlotVisibility(names.length);
}
function toggleWorklogVesselPick(index) {
    const item = worklogRenderedVessels[index];
    const input = document.getElementById("logShipName");
    if (!item || !input) return;
    const names = parseWorklogShipNames(input.value);
    const key = normalizeWorklogShipKey(item.name);
    const pos = names.findIndex(n => normalizeWorklogShipKey(n) === key);
    if (pos >= 0) {
        names.splice(pos, 1);
        input.value = names.join(" / ");
        syncWorklogDoubleOrderMemo();
        refreshWorklogVesselList();
        showToast(`🚢 ${item.name} 선택을 해제했습니다.`);
        return;
    }
    if (names.length >= MAX_WORK_VESSELS) {
        showToast(`⚠️ 멀티오더는 선박 ${MAX_WORK_VESSELS}척까지만 선택할 수 있습니다. 먼저 선택된 선박을 다시 눌러 해제해 주세요.`);
        return;
    }
    names.push(item.name);
    worklogVesselMeta.set(key, { name: item.name, vessel: item.vessel, date: item.dateStr, terminalId: item.terminalId });
    input.value = names.join(" / ");
    syncWorklogDoubleOrderMemo();
    refreshWorklogVesselList();
    if (names.length >= 2) {
        showToast(`🔀 ${getMultiOrderLabel(names.length)} ${names.length}척 선택 완료 (${names.join(" / ")}) · 작업 내용을 자동 입력했습니다.`);
    } else {
        showToast(`🚢 ${item.name} 선택 · 한 척 더 선택하면 더블오더 작업 내용이 자동 입력됩니다.`);
    }
}
function onWorklogShipNameEdited() {
    const names = parseWorklogShipNames(document.getElementById("logShipName")?.value);
    if (names.length > MAX_WORK_VESSELS) showToast(`⚠️ 선박은 최대 ${MAX_WORK_VESSELS}척까지 입력할 수 있습니다.`);
    syncWorklogDoubleOrderMemo();
    refreshWorklogVesselList();
    // 스케줄 캐시가 없어 목록을 다시 그리지 못해도 임금 3·4 칸 상태는 항상 맞춰 둡니다.
    updateWorklogDoubleOrderStatus();
}
function applyQuickShipChip(shipName, berthNo = "", ptnrCode = "", termBadge = "") {
    const input = document.getElementById("logShipName");
    if (!input) return;
    input.value = shipName;
    if (shipName.endsWith(" ")) input.focus();
    const curDate = getWorklogScheduleDate() || document.getElementById("dailyLogForm")?.getAttribute("data-date");
    if (curDate) {
        const ym = curDate.slice(0, 7);
        const cacheKey = `${selectedScheduleTerminal}_${ym}`;
        if (hjncScheduleMonthCache[cacheKey]) {
            renderHjncScheduledShipsUI(curDate, hjncScheduleMonthCache[cacheKey], selectedScheduleTerminal);
        }
    }
    const termPrefix = termBadge ? `[${termBadge}] ` : "";
    const extraInfo = berthNo ? ` (${berthNo}선석${ptnrCode ? ' · ' + ptnrCode : ''})` : "";
    showToast(`🚢 ${termPrefix}'${shipName.trim()}'${extraInfo} 선박명이 입력되었습니다.`);
}
function applyQuickCoworkerChip(workerName) {
    if (!isWorkLogUnlocked) {
        openWorkLogPinModal(() => applyQuickCoworkerChip(workerName));
        return;
    }
    const input = document.getElementById("logCoworkers");
    if (!input) return;
    const current = input.value.trim();
    if (!current) {
        input.value = workerName;
    } else {
        const list = current.split(/[,]+/).map(s => s.trim()).filter(Boolean);
        const idx = list.indexOf(workerName);
        if (idx >= 0) {
            list.splice(idx, 1);
            input.value = list.join(", ");
        } else {
            list.push(workerName);
            input.value = list.join(", ");
        }
    }
    syncCoworkerSelectionUI();
}
let lastWeatherFetchedAt = 0;
async function fetchBusanPortLiveWeather(force = false) {
    if (!force && Date.now() - lastWeatherFetchedAt < 5 * 60 * 1000) return;
    const ports = [
        { key: "NewPort", lat: 35.077, lon: 128.828 },
        { key: "NorthPort", lat: 35.104, lon: 129.042 }
    ];
    try {
        await Promise.all(ports.map(async p => {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=Asia%2FSeoul`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("기상 응답 오류");
            const json = await res.json();
            const cur = json.current || {};
            const temp = typeof cur.temperature_2m === "number" ? `${cur.temperature_2m.toFixed(1)}℃` : "-";
            const wind = typeof cur.wind_speed_10m === "number" ? cur.wind_speed_10m.toFixed(1) : "0.0";
            const gust = typeof cur.wind_gusts_10m === "number" ? cur.wind_gusts_10m.toFixed(1) : wind;
            const rain = typeof cur.precipitation === "number" ? cur.precipitation.toFixed(1) : "0.0";
            const maxW = Math.max(parseFloat(wind) || 0, parseFloat(gust) || 0);

            const tempEl = document.getElementById(`weather${p.key}Temp`);
            const windEl = document.getElementById(`weather${p.key}Wind`);
            const badgeEl = document.getElementById(`weather${p.key}Badge`);
            if (tempEl) tempEl.innerText = `🌡️ ${temp}`;
            if (windEl) windEl.innerText = `💨 풍속 ${wind}m/s (순간 ${gust}) · ☔ ${rain}mm`;
            if (badgeEl) {
                if (maxW >= 15) {
                    badgeEl.innerText = "🔴 고소 작업 통제 기준 (15m/s↑)";
                    badgeEl.style.background = "rgba(239,68,68,0.3)";
                    badgeEl.style.color = "#fca5a5";
                } else if (maxW >= 10 || parseFloat(rain) >= 5) {
                    badgeEl.innerText = "🟠 강풍·우천 주의 작업";
                    badgeEl.style.background = "rgba(245,158,11,0.3)";
                    badgeEl.style.color = "#fde68a";
                } else {
                    badgeEl.innerText = "🟢 정상 작업 가능 (양호)";
                    badgeEl.style.background = "rgba(16,185,129,0.25)";
                    badgeEl.style.color = "#6ee7b7";
                }
            }
        }));
        lastWeatherFetchedAt = Date.now();
        const now = new Date();
        const timeEl = document.getElementById("weatherUpdatedTimeText");
        if (timeEl) {
            timeEl.innerText = `실시간 관측 갱신: ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} · 기준: 10m/s 강풍 주의 / 15m/s 고소 작업 통제`;
        }
        if (force) showToast("🌬️ 부산항 신항·북항 실시간 기상 정보가 갱신되었습니다.");
    } catch (e) {
        const weatherTimeEl = document.getElementById("weatherUpdatedTimeText");
        if (weatherTimeEl) weatherTimeEl.innerText = "⚠️ 실시간 기상 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.";
        reportFailure("실시간 기상", e, "⚠️ 부산항 실시간 기상 정보를 불러오지 못했습니다.");
    }
}
function generateReceiptCanvas(mode) {
    const canvas = document.createElement("canvas");
    const width = 680;
    let lines = [];
    let title = "";
    let subTitle = "";
    let highlightTotal = "";

    if (mode === "wage") {
        title = lastCalculatedWageData?.isDoubleOrder
            ? "🧾 부산항 더블오더 임금 2 명세서"
            : "🧾 부산항 임금 산정 명세서";
        if (lastCalculatedWageData?.isDoubleOrder) {
            lines.push({ label: "🚢 더블오더 선박", value: lastCalculatedWageData.shipName || "미입력" });
        }
        const sd = document.getElementById("wageStartDate")?.value || "-";
        const ed = document.getElementById("wageEndDate")?.value || "-";
        subTitle = `근무 일자: ${sd} ~ ${ed}`;
        document.querySelectorAll("#wageSpecBody tr").forEach(tr => {
            const tds = tr.querySelectorAll("td");
            if (tds.length === 2) {
                lines.push({ label: tds[0].innerText.trim(), value: tds[1].innerText.trim() });
            }
        });
        highlightTotal = `예상 실수령액: ${document.getElementById("wageTotal")?.innerText || "0원"}`;
    } else {
        const monthTitle = document.getElementById("calMonthYear")?.innerText || "이번 달";
        title = `🧾 ${monthTitle} 근무일지 정산 요약표`;
        subTitle = `근로자: ${currentWorkerId || "내 저장소"} · 발급일: ${new Date().toISOString().split("T")[0]}`;
        lines.push({ label: "🗓️ 총 출근일수", value: `${latestMonthlyStatsCache.days}일` });
        lines.push({ label: "📈 일평균 수입", value: `${latestMonthlyStatsCache.avg.toLocaleString()}원` });
        lines.push({ label: "💵 임금 1 합계", value: `${latestMonthlyStatsCache.w1Sum.toLocaleString()}원` });
        lines.push({ label: "💴 임금 2 합계", value: `${latestMonthlyStatsCache.w2Sum.toLocaleString()}원` });
        // 임금 3·4 는 트리플·쿼드오더 작업이 있는 달에만 표에 추가합니다.
        if (Number(latestMonthlyStatsCache.w3Sum) > 0) lines.push({ label: "💶 임금 3 합계", value: `${Number(latestMonthlyStatsCache.w3Sum).toLocaleString()}원` });
        if (Number(latestMonthlyStatsCache.w4Sum) > 0) lines.push({ label: "💷 임금 4 합계", value: `${Number(latestMonthlyStatsCache.w4Sum).toLocaleString()}원` });
        const goal = Math.max(100000, Number(monthlyGoalAmount) || 4500000);
        const pct = Math.round((latestMonthlyStatsCache.total / goal) * 100);
        lines.push({ label: "🎯 월 목표 달성률", value: `${pct}% (목표 ${(goal/10000).toFixed(0)}만 원)` });
        if (typeof extractWorkLogTimeAndWageMetrics === "function" && typeof aggregateWorkTimeMetrics === "function") {
            const wtMonth = aggregateWorkTimeMetrics(Object.values(adminWorkLogs || {}));
            if (wtMonth.totalHours > 0) {
                lines.push({ label: "⏱️ 총 작업시간", value: `${wtMonth.totalHours}H (일평균 ${wtMonth.days > 0 ? (wtMonth.totalHours / wtMonth.days).toFixed(1) : 0}H)` });
                lines.push({ label: "☀️ 주간 시간 / 책정", value: `${wtMonth.dayHours}H · ${wtMonth.dayAmt.toLocaleString()}원` });
                lines.push({ label: "🌙 야간 시간 / 책정", value: `${wtMonth.nightHours}H · ${wtMonth.nightAmt.toLocaleString()}원` });
                lines.push({ label: "🗓️ 주말·공휴일 / 수당", value: `${wtMonth.weekendHours}H · ${wtMonth.weekendAmt.toLocaleString()}원` });
                if ((wtMonth.extraAmt + wtMonth.skilledAmt) > 0) lines.push({ label: "🔧 기능공·기타 가산", value: `${(wtMonth.extraAmt + wtMonth.skilledAmt).toLocaleString()}원` });
            }
        }
        const sortedDates = Object.keys(adminWorkLogs || {}).sort().slice(-6);
        if (sortedDates.length > 0) {
            lines.push({ label: "── 최근 근무 내역 (최대 6건) ──", value: "" });
            sortedDates.forEach(dStr => {
                const d = adminWorkLogs[dStr];
                if (d) {
                    lines.push({
                        label: `${dStr.slice(5)} · ${d.shipName || "선박 미입력"}`,
                        value: `${(Number(d.totalPay) || 0).toLocaleString()}원`
                    });
                }
            });
        }
        highlightTotal = `이번 달 총수입: ${latestMonthlyStatsCache.total.toLocaleString()}원`;
    }

    const height = 250 + lines.length * 42;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#0a1b3f";
    ctx.fillRect(20, 20, width - 40, 86);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 26px sans-serif";
    ctx.fillText(title, 44, 62);
    ctx.fillStyle = "#93c5fd";
    ctx.font = "700 16px sans-serif";
    ctx.fillText(subTitle, 44, 90);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(20, 106, width - 40, height - 126);
    ctx.strokeStyle = "#0a1b3f";
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    let y = 148;
    lines.forEach(item => {
        ctx.fillStyle = "#334155";
        ctx.font = "700 18px sans-serif";
        ctx.fillText(item.label, 44, y);

        ctx.fillStyle = "#0f172a";
        ctx.font = "900 18px sans-serif";
        const valWidth = ctx.measureText(item.value).width;
        ctx.fillText(item.value, width - 44 - valWidth, y);

        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(44, y + 14);
        ctx.lineTo(width - 44, y + 14);
        ctx.stroke();
        y += 42;
    });

    ctx.fillStyle = "#eff6ff";
    ctx.fillRect(36, height - 96, width - 72, 54);
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.strokeRect(36, height - 96, width - 72, 54);

    ctx.fillStyle = "#1d4ed8";
    ctx.font = "900 22px sans-serif";
    ctx.fillText(highlightTotal, 54, height - 61);

    ctx.fillStyle = "#64748b";
    ctx.font = "700 13px sans-serif";
    ctx.fillText("BUSAN HAK PORT INFO · 스마트 정산 명세서", 44, height - 26);

    return { canvas, title, subTitle, lines, highlightTotal };
}
function saveReceiptImage(mode) {
    if (!isWorkLogUnlocked) {
        openWorkLogPinModal(() => saveReceiptImage(mode));
        return;
    }
    trackAppEvent('actions', 'receipt_share');
    const { canvas, title } = generateReceiptCanvas(mode);
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${title.replace(/[^\w가-힣]/g, "_")}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("📸 명세서 이미지가 내 기기에 저장되었습니다!");
}
async function shareReceiptCard(mode) {
    if (!isWorkLogUnlocked) {
        openWorkLogPinModal(() => shareReceiptCard(mode));
        return;
    }
    trackAppEvent('actions', 'receipt_share');
    const { canvas, title, subTitle, lines, highlightTotal } = generateReceiptCanvas(mode);
    const textSummary = [
        `[${title}]`,
        subTitle,
        ...lines.map(l => l.value ? `• ${l.label}: ${l.value}` : l.label),
        `▶ ${highlightTotal}`
    ].join("\n");

    try {
        if (navigator.canShare && canvas.toBlob) {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
            if (blob) {
                const file = new File([blob], "busan_port_receipt.png", { type: "image/png" });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({ title, text: textSummary, files: [file] });
                    return;
                }
            }
        }
        if (navigator.share) {
            await navigator.share({ title, text: textSummary });
            return;
        }
    } catch (e) {}

    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textSummary);
        showToast("📋 정산 명세서 내용이 복사되었습니다! 카카오톡 등에 붙여넣기 하세요.");
    } else {
        saveReceiptImage(mode);
    }
}
function toggleWageLayoutMode() {
    const layout = document.querySelector('#wage-card .calc-layout');
    const btn = document.getElementById('wageLayoutToggleBtn');
    if (!layout) return;
    const isWide = layout.classList.toggle('wide-mode');
    if (btn) {
        btn.innerText = isWide ? '📐 5:5 단가표 나란히 보기' : '📐 입력창 넓게 보기';
        btn.style.background = isWide ? '#dbeafe' : '#eff6ff';
    }
}
async function shareOrCopyAppPromo() {
    trackAppEvent('actions', 'promo_share');
    const promoText = [
        "🚢 [부산항 항만 근로자 필수 앱 - BUSAN HAK PORT] 🚢",
        "",
        "✅ 주·야간/기능공/수당 자동 [임금계산기]",
        "✅ 달력에 적고 한 달 총액 자동 정산되는 [근무일지]",
        "✅ 1·2·3항업 전 터미널 [스케줄·차트·베이 플랜·식단표·셔틀 시간표]",
        "✅ 배마다 어떤 콘/장비 쓰는지 미리 보는 [작업 선박 정보(등록및검색) 도감]",
        "✅ 신항·북항 실시간 풍속·날씨 및 도선 현황까지!",
        "",
        "👇 아래 주소 누르셔서 바로 써보세요!",
        "https://busan-hak-port-info.vercel.app",
        "",
        "💡 [휴대폰 바탕화면에 아이콘 만드는 법]",
        "• 갤럭시: 주소 접속 후 우측 메뉴(⋮ 또는 ≡) → [홈 화면에 추가]",
        "• 아이폰: 사파리(Safari)로 접속 후 하단 공유 버튼(📤) → [홈 화면에 추가]",
        "",
        "(운영관리자: 이춘학 / 문의: 010-2846-8906)"
    ].join("\n");
    try {
        if (navigator.share) {
            await navigator.share({
                title: "부산항 스마트 작업 가이드 (BUSAN HAK PORT)",
                text: promoText,
                url: "https://busan-hak-port-info.vercel.app"
            });
            return;
        }
    } catch (e) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(promoText);
        showToast("📋 앱 홍보글과 접속 주소가 복사되었습니다! 카톡이나 문자에 붙여넣기 하세요.");
    } else {
        const ta = document.createElement("textarea");
        ta.value = promoText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showToast("📋 앱 홍보글과 접속 주소가 복사되었습니다!");
    }
}
function updateMonthlyStatsUI(logsMap) {
    let total = 0, w1Sum = 0, w2Sum = 0, w3Sum = 0, w4Sum = 0, days = 0;
    Object.values(logsMap || {}).forEach(d => {
        if (!d) return;
        const w1 = Number(d.wage1) || 0;
        const w2 = Number(d.wage2) || 0;
        const w3 = Number(d.wage3) || 0;
        const w4 = Number(d.wage4) || 0;
        const p = Number(d.totalPay) || (w1 + w2 + w3 + w4);
        if (p > 0 || d.shipName || d.memo || d.coworkers) days++;
        total += p;
        w1Sum += w1;
        w2Sum += w2;
        w3Sum += w3;
        w4Sum += w4;
    });
    const avg = days > 0 ? Math.round(total / days) : 0;
    latestMonthlyStatsCache = { total, w1Sum, w2Sum, w3Sum, w4Sum, days, avg };
    const totalEl = document.getElementById('monthlyTotalDisplay');
    const daysEl = document.getElementById('monthlyWorkDays');
    const avgEl = document.getElementById('monthlyAvgPay');
    const splitEl = document.getElementById('monthlySplitPay');
    const logSubMeta = document.getElementById('logCardSubMeta');
    if (totalEl) totalEl.innerText = `이번 달 총액: ${total.toLocaleString()}원`;
    if (daysEl) daysEl.innerText = `${days}일`;
    if (avgEl) avgEl.innerText = `${avg.toLocaleString()}원`;
    if (splitEl) {
        const splitParts = [w1Sum, w2Sum, w3Sum, w4Sum];
        const lastUsed = Math.max(1, ...splitParts.map((v, i) => (v > 0 ? i + 1 : 0)), 2);
        splitEl.innerText = splitParts.slice(0, lastUsed).map(v => `${(v/10000).toFixed(0)}만`).join(" / ");
    }
    if (logSubMeta) {
        logSubMeta.innerText = days > 0 ? `이번 달 출근 ${days}일 · ${(total/10000).toFixed(0)}만 원` : `날짜 클릭 기록 · 월간 정산 관리`;
    }
    updateMonthlyGoalGaugeUI(total, days);
    renderWorkLogQuickChips();
}
function renderCalendar(y, m){
    const g = document.getElementById('calendarGrid');
    document.getElementById('calMonthYear').innerText = `${y}년 ${m+1}월`;
    const fD = new Date(y, m, 1).getDay(), lD = new Date(y, m+1, 0).getDate();
    const nowObj = new Date();
    const todayStr = `${nowObj.getFullYear()}-${String(nowObj.getMonth()+1).padStart(2,'0')}-${String(nowObj.getDate()).padStart(2,'0')}`;
    const cellsHtml = [];
    for(let i=0; i<fD; i++) cellsHtml.push(`<div></div>`);
    for(let d=1; d<=lD; d++){
        const dStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        let dayColor = "var(--text-main)";
        let currentDayObj = new Date(y, m, d).getDay();
        if (currentDayObj === 0) dayColor = "#ef4444";
        if (currentDayObj === 6) dayColor = "#3b82f6";
        const isToday = (dStr === todayStr);
        cellsHtml.push(`<div id="cal-day-${d}" data-date="${dStr}" class="cal-day tap-effect ${isToday ? 'is-today' : ''}" onclick="clickDate('${dStr}')" style="color: ${dayColor};"><div>${d}${isToday ? '<span class="cal-today-tag">오늘</span>' : ''}</div><div class="cal-dot"></div></div>`);
    }
    g.innerHTML = cellsHtml.join("");
    if(currentWorkerId) {
        const sDate = `${y}-${String(m+1).padStart(2,'0')}-01`, eDate = `${y}-${String(m+1).padStart(2,'0')}-${lD}`;
        queryWorkLogsByDateRange(sDate, eDate, 400).then(s => {
            adminWorkLogs = {};
            s.forEach(doc => {
                const data = doc.data();
                if (isDeletedRecord(data)) return;
                if(data.workerId === currentWorkerId) {
                    adminWorkLogs[data.date] = data;
                    const day = parseInt(data.date.split('-')[2]);
                    const el = document.getElementById(`cal-day-${day}`);
                    if(el) {
                        el.classList.add('has-data');
                        const payNum = Number(data.totalPay) || 0;
                        if (payNum > 0 && !el.querySelector('.cal-pay-tag')) {
                            const manVal = (payNum / 10000).toFixed(payNum % 10000 === 0 ? 0 : 1);
                            el.insertAdjacentHTML('beforeend', `<div class="cal-pay-tag">${manVal}만</div>`);
                        }
                        if (data.coworkers) {
                            if (!el.querySelector('.coworker-badge')) {
                                el.insertAdjacentHTML('beforeend', `<div class="coworker-badge">${escapeShipCommentHtml(data.coworkers)}</div>`);
                            } else {
                                el.querySelector('.coworker-badge').innerText = data.coworkers;
                            }
                        }
                    }
                }
            });
            updateMonthlyStatsUI(adminWorkLogs);
            applyWorkLogFilter();
            const selDate = document.getElementById('dailyLogForm')?.getAttribute('data-date');
            if (selDate && !document.getElementById('dailyLogForm')?.classList.contains('hidden')) {
                loadHjncScheduledShipsForDate(getWorklogScheduleDate() || selDate);
            }
            if (isWorkLogUnlocked) loadAndRenderYearlyD3Chart(y);
        });
    } else {
        updateMonthlyStatsUI({});
        const selDate = document.getElementById('dailyLogForm')?.getAttribute('data-date');
        if (selDate && !document.getElementById('dailyLogForm')?.classList.contains('hidden')) {
            loadHjncScheduledShipsForDate(getWorklogScheduleDate() || selDate);
        }
        if (isWorkLogUnlocked) loadAndRenderYearlyD3Chart(y);
    }
}
/* ===== 월단위 작업시간 · 시간대별 책정 금액 분석 (스마트 수입·정산 통합 분석 리포트) =====
   근무일지 1건에서 작업시간과 시간대별 책정 금액을 뽑아낸다.
   우선순위: ① 임금계산기 연동 요약(총 XH (주간/야간/주말)) ② 더블오더 선박 입·출항 시각
   ③ 메모의 수기 시간(주간/야간/주말 X시간) ④ 금액만 있는 기록은 계절별 주·야간 시간표로 추정 */
let latestWorkTimeReportText = "";
let showAllWorkTimeMonths = false;
function extractWorkLogTimeAndWageMetrics(log) {
    const HOLIDAYS = new Set(["2025-01-01","2025-01-28","2025-01-29","2025-01-30","2025-03-01","2025-03-03","2025-05-05","2025-05-06","2025-06-06","2025-08-15","2025-10-03","2025-10-05","2025-10-06","2025-10-07","2025-10-08","2025-10-09","2025-12-25","2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-03-01","2026-03-02","2026-05-05","2026-05-24","2026-05-25","2026-06-06","2026-08-15","2026-08-17","2026-09-24","2026-09-25","2026-09-26","2026-09-28","2026-10-03","2026-10-05","2026-10-09","2026-12-25","2027-01-01","2027-02-06","2027-02-08","2027-02-09","2027-03-01","2027-05-05","2027-05-13","2027-06-06","2027-08-15","2027-08-16","2027-09-14","2027-09-15","2027-09-16","2027-10-03","2027-10-04","2027-10-09","2027-10-11","2027-12-25"]);
    const RATE_BY_YEAR = { 2020: 8590, 2021: 8720, 2022: 9160, 2023: 9620, 2024: 9860, 2025: 10030, 2026: 10320 };
    const seasonFor = (month) => {
        const m = Number(month) || 1;
        if (m >= 4 && m <= 9) return { dayStart: 6, dayEnd: 19 };
        if (m >= 10 && m <= 12) return { dayStart: 7, dayEnd: 17 };
        return { dayStart: 8, dayEnd: 18 };
    };
    const isWknd = (dt) => {
        if (!dt || isNaN(dt.getTime())) return false;
        const key = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
        return dt.getDay() === 0 || dt.getDay() === 6 || HOLIDAYS.has(key);
    };
    const splitInterval = (startDt, hoursFloat) => {
        const out = { totalHours: 0, dayHours: 0, nightHours: 0, weekendHours: 0 };
        const minutes = Math.max(0, Math.round((Number(hoursFloat) || 0) * 60));
        for (let i = 0; i < minutes; i++) {
            const slot = new Date(startDt.getTime() + i * 60000);
            const s = seasonFor(slot.getMonth() + 1);
            const h = slot.getHours();
            if (h >= s.dayStart && h < s.dayEnd) out.dayHours += 1 / 60; else out.nightHours += 1 / 60;
            if (isWknd(slot)) out.weekendHours += 1 / 60;
            out.totalHours += 1 / 60;
        }
        return out;
    };
    const d = log || {};
    const dateStr = String(d.date || "");
    const yearNum = parseInt(dateStr.slice(0, 4), 10) || 2026;
    let baseRate = RATE_BY_YEAR[yearNum] || 10320;
    try {
        if (typeof WAGE_HOURLY_BY_YEAR !== "undefined" && WAGE_HOURLY_BY_YEAR && WAGE_HOURLY_BY_YEAR[yearNum]) baseRate = WAGE_HOURLY_BY_YEAR[yearNum];
    } catch (e) {}
    // Explicit zero is authoritative (e.g. an unpaid or cleared record).
    const totalPay = d.totalPay != null && Number.isFinite(Number(d.totalPay))
        ? Math.max(0, Math.round(Number(d.totalPay)))
        : Math.max(0, Math.round((Number(d.wage1) || 0) + (Number(d.wage2) || 0) + (Number(d.wage3) || 0) + (Number(d.wage4) || 0)));
    const wage1 = Number(d.wage1) || 0;
    const wage2 = Number(d.wage2) || 0;
    const wage3 = Number(d.wage3) || 0;
    const wage4 = Number(d.wage4) || 0;
    const memo = String(d.memo || "");
    const empty = { date: dateStr, totalHours: 0, dayHours: 0, nightHours: 0, weekendHours: 0, dayAmt: 0, nightAmt: 0, weekendAmt: 0, skilledAmt: 0, extraAmt: 0, totalPay, wage1, wage2, wage3, wage4, source: "none", estimated: false, hasTime: false };
    let acc = null;
    let source = "none";
    const addTo = (target, part) => {
        target.totalHours += part.totalHours || 0;
        target.dayHours += part.dayHours || 0;
        target.nightHours += part.nightHours || 0;
        target.weekendHours += part.weekendHours || 0;
        return target;
    };
    // 0) 구조화 필드가 직접 저장된 경우
    const directTotal = Number(d.totalHours || d.workHours || 0);
    if (directTotal > 0) {
        acc = { totalHours: directTotal, dayHours: Number(d.dayHours) || 0, nightHours: Number(d.nightHours) || 0, weekendHours: Number(d.weekendHours || d.weekendHolidayHours) || 0 };
        if (!acc.dayHours && !acc.nightHours) { acc.dayHours = directTotal; }
        source = "calc";
    }
    // 1) 임금계산기 연동 요약: 총 XH (주간 YH / 야간 ZH / 주말·공휴일 WH)
    if (!acc) {
        const calcRe = /총\s*(\d+(?:\.\d+)?)\s*H\s*\(\s*주간\s*(\d+(?:\.\d+)?)\s*H\s*\/\s*야간\s*(\d+(?:\.\d+)?)\s*H(?:\s*\/\s*주말·공휴일\s*(\d+(?:\.\d+)?)\s*H)?\s*\)/gi;
        let m = null;
        let found = null;
        const slots = new Map();
        while ((m = calcRe.exec(memo)) !== null) {
            const part = { totalHours: parseFloat(m[1]) || 0, dayHours: parseFloat(m[2]) || 0, nightHours: parseFloat(m[3]) || 0, weekendHours: parseFloat(m[4]) || 0 };
            // Recalculations replace a wage slot; they are not additional shifts.
            const line = memo.slice(memo.lastIndexOf("\n", m.index) + 1, m.index);
            const slot = line.match(/(?:더블|트리플|쿼드|멀티)오더\s*·\s*임금\s*([1-4])/);
            slots.set(slot ? slot[1] : "1", part);
        }
        slots.forEach(part => { found = found ? addTo(found, part) : { ...part }; });
        if (found && found.totalHours > 0) { acc = found; source = "calc"; }
    }
    // 2) 멀티오더(2~4척) 선박 스케줄: ① 선박 · 입항 YYYY-MM-DD HH:MM → 출항 ... · XH
    if (!acc && memo) {
        const lineRe = /[①②③④]\s*[^\n]*?입항\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})\s*→\s*출항\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/g;
        let m = null;
        let found = null;
        while ((m = lineRe.exec(memo)) !== null) {
            const startDt = new Date(m[1] + "T" + m[2] + ":" + m[3] + ":00");
            const endDt = new Date(m[4] + "T" + m[5] + ":" + m[6] + ":00");
            const hrs = (endDt.getTime() - startDt.getTime()) / 3600000;
            if (hrs > 0 && !isNaN(startDt.getTime())) {
                const part = splitInterval(startDt, hrs);
                found = found ? addTo(found, part) : part;
            }
        }
        if (found && found.totalHours > 0) { acc = found; source = "double"; }
    }
    // 3) 메모 수기 시간: 주간/야간/주말·공휴일 X시간 또는 XH
    if (!acc && memo) {
        const pick = (re) => { const mm = memo.match(re); return mm ? parseFloat(mm[1]) || 0 : 0; };
        const dayH = pick(/주간\s*(\d+(?:\.\d+)?)\s*(?:시간|H)/i);
        const nightH = pick(/야간\s*(\d+(?:\.\d+)?)\s*(?:시간|H)/i);
        const wkndH = pick(/(?:주말|공휴일|휴일)\s*(\d+(?:\.\d+)?)\s*(?:시간|H)/i);
        const totalH = pick(/총\s*(?:작업|근무)?\s*(\d+(?:\.\d+)?)\s*(?:시간|H)/i);
        if (dayH > 0 || nightH > 0 || wkndH > 0 || totalH > 0) {
            const total = totalH > 0 ? totalH : (dayH + nightH);
            acc = { totalHours: total, dayHours: dayH, nightHours: nightH, weekendHours: wkndH };
            if (total > 0 && !dayH && !nightH) acc.dayHours = total;
            source = "memo";
        }
    }
    // 4) 금액만 있는 기록: 계절별 주간 시작 시각부터 시간당 책정액을 누적해 총액에 가장 가까운 시간을 추정
    let estimated = false;
    if ((!acc || acc.totalHours <= 0) && totalPay > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const parts = dateStr.split("-").map(Number);
        const season = seasonFor(parts[1]);
        const startDt = new Date(parts[0], parts[1] - 1, parts[2], season.dayStart, 0, 0);
        let cum = 0;
        let best = splitInterval(startDt, 0);
        let bestDiff = Math.abs(totalPay);
        let running = { totalHours: 0, dayHours: 0, nightHours: 0, weekendHours: 0 };
        for (let i = 0; i < 24; i++) {
            const slot = new Date(startDt.getTime() + i * 3600000);
            const s = seasonFor(slot.getMonth() + 1);
            const isDay = slot.getHours() >= s.dayStart && slot.getHours() < s.dayEnd;
            cum += (isDay ? baseRate : baseRate * 1.5) + (isWknd(slot) ? baseRate * 0.5 : 0);
            const one = splitInterval(slot, 1);
            running = addTo(running, one);
            const diff = Math.abs(totalPay - cum);
            if (diff < bestDiff) { bestDiff = diff; best = { totalHours: running.totalHours, dayHours: running.dayHours, nightHours: running.nightHours, weekendHours: running.weekendHours }; }
            if (cum >= totalPay) break;
        }
        if (best.totalHours > 0) { acc = best; source = "estimate"; estimated = true; }
    }
    if (!acc || acc.totalHours <= 0) return { ...empty, extraAmt: totalPay };
    // Allocate the recorded (possibly net) pay, not an uncapped theoretical gross.
    const weights = [acc.dayHours * baseRate, acc.nightHours * baseRate * 1.5, acc.weekendHours * baseRate * 0.5];
    const theoretical = weights.reduce((sum, value) => sum + value, 0);
    const budget = Math.min(totalPay, Math.round(theoretical));
    const scale = theoretical > 0 ? budget / theoretical : 0;
    const amounts = weights.map(value => Math.floor(value * scale));
    let remainder = budget - amounts.reduce((sum, value) => sum + value, 0);
    weights.map((value, index) => ({ index, fraction: value * scale - amounts[index] }))
        .sort((a, b) => b.fraction - a.fraction)
        .forEach(({ index }) => { if (remainder > 0) { amounts[index]++; remainder--; } });
    const [dayAmt, nightAmt, weekendAmt] = amounts;
    const residualAmt = Math.max(0, Math.round(totalPay - dayAmt - nightAmt - weekendAmt));
    const isSkilledLog = /기능공/.test(memo) || d.skilled === true || d.isSkilled === true;
    const skilledAmt = isSkilledLog
        ? Math.min(residualAmt, Math.round(acc.dayHours * 2557 + acc.nightHours * 3836))
        : 0;
    const extraAmt = residualAmt - skilledAmt;
    return {
        date: dateStr,
        totalHours: Math.round(acc.totalHours * 10) / 10,
        dayHours: Math.round(acc.dayHours * 10) / 10,
        nightHours: Math.round(acc.nightHours * 10) / 10,
        weekendHours: Math.round(acc.weekendHours * 10) / 10,
        dayAmt, nightAmt, weekendAmt,
        skilledAmt,
        extraAmt,
        totalPay, wage1, wage2, wage3, wage4,
        source, estimated, hasTime: true
    };
}
function aggregateWorkTimeMetrics(logs) {
    const list = Array.isArray(logs) ? logs : Object.values(logs || {});
    const out = { days: 0, totalHours: 0, dayHours: 0, nightHours: 0, weekendHours: 0, dayAmt: 0, nightAmt: 0, weekendAmt: 0, skilledAmt: 0, extraAmt: 0, totalPay: 0, wage1: 0, wage2: 0, wage3: 0, wage4: 0, estimatedDays: 0, timeRecordedDays: 0 };
    list.forEach(log => {
        if (!log) return;
        const pay = Number(log.totalPay) || ((Number(log.wage1) || 0) + (Number(log.wage2) || 0) + (Number(log.wage3) || 0) + (Number(log.wage4) || 0));
        if (pay > 0 || log.shipName || log.memo || log.coworkers) out.days += 1;
        const wt = extractWorkLogTimeAndWageMetrics(log);
        out.totalHours += wt.totalHours; out.dayHours += wt.dayHours; out.nightHours += wt.nightHours; out.weekendHours += wt.weekendHours;
        out.dayAmt += wt.dayAmt; out.nightAmt += wt.nightAmt; out.weekendAmt += wt.weekendAmt; out.skilledAmt += wt.skilledAmt; out.extraAmt += wt.extraAmt;
        out.totalPay += wt.totalPay; out.wage1 += wt.wage1; out.wage2 += wt.wage2; out.wage3 += Number(wt.wage3) || 0; out.wage4 += Number(wt.wage4) || 0;
        if (wt.estimated) out.estimatedDays += 1;
        if (wt.hasTime) out.timeRecordedDays += 1;
    });
    ["totalHours", "dayHours", "nightHours", "weekendHours"].forEach(k => { out[k] = Math.round(out[k] * 10) / 10; });
    return out;
}
function formatWorkHours(v) {
    const n = Math.round((Number(v) || 0) * 10) / 10;
    return (Number.isInteger(n) ? String(n) : n.toFixed(1)) + "H";
}
function toggleWorkTimeMonthsView() {
    showAllWorkTimeMonths = !showAllWorkTimeMonths;
    document.querySelectorAll("#yearlyD3ReportContainer .wt-month-row").forEach(row => {
        if (row.getAttribute("data-active") !== "1") row.style.display = showAllWorkTimeMonths ? "" : "none";
    });
    const btn = document.getElementById("wtToggleMonthsBtn");
    if (btn) btn.textContent = showAllWorkTimeMonths ? "📅 활동월만 보기" : "📅 1~12월 전체 보기";
}
function jumpToWorkTimeMonth(year, month) {
    try {
        currentDate = new Date(year, month - 1, 1);
        if (typeof renderCalendar === "function") renderCalendar(year, month - 1);
    } catch (e) {}
}
function copyWorkTimeReport() {
    if (!latestWorkTimeReportText) { if (typeof showToast === "function") showToast("복사할 작업시간 리포트가 없습니다."); return; }
    const done = () => { if (typeof showToast === "function") showToast("📋 작업시간 리포트가 복사되었습니다!"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(latestWorkTimeReportText).then(done).catch(() => { if (typeof showToast === "function") showToast("복사에 실패했습니다."); });
    } else {
        const ta = document.createElement("textarea");
        ta.value = latestWorkTimeReportText;
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta); done();
    }
}
function renderMonthlyWorkTimeReport(data, year) {
    const box = document.getElementById("monthlyWorkTimeReportContainer");
    if (!box || !Array.isArray(data)) return;
    const now = new Date();
    const selIdx = (year === now.getFullYear() || (typeof currentDate !== "undefined" && year === currentDate.getFullYear()))
        ? (typeof currentDate !== "undefined" ? currentDate.getMonth() : now.getMonth()) : 0;
    const cur = data[selIdx] || data[0];
    if (!cur) { box.innerHTML = ""; return; }
    const totalH = Number(cur.totalHours) || 0;
    const dayPct = totalH > 0 ? Math.round((cur.dayHours / totalH) * 100) : 0;
    const nightPct = totalH > 0 ? Math.max(0, 100 - dayPct) : 0;
    const wkndPct = totalH > 0 ? Math.round((cur.weekendHours / totalH) * 100) : 0;
    const hourlyAvg = totalH > 0 ? Math.round(cur.totalPay / totalH) : 0;
    const dailyAvgH = cur.workDays > 0 ? (totalH / cur.workDays).toFixed(1) : "0";
    const card = (label, hours, amt, color, bg, border) =>
        '<div style="background:' + bg + '; border:1px solid ' + border + '; border-radius:8px; padding:8px 10px;">' +
        '<div style="font-size:0.72rem; color:' + color + '; font-weight:800;">' + label + '</div>' +
        '<div style="font-size:1rem; font-weight:900; color:' + color + '; margin-top:2px;">' + formatWorkHours(hours) + '</div>' +
        '<div style="font-size:0.72rem; color:var(--text-sub); font-weight:800; margin-top:2px;">책정 ' + (Number(amt) || 0).toLocaleString() + '원</div></div>';
    box.innerHTML =
        '<div style="background:linear-gradient(135deg,#eff6ff,#f0fdf4); border:1.5px solid #93c5fd; border-radius:10px; padding:10px 12px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:8px;">' +
        '<span style="font-size:0.86rem; font-weight:900; color:var(--primary);">⏱️ ' + year + '년 ' + cur.label + ' 작업시간 · 책정 금액 리포트</span>' +
        '<button type="button" onclick="copyWorkTimeReport()" style="background:var(--primary); color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:0.74rem; font-weight:800; cursor:pointer;">📋 작업시간 리포트 복사</button></div>' +
        '<div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px;">' +
        '<div style="background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:8px 10px;"><div style="font-size:0.72rem; color:var(--text-sub); font-weight:800;">⏱️ 총 작업시간 / 총 책정액</div><div style="font-size:1rem; font-weight:900; color:var(--primary); margin-top:2px;">' + formatWorkHours(totalH) + ' · ' + cur.totalPay.toLocaleString() + '원</div><div style="font-size:0.7rem; color:var(--text-sub); font-weight:700; margin-top:2px;">출근 ' + cur.workDays + '일 · 일평균 ' + dailyAvgH + 'H · 시간당 평균 ' + hourlyAvg.toLocaleString() + '원</div></div>' +
        '<div style="background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:8px 10px;"><div style="font-size:0.72rem; color:var(--text-sub); font-weight:800;">💰 임금 1 / 임금 2' + ((cur.wage3Sum || cur.wage4Sum) ? ' / 임금 3 / 임금 4' : '') + '</div><div style="font-size:0.92rem; font-weight:900; color:#047857; margin-top:2px;">' + (cur.wage1Sum || 0).toLocaleString() + '원 / ' + (cur.wage2Sum || 0).toLocaleString() + '원' + ((cur.wage3Sum || cur.wage4Sum) ? ' / ' + (cur.wage3Sum || 0).toLocaleString() + '원 / ' + (cur.wage4Sum || 0).toLocaleString() + '원' : '') + '</div><div style="font-size:0.7rem; color:var(--text-sub); font-weight:700; margin-top:2px;">기능공 ' + (cur.skilledAmt || 0).toLocaleString() + '원 · 기타 가산 ' + (cur.extraAmt || 0).toLocaleString() + '원' + (cur.estimatedDays ? ' · 금액 기준 추정 ' + cur.estimatedDays + '일 포함' : '') + '</div></div>' +
        card("☀️ 주간 작업시간", cur.dayHours, cur.dayAmt, "#b45309", "rgba(245,158,11,0.07)", "#fde68a") +
        card("🌙 야간 작업시간 (할증 1.5배)", cur.nightHours, cur.nightAmt, "#1e40af", "rgba(59,130,246,0.07)", "#bfdbfe") +
        card("🗓️ 주말·공휴일 시간 (+50% 수당)", cur.weekendHours, cur.weekendAmt, "#be185d", "rgba(236,72,153,0.06)", "#fbcfe8") +
        card("🔧 기능공·특근·기타 가산", 0, (cur.extraAmt || 0) + (cur.skilledAmt || 0), "#6d28d9", "rgba(139,92,246,0.06)", "#ddd6fe").replace(formatWorkHours(0), "가산 수당") +
        '</div>' +
        '<div style="margin-top:8px;"><div style="display:flex; height:12px; border-radius:6px; overflow:hidden; border:1px solid var(--border);"><div style="width:' + dayPct + '%; background:#f59e0b;"></div><div style="width:' + nightPct + '%; background:#2563eb;"></div></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:0.7rem; font-weight:800; color:var(--text-sub); margin-top:3px;"><span>☀️ 주간 ' + dayPct + '%</span><span>🗓️ 주말·공휴일 비중 ' + wkndPct + '% (주·야간과 중복)</span><span>🌙 야간 ' + nightPct + '%</span></div></div>' +
        '<div style="font-size:0.68rem; color:var(--text-sub); font-weight:700; margin-top:6px;">※ 야간 1.5배·주말 기본시급의 +50% 비율로 배분하며, 책정 금액 합계는 기록된 총액에 맞춥니다. 주말 시간은 주·야간 시간과 겹치는 시간입니다.</div>' +
        '</div>';
}

async function loadAndRenderYearlyD3Chart(year) {
    const container = document.getElementById("monthlyD3ChartContainer");
    const titleEl = document.getElementById("d3ChartYearTitle");
    if (!container) return;
    if (titleEl) titleEl.innerText = `📊 ${year}년 월별 총수입 · 근로일수 그래프 & 연간 보고서`;

    // ⚡ d3.js 지연 로드(A-2): 차트를 처음 그릴 때만 내려받습니다.
    if (typeof window.d3 === "undefined") {
        if (!container.innerHTML.trim()) {
            container.innerHTML = `<div style="padding:18px; text-align:center; font-size:0.8rem; font-weight:800; color:var(--text-sub);">📊 그래프를 준비하는 중입니다...</div>`;
        }
        const d3Ready = typeof ensureD3LibraryLoaded === "function" ? await ensureD3LibraryLoaded() : null;
        if (!d3Ready) {
            container.innerHTML = `<div style="padding:18px; text-align:center; font-size:0.8rem; font-weight:800; color:var(--text-sub);">⚠️ 그래프 라이브러리를 불러오지 못했습니다. 네트워크 확인 후 다시 시도해 주세요.</div>`;
            reportFailure("d3 그래프 라이브러리", new Error("d3 로드 실패"));
            return;
        }
    }

    const monthlyData = Array.from({ length: 12 }, (_, idx) => ({
        month: idx + 1,
        label: `${idx + 1}월`,
        totalPay: 0,
        wage1Sum: 0,
        wage2Sum: 0,
        wage3Sum: 0,
        wage4Sum: 0,
        workDays: 0,
        totalHours: 0,
        dayHours: 0,
        nightHours: 0,
        weekendHours: 0,
        dayAmt: 0,
        nightAmt: 0,
        weekendAmt: 0,
        skilledAmt: 0,
        extraAmt: 0,
        estimatedDays: 0,
        timeRecordedDays: 0
    }));

    const shipCounts = {};
    const coworkerCounts = {};

    if (currentWorkerId) {
        try {
            const sDate = `${year}-01-01`;
            const eDate = `${year}-12-31`;
            const snap = await queryWorkLogsByDateRange(sDate, eDate, 2000);
            snap.forEach(doc => {
                const d = doc.data();
                if (isDeletedRecord(d) || d.workerId !== currentWorkerId || !d.date) return;
                const mIdx = parseInt(d.date.split("-")[1], 10) - 1;
                if (mIdx >= 0 && mIdx < 12) {
                    const pay = extractWorkLogTimeAndWageMetrics(d).totalPay;
                    const w1 = Number(d.wage1) || 0;
                    const w2 = Number(d.wage2) || 0;
                    const w3 = Number(d.wage3) || 0;
                    const w4 = Number(d.wage4) || 0;
                    monthlyData[mIdx].totalPay += pay;
                    monthlyData[mIdx].wage1Sum += w1;
                    monthlyData[mIdx].wage2Sum += w2;
                    monthlyData[mIdx].wage3Sum += w3;
                    monthlyData[mIdx].wage4Sum += w4;
                    if (pay > 0 || d.shipName || d.memo || d.coworkers) {
                        monthlyData[mIdx].workDays += 1;
                    }
                    const wt = extractWorkLogTimeAndWageMetrics(d);
                    monthlyData[mIdx].totalHours += wt.totalHours;
                    monthlyData[mIdx].dayHours += wt.dayHours;
                    monthlyData[mIdx].nightHours += wt.nightHours;
                    monthlyData[mIdx].weekendHours += wt.weekendHours;
                    monthlyData[mIdx].dayAmt += wt.dayAmt;
                    monthlyData[mIdx].nightAmt += wt.nightAmt;
                    monthlyData[mIdx].weekendAmt += wt.weekendAmt;
                    monthlyData[mIdx].skilledAmt += wt.skilledAmt;
                    monthlyData[mIdx].extraAmt += wt.extraAmt;
                    if (wt.estimated) monthlyData[mIdx].estimatedDays += 1;
                    if (wt.hasTime) monthlyData[mIdx].timeRecordedDays += 1;
                    const ship = (d.shipName || "").trim();
                    if (ship) shipCounts[ship] = (shipCounts[ship] || 0) + 1;
                    const cwRaw = (d.coworkers || "").trim();
                    if (cwRaw) {
                        cwRaw.split(/[,/\s]+/).map(s => s.trim()).filter(Boolean).forEach(name => {
                            coworkerCounts[name] = (coworkerCounts[name] || 0) + 1;
                        });
                    }
                }
            });
        } catch (err) {
            console.warn("연간 그래프 데이터 조회 오류:", err);
        }
    }

    renderMonthlyD3BarChart(monthlyData, year);
    renderYearlySummaryReport(monthlyData, year, shipCounts, coworkerCounts);
}
let latestYearlyReportText = "";
function copyYearlySummaryReport() {
    if (!latestYearlyReportText) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(latestYearlyReportText).then(() => {
            showToast("📋 연간 정산 요약 보고서가 클립보드에 복사되었습니다!");
        }).catch(() => {
            showToast("복사에 실패했습니다.");
        });
    } else {
        const ta = document.createElement("textarea");
        ta.value = latestYearlyReportText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showToast("📋 연간 정산 요약 보고서가 복사되었습니다!");
    }
}
function renderYearlySummaryReport(data, year, shipCounts = {}, coworkerCounts = {}) {
    const reportEl = document.getElementById("yearlyD3ReportContainer");
    if (!reportEl) return;

    const totalYearPay = data.reduce((acc, d) => acc + d.totalPay, 0);
    const totalYearW1 = data.reduce((acc, d) => acc + d.wage1Sum, 0);
    const totalYearW2 = data.reduce((acc, d) => acc + d.wage2Sum, 0);
    const totalYearW3 = data.reduce((acc, d) => acc + (d.wage3Sum || 0), 0);
    const totalYearW4 = data.reduce((acc, d) => acc + (d.wage4Sum || 0), 0);
    // 선박 3~4척(트리플·쿼드오더) 작업이 있는 해에만 임금 3·4를 덧붙여 표기합니다.
    const extraWageLabel = (totalYearW3 > 0 || totalYearW4 > 0)
        ? ` / 임금 3: ${totalYearW3.toLocaleString()}원 / 임금 4: ${totalYearW4.toLocaleString()}원`
        : "";
    const totalYearDays = data.reduce((acc, d) => acc + d.workDays, 0);
    const activeMonths = data.filter(d => d.workDays > 0 || d.totalPay > 0).length;
    const avgMonthlyPay = activeMonths > 0 ? Math.round(totalYearPay / activeMonths) : 0;
    const avgDailyPay = totalYearDays > 0 ? Math.round(totalYearPay / totalYearDays) : 0;
    const totalYearHours = Math.round(data.reduce((acc, d) => acc + (d.totalHours || 0), 0) * 10) / 10;
    const totalYearDayHours = Math.round(data.reduce((acc, d) => acc + (d.dayHours || 0), 0) * 10) / 10;
    const totalYearNightHours = Math.round(data.reduce((acc, d) => acc + (d.nightHours || 0), 0) * 10) / 10;
    const totalYearWeekendHours = Math.round(data.reduce((acc, d) => acc + (d.weekendHours || 0), 0) * 10) / 10;
    const totalYearDayAmt = data.reduce((acc, d) => acc + (d.dayAmt || 0), 0);
    const totalYearNightAmt = data.reduce((acc, d) => acc + (d.nightAmt || 0), 0);
    const totalYearWeekendAmt = data.reduce((acc, d) => acc + (d.weekendAmt || 0), 0);
    const totalYearExtraAmt = data.reduce((acc, d) => acc + (d.extraAmt || 0) + (d.skilledAmt || 0), 0);
    const totalYearSkilledAmt = data.reduce((acc, d) => acc + (d.skilledAmt || 0), 0);
    if (typeof renderMonthlyWorkTimeReport === "function") renderMonthlyWorkTimeReport(data, year);

    let bestPayMonth = null;
    let bestDaysMonth = null;
    data.forEach(d => {
        if (d.totalPay > 0 && (!bestPayMonth || d.totalPay > bestPayMonth.totalPay)) bestPayMonth = d;
        if (d.workDays > 0 && (!bestDaysMonth || d.workDays > bestDaysMonth.workDays)) bestDaysMonth = d;
    });

    const quarters = [
        { label: "1분기 (1~3월)", pay: data.slice(0, 3).reduce((a, b) => a + b.totalPay, 0), days: data.slice(0, 3).reduce((a, b) => a + b.workDays, 0) },
        { label: "2분기 (4~6월)", pay: data.slice(3, 6).reduce((a, b) => a + b.totalPay, 0), days: data.slice(3, 6).reduce((a, b) => a + b.workDays, 0) },
        { label: "3분기 (7~9월)", pay: data.slice(6, 9).reduce((a, b) => a + b.totalPay, 0), days: data.slice(6, 9).reduce((a, b) => a + b.workDays, 0) },
        { label: "4분기 (10~12월)", pay: data.slice(9, 12).reduce((a, b) => a + b.totalPay, 0), days: data.slice(9, 12).reduce((a, b) => a + b.workDays, 0) }
    ];

    const topShips = Object.entries(shipCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topCoworkers = Object.entries(coworkerCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

    const activeMonthIdx = currentDate.getMonth();
    const curMonthObj = data[activeMonthIdx] || { label: `${activeMonthIdx + 1}월`, totalPay: 0, workDays: 0 };
    const prevMonthObj = activeMonthIdx > 0 ? data[activeMonthIdx - 1] : null;
    let momDiffText = "전월 비교 데이터 없음";
    let momDiffColor = "var(--text-sub)";
    if (prevMonthObj && prevMonthObj.totalPay > 0) {
        const diff = curMonthObj.totalPay - prevMonthObj.totalPay;
        const pct = Math.round((diff / prevMonthObj.totalPay) * 100);
        if (diff > 0) {
            momDiffText = `전월 대비 +${diff.toLocaleString()}원 (▲${pct}%)`;
            momDiffColor = "#16a34a";
        } else if (diff < 0) {
            momDiffText = `전월 대비 ${diff.toLocaleString()}원 (▼${Math.abs(pct)}%)`;
            momDiffColor = "#dc2626";
        } else {
            momDiffText = "전월과 동일 (0%)";
        }
    }

    latestYearlyReportText = [
        `[${year}년 근무일지 종합 정산 보고서]`,
        `- 근로자: ${currentWorkerId || "미로그인"}`,
        `- 연간 총수입: ${totalYearPay.toLocaleString()}원 (임금 1: ${totalYearW1.toLocaleString()}원 / 임금 2: ${totalYearW2.toLocaleString()}원${extraWageLabel})`,
        `- 연간 총 근로일수: ${totalYearDays}일 (가동 ${activeMonths}개월)`,
        `- 월평균 수입: ${avgMonthlyPay.toLocaleString()}원 / 일평균 수입: ${avgDailyPay.toLocaleString()}원`,
        `- 최고 수입월: ${bestPayMonth ? `${bestPayMonth.label} (${bestPayMonth.totalPay.toLocaleString()}원)` : "기록 없음"}`,
        `- 최다 출근월: ${bestDaysMonth ? `${bestDaysMonth.label} (${bestDaysMonth.workDays}일)` : "기록 없음"}`,
        `- 분기별 요약: ` + quarters.map(q => `${q.label} ${(q.pay / 10000).toFixed(0)}만(${q.days}일)`).join(" | "),
        `- 연간 총 작업시간: ${formatWorkHours(totalYearHours)} (주간 ${formatWorkHours(totalYearDayHours)} / 야간 ${formatWorkHours(totalYearNightHours)} / 주말·공휴일 ${formatWorkHours(totalYearWeekendHours)})`,
        `- 시간대별 책정: 주간 ${totalYearDayAmt.toLocaleString()}원 / 야간 ${totalYearNightAmt.toLocaleString()}원 / 주말·공휴일 수당 ${totalYearWeekendAmt.toLocaleString()}원 / 기능공·기타 ${totalYearExtraAmt.toLocaleString()}원`
    ].join("\n");

    latestWorkTimeReportText = [
        `[${year}년 월단위 작업시간 · 시간대별 책정 금액 리포트]`,
        `- 근로자: ${currentWorkerId || "미로그인"}`,
        `- 연간 총 작업시간: ${formatWorkHours(totalYearHours)} (출근 ${totalYearDays}일)`,
        `- 주간: ${formatWorkHours(totalYearDayHours)} / ${totalYearDayAmt.toLocaleString()}원`,
        `- 야간(1.5배): ${formatWorkHours(totalYearNightHours)} / ${totalYearNightAmt.toLocaleString()}원`,
        `- 주말·공휴일(+50%): ${formatWorkHours(totalYearWeekendHours)} / ${totalYearWeekendAmt.toLocaleString()}원`,
        `- 기능공 수당: ${totalYearSkilledAmt.toLocaleString()}원 / 특근·기타 가산: ${(totalYearExtraAmt - totalYearSkilledAmt).toLocaleString()}원`,
        `- 총 책정 금액: ${totalYearPay.toLocaleString()}원 (임금 1: ${totalYearW1.toLocaleString()}원 / 임금 2: ${totalYearW2.toLocaleString()}원${extraWageLabel})`,
        ``,
        ...data.filter(d => d.workDays > 0 || d.totalPay > 0 || (d.totalHours || 0) > 0).map(d => `- ${d.label}: 출근 ${d.workDays}일 · 총 ${formatWorkHours(d.totalHours)} (주간 ${formatWorkHours(d.dayHours)} ${ (d.dayAmt||0).toLocaleString()}원 / 야간 ${formatWorkHours(d.nightHours)} ${(d.nightAmt||0).toLocaleString()}원 / 주말·공휴일 ${formatWorkHours(d.weekendHours)} ${(d.weekendAmt||0).toLocaleString()}원 / 기타 ${((d.extraAmt||0)+(d.skilledAmt||0)).toLocaleString()}원) · 총책정 ${d.totalPay.toLocaleString()}원`)
    ].join("\n");

    const activeRows = data.filter(d => d.totalPay > 0 || d.workDays > 0);
    const wtCell = (hours, amt, color) => `<div style="font-weight:900; color:${color};">${formatWorkHours(hours)}</div><div style="font-size:0.68rem; color:var(--text-sub); font-weight:700;">${(amt || 0).toLocaleString()}원</div>`;
    const monthlyTableRows = data.map(d => {
            const dAvg = d.workDays > 0 ? Math.round(d.totalPay / d.workDays) : 0;
            const isCur = d.month === (activeMonthIdx + 1);
            const isActive = d.workDays > 0 || d.totalPay > 0 || (d.totalHours || 0) > 0;
            const hidden = (!isActive && !showAllWorkTimeMonths) ? 'display:none;' : '';
            return `<tr class="wt-month-row" data-active="${isActive ? '1' : '0'}" onclick="jumpToWorkTimeMonth(${year}, ${d.month})" title="클릭하면 ${d.label} 달력·리포트로 이동" style="cursor:pointer; ${hidden} ${isCur ? 'background:rgba(59,130,246,0.08); font-weight:900;' : ''}">
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); white-space:nowrap;">${d.label}${isCur ? ' 👈' : ''}</td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:center; color:#047857; font-weight:800;">${d.workDays}일</td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:center; font-weight:900; color:var(--primary);">${formatWorkHours(d.totalHours)}</td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:right;">${wtCell(d.dayHours, d.dayAmt, '#b45309')}</td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:right;">${wtCell(d.nightHours, d.nightAmt, '#1d4ed8')}</td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:right;">${wtCell(d.weekendHours, d.weekendAmt, '#be185d')}</td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:right; font-weight:800; color:#6d28d9;">${((d.extraAmt || 0) + (d.skilledAmt || 0)).toLocaleString()}원<div style="font-size:0.68rem; color:var(--text-sub); font-weight:700;">기능공 ${(d.skilledAmt || 0).toLocaleString()} · 기타 ${(d.extraAmt || 0).toLocaleString()}</div></td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:right; color:#1d4ed8; font-weight:900;">${d.totalPay.toLocaleString()}원<div style="font-size:0.68rem; color:var(--text-sub); font-weight:700;">일평균 ${dAvg.toLocaleString()}원</div></td>
            </tr>`;
        }).join("");

    reportEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:6px; flex-wrap:wrap;">
            <span style="font-size:0.92rem; font-weight:900; color:var(--primary);">📑 ${year}년 종합 정산 요약 보고서</span>
            <button type="button" onclick="copyYearlySummaryReport()" style="background:var(--primary); color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:0.75rem; font-weight:800; cursor:pointer;">📋 보고서 텍스트 복사</button>
        </div>

        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:6px; margin-bottom:10px;">
            <div style="background:rgba(59,130,246,0.06); border:1px solid #bfdbfe; border-radius:8px; padding:8px 10px;">
                <div style="font-size:0.72rem; color:#1e40af; font-weight:800;">💰 연간 누적 총수입</div>
                <div style="font-size:1.02rem; font-weight:900; color:#1d4ed8; margin-top:2px;">${totalYearPay.toLocaleString()}원</div>
                <div style="font-size:0.7rem; color:var(--text-sub); margin-top:2px;">임금 1 ${(totalYearW1/10000).toFixed(0)}만 · 임금 2 ${(totalYearW2/10000).toFixed(0)}만${(totalYearW3 > 0 || totalYearW4 > 0) ? ` · 임금 3 ${(totalYearW3/10000).toFixed(0)}만 · 임금 4 ${(totalYearW4/10000).toFixed(0)}만` : ""}</div>
            </div>
            <div style="background:rgba(16,185,129,0.06); border:1px solid #a7f3d0; border-radius:8px; padding:8px 10px;">
                <div style="font-size:0.72rem; color:#065f46; font-weight:800;">🗓️ 연간 누적 근로일수</div>
                <div style="font-size:1.02rem; font-weight:900; color:#047857; margin-top:2px;">${totalYearDays}일 <span style="font-size:0.75rem; font-weight:700;">(${activeMonths}개월 활동)</span></div>
                <div style="font-size:0.7rem; color:var(--text-sub); margin-top:2px;">월평균 출근 ${activeMonths > 0 ? (totalYearDays / activeMonths).toFixed(1) : 0}일</div>
            </div>
            <div style="background:rgba(245,158,11,0.07); border:1px solid #fde68a; border-radius:8px; padding:8px 10px;">
                <div style="font-size:0.72rem; color:#92400e; font-weight:800;">📈 월평균 / 일평균 수입</div>
                <div style="font-size:0.88rem; font-weight:900; color:#b45309; margin-top:2px;">월 ${(avgMonthlyPay/10000).toFixed(0)}만 원 / 일 ${avgDailyPay.toLocaleString()}원</div>
                <div style="font-size:0.7rem; color:${momDiffColor}; font-weight:800; margin-top:2px;">${curMonthObj.label}: ${momDiffText}</div>
            </div>
            <div style="background:rgba(139,92,246,0.06); border:1px solid #ddd6fe; border-radius:8px; padding:8px 10px;">
                <div style="font-size:0.72rem; color:#5b21b6; font-weight:800;">🏆 연간 베스트 기록월</div>
                <div style="font-size:0.8rem; font-weight:900; color:#6d28d9; margin-top:2px;">최고 수입: ${bestPayMonth ? `${bestPayMonth.label} (${(bestPayMonth.totalPay/10000).toFixed(0)}만)` : '-'}</div>
                <div style="font-size:0.75rem; color:#4c1d95; font-weight:800; margin-top:2px;">최다 출근: ${bestDaysMonth ? `${bestDaysMonth.label} (${bestDaysMonth.workDays}일)` : '-'}</div>
            </div>
        </div>

        <div style="background:rgba(10,27,63,0.03); border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:10px;">
            <div style="font-size:0.76rem; font-weight:900; color:var(--primary); margin-bottom:6px;">📊 분기별 실적 요약</div>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; text-align:center;">
                ${quarters.map(q => `<div style="background:var(--card-bg); border:1px solid var(--border); border-radius:6px; padding:5px 2px;">
                    <div style="font-size:0.68rem; color:var(--text-sub); font-weight:800;">${q.label.split(' ')[0]}</div>
                    <div style="font-size:0.78rem; font-weight:900; color:#1d4ed8; margin-top:2px;">${(q.pay/10000).toFixed(0)}만</div>
                    <div style="font-size:0.68rem; color:#047857; font-weight:800;">${q.days}일</div>
                </div>`).join("")}
            </div>
        </div>

        ${(topShips.length > 0 || topCoworkers.length > 0) ? `
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:6px; margin-bottom:10px; font-size:0.75rem;">
            <div style="background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:7px 9px;">
                <div style="font-weight:900; color:var(--primary); margin-bottom:3px;">🚢 주요 작업 선박 TOP 3</div>
                <div style="color:var(--text-sub); font-weight:700; line-height:1.4;">${topShips.length ? topShips.map(([name, cnt], idx) => `${idx+1}. ${escapeShipCommentHtml(name)} (${cnt}회)`).join('<br>') : '기록 없음'}</div>
            </div>
            <div style="background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:7px 9px;">
                <div style="font-weight:900; color:var(--primary); margin-bottom:3px;">👥 주요 동반 근무자 TOP 3</div>
                <div style="color:var(--text-sub); font-weight:700; line-height:1.4;">${topCoworkers.length ? topCoworkers.map(([name, cnt], idx) => `${idx+1}. ${escapeShipCommentHtml(name)} (${cnt}회)`).join('<br>') : '기록 없음'}</div>
            </div>
        </div>` : ''}

        <div style="background:linear-gradient(135deg,#eff6ff,#fdf2f8); border:1.5px solid #93c5fd; border-radius:8px; padding:8px 10px; margin-bottom:10px;">
            <div style="font-size:0.8rem; font-weight:900; color:var(--primary); margin-bottom:6px;">⏱️ ${year}년 연간 작업시간 · 시간대별 책정 금액</div>
            <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:5px; font-size:0.75rem;">
                <div style="background:var(--card-bg); border:1px solid var(--border); border-radius:6px; padding:6px 8px;"><b>⏱️ 총시간</b> ${formatWorkHours(totalYearHours)}<br><span style="color:var(--text-sub); font-weight:700;">총책정 ${totalYearPay.toLocaleString()}원</span></div>
                <div style="background:var(--card-bg); border:1px solid var(--border); border-radius:6px; padding:6px 8px;"><b>☀️ 주간</b> ${formatWorkHours(totalYearDayHours)}<br><span style="color:#b45309; font-weight:800;">${totalYearDayAmt.toLocaleString()}원</span></div>
                <div style="background:var(--card-bg); border:1px solid var(--border); border-radius:6px; padding:6px 8px;"><b>🌙 야간</b> ${formatWorkHours(totalYearNightHours)}<br><span style="color:#1d4ed8; font-weight:800;">${totalYearNightAmt.toLocaleString()}원</span></div>
                <div style="background:var(--card-bg); border:1px solid var(--border); border-radius:6px; padding:6px 8px;"><b>🗓️ 주말·공휴일</b> ${formatWorkHours(totalYearWeekendHours)}<br><span style="color:#be185d; font-weight:800;">수당 ${totalYearWeekendAmt.toLocaleString()}원 · 기타 ${totalYearExtraAmt.toLocaleString()}원</span></div>
            </div>
        </div>

        <details open style="background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:8px 10px;">
            <summary style="cursor:pointer; font-size:0.8rem; font-weight:900; color:var(--primary); outline:none;">📅 월단위 작업시간 · 시간대별 책정 금액 종합표 (${activeRows.length}개 활동월)</summary>
            <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                <button type="button" id="wtToggleMonthsBtn" onclick="toggleWorkTimeMonthsView()" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; padding:4px 10px; font-size:0.74rem; font-weight:800; cursor:pointer;">${showAllWorkTimeMonths ? '📅 활동월만 보기' : '📅 1~12월 전체 보기'}</button>
                <button type="button" onclick="copyWorkTimeReport()" style="background:var(--primary); color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:0.74rem; font-weight:800; cursor:pointer;">📋 작업시간 리포트 복사</button>
            </div>
            <div style="overflow-x:auto; margin-top:8px;">
            <table style="width:100%; min-width:560px; border-collapse:collapse; font-size:0.78rem;">
                <thead>
                    <tr style="background:rgba(10,27,63,0.05); color:var(--primary); font-weight:900;">
                        <th style="padding:5px 4px; text-align:left; border-bottom:1.5px solid var(--primary);">월</th>
                        <th style="padding:5px 4px; text-align:center; border-bottom:1.5px solid var(--primary);">출근</th>
                        <th style="padding:5px 4px; text-align:center; border-bottom:1.5px solid var(--primary);">총시간</th>
                        <th style="padding:5px 4px; text-align:right; border-bottom:1.5px solid var(--primary);">☀️ 주간 시간/금액</th>
                        <th style="padding:5px 4px; text-align:right; border-bottom:1.5px solid var(--primary);">🌙 야간 시간/금액</th>
                        <th style="padding:5px 4px; text-align:right; border-bottom:1.5px solid var(--primary);">🗓️ 주말·공휴일/수당</th>
                        <th style="padding:5px 4px; text-align:right; border-bottom:1.5px solid var(--primary);">🔧 기능공·기타</th>
                        <th style="padding:5px 4px; text-align:right; border-bottom:1.5px solid var(--primary);">💰 총 책정금액</th>
                    </tr>
                </thead>
                <tbody>${monthlyTableRows}</tbody>
                <tfoot><tr style="background:rgba(10,27,63,0.05); font-weight:900; color:var(--primary);">
                    <td style="padding:6px 4px;">연간 합계</td>
                    <td style="padding:6px 4px; text-align:center;">${totalYearDays}일</td>
                    <td style="padding:6px 4px; text-align:center;">${formatWorkHours(totalYearHours)}</td>
                    <td style="padding:6px 4px; text-align:right;">${formatWorkHours(totalYearDayHours)}<div style="font-size:0.68rem;">${totalYearDayAmt.toLocaleString()}원</div></td>
                    <td style="padding:6px 4px; text-align:right;">${formatWorkHours(totalYearNightHours)}<div style="font-size:0.68rem;">${totalYearNightAmt.toLocaleString()}원</div></td>
                    <td style="padding:6px 4px; text-align:right;">${formatWorkHours(totalYearWeekendHours)}<div style="font-size:0.68rem;">${totalYearWeekendAmt.toLocaleString()}원</div></td>
                    <td style="padding:6px 4px; text-align:right;">${totalYearExtraAmt.toLocaleString()}원</td>
                    <td style="padding:6px 4px; text-align:right;">${totalYearPay.toLocaleString()}원</td>
                </tr></tfoot>
            </table>
            </div>
            <div style="font-size:0.68rem; color:var(--text-sub); font-weight:700; margin-top:6px;">※ 월 행을 누르면 해당 월 달력·리포트로 이동합니다. 주말·공휴일 시간은 주·야간과 겹치는 시간이며 수당은 +50% 가산분입니다.</div>
        </details>
    `;
}
function renderMonthlyD3BarChart(data, year) {
    const container = document.getElementById("monthlyD3ChartContainer");
    if (!container || typeof d3 === "undefined") return;
    container.innerHTML = "";

    const width = Math.max(container.clientWidth || 340, 340);
    const height = 210;
    const margin = { top: 26, right: 32, bottom: 30, left: 42 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(container)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .style("width", "100%")
        .style("height", "auto")
        .style("display", "block");

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x0 = d3.scaleBand()
        .domain(data.map(d => d.label))
        .range([0, innerWidth])
        .paddingInner(0.25)
        .paddingOuter(0.1);

    const x1 = d3.scaleBand()
        .domain(["pay", "days"])
        .range([0, x0.bandwidth()])
        .padding(0.12);

    const maxPayMan = Math.max(d3.max(data, d => d.totalPay / 10000) || 0, 100);
    const maxDays = Math.max(d3.max(data, d => d.workDays) || 0, 10);

    const yPay = d3.scaleLinear()
        .domain([0, maxPayMan * 1.15])
        .nice()
        .range([innerHeight, 0]);

    const yDays = d3.scaleLinear()
        .domain([0, maxDays * 1.15])
        .nice()
        .range([innerHeight, 0]);

    g.append("g")
        .attr("stroke", "#e2e8f0")
        .attr("stroke-dasharray", "2,2")
        .call(d3.axisLeft(yPay).ticks(4).tickSize(-innerWidth).tickFormat(""))
        .call(gEl => gEl.select(".domain").remove());

    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x0).tickSize(0))
        .call(gEl => gEl.select(".domain").attr("stroke", "#cbd5e1"))
        .selectAll("text")
        .style("font-size", "10px")
        .style("font-weight", "800")
        .style("fill", "var(--text-main)");

    g.append("g")
        .call(d3.axisLeft(yPay).ticks(4).tickFormat(d => `${d}만`))
        .call(gEl => gEl.select(".domain").remove())
        .selectAll("text")
        .style("font-size", "9px")
        .style("font-weight", "700")
        .style("fill", "#2563eb");

    g.append("g")
        .attr("transform", `translate(${innerWidth},0)`)
        .call(d3.axisRight(yDays).ticks(4).tickFormat(d => `${d}일`))
        .call(gEl => gEl.select(".domain").remove())
        .selectAll("text")
        .style("font-size", "9px")
        .style("font-weight", "700")
        .style("fill", "#059669");

    const activeMonth = currentDate.getMonth() + 1;

    const monthGroup = g.selectAll(".month-group")
        .data(data)
        .enter()
        .append("g")
        .attr("class", "month-group")
        .attr("transform", d => `translate(${x0(d.label)},0)`)
        .style("cursor", "pointer")
        .on("click", (_, d) => {
            currentDate = new Date(year, d.month - 1, 1);
            renderCalendar(year, d.month - 1);
        });

    monthGroup.filter(d => d.month === activeMonth)
        .append("rect")
        .attr("x", -2)
        .attr("y", -6)
        .attr("width", x0.bandwidth() + 4)
        .attr("height", innerHeight + 6)
        .attr("rx", 4)
        .attr("fill", "rgba(59, 130, 246, 0.08)");

    monthGroup.append("rect")
        .attr("x", x1("pay"))
        .attr("y", d => yPay(d.totalPay / 10000))
        .attr("width", x1.bandwidth())
        .attr("height", d => Math.max(0, innerHeight - yPay(d.totalPay / 10000)))
        .attr("rx", 2)
        .attr("fill", "#3b82f6");

    monthGroup.append("rect")
        .attr("x", x1("days"))
        .attr("y", d => yDays(d.workDays))
        .attr("width", x1.bandwidth())
        .attr("height", d => Math.max(0, innerHeight - yDays(d.workDays)))
        .attr("rx", 2)
        .attr("fill", "#10b981");

    monthGroup.filter(d => d.totalPay > 0)
        .append("text")
        .attr("x", x1("pay") + x1.bandwidth() / 2)
        .attr("y", d => yPay(d.totalPay / 10000) - 4)
        .attr("text-anchor", "middle")
        .style("font-size", "8px")
        .style("font-weight", "800")
        .style("fill", "#1d4ed8")
        .text(d => `${Math.round(d.totalPay / 10000)}만`);

    monthGroup.filter(d => d.workDays > 0)
        .append("text")
        .attr("x", x1("days") + x1.bandwidth() / 2)
        .attr("y", d => yDays(d.workDays) - 4)
        .attr("text-anchor", "middle")
        .style("font-size", "8px")
        .style("font-weight", "800")
        .style("fill", "#047857")
        .text(d => `${d.workDays}일`);
}
let rangeFetchedLogs = null;
function matchesLogFilter(log, startDate, endDate, keyword) {
    if (!log) return false;
    if (startDate && log.date < startDate) return false;
    if (endDate && log.date > endDate) return false;
    if (keyword) {
        const hay = `${log.date || ''} ${log.shipName || ''} ${log.coworkers || ''} ${log.memo || ''} ${log.totalPay || ''}`.toLowerCase();
        if (!hay.includes(keyword)) return false;
    }
    return true;
}
function applyWorkLogFilter(externalLogs) {
    const startDate = (document.getElementById('logFilterStartDate')?.value || '').trim();
    const endDate = (document.getElementById('logFilterEndDate')?.value || '').trim();
    const keyword = (document.getElementById('logFilterKeyword')?.value || '').trim().toLowerCase();
    const resultsBox = document.getElementById('logFilterResults');
    const isFiltering = Boolean(startDate || endDate || keyword);

    document.querySelectorAll('#calendarGrid .cal-day').forEach(cell => {
        cell.classList.remove('filter-match', 'filter-dim');
        if (!isFiltering) return;
        const dStr = cell.getAttribute('data-date');
        const log = adminWorkLogs[dStr];
        if (matchesLogFilter(log, startDate, endDate, keyword)) {
            cell.classList.add('filter-match');
        } else {
            cell.classList.add('filter-dim');
        }
    });

    if (!resultsBox) return;
    if (!isFiltering) {
        resultsBox.classList.add('hidden');
        resultsBox.innerHTML = '';
        rangeFetchedLogs = null;
        return;
    }

    const sourceMap = externalLogs || rangeFetchedLogs || adminWorkLogs;
    const matched = Object.values(sourceMap)
        .filter(log => matchesLogFilter(log, startDate, endDate, keyword))
        .sort((a, b) => b.date.localeCompare(a.date));

    resultsBox.classList.remove('hidden');
    if (matched.length === 0) {
        resultsBox.innerHTML = `<div style="text-align:center; padding:10px; font-size:0.82rem; color:var(--text-sub); font-weight:700;">조건에 맞는 근무 기록이 없습니다.${!externalLogs && !rangeFetchedLogs && (startDate || endDate) ? ' 다른 달 기록을 찾으시려면 [기간 조회]를 눌러 주세요.' : ''}</div>`;
        return;
    }

    let sumPay = 0;
    const itemsHtml = matched.map(log => {
        const pay = Number(log.totalPay) || 0;
        sumPay += pay;
        const ship = escapeShipCommentHtml(log.shipName || '선박명 미입력');
        const workers = escapeShipCommentHtml(log.coworkers || '');
        const memo = escapeShipCommentHtml(log.memo || '');
        return `<div class="log-filter-item" onclick="jumpToLogDate('${log.date}')">
            <div style="flex:1; min-width:0;">
                <div style="font-weight:900; color:var(--primary);">${log.date} · 🚢 ${ship}</div>
                <div style="font-size:0.78rem; color:var(--text-sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${workers ? `👥 ${workers} ` : ''}${memo ? `📝 ${memo}` : ''}</div>
            </div>
            <div style="font-weight:900; color:#c2410c; white-space:nowrap;">${pay.toLocaleString()}원</div>
        </div>`;
    }).join('');

    resultsBox.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; font-weight:900; color:var(--primary); margin-bottom:6px; padding:0 4px;">
        <span>검색 결과: ${matched.length}건</span>
        <span>합계: ${sumPay.toLocaleString()}원</span>
    </div>${itemsHtml}`;
}
async function searchWorkLogsRange() {
    if (!currentWorkerId) {
        document.getElementById('loginModal').style.display = 'flex';
        return;
    }
    const startDate = (document.getElementById('logFilterStartDate')?.value || '').trim();
    const endDate = (document.getElementById('logFilterEndDate')?.value || '').trim();
    if (startDate && endDate && startDate > endDate) {
        alert("시작일이 종료일보다 늦을 수 없습니다.");
        return;
    }
    const resultsBox = document.getElementById('logFilterResults');
    if (resultsBox) {
        resultsBox.classList.remove('hidden');
        resultsBox.innerHTML = `<div style="text-align:center; padding:10px; font-size:0.82rem; color:var(--text-sub); font-weight:700;">기록을 조회하는 중...</div>`;
    }
    try {
        const snap = await queryWorkLogsByDateRange(startDate || null, endDate || null, 500);
        const fetched = {};
        snap.forEach(doc => {
            const data = doc.data();
            if (isDeletedRecord(data)) return;
            if (data.workerId === currentWorkerId) {
                fetched[data.date] = data;
            }
        });
        rangeFetchedLogs = fetched;
        if (startDate) {
            const parts = startDate.split('-');
            if (parts.length === 3) {
                currentDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
                renderCalendar(currentDate.getFullYear(), currentDate.getMonth());
            }
        }
        applyWorkLogFilter(fetched);
    } catch (e) {
        console.error("기간 조회 오류:", e);
        applyWorkLogFilter();
    }
}
function resetWorkLogFilter() {
    const s = document.getElementById('logFilterStartDate');
    const e = document.getElementById('logFilterEndDate');
    const k = document.getElementById('logFilterKeyword');
    if (s) s.value = '';
    if (e) e.value = '';
    if (k) k.value = '';
    rangeFetchedLogs = null;
    applyWorkLogFilter();
}
function jumpToLogDate(dStr) {
    if (!dStr) return;
    const parts = dStr.split('-');
    if (parts.length !== 3) return;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    if (rangeFetchedLogs && rangeFetchedLogs[dStr]) {
        adminWorkLogs[dStr] = rangeFetchedLogs[dStr];
    }
    if (currentDate.getFullYear() !== y || currentDate.getMonth() !== m) {
        currentDate = new Date(y, m, 1);
        renderCalendar(y, m);
    }
    clickDate(dStr);
    const formEl = document.getElementById('dailyLogForm');
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
/* 근무일지 '작업 내용' 블록 높이 자동 조절: 내용 길이(글자 수)만큼 박스가 늘어나 항상 전체가 보이도록 함 */
function autoGrowWorkLogMemo(el) {
    const target = el || (typeof document !== 'undefined' && document.getElementById ? document.getElementById('logMemo') : null);
    if (!target || !target.style || typeof target.style.setProperty !== 'function') return;
    try {
        target.style.setProperty('height', 'auto', 'important');
        if (!target.scrollHeight) return; // 숨겨진 상태에서는 측정 불가 → 다음 표시 시 다시 조절
        const borderPx = Math.max(0, (target.offsetHeight || 0) - (target.clientHeight || 0));
        target.style.setProperty('height', (target.scrollHeight + borderPx) + 'px', 'important');
    } catch (err) { /* 측정 실패 시 기본 스타일 유지 */ }
}
function clickDate(dStr){ document.getElementById('selectedDateText').innerText = dStr; document.getElementById('dailyLogForm').classList.remove('hidden'); document.getElementById('dailyLogForm').setAttribute('data-date', dStr); const d = adminWorkLogs[dStr]; document.getElementById('logShipName').value = d ? (d.shipName || '') : ''; document.getElementById('logWage1').value = d ? (d.wage1 || '') : ''; document.getElementById('logWage2').value = d ? (d.wage2 || '') : ''; const logWage3El = document.getElementById('logWage3'); if (logWage3El) logWage3El.value = d ? (d.wage3 || '') : ''; const logWage4El = document.getElementById('logWage4'); if (logWage4El) logWage4El.value = d ? (d.wage4 || '') : ''; document.getElementById('logCoworkers').value = d ? (d.coworkers || '') : ''; document.getElementById('logMemo').value = d ? d.memo : ''; autoGrowWorkLogMemo(document.getElementById('logMemo')); const img = document.getElementById('logImagePreview'); if(d && d.imageUrl){ img.src = d.imageUrl; img.style.display = 'block'; } else { img.style.display = 'none'; img.src = ""; } document.getElementById('logImageInput').value = ''; setWorklogScheduleDateInput(dStr); updateWorklogDoubleOrderStatus(); renderWorkLogQuickChips(dStr); }
function trySaveWorkLog(){ if(currentWorkerId) saveWorkLog(); else document.getElementById('loginModal').style.display = 'flex'; }
async function confirmLoginAndSave(evt) {
    const nick = document.getElementById('loginNick').value.trim();
    const pw = document.getElementById('loginPw').value.trim();
    const btn = (evt && evt.currentTarget) || document.getElementById('confirmLoginBtn') || (typeof event !== 'undefined' && event ? event.target : null);

    if (!nick || !pw) {
        alert("닉네임과 비밀번호를 입력해 주세요.");
        return;
    }

    // 버튼 중복 클릭 방지
    btn.disabled = true;
    btn.innerText = "연결 시도 중...";

    try {
        await ensureAnonymousAuth();
        const pwHash = await sha256Hex(pw);
        // 네트워크 상태와 상관없이 Firestore 참조를 명확히 가져옴
        const userRef = db.collection('user_profiles').doc(nick);
        
        // 데이터 가져오기 (get) 시도
        const doc = await userRef.get().catch(e => {
            throw new Error("서버 연결 실패 (네트워크를 확인하세요)");
        });

        if (doc.exists) {
            const savedPw = doc.data().password || "";
            const isMatched = await verifyPasswordMatch(pw, savedPw);
            if (!isMatched) {
                alert("비밀번호가 일치하지 않습니다.");
                btn.disabled = false;
                btn.innerText = "확인 및 저장";
                return;
            }
            // 기존 평문 비밀번호였던 경우 자동으로 SHA-256 해시로 업그레이드
            if (savedPw !== pwHash) {
                await userRef.set({ password: pwHash }, { merge: true }).catch(() => {});
            }
        } else {
            if(!confirm("새로운 닉네임입니다. 가입하시겠습니까?")) {
                btn.disabled = false;
                btn.innerText = "확인 및 저장";
                return;
            }
            await userRef.set({ 
                password: pwHash, 
                createdAt: firebase.firestore.FieldValue.serverTimestamp() 
            });
        }

        // 로그인 성공 세션 저장
        currentWorkerId = nick;
        localStorage.setItem('myWorkerId', nick);
        updateUserBar();
        
        // 모달 닫고 저장 실행
        closeLoginModal();
        saveWorkLog(); 
        
        showToast("🔓 로그인 및 저장 성공!");

    } catch (err) {
        console.error("에러 디테일:", err);
        alert("⚠️ 오류 발생: " + err.message);
        btn.disabled = false;
        btn.innerText = "확인 및 저장";
    }
}

function saveWorkLog(){ 
    const btn = document.getElementById('saveLogBtn'); 
    const dStr = document.getElementById('dailyLogForm').getAttribute('data-date'); 

    // 🚩 [보안 강화] 로그인이 안 되어 있으면 저장 차단 및 로그인창 표시
    if(!currentWorkerId) {
        alert("로그인이 필요합니다. 닉네임과 비밀번호를 먼저 입력해 주세요!");
        document.getElementById('loginModal').style.display = 'flex';
        return;
    }

    if(!dStr) { 
        alert("날짜가 선택되지 않았습니다."); 
        return; 
    } 

    btn.innerText = "저장 중... (0%)"; 
    btn.disabled = true; 

    const shipNameInfo = document.getElementById('logShipName').value.trim(); 
    const previousWorkLog = adminWorkLogs[dStr] || {};
    const previousShipName = previousWorkLog.shipName || "";
    const w1 = parseFloat(document.getElementById('logWage1').value) || 0; 
    const w2 = parseFloat(document.getElementById('logWage2').value) || 0; 
    // 선박 3~4척(트리플·쿼드오더) 작업일 때만 입력되는 임금 3·임금 4
    const w3 = parseFloat(document.getElementById('logWage3')?.value) || 0; 
    const w4 = parseFloat(document.getElementById('logWage4')?.value) || 0; 
    const coworkersInfo = document.getElementById('logCoworkers').value.trim(); 
    const memo = document.getElementById('logMemo').value; 
    const file = document.getElementById('logImageInput').files[0]; 
    const pay = w1 + w2 + w3 + w4; 

    const shouldOfferVesselInfoFollowUp =
        !!normalizeVesselInfoName(shipNameInfo) &&
        (
            normalizeVesselInfoName(shipNameInfo) !==
                normalizeVesselInfoName(previousShipName) ||
            String(memo || "").trim() !==
                String(previousWorkLog.memo || "").trim()
        );
    
    // 문서 ID 생성 (닉네임_날짜 형식)
    const docId = `${currentWorkerId}_${dStr}`; 

    const finalizeSave = (url) => { 
        btn.innerText = "데이터 기록 중..."; 
        const logData = { 
            date: dStr, 
            workerId: currentWorkerId, 
            shipName: shipNameInfo, 
            wage1: w1, 
            wage2: w2, 
            wage3: w3, 
            wage4: w4, 
            coworkers: coworkersInfo, 
            memo: memo, 
            totalPay: pay, 
            imageUrl: url,
            deletedAt: null, // 삭제 표시가 있던 일지를 다시 저장하면 복구됩니다.
            timestamp: firebase.firestore.FieldValue.serverTimestamp() // 🚩 저장 시간 기록 추가
        }; 

        db.collection('work_logs').doc(docId).set(logData, {merge: true}).then(() => { 
            trackAppEvent('actions', 'log_save');
            btn.innerText = "✅ 저장 완료!"; 
            btn.style.background = "var(--success)"; 
            showToast("근무일지가 안전하게 저장되었습니다."); 
            
            // 데이터 즉시 갱신
            adminWorkLogs[dStr] = logData; 
            renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); 

            if (shouldOfferVesselInfoFollowUp) {
                setTimeout(() => startVesselInfoFollowUp("workLog", {
                    vesselName: shipNameInfo,
                    date: dStr
                }), 350);
            } 

            setTimeout(() => { 
                btn.innerText = "저장하기"; 
                btn.style.background = ""; // 기본색으로 복구
                btn.disabled = false; 
            }, 1500); 
        }).catch(err => { 
            alert("데이터베이스 저장 실패: " + err.message); 
            btn.innerText = "저장하기"; 
            btn.disabled = false; 
        }); 
    }; 

    // 사진 업로드 로직 (고화질 사진 자동 압축 후 업로드)
    if(file) { 
        Promise.resolve(typeof compressImageForUpload === 'function' ? compressImageForUpload(file) : file).then((optimizedFile) => {
            const targetFile = optimizedFile || file;
            const storageRef = storage.ref(`logs/${currentWorkerId}/${Date.now()}_${targetFile.name || file.name}`); 
            const uploadTask = storageRef.put(targetFile); 
            uploadTask.on('state_changed', (snapshot) => { 
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100; 
                btn.innerText = `업로드 중... ${Math.round(progress)}%`; 
            }, (error) => { 
                alert("사진 업로드 실패: " + error.message); 
                btn.innerText = "저장하기"; 
                btn.disabled = false; 
            }, () => { 
                uploadTask.snapshot.ref.getDownloadURL().then((downloadURL) => { 
                    finalizeSave(downloadURL); 
                }); 
            });
        });
    } else { 
        // 기존 사진 유지 또는 사진 없음 처리
        const existingUrl = (adminWorkLogs[dStr] && adminWorkLogs[dStr].imageUrl) ? adminWorkLogs[dStr].imageUrl : null; 
        finalizeSave(existingUrl); 
    } 
}
function loginSuccess(name) { currentWorkerId = name; localStorage.setItem('myWorkerId', currentWorkerId); updateUserBar(); renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); if(typeof initNotifications === 'function') initNotifications(currentWorkerId); }
function closeLoginModal(){ document.getElementById('loginModal').style.display = 'none'; }
function updateUserBar() { document.getElementById('userProfileBar').style.display = currentWorkerId ? 'flex' : 'none'; if(currentWorkerId) document.getElementById('currentUserDisplay').innerText = `👤 ${currentWorkerId}`; }
function logoutWorker() { if(confirm("로그아웃하시겠습니까?")) { currentWorkerId = null; localStorage.removeItem('myWorkerId'); updateUserBar(); renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); document.getElementById('dailyLogForm').classList.add('hidden'); } }
function deleteWorkLog(){ if(!currentWorkerId) return; if(!confirm("정말 삭제하시겠습니까?")) return; const dStr = document.getElementById('dailyLogForm').getAttribute('data-date'); db.collection('work_logs').doc(`${currentWorkerId}_${dStr}`).update(softDeletePayload()).then(()=>{ showToast("삭제되었습니다."); document.getElementById('logShipName').value=''; document.getElementById('logWage1').value=''; document.getElementById('logWage2').value=''; const delWage3 = document.getElementById('logWage3'); if (delWage3) delWage3.value=''; const delWage4 = document.getElementById('logWage4'); if (delWage4) delWage4.value=''; if (typeof syncWorklogWageSlotVisibility === 'function') syncWorklogWageSlotVisibility(0); document.getElementById('logCoworkers').value=''; document.getElementById('logMemo').value=''; autoGrowWorkLogMemo(document.getElementById('logMemo')); document.getElementById('logImageInput').value = ''; const imgPreview = document.getElementById('logImagePreview'); if(imgPreview) { imgPreview.src = ''; imgPreview.style.display = 'none'; } renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); }).catch(err => alert("삭제 실패: " + err.message)); }
/* 근무일지 입력 폼 초기화: 임금계산기 초기화(resetWageForm)와 같은 역할.
   저장된 기록은 건드리지 않고, 선택한 날짜 폼의 입력 내용(배 이름·임금·근무자·작업 내용·사진)만 비운다. */
function resetWorkLogForm() {
    const form = document.getElementById('dailyLogForm');
    if (!form || form.classList.contains('hidden')) return;
    const fieldIds = ['logShipName', 'logWage1', 'logWage2', 'logWage3', 'logWage4', 'logCoworkers', 'logMemo'];
    const hasContent = fieldIds.some(id => {
        const el = document.getElementById(id);
        return !!el && String(el.value || '').trim() !== '';
    }) || !!(document.getElementById('logImageInput')?.value)
        || !!(document.getElementById('logImagePreview') && document.getElementById('logImagePreview').style.display !== 'none' && document.getElementById('logImagePreview').src);
    if (hasContent && !confirm("현재 근무일지에 입력한 내용이 있습니다. 모두 지우고 새로 입력할까요?\n\n※ 이미 저장된 기록은 삭제되지 않습니다.")) return;
    fieldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const imgInput = document.getElementById('logImageInput');
    if (imgInput) imgInput.value = '';
    const imgPreview = document.getElementById('logImagePreview');
    if (imgPreview) { imgPreview.src = ''; imgPreview.style.display = 'none'; }
    if (typeof autoGrowWorkLogMemo === 'function') autoGrowWorkLogMemo(document.getElementById('logMemo'));
    if (typeof syncCoworkerSelectionUI === 'function') syncCoworkerSelectionUI();
    if (typeof updateWorklogDoubleOrderStatus === 'function') updateWorklogDoubleOrderStatus();
    showToast("🔄 근무일지 입력 내용이 초기화되었습니다. 저장된 기록은 날짜를 다시 누르면 불러올 수 있습니다.");
}
function changeMonth(s){ currentDate.setMonth(currentDate.getMonth()+s); renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); }
function previewLogImage(input){ if(input.files&&input.files[0]){ const r=new FileReader(); r.onload=e=>{const i=document.getElementById('logImagePreview'); i.src=e.target.result; i.style.display='block';}; r.readAsDataURL(input.files[0]); } }
function renderRow(label, amt, color = "inherit") { return `<tr><td style="padding: 8px 0; color: var(--text-sub); font-weight:700;">${label}</td><td style="text-align: right; font-weight: 900; color: ${color};">${amt.toLocaleString()}원</td></tr>`; }
const publicHolidays = [
    '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-01', '2025-03-03', '2025-05-05', '2025-05-06', '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25',
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-06', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
    '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-05', '2027-05-13', '2027-06-06', '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25'
];
let lastCalculatedWageData = null;
function getSeasonScheduleByMonth(month) {
    const m = Number(month) || 1;
    if (m >= 4 && m <= 9) return { dayStart: 6, dayEnd: 19, rowId: 'row-apr', label: '4~9월 (06~19시)' };
    if (m >= 10 && m <= 12) return { dayStart: 7, dayEnd: 17, rowId: 'row-oct', label: '10~12월 (07~17시)' };
    return { dayStart: 8, dayEnd: 18, rowId: 'row-jan', label: '1~3월 (08~18시)' };
}
function applySeasonDefaultHours(month, force = false) {
    const { dayStart, dayEnd } = getSeasonScheduleByMonth(month);
    const sHour = document.getElementById('wageStartHour');
    const eHour = document.getElementById('wageEndHour');
    if (sHour && (force || !sHour.dataset.userModified)) {
        sHour.value = String(dayStart);
        if (force) delete sHour.dataset.userModified;
    }
    if (eHour && (force || !eHour.dataset.userModified)) {
        eHour.value = String(dayEnd);
        if (force) delete eHour.dataset.userModified;
    }
}
function isWeekendOrPublicHolidayDate(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return false;
    const dayOfWeek = dateObj.getDay();
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;
    return dayOfWeek === 0 || dayOfWeek === 6 || publicHolidays.includes(dateKey);
}
function highlightSeasonRow(month) {
    ['row-jan', 'row-apr', 'row-oct'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('is-season-active');
    });
    const { rowId } = getSeasonScheduleByMonth(month);
    const activeEl = document.getElementById(rowId);
    if (activeEl) activeEl.classList.add('is-season-active');
}
function calcTimeAndFill() {
    try {
        const sd = document.getElementById('wageStartDate').value;
        const sh = parseInt(document.getElementById('wageStartHour').value, 10) || 0;
        const ed = document.getElementById('wageEndDate').value;
        const eh = parseInt(document.getElementById('wageEndHour').value, 10) || 0;
        if (!sd || !ed) {
            alert("시작 날짜와 종료 날짜를 선택해 주세요.");
            return;
        }
        const month = parseInt(sd.split('-')[1], 10) || (new Date(sd).getMonth() + 1);
        highlightSeasonRow(month);
        const startD = new Date(`${sd}T${String(sh).padStart(2,'0')}:00:00`);
        const endD = new Date(`${ed}T${String(eh).padStart(2,'0')}:00:00`);
        const diffMs = endD.getTime() - startD.getTime();
        if (diffMs > 0) {
            const firstHours = Math.floor(diffMs / (1000 * 60 * 60));
            const autoWeekendHours = autoFillWeekendHoliday(startD, firstHours);
            if (selectedWageVessels.length > 1) {
                refreshWageWorkHours();
                const totalHours = document.getElementById('wageTotalHours').value;
                showToast(`⏱️ 1선박 ${firstHours}시간 · 총 근무 ${totalHours || firstHours}시간 설정 완료`);
            } else {
                const totalInput = document.getElementById('wageTotalHours');
                if (totalInput) {
                    totalInput.readOnly = false;
                    totalInput.value = firstHours;
                }
                updateWageHoursBreakdown();
                if (autoWeekendHours > 0) {
                    showToast(`⏱️ 총 근무 ${firstHours}시간 (주말·공휴일 ${autoWeekendHours}시간 자동 반영)`);
                } else {
                    showToast(`⏱️ 총 근무 시간 ${firstHours}시간이 설정되었습니다.`);
                }
            }
        } else {
            document.getElementById('wageTotalHours').value = '';
            updateWageHoursBreakdown();
            if (sd !== ed || sh !== eh) {
                alert("종료 시간이 시작 시간보다 빠를 수 없습니다.");
            } else {
                alert("시작 시간과 종료 시간이 같습니다. 근무 시간을 확인해 주세요.");
            }
        }
    } catch (e) {
        console.error(e);
    }
}
function autoFillWeekendHoliday(startDateObj, totalHoursArg) {
    try {
        const sd = document.getElementById('wageStartDate')?.value;
        const sh = parseInt(document.getElementById('wageStartHour')?.value, 10) || 0;
        const ed = document.getElementById('wageEndDate')?.value;
        const eh = parseInt(document.getElementById('wageEndHour')?.value, 10) || 0;
        if (!sd) return 0;

        const startD = startDateObj instanceof Date && !isNaN(startDateObj.getTime())
            ? startDateObj
            : new Date(`${sd}T${String(sh).padStart(2, '0')}:00:00`);

        let hours = Number(totalHoursArg);
        if (!hours || hours <= 0) {
            const totalInput = parseFloat(document.getElementById('wageTotalHours')?.value) || 0;
            if (totalInput > 0) {
                hours = totalInput;
            } else if (ed) {
                const endD = new Date(`${ed}T${String(eh).padStart(2, '0')}:00:00`);
                const diff = Math.floor((endD.getTime() - startD.getTime()) / (1000 * 60 * 60));
                if (diff > 0) hours = diff;
            }
        }

        let weekendHolidayHours = 0;
        if (hours > 0) {
            for (let i = 0; i < hours; i++) {
                const slotDate = new Date(startD.getTime() + i * 60 * 60 * 1000);
                if (isWeekendOrPublicHolidayDate(slotDate)) {
                    weekendHolidayHours++;
                }
            }
        }

        const weekendEl = document.getElementById('wageWeekend');
        if (weekendEl && !weekendEl.dataset.userModified) {
            weekendEl.value = weekendHolidayHours > 0 ? String(weekendHolidayHours) : '';
            const typeSelect = document.getElementById('wageAllowanceType');
            const hoursInput = document.getElementById('wageAllowanceHours');
            if (typeSelect && hoursInput && typeSelect.value === 'wageWeekend') {
                hoursInput.value = weekendEl.value;
            }
        }
        return weekendHolidayHours;
    } catch (e) {
        return 0;
    }
}

function changeWageAllowanceType() {
    const typeSelect = document.getElementById("wageAllowanceType");
    const hoursInput = document.getElementById("wageAllowanceHours");
    const storedInput = typeSelect
        ? document.getElementById(typeSelect.value)
        : null;

    if (hoursInput) hoursInput.value = storedInput?.value || "";
}

function updateSelectedWageAllowanceHours(hours) {
    const typeSelect = document.getElementById("wageAllowanceType");
    const storedInput = typeSelect
        ? document.getElementById(typeSelect.value)
        : null;

    if (storedInput) {
        storedInput.value = hours;
        if (String(hours).trim() !== "") {
            storedInput.dataset.userModified = "1";
        } else {
            delete storedInput.dataset.userModified;
        }
    }
    invalidateCalculatedWage();
}

function calculateWageSegment(period, options) {
    const {
        startDate,
        endDate,
        startHour = 0,
        endHour = 0,
        hours = 0
    } = period || {};
    const {
        baseRate = 10320,
        skilled: skilledOpt,
        isSkilled = false,
        roleLabel = "본선",
        holidayH = 0,
        rainH = 0,
        hotH = 0,
        weekendH = null
    } = options || {};
    const skilled = Boolean(skilledOpt ?? isSkilled);

    const SKILLED_DAY_ADD = 2557;
    const SKILLED_NIGHT_ADD = 3836;
    const startD = new Date(`${startDate}T${String(startHour).padStart(2, "0")}:00:00`);

    let dayHours = 0;
    let nightHours = 0;
    let autoWeekendHolidayHours = 0;

    for (let i = 0; i < hours; i++) {
        const slotDate = new Date(startD.getTime() + i * 60 * 60 * 1000);
        const slotMonth = slotDate.getMonth() + 1;
        const { dayStart, dayEnd } = getSeasonScheduleByMonth(slotMonth);
        const currentHour = slotDate.getHours();
        if (currentHour >= dayStart && currentHour < dayEnd) dayHours++;
        else nightHours++;

        if (isWeekendOrPublicHolidayDate(slotDate)) {
            autoWeekendHolidayHours++;
        }
    }

    const effectiveWeekendH = (weekendH !== null && weekendH !== undefined && !isNaN(Number(weekendH)))
        ? Number(weekendH)
        : autoWeekendHolidayHours;

    const dayAmt = dayHours * baseRate;
    const nightAmt = nightHours * baseRate * 1.5;
    const skilledAmt = skilled ? dayHours * SKILLED_DAY_ADD + nightHours * SKILLED_NIGHT_ADD : 0;
    const holidayAmt = holidayH * baseRate * 0.5;
    const weekendAmt = effectiveWeekendH * baseRate * 0.5;
    const rainAmt = rainH * baseRate * 0.5;
    const hotAmt = hotH * baseRate * 0.3;

    const subTotal =
        dayAmt + nightAmt + skilledAmt +
        holidayAmt + weekendAmt + rainAmt + hotAmt;
    const totalPay = Math.round(subTotal);

    let extraHtml = "";
    if (holidayAmt > 0) extraHtml += renderRow("🚜 지게차 수당 (" + holidayH + "H)", holidayAmt, "#ea580c");
    if (weekendAmt > 0) {
        const weekendLabel = autoWeekendHolidayHours > 0
            ? "🗓️ 주말·공휴일 수당 (" + effectiveWeekendH + "H)"
            : "🎈 특별·주말 수당 (" + effectiveWeekendH + "H)";
        extraHtml += renderRow(weekendLabel, weekendAmt, "#3b82f6");
    }
    if (rainAmt > 0) extraHtml += renderRow("☔ 우천 수당 (" + rainH + "H)", rainAmt, "#0284c7");
    if (hotAmt > 0) extraHtml += renderRow("☀️ 혹서기(30%) 수당 (" + hotH + "H)", hotAmt, "#d97706");
    if (holidayAmt === 0 && weekendAmt === 0 && rainAmt === 0 && hotAmt === 0) {
        extraHtml += renderRow("➕ 추가 가산 수당", 0);
    }

    // 내역서에 원천징수 행을 추가하지 않음
    const rows =
        ` ${renderRow("☀️ 주간 기본 (" + dayHours + "H)", dayAmt)}` +
        ` ${renderRow("🌙 야간 할증 (" + nightHours + "H)", nightAmt)}` +
        ` ${renderRow("🔧 기능공 수당 추가", skilledAmt, "var(--primary)")}` +
        ` ${extraHtml}`;

    const summary =
        `[${roleLabel}] ${startDate} ${String(startHour).padStart(2, "0")}시~` +
        `${endDate} ${String(endHour).padStart(2, "0")}시 · ` +
        `총 ${hours}H (주간 ${dayHours}H / 야간 ${nightHours}H${effectiveWeekendH > 0 ? ` / 주말·공휴일 ${effectiveWeekendH}H` : ""})`;

    return {
        startDate,
        endDate,
        startHour,
        endHour,
        hours,
        dayHours,
        nightHours,
        autoWeekendHolidayHours,
        weekendH: effectiveWeekendH,
        dayAmt,
        nightAmt,
        skilledAmt,
        holidayAmt,
        weekendAmt,
        rainAmt,
        hotAmt,
        totalPay,
        rows,
        rowsHtml: rows,
        summary
    };
}

function calculateWage() {
    try {
        const sd = document.getElementById('wageStartDate').value;
        const sh = parseInt(document.getElementById('wageStartHour').value, 10) || 0;
        const wageEndDate = document.getElementById('wageEndDate').value;
        const wageEndHour = parseInt(document.getElementById('wageEndHour').value, 10) || 0;
        if (!sd || !wageEndDate) {
            alert("근무 날짜를 선택해 주세요.");
            return;
        }

        const multi = selectedWageVessels.length > 1;
        let firstHours = parseFloat(document.getElementById('wageTotalHours').value) || 0;
        let restPeriods = [];

        if (multi) {
            firstHours = periodHours(sd, sh, wageEndDate, wageEndHour);
            // 2~4번 선박: 스케줄 입·출항 시각으로 각각 산정 후 합산
            restPeriods = selectedWageVessels.slice(1, MAX_WORK_VESSELS)
                .map(item => getSelectedVesselPeriod(item.vessel, item.date));
            if (firstHours <= 0 || restPeriods.some(period => !period.hours)) {
                alert(`선택한 ${selectedWageVessels.length}척 선박의 입·출항 근무 시간이 모두 확인되어야 합산 계산할 수 있습니다.`);
                return;
            }
            const totalEl = document.getElementById('wageTotalHours');
            if (totalEl) {
                totalEl.value = firstHours + restPeriods.reduce((sum, period) => sum + period.hours, 0);
                totalEl.readOnly = true;
            }
        } else if (firstHours <= 0) {
            alert("총 근무 시간이 0시간입니다. [⏱️ 시간 설정 완료] 버튼을 누르거나 총 근무 시간을 입력해 주세요.");
            return;
        }

        const isSkilled = Boolean(document.getElementById('role-skilled')?.checked);
        const roleLabel = isSkilled ? '기능공' : (document.getElementById('role-onshore')?.checked ? '육상' : '본선');
        const weekendInputEl = document.getElementById('wageWeekend');
        const manualWeekendH = parseFloat(weekendInputEl?.value);
        const baseRate = parseFloat(document.getElementById('wageHourly')?.value) || 10320;

        const month = parseInt(sd.split('-')[1], 10) || (new Date(sd).getMonth() + 1);
        highlightSeasonRow(month);

        const common = {
            baseRate,
            skilled: isSkilled,
            roleLabel,
            holidayH: Number(document.getElementById('wageHoliday')?.value) || 0,
            rainH: Number(document.getElementById('wageRain')?.value) || 0,
            hotH: Number(document.getElementById('wageHotTime')?.value) || 0,
            weekendH: (weekendInputEl?.dataset.userModified && !isNaN(manualWeekendH))
                ? manualWeekendH
                : null
        };

        const firstPeriod = {
            startDate: sd,
            endDate: wageEndDate,
            startHour: sh,
            endHour: wageEndHour,
            hours: firstHours
        };
        const first = calculateWageSegment(firstPeriod, common);

        if (weekendInputEl && !weekendInputEl.dataset.userModified) {
            weekendInputEl.value = first.autoWeekendHolidayHours > 0 ? String(first.autoWeekendHolidayHours) : '';
            const typeSelect = document.getElementById('wageAllowanceType');
            const hoursInput = document.getElementById('wageAllowanceHours');
            if (typeSelect && hoursInput && typeSelect.value === 'wageWeekend') {
                hoursInput.value = weekendInputEl.value;
            }
        }

        const rawShipInput =
            document.getElementById("wageShipName")?.value.trim() ||
            selectedWageScheduleShipName ||
            "";
        const firstName = multi
            ? selectedWageVessels[0].name
            : (selectedWageVessels[0]?.name || rawShipInput);

        const segments = [{ ...first, name: firstName, hours: firstHours }];

        if (multi) {
            restPeriods.forEach((period, restIndex) => {
                const part = calculateWageSegment(period, {
                    ...common,
                    holidayH: 0,
                    rainH: 0,
                    hotH: 0,
                    weekendH: null
                });

                segments.push({
                    ...part,
                    name: selectedWageVessels[restIndex + 1].name,
                    hours: period.hours
                });
            });
        }

        const isDoubleOrder = multi || Boolean(
            document.getElementById('wageDoubleOrder')?.checked
        );
        const finalTotal = segments.reduce((sum, item) => sum + item.totalPay, 0);
        const totalHours = segments.reduce((sum, item) => sum + item.hours, 0);
        const wageShipName = multi
            ? segments.map(item => item.name).join(' / ')
            : firstName;

        lastCalculatedWageData = {
            isDoubleOrder,
            isMultiVessel: multi,
            segments,
            date: sd,
            endDate: wageEndDate,
            startHour: sh,
            endHour: wageEndHour,
            totalHours,
            totalPay: finalTotal,
            shipName: wageShipName,
            terminalId: selectedScheduleTerminal,
            vesselCount: multi ? segments.length : 1,
            orderLabel: multi ? getMultiOrderLabel(segments.length) : "",
            summary: multi
                ? segments.map((part, idx) => `[${getMultiOrderLabel(segments.length)} · 임금 ${idx + 1} · ${part.name}] ${part.summary}`).join('\n')
                : first.summary
        };

        const specBody = document.getElementById('wageSpecBody');
        if (multi) {
            specBody.innerHTML = segments.map((seg, idx) =>
                `<tr><td colspan="2" style="padding:10px 0 4px; font-weight:900; color:var(--primary); border-top:${idx > 0 ? '2px dashed var(--border)' : 'none'};">🚢 선박 ${idx + 1} (임금 ${idx + 1}): ${escapeShipCommentHtml(seg.name)} · ${seg.hours}H</td></tr>` +
                seg.rowsHtml +
                `<tr><td style="padding:6px 0 10px; font-weight:900; color:var(--primary);">💰 임금 ${idx + 1} 소계</td><td style="text-align:right; font-weight:900; color:var(--primary);">${seg.totalPay.toLocaleString()}원</td></tr>`
            ).join("");
        } else {
            specBody.innerHTML = first.rowsHtml;
        }

        document.getElementById('wageResultTitle').innerText = multi
            ? `📋 ${getMultiOrderLabel(segments.length)} 선박별 임금 산정 내역서 (${segments.map((_, idx) => `임금 ${idx + 1}`).join(' · ')})`
            : (isDoubleOrder
                ? '📋 더블오더 임금 산정 내역서 (임금 2)'
                : '📋 임금 산정 내역서');
        document.getElementById('wageTotal').innerText = finalTotal.toLocaleString() + "원";
        document.getElementById('wageResultBox').classList.remove('hidden');
        updateWageHoursBreakdown();
        trackAppEvent('actions', 'wage_calc');

        if (isDoubleOrder && !multi) {
            // 같은 날짜의 첫 번째 작업은 보존하고, 두 번째 작업만 임금 2로 전송한다.
            void sendCalculatedWageToLog();
        } else {
            showToast("상세 계산서가 생성되었습니다!");
        }
        if (wageShipName && !isDoubleOrder) {
            setTimeout(() => startVesselInfoFollowUp("wage", {
                vesselName: wageShipName,
                date: sd,
                terminalId: selectedScheduleTerminal
            }), 0);
        }
    } catch (e) {
        console.error(e);
        alert("계산 오류: 입력창 값을 확인해 주세요.");
    }
}
function onWageShipNameChange(value) {
    const trimmed = String(value || "").trim();
    const parts = trimmed.split(" / ").map(s => s.trim()).filter(Boolean);
    selectedWageVessels = selectedWageVessels.filter(item => parts.includes(item.name));
    selectedWageScheduleShipName = trimmed;
    invalidateCalculatedWage();
    refreshWageWorkHours();
    const dateStr = typeof getWageScheduleDate === "function"
        ? getWageScheduleDate()
        : document.getElementById("wageStartDate")?.value;
    if (dateStr) {
        const cacheKey = `${selectedScheduleTerminal}_${dateStr.slice(0, 7)}`;
        if (hjncScheduleMonthCache[cacheKey]) {
            renderWageScheduledShipsUI(dateStr, hjncScheduleMonthCache[cacheKey], selectedScheduleTerminal);
        }
    }
}
let wageToLogTransferPending = false;
async function sendCalculatedWageToLog() {
    if (!lastCalculatedWageData || wageToLogTransferPending) return;
    wageToLogTransferPending = true;
    // 체크박스나 선박 입력을 나중에 바꿔도 이미 계산한 내역의 대상이 바뀌지 않도록 고정한다.
    const calculatedData = lastCalculatedWageData;
    const { date, totalPay, summary, shipName, isDoubleOrder, isMultiVessel } = calculatedData;
    try {
        const form = document.getElementById("dailyLogForm");
        const sameDateDraft = form?.getAttribute("data-date") === date && !form.classList.contains("hidden");
        if (isDoubleOrder && !isMultiVessel && !sameDateDraft && currentWorkerId) {
            // 달력을 다른 달로 이동한 경우에도 저장된 첫 선박/임금을 읽어 덮어쓰지 않는다.
            const doc = await db.collection('work_logs').doc(`${currentWorkerId}_${date}`).get();
            if (lastCalculatedWageData !== calculatedData) return;
            if (doc.exists) adminWorkLogs[date] = doc.data();
            else delete adminWorkLogs[date];
        }

        const logCard = document.getElementById("log-card");
        if (logCard && !logCard.classList.contains("expanded")) toggleDashItem("log-card");
        if (!sameDateDraft) jumpToLogDate(date);

        const memoInput = document.getElementById("logMemo");
        const logShipInput = document.getElementById("logShipName");

        if (calculatedData.isMultiVessel && Array.isArray(calculatedData.segments) && calculatedData.segments.length >= 2) {
            const parts = calculatedData.segments.slice(0, MAX_WORK_VESSELS);
            const orderLabel = getMultiOrderLabel(parts.length);
            for (let slot = 1; slot <= MAX_WORK_VESSELS; slot++) {
                const wageEl = document.getElementById(`logWage${slot}`);
                if (!wageEl) continue;
                const part = parts[slot - 1];
                if (part) wageEl.value = part.totalPay;
                else if (slot > 2) wageEl.value = "";
            }
            syncWorklogWageSlotVisibility(parts.length);

            if (logShipInput) {
                logShipInput.value = parts.map(item => item.name).join(" / ");
            }

            const lines = parts.map((part, index) =>
                `[${orderLabel} · 임금 ${index + 1} · ${part.name}] ${part.summary}`
            );
            if (memoInput) {
                lines.forEach(line => {
                    if (!memoInput.value.includes(line)) {
                        memoInput.value = memoInput.value
                            ? `${memoInput.value}\n${line}`
                            : line;
                    }
                });
                if (typeof autoGrowWorkLogMemo === 'function') autoGrowWorkLogMemo(memoInput);
            }

            if (typeof refreshWorklogVesselList === "function") refreshWorklogVesselList(); trackAppEvent("actions", "wage_to_log");
            showToast(`📅 ${orderLabel} 선박 ${parts.length}척의 금액을 ${parts.map((_, idx) => `임금 ${idx + 1}`).join("·")}에 각각 입력했습니다. 저장을 눌러 기록하세요.`);
            return;
        }

        const wageInput = document.getElementById(isDoubleOrder ? "logWage2" : "logWage1");
        if (wageInput) wageInput.value = totalPay;
        if (logShipInput && shipName) {
            if (isDoubleOrder) {
                const ships = logShipInput.value.trim().split(' / ').filter(Boolean);
                if (!ships.includes(shipName)) ships.push(shipName);
                logShipInput.value = ships.join(' / ');
            } else {
                logShipInput.value = shipName;
            }
        }

        const logSummary = isDoubleOrder
            ? `[더블오더 · 임금 2${shipName ? ` · ${shipName}` : ''}] ${summary}`
            : summary;
        if (memoInput && !memoInput.value.includes(logSummary)) {
            memoInput.value = memoInput.value
                ? `${memoInput.value}\n${logSummary}`
                : logSummary;
            if (typeof autoGrowWorkLogMemo === 'function') autoGrowWorkLogMemo(memoInput);
        }

        if (typeof refreshWorklogVesselList === "function") refreshWorklogVesselList(); trackAppEvent("actions", "wage_to_log");
        showToast(isDoubleOrder
            ? `📅 더블오더 금액을 임금 2에 입력했습니다. 기존 임금 1을 확인하고 근무일지를 저장하세요.`
            : (shipName
                ? `📅 ${shipName} 선박명과 계산 임금을 근무일지에 입력했습니다. 저장을 눌러 기록하세요.`
                : "📅 계산 임금을 근무일지에 입력했습니다. 저장을 눌러 기록하세요."));
    } catch (error) {
        console.error("근무일지 불러오기 실패:", error);
        showToast("⚠️ 기존 근무일지를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
        wageToLogTransferPending = false;
        // 저장된 내역을 읽는 동안 다시 계산했다면 가장 최근 더블오더를 전송한다.
        if (lastCalculatedWageData && lastCalculatedWageData !== calculatedData && lastCalculatedWageData.isDoubleOrder && !lastCalculatedWageData.isMultiVessel) {
            void sendCalculatedWageToLog();
        }
    }
}
async function sendWorkLogShipToWage() {
    const rawName =
        document.getElementById("logShipName")?.value.trim() || "";
    if (!rawName) {
        return showToast("근무일지에 선박명을 먼저 입력해 주세요.");
    }

    const shipNames = rawName
        .split(/\s*\/\s*|\s*,\s*/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, MAX_WORK_VESSELS);

    const card = document.getElementById("wage-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("wage-card");
    }

    invalidateCalculatedWage();
    selectedWageVessels = [];
    selectedWageScheduleShipName = "";

    const totalHoursInput = document.getElementById("wageTotalHours");
    if (totalHoursInput) {
        totalHoursInput.value = "";
        totalHoursInput.readOnly = false;
    }

    const logDate =
        document.getElementById("dailyLogForm")?.getAttribute("data-date") ||
        document.getElementById("wageStartDate")?.value ||
        getAppLocalDateString();

    if (logDate) {
        const startDate = document.getElementById("wageStartDate");
        const endDate = document.getElementById("wageEndDate");

        if (startDate) startDate.value = logDate;
        if (endDate) endDate.value = logDate;
        if (typeof setWageScheduleDate === "function") setWageScheduleDate(logDate);

        const logMonth = parseInt(logDate.split("-")[1], 10);
        highlightSeasonRow(logMonth);
        applySeasonDefaultHours(logMonth, false);
    }

    let scheduleVessels = [];
    if (logDate) {
        const cacheKey = `${selectedScheduleTerminal}_${logDate.slice(0, 7)}`;
        scheduleVessels = hjncScheduleMonthCache[cacheKey] || [];
        if (scheduleVessels.length === 0 && typeof fetchHjncScheduleForMonth === "function") {
            try {
                scheduleVessels = (await fetchHjncScheduleForMonth(
                    logDate.slice(0, 7),
                    false,
                    selectedScheduleTerminal
                )) || [];
            } catch (e) {
                scheduleVessels = [];
            }
        }
    }

    const matchedVessels = [];
    const missingNames = [];

    shipNames.forEach(targetName => {
        const cleaned = targetName.replace(/^\[[^\]]+\]\s*/, "").trim().toUpperCase();
        const found = scheduleVessels.find(v => {
            const vName = String(v?.VSL_NM || "").trim().toUpperCase();
            return vName && (vName === cleaned || vName === targetName.toUpperCase());
        });
        if (found) {
            const period = getSelectedVesselPeriod(found, logDate);
            if (period.hours > 0) {
                matchedVessels.push(found);
            } else {
                matchedVessels.push(found);
                missingNames.push(targetName);
            }
        } else {
            missingNames.push(targetName);
        }
    });

    if (matchedVessels.length > 0) {
        matchedVessels.forEach(vessel => {
            applyWageScheduleShip(vessel, logDate, selectedScheduleTerminal);
        });
    } else {
        const input = document.getElementById("wageShipName");
        if (input) input.value = shipNames.join(" / ");
        selectedWageScheduleShipName = shipNames.join(" / ");
        const doubleOrderEl = document.getElementById("wageDoubleOrder");
        if (doubleOrderEl) doubleOrderEl.checked = shipNames.length >= 2;
        refreshWageWorkHours();
        if (logDate && typeof loadWageScheduledShipsForDate === "function") {
            loadWageScheduledShipsForDate(logDate, false);
        }
    }

    document.getElementById("wage-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });

    if (missingNames.length > 0) {
        showToast(
            `🚢 ${shipNames.join(" / ")} 선박을 임금계산기로 보냈습니다. 스케줄 시각을 확인할 수 없어 근무 시간을 직접 확인해 주세요.`
        );
    } else {
        showToast(
            `🚢 ${shipNames.join(" / ")} 선박의 스케줄 입·출항 시각을 임금계산기에 반영했습니다.`
        );
    }
}
function resetWageForm() {
    try {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const todayStr = now.toISOString().split('T')[0];
        ['wageTotalHours', 'wageShipName', 'wageAllowanceHours', 'wageHoliday', 'wageWeekend', 'wageRain', 'wageHotTime'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
                delete el.dataset.userModified;
            }
        });
        const totalHoursEl = document.getElementById('wageTotalHours');
        if (totalHoursEl) totalHoursEl.readOnly = false;
        const allowanceType = document.getElementById('wageAllowanceType');
        if (allowanceType) allowanceType.value = 'wageHoliday';
        const sDate = document.getElementById('wageStartDate');
        const eDate = document.getElementById('wageEndDate');
        const hourlyEl = document.getElementById('wageHourly');
        if (hourlyEl) {
            delete hourlyEl.dataset.userModified;
            hourlyEl.value = '10320';
        }
        selectedWageScheduleShipName = "";
        selectedWageVessels = [];
        if (sDate) sDate.value = todayStr;
        if (eDate) eDate.value = todayStr;
        if (typeof syncWageHourlyYearLabel === 'function') syncWageHourlyYearLabel(todayStr);
        if (typeof setWageScheduleDate === 'function') setWageScheduleDate(todayStr);
        const curMonth = parseInt(todayStr.split('-')[1], 10) || (now.getMonth() + 1);
        highlightSeasonRow(curMonth);
        applySeasonDefaultHours(curMonth, true);
        const doubleOrder = document.getElementById('wageDoubleOrder');
        if (doubleOrder) doubleOrder.checked = false;
        invalidateCalculatedWage();
        updateWageHoursBreakdown();
        if (typeof loadWageScheduledShipsForDate === 'function') {
            loadWageScheduledShipsForDate(todayStr, false);
        }
        showToast("🔄 임금계산기 입력값이 초기화되었습니다.");
    } catch (e) {
        console.error(e);
    }
}
// --- [3순위 자동화] 1) 이미지 용량 자동 최적화(1~2MB 이하 WebP/JPEG 압축) & 2) 금칙어·도배 자동 블라인드 ---
const COMMUNITY_BANNED_WORDS = [
    "씨발", "시발", "병신", "개새끼", "좆같", "미친놈", "꺼져라", "죽어라",
    "쓰레기새끼", "지랄", "염병", "불법도박", "토토사이트", "카지노사이트", "바카라사이트", "성인용품"
];
const recentCommunitySubmissions = [];
const COMMUNITY_FLOOD_WINDOW_MS = 3 * 60 * 1000;

function normalizeModerationText(value) {
    return String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\u200B\u200C\u200D._\-~*!@#$%^&()+=|<>?/,;:'"`[\]{}\\]+/g, "");
}

function inspectCommunityContent(payload = {}) {
    const rawTitle = String(payload.title || "").trim();
    const rawText = String(payload.text || "").trim();
    const combinedRaw = `${rawTitle} ${rawText}`.trim();
    const normalized = normalizeModerationText(combinedRaw);
    const category = String(payload.category || "community");
    const author = String(payload.author || "익명").trim();
    const nowMs = typeof payload.nowMs === "number" ? payload.nowMs : Date.now();

    if (!combinedRaw) {
        return { hidden: false, reason: null, matchedTerm: null };
    }

    for (const badWord of COMMUNITY_BANNED_WORDS) {
        const normBad = normalizeModerationText(badWord);
        if (normBad && normalized.includes(normBad)) {
            return {
                hidden: true,
                reason: "금칙어/비방 표현 감지",
                matchedTerm: badWord
            };
        }
    }

    if (/(.)\1{14,}/.test(combinedRaw)) {
        return {
            hidden: true,
            reason: "동일 문자 반복(도배) 감지",
            matchedTerm: "REPEATED_CHARS"
        };
    }
    const urlCount = (combinedRaw.match(/https?:\/\/[^\s]+/gi) || []).length;
    if (urlCount >= 4) {
        return {
            hidden: true,
            reason: "과도한 외부 링크(스팸) 감지",
            matchedTerm: "EXCESSIVE_URLS"
        };
    }

    while (recentCommunitySubmissions.length > 0 && nowMs - recentCommunitySubmissions[0].timestampMs > COMMUNITY_FLOOD_WINDOW_MS) {
        recentCommunitySubmissions.shift();
    }
    if (normalized.length >= 4) {
        const duplicateCount = recentCommunitySubmissions.filter(
            item => item.category === category && item.normalized === normalized
        ).length;
        recentCommunitySubmissions.push({
            category,
            author,
            normalized,
            timestampMs: nowMs
        });
        if (duplicateCount >= 1) {
            return {
                hidden: true,
                reason: "동일 내용 반복 등록(도배) 감지",
                matchedTerm: "DUPLICATE_FLOOD"
            };
        }
    }

    return { hidden: false, reason: null, matchedTerm: null };
}

function notifyAdminAutoBlind(info = {}) {
    try {
        if (typeof db === "undefined" || !db || typeof db.collection !== "function") return;
        const createdAt = (typeof firebase !== "undefined" && firebase.firestore && firebase.firestore.FieldValue)
            ? firebase.firestore.FieldValue.serverTimestamp()
            : new Date();
        const snippet = String(info.title || info.text || "").slice(0, 60);
        db.collection("notifications").add({
            userId: "ADMIN",
            title: "🚨 커뮤니티 자동 블라인드 감지",
            body: `[${info.category || "게시판"}] 작성자(${info.author || "익명"})의 게시물이 자동 숨김 처리되었습니다. 사유: ${info.reason || "규칙 위반"} (${snippet})`,
            type: "AUTO_BLIND",
            category: info.category || "board",
            reason: info.reason || null,
            read: false,
            createdAt
        }).catch(() => {});
    } catch (e) {}
}

async function compressImageForUpload(file, options = {}) {
    if (!file || typeof file !== "object") return file;
    const mime = String(file.type || "").toLowerCase();
    if (!mime.startsWith("image/") || mime === "image/gif" || mime === "image/svg+xml") {
        return file;
    }

    const maxDimension = Number(options.maxDimension) || 1600;
    const targetMaxBytes = Number(options.targetMaxBytes) || (1.5 * 1024 * 1024);
    const skipUnderBytes = Number(options.skipUnderBytes) || (900 * 1024);

    if (!options.force && typeof file.size === "number" && file.size > 0 && file.size <= skipUnderBytes) {
        return file;
    }

    if (typeof document === "undefined" || typeof Image === "undefined") {
        return file;
    }

    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target && e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        if (!dataUrl) return file;

        const img = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = dataUrl;
        });

        const origW = Number(img.naturalWidth || img.width) || 0;
        const origH = Number(img.naturalHeight || img.height) || 0;
        if (!origW || !origH) return file;

        let targetW = origW;
        let targetH = origH;
        if (Math.max(origW, origH) > maxDimension) {
            if (origW >= origH) {
                targetW = maxDimension;
                targetH = Math.max(1, Math.round((origH * maxDimension) / origW));
            } else {
                targetH = maxDimension;
                targetW = Math.max(1, Math.round((origW * maxDimension) / origH));
            }
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx || typeof canvas.toBlob !== "function") return file;
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const preferredTypes = ["image/webp", "image/jpeg"];
        const qualities = [0.82, 0.72, 0.6];
        let bestBlob = null;

        for (const outType of preferredTypes) {
            for (const q of qualities) {
                const blob = await new Promise((resolve) => {
                    try {
                        canvas.toBlob((b) => resolve(b), outType, q);
                    } catch {
                        resolve(null);
                    }
                });
                if (!blob) continue;
                bestBlob = blob;
                if (blob.size <= targetMaxBytes) break;
            }
            if (bestBlob && bestBlob.size <= targetMaxBytes) break;
        }

        if (!bestBlob || (typeof file.size === "number" && bestBlob.size >= file.size)) {
            return file;
        }

        const ext = bestBlob.type === "image/webp" ? ".webp" : ".jpg";
        const baseName = String(file.name || "photo").replace(/\.[^.]+$/, "");
        const newName = `${baseName}${ext}`;
        if (typeof File === "function") {
            return new File([bestBlob], newName, { type: bestBlob.type, lastModified: Date.now() });
        }
        bestBlob.name = newName;
        return bestBlob;
    } catch {
        return file;
    }
}

let currentEditNoticeId = null; let currentEditNoticeImg = null; function autoLink(text) { if (!text) return ""; const escaped = escapeShipCommentHtml(text); const urlRegex = /(https?:\/\/[^\s<"&']+)/g; return escaped.replace(urlRegex, function(url) { return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#2563eb; text-decoration:underline; font-weight:bold;">${url}</a>`; }); } async function startEditNotice(id, title, content, imgUrl, e) { if (e) e.stopPropagation(); if (!(await verifyAdmin())) return; const noticeObj = (window.allNoticesCache || []).find(n => n.id === id); const finalTitle = noticeObj ? (noticeObj.title || '') : title; const finalContent = noticeObj ? (noticeObj.content || '') : content.replace(/\\n/g, '\n'); const finalImg = noticeObj ? (noticeObj.imageUrl || null) : imgUrl; const isPriority = noticeObj ? Boolean(noticeObj.isPriority) : false; currentEditNoticeId = id; currentEditNoticeImg = finalImg; document.getElementById('noticeTitle').value = finalTitle; document.getElementById('noticeContent').value = finalContent; const priEl = document.getElementById('noticePriority'); if (priEl) priEl.checked = isPriority; document.getElementById('noticeFileInput').value = ''; document.getElementById('noticeForm').classList.remove('hidden'); document.getElementById('noticeSubmitBtn').innerText = "수정 완료"; document.getElementById('noticeSubmitBtn').style.background = "var(--primary)"; document.getElementById('noticeCancelBtn').style.display = "block"; document.getElementById('noticeForm').scrollIntoView({behavior: 'smooth', block: 'center'}); } function cancelEditNotice() { currentEditNoticeId = null; currentEditNoticeImg = null; document.getElementById('noticeTitle').value = ''; document.getElementById('noticeContent').value = ''; const priEl = document.getElementById('noticePriority'); if (priEl) priEl.checked = false; document.getElementById('noticeFileInput').value = ''; document.getElementById('noticeSubmitBtn').innerText = "등록 완료"; document.getElementById('noticeSubmitBtn').style.background = "var(--success)"; document.getElementById('noticeSubmitBtn').disabled = false; document.getElementById('noticeCancelBtn').style.display = "none"; document.getElementById('noticeForm').classList.add('hidden'); } async function saveNotice() { if (!(await verifyAdmin())) return; const t = document.getElementById('noticeTitle').value.trim(); const c = document.getElementById('noticeContent').value.trim(); const isPriority = Boolean(document.getElementById('noticePriority')?.checked); const f = document.getElementById('noticeFileInput').files[0]; const btn = document.getElementById('noticeSubmitBtn'); if (!t || !c) { alert("공지 제목과 내용을 입력해 주세요."); return; } btn.innerText = "서버 기록 중..."; btn.disabled = true; const finalize = (url) => { const data = { title: t, content: c, isPriority: isPriority, timestamp: firebase.firestore.FieldValue.serverTimestamp() }; if (url) { data.imageUrl = url; } else if (currentEditNoticeId && currentEditNoticeImg) { data.imageUrl = currentEditNoticeImg; } else { data.imageUrl = null; } let req; if (currentEditNoticeId) { req = db.collection("notices").doc(currentEditNoticeId).update(data); } else { req = db.collection("notices").add(data); } req.then(() => { const isEdit = !!currentEditNoticeId; cancelEditNotice(); showToast(isEdit ? "공지가 수정되었습니다." : "공지가 등록되었습니다."); }).catch(err => { alert("저장 실패: " + err.message); btn.innerText = currentEditNoticeId ? "수정 완료" : "등록 완료"; btn.disabled = false; }); }; if (f) { const optimizedFile = await compressImageForUpload(f); const storageRef = storage.ref(`notices/${Date.now()}_${optimizedFile.name || f.name}`); const uploadTask = storageRef.put(optimizedFile); uploadTask.on('state_changed', (snap) => { const percent = Math.round((snap.bytesTransferred / snap.totalBytes) * 100); btn.innerText = `사진 업로드 중... ${percent}%`; }, (err) => { alert("사진 업로드 실패: " + err.message); btn.disabled = false; btn.innerText = currentEditNoticeId ? "수정 완료" : "등록 완료"; }, () => { uploadTask.snapshot.ref.getDownloadURL().then(url => finalize(url)); }); } else { finalize(null); } } function delNotice(id,e){ if (e) e.stopPropagation(); verifyAdmin().then(r=>{ if(r) { if(!confirm("이 공지사항을 삭제하시겠습니까?")) return; db.collection("notices").doc(id).delete().then(() => showToast("공지가 삭제되었습니다.")).catch(err => alert("삭제 실패: " + err.message)); } }); }

const PORT_NICKNAME_STORAGE_KEY = "busanHakPortBoardNickname";
const PORT_NICKNAME_OPTIONS = [
    "부산항 도선사", "신항 도선사", "북항 예선장", "선석 지킴이",
    "컨테이너 포맨", "야드 검수원", "라싱 반장", "크레인 운전원",
    "샤시 기사", "부두 하역반장", "접안 안내원", "갠트리 크레인 기사",
    "RTGC 조종수", "리치스태커 기사", "본선 작업자", "화물 고박 담당",
    "터미널 배차원", "적재 검수원", "양하 작업자", "항만 안전요원",
    "신항 장비반장", "북항 포맨", "벌크 하역 작업자", "갑판 작업자",
    "야드 트랙터 기사", "선석 배정 담당", "컨테이너 기사", "하역 작업반장"
];

function pickPortNickname(previousNickname = "") {
    const options = PORT_NICKNAME_OPTIONS.filter(nickname => nickname !== previousNickname);
    const availableOptions = options.length ? options : PORT_NICKNAME_OPTIONS;
    return availableOptions[Math.floor(Math.random() * availableOptions.length)];
}

function getPortNickname(forceNew = false) {
    let savedNickname = "";
    try {
        savedNickname = localStorage.getItem(PORT_NICKNAME_STORAGE_KEY) || "";
    } catch (error) {
        // Private browsing settings may block localStorage; generation still works for this visit.
    }

    if (!forceNew && PORT_NICKNAME_OPTIONS.includes(savedNickname)) return savedNickname;

    const nickname = pickPortNickname(savedNickname);
    try {
        localStorage.setItem(PORT_NICKNAME_STORAGE_KEY, nickname);
    } catch (error) {
        // Keep the generated nickname in the current form even when it cannot be persisted.
    }
    return nickname;
}

function toggleBoardForm() {
    const form = document.getElementById("boardForm");
    if (!form) return;

    const isOpening = form.classList.contains("hidden");
    if (isOpening && !currentEditPostId) {
        const nicknameInput = document.getElementById("inputNick");
        if (nicknameInput && !nicknameInput.value.trim()) {
            nicknameInput.value = getPortNickname();
        }
    }
    form.classList.toggle("hidden");
}

function refreshBoardNickname() {
    const nicknameInput = document.getElementById("inputNick");
    if (!nicknameInput) return;
    nicknameInput.value = getPortNickname(true);
    nicknameInput.focus();
}

let currentEditPostFileUrl = null;
let currentEditPostFileName = null;
let currentEditPostFileType = null;
let currentEditPostAttachments = null;
let currentEditPostImageUrls = null;
const BOARD_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const BOARD_MAX_IMAGE_COUNT = 10;

function updateBoardSelectedFilesInfo(files, existingCount = 0) {
    const infoEl = document.getElementById("boardSelectedFilesInfo");
    if (!infoEl) return;
    if (files && files.length > 0) {
        const totalBytes = Array.from(files).reduce((sum, f) => sum + (f.size || 0), 0);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
        const names = Array.from(files).map(f => escapeShipCommentHtml(f.name)).join(", ");
        infoEl.innerHTML = `🖼️ 선택된 파일 <strong>${files.length}개</strong> (총 ${totalMb}MB / 최대 10MB)<div style="font-weight:700; color:var(--text-sub); font-size:0.72rem; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${names}</div>`;
        infoEl.classList.remove("hidden");
    } else if (existingCount > 0) {
        infoEl.innerHTML = `📎 기존 첨부파일 <strong>${existingCount}개</strong> 유지 중 (새 파일 선택 시 교체됩니다)`;
        infoEl.classList.remove("hidden");
    } else {
        infoEl.innerHTML = "";
        infoEl.classList.add("hidden");
    }
}

function validateBoardFileSize(inputEl) {
    if (!inputEl || !inputEl.files || inputEl.files.length === 0) {
        updateBoardSelectedFilesInfo(null, currentEditPostAttachments ? currentEditPostAttachments.length : 0);
        return true;
    }
    const files = Array.from(inputEl.files);
    if (files.length > BOARD_MAX_IMAGE_COUNT) {
        alert(`⚠️ 파일은 한 번에 최대 ${BOARD_MAX_IMAGE_COUNT}장(개)까지만 선택할 수 있습니다.\n(현재 선택: ${files.length}개)`);
        inputEl.value = "";
        updateBoardSelectedFilesInfo(null, currentEditPostAttachments ? currentEditPostAttachments.length : 0);
        return false;
    }
    if (files.length > 1) {
        const nonImageFile = files.find(f => !(f.type && f.type.startsWith("image/")) && !/\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif)$/i.test(f.name || ""));
        if (nonImageFile) {
            alert(`⚠️ 다중 선택(최대 10장)은 이미지 파일만 가능합니다.\n(일반 첨부파일은 1개씩 업로드해 주세요: ${nonImageFile.name})`);
            inputEl.value = "";
            updateBoardSelectedFilesInfo(null, currentEditPostAttachments ? currentEditPostAttachments.length : 0);
            return false;
        }
    }
    let totalBytes = 0;
    for (const file of files) {
        totalBytes += file.size || 0;
    }
    if (totalBytes > BOARD_MAX_FILE_SIZE_BYTES) {
        const sizeMb = (totalBytes / (1024 * 1024)).toFixed(2);
        alert(`⚠️ 선택한 파일의 총 합산 용량은 10MB를 초과할 수 없습니다.\n(선택한 ${files.length}개 파일 합계: ${sizeMb}MB)`);
        inputEl.value = "";
        updateBoardSelectedFilesInfo(null, currentEditPostAttachments ? currentEditPostAttachments.length : 0);
        return false;
    }
    updateBoardSelectedFilesInfo(files);
    return true;
}

async function uploadSingleBoardFile(file, index, totalCount, btnEl) {
    const isImg = Boolean((file.type && file.type.startsWith("image/")) || /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif)$/i.test(file.name || ""));
    const targetFile = isImg ? (await compressImageForUpload(file)) : file;
    return new Promise((resolve, reject) => {
        const safeName = ((targetFile && targetFile.name) || file.name || `file_${index + 1}`).replace(/[^\w.\-가-힣]/g, "_");
        const storageRef = storage.ref(`posts/${Date.now()}_${index}_${safeName}`);
        const uploadTask = storageRef.put(targetFile || file);
        uploadTask.on('state_changed', (snap) => {
            const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
            if (btnEl) {
                btnEl.innerText = totalCount > 1
                    ? `파일 업로드 중 (${index + 1}/${totalCount})... ${pct}%`
                    : `파일 업로드 중... ${pct}%`;
            }
        }, (err) => {
            reject(err);
        }, () => {
            uploadTask.snapshot.ref.getDownloadURL().then(url => {
                resolve({
                    url: url,
                    name: (targetFile && targetFile.name) || file.name || `첨부파일_${index + 1}`,
                    type: (targetFile && targetFile.type) || file.type || (isImg ? "image/jpeg" : ""),
                    isImage: isImg
                });
            }).catch(reject);
        });
    });
}

async function addPost() {
    const nickVal = document.getElementById("inputNick").value.trim();
    const titleVal = document.getElementById("inputTitle").value.trim();
    const pwVal = document.getElementById("inputPw").value.trim();
    const contentVal = document.getElementById("inputContent").value.trim();
    const fileInput = document.getElementById("boardFileInput");
    const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
    const btnEl = document.querySelector("#boardForm .bg-submit");

    if (!nickVal || !titleVal || !pwVal || !contentVal) {
        alert("모든 항목을 입력해 주세요.");
        return;
    }

    if (files.length > 0 && !validateBoardFileSize(fileInput)) {
        return;
    }

    btnEl.innerText = "처리 중...";
    btnEl.disabled = true;
    const pwHash = (/^[a-f0-9]{64}$/i.test(pwVal)) ? pwVal.toLowerCase() : (await sha256Hex(pwVal));
    const modResult = inspectCommunityContent({
        title: titleVal,
        text: contentVal,
        author: nickVal,
        category: "왁자지껄 게시판"
    });

    const finalizePost = (uploadedItems) => {
        const postData = {
            nick: nickVal,
            title: titleVal,
            password: pwHash,
            content: contentVal,
            hidden: Boolean(modResult.hidden),
            blindReason: modResult.reason || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (modResult.hidden) {
            notifyAdminAutoBlind({
                category: "왁자지껄 게시판",
                author: nickVal,
                title: titleVal,
                text: contentVal,
                reason: modResult.reason
            });
        }
        if (Array.isArray(uploadedItems) && uploadedItems.length > 0) {
            const firstItem = uploadedItems[0];
            const imageUrls = uploadedItems.filter(item => item.isImage).map(item => item.url);
            postData.attachments = uploadedItems;
            postData.imageUrls = imageUrls;
            postData.fileUrl = firstItem.url;
            postData.fileName = firstItem.name || "첨부파일";
            postData.fileType = firstItem.type || "";
            postData.imageUrl = imageUrls.length > 0 ? imageUrls[0] : null;
        } else if (currentEditPostId && (currentEditPostAttachments || currentEditPostFileUrl)) {
            postData.attachments = currentEditPostAttachments || [];
            postData.imageUrls = currentEditPostImageUrls || (currentEditPostFileUrl && (currentEditPostFileType || "").startsWith("image/") ? [currentEditPostFileUrl] : []);
            postData.fileUrl = currentEditPostFileUrl;
            postData.fileName = currentEditPostFileName || "첨부파일";
            postData.fileType = currentEditPostFileType || "";
            postData.imageUrl = postData.imageUrls.length > 0 ? postData.imageUrls[0] : null;
        }

        if (currentEditPostId) {
            db.collection("posts").doc(currentEditPostId).update(postData).then(() => {
                resetBoardForm();
                showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 게시글이 자동 블라인드 처리되었습니다." : "게시글이 수정되었습니다.");
            }).catch((err) => {
                alert("수정 실패: " + err.message);
                btnEl.innerText = "수정 완료";
                btnEl.disabled = false;
            });
        } else {
            db.collection("posts").add(postData).then(() => {
                resetBoardForm();
                showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 게시글이 자동 블라인드 처리되었습니다." : "게시글이 등록되었습니다.");
            }).catch((err) => {
                alert("등록 실패: " + err.message);
                btnEl.innerText = "등록";
                btnEl.disabled = false;
            });
        }
    };

    if (files.length > 0) {
        try {
            const uploadedItems = [];
            for (let idx = 0; idx < files.length; idx++) {
                const item = await uploadSingleBoardFile(files[idx], idx, files.length, btnEl);
                uploadedItems.push(item);
            }
            finalizePost(uploadedItems);
        } catch (err) {
            alert("파일 업로드 실패: " + (err && err.message ? err.message : err));
            btnEl.innerText = currentEditPostId ? "수정 완료" : "등록";
            btnEl.disabled = false;
        }
    } else {
        finalizePost(null);
    }
}
function resetBoardForm() { document.getElementById('inputNick').value = ''; document.getElementById('inputTitle').value = ''; document.getElementById('inputPw').value = ''; document.getElementById('inputContent').value = ''; const fEl = document.getElementById('boardFileInput'); if(fEl) fEl.value = ''; updateBoardSelectedFilesInfo(null, 0); document.getElementById('boardForm').classList.add('hidden'); const btnEl = document.querySelector('#boardForm .bg-submit'); if(btnEl) { btnEl.innerText = "등록"; btnEl.disabled = false; } const cancelBtn = document.getElementById('boardCancelBtn'); if(cancelBtn) cancelBtn.style.display = "none"; currentEditPostId = null; currentEditPostFileUrl = null; currentEditPostFileName = null; currentEditPostFileType = null; currentEditPostAttachments = null; currentEditPostImageUrls = null; }
async function tryEditPost(id, savedPw, nick, title, content, e) { if (e) e.stopPropagation(); const postObj = (allPostsData || []).find(p => p.id === id); const finalPw = postObj ? (postObj.password || '') : savedPw; const finalNick = postObj ? (postObj.nick || '익명') : nick; const finalTitle = postObj ? (postObj.title || '') : title; const finalContent = postObj ? (postObj.content || '') : content; const inputPw = prompt("게시글 비밀번호를 입력하세요 (작성자 또는 관리자):"); if (inputPw === null) return; const isAuthor = await verifyPasswordMatch(inputPw, finalPw); const inputHash = await sha256Hex(inputPw); const isAdmin = isAdminSessionVerified || (inputHash === DEFAULT_ADMIN_PW_HASH); if (isAuthor || isAdmin) { currentEditPostId = id; currentEditPostFileUrl = postObj ? (postObj.fileUrl || postObj.imageUrl || null) : null; currentEditPostFileName = postObj ? (postObj.fileName || (postObj.imageUrl ? '첨부 이미지' : null)) : null; currentEditPostFileType = postObj ? (postObj.fileType || (postObj.imageUrl ? 'image/jpeg' : '')) : ''; currentEditPostAttachments = postObj && Array.isArray(postObj.attachments) ? postObj.attachments : (currentEditPostFileUrl ? [{ url: currentEditPostFileUrl, name: currentEditPostFileName || '첨부파일', type: currentEditPostFileType, isImage: Boolean(postObj?.imageUrl || (currentEditPostFileType || '').startsWith('image/')) }] : null); currentEditPostImageUrls = postObj && Array.isArray(postObj.imageUrls) ? postObj.imageUrls : (postObj?.imageUrl ? [postObj.imageUrl] : null); document.getElementById('inputNick').value = finalNick; document.getElementById('inputPw').value = isAuthor ? inputPw.trim() : (finalPw || inputPw.trim()); document.getElementById('inputTitle').value = finalTitle; document.getElementById('inputContent').value = finalContent; const fEl = document.getElementById('boardFileInput'); if(fEl) fEl.value = ''; updateBoardSelectedFilesInfo(null, currentEditPostAttachments ? currentEditPostAttachments.length : 0); document.getElementById('boardForm').classList.remove('hidden'); document.querySelector('#boardForm .bg-submit').innerText = "수정 완료"; const cancelBtn = document.getElementById('boardCancelBtn'); if(cancelBtn) cancelBtn.style.display = "block"; document.getElementById('boardForm').scrollIntoView({behavior: 'smooth', block: 'center'}); showToast("수정 모드로 전환되었습니다."); } else alert("⚠️ 비밀번호가 일치하지 않습니다."); }
async function deletePost(id,pw,e){ if (e) e.stopPropagation(); const postObj = (allPostsData || []).find(p => p.id === id); const finalPw = postObj ? (postObj.password || '') : pw; const inputPw = prompt("게시글 비밀번호를 입력하세요 (작성자 또는 관리자):"); if (inputPw === null) return; const isAuthor = await verifyPasswordMatch(inputPw, finalPw); const inputHash = await sha256Hex(inputPw); const isAdmin = isAdminSessionVerified || (inputHash === DEFAULT_ADMIN_PW_HASH); if(isAuthor || isAdmin) { if(!confirm("이 게시글을 삭제하시겠습니까?")) return; db.collection("posts").doc(id).update(softDeletePayload()).then(() => showToast("게시글이 삭제되었습니다.")).catch(err => alert("삭제 실패: " + err.message)); } else { alert("⚠️ 비밀번호가 일치하지 않습니다."); } } 
let boardCommentsById = {};
let editingBoardComment = null;

async function uploadCommentImageFile(file, pathPrefix = "comments") {
    const optimizedFile = await compressImageForUpload(file);
    return new Promise((resolve, reject) => {
        const safeName = ((optimizedFile && optimizedFile.name) || file.name || "comment_image.jpg").replace(/[^\w.\-가-힣]/g, "_");
        const storageRef = storage.ref(`${pathPrefix}/${Date.now()}_${safeName}`);
        const uploadTask = storageRef.put(optimizedFile || file);
        uploadTask.on('state_changed', null, reject, () => {
            uploadTask.snapshot.ref.getDownloadURL().then(resolve).catch(reject);
        });
    });
}

function handleCommentFileChange(pid, inputEl) {
    const file = inputEl.files && inputEl.files[0];
    const previewEl = document.getElementById(`cmt-preview-${pid}`);
    const labelEl = document.getElementById(`cmt-file-label-${pid}`);
    if (!file) {
        delete selectedCommentFiles[pid];
        if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
        if (labelEl) labelEl.classList.remove("has-file");
        return;
    }
    if (!file.type.startsWith("image/")) {
        alert("이미지 파일만 첨부할 수 있습니다.");
        inputEl.value = "";
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        alert("이미지 용량은 10MB를 초과할 수 없습니다.");
        inputEl.value = "";
        return;
    }
    selectedCommentFiles[pid] = file;
    if (labelEl) labelEl.classList.add("has-file");
    if (previewEl) {
        const reader = new FileReader();
        reader.onload = (e) => {
            previewEl.style.display = "flex";
            previewEl.innerHTML = `
                <img src="${e.target.result}" class="comment-preview-thumb" alt="미리보기">
                <span class="comment-preview-name">${escapeShipCommentHtml(file.name)}</span>
                <button type="button" class="comment-preview-remove" onclick="removeCommentFile('${pid}')" title="첨부 취소">×</button>
            `;
        };
        reader.readAsDataURL(file);
    }
}

function removeCommentFile(pid) {
    delete selectedCommentFiles[pid];
    const inputEl = document.getElementById(`cmt-file-${pid}`);
    if (inputEl) inputEl.value = "";
    const previewEl = document.getElementById(`cmt-preview-${pid}`);
    if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
    const labelEl = document.getElementById(`cmt-file-label-${pid}`);
    if (labelEl) labelEl.classList.remove("has-file");
    if (editingBoardComment && editingBoardComment.pid === pid) {
        editingBoardComment.existingImageUrl = null;
    }
}

function handleShipCommentFileChange(shipId, inputEl) {
    const file = inputEl.files && inputEl.files[0];
    const previewEl = document.getElementById(`ship-comment-preview-${shipId}`);
    const labelEl = document.getElementById(`ship-comment-file-label-${shipId}`);
    if (!file) {
        delete selectedShipCommentFiles[shipId];
        if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
        if (labelEl) labelEl.classList.remove("has-file");
        return;
    }
    if (!file.type.startsWith("image/")) {
        alert("이미지 파일만 첨부할 수 있습니다.");
        inputEl.value = "";
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        alert("이미지 용량은 10MB를 초과할 수 없습니다.");
        inputEl.value = "";
        return;
    }
    selectedShipCommentFiles[shipId] = file;
    if (labelEl) labelEl.classList.add("has-file");
    if (previewEl) {
        const reader = new FileReader();
        reader.onload = (e) => {
            previewEl.style.display = "flex";
            previewEl.innerHTML = `
                <img src="${e.target.result}" class="comment-preview-thumb" alt="미리보기">
                <span class="comment-preview-name">${escapeShipCommentHtml(file.name)}</span>
                <button type="button" class="comment-preview-remove" onclick="removeShipCommentFile('${shipId}')" title="첨부 취소">×</button>
            `;
        };
        reader.readAsDataURL(file);
    }
}

function removeShipCommentFile(shipId) {
    delete selectedShipCommentFiles[shipId];
    const inputEl = document.getElementById(`ship-comment-file-${shipId}`);
    if (inputEl) inputEl.value = "";
    const previewEl = document.getElementById(`ship-comment-preview-${shipId}`);
    if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
    const labelEl = document.getElementById(`ship-comment-file-label-${shipId}`);
    if (labelEl) labelEl.classList.remove("has-file");
    if (editingShipComment && editingShipComment.shipId === shipId) {
        editingShipComment.existingImageUrl = null;
    }
}

async function verifyBoardCommentPassword(comment) {
    const enteredPassword = prompt("댓글 비밀번호를 입력하세요 (작성자 또는 관리자):");
    if (enteredPassword === null) return false;
    if (await verifyPasswordMatch(enteredPassword, comment.password)) return true;
    const enteredHash = await sha256Hex(enteredPassword);
    if (isAdminSessionVerified || enteredHash === DEFAULT_ADMIN_PW_HASH) return true;
    alert("⚠️ 비밀번호가 일치하지 않습니다.");
    return false;
}
async function editComment(pid, cid) {
    const comment = (boardCommentsById[pid] || []).find(item => item.id === cid);
    if (!comment || !(await verifyBoardCommentPassword(comment))) return;
    const nameEl = document.getElementById(`cmt-name-${pid}`);
    const pwEl = document.getElementById(`cmt-pw-${pid}`);
    const txtEl = document.getElementById(`cmt-txt-${pid}`);
    const submitBtn = document.getElementById(`cmt-submit-${pid}`);
    const cancelBtn = document.getElementById(`cmt-cancel-${pid}`);
    const previewEl = document.getElementById(`cmt-preview-${pid}`);
    const labelEl = document.getElementById(`cmt-file-label-${pid}`);
    if (nameEl) nameEl.value = comment.name || "";
    if (pwEl) pwEl.value = "";
    if (txtEl) { txtEl.value = comment.text || ""; txtEl.focus(); }
    delete selectedCommentFiles[pid];
    const fileInput = document.getElementById(`cmt-file-${pid}`);
    if (fileInput) fileInput.value = "";
    if (comment.imageUrl) {
        if (labelEl) labelEl.classList.add("has-file");
        if (previewEl) {
            previewEl.style.display = "flex";
            previewEl.innerHTML = `
                <img src="${escapeShipCommentHtml(comment.imageUrl)}" class="comment-preview-thumb" alt="기존 첨부 이미지">
                <span class="comment-preview-name">기존 첨부 이미지</span>
                <button type="button" class="comment-preview-remove" onclick="removeCommentFile('${pid}')" title="이미지 삭제">×</button>
            `;
        }
    } else {
        if (labelEl) labelEl.classList.remove("has-file");
        if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
    }
    editingBoardComment = { pid, cid, existingImageUrl: comment.imageUrl || null };
    if (submitBtn) submitBtn.innerText = "수정 완료";
    if (cancelBtn) cancelBtn.style.display = "inline-flex";
    showToast("댓글 수정 모드로 전환되었습니다.");
}
function cancelBoardCommentEdit(pid) {
    const nameEl = document.getElementById(`cmt-name-${pid}`);
    const pwEl = document.getElementById(`cmt-pw-${pid}`);
    const txtEl = document.getElementById(`cmt-txt-${pid}`);
    const submitBtn = document.getElementById(`cmt-submit-${pid}`);
    const cancelBtn = document.getElementById(`cmt-cancel-${pid}`);
    if (nameEl) nameEl.value = getPortNickname();
    if (pwEl) pwEl.value = "";
    if (txtEl) txtEl.value = "";
    if (submitBtn) { submitBtn.innerText = "등록"; submitBtn.disabled = false; }
    if (cancelBtn) cancelBtn.style.display = "none";
    removeCommentFile(pid);
    editingBoardComment = null;
}
async function addComment(pid){
    const nameEl = document.getElementById(`cmt-name-${pid}`);
    const pwEl = document.getElementById(`cmt-pw-${pid}`);
    const txtEl = document.getElementById(`cmt-txt-${pid}`);
    const submitBtn = document.getElementById(`cmt-submit-${pid}`);
    const n = (nameEl?.value || "").trim();
    const p = (pwEl?.value || "").trim();
    const t = (txtEl?.value || "").trim();
    const attachedFile = selectedCommentFiles[pid];

    if(!n || !p || (!t && !attachedFile)){
        alert("닉네임, 비밀번호, 그리고 댓글 내용(또는 사진)을 입력해 주세요.");
        return;
    }

    const pwHash = (/^[a-f0-9]{64}$/i.test(p)) ? p.toLowerCase() : (await sha256Hex(p));
    const isEditing = editingBoardComment && editingBoardComment.pid === pid;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = attachedFile ? "사진 업로드 중..." : "저장 중...";
    }

    try {
        let imageUrl = null;
        if (attachedFile) {
            imageUrl = await uploadCommentImageFile(attachedFile, "posts/comments");
        } else if (isEditing) {
            imageUrl = editingBoardComment.existingImageUrl || null;
        }

        const commentsRef = db.collection('posts').doc(pid).collection('comments');
        const modResult = inspectCommunityContent({
            text: t,
            author: n,
            category: "게시판 댓글"
        });
        const commentData = {
            name: n,
            password: pwHash,
            text: t,
            hidden: Boolean(modResult.hidden),
            blindReason: modResult.reason || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (modResult.hidden) {
            notifyAdminAutoBlind({
                category: "게시판 댓글",
                author: n,
                text: t,
                reason: modResult.reason
            });
        }
        if (imageUrl) {
            commentData.imageUrl = imageUrl;
        } else if (isEditing) {
            commentData.imageUrl = null;
        }
        // D-3: 수정 시 비밀번호는 바꿀 수 없습니다. 관리자 수정이면 원래 비밀번호를 유지합니다.
        if (isEditing) {
            const existingComment = (boardCommentsById[pid] || []).find(item => item.id === editingBoardComment.cid);
            if (existingComment && existingComment.password && commentData.password !== existingComment.password) {
                commentData.password = existingComment.password;
            }
        }

        if (isEditing) {
            await commentsRef.doc(editingBoardComment.cid).update(commentData);
            cancelBoardCommentEdit(pid);
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다." : "댓글이 수정되었습니다.");
        } else {
            await commentsRef.add(commentData);
            if (txtEl) txtEl.value = "";
            if (pwEl) pwEl.value = "";
            removeCommentFile(pid);
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다." : "댓글이 등록되었습니다.");
        }
    } catch(err) {
        alert("댓글 저장 실패: " + (err?.message || err));
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = (editingBoardComment && editingBoardComment.pid === pid) ? "수정 완료" : "등록";
        }
    }
} 
async function deleteComment(pid,cid,pw){
    const comment = (boardCommentsById[pid] || []).find(item => item.id === cid) || { password: pw };
    if (!(await verifyBoardCommentPassword(comment))) return;
    if (!confirm("이 댓글을 삭제하시겠습니까?")) return;
    db.collection('posts').doc(pid).collection('comments').doc(cid).update(softDeletePayload()).then(() => {
        if (editingBoardComment && editingBoardComment.pid === pid && editingBoardComment.cid === cid) {
            cancelBoardCommentEdit(pid);
        }
        showToast("댓글이 삭제되었습니다.");
    }).catch(err => alert("댓글 삭제 실패: " + err.message));
}

let currentEditShipId = null;
let selectedShipFormTags = [];
let activeShipFilterTags = [];
let shipDirectorySnapshotLoaded = false;
let pendingVesselInfoLink = null;
let pendingShipInfoRegistration = null;
const handledVesselInfoFollowUps = new Set();

function getAppLocalDateString() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().split("T")[0];
}

function normalizeVesselInfoName(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/^\s*\[[^\]]+\]\s*/, "")
        .replace(/[\s\u200B]+/g, "")
        .toLocaleUpperCase("ko-KR");
}

function getVesselInfoFollowUpKey(name, date) {
    return `${normalizeVesselInfoName(name)}|${date || "no-date"}`;
}

async function lookupVesselInfoRecord(vesselName) {
    const normalized = normalizeVesselInfoName(vesselName);
    const localMatch = (allShipsData || []).find(ship =>
        normalizeVesselInfoName(ship.shipName || ship.name || ship.vesselName) === normalized
    );

    if (localMatch) return { status: "found", ship: localMatch };

    // 실시간 목록에서 찾지 못하면 레거시 문서를 포함해 다시 확인
    try {
        const snapshot = await db.collection("ships").get();
        const records = [];
        snapshot.forEach(doc => records.push({ ...doc.data(), id: doc.id }));

        const found = records.find(ship =>
            normalizeVesselInfoName(ship.shipName || ship.name || ship.vesselName) === normalized
        );

        if (!shipDirectorySnapshotLoaded) {
            allShipsData = records;
            filteredShips = records;
        }

        return found
            ? { status: "found", ship: found }
            : { status: "missing", ship: null };
    } catch (error) {
        console.error("선박 정보 확인 실패:", error);
        return { status: "error", error };
    }
}

function getVesselInfoFollowUpContext(source, overrides = {}) {
    const isWage = source === "wage";
    const vesselName = String(
        overrides.vesselName ??
        (isWage
            ? (document.getElementById("wageShipName")?.value || selectedWageScheduleShipName || "")
            : (document.getElementById("logShipName")?.value || ""))
    ).trim();
    const date = String(
        overrides.date ??
        (isWage
            ? (document.getElementById("wageStartDate")?.value || "")
            : (document.getElementById("dailyLogForm")?.getAttribute("data-date") || ""))
    ).trim();
    const terminalId = overrides.terminalId || selectedScheduleTerminal;
    const sourceLabel = isWage ? "임금계산기" : "근무일지";
    const force = Boolean(overrides.force);
    const key = getVesselInfoFollowUpKey(vesselName, date);
    return { source, sourceLabel, vesselName, date, terminalId, force, key };
}

function setVesselLinkButtonVisible(id, visible) {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = visible ? "block" : "none";
}

function closeVesselInfoLinkModal() {
    const modal = document.getElementById("vesselInfoLinkModal");
    if (modal) modal.style.display = "none";
    document.getElementById("vesselInfoCommentForm")?.classList.add("hidden");
    pendingVesselInfoLink = null;
}

function toggleVesselInfoCommentForm() {
    const form = document.getElementById("vesselInfoCommentForm");
    if (!form) return;
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
        const nameInput = document.getElementById("vesselInfoCommentName");
        if (nameInput && !nameInput.value && currentWorkerId) {
            nameInput.value = currentWorkerId;
        }
        document.getElementById("vesselInfoCommentText")?.focus();
    }
}

function openVesselInfoViewFromLink() {
    const context = pendingVesselInfoLink;
    if (!context?.ship?.id) return;
    const shipId = context.ship.id;
    closeVesselInfoLinkModal();
    const card = document.getElementById("ship-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("ship-card");
    }
    openShipDetailView(shipId);
}

async function startVesselInfoFollowUp(source, overrides = {}) {
    const context = getVesselInfoFollowUpContext(source, overrides);

    if (!normalizeVesselInfoName(context.vesselName)) {
        showToast("선박명을 먼저 입력하거나 스케줄에서 선택해 주세요.");
        return;
    }

    if (!context.force && handledVesselInfoFollowUps.has(context.key)) return;

    const modal = document.getElementById("vesselInfoLinkModal");
    const title = document.getElementById("vesselInfoLinkTitle");
    const message = document.getElementById("vesselInfoLinkMessage");
    const meta = document.getElementById("vesselInfoLinkMeta");
    const actions = document.getElementById("vesselInfoLinkActions");
    const commentForm = document.getElementById("vesselInfoCommentForm");
    if (!modal || !title || !message || !actions) return;

    const pending = { ...context, ship: null, status: "checking" };
    pendingVesselInfoLink = pending;

    commentForm?.classList.add("hidden");
    setVesselLinkButtonVisible("vesselInfoRegisterBtn", false);
    setVesselLinkButtonVisible("vesselInfoCommentBtn", false);
    setVesselLinkButtonVisible("vesselInfoViewBtn", false);

    title.textContent = "🔎 선박 정보 확인";
    message.textContent =
        `‘${context.vesselName}’ 선박이 선박 정보에 등록되어 있는지 확인하고 있습니다...`;
    meta.textContent = context.date
        ? `${context.sourceLabel} · ${context.date}`
        : context.sourceLabel;
    modal.style.display = "flex";

    const result = await lookupVesselInfoRecord(context.vesselName);
    if (pendingVesselInfoLink !== pending) return;
    pending.status = result.status;

    if (result.status === "error") {
        title.textContent = "⚠️ 선박 정보를 확인하지 못했습니다";
        message.textContent =
            "네트워크 또는 데이터베이스 연결을 확인한 뒤 다시 시도해 주세요. " +
            "등록 여부를 확인하지 못했으므로 신규 등록은 아직 시작하지 않았습니다.";
        meta.textContent = "연동 확인에 실패했습니다.";
        return;
    }

    if (result.status === "missing") {
        title.textContent = "📝 신규 선박 등록";
        message.textContent =
            `‘${context.vesselName}’ 선박은 선박 정보에 없습니다. 신규 등록 화면에 선박명을 넣어드릴까요?`;
        setVesselLinkButtonVisible("vesselInfoRegisterBtn", true);
        return;
    }

    pending.ship = result.ship;
    title.textContent = "🚢 기존 선박 정보 확인";
    message.textContent =
        `‘${result.ship.shipName || context.vesselName}’ 선박이 이미 등록되어 있습니다. ` +
        "추가 장비·작업 난이도·주의사항을 댓글로 남기시겠습니까?";

    const tags = extractShipTags(result.ship);
    const details = [];
    if (Number(result.ship.difficulty)) {
        details.push(`작업 난이도 ★${Number(result.ship.difficulty)}`);
    }
    if (tags.length) details.push(tags.join(" · "));

    meta.textContent = [
        context.sourceLabel,
        context.date,
        details.join(" · ")
    ].filter(Boolean).join(" · ");

    setVesselLinkButtonVisible("vesselInfoCommentBtn", true);
    setVesselLinkButtonVisible("vesselInfoViewBtn", true);
}

function openVesselRegistrationFromLink() {
    const context = pendingVesselInfoLink;
    if (!context || context.status !== "missing") return;

    const existingForm = document.getElementById("shipForm");
    const hasUnsavedShipDraft = !!currentEditShipId || !!(
        existingForm &&
        !existingForm.classList.contains("hidden") &&
        (
            document.getElementById("shipName")?.value.trim() ||
            document.getElementById("shipOnboard")?.value.trim() ||
            document.getElementById("shipPw")?.value.trim() ||
            document.getElementById("shipFileInput")?.files?.length
        )
    );

    if (hasUnsavedShipDraft &&
        !confirm("현재 선박 등록·수정 입력 내용이 있습니다. 이를 초기화하고 신규 선박 등록을 시작할까요?")) {
        return;
    }

    const registrationContext = {
        vesselName: context.vesselName,
        key: context.key
    };

    closeVesselInfoLinkModal();

    const card = document.getElementById("ship-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("ship-card");
    }

    if (typeof resetShipForm === "function") resetShipForm();
    pendingShipInfoRegistration = registrationContext;

    const form = document.getElementById("shipForm");
    const nameInput = document.getElementById("shipName");
    const passwordInput = document.getElementById("shipPw");

    if (form) form.classList.remove("hidden");
    if (nameInput) nameInput.value = context.vesselName;
    if (passwordInput) passwordInput.value = "";
    initShipFormSchedulePicker();

    form?.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("신규 등록 양식에 선박명을 입력했습니다. 특징·장비와 비밀번호를 작성해 저장하세요.");
}

async function submitVesselInfoComment() {
    const context = pendingVesselInfoLink;
    if (!context?.ship?.id) return;

    const name =
        document.getElementById("vesselInfoCommentName")?.value.trim() || "";
    const password =
        document.getElementById("vesselInfoCommentPassword")?.value.trim() || "";
    const text =
        document.getElementById("vesselInfoCommentText")?.value.trim() || "";

    if (!name || !password || !text) {
        alert("닉네임, 댓글 비밀번호, 추가사항을 모두 입력해 주세요.");
        return;
    }

    const button = document.querySelector("#vesselInfoCommentForm .bg-submit");
    if (button) {
        button.disabled = true;
        button.innerText = "댓글 저장 중...";
    }

    const sourcePrefix =
        `[${context.sourceLabel}${context.date ? ` · ${context.date}` : ""}]`;

    try {
        const fullText = `${sourcePrefix}\n${text}`;
        const modResult = inspectCommunityContent({
            text: fullText,
            author: name,
            category: "선박 댓글"
        });
        const commentData = {
            name,
            password: await sha256Hex(password),
            text: fullText,
            hidden: Boolean(modResult.hidden),
            blindReason: modResult.reason || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (modResult.hidden) {
            notifyAdminAutoBlind({
                category: "선박 댓글",
                author: name,
                text: fullText,
                reason: modResult.reason
            });
        }

        await db.collection("ships")
            .doc(context.ship.id)
            .collection("comments")
            .add(commentData);

        handledVesselInfoFollowUps.add(context.key);
        document.getElementById("vesselInfoCommentText").value = "";
        closeVesselInfoLinkModal();
        showToast(
            modResult.hidden
                ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다."
                : `💬 ${context.ship.shipName || context.vesselName} 선박 정보에 추가 댓글을 등록했습니다.`
        );
    } catch (error) {
        console.error("선박 정보 댓글 등록 실패:", error);
        alert("댓글 저장에 실패했습니다: " + error.message);
    } finally {
        if (button) {
            button.disabled = false;
            button.innerText = "댓글 등록";
        }
    }
}

async function loadShipRecordById(shipId) {
    if (!shipId) return null;
    const local = (allShipsData || []).find(s => s.id === shipId);
    if (local) return local;
    try {
        const snap = await db.collection("ships").doc(shipId).get();
        if (snap.exists) return { ...snap.data(), id: snap.id };
    } catch (e) {}
    return null;
}

async function sendShipInfoToWage(shipId, event) {
    if (event) event.stopPropagation();

    const ship = await loadShipRecordById(shipId);
    if (!ship) return showToast("선박 정보를 다시 불러와 주세요.");

    const card = document.getElementById("wage-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("wage-card");
    }

    const name = ship.shipName || ship.name || ship.vesselName || "";
    const input = document.getElementById("wageShipName");

    if (input) input.value = name;
    onWageShipNameChange(name);

    const date = document.getElementById("wageStartDate")?.value;
    if (date) loadWageScheduledShipsForDate(date, false);

    document.getElementById("wage-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    input?.focus();

    showToast(`🚢 ${name} 선박을 임금계산기로 보냈습니다.`);
}

async function sendShipInfoToWorkLog(shipId, event) {
    if (event) event.stopPropagation();

    const ship = await loadShipRecordById(shipId);
    if (!ship) return showToast("선박 정보를 다시 불러와 주세요.");

    const card = document.getElementById("log-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("log-card");
    }

    const form = document.getElementById("dailyLogForm");
    const date = form?.getAttribute("data-date") || getAppLocalDateString();

    if (form?.classList.contains("hidden")) {
        jumpToLogDate(date);
    }

    const name = ship.shipName || ship.name || ship.vesselName || "";
    const input = document.getElementById("logShipName");

    if (input) input.value = name;

    document.getElementById("log-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    input?.focus();

    showToast(`🚢 ${name} 선박을 근무일지 입력창으로 보냈습니다.`);
}
const shipDifficultyDescriptions = {
    1: "★☆☆☆☆ (매우 수월·1점)",
    2: "★★☆☆☆ (수월함·2점)",
    3: "★★★☆☆ (보통·3점)",
    4: "★★★★☆ (까다로움·4점)",
    5: "★★★★★ (극상/주의·5점)"
};
function setShipDifficulty(level) {
    const num = Math.min(5, Math.max(1, parseInt(level, 10) || 3));
    const input = document.getElementById("shipDifficultyInput");
    const label = document.getElementById("shipDifficultyLabel");
    if (input) input.value = String(num);
    if (label) label.innerText = shipDifficultyDescriptions[num] || `★${num}`;
    document.querySelectorAll("#shipStarPicker .ship-star-btn").forEach((btn, idx) => {
        btn.classList.toggle("active", idx < num);
    });
}
function toggleShipFormTag(tag) {
    const idx = selectedShipFormTags.indexOf(tag);
    if (idx >= 0) selectedShipFormTags.splice(idx, 1);
    else selectedShipFormTags.push(tag);
    syncShipFormTagUI();
}
function syncShipFormTagUI() {
    document.querySelectorAll("#shipFormTagList [data-form-tag]").forEach(btn => {
        const tag = btn.getAttribute("data-form-tag");
        btn.classList.toggle("active", selectedShipFormTags.includes(tag));
    });
}
function toggleShipFilterTag(tag) {
    const idx = activeShipFilterTags.indexOf(tag);
    if (idx >= 0) activeShipFilterTags.splice(idx, 1);
    else activeShipFilterTags.push(tag);
    document.querySelectorAll(".ship-filter-bar [data-filter-tag]").forEach(btn => {
        const t = btn.getAttribute("data-filter-tag");
        btn.classList.toggle("active", activeShipFilterTags.includes(t));
    });
    filterShips();
}
function resetShipFilters() {
    activeShipFilterTags = [];
    const searchEl = document.getElementById("shipSearch");
    const diffEl = document.getElementById("shipDifficultyFilter");
    if (searchEl) searchEl.value = "";
    if (diffEl) diffEl.value = "0";
    document.querySelectorAll(".ship-filter-bar [data-filter-tag]").forEach(btn => btn.classList.remove("active"));
    filterShips();
}
function extractShipTags(ship) {
    if (!ship) return [];
    // 📝 게시글 태그 — 하트(♡) 표기를 정본으로 사용합니다.
    // 예전에 하트 없이 저장한 '#찬구콘' 도 '#찬구콘♡' 로 맞춰 필터가 어긋나지 않게 합니다.
    const heartTags = ["#찬구콘♡", "#수열콘♡", "#영구콘♡", "#광명콘♡"];
    const normalizeTag = (tag) => {
        const raw = String(tag ?? "").trim();
        if (!raw) return "";
        const compact = raw.replace(/\s+/g, "");
        const hashed = compact.startsWith("#") ? compact : `#${compact}`;
        if (heartTags.includes(hashed)) return hashed;
        if (heartTags.includes(`${hashed}♡`)) return `${hashed}♡`;
        return raw;
    };
    if (Array.isArray(ship.tags) && ship.tags.length > 0) {
        return [...new Set(ship.tags.map(normalizeTag).filter(Boolean))];
    }
    const text = `${getShipDisplayName(ship)} ${getShipMemoText(ship)} ${getShipLegacyOnshoreText(ship)}`;
    const known = [
        "#오토콘", "#수동콘",
        "#외줄콘", "#더블콘", "#주먹콘", "#손가락콘", "#현대콘", "#춘학 사랑해콘", "#춘학사랑해",
        "#브릿지주의", "#라싱바무거움", "#턴버클뻑뻑함", "#통로협소",
        "#찬구콘♡", "#수열콘♡", "#브라보콘", "#월드콘", "#닭다리콘", "#개콘", "#영구콘♡", "#광명콘♡"
    ];
    return known.filter(t => {
        // '#춘학사랑해'는 레거시 문구 '춘학사랑해콘'(기존 '#춘학 사랑해콘' 전용)과 이중 매칭되지 않게 제외
        if (t === "#춘학사랑해") return (text.includes("#춘학사랑해") || text.includes("춘학사랑해")) && !text.includes("춘학사랑해콘");
        if (text.includes(t) || text.includes(t.slice(1))) return true;
        // 하트 태그는 '찬구콘'처럼 하트 없이 적힌 메모도 같은 태그로 인식
        if (t.endsWith("♡") && text.includes(t.slice(1, -1))) return true;
        return t === "#춘학 사랑해콘" && text.includes("춘학사랑해콘");
    });
}
/* ------------------------------------------------------------------
   🚢 선박 도감 레거시(업데이트 이전 등록) 데이터 호환 헬퍼
   - 초기 버전 선박 문서는 메모가 onboardFeat 대신 content/memo 에 있거나,
     '육상 특징'(onshoreFeat) 필드를 별도로 가진 경우가 있어 함께 표시·검색합니다.
   ------------------------------------------------------------------ */
function getShipDisplayName(ship) {
    if (!ship) return "";
    const raw = ship.shipName || ship.name || ship.vesselName || "";
    return String(raw).trim();
}
function getShipMemoText(ship) {
    if (!ship) return "";
    for (const key of ["onboardFeat", "content", "memo", "info"]) {
        const value = ship[key];
        if (value === undefined || value === null) continue;
        const text = String(value);
        if (text.trim()) return text;
    }
    return "";
}
function getShipLegacyOnshoreText(ship) {
    const value = ship ? ship.onshoreFeat : null;
    if (value === undefined || value === null) return "";
    const text = String(value);
    return text.trim() ? text : "";
}
function toShipDate(value) {
    if (!value) return null;
    const isDateObject = v => Object.prototype.toString.call(v) === "[object Date]";
    try {
        let date = null;
        if (typeof value.toDate === "function") date = value.toDate();
        else if (isDateObject(value)) date = value;
        else if (typeof value === "number") date = new Date(value < 100000000000 ? value * 1000 : value);
        else if (typeof value === "string") date = new Date(value);
        else if (typeof value === "object" && (typeof value.seconds === "number" || typeof value._seconds === "number")) {
            const seconds = typeof value.seconds === "number" ? value.seconds : value._seconds;
            date = new Date(seconds * 1000);
        }
        return isDateObject(date) && !isNaN(date.getTime()) ? date : null;
    } catch (e) {
        return null;
    }
}
function findDuplicateShipRecord(shipName, excludeId = null) {
    const normalized = normalizeVesselInfoName(shipName);
    if (!normalized) return null;
    return (allShipsData || []).find(ship => {
        if (excludeId && ship.id === excludeId) return false;
        return normalizeVesselInfoName(ship.shipName || ship.name || ship.vesselName) === normalized;
    }) || null;
}
function checkShipDuplicateInline(val) {
    const noticeEl = document.getElementById("shipDuplicateNotice");
    if (!noticeEl) return null;
    const dup = findDuplicateShipRecord(val, currentEditShipId);
    if (dup) {
        const dupName = escapeShipCommentHtml(dup.shipName || dup.name || val);
        const dupId = String(dup.id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        noticeEl.innerHTML = `⚠️ <strong>‘${dupName}’</strong> 선박은 이미 등록되어 있습니다. (중복 등록 불가)<div style="margin-top:5px; display:flex; gap:6px; flex-wrap:wrap;"><button type="button" class="mini-btn" style="background:var(--primary) !important; color:#fff !important;" onclick="jumpToExistingShipFromForm('${dupId}')">🔎 등록된 선박 보기 · 댓글 달기</button><button type="button" class="mini-btn" style="background:var(--primary-light) !important; color:#fff !important;" onclick="tryEditShip('${dupId}', '', '', '')">✏️ 기존 정보 수정</button></div>`;
        noticeEl.classList.remove("hidden");
    } else {
        noticeEl.innerHTML = "";
        noticeEl.classList.add("hidden");
    }
    return dup;
}
function jumpToExistingShipFromForm(shipId) {
    if (!shipId) return;
    resetShipForm();
    resetShipFilters();
    const idx = filteredShips.findIndex(s => s.id === shipId);
    if (idx >= 0) {
        const targetPage = Math.floor(idx / postsPerPage) + 1;
        renderShipPage(targetPage);
        setTimeout(() => {
            const row = document.getElementById(`s-${shipId}`);
            if (row && !row.classList.contains("show")) {
                toggleBoardRow(`s-${shipId}`);
            }
            row?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 60);
    } else {
        openShipDetailView(shipId);
    }
}
async function addShipInfo() {
    const n = document.getElementById('shipName').value.trim();
    const c = document.getElementById('shipOnboard').value.trim();
    const p = document.getElementById('shipPw').value.trim();
    const diff = parseInt(document.getElementById('shipDifficultyInput')?.value || '3', 10) || 3;
    const tags = [...selectedShipFormTags];
    const f = document.getElementById('shipFileInput').files[0];
    const btn = document.getElementById('shipSubmitBtn');
    if (!n || !p) return alert("선박명과 비밀번호는 필수입니다!");
    if (!normalizeVesselInfoName(n)) return alert("유효한 선박명을 입력해 주세요.");

    btn.innerText = "중복 확인 중...";
    btn.disabled = true;

    let duplicateShip = findDuplicateShipRecord(n, currentEditShipId);
    if (!duplicateShip) {
        try {
            const snapshot = await db.collection("ships").get();
            snapshot.forEach(doc => {
                if (currentEditShipId && doc.id === currentEditShipId) return;
                const d = doc.data() || {};
                if (normalizeVesselInfoName(d.shipName || d.name || d.vesselName) === normalizeVesselInfoName(n)) {
                    duplicateShip = { ...d, id: doc.id };
                }
            });
        } catch (err) {
            console.warn("선박 중복 조회 중 오류:", err);
        }
    }

    if (duplicateShip) {
        checkShipDuplicateInline(n);
        btn.innerText = currentEditShipId ? "수정 완료" : "등록/수정";
        btn.disabled = false;
        const existingTitle = duplicateShip.shipName || duplicateShip.name || n;
        alert(`⚠️ 이미 등록된 선박입니다: ‘${existingTitle}’\n\n동일한 선박명은 중복 등록할 수 없습니다.\n기존 선박 게시글을 열어 정보를 수정하거나 댓글을 남겨 주세요.`);
        return;
    }

    btn.innerText = "서버 기록 중...";
    const pwHash = (/^[a-f0-9]{64}$/i.test(p)) ? p.toLowerCase() : (await sha256Hex(p));
    const finalizeSave = (url) => {
        const shipData = {
            shipName: n,
            onboardFeat: c,
            password: pwHash,
            difficulty: diff,
            tags: tags,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (url) shipData.imageUrl = url;
        let task = currentEditShipId ? db.collection("ships").doc(currentEditShipId).update(shipData) : db.collection("ships").add(shipData);
        task.then(() => {
            const linkedRegistration = pendingShipInfoRegistration;
            const linkedByVesselFlow =
                linkedRegistration &&
                normalizeVesselInfoName(linkedRegistration.vesselName) ===
                    normalizeVesselInfoName(n);

            if (linkedByVesselFlow) {
                handledVesselInfoFollowUps.add(linkedRegistration.key);
                pendingShipInfoRegistration = null;
            }

            showToast(linkedByVesselFlow
                ? "🚢 선박 정보 신규 등록 및 임금계산기·근무일지 연동이 완료되었습니다."
                : "성공적으로 기록되었습니다.");
            resetShipForm();
            btn.innerText = "등록/수정";
            btn.disabled = false;
        }).catch(err => {
            alert("실패: " + err.message);
            btn.disabled = false;
        });
    };
    if (f) {
        const optimizedFile = await compressImageForUpload(f);
        const storageRef = storage.ref(`ships/${Date.now()}_${optimizedFile.name || f.name}`);
        const uploadTask = storageRef.put(optimizedFile);
        uploadTask.on('state_changed', (snap) => {
            const p = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            btn.innerText = `사진 업로드 중... ${p}%`;
        }, (err) => {
            alert("사진 업로드 실패: " + err.message);
            btn.innerText = "등록/수정";
            btn.disabled = false;
        }, () => {
            uploadTask.snapshot.ref.getDownloadURL().then(url => finalizeSave(url)).catch(err => {
                alert("이미지 URL 조회 실패: " + err.message);
                btn.innerText = "등록/수정";
                btn.disabled = false;
            });
        });
    } else {
        finalizeSave();
    }
}
async function tryEditShip(id, name, feat, savedPw) {
    const shipObj = (allShipsData || []).find(s => s.id === id);
    const finalPw = shipObj ? (shipObj.password || "") : savedPw;
    const finalName = shipObj ? getShipDisplayName(shipObj) : name;
    const finalFeat = shipObj ? getShipMemoText(shipObj) : feat;
    const inputPw = prompt("비밀번호를 입력하세요 (작성자 또는 관리자):");
    if (!inputPw) return;
    const isAuthor = await verifyPasswordMatch(inputPw, finalPw);
    const inputHash = await sha256Hex(inputPw);
    const isAdmin = isAdminSessionVerified || (inputHash === DEFAULT_ADMIN_PW_HASH);
    if (isAuthor || isAdmin) {
        startEditShip(id, finalName, finalFeat, isAuthor ? inputPw.trim() : (finalPw || inputPw.trim()));
    } else {
        alert("⚠️ 권한이 없습니다. 비밀번호를 확인하세요.");
    }
}
function startEditShip(id, name, feat, verifiedPw = "") {
    currentEditShipId = id;
    const shipObj = allShipsData.find(s => s.id === id) || {};
    document.getElementById('shipName').value = name !== undefined ? name : getShipDisplayName(shipObj);
    document.getElementById('shipOnboard').value = feat !== undefined ? feat : getShipMemoText(shipObj);
    const pwEl = document.getElementById('shipPw');
    if (pwEl && verifiedPw) pwEl.value = verifiedPw;
    setShipDifficulty(shipObj.difficulty || 3);
    // extractShipTags 가 게시글 태그의 하트(♡) 표기를 정규화하므로 수정 화면에서도 같은 표기로 선택됩니다.
    selectedShipFormTags = extractShipTags(shipObj);
    syncShipFormTagUI();
    checkShipDuplicateInline(document.getElementById('shipName').value);
    const form = document.getElementById('shipForm');
    if (form.classList.contains('hidden')) form.classList.remove('hidden');
    const submitBtn = document.getElementById('shipSubmitBtn');
    if (submitBtn) submitBtn.innerText = "수정 완료";
    const cancelBtn = document.getElementById('shipCancelBtn');
    if (cancelBtn) cancelBtn.style.display = "block";
    initShipFormSchedulePicker();
    form.scrollIntoView({behavior: 'smooth', block: 'center'});
    showToast("수정 모드로 전환되었습니다.");
}
function resetShipForm() {
    document.getElementById('shipName').value = '';
    document.getElementById('shipOnboard').value = '';
    document.getElementById('shipPw').value = '';
    document.getElementById('shipFileInput').value = '';
    setShipDifficulty(3);
    selectedShipFormTags = [];
    syncShipFormTagUI();
    const dupNotice = document.getElementById('shipDuplicateNotice');
    if (dupNotice) { dupNotice.innerHTML = ''; dupNotice.classList.add('hidden'); }
    document.getElementById('shipForm').classList.add('hidden');
    const submitBtn = document.getElementById('shipSubmitBtn');
    if (submitBtn) { submitBtn.innerText = "등록/수정"; submitBtn.disabled = false; }
    const cancelBtn = document.getElementById('shipCancelBtn');
    if (cancelBtn) cancelBtn.style.display = "none";
    currentEditShipId = null;
}
function getShipSearchHaystack(ship, tags) {
    const sTags = Array.isArray(tags) ? tags : extractShipTags(ship);
    const compactTags = sTags.map(t => t.replace(/\s+/g, '')).join(" ");
    return `${getShipDisplayName(ship)} ${getShipMemoText(ship)} ${getShipLegacyOnshoreText(ship)} ${sTags.join(" ")} ${compactTags}`;
}
/* 🔍 선박 검색 — 한글 초성·영문 이니셜 매칭 (선박명_효율입력_제안서 후속 제안 #1)
 * "ㅎㅁ" → "HMM ROTTERDAM", "ㅎㅈㅊ" → "한진초원" 처럼 초성만으로 후보를 찾습니다.
 * ① 기존 부분문자열(대소문자 무시) → ② 한글 헤이스택의 초성 연속 일치
 * ③ 영문 이니셜 — 초성 자음을 로마자로 매핑(ㄱ→G/K, ㅂ→B/P, ㅊ→C/CH …)해
 *    선박명의 연속 글자("HMM"에서 "HM") 또는 단어 첫 글자("HR")와 일치
 * 기존 부분문자열 검색 동작은 그대로 유지합니다. */
const CHO_TO_LATIN_PATTERN = {
    "ㄱ": "[GK]", "ㄲ": "[GK]", "ㄴ": "N", "ㄷ": "[DT]", "ㄸ": "[DT]", "ㄹ": "[LR]",
    "ㅁ": "M", "ㅂ": "[BP]", "ㅃ": "[BP]", "ㅅ": "S", "ㅆ": "S", "ㅇ": "[OIY]",
    "ㅈ": "[JZ]", "ㅉ": "[JZ]", "ㅊ": "C(?:H)?", "ㅋ": "[CKQ]", "ㅌ": "T", "ㅍ": "[FP]", "ㅎ": "H"
};
function matchesShipQuery(rawQuery, rawHaystack) {
    const query = String(rawQuery ?? "").trim();
    const haystack = String(rawHaystack ?? "");
    if (query === "") return true;
    const q = query.toUpperCase();
    const hay = haystack.toUpperCase();
    if (hay.includes(q)) return true;
    // 초성·이니셜 확장 검색: 초성 자음이 포함된 쿼리에서만 (예: "ㅎㅁ" → HMM, "Hㅁ" → HMM)
    // 완성형 한글 쿼리("샠시")는 기존 부분문자열 검색만 사용 — 초성으로 넓어지면
    // "샠시"가 "ESSEN"의 SS 등 영문 오탐까지 붙잡는 문제 방지
    if (!/[ㄱ-ㅎ]/.test(query) || /[가-힣]/.test(query)) return false;
    const choQuery = getHangulChosung(query).toUpperCase();
    if (getHangulChosung(haystack).toUpperCase().includes(choQuery)) return true;
    const latinPattern = choQuery.split("").map(ch =>
        CHO_TO_LATIN_PATTERN[ch] || (/[A-Z0-9]/.test(ch) ? ch : "")
    ).join("");
    if (latinPattern === "") return false;
    let re;
    try { re = new RegExp(latinPattern); } catch (_e) { return false; }
    if (re.test(hay)) return true;
    // 단어 첫 글자 이니셜 (예: "ㅎㄹ" → "HMM ROTTERDAM"의 H + R)
    const wordInitials = haystack
        .split(/[^0-9A-Za-z가-힣]+/)
        .filter(Boolean)
        .map(w => getHangulChosung(w.charAt(0)).toUpperCase())
        .join("");
    return re.test(wordInitials);
}
// 현재 화면의 검색어·장비 태그·난이도 필터를 그대로 적용한 선박 목록을 돌려줍니다.
// (실시간 스냅샷으로 목록을 다시 그릴 때도 같은 조건을 유지하기 위해 분리)
function getFilteredShipList(source = allShipsData) {
    const searchTerm = (document.getElementById('shipSearch')?.value || '').trim();
    const diffFilter = parseInt(document.getElementById('shipDifficultyFilter')?.value || '0', 10) || 0;
    const filterTags = Array.isArray(activeShipFilterTags) ? activeShipFilterTags : [];
    return (Array.isArray(source) ? source : []).filter(ship => {
        if (!ship) return false;
        const sTags = extractShipTags(ship);
        const sDiff = Number(ship.difficulty) || 0;
        if (searchTerm !== "") {
            const hay = getShipSearchHaystack(ship, sTags);
            if (!matchesShipQuery(searchTerm, hay)) return false;
        }
        if (filterTags.length > 0) {
            const hasAllTags = filterTags.every(t => sTags.includes(t));
            if (!hasAllTags) return false;
        }
        if (diffFilter > 0) {
            if (diffFilter === 2) {
                if (!sDiff || sDiff > 2) return false;
            } else {
                if (sDiff < diffFilter) return false;
            }
        }
        return true;
    });
}
function filterShips() {
    filteredShips = getFilteredShipList();
    renderShipPage(1);
    if (typeof loadAndSearchAllShips === "function") {
        loadAndSearchAllShips(document.getElementById('shipSearch')?.value || '');
    }
}
/* ------------------------------------------------------------------
   🚢 선박 도감 실시간 스냅샷 반영
   [버그 원인] 선박을 펼치면 조회수(views)가 +1 저장되고, 그 즉시 ships 실시간
   스냅샷이 다시 도착합니다. 기존 코드는 이때 filteredShips = allShipsData 로
   검색 조건을 버리고 전체 목록을 다시 그려서, 전체 목록 1페이지(최신 5척)에
   없는 선박(=업데이트 이전에 등록된 예전 선박)은 펼친 내용이 사라지고 전체
   선박 목록만 보였습니다.
   [수정] ① 조회수만 바뀐 스냅샷은 목록을 다시 그리지 않고 숫자만 갱신
          ② 내용이 바뀐 스냅샷도 현재 검색·필터·페이지·펼친 선박을 유지
   ------------------------------------------------------------------ */
function getShipRowSignature(ship) {
    try {
        const normalize = (value, depth) => {
            if (value === undefined || value === null) return null;
            if (typeof value.toMillis === "function") return { __ts: value.toMillis() };
            if (typeof value !== "object") return value;
            if (depth > 4) return String(value);
            if (Array.isArray(value)) return value.map(item => normalize(item, depth + 1));
            const out = {};
            Object.keys(value).sort().forEach(key => { out[key] = normalize(value[key], depth + 1); });
            return out;
        };
        const rest = {};
        Object.keys(ship || {}).forEach(key => {
            if (key !== "views" && key !== "id") rest[key] = ship[key];
        });
        return JSON.stringify(normalize(rest, 0));
    } catch (e) {
        return null;
    }
}
function isShipViewCountOnlyChange(prevList, nextList) {
    if (!Array.isArray(prevList) || !Array.isArray(nextList)) return false;
    if (prevList.length !== nextList.length) return false;
    for (let i = 0; i < nextList.length; i++) {
        const prev = prevList[i];
        const next = nextList[i];
        if (!prev || !next || prev.id !== next.id) return false;
        const prevSig = getShipRowSignature(prev);
        if (prevSig === null || prevSig !== getShipRowSignature(next)) return false;
    }
    return true;
}
function syncShipViewCountBadges(ships) {
    (Array.isArray(ships) ? ships : []).forEach(ship => {
        if (!ship || !ship.id) return;
        const label = Math.max(0, Number(ship.views) || 0).toLocaleString();
        const badgeEl = document.getElementById(`view-badge-s-${ship.id}`);
        if (badgeEl) {
            badgeEl.innerText = `👁️ ${label}`;
            badgeEl.title = `조회수 ${label}회 (중복 조회 포함)`;
        }
        const detailEl = document.getElementById(`view-detail-s-${ship.id}`);
        if (detailEl) detailEl.innerText = `👁️ 조회수 ${label}회`;
        const fullTableBadgeEl = document.getElementById(`view-full-s-${ship.id}`);
        if (fullTableBadgeEl) fullTableBadgeEl.innerText = `👁️ ${label}`;
    });
}
function applyShipDirectorySnapshot(snapshot) {
    const openIds = Array.from(document.querySelectorAll("#shipList .board-content-row.show")).map(el => el.id);
    const nextShips = [];
    snapshot.forEach(d => {
        const shipData = d.data() || {};
        if (isDeletedRecord(shipData)) return; // 소프트 삭제된 선박은 목록에서 감춥니다.
        nextShips.push({ ...shipData, id: d.id });
    });
    const viewCountOnly = shipDirectorySnapshotLoaded && isShipViewCountOnlyChange(allShipsData, nextShips);
    shipDirectorySnapshotLoaded = true;
    allShipsData = nextShips;

    const subMeta = document.getElementById("shipCardSubMeta");
    if (subMeta) subMeta.innerText = allShipsData.length > 0 ? `등록 선박 ${allShipsData.length}척 · 장비 도감` : "난이도 · 필수 장비 도감";
    const shipBadge = document.getElementById("shipBadge");
    if (shipBadge) {
        const nowMs = Date.now();
        const hasNewShip = allShipsData.some(item => {
            const date = toShipDate(item.timestamp);
            return Boolean(date) && (nowMs - date.getTime() < 24 * 60 * 60 * 1000);
        });
        if (hasNewShip) shipBadge.classList.remove("hidden");
        else shipBadge.classList.add("hidden");
    }

    // 검색어·태그·난이도 필터는 사용자가 바꾸기 전까지 그대로 유지
    filteredShips = getFilteredShipList(allShipsData);

    if (viewCountOnly) {
        // 조회수만 바뀜 → 목록·펼친 상세·댓글 입력란을 건드리지 않고 숫자만 갱신
        syncShipViewCountBadges(allShipsData);
        return;
    }

    const maxPage = Math.max(1, Math.ceil(filteredShips.length / postsPerPage));
    let targetPage = Math.min(currentShipPage || 1, maxPage);
    // 펼쳐 둔 선박이 다른 페이지로 밀려났다면 그 선박이 있는 페이지를 유지
    const openShipPages = openIds
        .filter(rid => rid.startsWith("s-"))
        .map(rid => filteredShips.findIndex(ship => `s-${ship.id}` === rid))
        .filter(idx => idx >= 0)
        .map(idx => Math.floor(idx / postsPerPage) + 1);
    if (openShipPages.length > 0 && !openShipPages.includes(targetPage)) {
        targetPage = openShipPages[0];
    }
    renderShipPage(targetPage);
    openIds.forEach(rid => {
        const r = document.getElementById(rid);
        if (r) {
            r.classList.add("show");
            if (rid.startsWith("s-")) loadShipComments(rid.slice(2));
        }
    });
    if (typeof loadAndSearchAllShips === "function") loadAndSearchAllShips(document.getElementById('shipSearch')?.value || '');
}
let currentEditArchiveId = null;
let currentEditArchiveUrl = null;
let currentEditArchivePw = null;
function toggleArchiveForm() {
    const form = document.getElementById('archiveForm');
    if (!form) return;
    if (!form.classList.contains('hidden')) {
        cancelEditArchive();
    } else {
        form.classList.remove('hidden');
    }
}
function cancelEditArchive() {
    currentEditArchiveId = null;
    currentEditArchiveUrl = null;
    currentEditArchivePw = null;
    const tEl = document.getElementById('archiveTitle');
    const pEl = document.getElementById('archivePw');
    const fEl = document.getElementById('archiveFile');
    const btn = document.getElementById('archiveSubmitBtn');
    const cancelBtn = document.getElementById('archiveCancelBtn');
    if (tEl) tEl.value = '';
    if (pEl) pEl.value = '';
    if (fEl) fEl.value = '';
    if (btn) { btn.innerText = "업로드 완료"; btn.disabled = false; }
    if (cancelBtn) cancelBtn.style.display = "none";
    document.getElementById('archiveForm')?.classList.add('hidden');
}
async function startEditArchive(id, e) {
    if (e) e.stopPropagation();
    const archObj = (window.allArchivesCache || []).find(a => a.id === id);
    if (!archObj) return;
    const savedPw = archObj.password || "";
    const inputPw = prompt("자료 비밀번호를 입력하세요 (작성자 또는 관리자):");
    if (inputPw === null) return;
    const isAuthor = savedPw ? (await verifyPasswordMatch(inputPw, savedPw)) : false;
    const inputHash = await sha256Hex(inputPw);
    const isAdmin = isAdminSessionVerified || (inputHash === DEFAULT_ADMIN_PW_HASH);
    if (!isAuthor && !isAdmin) {
        alert("⚠️ 비밀번호가 일치하지 않습니다.");
        return;
    }
    currentEditArchiveId = id;
    currentEditArchiveUrl = archObj.url || null;
    currentEditArchivePw = isAuthor ? inputPw.trim() : (savedPw || inputPw.trim());
    document.getElementById('archiveTitle').value = archObj.title || '';
    const pwEl = document.getElementById('archivePw');
    if (pwEl) pwEl.value = currentEditArchivePw;
    document.getElementById('archiveFile').value = '';
    const form = document.getElementById('archiveForm');
    if (form) form.classList.remove('hidden');
    const btn = document.getElementById('archiveSubmitBtn');
    if (btn) btn.innerText = "수정 완료";
    const cancelBtn = document.getElementById('archiveCancelBtn');
    if (cancelBtn) cancelBtn.style.display = "block";
    form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast("자료 수정 모드로 전환되었습니다. (파일 미선택 시 기존 파일이 유지됩니다)");
}
async function addArchive() {
    const t = document.getElementById('archiveTitle').value.trim();
    const p = (document.getElementById('archivePw')?.value || '').trim();
    const f = document.getElementById('archiveFile').files[0];
    const btn = document.getElementById('archiveSubmitBtn');
    const isEdit = !!currentEditArchiveId;
    if (!t || (!isEdit && !f)) return alert(isEdit ? "파일 설명을 입력해 주세요." : "파일 설명과 파일을 모두 선택해 주세요.");
    if (!p && !currentEditArchivePw) return alert("수정/삭제에 사용할 비밀번호를 입력해 주세요.");
    btn.innerText = "서버 연결 중...";
    btn.disabled = true;
    const rawPw = p || currentEditArchivePw;
    const pwHash = (/^[a-f0-9]{64}$/i.test(rawPw)) ? rawPw.toLowerCase() : (await sha256Hex(rawPw));
    const finalizeArchive = (url) => {
        const archiveData = {
            title: t,
            url: url || currentEditArchiveUrl,
            password: pwHash,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        const req = isEdit
            ? db.collection("archives").doc(currentEditArchiveId).update(archiveData)
            : db.collection("archives").add(archiveData);
        req.then(() => {
            cancelEditArchive();
            showToast(isEdit ? "자료가 수정되었습니다!" : "파일이 성공적으로 등록되었습니다!");
        }).catch(err => {
            alert("저장 실패: " + err.message);
            btn.disabled = false;
            btn.innerText = isEdit ? "수정 완료" : "업로드 완료";
        });
    };
    if (f) {
        const ref = storage.ref(`archives/${Date.now()}_${f.name}`);
        const task = ref.put(f);
        task.on('state_changed', (s) => {
            const prog = Math.round((s.bytesTransferred / s.totalBytes) * 100);
            btn.innerText = `업로드 중... ${prog}%`;
        }, (e) => {
            alert("업로드 실패: " + e.message);
            btn.disabled = false;
            btn.innerText = isEdit ? "수정 완료" : "업로드 완료";
        }, () => {
            task.snapshot.ref.getDownloadURL().then(url => finalizeArchive(url)).catch(err => {
                alert("파일 URL 조회 실패: " + err.message);
                btn.disabled = false;
                btn.innerText = isEdit ? "수정 완료" : "업로드 완료";
            });
        });
    } else {
        finalizeArchive(currentEditArchiveUrl);
    }
}
async function deleteShip(id,e){
    if(e) e.stopPropagation();
    const shipObj = (allShipsData || []).find(s => s.id === id);
    const savedPw = shipObj ? (shipObj.password || "") : "";
    const inputPw = prompt("선박 정보 비밀번호를 입력하세요 (작성자 또는 관리자):");
    if (inputPw === null) return;
    const isAuthor = savedPw ? (await verifyPasswordMatch(inputPw, savedPw)) : false;
    const inputHash = await sha256Hex(inputPw);
    const isAdmin = isAdminSessionVerified || (inputHash === DEFAULT_ADMIN_PW_HASH);
    if (isAuthor || isAdmin) {
        if (!confirm("이 선박 정보를 삭제하시겠습니까?")) return;
        db.collection("ships").doc(id).update(softDeletePayload()).then(() => showToast("선박 정보가 삭제되었습니다.")).catch(err => alert("삭제 실패: " + err.message));
    } else {
        alert("⚠️ 비밀번호가 일치하지 않습니다.");
    }
}
async function delArchive(id,e){
    if(e) e.stopPropagation();
    const archObj = (window.allArchivesCache || []).find(a => a.id === id);
    const savedPw = archObj ? (archObj.password || "") : "";
    const inputPw = prompt("자료 비밀번호를 입력하세요 (작성자 또는 관리자):");
    if (inputPw === null) return;
    const isAuthor = savedPw ? (await verifyPasswordMatch(inputPw, savedPw)) : false;
    const inputHash = await sha256Hex(inputPw);
    const isAdmin = isAdminSessionVerified || (inputHash === DEFAULT_ADMIN_PW_HASH);
    if (isAuthor || isAdmin) {
        if (!confirm("이 자료를 삭제하시겠습니까?")) return;
        db.collection("archives").doc(id).delete().then(() => showToast("자료가 삭제되었습니다.")).catch(err => alert("삭제 실패: " + err.message));
    } else {
        alert("⚠️ 비밀번호가 일치하지 않습니다.");
    }
} 

let currentBoardPage = 1;
function renderBoardPage(p){ currentBoardPage = p; const l = document.getElementById("boardList"); Object.values(commentUnsubscribes).forEach(unsub => { if (typeof unsub === "function") unsub(); }); commentUnsubscribes = {}; boardCommentsById = {}; editingBoardComment = null; l.innerHTML = ""; const start = (p-1) * postsPerPage; const end = start + postsPerPage; const pageData = allPostsData.slice(start, end); if(pageData.length === 0) { l.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>게시글이 없습니다.</td></tr>"; document.getElementById("pagination").innerHTML = ""; return; } const rowsHtml = []; const nowMs = Date.now(); pageData.forEach((x, i) => { let dateStr = ""; let isRowNew = false; if(x.timestamp) { const d = x.timestamp.toDate(); const month = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); const hour = String(d.getHours()).padStart(2, '0'); const min = String(d.getMinutes()).padStart(2, '0'); dateStr = `${month}/${day} ${hour}:${min}`; if (nowMs - d.getTime() < 24 * 60 * 60 * 1000) isRowNew = true; } const newRowBadge = isRowNew ? `<span class="badge-new">NEW</span>` : ""; const rowId = `p-${x.id}`; const authorName = escapeShipCommentHtml(x.nick || '익명'); const postNum = allPostsData.length - ((currentBoardPage - 1) * postsPerPage) - i; const isHidden = Boolean(x.hidden); const safeTitleHtml = isHidden ? `🔒 자동 블라인드 처리된 게시글입니다.` : escapeShipCommentHtml(x.title || ''); const safeContentHtml = isHidden ? `🔒 커뮤니티 건전성 보호를 위해 자동 블라인드 처리된 게시글입니다. (${escapeShipCommentHtml(x.blindReason || '금칙어/도배 감지')})` : escapeShipCommentHtml(x.content || ''); const viewCnt = Math.max(0, Number(x.views) || 0); const viewBadgeHtml = `<span id="view-badge-p-${x.id}" class="view-count-pill" title="조회수 ${viewCnt.toLocaleString()}회 (중복 조회 포함)">👁️ ${viewCnt.toLocaleString()}</span>`; let attachmentsList = []; if (!isHidden) { if (Array.isArray(x.attachments) && x.attachments.length > 0) { attachmentsList = x.attachments.filter(item => item && item.url); } else if (Array.isArray(x.imageUrls) && x.imageUrls.length > 0) { attachmentsList = x.imageUrls.filter(Boolean).map((u, idx) => ({ url: u, name: `첨부 이미지 ${idx + 1}`, type: 'image/jpeg', isImage: true })); } else { const rawFileUrl = x.fileUrl || x.imageUrl || ''; if (rawFileUrl) { const isImg = Boolean(x.imageUrl || (x.fileType && String(x.fileType).startsWith('image/')) || /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif)(\?|$)/i.test(rawFileUrl)); attachmentsList = [{ url: rawFileUrl, name: x.fileName || (isImg ? '첨부 이미지' : '첨부파일 열기/다운로드'), type: x.fileType || '', isImage: isImg }]; } } } const imageAttachments = attachmentsList.filter(att => Boolean(att.isImage || (att.type && String(att.type).startsWith('image/')) || /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif)(\?|$)/i.test(att.url || ''))); const hasAnyAttachment = attachmentsList.length > 0; const attachIconHtml = hasAnyAttachment ? `<span title="첨부파일 ${attachmentsList.length}개 포함" style="margin-left:3px; font-size:0.82rem; font-weight:800; color:var(--primary);">${imageAttachments.length > 0 ? '🖼️' : '📎'}${attachmentsList.length > 1 ? `<span style="font-size:0.7rem; margin-left:1px;">+${attachmentsList.length}</span>` : ''}</span>` : ''; let attachmentBoxHtml = ''; if (hasAnyAttachment) { const imagesHtml = imageAttachments.map((imgAtt, idx) => { const safeImgUrl = escapeShipCommentHtml(imgAtt.url); return `<div style="margin-bottom:8px;"><img src="${safeImgUrl}" loading="lazy" alt="게시글 첨부 이미지 ${idx + 1}" style="max-width:100%; border-radius:8px; border:1px solid var(--border); cursor:pointer; display:block;" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src=this.src;"></div>`; }).join(''); const downloadLinksHtml = attachmentsList.map((att, idx) => { const safeUrl = escapeShipCommentHtml(att.url); const safeName = escapeShipCommentHtml(att.name || `첨부파일 ${idx + 1}`); return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:5px; padding:5px 10px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25); border-radius:6px; color:var(--primary); font-size:0.78rem; font-weight:800; text-decoration:none;">📎 ${safeName}</a>`; }).join(''); attachmentBoxHtml = `<div style="margin-bottom:12px;">${imagesHtml}<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">${downloadLinksHtml}</div></div>`; } rowsHtml.push(`<tr onclick="toggleBoardRow('${rowId}')" style="cursor:pointer;"> <td class="board-no">${postNum}</td> <td class="board-title" style="${isHidden ? 'color:var(--text-sub); font-style:italic;' : ''}">${safeTitleHtml}${attachIconHtml}${newRowBadge}${viewBadgeHtml} <span id="cmt-badge-${x.id}" class="cmt-count-pill hidden"></span> <span style="font-size:0.75rem; color:var(--primary); margin-left:4px;">▼</span></td> <td class="board-date">${dateStr}</td> <td class="board-nick">${authorName}</td> </tr> <tr id="${rowId}" class="board-content-row"> <td colspan="4" class="board-content-box"> <div style="margin-bottom:12px; font-weight:600; background:var(--card-bg); padding:12px; border-radius:8px; border:1px solid var(--border); white-space:pre-wrap; ${isHidden ? 'color:var(--text-sub); font-style:italic;' : ''}">${safeContentHtml}</div> ${attachmentBoxHtml} <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; border-bottom:1px dashed var(--border); padding-bottom:10px; margin-bottom:10px;"> <span id="view-detail-p-${x.id}" style="font-size:0.76rem; color:var(--text-sub); font-weight:800;">👁️ 조회수 ${viewCnt.toLocaleString()}회</span> <div style="display:flex; gap:5px; margin-left:auto;"> <button class="mini-btn" style="background:var(--primary-light) !important; color:white !important;" onclick="tryEditPost('${x.id}', '', '', '', '', event)">✏️ 수정</button> <button class="mini-btn btn-del" onclick="deletePost('${x.id}','',event)">🗑️ 삭제</button> </div> </div> <div id="cmt-list-${x.id}" class="comment-section"></div> <div class="comment-form"> <div class="comment-form-row"> <input id="cmt-name-${x.id}" class="comment-input-sm board-comment-nickname" placeholder="항만용어 닉네임" aria-label="댓글 닉네임 (직접 수정 가능)" maxlength="50"> <input id="cmt-pw-${x.id}" class="comment-input-sm" type="password" placeholder="비밀번호" aria-label="비밀번호" maxlength="30"> </div> <div id="cmt-preview-${x.id}" class="comment-preview-box" style="display:none;"></div> <div class="comment-form-row"> <input id="cmt-txt-${x.id}" class="comment-input-main" placeholder="따뜻한 댓글을 남겨주세요..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();addComment('${x.id}');}"> <label for="cmt-file-${x.id}" id="cmt-file-label-${x.id}" class="comment-attach-btn" title="사진 첨부">📷</label> <input type="file" id="cmt-file-${x.id}" accept="image/*" style="display:none;" onchange="handleCommentFileChange('${x.id}', this)"> <button id="cmt-submit-${x.id}" class="comment-submit" onclick="addComment('${x.id}')">등록</button> <button id="cmt-cancel-${x.id}" type="button" class="mini-btn btn-del" style="display:none; height:32px; padding:0 8px; border-radius:6px; font-size:0.8rem; margin:0; line-height:30px;" onclick="cancelBoardCommentEdit('${x.id}')">취소</button> </div> </div> </td> </tr>`); }); l.innerHTML = rowsHtml.join(""); pageData.forEach(x => { const nicknameInput = document.getElementById(`cmt-name-${x.id}`); if (nicknameInput && !nicknameInput.value.trim()) nicknameInput.value = getPortNickname(); loadComments(x.id); }); renderPagination(p); } 
function renderShipPage(p) {
    currentShipPage = p;
    const list = document.getElementById("shipList");
    const pagination = document.getElementById("shipPagination");
    Object.values(shipCommentUnsubscribes).forEach(unsubscribe => unsubscribe());
    shipCommentUnsubscribes = {};
    shipCommentsById = {};
    editingShipComment = null;
    list.innerHTML = "";
    pagination.innerHTML = "";
    if (p === 1) pagination.scrollLeft = 0;
    const pageData = filteredShips.slice((p - 1) * postsPerPage, p * postsPerPage);
    if (pageData.length === 0) {
        list.innerHTML = "<tr><td colspan='3' style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>조건에 맞는 선박 정보가 없습니다.</td></tr>";
        return;
    }
    const rowsHtml = [];
    pageData.forEach((ship, index) => {
        const safeShipNameHtml = escapeShipCommentHtml(getShipDisplayName(ship) || "선박명 없음");
        const shipMemoText = getShipMemoText(ship);
        const legacyOnshoreText = getShipLegacyOnshoreText(ship);
        const safeShipFeatHtml = shipMemoText
            ? escapeShipCommentHtml(shipMemoText)
            : (legacyOnshoreText ? "" : `<span style="color:var(--text-sub); font-size:0.82rem;">📝 등록된 작업 메모가 없습니다. 댓글로 정보를 추가해 주세요.</span>`);
        const legacyOnshoreHtml = legacyOnshoreText
            ? `<div style="margin-bottom:12px; background:rgba(2,132,199,0.06); border:1px solid var(--border); border-radius:8px; padding:8px 10px;"><div style="font-weight:900; color:var(--primary); font-size:0.82rem; margin-bottom:4px;">🚛 육상 작업 특징</div><div style="white-space:pre-wrap;">${escapeShipCommentHtml(legacyOnshoreText)}</div></div>`
            : "";
        let dateStr = "";
        let isShipNew = false;
        const date = toShipDate(ship.timestamp);
        if (date) {
            dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
            if (Date.now() - date.getTime() < 24 * 60 * 60 * 1000) isShipNew = true;
        }
        const shipNewBadge = isShipNew ? `<span class="badge-new">NEW</span>` : "";
        const diff = Number(ship.difficulty) || 0;
        const starBadge = diff > 0 ? `<span class="ship-badge-star" title="작업 난이도 ${diff}점">${"★".repeat(diff)}${"☆".repeat(5 - diff)}</span>` : "";
        const viewCnt = Math.max(0, Number(ship.views) || 0);
        const viewBadgeHtml = `<span id="view-badge-s-${ship.id}" class="view-count-pill" title="조회수 ${viewCnt.toLocaleString()}회 (중복 조회 포함)">👁️ ${viewCnt.toLocaleString()}</span>`;
        const sTags = extractShipTags(ship);
        const warnTags = ["#브릿지주의", "#라싱바무거움", "#턴버클뻑뻑함", "#통로협소"];
        const tagsInlineHtml = sTags.length > 0
            ? `<div style="margin-top:3px; white-space:normal;">${sTags.map(t => `<span class="ship-badge-tag ${warnTags.includes(t) ? 'warn' : ''}">${escapeShipCommentHtml(t)}</span>`).join("")}</div>`
            : "";
        const detailMetaHtml = (diff > 0 || sTags.length > 0)
            ? `<div style="background:rgba(10,27,63,0.04); border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:0.82rem;">
                ${diff > 0 ? `<div style="font-weight:900; color:#b45309; margin-bottom:${sTags.length ? '4px' : '0'};">⭐ 작업 난이도: ${"★".repeat(diff)}${"☆".repeat(5 - diff)} (${diff}점)</div>` : ""}
                ${sTags.length > 0 ? `<div><strong style="color:var(--primary);">🏷️ 준비 장비·특징:</strong> ${sTags.map(t => `<span class="ship-badge-tag ${warnTags.includes(t) ? 'warn' : ''}">${escapeShipCommentHtml(t)}</span>`).join("")}</div>` : ""}
            </div>`
            : "";
        const safeImgUrl = ship.imageUrl ? escapeShipCommentHtml(ship.imageUrl) : "";
        const imageHtml = safeImgUrl
            ? `<div style="margin-top:8px; margin-bottom:10px;"><img src="${safeImgUrl}" loading="lazy" alt="선박 현장 이미지" class="ship-post-img" style="width:30%; max-width:30%; min-width:140px; height:auto; border-radius:8px; border:1px solid var(--border); cursor:pointer; display:block; object-fit:cover;" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src=this.src;" title="클릭하여 원본 크기로 확대 보기"></div>`
            : "";
        const rowId = `s-${ship.id}`;
        const postNum = filteredShips.length - ((p - 1) * postsPerPage) - index;
        rowsHtml.push(`<tr onclick="toggleBoardRow('${rowId}')" style="cursor:pointer;"><td class="board-no">${postNum}</td><td class="board-title" style="white-space:normal; line-height:1.35;"><div>🚢 ${safeShipNameHtml} ${starBadge}${shipNewBadge}${viewBadgeHtml} <span style="font-size:0.75rem; color:var(--primary); margin-left:4px;">▼</span></div>${tagsInlineHtml}</td><td class="board-date">${dateStr}</td></tr><tr id="${rowId}" class="board-content-row"><td colspan="3" class="board-content-box">${detailMetaHtml}<div style="margin-bottom:12px; white-space:pre-wrap;">${safeShipFeatHtml}</div>${legacyOnshoreHtml}${imageHtml}<div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:6px; border-bottom:1px dashed var(--border); padding-bottom:10px; margin-bottom:10px;"><div style="display:flex; flex-wrap:wrap; align-items:center; gap:5px;"><button type="button" class="mini-btn" onclick="sendShipInfoToWage('${ship.id}', event)">🧮 임금계산기로</button><button type="button" class="mini-btn" onclick="sendShipInfoToWorkLog('${ship.id}', event)">📅 근무일지로</button><span id="view-detail-s-${ship.id}" style="font-size:0.75rem; color:var(--text-sub); font-weight:800; margin-left:4px;">👁️ 조회수 ${viewCnt.toLocaleString()}회</span></div><div style="display:flex; gap:5px; margin-left:auto;"><button class="mini-btn" style="background:var(--primary-light) !important; color:white !important;" onclick="tryEditShip('${ship.id}', '', '', '')">✏️ 수정</button><button class="mini-btn btn-del" onclick="deleteShip('${ship.id}',event)">🗑️ 삭제</button></div></div>${renderShipCommentMarkup(ship.id)}</td></tr>`);
    });
    list.innerHTML = rowsHtml.join("");
    const totalPages = Math.ceil(filteredShips.length / postsPerPage);
    const pageHtml = [];
    for (let page = 1; page <= totalPages; page++) {
        pageHtml.push(`<span class="page-num ${page === p ? 'active' : ''}" onclick="renderShipPage(${page})" style="flex:0 0 auto; cursor:pointer; padding:5px 12px; margin:2px; background:#e5e7eb; border-radius:8px; font-weight:800; font-size:0.9rem;">${page}</span>`);
    }
    pagination.innerHTML = pageHtml.join("");
};
function renderShipCommentMarkup(shipId) {
    return `<div style="margin-top:12px; border-top:1px dashed var(--border); padding-top:10px;">
        <div style="font-weight:900; margin-bottom:6px; font-size:0.88rem; color:var(--primary);">댓글</div>
        <div id="ship-comment-list-${shipId}" class="comment-section"></div>
        <div class="comment-form">
            <div class="comment-form-row">
                <input id="ship-comment-name-${shipId}" class="comment-input-sm" placeholder="닉네임" maxlength="50">
                <input id="ship-comment-password-${shipId}" class="comment-input-sm" type="password" placeholder="비밀번호" maxlength="30">
            </div>
            <div id="ship-comment-preview-${shipId}" class="comment-preview-box" style="display:none;"></div>
            <div class="comment-form-row">
                <input id="ship-comment-text-${shipId}" class="comment-input-main" placeholder="선박 댓글을 입력하세요..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submitShipComment('${shipId}');}">
                <label for="ship-comment-file-${shipId}" id="ship-comment-file-label-${shipId}" class="comment-attach-btn" title="사진 첨부">📷</label>
                <input type="file" id="ship-comment-file-${shipId}" accept="image/*" style="display:none;" onchange="handleShipCommentFileChange('${shipId}', this)">
                <button id="ship-comment-submit-${shipId}" class="comment-submit" onclick="submitShipComment('${shipId}')">등록</button>
                <button id="ship-comment-cancel-${shipId}" type="button" class="mini-btn btn-del" style="display:none; height:32px; padding:0 8px; border-radius:6px; font-size:0.8rem; margin:0; line-height:30px;" onclick="cancelShipCommentEdit('${shipId}')">취소</button>
            </div>
        </div>
    </div>`;
}
function escapeShipCommentHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
let currentShipPage = 1;
function incrementBoardItemViewCount(collectionName, docId, prefix) {
    if (!collectionName || !docId || typeof db === "undefined" || !db) return;
    let targetItem = null;
    if (collectionName === "ships") {
        targetItem = (allShipsData || []).find(item => item.id === docId);
    } else if (collectionName === "posts") {
        targetItem = (allPostsData || []).find(item => item.id === docId);
    } else if (collectionName === "notices") {
        targetItem = (window.allNoticesCache || []).find(item => item.id === docId);
    }
    const nextViews = Math.max(0, Number(targetItem && targetItem.views) || 0) + 1;
    if (targetItem) targetItem.views = nextViews;

    const badgeEl = document.getElementById(`view-badge-${prefix}-${docId}`);
    if (badgeEl) {
        badgeEl.innerText = `👁️ ${nextViews.toLocaleString()}`;
        badgeEl.title = `조회수 ${nextViews.toLocaleString()}회 (중복 조회 포함)`;
    }
    const detailEl = document.getElementById(`view-detail-${prefix}-${docId}`);
    if (detailEl) {
        detailEl.innerText = `👁️ 조회수 ${nextViews.toLocaleString()}회`;
    }
    const fullTableBadgeEl = document.getElementById(`view-full-s-${docId}`);
    if (fullTableBadgeEl) {
        fullTableBadgeEl.innerText = `👁️ ${nextViews.toLocaleString()}`;
    }

    try {
        db.collection(collectionName).doc(docId).update({
            views: firebase.firestore.FieldValue.increment(1)
        }).catch(err => {
            console.warn(`조회수 업데이트 실패 (${collectionName}/${docId}):`, err && err.message);
        });
    } catch (e) {}
}
function toggleBoardRow(id) {
    const row = document.getElementById(id);
    if (!row) return;
    if (row.classList.contains("show")) {
        row.classList.remove("show");
        scheduleAppHistoryRecord();
        return;
    }
    row.classList.add("show");
    if (id.startsWith("s-")) {
        const shipId = id.slice(2);
        incrementBoardItemViewCount("ships", shipId, "s");
        loadShipComments(shipId);
    } else if (id.startsWith("p-")) {
        incrementBoardItemViewCount("posts", id.slice(2), "p");
    } else if (id.startsWith("n-")) {
        incrementBoardItemViewCount("notices", id.slice(2), "n");
    }
    scheduleAppHistoryRecord();
}
function loadShipComments(shipId) {
    if (shipCommentUnsubscribes[shipId]) return;
    shipCommentUnsubscribes[shipId] = db.collection("ships").doc(shipId).collection("comments").orderBy("timestamp", "asc").onSnapshot(snapshot => {
        const list = document.getElementById(`ship-comment-list-${shipId}`);
        if (!list) return;
        shipCommentsById[shipId] = [];
        list.innerHTML = "";
        if (snapshot.empty) {
            list.innerHTML = "<div style='color:var(--text-sub); font-size:0.8rem; padding:4px 0;'>첫 댓글을 남겨보세요.</div>";
            return;
        }
        snapshot.forEach(doc => {
            const comment = { ...doc.data(), id: doc.id };
            if (isDeletedRecord(comment)) return; // 소프트 삭제된 댓글은 감춥니다.
            shipCommentsById[shipId].push(comment);
            const isHidden = Boolean(comment.hidden);
            const safeName = escapeShipCommentHtml(comment.name || "익명");
            const safeText = isHidden
                ? `🔒 자동 블라인드 처리된 댓글입니다. (${escapeShipCommentHtml(comment.blindReason || '금칙어/도배 감지')})`
                : escapeShipCommentHtml(comment.text || "");
            const imgHtml = (!isHidden && comment.imageUrl)
                ? `<div style="margin-top:4px;"><img src="${escapeShipCommentHtml(comment.imageUrl)}" loading="lazy" alt="댓글 첨부 이미지" class="comment-img-thumb" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src=this.src;" title="클릭하여 원본 확대 보기"></div>`
                : "";
            list.innerHTML += `<div class="comment-item"><div style="flex:1; min-width:0; padding-right:6px;"><div><span class="comment-meta">${safeName}:</span> <span class="comment-text" style="white-space:pre-wrap; ${isHidden ? 'color:var(--text-sub); font-style:italic;' : ''}">${safeText}</span></div>${imgHtml}</div><div style="display:flex; gap:3px; flex-shrink:0;"><button class="mini-btn" style="padding:2px 8px; font-size:0.75rem; border-radius:4px;" onclick="editShipComment('${shipId}','${doc.id}')">수정</button><button class="mini-btn btn-del" style="padding:2px 8px; font-size:0.75rem; border-radius:4px;" onclick="deleteShipComment('${shipId}','${doc.id}')">삭제</button></div></div>`;
        });
    }, error => {
        const list = document.getElementById(`ship-comment-list-${shipId}`);
        if (list) list.innerHTML = "<div style='color:var(--danger); font-size:0.8rem;'>댓글을 불러오지 못했습니다.</div>";
        console.error("선박 댓글 불러오기 오류:", error);
    });
}
async function verifyShipCommentPassword(comment) {
    const enteredPassword = prompt("댓글 비밀번호를 입력하세요. 관리자도 관리자 비밀번호로 관리할 수 있습니다:");
    if (enteredPassword === null) return false;
    if (await verifyPasswordMatch(enteredPassword, comment.password)) return true;
    const enteredHash = await sha256Hex(enteredPassword);
    if (isAdminSessionVerified || enteredHash === DEFAULT_ADMIN_PW_HASH) return true;
    alert("비밀번호가 일치하지 않습니다.");
    return false;
}
async function editShipComment(shipId, commentId) {
    const comment = (shipCommentsById[shipId] || []).find(item => item.id === commentId);
    if (!comment || !(await verifyShipCommentPassword(comment))) return;
    const nameEl = document.getElementById(`ship-comment-name-${shipId}`);
    const pwEl = document.getElementById(`ship-comment-password-${shipId}`);
    const txtEl = document.getElementById(`ship-comment-text-${shipId}`);
    const submitBtn = document.getElementById(`ship-comment-submit-${shipId}`);
    const cancelBtn = document.getElementById(`ship-comment-cancel-${shipId}`);
    const previewEl = document.getElementById(`ship-comment-preview-${shipId}`);
    const labelEl = document.getElementById(`ship-comment-file-label-${shipId}`);
    if (nameEl) nameEl.value = comment.name || "";
    if (pwEl) pwEl.value = "";
    if (txtEl) { txtEl.value = comment.text || ""; txtEl.focus(); }
    delete selectedShipCommentFiles[shipId];
    const fileInput = document.getElementById(`ship-comment-file-${shipId}`);
    if (fileInput) fileInput.value = "";
    if (comment.imageUrl) {
        if (labelEl) labelEl.classList.add("has-file");
        if (previewEl) {
            previewEl.style.display = "flex";
            previewEl.innerHTML = `
                <img src="${escapeShipCommentHtml(comment.imageUrl)}" class="comment-preview-thumb" alt="기존 첨부 이미지">
                <span class="comment-preview-name">기존 첨부 이미지</span>
                <button type="button" class="comment-preview-remove" onclick="removeShipCommentFile('${shipId}')" title="이미지 삭제">×</button>
            `;
        }
    } else {
        if (labelEl) labelEl.classList.remove("has-file");
        if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
    }
    editingShipComment = { shipId, commentId, existingImageUrl: comment.imageUrl || null };
    if (submitBtn) submitBtn.innerText = "수정 완료";
    if (cancelBtn) cancelBtn.style.display = "inline-flex";
}
async function deleteShipComment(shipId, commentId) {
    const comment = (shipCommentsById[shipId] || []).find(item => item.id === commentId);
    if (!comment || !(await verifyShipCommentPassword(comment))) return;
    if (!confirm("이 댓글을 삭제할까요?")) return;
    db.collection("ships").doc(shipId).collection("comments").doc(commentId).update(softDeletePayload()).then(() => {
        if (editingShipComment && editingShipComment.shipId === shipId && editingShipComment.commentId === commentId) {
            cancelShipCommentEdit(shipId);
        }
        showToast("댓글이 삭제되었습니다.");
    }).catch(error => alert("댓글 삭제 실패: " + error.message));
}
function cancelShipCommentEdit(shipId) {
    const nameEl = document.getElementById(`ship-comment-name-${shipId}`);
    const pwEl = document.getElementById(`ship-comment-password-${shipId}`);
    const txtEl = document.getElementById(`ship-comment-text-${shipId}`);
    const submitBtn = document.getElementById(`ship-comment-submit-${shipId}`);
    const cancelBtn = document.getElementById(`ship-comment-cancel-${shipId}`);
    if (nameEl) nameEl.value = "";
    if (pwEl) pwEl.value = "";
    if (txtEl) txtEl.value = "";
    if (submitBtn) { submitBtn.innerText = "등록"; submitBtn.disabled = false; }
    if (cancelBtn) cancelBtn.style.display = "none";
    removeShipCommentFile(shipId);
    editingShipComment = null;
}
async function submitShipComment(shipId) {
    const nameEl = document.getElementById(`ship-comment-name-${shipId}`);
    const pwEl = document.getElementById(`ship-comment-password-${shipId}`);
    const txtEl = document.getElementById(`ship-comment-text-${shipId}`);
    const submitBtn = document.getElementById(`ship-comment-submit-${shipId}`);
    const name = (nameEl?.value || "").trim();
    const password = (pwEl?.value || "").trim();
    const text = (txtEl?.value || "").trim();
    const attachedFile = selectedShipCommentFiles[shipId];

    if (!name || !password || (!text && !attachedFile)) {
        alert("닉네임, 비밀번호, 그리고 댓글 내용(또는 사진)을 입력해 주세요.");
        return;
    }

    const pwHash = (/^[a-f0-9]{64}$/i.test(password)) ? password.toLowerCase() : (await sha256Hex(password));
    const isEditing = editingShipComment && editingShipComment.shipId === shipId;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = attachedFile ? "사진 업로드 중..." : "저장 중...";
    }

    try {
        let imageUrl = null;
        if (attachedFile) {
            imageUrl = await uploadCommentImageFile(attachedFile, "ships/comments");
        } else if (isEditing) {
            imageUrl = editingShipComment.existingImageUrl || null;
        }

        const comments = db.collection("ships").doc(shipId).collection("comments");
        const modResult = inspectCommunityContent({
            text,
            author: name,
            category: "선박 댓글"
        });
        const commentData = {
            name,
            password: pwHash,
            text,
            hidden: Boolean(modResult.hidden),
            blindReason: modResult.reason || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (modResult.hidden) {
            notifyAdminAutoBlind({
                category: "선박 댓글",
                author: name,
                text,
                reason: modResult.reason
            });
        }
        if (imageUrl) {
            commentData.imageUrl = imageUrl;
        } else if (isEditing) {
            commentData.imageUrl = null;
        }

        if (isEditing) {
            await comments.doc(editingShipComment.commentId).update(commentData);
            cancelShipCommentEdit(shipId);
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다." : "선박 댓글이 수정되었습니다.");
        } else {
            await comments.add(commentData);
            if (txtEl) txtEl.value = "";
            if (pwEl) pwEl.value = "";
            removeShipCommentFile(shipId);
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다." : "선박 댓글이 등록되었습니다.");
        }
    } catch (error) {
        alert("댓글 저장 실패: " + (error?.message || error));
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = (editingShipComment && editingShipComment.shipId === shipId) ? "수정 완료" : "등록";
        }
    }
}
function renderPagination(curr) { const total = Math.ceil(allPostsData.length / postsPerPage); const el = document.getElementById('pagination'); if(!el) return; const html = []; for(let i=1; i<=total; i++){ html.push(`<span class="page-num ${i===curr?'active':''}" onclick="renderBoardPage(${i})" style="cursor:pointer; padding:5px 12px; margin:2px; background:#e5e7eb; border-radius:8px; font-weight:800; font-size:0.9rem;">${i}</span>`); } el.innerHTML = html.join(""); } 
function loadComments(pid){if(commentUnsubscribes[pid]) commentUnsubscribes[pid](); commentUnsubscribes[pid]=db.collection('posts').doc(pid).collection('comments').orderBy('timestamp','asc').onSnapshot(s=>{const el=document.getElementById(`cmt-list-${pid}`); const badgeEl=document.getElementById(`cmt-badge-${pid}`); const visibleComments=[]; s.forEach(d=>{const c=d.data()||{}; if(isDeletedRecord(c)) return; visibleComments.push(d);}); if(badgeEl){ if(visibleComments.length>0){ badgeEl.innerText=`💬 ${visibleComments.length}`; badgeEl.classList.remove('hidden'); } else { badgeEl.classList.add('hidden'); } } if(!el) return; boardCommentsById[pid]=[]; const items=[]; s.forEach(d=>{const c=d.data()||{}; if(isDeletedRecord(c)) return; boardCommentsById[pid].push({...c, id:d.id}); const isHidden=Boolean(c.hidden); const safeName=escapeShipCommentHtml(c.name||"익명"); const safeText=isHidden ? `🔒 자동 블라인드 처리된 댓글입니다. (${escapeShipCommentHtml(c.blindReason||'금칙어/도배 감지')})` : escapeShipCommentHtml(c.text||""); const safePw=String(c.password||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/"/g,"&quot;"); const imgHtml=(!isHidden && c.imageUrl) ? `<div style="margin-top:4px;"><img src="${escapeShipCommentHtml(c.imageUrl)}" loading="lazy" alt="댓글 첨부 이미지" class="comment-img-thumb" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src=this.src;" title="클릭하여 원본 확대 보기"></div>` : ""; items.push(`<div class="comment-item"><div style="flex:1; min-width:0; padding-right:6px;"><div><span class="comment-meta">${safeName}:</span> <span class="comment-text" style="white-space:pre-wrap; ${isHidden ? 'color:var(--text-sub); font-style:italic;' : ''}">${safeText}</span></div>${imgHtml}</div><div style="display:flex; gap:3px; flex-shrink:0;"><button class="mini-btn" style="padding:2px 8px; font-size:0.75rem; border-radius:4px;" onclick="editComment('${pid}','${d.id}')">수정</button><button class="mini-btn btn-del" style="padding:2px 8px; font-size:0.75rem; border-radius:4px;" onclick="deleteComment('${pid}','${d.id}','${safePw}')">삭제</button></div></div>`);}); el.innerHTML=items.join("");}, err=>{console.warn("댓글 로드 오류:",err);});} 

function openBusSchedule(){ trackAppEvent('actions', 'bus_view'); const m=document.getElementById('imageModal'); document.getElementById('modalImage').src='https://firebasestorage.googleapis.com/v0/b/busan-hak-port.firebasestorage.app/o/KakaoTalk_20260129_001114789.jpg?alt=media'; m.style.display='flex'; } function closeImageModal(){ document.getElementById('imageModal').style.display='none'; } function openPrivacy() { toggleDashItem('privacy-center-card'); document.getElementById('privacy-center-card').scrollIntoView({behavior: 'smooth', block: 'center'}); }

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js").then(reg => {
            reg.addEventListener("updatefound", () => {
                const newWorker = reg.installing;
                if (!newWorker) return;
                newWorker.addEventListener("statechange", () => {
                    if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                        if (typeof showToast === "function") {
                            showToast("✨ 새 버전이 준비되었습니다. 새로고침 시 즉시 반영됩니다.");
                        }
                    }
                });
            });
        }).catch(err => console.warn("SW 등록 확인:", err));
    });
}

async function ensureTodayUpdateNotice() {
    const noticeDocId = "update_2026_10_19_multi_vessel_emergency";
    const noticeVersion = "multi_vessel_emergency_20261019_r2";
    const noticeTitle = "선박 4척(멀티오더) 지원 · 🚨 긴급 플로팅 공지 신설 업데이트";
    const noticeContent = [
        "부산항(신항·북항) 현장 근로자 여러분, 안녕하십니까! 운영관리자 이춘학입니다.",
        "하루에 선박을 3~4척까지 작업하는 날이 늘어남에 따라, 임금계산기와 근무일지를 선박 4척 기준으로 확장했습니다. 또한 급히 전달해야 할 현장 상황을 모든 접속자에게 즉시 띄우는 [🚨 긴급 플로팅 공지] 기능이 새로 추가되었습니다.",
        "",
        "🚢 1. 당일 작업 선박 최대 2척 → 최대 4척 확대 (더블·트리플·쿼드오더)",
        "• 당일 입·출항 선박 스케줄에서 작업 선박을 최대 4척까지 선택할 수 있습니다. (2척=더블오더 · 3척=트리플오더 · 4척=쿼드오더)",
        "• 선택한 선박의 입·출항 시각으로 각 선박 근무시간이 자동 계산되어 [⏳ 총 근무시간]에 모두 합산됩니다.",
        "• 임금 산정 내역서도 선박별(임금 1~임금 4) 소계와 총액으로 나누어 표시됩니다.",
        "",
        "⏱️ 2. 선박별 자동계산 블록 4칸 · 총근무시간 블록과 높이 일치",
        "• [⏱️ 선박별 자동계산] 영역이 1~4번 선박 4칸 구조로 바뀌었습니다.",
        "• 평소에는 1·2번 선박 칸만 보이고, 선박을 3척 또는 4척 선택하면 3·4번 칸이 자동으로 나타납니다.",
        "• 표시되는 칸은 항상 같은 크기로 균등 분할되며, 블록 전체 높이는 옆의 [⏳ 총 근무시간] 블록 높이와 정확히 일치하도록 맞췄습니다.",
        "",
        "💰 3. 근무일지 [임금 3] · [임금 4] 입력칸 추가 (평소에는 숨김)",
        "• 근무일지에 임금 3·임금 4 입력칸이 추가되었습니다. 기본 화면에서는 임금 1·임금 2만 보입니다.",
        "• 선박을 3~4척 선택하면 임금 3·임금 4 칸이 자동으로 열리고, 계산 결과를 근무일지로 보내면 선박별 금액이 임금 1~4로 각각 자동 입력됩니다.",
        "• 월간 합계·총임금·목표 달성률, 연간 리포트, 관리자 누적 분석, CSV(엑셀) 내려받기 항목에도 임금 3·임금 4가 모두 반영됩니다.",
        "",
        "📝 4. 작업 내용 자동 입력 문구 확장",
        "• 선박 2~4척 선택 시 작업 내용 맨 위에 [🚢 트리플오더 작업 (선박 3척 · 합계 OOH)] 형태의 요약 블록과 ①②③④ 선박별 입·출항 시각이 자동으로 입력됩니다.",
        "",
        "🚨 5. [신규] 긴급 플로팅 공지 — 상단 흐르는 문구(티커)와 별개 기능",
        "• 관리자가 작성하면 모든 접속자 화면 상단에 공지 카드가 떠올라(floating) 즉시 읽을 수 있습니다.",
        "• 게시 ON/OFF 전환과 게시 기간(시작·종료 시각) 지정이 가능하며, 기간이 끝나면 자동으로 사라집니다.",
        "• 표시 단계(🔴 긴급 / 🟠 주의 / 🔵 안내)를 고를 수 있고, 읽은 뒤 ✕ 로 접으면 오른쪽 아래 🚨 버튼으로 다시 열 수 있습니다.",
        "• 작성은 관리자 비밀번호 인증을 통과한 운영자만 가능합니다. (상단 톱니바퀴 ⚙️ 메뉴 → 🚨 긴급 플로팅 공지)",
        "",
        "⚠️ [꼭 확인] 임금 자동 입력 시간 기준",
        "• 임금 자동 입력은 차트상(작업실제 시작시간)이 아닌 스케줄상(입출항시간)기준으로 시간이 자동 입력됩니다.",
        "• 입항시간과 실제 작업시간(스타트 시간)이 차이나는 경우 시간을 수동으로 입력하시면 됩니다!",
        "",
        "언제나 현장에서 안전을 최우선으로 작업하시길 바라며, 이용 중 불편한 점이나 건의 사항은 운영관리자(이춘학 / 010-2846-8906)에게 연락 주시기 바랍니다. 오늘도 무사고 안전 작업하십시오!"
    ].join("\n");
    try {
        const docRef = db.collection("notices").doc(noticeDocId);
        const snap = await docRef.get();
        if (!snap.exists || snap.data()?.version !== noticeVersion) {
            await docRef.set({
                title: noticeTitle,
                content: noticeContent,
                version: noticeVersion,
                isPriority: true,
                imageUrl: null,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (e) {
        console.warn("업데이트 공지 자동 등록 확인 중 오류:", e);
    }
}

/** 이전 버전(Ver.2) 업데이트 공지 — 기록 보존용. 신규 등록은 하지 않습니다. */
async function ensureHakPortVer2UpdateNotice() {
    const noticeDocId = "update_2026_10_10_hak_port_ver2";
    const noticeVersion = "hak_port_ver2_20261010_r1";
    const noticeTitle = "HAK PORT Ver.2 업데이트";
    const noticeContent = [
        "부산항(신항·북항) 현장 근로자 여러분, 안녕하십니까! 운영관리자 이춘학입니다.",
        "더 빠르고 정확한 임금 계산과 모바일 현장 사용성을 위해 [HAK PORT Ver.2 업데이트]가 적용되었습니다. 오늘 반영된 주요 변경 사항을 안내해 드립니다.",
        "",
        "🚢 1. 당일 입·출항 선박 최대 2척 선택(더블오더) & 선박별 자동계산 연동",
        "• 당일 입·출항 선박 스케줄에서 작업 선박을 최대 2척까지 동시에 선택할 수 있습니다.",
        "• 2번째 선박 선택 시 [더블오더]가 자동 체크되며, [⏱️ 선박별 자동계산 (1번 선박 / 2번 선박)] 카드와 [⏳ 총 근무시간]에 선박별 근무시간이 자동 합산·표시됩니다.",
        "• 계산 완료 후 [이 계산 결과를 근무일지로 보내기]를 누르면 1번 선박은 [임금 1], 2번 선박(더블오더)은 [임금 2]로 자동 분리 입력됩니다.",
        "",
        "📅 2. 연도별 시급(기본 2026년 시급) 표시 및 달력 날짜 자동 연동",
        "• 시급 입력란이 [2026년 시급]으로 표시되며, 시작·종료 날짜 달력 및 선박 스케줄 달력에서 선택한 연도에 맞춰 해당 연도 시급 라벨과 기본 시급으로 자동 변경됩니다.",
        "• 시급 입력창 너비와 테두리 시인성을 강화하여 터치 및 직접 수정이 더욱 편리해졌습니다.",
        "",
        "📐 3. 임금계산기 화면 배치 최적화 및 접기/펼치기(▼) 간편화",
        "• [월·주간·야간 시간표]를 임금계산기 상단 헤더 우측에 배치해 카드를 열면 접힘 없이 한눈에 기준 시간을 확인할 수 있습니다.",
        "• [📅 시작·종료 날짜·시간 수동 입력] 및 [✅ 추가 수당 시간 입력] 영역을 필요할 때만 펼쳐 쓰는 접기/펼치기(▼) 구조로 정리하여 화면 스크롤 부담을 대폭 줄였습니다.",
        "• [⏱️ 선박별 자동계산 · ⏳ 총 근무시간] 블록을 계산 버튼 바로 위로 배치하여 선박 선택 후 시간 확인부터 내역서 생성까지 한 흐름으로 이어지도록 개선했습니다.",
        "",
        "🧾 4. 세금 공제 선택 제거 및 순수 임금 산정 일원화",
        "• 기존의 복잡한 프리랜서(3.3%)·4대보험 선택 블록을 제거하고, 주·야간 및 직종·추가 수당 기준의 정확한 임금 산정 내역이 바로 계산되도록 단순화했습니다.",
        "",
        "📱 5. 모바일(Galaxy S24 Ultra 등) 상단 헤더 및 오프라인 안정성 강화",
        "• 작은 화면에서도 상단 방문자 배지·타이틀·다크모드 버튼이 겹치지 않도록 반응형 간격을 보완했습니다.",
        "• 터미널 스케줄 조회 중 작업중(주황색) 선박 카드의 경계선 시인성을 높이고, 뒤로가기 버튼 및 오프라인 캐시 안정성을 개선했습니다.",
        "",
        "언제나 현장에서 안전을 최우선으로 작업하시길 바라며, 이용 중 불편한 점이나 건의 사항은 운영관리자(이춘학 / 010-2846-8906)에게 연락 주시기 바랍니다. 오늘도 무사고 안전 작업하십시오!"
    ].join("\n");
    try {
        const docRef = db.collection("notices").doc(noticeDocId);
        const snap = await docRef.get();
        if (!snap.exists || snap.data()?.version !== noticeVersion) {
            await docRef.set({
                title: noticeTitle,
                content: noticeContent,
                version: noticeVersion,
                isPriority: true,
                imageUrl: null,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (e) {
        console.warn("업데이트 공지 자동 등록 확인 중 오류:", e);
    }
}

const DAILY_FIELD_ENGLISH_PHRASES = [
    { sentence: "Please wait here.", pronunciation: "플리즈 웨잇 히어", meaning: "여기서 기다려 주세요.", word: "wait = 기다리다" },
    { sentence: "Watch your step.", pronunciation: "와치 유어 스텝", meaning: "발밑을 조심하세요.", word: "step = 발걸음, 계단" },
    { sentence: "Please wear a helmet.", pronunciation: "플리즈 웨어 어 헬멧", meaning: "안전모를 써 주세요.", word: "wear = 착용하다" },
    { sentence: "The ship is here.", pronunciation: "더 쉽 이즈 히어", meaning: "배가 여기에 있어요.", word: "ship = 배" },
    { sentence: "The crane is moving.", pronunciation: "더 크레인 이즈 무빙", meaning: "크레인이 움직이고 있어요.", word: "moving = 움직이는 중" },
    { sentence: "Stay behind the line.", pronunciation: "스테이 비하인드 더 라인", meaning: "선 뒤에 서 주세요.", word: "behind = 뒤에" },
    { sentence: "Walk slowly, please.", pronunciation: "워크 슬로울리, 플리즈", meaning: "천천히 걸어 주세요.", word: "slowly = 천천히" },
    { sentence: "The floor is wet.", pronunciation: "더 플로어 이즈 웻", meaning: "바닥이 젖어 있어요.", word: "wet = 젖은" },
    { sentence: "Hold the handrail, please.", pronunciation: "홀드 더 핸드레일, 플리즈", meaning: "손잡이를 잡아 주세요.", word: "hold = 잡다" },
    { sentence: "Stay with your team.", pronunciation: "스테이 위드 유어 팀", meaning: "작업조와 함께 있어 주세요.", word: "team = 팀, 작업조" },
    { sentence: "Let's check the tools.", pronunciation: "렛츠 체크 더 툴즈", meaning: "도구를 함께 확인해요.", word: "check = 확인하다" },
    { sentence: "I need a safety vest.", pronunciation: "아이 니드 어 세이프티 베스트", meaning: "안전 조끼가 필요해요.", word: "need = 필요하다" },
    { sentence: "The truck is coming.", pronunciation: "더 트럭 이즈 커밍", meaning: "트럭이 오고 있어요.", word: "coming = 오는 중" },
    { sentence: "Do not run here.", pronunciation: "두 낫 런 히어", meaning: "여기서 뛰지 마세요.", word: "run = 뛰다" },
    { sentence: "Please stand back.", pronunciation: "플리즈 스탠드 백", meaning: "뒤로 물러나 주세요.", word: "stand back = 뒤로 물러서다" },
    { sentence: "Can you help me?", pronunciation: "캔 유 헬프 미?", meaning: "저를 도와주실 수 있나요?", word: "help = 돕다" },
    { sentence: "I am ready to work.", pronunciation: "아이 앰 레디 투 워크", meaning: "저는 일할 준비가 됐어요.", word: "ready = 준비된" },
    { sentence: "Please follow me.", pronunciation: "플리즈 팔로우 미", meaning: "저를 따라오세요.", word: "follow = 따라오다" },
    { sentence: "Put the tools here.", pronunciation: "풋 더 툴즈 히어", meaning: "도구를 여기에 놓아 주세요.", word: "put = 놓다" },
    { sentence: "Be careful near the crane.", pronunciation: "비 케어풀 니어 더 크레인", meaning: "크레인 근처에서는 조심하세요.", word: "careful = 조심하는" },
    { sentence: "The container is heavy.", pronunciation: "더 컨테이너 이즈 헤비", meaning: "컨테이너가 무거워요.", word: "heavy = 무거운" },
    { sentence: "Let's work together.", pronunciation: "렛츠 워크 투게더", meaning: "함께 일해요.", word: "together = 함께" },
    { sentence: "Is this the right place?", pronunciation: "이즈 디스 더 라이트 플레이스?", meaning: "여기가 맞는 장소인가요?", word: "right = 맞는" },
    { sentence: "Where is the meeting point?", pronunciation: "웨어 이즈 더 미팅 포인트?", meaning: "모이는 장소가 어디인가요?", word: "where = 어디" },
    { sentence: "Please look at the sign.", pronunciation: "플리즈 룩 앳 더 사인", meaning: "표지판을 봐 주세요.", word: "sign = 표지판" },
    { sentence: "Wait for the green light.", pronunciation: "웨잇 포 더 그린 라이트", meaning: "초록불을 기다려 주세요.", word: "green light = 초록불" },
    { sentence: "Keep a safe distance.", pronunciation: "킵 어 세이프 디스턴스", meaning: "안전거리를 유지해 주세요.", word: "safe = 안전한" },
    { sentence: "The work is finished.", pronunciation: "더 워크 이즈 피니시트", meaning: "작업이 끝났어요.", word: "finished = 끝난" },
    { sentence: "Thank you for your help.", pronunciation: "땡큐 포 유어 헬프", meaning: "도와주셔서 고맙습니다.", word: "thank you = 고맙습니다" },
    { sentence: "Use the safe path.", pronunciation: "유즈 더 세이프 패스", meaning: "안전한 길을 이용하세요.", word: "path = 길" }
];

const DAILY_FIELD_ENGLISH_TIME_ZONE = "Asia/Seoul";
const DAILY_FIELD_ENGLISH_UPDATE_HOUR = 9;
const DAILY_FIELD_ENGLISH_CYCLE_START = Date.UTC(2026, 0, 1);
const DAILY_FIELD_ENGLISH_FIRST_DATE_KEY = "2026-01-01";

let dailyFieldEnglishSelectedDateKey = "";
let dailyFieldEnglishActiveDateKey = "";
let dailyFieldEnglishCalendarYear = null;
let dailyFieldEnglishCalendarMonth = null;
let dailyFieldEnglishUpdateTimer = null;
let dailyFieldEnglishInitialized = false;

function getKoreaDateTimeParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: DAILY_FIELD_ENGLISH_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);

    const values = {};
    parts.forEach(part => {
        if (part.type !== "literal") values[part.type] = Number(part.value);
    });
    return values;
}

function formatDailyFieldEnglishDateKey(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getDailyFieldEnglishSnapshotForDateKey(dateKey) {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        month < 1 || month > 12 ||
        day < 1 || day > 31
    ) return null;

    const effectiveDate = new Date(Date.UTC(year, month - 1, day));
    if (
        effectiveDate.getUTCFullYear() !== year ||
        effectiveDate.getUTCMonth() + 1 !== month ||
        effectiveDate.getUTCDate() !== day
    ) return null;

    const daysSinceCycleStart = Math.floor(
        (effectiveDate.getTime() - DAILY_FIELD_ENGLISH_CYCLE_START) / 86400000
    );
    const phraseIndex =
        ((daysSinceCycleStart % DAILY_FIELD_ENGLISH_PHRASES.length) +
            DAILY_FIELD_ENGLISH_PHRASES.length) %
        DAILY_FIELD_ENGLISH_PHRASES.length;

    return {
        dateKey: formatDailyFieldEnglishDateKey(year, month, day),
        year,
        month,
        day,
        phrase: DAILY_FIELD_ENGLISH_PHRASES[phraseIndex]
    };
}

function getDailyFieldEnglishSnapshot(date = new Date()) {
    const koreaTime = getKoreaDateTimeParts(date);
    const effectiveDate = new Date(
        Date.UTC(koreaTime.year, koreaTime.month - 1, koreaTime.day)
    );

    if (koreaTime.hour < DAILY_FIELD_ENGLISH_UPDATE_HOUR) {
        effectiveDate.setUTCDate(effectiveDate.getUTCDate() - 1);
    }

    const dateKey = formatDailyFieldEnglishDateKey(
        effectiveDate.getUTCFullYear(),
        effectiveDate.getUTCMonth() + 1,
        effectiveDate.getUTCDate()
    );

    return getDailyFieldEnglishSnapshotForDateKey(dateKey);
}

function updateDailyFieldEnglishLesson(snapshot) {
    if (!snapshot) return;

    const sentenceEl = document.getElementById("dailyFieldEnglishSentence");
    if (sentenceEl) sentenceEl.textContent = snapshot.phrase.sentence;
    const pronEl = document.getElementById("dailyFieldEnglishPronunciation");
    if (pronEl) pronEl.textContent = snapshot.phrase.pronunciation;
    const meanEl = document.getElementById("dailyFieldEnglishMeaning");
    if (meanEl) meanEl.textContent = snapshot.phrase.meaning;
    const wordEl = document.getElementById("dailyFieldEnglishWord");
    if (wordEl) wordEl.textContent = snapshot.phrase.word;
    const dateEl = document.getElementById("dailyFieldEnglishDate");
    if (dateEl) dateEl.textContent = `${snapshot.year}년 ${snapshot.month}월 ${snapshot.day}일 문장`;

    const hintEl = document.getElementById("dailyFieldEnglishCalendarHint");
    if (hintEl) {
        hintEl.innerHTML = snapshot.dateKey === dailyFieldEnglishActiveDateKey
            ? "<strong>현재 문장</strong> · 날짜를 눌러 지난 문장을 복습하세요."
            : `${snapshot.month}월 ${snapshot.day}일 문장을 복습 중입니다.`;
    }
}

function renderDailyFieldEnglishCalendar() {
    const grid = document.getElementById("dailyFieldEnglishCalendarGrid");
    const monthLabel = document.getElementById("dailyFieldEnglishCalendarMonth");
    if (!grid || !monthLabel || !dailyFieldEnglishActiveDateKey) return;

    const activeSnapshot = getDailyFieldEnglishSnapshotForDateKey(
        dailyFieldEnglishActiveDateKey
    );
    if (!activeSnapshot) return;

    const year = dailyFieldEnglishCalendarYear;
    const month = dailyFieldEnglishCalendarMonth;
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const activeMonth = Date.UTC(activeSnapshot.year, activeSnapshot.month - 1, 1);
    const visibleMonth = Date.UTC(year, month - 1, 1);

    monthLabel.textContent = `${year}년 ${month}월`;
    const prevBtn = document.getElementById("dailyFieldEnglishPrevMonth");
    if (prevBtn) prevBtn.disabled = visibleMonth <= Date.UTC(2026, 0, 1);
    const nextBtn = document.getElementById("dailyFieldEnglishNextMonth");
    if (nextBtn) nextBtn.disabled = visibleMonth >= activeMonth;

    const cells = [];
    for (let blank = 0; blank < firstWeekday; blank++) {
        cells.push('<span class="daily-field-english-calendar-empty" aria-hidden="true"></span>');
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = formatDailyFieldEnglishDateKey(year, month, day);
        const isSelected = dateKey === dailyFieldEnglishSelectedDateKey;
        const isActiveDate = dateKey === dailyFieldEnglishActiveDateKey;
        const isDisabled =
            dateKey < DAILY_FIELD_ENGLISH_FIRST_DATE_KEY ||
            dateKey > dailyFieldEnglishActiveDateKey;

        const classes = ["daily-field-english-calendar-day"];
        if (isSelected) classes.push("is-selected");
        if (isActiveDate) classes.push("is-active-date");

        cells.push(
            `<button type="button"
                class="${classes.join(" ")}"
                onclick="selectDailyFieldEnglishDate('${dateKey}')"
                aria-pressed="${isSelected ? "true" : "false"}"
                ${isDisabled ? "disabled" : ""}>${day}</button>`
        );
    }

    while (cells.length % 7 !== 0) {
        cells.push('<span class="daily-field-english-calendar-empty" aria-hidden="true"></span>');
    }

    grid.innerHTML = cells.join("");
}

function selectDailyFieldEnglishDate(dateKey) {
    if (
        !dateKey ||
        dateKey < DAILY_FIELD_ENGLISH_FIRST_DATE_KEY ||
        dateKey > dailyFieldEnglishActiveDateKey
    ) return;

    const snapshot = getDailyFieldEnglishSnapshotForDateKey(dateKey);
    if (!snapshot) return;

    dailyFieldEnglishSelectedDateKey = dateKey;
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    updateDailyFieldEnglishLesson(snapshot);
    renderDailyFieldEnglishCalendar();
}

function changeDailyFieldEnglishMonth(offset) {
    const target = new Date(Date.UTC(
        dailyFieldEnglishCalendarYear,
        dailyFieldEnglishCalendarMonth - 1 + offset,
        1
    ));

    const targetMonth = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1);
    const activeSnapshot = getDailyFieldEnglishSnapshotForDateKey(
        dailyFieldEnglishActiveDateKey
    );
    if (!activeSnapshot) return;
    const activeMonth = Date.UTC(
        activeSnapshot.year,
        activeSnapshot.month - 1,
        1
    );

    if (targetMonth < Date.UTC(2026, 0, 1) || targetMonth > activeMonth) return;

    dailyFieldEnglishCalendarYear = target.getUTCFullYear();
    dailyFieldEnglishCalendarMonth = target.getUTCMonth() + 1;
    renderDailyFieldEnglishCalendar();
}

function showDailyFieldEnglishToday() {
    const currentSnapshot = getDailyFieldEnglishSnapshot();
    if (!currentSnapshot) return;

    dailyFieldEnglishActiveDateKey = currentSnapshot.dateKey;
    dailyFieldEnglishSelectedDateKey = currentSnapshot.dateKey;
    dailyFieldEnglishCalendarYear = currentSnapshot.year;
    dailyFieldEnglishCalendarMonth = currentSnapshot.month;

    updateDailyFieldEnglishLesson(currentSnapshot);
    renderDailyFieldEnglishCalendar();
}

function renderDailyFieldEnglish(date = new Date()) {
    const currentSnapshot = getDailyFieldEnglishSnapshot(date);
    if (!currentSnapshot) return;

    const previousActiveDateKey = dailyFieldEnglishActiveDateKey;
    dailyFieldEnglishActiveDateKey = currentSnapshot.dateKey;

    if (
        !dailyFieldEnglishSelectedDateKey ||
        dailyFieldEnglishSelectedDateKey === previousActiveDateKey ||
        dailyFieldEnglishSelectedDateKey > currentSnapshot.dateKey
    ) {
        dailyFieldEnglishSelectedDateKey = currentSnapshot.dateKey;
        dailyFieldEnglishCalendarYear = currentSnapshot.year;
        dailyFieldEnglishCalendarMonth = currentSnapshot.month;
    }

    if (!dailyFieldEnglishCalendarYear || !dailyFieldEnglishCalendarMonth) {
        dailyFieldEnglishCalendarYear = currentSnapshot.year;
        dailyFieldEnglishCalendarMonth = currentSnapshot.month;
    }

    const selectedSnapshot =
        getDailyFieldEnglishSnapshotForDateKey(dailyFieldEnglishSelectedDateKey) ||
        currentSnapshot;

    updateDailyFieldEnglishLesson(selectedSnapshot);
    renderDailyFieldEnglishCalendar();
}

function scheduleDailyFieldEnglishUpdate() {
    pauseDailyFieldEnglish();
    const now = new Date();
    const koreaTime = getKoreaDateTimeParts(now);
    const nextKoreaDate = new Date(Date.UTC(
        koreaTime.year,
        koreaTime.month - 1,
        koreaTime.day
    ));

    if (koreaTime.hour >= DAILY_FIELD_ENGLISH_UPDATE_HOUR) {
        nextKoreaDate.setUTCDate(nextKoreaDate.getUTCDate() + 1);
    }

    // 한국시간은 UTC+9이므로 다음 오전 9시에 맞춰 렌더링합니다.
    const nextUpdateUtc = Date.UTC(
        nextKoreaDate.getUTCFullYear(),
        nextKoreaDate.getUTCMonth(),
        nextKoreaDate.getUTCDate(),
        DAILY_FIELD_ENGLISH_UPDATE_HOUR
    ) - (9 * 60 * 60 * 1000);

    dailyFieldEnglishUpdateTimer = setTimeout(() => {
        renderDailyFieldEnglish();
        scheduleDailyFieldEnglishUpdate();
    }, Math.max(100, nextUpdateUtc - now.getTime() + 50));
}

function pauseDailyFieldEnglish() {
    if (dailyFieldEnglishUpdateTimer) {
        clearTimeout(dailyFieldEnglishUpdateTimer);
    }
    dailyFieldEnglishUpdateTimer = null;
}

function initializeDailyFieldEnglish() {
    if (!dailyFieldEnglishInitialized) {
        dailyFieldEnglishInitialized = true;

        document.addEventListener("visibilitychange", () => {
            const card = document.getElementById("daily-field-english-card");

            if (!document.hidden && card?.classList.contains("expanded")) {
                renderDailyFieldEnglish();
                scheduleDailyFieldEnglishUpdate();
            }
        });
    }

    renderDailyFieldEnglish();
    scheduleDailyFieldEnglishUpdate();
}

function speakDailyFieldEnglish() {
    const sentence = document.getElementById("dailyFieldEnglishSentence")
        ?.textContent?.trim();

    if (!sentence) return;
    if (!window.speechSynthesis ||
        typeof window.SpeechSynthesisUtterance !== "function") {
        showToast("이 브라우저에서는 영어 듣기를 사용할 수 없습니다.");
        return;
    }

    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(sentence);
    utterance.lang = "en-US";
    utterance.rate = 0.78;
    window.speechSynthesis.speak(utterance);
}

let currentNoticePage = 1;
function renderNoticePagination(curr) {
    const allNotices = window.allNoticesCache || [];
    const total = Math.ceil(allNotices.length / postsPerPage);
    const el = document.getElementById("noticePagination");
    if (!el) return;
    if (total <= 1) { el.innerHTML = ""; return; }
    const html = [];
    for (let i = 1; i <= total; i++) {
        html.push(`<span class="page-num ${i === curr ? 'active' : ''}" onclick="renderNoticePage(${i})" style="cursor:pointer; padding:5px 12px; margin:2px; background:#e5e7eb; border-radius:8px; font-weight:800; font-size:0.9rem;">${i}</span>`);
    }
    el.innerHTML = html.join("");
}

function renderNoticePage(p) {
    currentNoticePage = p;
    const l = document.getElementById("noticeList");
    const pageEl = document.getElementById("noticePagination");
    if (!l) return;
    const allNotices = window.allNoticesCache || [];
    if (allNotices.length === 0) {
        l.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>등록된 공지가 없습니다.</td></tr>";
        if (pageEl) pageEl.innerHTML = "";
        return;
    }
    const start = (p - 1) * postsPerPage;
    const end = start + postsPerPage;
    const pageData = allNotices.slice(start, end);
    const rowsHtml = [];
    const nowMs = Date.now();
    pageData.forEach((x, i) => {
        const isPinned = Boolean(x.isPriority);
        let dateStr = "";
        let isRowNew = false;
        if (x.timestamp && x.timestamp.toDate) {
            const dt = x.timestamp.toDate();
            const month = String(dt.getMonth() + 1).padStart(2, '0');
            const day = String(dt.getDate()).padStart(2, '0');
            const hour = String(dt.getHours()).padStart(2, '0');
            const min = String(dt.getMinutes()).padStart(2, '0');
            dateStr = `${month}/${day} ${hour}:${min}`;
            if (nowMs - dt.getTime() < 24 * 60 * 60 * 1000) isRowNew = true;
        }
        const rowNewBadge = isRowNew ? `<span class="badge-new">NEW</span>` : "";
        const safeTitleHtml = escapeShipCommentHtml(x.title || '');
        const linkedContent = autoLink(x.content);
        const safeImgUrl = x.imageUrl ? escapeShipCommentHtml(x.imageUrl) : '';
        const attachIconHtml = safeImgUrl ? `<span title="첨부 이미지 포함" style="margin-left:3px; font-size:0.82rem;">🖼️</span>` : '';
        const imageHtml = safeImgUrl
            ? `<div style="margin-bottom:12px;"><img src="${safeImgUrl}" loading="lazy" alt="공지사항 이미지" style="max-width:100%; border-radius:8px; margin-bottom:6px; border:1px solid var(--border); cursor:pointer; display:block;" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src=this.src;"></div>`
            : '';
        const rowId = `n-${x.id}`;
        const postNum = allNotices.length - ((currentNoticePage - 1) * postsPerPage) - i;
        const noLabel = isPinned ? `<span style="color:var(--primary); font-weight:900;">📌 우선</span>` : postNum;
        const pinnedPrefix = isPinned ? `<span style="display:inline-block; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; padding:1px 6px; font-size:0.72rem; font-weight:900; margin-right:4px; vertical-align:middle;">우선공지</span>` : '';
        const viewCnt = Math.max(0, Number(x.views) || 0);
        const viewBadgeHtml = `<span id="view-badge-n-${x.id}" class="view-count-pill" title="조회수 ${viewCnt.toLocaleString()}회 (중복 조회 포함)">👁️ ${viewCnt.toLocaleString()}</span>`;
        rowsHtml.push(`<tr onclick="toggleBoardRow('${rowId}')" style="cursor:pointer; ${isPinned ? 'background:rgba(59,130,246,0.06);' : ''}"> <td class="board-no" style="white-space:nowrap;">${noLabel}</td> <td class="board-title" style="${isPinned ? 'font-weight:900; color:var(--primary);' : ''}">${pinnedPrefix}${safeTitleHtml}${attachIconHtml}${rowNewBadge}${viewBadgeHtml} <span style="font-size:0.75rem; color:var(--primary); margin-left:4px;">▼</span></td> <td class="board-date">${dateStr}</td> <td class="board-nick">관리자</td> </tr> <tr id="${rowId}" class="board-content-row"> <td colspan="4" class="board-content-box"> <div style="margin-bottom:12px; font-weight:600; background:var(--card-bg); padding:12px; border-radius:8px; border:1px solid var(--border); white-space:pre-wrap;">${linkedContent}</div> ${imageHtml} <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; border-bottom:1px dashed var(--border); padding-bottom:10px; margin-bottom:4px;"> <span id="view-detail-n-${x.id}" style="font-size:0.76rem; color:var(--text-sub); font-weight:800;">👁️ 조회수 ${viewCnt.toLocaleString()}회</span> <div style="display:flex; justify-content:flex-end; gap:5px; flex-wrap:wrap; margin-left:auto;"> <button class="mini-btn" style="background:${isPinned ? '#64748b' : 'var(--primary-light)'} !important; color:white !important;" onclick="toggleNoticePriority('${x.id}', event)">📌 ${isPinned ? '우선고정 해제' : '우선공지 고정'}</button> <button class="mini-btn" style="background:var(--primary-light) !important; color:white !important;" onclick="startEditNotice('${x.id}', '', '', null, event)">✏️ 수정</button> <button class="mini-btn btn-del" onclick="delNotice('${x.id}',event)">🗑️ 삭제</button> </div> </div> </td> </tr>`);
    });
    l.innerHTML = rowsHtml.join("");
    renderNoticePagination(p);
}

async function toggleNoticePriority(id, e) {
    if (e) e.stopPropagation();
    if (!(await verifyAdmin())) return;
    const noticeObj = (window.allNoticesCache || []).find(n => n.id === id);
    if (!noticeObj) return;
    const nextPriority = !Boolean(noticeObj.isPriority);
    db.collection("notices").doc(id).update({ isPriority: nextPriority }).then(() => {
        showToast(nextPriority ? "📌 우선공지로 최상단에 고정되었습니다." : "우선공지 고정이 해제되었습니다.");
    }).catch(err => alert("우선공지 설정 실패: " + err.message));
}

/* ══════════════════════════════════════════════════════════════════════
   🚨 긴급 플로팅 공지 (상단 티커와 완전히 별개)
   - 관리자가 작성 → 모든 접속자 화면 상단에 떠서(floating) 바로 읽힘
   - 게시 ON/OFF + 게시 기간(시작/종료) 지정 가능
   - 작성 권한은 관리자 비밀번호로 잠금 (평문 비밀번호는 코드에 두지 않음:
     서버 환경변수 EMERGENCY_NOTICE_PIN / 빌드 주입 해시로만 검증)
   - 저장 위치: Firestore settings/emergency_notice
   ══════════════════════════════════════════════════════════════════════ */
const EMERGENCY_NOTICE_DOC = "emergency_notice";
const EMERGENCY_UNLOCK_ENDPOINT = "/api/emergency-unlock";
const EMERGENCY_UNLOCK_SESSION_KEY = "emergencyNoticeUnlocked";
const EMERGENCY_DISMISS_KEY = "emergencyNoticeDismissedRev";
const EMERGENCY_TITLE_MAX = 60;
const EMERGENCY_MESSAGE_MAX = 600;
let emergencyNoticeData = null;
let emergencyNoticeTimer = null;
let isEmergencyAuthorUnlocked = readSessionValue(EMERGENCY_UNLOCK_SESSION_KEY) === "1";

/** 저장 데이터와 현재 시각으로 "지금 띄워야 하는 공지인지" 판정 (순수 함수 · 테스트 대상) */
function isEmergencyNoticeActive(data, now = Date.now()) {
    if (!data || data.enabled !== true) return false;
    const message = String(data.message || "").trim();
    if (!message) return false;
    const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
    const startMs = emergencyTimeToMs(data.startAt);
    const endMs = emergencyTimeToMs(data.endAt);
    if (startMs && nowMs < startMs) return false;   // 아직 게시 시작 전
    if (endMs && nowMs > endMs) return false;       // 게시 기간 종료
    return true;
}

/** Firestore Timestamp · ISO 문자열 · 숫자 모두 ms 로 변환 */
function emergencyTimeToMs(value) {
    if (!value) return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
        const t = new Date(value).getTime();
        return Number.isFinite(t) ? t : 0;
    }
    if (typeof value.toMillis === "function") {
        try { return value.toMillis(); } catch (e) { return 0; }
    }
    if (typeof value.toDate === "function") {
        try { return value.toDate().getTime(); } catch (e) { return 0; }
    }
    if (value instanceof Date) return value.getTime();
    return 0;
}

function formatEmergencyDateTimeLabel(value) {
    const ms = emergencyTimeToMs(value);
    if (!ms) return "";
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatEmergencyPeriodLabel(data) {
    const start = formatEmergencyDateTimeLabel(data?.startAt);
    const end = formatEmergencyDateTimeLabel(data?.endAt);
    if (start && end) return `🕒 게시 기간: ${start} ~ ${end}`;
    if (start) return `🕒 게시 시작: ${start} (종료 시각 미지정)`;
    if (end) return `🕒 게시 종료: ${end} 까지`;
    return "🕒 게시 기간: 관리자가 내릴 때까지";
}

/** 로컬 datetime-local 값(예: 2026-10-19T18:30) ↔ ms 변환 */
function emergencyMsToLocalInput(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function emergencyLocalInputToMs(value) {
    const raw = String(value || "").trim();
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : 0;
}

function getEmergencyDismissedRevision() {
    try { return Number(localStorage.getItem(EMERGENCY_DISMISS_KEY) || 0); } catch (e) { return 0; }
}
function setEmergencyDismissedRevision(revision) {
    try { localStorage.setItem(EMERGENCY_DISMISS_KEY, String(revision || 0)); } catch (e) { }
}

/** 접속자 화면에 긴급 공지를 그리거나 숨깁니다. */
function renderEmergencyFloatingNotice() {
    const box = document.getElementById("emergencyFloatingNotice");
    const reopenBtn = document.getElementById("emergencyFloatingReopen");
    if (!box) return;
    const data = emergencyNoticeData;
    const active = isEmergencyNoticeActive(data, Date.now());

    if (!active) {
        box.classList.add("is-hidden");
        if (reopenBtn) reopenBtn.classList.add("is-hidden");
        return;
    }

    const revision = Number(data.revision) || 0;
    const titleEl = document.getElementById("emergencyFloatingTitle");
    const bodyEl = document.getElementById("emergencyFloatingBody");
    const periodEl = document.getElementById("emergencyFloatingPeriod");
    if (titleEl) titleEl.textContent = String(data.title || "").trim() || "긴급 공지";
    if (bodyEl) bodyEl.textContent = String(data.message || "").trim();
    if (periodEl) periodEl.textContent = formatEmergencyPeriodLabel(data);
    box.classList.remove("level-warn", "level-info");
    const level = String(data.level || "danger");
    if (level === "warn" || level === "info") box.classList.add(`level-${level}`);

    // 같은 내용(revision)을 이미 접은 사용자는 작은 🚨 버튼만 보여 줍니다.
    if (getEmergencyDismissedRevision() === revision && revision > 0) {
        box.classList.add("is-hidden");
        if (reopenBtn) reopenBtn.classList.remove("is-hidden");
        return;
    }
    box.classList.remove("is-hidden");
    if (reopenBtn) reopenBtn.classList.add("is-hidden");
}

function dismissEmergencyFloatingNotice() {
    const revision = Number(emergencyNoticeData?.revision) || 0;
    setEmergencyDismissedRevision(revision);
    renderEmergencyFloatingNotice();
    showToast("🚨 긴급 공지를 접었습니다. 오른쪽 아래 🚨 버튼으로 다시 볼 수 있습니다.");
}

function reopenEmergencyFloatingNotice() {
    setEmergencyDismissedRevision(0);
    renderEmergencyFloatingNotice();
}

/** settings/emergency_notice 실시간 구독 + 1분 주기 게시기간 재평가 */
function subscribeEmergencyNotice() {
    try {
        db.collection("settings").doc(EMERGENCY_NOTICE_DOC).onSnapshot(doc => {
            emergencyNoticeData = doc && doc.exists ? (doc.data() || null) : null;
            renderEmergencyFloatingNotice();
            if (document.getElementById("emergencyNoticeModal")?.style.display === "flex") {
                fillEmergencyAdminForm(emergencyNoticeData);
            }
        }, err => { console.warn("긴급 공지 구독 오류:", err); });
    } catch (e) {
        console.warn("긴급 공지 구독 실패:", e);
    }
    if (emergencyNoticeTimer) clearInterval(emergencyNoticeTimer);
    emergencyNoticeTimer = setInterval(renderEmergencyFloatingNotice, 60 * 1000);
}

/* ── 관리자 인증 (비밀번호 평문은 코드에 없음) ── */
async function verifyEmergencyNoticePin(pin) {
    const value = (typeof normalizePinInput === "function" ? normalizePinInput(pin) : String(pin || "").trim());
    if (!value) return { ok: false, reason: "empty" };

    // 1순위 — 서버 검증 (평문은 서버 환경변수 EMERGENCY_NOTICE_PIN 에만 존재)
    let rateLimited = false;
    try {
        const res = await fetch(EMERGENCY_UNLOCK_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: value })
        });
        if (res) {
            if (res.ok) {
                const data = await res.json().catch(() => null);
                if (data && data.ok === true) return { ok: true, token: String(data.token || "server") };
            }
            // 서버가 "이 비밀번호는 틀렸다"고 명확히 판정하면 폴백하지 않습니다(서버가 정답을 아는 쪽).
            if (res.status === 401 || res.status === 400) return { ok: false, reason: "invalid_pin" };
            // 429 는 "비밀번호가 틀렸다"가 아니라 "시도가 너무 잦다"는 뜻입니다.
            // 올바른 비밀번호까지 잠기지 않도록, 아래 해시 폴백으로 한 번 더 확인합니다.
            if (res.status === 429) rateLimited = true;
        }
    } catch (e) {
        // 정적 호스팅·오프라인 → 아래 해시 폴백
    }

    // 2순위 — 빌드 시 주입된 해시 (scripts/build-obfuscate.mjs)
    //   · __EMERGENCY_PIN_SHA256__        : EMERGENCY_NOTICE_PIN(또는 화면 잠금 PIN)
    //   · __SCREEN_LOCK_SHA256__          : 근무일지 잠금 PIN — 같은 비밀번호로도 열 수 있게 함께 인정
    //   · __EMERGENCY_DEFAULT_PIN_SHA256__: EMERGENCY_NOTICE_PIN 미설정 배포의 기본 관리자 PIN
    //   서버(정적 호스팅·2세그먼트 라우팅 404)와 무관하게, 주입된 해시 중 하나와 일치하면 통과합니다.
    const candidates = getEmergencyPinHashCandidates();
    if (candidates.length > 0) {
        try {
            const digest = String(await sha256Hex(value) || "").toLowerCase();
            if (digest && candidates.includes(digest)) return { ok: true, token: "local" };
        } catch (e) { }
        return { ok: false, reason: rateLimited ? "rate_limited" : "invalid_pin" };
    }
    return { ok: false, reason: rateLimited ? "rate_limited" : "no_verifier" };
}

/** 빌드가 주입한 긴급 공지 PIN 해시 후보 목록 (중복·빈 값 제거) */
function getEmergencyPinHashCandidates() {
    if (typeof window === "undefined") return [];
    const raw = [
        window.__EMERGENCY_PIN_SHA256__,
        window.__SCREEN_LOCK_SHA256__,
        window.__EMERGENCY_DEFAULT_PIN_SHA256__
    ];
    const unique = [];
    raw.forEach(value => {
        const hash = String(value || "").trim().toLowerCase();
        if (/^[a-f0-9]{64}$/.test(hash) && !unique.includes(hash)) unique.push(hash);
    });
    return unique;
}

function openEmergencyNoticeManager() {
    if (isEmergencyAuthorUnlocked) {
        openEmergencyNoticeModal();
        return;
    }
    const modal = document.getElementById("emergencyPinModal");
    if (!modal) return;
    modal.style.display = "flex";
    const input = document.getElementById("emergencyPinInput");
    if (input) { input.value = ""; setTimeout(() => input.focus(), 50); }
}

function closeEmergencyPinModal() {
    const modal = document.getElementById("emergencyPinModal");
    if (modal) modal.style.display = "none";
}

async function submitEmergencyPin() {
    const input = document.getElementById("emergencyPinInput");
    const value = String(input?.value || "").trim();
    if (!value) return showToast("⚠️ 관리자 비밀번호를 입력해 주세요.");
    const result = await verifyEmergencyNoticePin(value);
    if (result.ok) {
        isEmergencyAuthorUnlocked = true;
        writeSessionValue(EMERGENCY_UNLOCK_SESSION_KEY, "1");
        closeEmergencyPinModal();
        openEmergencyNoticeModal();
        return;
    }
    if (input) input.value = "";
    if (result.reason === "rate_limited") return showToast("⚠️ 시도 횟수가 많습니다. 잠시 후 다시 시도해 주세요.");
    if (result.reason === "no_verifier") {
        console.error("[보안] 긴급 공지 인증 수단이 없습니다 — 서버(/api/emergency-unlock)와 빌드 해시가 모두 없습니다.");
        return showToast("⚠️ 인증 서버에 연결할 수 없습니다. 관리자에게 문의해 주세요.");
    }
    // 어떤 비밀번호를 넣어야 하는지 현장에서 바로 알 수 있게 안내합니다.
    showToast("❌ 비밀번호가 올바르지 않습니다. 근무일지 잠금 비밀번호 또는 관리자 기본 비밀번호로 시도해 주세요.");
}

function openEmergencyNoticeModal() {
    const modal = document.getElementById("emergencyNoticeModal");
    if (!modal) return;
    modal.style.display = "flex";
    fillEmergencyAdminForm(emergencyNoticeData);
    trackAppEvent("actions", "emergency_open");
}

function closeEmergencyNoticeModal() {
    const modal = document.getElementById("emergencyNoticeModal");
    if (modal) modal.style.display = "none";
}

function fillEmergencyAdminForm(data) {
    const enabledEl = document.getElementById("emergencyNoticeEnabled");
    const titleEl = document.getElementById("emergencyNoticeTitle");
    const msgEl = document.getElementById("emergencyNoticeMessage");
    const levelEl = document.getElementById("emergencyNoticeLevel");
    const startEl = document.getElementById("emergencyNoticeStart");
    const endEl = document.getElementById("emergencyNoticeEnd");
    const stateEl = document.getElementById("emergencyNoticeState");
    if (enabledEl) enabledEl.checked = Boolean(data?.enabled);
    if (titleEl) titleEl.value = String(data?.title || "");
    if (msgEl) msgEl.value = String(data?.message || "");
    if (levelEl) levelEl.value = ["danger", "warn", "info"].includes(String(data?.level)) ? String(data.level) : "danger";
    if (startEl) startEl.value = emergencyMsToLocalInput(emergencyTimeToMs(data?.startAt));
    if (endEl) endEl.value = emergencyMsToLocalInput(emergencyTimeToMs(data?.endAt));
    if (stateEl) {
        if (!data || !String(data.message || "").trim()) {
            stateEl.textContent = "현재 등록된 긴급 공지가 없습니다.";
        } else if (isEmergencyNoticeActive(data, Date.now())) {
            stateEl.textContent = `🟢 게시 중 · ${formatEmergencyPeriodLabel(data)}`;
        } else if (data.enabled) {
            stateEl.textContent = `🟡 게시 대기/종료 상태 · ${formatEmergencyPeriodLabel(data)}`;
        } else {
            stateEl.textContent = "⚪ 게시 OFF 상태로 저장되어 있습니다.";
        }
    }
    updateEmergencyAdminPreview();
}

function updateEmergencyAdminPreview() {
    const preview = document.getElementById("emergencyNoticePreview");
    if (!preview) return;
    const title = String(document.getElementById("emergencyNoticeTitle")?.value || "").trim();
    const message = String(document.getElementById("emergencyNoticeMessage")?.value || "").trim();
    const enabled = Boolean(document.getElementById("emergencyNoticeEnabled")?.checked);
    const level = String(document.getElementById("emergencyNoticeLevel")?.value || "danger");
    const startMs = emergencyLocalInputToMs(document.getElementById("emergencyNoticeStart")?.value);
    const endMs = emergencyLocalInputToMs(document.getElementById("emergencyNoticeEnd")?.value);
    if (!message) {
        preview.textContent = "미리보기: 내용을 입력해 주세요.";
        return;
    }
    const levelLabel = level === "warn" ? "🟠 주의" : (level === "info" ? "🔵 안내" : "🔴 긴급");
    const periodLabel = formatEmergencyPeriodLabel({ startAt: startMs, endAt: endMs });
    const willShow = isEmergencyNoticeActive({ enabled, message, startAt: startMs, endAt: endMs }, Date.now());
    preview.textContent =
        `${levelLabel} ${title || "긴급 공지"}\n${message}\n${periodLabel}\n` +
        (enabled
            ? (willShow ? "▶ 저장하면 지금 바로 모든 접속자 화면에 표시됩니다." : "▶ 저장되지만 지정한 게시 시작 시각부터 표시됩니다.")
            : "▶ 게시 OFF 상태 — 저장만 되고 화면에는 표시되지 않습니다.");
}

/** 게시 기간 빠른 설정: 1=1시간, 3=3시간, 72=3일, 'today'=오늘 자정, 'clear'=제한 없음 */
function applyEmergencyNoticePeriodPreset(preset) {
    const startEl = document.getElementById("emergencyNoticeStart");
    const endEl = document.getElementById("emergencyNoticeEnd");
    if (!startEl || !endEl) return;
    if (preset === "clear") {
        startEl.value = "";
        endEl.value = "";
        updateEmergencyAdminPreview();
        return;
    }
    const now = Date.now();
    startEl.value = emergencyMsToLocalInput(now);
    if (preset === "today") {
        const end = new Date();
        end.setHours(23, 59, 0, 0);
        endEl.value = emergencyMsToLocalInput(end.getTime());
    } else {
        const hours = Number(preset) || 1;
        endEl.value = emergencyMsToLocalInput(now + hours * 60 * 60 * 1000);
    }
    updateEmergencyAdminPreview();
}

async function saveEmergencyNotice() {
    if (!isEmergencyAuthorUnlocked) return showToast("⚠️ 관리자 인증이 필요합니다.");
    const title = String(document.getElementById("emergencyNoticeTitle")?.value || "").trim().slice(0, EMERGENCY_TITLE_MAX);
    const message = String(document.getElementById("emergencyNoticeMessage")?.value || "").trim().slice(0, EMERGENCY_MESSAGE_MAX);
    const enabled = Boolean(document.getElementById("emergencyNoticeEnabled")?.checked);
    const levelRaw = String(document.getElementById("emergencyNoticeLevel")?.value || "danger");
    const level = ["danger", "warn", "info"].includes(levelRaw) ? levelRaw : "danger";
    const startAt = emergencyLocalInputToMs(document.getElementById("emergencyNoticeStart")?.value);
    const endAt = emergencyLocalInputToMs(document.getElementById("emergencyNoticeEnd")?.value);

    if (!message) return showToast("⚠️ 긴급 공지 내용을 입력해 주세요.");
    if (startAt && endAt && endAt <= startAt) return showToast("⚠️ 게시 종료 시각이 시작 시각보다 빨라요.");

    const payload = {
        enabled,
        title,
        message,
        level,
        startAt,
        endAt,
        revision: Date.now(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
        await db.collection("settings").doc(EMERGENCY_NOTICE_DOC).set(payload, { merge: true });
        setEmergencyDismissedRevision(0); // 새 내용은 모두에게 다시 펼쳐 보여 줍니다.
        trackAppEvent("actions", "emergency_save");
        showToast(enabled ? "🚨 긴급 공지를 게시했습니다." : "💾 긴급 공지를 저장했습니다. (게시 OFF)");
        closeEmergencyNoticeModal();
    } catch (err) {
        console.error("긴급 공지 저장 실패:", err);
        alert("긴급 공지 저장 실패: " + (err?.message || err));
    }
}

async function stopEmergencyNotice() {
    if (!isEmergencyAuthorUnlocked) return showToast("⚠️ 관리자 인증이 필요합니다.");
    if (!confirm("긴급 공지를 지금 화면에서 내릴까요?\n\n※ 내용은 그대로 남고 게시만 중단됩니다.")) return;
    try {
        await db.collection("settings").doc(EMERGENCY_NOTICE_DOC).set({
            enabled: false,
            revision: Date.now(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        const enabledEl = document.getElementById("emergencyNoticeEnabled");
        if (enabledEl) enabledEl.checked = false;
        updateEmergencyAdminPreview();
        showToast("🚨 긴급 공지를 내렸습니다.");
    } catch (err) {
        console.error("긴급 공지 내리기 실패:", err);
        alert("긴급 공지 내리기 실패: " + (err?.message || err));
    }
}

window.onload = async () => { 
    applyOfficialTerminalNames();
    appendTerminalMealBlocks();
    renderTerminalScheduleTabBar();
    await ensureAnonymousAuth();
    initAppHistoryNavigation();
    ["t1", "t2", "t3"].forEach(loadSectionTicker);
    trackVisitorSession();
    initTodayVisitorBadge();
    ensureTodayUpdateNotice();
    subscribeEmergencyNotice();
    try { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); const todayStr = now.toISOString().split('T')[0]; const sDate = document.getElementById('wageStartDate'); const eDate = document.getElementById('wageEndDate'); if(sDate) sDate.value = todayStr; if(eDate) eDate.value = todayStr; if (typeof syncWageHourlyYearLabel === 'function') syncWageHourlyYearLabel(todayStr); const initMonth = parseInt(todayStr.split('-')[1], 10) || (now.getMonth() + 1); highlightSeasonRow(initMonth); applySeasonDefaultHours(initMonth, true); if (typeof syncWageHoursBlockSize === 'function') syncWageHoursBlockSize(); if (typeof loadWageScheduledShipsForDate === 'function') loadWageScheduledShipsForDate(todayStr, false); } catch(e) { console.error("날짜 초기화 오류", e); } 
    loadBanner(); 
    try { 
        db.collection("notices").orderBy("timestamp","desc").onSnapshot(s => { const openIds = Array.from(document.querySelectorAll("#noticeList .board-content-row.show")).map(el => el.id); window.allNoticesCache = []; const badge = document.getElementById("noticeBadge"); const subMeta = document.getElementById("noticeCardSubMeta"); if (subMeta) subMeta.innerText = s.empty ? "운영 안내 및 주요 소식" : `등록된 공지 ${s.size}건`; if (s.empty) { renderNoticePage(1); if(badge) badge.classList.add("hidden"); return; } let isNew = false; const now = new Date(); const sortedNotices = []; s.forEach(d => { const item = { ...(d.data() || {}), id: d.id }; if (item.timestamp && item.timestamp.toDate) { if (now.getTime() - item.timestamp.toDate().getTime() < 24 * 60 * 60 * 1000) isNew = true; } sortedNotices.push(item); }); sortedNotices.sort((a, b) => { const pA = a.isPriority ? 1 : 0; const pB = b.isPriority ? 1 : 0; if (pA !== pB) return pB - pA; const tA = a.timestamp && a.timestamp.toMillis ? a.timestamp.toMillis() : 0; const tB = b.timestamp && b.timestamp.toMillis ? b.timestamp.toMillis() : 0; return tB - tA; }); window.allNoticesCache = sortedNotices; const maxPage = Math.max(1, Math.ceil(sortedNotices.length / postsPerPage)); renderNoticePage(Math.min(currentNoticePage || 1, maxPage)); openIds.forEach(rid => document.getElementById(rid)?.classList.add("show")); if(badge) { if(isNew) badge.classList.remove("hidden"); else badge.classList.add("hidden"); } }, err => { console.warn("공지사항 구독 오류:", err); }); 
        db.collection("posts").orderBy("timestamp","desc").onSnapshot(s => { const openIds = Array.from(document.querySelectorAll("#boardList .board-content-row.show")).map(el => el.id); allPostsData = []; s.forEach(d => { const postData = d.data() || {}; if (isDeletedRecord(postData)) return; allPostsData.push({...postData, id:d.id}) }); const subMeta = document.getElementById("boardCardSubMeta"); if (subMeta) subMeta.innerText = allPostsData.length > 0 ? `자유 게시글 ${allPostsData.length}건` : "현장 동료 자유 소통방"; const badge = document.getElementById("boardBadge"); if (badge) { const nowMs = Date.now(); const hasNewPost = allPostsData.some(p => p.timestamp && (nowMs - p.timestamp.toDate().getTime() < 24 * 60 * 60 * 1000)); if (hasNewPost) badge.classList.remove("hidden"); else badge.classList.add("hidden"); } const maxPage = Math.max(1, Math.ceil(allPostsData.length / postsPerPage)); renderBoardPage(Math.min(currentBoardPage || 1, maxPage)); openIds.forEach(rid => document.getElementById(rid)?.classList.add("show")); }, err => { console.warn("자유게시판 구독 오류:", err); }); 
        db.collection("ships").orderBy("timestamp","desc").onSnapshot(s => { applyShipDirectorySnapshot(s); }, err => { console.warn("선박도감 구독 오류:", err); });
        db.collection("archives").orderBy("timestamp","desc").onSnapshot(s=>{window.allArchivesCount = s.size; window.allArchivesCache = []; const l=document.getElementById("fileList"); const archiveBadge = document.getElementById("archiveBadge"); let isArchiveNew = false; const nowMs = Date.now(); const rowsHtml=[]; s.forEach(d=>{const x=d.data()||{}; window.allArchivesCache.push({...x, id:d.id}); let isRowNew = false; if (x.timestamp) { const dt = x.timestamp.toDate(); if (nowMs - dt.getTime() < 24 * 60 * 60 * 1000) { isRowNew = true; isArchiveNew = true; } } const rowNewBadge = isRowNew ? `<span class="badge-new">NEW</span>` : ""; const safeUrl = escapeShipCommentHtml(x.url || "#"); const safeTitle = escapeShipCommentHtml(x.title || "파일"); rowsHtml.push(`<tr><td class="board-title" style="width: 68%; padding-left: 10px;"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:none; color:var(--primary); font-weight:800;">💾 ${safeTitle}</a>${rowNewBadge}</td><td style="width: 32%; text-align:center;"><div style="display:inline-flex; gap:4px; justify-content:center;"><button class="mini-btn" style="background:var(--primary-light) !important; color:white !important;" onclick="startEditArchive('${d.id}',event)">수정</button><button class="mini-btn btn-del" onclick="delArchive('${d.id}',event)">삭제</button></div></td></tr>`);}); l.innerHTML=rowsHtml.join(""); if (archiveBadge) { if (isArchiveNew) archiveBadge.classList.remove("hidden"); else archiveBadge.classList.add("hidden"); }}, err => { console.warn("자료실 구독 오류:", err); }); 
    } catch(err) { console.warn("실시간 연결 오류:", err); } 
    if(localStorage.getItem('myWorkerId')) { currentWorkerId = localStorage.getItem('myWorkerId'); updateUserBar(); if(typeof initNotifications === 'function') initNotifications(currentWorkerId); } 
};

let leaderCurrentDate = new Date(); let leaderOverrides = []; const baseCycle = ["재경", "성철", "개굴"]; const baseAnchor = "2026-02-01"; function openLeaderSchedule() { trackAppEvent('actions', 'leader_cal'); document.getElementById('leaderCalendarModal').style.display = 'flex'; leaderCurrentDate = new Date(); renderLeaderCalendar(leaderCurrentDate.getFullYear(), leaderCurrentDate.getMonth()); } function closeLeaderCalendar() { document.getElementById('leaderCalendarModal').style.display = 'none'; } function changeLeaderMonth(s) { leaderCurrentDate.setMonth(leaderCurrentDate.getMonth() + s); renderLeaderCalendar(leaderCurrentDate.getFullYear(), leaderCurrentDate.getMonth()); } function getSlotIndex(dStr) { const target = new Date(dStr); const anchor = new Date(baseAnchor); const diffDays = Math.floor((target.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24)); return ((diffDays % 3) + 3) % 3; } function getCalculatedLeader(targetDateStr) { const targetSlot = getSlotIndex(targetDateStr); for (let i = leaderOverrides.length - 1; i >= 0; i--) { const ov = leaderOverrides[i]; if (ov.date <= targetDateStr) { if (getSlotIndex(ov.date) === targetSlot) return ov.leader; } } return baseCycle[targetSlot]; } function renderLeaderCalendar(y, m) { document.getElementById('leaderCalMonthYear').innerText = `${y}년 ${m+1}월`; const lD = new Date(y, m+1, 0).getDate(); db.collection('leader_overrides').get().then(s => { leaderOverrides = []; s.forEach(doc => { leaderOverrides.push(doc.data()); }); leaderOverrides.sort((a, b) => a.date.localeCompare(b.date)); drawLeaderGrid(y, m, lD); }).catch(err => { drawLeaderGrid(y, m, lD); }); } function drawLeaderGrid(y, m, lD) { const g = document.getElementById('leaderCalendarGrid'); const cells = []; const fD = new Date(y, m, 1).getDay(); for(let i=0; i<fD; i++) { cells.push(`<div style="background:transparent; border:none;"></div>`); } for(let d=1; d<=lD; d++) { const dStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; const isAnchor = leaderOverrides.some(ov => ov.date === dStr); const leaderName = String(getCalculatedLeader(dStr) || ""); const safeLeaderHtml = escapeShipCommentHtml(leaderName); const safeLeaderJs = leaderName.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;"); let badgeClass = "leader-badge "; if (leaderName.includes("재경")) badgeClass += "leader-jaekyung"; else if (leaderName.includes("성철")) badgeClass += "leader-sungchul"; else if (leaderName.includes("개굴")) badgeClass += "leader-gaegool"; else badgeClass += "leader-jaekyung"; let customStyle = isAnchor ? "border: 2px solid #ef4444;" : ""; if (!baseCycle.includes(leaderName)) customStyle += "background-color: #8b5cf6; color: white;"; let dayColor = "var(--text-main)"; let currentDayObj = new Date(y, m, d).getDay(); if (currentDayObj === 0) dayColor = "#ef4444"; if (currentDayObj === 6) dayColor = "#3b82f6"; cells.push(`<div class="cal-day tap-effect" onclick="overrideLeader('${dStr}', '${safeLeaderJs}')" style="min-height: 65px; justify-content: flex-start; padding-top: 5px; background: white;"><span style="color: ${dayColor}; font-weight: 900; font-size: 0.95rem;">${d}</span><div class="${badgeClass}" style="${customStyle}">${safeLeaderHtml}</div></div>`); } g.innerHTML = cells.join(""); } async function overrideLeader(dStr, currentLeader) { if (!(await verifyAdmin())) return; const newLeader = prompt(`[${dStr}] 조장을 변경합니다.\n\n👉 이곳에 새 이름(예: 용병)을 넣으면 이후 3일마다 돌아오는 이 근무조의 스케줄이 모두 교체됩니다.\n\n※ 취소하려면 '초기화'를 입력하세요.`, currentLeader); if (newLeader === null) return; if (newLeader.trim() === "" || newLeader === "초기화") { db.collection('leader_overrides').doc(dStr).delete().then(() => { showToast("기존 패턴이 복구되었습니다."); renderLeaderCalendar(leaderCurrentDate.getFullYear(), leaderCurrentDate.getMonth()); }); } else { db.collection('leader_overrides').doc(dStr).set({ date: dStr, leader: newLeader.trim() }).then(() => { showToast("새 근무조가 적용되었습니다."); renderLeaderCalendar(leaderCurrentDate.getFullYear(), leaderCurrentDate.getMonth()); }); } }
