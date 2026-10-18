// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================

/* ============================================================
   [방안 A] 5대 핵심 탭 뷰 하이브리드 컨트롤러
   ------------------------------------------------------------
   · 최초 접속 시      : 기존 원본 메인 화면(아코디언 대시보드) 그대로
   · 원본에서 기능 클릭 : 방안 A의 해당 탭 뷰로 전환 (예: 임금계산기 → [임금·일지] 탭)
   · 하단 내비게이션   : 방안 A 5탭 (홈 / 임금·일지 / 선박도감 / 커뮤니티 / 현장가이드)
   · 🏠 홈            : 언제든 기존 원본 메인 화면으로 복귀
   · 기존 DOM·계산·연동 로직을 그대로 재사용하므로 데이터/기능 손실이 없습니다.
   ============================================================ */

const PLAN_A_TAB_META = {
    'wage-log': {
        title: '임금·일지',
        hint: '임금계산기 · 근무일지 달력 · 월간 정산 리포트',
        nav: 'nav-wage'
    },
    'ships': {
        title: '선박도감',
        hint: '터미널 입출항 스케줄 통합 조회 · 작업 선박 검색/등록',
        nav: 'nav-ships'
    },
    'community': {
        title: '커뮤니티',
        hint: '왁자지껄(톡톡) · 공지사항 · 자료실',
        nav: 'nav-community'
    },
    'guide': {
        title: '현장가이드',
        hint: '실전안전지침 · 현장 실무 용어 가이드 · 생활영어 한문장',
        nav: 'nav-guide'
    }
};

/* 원본 홈 카드 → 방안 A 탭 매핑 (미등록 카드 = 홈 전용, 제자리 펼침) */
const PLAN_A_CARD_TABS = {
    'wage-card': { tab: 'wage-log', subtab: 'wage' },
    'log-card': { tab: 'wage-log', subtab: 'log' },
    'ship-card': { tab: 'ships' },
    'notice-card': { tab: 'community' },
    'board-card': { tab: 'community' },
    'archive-card': { tab: 'community' },
    'safety-card': { tab: 'guide' },
    'guide-card': { tab: 'guide' },
    'daily-field-english-card': { tab: 'guide' }
};

/* 탭 진입 시 기본으로 펼칠 카드 */
const PLAN_A_DEFAULT_FOCUS = {
    'wage-log:wage': 'wage-card',
    'wage-log:log': 'log-card',
    'wage-log:report': 'log-card',
    'ships': 'ship-card',
    'community': 'board-card',
    'guide': 'safety-card'
};

function getAppView() {
    return (document.body && document.body.dataset && document.body.dataset.appView) || 'legacy';
}

function isElementHiddenInLayout(el) {
    if (!el) return true;
    if (el.classList && el.classList.contains('view-hidden')) return true;
    let node = el.parentElement;
    while (node && node !== document.body) {
        if (node.classList && node.classList.contains('view-hidden')) return true;
        node = node.parentElement;
    }
    return false;
}

function syncTabChromeOffset() {
    try {
        const header = document.querySelector('body > header');
        if (header && header.offsetHeight) {
            document.documentElement.style.setProperty('--tab-chrome-offset', (header.offsetHeight + 6) + 'px');
        }
    } catch (e) {}
}

/* 현재 뷰 모드/탭에 따라 표시 그룹·툴바·서브탭 UI를 한 번에 동기화 */
function applyPlanAViewLayout() {
    const view = getAppView();
    const tab = (document.body.dataset && document.body.dataset.appTab) || '';
    const sub = (document.body.dataset && document.body.dataset.appSubTab) || 'wage';

    document.querySelectorAll('[data-view-group]').forEach(el => {
        const group = el.getAttribute('data-view-group');
        const show = (view === 'legacy') || (group === tab);
        el.classList.toggle('view-hidden', !show);
    });

    /* 임금·일지 서브탭: [임금계산기] ↔ [근무일지 달력] ↔ [월간 정산 리포트] */
    const wageCard = document.getElementById('wage-card');
    const logCard = document.getElementById('log-card');
    const inWageLogTab = (view === 'tab' && tab === 'wage-log');
    if (wageCard) wageCard.classList.toggle('view-hidden', inWageLogTab && sub !== 'wage');
    if (logCard) logCard.classList.toggle('view-hidden', inWageLogTab && sub === 'wage');

    const bar = document.getElementById('tabViewToolbar');
    if (bar) bar.style.display = (view === 'tab') ? 'flex' : 'none';

    const meta = PLAN_A_TAB_META[tab];
    const titleEl = document.getElementById('tabViewTitle');
    if (titleEl) titleEl.textContent = (meta && meta.title) || '핵심 기능';
    const hintEl = document.getElementById('tabViewHint');
    if (hintEl) hintEl.textContent = (meta && meta.hint) || '';

    const subWrap = document.getElementById('wageLogSubTabs');
    if (subWrap) subWrap.style.display = inWageLogTab ? 'flex' : 'none';
    document.querySelectorAll('#wageLogSubTabs .tab-sub-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-subtab') === sub);
    });

    syncTabChromeOffset();
}

/* 탭 뷰에서 대상 카드를 펼침 (이미 펼쳐져 있으면 토글로 닫히지 않도록 유지) */
function focusPlanACard(cardId) {
    const card = cardId ? document.getElementById(cardId) : null;
    if (!card) return;
    if (!card.classList.contains('expanded')) {
        toggleDashItem(cardId);
    }
}

/* [월간 정산 리포트] 서브탭: 통계/D3 차트 위치로 스크롤 */
function scrollToWorkLogReport() {
    const anchor = ['monthlyD3ChartSection', 'monthlyStatsSummary', 'd3ChartLockBanner']
        .map(id => document.getElementById(id))
        .find(el => el && !el.classList.contains('hidden') && el.style.display !== 'none');
    if (anchor) {
        setTimeout(() => anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    }
}

/* 선박도감 탭 진입 시 1·2·3항업 스케줄 섹션이 모두 접혀 있으면 한 번에 펼쳐 둠 */
function openShipsSectionsForOverview() {
    const els = ['t3-content', 't2-content', 't1-content'].map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;
    const allCollapsed = els.every(el => el.classList.contains('collapsed'));
    if (!allCollapsed) return;
    els.forEach(el => {
        el.classList.remove('collapsed');
        el.style.border = '2px solid var(--primary)';
        const parentCard = el.closest('.card');
        if (parentCard) parentCard.classList.add('active-work-section');
    });
}

/* 방안 A 탭 뷰로 전환 (핵심 진입점) */
function switchPlanATab(tab, subtab, focusCardId, opts) {
    opts = opts || {};
    const meta = PLAN_A_TAB_META[tab];
    if (!meta) return;

    if (tab === 'wage-log') {
        const prevSub = (document.body.dataset && document.body.dataset.appSubTab) || '';
        document.body.dataset.appSubTab = subtab || prevSub || 'wage';
    } else if (document.body.dataset) {
        delete document.body.dataset.appSubTab;
    }

    document.body.dataset.appView = 'tab';
    document.body.dataset.appTab = tab;

    applyPlanAViewLayout();
    syncBottomNavActive('');

    const sub = (document.body.dataset && document.body.dataset.appSubTab) || '';
    const focus = focusCardId || PLAN_A_DEFAULT_FOCUS[tab + (sub ? ':' + sub : '')] || PLAN_A_DEFAULT_FOCUS[tab];
    if (focus) focusPlanACard(focus);

    if (tab === 'ships' && !focusCardId) openShipsSectionsForOverview();
    if (tab === 'wage-log' && sub === 'report') scrollToWorkLogReport();

    if (opts.scroll !== false) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (opts.silent !== true) {
        showToast(meta.title + ' 탭으로 이동했습니다 · 하단 [🏠 홈]에서 원본 화면 복귀');
    }
    if (opts.skipHistory !== true && typeof scheduleAppHistoryRecord === 'function') {
        scheduleAppHistoryRecord();
    }
}

/* 하단 5탭 내비게이션 탭 전환 */
function planANavTap(tab) {
    if (!tab || tab === 'home') {
        goHomeView();
        return;
    }
    const prevSub = (document.body.dataset && document.body.dataset.appSubTab) || '';
    switchPlanATab(tab, tab === 'wage-log' ? (prevSub || 'wage') : null, null, { silent: true });
}

/* [임금·일지] 탭 내부 스위칭: [임금계산기] | [근무일지 달력] | [월간 정산 리포트] */
function switchWageLogSubTab(sub) {
    if (!sub) return;
    const currentView = getAppView();
    const currentTab = (document.body.dataset && document.body.dataset.appTab) || '';
    const currentSub = (document.body.dataset && document.body.dataset.appSubTab) || '';
    const targetCardId = sub === 'wage' ? 'wage-card' : 'log-card';
    const targetCard = document.getElementById(targetCardId);
    if (
        currentView === 'tab' &&
        currentTab === 'wage-log' &&
        currentSub === sub &&
        sub !== 'report' &&
        targetCard &&
        targetCard.classList.contains('expanded')
    ) {
        goHomeView();
        targetCard.classList.remove('expanded');
        if (typeof targetCard.querySelector === 'function') {
            const content = targetCard.querySelector('.dash-content');
            if (content) content.style.display = 'none';
        }
        return;
    }
    document.body.dataset.appView = 'tab';
    document.body.dataset.appTab = 'wage-log';
    document.body.dataset.appSubTab = sub;
    applyPlanAViewLayout();
    syncBottomNavActive('');
    focusPlanACard(targetCardId);
    if (sub === 'report') {
        scrollToWorkLogReport();
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (typeof scheduleAppHistoryRecord === 'function') scheduleAppHistoryRecord();
}

/* 🏠 홈: 기존 원본 메인 화면 복귀 (기존 홈 버튼 동작: 전체 접기 + 상단 이동) */
function goHomeView(opts) {
    opts = opts || {};
    document.body.dataset.appView = 'legacy';
    if (document.body.dataset) {
        delete document.body.dataset.appTab;
        delete document.body.dataset.appSubTab;
    }
    applyPlanAViewLayout();
    if (typeof scrollToTop === 'function') {
        scrollToTop();
    } else {
        syncBottomNavActive('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    syncBottomNavActive('nav-home');
    if (opts.skipHistory !== true && typeof scheduleAppHistoryRecord === 'function') {
        scheduleAppHistoryRecord();
    }
}

/* 기존 카드 헤더 클릭(toggleDashItem) → 방안 A 라우팅 판별
   · 원본 홈 + 핵심 기능 → 해당 탭 뷰로 전환
   · 탭 뷰에서 이미 펼쳐진 카드를 다시 눌러 접으면 → 원본 홈 화면으로 복귀
   · 탭 뷰 + 다른 탭 소속 기능 → 해당 탭으로 자동 점프 (예: 계산 결과 → 근무일지)
   · 홈 전용 카드(날씨/보안/설명서) → 원본 홈에서 기존처럼 제자리 펼침 */
function planARouteCardOpen(id, card) {
    const view = getAppView();
    const plan = PLAN_A_CARD_TABS[id];

    if (view === 'legacy') {
        if (!plan) return false;
        if (card.classList.contains('expanded')) return false;
        switchPlanATab(plan.tab, plan.subtab || null, id);
        return true;
    }

    if (view === 'tab') {
        if (card && card.classList.contains('expanded')) {
            goHomeView();
            card.classList.remove('expanded');
            if (typeof card.querySelector === 'function') {
                const content = card.querySelector('.dash-content');
                if (content) content.style.display = 'none';
            }
            return true;
        }
        if (!isElementHiddenInLayout(card)) return false;
        if (plan) {
            switchPlanATab(plan.tab, plan.subtab || null, id, { silent: true });
            return true;
        }
        goHomeView();
        return false;
    }
    return false;
}

/* 초기화: 상단 고정 영역 높이 측정 + 리사이즈 대응 */
window.addEventListener('resize', function () { syncTabChromeOffset(); });
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        syncTabChromeOffset();
        applyPlanAViewLayout();
    });
} else {
    syncTabChromeOffset();
    applyPlanAViewLayout();
}

function selectBestCalcSegment(...args) {
    const segments = [];
    const targets = [];
    const parseMemo = (memo) => {
        const lines = String(memo || '').split(/\r?\n/);
        const matched = lines
            .map(l => l.trim())
            .filter(l => /총\s*\d+(?:\.\d+)?\s*H/i.test(l));
        return matched.length ? matched : lines.map(l => l.trim()).filter(Boolean);
    };
    const collect = (val) => {
        if (val == null) return;
        if (Array.isArray(val)) {
            val.forEach(v => collect(v));
            return;
        }
        if (typeof val === 'string') {
            const parsed = parseMemo(val);
            if (parsed.length && /총\s*\d+(?:\.\d+)?\s*H/i.test(val)) {
                // If the whole string itself is a single segment, keep as one.
                if (/총\s*\d+(?:\.\d+)?\s*H/i.test(val) && val.split(/\r?\n/).filter(l => /총\s*\d+(?:\.\d+)?\s*H/i.test(l)).length <= 1) {
                    segments.push(val.trim());
                    return;
                }
            }
            const memoSegments = parseMemo(val);
            if (memoSegments.length) segments.push(...memoSegments);
            else segments.push(val.trim());
            return;
        }
        if (typeof val === 'number') {
            targets.push(val);
            return;
        }
        if (typeof val === 'object') {
            if (val.segments) collect(val.segments);
            if (val.memo) collect(val.memo);
            if (val.text) collect(val.text);
            if (val.line) collect(val.line);
            if (typeof val.targetPay === 'number') targets.push(val.targetPay);
            if (typeof val.totalPay === 'number') targets.push(val.totalPay);
            if (typeof val.wage1 === 'number') targets.push(val.wage1);
            if (typeof val.wage2 === 'number') targets.push(val.wage2);
            if (typeof val.pay === 'number') targets.push(val.pay);
            if (typeof val.amount === 'number') targets.push(val.amount);
            return;
        }
    };
    args.forEach(collect);

    // Remove empties and de-duplicate while keeping order (newest last).
    const cleaned = segments.map(s => (typeof s === 'string' ? s.trim() : s)).filter(s => s !== '' && s != null);
    const unique = [];
    cleaned.forEach(s => {
        const key = typeof s === 'string' ? s : JSON.stringify(s);
        if (!unique.some(u => (typeof u === 'string' ? u.trim() : JSON.stringify(u)) === key)) {
            unique.push(s);
        }
    });
    const list = unique.length ? unique : cleaned;
    if (list.length === 0) {
        return args.length ? args[args.length - 1] : '';
    }

    const hoursOf = (seg) => {
        const text = typeof seg === 'string' ? seg : (seg && (seg.summary || seg.text || seg.line)) || String(seg);
        const m = String(text).match(/총\s*(\d+(?:\.\d+)?)\s*H/i);
        return m ? parseFloat(m[1]) : 0;
    };

    // If no target pay is given, keep the latest (last) segment.
    if (targets.length === 0) {
        return list[list.length - 1];
    }

    // Score: prefer segment whose implied pay (hours * base rate) is closest to a target.
    // Also slightly prefer later segments on ties.
    const BASE = 10320;
    let bestIdx = 0;
    let bestScore = Infinity;
    list.forEach((seg, idx) => {
        const h = hoursOf(seg);
        const implied = h * BASE;
        let minDiff = Infinity;
        targets.forEach(t => {
            const diff = Math.abs(implied - Number(t));
            if (diff < minDiff) minDiff = diff;
        });
        // Tie-break: later index wins (subtract tiny epsilon by index).
        const score = minDiff - idx * 1e-9;
        if (score < bestScore) {
            bestScore = score;
            bestIdx = idx;
        }
    });
    return list[bestIdx];
}

