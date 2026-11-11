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
const ROSTER_VESSEL_PREFIXES = new Set(["CMA", "COSCO", "EVER", "EVERGREEN", "HAPAG", "HMM", "KMTC", "MAERSK", "MSC", "ONE", "OOCL", "PIL", "SITC", "SM", "WAN", "YANG", "ZIM"]);
const ROSTER_NAME_NOISE = new Set(["지원", "명단", "작업", "선박", "배치", "입항", "출항", "접안", "선석", "부산", "신항", "터미널", "근무", "당일", "전체", "이름", "비고", "합계", "시간", "회사", "야간", "주간", "조출", "잔업", "휴무", "연장", "정상", "확정", "예정", "변경", "공지", "안내", "첨부", "사진", "명령", "작성", "확인", "담당", "기사", "본부", "센터", "지점", "계획", "실시"]);

const rosterRuntime = {
    hydrated: false,
    photoModeEngaged: false,
    persistPhotoText: false,
    photoAssignments: [],
    reviewRows: [],
    finderResults: [],
    activeImageUrl: "",
    recognizedText: "",
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

function rosterAssignmentKey(row) {
    return `${String(row?.date || "")}|${normalizeRosterVesselKey(row?.vessel)}`;
}

/** 같은 날짜·선박 안에서 같은 작업자일 때만 같은 배정으로 봅니다. */
function rosterWorkerAssignmentKey(row, worker) {
    return `${rosterAssignmentKey(row)}|${normalizeRosterWorkerName(worker)}`;
}

function normalizeRosterAssignment(row, source) {
    const vessel = String(row?.vessel || "").trim();
    if (!vessel) return null;
    const workers = Array.isArray(row?.workers) ? row.workers : [row?.worker];
    const dedupedWorkers = [...new Map(workers
        .map((name) => String(name || "").trim())
        .filter(Boolean)
        .map((name) => [normalizeRosterWorkerName(name), name])).values()];
    return {
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")) ? String(row.date) : "",
        vessel,
        time: String(row?.time || "").trim(),
        company: String(row?.company || "").trim(),
        support: String(row?.support || "").trim(),
        group: String(row?.group || "").trim(),
        workers: dedupedWorkers,
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
    return rosterRuntime.photoAssignments.slice();
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
    const assignments = new Map();
    for (const source of sources) {
        for (const raw of source) {
            const row = normalizeRosterAssignment(raw, raw?.source);
            if (!row || !row.workers.length) continue;
            const key = rosterAssignmentKey(row);
            const existing = assignments.get(key);
            if (!existing) {
                assignments.set(key, row);
                continue;
            }
            // 같은 선박의 다른 작업자는 별도 배정입니다. 한 선박 카드에 모두 보존하되,
            // 같은 이름만 정규화해 한 번으로 합칩니다.
            assignments.set(key, { ...existing, workers: mergeWorkers(existing.workers, row.workers) });
        }
    }
    return [...assignments.values()];
}

/**
 * 작업자 검색은 정확한 이름뿐 아니라 입력한 글자가 포함된 이름도 찾습니다.
 * 예: "김근우" → "김근우"와 "김근우1" 배정을 모두 반환합니다.
 */
function findRosterAssignmentsByWorker(query) {
    const key = normalizeRosterWorkerName(query);
    if (!key) return [];
    return getAllRosterAssignments().filter((row) =>
        row.workers.some((worker) => normalizeRosterWorkerName(worker).includes(key))
    );
}

function findRosterAssignmentsByVessel(query) {
    const key = normalizeRosterVesselKey(query);
    return key ? getAllRosterAssignments().filter((row) => {
        const vesselKey = normalizeRosterVesselKey(row.vessel);
        return vesselKey === key || vesselKey.includes(key) || key.includes(vesselKey);
    }) : [];
}

/** 작업자·선박명 두 검색 결과를 합쳐 날짜·선박 단위로 한 번만 표시합니다. */
function findAllRosterAssignments(query) {
    const workerMatches = findRosterAssignmentsByWorker(query);
    const vesselMatches = findRosterAssignmentsByVessel(query);
    const unique = new Map();
    [...workerMatches, ...vesselMatches].forEach((assignment) => {
        unique.set(rosterAssignmentKey(assignment), assignment);
    });
    return {
        assignments: [...unique.values()],
        mode: workerMatches.length && vesselMatches.length ? "작업자·선박" : (workerMatches.length ? "작업자" : "선박")
    };
}

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

function worklogVesselNamesFor(date) {
    const saved = adminWorkLogs?.[date]?.shipName ? parseWorklogShipNames(adminWorkLogs[date].shipName) : [];
    const current = getActiveWorkLogDate() === date ? parseWorklogShipNames(rosterElement("logShipName")?.value) : [];
    return dedupeVesselNameList([...saved, ...current]).unique;
}

function isVesselRegisteredOnDate(vessel, date) {
    const key = normalizeRosterVesselKey(vessel);
    return Boolean(key && date && worklogVesselNamesFor(date).some((name) => normalizeRosterVesselKey(name) === key));
}

function splitNewAndDuplicateVessels(candidateNames, currentNames) {
    const existing = new Set((currentNames || []).map(normalizeRosterVesselKey));
    const toAdd = [];
    const skipped = [];
    for (const name of candidateNames || []) {
        const clean = String(name || "").trim();
        if (!clean) continue;
        const key = normalizeRosterVesselKey(clean);
        if (existing.has(key)) skipped.push(clean);
        else {
            existing.add(key);
            toAdd.push(clean);
        }
    }
    return { toAdd, skipped };
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
        : " 이름 철자 또는 선박명을 확인하거나 ‘내 명단 추가’로 배정을 넣어 주세요.";
    return `<div class="roster-finder-empty">🔍 '${escapeShipCommentHtml(query)}' 명단에서 찾지 못했습니다.${hint}</div>`;
}

async function searchRosterVessels() {
    if (!isRosterFinderUnlocked()) return unlockRosterFinder();
    const query = String(rosterElement("rosterFinderInput")?.value || "").trim();
    const output = rosterElement("rosterFinderResults");
    if (!query) return showToast("작업자 이름 또는 선박명을 입력해 주세요.");
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

function renderRosterFinderResults(plan, query, mode) {
    const output = rosterElement("rosterFinderResults");
    if (!output) return;
    const foundCount = plan.filter((item) => item.found).length;
    const registered = plan.filter((item) => isVesselRegisteredOnDate(item.assignment.vessel, item.assignment.date)).length;
    const cards = plan.map((item, index) => {
        const assignment = item.assignment;
        const meta = item.terminalId ? getTerminalMeta(item.terminalId) : null;
        const terminal = item.terminalId ? terminalQuickConfig[item.terminalId] || {} : {};
        const done = isVesselRegisteredOnDate(assignment.vessel, assignment.date);
        const badge = meta ? `<span class="roster-finder-badge" style="background:${meta.color};">${meta.badge}</span>` : "";
        const doneBadge = done ? `<span class="roster-finder-registered-badge">✅ 등록됨</span>` : "";
        const links = item.terminalId
            ? `<a href="${terminal.schedule || "#"}" target="_blank" rel="noopener noreferrer" class="roster-finder-link">🗓️ 스케줄 ↗</a><a href="${terminal.chart || "#"}" target="_blank" rel="noopener noreferrer" class="roster-finder-link">📊 차트 ↗</a>`
            : "";
        const secondary = [assignment.time && `명단 ${assignment.time}`, assignment.company, assignment.support, assignment.group].filter(Boolean).map(escapeShipCommentHtml).join(" · ");
        const status = `${rosterResultScheduleDescription(item)}${done ? " · ✅ 이미 근무일지에 등록됨 (중복 등록 안 함)" : ""}`;
        return `<div class="roster-finder-card${item.found ? "" : " is-missing"}${done ? " is-registered" : ""}">
            <div class="roster-finder-card-head">${badge}${doneBadge}<strong>🚢 ${escapeShipCommentHtml(assignment.vessel)}</strong><span>${escapeShipCommentHtml(assignment.date)}${secondary ? ` · ${secondary}` : ""}</span></div>
            <div class="roster-finder-card-sub">${status}</div>
            <div class="roster-finder-card-actions">
                <button type="button" onclick="registerRosterResultToWage(${index})"${done ? " disabled" : ""}>🧮 임금계산기 등록</button>
                <button type="button" onclick="registerRosterResultToWorkLog(${index})"${done ? " disabled" : ""}>📅 근무일지 등록</button>
                ${links}
            </div>
        </div>`;
    }).join("");
    const allDone = plan.length > 0 && registered === plan.length;
    const action = plan.length > 1
        ? (allDone
            ? `<button type="button" class="roster-finder-all-btn is-done" disabled>✅ 모두 이미 근무일지에 등록됨</button>`
            : `<button type="button" class="roster-finder-all-btn" onclick="registerAllRosterResults()">✨ 전체 자동 등록 (임금계산기 + 근무일지${foundCount ? " · 임금 자동 계산" : ""}${registered ? " · 중복 제외" : ""})</button>`)
        : "";
    output.innerHTML = `<div class="roster-finder-summary">🔍 '${escapeShipCommentHtml(query)}' (${mode}) · ${plan.length}척 배정 · 스케줄 매칭 ${foundCount}척${registered && !allDone ? ` · 이미 등록 ${registered}척 제외` : ""}</div>${cards}${action}`;
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
    const alreadySelected = selectedWageVessels.some((selected) => normalizeWorklogShipKey(selected.name) === normalizeWorklogShipKey(vesselName));
    if (alreadySelected) {
        showToast(`🧮 ${vesselName}은(는) 이미 임금계산기에 있습니다.`);
        rosterElement("wage-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
    }
    if (item.found) {
        if (item.terminalId && item.terminalId !== selectedScheduleTerminal) selectScheduleTerminal(item.terminalId);
        applyWageScheduleShip(item.vessel, item.assignment.date, item.terminalId || selectedScheduleTerminal);
    } else {
        const input = rosterElement("wageShipName");
        if (input) {
            input.value = dedupeVesselNameList([...parseWorklogShipNames(input.value), vesselName]).unique.slice(0, MAX_WORK_VESSELS).join(" / ");
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
    if (isVesselRegisteredOnDate(vesselName, item.assignment.date)) return false;

    const merged = dedupeVesselNameList([...parseWorklogShipNames(input.value), vesselName]).unique;
    input.value = merged.slice(0, MAX_WORK_VESSELS).join(" / ");
    if (item.found) {
        worklogVesselMeta.set(normalizeWorklogShipKey(vesselName), {
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
    } else {
        showToast(`📅 ${item.assignment.vessel}은(는) 이미 ${item.assignment.date} 근무일지에 있어 건너뛰었습니다.`);
    }
    rosterElement("dailyLogForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function registerAllRosterResults() {
    const plan = rosterRuntime.finderResults.slice().sort((a, b) => a.assignment.date.localeCompare(b.assignment.date));
    if (!plan.length) return;

    ensureDashboardCardOpen("wage-card");
    const selectedNames = new Set(selectedWageVessels.map((selected) => normalizeWorklogShipKey(selected.name)));
    const scheduleMatches = plan.filter((item) => item.found).slice(0, MAX_WORK_VESSELS);
    const wageSkipped = scheduleMatches.filter((item) => selectedNames.has(normalizeWorklogShipKey(item.assignment.vessel))).map((item) => item.assignment.vessel);
    const wageNew = scheduleMatches.filter((item) => !selectedNames.has(normalizeWorklogShipKey(item.assignment.vessel)));
    if (wageNew.length) {
        const terminalId = wageNew[0].terminalId;
        if (terminalId && terminalId !== selectedScheduleTerminal) selectScheduleTerminal(terminalId);
        wageNew.forEach((item) => applyWageScheduleShip(item.vessel, item.assignment.date, item.terminalId || selectedScheduleTerminal));
    } else if (!scheduleMatches.length) {
        const input = rosterElement("wageShipName");
        if (input) {
            input.value = dedupeVesselNameList([...parseWorklogShipNames(input.value), ...plan.map((item) => item.assignment.vessel)]).unique.slice(0, MAX_WORK_VESSELS).join(" / ");
            onWageShipNameChange(input.value);
        }
    }

    ensureDashboardCardOpen("log-card");
    const added = [];
    const logSkipped = [];
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
        const existing = parseWorklogShipNames(input.value);
        const split = splitNewAndDuplicateVessels(rows.map((item) => item.assignment.vessel), existing);
        logSkipped.push(...split.skipped);
        for (const vesselName of split.toAdd.slice(0, Math.max(0, MAX_WORK_VESSELS - existing.length))) {
            const item = rows.find((row) => normalizeWorklogShipKey(row.assignment.vessel) === normalizeWorklogShipKey(vesselName));
            if (item && attachRosterResultToOpenLog(item)) added.push(vesselName);
        }
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
    const skipped = [...new Set([...wageSkipped, ...logSkipped])];
    const names = added.length ? added.join(" / ") : plan.map((item) => item.assignment.vessel).join(" / ");
    const suffix = skipped.length ? ` · ${skipped.join(", ")}은(는) 이미 등록되어 제외했습니다` : "";
    showToast(selectedHaveHours
        ? `✨ ${names}을(를) 임금계산기·근무일지에 등록하고 임금을 계산했습니다${suffix}. 근무일지를 저장해 주세요.`
        : `✨ ${names}을(를) 임금계산기·근무일지에 등록했습니다${suffix}. 시간은 확인 후 계산해 주세요.`);
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
    const workerAssignmentKey = rosterWorkerAssignmentKey(entry, entry.workers[0]);
    const entries = getRosterExtraEntries();
    const duplicate = entries.some((saved) => saved.workers.some((savedWorker) =>
        rosterWorkerAssignmentKey(saved, savedWorker) === workerAssignmentKey
    ));
    if (duplicate) {
        showToast(`⚠️ ${worker}은(는) ${vessel} ${date} 배정에 이미 있습니다.`);
        return;
    }
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

function rosterLatinWords(value) {
    return String(value || "").match(/[A-Za-z][A-Za-z0-9&'.-]*/g) || [];
}

function isLikelyUnrecognizedVesselHeading(line) {
    const words = rosterLatinWords(line);
    if (words.length < 2) return false;
    const hasTime = Boolean(readTimeFromOcrLine(line));
    const uppercaseLabel = words.every((word) => word === word.toUpperCase());
    return hasTime || uppercaseLabel || ROSTER_VESSEL_PREFIXES.has(words[0].toUpperCase());
}

function pickVesselFromOcrLine(line) {
    const candidates = String(line).match(/[A-Za-z][A-Za-z0-9&'.-]*(?:\s+[A-Za-z0-9&'.-]{2,})*/g) || [];
    return candidates.reduce((winner, candidate) => {
        const words = candidate.split(/\s+/).map((word) => word.replace(/[.'-]+$/, "")).filter((word) => /^[A-Za-z][A-Za-z0-9&'.-]*$/.test(word) && word.length > 1);
        const name = words.join(" ").trim().toUpperCase();
        const isTerminal = /^(BNCT|HJNC|DGT|PNC|HMM|PNIT|BPTC|HBCT|BCT|KML|KMT)$/.test(name);
        const isCompany = ROSTER_COMPANIES.some((company) => company.toUpperCase() === name);
        const hasKnownPrefix = ROSTER_VESSEL_PREFIXES.has(words[0]?.toUpperCase());
        const enoughLetters = words.some((word) => word.length >= 4);
        const vesselLikeShortName = words.length >= 2 && (hasKnownPrefix || Boolean(readTimeFromOcrLine(line)));
        return !name || isTerminal || isCompany || (!enoughLetters && !vesselLikeShortName) || name.length <= winner.length ? winner : name;
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

function getKnownRosterWorkerNames() {
    const names = ROSTER_SEED_ASSIGNMENTS.flatMap((assignment) => assignment.workers || []);
    // 기존 동료 선택표가 있는 화면에서는 그 이름도 보정 후보로 함께 씁니다.
    if (typeof HANJIN_COWORKER_ROSTER !== "undefined" && Array.isArray(HANJIN_COWORKER_ROSTER)) {
        names.push(...HANJIN_COWORKER_ROSTER.map((worker) => worker?.name));
    }
    return [...new Map(names
        .map((name) => String(name || "").trim())
        .filter(Boolean)
        .map((name) => [normalizeRosterWorkerName(name), name])).values()]
        .sort((left, right) => normalizeRosterWorkerName(right).length - normalizeRosterWorkerName(left).length);
}

function escapeRosterRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * OCR이 "이 수 열"처럼 이름 안에 공백을 넣은 경우만 시작용 명단의 이름으로 복구합니다.
 * 공백을 전부 지워서 찾으면 "이 수 열차" 같은 일반 문구도 이수열로 오인할 수 있어,
 * 한글·숫자 경계 안의 완전한 이름이고 실제로 이름 내부에 공백이 있을 때만 허용합니다.
 */
function recoverFragmentedRosterWorkerNames(value) {
    const source = String(value || "").normalize("NFKC");
    if (!source) return [];
    const matches = [];
    getKnownRosterWorkerNames().forEach((name) => {
        const normalized = normalizeRosterWorkerName(name);
        if (!/^[가-힣]{2,4}\d?$/.test(normalized)) return;
        const spacedName = Array.from(normalized).map(escapeRosterRegex).join("\\s*");
        const pattern = new RegExp(`(^|[^가-힣0-9])(${spacedName})(?=$|[^가-힣0-9])`, "g");
        let match;
        while ((match = pattern.exec(source))) {
            const detected = match[2] || "";
            if (!/\s/.test(detected)) continue;
            const start = match.index + (match[1] || "").length;
            matches.push({ name, normalized, start, end: start + detected.length });
        }
    });
    const selected = matches
        .sort((left, right) => left.start - right.start || right.normalized.length - left.normalized.length)
        .reduce((accepted, candidate) => {
            const overlaps = accepted.some((item) => candidate.start < item.end && candidate.end > item.start);
            if (!overlaps) accepted.push(candidate);
            return accepted;
        }, []);
    if (!selected.length) return [];

    // 이름 외에 '근무', '명단' 같은 머리말만 남는 줄은 작업자 행으로 추정하지 않습니다.
    const masked = selected.reduce((text, candidate) => `${text.slice(0, candidate.start)}${" ".repeat(candidate.end - candidate.start)}${text.slice(candidate.end)}`, source);
    const compactRemainder = masked.replace(/[^가-힣]/g, "");
    if ([...ROSTER_NAME_NOISE].some((noise) => compactRemainder.includes(noise))) return [];
    return selected.map((candidate) => candidate.name);
}

function pickWorkersFromOcrLine(line) {
    const withoutMetadata = String(line)
        .replace(/(20\d{2})\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?/g, " ")
        .replace(/(?:^|[^\d:])\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?(?![\d:])/g, " ")
        .replace(/\d{1,2}\s*:\s*\d{2}/g, " ")
        .replace(/\d{1,2}\s*시(?!\s*간)/g, " ")
        .replace(/[A-Za-z][A-Za-z0-9&'.-]*/g, " ")
        .replace(/\([1-9]\)|\d{1,2}\s*조(?![가-힣])|[①-⑨]/g, " ")
        .replace(/지원/g, " ");
    const direct = withoutMetadata.split(/[\s,/、]+/)
        .map((value) => value.trim())
        .filter((value) => /^[가-힣]{2,4}\d?$/.test(value))
        .filter((value) => !ROSTER_NAME_NOISE.has(value) && !ROSTER_NAME_NOISE.has(value.replace(/\d$/, "")))
        .filter((value) => !ROSTER_COMPANIES.includes(value) && !ROSTER_COMPANIES.includes(value.replace(/\d$/, "")));
    return mergeWorkers(direct, recoverFragmentedRosterWorkerNames(withoutMetadata));
}

function mergeWorkers(existing, incoming) {
    const values = new Map((existing || []).map((name) => [normalizeRosterWorkerName(name), name]));
    (incoming || []).forEach((name) => {
        const key = normalizeRosterWorkerName(name);
        if (key && !values.has(key)) values.set(key, name);
    });
    return [...values.values()];
}

function parseRosterPhotoText(rawText, options) {
    const settings = options || {};
    const fallbackYear = Number(settings.defaultYear) || new Date().getFullYear();
    const suppliedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(settings.defaultDate || "")) ? String(settings.defaultDate) : "";
    const lines = cleanOcrText(rawText).split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return { entries: [], warnings: ["글자가 없습니다. 사진을 다시 고르거나 직접 입력해 주세요."] };

    const result = { date: suppliedDate, current: null, byKey: new Map(), entries: [], unrecognizedVesselHeadings: 0 };
    lines.forEach((line) => {
        const date = readDateFromOcrLine(line, fallbackYear);
        if (date) result.date = date;
        const workers = pickWorkersFromOcrLine(line);
        const vessel = pickVesselFromOcrLine(line);
        if (!vessel) {
            // OCR이 다음 선박 머리말을 읽지 못했을 때, 이어지는 이름이 직전 선박으로
            // 잘못 붙는 것을 막습니다. 이런 경우에는 검토 경고를 보여 직접 고칠 수 있습니다.
            if (isLikelyUnrecognizedVesselHeading(line)) {
                result.current = null;
                result.unrecognizedVesselHeadings += 1;
                return;
            }
            if (result.current) result.current.workers = mergeWorkers(result.current.workers, workers);
            return;
        }
        const key = `${result.date}|${normalizeRosterVesselKey(vessel)}`;
        let row = result.byKey.get(key);
        const discovered = {
            date: result.date,
            vessel,
            time: readTimeFromOcrLine(line),
            company: pickCompanyFromOcrLine(line),
            support: pickSupportFromOcrLine(line),
            group: pickGroupFromOcrLine(line),
            workers: [],
            source: "photo"
        };
        if (!row) {
            row = discovered;
            result.byKey.set(key, row);
            result.entries.push(row);
        } else {
            ["time", "company", "support", "group"].forEach((field) => { if (!row[field] && discovered[field]) row[field] = discovered[field]; });
        }
        row.workers = mergeWorkers(row.workers, workers);
        result.current = row;
    });

    const warnings = [];
    if (!result.entries.length) warnings.push("선박명을 찾지 못했습니다. 선박명은 영문(예: PRESIDENT CARTER)으로 적어 주세요.");
    const missingDates = result.entries.filter((row) => !row.date).length;
    const missingWorkers = result.entries.filter((row) => !row.workers.length).length;
    if (missingDates) warnings.push(`${missingDates}척은 날짜를 찾지 못했습니다. 검토 표에서 날짜를 채워 주세요.`);
    if (missingWorkers) warnings.push(`${missingWorkers}척은 작업자 이름을 찾지 못했습니다. 사진을 보며 직접 입력해 주세요.`);
    if (result.unrecognizedVesselHeadings) {
        warnings.push(`${result.unrecognizedVesselHeadings}개 선박 머리말을 확실히 읽지 못해, 뒤 이름을 앞선 선박에 넣지 않았습니다. 원문을 수정하거나 ‘내 명단 추가’로 해당 배정을 넣어 주세요.`);
    }
    return { entries: result.entries, warnings };
}

function mergeRosterPhotoEntries(rows) {
    const positions = new Map();
    const output = [];
    for (const raw of rows || []) {
        const row = normalizeRosterAssignment(raw, "photo");
        if (!row) continue;
        const key = rosterAssignmentKey(row);
        const index = positions.get(key);
        if (index === undefined) {
            positions.set(key, output.length);
            output.push(row);
        } else {
            // 최신 선박 정보는 반영하되, 다른 작업자를 지우지 않습니다.
            // 같은 선박의 같은 이름만 정규화하여 한 번으로 유지합니다.
            output[index] = { ...row, workers: mergeWorkers(output[index].workers, row.workers) };
        }
    }
    return output;
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

function setRosterPhotoBusy(isBusy, message) {
    ["rosterPhotoOcrBtn", "rosterPhotoClearBtn"].forEach((id) => {
        const button = rosterElement(id);
        if (button) button.disabled = Boolean(isBusy);
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
    rosterRuntime.recognizedText = "";
    rosterRuntime.reviewRows = [];
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
    setRosterPhotoStatus("📷 사진을 이 기기에서만 열었습니다. [사진에서 명단 읽기]를 눌러 글자를 읽어 주세요.");
    trackAppEvent?.("actions", "roster_photo_selected");
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

/** 대비를 자동 보정하고, 필요할 때는 고대비 흑백본을 만듭니다. */
function enhanceRosterOcrPixels(imageData, profile = "enhanced") {
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
        const value = profile === "binary" ? (gray <= threshold ? 0 : 255) : Math.round(contrast);
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
        data[index + 3] = 255;
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

async function prepareRosterImageForOcr(profile = "enhanced") {
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
        enhanceRosterOcrPixels(pixels, profile);
        context.putImageData(pixels, 0, 0);
    } catch (error) {
        // Some browsers disallow pixel access for an image. The scaled canvas is still usable.
    }
    return canvas.toDataURL("image/png");
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

async function runRosterPhotoOcr() {
    if (!isRosterFinderUnlocked()) return unlockRosterFinder();
    if (!rosterRuntime.activeImageUrl) return showToast("📷 먼저 근무 배치 사진을 선택해 주세요.");
    setRosterPhotoBusy(true, "🔍 글자를 선명하게 보정한 뒤 읽는 중… (사진은 이 기기 밖으로 전송되지 않습니다)");
    const recognize = async (engine, image, phase) => engine.recognize(image, "kor+eng", {
        logger: (progress) => {
            if (progress?.status === "recognizing text") {
                setRosterPhotoStatus(`🔍 ${phase} 글자 인식 중… ${Math.round((Number(progress.progress) || 0) * 100)}%`);
            }
        }
    });
    try {
        const [engine, enhancedImage] = await Promise.all([getRosterOcrEngine(), prepareRosterImageForOcr("enhanced")]);
        const primaryResult = await recognize(engine, enhancedImage, "보정");
        const primary = assessRosterOcrText(primaryResult?.data?.text, primaryResult?.data?.confidence);
        let selected = primary;
        let retried = false;
        if (shouldRetryRosterOcr(primary)) {
            retried = true;
            setRosterPhotoStatus("🔍 이름 인식이 부족해 고대비 흑백으로 한 번 더 확인하는 중…");
            const binaryImage = await prepareRosterImageForOcr("binary");
            const retryResult = await recognize(engine, binaryImage, "고대비 재확인");
            const alternate = assessRosterOcrText(retryResult?.data?.text, retryResult?.data?.confidence);
            selected = chooseRosterOcrCandidate(primary, alternate);
            trackAppEvent?.("actions", "roster_photo_ocr_retry");
        }
        rosterRuntime.recognizedText = selected.text;
        const box = rosterElement("rosterPhotoText");
        if (box) box.value = rosterRuntime.recognizedText;
        rosterElement("rosterPhotoTextDetails")?.classList.remove("hidden");
        const retryLabel = retried ? (selected === primary ? " · 보정본 선택" : " · 고대비 재확인본 선택") : "";
        setRosterPhotoStatus(`✅ 글자 인식 완료 (${rosterRuntime.recognizedText.length}자${retryLabel}). 검토 후 명단을 적용해 주세요.`);
        parseRosterPhotoTextFromBox();
        trackAppEvent?.("actions", "roster_photo_ocr_done");
    } catch (error) {
        console.error("[roster] OCR failed", error);
        rosterElement("rosterPhotoTextDetails")?.classList.remove("hidden");
        setRosterPhotoStatus("⚠️ 자동 인식에 실패했습니다. 사진을 보며 아래 칸에 직접 입력할 수 있습니다.");
        showToast("⚠️ 자동 인식에 실패했습니다. 직접 입력으로 계속할 수 있습니다.");
    } finally {
        setRosterPhotoBusy(false);
    }
}

function parseRosterPhotoTextFromBox() {
    const textBox = rosterElement("rosterPhotoText");
    const raw = String(textBox?.value || rosterRuntime.recognizedText || "");
    if (!raw.trim()) {
        showToast("⚠️ 읽은 글자가 없습니다. 사진을 다시 고르거나 직접 입력해 주세요.");
        return { entries: [], warnings: [] };
    }
    const activeDate = (() => {
        try { return String(getActiveWorkLogDate() || ""); } catch (error) { return ""; }
    })();
    const parsed = parseRosterPhotoText(raw, { defaultYear: new Date().getFullYear(), defaultDate: activeDate });
    rosterRuntime.photoModeEngaged = true;
    rosterRuntime.reviewRows = parsed.entries.map((row) => ({ ...row, workers: [...row.workers] }));
    renderRosterPhotoRows(parsed.warnings);
    if (rosterRuntime.reviewRows.some((row) => row.date && row.vessel)) applyRosterPhotoRoster({ automatic: true });
    return parsed;
}

function renderRosterPhotoRows(warnings) {
    const container = rosterElement("rosterPhotoRows");
    if (!container) return;
    if (!rosterRuntime.reviewRows.length) {
        const message = rosterRuntime.photoModeEngaged
            ? "명단을 찾지 못했습니다. 새 명단을 만들기 전까지 시작용 명단은 검색하지 않습니다."
            : "명단을 찾지 못했습니다. 선박명·날짜·이름이 보이게 사진을 찍거나 직접 입력해 주세요.";
        container.innerHTML = `<div class="roster-photo-empty">${message}</div>`;
        return;
    }
    const warningHtml = (warnings || []).map((warning) => `<div class="roster-photo-warn">⚠️ ${escapeShipCommentHtml(warning)}</div>`).join("");
    const rows = rosterRuntime.reviewRows.map((row, index) => `<div class="roster-photo-row">
        <div class="roster-photo-row-grid">
            <label>날짜<input type="date" value="${escapeShipCommentHtml(row.date)}" onchange="updateRosterPhotoRow(${index}, 'date', this.value)"></label>
            <label>선박명<input type="text" value="${escapeShipCommentHtml(row.vessel)}" onchange="updateRosterPhotoRow(${index}, 'vessel', this.value)"></label>
            <label>시간<input type="text" value="${escapeShipCommentHtml(row.time)}" placeholder="HH:MM" onchange="updateRosterPhotoRow(${index}, 'time', this.value)"></label>
            <label>회사<input type="text" value="${escapeShipCommentHtml(row.company)}" onchange="updateRosterPhotoRow(${index}, 'company', this.value)"></label>
        </div>
        <label class="roster-photo-row-workers">작업자 (${row.workers.length}명)<textarea rows="2" onchange="updateRosterPhotoRow(${index}, 'workers', this.value)">${escapeShipCommentHtml(row.workers.join(", "))}</textarea></label>
        <button type="button" class="roster-photo-row-del" onclick="removeRosterPhotoRow(${index})">이 줄 삭제</button>
    </div>`).join("");
    container.innerHTML = `${warningHtml}${rows}<label class="roster-photo-persist"><input type="checkbox" id="rosterPhotoPersist"${rosterRuntime.persistPhotoText ? " checked" : ""}> 이 명단을 내 기기에 저장 (사진은 저장하지 않습니다)</label><button type="button" class="roster-photo-apply-btn" onclick="applyRosterPhotoRoster()">✅ 현재 검색 명단에 합치기 (${rosterRuntime.reviewRows.length}척)</button>`;
}

function updateRosterPhotoRow(index, field, value) {
    const row = rosterRuntime.reviewRows[index];
    if (!row) return;
    if (field === "workers") row.workers = mergeWorkers([], String(value || "").split(/[,、\n]+/).map((item) => item.trim()).filter(Boolean));
    else if (field === "date") row.date = /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
    else row[field] = String(value || "").trim();
}

function removeRosterPhotoRow(index) {
    rosterRuntime.reviewRows.splice(index, 1);
    renderRosterPhotoRows([]);
}

function clearRosterSearchResult() {
    rosterRuntime.finderResults = [];
    const output = rosterElement("rosterFinderResults");
    if (output) output.innerHTML = "";
}

function applyRosterPhotoRoster(options) {
    const usable = rosterRuntime.reviewRows
        .map((row) => normalizeRosterAssignment(row, "photo"))
        .filter((row) => row && row.date && row.vessel);
    if (!usable.length) {
        if (!(options || {}).automatic) showToast("⚠️ 날짜와 선박명을 확인한 뒤 명단을 적용해 주세요.");
        return false;
    }
    const before = rosterRuntime.photoAssignments.length;
    rosterRuntime.photoModeEngaged = true;
    // 새 사진은 현재 명단에 합칩니다. 같은 날짜·선박만 최신 사진으로 갱신되고,
    // 다른 선박은 유지되어 한 작업자의 모든 배정을 검색할 수 있습니다.
    appendRosterPhotoEntries(usable);
    const persistCheck = rosterElement("rosterPhotoPersist");
    const persist = (options || {}).automatic ? rosterRuntime.persistPhotoText : Boolean(persistCheck?.checked);
    if (persist) savePhotoRosterToDevice();
    else if (!(options || {}).automatic) {
        try {
            localStorage.removeItem(ROSTER_STORAGE.photo);
            localStorage.removeItem(ROSTER_STORAGE.persist);
        } catch (error) { /* non-persistent mode is still usable */ }
        rosterRuntime.persistPhotoText = false;
    }
    clearRosterSearchResult();
    renderRosterPhotoSaved();
    if (!(options || {}).automatic) {
        const total = rosterRuntime.photoAssignments.length;
        showToast(before
            ? `✅ 사진 명단 ${usable.length}척을 합쳤습니다. 현재 ${total}척을 검색합니다.${persist ? " (이 기기에 저장됨)" : ""}`
            : `✅ 사진 명단 ${total}척을 적용했습니다.${persist ? " (이 기기에 저장됨)" : ""}`);
        trackAppEvent?.("actions", "roster_photo_applied");
        if (rosterElement("rosterFinderInput")?.value.trim()) searchRosterVessels();
    }
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
    container.innerHTML = `<div class="roster-photo-saved-head">📋 사진으로 만든 명단 ${list.length}척${rosterRuntime.persistPhotoText ? " · 내 기기에 저장됨" : " · 이번 탭에서만"}</div>${items}${list.length > 12 ? `<div class="roster-photo-empty">…외 ${list.length - 12}척</div>` : ""}<button type="button" class="roster-photo-clear-all" onclick="clearPhotoRosterEntries()">🗑️ 사진 명단 모두 지우기</button>`;
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
    clearRosterSearchResult();
    renderRosterPhotoSaved();
    renderRosterPhotoRows([]);
    showToast("🗑️ 사진 명단을 모두 지웠습니다.");
}

function clearRosterPhoto() {
    releaseRosterPhotoObjectUrl();
    rosterRuntime.recognizedText = "";
    rosterRuntime.reviewRows = [];
    rosterRuntime.photoModeEngaged = false;
    const preview = rosterElement("rosterPhotoPreview");
    if (preview) preview.removeAttribute("src");
    rosterElement("rosterPhotoPreviewWrap")?.classList.add("hidden");
    rosterElement("rosterPhotoTextDetails")?.classList.add("hidden");
    const text = rosterElement("rosterPhotoText");
    if (text) text.value = "";
    const rows = rosterElement("rosterPhotoRows");
    if (rows) rows.innerHTML = "";
    const readButton = rosterElement("rosterPhotoOcrBtn");
    const clearButton = rosterElement("rosterPhotoClearBtn");
    if (readButton) readButton.disabled = true;
    if (clearButton) clearButton.disabled = true;
    setRosterPhotoStatus("사진을 지웠습니다. 사진은 이 기기의 메모리에서만 처리되며 저장되지 않습니다.");
}
