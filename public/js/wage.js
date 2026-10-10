function renderRow(label, amt, color = "inherit") { return `<tr><td style="padding: 8px 0; color: var(--text-sub); font-weight:700;">${label}</td><td style="text-align: right; font-weight: 900; color: ${color};">${amt.toLocaleString()}원</td></tr>`; }
const publicHolidays = [
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-06', '2026-08-15', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', '2026-10-03', '2026-10-09', '2026-12-25',
    '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-05', '2027-05-13', '2027-06-06', '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25'
];
let lastCalculatedWageData = null;
function highlightSeasonRow(month) {
    ['row-jan', 'row-apr', 'row-oct'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('is-season-active');
    });
    const activeId = (month >= 4 && month <= 9) ? 'row-apr' : (month >= 10 ? 'row-oct' : 'row-jan');
    const activeEl = document.getElementById(activeId);
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
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            document.getElementById('wageTotalHours').value = hours;
            showToast(`⏱️ 총 근무 시간 ${hours}시간이 설정되었습니다.`);
        } else {
            document.getElementById('wageTotalHours').value = '';
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
function autoFillWeekendHoliday() {
    // 추가 수당 시간 입력(지게차, 특별수당, 우천, 혹서기)은 사용자가 직접 입력할 때만 반영되도록 자동 입력 비활성화
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

    if (storedInput) storedInput.value = hours;
}

function calculateWage() {
    try {
        const totalHours = parseFloat(document.getElementById('wageTotalHours').value) || 0;
        const sd = document.getElementById('wageStartDate').value;
        const sh = parseInt(document.getElementById('wageStartHour').value, 10) || 0;
        if (!sd || !document.getElementById('wageEndDate').value) {
            alert("근무 날짜를 선택해 주세요.");
            return;
        }
        if (totalHours <= 0) {
            alert("총 근무 시간이 0시간입니다. [⏱️ 시간 설정 완료] 버튼을 누르거나 총 근무 시간을 입력해 주세요.");
            return;
        }
        const startTime = sh;
        const isSkilled = document.getElementById('role-skilled').checked;
        const roleLabel = isSkilled ? '기능공' : (document.getElementById('role-onshore').checked ? '육상' : '본선');
        const holidayH = parseFloat(document.getElementById('wageHoliday').value) || 0;
        const weekendH = parseFloat(document.getElementById('wageWeekend').value) || 0;
        const rainH = parseFloat(document.getElementById('wageRain').value) || 0;
        const hotH = parseFloat(document.getElementById('wageHotTime').value) || 0;
        const taxRate = parseFloat(document.getElementById('wageTaxType').value) || 0;
        const BASE_RATE = parseFloat(document.getElementById('wageHourly').value) || 10320;
        const SKILLED_DAY_ADD = 2557;
        const SKILLED_NIGHT_ADD = 3836;
        const month = parseInt(sd.split('-')[1], 10) || (new Date(sd).getMonth() + 1);
        highlightSeasonRow(month);
        let dayStart = 8, dayEnd = 18;
        if (month >= 4 && month <= 9) { dayStart = 6; dayEnd = 19; }
        else if (month >= 10) { dayStart = 7; dayEnd = 17; }
        let dayHours = 0, nightHours = 0;
        for (let i = 0; i < totalHours; i++) {
            let currentHour = (startTime + i) % 24;
            if (currentHour >= dayStart && currentHour < dayEnd) dayHours++;
            else nightHours++;
        }
        const dayAmt = dayHours * BASE_RATE;
        const nightAmt = nightHours * (BASE_RATE * 1.5);
        const holidayAmt = holidayH * (BASE_RATE * 0.5);
        const weekendAmt = weekendH * (BASE_RATE * 0.5);
        const rainAmt = rainH * (BASE_RATE * 0.5);
        const hotAmt = hotH * (BASE_RATE * 0.3);
        const otherAmt = rainAmt + hotAmt;
        let skilledAmt = isSkilled ? (dayHours * SKILLED_DAY_ADD) + (nightHours * SKILLED_NIGHT_ADD) : 0;
        const subTotal = dayAmt + nightAmt + skilledAmt + holidayAmt + weekendAmt + otherAmt;
        const taxAmt = Math.floor(subTotal * taxRate);
        const finalTotal = Math.round(subTotal - taxAmt);
        const wageShipName =
            document.getElementById("wageShipName")?.value.trim() ||
            selectedWageScheduleShipName ||
            "";
        const wageEndDate = document.getElementById("wageEndDate").value;
        const wageEndHour =
            parseInt(document.getElementById("wageEndHour").value, 10) || 0;

        lastCalculatedWageData = {
            date: sd,
            endDate: wageEndDate,
            startHour: sh,
            endHour: wageEndHour,
            totalHours,
            totalPay: finalTotal,
            shipName: wageShipName,
            terminalId: selectedScheduleTerminal,
            summary:
                `[${roleLabel}] ${sd} ${String(sh).padStart(2, "0")}시~` +
                `${wageEndDate} ${String(wageEndHour).padStart(2, "0")}시 · ` +
                `총 ${totalHours}H (주간 ${dayHours}H / 야간 ${nightHours}H)`
        };
        let extraHtml = "";
        if (holidayAmt > 0) extraHtml += renderRow("🚜 지게차 수당 (" + holidayH + "H)", holidayAmt, "#ea580c");
        if (weekendAmt > 0) extraHtml += renderRow("🎈 특별 수당 (" + weekendH + "H)", weekendAmt, "#3b82f6");
        if (rainAmt > 0) extraHtml += renderRow("☔ 우천 수당 (" + rainH + "H)", rainAmt, "#0284c7");
        if (hotAmt > 0) extraHtml += renderRow("☀️ 혹서기(30%) 수당 (" + hotH + "H)", hotAmt, "#d97706");
        if (holidayAmt === 0 && weekendAmt === 0 && otherAmt === 0) extraHtml += renderRow("➕ 추가 가산 수당", 0);
        const specBody = document.getElementById('wageSpecBody');
        specBody.innerHTML = ` ${renderRow("☀️ 주간 기본 ("+dayHours+"H)", dayAmt)} ${renderRow("🌙 야간 할증 ("+nightHours+"H)", nightAmt)} ${renderRow("🔧 기능공 수당 추가", skilledAmt, "var(--primary)")} ${extraHtml} ${taxAmt > 0 ? renderRow("💸 공제액 (세금/보험)", -taxAmt, "var(--danger)") : ""} `;
        document.getElementById('wageTotal').innerText = finalTotal.toLocaleString() + "원";
        document.getElementById('wageResultBox').classList.remove('hidden');
        trackAppEvent('actions', 'wage_calc');
        showToast("상세 계산서가 생성되었습니다!");
        if (wageShipName) {
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
    selectedWageScheduleShipName = trimmed;
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
function sendCalculatedWageToLog() {
    if (!lastCalculatedWageData) return;

    trackAppEvent("actions", "wage_to_log");
    const { date, totalPay, summary } = lastCalculatedWageData;

    const logCard = document.getElementById("log-card");
    if (logCard && !logCard.classList.contains("expanded")) {
        toggleDashItem("log-card");
    }

    jumpToLogDate(date);

    const wage1Input = document.getElementById("logWage1");
    const memoInput = document.getElementById("logMemo");
    const logShipInput = document.getElementById("logShipName");
    const shipName =
        document.getElementById("wageShipName")?.value.trim() ||
        lastCalculatedWageData.shipName ||
        "";

    if (wage1Input) wage1Input.value = totalPay;
    if (logShipInput && shipName) logShipInput.value = shipName;

    if (memoInput && !memoInput.value.includes(summary)) {
        memoInput.value = memoInput.value
            ? `${memoInput.value}\n${summary}`
            : summary;
    }

    showToast(shipName
        ? `📅 ${shipName} 선박명과 계산 임금을 근무일지에 입력했습니다. 저장을 눌러 기록하세요.`
        : "📅 계산 임금을 근무일지에 입력했습니다. 저장을 눌러 기록하세요.");
}
function sendWorkLogShipToWage() {
    const name =
        document.getElementById("logShipName")?.value.trim() || "";
    if (!name) {
        return showToast("근무일지에 선박명을 먼저 입력해 주세요.");
    }

    const card = document.getElementById("wage-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("wage-card");
    }

    lastCalculatedWageData = null;
    document.getElementById("wageResultBox")?.classList.add("hidden");

    const totalHoursInput = document.getElementById("wageTotalHours");
    if (totalHoursInput) totalHoursInput.value = "";

    const input = document.getElementById("wageShipName");
    if (input) input.value = name;
    onWageShipNameChange(name);

    const logDate =
        document.getElementById("dailyLogForm")?.getAttribute("data-date") || "";

    if (logDate) {
        const startDate = document.getElementById("wageStartDate");
        const endDate = document.getElementById("wageEndDate");

        if (startDate) startDate.value = logDate;
        if (endDate) endDate.value = logDate;
        if (typeof setWageScheduleDate === "function") setWageScheduleDate(logDate);

        highlightSeasonRow(parseInt(logDate.split("-")[1], 10));
        loadWageScheduledShipsForDate(logDate, false);
    }

    document.getElementById("wage-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });

    showToast(
        `🚢 ${name} 선박과 근무일자를 임금계산기로 보냈습니다. 근무 시간은 확인해 주세요.`
    );
}
function resetWageForm() {
    try {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const todayStr = now.toISOString().split('T')[0];
        ['wageTotalHours', 'wageShipName', 'wageAllowanceHours', 'wageHoliday', 'wageWeekend', 'wageRain', 'wageHotTime'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const allowanceType = document.getElementById('wageAllowanceType');
        if (allowanceType) allowanceType.value = 'wageHoliday';
        const sDate = document.getElementById('wageStartDate');
        const eDate = document.getElementById('wageEndDate');
        const sHour = document.getElementById('wageStartHour');
        const eHour = document.getElementById('wageEndHour');
        const taxType = document.getElementById('wageTaxType');
        selectedWageScheduleShipName = "";
        if (sDate) sDate.value = todayStr;
        if (eDate) eDate.value = todayStr;
        if (typeof setWageScheduleDate === 'function') setWageScheduleDate(todayStr);
        if (sHour) sHour.value = '8';
        if (eHour) eHour.value = '17';
        if (taxType) taxType.value = '0';
        if (typeof loadWageScheduledShipsForDate === 'function') {
            loadWageScheduledShipsForDate(todayStr, false);
        }
        document.getElementById('wageResultBox').classList.add('hidden');
        showToast("🔄 임금계산기 입력값이 초기화되었습니다.");
    } catch (e) {
        console.error(e);
    }
}
