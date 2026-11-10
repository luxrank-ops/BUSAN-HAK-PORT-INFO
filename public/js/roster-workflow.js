/* ==========================================================================
   📋 근무배치 워크플로우 엔진
   --------------------------------------------------------------------------
   사진 명단 → 이름/선박 검색 → 전 터미널 스케줄 대입 → 임금·근무일지 연결을
   앱의 다른 화면 코드와 분리한 전용 엔진입니다.

   - 사진 파일은 Object URL 로만 열고 서버에 전송하지 않습니다.
   - OCR 결과와 직접 추가 명단은 검토 후에만 반영합니다.
   - 기존 인라인 onclick API 는 현장 사용 흐름을 깨지 않도록 그대로 제공합니다.
   ========================================================================== */

/* ===== 🔍 이름으로 선박 찾기 (명단 → 차트·스케줄 → 임금·일지 자동 등록) =====
   BAND 명단 사진(2026-11-10/11)을 전사한 PHOTO_ROSTER_20261110 을 기본 명단으로 쓴다.
   작업자 이름(이춘학 등) 또는 선박명을 입력하면:
   ① 명단에서 배정 선박을 찾고 ② 전 터미널 차트·스케줄에서 선박명을 대입 조회한 뒤
   ③ 임금계산기(최대 4척)와 근무일지에 자동 등록한다.
   사용자가 직접 추가한 명단은 localStorage(busanPortRosterExtra)에 보관한다. */
const PHOTO_ROSTER_20261110 = [
    { date: "2026-11-10", vessel: "CMA CGM AUSTRAL", time: "18:00", company: "세정", support: "BNCT 지원", group: "①",
      workers: ["김명준", "김민재2", "조훈철", "김근우1", "김경찬", "구자성", "사승동", "이재호"] },
    { date: "2026-11-10", vessel: "YM WAYFINDER", time: "20:00", company: "KML", support: "", group: "",
      workers: ["이성", "최준호", "신승호", "이재열", "이종림", "박세훈", "김광명", "김동근", "이준필", "양기택", "백상훈", "김치성", "김봉준", "박상준", "오경환", "곽민석", "임종호", "백승윤", "박규태", "정영중", "박창훈", "신철구", "황인기", "김영구", "김찬우1", "유동석", "김종성", "최영용", "최병섭", "김근우", "하승환", "윤동환", "김유신1", "윤승주", "설석종", "이준수", "이현재", "김찬구", "강성빈", "박성용"] },
    { date: "2026-11-11", vessel: "PRESIDENT CARTER", time: "00:00", company: "고려", support: "BNCT 지원", group: "②",
      workers: ["조훈철", "오규환", "신경호", "김근우1", "김경민1", "남영우", "김명준", "박상원", "이경덕", "김민재2", "이수남", "최승훈", "김경찬", "이정식", "이봉호", "구자성", "김영현", "이춘학", "사승동", "이수열", "안영준", "이재호", "박현대", "오용구"] },
    { date: "2026-11-11", vessel: "WILLIAM", time: "11:00", company: "코엠", support: "", group: "",
      workers: ["백상훈", "박상준", "곽민석", "박규태", "이성", "이재열", "박세훈", "이준필", "박창훈", "신철구", "유동석", "김종성", "여상규", "정철화", "김창홍", "이재원"] },
    { date: "2026-11-11", vessel: "CMA CGM PANAMA", time: "15:00", company: "세정", support: "BNCT 지원", group: "③",
      workers: ["이경덕", "김명준", "박상원", "최승훈", "김민재2", "이수남", "신경호", "김영수3", "오규환", "남영우", "김근우1", "김경민1", "이봉호", "김경찬", "이정식", "이춘학", "설석종", "김영현", "안영준", "구자성", "이수열", "오용구", "사승동", "박현대"] },
    { date: "2026-11-11", vessel: "MAGNA", time: "14:00", company: "고려", support: "", group: "④",
      workers: ["김치성", "김봉준", "임종호", "백승윤", "최준호", "신승호", "김광명", "김동근", "황인기", "김영구", "최영용", "최병섭", "김유신1", "윤승주", "김찬구", "강성빈"] },
    { date: "2026-11-11", vessel: "ULTIMA", time: "15:00", company: "조영", support: "", group: "①",
      workers: ["오경환", "원지현", "정영중", "강남오", "이종림", "장영근", "양기택", "강무성", "김찬우1", "여상규", "김근우", "김창홍", "설석종", "정철화", "박성용", "이재원"] }
];
const ROSTER_EXTRA_STORAGE_KEY = "busanPortRosterExtra";

/* 🔒 근무배치(오더 종이) 기능은 테스트가 끝날 때까지 PIN 잠금 상태로 유지합니다.
 *   잠금은 기존 근무일지 PIN 모달/서버 검증(SCREEN_LOCK_PIN)을 사용합니다.
 */
const ROSTER_FINDER_BETA_LOCK = true;

/** 사진 명단 기능을 지금 쓸 수 있는지 (잠금이 꺼져 있거나, 근무일지 잠금/전용 잠금을 푼 상태) */
function isRosterFinderUnlocked() {
    if (!ROSTER_FINDER_BETA_LOCK) return true;
    // 근무일지 잠금 해제 상태와 분리: 테스트 중에는 이 기능도 별도로 PIN 입력을 요구합니다.
    return readSessionValue(ROSTER_FINDER_UNLOCK_KEY) === "1";
}

/** 저장해 둔 사진 명단(내 기기에 저장을 체크한 경우)을 한 번만 불러옵니다. */
let rosterPhotoLoaded = false;
function ensureRosterPhotoRosterLoaded() {
    if (rosterPhotoLoaded) return;
    rosterPhotoLoaded = true;
    loadPhotoRosterFromDevice();
    renderRosterPhotoSaved();
}

/** 잠금 배너 ↔ 패널 표시를 현재 상태에 맞춥니다. */
function syncRosterFinderLockUI() {
    if (typeof ensureRosterPhotoRosterLoaded === "function") ensureRosterPhotoRosterLoaded();
    const banner = document.getElementById("rosterFinderLockBanner");
    const panel = document.getElementById("rosterFinderPanel");
    const unlocked = isRosterFinderUnlocked();
    if (banner) banner.classList.toggle("hidden", unlocked);
    if (panel) panel.classList.toggle("hidden", !unlocked);
    return unlocked;
}

/** 잠금 배너/진입 버튼 → PIN 입력 모달 → 성공 시 패널 열기 */
function unlockRosterFinder() {
    if (syncRosterFinderLockUI()) {
        const input = document.getElementById("rosterFinderInput");
        if (input) setTimeout(() => input.focus(), 50);
        return;
    }
    openWorkLogPinModal(() => {
        writeSessionValue(ROSTER_FINDER_UNLOCK_KEY, "1");
        syncRosterFinderLockUI();
        showToast("🔓 사진 명단 기능 잠금이 해제되었습니다. 이름을 입력해 보세요.");
        const input = document.getElementById("rosterFinderInput");
        if (input) {
            input.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => input.focus(), 120);
        }
    });
}
/* ===== 📋 근무배치(오더 종이) 자동 기입 — 메인 화면 독립 펼침 블럭 =====
   · 기존 근무일지 카드 안에 있던 "사진 명단 · 이름으로 선박 찾기" 패널을 메인 화면으로 옮겼습니다.
   · 헤더(블럭)를 누르면 펼침/접힘. 한 번에 한 블럭만 펼치는 기존 대시보드 동작을 따릅니다.
   · 사진은 서버로 전송되지 않고 이 기기에서만 처리됩니다. */
function syncRosterDeckAria() {
    const card = document.getElementById("rosterDeckCard");
    const header = document.getElementById("rosterDeckHeader");
    if (!header) return;
    const expanded = Boolean(card && card.classList.contains("expanded"));
    header.setAttribute("aria-expanded", expanded ? "true" : "false");
}
function setRosterDeckExpanded(expanded) {
    const card = document.getElementById("rosterDeckCard");
    if (!card) return;
    const content = card.querySelector(".dash-content");
    card.classList.toggle("expanded", Boolean(expanded));
    if (content) content.style.display = expanded ? "block" : "none";
    syncRosterDeckAria();
    if (!expanded) return;
    if (typeof syncRosterFinderLockUI === "function") syncRosterFinderLockUI();
    if (typeof renderRosterExtraList === "function") renderRosterExtraList();
    if (typeof trackAppEvent === "function") trackAppEvent("blocks", "rosterDeckCard");
}
function openRosterDeck(scroll) {
    setRosterDeckExpanded(true);
    if (scroll === false) return;
    const card = document.getElementById("rosterDeckCard");
    if (card && typeof card.scrollIntoView === "function") {
        setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
}
function toggleRosterDeck() {
    const card = document.getElementById("rosterDeckCard");
    if (!card) return;
    if (card.classList.contains("expanded")) {
        setRosterDeckExpanded(false);
        return;
    }
    // 다른 펼침 블럭은 접어 화면을 정리합니다(기존 대시보드와 같은 동작).
    if (typeof document.querySelectorAll === "function") {
        document.querySelectorAll(".dash-card.expanded").forEach(item => {
            if (!item || item.id === "rosterDeckCard") return;
            item.classList.remove("expanded");
            const content = item.querySelector ? item.querySelector(".dash-content") : null;
            if (content) content.style.display = "none";
        });
    }
    setRosterDeckExpanded(true);
}
let rosterFinderResults = [];
/** 이 탭에서 사용자가 근무 배치 사진을 골라 명단 읽기 흐름에 들어왔는지.
 *  들어왔다면 예전 기본(전사) 명단은 이름 검색에서 제외합니다(사진에 없는 배가 나오는 문제 방지). */
let rosterPhotoSessionActive = false;

function normalizeRosterWorkerName(name) {
    return String(name || "").normalize("NFKC").replace(/[\s\u200B]+/g, "").trim();
}
function normalizeRosterVesselKey(name) {
    return String(name || "").normalize("NFKC").replace(/^\s*\[[^\]]+\]\s*/, "").replace(/[\s\u200B]+/g, "").toLocaleUpperCase("ko-KR");
}
/** 직접 추가한 명단을 화면용 공통 형태로 안전하게 복원합니다. */
function getRosterExtraEntries() {
    let rows = [];
    try {
        const stored = localStorage.getItem(ROSTER_EXTRA_STORAGE_KEY);
        rows = stored ? JSON.parse(stored) : [];
    } catch (error) {
        rows = [];
    }
    if (!Array.isArray(rows)) return [];

    return rows.reduce((entries, row) => {
        if (!row || !row.date || !row.vessel) return entries;
        const workers = Array.isArray(row.workers) ? row.workers : [row.worker];
        const cleanWorkers = workers.map((worker) => String(worker || "").trim()).filter(Boolean);
        if (!cleanWorkers.length) return entries;
        entries.push({
            date: String(row.date),
            vessel: String(row.vessel).trim(),
            time: String(row.time || ""),
            company: String(row.company || ""),
            support: String(row.support || ""),
            group: String(row.group || ""),
            workers: cleanWorkers
        });
        return entries;
    }, []);
}

/**
 * 시작용 전사 명단은 사용자가 자신의 사진 명단을 쓰기 시작한 뒤에는 완전히 제외합니다.
 * 같은 날짜만 교체하면 다른 날짜의 오래된 배정이 섞이는 문제가 있어 명단 전체를 교체합니다.
 */
function isBuiltinPhotoRosterSuppressed() {
    const hasPhotoRoster = (typeof getPhotoRosterEntries === "function" ? getPhotoRosterEntries() : []).length > 0;
    return rosterPhotoSessionActive === true || hasPhotoRoster;
}

/** 여러 입력층을 우선순위 순으로 한 번만 합치는 명단 저장소 경계입니다. */
function getAllRosterAssignments() {
    const sources = [
        getPhotoRosterEntries(),
        getRosterExtraEntries(),
        ...(isBuiltinPhotoRosterSuppressed() ? [] : [PHOTO_ROSTER_20261110])
    ];
    const assignmentByKey = new Map();
    for (const source of sources) {
        for (const assignment of source || []) {
            if (!assignment || !assignment.vessel) continue;
            const key = `${assignment.date || ""}|${normalizeRosterVesselKey(assignment.vessel)}`;
            // 먼저 들어온 사진/직접 명단이 뒤의 시작용 전사 명단보다 우선합니다.
            if (!assignmentByKey.has(key)) assignmentByKey.set(key, assignment);
        }
    }
    return [...assignmentByKey.values()];
}

function findRosterAssignmentsByWorker(workerName) {
    const workerKey = normalizeRosterWorkerName(workerName);
    if (!workerKey) return [];
    return getAllRosterAssignments().filter(({ workers }) =>
        (workers || []).some((worker) => normalizeRosterWorkerName(worker) === workerKey)
    );
}

function findRosterAssignmentsByVessel(vesselName) {
    const vesselKey = normalizeRosterVesselKey(vesselName);
    if (!vesselKey) return [];
    return getAllRosterAssignments().filter(({ vessel }) => {
        const candidateKey = normalizeRosterVesselKey(vessel);
        return candidateKey === vesselKey || candidateKey.includes(vesselKey) || vesselKey.includes(candidateKey);
    });
}

/** 정확 일치를 우선하고, 없을 때만 부분 일치를 보조 후보로 사용합니다. */
function matchScheduleVesselByName(vessels, vesselName) {
    if (!Array.isArray(vessels)) return null;
    const requestedKey = normalizeRosterVesselKey(vesselName);
    if (!requestedKey) return null;
    let partial = null;
    for (const vessel of vessels) {
        const scheduledKey = normalizeRosterVesselKey(vessel && vessel.VSL_NM);
        if (!scheduledKey) continue;
        if (scheduledKey === requestedKey) return vessel;
        if (!partial && (scheduledKey.includes(requestedKey) || requestedKey.includes(scheduledKey))) partial = vessel;
    }
    return partial;
}

/**
 * 명단별로 모든 터미널을 훑어 자동 입력에 쓸 계획을 만듭니다.
 * 첫 번째 순회는 정확 일치만, 두 번째 순회는 OCR 약자를 보완하는 부분 일치만 허용합니다.
 */
function buildRosterVesselPlan(assignments, scheduleByTerminal) {
    const terminalEntries = Object.entries(scheduleByTerminal || {});
    return (assignments || []).map((assignment) => {
        const assignmentKey = normalizeRosterVesselKey(assignment && assignment.vessel);
        let located = null;
        let terminalId = "";

        for (const [id, vessels] of terminalEntries) {
            const exact = (vessels || []).find((vessel) => normalizeRosterVesselKey(vessel && vessel.VSL_NM) === assignmentKey);
            if (exact) {
                located = exact;
                terminalId = id;
                break;
            }
        }
        if (!located) {
            for (const [id, vessels] of terminalEntries) {
                const partial = matchScheduleVesselByName(vessels, assignment && assignment.vessel);
                if (partial) {
                    located = partial;
                    terminalId = id;
                    break;
                }
            }
        }
        return { assignment, vessel: located, terminalId, found: Boolean(located) };
    });
}

/* ===== 동일 날짜 중복 등록 방지 (근무일지 기준) =====
   사진 명단으로 자동 기입할 때, 이미 같은 날짜 근무일지에 등록된 선박은
   다시 등록하지 않는다. 판정은 선박명 정규화 키(normalizeWorklogShipKey) 기준이며,
   저장 기록(adminWorkLogs) + 현재 폼(logShipName, 폼 날짜가 같은 경우)을 함께 본다. */
function dedupeVesselNameList(names) {
    const seen = new Set();
    const unique = [];
    const duplicates = [];
    (names || []).forEach(name => {
        const clean = String(name || "").trim();
        if (!clean) return;
        // 공백·대소문자·[터미널] 머리말을 무시해 같은 배로 판정한다.
        const key = normalizeRosterVesselKey(clean);
        if (seen.has(key)) duplicates.push(clean);
        else { seen.add(key); unique.push(clean); }
    });
    return { unique, duplicates };
}
function getSavedWorklogVesselNames(dateStr) {
    const d = adminWorkLogs[dateStr];
    return d && d.shipName ? parseWorklogShipNames(d.shipName) : [];
}
function getExistingWorklogVesselNames(dateStr) {
    const saved = getSavedWorklogVesselNames(dateStr);
    const formNames = getActiveWorkLogDate() === dateStr
        ? parseWorklogShipNames(document.getElementById("logShipName")?.value)
        : [];
    return dedupeVesselNameList([...saved, ...formNames]).unique;
}
function isVesselRegisteredOnDate(vesselName, dateStr) {
    const key = normalizeRosterVesselKey(vesselName);
    if (!key || !dateStr) return false;
    return getExistingWorklogVesselNames(dateStr).some(n => normalizeRosterVesselKey(n) === key);
}
function splitNewAndDuplicateVessels(newNames, existingNames) {
    const existingKeys = new Set((existingNames || []).map(n => normalizeRosterVesselKey(n)));
    const toAdd = [];
    const skipped = [];
    (newNames || []).forEach(name => {
        const clean = String(name || "").trim();
        if (!clean) return;
        if (existingKeys.has(normalizeRosterVesselKey(clean))) skipped.push(clean);
        else toAdd.push(clean);
    });
    return { toAdd, skipped };
}
let rosterSearchNonce = 0;

/** 필요한 월과 실시간 터미널만 수집해 결과를 터미널별로 정리합니다. */
async function loadRosterScheduleByTerminal(assignments) {
    const months = [...new Set((assignments || []).map(({ date }) => String(date || "").slice(0, 7)).filter(Boolean))];
    const terminalIds = TERMINAL_SCHEDULE_LIST.filter(({ live }) => live).map(({ id }) => id);
    const scheduleByTerminal = Object.fromEntries(terminalIds.map((id) => [id, []]));

    await Promise.all(terminalIds.flatMap((terminalId) => months.map(async (month) => {
        try {
            const response = await fetchHjncScheduleForMonth(month, false, terminalId);
            if (Array.isArray(response)) scheduleByTerminal[terminalId].push(...response);
        } catch (error) {
            // 일부 터미널의 조회가 실패해도 다른 터미널과 명단 이름 폴백은 계속 제공합니다.
            console.warn("[근무배치] 터미널 스케줄 조회 실패", terminalId, month, error);
        }
    })));
    return scheduleByTerminal;
}

function findRosterAssignments(query) {
    const byWorker = findRosterAssignmentsByWorker(query);
    return byWorker.length ? { assignments: byWorker, mode: "worker" } : {
        assignments: findRosterAssignmentsByVessel(query),
        mode: "vessel"
    };
}

function renderEmptyRosterSearch(query) {
    rosterFinderResults = [];
    const output = document.getElementById("rosterFinderResults");
    if (!output) return;
    const usingOwnRoster = isBuiltinPhotoRosterSuppressed();
    const guidance = usingOwnRoster
        ? " 내 사진 명단을 쓰는 중이라 예전 기본 명단(11/10~11일 사진 전사분)은 찾지 않습니다. 위 검토 표에서 선박명·날짜·이름을 고쳐 [명단으로 변환]을 누르거나, 아래 '내 명단 추가'로 배정을 등록해 주세요."
        : " 이름 철자(예: 이춘학) 또는 선박명(예: PRESIDENT CARTER)으로 다시 입력하거나, 아래 '내 명단 추가'로 배정을 등록해 주세요.";
    output.innerHTML = `<div class="roster-finder-empty">🔍 '${escapeShipCommentHtml(query)}' 명단에서 찾지 못했습니다.${guidance}</div>`;
}

async function searchRosterVessels() {
    if (!isRosterFinderUnlocked()) {
        unlockRosterFinder();
        return;
    }
    const query = String(document.getElementById("rosterFinderInput")?.value || "").trim();
    const output = document.getElementById("rosterFinderResults");
    if (!query) return showToast("작업자 이름 또는 선박명을 입력해 주세요.");
    if (!output) return;

    const { assignments, mode } = findRosterAssignments(query);
    if (!assignments.length) {
        renderEmptyRosterSearch(query);
        return;
    }

    // 네트워크가 느린 상태에서 새 검색을 하면, 이전 응답이 최신 화면을 덮지 못하게 합니다.
    const requestNonce = ++rosterSearchNonce;
    output.innerHTML = `<div class="roster-finder-empty">⏳ ${assignments.length}척 배정 확인 · 전 터미널 차트·스케줄에서 선박을 대입 조회 중...</div>`;
    const scheduleByTerminal = await loadRosterScheduleByTerminal(assignments);
    if (requestNonce !== rosterSearchNonce) return;

    const plan = buildRosterVesselPlan(assignments, scheduleByTerminal);
    rosterFinderResults = plan;
    renderRosterFinderResults(plan, query, mode);
    trackAppEvent("actions", "roster_finder_search");
}

function renderRosterFinderResults(plan, query, searchMode) {
    const el = document.getElementById("rosterFinderResults");
    if (!el) return;
    const foundCount = plan.filter(p => p.found).length;
    const modeLabel = searchMode === "worker" ? "작업자" : "선박";
    const registeredCount = plan.filter(p => isVesselRegisteredOnDate(p.assignment.vessel, p.assignment.date)).length;
    const cards = plan.map((p, i) => {
        const a = p.assignment;
        const meta = p.terminalId ? getTerminalMeta(p.terminalId) : null;
        const cfg = p.terminalId ? (terminalQuickConfig[p.terminalId] || {}) : {};
        const alreadyRegistered = isVesselRegisteredOnDate(a.vessel, a.date);
        let scheduleLine = "";
        let hoursLine = "";
        if (p.found && p.vessel) {
            const period = getSelectedVesselPeriod(p.vessel, a.date);
            const berth = escapeShipCommentHtml(p.vessel.BERTH_NO || "-");
            scheduleLine = `선석 ${berth} · 입항 ${formatWageScheduleEvent(period.arrival)} · 출항 ${formatWageScheduleEvent(period.departure)}`;
            hoursLine = period.hours > 0 ? ` · ${period.hours}시간 자동 계산 가능` : " · 입·출항 시각 확인 필요";
        } else {
            scheduleLine = "⚠️ 차트·스케줄에서 찾지 못함 — 명단 선박명으로만 등록됩니다";
        }
        if (alreadyRegistered) {
            scheduleLine += " · ✅ 이미 근무일지에 등록됨 (중복 등록 안 함)";
        }
        const badge = meta ? `<span class="roster-finder-badge" style="background:${meta.color};">${meta.badge}</span>` : "";
        const registeredBadge = alreadyRegistered ? `<span class="roster-finder-registered-badge">✅ 등록됨</span>` : "";
        const links = p.terminalId
            ? `<a href="${cfg.schedule || "#"}" target="_blank" rel="noopener noreferrer" class="roster-finder-link">🗓️ 스케줄 ↗</a><a href="${cfg.chart || "#"}" target="_blank" rel="noopener noreferrer" class="roster-finder-link">📊 차트 ↗</a>`
            : "";
        const disabledAttr = alreadyRegistered ? " disabled" : "";
        return `<div class="roster-finder-card${p.found ? "" : " is-missing"}${alreadyRegistered ? " is-registered" : ""}">
            <div class="roster-finder-card-head">${badge}${registeredBadge}<strong>🚢 ${escapeShipCommentHtml(a.vessel)}</strong><span>${escapeShipCommentHtml(a.date)}${a.time ? " · 명단 " + escapeShipCommentHtml(a.time) : ""}${a.company ? " · " + escapeShipCommentHtml(a.company) : ""}${a.support ? " · " + escapeShipCommentHtml(a.support) : ""}${a.group ? " · " + escapeShipCommentHtml(a.group) : ""}</span></div>
            <div class="roster-finder-card-sub">${scheduleLine}${hoursLine}</div>
            <div class="roster-finder-card-actions">
                <button type="button" onclick="registerRosterResultToWage(${i})"${disabledAttr}>🧮 임금계산기 등록</button>
                <button type="button" onclick="registerRosterResultToWorkLog(${i})"${disabledAttr}>📅 근무일지 등록</button>
                ${links}
            </div>
        </div>`;
    }).join("");
    const allRegistered = plan.length > 0 && registeredCount === plan.length;
    const allBtn = plan.length > 1
        ? (allRegistered
            ? `<button type="button" class="roster-finder-all-btn is-done" disabled>✅ 모두 이미 근무일지에 등록됨</button>`
            : `<button type="button" class="roster-finder-all-btn" onclick="registerAllRosterResults()">✨ 전체 자동 등록 (임금계산기 + 근무일지${foundCount > 0 ? " · 임금 자동 계산" : ""}${registeredCount > 0 ? " · 중복 제외" : ""})</button>`)
        : "";
    const registeredNote = registeredCount > 0 && !allRegistered ? ` · 이미 등록 ${registeredCount}척 제외` : "";
    el.innerHTML = `<div class="roster-finder-summary">🔍 '${escapeShipCommentHtml(query)}' (${modeLabel}) · ${plan.length}척 배정 · 스케줄 매칭 ${foundCount}척${registeredNote}</div>${cards}${allBtn}`;
}
function registerRosterResultToWage(index) {
    const item = rosterFinderResults[index];
    if (!item) return;
    const wageCard = document.getElementById("wage-card");
    if (wageCard && !wageCard.classList.contains("expanded")) toggleDashItem("wage-card");
    // 이미 선택된 선박은 다시 누르면 해제(토글)되므로, 등록은 멱등하게 건너뛴다.
    const alreadySelected = selectedWageVessels.some(v => normalizeWorklogShipKey(v.name) === normalizeWorklogShipKey(item.assignment.vessel));
    if (alreadySelected) {
        showToast(`🧮 ${item.assignment.vessel}은(는) 이미 임금계산기에 선택되어 있어 중복 등록하지 않았습니다.`);
        document.getElementById("wage-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
    }
    if (item.found && item.vessel) {
        if (item.terminalId && item.terminalId !== selectedScheduleTerminal) selectScheduleTerminal(item.terminalId);
        applyWageScheduleShip(item.vessel, item.assignment.date, item.terminalId || selectedScheduleTerminal);
    } else {
        const input = document.getElementById("wageShipName");
        if (input) {
            const merged = dedupeVesselNameList([...parseWorklogShipNames(input.value), item.assignment.vessel]);
            input.value = merged.unique.slice(0, MAX_WORK_VESSELS).join(" / ");
            onWageShipNameChange(input.value);
        }
        showToast(`🧮 ${item.assignment.vessel} 선박명을 임금계산기에 입력했습니다. 근무 시간은 직접 확인해 주세요.`);
    }
    document.getElementById("wage-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function registerRosterResultToWorkLog(index) {
    const item = rosterFinderResults[index];
    if (!item) return;
    const logCard = document.getElementById("log-card");
    if (logCard && !logCard.classList.contains("expanded")) toggleDashItem("log-card");
    jumpToLogDate(item.assignment.date);
    const input = document.getElementById("logShipName");
    if (!input) return;
    // 동일 날짜에 이미 등록된 선박은 중복 등록하지 않는다.
    if (isVesselRegisteredOnDate(item.assignment.vessel, item.assignment.date)) {
        showToast(`📅 ${item.assignment.vessel}은(는) 이미 ${item.assignment.date} 근무일지에 등록되어 있어 중복 등록하지 않았습니다.`);
        document.getElementById("dailyLogForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
    }
    const names = parseWorklogShipNames(input.value);
    const key = normalizeWorklogShipKey(item.assignment.vessel);
    if (!names.some(n => normalizeWorklogShipKey(n) === key)) names.push(item.assignment.vessel);
    input.value = names.slice(0, MAX_WORK_VESSELS).join(" / ");
    if (item.found && item.vessel) {
        worklogVesselMeta.set(key, { name: item.assignment.vessel, vessel: item.vessel, date: item.assignment.date, terminalId: item.terminalId });
    }
    syncWorklogDoubleOrderMemo();
    refreshWorklogVesselList();
    updateWorklogDoubleOrderStatus();
    showToast(`📅 ${item.assignment.date} 근무일지에 ${item.assignment.vessel}을(를) 등록했습니다. 저장을 눌러 기록하세요.`);
    document.getElementById("dailyLogForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
async function registerAllRosterResults() {
    if (!rosterFinderResults.length) return;
    const sorted = [...rosterFinderResults].sort((a, b) => String(a.assignment.date).localeCompare(String(b.assignment.date)));
    const wageCard = document.getElementById("wage-card");
    if (wageCard && !wageCard.classList.contains("expanded")) toggleDashItem("wage-card");

    // 임금계산기: 기존 선택과 합쳐 등록한다. 이미 선택된 선박은 건너뛰어
    // 재실행해도 중복·토글 해제(선택 해제)가 일어나지 않는다.
    const wageInput = document.getElementById("wageShipName");
    const wageSkipped = [];
    const foundItems = sorted.filter(p => p.found && p.vessel).slice(0, MAX_WORK_VESSELS);
    const newFoundItems = foundItems.filter(p => !selectedWageVessels.some(v => normalizeWorklogShipKey(v.name) === normalizeWorklogShipKey(p.assignment.vessel)));
    wageSkipped.push(...foundItems.filter(p => !newFoundItems.includes(p)).map(p => p.assignment.vessel));
    if (newFoundItems.length > 0) {
        const firstTid = newFoundItems[0].terminalId;
        if (firstTid && firstTid !== selectedScheduleTerminal) selectScheduleTerminal(firstTid);
        newFoundItems.forEach(p => applyWageScheduleShip(p.vessel, p.assignment.date, p.terminalId || selectedScheduleTerminal));
    } else if (foundItems.length === 0) {
        const merged = dedupeVesselNameList([...parseWorklogShipNames(wageInput?.value), ...sorted.slice(0, MAX_WORK_VESSELS).map(p => p.assignment.vessel)]);
        if (wageInput) wageInput.value = merged.unique.slice(0, MAX_WORK_VESSELS).join(" / ");
        onWageShipNameChange(wageInput?.value || "");
    }

    // 근무일지: 같은 날짜 배정은 한 번에, 날짜가 여러 개면 날짜별로 순차 등록(마지막 날짜 폼이 열림)
    // 동일 날짜에 이미 등록된 선박은 중복 등록하지 않고 건너뛴다.
    const dates = [...new Set(sorted.map(p => p.assignment.date))];
    const logCard = document.getElementById("log-card");
    if (logCard && !logCard.classList.contains("expanded")) toggleDashItem("log-card");
    const logSkipped = [];
    const logAdded = [];
    for (const d of dates) {
        jumpToLogDate(d);
        const input = document.getElementById("logShipName");
        if (!input) continue;
        const names = parseWorklogShipNames(input.value);
        const dayItems = sorted.filter(p => p.assignment.date === d).slice(0, MAX_WORK_VESSELS);
        const { toAdd, skipped } = splitNewAndDuplicateVessels(dayItems.map(p => p.assignment.vessel), names);
        logSkipped.push(...skipped);
        toAdd.forEach(vesselName => {
            names.push(vesselName);
            logAdded.push(vesselName);
            const p = dayItems.find(item => normalizeWorklogShipKey(item.assignment.vessel) === normalizeWorklogShipKey(vesselName));
            if (p && p.found && p.vessel) worklogVesselMeta.set(normalizeWorklogShipKey(vesselName), { name: p.assignment.vessel, vessel: p.vessel, date: p.assignment.date, terminalId: p.terminalId });
        });
        input.value = names.slice(0, MAX_WORK_VESSELS).join(" / ");
        syncWorklogDoubleOrderMemo();
        refreshWorklogVesselList();
        updateWorklogDoubleOrderStatus();
    }

    // 스케줄 시각이 모두 있으면 임금 자동 계산 후 근무일지 임금 슬롯까지 전송
    const allHaveHours = selectedWageVessels.length > 0 && selectedWageVessels.every(item => getSelectedVesselPeriod(item.vessel, item.date).hours > 0);
    if (allHaveHours) {
        try { calculateWage(); } catch (e) { console.error("이름으로 선박 찾기 자동 계산 실패:", e); }
        if (lastCalculatedWageData) {
            try { await sendCalculatedWageToLog(); } catch (e) { console.error("이름으로 선박 찾기 일지 전송 실패:", e); }
        }
    }
    const skippedNote = [...new Set([...logSkipped, ...wageSkipped])];
    const addedNames = logAdded.length > 0 ? logAdded.join(" / ") : sorted.map(p => p.assignment.vessel).join(" / ");
    const skipNote = skippedNote.length > 0 ? ` · ${skippedNote.join(", ")}은(는) 이미 등록되어 건너뛰었습니다` : "";
    if (logAdded.length === 0 && skippedNote.length > 0) {
        showToast(`📅 ${skippedNote.join(", ")}은(는) 이미 근무일지에 등록되어 있어 중복 등록하지 않았습니다.`);
    } else {
        showToast(allHaveHours
            ? `✨ ${addedNames}을(를) 임금계산기·근무일지에 자동 등록하고 임금을 계산했습니다${skipNote}. 근무일지 저장을 눌러 기록하세요.`
            : `✨ ${addedNames}을(를) 임금계산기·근무일지에 등록했습니다${skipNote}. 입·출항 시각이 없어 임금 계산은 직접 확인해 주세요.`);
    }
    trackAppEvent("actions", "roster_finder_register_all");
}
function focusRosterFinder() {
    // 📋 근무배치(오더 종이) 자동 기입은 근무일지 카드 안이 아니라 메인 화면의 독립 펼침 블럭에 있다.
    // 임금계산기·근무일지에서 진입하면 이 블럭을 펼칩니다. (2026-11-10 부터 PIN 잠금 없이 바로 사용)
    const deckCard = document.getElementById("rosterDeckCard");
    if (deckCard && !deckCard.classList.contains("expanded")) {
        if (typeof openRosterDeck === "function") openRosterDeck();
        else deckCard.classList.add("expanded");
    }
    syncRosterFinderLockUI();
    if (!isRosterFinderUnlocked()) {
        const banner = document.getElementById("rosterFinderLockBanner");
        if (banner) banner.scrollIntoView({ behavior: "smooth", block: "center" });
        unlockRosterFinder();
        return;
    }
    const input = document.getElementById("rosterFinderInput");
    if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => input.focus(), 350);
    }
}
function addRosterExtraEntry() {
    const worker = String(document.getElementById("rosterExtraWorker")?.value || "").trim();
    const vessel = String(document.getElementById("rosterExtraVessel")?.value || "").trim();
    const date = String(document.getElementById("rosterExtraDate")?.value || "").trim();
    if (!worker || !vessel || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return showToast("작업자 이름·선박명·날짜를 모두 입력해 주세요.");
    }
    try {
        const list = getRosterExtraEntries();
        list.push({ date, vessel, time: "", company: "", support: "", group: "", workers: [worker] });
        localStorage.setItem(ROSTER_EXTRA_STORAGE_KEY, JSON.stringify(list));
        document.getElementById("rosterExtraWorker").value = "";
        document.getElementById("rosterExtraVessel").value = "";
        document.getElementById("rosterExtraDate").value = "";
        renderRosterExtraList();
        showToast(`➕ ${worker} · ${vessel} (${date}) 명단을 추가했습니다. 이제 이름으로 찾을 수 있습니다.`);
    } catch (e) {
        showToast("⚠️ 명단 추가에 실패했습니다. 다시 시도해 주세요.");
    }
}
function deleteRosterExtraEntry(index) {
    try {
        const list = getRosterExtraEntries();
        if (!list[index]) return;
        list.splice(index, 1);
        localStorage.setItem(ROSTER_EXTRA_STORAGE_KEY, JSON.stringify(list));
        renderRosterExtraList();
        showToast("🗑️ 명단 항목을 삭제했습니다.");
    } catch (e) {
        showToast("⚠️ 명단 삭제에 실패했습니다.");
    }
}
function renderRosterExtraList() {
    const el = document.getElementById("rosterExtraList");
    if (!el) return;
    const list = getRosterExtraEntries();
    if (list.length === 0) {
        el.innerHTML = `<div class="roster-finder-empty">아직 직접 추가한 명단이 없습니다. 사진 명단(2026-11-10/11) 7척은 기본으로 들어 있습니다.</div>`;
        return;
    }
    el.innerHTML = list.map((e, i) =>
        `<div class="roster-finder-extra-item"><span>${escapeShipCommentHtml(e.date)} · ${escapeShipCommentHtml(e.vessel)} · ${escapeShipCommentHtml(e.workers.join(", "))}</span><button type="button" onclick="deleteRosterExtraEntry(${i})">삭제</button></div>`
    ).join("");
}
/* ===== 📷 근무 배치 사진으로 명단 만들기 (기기 내 처리 전용) =====
   · 사진 파일은 서버로 전송하지 않습니다. FileReader/ObjectURL 로 메모리에서만 열고,
     글자 인식(Tesseract.js)도 브라우저 안에서 실행됩니다.
   · 사진 자체는 어떤 저장소에도 남기지 않습니다(닫으면 사라짐).
   · 인식된 "글자"는 사용자가 검토·수정한 뒤 명단에 반영하며,
     [내 기기에 저장]을 체크한 경우에만 이 기기 localStorage 에 명단 텍스트가 남습니다.
   · 사진을 못 읽어도 사진을 보며 직접 적거나 붙여넣어 명단을 만들 수 있습니다. */
const ROSTER_PHOTO_STORAGE_KEY = "busanPortRosterPhoto";
const ROSTER_PHOTO_PERSIST_KEY = "busanPortRosterPhotoPersist";
const ROSTER_OCR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const ROSTER_PHOTO_MAX_EDGE = 2000;
const ROSTER_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const ROSTER_PHOTO_KNOWN_COMPANIES = [
    "고려", "세정", "코엠", "조영", "한진", "동원", "국제", "북항", "허치슨",
    "KML", "KMT", "PNC", "HMM", "PNIT", "BPTC", "BNCT", "HJNC", "DGT", "HPNT", "HBCT", "BCT"
];
const ROSTER_PHOTO_NOISE_WORDS = [
    "지원", "명단", "작업", "선박", "배치", "입항", "출항", "접안", "선석", "부산", "신항",
    "터미널", "근무", "당일", "전체", "이름", "비고", "합계", "시간", "회사", "야간", "주간",
    "조출", "잔업", "휴무", "연장", "정상", "확정", "예정", "변경", "공지", "안내", "첨부",
    "사진", "명령", "작성", "확인", "담당", "기사", "본부", "센터", "지점", "계획", "실시"
];

let rosterPhotoEntries = [];
let rosterPhotoPersist = false;
let rosterPhotoObjectUrl = "";
let rosterPhotoOcrText = "";
let rosterPhotoParsedRows = [];

/** OCR/붙여넣기 글자를 비교 가능한 형태로 정리합니다 (전각·제로폭·표 테두리 제거). */
function normalizeRosterOcrText(raw) {
    return String(raw || "")
        // ①②③ 은 NFKC 가 일반 숫자로 바꿔 버리므로 먼저 '(1)' 형태로 표시해 둡니다.
        .replace(/[①-⑨]/g, (m) => ` (${m.charCodeAt(0) - 0x2460 + 1}) `)
        .normalize("NFKC")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/[|│┃┆┊¦]/g, " ")
        .replace(/[：]/g, ":")
        .replace(/[·•‧]/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\r\n?/g, "\n");
}

function formatRosterDateParts(year, month, day) {
    const y = Number(year);
    const mo = Number(month);
    const d = Number(day);
    if (!(y >= 2000 && y <= 2100) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return "";
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 줄에서 날짜(2026.11.11 / 11.11 / 11월 11일)를 찾습니다. 연도가 없으면 defaultYear 를 씁니다. */
function extractRosterTextDate(line, defaultYear) {
    const s = String(line || "");
    let m = s.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/);
    if (m) return formatRosterDateParts(m[1], m[2], m[3]);
    m = s.match(/(?:^|[^\d:])(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?(?![\d:])/);
    if (m) return formatRosterDateParts(defaultYear, m[1], m[2]);
    return "";
}

/** 줄에서 시각(HH:MM / HH시)을 찾습니다. */
function extractRosterTextTime(line) {
    const s = String(line || "");
    const m = s.match(/(\d{1,2})\s*:\s*(\d{2})/) || s.match(/(\d{1,2})\s*시(?!\s*간)/);
    if (!m) return "";
    const h = Number(m[1]);
    const mi = m[2] ? Number(m[2]) : 0;
    if (!(h >= 0 && h <= 23) || !(mi >= 0 && mi <= 59)) return "";
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** 줄에서 선박명(영문, 대소문자 무관)을 뽑습니다. 터미널 약어·회사명은 제외합니다. */
function extractRosterVesselToken(line) {
    const s = String(line || "");
    const runs = s.match(/[A-Za-z][A-Za-z0-9&'.\-]*(?:\s+[A-Za-z0-9&'.\-]{2,})*/g) || [];
    let best = "";
    for (const run of runs) {
        const tokens = run.split(/\s+/)
            .map(t => t.replace(/[.'\-]+$/, ""))
            .filter(t => /^[A-Za-z][A-Za-z0-9&'.\-]*$/.test(t) && t.length >= 2);
        if (!tokens.length) continue;
        const joined = tokens.join(" ").trim();
        const longest = tokens.reduce((max, t) => Math.max(max, t.length), 0);
        if (longest < 4) continue;
        const upper = joined.toUpperCase();
        if (/^(BNCT|HJNC|DGT|PNC|HMM|PNIT|BPTC|HBCT|BCT|KML|KMT)$/.test(upper)) continue;
        if (ROSTER_PHOTO_KNOWN_COMPANIES.some(c => c.toUpperCase() === upper)) continue;
        if (upper.length > best.length) best = upper;
    }
    return best;
}

function extractRosterTextGroup(line) {
    const s = String(line || "");
    const circled = s.match(/\(([1-9])\)/);
    if (circled) return circled[1];
    const mark = s.match(/[①-⑨]/);
    if (mark) return mark[0];
    const jo = s.match(/(\d{1,2})\s*조(?![가-힣])/);
    return jo ? `${jo[1]}조` : "";
}

function extractRosterTextCompany(line) {
    const s = String(line || "").toUpperCase();
    for (const company of ROSTER_PHOTO_KNOWN_COMPANIES) {
        if (s.includes(company.toUpperCase())) return company;
    }
    return "";
}

function extractRosterTextSupport(line) {
    const s = String(line || "");
    if (!/지원/.test(s)) return "";
    const m = s.match(/([A-Za-z]{3,6}|[가-힣]{2,6})\s*지원/);
    if (!m) return "지원";
    return `${m[1].toUpperCase()} 지원`;
}

/** 작업자 이름 후보만 남깁니다 (2~4글자 한글, 끝에 숫자 허용: 김민재2). */
function isRosterWorkerNameToken(token) {
    if (!/^[가-힣]{2,4}\d?$/.test(token)) return false;
    const base = token.replace(/\d$/, "");
    if (ROSTER_PHOTO_NOISE_WORDS.includes(token) || ROSTER_PHOTO_NOISE_WORDS.includes(base)) return false;
    if (ROSTER_PHOTO_KNOWN_COMPANIES.includes(token) || ROSTER_PHOTO_KNOWN_COMPANIES.includes(base)) return false;
    return true;
}

/** 줄에서 작업자 이름 후보를 뽑습니다(날짜·시각·선박명·회사·지원·조 표시는 제거). */
function extractRosterWorkerTokens(line) {
    let s = String(line || "");
    s = s.replace(/(20\d{2})\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?/g, " ");
    s = s.replace(/(?:^|[^\d:])\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?(?![\d:])/g, " ");
    s = s.replace(/\d{1,2}\s*:\s*\d{2}/g, " ");
    s = s.replace(/\d{1,2}\s*시(?!\s*간)/g, " ");
    s = s.replace(/[A-Za-z][A-Za-z0-9&'.\-]*/g, " ");
    s = s.replace(/[①-⑨]/g, " ");
    s = s.replace(/\([1-9]\)/g, " ");
    s = s.replace(/\d{1,2}\s*조(?![가-힣])/g, " ");
    s = s.replace(/지원/g, " ");
    return s.split(/[\s,/、]+/).map(t => t.trim()).filter(Boolean).filter(isRosterWorkerNameToken);
}

/**
 * 사진에서 읽은(또는 붙여넣은) 글자를 명단 후보로 변환합니다.
 * 선박명이 있는 줄을 새 배정으로 보고, 뒤따르는 줄의 한글 이름은 그 배정에 이어 붙입니다.
 * @returns {{entries: Array, warnings: string[]}}
 */
/**
 * OCR 텍스트를 줄 단위 이벤트로 읽어 검토 가능한 배정 목록으로 바꿉니다.
 * 선박 줄은 새 배정을 시작하고, 선박이 없는 이름 줄은 마지막 배정에 이어 붙입니다.
 */
function parseRosterPhotoText(rawText, options) {
    const optionsValue = options || {};
    const defaultYear = Number(optionsValue.defaultYear) || new Date().getFullYear();
    const defaultDate = /^\d{4}-\d{2}-\d{2}$/.test(String(optionsValue.defaultDate || ""))
        ? String(optionsValue.defaultDate)
        : "";
    const lines = normalizeRosterOcrText(rawText).split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return { entries: [], warnings: ["글자가 없습니다. 사진을 다시 고르거나 직접 입력해 주세요."] };

    const state = lines.reduce((current, line) => {
        const dateInLine = extractRosterTextDate(line, defaultYear);
        if (dateInLine) current.date = dateInLine;

        const workers = extractRosterWorkerTokens(line);
        const vessel = extractRosterVesselToken(line);
        if (!vessel) {
            if (current.last && workers.length) {
                for (const worker of workers) {
                    if (!current.last.workers.some((saved) => normalizeRosterWorkerName(saved) === normalizeRosterWorkerName(worker))) {
                        current.last.workers.push(worker);
                    }
                }
            }
            return current;
        }

        const entryKey = `${current.date}|${normalizeRosterVesselKey(vessel)}`;
        let entry = current.byVessel.get(entryKey);
        const details = {
            time: extractRosterTextTime(line),
            company: extractRosterTextCompany(line),
            support: extractRosterTextSupport(line),
            group: extractRosterTextGroup(line)
        };
        if (!entry) {
            entry = { date: current.date, vessel, ...details, workers: [], source: "photo" };
            current.entries.push(entry);
            current.byVessel.set(entryKey, entry);
        } else {
            // 같은 선박이 사진 안에서 여러 줄로 나뉜 경우 최초로 인식한 정보를 보존합니다.
            for (const [field, value] of Object.entries(details)) {
                if (!entry[field] && value) entry[field] = value;
            }
        }
        for (const worker of workers) {
            if (!entry.workers.some((saved) => normalizeRosterWorkerName(saved) === normalizeRosterWorkerName(worker))) {
                entry.workers.push(worker);
            }
        }
        current.last = entry;
        return current;
    }, { date: defaultDate, entries: [], byVessel: new Map(), last: null });

    const warnings = [];
    if (!state.entries.length) warnings.push("선박명을 찾지 못했습니다. 선박명은 영문(예: PRESIDENT CARTER)으로 적혀 있어야 인식합니다.");
    const withoutDate = state.entries.filter(({ date }) => !date).length;
    const withoutWorkers = state.entries.filter(({ workers }) => !workers.length).length;
    if (withoutDate) warnings.push(`${withoutDate}척은 날짜를 찾지 못했습니다. 검토 화면에서 날짜를 채워 주세요.`);
    if (withoutWorkers) warnings.push(`${withoutWorkers}척은 작업자 이름을 찾지 못했습니다. 사진이 흐리면 직접 입력해 주세요.`);
    return { entries: state.entries, warnings };
}

function normalizeRosterPhotoEntry(entry) {
    if (!entry || !String(entry.vessel || "").trim()) return null;
    const date = String(entry.date || "");
    return {
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
        vessel: String(entry.vessel).trim(),
        time: String(entry.time || "").trim(),
        company: String(entry.company || "").trim(),
        support: String(entry.support || "").trim(),
        group: String(entry.group || "").trim(),
        workers: [...new Map((Array.isArray(entry.workers) ? entry.workers : [])
            .map((worker) => String(worker || "").trim())
            .filter(Boolean)
            .map((worker) => [normalizeRosterWorkerName(worker), worker])).values()],
        source: "photo"
    };
}

/** 같은 날짜·선박은 한 건만 남기되, 목록 순서는 최초 사진 줄을 유지하고 최신 값을 씁니다. */
function mergeRosterPhotoEntries(rows) {
    const positions = new Map();
    const merged = [];
    for (const row of rows || []) {
        const entry = normalizeRosterPhotoEntry(row);
        if (!entry) continue;
        const key = `${entry.date}|${normalizeRosterVesselKey(entry.vessel)}`;
        const position = positions.get(key);
        if (position === undefined) {
            positions.set(key, merged.length);
            merged.push(entry);
        } else {
            merged[position] = entry;
        }
    }
    return merged;
}

/**
 * 새로 읽은 명단으로 사진 명단을 '교체'합니다.
 * 이전 사진의 배가 검색 결과에 계속 남는 문제를 막기 위해 병합하지 않고 덮어씁니다.
 */
function replaceRosterPhotoEntries(rows) {
    rosterPhotoEntries = mergeRosterPhotoEntries(rows || []);
    return rosterPhotoEntries;
}

function getPhotoRosterEntries() {
    return rosterPhotoEntries;
}

function loadPhotoRosterFromDevice() {
    try {
        rosterPhotoPersist = localStorage.getItem(ROSTER_PHOTO_PERSIST_KEY) === "1";
        if (!rosterPhotoPersist) {
            rosterPhotoEntries = [];
            return rosterPhotoEntries;
        }
        const parsed = JSON.parse(localStorage.getItem(ROSTER_PHOTO_STORAGE_KEY) || "[]");
        rosterPhotoEntries = Array.isArray(parsed)
            ? parsed.map(normalizeRosterPhotoEntry).filter(e => e && e.date && e.vessel)
            : [];
    } catch (e) {
        rosterPhotoEntries = [];
    }
    return rosterPhotoEntries;
}

function savePhotoRosterToDevice() {
    try {
        localStorage.setItem(ROSTER_PHOTO_PERSIST_KEY, "1");
        localStorage.setItem(ROSTER_PHOTO_STORAGE_KEY, JSON.stringify(rosterPhotoEntries));
        return true;
    } catch (e) {
        return false;
    }
}

function clearPhotoRosterFromDevice() {
    try {
        localStorage.removeItem(ROSTER_PHOTO_STORAGE_KEY);
        localStorage.removeItem(ROSTER_PHOTO_PERSIST_KEY);
    } catch (e) { }
    rosterPhotoEntries = [];
    rosterPhotoPersist = false;
}

function isRosterPhotoPersistEnabled() {
    return rosterPhotoPersist;
}

/* --- 화면: 사진 선택 → 읽기 → 검토 --- */
function releaseRosterPhotoObjectUrl() {
    if (rosterPhotoObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(rosterPhotoObjectUrl);
    }
    rosterPhotoObjectUrl = "";
}

function setRosterPhotoStatus(message) {
    const el = document.getElementById("rosterPhotoStatus");
    if (el) el.textContent = String(message || "");
}

function setRosterPhotoBusy(busy, message) {
    const busyFlag = !!busy;
    ["rosterPhotoOcrBtn", "rosterPhotoClearBtn"].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = busyFlag;
    });
    ["rosterPhotoUploadLabel", "rosterPhotoGalleryLabel"].forEach(id => {
        const label = document.getElementById(id);
        if (label) label.classList.toggle("is-busy", busyFlag);
    });
    if (message) setRosterPhotoStatus(message);
}

function openRosterPhotoPicker() {
    if (!isRosterFinderUnlocked()) {
        unlockRosterFinder();
        return;
    }
    const input = document.getElementById("rosterPhotoInput");
    if (input) input.click();
}

/** 갤러리(앨범)에서 사진 선택 — capture 속성이 없는 입력을 엽니다. */
function openRosterGalleryPicker() {
    if (!isRosterFinderUnlocked()) {
        unlockRosterFinder();
        return;
    }
    const input = document.getElementById("rosterPhotoGalleryInput");
    if (input) input.click();
}

/** 사진 선택(카메라/앨범) — 이 기기 메모리에서만 엽니다. */
function handleRosterPhotoSelected(event) {
    const input = event && event.target;
    const file = input && input.files && input.files[0];
    if (!file) return;
    if (!/^image\//.test(String(file.type || ""))) {
        showToast("⚠️ 사진 파일만 올릴 수 있습니다.");
        return;
    }
    if (file.size > ROSTER_PHOTO_MAX_BYTES) {
        showToast("⚠️ 사진이 너무 큽니다. 15MB 이하 사진을 골라 주세요.");
        return;
    }
    // 사진을 고른 순간부터 예전 기본(전사) 명단은 이름 검색에서 제외합니다.
    // (사진에 없는 배가 결과에 나오는 문제 방지 — 명단이 0척으로 읽혀도 동일)
    rosterPhotoSessionActive = true;
    releaseRosterPhotoObjectUrl();
    try {
        rosterPhotoObjectUrl = URL.createObjectURL(file);
    } catch (e) {
        rosterPhotoObjectUrl = "";
    }
    // 새 사진을 고르면 이전 사진의 인식 글자·검토 줄은 지웁니다(예전 명단이 화면에 남지 않도록).
    rosterPhotoOcrText = "";
    rosterPhotoParsedRows = [];
    const textBox = document.getElementById("rosterPhotoText");
    if (textBox) textBox.value = "";
    const oldRows = document.getElementById("rosterPhotoRows");
    if (oldRows) oldRows.innerHTML = "";
    document.getElementById("rosterPhotoTextDetails")?.classList.add("hidden");
    const preview = document.getElementById("rosterPhotoPreview");
    if (preview && rosterPhotoObjectUrl) preview.src = rosterPhotoObjectUrl;
    document.getElementById("rosterPhotoPreviewWrap")?.classList.remove("hidden");
    const ocrBtn = document.getElementById("rosterPhotoOcrBtn");
    if (ocrBtn) ocrBtn.disabled = false;
    const clearBtn = document.getElementById("rosterPhotoClearBtn");
    if (clearBtn) clearBtn.disabled = false;
    setRosterPhotoStatus("📷 사진을 불러왔습니다(서버 전송 없음). [사진에서 명단 읽기]를 누르면 이 기기에서만 글자를 읽습니다.");
    if (input) input.value = ""; // 같은 사진을 다시 골라도 동작하도록
    trackAppEvent("actions", "roster_photo_selected");
}

/** OCR용 이미지 준비 — 확대·회색조·대비 보정. 결과는 메모리 문자열이며 저장하지 않습니다. */
async function preprocessRosterPhotoForOcr() {
    const img = document.getElementById("rosterPhotoPreview");
    if (!img || !img.src) throw new Error("사진이 없습니다.");
    if (!img.complete || !img.naturalWidth) {
        await new Promise(resolve => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, 3000);
        });
    }
    const w0 = img.naturalWidth || 0;
    const h0 = img.naturalHeight || 0;
    if (!w0 || !h0) throw new Error("사진을 읽을 수 없습니다.");
    const scale = w0 < 1200 ? Math.min(3, 1600 / w0) : Math.min(1, ROSTER_PHOTO_MAX_EDGE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이 브라우저에서는 사진 처리를 지원하지 않습니다.");
    ctx.drawImage(img, 0, 0, w, h);
    try {
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
            const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            const boosted = gray < 128 ? Math.max(0, gray - 20) : Math.min(255, gray + 20);
            px[i] = px[i + 1] = px[i + 2] = boosted;
        }
        ctx.putImageData(data, 0, 0);
    } catch (e) {
        // 캔버스 픽셀 접근이 막힌 환경이면 원본 그대로 진행합니다.
    }
    return canvas.toDataURL("image/png");
}

function loadRosterOcrScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector('script[data-roster-ocr="1"]')) return resolve();
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.setAttribute("data-roster-ocr", "1");
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("글자 인식 엔진을 불러오지 못했습니다."));
        document.head.appendChild(script);
    });
}

async function ensureRosterOcrEngine() {
    if (typeof window !== "undefined" && window.Tesseract && typeof window.Tesseract.recognize === "function") {
        return window.Tesseract;
    }
    await loadRosterOcrScript(ROSTER_OCR_SCRIPT_URL);
    if (!window.Tesseract || typeof window.Tesseract.recognize !== "function") {
        throw new Error("글자 인식 엔진을 사용할 수 없습니다.");
    }
    return window.Tesseract;
}

/** 사진에서 글자 읽기 — 전 과정이 이 기기 브라우저 안에서 실행됩니다. */
async function runRosterPhotoOcr() {
    if (!isRosterFinderUnlocked()) {
        unlockRosterFinder();
        return;
    }
    if (!rosterPhotoObjectUrl) {
        showToast("📷 먼저 근무 배치 사진을 선택해 주세요.");
        return;
    }
    setRosterPhotoBusy(true, "🔍 사진에서 글자를 읽는 중… (기기에서만 처리 · 처음 한 번은 엔진 내려받기로 조금 걸립니다)");
    try {
        const engine = await ensureRosterOcrEngine();
        const image = await preprocessRosterPhotoForOcr();
        const result = await engine.recognize(image, "kor+eng", {
            logger: (m) => {
                if (m && m.status === "recognizing text") {
                    setRosterPhotoStatus(`🔍 글자 인식 중… ${Math.round((Number(m.progress) || 0) * 100)}%`);
                }
            }
        });
        const text = String((result && result.data && result.data.text) || "");
        rosterPhotoOcrText = text;
        const box = document.getElementById("rosterPhotoText");
        if (box) box.value = text;
        document.getElementById("rosterPhotoTextDetails")?.classList.remove("hidden");
        setRosterPhotoStatus(`✅ 글자 인식 완료 (${text.length}자). 아래 칸에서 고친 뒤 [명단으로 변환]을 눌러 주세요.`);
        parseRosterPhotoTextFromBox();
        trackAppEvent("actions", "roster_photo_ocr_done");
    } catch (e) {
        console.error("사진 글자 인식 실패:", e);
        document.getElementById("rosterPhotoTextDetails")?.classList.remove("hidden");
        setRosterPhotoStatus("⚠️ 자동 인식이 안 됐습니다. 사진을 보며 아래 칸에 직접 적거나 붙여넣고 [명단으로 변환]을 눌러 주세요.");
        showToast("⚠️ 자동 인식 실패 — 사진을 보며 직접 입력할 수 있습니다.");
    } finally {
        setRosterPhotoBusy(false);
    }
}

function parseRosterPhotoTextFromBox() {
    const box = document.getElementById("rosterPhotoText");
    const raw = String(box ? box.value : rosterPhotoOcrText || "");
    if (!raw.trim()) {
        showToast("⚠️ 읽은 글자가 없습니다. 사진을 다시 고르거나 직접 입력해 주세요.");
        return { entries: [], warnings: [] };
    }
    let fallbackDate = "";
    try {
        fallbackDate = typeof getActiveWorkLogDate === "function" ? String(getActiveWorkLogDate() || "") : "";
    } catch (e) {
        fallbackDate = "";
    }
    const parsed = parseRosterPhotoText(raw, { defaultYear: new Date().getFullYear(), defaultDate: fallbackDate });
    rosterPhotoParsedRows = parsed.entries.map(e => Object.assign({}, e));
    renderRosterPhotoRows(parsed.warnings);
    // 사진을 새로 읽었는데 반영을 누르지 않으면 예전 명단으로 검색되므로, 바로 교체해 둡니다.
    autoApplyRosterPhotoRows();
    return parsed;
}

function renderRosterPhotoRows(warnings) {
    const el = document.getElementById("rosterPhotoRows");
    if (!el) return;
    const rows = rosterPhotoParsedRows;
    if (!rows.length) {
        const suffix = (typeof rosterPhotoSessionActive !== "undefined" && rosterPhotoSessionActive)
            ? " 명단을 만들기 전까지 이름 검색에 예전 기본 명단의 배는 나오지 않습니다."
            : "";
        el.innerHTML = `<div class="roster-photo-empty">명단을 찾지 못했습니다. 선박명(영문)·날짜·이름이 보이게 사진을 다시 찍거나, 위 칸에 직접 적어 주세요.${suffix}</div>`;
        return;
    }
    const warnHtml = (warnings || []).map(w => `<div class="roster-photo-warn">⚠️ ${escapeShipCommentHtml(w)}</div>`).join("");
    const rowHtml = rows.map((row, i) => `
        <div class="roster-photo-row">
            <div class="roster-photo-row-grid">
                <label>날짜<input type="date" value="${escapeShipCommentHtml(row.date || "")}" onchange="updateRosterPhotoRow(${i}, 'date', this.value)"></label>
                <label>선박명<input type="text" value="${escapeShipCommentHtml(row.vessel || "")}" onchange="updateRosterPhotoRow(${i}, 'vessel', this.value)"></label>
                <label>시간<input type="text" value="${escapeShipCommentHtml(row.time || "")}" placeholder="HH:MM" onchange="updateRosterPhotoRow(${i}, 'time', this.value)"></label>
                <label>회사<input type="text" value="${escapeShipCommentHtml(row.company || "")}" onchange="updateRosterPhotoRow(${i}, 'company', this.value)"></label>
            </div>
            <label class="roster-photo-row-workers">작업자 (${row.workers.length}명)
                <textarea rows="2" onchange="updateRosterPhotoRow(${i}, 'workers', this.value)">${escapeShipCommentHtml((row.workers || []).join(", "))}</textarea>
            </label>
            <button type="button" class="roster-photo-row-del" onclick="removeRosterPhotoRow(${i})">이 줄 삭제</button>
        </div>`).join("");
    el.innerHTML = `${warnHtml}${rowHtml}
        <label class="roster-photo-persist"><input type="checkbox" id="rosterPhotoPersist"${rosterPhotoPersist ? " checked" : ""}> 이 명단을 내 기기에 저장 (사진은 저장하지 않습니다)</label>
        <button type="button" class="roster-photo-apply-btn" onclick="applyRosterPhotoRoster()">✅ 이 명단으로 검색하기 (${rows.length}척)</button>`;
}

function updateRosterPhotoRow(index, field, value) {
    const row = rosterPhotoParsedRows[index];
    if (!row) return;
    if (field === "workers") {
        row.workers = String(value || "").split(/[,、\n]+/).map(v => v.trim()).filter(Boolean);
    } else if (field === "date") {
        row.date = /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
    } else {
        row[field] = String(value || "").trim();
    }
}

function removeRosterPhotoRow(index) {
    if (!rosterPhotoParsedRows[index]) return;
    rosterPhotoParsedRows.splice(index, 1);
    renderRosterPhotoRows([]);
}

/**
 * 검토한 명단을 실제 검색 명단에 반영합니다.
 * - 새 사진 명단은 이전 명단을 '교체'합니다(예전 근무가 결과에 남지 않게).
 * - options.auto 는 사진 인식 직후 자동 반영할 때 사용합니다(기기 저장 설정은 기존 값을 유지).
 */
function applyRosterPhotoRoster(options) {
    const opts = options || {};
    const usable = rosterPhotoParsedRows.filter(r => r && r.vessel && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || "")));
    if (!usable.length) {
        showToast("⚠️ 반영할 명단이 없습니다. 날짜와 선박명을 확인해 주세요.");
        return;
    }
    const previousCount = rosterPhotoEntries.length;
    const persistBox = document.getElementById("rosterPhotoPersist");
    const persist = opts.auto ? rosterPhotoPersist : !!(persistBox && persistBox.checked);
    rosterPhotoSessionActive = true;
    replaceRosterPhotoEntries(usable);
    rosterPhotoPersist = persist;
    if (persist) savePhotoRosterToDevice();
    else if (!opts.auto) clearRosterPhotoStorageOnly();
    renderRosterPhotoSaved();
    // 이전 사진으로 조회한 결과가 화면에 그대로 남지 않도록 지우고, 검색어가 있으면 다시 조회합니다.
    rosterFinderResults = [];
    const resultsEl = document.getElementById("rosterFinderResults");
    if (resultsEl) resultsEl.innerHTML = "";
    if (previousCount > 0) {
        showToast(`✅ 사진 명단을 ${usable.length}척으로 바꿨습니다. (이전 명단 ${previousCount}척은 지웠습니다)`);
    } else {
        showToast(`✅ 사진 명단 ${usable.length}척을 반영했습니다. 이제 이름으로 찾을 수 있습니다.${persist ? " (내 기기에 저장됨)" : ""}`);
    }
    trackAppEvent("actions", "roster_photo_applied");
    const query = String(document.getElementById("rosterFinderInput")?.value || "").trim();
    if (query) searchRosterVessels();
}

/** 날짜·선박명이 확실한 줄이 있으면 사진 인식 직후 바로 반영합니다. */
function autoApplyRosterPhotoRows() {
    const usable = rosterPhotoParsedRows.filter(r => r && r.vessel && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || "")));
    if (!usable.length) return false;
    applyRosterPhotoRoster({ auto: true });
    return true;
}

/** 저장된 명단만 지우고, 이번 세션에 만든 명단은 유지합니다. */
function clearRosterPhotoStorageOnly() {
    try {
        localStorage.removeItem(ROSTER_PHOTO_STORAGE_KEY);
        localStorage.removeItem(ROSTER_PHOTO_PERSIST_KEY);
    } catch (e) { }
}

function renderRosterPhotoSaved() {
    const el = document.getElementById("rosterPhotoSaved");
    if (!el) return;
    const list = rosterPhotoEntries;
    if (!list.length) {
        el.innerHTML = "";
        return;
    }
    const rows = list.slice(0, 12).map(e =>
        `<div class="roster-photo-saved-item"><span>${escapeShipCommentHtml(e.date)} · ${escapeShipCommentHtml(e.vessel)}${e.workers.length ? " · " + escapeShipCommentHtml(e.workers.join(", ")) : ""}</span><button type="button" onclick="deleteSavedPhotoRosterEntry('${escapeShipCommentHtml(e.date)}', '${escapeShipCommentHtml(e.vessel).replace(/'/g, "\\'")}')">삭제</button></div>`
    ).join("");
    el.innerHTML = `<div class="roster-photo-saved-head">📋 사진으로 만든 명단 ${list.length}척${rosterPhotoPersist ? " · 내 기기에 저장됨" : " · 이번 탭에서만"}</div>${rows}${list.length > 12 ? `<div class="roster-photo-empty">…외 ${list.length - 12}척</div>` : ""}
        <button type="button" class="roster-photo-clear-all" onclick="clearPhotoRosterEntries()">🗑️ 사진 명단 모두 지우기</button>`;
}

function deleteSavedPhotoRosterEntry(date, vessel) {
    const key = normalizeRosterVesselKey(vessel);
    rosterPhotoEntries = rosterPhotoEntries.filter(e => !(e.date === date && normalizeRosterVesselKey(e.vessel) === key));
    if (rosterPhotoPersist) savePhotoRosterToDevice();
    renderRosterPhotoSaved();
    showToast("🗑️ 명단에서 삭제했습니다.");
}

function clearPhotoRosterEntries() {
    rosterPhotoEntries = [];
    clearPhotoRosterFromDevice();
    renderRosterPhotoSaved();
    renderRosterPhotoRows([]);
    showToast("🗑️ 사진으로 만든 명단을 모두 지웠습니다.");
}

/** 사진·인식 글자·검토 결과를 화면에서 지웁니다(사진은 메모리에서 즉시 해제). */
function clearRosterPhoto() {
    releaseRosterPhotoObjectUrl();
    rosterPhotoOcrText = "";
    rosterPhotoParsedRows = [];
    // 사진 흐름을 완전히 닫으면 기본(전사) 명단 검색을 다시 허용합니다.
    // 단, 이미 반영된 사진 명단(rosterPhotoEntries)이 남아 있으면 그 명단이 계속 우선합니다.
    rosterPhotoSessionActive = false;
    const preview = document.getElementById("rosterPhotoPreview");
    if (preview) preview.removeAttribute("src");
    document.getElementById("rosterPhotoPreviewWrap")?.classList.add("hidden");
    document.getElementById("rosterPhotoTextDetails")?.classList.add("hidden");
    const box = document.getElementById("rosterPhotoText");
    if (box) box.value = "";
    const rowsEl = document.getElementById("rosterPhotoRows");
    if (rowsEl) rowsEl.innerHTML = "";
    const ocrBtn = document.getElementById("rosterPhotoOcrBtn");
    if (ocrBtn) ocrBtn.disabled = true;
    const clearBtn = document.getElementById("rosterPhotoClearBtn");
    if (clearBtn) clearBtn.disabled = true;
    setRosterPhotoStatus("사진을 지웠습니다. 사진은 기기 메모리에서만 쓰이고 어디에도 저장되지 않습니다.");
}
