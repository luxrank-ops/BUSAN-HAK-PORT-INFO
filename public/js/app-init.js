function openBusSchedule(){ trackAppEvent('actions', 'bus_view'); const m=document.getElementById('imageModal'); document.getElementById('modalImage').src='https://firebasestorage.googleapis.com/v0/b/busan-hak-port.firebasestorage.app/o/KakaoTalk_20260129_001114789.jpg?alt=media'; m.style.display='flex'; } function closeImageModal(){ document.getElementById('imageModal').style.display='none'; } function openPrivacy() { toggleDashItem('privacy-center-card'); document.getElementById('privacy-center-card').scrollIntoView({behavior: 'smooth', block: 'center'}); }

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js").then(reg => {
            reg.addEventListener("updatefound", () => {
                const newWorker = reg.installing;
                if (!newWorker) return;
                newWorker.addEventListener("statechange", () => {
                    if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                        if (typeof showToast === "function") {
                            showToast("✨ 새 버전이 준비되었습니다. 새로고침 시 즉시 반영됩니다.");
                        }
                    }
                });
            });
        }).catch(err => console.warn("SW 등록 확인:", err));
    });
}

async function ensureTodayUpdateNotice() {
    const noticeDocId = "update_2026_10_10_hak_port_ver2";
    const noticeVersion = "hak_port_ver2_20261010_r1";
    const noticeTitle = "HAK PORT Ver.2 업데이트";
    const noticeContent = [
        "부산항(신항·북항) 현장 근로자 여러분, 안녕하십니까! 운영관리자 이춘학입니다.",
        "더 빠르고 정확한 임금 계산과 모바일 현장 사용성을 위해 [HAK PORT Ver.2 업데이트]가 적용되었습니다. 오늘 반영된 주요 변경 사항을 안내해 드립니다.",
        "",
        "🚢 1. 당일 입·출항 선박 최대 2척 선택(더블오더) & 선박별 자동계산 연동",
        "• 당일 입·출항 선박 스케줄에서 작업 선박을 최대 2척까지 동시에 선택할 수 있습니다.",
        "• 2번째 선박 선택 시 [더블오더]가 자동 체크되며, [⏱️ 선박별 자동계산 (1번 선박 / 2번 선박)] 카드와 [⏳ 총 근무시간]에 선박별 근무시간이 자동 합산·표시됩니다.",
        "• 계산 완료 후 [이 계산 결과를 근무일지로 보내기]를 누르면 1번 선박은 [임금 1], 2번 선박(더블오더)은 [임금 2]로 자동 분리 입력됩니다.",
        "",
        "📅 2. 연도별 시급(기본 2026년 시급) 표시 및 달력 날짜 자동 연동",
        "• 시급 입력란이 [2026년 시급]으로 표시되며, 시작·종료 날짜 달력 및 선박 스케줄 달력에서 선택한 연도에 맞춰 해당 연도 시급 라벨과 기본 시급으로 자동 변경됩니다.",
        "• 시급 입력창 너비와 테두리 시인성을 강화하여 터치 및 직접 수정이 더욱 편리해졌습니다.",
        "",
        "📐 3. 임금계산기 화면 구성 최적화 및 접기/펼치기(▼) 기능 도입",
        "• [월·주간·야간 기준표]를 임금계산기 상단 헤더 오른쪽에 컴팩트하게 배치하여 공간 활용도를 높였습니다.",
        "• [📅 시작·종료 날짜·시간 수동 입력] 및 [✅ 추가 수당 시간 입력] 블록을 터치하여 접고 펼칠 수 있도록 개선했습니다.",
        "• [⏱️ 선박별 자동계산(7) · ⏳ 총 근무시간(3)] 블록을 추가 수당 입력 아래(내역서 생성 버튼 바로 위)로 이동하여 선박 선택부터 계산까지 한눈에 확인하실 수 있습니다.",
        "",
        "🧾 4. 세금 공제 선택 제거 및 순수 임금 산정 일원화",
        "• 기존의 복잡한 세금 공제(프리랜서 3.3% / 4대보험) 선택 블록을 제거하고, 주·야간 기본급, 기능공 수당, 추가 가산 수당 중심의 직관적인 순수 임금 산정 내역서로 일원화했습니다.",
        "",
        "📱 5. 모바일(Galaxy S24 Ultra 등) 상단 헤더 및 오프라인 안정성 강화",
        "• 작은 화면에서도 상단 방문자 배지·타이틀·야간모드 버튼이 겹치지 않도록 레이아웃을 보완하고, 터미널 카드 내 [작업중] 선박 강조 테두리와 오프라인 캐시 안정성을 높였습니다.",
        "",
        "언제나 안전을 최우선으로 작업하시길 바라며, 이용 문의나 건의 사항은 운영관리자(이춘학 / 010-2846-8906)에게 언제든 연락해 주시기 바랍니다. 오늘도 무사고 안전 작업하십시오!"
    ].join("\n");
    try {
        const docRef = db.collection("notices").doc(noticeDocId);
        const snap = await docRef.get();
        if (!snap.exists || snap.data()?.version !== noticeVersion) {
            await docRef.set({
                title: noticeTitle,
                content: noticeContent,
                version: noticeVersion,
                isPriority: true,
                imageUrl: null,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (e) {
        console.warn("업데이트 공지 자동 등록 확인 중 오류:", e);
    }
}

const DAILY_FIELD_ENGLISH_PHRASES = [
    { sentence: "Please wait here.", pronunciation: "플리즈 웨잇 히어", meaning: "여기서 기다려 주세요.", word: "wait = 기다리다" },
    { sentence: "Watch your step.", pronunciation: "와치 유어 스텝", meaning: "발밑을 조심하세요.", word: "step = 발걸음, 계단" },
    { sentence: "Please wear a helmet.", pronunciation: "플리즈 웨어 어 헬멧", meaning: "안전모를 써 주세요.", word: "wear = 착용하다" },
    { sentence: "The ship is here.", pronunciation: "더 쉽 이즈 히어", meaning: "배가 여기에 있어요.", word: "ship = 배" },
    { sentence: "The crane is moving.", pronunciation: "더 크레인 이즈 무빙", meaning: "크레인이 움직이고 있어요.", word: "moving = 움직이는 중" },
    { sentence: "Stay behind the line.", pronunciation: "스테이 비하인드 더 라인", meaning: "선 뒤에 서 주세요.", word: "behind = 뒤에" },
    { sentence: "Walk slowly, please.", pronunciation: "워크 슬로울리, 플리즈", meaning: "천천히 걸어 주세요.", word: "slowly = 천천히" },
    { sentence: "The floor is wet.", pronunciation: "더 플로어 이즈 웻", meaning: "바닥이 젖어 있어요.", word: "wet = 젖은" },
    { sentence: "Hold the handrail, please.", pronunciation: "홀드 더 핸드레일, 플리즈", meaning: "손잡이를 잡아 주세요.", word: "hold = 잡다" },
    { sentence: "Stay with your team.", pronunciation: "스테이 위드 유어 팀", meaning: "작업조와 함께 있어 주세요.", word: "team = 팀, 작업조" },
    { sentence: "Let's check the tools.", pronunciation: "렛츠 체크 더 툴즈", meaning: "도구를 함께 확인해요.", word: "check = 확인하다" },
    { sentence: "I need a safety vest.", pronunciation: "아이 니드 어 세이프티 베스트", meaning: "안전 조끼가 필요해요.", word: "need = 필요하다" },
    { sentence: "The truck is coming.", pronunciation: "더 트럭 이즈 커밍", meaning: "트럭이 오고 있어요.", word: "coming = 오는 중" },
    { sentence: "Do not run here.", pronunciation: "두 낫 런 히어", meaning: "여기서 뛰지 마세요.", word: "run = 뛰다" },
    { sentence: "Please stand back.", pronunciation: "플리즈 스탠드 백", meaning: "뒤로 물러나 주세요.", word: "stand back = 뒤로 물러서다" },
    { sentence: "Can you help me?", pronunciation: "캔 유 헬프 미?", meaning: "저를 도와주실 수 있나요?", word: "help = 돕다" },
    { sentence: "I am ready to work.", pronunciation: "아이 앰 레디 투 워크", meaning: "저는 일할 준비가 됐어요.", word: "ready = 준비된" },
    { sentence: "Please follow me.", pronunciation: "플리즈 팔로우 미", meaning: "저를 따라오세요.", word: "follow = 따라오다" },
    { sentence: "Put the tools here.", pronunciation: "풋 더 툴즈 히어", meaning: "도구를 여기에 놓아 주세요.", word: "put = 놓다" },
    { sentence: "Be careful near the crane.", pronunciation: "비 케어풀 니어 더 크레인", meaning: "크레인 근처에서는 조심하세요.", word: "careful = 조심하는" },
    { sentence: "The container is heavy.", pronunciation: "더 컨테이너 이즈 헤비", meaning: "컨테이너가 무거워요.", word: "heavy = 무거운" },
    { sentence: "Let's work together.", pronunciation: "렛츠 워크 투게더", meaning: "함께 일해요.", word: "together = 함께" },
    { sentence: "Is this the right place?", pronunciation: "이즈 디스 더 라이트 플레이스?", meaning: "여기가 맞는 장소인가요?", word: "right = 맞는" },
    { sentence: "Where is the meeting point?", pronunciation: "웨어 이즈 더 미팅 포인트?", meaning: "모이는 장소가 어디인가요?", word: "where = 어디" },
    { sentence: "Please look at the sign.", pronunciation: "플리즈 룩 앳 더 사인", meaning: "표지판을 봐 주세요.", word: "sign = 표지판" },
    { sentence: "Wait for the green light.", pronunciation: "웨잇 포 더 그린 라이트", meaning: "초록불을 기다려 주세요.", word: "green light = 초록불" },
    { sentence: "Keep a safe distance.", pronunciation: "킵 어 세이프 디스턴스", meaning: "안전거리를 유지해 주세요.", word: "safe = 안전한" },
    { sentence: "The work is finished.", pronunciation: "더 워크 이즈 피니시트", meaning: "작업이 끝났어요.", word: "finished = 끝난" },
    { sentence: "Thank you for your help.", pronunciation: "땡큐 포 유어 헬프", meaning: "도와주셔서 고맙습니다.", word: "thank you = 고맙습니다" },
    { sentence: "Use the safe path.", pronunciation: "유즈 더 세이프 패스", meaning: "안전한 길을 이용하세요.", word: "path = 길" }
];

const DAILY_FIELD_ENGLISH_TIME_ZONE = "Asia/Seoul";
const DAILY_FIELD_ENGLISH_UPDATE_HOUR = 9;
const DAILY_FIELD_ENGLISH_CYCLE_START = Date.UTC(2026, 0, 1);
const DAILY_FIELD_ENGLISH_FIRST_DATE_KEY = "2026-01-01";

let dailyFieldEnglishSelectedDateKey = "";
let dailyFieldEnglishActiveDateKey = "";
let dailyFieldEnglishCalendarYear = null;
let dailyFieldEnglishCalendarMonth = null;
let dailyFieldEnglishUpdateTimer = null;
let dailyFieldEnglishInitialized = false;

function getKoreaDateTimeParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: DAILY_FIELD_ENGLISH_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);

    const values = {};
    parts.forEach(part => {
        if (part.type !== "literal") values[part.type] = Number(part.value);
    });
    return values;
}

function formatDailyFieldEnglishDateKey(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getDailyFieldEnglishSnapshotForDateKey(dateKey) {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        month < 1 || month > 12 ||
        day < 1 || day > 31
    ) return null;

    const effectiveDate = new Date(Date.UTC(year, month - 1, day));
    if (
        effectiveDate.getUTCFullYear() !== year ||
        effectiveDate.getUTCMonth() + 1 !== month ||
        effectiveDate.getUTCDate() !== day
    ) return null;

    const daysSinceCycleStart = Math.floor(
        (effectiveDate.getTime() - DAILY_FIELD_ENGLISH_CYCLE_START) / 86400000
    );
    const phraseIndex =
        ((daysSinceCycleStart % DAILY_FIELD_ENGLISH_PHRASES.length) +
            DAILY_FIELD_ENGLISH_PHRASES.length) %
        DAILY_FIELD_ENGLISH_PHRASES.length;

    return {
        dateKey: formatDailyFieldEnglishDateKey(year, month, day),
        year,
        month,
        day,
        phrase: DAILY_FIELD_ENGLISH_PHRASES[phraseIndex]
    };
}

function getDailyFieldEnglishSnapshot(date = new Date()) {
    const koreaTime = getKoreaDateTimeParts(date);
    const effectiveDate = new Date(
        Date.UTC(koreaTime.year, koreaTime.month - 1, koreaTime.day)
    );

    if (koreaTime.hour < DAILY_FIELD_ENGLISH_UPDATE_HOUR) {
        effectiveDate.setUTCDate(effectiveDate.getUTCDate() - 1);
    }

    const dateKey = formatDailyFieldEnglishDateKey(
        effectiveDate.getUTCFullYear(),
        effectiveDate.getUTCMonth() + 1,
        effectiveDate.getUTCDate()
    );

    return getDailyFieldEnglishSnapshotForDateKey(dateKey);
}

function updateDailyFieldEnglishLesson(snapshot) {
    if (!snapshot) return;

    const sentenceEl = document.getElementById("dailyFieldEnglishSentence");
    if (sentenceEl) sentenceEl.textContent = snapshot.phrase.sentence;
    const pronEl = document.getElementById("dailyFieldEnglishPronunciation");
    if (pronEl) pronEl.textContent = snapshot.phrase.pronunciation;
    const meanEl = document.getElementById("dailyFieldEnglishMeaning");
    if (meanEl) meanEl.textContent = snapshot.phrase.meaning;
    const wordEl = document.getElementById("dailyFieldEnglishWord");
    if (wordEl) wordEl.textContent = snapshot.phrase.word;
    const dateEl = document.getElementById("dailyFieldEnglishDate");
    if (dateEl) dateEl.textContent = `${snapshot.year}년 ${snapshot.month}월 ${snapshot.day}일 문장`;

    const hintEl = document.getElementById("dailyFieldEnglishCalendarHint");
    if (hintEl) {
        hintEl.innerHTML = snapshot.dateKey === dailyFieldEnglishActiveDateKey
            ? "<strong>현재 문장</strong> · 날짜를 눌러 지난 문장을 복습하세요."
            : `${snapshot.month}월 ${snapshot.day}일 문장을 복습 중입니다.`;
    }
}

function renderDailyFieldEnglishCalendar() {
    const grid = document.getElementById("dailyFieldEnglishCalendarGrid");
    const monthLabel = document.getElementById("dailyFieldEnglishCalendarMonth");
    if (!grid || !monthLabel || !dailyFieldEnglishActiveDateKey) return;

    const activeSnapshot = getDailyFieldEnglishSnapshotForDateKey(
        dailyFieldEnglishActiveDateKey
    );
    if (!activeSnapshot) return;

    const year = dailyFieldEnglishCalendarYear;
    const month = dailyFieldEnglishCalendarMonth;
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const activeMonth = Date.UTC(activeSnapshot.year, activeSnapshot.month - 1, 1);
    const visibleMonth = Date.UTC(year, month - 1, 1);

    monthLabel.textContent = `${year}년 ${month}월`;
    const prevBtn = document.getElementById("dailyFieldEnglishPrevMonth");
    if (prevBtn) prevBtn.disabled = visibleMonth <= Date.UTC(2026, 0, 1);
    const nextBtn = document.getElementById("dailyFieldEnglishNextMonth");
    if (nextBtn) nextBtn.disabled = visibleMonth >= activeMonth;

    const cells = [];
    for (let blank = 0; blank < firstWeekday; blank++) {
        cells.push('<span class="daily-field-english-calendar-empty" aria-hidden="true"></span>');
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = formatDailyFieldEnglishDateKey(year, month, day);
        const isSelected = dateKey === dailyFieldEnglishSelectedDateKey;
        const isActiveDate = dateKey === dailyFieldEnglishActiveDateKey;
        const isDisabled =
            dateKey < DAILY_FIELD_ENGLISH_FIRST_DATE_KEY ||
            dateKey > dailyFieldEnglishActiveDateKey;

        const classes = ["daily-field-english-calendar-day"];
        if (isSelected) classes.push("is-selected");
        if (isActiveDate) classes.push("is-active-date");

        cells.push(
            `<button type="button"
                class="${classes.join(" ")}"
                onclick="selectDailyFieldEnglishDate('${dateKey}')"
                aria-pressed="${isSelected ? "true" : "false"}"
                ${isDisabled ? "disabled" : ""}>${day}</button>`
        );
    }

    while (cells.length % 7 !== 0) {
        cells.push('<span class="daily-field-english-calendar-empty" aria-hidden="true"></span>');
    }

    grid.innerHTML = cells.join("");
}

function selectDailyFieldEnglishDate(dateKey) {
    if (
        !dateKey ||
        dateKey < DAILY_FIELD_ENGLISH_FIRST_DATE_KEY ||
        dateKey > dailyFieldEnglishActiveDateKey
    ) return;

    const snapshot = getDailyFieldEnglishSnapshotForDateKey(dateKey);
    if (!snapshot) return;

    dailyFieldEnglishSelectedDateKey = dateKey;
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    updateDailyFieldEnglishLesson(snapshot);
    renderDailyFieldEnglishCalendar();
}

function changeDailyFieldEnglishMonth(offset) {
    const target = new Date(Date.UTC(
        dailyFieldEnglishCalendarYear,
        dailyFieldEnglishCalendarMonth - 1 + offset,
        1
    ));

    const targetMonth = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1);
    const activeSnapshot = getDailyFieldEnglishSnapshotForDateKey(
        dailyFieldEnglishActiveDateKey
    );
    if (!activeSnapshot) return;
    const activeMonth = Date.UTC(
        activeSnapshot.year,
        activeSnapshot.month - 1,
        1
    );

    if (targetMonth < Date.UTC(2026, 0, 1) || targetMonth > activeMonth) return;

    dailyFieldEnglishCalendarYear = target.getUTCFullYear();
    dailyFieldEnglishCalendarMonth = target.getUTCMonth() + 1;
    renderDailyFieldEnglishCalendar();
}

function showDailyFieldEnglishToday() {
    const currentSnapshot = getDailyFieldEnglishSnapshot();
    if (!currentSnapshot) return;

    dailyFieldEnglishActiveDateKey = currentSnapshot.dateKey;
    dailyFieldEnglishSelectedDateKey = currentSnapshot.dateKey;
    dailyFieldEnglishCalendarYear = currentSnapshot.year;
    dailyFieldEnglishCalendarMonth = currentSnapshot.month;

    updateDailyFieldEnglishLesson(currentSnapshot);
    renderDailyFieldEnglishCalendar();
}

function renderDailyFieldEnglish(date = new Date()) {
    const currentSnapshot = getDailyFieldEnglishSnapshot(date);
    if (!currentSnapshot) return;

    const previousActiveDateKey = dailyFieldEnglishActiveDateKey;
    dailyFieldEnglishActiveDateKey = currentSnapshot.dateKey;

    if (
        !dailyFieldEnglishSelectedDateKey ||
        dailyFieldEnglishSelectedDateKey === previousActiveDateKey ||
        dailyFieldEnglishSelectedDateKey > currentSnapshot.dateKey
    ) {
        dailyFieldEnglishSelectedDateKey = currentSnapshot.dateKey;
        dailyFieldEnglishCalendarYear = currentSnapshot.year;
        dailyFieldEnglishCalendarMonth = currentSnapshot.month;
    }

    if (!dailyFieldEnglishCalendarYear || !dailyFieldEnglishCalendarMonth) {
        dailyFieldEnglishCalendarYear = currentSnapshot.year;
        dailyFieldEnglishCalendarMonth = currentSnapshot.month;
    }

    const selectedSnapshot =
        getDailyFieldEnglishSnapshotForDateKey(dailyFieldEnglishSelectedDateKey) ||
        currentSnapshot;

    updateDailyFieldEnglishLesson(selectedSnapshot);
    renderDailyFieldEnglishCalendar();
}

function scheduleDailyFieldEnglishUpdate() {
    pauseDailyFieldEnglish();
    const now = new Date();
    const koreaTime = getKoreaDateTimeParts(now);
    const nextKoreaDate = new Date(Date.UTC(
        koreaTime.year,
        koreaTime.month - 1,
        koreaTime.day
    ));

    if (koreaTime.hour >= DAILY_FIELD_ENGLISH_UPDATE_HOUR) {
        nextKoreaDate.setUTCDate(nextKoreaDate.getUTCDate() + 1);
    }

    // 한국시간은 UTC+9이므로 다음 오전 9시에 맞춰 렌더링합니다.
    const nextUpdateUtc = Date.UTC(
        nextKoreaDate.getUTCFullYear(),
        nextKoreaDate.getUTCMonth(),
        nextKoreaDate.getUTCDate(),
        DAILY_FIELD_ENGLISH_UPDATE_HOUR
    ) - (9 * 60 * 60 * 1000);

    dailyFieldEnglishUpdateTimer = setTimeout(() => {
        renderDailyFieldEnglish();
        scheduleDailyFieldEnglishUpdate();
    }, Math.max(100, nextUpdateUtc - now.getTime() + 50));
}

function pauseDailyFieldEnglish() {
    if (dailyFieldEnglishUpdateTimer) {
        clearTimeout(dailyFieldEnglishUpdateTimer);
    }
    dailyFieldEnglishUpdateTimer = null;
}

function initializeDailyFieldEnglish() {
    if (!dailyFieldEnglishInitialized) {
        dailyFieldEnglishInitialized = true;

        document.addEventListener("visibilitychange", () => {
            const card = document.getElementById("daily-field-english-card");

            if (!document.hidden && card?.classList.contains("expanded")) {
                renderDailyFieldEnglish();
                scheduleDailyFieldEnglishUpdate();
            }
        });
    }

    renderDailyFieldEnglish();
    scheduleDailyFieldEnglishUpdate();
}

function speakDailyFieldEnglish() {
    const sentence = document.getElementById("dailyFieldEnglishSentence")
        ?.textContent?.trim();

    if (!sentence) return;
    if (!window.speechSynthesis ||
        typeof window.SpeechSynthesisUtterance !== "function") {
        showToast("이 브라우저에서는 영어 듣기를 사용할 수 없습니다.");
        return;
    }

    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(sentence);
    utterance.lang = "en-US";
    utterance.rate = 0.78;
    window.speechSynthesis.speak(utterance);
}

window.onload = async () => { 
    applyOfficialTerminalNames();
    appendTerminalMealBlocks();
    renderTerminalScheduleTabBar();
    await ensureAnonymousAuth();
    ["t1", "t2", "t3"].forEach(loadSectionTicker);
    trackVisitorSession();
    initTodayVisitorBadge();
    ensureTodayUpdateNotice();
    try { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); const todayStr = now.toISOString().split('T')[0]; const sDate = document.getElementById('wageStartDate'); const eDate = document.getElementById('wageEndDate'); if(sDate) sDate.value = todayStr; if(eDate) eDate.value = todayStr; if (typeof syncWageHourlyYearLabel === 'function') syncWageHourlyYearLabel(todayStr); const initMonth = parseInt(todayStr.split('-')[1], 10) || (now.getMonth() + 1); highlightSeasonRow(initMonth); applySeasonDefaultHours(initMonth, true); if (typeof syncWageHoursBlockSize === 'function') syncWageHoursBlockSize(); if (typeof loadWageScheduledShipsForDate === 'function') loadWageScheduledShipsForDate(todayStr, false); } catch(e) { console.error("날짜 초기화 오류", e); } 
    loadBanner(); 
    try { 
        db.collection("notices").orderBy("timestamp","desc").onSnapshot(s => { const l = document.getElementById("noticeList"); const badge = document.getElementById("noticeBadge"); const subMeta = document.getElementById("noticeCardSubMeta"); if (subMeta) subMeta.innerText = s.empty ? "운영 안내 및 주요 소식" : `등록된 공지 ${s.size}건`; if (s.empty) { l.innerHTML = "<tr><td colspan='3' style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>등록된 공지가 없습니다.</td></tr>"; if(badge) badge.classList.add("hidden"); return; } let isNew = false; const now = new Date(); let index = 0; const rowsHtml = []; s.forEach(d => { const x = d.data(); let dateStr = ""; if(x.timestamp) { const dt = x.timestamp.toDate(); dateStr = `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`; if (index === 0) { const diffTime = now.getTime() - dt.getTime(); if (diffTime < 24 * 60 * 60 * 1000) isNew = true; } } const linkedContent = autoLink(x.content); const imageHtml = x.imageUrl ? `<img src="${x.imageUrl}" loading="lazy" alt="공지사항 이미지" style="max-width:100%; border-radius:8px; margin-top:10px; border:1px solid rgba(0,0,0,0.1);" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src=this.src;">` : ''; const safeTitle = (x.title || '').replace(/'/g, "\\'").replace(/"/g, "&quot;"); const safeContent = (x.content || '').replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, "\\n"); const imgParam = x.imageUrl ? `'${x.imageUrl}'` : `null`; const rowId = `n-${d.id}`; rowsHtml.push(`<tr onclick="toggleBoardRow('${rowId}')" style="cursor:pointer; background:${index === 0 ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.02)'};"> <td class="board-no" style="color:var(--danger); font-weight:900;">${index === 0 ? '📌 필독' : '공지'}</td> <td class="board-title">📢 ${x.title} <span style="font-size:0.75rem; color:var(--primary); margin-left:4px;">▼</span></td> <td class="board-date">${dateStr}</td> </tr> <tr id="${rowId}" class="board-content-row"> <td colspan="3" class="board-content-box" style="border-left: 3px solid var(--danger);"> <div style="margin-bottom:15px; white-space:pre-wrap; font-weight:600; background:var(--card-bg); padding:12px; border-radius:8px; border:1px solid var(--border);">${linkedContent}</div> ${imageHtml} <div style="text-align:right; margin-top:10px;"> <button class="mini-btn" style="background:var(--primary) !important; margin-right:5px; color:white !important;" onclick="startEditNotice('${d.id}', '${safeTitle}', '${safeContent}', ${imgParam}, event)">✏️ 수정(Admin)</button> <button class="mini-btn btn-del" onclick="delNotice('${d.id}',event)">🗑️ 삭제(Admin)</button> </div> </td> </tr>`); index++; }); l.innerHTML = rowsHtml.join(""); if(badge) { if(isNew) badge.classList.remove("hidden"); else badge.classList.add("hidden"); } }); 
        db.collection("posts").orderBy("timestamp","desc").onSnapshot(s => { allPostsData = []; s.forEach(d => { allPostsData.push({...d.data(), id:d.id}) }); const subMeta = document.getElementById("boardCardSubMeta"); if (subMeta) subMeta.innerText = allPostsData.length > 0 ? `자유 게시글 ${allPostsData.length}건` : "현장 동료 자유 소통방"; const badge = document.getElementById("boardBadge"); if (badge) { if (allPostsData.length > 0 && allPostsData[0].timestamp) { const now = new Date(); const dt = allPostsData[0].timestamp.toDate(); const diffTime = now.getTime() - dt.getTime(); if (diffTime < 24 * 60 * 60 * 1000) badge.classList.remove("hidden"); else badge.classList.add("hidden"); } else badge.classList.add("hidden"); } renderBoardPage(1); }); 
        db.collection("ships").orderBy("timestamp","desc").onSnapshot(s=>{shipDirectorySnapshotLoaded = true; allShipsData=[]; s.forEach(d=>{allShipsData.push({...d.data(), id:d.id})}); const subMeta = document.getElementById("shipCardSubMeta"); if (subMeta) subMeta.innerText = allShipsData.length > 0 ? `등록 선박 ${allShipsData.length}척 · 장비 도감` : "난이도 · 필수 장비 도감"; filteredShips=allShipsData; renderShipPage(1); if(typeof loadAndSearchAllShips==="function") loadAndSearchAllShips(document.getElementById('shipSearch')?.value || '');}); 
        db.collection("archives").orderBy("timestamp","desc").onSnapshot(s=>{const l=document.getElementById("fileList"); const subMeta = document.getElementById("archiveCardSubMeta"); if (subMeta) subMeta.innerText = s.size > 0 ? `등록 자료 ${s.size}건 · 시간표` : "터미널 셔틀 시간표 · 서식"; const rowsHtml=[]; s.forEach(d=>{const x=d.data(); rowsHtml.push(`<tr><td class="board-title" style="width: 75%; padding-left: 10px;"><a href="${x.url}" target="_blank" style="text-decoration:none; color:var(--primary); font-weight:800;">💾 ${x.title}</a></td><td style="width: 25%; text-align:center;"><button class="mini-btn btn-del" onclick="delArchive('${d.id}',event)">삭제</button></td></tr>`);}); l.innerHTML=rowsHtml.join("");}); 
    } catch(err) { console.warn("실시간 연결 오류:", err); } 
    if(localStorage.getItem('myWorkerId')) { currentWorkerId = localStorage.getItem('myWorkerId'); updateUserBar(); }
    if (window.location.hash && window.location.hash.length > 1 && typeof applyHashRoute === "function") {
        applyHashRoute();
    } 
};

let leaderCurrentDate = new Date(); let leaderOverrides = []; const baseCycle = ["재경", "성철", "개굴"]; const baseAnchor = "2026-02-01"; function openLeaderSchedule() { trackAppEvent('actions', 'leader_cal'); document.getElementById('leaderCalendarModal').style.display = 'flex'; leaderCurrentDate = new Date(); renderLeaderCalendar(leaderCurrentDate.getFullYear(), leaderCurrentDate.getMonth()); } function closeLeaderCalendar() { document.getElementById('leaderCalendarModal').style.display = 'none'; } function changeLeaderMonth(s) { leaderCurrentDate.setMonth(leaderCurrentDate.getMonth() + s); renderLeaderCalendar(leaderCurrentDate.getFullYear(), leaderCurrentDate.getMonth()); } function getSlotIndex(dStr) { const target = new Date(dStr); const anchor = new Date(baseAnchor); const diffDays = Math.floor((target.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24)); return ((diffDays % 3) + 3) % 3; } function getCalculatedLeader(targetDateStr) { const targetSlot = getSlotIndex(targetDateStr); for (let i = leaderOverrides.length - 1; i >= 0; i--) { const ov = leaderOverrides[i]; if (ov.date <= targetDateStr) { if (getSlotIndex(ov.date) === targetSlot) return ov.leader; } } return baseCycle[targetSlot]; } function renderLeaderCalendar(y, m) { document.getElementById('leaderCalMonthYear').innerText = `${y}년 ${m+1}월`; const lD = new Date(y, m+1, 0).getDate(); db.collection('leader_overrides').get().then(s => { leaderOverrides = []; s.forEach(doc => { leaderOverrides.push(doc.data()); }); leaderOverrides.sort((a, b) => a.date.localeCompare(b.date)); drawLeaderGrid(y, m, lD); }).catch(err => { drawLeaderGrid(y, m, lD); }); } function drawLeaderGrid(y, m, lD) { const g = document.getElementById('leaderCalendarGrid'); const cells = []; const fD = new Date(y, m, 1).getDay(); for(let i=0; i<fD; i++) { cells.push(`<div style="background:transparent; border:none;"></div>`); } for(let d=1; d<=lD; d++) { const dStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; const isAnchor = leaderOverrides.some(ov => ov.date === dStr); const leaderName = getCalculatedLeader(dStr); let badgeClass = "leader-badge "; if (leaderName.includes("재경")) badgeClass += "leader-jaekyung"; else if (leaderName.includes("성철")) badgeClass += "leader-sungchul"; else if (leaderName.includes("개굴")) badgeClass += "leader-gaegool"; else badgeClass += "leader-jaekyung"; let customStyle = isAnchor ? "border: 2px solid #ef4444;" : ""; if (!baseCycle.includes(leaderName)) customStyle += "background-color: #8b5cf6; color: white;"; let dayColor = "var(--text-main)"; let currentDayObj = new Date(y, m, d).getDay(); if (currentDayObj === 0) dayColor = "#ef4444"; if (currentDayObj === 6) dayColor = "#3b82f6"; cells.push(`<div class="cal-day tap-effect" onclick="overrideLeader('${dStr}', '${leaderName}')" style="min-height: 65px; justify-content: flex-start; padding-top: 5px; background: white;"><span style="color: ${dayColor}; font-weight: 900; font-size: 0.95rem;">${d}</span><div class="${badgeClass}" style="${customStyle}">${leaderName}</div></div>`); } g.innerHTML = cells.join(""); } async function overrideLeader(dStr, currentLeader) { if (!(await verifyAdmin())) return; const newLeader = prompt(`[${dStr}] 조장을 변경합니다.\n\n👉 이곳에 새 이름(예: 용병)을 넣으면 이후 3일마다 돌아오는 이 근무조의 스케줄이 모두 교체됩니다.\n\n※ 취소하려면 '초기화'를 입력하세요.`, currentLeader); if (newLeader === null) return; if (newLeader.trim() === "" || newLeader === "초기화") { db.collection('leader_overrides').doc(dStr).delete().then(() => { showToast("기존 패턴이 복구되었습니다."); renderLeaderCalendar(leaderCurrentDate.getFullYear(), leaderCurrentDate.getMonth()); }); } else { db.collection('leader_overrides').doc(dStr).set({ date: dStr, leader: newLeader.trim() }).then(() => { showToast("새 근무조가 적용되었습니다."); renderLeaderCalendar(leaderCurrentDate.getFullYear(), leaderCurrentDate.getMonth()); }); } }

/**
 * 조장 근무일 접근 권한 검증 모듈
 * @param {Event} event - 클릭 이벤트 객체
 */
function verifyLeaderAccess(event) {
    try {
        // 1. 기본 이벤트 전파 차단
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        // 2. 요청하신 안내 문구와 함께 비밀번호 입력창 호출
        const userPassword = prompt("비밀번호를 입력하세요.\n(비밀번호는 제작자에게 문의 바랍니다. 문의: luxrank@gmail.com / 문자: 010-2846-8906)");

        // 3. 취소 버튼을 누르거나 빈값일 경우 안전하게 중단 (예외 처리)
        if (userPassword === null) {
            return false;
        }

        // 4. 비밀번호 확인 (9363)
        if (userPassword.trim() === "9363") {
            alert("인증되었습니다.");
            
            // 5. 원래 실행되어야 할 함수가 있다면 안전하게 호출, 없으면 관리자 페이지 등으로 연결
            if (typeof openLeaderSchedule === "function") {
                openLeaderSchedule();
            } else {
                // 만약 연결된 함수가 없다면 기본 동작이나 페이지 이동 처리 가능
                console.warn("openLeaderSchedule 함수가 정의되어 있지 않습니다.");
            }
        } else {
            alert("비밀번호가 일치하지 않습니다.");
            return false;
        }
    } catch (error) {
        // 6. 런타임 에러 핸들링 (OWASP 방어 지침 준수)
        console.error("비밀번호 검증 중 오류 발생:", error);
        alert("일시적인 오류가 발생했습니다. 다시 시도해 주세요.");
        return false;
    }
}
