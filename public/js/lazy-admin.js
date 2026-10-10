// Phase 3 Dynamic Import Module: Visitor Stats & Admin WorkLog Detail Modals
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
async function loadAndRenderVisitorStats() {
    const todayCountEl = document.getElementById("todayVisitorCount");
    const yesterdayCountEl = document.getElementById("yesterdayVisitorCount");
    const weekCountEl = document.getElementById("weekVisitorCount");
    const totalCountEl = document.getElementById("totalVisitorCount");
    if (todayCountEl) todayCountEl.innerText = "...";
    if (totalCountEl) totalCountEl.innerText = "...";

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

    const [totalSnap, ...dailySnaps] = await Promise.all([
        db.collection("visitor_stats").doc("total").get(),
        ...dayKeys.map(dk => db.collection("visitor_stats").doc(`daily-${dk.key}`).get())
    ]);

    const totalDoc = totalSnap.exists ? totalSnap.data() : {};
    const dailyDocs = dailySnaps.map(s => (s.exists ? s.data() : {}));
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
        const workerAccounts = [];
        const workerLogSummary = {};
        try {
            const [uSnap, lSnap, nSnap, aSnap] = await Promise.all([
                db.collection("user_profiles").get(),
                db.collection("work_logs").get(),
                db.collection("notices").get(),
                db.collection("archives").get()
            ]);
            workersCnt = uSnap.size;
            logsCnt = lSnap.size;
            noticesCnt = nSnap.size;
            archivesCnt = aSnap.size;

            lSnap.forEach(doc => {
                const d = doc.data() || {};
                const wid = String(d.workerId || "").trim() || (doc.id.includes("_") ? doc.id.split("_")[0] : "");
                if (!wid) return;
                if (!workerLogSummary[wid]) {
                    workerLogSummary[wid] = { count: 0, totalPay: 0, lastDate: "", lastSavedMs: 0 };
                }
                workerLogSummary[wid].count += 1;
                const pay = Number(d.totalPay) || ((Number(d.wage1) || 0) + (Number(d.wage2) || 0));
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
        } catch (e) {}
        const shipsCnt = Array.isArray(allShipsData) ? allShipsData.length : 0;
        const postsCnt = Array.isArray(allPostsData) ? allPostsData.length : 0;
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
    if (!isAdminSessionVerified && !(await verifyAdmin())) return;
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
            const snap = await db.collection("work_logs").get();
            const items = [];
            snap.forEach(doc => {
                const d = doc.data() || {};
                const docId = doc.id || "";
                const wid = String(d.workerId || "").trim() || (docId.includes("_") ? docId.split("_")[0] : "미지정");
                const dateStr = String(d.date || "").trim() || (docId.includes("_") ? docId.split("_").slice(1).join("_") : "-");
                const wage1 = Number(d.wage1) || 0;
                const wage2 = Number(d.wage2) || 0;
                const totalPay = Number(d.totalPay) || (wage1 + wage2);
                const savedMs = d.timestamp && typeof d.timestamp.toMillis === "function" ? d.timestamp.toMillis() : 0;
                const savedStr = formatAdminWorkLogDateTime(d.timestamp);
                items.push({
                    id: docId,
                    workerId: wid,
                    date: dateStr,
                    shipName: String(d.shipName || "").trim(),
                    wage1,
                    wage2,
                    totalPay,
                    coworkers: String(d.coworkers || "").trim(),
                    memo: String(d.memo || "").trim(),
                    imageUrl: String(d.imageUrl || "").trim(),
                    savedMs,
                    savedStr
                });
            });
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

    let sumPay = 0, sumW1 = 0, sumW2 = 0, photoCnt = 0;
    const workerMap = {};
    const shipMap = {};
    const dateSet = new Set();
    let minDate = "", maxDate = "";

    filtered.forEach(item => {
        sumPay += item.totalPay;
        sumW1 += item.wage1;
        sumW2 += item.wage2;
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
    setAdminWorkLogText("awlKpiSplitSub", `임금1: ${sumW1.toLocaleString()}원 · 임금2: ${sumW2.toLocaleString()}원`);
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
        `• 합산 금액: ${sumPay.toLocaleString()}원 (임금1: ${sumW1.toLocaleString()}원 / 임금2: ${sumW2.toLocaleString()}원 / 건당 평균: ${avgPay.toLocaleString()}원)`,
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
    const headers = ["No", "근무일", "근로자(ID)", "선박명", "임금1(원)", "임금2(원)", "총액(원)", "동반근무자", "작업메모", "사진여부", "저장일시"];
    const lines = [headers.map(csvEscape).join(",")];
    filtered.forEach((item, idx) => {
        lines.push([
            idx + 1,
            item.date,
            item.workerId,
            item.shipName,
            item.wage1,
            item.wage2,
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


export {
  switchBlockRankMode,
  renderStatsBlockRanking,
  renderStatsTerminalRanking,
  openVisitorStats,
  refreshVisitorStatsModal,
  loadAndRenderVisitorStats,
  copyVisitorStatsReport,
  toggleStatsWorkerAccountList,
  renderStatsWorkerAccountList,
  closeVisitorStats,
  openAdminWorkLogDetail,
  openAdminWorkLogDetailFromStats,
  showAdminWorkLogModal,
  closeAdminWorkLogDetail,
  loadAdminWorkLogDetail,
  populateAdminWorkLogWorkerSelect,
  getAdminWorkLogFiltered,
  filterAdminWorkLogByWorker,
  filterAdminWorkLogByKeyword,
  resetAdminWorkLogFilters,
  renderAdminWorkLogDetail,
  downloadAdminWorkLogCsv,
  copyAdminWorkLogReport
};

Object.assign(window, {
  switchBlockRankMode,
  renderStatsBlockRanking,
  renderStatsTerminalRanking,
  openVisitorStats,
  refreshVisitorStatsModal,
  loadAndRenderVisitorStats,
  copyVisitorStatsReport,
  toggleStatsWorkerAccountList,
  renderStatsWorkerAccountList,
  closeVisitorStats,
  openAdminWorkLogDetail,
  openAdminWorkLogDetailFromStats,
  showAdminWorkLogModal,
  closeAdminWorkLogDetail,
  loadAdminWorkLogDetail,
  populateAdminWorkLogWorkerSelect,
  getAdminWorkLogFiltered,
  filterAdminWorkLogByWorker,
  filterAdminWorkLogByKeyword,
  resetAdminWorkLogFilters,
  renderAdminWorkLogDetail,
  downloadAdminWorkLogCsv,
  copyAdminWorkLogReport
});
