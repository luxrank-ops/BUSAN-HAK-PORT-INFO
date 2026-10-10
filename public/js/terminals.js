const hjncScheduleMonthCache = {};
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
    const curDate = document.getElementById("dailyLogForm")?.getAttribute("data-date");
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
    const dateInput = document.getElementById("wageStartDate");
    const grid = document.querySelector("#wage-card .wage-hours-grid");
    if (!dateInput || !grid || typeof dateInput.getBoundingClientRect !== "function") return;

    const rect = dateInput.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // 정사각형의 최소 한 변: 날짜칸 높이 2개 + 선박 블록 사이 간격
    const minimumSide = rect.height * 2 + 4;
    const available = grid.getBoundingClientRect?.().width ||
        grid.parentElement?.getBoundingClientRect?.().width ||
        grid.closest?.(".calc-layout")?.getBoundingClientRect?.().width ||
        rect.width + minimumSide + 6;

    // 기본은 가로폭의 30%. 좁으면 날짜칸 기준 최소 높이를 우선
    const side = Math.max(minimumSide, (available - 6) * 0.3);
    grid.style?.setProperty("--wage-date-height", `${rect.height}px`);
    grid.style?.setProperty("--wage-total-side", `${side}px`);

    const timeButton = document.querySelector("#wage-card .calc-left .action-btn");
    if (timeButton && typeof getComputedStyle === "function") {
        grid.style?.setProperty("--wage-hours-font", getComputedStyle(timeButton).fontSize);
    }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("resize", syncWageHoursBlockSize);
}

function updateWageHoursBreakdown() {
    syncWageHoursBlockSize();
    const breakdownEl = document.getElementById("wageHoursBreakdown");
    const v1NameEl = document.getElementById("wageVessel1Name");
    const v1HoursEl = document.getElementById("wageVessel1Hours");
    const v2NameEl = document.getElementById("wageVessel2Name");
    const v2HoursEl = document.getElementById("wageVessel2Hours");

    const firstHours = periodHours(
        document.getElementById("wageStartDate")?.value,
        document.getElementById("wageStartHour")?.value,
        document.getElementById("wageEndDate")?.value,
        document.getElementById("wageEndHour")?.value
    );
    const manualTotal = parseFloat(document.getElementById("wageTotalHours")?.value) || 0;

    if (v1NameEl && v1HoursEl && v2NameEl && v2HoursEl) {
        if (selectedWageVessels.length > 1) {
            const firstItem = selectedWageVessels[0];
            const secondItem = selectedWageVessels[1];
            const secondPeriod = getSelectedVesselPeriod(secondItem.vessel, secondItem.date);
            v1NameEl.textContent = firstItem.name || "1번 선박";
            v1HoursEl.textContent = firstHours > 0 ? `${firstHours}시간` : "확인 필요";
            v2NameEl.textContent = secondItem.name || "2번 선박";
            v2HoursEl.textContent = secondPeriod.hours > 0 ? `${secondPeriod.hours}시간` : "확인 필요";
            return;
        }

        if (selectedWageVessels.length === 1) {
            const firstItem = selectedWageVessels[0];
            const displayHours = manualTotal || firstHours;
            v1NameEl.textContent = firstItem.name || "1번 선박";
            v1HoursEl.textContent = displayHours > 0 ? `${displayHours}시간` : "확인 필요";
            v2NameEl.textContent = "미선택";
            v2HoursEl.textContent = "-";
            return;
        }

        const shipInputVal = document.getElementById("wageShipName")?.value.trim() || "";
        const displayHours = manualTotal || firstHours;
        v1NameEl.textContent = shipInputVal || "미선택";
        v1HoursEl.textContent = displayHours > 0 ? `${displayHours}시간` : "확인 필요";
        v2NameEl.textContent = "미선택";
        v2HoursEl.textContent = "-";
        return;
    }

    if (!breakdownEl) return;

    if (selectedWageVessels.length > 1) {
        const firstItem = selectedWageVessels[0];
        const secondItem = selectedWageVessels[1];
        const secondPeriod = getSelectedVesselPeriod(secondItem.vessel, secondItem.date);
        const h1 = firstHours > 0 ? `${firstHours}시간` : "확인 필요";
        const h2 = secondPeriod.hours > 0 ? `${secondPeriod.hours}시간` : "확인 필요";
        breakdownEl.innerHTML =
            `<div class="wage-vessel-hours-card"><span class="vessel-order">1번 선박</span><span id="wageVessel1Name" class="vessel-name">${escapeShipCommentHtml(firstItem.name)}</span><span id="wageVessel1Hours" class="vessel-hours">${h1}</span></div>` +
            `<div class="wage-vessel-hours-card"><span class="vessel-order">2번 선박</span><span id="wageVessel2Name" class="vessel-name">${escapeShipCommentHtml(secondItem.name)}</span><span id="wageVessel2Hours" class="vessel-hours">${h2}</span></div>`;
        return;
    }

    if (selectedWageVessels.length === 1) {
        const firstItem = selectedWageVessels[0];
        const displayHours = manualTotal || firstHours;
        const h1 = displayHours > 0 ? `${displayHours}시간` : "확인 필요";
        breakdownEl.innerHTML =
            `<div class="wage-vessel-hours-card"><span class="vessel-order">1번 선박</span><span id="wageVessel1Name" class="vessel-name">${escapeShipCommentHtml(firstItem.name)}</span><span id="wageVessel1Hours" class="vessel-hours">${h1}</span></div>` +
            `<div class="wage-vessel-hours-card"><span class="vessel-order">2번 선박</span><span id="wageVessel2Name" class="vessel-name">미선택</span><span id="wageVessel2Hours" class="vessel-hours">-</span></div>`;
        return;
    }

    const shipInputVal = document.getElementById("wageShipName")?.value.trim() || "";
    const displayHours = manualTotal || firstHours;
    const h1 = displayHours > 0 ? `${displayHours}시간` : "확인 필요";
    breakdownEl.innerHTML =
        `<div class="wage-vessel-hours-card"><span class="vessel-order">1번 선박</span><span id="wageVessel1Name" class="vessel-name">${escapeShipCommentHtml(shipInputVal || "미선택")}</span><span id="wageVessel1Hours" class="vessel-hours">${h1}</span></div>` +
        `<div class="wage-vessel-hours-card"><span class="vessel-order">2번 선박</span><span id="wageVessel2Name" class="vessel-name">미선택</span><span id="wageVessel2Hours" class="vessel-hours">-</span></div>`;
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
        const second = getSelectedVesselPeriod(
            selectedWageVessels[1].vessel,
            selectedWageVessels[1].date
        ).hours;

        if (total) {
            total.value = first && second ? first + second : "";
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

    if (startDateInput && period.startDate) startDateInput.value = period.startDate;
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
    } else if (selectedWageVessels.length >= 2) {
        return showToast("⚠️ 선박은 최대 2척까지 선택할 수 있습니다.");
    } else {
        selectedWageVessels.push({ name, vessel, date: dateStr, terminalId });
    }

    const names = selectedWageVessels.map(item => item.name);
    selectedWageScheduleShipName = names.join(" / ");

    const wageShipNameInput = document.getElementById("wageShipName");
    if (wageShipNameInput) wageShipNameInput.value = names.join(" / ");

    const doubleOrderInput = document.getElementById("wageDoubleOrder");
    if (doubleOrderInput) doubleOrderInput.checked = names.length === 2;

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
        const firstEntry = selectedWageVessels[0];
        const secondEntry = selectedWageVessels[1];
        const secondPeriod = getSelectedVesselPeriod(secondEntry.vessel, secondEntry.date);
        const totalVal = document.getElementById("wageTotalHours")?.value;
        const missingNote = !secondPeriod.hours ? " · 2번째 선박 입·출항 시각 확인 필요" : "";
        showToast(
            `🚢 더블오더 2척 선택 (${firstEntry.name} / ${secondEntry.name})` +
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

    titleEl.innerText = `⚓ ${dateStr} ${meta.label} 입항·작업 선박 (${uniqueMatched.length}척)`;

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
            }
        } catch (e) {}
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
                    db.collection("hjnc_schedules").doc(docKey).set({
                        terminal: tid,
                        yearMonth,
                        vesselsJson: JSON.stringify(slim),
                        count: slim.length,
                        updatedAt: new Date().toISOString()
                    }, { merge: true }).catch(() => {});
                    return slim;
                }
            }
        } catch (e) {}
        return null;
    };

    if (vessels.length > 0 && !forceRefresh) {
        hjncScheduleMonthCache[cacheKey] = vessels;
        syncFromLiveApi().then(updated => {
            if (updated && updated.length > 0 && selectedScheduleTerminal === tid) {
                const curDate = document.getElementById("dailyLogForm")?.getAttribute("data-date");
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
    } catch (e) {}

    return vessels;
}
async function refreshHjncScheduleForSelectedDate() {
    const dateStr = document.getElementById("dailyLogForm")?.getAttribute("data-date");
    if (!dateStr) return;
    const yearMonth = dateStr.slice(0, 7);
    const cacheKey = `${selectedScheduleTerminal}_${yearMonth}`;
    delete hjncScheduleMonthCache[cacheKey];
    const meta = getTerminalMeta(selectedScheduleTerminal);
    showToast(`🔄 ${meta.label} 선석 배정 현황을 새로고침합니다...`);
    await loadHjncScheduledShipsForDate(dateStr, true);
}
function renderHjncScheduledShipsUI(dateStr, allVessels, terminalId = selectedScheduleTerminal) {
    const titleEl = document.getElementById("hjncScheduleBoxTitle");
    const listEl = document.getElementById("hjncScheduledShipList");
    if (!titleEl || !listEl || !dateStr) return;

    renderTerminalScheduleTabBar();
    const meta = getTerminalMeta(terminalId);
    const cfg = terminalQuickConfig[terminalId] || terminalQuickConfig.hjnc;
    const currentValue = (document.getElementById("logShipName")?.value || "").trim().toUpperCase();
    const matched = (allVessels || []).filter(v => isVesselActiveOnDate(v, dateStr));
    const seen = new Set();
    const uniqueMatched = [];
    matched.forEach(v => {
        const name = String(v.VSL_NM || "").trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        uniqueMatched.push(v);
    });

    titleEl.innerHTML = `<span style="white-space:nowrap;">⚓ ${dateStr} ${meta.label}</span><br><span style="font-size:clamp(0.66rem, 2.2vw, 0.72rem); font-weight:800; white-space:nowrap; letter-spacing:-0.3px;">입항·작업 선박 (${uniqueMatched.length}척) (터치 시 선박명 자동 입력)</span>`;

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
        return `<button type="button" class="hjnc-ship-chip" style="${selectedStyle}" onclick="applyQuickShipChip('${jsSafeName}', '${berth}', '${ptnr}', '${meta.badge}')">
            <span class="hjnc-berth-tag" style="${isSelected ? `background:#ffffff; color:${meta.color};` : `background:${meta.color}; color:#ffffff;`}">${berth}</span>
            <span>🚢 ${safeName}</span>
            ${ptnr ? `<span style="font-size:0.66rem; color:${isSelected ? '#fed7aa' : '#64748b'}; font-weight:800;">(${ptnr})</span>` : ""}
            <span class="hjnc-time-tag" style="${timeStyle}">${timeBadge}</span>
        </button>`;
    }).join("");
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

    titleEl.innerHTML = `⚓ ${dateStr} ${meta.label}<br><span style="font-size:0.7rem; font-weight:800;">입항·접안 예정 선박 조회 중...</span>`;
    listEl.innerHTML = `<span style="font-size:0.74rem; color:var(--text-sub); font-weight:700;">${meta.label} 선석 배정 현황 데이터를 불러오는 중입니다...</span>`;

    const allVessels = await fetchHjncScheduleForMonth(yearMonth, forceRefresh, tid);
    const currentSelected = document.getElementById("dailyLogForm")?.getAttribute("data-date");
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
    const targetDate = dateStr || document.getElementById("dailyLogForm")?.getAttribute("data-date") || "";
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
function applyQuickShipChip(shipName, berthNo = "", ptnrCode = "", termBadge = "") {
    const input = document.getElementById("logShipName");
    if (!input) return;
    input.value = shipName;
    if (shipName.endsWith(" ")) input.focus();
    const curDate = document.getElementById("dailyLogForm")?.getAttribute("data-date");
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
        console.warn("실시간 기상 조회 오류:", e);
    }
}
