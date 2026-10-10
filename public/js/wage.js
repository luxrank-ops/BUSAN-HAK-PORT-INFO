function renderRow(label, amt, color = "inherit") { return `<tr><td style="padding: 8px 0; color: var(--text-sub); font-weight:700;">${label}</td><td style="text-align: right; font-weight: 900; color: ${color};">${amt.toLocaleString()}원</td></tr>`; }
const publicHolidays = [
    '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-01', '2025-03-03', '2025-05-05', '2025-05-06', '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25',
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-06', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
    '2027-01-01', '2027-02-06', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-05', '2027-05-13', '2027-06-06', '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25'
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
        let secondPeriod = null;

        if (multi) {
            firstHours = periodHours(sd, sh, wageEndDate, wageEndHour);
            secondPeriod = getSelectedVesselPeriod(
                selectedWageVessels[1].vessel,
                selectedWageVessels[1].date
            );
            if (firstHours <= 0 || !secondPeriod.hours) {
                alert("선택한 두 선박의 입·출항 근무 시간이 모두 확인되어야 합산 계산할 수 있습니다.");
                return;
            }
            const totalEl = document.getElementById('wageTotalHours');
            if (totalEl) {
                totalEl.value = firstHours + secondPeriod.hours;
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
            const second = calculateWageSegment(secondPeriod, {
                ...common,
                holidayH: 0,
                rainH: 0,
                hotH: 0,
                weekendH: null
            });

            segments.push({
                ...second,
                name: selectedWageVessels[1].name,
                hours: secondPeriod.hours
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
            summary: multi
                ? segments.map((part, idx) => `[더블오더 · 임금 ${idx + 1} · ${part.name}] ${part.summary}`).join('\n')
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
            ? '📋 더블오더 선박별 임금 산정 내역서 (임금 1 · 임금 2)'
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
            const wage1El = document.getElementById("logWage1");
            const wage2El = document.getElementById("logWage2");
            if (wage1El) wage1El.value = calculatedData.segments[0].totalPay;
            if (wage2El) wage2El.value = calculatedData.segments[1].totalPay;

            if (logShipInput) {
                logShipInput.value = calculatedData.segments.map(item => item.name).join(" / ");
            }

            const lines = calculatedData.segments.map((part, index) =>
                `[더블오더 · 임금 ${index + 1} · ${part.name}] ${part.summary}`
            );
            if (memoInput) {
                lines.forEach(line => {
                    if (!memoInput.value.includes(line)) {
                        memoInput.value = memoInput.value
                            ? `${memoInput.value}\n${line}`
                            : line;
                    }
                });
            }

            trackAppEvent("actions", "wage_to_log");
            showToast("📅 더블오더 선박 2척의 금액을 임금 1·임금 2에 각각 입력했습니다. 저장을 눌러 기록하세요.");
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
        }

        trackAppEvent("actions", "wage_to_log");
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
        .slice(0, 2);

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
        if (doubleOrderEl) doubleOrderEl.checked = shipNames.length === 2;
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
        const hourlyEl = document.getElementById('wageHourly');
        if (hourlyEl) {
            delete hourlyEl.dataset.userModified;
            hourlyEl.value = '10320';
        }
        const allowanceType = document.getElementById('wageAllowanceType');
        if (allowanceType) allowanceType.value = 'wageHoliday';
        const sDate = document.getElementById('wageStartDate');
        const eDate = document.getElementById('wageEndDate');
        selectedWageScheduleShipName = "";
        selectedWageVessels = [];
        if (sDate) sDate.value = todayStr;
        if (eDate) eDate.value = todayStr;
        if (typeof setWageScheduleDate === 'function') setWageScheduleDate(todayStr);
        if (typeof syncWageHourlyYearLabel === 'function') syncWageHourlyYearLabel(todayStr);
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
