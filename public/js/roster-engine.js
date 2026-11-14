/* ===========================================================================
   Roster engine
   ---------------------------------------------------------------------------
   Browser-only order-sheet workflow. This module owns roster state, OCR review,
   terminal matching and the adapters into the existing wage/work-log screens.
   It intentionally has no server endpoint for image data: selected images exist
   only as object URLs for the lifetime of the tab.
   =========================================================================== */

const ROSTER_SEED_ASSIGNMENTS = [
    { date: "2026-11-10", vessel: "CMA CGM AUSTRAL", time: "18:00", company: "세정", support: "BNCT 지원", group: "①", workers: ["김명준", "김민재2", "조훈철", "김근우1", "김경찬", "구자성", "사승동", "이재호"] },
    { date: "2026-11-10", vessel: "YM WAYFINDER", time: "20:00", company: "KML", support: "", group: "", workers: ["이성", "최준호", "신승호", "이재열", "이종림", "박세훈", "김광명", "김동근", "이준필", "양기택", "백상훈", "김치성", "김봉준", "박상준", "오경환", "곽민석", "임종호", "백승윤", "박규태", "정영중", "박창훈", "신철구", "황인기", "김영구", "김찬우1", "유동석", "김종성", "최영용", "최병섭", "김근우", "하승환", "윤동환", "김유신1", "윤승주", "설석종", "이준수", "이현재", "김찬구", "강성빈", "박성용"] },
    { date: "2026-11-11", vessel: "PRESIDENT CARTER", time: "00:00", company: "고려", support: "BNCT 지원", group: "②", workers: ["조훈철", "오규환", "신경호", "김근우1", "김경민1", "남영우", "김명준", "박상원", "이경덕", "김민재2", "이수남", "최승훈", "김경찬", "이정식", "이봉호", "구자성", "김영현", "이춘학", "사승동", "이수열", "안영준", "이재호", "박현대", "오용구"] },
    { date: "2026-11-11", vessel: "WILLIAM", time: "11:00", company: "코엠", support: "", group: "", workers: ["백상훈", "박상준", "곽민석", "박규태", "이성", "이재열", "박세훈", "이준필", "박창훈", "신철구", "유동석", "김종성", "여상규", "정철화", "김창홍", "이재원"] },
    { date: "2026-11-11", vessel: "CMA CGM PANAMA", time: "15:00", company: "세정", support: "BNCT 지원", group: "③", workers: ["이경덕", "김명준", "박상원", "최승훈", "김민재2", "이수남", "신경호", "김영수3", "오규환", "남영우", "김근우1", "김경민1", "이봉호", "김경찬", "이정식", "이춘학", "설석종", "김영현", "안영준", "구자성", "이수열", "오용구", "사승동", "박현대"] },
    { date: "2026-11-11", vessel: "MAGNA", time: "14:00", company: "고려", support: "", group: "④", workers: ["김치성", "김봉준", "임종호", "백승윤", "최준호", "신승호", "김광명", "김동근", "황인기", "김영구", "최영용", "최병섭", "김유신1", "윤승주", "김찬구", "강성빈"] },
    { date: "2026-11-11", vessel: "ULTIMA", time: "15:00", company: "조영", support: "", group: "①", workers: ["오경환", "원지현", "정영중", "강남오", "이종림", "장영근", "양기택", "강무성", "김찬우1", "여상규", "김근우", "김창홍", "설석종", "정철화", "박성용", "이재원"] }
];

const ROSTER_STORAGE = Object.freeze({
    manual: "busanPortRosterExtra",
    photo: "busanPortRosterPhoto",
    persist: "busanPortRosterPhotoPersist"
});
const ROSTER_OCR_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const ROSTER_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ROSTER_MAX_IMAGE_EDGE = 2000;
const ROSTER_FINDER_BETA_LOCK = true;
const ROSTER_COMPANIES = ["고려", "세정", "코엠", "조영", "한진", "동원", "국제", "북항", "허치슨", "KML", "KMT", "PNC", "HMM", "PNIT", "BPTC", "BNCT", "HJNC", "DGT", "HPNT", "HBCT", "BCT"];
// OCR 검토표는 보정·제외·안전 차단 없이 인식한 내용을 그대로 보여 줍니다.
// 날짜와 영문 선박명은 검토 행을 만들기 위한 최소 구조 정보로만 사용합니다.

const rosterRuntime = {
    hydrated: false,
    photoModeEngaged: false,
    persistPhotoText: false,
    photoAssignments: [],
    reviewRows: [],
    reviewWarnings: [],
    reviewVerifications: [],
    reviewVerificationState: "idle",
    reviewVerificationRequestId: 0,
    finderResults: [],
    activeImageUrl: "",
    cloudOcrEnabled: false,
    recognizedText: "",
    ocrAudit: null,
    tableOcrParsed: null,
    // 표 OCR에서 어떤 칸에도 안전하게 귀속할 수 없었던 한글 조각 수입니다. 원본 인원 대조에는 포함합니다.
    sourceUnassignedWorkerCount: 0,
    // 사진을 처음 읽었을 때 확정한 원본 작업자 총수입니다. 검토 행을 수정·삭제해도 기준은 바뀌지 않습니다.
    sourceWorkerCount: null,
    // 표의 실제 작업자 칸 수와 검토표 출력 인원을 대조한 최신 결과입니다.
    workerCountAudit: { hasSourceCount: false, sourceCount: 0, outputCount: 0, mismatches: [], isVerified: true },
    // 현재 사진에서 막 읽은 검토 행은 저장 버튼을 누르지 않아도 즉시 찾기에만 쓸 수 있습니다.
    // 사진을 지우거나 새 사진을 고르면 이 임시 검색 명단도 함께 바뀝니다.
    searchableReviewAssignments: [],
    requestId: 0
};

function rosterElement(id) {
    return document.getElementById(id);
}

function normalizeRosterWorkerName(value) {
    return String(value || "").normalize("NFKC").replace(/[\s\u200B]+/g, "").trim();
}

function normalizeRosterVesselKey(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/^\s*\[[^\]]+\]\s*/, "")
        .replace(/[\s\u200B]+/g, "")
        .trim()
        .toLocaleUpperCase("ko-KR");
}

function normalizeRosterAssignment(row, source) {
    const vessel = String(row?.vessel || "").trim();
    if (!vessel) return null;
    const workers = (Array.isArray(row?.workers) ? row.workers : [row?.worker])
        .map((name) => String(name || "").trim())
        .filter(Boolean);
    return {
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")) ? String(row.date) : "",
        vessel,
        time: String(row?.time || "").trim(),
        company: String(row?.company || "").trim(),
        support: String(row?.support || "").trim(),
        group: String(row?.group || "").trim(),
        workers,
        source: source || String(row?.source || "manual")
    };
}

function safelyReadRosterStorage(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function safelyWriteRosterStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        return false;
    }
}

function getRosterExtraEntries() {
    const value = safelyReadRosterStorage(ROSTER_STORAGE.manual, []);
    if (!Array.isArray(value)) return [];
    return value.map((row) => normalizeRosterAssignment(row, "manual"))
        .filter((row) => row && row.date && row.workers.length);
}

function saveRosterExtraEntries(rows) {
    return safelyWriteRosterStorage(ROSTER_STORAGE.manual, rows);
}

function getPhotoRosterEntries() {
    return [
        ...rosterRuntime.photoAssignments,
        ...rosterRuntime.searchableReviewAssignments
    ];
}

/**
 * 표 작업자 칸에서 읽은 최초 총인원과 현재 검토표의 출력 총인원을 비교합니다.
 * sourceWorkerCount가 없는 일반 OCR 텍스트는 기존처럼 사용하되, 표 OCR은 일치할 때만 자동 출력합니다.
 */
function auditRosterPhotoWorkerCounts(rows, unassignedWorkerCount = 0, expectedSourceCount = null) {
    const sourceRows = (rows || []).map((row, index) => ({
        index,
        expected: Number.isInteger(row?.sourceWorkerCount) && row.sourceWorkerCount >= 0
            ? row.sourceWorkerCount
            : null,
        actual: Array.isArray(row?.workers) ? row.workers.length : 0
    })).filter((row) => row.expected !== null);
    const unassigned = Math.max(0, Number(unassignedWorkerCount) || 0);
    const detectedSourceCount = sourceRows.reduce((sum, row) => sum + row.expected, 0) + unassigned;
    const hasFixedSourceCount = Number.isInteger(expectedSourceCount) && expectedSourceCount >= 0;
    const hasSourceCount = sourceRows.length > 0 || unassigned > 0 || hasFixedSourceCount;
    const sourceCount = hasFixedSourceCount ? expectedSourceCount : detectedSourceCount;
    // 검토표에 새로 보인 행까지 포함해야 실제 선박별 출력 총합과 비교할 수 있습니다.
    const outputCount = (rows || []).reduce((sum, row) => sum + (Array.isArray(row?.workers) ? row.workers.length : 0), 0);
    const mismatches = hasSourceCount && sourceCount !== outputCount
        ? [{ expected: sourceCount, actual: outputCount, reason: "source-output-total" }]
        : [];
    return {
        hasSourceCount,
        sourceCount,
        outputCount,
        checkedRowCount: sourceRows.length,
        unassignedWorkerCount: unassigned,
        mismatches,
        isVerified: mismatches.length === 0
    };
}

/** OCR 검토 행을 저장 절차와 별개로 현재 탭의 찾기에 바로 반영합니다. 인원 대조는 경고·검토 정보로만 유지합니다. */
function syncRosterPhotoSearchEntries() {
    const audit = auditRosterPhotoWorkerCounts(rosterRuntime.reviewRows, rosterRuntime.sourceUnassignedWorkerCount, rosterRuntime.sourceWorkerCount);
    rosterRuntime.workerCountAudit = audit;
    rosterRuntime.searchableReviewAssignments = rosterRuntime.reviewRows
        .map((row) => normalizeRosterAssignment(row, "photo"))
        .filter((row) => row && row.date && row.vessel);
    return getPhotoRosterEntries();
}

function isBuiltinPhotoRosterSuppressed() {
    return rosterRuntime.photoModeEngaged || rosterRuntime.photoAssignments.length > 0;
}

function getAllRosterAssignments() {
    const sources = [
        getPhotoRosterEntries(),
        getRosterExtraEntries(),
        ...(isBuiltinPhotoRosterSuppressed() ? [] : [ROSTER_SEED_ASSIGNMENTS])
    ];
    // 사진·직접 입력·시작용 명단에서 읽은 행을 원문 순서 그대로 사용합니다.
    // 같은 날짜·선박·이름이라도 자동으로 합치거나 제외하지 않습니다.
    return sources.flatMap((source) => source
        .map((raw) => normalizeRosterAssignment(raw, raw?.source))
        .filter(Boolean));
}

/**
 * 작업자 검색은 정확한 이름뿐 아니라 입력한 글자가 포함된 이름도 찾습니다.
 * 예: "김근우" → "김근우"와 "김근우1" 배정을 모두 반환합니다.
 */
function findRosterWorkerNamesInAssignment(row, query) {
    const key = normalizeRosterWorkerName(query);
    if (!key) return [];
    // 사진 검토표에서 선박명 아래에 나열한 이름은 해당 선박의 작업자입니다.
    // 원문 명단을 수정하거나 중복을 합치지 않고, 검색어와 맞는 이름만 결과 근거로 돌려줍니다.
    return (row?.workers || []).filter((worker) => normalizeRosterWorkerName(worker).includes(key));
}

function findRosterAssignmentsByWorker(query) {
    return getAllRosterAssignments().filter((row) => findRosterWorkerNamesInAssignment(row, query).length);
}

/** 사진·직접 명단에 적힌 회사·지원·조 표기도 원문 그대로 관련어 검색에 포함합니다. */
function findRosterRelatedTermsInAssignment(row, query) {
    const key = normalizeRosterWorkerName(query).toLocaleUpperCase("ko-KR");
    if (!key) return [];
    return [row?.company, row?.support, row?.group]
        .map((term) => String(term || "").trim())
        .filter(Boolean)
        .filter((term) => normalizeRosterWorkerName(term).toLocaleUpperCase("ko-KR").includes(key));
}

function findRosterAssignmentsByRelatedTerm(query) {
    return getAllRosterAssignments().filter((row) => findRosterRelatedTermsInAssignment(row, query).length);
}

function findRosterAssignmentsByVessel(query) {
    const key = normalizeRosterVesselKey(query);
    return key ? getAllRosterAssignments().filter((row) => {
        const vesselKey = normalizeRosterVesselKey(row.vessel);
        return vesselKey === key || vesselKey.includes(key) || key.includes(vesselKey);
    }) : [];
}

/** 작업자·관련어·선박명 검색 결과는 입력된 행을 그대로 보여 주며 자동으로 합치지 않습니다. */
function findAllRosterAssignments(query) {
    const workerMatches = findRosterAssignmentsByWorker(query);
    const relatedMatches = findRosterAssignmentsByRelatedTerm(query);
    const vesselMatches = findRosterAssignmentsByVessel(query);
    const modes = [
        workerMatches.length && "작업자",
        relatedMatches.length && "관련어",
        vesselMatches.length && "선박"
    ].filter(Boolean);
    return {
        assignments: [...workerMatches, ...relatedMatches, ...vesselMatches],
        mode: modes.join("·") || "검색"
    };
}

// 임금·근무일지의 다중 선박 입력에서 쓰는 공용 정리 도구입니다.
// 사진 OCR 검토·배치 행에는 적용하지 않습니다.
function dedupeVesselNameList(names) {
    const known = new Set();
    const unique = [];
    const duplicates = [];
    for (const name of names || []) {
        const clean = String(name || "").trim();
        const key = normalizeRosterVesselKey(clean);
        if (!key) continue;
        if (known.has(key)) duplicates.push(clean);
        else {
            known.add(key);
            unique.push(clean);
        }
    }
    return { unique, duplicates };
}

function findScheduleVessel(vessels, name) {
    if (!Array.isArray(vessels)) return null;
    const target = normalizeRosterVesselKey(name);
    if (!target) return null;
    const partial = vessels.find((vessel) => {
        const key = normalizeRosterVesselKey(vessel?.VSL_NM);
        return key && (key.includes(target) || target.includes(key));
    });
    return vessels.find((vessel) => normalizeRosterVesselKey(vessel?.VSL_NM) === target) || partial || null;
}

function matchScheduleVesselByName(vessels, vesselName) {
    return findScheduleVessel(vessels, vesselName);
}

function buildRosterVesselPlan(assignments, schedules) {
    const terminalEntries = Object.entries(schedules || {});
    return (assignments || []).map((assignment) => {
        const exact = terminalEntries.map(([terminalId, vessels]) => ({
            terminalId,
            vessel: (vessels || []).find((item) => normalizeRosterVesselKey(item?.VSL_NM) === normalizeRosterVesselKey(assignment?.vessel)) || null
        })).find(({ vessel }) => vessel);
        const partial = exact || terminalEntries.map(([terminalId, vessels]) => ({
            terminalId,
            vessel: findScheduleVessel(vessels, assignment?.vessel)
        })).find(({ vessel }) => vessel);
        return {
            assignment,
            terminalId: partial?.terminalId || "",
            vessel: partial?.vessel || null,
            found: Boolean(partial?.vessel)
        };
    });
}

function rosterScheduleDatePrefix(value) {
    const match = String(value || "").trim().match(/^(\d{4})[-./](\d{2})[-./](\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

/** 사진에 적힌 날짜가 입·출항/작업 기간에 포함되는지 확인합니다. */
function isRosterScheduleVesselActiveOnDate(vessel, date) {
    if (!vessel || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return false;
    const dates = ["ETB", "ATA", "ATW", "ATD", "ATC"].map((key) => rosterScheduleDatePrefix(vessel[key]));
    if (dates.includes(date)) return true;
    const start = rosterScheduleDatePrefix(vessel.ATA) || rosterScheduleDatePrefix(vessel.ETB) || rosterScheduleDatePrefix(vessel.ATW);
    const end = rosterScheduleDatePrefix(vessel.ATD) || rosterScheduleDatePrefix(vessel.ATC) || start;
    return Boolean(start && end && start <= date && date <= end);
}

function collectRosterScheduleEntries(schedules) {
    return Object.entries(schedules || {}).flatMap(([terminalId, vessels]) => (Array.isArray(vessels) ? vessels : [])
        .filter((vessel) => String(vessel?.VSL_NM || "").trim())
        .map((vessel) => ({ terminalId, vessel })));
}

/**
 * OCR 선박명을 해당 날짜의 전 터미널 입·출항 스케줄과 비교합니다.
 * 후보 판정 자체는 원문을 바꾸지 않으며, 단일 활성 후보는 이후 검토 흐름에서 스케줄명으로 확정합니다.
 */
function verifyRosterPhotoVesselName(row, schedules) {
    const literalName = String(row?.vessel || "").trim();
    const date = String(row?.date || "").trim();
    if (!literalName) return { status: "missing-name", matches: [] };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: "needs-date", literalName, matches: [] };

    const entries = collectRosterScheduleEntries(schedules);
    if (!entries.length) return { status: "schedule-unavailable", literalName, matches: [] };
    const target = normalizeRosterVesselKey(literalName);
    const activeEntries = entries.filter((entry) => isRosterScheduleVesselActiveOnDate(entry.vessel, date));
    const exactActive = activeEntries.filter((entry) => normalizeRosterVesselKey(entry.vessel.VSL_NM) === target);
    if (exactActive.length) return { status: "verified", literalName, matches: exactActive };

    const partialActive = activeEntries.filter((entry) => {
        const key = normalizeRosterVesselKey(entry.vessel.VSL_NM);
        return key && (key.includes(target) || target.includes(key));
    });
    if (partialActive.length === 1) return { status: "candidate", literalName, matches: partialActive };
    if (partialActive.length > 1) return { status: "ambiguous", literalName, matches: partialActive };

    const exactOtherDate = entries.filter((entry) => normalizeRosterVesselKey(entry.vessel.VSL_NM) === target);
    if (exactOtherDate.length) return { status: "date-mismatch", literalName, matches: exactOtherDate };
    return { status: "not-found", literalName, matches: [] };
}

function buildRosterPhotoVesselVerifications(rows, schedules) {
    return (rows || []).map((row) => verifyRosterPhotoVesselName(row, schedules));
}

/** 사용자가 명시적으로 선택한 스케줄 정식명만 OCR 행과 연결해 보존합니다. */
function markUserConfirmedRosterPhotoScheduleNames(rows, verifications) {
    let confirmed = 0;
    (rows || []).forEach((row, index) => {
        const check = verifications?.[index];
        const sourceName = String(row?.scheduleNameSource || "").trim();
        const officialName = String(check?.matches?.[0]?.vessel?.VSL_NM || "").trim();
        if (!sourceName || check?.status !== "verified" || !officialName
            || normalizeRosterVesselKey(row?.vessel) !== normalizeRosterVesselKey(officialName)) return;
        verifications[index] = {
            ...check,
            status: "user-confirmed",
            literalName: sourceName,
            officialName,
            userConfirmed: true
        };
        confirmed += 1;
    });
    return confirmed;
}

function applyRosterPhotoScheduleName(index) {
    const row = rosterRuntime.reviewRows[index];
    const check = rosterRuntime.reviewVerifications[index];
    const officialName = String(check?.status === "candidate" ? check.matches?.[0]?.vessel?.VSL_NM || "" : "").trim();
    const currentName = String(row?.vessel || "").trim();
    if (!row || !officialName || !currentName) return false;
    row.scheduleNameSource = row.scheduleNameSource || currentName;
    row.vessel = officialName;
    rosterRuntime.reviewVerifications[index] = {
        ...check,
        status: "user-confirmed",
        literalName: row.scheduleNameSource,
        officialName,
        userConfirmed: true
    };
    syncRosterPhotoSearchEntries();
    renderRosterPhotoRows();
    setRosterPhotoStatus(`✅ 사용자가 스케줄 선박명 “${officialName}”을(를) ${index + 1}번 행에 적용했습니다. OCR 원문은 보존했습니다.`);
    return true;
}

function isRosterFinderUnlocked() {
    return !ROSTER_FINDER_BETA_LOCK || readSessionValue(ROSTER_FINDER_UNLOCK_KEY) === "1";
}

function hydrateRosterFromDevice() {
    if (rosterRuntime.hydrated) return;
    rosterRuntime.hydrated = true;
    try {
        rosterRuntime.persistPhotoText = localStorage.getItem(ROSTER_STORAGE.persist) === "1";
        const stored = rosterRuntime.persistPhotoText ? safelyReadRosterStorage(ROSTER_STORAGE.photo, []) : [];
        rosterRuntime.photoAssignments = Array.isArray(stored)
            ? mergeRosterPhotoEntries(stored).filter((row) => row.date && row.vessel)
            : [];
    } catch (error) {
        rosterRuntime.photoAssignments = [];
        rosterRuntime.persistPhotoText = false;
    }
}

function syncRosterFinderLockUI() {
    hydrateRosterFromDevice();
    const enabled = isRosterFinderUnlocked();
    rosterElement("rosterFinderLockBanner")?.classList.toggle("hidden", enabled);
    rosterElement("rosterFinderPanel")?.classList.toggle("hidden", !enabled);
    if (enabled) renderRosterPhotoSaved();
    return enabled;
}

function unlockRosterFinder() {
    if (syncRosterFinderLockUI()) {
        rosterElement("rosterFinderInput")?.focus();
        return;
    }
    openWorkLogPinModal(() => {
        writeSessionValue(ROSTER_FINDER_UNLOCK_KEY, "1");
        syncRosterFinderLockUI();
        showToast("🔓 근무배치 명단을 사용할 수 있습니다.");
        const input = rosterElement("rosterFinderInput");
        input?.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => input?.focus(), 120);
    });
}

function setRosterDeckExpanded(expanded) {
    const card = rosterElement("rosterDeckCard");
    if (!card) return;
    const isExpanded = Boolean(expanded);
    card.classList.toggle("expanded", isExpanded);
    const content = card.querySelector(".dash-content");
    if (content) content.style.display = isExpanded ? "block" : "none";
    rosterElement("rosterDeckHeader")?.setAttribute("aria-expanded", String(isExpanded));
    if (isExpanded) {
        syncRosterFinderLockUI();
        renderRosterExtraList();
        trackAppEvent?.("blocks", "rosterDeckCard");
    }
}

function syncRosterDeckAria() {
    const card = rosterElement("rosterDeckCard");
    rosterElement("rosterDeckHeader")?.setAttribute("aria-expanded", String(Boolean(card?.classList.contains("expanded"))));
}

function openRosterDeck(skipScroll) {
    setRosterDeckExpanded(true);
    if (!skipScroll) setTimeout(() => rosterElement("rosterDeckCard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}

function toggleRosterDeck() {
    const card = rosterElement("rosterDeckCard");
    if (!card) return;
    if (card.classList.contains("expanded")) return setRosterDeckExpanded(false);
    document.querySelectorAll(".dash-card.expanded").forEach((other) => {
        if (other.id === "rosterDeckCard") return;
        other.classList.remove("expanded");
        const content = other.querySelector(".dash-content");
        if (content) content.style.display = "none";
    });
    setRosterDeckExpanded(true);
}

function focusRosterFinder() {
    openRosterDeck();
    if (!isRosterFinderUnlocked()) return unlockRosterFinder();
    const input = rosterElement("rosterFinderInput");
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => input?.focus(), 280);
}

async function collectRosterSchedules(assignments) {
    const months = [...new Set(assignments.map((assignment) => assignment.date.slice(0, 7)).filter(Boolean))];
    const terminalIds = TERMINAL_SCHEDULE_LIST.filter((terminal) => terminal.live).map((terminal) => terminal.id);
    const result = Object.fromEntries(terminalIds.map((id) => [id, []]));
    await Promise.all(terminalIds.flatMap((terminalId) => months.map(async (month) => {
        try {
            const rows = await fetchHjncScheduleForMonth(month, false, terminalId);
            if (Array.isArray(rows)) result[terminalId].push(...rows);
        } catch (error) {
            console.warn("[roster] schedule unavailable", terminalId, month, error);
        }
    })));
    return result;
}

function describeNoRosterMatch(query) {
    const hint = isBuiltinPhotoRosterSuppressed()
        ? " 내 사진 명단을 쓰는 중이라 시작용 명단은 제외됩니다. 검토 표를 수정하거나 ‘내 명단 추가’로 배정을 넣어 주세요."
        : " 이름·관련 단어 또는 선박명을 확인하거나 ‘내 명단 추가’로 배정을 넣어 주세요.";
    return `<div class="roster-finder-empty">🔍 '${escapeShipCommentHtml(query)}' 명단에서 찾지 못했습니다.${hint}</div>`;
}

async function searchRosterVessels() {
    if (!isRosterFinderUnlocked()) return unlockRosterFinder();
    const query = String(rosterElement("rosterFinderInput")?.value || "").trim();
    const output = rosterElement("rosterFinderResults");
    if (!query) return showToast("작업자 이름·관련 단어 또는 선박명을 입력해 주세요.");
    if (!output) return;

    // 한 검색어가 작업자와 선박명 양쪽에 걸려도 어느 한쪽을 버리지 않습니다.
    // 따라서 이름이 들어간 모든 배정 선박을 결과 카드에 보여 줍니다.
    const match = findAllRosterAssignments(query);
    const { assignments, mode } = match;
    if (!assignments.length) {
        rosterRuntime.finderResults = [];
        output.innerHTML = describeNoRosterMatch(query);
        return;
    }

    const requestId = ++rosterRuntime.requestId;
    output.innerHTML = `<div class="roster-finder-empty">⏳ ${assignments.length}척 배정 확인 · 전 터미널 스케줄을 확인하는 중...</div>`;
    const schedules = await collectRosterSchedules(assignments);
    if (requestId !== rosterRuntime.requestId) return;
    rosterRuntime.finderResults = buildRosterVesselPlan(assignments, schedules);
    renderRosterFinderResults(rosterRuntime.finderResults, query, mode);
    trackAppEvent?.("actions", "roster_finder_search");
}

function rosterResultScheduleDescription(item) {
    if (!item.found || !item.vessel) return "⚠️ 차트·스케줄에서 찾지 못함 — 명단 선박명으로만 등록됩니다";
    const period = getSelectedVesselPeriod(item.vessel, item.assignment.date);
    const berth = escapeShipCommentHtml(item.vessel.BERTH_NO || "-");
    const duration = period.hours > 0 ? ` · ${period.hours}시간 자동 계산 가능` : " · 입·출항 시각 확인 필요";
    return `선석 ${berth} · 입항 ${formatWageScheduleEvent(period.arrival)} · 출항 ${formatWageScheduleEvent(period.departure)}${duration}`;
}

/** 찾기 결과에는 해당 선박의 전체 명단이 아니라 검색어와 맞은 작업자만 표시합니다. */
function rosterResultWorkerDescription(assignment, query) {
    const matchedWorkers = findRosterWorkerNamesInAssignment(assignment, query);
    if (!matchedWorkers.length) return "";
    const names = matchedWorkers.map((name) => escapeShipCommentHtml(name)).join(", ");
    return `<div class="roster-finder-worker-match"><strong>👷 찾은 작업자: ${names}</strong></div>`;
}

/** 회사·지원·조 중 검색어와 맞은 원문 표기만 찾기 결과에 남깁니다. */
function rosterResultRelatedDescription(assignment, query) {
    const terms = findRosterRelatedTermsInAssignment(assignment, query);
    if (!terms.length) return "";
    return `<div class="roster-finder-worker-match"><strong>🏷️ 찾은 관련어: ${terms.map(escapeShipCommentHtml).join(", ")}</strong></div>`;
}

/** 찾기 카드의 배정 정보는 선박 식별에 필요한 날짜·시간만 표시합니다. */
function rosterResultAssignmentSummary(assignment) {
    return [assignment?.date, assignment?.time && `명단 ${assignment.time}`]
        .filter(Boolean)
        .map((value) => escapeShipCommentHtml(value))
        .join(" · ");
}

function renderRosterFinderResults(plan, query, mode) {
    const output = rosterElement("rosterFinderResults");
    if (!output) return;
    const foundCount = plan.filter((item) => item.found).length;
    const cards = plan.map((item, index) => {
        const assignment = item.assignment;
        const meta = item.terminalId ? getTerminalMeta(item.terminalId) : null;
        const terminal = item.terminalId ? terminalQuickConfig[item.terminalId] || {} : {};
        const badge = meta ? `<span class="roster-finder-badge" style="background:${meta.color};">${meta.badge}</span>` : "";
        const links = item.terminalId
            ? `<a href="${terminal.schedule || "#"}" target="_blank" rel="noopener noreferrer" class="roster-finder-link">🗓️ 스케줄 ↗</a><a href="${terminal.chart || "#"}" target="_blank" rel="noopener noreferrer" class="roster-finder-link">📊 차트 ↗</a>`
            : "";
        const assignmentSummary = rosterResultAssignmentSummary(assignment);
        return `<div class="roster-finder-card${item.found ? "" : " is-missing"}">
            <div class="roster-finder-card-head">${badge}<strong>🚢 ${escapeShipCommentHtml(assignment.vessel)}</strong><span>${assignmentSummary}</span></div>
            ${rosterResultWorkerDescription(assignment, query)}
            ${rosterResultRelatedDescription(assignment, query)}
            <div class="roster-finder-card-sub">${rosterResultScheduleDescription(item)}</div>
            <div class="roster-finder-card-actions">
                <button type="button" onclick="registerRosterResultToWage(${index})">🧮 임금계산기 등록</button>
                <button type="button" onclick="registerRosterResultToWorkLog(${index})">📅 근무일지 등록</button>
                ${links}
            </div>
        </div>`;
    }).join("");
    const action = plan.length > 1
        ? `<button type="button" class="roster-finder-all-btn" onclick="registerAllRosterResults()">✨ 전체 자동 등록 (임금계산기 + 근무일지${foundCount ? " · 임금 자동 계산" : ""})</button>`
        : "";
    output.innerHTML = `<div class="roster-finder-summary">🔍 '${escapeShipCommentHtml(query)}' (${mode}) · ${plan.length}행 · 스케줄 매칭 ${foundCount}행</div>${cards}${action}`;
}

function ensureDashboardCardOpen(id) {
    const card = rosterElement(id);
    if (card && !card.classList.contains("expanded")) toggleDashItem(id);
    return card;
}

function registerRosterResultToWage(index) {
    const item = rosterRuntime.finderResults[index];
    if (!item) return;
    ensureDashboardCardOpen("wage-card");
    const vesselName = item.assignment.vessel;
    if (item.found) {
        if (item.terminalId && item.terminalId !== selectedScheduleTerminal) selectScheduleTerminal(item.terminalId);
        // 임금계산기 선택 함수는 같은 선박을 두 번 받으면 선택 해제로 동작합니다.
        // OCR 행은 그대로 남기되, 이 화면의 선택 상태만 반전되지 않도록 한 번만 전달합니다.
        const alreadySelected = selectedWageVessels.some((selected) => normalizeWorklogShipKey(selected.name) === normalizeWorklogShipKey(vesselName));
        if (!alreadySelected) applyWageScheduleShip(item.vessel, item.assignment.date, item.terminalId || selectedScheduleTerminal);
    } else {
        const input = rosterElement("wageShipName");
        if (input) {
            input.value = [...parseWorklogShipNames(input.value), vesselName].slice(0, MAX_WORK_VESSELS).join(" / ");
            onWageShipNameChange(input.value);
        }
        showToast(`🧮 ${vesselName}을(를) 임금계산기에 입력했습니다. 시간은 직접 확인해 주세요.`);
    }
    rosterElement("wage-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function attachRosterResultToOpenLog(item) {
    const input = rosterElement("logShipName");
    if (!input) return false;
    const vesselName = item.assignment.vessel;
    // 근무배치 원문은 유지하되, 현재 선택한 날짜의 근무일지에는 같은 선박을 한 번만 넣습니다.
    const existing = typeof dedupeWorklogShipNames === "function"
        ? dedupeWorklogShipNames(parseWorklogShipNames(input.value))
        : dedupeVesselNameList(parseWorklogShipNames(input.value));
    const vesselKey = typeof normalizeWorklogShipKey === "function"
        ? normalizeWorklogShipKey(vesselName)
        : normalizeRosterVesselKey(vesselName);
    input.value = existing.unique.join(" / ");
    if (existing.unique.some((name) => (typeof normalizeWorklogShipKey === "function"
        ? normalizeWorklogShipKey(name)
        : normalizeRosterVesselKey(name)) === vesselKey)) {
        const date = typeof getActiveWorkLogDate === "function" ? getActiveWorkLogDate() : "";
        if (typeof showToast === "function") showToast(`⚠️ ${date || "선택한 날짜"} 근무일지에 ${vesselName}은(는) 이미 입력되어 있어 중복 등록하지 않았습니다.`);
        syncWorklogDoubleOrderMemo();
        refreshWorklogVesselList();
        updateWorklogDoubleOrderStatus();
        return false;
    }
    if (existing.unique.length >= MAX_WORK_VESSELS) {
        if (typeof showToast === "function") showToast(`⚠️ 근무일지에는 선박 ${MAX_WORK_VESSELS}척까지만 입력할 수 있습니다.`);
        return false;
    }
    input.value = [...existing.unique, vesselName].join(" / ");
    if (item.found) {
        worklogVesselMeta.set(vesselKey, {
            name: vesselName,
            vessel: item.vessel,
            date: item.assignment.date,
            terminalId: item.terminalId
        });
    }
    syncWorklogDoubleOrderMemo();
    refreshWorklogVesselList();
    updateWorklogDoubleOrderStatus();
    return true;
}

function registerRosterResultToWorkLog(index) {
    const item = rosterRuntime.finderResults[index];
    if (!item) return;
    ensureDashboardCardOpen("log-card");
    jumpToLogDate(item.assignment.date);
    if (attachRosterResultToOpenLog(item)) {
        showToast(`📅 ${item.assignment.date} 근무일지에 ${item.assignment.vessel}을(를) 넣었습니다. 저장을 눌러 기록하세요.`);
    }
    rosterElement("dailyLogForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function registerAllRosterResults() {
    const plan = rosterRuntime.finderResults.slice().sort((a, b) => a.assignment.date.localeCompare(b.assignment.date));
    if (!plan.length) return;

    ensureDashboardCardOpen("wage-card");
    const existingWageNames = new Set(selectedWageVessels.map((selected) => normalizeWorklogShipKey(selected.name)));
    const scheduleMatches = plan.filter((item) => {
        if (!item.found) return false;
        const key = normalizeWorklogShipKey(item.assignment.vessel);
        if (existingWageNames.has(key)) return false;
        existingWageNames.add(key);
        return true;
    }).slice(0, Math.max(0, MAX_WORK_VESSELS - selectedWageVessels.length));
    if (scheduleMatches.length) {
        const terminalId = scheduleMatches[0].terminalId;
        if (terminalId && terminalId !== selectedScheduleTerminal) selectScheduleTerminal(terminalId);
        scheduleMatches.forEach((item) => applyWageScheduleShip(item.vessel, item.assignment.date, item.terminalId || selectedScheduleTerminal));
    } else {
        const input = rosterElement("wageShipName");
        if (input) {
            input.value = [...parseWorklogShipNames(input.value), ...plan.map((item) => item.assignment.vessel)].slice(0, MAX_WORK_VESSELS).join(" / ");
            onWageShipNameChange(input.value);
        }
    }

    ensureDashboardCardOpen("log-card");
    const added = [];
    let duplicateOrFullCount = 0;
    const byDate = new Map();
    plan.forEach((item) => {
        const rows = byDate.get(item.assignment.date) || [];
        rows.push(item);
        byDate.set(item.assignment.date, rows);
    });
    for (const [date, rows] of byDate) {
        jumpToLogDate(date);
        const input = rosterElement("logShipName");
        if (!input) continue;
        for (const item of rows) {
            if (attachRosterResultToOpenLog(item)) added.push(item.assignment.vessel);
            else duplicateOrFullCount += 1;
        }
    }

    if (!added.length) {
        showToast(duplicateOrFullCount
            ? "⚠️ 같은 날짜에 이미 입력된 선박 또는 최대 선박 수에 도달한 선박은 근무일지에 중복 등록하지 않았습니다."
            : "⚠️ 근무일지에 등록할 선박을 찾지 못했습니다.");
        return;
    }
    const selectedHaveHours = selectedWageVessels.length > 0 && selectedWageVessels.every((selected) => getSelectedVesselPeriod(selected.vessel, selected.date).hours > 0);
    if (selectedHaveHours) {
        try {
            calculateWage();
            if (lastCalculatedWageData) await sendCalculatedWageToLog();
        } catch (error) {
            console.error("[roster] automatic wage transfer failed", error);
        }
    }
    const names = added.join(" / ");
    const duplicateNotice = duplicateOrFullCount ? ` (중복·최대 초과 ${duplicateOrFullCount}척 제외)` : "";
    showToast(selectedHaveHours
        ? `✨ ${names}을(를) 임금계산기·근무일지에 등록하고 임금을 계산했습니다. 근무일지를 저장해 주세요.${duplicateNotice}`
        : `✨ ${names}을(를) 임금계산기·근무일지에 등록했습니다. 시간은 확인 후 계산해 주세요.${duplicateNotice}`);
    trackAppEvent?.("actions", "roster_finder_register_all");
}

function addRosterExtraEntry() {
    const worker = String(rosterElement("rosterExtraWorker")?.value || "").trim();
    const vessel = String(rosterElement("rosterExtraVessel")?.value || "").trim();
    const date = String(rosterElement("rosterExtraDate")?.value || "").trim();
    if (!worker || !vessel || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        showToast("작업자 이름·선박명·날짜를 모두 입력해 주세요.");
        return;
    }
    const entry = normalizeRosterAssignment({ date, vessel, workers: [worker] }, "manual");
    if (!entry) return showToast("⚠️ 유효한 작업자 이름과 선박명을 입력해 주세요.");
    const entries = getRosterExtraEntries();
    // 검토자가 입력한 행은 같은 날짜·선박·이름이어도 그대로 남깁니다.
    entries.push(entry);
    if (!saveRosterExtraEntries(entries)) return showToast("⚠️ 이 기기에 명단을 저장하지 못했습니다.");
    ["rosterExtraWorker", "rosterExtraVessel", "rosterExtraDate"].forEach((id) => { const input = rosterElement(id); if (input) input.value = ""; });
    renderRosterExtraList();
    showToast(`➕ ${worker} · ${vessel} (${date}) 배정을 추가했습니다.`);
}

function deleteRosterExtraEntry(index) {
    const entries = getRosterExtraEntries();
    if (!entries[index]) return;
    entries.splice(index, 1);
    if (!saveRosterExtraEntries(entries)) return showToast("⚠️ 명단을 삭제하지 못했습니다.");
    renderRosterExtraList();
    showToast("🗑️ 직접 추가한 배정을 삭제했습니다.");
}

function renderRosterExtraList() {
    const container = rosterElement("rosterExtraList");
    if (!container) return;
    const entries = getRosterExtraEntries();
    container.innerHTML = entries.length
        ? entries.map((entry, index) => `<div class="roster-finder-extra-item"><span>${escapeShipCommentHtml(entry.date)} · ${escapeShipCommentHtml(entry.vessel)} · ${escapeShipCommentHtml(entry.workers.join(", "))}</span><button type="button" onclick="deleteRosterExtraEntry(${index})">삭제</button></div>`).join("")
        : `<div class="roster-finder-empty">직접 추가한 명단이 없습니다. 시작용 명단은 사진 명단을 사용하기 전까지만 검색됩니다.</div>`;
}

function cleanOcrText(raw) {
    return String(raw || "")
        .replace(/[①-⑨]/g, (mark) => ` (${mark.charCodeAt(0) - 0x2460 + 1}) `)
        .normalize("NFKC")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/[|│┃┆┊¦]/g, " ")
        .replace(/[：]/g, ":")
        .replace(/[·•‧]/g, " ")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ");
}

/** OCR 엔진의 원문을 줄바꿈 그대로 보존하고, 원문이 비었을 때만 좌표로 줄을 재구성합니다. */
function buildRosterOcrTextFromWords(words) {
    const items = (Array.isArray(words) ? words : []).map((word) => {
        const box = word?.bbox || word?.boundingBox || word?.box || {};
        const x0 = Number(box.x0 ?? box.left ?? 0);
        const y0 = Number(box.y0 ?? box.top ?? 0);
        const x1 = Number(box.x1 ?? box.right ?? 0);
        const y1 = Number(box.y1 ?? box.bottom ?? 0);
        return { text: String(word?.text || "").trim(), x0, y0, x1, y1, y: (y0 + y1) / 2, height: y1 - y0 };
    }).filter((item) => item.text);
    if (!items.length) return "";
    if (items.some((item) => item.x1 <= item.x0 || item.y1 <= item.y0)) {
        return items.map((item) => item.text).join(" ");
    }
    items.sort((a, b) => a.y - b.y || a.x0 - b.x0);
    const lines = [];
    items.forEach((item) => {
        const tolerance = Math.max(3, Math.min(24, item.height * 0.65));
        let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(tolerance, candidate.tolerance));
        if (!line) {
            line = { y: item.y, tolerance, items: [] };
            lines.push(line);
        }
        line.items.push(item);
        line.y = line.items.reduce((sum, entry) => sum + entry.y, 0) / line.items.length;
        line.tolerance = Math.max(line.tolerance, tolerance);
    });
    return lines.sort((a, b) => a.y - b.y)
        .map((line) => line.items.sort((a, b) => a.x0 - b.x0).map((item) => item.text).join(" "))
        .join("\n");
}

function countRosterOcrLines(text) {
    return String(text || "").replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim()).length;
}

function toRosterDate(year, month, day) {
    const numbers = [Number(year), Number(month), Number(day)];
    if (numbers[0] < 2000 || numbers[0] > 2100 || numbers[1] < 1 || numbers[1] > 12 || numbers[2] < 1 || numbers[2] > 31) return "";
    return `${numbers[0]}-${String(numbers[1]).padStart(2, "0")}-${String(numbers[2]).padStart(2, "0")}`;
}

function readDateFromOcrLine(line, fallbackYear) {
    const full = String(line).match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/);
    if (full) return toRosterDate(full[1], full[2], full[3]);
    const short = String(line).match(/(?:^|[^\d:])(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?(?![\d:])/);
    return short ? toRosterDate(fallbackYear, short[1], short[2]) : "";
}

function readTimeFromOcrLine(line) {
    const match = String(line).match(/(\d{1,2})\s*:\s*(\d{2})/) || String(line).match(/(\d{1,2})\s*시(?!\s*간)/);
    if (!match) return "";
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : "";
}

function pickVesselFromOcrLine(line) {
    const candidates = String(line).match(/[A-Za-z][A-Za-z0-9&'.-]*(?:\s+[A-Za-z][A-Za-z0-9&'.-]*)*/g) || [];
    return candidates.reduce((winner, candidate) => {
        const name = candidate.trim().toUpperCase();
        // 세로로 분리 인식된 글자(예: P / R / E)나 표 선의 영문 노이즈를 선박 행으로 만들지 않습니다.
        if ((name.match(/[A-Z]/g) || []).length < 3) return winner;
        return name.length > winner.length ? name : winner;
    }, "");
}

function pickCompanyFromOcrLine(line) {
    const upper = String(line).toUpperCase();
    return ROSTER_COMPANIES.find((company) => upper.includes(company.toUpperCase())) || "";
}

function pickSupportFromOcrLine(line) {
    const match = String(line).match(/([A-Za-z]{3,6}|[가-힣]{2,6})\s*지원/);
    return match ? `${match[1].toUpperCase()} 지원` : (/지원/.test(String(line)) ? "지원" : "");
}

function pickGroupFromOcrLine(line) {
    const joined = String(line).match(/\(([1-9])\)/);
    if (joined) return joined[1];
    const group = String(line).match(/(\d{1,2})\s*조(?![가-힣])/);
    return group ? `${group[1]}조` : "";
}

/**
 * 자동 보정·제외 규칙을 비운 기본 OCR 모드입니다.
 * 한글 덩어리는 이름인지 제목·회사·메타데이터인지 판단하지 않고, 인식한 순서 그대로 검토표에 넣습니다.
 */
function pickWorkersFromOcrLine(line) {
    return String(line || "").normalize("NFKC").match(/[가-힣]+(?:\d+)?/g) || [];
}

function mergeWorkers(existing, incoming) {
    return [...(existing || []), ...(incoming || [])]
        .map((name) => String(name || "").trim())
        .filter(Boolean);
}

function parseRosterPhotoText(rawText, options) {
    const settings = options || {};
    const fallbackYear = Number(settings.defaultYear) || new Date().getFullYear();
    const suppliedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(settings.defaultDate || "")) ? String(settings.defaultDate) : "";
    const lines = cleanOcrText(rawText).split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return { entries: [], warnings: ["글자가 없습니다. 사진을 다시 고르거나 직접 입력해 주세요."] };

    const result = { date: suppliedDate, current: null, entries: [] };
    lines.forEach((line) => {
        const date = readDateFromOcrLine(line, fallbackYear);
        if (date) result.date = date;
        const workers = pickWorkersFromOcrLine(line);
        const vessel = pickVesselFromOcrLine(line);
        if (!vessel) {
            // 읽지 못한 머리말도 추정하거나 차단하지 않습니다. 다음 한글 덩어리는 현재 검토 행에 그대로 붙습니다.
            if (result.current) result.current.workers = mergeWorkers(result.current.workers, workers);
            return;
        }
        const row = {
            date: result.date,
            vessel,
            time: readTimeFromOcrLine(line),
            company: pickCompanyFromOcrLine(line),
            support: pickSupportFromOcrLine(line),
            group: pickGroupFromOcrLine(line),
            workers,
            sourceOcrLine: line,
            sourceOcrVessel: vessel,
            source: "photo"
        };
        // 날짜·선박이 같아도 OCR이 만든 행을 합치지 않고 검토표에 모두 남깁니다.
        result.entries.push(row);
        result.current = row;
    });

    const warnings = [];
    if (!result.entries.length) warnings.push("선박명을 찾지 못했습니다. 선박명은 영문(예: PRESIDENT CARTER)으로 적어 주세요.");
    const missingDates = result.entries.filter((row) => !row.date).length;
    const missingWorkers = result.entries.filter((row) => !row.workers.length).length;
    if (missingDates) warnings.push(`${missingDates}척은 날짜를 찾지 못했습니다. 검토 표에서 날짜를 채워 주세요.`);
    if (missingWorkers) warnings.push(`${missingWorkers}척은 한글 덩어리를 찾지 못했습니다. 사진을 보며 직접 입력해 주세요.`);
    warnings.push("자동 보정·제외·중복 처리 없이 인식한 내용을 그대로 표시했습니다. 적용 전 검토표를 확인해 주세요.");
    return { entries: result.entries, warnings };
}

function mergeRosterPhotoEntries(rows) {
    // 누적 사진 명단도 같은 날짜·선박·작업자를 자동으로 합치지 않습니다.
    return (rows || [])
        .map((raw) => normalizeRosterAssignment(raw, "photo"))
        .filter(Boolean);
}

function replaceRosterPhotoEntries(rows) {
    rosterRuntime.photoAssignments = mergeRosterPhotoEntries(rows);
    return getPhotoRosterEntries();
}

/**
 * 여러 장의 오더 사진을 차례로 읽어도 앞 사진의 다른 선박을 지우지 않습니다.
 * 같은 날짜·선박은 최신 정보에 작업자 명단을 합쳐 갱신합니다.
 */
function appendRosterPhotoEntries(rows) {
    rosterRuntime.photoAssignments = mergeRosterPhotoEntries([
        ...rosterRuntime.photoAssignments,
        ...(rows || [])
    ]);
    return getPhotoRosterEntries();
}

function savePhotoRosterToDevice() {
    if (!safelyWriteRosterStorage(ROSTER_STORAGE.photo, rosterRuntime.photoAssignments)) return false;
    try { localStorage.setItem(ROSTER_STORAGE.persist, "1"); } catch (error) { return false; }
    rosterRuntime.persistPhotoText = true;
    return true;
}

function clearPhotoRosterFromDevice() {
    try {
        localStorage.removeItem(ROSTER_STORAGE.photo);
        localStorage.removeItem(ROSTER_STORAGE.persist);
    } catch (error) { /* local storage may be unavailable */ }
    rosterRuntime.photoAssignments = [];
    rosterRuntime.persistPhotoText = false;
}

function setRosterPhotoStatus(message) {
    const status = rosterElement("rosterPhotoStatus");
    if (status) status.textContent = String(message || "");
}

async function refreshRosterCloudOcrButton() {
    const button = rosterElement("rosterPhotoCloudOcrBtn");
    if (!button) return false;
    button.classList.add("hidden");
    button.disabled = true;
    rosterRuntime.cloudOcrEnabled = false;
    try {
        const response = await fetch("/api/roster-ocr/config", { cache: "no-store" });
        const config = response.ok ? await response.json() : null;
        rosterRuntime.cloudOcrEnabled = Boolean(config?.enabled);
        button.classList.toggle("hidden", !rosterRuntime.cloudOcrEnabled);
        button.disabled = !rosterRuntime.cloudOcrEnabled || !rosterRuntime.activeImageUrl;
        return rosterRuntime.cloudOcrEnabled;
    } catch (error) {
        return false;
    }
}

function setRosterPhotoBusy(isBusy, message) {
    ["rosterPhotoOcrBtn", "rosterPhotoCloudOcrBtn", "rosterPhotoClearBtn", "rosterFinderResetBtn"].forEach((id) => {
        const button = rosterElement(id);
        if (!button) return;
        button.disabled = Boolean(isBusy) || (id === "rosterPhotoCloudOcrBtn" && (!rosterRuntime.cloudOcrEnabled || !rosterRuntime.activeImageUrl));
    });
    ["rosterPhotoUploadLabel", "rosterPhotoGalleryLabel"].forEach((id) => rosterElement(id)?.classList.toggle("is-busy", Boolean(isBusy)));
    if (message) setRosterPhotoStatus(message);
}

function releaseRosterPhotoObjectUrl() {
    if (rosterRuntime.activeImageUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(rosterRuntime.activeImageUrl);
    }
    rosterRuntime.activeImageUrl = "";
}

function handleRosterPhotoSelected(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) return showToast("⚠️ 사진 파일만 선택할 수 있습니다.");
    if (file.size > ROSTER_MAX_IMAGE_BYTES) return showToast("⚠️ 사진은 15MB 이하만 사용할 수 있습니다.");

    rosterRuntime.photoModeEngaged = true;
    releaseRosterPhotoObjectUrl();
    rosterRuntime.activeImageUrl = URL.createObjectURL(file);
    rosterRuntime.cloudOcrEnabled = false;
    const cloudOcrButton = rosterElement("rosterPhotoCloudOcrBtn");
    if (cloudOcrButton) { cloudOcrButton.classList.add("hidden"); cloudOcrButton.disabled = true; }
    rosterRuntime.recognizedText = "";
    rosterRuntime.ocrAudit = null;
    rosterRuntime.tableOcrParsed = null;
    rosterRuntime.sourceUnassignedWorkerCount = 0;
    rosterRuntime.sourceWorkerCount = null;
    rosterRuntime.workerCountAudit = { hasSourceCount: false, sourceCount: 0, outputCount: 0, mismatches: [], isVerified: true };
    rosterRuntime.reviewRows = [];
    rosterRuntime.reviewWarnings = [];
    rosterRuntime.reviewVerifications = [];
    rosterRuntime.reviewVerificationState = "idle";
    rosterRuntime.reviewVerificationRequestId += 1;
    rosterRuntime.searchableReviewAssignments = [];
    const preview = rosterElement("rosterPhotoPreview");
    if (preview) preview.src = rosterRuntime.activeImageUrl;
    rosterElement("rosterPhotoPreviewWrap")?.classList.remove("hidden");
    rosterElement("rosterPhotoTextDetails")?.classList.add("hidden");
    const text = rosterElement("rosterPhotoText");
    if (text) text.value = "";
    const rows = rosterElement("rosterPhotoRows");
    if (rows) rows.innerHTML = "";
    const readButton = rosterElement("rosterPhotoOcrBtn");
    const clearButton = rosterElement("rosterPhotoClearBtn");
    if (readButton) readButton.disabled = false;
    if (clearButton) clearButton.disabled = false;
    if (input) input.value = "";
    setRosterPhotoStatus("📷 사진을 이 기기에서만 열었습니다. 자동으로 사진에서 명단을 읽는 중입니다…");
    trackAppEvent?.("actions", "roster_photo_selected");
    // 사진을 고르는 즉시 OCR을 시작하되, 같은 버튼으로 필요 시 다시 읽을 수 있게 둡니다.
    void runRosterPhotoOcr();
}

function openRosterPhotoPicker() {
    if (!isRosterFinderUnlocked()) return unlockRosterFinder();
    rosterElement("rosterPhotoInput")?.click();
}

function openRosterGalleryPicker() {
    if (!isRosterFinderUnlocked()) return unlockRosterFinder();
    rosterElement("rosterPhotoGalleryInput")?.click();
}

function rosterOcrLuminance(red, green, blue) {
    return Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
}

function rosterOcrHistogram(data) {
    const histogram = new Array(256).fill(0);
    for (let index = 0; index < data.length; index += 4) {
        histogram[rosterOcrLuminance(data[index], data[index + 1], data[index + 2])] += 1;
    }
    return histogram;
}

function rosterOcrPercentile(histogram, pixelCount, ratio) {
    const target = Math.max(1, Math.ceil(pixelCount * ratio));
    let seen = 0;
    for (let value = 0; value < histogram.length; value += 1) {
        seen += histogram[value];
        if (seen >= target) return value;
    }
    return 255;
}

function rosterOcrValueRange(histogram) {
    const darkest = histogram.findIndex((count) => count > 0);
    const brightest = histogram.length - 1 - [...histogram].reverse().findIndex((count) => count > 0);
    return [darkest < 0 ? 0 : darkest, brightest < 0 ? 255 : brightest];
}

function rosterOcrThreshold(histogram, pixelCount) {
    let weightedTotal = 0;
    for (let value = 0; value < histogram.length; value += 1) weightedTotal += value * histogram[value];
    let backgroundCount = 0;
    let backgroundTotal = 0;
    let bestThreshold = 128;
    let bestVariance = -1;
    for (let value = 0; value < histogram.length; value += 1) {
        backgroundCount += histogram[value];
        if (!backgroundCount) continue;
        const foregroundCount = pixelCount - backgroundCount;
        if (!foregroundCount) break;
        backgroundTotal += value * histogram[value];
        const backgroundMean = backgroundTotal / backgroundCount;
        const foregroundMean = (weightedTotal - backgroundTotal) / foregroundCount;
        const variance = backgroundCount * foregroundCount * (backgroundMean - foregroundMean) ** 2;
        if (variance > bestVariance) {
            bestVariance = variance;
            bestThreshold = value;
        }
    }
    return bestThreshold;
}

/**
 * 조명 그림자가 있는 사진은 페이지 전체의 한 임계값으로 글자와 어두운 종이 바탕을 구분하기 어렵습니다.
 * 작은 타일마다 밝기·분산을 따로 계산해, 원문자를 바꾸지 않고 OCR 입력 픽셀만 흑백화합니다.
 */
function applyRosterOcrAdaptiveThreshold(imageData, width, height) {
    const data = imageData?.data;
    const safeWidth = Math.floor(Number(width) || 0);
    const safeHeight = Math.floor(Number(height) || 0);
    if (!data?.length || !safeWidth || !safeHeight || safeWidth * safeHeight * 4 > data.length) return false;
    const tileSize = Math.max(36, Math.min(96, Math.round(Math.min(safeWidth, safeHeight) / 18) || 48));
    const columns = Math.ceil(safeWidth / tileSize);
    const rows = Math.ceil(safeHeight / tileSize);
    const sums = new Array(columns * rows).fill(0);
    const squares = new Array(columns * rows).fill(0);
    const counts = new Array(columns * rows).fill(0);
    for (let y = 0; y < safeHeight; y += 1) {
        const tileRow = Math.floor(y / tileSize);
        for (let x = 0; x < safeWidth; x += 1) {
            const tileIndex = tileRow * columns + Math.floor(x / tileSize);
            const gray = data[(y * safeWidth + x) * 4];
            sums[tileIndex] += gray;
            squares[tileIndex] += gray * gray;
            counts[tileIndex] += 1;
        }
    }
    const thresholds = sums.map((sum, index) => {
        const count = counts[index] || 1;
        const mean = sum / count;
        const variance = Math.max(0, (squares[index] / count) - mean ** 2);
        // 배경보다 충분히 어두운 글자만 남기되, 흐린 획도 버리지 않도록 표준편차에 맞춰 여유를 둡니다.
        const offset = Math.max(10, Math.min(35, Math.sqrt(variance) * 0.55));
        return Math.max(25, Math.min(245, mean - offset));
    });
    for (let y = 0; y < safeHeight; y += 1) {
        const tileRow = Math.floor(y / tileSize);
        for (let x = 0; x < safeWidth; x += 1) {
            const index = (y * safeWidth + x) * 4;
            const threshold = thresholds[tileRow * columns + Math.floor(x / tileSize)];
            const value = data[index] <= threshold ? 0 : 255;
            data[index] = value;
            data[index + 1] = value;
            data[index + 2] = value;
            data[index + 3] = 255;
        }
    }
    return true;
}

/** 사진 영역별 평균 밝기 차이로 전역 흑백/부분별 흑백 재시도 방식을 고릅니다. */
function inspectRosterOcrLighting(imageData, width, height) {
    const data = imageData?.data;
    const safeWidth = Math.floor(Number(width) || 0);
    const safeHeight = Math.floor(Number(height) || 0);
    if (!data?.length || !safeWidth || !safeHeight || safeWidth * safeHeight * 4 > data.length) {
        return { uneven: false, spread: 0 };
    }
    const tileSize = Math.max(80, Math.min(240, Math.round(Math.min(safeWidth, safeHeight) / 8) || 120));
    const columns = Math.ceil(safeWidth / tileSize);
    const rows = Math.ceil(safeHeight / tileSize);
    const sums = new Array(columns * rows).fill(0);
    const counts = new Array(columns * rows).fill(0);
    for (let y = 0; y < safeHeight; y += 4) {
        const tileRow = Math.floor(y / tileSize);
        for (let x = 0; x < safeWidth; x += 4) {
            const tileIndex = tileRow * columns + Math.floor(x / tileSize);
            sums[tileIndex] += data[(y * safeWidth + x) * 4];
            counts[tileIndex] += 1;
        }
    }
    const means = sums.map((sum, index) => sum / (counts[index] || 1));
    const spread = means.length ? Math.max(...means) - Math.min(...means) : 0;
    return { uneven: spread >= 42, spread: Math.round(spread) };
}

function getRosterOcrRetryProfile(imageData, width, height) {
    return inspectRosterOcrLighting(imageData, width, height).uneven ? "adaptive" : "binary";
}

/** 대비를 자동 보정하고, 필요할 때는 전역 또는 부분별 고대비 흑백본을 만듭니다. */
function enhanceRosterOcrPixels(imageData, profile = "enhanced", width, height) {
    const data = imageData?.data;
    if (!data?.length) return false;
    const pixelCount = Math.floor(data.length / 4);
    const histogram = rosterOcrHistogram(data);
    const percentileLow = rosterOcrPercentile(histogram, pixelCount, 0.02);
    const percentileHigh = rosterOcrPercentile(histogram, pixelCount, 0.98);
    const [darkest, brightest] = rosterOcrValueRange(histogram);
    // 글자가 면적의 2%보다 작으면 양 끝 백분위가 모두 흰색이 될 수 있습니다.
    // 그 경우 실제 색 범위를 써서 흰 바탕이 검게 변하는 것을 막습니다.
    const low = percentileHigh - percentileLow >= 24 ? percentileLow : darkest;
    const high = percentileHigh - percentileLow >= 24 ? percentileHigh : brightest;
    const span = high - low;
    const threshold = rosterOcrThreshold(histogram, pixelCount);
    for (let index = 0; index < data.length; index += 4) {
        const gray = rosterOcrLuminance(data[index], data[index + 1], data[index + 2]);
        const normalized = span > 0 ? Math.max(0, Math.min(255, ((gray - low) * 255) / span)) : gray;
        const contrast = Math.max(0, Math.min(255, (normalized - 128) * 1.45 + 128));
        // 부분별 임계값은 그림자 영역을 전역 대비로 먼저 검게 만들지 않도록 원래 회색값으로 시작합니다.
        const value = profile === "adaptive"
            ? gray
            : (profile === "binary" ? (gray <= threshold ? 0 : 255) : Math.round(contrast));
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
        data[index + 3] = 255;
    }
    if (profile === "adaptive") {
        return applyRosterOcrAdaptiveThreshold(imageData, width, height)
            // Canvas 크기를 알 수 없는 비브라우저 호출도 기존 고대비 동작으로 안전하게 처리합니다.
            || enhanceRosterOcrPixels(imageData, "binary");
    }
    return true;
}

function getRosterOcrScale(width, height) {
    const largestEdge = Math.max(Number(width) || 0, Number(height) || 0);
    if (!largestEdge) return 1;
    if (largestEdge > ROSTER_MAX_IMAGE_EDGE) return ROSTER_MAX_IMAGE_EDGE / largestEdge;
    if (largestEdge < 1600) return Math.min(3, ROSTER_MAX_IMAGE_EDGE / largestEdge);
    return 1;
}

async function prepareRosterCanvasForOcr(profile = "enhanced") {
    const image = rosterElement("rosterPhotoPreview");
    if (!image?.src) throw new Error("사진이 없습니다.");
    if (!image.complete || !image.naturalWidth) {
        await new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
            setTimeout(resolve, 3000);
        });
    }
    const originalWidth = image.naturalWidth;
    const originalHeight = image.naturalHeight;
    if (!originalWidth || !originalHeight) throw new Error("사진을 열 수 없습니다.");
    const scale = getRosterOcrScale(originalWidth, originalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(originalWidth * scale));
    canvas.height = Math.max(1, Math.round(originalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("사진 보정을 지원하지 않는 브라우저입니다.");
    context.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in context) context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    try {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        enhanceRosterOcrPixels(pixels, profile, canvas.width, canvas.height);
        context.putImageData(pixels, 0, 0);
    } catch (error) {
        // Some browsers disallow pixel access for an image. The scaled canvas is still usable.
    }
    return canvas;
}

async function prepareRosterImageForOcr(profile = "enhanced") {
    const canvas = await prepareRosterCanvasForOcr(profile);
    return canvas.toDataURL("image/png");
}

function rosterOcrPixelIsDark(data, offset, threshold = 110) {
    return rosterOcrLuminance(data[offset], data[offset + 1], data[offset + 2]) < threshold;
}

/** 표 외곽·구획선처럼 충분히 긴 검은 선을 가로 또는 세로 방향으로 찾습니다. */
function findRosterTableLineBands(imageData, width, height, axis) {
    const data = imageData?.data;
    if (!data?.length || !width || !height) return [];
    const horizontal = axis === "horizontal";
    const primaryLength = horizontal ? height : width;
    const secondaryLength = horizontal ? width : height;
    const minimumCoverage = horizontal ? 0.58 : 0.45;
    const candidates = [];
    for (let primary = 0; primary < primaryLength; primary += 1) {
        let dark = 0;
        for (let secondary = 0; secondary < secondaryLength; secondary += 1) {
            const x = horizontal ? secondary : primary;
            const y = horizontal ? primary : secondary;
            if (rosterOcrPixelIsDark(data, (y * width + x) * 4)) dark += 1;
        }
        if (dark >= secondaryLength * minimumCoverage) candidates.push({ position: primary, coverage: dark });
    }
    return candidates.reduce((bands, candidate) => {
        const previous = bands[bands.length - 1];
        if (previous && candidate.position <= previous.end + 1) {
            previous.end = candidate.position;
            previous.coverage = Math.max(previous.coverage, candidate.coverage);
        } else {
            bands.push({ start: candidate.position, end: candidate.position, coverage: candidate.coverage });
        }
        return bands;
    }, []);
}

function rosterTableLineCenter(band) {
    return Math.round((Number(band?.start) + Number(band?.end)) / 2);
}

function findRosterTableVerticalBottom(imageData, width, height, lineBand) {
    const data = imageData?.data;
    if (!data?.length || !lineBand) return 0;
    for (let y = height - 1; y >= 0; y -= 1) {
        for (let x = lineBand.start; x <= lineBand.end; x += 1) {
            if (rosterOcrPixelIsDark(data, (y * width + x) * 4)) return y;
        }
    }
    return 0;
}

/**
 * 2열·반복 헤더 형태의 오더 표에서 선박별 헤더/명단 영역을 분리합니다.
 * 표가 아니거나 선이 부족하면 null을 돌려 기존 일반 OCR 흐름으로 안전하게 돌아갑니다.
 */
function detectRosterTableRegions(imageData, width, height) {
    const horizontalBands = findRosterTableLineBands(imageData, width, height, "horizontal");
    const verticalBands = findRosterTableLineBands(imageData, width, height, "vertical");
    if (horizontalBands.length < 6 || verticalBands.length < 3) return null;
    const leftLine = verticalBands[0];
    const centerLine = verticalBands.reduce((closest, band) => (
        Math.abs(rosterTableLineCenter(band) - width / 2) < Math.abs(rosterTableLineCenter(closest) - width / 2) ? band : closest
    ), verticalBands[0]);
    const rightLine = verticalBands[verticalBands.length - 1];
    const leftStart = leftLine.end + 4;
    const leftEnd = centerLine.start - 4;
    const rightStart = centerLine.end + 4;
    const rightEnd = rightLine.start - 4;
    if (leftEnd - leftStart < width * 0.25 || rightEnd - rightStart < width * 0.25) return null;

    const bottom = findRosterTableVerticalBottom(imageData, width, height, centerLine);
    const lineCenters = horizontalBands.map(rosterTableLineCenter);
    let bestRowBoundaries = null;
    // 사진마다 행 수가 다릅니다. 이전처럼 앞의 3행만 고정하면 마지막 작업자 칸이 다음 행까지 삼켜집니다.
    // 유효한 헤더·명단 높이 패턴을 끝까지 따라 가장 긴 반복 표를 사용합니다.
    for (let start = 0; start <= lineCenters.length - 6; start += 1) {
        const rowBoundaries = [];
        for (let lineIndex = start; lineIndex + 1 < lineCenters.length; lineIndex += 2) {
            const headerTop = lineCenters[lineIndex];
            const headerBottom = lineCenters[lineIndex + 1];
            const nextBoundary = lineCenters[lineIndex + 2] || bottom;
            const headerHeight = headerBottom - headerTop;
            const bodyHeight = nextBoundary - headerBottom;
            const headerIsValid = headerHeight >= height * 0.02 && headerHeight <= height * 0.13;
            const bodyIsValid = bodyHeight >= headerHeight * 1.5;
            if (!headerIsValid || !bodyIsValid) break;
            rowBoundaries.push({ headerTop, headerBottom, bodyBottom: nextBoundary });
            if (lineIndex + 2 >= lineCenters.length) break;
        }
        if (rowBoundaries.length >= 3 && (!bestRowBoundaries || rowBoundaries.length > bestRowBoundaries.length)) {
            bestRowBoundaries = rowBoundaries;
        }
    }
    if (!bestRowBoundaries) return null;
    const regions = [];
    bestRowBoundaries.forEach((row, rowIndex) => {
        [[leftStart, leftEnd], [rightStart, rightEnd]].forEach(([x0, x1], columnIndex) => {
            regions.push({
                index: regions.length,
                rowIndex,
                columnIndex,
                header: { x: x0, y: row.headerTop + 4, width: x1 - x0, height: row.headerBottom - row.headerTop - 8 },
                workers: { x: x0, y: row.headerBottom + 5, width: x1 - x0, height: row.bodyBottom - row.headerBottom - 9 }
            });
        });
    });
    return regions.every((region) => region.header.width > 0 && region.header.height > 0 && region.workers.height > 0)
        ? regions
        : null;
}

function normalizeRosterTableCellText(value) {
    return String(value || "").normalize("NFKC").replace(/[^가-힣0-9]/g, "");
}

function rosterTableWordCenter(word, axis) {
    const box = word?.bbox || {};
    const start = Number(box[axis === "x" ? "x0" : "y0"]);
    const end = Number(box[axis === "x" ? "x1" : "y1"]);
    return Number.isFinite(start) && Number.isFinite(end) ? (start + end) / 2 : NaN;
}

function rosterTableWordBox(word) {
    const box = word?.bbox || {};
    const x0 = Number(box.x0);
    const x1 = Number(box.x1);
    const y0 = Number(box.y0);
    const y1 = Number(box.y1);
    return Number.isFinite(x0) && Number.isFinite(x1) && Number.isFinite(y0) && Number.isFinite(y1)
        && x1 > x0 && y1 > y0
        ? { x0, x1, y0, y1 }
        : null;
}

/** 글자 상자가 작업자 칸 안에 완전히 들어온 경우만 해당 선박에 귀속합니다. */
function rosterTableWordFitsWorkerRegion(word, region, inset = 2) {
    const box = rosterTableWordBox(word);
    if (!box || !region) return false;
    const left = Number(region.x) + inset;
    const top = Number(region.y) + inset;
    const right = Number(region.x) + Number(region.width) - inset;
    const bottom = Number(region.y) + Number(region.height) - inset;
    return box.x0 >= left && box.x1 <= right && box.y0 >= top && box.y1 <= bottom;
}

function rosterTableWordTouchesWorkerRegion(word, region) {
    const box = rosterTableWordBox(word);
    if (!box || !region) return false;
    const left = Number(region.x);
    const top = Number(region.y);
    const right = left + Number(region.width);
    const bottom = top + Number(region.height);
    return box.x0 < right && box.x1 > left && box.y0 < bottom && box.y1 > top;
}

/**
 * 전체 OCR 단어는 정확히 한 작업자 칸에만 배정합니다.
 * 표 선·헤더 경계에 걸친 한글 조각은 원문 확인 대상으로 남기고 어느 선박에도 자동 귀속하지 않습니다.
 */
function assignRosterTableWordsToWorkerRegions(words, regions) {
    const assigned = (regions || []).map(() => []);
    const unassigned = [];
    (words || []).forEach((word) => {
        const rawText = String(word?.text || "");
        const text = normalizeRosterTableCellText(rawText);
        const isWorkerText = /^[가-힣]/.test(text);
        const isDivider = !text && /[_|]/.test(rawText);
        if (!isWorkerText && !isDivider) return;
        const candidates = (regions || []).map((region, index) => (
            rosterTableWordFitsWorkerRegion(word, region?.workers) ? index : -1
        )).filter((index) => index >= 0);
        if (candidates.length === 1) {
            assigned[candidates[0]].push(word);
            return;
        }
        // 한글 조각이 작업자 칸과 겹치지만 한 칸에 명확히 속하지 않으면 잘못된 선박 배정을 막습니다.
        if (isWorkerText && (regions || []).some((region) => rosterTableWordTouchesWorkerRegion(word, region?.workers))) {
            unassigned.push(word);
        }
    });
    return { assigned, unassigned };
}

/** 전체 표 OCR의 단어 좌표를 한 선박 명단 영역으로 제한해, 행·칸 순서대로 이름을 복원합니다. */
function collectRosterTableWorkers(words, region) {
    if (!region || !Array.isArray(words)) return [];
    const inRegion = words.map((word) => {
        const rawText = String(word?.text || "");
        const text = normalizeRosterTableCellText(rawText);
        return {
            word,
            text,
            divider: !text && /[_|]/.test(rawText),
            trailingDivider: Boolean(text) && /[_|]/.test(rawText),
            x: rosterTableWordCenter(word, "x"),
            y: rosterTableWordCenter(word, "y"),
            xStart: Number(word?.bbox?.x0),
            xEnd: Number(word?.bbox?.x1)
        };
    }).filter((item) => (item.text || item.divider) && Number.isFinite(item.x) && Number.isFinite(item.y)
        // 실제 표 OCR 경로는 먼저 전역 단일 배정을 거치므로 여기서는 이름 조각 결합에 필요한 중심점 범위만 씁니다.
        && item.x >= region.x && item.x <= region.x + region.width
        && item.y >= region.y && item.y <= region.y + region.height)
        .sort((a, b) => a.y - b.y || a.x - b.x);
    const lineTolerance = Math.max(14, Math.min(26, region.height / 14));
    const lines = [];
    inRegion.forEach((item) => {
        const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= lineTolerance);
        if (line) {
            line.items.push(item);
            line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
        } else {
            lines.push({ y: item.y, items: [item] });
        }
    });
    // 한 이름 안의 글자 간격은 약 15px 이하이고, 표의 다음 사람 칸은 그보다 큽니다.
    const joinGap = Math.max(14, Math.min(18, region.width * 0.021));
    return lines.sort((a, b) => a.y - b.y).flatMap((line) => {
        const cells = [];
        let forceNewCell = false;
        line.items.sort((a, b) => a.x - b.x).forEach((item) => {
            if (item.divider) {
                forceNewCell = true;
                return;
            }
            const previous = cells[cells.length - 1];
            if (previous && !forceNewCell && item.xStart - previous.xEnd <= joinGap) {
                previous.text += item.text;
                previous.xEnd = Math.max(previous.xEnd, item.xEnd);
            } else {
                cells.push({ text: item.text, xEnd: item.xEnd });
            }
            forceNewCell = item.trailingDivider;
        });
        // 표 칸에 든 한글 OCR 조각은 글자 수와 무관하게 보존합니다. 이름 여부를 추정해 제외하지 않습니다.
        return cells.map((cell) => cell.text).filter((text) => /^[가-힣]/.test(text));
    });
}

function readRosterTableHeaderTime(value) {
    const standard = readTimeFromOcrLine(value);
    if (standard) return standard;
    const compact = String(value || "").match(/(?:^|[^\d])([01]\d|2[0-3])\s*([0-5]\d)(?!\d)/);
    return compact ? `${compact[1]}:${compact[2]}` : "";
}

function pickRosterTableHeaderCompany(value) {
    const time = String(value || "").match(/(?:[01]\d|2[0-3])\s*(?::|\.)?\s*[0-5]\d/);
    const tail = time ? String(value).slice(time.index + time[0].length) : String(value || "");
    return (tail.match(/[가-힣]/g) || []).join("");
}

function parseRosterTableHeader(text, options) {
    const settings = options || {};
    const fallbackYear = Number(settings.defaultYear) || new Date().getFullYear();
    const raw = String(text || "");
    return {
        date: readDateFromOcrLine(raw, fallbackYear),
        vessel: pickVesselFromOcrLine(raw),
        time: readRosterTableHeaderTime(raw),
        company: pickRosterTableHeaderCompany(raw)
    };
}

function assessRosterOcrText(text, confidence = 0) {
    const parsed = parseRosterPhotoText(text, { defaultYear: new Date().getFullYear() });
    const workerCount = parsed.entries.reduce((total, row) => total + row.workers.length, 0);
    const score = parsed.entries.length * 100 + workerCount * 12 - parsed.warnings.length * 15;
    return { text: String(text || ""), confidence: Number(confidence) || 0, score, entryCount: parsed.entries.length, workerCount };
}

function shouldRetryRosterOcr(candidate) {
    return !candidate.text.trim() || candidate.entryCount === 0 || candidate.workerCount < 4;
}

function chooseRosterOcrCandidate(primary, alternative) {
    if (!alternative) return primary;
    if (alternative.score !== primary.score) return alternative.score > primary.score ? alternative : primary;
    return alternative.confidence > primary.confidence ? alternative : primary;
}

function loadRosterOcrScript(source) {
    return new Promise((resolve, reject) => {
        if (document.querySelector('script[data-roster-engine-ocr="true"]')) return resolve();
        const script = document.createElement("script");
        script.src = source;
        script.async = true;
        script.setAttribute("data-roster-engine-ocr", "true");
        script.onload = resolve;
        script.onerror = () => reject(new Error("글자 인식 엔진을 불러오지 못했습니다."));
        document.head.appendChild(script);
    });
}

async function getRosterOcrEngine() {
    if (window.Tesseract?.recognize) return window.Tesseract;
    await loadRosterOcrScript(ROSTER_OCR_URL);
    if (!window.Tesseract?.recognize) throw new Error("글자 인식 엔진을 준비하지 못했습니다.");
    return window.Tesseract;
}

function cropRosterOcrCanvas(source, region, padding = 14, scale = 1) {
    const x = Math.max(0, Math.floor(region?.x || 0));
    const y = Math.max(0, Math.floor(region?.y || 0));
    const width = Math.min(source.width - x, Math.max(1, Math.ceil(region?.width || 0)));
    const height = Math.min(source.height - y, Math.max(1, Math.ceil(region?.height || 0)));
    const zoom = Math.max(1, Number(scale) || 1);
    const crop = document.createElement("canvas");
    crop.width = Math.round(width * zoom) + padding * 2;
    crop.height = Math.round(height * zoom) + padding * 2;
    const context = crop.getContext("2d");
    if (!context) throw new Error("표 영역을 읽을 수 없습니다.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, crop.width, crop.height);
    context.drawImage(source, x, y, width, height, padding, padding, Math.round(width * zoom), Math.round(height * zoom));
    return crop.toDataURL("image/png");
}

function rotateRosterCanvasForOcr(sourceCanvas, degrees) {
    const normalizedDegrees = ((Number(degrees) % 360) + 360) % 360;
    if (![90, 180, 270].includes(normalizedDegrees)) return sourceCanvas;
    const rotated = document.createElement("canvas");
    const quarterTurn = normalizedDegrees === 90 || normalizedDegrees === 270;
    rotated.width = quarterTurn ? sourceCanvas.height : sourceCanvas.width;
    rotated.height = quarterTurn ? sourceCanvas.width : sourceCanvas.height;
    const context = rotated.getContext("2d");
    if (!context) return sourceCanvas;
    context.translate(rotated.width / 2, rotated.height / 2);
    context.rotate((normalizedDegrees * Math.PI) / 180);
    context.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
    return rotated;
}

function rosterTableHeaderFieldRegion(header, startRatio, endRatio) {
    const start = Math.max(0, Math.min(1, startRatio));
    const end = Math.max(start, Math.min(1, endRatio));
    return {
        x: header.x + header.width * start,
        y: header.y,
        width: header.width * (end - start),
        height: header.height
    };
}

function hasRosterTableHeaderInk(imageData, region) {
    const data = imageData?.data;
    const imageWidth = Number(imageData?.width);
    const imageHeight = Number(imageData?.height);
    if (!data?.length || !imageWidth || !imageHeight || !region) return false;
    const x0 = Math.max(0, Math.floor(Number(region.x) || 0));
    const y0 = Math.max(0, Math.floor(Number(region.y) || 0));
    const x1 = Math.min(imageWidth, Math.ceil(x0 + (Number(region.width) || 0)));
    const y1 = Math.min(imageHeight, Math.ceil(y0 + (Number(region.height) || 0)));
    if (x1 <= x0 || y1 <= y0) return false;
    let darkPixelCount = 0;
    const occupiedRows = new Set();
    const occupiedColumns = new Set();
    for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
            const offset = (y * imageWidth + x) * 4;
            if (rosterOcrLuminance(data[offset], data[offset + 1], data[offset + 2]) >= 185) continue;
            darkPixelCount += 1;
            occupiedRows.add(y);
            occupiedColumns.add(x);
        }
    }
    // 표 선은 영역 감지 때 제외됩니다. 남은 영역에 글자 형태의 충분한 잉크가 없으면 빈 헤더로 취급합니다.
    const minimumInk = Math.max(24, Math.ceil((x1 - x0) * (y1 - y0) * 0.00015));
    return darkPixelCount >= minimumInk && occupiedRows.size >= 3 && occupiedColumns.size >= 3;
}

async function recognizeRosterTableHeader(worker, sourceCanvas, imageData, region, fallbackYear) {
    if (!hasRosterTableHeaderInk(imageData, region.header)) return { date: "", vessel: "", time: "", company: "", raw: "" };
    const recognizeCrop = async (crop, label, scale = 1) => {
        setRosterPhotoStatus(`🔍 표의 ${label} 읽는 중…`);
        const result = await worker.recognize(cropRosterOcrCanvas(sourceCanvas, crop, 14, scale));
        return String(result?.data?.text || "");
    };
    let raw = await recognizeCrop(region.header, `${region.index + 1}번째 선박 헤더`);
    let header = parseRosterTableHeader(raw, { defaultYear: fallbackYear });
    // 날짜 칸은 작고 구분선이 가까워, 확대 OCR 값을 우선해 11/10 → 1/10 같은 누락을 줄입니다.
    const dateText = await recognizeCrop(rosterTableHeaderFieldRegion(region.header, 0, 0.20), "날짜", 2);
    const cropDate = readDateFromOcrLine(dateText, fallbackYear);
    if (cropDate) header.date = cropDate;
    raw += ` ${dateText}`;
    if (!header.vessel) {
        const vesselText = await recognizeCrop(rosterTableHeaderFieldRegion(region.header, 0.15, 0.72), "선박명");
        header.vessel = pickVesselFromOcrLine(vesselText);
        raw += ` ${vesselText}`;
    }
    if (!header.time) {
        const timeText = await recognizeCrop(rosterTableHeaderFieldRegion(region.header, 0.70, 0.87), "시간");
        header.time = readRosterTableHeaderTime(timeText);
        raw += ` ${timeText}`;
    }
    if (!header.company) {
        const companyText = await recognizeCrop(rosterTableHeaderFieldRegion(region.header, 0.84, 1), "회사");
        header.company = pickRosterTableHeaderCompany(companyText);
        raw += ` ${companyText}`;
    }
    return { ...header, raw: raw.trim() };
}

function buildRosterTableOcrEntries(regions, headers, assignedWords) {
    return (regions || []).flatMap((region, index) => {
        const header = headers?.[index];
        // 날짜나 작업자 글자가 있어도 선박명이 없는 칸은 새 선박 검토 행으로 만들지 않습니다.
        if (!header?.vessel) return [];
        const workerWords = assignedWords?.[index] || [];
        const workers = collectRosterTableWorkers(workerWords, region.workers);
        const sourceOcrLine = [String(header.raw || header.vessel || "").trim(), buildRosterOcrTextFromWords(workerWords)].filter(Boolean).join("\n");
        return [{
            ...header,
            workers,
            sourceOcrLine,
            sourceOcrVessel: String(header.vessel || "").trim(),
            sourceWorkerCount: workers.length,
            source: "photo-table"
        }];
    });
}

function parseRosterCloudTableResult(result, regions, defaultYear) {
    const words = Array.isArray(result?.words) ? result.words : [];
    const headers = (regions || []).map((region) => {
        const headerWords = words.map((word) => ({
            word,
            x: rosterTableWordCenter(word, "x"),
            y: rosterTableWordCenter(word, "y")
        })).filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y)
            && item.x >= region.header.x && item.x <= region.header.x + region.header.width
            && item.y >= region.header.y && item.y <= region.header.y + region.header.height)
            .sort((a, b) => a.y - b.y || a.x - b.x);
        const lines = [];
        const tolerance = Math.max(8, Math.min(18, region.header.height * 0.24));
        headerWords.forEach((item) => {
            const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
            if (line) {
                line.items.push(item);
                line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
            } else {
                lines.push({ y: item.y, items: [item] });
            }
        });
        const text = lines.sort((a, b) => a.y - b.y)
            .map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.word.text).join(" "))
            .join(" ");
        const header = parseRosterTableHeader(text, { defaultYear });
        const confidences = headerWords.map((item) => Number(item.word.confidence)).filter(Number.isFinite);
        return { ...header, confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0, raw: text };
    });
    for (let index = 0; index < headers.length; index += 2) {
        const left = headers[index];
        const right = headers[index + 1];
        if (!left?.date && right?.date) left.date = right.date;
        if (!right?.date && left?.date) right.date = left.date;
    }
    const allocation = assignRosterTableWordsToWorkerRegions(words, regions);
    const entries = buildRosterTableOcrEntries(regions, headers, allocation.assigned);
    const workerCountAudit = auditRosterPhotoWorkerCounts(entries, allocation.unassigned.length);
    const warnings = ["☁️ Google Cloud Vision으로 온라인 재판독했습니다. 사진 원본과 비교해 검토해 주세요."];
    if (!entries.length) warnings.push("선박명이 확인된 표 칸이 없습니다. 빈 칸은 선박 행으로 만들지 않았습니다. 사진을 확인하거나 직접 입력해 주세요.");
    if (allocation.unassigned.length) warnings.push(`${allocation.unassigned.length}개 한글 OCR 조각은 작업자 칸 경계에 걸려 자동 배정하지 않았습니다.`);
    warnings.push(`👥 사진 작업자 칸 ${workerCountAudit.sourceCount}명 · 출력 ${workerCountAudit.outputCount}명${workerCountAudit.isVerified ? " 일치" : " 불일치 — 원본 확인 권장"}`);
    const rawText = String(result?.text || "").replace(/\r\n?/g, "\n").trim()
        || buildRosterOcrTextFromWords(words);
    return {
        text: buildRosterTableOcrText(entries),
        rawText,
        detectedRegionCount: regions?.length || 0,
        entries,
        warnings,
        unassignedWorkerCellCount: allocation.unassigned.length,
        workerCountAudit,
        confidence: Number(result?.confidence) || 0
    };
}

function buildRosterTableOcrText(entries) {
    return (entries || []).map((row) => [
        [row.date, row.vessel, row.time, row.company].filter(Boolean).join(" "),
        ...(row.workers || [])
    ].filter(Boolean).join("\n")).join("\n\n");
}

/** 표 감지에 성공했을 때, 한 번의 전체 OCR 좌표와 선박별 헤더 OCR을 결합합니다. */
async function recognizeRosterTablePhoto(engine, sourceCanvas, imageData, regions, defaultYear) {
    if (!engine?.createWorker || !regions?.length) return null;
    let worker = null;
    try {
        worker = await engine.createWorker("kor+eng", 1, {
            logger: (progress) => {
                if (progress?.status === "recognizing text") {
                    setRosterPhotoStatus(`🔍 표 명단 좌표 인식 중… ${Math.round((Number(progress.progress) || 0) * 100)}%`);
                }
            }
        });
        await worker.setParameters?.({ tessedit_pageseg_mode: "6" });
        const fullResult = await worker.recognize(sourceCanvas.toDataURL("image/png"));
        const words = Array.isArray(fullResult?.data?.words) ? fullResult.data.words : [];
        await worker.setParameters?.({ tessedit_pageseg_mode: "7" });
        const headers = [];
        for (const region of regions) headers.push(await recognizeRosterTableHeader(worker, sourceCanvas, imageData, region, defaultYear));
        // 같은 가로줄의 짝 헤더가 명확한 날짜를 읽었을 때만, 완전히 비어 있는 날짜 칸의 검토 시작값으로 씁니다.
        for (let index = 0; index < headers.length; index += 2) {
            const left = headers[index];
            const right = headers[index + 1];
            if (!left?.date && right?.date) left.date = right.date;
            if (!right?.date && left?.date) right.date = left.date;
        }
        // 전체 OCR 단어를 선박별 작업자 칸에 한 번씩만 배정합니다. 겹치거나 경계에 걸린 이름은 자동 출력하지 않습니다.
        const workerWordAssignments = assignRosterTableWordsToWorkerRegions(words, regions);
        const entries = buildRosterTableOcrEntries(regions, headers, workerWordAssignments.assigned);
        // 표 구조가 확인되면 선박명이 실제로 읽힌 칸만 사용합니다. 빈 헤더가 많다는 이유로 일반 OCR에
        // 되돌리면 빈 표 칸의 잡음이 선박 행으로 부풀 수 있으므로, 낮은 헤더 비율도 그대로 허용합니다.
        const missingDates = entries.filter((row) => !row.date).length;
        const missingWorkers = entries.filter((row) => !row.workers.length).length;
        const workerCountAudit = auditRosterPhotoWorkerCounts(entries, workerWordAssignments.unassigned.length);
        const warnings = ["표 구조를 인식해 선박별 헤더와 그 아래 작업자 칸을 따로 읽었습니다. 작업자 칸 인원과 출력 인원을 함께 표시하니 원본 사진과 검토해 주세요."];
        if (!entries.length) warnings.push("선박명이 확인된 표 칸이 없습니다. 빈 칸은 선박 행으로 만들지 않았습니다. 사진을 확인하거나 직접 입력해 주세요.");
        if (workerWordAssignments.unassigned.length) warnings.push(`${workerWordAssignments.unassigned.length}개 한글 OCR 조각은 선박 작업자 칸 경계에 걸려 자동 배정하지 않았습니다. 원문을 보고 필요한 이름만 검토 표에 입력해 주세요.`);
        if (missingDates) warnings.push(`${missingDates}척은 날짜를 읽지 못했습니다. 검토 표에서 날짜를 채워 주세요.`);
        if (missingWorkers) warnings.push(`${missingWorkers}척은 작업자 칸을 읽지 못했습니다. 사진을 보며 직접 입력해 주세요.`);
        warnings.push(`👥 사진 작업자 칸 ${workerCountAudit.sourceCount}명 · 출력 ${workerCountAudit.outputCount}명${workerCountAudit.isVerified ? " 일치" : " 불일치 — 원본 확인 권장"}`);
        const rawText = String(fullResult?.data?.text || "").replace(/\r\n?/g, "\n").trim()
            || buildRosterOcrTextFromWords(words);
        return {
            text: buildRosterTableOcrText(entries),
            rawText,
            detectedRegionCount: regions.length,
            entries,
            warnings,
            unassignedWorkerCellCount: workerWordAssignments.unassigned.length,
            workerCountAudit,
            confidence: Number(fullResult?.data?.confidence) || 0
        };
    } catch (error) {
        console.warn("[roster] table photo recognition unavailable", error);
        return null;
    } finally {
        await worker?.terminate?.();
    }
}

async function runRosterPhotoOcr() {
    if (!isRosterFinderUnlocked()) return unlockRosterFinder();
    if (!rosterRuntime.activeImageUrl) return showToast("📷 먼저 근무 배치 사진을 선택해 주세요.");
    rosterRuntime.ocrAudit = null;
    setRosterPhotoBusy(true, "🔍 글자를 선명하게 보정한 뒤 읽는 중… (사진은 이 기기 밖으로 전송되지 않습니다)");
    const recognize = async (engine, image, phase) => engine.recognize(image, "kor+eng", {
        logger: (progress) => {
            if (progress?.status === "recognizing text") {
                setRosterPhotoStatus(`🔍 ${phase} 글자 인식 중… ${Math.round((Number(progress.progress) || 0) * 100)}%`);
            }
        }
    });
    try {
        const [engine, enhancedCanvas] = await Promise.all([getRosterOcrEngine(), prepareRosterCanvasForOcr("enhanced")]);
        let tableResult = null;
        let enhancedPixels = null;
        try {
            enhancedPixels = enhancedCanvas.getContext("2d")?.getImageData(0, 0, enhancedCanvas.width, enhancedCanvas.height);
            const tableRegions = detectRosterTableRegions(enhancedPixels, enhancedCanvas.width, enhancedCanvas.height);
            if (tableRegions) {
                const activeDate = (() => {
                    try { return String(getActiveWorkLogDate() || ""); } catch (error) { return ""; }
                })();
                const fallbackYear = Number(activeDate.slice(0, 4)) || new Date().getFullYear();
                setRosterPhotoStatus(`🔍 ${tableRegions.length}개 선박 표 칸을 분리해 읽는 중…`);
                tableResult = await recognizeRosterTablePhoto(engine, enhancedCanvas, enhancedPixels, tableRegions, fallbackYear);
            }
        } catch (error) {
            console.warn("[roster] table layout detection unavailable", error);
        }
        if (tableResult) {
            rosterRuntime.recognizedText = tableResult.rawText || tableResult.text;
            rosterRuntime.ocrAudit = {
                source: "device-table",
                detectedRegionCount: tableResult.detectedRegionCount,
                confidence: tableResult.confidence
            };
            rosterRuntime.tableOcrParsed = {
                entries: tableResult.entries,
                warnings: tableResult.warnings,
                unassignedWorkerCellCount: tableResult.unassignedWorkerCellCount
            };
            const box = rosterElement("rosterPhotoText");
            if (box) box.value = rosterRuntime.recognizedText;
            const details = rosterElement("rosterPhotoTextDetails");
            if (details) { details.classList.remove("hidden"); details.open = true; }
            beginRosterPhotoReview(rosterRuntime.tableOcrParsed, "✅ 사진에서 OCR 원문을 먼저 추출했습니다. 아래 원문과 선박별 검토 행을 비교하고, 일정에 나타난 이름은 후보로만 제안합니다.");
            void refreshRosterCloudOcrButton();
            trackAppEvent?.("actions", "roster_photo_table_ocr_done");
            return tableResult;
        }

        const enhancedImage = enhancedCanvas.toDataURL("image/png");
        const primaryResult = await recognize(engine, enhancedImage, "보정");
        const primary = assessRosterOcrText(primaryResult?.data?.text, primaryResult?.data?.confidence);
        let selected = primary;
        let retryProfile = "";
        let orientationLabel = "";
        if (shouldRetryRosterOcr(primary)) {
            // 그림자·부분 역광이 크면 타일별 임계값, 균일한 사진이면 기존 전역 흑백을 사용합니다.
            retryProfile = enhancedPixels
                ? getRosterOcrRetryProfile(enhancedPixels, enhancedCanvas.width, enhancedCanvas.height)
                : "binary";
            const retryLabel = retryProfile === "adaptive" ? "부분별 밝기 보정" : "고대비 흑백";
            setRosterPhotoStatus(`🔍 이름 인식이 부족해 ${retryLabel}으로 한 번 더 확인하는 중…`);
            const retryImage = await prepareRosterImageForOcr(retryProfile);
            const retryResult = await recognize(engine, retryImage, `${retryLabel} 재확인`);
            const alternate = assessRosterOcrText(retryResult?.data?.text, retryResult?.data?.confidence);
            selected = chooseRosterOcrCandidate(primary, alternate);
            trackAppEvent?.("actions", retryProfile === "adaptive"
                ? "roster_photo_ocr_adaptive_retry"
                : "roster_photo_ocr_retry");
        }
        // 글자가 세로 방향으로 찍혔거나 사진이 90도 돌아간 경우를 위해, 선박 행이 하나도 없을 때만
        // 좌우 회전본을 추가 확인합니다. 불필요한 회전 OCR은 생략하고 실제 행 수/내용이 나아진 경우에만 채택합니다.
        if (selected.entryCount === 0) {
            for (const degrees of [90, 270]) {
                setRosterPhotoStatus(`🔍 선박명을 찾지 못해 사진을 ${degrees}도 돌려 방향을 확인하는 중…`);
                const rotatedCanvas = rotateRosterCanvasForOcr(enhancedCanvas, degrees);
                if (rotatedCanvas === enhancedCanvas) break;
                const rotatedResult = await recognize(engine, rotatedCanvas.toDataURL("image/png"), `${degrees}도 회전`);
                const candidate = assessRosterOcrText(rotatedResult?.data?.text, rotatedResult?.data?.confidence);
                if (candidate.entryCount > selected.entryCount || (candidate.entryCount === selected.entryCount && candidate.score > selected.score)) {
                    selected = candidate;
                    orientationLabel = ` · ${degrees}도 회전본 선택`;
                }
                if (selected.entryCount > 0) break;
            }
        }
        rosterRuntime.recognizedText = selected.text;
        rosterRuntime.ocrAudit = { source: "device-text", detectedRegionCount: null, confidence: selected.confidence };
        rosterRuntime.tableOcrParsed = null;
        rosterRuntime.sourceUnassignedWorkerCount = 0;
        rosterRuntime.sourceWorkerCount = null;
        const box = rosterElement("rosterPhotoText");
        if (box) box.value = rosterRuntime.recognizedText;
        const details = rosterElement("rosterPhotoTextDetails");
        if (details) { details.classList.remove("hidden"); details.open = true; }
        const retryLabel = `${retryProfile
            ? (selected === primary
                ? " · 보정본 선택"
                : ` · ${retryProfile === "adaptive" ? "부분별 밝기 보정" : "고대비"} 재확인본 선택`)
            : ""}${orientationLabel}`;
        beginRosterPhotoReview(parseRosterPhotoTextFromBox({ skipReview: true }), `✅ 글자 인식 완료 (${rosterRuntime.recognizedText.length}자${retryLabel}). 전 터미널 입·출항 스케줄과 선박명을 교차 확인하는 중입니다.`);
        void refreshRosterCloudOcrButton();
        trackAppEvent?.("actions", "roster_photo_ocr_done");
        return selected;
    } catch (error) {
        console.error("[roster] OCR failed", error);
        const details = rosterElement("rosterPhotoTextDetails");
        if (details) { details.classList.remove("hidden"); details.open = true; }
        void refreshRosterCloudOcrButton();
        setRosterPhotoStatus("⚠️ 자동 인식에 실패했습니다. 사진을 보며 아래 칸에 직접 입력하거나 온라인 OCR로 재판독할 수 있습니다.");
        showToast("⚠️ 자동 인식에 실패했습니다. 직접 입력으로 계속할 수 있습니다.");
    } finally {
        setRosterPhotoBusy(false);
    }
}

async function runRosterCloudOcr() {
    if (!isRosterFinderUnlocked()) return unlockRosterFinder();
    if (!rosterRuntime.activeImageUrl) return showToast("📷 먼저 근무 배치 사진을 선택해 주세요.");
    if (!rosterRuntime.cloudOcrEnabled) return showToast("⚠️ 온라인 OCR이 서버에 설정되어 있지 않습니다.");
    const approved = window.confirm("온라인 재판독을 위해 보정한 사진을 Google Cloud Vision으로 전송합니다. 전송을 계속할까요?");
    if (!approved) return false;
    rosterRuntime.ocrAudit = null;
    setRosterPhotoBusy(true, "☁️ 동의한 사진만 Google Cloud Vision으로 전송해 재판독 중입니다…");
    try {
        const [engineCanvas, user] = await Promise.all([
            prepareRosterCanvasForOcr("enhanced"),
            (async () => {
                let current = null;
                try { current = typeof auth !== "undefined" ? auth?.currentUser || null : null; } catch (error) { current = null; }
                if (!current && typeof ensureAnonymousAuth === "function") current = await ensureAnonymousAuth();
                return current;
            })()
        ]);
        if (!user?.getIdToken) throw new Error("온라인 OCR에는 앱 로그인이 필요합니다.");
        const idToken = await user.getIdToken();
        const jpeg = await new Promise((resolve, reject) => {
            engineCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("사진을 온라인 판독용으로 준비하지 못했습니다.")), "image/jpeg", 0.88);
        });
        if (jpeg.size > 4 * 1024 * 1024) throw new Error("온라인 판독용 사진이 4MB를 넘습니다. 사진을 더 작게 잘라 다시 시도해 주세요.");
        const response = await fetch("/api/roster-ocr", {
            method: "POST",
            headers: {
                "Content-Type": "image/jpeg",
                Authorization: `Bearer ${idToken}`,
                "X-Roster-Ocr-Consent": "1"
            },
            body: jpeg,
            cache: "no-store"
        });
        const cloudResult = await response.json().catch(() => ({}));
        if (!response.ok || !cloudResult?.ok) {
            const messages = {
                cloud_ocr_not_configured: "서버에 온라인 OCR 자격 설정이 필요합니다.",
                authentication_required: "앱 로그인 후 온라인 OCR을 다시 시도해 주세요.",
                too_many_requests: "온라인 OCR 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.",
                cloud_ocr_provider_error: "온라인 OCR 서비스가 요청을 처리하지 못했습니다.",
                cloud_ocr_unavailable: "온라인 OCR 서비스에 연결하지 못했습니다."
            };
            throw new Error(messages[cloudResult?.error] || "온라인 재판독에 실패했습니다.");
        }
        const imageData = engineCanvas.getContext("2d")?.getImageData(0, 0, engineCanvas.width, engineCanvas.height);
        const regions = detectRosterTableRegions(imageData, engineCanvas.width, engineCanvas.height);
        const activeDate = (() => {
            try { return String(getActiveWorkLogDate() || ""); } catch (error) { return ""; }
        })();
        const defaultYear = Number(activeDate.slice(0, 4)) || new Date().getFullYear();
        if (regions?.length) {
            const parsed = parseRosterCloudTableResult(cloudResult, regions, defaultYear);
            rosterRuntime.recognizedText = parsed.rawText || parsed.text;
            rosterRuntime.ocrAudit = {
                source: "cloud-table",
                detectedRegionCount: parsed.detectedRegionCount,
                confidence: parsed.confidence
            };
            rosterRuntime.tableOcrParsed = {
                entries: parsed.entries,
                warnings: parsed.warnings,
                unassignedWorkerCellCount: parsed.unassignedWorkerCellCount
            };
            const box = rosterElement("rosterPhotoText");
            if (box) box.value = rosterRuntime.recognizedText;
            const details = rosterElement("rosterPhotoTextDetails");
            if (details) { details.classList.remove("hidden"); details.open = true; }
            beginRosterPhotoReview(rosterRuntime.tableOcrParsed, `✅ Google Cloud Vision에서 OCR 원문을 추출했습니다 (${parsed.entries.length}척). 원문과 검토 행을 비교해 주세요.`);
        } else {
            const parsed = parseRosterPhotoText(cloudResult.text, { defaultYear, defaultDate: activeDate });
            parsed.warnings.unshift("☁️ Google Cloud Vision 온라인 재판독 결과입니다. 표 구조를 찾지 못해 사진 원문과 대조해 주세요.");
            rosterRuntime.recognizedText = String(cloudResult.text || "").replace(/\r\n?/g, "\n");
            rosterRuntime.ocrAudit = { source: "cloud-text", detectedRegionCount: null, confidence: cloudResult.confidence };
            rosterRuntime.tableOcrParsed = null;
            const box = rosterElement("rosterPhotoText");
            if (box) box.value = rosterRuntime.recognizedText;
            const details = rosterElement("rosterPhotoTextDetails");
            if (details) { details.classList.remove("hidden"); details.open = true; }
            beginRosterPhotoReview(parsed, `✅ Google Cloud Vision 재판독 완료 (${parsed.entries.length}척). 원본 사진과 검토해 주세요.`);
        }
        trackAppEvent?.("actions", "roster_photo_cloud_ocr_done");
        return cloudResult;
    } catch (error) {
        console.error("[roster] cloud OCR failed", error);
        showToast(`⚠️ ${error?.message || "온라인 OCR 재판독에 실패했습니다."}`);
        return null;
    } finally {
        setRosterPhotoBusy(false);
    }
}

function beginRosterPhotoReview(parsed, statusMessage) {
    const safeParsed = parsed || { entries: [], warnings: [] };
    rosterRuntime.photoModeEngaged = true;
    const textBox = rosterElement("rosterPhotoText");
    const rawText = textBox ? String(textBox.value || "") : String(rosterRuntime.recognizedText || "");
    const previousAudit = rosterRuntime.ocrAudit || { source: "manual", detectedRegionCount: null, confidence: null };
    rosterRuntime.ocrAudit = {
        ...previousAudit,
        rawLineCount: countRosterOcrLines(rawText),
        parsedRowCount: (safeParsed.entries || []).length,
        edited: Boolean(rosterRuntime.recognizedText && rawText !== rosterRuntime.recognizedText)
    };
    const textDetails = rosterElement("rosterPhotoTextDetails");
    if (textDetails && rawText.trim()) { textDetails.classList.remove("hidden"); textDetails.open = true; }
    rosterRuntime.reviewRows = (safeParsed.entries || []).map((row) => ({ ...row, workers: [...(row.workers || [])] }));
    rosterRuntime.sourceUnassignedWorkerCount = Math.max(0, Number(safeParsed.unassignedWorkerCellCount) || 0);
    const initialWorkerCountAudit = auditRosterPhotoWorkerCounts(rosterRuntime.reviewRows, rosterRuntime.sourceUnassignedWorkerCount);
    rosterRuntime.sourceWorkerCount = initialWorkerCountAudit.hasSourceCount ? initialWorkerCountAudit.sourceCount : null;
    rosterRuntime.reviewWarnings = [...(safeParsed.warnings || [])];
    rosterRuntime.reviewVerifications = rosterRuntime.reviewRows.map(() => ({ status: "pending", matches: [] }));
    rosterRuntime.reviewVerificationState = "pending";
    // 읽기 완료 즉시 이 사진의 이름·선박명으로 찾기를 쓸 수 있습니다. 임금·근무일지 등록은 찾기 결과에서만 별도로 실행됩니다.
    syncRosterPhotoSearchEntries();
    renderRosterPhotoRows();
    setRosterPhotoStatus(statusMessage || "📝 인식한 내용을 검토표와 찾기에 바로 표시했습니다. 전 터미널 입·출항 스케줄과 선박명을 교차 확인하는 중입니다.");
    // 기존에 찾기어를 입력해 둔 경우에는 사진을 읽는 즉시 새 명단으로 결과도 갱신합니다.
    if (rosterElement("rosterFinderInput")?.value.trim()) void searchRosterVessels();
    verifyRosterPhotoVessels();
    return safeParsed;
}

function parseRosterPhotoTextFromBox(options) {
    const settings = options || {};
    const textBox = rosterElement("rosterPhotoText");
    const raw = textBox ? String(textBox.value || "") : String(rosterRuntime.recognizedText || "");
    if (!raw.trim()) {
        if (!settings.skipReview) showToast("⚠️ 읽은 글자가 없습니다. 사진을 다시 고르거나 직접 입력해 주세요.");
        return { entries: [], warnings: [] };
    }
    // 표 OCR 결과를 수정하지 않고 다시 검토할 때는 이미 분리한 작업자 칸 연결을 그대로 보존합니다.
    if (rosterRuntime.tableOcrParsed && raw === rosterRuntime.recognizedText) {
        const tableParsed = {
            entries: rosterRuntime.tableOcrParsed.entries.map((row) => ({ ...row, workers: [...(row.workers || [])] })),
            warnings: [...rosterRuntime.tableOcrParsed.warnings],
            unassignedWorkerCellCount: rosterRuntime.tableOcrParsed.unassignedWorkerCellCount
        };
        return settings.skipReview ? tableParsed : beginRosterPhotoReview(tableParsed);
    }
    if (rosterRuntime.tableOcrParsed && !settings.skipReview && typeof window !== "undefined"
        && !window.confirm("표 OCR 원문을 수정하면 표 칸의 좌표 연결이 해제되고 일반 텍스트로 다시 분석됩니다. 선박별 연결을 유지하려면 취소하고 아래 검토표의 행을 수정하세요. 원문 텍스트를 일반 문장 방식으로 다시 읽을까요?")) {
        return false;
    }
    rosterRuntime.tableOcrParsed = null;
    rosterRuntime.sourceUnassignedWorkerCount = 0;
    rosterRuntime.sourceWorkerCount = null;
    const activeDate = (() => {
        try { return String(getActiveWorkLogDate() || ""); } catch (error) { return ""; }
    })();
    const parsed = parseRosterPhotoText(raw, { defaultYear: new Date().getFullYear(), defaultDate: activeDate });
    if (settings.skipReview) return parsed;
    return beginRosterPhotoReview(parsed);
}

async function copyRosterPhotoOcrText() {
    const text = String(rosterElement("rosterPhotoText")?.value || "");
    if (!text.trim()) return showToast("복사할 OCR 원문이 없습니다.");
    try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const box = rosterElement("rosterPhotoText");
            box?.focus();
            box?.select();
            if (!document.execCommand?.("copy")) throw new Error("clipboard_unavailable");
        }
        showToast("OCR 원문을 복사했습니다.");
        return true;
    } catch (error) {
        showToast("원문 복사 권한이 없습니다. 텍스트를 길게 눌러 직접 복사해 주세요.");
        return false;
    }
}

function rosterPhotoScheduleValue(vessel, fields) {
    for (const field of fields) {
        const value = String(vessel?.[field] || "").trim();
        if (value) return value;
    }
    return "-";
}

function rosterPhotoVerificationHtml(verification, index) {
    const check = verification || { status: "pending", matches: [] };
    const first = check.matches?.[0];
    const terminal = first && typeof getTerminalMeta === "function"
        ? getTerminalMeta(first.terminalId)
        : null;
    const terminalLabel = terminal?.badge || String(first?.terminalId || "").toUpperCase();
    const vesselName = String(first?.vessel?.VSL_NM || "").trim();
    const correctionInfo = check.status === "user-confirmed"
        ? ` · OCR 원문 ${escapeShipCommentHtml(check.literalName)} → 사용자가 적용 ${escapeShipCommentHtml(check.officialName || vesselName)}`
        : "";
    const scheduleInfo = first
        ? ` · ${escapeShipCommentHtml(terminalLabel)} · 스케줄 ${escapeShipCommentHtml(vesselName)}${correctionInfo} · 입항 ${escapeShipCommentHtml(rosterPhotoScheduleValue(first.vessel, ["ATA", "ETB", "ATW"]))} · 출항 ${escapeShipCommentHtml(rosterPhotoScheduleValue(first.vessel, ["ATD", "ATC"]))}`
        : "";
    const more = check.matches?.length > 1 ? ` 외 ${check.matches.length - 1}척` : "";
    const labels = {
        pending: "⏳ 스케줄 교차 확인 대기",
        loading: "⏳ 전 터미널 입·출항 스케줄 확인 중",
        verified: "✅ OCR 선박명이 입·출항 스케줄과 일치",
        "user-confirmed": "✅ 사용자가 스케줄 선박명을 선택함",
        candidate: "🔎 스케줄에 비슷한 선박 후보가 있습니다 — OCR 원문 유지 중",
        ambiguous: "⚠️ 비슷한 스케줄 선박이 여러 척 — OCR 원문 유지, 직접 확인 필요",
        "date-mismatch": "⚠️ 같은 선박명이지만 입력 날짜의 입·출항 일정과 다름",
        "not-found": "⚠️ 해당 날짜 전 터미널 스케줄에서 선박명을 찾지 못함",
        "schedule-unavailable": "ℹ️ 스케줄 데이터가 없어 교차 확인 보류",
        "needs-date": "ℹ️ 날짜를 입력하면 입·출항 스케줄과 교차 확인",
        "missing-name": "ℹ️ 선박명을 입력하면 입·출항 스케줄과 교차 확인",
        stale: "✏️ 선박명 또는 날짜를 수정함 — 스케줄 재확인 필요"
    };
    const candidateAction = check.status === "candidate" && vesselName
        ? `<button type="button" class="roster-photo-schedule-apply" onclick="applyRosterPhotoScheduleName(${Number(index) || 0})">이 후보를 선박명에 적용</button>`
        : "";
    return `<div class="roster-photo-schedule-check is-${escapeShipCommentHtml(check.status || "pending")}"><span>${labels[check.status] || labels.pending}${scheduleInfo}${more}</span>${candidateAction}</div>`;
}

function summarizeRosterPhotoVerification(verifications) {
    const counts = (verifications || []).reduce((summary, item) => {
        summary[item?.status || "pending"] = (summary[item?.status || "pending"] || 0) + 1;
        return summary;
    }, {});
    const parts = [];
    if (counts.verified) parts.push(`일치 ${counts.verified}척`);
    if (counts["user-confirmed"]) parts.push(`사용자 선택 ${counts["user-confirmed"]}척`);
    if (counts.candidate) parts.push(`원문 유지 후보 ${counts.candidate}척`);
    if (counts.ambiguous || counts["date-mismatch"] || counts["not-found"]) parts.push(`확인 필요 ${(counts.ambiguous || 0) + (counts["date-mismatch"] || 0) + (counts["not-found"] || 0)}척`);
    if (counts["schedule-unavailable"]) parts.push(`스케줄 보류 ${counts["schedule-unavailable"]}척`);
    if (counts["needs-date"]) parts.push(`날짜 입력 필요 ${counts["needs-date"]}척`);
    return parts.join(" · ") || "확인할 선박명이 없습니다.";
}

async function verifyRosterPhotoVessels() {
    const rows = rosterRuntime.reviewRows.map((row) => ({ ...row }));
    const requestId = ++rosterRuntime.reviewVerificationRequestId;
    if (!rows.length) return [];
    const eligible = rows.filter((row) => row.date && row.vessel);
    if (!eligible.length) {
        const verifications = buildRosterPhotoVesselVerifications(rows, {});
        if (requestId !== rosterRuntime.reviewVerificationRequestId) return [];
        rosterRuntime.reviewVerifications = verifications;
        rosterRuntime.reviewVerificationState = "ready";
        renderRosterPhotoRows();
        setRosterPhotoStatus(`🗓️ ${summarizeRosterPhotoVerification(verifications)}`);
        return verifications;
    }

    rosterRuntime.reviewVerificationState = "loading";
    rosterRuntime.reviewVerifications = rows.map(() => ({ status: "loading", matches: [] }));
    renderRosterPhotoRows();
    let schedules = {};
    try {
        schedules = await collectRosterSchedules(eligible);
    } catch (error) {
        console.warn("[roster] photo schedule verification unavailable", error);
    }
    if (requestId !== rosterRuntime.reviewVerificationRequestId) return [];
    const verifications = buildRosterPhotoVesselVerifications(rows, schedules);
    markUserConfirmedRosterPhotoScheduleNames(rosterRuntime.reviewRows, verifications);
    syncRosterPhotoSearchEntries();
    rosterRuntime.reviewVerifications = verifications;
    rosterRuntime.reviewVerificationState = "ready";
    renderRosterPhotoRows();
    setRosterPhotoStatus(`🗓️ OCR 선박명을 원문 그대로 유지해 입·출항 스케줄과 교차 확인했습니다. 후보는 직접 선택해야 적용됩니다. ${summarizeRosterPhotoVerification(verifications)}`);
    trackAppEvent?.("actions", "roster_photo_schedule_verify");
    return verifications;
}

function rosterPhotoWorkerCountAuditHtml(audit) {
    if (!audit?.hasSourceCount) return "";
    const label = `👥 사진 작업자 칸 ${audit.sourceCount}명 · 출력 ${audit.outputCount}명`;
    return audit.isVerified
        ? `<div class="roster-photo-worker-count is-verified">${label} · 일치 확인</div>`
        : `<div class="roster-photo-worker-count is-mismatch">⚠️ ${label} · 불일치 ${audit.mismatches.length}개 확인 항목 — 원본 사진을 확인해 주세요. 현재 출력 결과로 계속 진행할 수 있습니다.</div>`;
}

function rosterPhotoOcrAuditHtml() {
    const audit = rosterRuntime.ocrAudit;
    if (!audit) return "";
    const textBox = rosterElement("rosterPhotoText");
    const rawText = textBox ? String(textBox.value || "") : String(rosterRuntime.recognizedText || "");
    audit.rawLineCount = countRosterOcrLines(rawText);
    audit.parsedRowCount = rosterRuntime.reviewRows.length;
    const sourceLabels = {
        "device-table": "기기 내 표 OCR",
        "device-text": "기기 내 텍스트 OCR",
        "cloud-table": "동의 후 온라인 표 OCR",
        "cloud-text": "동의 후 온라인 텍스트 OCR",
        manual: "직접 입력"
    };
    const regionCount = Number.isInteger(audit.detectedRegionCount)
        ? `<span>표 칸 감지 ${audit.detectedRegionCount}개</span>`
        : "";
    const confidence = Number(audit.confidence) > 0
        ? `<span>OCR 신뢰도 ${Math.round(Math.min(100, Number(audit.confidence)))}%</span>`
        : "";
    const counts = (rosterRuntime.reviewVerifications || []).reduce((summary, check) => {
        const key = check?.status || "pending";
        summary[key] = (summary[key] || 0) + 1;
        return summary;
    }, {});
    let scheduleSummary = "스케줄 대조 대기";
    if (rosterRuntime.reviewVerificationState === "loading") scheduleSummary = "스케줄 대조 중";
    else if (rosterRuntime.reviewVerificationState === "ready") {
        const confirmed = (counts.verified || 0) + (counts["user-confirmed"] || 0);
        const candidates = (counts.candidate || 0) + (counts.ambiguous || 0);
        const needsReview = (counts["date-mismatch"] || 0) + (counts["not-found"] || 0)
            + (counts["needs-date"] || 0) + (counts["missing-name"] || 0);
        const unavailable = counts["schedule-unavailable"] || 0;
        scheduleSummary = `스케줄 일치 ${confirmed}척 · 후보 ${candidates}척 · 확인 필요 ${needsReview}척${unavailable ? ` · 조회 보류 ${unavailable}척` : ""}`;
    }
    return `<div class="roster-photo-ocr-audit" aria-live="polite"><strong>판독 단계 요약 · ${sourceLabels[audit.source] || "OCR"}${audit.edited ? " · 원문 수정됨" : ""}</strong><div><span>OCR 원문 ${audit.rawLineCount}줄</span>${regionCount}<span>검토표 선박 행 ${rosterRuntime.reviewRows.length}척</span><span>${scheduleSummary}</span>${confidence}</div></div>`;
}

function rosterPhotoWorkerCountLabel(row) {
    const expected = Number.isInteger(row?.sourceWorkerCount) && row.sourceWorkerCount >= 0
        ? row.sourceWorkerCount
        : null;
    const actual = Array.isArray(row?.workers) ? row.workers.length : 0;
    if (expected === null) return `작업자 (${actual}명)`;
    return expected === actual
        ? `작업자 (사진 칸 ${expected}명 · 출력 ${actual}명 ✓)`
        : `작업자 (사진 칸 ${expected}명 · 출력 ${actual}명 ⚠)`;
}

function renderRosterPhotoRows() {
    const container = rosterElement("rosterPhotoRows");
    if (!container) return;
    const auditHtml = rosterPhotoOcrAuditHtml();
    if (!rosterRuntime.reviewRows.length) {
        const message = rosterRuntime.photoModeEngaged
            ? "명단을 찾지 못했습니다. OCR 원문을 확인하고 새 명단을 만들기 전까지 시작용 명단은 검색하지 않습니다."
            : "명단을 찾지 못했습니다. 선박명·날짜·이름이 보이게 사진을 찍거나 직접 입력해 주세요.";
        container.innerHTML = `${auditHtml}<div class="roster-photo-empty">${message}</div>`;
        return;
    }
    const warningHtml = (rosterRuntime.reviewWarnings || []).map((warning) => `<div class="roster-photo-warn">⚠️ ${escapeShipCommentHtml(warning)}</div>`).join("");
    const workerCountAudit = rosterRuntime.workerCountAudit || auditRosterPhotoWorkerCounts(rosterRuntime.reviewRows, rosterRuntime.sourceUnassignedWorkerCount, rosterRuntime.sourceWorkerCount);
    const workerCountHtml = rosterPhotoWorkerCountAuditHtml(workerCountAudit);
    const state = rosterRuntime.reviewVerificationState;
    const refreshLabel = state === "loading" ? "🗓️ 스케줄 확인 중…" : "🗓️ 입·출항 스케줄로 선박명 다시 확인";
    const rows = rosterRuntime.reviewRows.map((row, index) => {
        const sourceText = String(row.sourceOcrLine || row.sourceOcrVessel || "").trim();
        const sourceHtml = sourceText
            ? `<div class="roster-photo-source-text"><strong>해당 행 OCR 원문</strong><span>${escapeShipCommentHtml(sourceText)}</span></div>`
            : "";
        return `<div class="roster-photo-row">
        ${sourceHtml}
        <div class="roster-photo-row-grid">
            <label>날짜<input type="date" value="${escapeShipCommentHtml(row.date)}" onchange="updateRosterPhotoRow(${index}, 'date', this.value)"></label>
            <label>선박명<input type="text" value="${escapeShipCommentHtml(row.vessel)}" onchange="updateRosterPhotoRow(${index}, 'vessel', this.value)"></label>
            <label>시간<input type="text" value="${escapeShipCommentHtml(row.time)}" placeholder="HH:MM" onchange="updateRosterPhotoRow(${index}, 'time', this.value)"></label>
            <label>회사<input type="text" value="${escapeShipCommentHtml(row.company)}" onchange="updateRosterPhotoRow(${index}, 'company', this.value)"></label>
        </div>
        ${rosterPhotoVerificationHtml(rosterRuntime.reviewVerifications[index], index)}
        <label class="roster-photo-row-workers">${rosterPhotoWorkerCountLabel(row)}<textarea rows="2" onchange="updateRosterPhotoRow(${index}, 'workers', this.value)">${escapeShipCommentHtml(row.workers.join(", "))}</textarea></label>
        <button type="button" class="roster-photo-row-del" onclick="removeRosterPhotoRow(${index})">이 줄 삭제</button>
    </div>`;
    }).join("");
    const finderReadyHtml = workerCountAudit.hasSourceCount && !workerCountAudit.isVerified
        ? `<div class="roster-photo-search-ready is-warning">⚠️ 사진 작업자 인원과 출력 인원이 다릅니다. 원본 사진 확인을 권장하지만, 현재 출력 결과로 찾기·저장을 계속할 수 있습니다.</div>`
        : `<div class="roster-photo-search-ready">🔍 읽은 이름·관련 단어·선박명은 지금 바로 아래 찾기에서 검색할 수 있습니다. 임금·근무일지는 찾기 결과에서만 등록됩니다.</div>`;
    container.innerHTML = `${auditHtml}${warningHtml}${workerCountHtml}<div class="roster-photo-schedule-toolbar"><span>OCR 원문과 날짜별 전 터미널 스케줄을 대조합니다. 스케줄 후보는 선박명에 자동 반영하지 않으며, 적용하려면 후보 버튼을 직접 눌러 주세요.</span><button type="button" onclick="verifyRosterPhotoVessels()"${state === "loading" ? " disabled" : ""}>${refreshLabel}</button></div>${rows}${finderReadyHtml}<label class="roster-photo-persist"><input type="checkbox" id="rosterPhotoPersist"${rosterRuntime.persistPhotoText ? " checked" : ""}> 이 명단을 내 기기에 저장 (사진은 저장하지 않습니다)</label><button type="button" class="roster-photo-apply-btn" onclick="applyRosterPhotoRoster()">💾 검토한 행을 사진 명단으로 저장 (${rosterRuntime.reviewRows.length}행)</button>`;
}

function updateRosterPhotoRow(index, field, value) {
    const row = rosterRuntime.reviewRows[index];
    if (!row) return;
    if (field === "workers") row.workers = mergeWorkers([], String(value || "").split(/[,、\n]+/).map((item) => item.trim()).filter(Boolean));
    else if (field === "date") row.date = /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
    else row[field] = String(value || "").trim();
    if (field === "date" || field === "vessel") {
        delete row.scheduleNameSource;
        // 이전 값으로 진행 중이던 비동기 스케줄 조회 결과가 새 입력을 덮어쓰지 않게 합니다.
        rosterRuntime.reviewVerificationRequestId += 1;
        rosterRuntime.reviewVerifications[index] = { status: "stale", matches: [] };
        rosterRuntime.reviewVerificationState = "stale";
    }
    syncRosterPhotoSearchEntries();
    renderRosterPhotoRows();
}

function removeRosterPhotoRow(index) {
    rosterRuntime.reviewVerificationRequestId += 1;
    rosterRuntime.reviewRows.splice(index, 1);
    rosterRuntime.reviewVerifications.splice(index, 1);
    syncRosterPhotoSearchEntries();
    renderRosterPhotoRows();
}

function clearRosterSearchResult() {
    rosterRuntime.finderResults = [];
    const output = rosterElement("rosterFinderResults");
    if (output) output.innerHTML = "";
}

function applyRosterPhotoRoster() {
    const workerCountAudit = auditRosterPhotoWorkerCounts(rosterRuntime.reviewRows, rosterRuntime.sourceUnassignedWorkerCount, rosterRuntime.sourceWorkerCount);
    rosterRuntime.workerCountAudit = workerCountAudit;
    const usable = rosterRuntime.reviewRows
        .map((row) => normalizeRosterAssignment(row, "photo"))
        .filter((row) => row && row.date && row.vessel);
    if (!usable.length) {
        showToast("⚠️ 날짜와 선박명을 확인한 뒤 명단을 적용해 주세요.");
        return false;
    }
    const before = rosterRuntime.photoAssignments.length;
    rosterRuntime.photoModeEngaged = true;
    // 저장한 행은 같은 날짜·선박·작업자와 비교하지 않고 입력 순서 그대로 누적합니다.
    appendRosterPhotoEntries(usable);
    // 현재 검토 행은 이미 찾기에 임시 반영되어 있으므로, 저장본과 이중으로 검색되지 않게 합니다.
    rosterRuntime.searchableReviewAssignments = [];
    const persistCheck = rosterElement("rosterPhotoPersist");
    const persist = Boolean(persistCheck?.checked);
    if (persist) savePhotoRosterToDevice();
    else {
        try {
            localStorage.removeItem(ROSTER_STORAGE.photo);
            localStorage.removeItem(ROSTER_STORAGE.persist);
        } catch (error) { /* non-persistent mode is still usable */ }
        rosterRuntime.persistPhotoText = false;
    }
    clearRosterSearchResult();
    renderRosterPhotoSaved();
    const total = rosterRuntime.photoAssignments.length;
    showToast(before
        ? `✅ 검토한 사진 명단 ${usable.length}행을 추가 저장했습니다. 현재 ${total}행을 검색합니다.${persist ? " (이 기기에 저장됨)" : ""}`
        : `✅ 검토한 사진 명단 ${total}행을 저장했습니다.${persist ? " (이 기기에 저장됨)" : ""}`);
    trackAppEvent?.("actions", "roster_photo_saved");
    if (rosterElement("rosterFinderInput")?.value.trim()) searchRosterVessels();
    return true;
}

function renderRosterPhotoSaved() {
    const container = rosterElement("rosterPhotoSaved");
    if (!container) return;
    const list = rosterRuntime.photoAssignments;
    if (!list.length) {
        container.innerHTML = "";
        return;
    }
    const items = list.slice(0, 12).map((row, index) => `<div class="roster-photo-saved-item"><span>${escapeShipCommentHtml(row.date)} · ${escapeShipCommentHtml(row.vessel)}${row.workers.length ? ` · ${escapeShipCommentHtml(row.workers.join(", "))}` : ""}</span><button type="button" onclick="deleteSavedPhotoRosterEntry(${index})">삭제</button></div>`).join("");
    container.innerHTML = `<div class="roster-photo-saved-head">📋 사진으로 만든 검토 명단 ${list.length}행${rosterRuntime.persistPhotoText ? " · 내 기기에 저장됨" : " · 이번 탭에서만"}</div>${items}${list.length > 12 ? `<div class="roster-photo-empty">…외 ${list.length - 12}행</div>` : ""}<button type="button" class="roster-photo-clear-all" onclick="clearPhotoRosterEntries()">🗑️ 사진 명단 모두 지우기</button>`;
}

function deleteSavedPhotoRosterEntry(index) {
    if (!rosterRuntime.photoAssignments[index]) return;
    rosterRuntime.photoAssignments.splice(index, 1);
    if (rosterRuntime.persistPhotoText) savePhotoRosterToDevice();
    renderRosterPhotoSaved();
    clearRosterSearchResult();
    showToast("🗑️ 사진 명단에서 삭제했습니다.");
}

function clearPhotoRosterEntries() {
    clearPhotoRosterFromDevice();
    rosterRuntime.reviewRows = [];
    rosterRuntime.reviewWarnings = [];
    rosterRuntime.reviewVerifications = [];
    rosterRuntime.reviewVerificationState = "idle";
    rosterRuntime.reviewVerificationRequestId += 1;
    rosterRuntime.searchableReviewAssignments = [];
    rosterRuntime.photoModeEngaged = false;
    clearRosterSearchResult();
    renderRosterPhotoSaved();
    renderRosterPhotoRows([]);
    showToast("🗑️ 사진 명단을 모두 지웠습니다.");
}

function renderRosterFinderHint() {
    const output = rosterElement("rosterFinderResults");
    if (!output) return;
    output.innerHTML = `<div class="roster-finder-empty">사진에서 선박명 아래에 나열된 작업자 이름(이춘학 등)·관련 단어 또는 선박명을 입력하면, 검색어와 일치한 작업자·관련어와 해당 선박의 날짜·시간·전 터미널 차트·스케줄만 표시하고 임금계산기·근무일지에 등록합니다. 같은 행도 자동으로 제외하지 않습니다.</div>`;
}

function clearRosterPhoto() {
    releaseRosterPhotoObjectUrl();
    rosterRuntime.cloudOcrEnabled = false;
    const cloudOcrButton = rosterElement("rosterPhotoCloudOcrBtn");
    if (cloudOcrButton) { cloudOcrButton.classList.add("hidden"); cloudOcrButton.disabled = true; }
    rosterRuntime.recognizedText = "";
    rosterRuntime.ocrAudit = null;
    rosterRuntime.tableOcrParsed = null;
    rosterRuntime.sourceUnassignedWorkerCount = 0;
    rosterRuntime.sourceWorkerCount = null;
    rosterRuntime.workerCountAudit = { hasSourceCount: false, sourceCount: 0, outputCount: 0, mismatches: [], isVerified: true };
    rosterRuntime.reviewRows = [];
    rosterRuntime.reviewWarnings = [];
    rosterRuntime.reviewVerifications = [];
    rosterRuntime.reviewVerificationState = "idle";
    rosterRuntime.reviewVerificationRequestId += 1;
    rosterRuntime.searchableReviewAssignments = [];
    rosterRuntime.photoModeEngaged = false;
    const preview = rosterElement("rosterPhotoPreview");
    if (preview) preview.removeAttribute("src");
    rosterElement("rosterPhotoPreviewWrap")?.classList.add("hidden");
    rosterElement("rosterPhotoTextDetails")?.classList.add("hidden");
    const text = rosterElement("rosterPhotoText");
    if (text) text.value = "";
    ["rosterPhotoInput", "rosterPhotoGalleryInput"].forEach((id) => {
        const input = rosterElement(id);
        if (input) input.value = "";
    });
    const rows = rosterElement("rosterPhotoRows");
    if (rows) rows.innerHTML = "";
    const readButton = rosterElement("rosterPhotoOcrBtn");
    const clearButton = rosterElement("rosterPhotoClearBtn");
    if (readButton) readButton.disabled = true;
    if (clearButton) clearButton.disabled = true;
    setRosterPhotoStatus("사진을 지웠습니다. 사진은 이 기기의 메모리에서만 처리되며 저장되지 않습니다.");
}

/** OCR·자동배치 검토와 찾기 조건만 초기화합니다. 저장한 사진·직접 명단은 보존합니다. */
function resetRosterFinder() {
    // 기존 검색 또는 스케줄 조회가 초기화 후 결과를 다시 그리지 못하게 합니다.
    rosterRuntime.requestId += 1;
    clearRosterPhoto();
    clearRosterSearchResult();
    ["rosterFinderInput", "rosterExtraWorker", "rosterExtraVessel", "rosterExtraDate"].forEach((id) => {
        const input = rosterElement(id);
        if (input) input.value = "";
    });
    renderRosterPhotoSaved();
    renderRosterExtraList();
    renderRosterFinderHint();
    setRosterPhotoStatus("OCR 검토와 찾기 조건을 초기화했습니다. 저장한 사진 명단은 그대로 유지됩니다.");
    showToast("↺ OCR·자동배치 검토와 찾기 조건을 초기화했습니다. 저장한 명단은 유지됩니다.");
    trackAppEvent?.("actions", "roster_finder_reset");
}
