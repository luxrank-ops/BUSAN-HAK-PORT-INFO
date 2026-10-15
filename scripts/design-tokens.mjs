/**
 * 🎨 부산항 스마트 작업 가이드 — 디자인 토큰 단일 소스 (Design Token Single Source of Truth)
 *
 * 이 파일은 앱 UI의 "숫자와 색"을 정의하는 유일한 원본입니다.
 * - TOKEN_CSS      : index.html <style> 최상단에 삽입되는 :root 토큰 선언 블록
 * - TOKEN_MARKERS  : 토큰 블록을 감싸는 주석 마커 (멱등 재실행용)
 * - * 토큰 맵        : 기존 하드코딩 값을 토큰으로 치환할 때 쓰는 값 → 토큰 사전
 *
 * 적용: `npm run tokens:apply`  (scripts/apply-design-tokens.mjs)
 * 검증: `npm run tokens:check`  (scripts/apply-design-tokens.mjs --check)
 */

export const TOKEN_MARKER_START =
    '/* ══════════════════════════════════════════════════════════════════════\n' +
    '   🎨 디자인 토큰 (Design Tokens) — 부산항 스마트 작업 가이드\n' +
    '   이 블록은 scripts/design-tokens.mjs 에서 생성됩니다. 직접 수정하지 마세요.\n' +
    '   화면 코드는 아래 토큰만 참조합니다 (원시값 하드코딩 금지).\n' +
    '   ══════════════════════════════════════════════════════════════════════ */';

export const TOKEN_MARKER_END = '/* ══════════════ 🎨 디자인 토큰 끝 ══════════════ */';

export const TOKEN_CSS = `
        /* ── 1. 색상 · 뉴트럴 램프 (명도 0 → 1000) ── */
        :root {
            --n-000: #ffffff;
            --n-025: #f9fafb;
            --n-050: #f8fafc;
            --n-075: #f3f4f6;
            --n-100: #f1f5f9;
            --n-150: #e2e8f0;
            --n-200: #d1d5db;
            --n-250: #cbd5e1;
            --n-300: #9ca3af;
            --n-350: #94a3b8;
            --n-400: #64748b;
            --n-500: #475569;
            --n-600: #374151;
            --n-650: #334155;
            --n-800: #1e293b;
            --n-900: #0f172a;
            --n-1000: #000000;

            /* ── 2. 색상 · 브랜드 & 상태 팔레트 ── */
            --navy-900: #0a1b3f;
            --navy-700: #1d366f;
            --blue-900: #1e3a8a;
            --blue-800: #1e40af;
            --blue-700: #1d4ed8;
            --blue-600: #2563eb;
            --blue-500: #3b82f6;
            --blue-400: #60a5fa;
            --blue-300: #93c5fd;
            --blue-200: #bfdbfe;
            --blue-100: #dbeafe;
            --blue-50: #eff6ff;
            --sky-700: #0369a1;
            --sky-600: #0284c7;
            --sky-400: #38bdf8;
            --sky-200: #7dd3fc;
            --sky-100: #e0f2fe;
            --teal-600: #0d9488;
            --emerald-700: #047857;
            --emerald-600: #059669;
            --emerald-500: #10b981;
            --emerald-400: #34d399;
            --emerald-300: #6ee7b7;
            --emerald-50: #ecfdf5;
            --green-600: #16a34a;
            --red-600: #dc2626;
            --red-500: #ef4444;
            --red-300: #fca5a5;
            --red-100: #fee2e2;
            --red-50: #fef2f2;
            --orange-800: #9a3412;
            --orange-700: #c2410c;
            --orange-600: #ea580c;
            --orange-500: #f97316;
            --orange-400: #fb923c;
            --orange-300: #fdba74;
            --orange-200: #fed7aa;
            --orange-100: #ffedd5;
            --orange-50: #fff7ed;
            --amber-900: #713f12;
            --amber-800: #92400e;
            --amber-700: #b45309;
            --amber-600: #d97706;
            --amber-500: #f59e0b;
            --amber-400: #fbbf24;
            --amber-300: #fcd34d;
            --amber-200: #fde68a;
            --amber-100: #fef3c7;
            --amber-50: #fffbeb;
            --yellow-400: #facc15;
            --yellow-300: #fde047;
            --yellow-200: #fef08a;

            /* ── 3. 색상 · 시맨틱 (라이트 모드) ── */
            --primary: var(--navy-900);
            --primary-light: var(--navy-700);
            --accent: var(--navy-900);
            --bg-color: var(--n-100);
            --card-bg: var(--n-000);
            --text-main: var(--n-900);
            --text-sub: var(--n-400);
            --text-muted: var(--n-350);
            --border: var(--n-250);
            --border-strong: var(--n-200);
            --line-soft: var(--n-150);
            --danger: var(--red-500);
            --success: var(--emerald-500);
            --warning: var(--amber-500);
            --info: var(--blue-600);
            --surface-muted: var(--n-050);
            --surface-sunken: var(--n-150);

            /* ── 4. 색상 · 시맨틱 (다크 모드) ── */
            --surface-dark: rgba(30, 41, 59, 0.98);
            --border-dark: rgba(55, 65, 81, 0.7);

            /* ── 5. 간격 (Spacing) · 2px 리듬 ── */
            --sp-2: 2px;
            --sp-3: 3px;
            --sp-4: 4px;
            --sp-5: 5px;
            --sp-6: 6px;
            --sp-7: 7px;
            --sp-8: 8px;
            --sp-9: 9px;
            --sp-10: 10px;
            --sp-11: 11px;
            --sp-12: 12px;
            --sp-14: 14px;
            --sp-15: 15px;
            --sp-16: 16px;
            --sp-18: 18px;
            --sp-20: 20px;
            --sp-24: 24px;
            --sp-32: 32px;

            /* ── 6. 타이포 · 크기 (Type scale) ── */
            --fs-1: 0.58rem;
            --fs-2: 0.62rem;
            --fs-3: 0.68rem;
            --fs-4: 0.72rem;
            --fs-5: 0.75rem;
            --fs-6: 0.8rem;
            --fs-7: 0.85rem;
            --fs-8: 0.9rem;
            --fs-9: 0.95rem;
            --fs-10: 1rem;
            --fs-11: 1.05rem;
            --fs-12: 1.1rem;
            --fs-13: 1.2rem;
            --fs-14: 1.25rem;
            --fs-15: 1.32rem;
            --fs-16: 1.4rem;
            --fs-17: 1.85rem;
            --fs-18: 1.5rem;

            /* ── 7. 타이포 · 유체(반응형) 크기 ── */
            --fs-fluid-1: clamp(0.95rem, 3.5vw, 1.1rem);
            --fs-fluid-2: clamp(0.9rem, 3vw, 1rem);
            --fs-fluid-3: clamp(1.275rem, 4.5vw, 1.425rem);
            --fs-fluid-4: clamp(0.85rem, 3vw, 1rem);
            --fs-fluid-5: clamp(0.85rem, 3vw, 0.95rem);
            --fs-min-1: max(0.66rem, 10px);

            /* ── 8. 타이포 · 굵기 & 행간 ── */
            --fw-medium: 500;
            --fw-semibold: 600;
            --fw-bold: 700;
            --fw-extrabold: 800;
            --fw-black: 900;
            --lh-1: 1;
            --lh-2: 1.1;
            --lh-3: 1.15;
            --lh-4: 1.2;
            --lh-5: 1.25;
            --lh-6: 1.3;
            --lh-7: 1.35;
            --lh-8: 1.4;
            --lh-9: 1.45;
            --lh-tight: var(--lh-4);
            --lh-normal: var(--lh-7);
            --lh-relaxed: var(--lh-8);

            /* ── 9. 라운드 (Radius) ── */
            --radius-xs: 4px;
            --radius-sm: 6px;
            --radius-md: 8px;
            --radius-lg: 10px;
            --radius-xl: 12px;
            --radius-2xl: 14px;
            --radius-3xl: 16px;
            --radius-pill: 999px;
            --radius-circle: 50%;

            /* ── 10. 그림자 (Elevation) ── */
            --shadow-elev-1: 0 2px 8px rgba(10, 27, 63, 0.06);
            --shadow-elev-2: 0 1px 3px rgba(10, 27, 63, 0.1);
            --shadow-elev-3: 0 3px 8px rgba(10, 27, 63, 0.12);
            --shadow-elev-4: 0 6px 18px rgba(10, 27, 63, 0.14);
            --shadow-elev-up: 0 -4px 16px rgba(10, 27, 63, 0.06);
            --shadow-soft: 0 2px 6px rgba(15, 23, 42, 0.04);
            --shadow-pop-blue: 0 2px 6px rgba(37, 99, 235, 0.35);
            --shadow-pop-green: 0 2px 6px rgba(16, 185, 129, 0.35);
            --shadow-focus-light: 0 0 0 4px rgba(37, 99, 235, 0.18), 0 10px 26px rgba(10, 27, 63, 0.16);
            --shadow-focus-dark: 0 0 0 4px rgba(96, 165, 250, 0.24), 0 10px 26px rgba(0, 0, 0, 0.5);
            --shadow-focus-ring: 0 0 0 3px rgba(37, 99, 235, 0.15);

            /* ── 11. 모션 (Motion) ── */
            --dur-100: 0.1s;
            --dur-120: 0.12s;
            --dur-140: 0.14s;
            --dur-150: 0.15s;
            --dur-160: 0.16s;
            --dur-200: 0.2s;
            --dur-300: 0.3s;
            --dur-350: 0.35s;
            --dur-fast: var(--dur-150);
            --dur-base: var(--dur-200);
            --dur-slow: var(--dur-300);

            /* ── 12. Z축 (Layering) ── */
            --z-content: 2;
            --z-sticky-head: 20;
            --z-header: 100;
            --z-sticky-foot: 950;
            --z-ticker: 999;
            --z-bottom-nav: 1000;
            --z-visitor-badge: 2500;
            --z-modal: 3000;
            --z-toast: 5000;
            --z-hover-menu: 9999;
        }

        body.dark-mode {
            /* ── 4. 색상 · 시맨틱 (다크 모드) ── */
            --primary: var(--blue-400);
            --primary-light: var(--blue-300);
            --accent: var(--amber-400);
            --bg-color: var(--n-900);
            --card-bg: var(--surface-dark);
            --text-main: var(--n-075);
            --text-sub: var(--n-300);
            --border: var(--border-dark);
        }
`;

/* ────────────────────────────────────────────────────────────────
   값 → 토큰 치환 사전 (하드코딩 값 정리용)
   ──────────────────────────────────────────────────────────────── */

/** 간격: padding / margin / gap 계열에서 정확히 일치하는 값만 치환 */
export const SPACING_TOKENS = {
    '2px': '--sp-2',
    '3px': '--sp-3',
    '4px': '--sp-4',
    '5px': '--sp-5',
    '6px': '--sp-6',
    '7px': '--sp-7',
    '8px': '--sp-8',
    '9px': '--sp-9',
    '10px': '--sp-10',
    '11px': '--sp-11',
    '12px': '--sp-12',
    '14px': '--sp-14',
    '15px': '--sp-15',
    '16px': '--sp-16',
    '18px': '--sp-18',
    '20px': '--sp-20',
    '24px': '--sp-24',
    '32px': '--sp-32'
};

/** 라운드: 픽셀 값 및 다중값 구성 요소 */
export const RADIUS_TOKENS = {
    '4px': '--radius-xs',
    '5px': '--radius-sm',
    '6px': '--radius-sm',
    '7px': '--radius-md',
    '8px': '--radius-md',
    '9px': '--radius-lg',
    '10px': '--radius-lg',
    '12px': '--radius-xl',
    '14px': '--radius-2xl',
    '16px': '--radius-3xl',
    '999px': '--radius-pill',
    '50%': '--radius-circle'
};

/** 타이포 크기: 기존 값 → 스케일 단계 (스냅 허용 오차 0.02rem 이내) */
export const FONT_SIZE_TOKENS = {
    '0.56rem': '--fs-1',
    '0.58rem': '--fs-1',
    '0.62rem': '--fs-2',
    '0.63rem': '--fs-2',
    '0.66rem': '--fs-3',
    '0.68rem': '--fs-3',
    '0.7rem': '--fs-3',
    '0.71rem': '--fs-4',
    '0.72rem': '--fs-4',
    '0.73rem': '--fs-4',
    '0.74rem': '--fs-5',
    '0.75rem': '--fs-5',
    '0.76rem': '--fs-5',
    '0.78rem': '--fs-6',
    '0.79rem': '--fs-6',
    '0.8rem': '--fs-6',
    '0.81rem': '--fs-6',
    '0.82rem': '--fs-6',
    '0.84rem': '--fs-7',
    '0.85rem': '--fs-7',
    '0.86rem': '--fs-7',
    '0.88rem': '--fs-8',
    '0.9rem': '--fs-8',
    '0.92rem': '--fs-8',
    '0.95rem': '--fs-9',
    '0.96rem': '--fs-9',
    '1rem': '--fs-10',
    '1.02rem': '--fs-10',
    '1.05rem': '--fs-11',
    '1.06rem': '--fs-11',
    '1.08rem': '--fs-12',
    '1.1rem': '--fs-12',
    '1.12rem': '--fs-12',
    '1.2rem': '--fs-13',
    '1.22rem': '--fs-13',
    '1.25rem': '--fs-14',
    '1.3rem': '--fs-15',
    '1.32rem': '--fs-15',
    '1.4rem': '--fs-16',
    '1.5rem': '--fs-18',
    '1.85rem': '--fs-17'
};

/** 타이포: 반복되는 유체(clamp·max) 크기 */
export const FLUID_FONT_TOKENS = {
    'clamp(0.95rem, 3.5vw, 1.1rem)': '--fs-fluid-1',
    'clamp(0.9rem, 3vw, 1rem)': '--fs-fluid-2',
    'clamp(1.275rem, 4.5vw, 1.425rem)': '--fs-fluid-3',
    'clamp(0.85rem, 3vw, 1rem)': '--fs-fluid-4',
    'clamp(0.85rem, 3vw, 0.95rem)': '--fs-fluid-5',
    'max(0.66rem, 10px)': '--fs-min-1'
};

export const FONT_WEIGHT_TOKENS = {
    '500': '--fw-medium',
    '600': '--fw-semibold',
    '700': '--fw-bold',
    '800': '--fw-extrabold',
    '900': '--fw-black',
    bold: '--fw-bold'
};

export const LINE_HEIGHT_TOKENS = {
    '1': '--lh-1',
    '1.1': '--lh-2',
    '1.15': '--lh-3',
    '1.2': '--lh-4',
    '1.25': '--lh-5',
    '1.3': '--lh-6',
    '1.35': '--lh-7',
    '1.4': '--lh-8',
    '1.45': '--lh-9'
};

export const Z_INDEX_TOKENS = {
    '2': '--z-content',
    '20': '--z-sticky-head',
    '100': '--z-header',
    '950': '--z-sticky-foot',
    '999': '--z-ticker',
    '1000': '--z-bottom-nav',
    '2500': '--z-visitor-badge',
    '3000': '--z-modal',
    '5000': '--z-toast',
    '9999': '--z-hover-menu'
};

export const DURATION_TOKENS = {
    '0.1s': '--dur-100',
    '0.12s': '--dur-120',
    '0.14s': '--dur-140',
    '0.15s': '--dur-150',
    '0.16s': '--dur-160',
    '0.2s': '--dur-200',
    '0.3s': '--dur-300',
    '0.35s': '--dur-350'
};

/** 그림자: 두 번 이상 반복되는 값 + 카드 고도(elevation) 사다리 */
export const SHADOW_TOKENS = {
    '0 2px 6px rgba(37, 99, 235, 0.35)': '--shadow-pop-blue',
    '0 2px 6px rgba(16, 185, 129, 0.35)': '--shadow-pop-green',
    '0 2px 6px rgba(15, 23, 42, 0.04)': '--shadow-soft',
    '0 0 0 4px rgba(37, 99, 235, 0.18), 0 10px 26px rgba(10, 27, 63, 0.16)': '--shadow-focus-light',
    '0 0 0 4px rgba(96, 165, 250, 0.24), 0 10px 26px rgba(0, 0, 0, 0.5)': '--shadow-focus-dark',
    '0 0 0 3px rgba(37, 99, 235, 0.15)': '--shadow-focus-ring',
    '0 2px 8px rgba(10, 27, 63, 0.06)': '--shadow-elev-1',
    '0 1px 3px rgba(10, 27, 63, 0.1)': '--shadow-elev-2',
    '0 3px 8px rgba(10, 27, 63, 0.12)': '--shadow-elev-3',
    '0 6px 18px rgba(10, 27, 63, 0.14)': '--shadow-elev-4',
    '0 -4px 16px rgba(10, 27, 63, 0.06)': '--shadow-elev-up'
};

/** 색상: 반복 사용되는 원시 hex → 팔레트 토큰 (키는 소문자, 3자리는 6자리로 정규화) */
export const COLOR_TOKENS = {
    '#ffffff': '--n-000',
    '#fff': '--n-000',
    '#000': '--n-1000',
    '#f9fafb': '--n-025',
    '#f8fafc': '--n-050',
    '#f3f4f6': '--n-075',
    '#f1f5f9': '--n-100',
    '#e2e8f0': '--n-150',
    '#d1d5db': '--n-200',
    '#cbd5e1': '--n-250',
    '#9ca3af': '--n-300',
    '#94a3b8': '--n-350',
    '#64748b': '--n-400',
    '#475569': '--n-500',
    '#374151': '--n-600',
    '#334155': '--n-650',
    '#1e293b': '--n-800',
    '#0f172a': '--n-900',
    '#0a1b3f': '--navy-900',
    '#1d366f': '--navy-700',
    '#1e3a8a': '--blue-900',
    '#1e40af': '--blue-800',
    '#1d4ed8': '--blue-700',
    '#2563eb': '--blue-600',
    '#3b82f6': '--blue-500',
    '#60a5fa': '--blue-400',
    '#93c5fd': '--blue-300',
    '#bfdbfe': '--blue-200',
    '#dbeafe': '--blue-100',
    '#eff6ff': '--blue-50',
    '#0369a1': '--sky-700',
    '#0284c7': '--sky-600',
    '#38bdf8': '--sky-400',
    '#7dd3fc': '--sky-200',
    '#e0f2fe': '--sky-100',
    '#0d9488': '--teal-600',
    '#047857': '--emerald-700',
    '#059669': '--emerald-600',
    '#10b981': '--emerald-500',
    '#34d399': '--emerald-400',
    '#6ee7b7': '--emerald-300',
    '#ecfdf5': '--emerald-50',
    '#16a34a': '--green-600',
    '#dc2626': '--red-600',
    '#ef4444': '--red-500',
    '#fca5a5': '--red-300',
    '#fee2e2': '--red-100',
    '#fef2f2': '--red-50',
    '#9a3412': '--orange-800',
    '#c2410c': '--orange-700',
    '#ea580c': '--orange-600',
    '#f97316': '--orange-500',
    '#fb923c': '--orange-400',
    '#fdba74': '--orange-300',
    '#fed7aa': '--orange-200',
    '#ffedd5': '--orange-100',
    '#fff7ed': '--orange-50',
    '#713f12': '--amber-900',
    '#92400e': '--amber-800',
    '#b45309': '--amber-700',
    '#d97706': '--amber-600',
    '#f59e0b': '--amber-500',
    '#fbbf24': '--amber-400',
    '#fcd34d': '--amber-300',
    '#fde68a': '--amber-200',
    '#fef3c7': '--amber-100',
    '#fffbeb': '--amber-50',
    '#facc15': '--yellow-400',
    '#fde047': '--yellow-300',
    '#fef08a': '--yellow-200'
};

/** 토큰화 대상 속성 → 사전 매핑 */
export const LENGTH_PROPS = ['padding', 'margin', 'gap', 'row-gap', 'column-gap'];
export const RADIUS_PROPS = ['border-radius'];
export const ALL_RADIUS_PROPS = [
    'border-radius',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-left-radius',
    'border-bottom-right-radius'
];
export const TYPE_PROPS = ['font-size'];
export const WEIGHT_PROPS = ['font-weight'];
export const LINE_HEIGHT_PROPS = ['line-height'];
export const Z_PROPS = ['z-index'];
export const SHADOW_PROPS = ['box-shadow'];
export const MOTION_PROPS = ['transition', 'transition-duration', 'animation', 'animation-duration'];

/** 문서 생성용: 토큰 섹션 제목 (모듈이 단일 소스임을 보장) */
export const SECTION_TITLES = {
    1: '색상 · 뉴트럴 램프',
    2: '색상 · 브랜드 & 상태 팔레트',
    3: '색상 · 시맨틱 (라이트 모드)',
    4: '색상 · 시맨틱 (다크 모드)',
    5: '간격 (Spacing)',
    6: '타이포 · 크기 (Type Scale)',
    7: '타이포 · 유체(반응형) 크기',
    8: '타이포 · 굵기 & 행간',
    9: '라운드 (Radius)',
    10: '그림자 (Elevation)',
    11: '모션 (Motion)',
    12: 'Z축 (Layering)'
};
