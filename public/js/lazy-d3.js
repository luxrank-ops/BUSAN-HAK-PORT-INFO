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
        workDays: 0
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
                    const pay = Number(d.totalPay) || 0;
                    const w1 = Number(d.wage1) || 0;
                    const w2 = Number(d.wage2) || 0;
                    monthlyData[mIdx].totalPay += pay;
                    monthlyData[mIdx].wage1Sum += w1;
                    monthlyData[mIdx].wage2Sum += w2;
                    if (pay > 0 || d.shipName || d.memo || d.coworkers) {
                        monthlyData[mIdx].workDays += 1;
                    }
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
        `- 분기별 요약: ` + quarters.map(q => `${q.label} ${(q.pay / 10000).toFixed(0)}만(${q.days}일)`).join(" | ")
    ].join("\n");

    const activeRows = data.filter(d => d.totalPay > 0 || d.workDays > 0);
    const monthlyTableRows = activeRows.length > 0
        ? activeRows.map(d => {
            const dAvg = d.workDays > 0 ? Math.round(d.totalPay / d.workDays) : 0;
            const isCur = d.month === (activeMonthIdx + 1);
            return `<tr style="${isCur ? 'background:rgba(59,130,246,0.08); font-weight:900;' : ''}">
                <td style="padding:5px 4px; border-bottom:1px solid var(--border);">${d.label}${isCur ? ' 👈' : ''}</td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:center; color:#047857; font-weight:800;">${d.workDays}일</td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:right; color:#1d4ed8; font-weight:900;">${d.totalPay.toLocaleString()}원</td>
                <td style="padding:5px 4px; border-bottom:1px solid var(--border); text-align:right; color:var(--text-sub); font-size:0.74rem;">${dAvg.toLocaleString()}원</td>
            </tr>`;
        }).join("")
        : `<tr><td colspan="4" style="padding:12px; text-align:center; color:var(--text-sub); font-weight:700;">${year}년 등록된 근무 기록이 없습니다.</td></tr>`;

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

        <details style="background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:8px 10px;">
            <summary style="cursor:pointer; font-size:0.8rem; font-weight:900; color:var(--primary); outline:none;">📋 월별 상세 정산표 펼치기 (${activeRows.length}개 활동월)</summary>
            <table style="width:100%; border-collapse:collapse; font-size:0.78rem; margin-top:8px;">
                <thead>
                    <tr style="background:rgba(10,27,63,0.05); color:var(--primary); font-weight:900;">
                        <th style="padding:5px 4px; text-align:left; border-bottom:1.5px solid var(--primary);">월</th>
                        <th style="padding:5px 4px; text-align:center; border-bottom:1.5px solid var(--primary);">근로일수</th>
                        <th style="padding:5px 4px; text-align:right; border-bottom:1.5px solid var(--primary);">총수입</th>
                        <th style="padding:5px 4px; text-align:right; border-bottom:1.5px solid var(--primary);">일평균</th>
                    </tr>
                </thead>
                <tbody>${monthlyTableRows}</tbody>
            </table>
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
  renderMonthlyD3BarChart
};

window.loadAndRenderYearlyD3Chart = loadAndRenderYearlyD3Chart;
window.copyYearlySummaryReport = copyYearlySummaryReport;
window.renderYearlySummaryReport = renderYearlySummaryReport;
window.renderMonthlyD3BarChart = renderMonthlyD3BarChart;
