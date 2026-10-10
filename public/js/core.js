const firebaseConfig = { apiKey: "AIzaSyBWFZr9TE9yybZJCJjEXSsv1YCpGkVb0kA", authDomain: "busan-hak-port.firebaseapp.com", projectId: "busan-hak-port", storageBucket: "busan-hak-port.firebasestorage.app", messagingSenderId: "616469111502", appId: "1:616469111502:web:6f3c94b15e444e04c7669f", measurementId: "G-QQ728TDFJ2" };
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const db = firebase.firestore(); const storage = firebase.storage();
const auth = typeof firebase.auth === "function" ? firebase.auth() : null;
db.enablePersistence({ synchronizeTabs: true }).catch(err => { console.warn("Persistence Error:", err.code); });

// 🔐 익명 인증 자동 연결 (미인증 접근 차단 대비 및 UID 확보)
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
let isAdminSessionVerified = sessionStorage.getItem("busanPortAdminVerified") === "1";

async function ensureAnonymousAuth() {
    if (!auth) return null;
    if (auth.currentUser) {
        currentAuthUser = auth.currentUser;
        return currentAuthUser;
    }
    try {
        const cred = await auth.signInAnonymously();
        currentAuthUser = cred.user;
        return currentAuthUser;
    } catch (e) {
        // 콘솔에서 익명 인증 비활성화 상태여도 앱 기능은 정상 동작하도록 폴백
        return null;
    }
}
if (auth) {
    auth.onAuthStateChanged(user => {
        currentAuthUser = user || null;
        if (!user) {
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
let commentUnsubscribes = {}; let shipCommentUnsubscribes = {}; let shipCommentsById = {}; let editingShipComment = null; let visitorCountPromise = null; const postsPerPage = 5; let globalTickerData = { adminMessage: "", userMessages: [] };
let currentEditPostId = null;

async function safeGet(ref) { if (!ref) return null; try { return await ref.get(); } catch (e) { return null; } }
async function verifyAdmin(forcePrompt = false) {
    await ensureAnonymousAuth();
    if (!forcePrompt && isAdminSessionVerified) return true;

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

    // 2) SHA-256 해시 검증 (settings/admin 차단 시에도 동작하며 평문 노출 원천 차단)
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
        if (auth && auth.currentUser) {
            db.collection("admins").doc(auth.currentUser.uid).set({
                uid: auth.currentUser.uid,
                verifiedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true }).catch(() => {});
        }
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
    { id: "safety-card", label: "⛑️ 실전 통합 안전 지침", color: "#10b981" },
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

    visitorCountPromise = db.runTransaction(async transaction => {
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
    }).then(() => {
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
   📊 오늘 방문자 실시간 배지 (화면 좌측 상단)
   - visitor_stats/daily-{dateKey} 단건 리스너로 실시간(증가 즉시) 갱신
   - 자정 경계(dateKey) 변경 시 자동 재구독 → 항상 "오늘" 숫자만 표시
   - 탭 복귀·절전 해제 시 날짜/리스너 상태 자동 점검
   ================================================================== */
let todayVisitorBadgeUnsub = null;
let todayVisitorBadgeDateKey = "";
let todayVisitorBadgeRetry = 0;
let todayVisitorBadgeInitialized = false;

function getTodayVisitorBadgeEls() {
    const badge = document.getElementById("todayVisitorBadge");
    if (!badge) return null;
    return { badge, count: document.getElementById("todayVisitorBadgeCount") };
}

function setTodayVisitorBadgeState(state) {
    const els = getTodayVisitorBadgeEls();
    if (!els) return;
    if (state === "error") {
        els.badge.classList.remove("is-loading");
        els.badge.classList.add("is-error");
        if (els.count) els.count.innerText = "-";
        els.badge.title = "오늘 방문자 집계를 불러오지 못했습니다. (네트워크·인증 상태 확인 후 자동 재시도)";
        return;
    }
    if (state === "loading") {
        els.badge.classList.remove("is-error");
        els.badge.classList.add("is-loading");
    }
}

function renderTodayVisitorBadgeValue(count, updatedAt) {
    const els = getTodayVisitorBadgeEls();
    if (!els) return;
    const safeCount = Math.max(0, Number(count) || 0);
    if (els.count) els.count.innerText = safeCount.toLocaleString();
    els.badge.classList.remove("is-loading", "is-error");
    let timeLabel = "";
    try {
        const updated = updatedAt && typeof updatedAt.toDate === "function" ? updatedAt.toDate() : null;
        if (updated) {
            timeLabel = ` · ${String(updated.getHours()).padStart(2, "0")}:${String(updated.getMinutes()).padStart(2, "0")} 기준`;
        }
    } catch (e) {}
    els.badge.title = `👥 오늘 방문자 ${safeCount.toLocaleString()}명 (세션 기준)${timeLabel} · 클릭 시 상세 통계`;
    els.badge.setAttribute("aria-label", `오늘 방문자 ${safeCount.toLocaleString()}명`);
}

function startTodayVisitorBadgeListener() {
    const els = getTodayVisitorBadgeEls();
    if (!els) return;
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
        }, error => {
            console.warn("오늘 방문자 배지 갱신 실패:", error && error.message);
            todayVisitorBadgeUnsub = null;
            setTodayVisitorBadgeState("error");
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
    }
}

function initTodayVisitorBadge() {
    if (!document.getElementById("todayVisitorBadge")) return;
    startTodayVisitorBadgeListener();
    if (todayVisitorBadgeInitialized) return;
    todayVisitorBadgeInitialized = true;

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
    // 관리자 세션이면 바로 상세 통계, 일반 방문자는 현재 집계 수치 안내
    if (isAdminSessionVerified) { openVisitorStats(); return; }
    const countEl = document.getElementById("todayVisitorBadgeCount");
    const countText = countEl ? countEl.innerText : "-";
    showToast(`👥 오늘 방문자 ${countText}명 · 실시간 집계 중`);
}

let isWorkLogUnlocked = sessionStorage.getItem("workLogPinUnlocked") === "1";
let pendingWorkLogAction = null;
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
function submitWorkLogPin() {
    const input = document.getElementById("workLogPinInput");
    const val = (input ? input.value : "").trim();
    if (val === "9445") {
        isWorkLogUnlocked = true;
        try { sessionStorage.setItem("workLogPinUnlocked", "1"); } catch (e) {}
        syncWorkLogExtraUnlockUI();
        const callback = pendingWorkLogAction;
        closeWorkLogPinModal();
        showToast("🔓 추가 기능(검색·상세 통계) 잠금이 해제되었습니다.");
        if (typeof callback === "function") callback();
    } else {
        showToast("⚠️ 비밀번호가 일치하지 않습니다.");
        if (input) {
            input.value = "";
            input.focus();
        }
    }
}
function syncBottomNavActive(activeCardId) {
    const map = {
        'board-card': 'nav-board',
        'ship-card': 'nav-ship',
        'archive-card': 'nav-archive'
    };
    const targetNavId = map[activeCardId] || 'nav-home';
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
        document.getElementById('wageEndDate')?.value ||
        ''
    ).trim();
    const parsedYear = parseInt(raw.split('-')[0], 10);
    const validYear = (parsedYear >= 2000 && parsedYear <= 2100) ? parsedYear : 2026;

    const labelEl = document.getElementById('wageHourlyLabel');
    if (labelEl) {
        labelEl.textContent = `${validYear}년 시급`;
    }

    const hourlyEl = document.getElementById('wageHourly');
    if (hourlyEl && !hourlyEl.dataset.userModified) {
        const targetWage = WAGE_HOURLY_BY_YEAR[validYear] || 10320;
        if (String(hourlyEl.value) !== String(targetWage)) {
            hourlyEl.value = String(targetWage);
        }
    }
    return validYear;
}

function onWageDateChange(which) {
    const sdEl = document.getElementById('wageStartDate');
    const edEl = document.getElementById('wageEndDate');
    if (!sdEl || !edEl) return;
    const activeDateStr = (which === 'end' && edEl.value) ? edEl.value : (sdEl.value || edEl.value);
    if (activeDateStr) {
        syncWageHourlyYearLabel(activeDateStr);
    }
    if (sdEl.value) {
        const m = parseInt(sdEl.value.split('-')[1], 10);
        if (m >= 1 && m <= 12) {
            highlightSeasonRow(m);
            if (which === 'start' && typeof applySeasonDefaultHours === 'function') {
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
        if (typeof autoFillWeekendHoliday === 'function') autoFillWeekendHoliday();
        if (typeof refreshWageWorkHours === 'function') refreshWageWorkHours();
        if (typeof invalidateCalculatedWage === 'function') invalidateCalculatedWage();
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

/* ==================================================================
   ⚡ Phase 2 & Phase 3: 해시 라우팅(/#/...) + 동적 임포트(import()) 래퍼
   ================================================================== */
let _lazyD3ModPromise = null;
let _lazyShipsModPromise = null;
let _lazyAdminModPromise = null;
let _lazyGuidesModPromise = null;

function getLazyD3Module() {
    if (!_lazyD3ModPromise) _lazyD3ModPromise = import("./lazy-d3.js?v=2027.1");
    return _lazyD3ModPromise;
}
function getLazyShipsModule() {
    if (!_lazyShipsModPromise) _lazyShipsModPromise = import("./lazy-ships.js?v=2027.1");
    return _lazyShipsModPromise;
}
function getLazyAdminModule() {
    if (!_lazyAdminModPromise) _lazyAdminModPromise = import("./lazy-admin.js?v=2027.1");
    return _lazyAdminModPromise;
}
function getLazyGuidesModule() {
    if (!_lazyGuidesModPromise) _lazyGuidesModPromise = import("./lazy-guides.js?v=2027.1");
    return _lazyGuidesModPromise;
}

// 1) D3 연간 차트 & 보고서 동적 로드 래퍼
async function loadAndRenderYearlyD3Chart(year) {
    const mod = await getLazyD3Module();
    return mod.loadAndRenderYearlyD3Chart(year);
}
async function copyYearlySummaryReport() {
    const mod = await getLazyD3Module();
    return mod.copyYearlySummaryReport();
}

// 2) 전체 선박 도감 & 상세 모달 동적 로드 래퍼
async function loadAndSearchAllShips(searchKeyword = "") {
    if (!isWorkLogUnlocked) return;
    const mod = await getLazyShipsModule();
    return mod.loadAndSearchAllShips(searchKeyword);
}
async function openShipDetailView(docId) {
    const mod = await getLazyShipsModule();
    return mod.openShipDetailView(docId);
}

// 3) 관리자 통계 & 누적 일지 상세 동적 로드 래퍼
async function openVisitorStats() {
    const mod = await getLazyAdminModule();
    return mod.openVisitorStats();
}
async function refreshVisitorStatsModal() {
    const mod = await getLazyAdminModule();
    return mod.refreshVisitorStatsModal();
}
async function switchBlockRankMode(mode) {
    const mod = await getLazyAdminModule();
    return mod.switchBlockRankMode(mode);
}
async function copyVisitorStatsReport() {
    const mod = await getLazyAdminModule();
    return mod.copyVisitorStatsReport();
}
async function toggleStatsWorkerAccountList(forceOpen) {
    const mod = await getLazyAdminModule();
    return mod.toggleStatsWorkerAccountList(forceOpen);
}
async function renderStatsWorkerAccountList() {
    const mod = await getLazyAdminModule();
    return mod.renderStatsWorkerAccountList();
}
function closeVisitorStats() {
    const modal = document.getElementById("visitorStatsModal");
    if (modal) modal.style.display = "none";
}
async function openAdminWorkLogDetail(initialWorker = "") {
    const mod = await getLazyAdminModule();
    return mod.openAdminWorkLogDetail(initialWorker);
}
async function openAdminWorkLogDetailFromStats(initialWorker = "") {
    const mod = await getLazyAdminModule();
    return mod.openAdminWorkLogDetailFromStats(initialWorker);
}
function closeAdminWorkLogDetail() {
    const modal = document.getElementById("adminWorkLogModal");
    if (modal) modal.style.display = "none";
}
async function loadAdminWorkLogDetail(forceRefresh = false, initialWorker = "") {
    const mod = await getLazyAdminModule();
    return mod.loadAdminWorkLogDetail(forceRefresh, initialWorker);
}
async function downloadAdminWorkLogCsv() {
    const mod = await getLazyAdminModule();
    return mod.downloadAdminWorkLogCsv();
}
async function copyAdminWorkLogReport() {
    const mod = await getLazyAdminModule();
    return mod.copyAdminWorkLogReport();
}
async function resetAdminWorkLogFilters() {
    const mod = await getLazyAdminModule();
    return mod.resetAdminWorkLogFilters();
}
async function renderAdminWorkLogDetail() {
    const mod = await getLazyAdminModule();
    return mod.renderAdminWorkLogDetail();
}
async function filterAdminWorkLogByWorker(workerId) {
    const mod = await getLazyAdminModule();
    return mod.filterAdminWorkLogByWorker(workerId);
}
async function filterAdminWorkLogByKeyword(keyword) {
    const mod = await getLazyAdminModule();
    return mod.filterAdminWorkLogByKeyword(keyword);
}

// 4) 안전 지침 · 용어 가이드 · 개인정보센터 · 사용설명서 동적 로드 래퍼
const LAZY_STATIC_CARDS = new Set(["safety-card", "guide-card", "privacy-center-card", "main-manual-card"]);
async function ensureLazyCardContent(cardId) {
    if (!LAZY_STATIC_CARDS.has(cardId)) return;
    const card = document.getElementById(cardId);
    const content = card ? card.querySelector(".dash-content") : null;
    if (content && !content.getAttribute("data-lazy-mounted")) {
        const mod = await getLazyGuidesModule();
        mod.ensureStaticCardMounted(cardId);
    }
}
async function filterGuide() {
    const mod = await getLazyGuidesModule();
    return mod.filterGuide();
}
async function filterGuideByCategory(cat) {
    const mod = await getLazyGuidesModule();
    return mod.filterGuideByCategory(cat);
}

// 5) Phase 2: 해시 라우팅 (/#/wage, /#/ship, /#/board, /#/archive 등)
const HASH_TO_CARD_MAP = {
    "wage": "wage-card",
    "log": "log-card",
    "ship": "ship-card",
    "notice": "notice-card",
    "english": "daily-field-english-card",
    "board": "board-card",
    "archive": "archive-card",
    "weather": "weather-card",
    "safety": "safety-card",
    "guide": "guide-card",
    "privacy": "privacy-center-card",
    "manual": "main-manual-card",
    "t3": "t3-content",
    "t2": "t2-content",
    "t1": "t1-content"
};
const CARD_TO_HASH_MAP = Object.fromEntries(
    Object.entries(HASH_TO_CARD_MAP).map(([slug, id]) => [id, `#/${slug}`])
);
let _isHandlingHashRoute = false;

function syncRouteHashForTarget(targetId, isExpanded) {
    if (_isHandlingHashRoute) return;
    const nextHash = isExpanded ? (CARD_TO_HASH_MAP[targetId] || "") : "";
    const curHash = window.location.hash || "";
    if (nextHash) {
        if (curHash !== nextHash) {
            try { history.pushState({ targetId }, "", nextHash); } catch (e) { window.location.hash = nextHash; }
        }
    } else if (curHash && curHash !== "#" && curHash !== "#/") {
        try { history.pushState({ targetId: null }, "", window.location.pathname + window.location.search); } catch (e) {}
    }
}

async function toggleDashItem(id, options = {}) {
    const card = document.getElementById(id);
    if (!card) return;

    const isExpanded = card.classList.contains("expanded");
    const forceExpand = typeof options.forceExpand === "boolean" ? options.forceExpand : !isExpanded;

    if (forceExpand && LAZY_STATIC_CARDS.has(id)) {
        await ensureLazyCardContent(id);
    }

    document.querySelectorAll(".dash-card").forEach(item => {
        if (
            item.id === "daily-field-english-card" &&
            item.classList.contains("expanded") &&
            typeof pauseDailyFieldEnglish === "function"
        ) {
            pauseDailyFieldEnglish();
        }
        item.classList.remove("expanded");
        const content = item.querySelector(".dash-content");
        if (content) content.style.display = "none";
    });

    if (forceExpand) {
        card.classList.add("expanded");
        const content = card.querySelector(".dash-content");
        if (content) content.style.display = "block";

        if (!options.skipTrack) trackAppEvent("blocks", id);
        syncBottomNavActive(id);
        if (!options.fromRouter) syncRouteHashForTarget(id, true);

        if (id === "daily-field-english-card" && typeof initializeDailyFieldEnglish === "function") {
            initializeDailyFieldEnglish();
        } else if (id === "log-card") {
            syncWorkLogExtraUnlockUI();
            if (typeof renderCalendar === "function") renderCalendar(currentDate.getFullYear(), currentDate.getMonth());
            const formEl = document.getElementById("dailyLogForm");
            if (formEl && !formEl.getAttribute("data-date") && typeof clickDate === "function") {
                const nowObj = new Date();
                const todayStr = `${nowObj.getFullYear()}-${String(nowObj.getMonth() + 1).padStart(2, "0")}-${String(nowObj.getDate()).padStart(2, "0")}`;
                clickDate(todayStr);
            }
        } else if (id === "ship-card" || id === "wage-card") {
            syncWorkLogExtraUnlockUI();
            if (id === "wage-card" && typeof renderTerminalScheduleTabBar === "function") {
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
        } else if (id === "weather-card" && typeof fetchBusanPortLiveWeather === "function") {
            fetchBusanPortLiveWeather(false);
        }

        if (["board-card", "ship-card", "archive-card"].includes(id) || options.fromRouter) {
            setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        }
    } else {
        syncBottomNavActive("nav-home");
        if (!options.fromRouter) syncRouteHashForTarget(id, false);
    }
}

function toggleSection(id, triggerEl, options = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    const currentlyCollapsed = el.classList.contains("collapsed");
    const willExpand = typeof options.forceExpand === "boolean" ? options.forceExpand : currentlyCollapsed;
    el.classList.toggle("collapsed", !willExpand);
    el.style.border = willExpand ? "2px solid var(--primary)" : "1px solid var(--border)";
    const parentCard = el.closest(".card");
    if (parentCard) parentCard.classList.toggle("active-work-section", willExpand);
    if (willExpand) {
        if (!options.skipTrack) trackAppEvent("blocks", id);
        if (!options.fromRouter) syncRouteHashForTarget(id, true);
        if (options.fromRouter) {
            setTimeout(() => (el.parentElement || el).scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        }
    } else if (!options.fromRouter) {
        syncRouteHashForTarget(id, false);
    }
}

async function applyHashRoute() {
    const rawHash = (window.location.hash || "").trim();
    const cleaned = rawHash.replace(/^#\/?/, "").split("?")[0].trim().toLowerCase();
    _isHandlingHashRoute = true;
    try {
        if (!cleaned || cleaned === "home") {
            document.querySelectorAll(".dash-card.expanded").forEach(item => {
                if (item.id === "daily-field-english-card" && typeof pauseDailyFieldEnglish === "function") {
                    pauseDailyFieldEnglish();
                }
                item.classList.remove("expanded");
                const content = item.querySelector(".dash-content");
                if (content) content.style.display = "none";
            });
            ["t1-content", "t2-content", "t3-content"].forEach(secId => {
                const sec = document.getElementById(secId);
                if (sec && !sec.classList.contains("collapsed")) {
                    sec.classList.add("collapsed");
                    sec.style.border = "1px solid var(--border)";
                    const parentCard = sec.closest(".card");
                    if (parentCard) parentCard.classList.remove("active-work-section");
                }
            });
            syncBottomNavActive("nav-home");
            return;
        }
        const targetId = HASH_TO_CARD_MAP[cleaned] || (document.getElementById(cleaned) ? cleaned : null);
        if (!targetId) return;
        if (["t1-content", "t2-content", "t3-content"].includes(targetId)) {
            toggleSection(targetId, null, { forceExpand: true, fromRouter: true });
        } else {
            await toggleDashItem(targetId, { forceExpand: true, fromRouter: true });
        }
    } finally {
        _isHandlingHashRoute = false;
    }
}

window.addEventListener("hashchange", () => {
    applyHashRoute();
});
window.addEventListener("popstate", () => {
    applyHashRoute();
});

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
}
function toggleHidden(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden');
    if (id === 'shipForm' && !el.classList.contains('hidden')) {
        initShipFormSchedulePicker();
    }
}
function toggleDarkMode(){ document.body.classList.toggle('dark-mode'); }
function scrollToTop(){
    if (window.location.hash && window.location.hash !== "#/") {
        try { history.pushState({ targetId: null }, "", window.location.pathname + window.location.search); } catch (e) {}
        applyHashRoute();
    }
    syncBottomNavActive(nav-home);
    window.scrollTo({top:0, behavior:smooth});
}
function showToast(m){const t=document.getElementById("toast"); t.innerText=m; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),3000);}

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
function loadBanner(){ db.collection('settings').doc('banner').onSnapshot((doc) => { if(!doc.exists) { renderMainTickerText(""); return; } globalTickerData = doc.data(); let msg = ""; if(globalTickerData.adminMessage) msg += `📢 ${globalTickerData.adminMessage}   ///   `; if(globalTickerData.userMessages && globalTickerData.userMessages.length > 0) { msg += globalTickerData.userMessages.map((m,i) => `${i+1}. ${m}`).join("   ///   "); } renderMainTickerText(msg); }); }
function writeUserTicker(){ const m = prompt("현장 안전 문구를 입력하세요:"); if(!m) return; let msgs = globalTickerData.userMessages || []; msgs.unshift(m); if(msgs.length > 3) msgs = msgs.slice(0, 3); db.collection('settings').doc('banner').set({ userMessages: msgs }, { merge: true }).then(() => showToast("등록되었습니다.")).catch((e) => alert("실패: " + e.message)); }
async function setAdminTicker(){ if(await verifyAdmin()){ const m = prompt("관리자 공지 문구를 입력하세요:"); if(m) db.collection('settings').doc('banner').set({adminMessage:m}, {merge:true}); } }
async function openTickerManager(){ if(await verifyAdmin()){ document.getElementById('tickerManageModal').style.display='flex'; renderTickerList(); } }
function renderTickerList() { const listContainer = document.getElementById('tickerListContainer'); listContainer.innerHTML = ''; const data = globalTickerData; let hasData = false; if (data.adminMessage) { hasData = true; listContainer.innerHTML += `<div class="ticker-manage-item"><span style="color:red; flex:1; font-weight:800;">📢 [관리자] ${data.adminMessage}</span><button onclick="deleteTickerMsg('admin', 0)" class="mini-btn btn-del-mini">삭제</button></div>`; } if (data.userMessages) { data.userMessages.forEach((m, i) => { hasData = true; listContainer.innerHTML += `<div class="ticker-manage-item"><span style="flex:1; font-weight:700;">${i + 1}. ${m}</span><button onclick="deleteTickerMsg('user', ${i})" class="mini-btn btn-del-mini">삭제</button></div>`; }); } if (!hasData) listContainer.innerHTML = '<div style="padding:10px; text-align:center; font-weight:700;">등록된 내용이 없습니다.</div>'; }
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
function downloadWorkLogsExcel() { if (!currentWorkerId || Object.keys(adminWorkLogs).length === 0) { return alert("다운로드할 근무 기록 데이터가 없습니다."); } trackAppEvent('actions', 'excel_dl'); let csvContent = "\uFEFF날짜,배 이름,임금 1,임금 2,총임금,근무자,메모\n"; const sortedDates = Object.keys(adminWorkLogs).sort(); sortedDates.forEach(date => { const d = adminWorkLogs[date]; const ship = d.shipName || ""; const w1 = d.wage1 || 0; const w2 = d.wage2 || 0; const total = d.totalPay || 0; const workers = (d.coworkers || "").replace(/,/g, " "); const memo = (d.memo || "").replace(/\n/g, " ").replace(/,/g, " "); csvContent += `${date},${ship},${w1},${w2},${total},${workers},${memo}\n`; }); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); const monthTitle = document.getElementById('calMonthYear').innerText; link.href = url; link.download = `${currentWorkerId}_${monthTitle}_근무기록.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link); showToast("📊 엑셀 파일이 다운로드 폴더에 저장되었습니다!"); }
let latestMonthlyStatsCache = { total: 0, w1Sum: 0, w2Sum: 0, days: 0, avg: 0 };
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
