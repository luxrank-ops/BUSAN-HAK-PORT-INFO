// Phase 3 Dynamic Import Module: D3.js Yearly Chart & Summary Report
let d3LibraryLoadPromise = null;

export function ensureD3LibraryLoaded() {
  if (typeof window.d3 !== "undefined") return Promise.resolve(window.d3);
  if (d3LibraryLoadPromise) return d3LibraryLoadPromise;
  d3LibraryLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-d3-cdn]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.d3));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js";
    s.async = true;
    s.setAttribute("data-d3-cdn", "1");
    s.onload = () => resolve(window.d3);
    s.onerror = (err) => {
      d3LibraryLoadPromise = null;
      reject(err);
    };
    document.head.appendChild(s);
  });
  return d3LibraryLoadPromise;
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
        : Math.max(0, Math.round((Number(d.wage1) || 0) + (Number(d.wage2) || 0)));
    const wage1 = Number(d.wage1) || 0;
    const wage2 = Number(d.wage2) || 0;
    const memo = String(d.memo || "");
    const empty = { date: dateStr, totalHours: 0, dayHours: 0, nightHours: 0, weekendHours: 0, dayAmt: 0, nightAmt: 0, weekendAmt: 0, skilledAmt: 0, extraAmt: 0, totalPay, wage1, wage2, source: "none", estimated: false, hasTime: false };
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
            const slot = line.match(/더블오더\s*·\s*임금\s*([12])/);
            slots.set(slot ? slot[1] : "1", part);
        }
        slots.forEach(part => { found = found ? addTo(found, part) : { ...part }; });
        if (found && found.totalHours > 0) { acc = found; source = "calc"; }
    }
    // 2) 더블오더 선박 스케줄: ① 선박 · 입항 YYYY-MM-DD HH:MM → 출항 ... · XH
    if (!acc && memo) {
        const lineRe = /[①②]\s*[^\n]*?입항\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})\s*→\s*출항\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/g;
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
        totalPay, wage1, wage2,
        source, estimated, hasTime: true
    };
}
function aggregateWorkTimeMetrics(logs) {
    const list = Array.isArray(logs) ? logs : Object.values(logs || {});
    const out = { days: 0, totalHours: 0, dayHours: 0, nightHours: 0, weekendHours: 0, dayAmt: 0, nightAmt: 0, weekendAmt: 0, skilledAmt: 0, extraAmt: 0, totalPay: 0, wage1: 0, wage2: 0, estimatedDays: 0, timeRecordedDays: 0 };
    list.forEach(log => {
        if (!log) return;
        const pay = Number(log.totalPay) || ((Number(log.wage1) || 0) + (Number(log.wage2) || 0));
        if (pay > 0 || log.shipName || log.memo || log.coworkers) out.days += 1;
        const wt = extractWorkLogTimeAndWageMetrics(log);
        out.totalHours += wt.totalHours; out.dayHours += wt.dayHours; out.nightHours += wt.nightHours; out.weekendHours += wt.weekendHours;
        out.dayAmt += wt.dayAmt; out.nightAmt += wt.nightAmt; out.weekendAmt += wt.weekendAmt; out.skilledAmt += wt.skilledAmt; out.extraAmt += wt.extraAmt;
        out.totalPay += wt.totalPay; out.wage1 += wt.wage1; out.wage2 += wt.wage2;
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
        '<div style="background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:8px 10px;"><div style="font-size:0.72rem; color:var(--text-sub); font-weight:800;">💰 임금 1 / 임금 2</div><div style="font-size:0.92rem; font-weight:900; color:#047857; margin-top:2px;">' + (cur.wage1Sum || 0).toLocaleString() + '원 / ' + (cur.wage2Sum || 0).toLocaleString() + '원</div><div style="font-size:0.7rem; color:var(--text-sub); font-weight:700; margin-top:2px;">기능공 ' + (cur.skilledAmt || 0).toLocaleString() + '원 · 기타 가산 ' + (cur.extraAmt || 0).toLocaleString() + '원' + (cur.estimatedDays ? ' · 금액 기준 추정 ' + cur.estimatedDays + '일 포함' : '') + '</div></div>' +
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

    const monthlyData = Array.from({ length: 12 }, (_, idx) => ({
        month: idx + 1,
        label: `${idx + 1}월`,
        totalPay: 0,
        wage1Sum: 0,
        wage2Sum: 0,
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
            const snap = await db.collection("work_logs").where("date", ">=", sDate).where("date", "<=", eDate).get();
            snap.forEach(doc => {
                const d = doc.data();
                if (d.workerId !== currentWorkerId || !d.date) return;
                const mIdx = parseInt(d.date.split("-")[1], 10) - 1;
                if (mIdx >= 0 && mIdx < 12) {
                    const pay = extractWorkLogTimeAndWageMetrics(d).totalPay;
                    const w1 = Number(d.wage1) || 0;
                    const w2 = Number(d.wage2) || 0;
                    monthlyData[mIdx].totalPay += pay;
                    monthlyData[mIdx].wage1Sum += w1;
                    monthlyData[mIdx].wage2Sum += w2;
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

    try { await ensureD3LibraryLoaded(); } catch (e) { console.warn("D3 CDN 로드 실패:", e); }
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
        `- 연간 총수입: ${totalYearPay.toLocaleString()}원 (임금 1: ${totalYearW1.toLocaleString()}원 / 임금 2: ${totalYearW2.toLocaleString()}원)`,
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
        `- 총 책정 금액: ${totalYearPay.toLocaleString()}원 (임금 1: ${totalYearW1.toLocaleString()}원 / 임금 2: ${totalYearW2.toLocaleString()}원)`,
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
                <div style="font-size:0.7rem; color:var(--text-sub); margin-top:2px;">임금 1 ${(totalYearW1/10000).toFixed(0)}만 · 임금 2 ${(totalYearW2/10000).toFixed(0)}만</div>
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

export {
  loadAndRenderYearlyD3Chart,
  copyYearlySummaryReport,
  renderYearlySummaryReport,
  renderMonthlyD3BarChart,
  extractWorkLogTimeAndWageMetrics,
  aggregateWorkTimeMetrics,
  renderMonthlyWorkTimeReport,
  copyWorkTimeReport
};

window.loadAndRenderYearlyD3Chart = loadAndRenderYearlyD3Chart;
window.copyYearlySummaryReport = copyYearlySummaryReport;
window.renderYearlySummaryReport = renderYearlySummaryReport;
window.renderMonthlyD3BarChart = renderMonthlyD3BarChart;
window.extractWorkLogTimeAndWageMetrics = extractWorkLogTimeAndWageMetrics;
window.aggregateWorkTimeMetrics = aggregateWorkTimeMetrics;
window.renderMonthlyWorkTimeReport = renderMonthlyWorkTimeReport;
window.copyWorkTimeReport = copyWorkTimeReport;
window.toggleWorkTimeMonthsView = toggleWorkTimeMonthsView;
window.jumpToWorkTimeMonth = jumpToWorkTimeMonth;
