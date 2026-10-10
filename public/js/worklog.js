function generateReceiptCanvas(mode) {
    const canvas = document.createElement("canvas");
    const width = 680;
    let lines = [];
    let title = "";
    let subTitle = "";
    let highlightTotal = "";

    if (mode === "wage") {
        title = "🧾 부산항 임금 산정 명세서";
        const sd = document.getElementById("wageStartDate")?.value || "-";
        const ed = document.getElementById("wageEndDate")?.value || "-";
        subTitle = `근무 일자: ${sd} ~ ${ed}`;
        document.querySelectorAll("#wageSpecBody tr").forEach(tr => {
            const tds = tr.querySelectorAll("td");
            if (tds.length === 2) {
                lines.push({ label: tds[0].innerText.trim(), value: tds[1].innerText.trim() });
            }
        });
        highlightTotal = `예상 실수령액: ${document.getElementById("wageTotal")?.innerText || "0원"}`;
    } else {
        const monthTitle = document.getElementById("calMonthYear")?.innerText || "이번 달";
        title = `🧾 ${monthTitle} 근무일지 정산 요약표`;
        subTitle = `근로자: ${currentWorkerId || "내 저장소"} · 발급일: ${new Date().toISOString().split("T")[0]}`;
        lines.push({ label: "🗓️ 총 출근일수", value: `${latestMonthlyStatsCache.days}일` });
        lines.push({ label: "📈 일평균 수입", value: `${latestMonthlyStatsCache.avg.toLocaleString()}원` });
        lines.push({ label: "💵 임금 1 합계", value: `${latestMonthlyStatsCache.w1Sum.toLocaleString()}원` });
        lines.push({ label: "💴 임금 2 합계", value: `${latestMonthlyStatsCache.w2Sum.toLocaleString()}원` });
        const goal = Math.max(100000, Number(monthlyGoalAmount) || 4500000);
        const pct = Math.round((latestMonthlyStatsCache.total / goal) * 100);
        lines.push({ label: "🎯 월 목표 달성률", value: `${pct}% (목표 ${(goal/10000).toFixed(0)}만 원)` });
        const sortedDates = Object.keys(adminWorkLogs || {}).sort().slice(-6);
        if (sortedDates.length > 0) {
            lines.push({ label: "── 최근 근무 내역 (최대 6건) ──", value: "" });
            sortedDates.forEach(dStr => {
                const d = adminWorkLogs[dStr];
                if (d) {
                    lines.push({
                        label: `${dStr.slice(5)} · ${d.shipName || "선박 미입력"}`,
                        value: `${(Number(d.totalPay) || 0).toLocaleString()}원`
                    });
                }
            });
        }
        highlightTotal = `이번 달 총수입: ${latestMonthlyStatsCache.total.toLocaleString()}원`;
    }

    const height = 250 + lines.length * 42;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#0a1b3f";
    ctx.fillRect(20, 20, width - 40, 86);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 26px sans-serif";
    ctx.fillText(title, 44, 62);
    ctx.fillStyle = "#93c5fd";
    ctx.font = "700 16px sans-serif";
    ctx.fillText(subTitle, 44, 90);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(20, 106, width - 40, height - 126);
    ctx.strokeStyle = "#0a1b3f";
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    let y = 148;
    lines.forEach(item => {
        ctx.fillStyle = "#334155";
        ctx.font = "700 18px sans-serif";
        ctx.fillText(item.label, 44, y);

        ctx.fillStyle = "#0f172a";
        ctx.font = "900 18px sans-serif";
        const valWidth = ctx.measureText(item.value).width;
        ctx.fillText(item.value, width - 44 - valWidth, y);

        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(44, y + 14);
        ctx.lineTo(width - 44, y + 14);
        ctx.stroke();
        y += 42;
    });

    ctx.fillStyle = "#eff6ff";
    ctx.fillRect(36, height - 96, width - 72, 54);
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.strokeRect(36, height - 96, width - 72, 54);

    ctx.fillStyle = "#1d4ed8";
    ctx.font = "900 22px sans-serif";
    ctx.fillText(highlightTotal, 54, height - 61);

    ctx.fillStyle = "#64748b";
    ctx.font = "700 13px sans-serif";
    ctx.fillText("BUSAN HAK PORT INFO · 스마트 정산 명세서", 44, height - 26);

    return { canvas, title, subTitle, lines, highlightTotal };
}
function saveReceiptImage(mode) {
    if (!isWorkLogUnlocked) {
        openWorkLogPinModal(() => saveReceiptImage(mode));
        return;
    }
    trackAppEvent('actions', 'receipt_share');
    const { canvas, title } = generateReceiptCanvas(mode);
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${title.replace(/[^\w가-힣]/g, "_")}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("📸 명세서 이미지가 내 기기에 저장되었습니다!");
}
async function shareReceiptCard(mode) {
    if (!isWorkLogUnlocked) {
        openWorkLogPinModal(() => shareReceiptCard(mode));
        return;
    }
    trackAppEvent('actions', 'receipt_share');
    const { canvas, title, subTitle, lines, highlightTotal } = generateReceiptCanvas(mode);
    const textSummary = [
        `[${title}]`,
        subTitle,
        ...lines.map(l => l.value ? `• ${l.label}: ${l.value}` : l.label),
        `▶ ${highlightTotal}`
    ].join("\n");

    try {
        if (navigator.canShare && canvas.toBlob) {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
            if (blob) {
                const file = new File([blob], "busan_port_receipt.png", { type: "image/png" });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({ title, text: textSummary, files: [file] });
                    return;
                }
            }
        }
        if (navigator.share) {
            await navigator.share({ title, text: textSummary });
            return;
        }
    } catch (e) {}

    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textSummary);
        showToast("📋 정산 명세서 내용이 복사되었습니다! 카카오톡 등에 붙여넣기 하세요.");
    } else {
        saveReceiptImage(mode);
    }
}
function toggleWageLayoutMode() {
    const layout = document.querySelector('#wage-card .calc-layout');
    const btn = document.getElementById('wageLayoutToggleBtn');
    if (!layout) return;
    const isWide = layout.classList.toggle('wide-mode');
    if (btn) {
        btn.innerText = isWide ? '📐 5:5 단가표 나란히 보기' : '📐 입력창 넓게 보기';
        btn.style.background = isWide ? '#dbeafe' : '#eff6ff';
    }
}
async function shareOrCopyAppPromo() {
    trackAppEvent('actions', 'promo_share');
    const promoText = [
        "🚢 [부산항 항만 근로자 필수 앱 - BUSAN HAK PORT] 🚢",
        "",
        "✅ 주·야간/기능공/수당 자동 [임금계산기]",
        "✅ 달력에 적고 한 달 총액 자동 정산되는 [근무일지]",
        "✅ 1·2·3항업 전 터미널 [스케줄·차트·베이 플랜·식단표·셔틀 시간표]",
        "✅ 배마다 어떤 콘/장비 쓰는지 미리 보는 [작업 선박 정보(등록및검색) 도감]",
        "✅ 신항·북항 실시간 풍속·날씨 및 도선 현황까지!",
        "",
        "👇 아래 주소 누르셔서 바로 써보세요!",
        "https://busan-hak-port-info.vercel.app",
        "",
        "💡 [휴대폰 바탕화면에 아이콘 만드는 법]",
        "• 갤럭시: 주소 접속 후 우측 메뉴(⋮ 또는 ≡) → [홈 화면에 추가]",
        "• 아이폰: 사파리(Safari)로 접속 후 하단 공유 버튼(📤) → [홈 화면에 추가]",
        "",
        "(운영관리자: 이춘학 / 문의: 010-2846-8906)"
    ].join("\n");
    try {
        if (navigator.share) {
            await navigator.share({
                title: "부산항 스마트 작업 가이드 (BUSAN HAK PORT)",
                text: promoText,
                url: "https://busan-hak-port-info.vercel.app"
            });
            return;
        }
    } catch (e) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(promoText);
        showToast("📋 앱 홍보글과 접속 주소가 복사되었습니다! 카톡이나 문자에 붙여넣기 하세요.");
    } else {
        const ta = document.createElement("textarea");
        ta.value = promoText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showToast("📋 앱 홍보글과 접속 주소가 복사되었습니다!");
    }
}
function updateMonthlyStatsUI(logsMap) {
    let total = 0, w1Sum = 0, w2Sum = 0, days = 0;
    Object.values(logsMap || {}).forEach(d => {
        if (!d) return;
        const p = Number(d.totalPay) || 0;
        const w1 = Number(d.wage1) || 0;
        const w2 = Number(d.wage2) || 0;
        if (p > 0 || d.shipName || d.memo || d.coworkers) days++;
        total += p;
        w1Sum += w1;
        w2Sum += w2;
    });
    const avg = days > 0 ? Math.round(total / days) : 0;
    latestMonthlyStatsCache = { total, w1Sum, w2Sum, days, avg };
    const totalEl = document.getElementById('monthlyTotalDisplay');
    const daysEl = document.getElementById('monthlyWorkDays');
    const avgEl = document.getElementById('monthlyAvgPay');
    const splitEl = document.getElementById('monthlySplitPay');
    const logSubMeta = document.getElementById('logCardSubMeta');
    if (totalEl) totalEl.innerText = `이번 달 총액: ${total.toLocaleString()}원`;
    if (daysEl) daysEl.innerText = `${days}일`;
    if (avgEl) avgEl.innerText = `${avg.toLocaleString()}원`;
    if (splitEl) splitEl.innerText = `${(w1Sum/10000).toFixed(0)}만 / ${(w2Sum/10000).toFixed(0)}만`;
    if (logSubMeta) {
        logSubMeta.innerText = days > 0 ? `이번 달 출근 ${days}일 · ${(total/10000).toFixed(0)}만 원` : `날짜 클릭 기록 · 월간 정산 관리`;
    }
    updateMonthlyGoalGaugeUI(total, days);
    renderWorkLogQuickChips();
}
function renderCalendar(y, m){
    const g = document.getElementById('calendarGrid');
    document.getElementById('calMonthYear').innerText = `${y}년 ${m+1}월`;
    const fD = new Date(y, m, 1).getDay(), lD = new Date(y, m+1, 0).getDate();
    const nowObj = new Date();
    const todayStr = `${nowObj.getFullYear()}-${String(nowObj.getMonth()+1).padStart(2,'0')}-${String(nowObj.getDate()).padStart(2,'0')}`;
    const cellsHtml = [];
    for(let i=0; i<fD; i++) cellsHtml.push(`<div></div>`);
    for(let d=1; d<=lD; d++){
        const dStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        let dayColor = "var(--text-main)";
        let currentDayObj = new Date(y, m, d).getDay();
        if (currentDayObj === 0) dayColor = "#ef4444";
        if (currentDayObj === 6) dayColor = "#3b82f6";
        const isToday = (dStr === todayStr);
        cellsHtml.push(`<div id="cal-day-${d}" data-date="${dStr}" class="cal-day tap-effect ${isToday ? 'is-today' : ''}" onclick="clickDate('${dStr}')" style="color: ${dayColor};"><div>${d}${isToday ? '<span class="cal-today-tag">오늘</span>' : ''}</div><div class="cal-dot"></div></div>`);
    }
    g.innerHTML = cellsHtml.join("");
    if(currentWorkerId) {
        const sDate = `${y}-${String(m+1).padStart(2,'0')}-01`, eDate = `${y}-${String(m+1).padStart(2,'0')}-${lD}`;
        db.collection('work_logs').where('date', '>=', sDate).where('date', '<=', eDate).get().then(s => {
            adminWorkLogs = {};
            s.forEach(doc => {
                const data = doc.data();
                if(data.workerId === currentWorkerId) {
                    adminWorkLogs[data.date] = data;
                    const day = parseInt(data.date.split('-')[2]);
                    const el = document.getElementById(`cal-day-${day}`);
                    if(el) {
                        el.classList.add('has-data');
                        const payNum = Number(data.totalPay) || 0;
                        if (payNum > 0 && !el.querySelector('.cal-pay-tag')) {
                            const manVal = (payNum / 10000).toFixed(payNum % 10000 === 0 ? 0 : 1);
                            el.insertAdjacentHTML('beforeend', `<div class="cal-pay-tag">${manVal}만</div>`);
                        }
                        if (data.coworkers) {
                            if (!el.querySelector('.coworker-badge')) {
                                el.insertAdjacentHTML('beforeend', `<div class="coworker-badge">${escapeShipCommentHtml(data.coworkers)}</div>`);
                            } else {
                                el.querySelector('.coworker-badge').innerText = data.coworkers;
                            }
                        }
                    }
                }
            });
            updateMonthlyStatsUI(adminWorkLogs);
            applyWorkLogFilter();
            const selDate = document.getElementById('dailyLogForm')?.getAttribute('data-date');
            if (selDate && !document.getElementById('dailyLogForm')?.classList.contains('hidden')) {
                loadHjncScheduledShipsForDate(selDate);
            }
            if (isWorkLogUnlocked) loadAndRenderYearlyD3Chart(y);
        });
    } else {
        updateMonthlyStatsUI({});
        const selDate = document.getElementById('dailyLogForm')?.getAttribute('data-date');
        if (selDate && !document.getElementById('dailyLogForm')?.classList.contains('hidden')) {
            loadHjncScheduledShipsForDate(selDate);
        }
        if (isWorkLogUnlocked) loadAndRenderYearlyD3Chart(y);
    }
}
let rangeFetchedLogs = null;
function matchesLogFilter(log, startDate, endDate, keyword) {
    if (!log) return false;
    if (startDate && log.date < startDate) return false;
    if (endDate && log.date > endDate) return false;
    if (keyword) {
        const hay = `${log.date || ''} ${log.shipName || ''} ${log.coworkers || ''} ${log.memo || ''} ${log.totalPay || ''}`.toLowerCase();
        if (!hay.includes(keyword)) return false;
    }
    return true;
}
function applyWorkLogFilter(externalLogs) {
    const startDate = (document.getElementById('logFilterStartDate')?.value || '').trim();
    const endDate = (document.getElementById('logFilterEndDate')?.value || '').trim();
    const keyword = (document.getElementById('logFilterKeyword')?.value || '').trim().toLowerCase();
    const resultsBox = document.getElementById('logFilterResults');
    const isFiltering = Boolean(startDate || endDate || keyword);

    document.querySelectorAll('#calendarGrid .cal-day').forEach(cell => {
        cell.classList.remove('filter-match', 'filter-dim');
        if (!isFiltering) return;
        const dStr = cell.getAttribute('data-date');
        const log = adminWorkLogs[dStr];
        if (matchesLogFilter(log, startDate, endDate, keyword)) {
            cell.classList.add('filter-match');
        } else {
            cell.classList.add('filter-dim');
        }
    });

    if (!resultsBox) return;
    if (!isFiltering) {
        resultsBox.classList.add('hidden');
        resultsBox.innerHTML = '';
        rangeFetchedLogs = null;
        return;
    }

    const sourceMap = externalLogs || rangeFetchedLogs || adminWorkLogs;
    const matched = Object.values(sourceMap)
        .filter(log => matchesLogFilter(log, startDate, endDate, keyword))
        .sort((a, b) => b.date.localeCompare(a.date));

    resultsBox.classList.remove('hidden');
    if (matched.length === 0) {
        resultsBox.innerHTML = `<div style="text-align:center; padding:10px; font-size:0.82rem; color:var(--text-sub); font-weight:700;">조건에 맞는 근무 기록이 없습니다.${!externalLogs && !rangeFetchedLogs && (startDate || endDate) ? ' 다른 달 기록을 찾으시려면 [기간 조회]를 눌러 주세요.' : ''}</div>`;
        return;
    }

    let sumPay = 0;
    const itemsHtml = matched.map(log => {
        const pay = Number(log.totalPay) || 0;
        sumPay += pay;
        const ship = escapeShipCommentHtml(log.shipName || '선박명 미입력');
        const workers = escapeShipCommentHtml(log.coworkers || '');
        const memo = escapeShipCommentHtml(log.memo || '');
        return `<div class="log-filter-item" onclick="jumpToLogDate('${log.date}')">
            <div style="flex:1; min-width:0;">
                <div style="font-weight:900; color:var(--primary);">${log.date} · 🚢 ${ship}</div>
                <div style="font-size:0.78rem; color:var(--text-sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${workers ? `👥 ${workers} ` : ''}${memo ? `📝 ${memo}` : ''}</div>
            </div>
            <div style="font-weight:900; color:#c2410c; white-space:nowrap;">${pay.toLocaleString()}원</div>
        </div>`;
    }).join('');

    resultsBox.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; font-weight:900; color:var(--primary); margin-bottom:6px; padding:0 4px;">
        <span>검색 결과: ${matched.length}건</span>
        <span>합계: ${sumPay.toLocaleString()}원</span>
    </div>${itemsHtml}`;
}
async function searchWorkLogsRange() {
    if (!currentWorkerId) {
        document.getElementById('loginModal').style.display = 'flex';
        return;
    }
    const startDate = (document.getElementById('logFilterStartDate')?.value || '').trim();
    const endDate = (document.getElementById('logFilterEndDate')?.value || '').trim();
    if (startDate && endDate && startDate > endDate) {
        alert("시작일이 종료일보다 늦을 수 없습니다.");
        return;
    }
    const resultsBox = document.getElementById('logFilterResults');
    if (resultsBox) {
        resultsBox.classList.remove('hidden');
        resultsBox.innerHTML = `<div style="text-align:center; padding:10px; font-size:0.82rem; color:var(--text-sub); font-weight:700;">기록을 조회하는 중...</div>`;
    }
    try {
        let query = db.collection('work_logs');
        if (startDate) query = query.where('date', '>=', startDate);
        if (endDate) query = query.where('date', '<=', endDate);
        const snap = await query.get();
        const fetched = {};
        snap.forEach(doc => {
            const data = doc.data();
            if (data.workerId === currentWorkerId) {
                fetched[data.date] = data;
            }
        });
        rangeFetchedLogs = fetched;
        if (startDate) {
            const parts = startDate.split('-');
            if (parts.length === 3) {
                currentDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
                renderCalendar(currentDate.getFullYear(), currentDate.getMonth());
            }
        }
        applyWorkLogFilter(fetched);
    } catch (e) {
        console.error("기간 조회 오류:", e);
        applyWorkLogFilter();
    }
}
function resetWorkLogFilter() {
    const s = document.getElementById('logFilterStartDate');
    const e = document.getElementById('logFilterEndDate');
    const k = document.getElementById('logFilterKeyword');
    if (s) s.value = '';
    if (e) e.value = '';
    if (k) k.value = '';
    rangeFetchedLogs = null;
    applyWorkLogFilter();
}
function jumpToLogDate(dStr) {
    if (!dStr) return;
    const parts = dStr.split('-');
    if (parts.length !== 3) return;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    if (rangeFetchedLogs && rangeFetchedLogs[dStr]) {
        adminWorkLogs[dStr] = rangeFetchedLogs[dStr];
    }
    if (currentDate.getFullYear() !== y || currentDate.getMonth() !== m) {
        currentDate = new Date(y, m, 1);
        renderCalendar(y, m);
    }
    clickDate(dStr);
    const formEl = document.getElementById('dailyLogForm');
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clickDate(dStr){ document.getElementById('selectedDateText').innerText = dStr; document.getElementById('dailyLogForm').classList.remove('hidden'); document.getElementById('dailyLogForm').setAttribute('data-date', dStr); const d = adminWorkLogs[dStr]; document.getElementById('logShipName').value = d ? (d.shipName || '') : ''; document.getElementById('logWage1').value = d ? (d.wage1 || '') : ''; document.getElementById('logWage2').value = d ? (d.wage2 || '') : ''; document.getElementById('logCoworkers').value = d ? (d.coworkers || '') : ''; document.getElementById('logMemo').value = d ? d.memo : ''; const img = document.getElementById('logImagePreview'); if(d && d.imageUrl){ img.src = d.imageUrl; img.style.display = 'block'; } else { img.style.display = 'none'; img.src = ""; } document.getElementById('logImageInput').value = ''; renderWorkLogQuickChips(dStr); }
function trySaveWorkLog(){ if(currentWorkerId) saveWorkLog(); else document.getElementById('loginModal').style.display = 'flex'; }
async function confirmLoginAndSave(evt) {
    const nick = document.getElementById('loginNick').value.trim();
    const pw = document.getElementById('loginPw').value.trim();
    const btn = (evt && evt.currentTarget) || document.getElementById('confirmLoginBtn') || (typeof event !== 'undefined' && event ? event.target : null);

    if (!nick || !pw) {
        alert("닉네임과 비밀번호를 입력해 주세요.");
        return;
    }

    // 버튼 중복 클릭 방지
    btn.disabled = true;
    btn.innerText = "연결 시도 중...";

    try {
        await ensureAnonymousAuth();
        const pwHash = await sha256Hex(pw);
        // 네트워크 상태와 상관없이 Firestore 참조를 명확히 가져옴
        const userRef = db.collection('user_profiles').doc(nick);
        
        // 데이터 가져오기 (get) 시도
        const doc = await userRef.get().catch(e => {
            throw new Error("서버 연결 실패 (네트워크를 확인하세요)");
        });

        if (doc.exists) {
            const savedPw = doc.data().password || "";
            const isMatched = await verifyPasswordMatch(pw, savedPw);
            if (!isMatched) {
                alert("비밀번호가 일치하지 않습니다.");
                btn.disabled = false;
                btn.innerText = "확인 및 저장";
                return;
            }
            // 기존 평문 비밀번호였던 경우 자동으로 SHA-256 해시로 업그레이드
            if (savedPw !== pwHash) {
                await userRef.set({ password: pwHash }, { merge: true }).catch(() => {});
            }
        } else {
            if(!confirm("새로운 닉네임입니다. 가입하시겠습니까?")) {
                btn.disabled = false;
                btn.innerText = "확인 및 저장";
                return;
            }
            await userRef.set({ 
                password: pwHash, 
                createdAt: firebase.firestore.FieldValue.serverTimestamp() 
            });
        }

        // 로그인 성공 세션 저장
        currentWorkerId = nick;
        localStorage.setItem('myWorkerId', nick);
        updateUserBar();
        
        // 모달 닫고 저장 실행
        closeLoginModal();
        saveWorkLog(); 
        
        showToast("🔓 로그인 및 저장 성공!");

    } catch (err) {
        console.error("에러 디테일:", err);
        alert("⚠️ 오류 발생: " + err.message);
        btn.disabled = false;
        btn.innerText = "확인 및 저장";
    }
}

function saveWorkLog(){ 
    const btn = document.getElementById('saveLogBtn'); 
    const dStr = document.getElementById('dailyLogForm').getAttribute('data-date'); 

    // 🚩 [보안 강화] 로그인이 안 되어 있으면 저장 차단 및 로그인창 표시
    if(!currentWorkerId) {
        alert("로그인이 필요합니다. 닉네임과 비밀번호를 먼저 입력해 주세요!");
        document.getElementById('loginModal').style.display = 'flex';
        return;
    }

    if(!dStr) { 
        alert("날짜가 선택되지 않았습니다."); 
        return; 
    } 

    btn.innerText = "저장 중... (0%)"; 
    btn.disabled = true; 

    const shipNameInfo = document.getElementById('logShipName').value.trim(); 
    const previousWorkLog = adminWorkLogs[dStr] || {};
    const previousShipName = previousWorkLog.shipName || "";
    const w1 = parseFloat(document.getElementById('logWage1').value) || 0; 
    const w2 = parseFloat(document.getElementById('logWage2').value) || 0; 
    const coworkersInfo = document.getElementById('logCoworkers').value.trim(); 
    const memo = document.getElementById('logMemo').value; 
    const file = document.getElementById('logImageInput').files[0]; 
    const pay = w1 + w2; 

    const shouldOfferVesselInfoFollowUp =
        !!normalizeVesselInfoName(shipNameInfo) &&
        (
            normalizeVesselInfoName(shipNameInfo) !==
                normalizeVesselInfoName(previousShipName) ||
            String(memo || "").trim() !==
                String(previousWorkLog.memo || "").trim()
        );
    
    // 문서 ID 생성 (닉네임_날짜 형식)
    const docId = `${currentWorkerId}_${dStr}`; 

    const finalizeSave = (url) => { 
        btn.innerText = "데이터 기록 중..."; 
        const logData = { 
            date: dStr, 
            workerId: currentWorkerId, 
            shipName: shipNameInfo, 
            wage1: w1, 
            wage2: w2, 
            coworkers: coworkersInfo, 
            memo: memo, 
            totalPay: pay, 
            imageUrl: url,
            timestamp: firebase.firestore.FieldValue.serverTimestamp() // 🚩 저장 시간 기록 추가
        }; 

        db.collection('work_logs').doc(docId).set(logData, {merge: true}).then(() => { 
            trackAppEvent('actions', 'log_save');
            btn.innerText = "✅ 저장 완료!"; 
            btn.style.background = "var(--success)"; 
            showToast("근무일지가 안전하게 저장되었습니다."); 
            
            // 데이터 즉시 갱신
            adminWorkLogs[dStr] = logData; 
            renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); 

            if (shouldOfferVesselInfoFollowUp) {
                setTimeout(() => startVesselInfoFollowUp("workLog", {
                    vesselName: shipNameInfo,
                    date: dStr
                }), 350);
            } 

            setTimeout(() => { 
                btn.innerText = "저장하기"; 
                btn.style.background = ""; // 기본색으로 복구
                btn.disabled = false; 
            }, 1500); 
        }).catch(err => { 
            alert("데이터베이스 저장 실패: " + err.message); 
            btn.innerText = "저장하기"; 
            btn.disabled = false; 
        }); 
    }; 

    // 사진 업로드 로직
    if(file) { 
        const storageRef = storage.ref(`logs/${currentWorkerId}/${Date.now()}_${file.name}`); 
        const uploadTask = storageRef.put(file); 
        uploadTask.on('state_changed', (snapshot) => { 
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100; 
            btn.innerText = `업로드 중... ${Math.round(progress)}%`; 
        }, (error) => { 
            alert("사진 업로드 실패: " + error.message); 
            btn.innerText = "저장하기"; 
            btn.disabled = false; 
        }, () => { 
            uploadTask.snapshot.ref.getDownloadURL().then((downloadURL) => { 
                finalizeSave(downloadURL); 
            }); 
        }); 
    } else { 
        // 기존 사진 유지 또는 사진 없음 처리
        const existingUrl = (adminWorkLogs[dStr] && adminWorkLogs[dStr].imageUrl) ? adminWorkLogs[dStr].imageUrl : null; 
        finalizeSave(existingUrl); 
    } 
}
function loginSuccess(name) { currentWorkerId = name; localStorage.setItem('myWorkerId', currentWorkerId); updateUserBar(); renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); }
function closeLoginModal(){ document.getElementById('loginModal').style.display = 'none'; }
function updateUserBar() { document.getElementById('userProfileBar').style.display = currentWorkerId ? 'flex' : 'none'; if(currentWorkerId) document.getElementById('currentUserDisplay').innerText = `👤 ${currentWorkerId}`; }
function logoutWorker() { if(confirm("로그아웃하시겠습니까?")) { currentWorkerId = null; localStorage.removeItem('myWorkerId'); updateUserBar(); renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); document.getElementById('dailyLogForm').classList.add('hidden'); } }
function deleteWorkLog(){ if(!currentWorkerId) return; if(!confirm("정말 삭제하시겠습니까?")) return; const dStr = document.getElementById('dailyLogForm').getAttribute('data-date'); db.collection('work_logs').doc(`${currentWorkerId}_${dStr}`).delete().then(()=>{ showToast("삭제되었습니다."); document.getElementById('logShipName').value=''; document.getElementById('logWage1').value=''; document.getElementById('logWage2').value=''; document.getElementById('logCoworkers').value=''; document.getElementById('logMemo').value=''; document.getElementById('logImageInput').value = ''; const imgPreview = document.getElementById('logImagePreview'); if(imgPreview) { imgPreview.src = ''; imgPreview.style.display = 'none'; } renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); }).catch(err => alert("삭제 실패: " + err.message)); }
function changeMonth(s){ currentDate.setMonth(currentDate.getMonth()+s); renderCalendar(currentDate.getFullYear(), currentDate.getMonth()); }
function previewLogImage(input){ if(input.files&&input.files[0]){ const r=new FileReader(); r.onload=e=>{const i=document.getElementById('logImagePreview'); i.src=e.target.result; i.style.display='block';}; r.readAsDataURL(input.files[0]); } }
