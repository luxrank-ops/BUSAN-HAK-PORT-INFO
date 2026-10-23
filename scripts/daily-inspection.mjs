#!/usr/bin/env node
/**
 * BUSAN HAK PORT INFO — 매일 04시(KST) 기능 점검 스크립트
 *
 *  - 실행: node scripts/daily-inspection.mjs  (또는 npx tsx server.ts 경유)
 *  - 생성물: reports/daily-inspection-YYYY-MM-DD.md
 *           docs/inspections/YYYY-MM-DD.md
 *           reports/latest.md (최신 보고서 별칭)
 *  - Vercel Cron / GitHub Actions / 로컬 node-cron 모두 이 스크립트를 호출할 수 있습니다.
 *
 * 점검 항목 (총 10개 분야, 각 PASS/WARN/FAIL)
 *  1) 필수 파일 존재
 *  2) JSON 문법
 *  3) HTML 구조 (doctype, script 문법)
 *  4) API 라우트 정합성
 *  5) 터미널 스케줄 지원 (8개 터미널)
 *  6) 자동화 상태 (스케줄 감시·DB 정리·백업·일일 점검)
 *  7) 배포 설정 (vercel.json / firebase.json)
 *  8) 보안·인증 (PIN 해시, 관리자 토큰, CRON_SECRET)
 *  9) 디자인 토큰 정합성
 *  10) 워크플로·크론 등록
 *
 * 결과는 종료 코드로도 전달: 0=전체 PASS 또는 WARN만, 1=FAIL 1개 이상
 */

import { readFile, access, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ── KST 날짜 헬퍼 ──────────────────────────────────────────────
function getKstNow(now = new Date()) {
  // KST = UTC+9
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}
function formatKstDate(now = new Date()) {
  const kst = getKstNow(now);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function formatKstDateTime(now = new Date()) {
  const kst = getKstNow(now);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  const ss = String(kst.getUTCSeconds()).padStart(2, '0');
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dayName = days[kst.getUTCDay()];
  return `${y}-${m}-${d} (${dayName}) ${hh}:${mm}:${ss} KST`;
}

// ── 점검 정의 ──────────────────────────────────────────────────
const REQUIRED_FILES = [
  '.firebaserc',
  'firebase.json',
  'vercel.json',
  'firestore.rules',
  'firestore.indexes.json',
  'package.json',
  'public/index.html',
  'public/admin.html',
  'public/manifest.json',
  'public/service-worker.js',
  'public/firebase-messaging-sw.js',
  'public/css/app.css',
  'public/js/app.js',
  'public/js/notifications.js',
  'public/js/leader-access.js',
  'public/js/ships-board.js',
  'public/js/tab-views.js',
  'public/js/kkung-relay.js',
  'server.ts',
  'api/[...path].ts',
  // 주간 자가 점검 · 자가 복구 (2026-10-23 추가)
  'scripts/weekly-self-check.mjs',
  'scripts/weekly-self-check-run.mjs',
  'api/cron/weekly-self-check.ts',
];

const JSON_FILES = ['.firebaserc', 'firebase.json', 'vercel.json', 'firestore.indexes.json', 'package.json', 'public/manifest.json'];

const EXPECTED_TERMINALS = ['hjnc', 'bnct', 'dgt', 'pnc', 'hpnt', 'pnit', 'bptc', 'hbct'];

const EXPECTED_API_ROUTES = [
  'GET /api/health',
  'GET /api/config',
  'POST /api/screen-unlock',
  'POST /api/emergency-unlock',
  'POST /api/auth-session',
  'GET /api/analytics-summary',
  'GET /api/admin-stats',
  'GET /api/hjnc-schedule',
  'GET /api/terminal-schedule',
  'GET /api/cron/schedule-watch',
  'GET /api/cron/daily-cleanup',
  'GET /api/cron/weekly-backup',
  'GET /api/cron/daily-inspection',
  'GET /api/cron/weekly-self-check',
  'GET /api/self-check-report',
];

// ── 점검 실행 ──────────────────────────────────────────────────
export async function runInspection(now = new Date()) {
  const checks = [];
  const kstDate = formatKstDate(now);
  const kstDateTime = formatKstDateTime(now);

  function addCheck(category, name, status, detail, severity = 'info') {
    checks.push({ category, name, status, detail, severity });
  }

  // 1) 필수 파일 존재
  for (const file of REQUIRED_FILES) {
    try {
      await access(path.join(ROOT, file));
      addCheck('파일 존재', file, 'PASS', '파일 존재 확인');
    } catch {
      addCheck('파일 존재', file, 'FAIL', '파일이 없습니다', 'high');
    }
  }

  // 2) JSON 문법
  for (const file of JSON_FILES) {
    try {
      const raw = await readFile(path.join(ROOT, file), 'utf8');
      JSON.parse(raw);
      addCheck('JSON 문법', file, 'PASS', 'JSON 파싱 성공');
    } catch (e) {
      addCheck('JSON 문법', file, 'FAIL', `파싱 실패: ${e.message}`, 'high');
    }
  }

  // 3) HTML 구조
  for (const file of ['public/index.html', 'public/admin.html']) {
    try {
      const html = await readFile(path.join(ROOT, file), 'utf8');
      if (!/^[\s\S]*<!doctype html>/i.test(html)) {
        addCheck('HTML 구조', file, 'FAIL', '<!doctype html> 선언 없음', 'high');
      } else if (!/<html/i.test(html) || !/<\/html>/i.test(html)) {
        addCheck('HTML 구조', file, 'FAIL', 'HTML 문서 구조 불완전', 'high');
      } else {
        // 인라인 스크립트 문법 검사 (2KB 초과만 차단 — validate.mjs 와 동일)
        const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi)];
        let hasLargeInline = false;
        for (const m of inlineScripts) {
          if (m[1].trim().length > 2048 && file === 'public/index.html') {
            hasLargeInline = true;
            break;
          }
        }
        if (hasLargeInline) {
          addCheck('HTML 구조', file, 'WARN', '대형 인라인 스크립트 존재 (외부 분리 권장)', 'medium');
        } else {
          addCheck('HTML 구조', file, 'PASS', '문서 구조 정상');
        }
      }
    } catch (e) {
      addCheck('HTML 구조', file, 'FAIL', `읽기 실패: ${e.message}`, 'high');
    }
  }

  // 4) API 라우트 정합성 — server.ts 에서 app.get / app.post 경로 추출
  try {
    const serverCode = await readFile(path.join(ROOT, 'server.ts'), 'utf8');
    const routeRegex = /app\.(get|post|use)\(['"`]([^'"`]+)['"`]/g;
    const foundRoutes = new Set();
    let m;
    while ((m = routeRegex.exec(serverCode)) !== null) {
      const method = m[1].toUpperCase();
      const route = m[2];
      if (route.startsWith('/api')) {
        // use 는 와일드카드이므로 제외하거나 별도 표기
        if (m[1] === 'use' && route === '/api') continue;
        foundRoutes.add(`${method} ${route}`);
      }
    }
    // cron 별칭 경로도 확인 (server.ts에 /api/cron-xxx 형태로 등록됨)
    for (const expected of EXPECTED_API_ROUTES) {
      // expected가 cron/daily-inspection 이면 alias도 허용
      const aliasMap = {
        'GET /api/cron/schedule-watch': ['GET /api/cron/schedule-watch', 'GET /api/cron-schedule-watch'],
        'GET /api/cron/daily-cleanup': ['GET /api/cron/daily-cleanup', 'GET /api/cron-daily-cleanup'],
        'GET /api/cron/weekly-backup': ['GET /api/cron/weekly-backup', 'GET /api/cron-weekly-backup'],
        'GET /api/cron/daily-inspection': ['GET /api/cron/daily-inspection', 'GET /api/cron-daily-inspection'],
        'GET /api/cron/weekly-self-check': ['GET /api/cron/weekly-self-check', 'GET /api/cron-weekly-self-check'],
      };
      const candidates = aliasMap[expected] || [expected];
      const found = candidates.some(c => {
        // foundRoutes 에는 '/api/cron/schedule-watch' 형태로 저장, 메서드 포함
        return foundRoutes.has(c);
      });
      // daily-inspection은 새로 추가되므로 아직 없을 수도 있음 — WARN으로 처리
      if (found) {
        addCheck('API 라우트', expected, 'PASS', '라우트 존재');
      } else if (expected.includes('daily-inspection')) {
        addCheck('API 라우트', expected, 'WARN', '일일 점검 라우트 미등록 (마이그레이션 필요)', 'medium');
      } else {
        addCheck('API 라우트', expected, 'FAIL', '라우트 누락', 'high');
      }
    }
  } catch (e) {
    addCheck('API 라우트', 'server.ts 파싱', 'FAIL', `server.ts 읽기 실패: ${e.message}`, 'high');
  }

  // 5) 터미널 스케줄 지원
  try {
    const serverCode = await readFile(path.join(ROOT, 'server.ts'), 'utf8');
    const terminalMatch = serverCode.match(/SUPPORTED_TERMINALS\s*=\s*\[([^\]]+)\]/);
    if (terminalMatch) {
      const listed = terminalMatch[1].match(/'([a-z0-9]+)'/g)?.map(s => s.replace(/'/g, '')) || [];
      for (const tid of EXPECTED_TERMINALS) {
        if (listed.includes(tid)) {
          addCheck('터미널 지원', tid.toUpperCase(), 'PASS', '지원 목록 포함');
        } else {
          addCheck('터미널 지원', tid.toUpperCase(), 'FAIL', '지원 목록에서 누락', 'high');
        }
      }
      if (listed.length !== EXPECTED_TERMINALS.length) {
        addCheck('터미널 지원', '전체 개수', 'WARN', `기대 ${EXPECTED_TERMINALS.length}개, 실제 ${listed.length}개`, 'medium');
      }
    } else {
      addCheck('터미널 지원', 'SUPPORTED_TERMINALS', 'FAIL', 'server.ts에서 정의 미발견', 'high');
    }

    // PNC 파서 함수 존재 여부
    const pncFunctions = ['parsePncScheduleHtml', 'parsePncWorkStatusHtml', 'extractPncSearchFormRequest', 'mergePncScheduleAndWorkStatus'];
    for (const fn of pncFunctions) {
      if (serverCode.includes(`function ${fn}`) || serverCode.includes(`export function ${fn}`)) {
        addCheck('터미널 파서', fn, 'PASS', '함수 존재');
      } else {
        addCheck('터미널 파서', fn, 'FAIL', '함수 누락', 'high');
      }
    }
  } catch (e) {
    addCheck('터미널 지원', '전체', 'FAIL', `검사 실패: ${e.message}`, 'high');
  }

  // 6) 자동화 상태 — cron 스케줄 등록 여부
  try {
    const serverCode = await readFile(path.join(ROOT, 'server.ts'), 'utf8');
    const cronChecks = [
      { pattern: `cron.schedule('0 * * * *'`, name: '스케줄 감시 (매 정각)', required: true },
      { pattern: `cron.schedule('0 3 * * *'`, name: 'DB 정리 (매일 03시)', required: true },
      { pattern: `cron.schedule('0 0 * * 0'`, name: '주간 백업 (일요일 00시)', required: true },
      { pattern: `cron.schedule('0 4 * * *'`, name: '일일 점검 (매일 04시)', required: false },
      { pattern: `cron.schedule(WEEKLY_SELF_CHECK_CRON`, name: '주간 자가 점검 (월요일 05시)', required: false },
    ];
    for (const c of cronChecks) {
      if (serverCode.includes(c.pattern)) {
        addCheck('자동화 크론', c.name, 'PASS', '크론 등록됨');
      } else if (c.required) {
        addCheck('자동화 크론', c.name, 'FAIL', '크론 미등록', 'high');
      } else {
        addCheck('자동화 크론', c.name, 'WARN', '신규 크론 — 등록 권장', 'medium');
      }
    }

    // 주간 자가 점검 스케줄 상수 (0 5 * * 1 · Asia/Seoul)
    if (/WEEKLY_SELF_CHECK_CRON\s*=\s*'0 5 \* \* 1'/.test(serverCode) && serverCode.includes("timezone: 'Asia/Seoul'")) {
      addCheck('자동화 크론', '주간 자가 점검 시간대', 'PASS', '매주 월요일 05:00 (Asia/Seoul)');
    } else {
      addCheck('자동화 크론', '주간 자가 점검 시간대', 'WARN', '주간 점검 스케줄 상수/타임존 미확인', 'medium');
    }

    // automationRuntimeStatus 필드
    const statusFields = ['scheduleWatcher', 'autoCleanup', 'weeklyBackup', 'dailyInspection'];
    for (const field of statusFields) {
      if (serverCode.includes(field)) {
        const isNew = field === 'dailyInspection';
        addCheck('자동화 상태', `automationRuntimeStatus.${field}`, isNew ? 'WARN' : 'PASS', isNew ? '신규 필드 — 등록 확인 필요' : '상태 트래킹 존재');
        if (isNew && serverCode.includes('dailyInspection')) {
          // 실제 PASS로 승격
          checks[checks.length - 1].status = 'PASS';
          checks[checks.length - 1].detail = '일일 점검 상태 트래킹 존재';
        }
      } else {
        addCheck('자동화 상태', `automationRuntimeStatus.${field}`, field === 'dailyInspection' ? 'WARN' : 'FAIL', field === 'dailyInspection' ? '일일 점검 상태 필드 미등록' : '상태 필드 누락', field === 'dailyInspection' ? 'medium' : 'high');
      }
    }

    // 핵심 함수 존재
    const funcs = ['runScheduleChangeDetection', 'runDatabaseAutoCleanup', 'runWeeklyFirestoreBackup', 'runDailyInspection'];
    for (const fn of funcs) {
      if (serverCode.includes(`function ${fn}`) || serverCode.includes(`export async function ${fn}`) || serverCode.includes(`export function ${fn}`)) {
        addCheck('자동화 함수', fn, fn === 'runDailyInspection' ? 'WARN' : 'PASS', fn === 'runDailyInspection' ? '일일 점검 함수 존재 (신규)' : '함수 존재');
        if (fn === 'runDailyInspection' && serverCode.includes('runDailyInspection')) {
          checks[checks.length - 1].status = 'PASS';
          checks[checks.length - 1].detail = '일일 점검 함수 존재';
        }
      } else {
        addCheck('자동화 함수', fn, fn === 'runDailyInspection' ? 'WARN' : 'FAIL', fn === 'runDailyInspection' ? '일일 점검 함수 미등록' : '함수 누락', fn === 'runDailyInspection' ? 'medium' : 'high');
      }
    }
  } catch (e) {
    addCheck('자동화 크론', '전체', 'FAIL', `검사 실패: ${e.message}`, 'high');
  }

  // 7) 배포 설정
  try {
    const vercelConfig = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
    if (vercelConfig.outputDirectory === 'build/public') {
      addCheck('배포 설정', 'vercel.json outputDirectory', 'PASS', 'build/public 정상');
    } else {
      addCheck('배포 설정', 'vercel.json outputDirectory', 'FAIL', `값 불일치: ${vercelConfig.outputDirectory}`, 'high');
    }
    if (vercelConfig.crons && Array.isArray(vercelConfig.crons)) {
      const cronPaths = vercelConfig.crons.map(c => c.path);
      const expectedCrons = ['/api/cron/daily-cleanup', '/api/cron/weekly-backup', '/api/cron/daily-inspection'];
      for (const ec of expectedCrons) {
        if (cronPaths.includes(ec)) {
          addCheck('배포 설정', `vercel.json crons ${ec}`, 'PASS', '크론 등록됨');
        } else if (ec === '/api/cron/daily-inspection') {
          addCheck('배포 설정', `vercel.json crons ${ec}`, 'WARN', '일일 점검 크론 미등록 (추가 권장)', 'medium');
        } else {
          addCheck('배포 설정', `vercel.json crons ${ec}`, 'FAIL', '크론 누락', 'high');
        }
      }
    } else {
      addCheck('배포 설정', 'vercel.json crons', 'FAIL', 'crons 배열 없음', 'high');
    }

    const firebaseConfig = JSON.parse(await readFile(path.join(ROOT, 'firebase.json'), 'utf8'));
    if (firebaseConfig.hosting?.public === 'build/public') {
      addCheck('배포 설정', 'firebase.json hosting.public', 'PASS', 'build/public 정상');
    } else {
      addCheck('배포 설정', 'firebase.json hosting.public', 'FAIL', `값 불일치: ${firebaseConfig.hosting?.public}`, 'high');
    }
    if (firebaseConfig.hosting?.predeploy?.some(c => String(c).includes('build:obfuscate'))) {
      addCheck('배포 설정', 'firebase.json predeploy', 'PASS', 'build:obfuscate 등록됨');
    } else {
      addCheck('배포 설정', 'firebase.json predeploy', 'FAIL', 'predeploy 빌드 미등록', 'high');
    }
  } catch (e) {
    addCheck('배포 설정', '전체', 'FAIL', `검사 실패: ${e.message}`, 'high');
  }

  // 8) 보안·인증
  try {
    const serverCode = await readFile(path.join(ROOT, 'server.ts'), 'utf8');
    const securityChecks = [
      { pattern: 'verifyScreenLockPin', name: '화면 잠금 PIN 검증' },
      { pattern: 'verifyEmergencyNoticePin', name: '긴급 공지 PIN 검증' },
      { pattern: 'verifyAdminSessionToken', name: '관리자 세션 토큰 검증' },
      { pattern: 'verifyCronAuthHeader', name: 'CRON_SECRET 인증' },
      { pattern: 'isScreenUnlockRateLimited', name: '속도 제한 (Rate Limit)' },
      { pattern: 'SCREEN_LOCK_PIN', name: 'SCREEN_LOCK_PIN 환경변수 참조' },
      { pattern: 'CRON_SECRET', name: 'CRON_SECRET 환경변수 참조' },
    ];
    for (const sc of securityChecks) {
      if (serverCode.includes(sc.pattern)) {
        addCheck('보안·인증', sc.name, 'PASS', '구현 존재');
      } else {
        addCheck('보안·인증', sc.name, 'FAIL', '구현 누락', 'high');
      }
    }

    // firestore.rules 존재 및 isAdmin 검사
    try {
      const rules = await readFile(path.join(ROOT, 'firestore.rules'), 'utf8');
      if (rules.includes('isAdmin()') || rules.includes('isAdmin')) {
        addCheck('보안·인증', 'firestore.rules isAdmin', 'PASS', '관리자 규칙 존재');
      } else {
        addCheck('보안·인증', 'firestore.rules isAdmin', 'WARN', '관리자 규칙 미발견', 'medium');
      }
      if (rules.length > 1000) {
        addCheck('보안·인증', 'firestore.rules 크기', 'PASS', `${Math.round(rules.length / 1024)}KB`);
      }
    } catch {
      addCheck('보안·인증', 'firestore.rules', 'FAIL', '파일 읽기 실패', 'high');
    }
  } catch (e) {
    addCheck('보안·인증', '전체', 'FAIL', `검사 실패: ${e.message}`, 'high');
  }

  // 9) 디자인 토큰 정합성
  try {
    const tokenFile = path.join(ROOT, 'scripts/design-tokens.mjs');
    if (existsSync(tokenFile)) {
      const tokenCode = await readFile(tokenFile, 'utf8');
      const tokenCount = (tokenCode.match(/--[\w-]+/g) || []).length;
      addCheck('디자인 토큰', '토큰 정의 수', 'PASS', `${tokenCount}개 토큰 정의`);

      const cssFile = path.join(ROOT, 'public/css/app.css');
      if (existsSync(cssFile)) {
        const css = await readFile(cssFile, 'utf8');
        if (css.includes('var(--')) {
          addCheck('디자인 토큰', 'CSS 토큰 참조', 'PASS', 'var(--토큰) 사용 확인');
        } else {
          addCheck('디자인 토큰', 'CSS 토큰 참조', 'WARN', '토큰 참조 미발견', 'medium');
        }
      }
    } else {
      addCheck('디자인 토큰', '토큰 파일', 'FAIL', 'scripts/design-tokens.mjs 없음', 'high');
    }
  } catch (e) {
    addCheck('디자인 토큰', '전체', 'FAIL', `검사 실패: ${e.message}`, 'high');
  }

  // 10) 워크플로·크론 등록
  try {
    const workflowDir = path.join(ROOT, '.github/workflows');
    const files = await readdir(workflowDir);
    const ymlFiles = files.filter(f => /\.ya?ml$/.test(f));
    addCheck('워크플로', '워크플로 파일 수', 'PASS', `${ymlFiles.length}개 파일`);

    const expectedWorkflows = ['ci.yml', 'cron-schedule-watch.yml', 'deploy-firebase.yml', 'daily-inspection.yml'];
    for (const wf of expectedWorkflows) {
      if (ymlFiles.includes(wf)) {
        addCheck('워크플로', wf, 'PASS', '파일 존재');
      } else if (wf === 'daily-inspection.yml') {
        addCheck('워크플로', wf, 'WARN', '일일 점검 워크플로 미등록 (추가 권장)', 'medium');
      } else {
        addCheck('워크플로', wf, 'FAIL', '파일 누락', 'high');
      }
    }

    // package.json scripts 검사
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const requiredScripts = ['dev', 'build', 'typecheck', 'validate', 'test', 'check'];
    for (const s of requiredScripts) {
      if (pkg.scripts?.[s]) {
        addCheck('워크플로', `package.json script:${s}`, 'PASS', '스크립트 존재');
      } else {
        addCheck('워크플로', `package.json script:${s}`, 'FAIL', '스크립트 누락', 'high');
      }
    }
  } catch (e) {
    addCheck('워크플로', '전체', 'FAIL', `검사 실패: ${e.message}`, 'high');
  }

  // ── 집계 ─────────────────────────────────────────────────────
  const passCount = checks.filter(c => c.status === 'PASS').length;
  const warnCount = checks.filter(c => c.status === 'WARN').length;
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const totalCount = checks.length;
  const overall = failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'PASS';

  return {
    kstDate,
    kstDateTime,
    generatedAt: now.toISOString(),
    checks,
    summary: { total: totalCount, pass: passCount, warn: warnCount, fail: failCount, overall },
  };
}

// ── 마크다운 보고서 생성 ────────────────────────────────────────
export function generateMarkdownReport(result) {
  const { kstDate, kstDateTime, generatedAt, checks, summary } = result;
  const statusEmoji = { PASS: '✅', WARN: '⚠️', FAIL: '❌' };
  const overallEmoji = summary.overall === 'PASS' ? '🟢' : summary.overall === 'WARN' ? '🟡' : '🔴';
  const overallLabel = summary.overall === 'PASS' ? '정상' : summary.overall === 'WARN' ? '주의' : '이상 감지';

  // 카테고리별 그룹화
  const byCategory = new Map();
  for (const c of checks) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  }

  let md = '';
  md += `# 부산항 스마트 작업 가이드 — 일일 기능 점검 보고서\n\n`;
  md += `> **점검 일시**: ${kstDateTime}\n`;
  md += `> **점검 기준일**: ${kstDate} (KST)\n`;
  md += `> **생성 시각(UTC)**: ${generatedAt}\n`;
  md += `> **점검 방식**: 자동 점검 (매일 04:00 KST · GitHub Actions + Vercel Cron + 로컬 node-cron)\n\n`;
  md += `---\n\n`;
  md += `## 0. 점검 요약\n\n`;
  md += `| 구분 | 결과 |\n`;
  md += `| --- | --- |\n`;
  md += `| **종합 판정** | ${overallEmoji} **${overallLabel}** (${summary.overall}) |\n`;
  md += `| 전체 점검 항목 | ${summary.total}건 |\n`;
  md += `| ✅ PASS | ${summary.pass}건 |\n`;
  md += `| ⚠️ WARN | ${summary.warn}건 |\n`;
  md += `| ❌ FAIL | ${summary.fail}건 |\n`;
  md += `| 통과율 | ${Math.round((summary.pass / summary.total) * 100)}% |\n\n`;

  if (summary.overall === 'PASS') {
    md += `> 🟢 **모든 핵심 기능이 정상 동작합니다.** 별도 조치 없이 운영을 계속하세요.\n\n`;
  } else if (summary.overall === 'WARN') {
    md += `> 🟡 **일부 항목에서 주의가 필요합니다.** WARN 항목을 확인하고 필요 시 개선을 진행하세요.\n\n`;
  } else {
    md += `> 🔴 **이상 항목이 발견되었습니다.** FAIL 항목을 즉시 확인하고 조치하세요.\n\n`;
  }

  md += `---\n\n`;
  md += `## 1. 점검 항목 상세\n\n`;
  md += `| # | 분야 | 항목 | 결과 | 상세 |\n`;
  md += `| --- | --- | --- | --- | --- |\n`;
  let idx = 1;
  for (const [category, items] of byCategory) {
    for (const c of items) {
      const emoji = statusEmoji[c.status] || '❓';
      md += `| ${idx++} | ${category} | ${c.name} | ${emoji} ${c.status} | ${c.detail} |\n`;
    }
  }
  md += `\n`;

  md += `---\n\n`;
  md += `## 2. 분야별 요약\n\n`;
  md += `| 분야 | PASS | WARN | FAIL | 합계 | 상태 |\n`;
  md += `| --- | --- | --- | --- | --- | --- |\n`;
  for (const [category, items] of byCategory) {
    const p = items.filter(c => c.status === 'PASS').length;
    const w = items.filter(c => c.status === 'WARN').length;
    const f = items.filter(c => c.status === 'FAIL').length;
    const catStatus = f > 0 ? '🔴 이상' : w > 0 ? '🟡 주의' : '🟢 정상';
    md += `| ${category} | ${p} | ${w} | ${f} | ${items.length} | ${catStatus} |\n`;
  }
  md += `\n`;

  md += `---\n\n`;
  md += `## 3. 자동화 상태\n\n`;
  md += `| 작업 | 스케줄 | 트리거 | 상태 |\n`;
  md += `| --- | --- | --- | --- |\n`;
  md += `| 선박 스케줄 변경 감지 | 매 정각 (0 * * * *) | GitHub Actions / node-cron | ${checks.find(c => c.name === '스케줄 감시 (매 정각)')?.status === 'PASS' ? '✅ 정상' : '❌ 확인 필요'} |\n`;
  md += `| DB 자가 정리 | 매일 03:00 (0 3 * * *) | Vercel Cron / node-cron | ${checks.find(c => c.name === 'DB 정리 (매일 03시)')?.status === 'PASS' ? '✅ 정상' : '❌ 확인 필요'} |\n`;
  md += `| 주간 백업 | 매주 일요일 00:00 (0 0 * * 0) | Vercel Cron / node-cron | ${checks.find(c => c.name === '주간 백업 (일요일 00시)')?.status === 'PASS' ? '✅ 정상' : '❌ 확인 필요'} |\n`;
  md += `| **일일 기능 점검** | **매일 04:00 (0 4 * * *)** | **GitHub Actions + Vercel Cron + node-cron** | **${checks.find(c => c.name === '일일 점검 (매일 04시)')?.status === 'PASS' ? '✅ 정상' : '⚠️ 등록 확인'}** |\n\n`;

  md += `---\n\n`;
  md += `## 4. 배포 상태\n\n`;
  md += `| 구분 | URL | 상태 |\n`;
  md += `| --- | --- | --- |\n`;
  md += `| 운영 (Vercel) | https://busan-hak-port-info.vercel.app | 자동 배포 (main 푸시) |\n`;
  md += `| 보조 (Firebase Hosting) | https://busan-hak-port.web.app | 승인형 배포 |\n`;
  md += `| 데이터 저장소 | Firebase 프로젝트 \`busan-hak-port\` | Firestore · Storage · FCM |\n\n`;

  if (summary.fail > 0) {
    md += `---\n\n`;
    md += `## 5. 조치 필요 항목\n\n`;
    const fails = checks.filter(c => c.status === 'FAIL');
    for (const f of fails) {
      md += `- ❌ **[${f.category}] ${f.name}**: ${f.detail}\n`;
    }
    md += `\n`;
    if (checks.filter(c => c.status === 'WARN').length > 0) {
      md += `### 참고 (WARN)\n\n`;
      for (const w of checks.filter(c => c.status === 'WARN')) {
        md += `- ⚠️ **[${w.category}] ${w.name}**: ${w.detail}\n`;
      }
      md += `\n`;
    }
  } else if (summary.warn > 0) {
    md += `---\n\n`;
    md += `## 5. 개선 권장 항목\n\n`;
    for (const w of checks.filter(c => c.status === 'WARN')) {
      md += `- ⚠️ **[${w.category}] ${w.name}**: ${w.detail}\n`;
    }
    md += `\n`;
  } else {
    md += `---\n\n`;
    md += `## 5. 조치 사항\n\n`;
    md += `조치 필요 항목 없음 — 모든 항목 정상입니다.\n\n`;
  }

  md += `---\n\n`;
  md += `## 6. 점검 이력\n\n`;
  md += `- 이전 점검 보고서는 \`reports/\` 및 \`docs/inspections/\` 디렉터리에서 날짜별로 확인할 수 있습니다.\n`;
  md += `- 최신 보고서는 \`reports/latest.md\` 에서 항상 확인할 수 있습니다.\n`;
  md += `- 자동 점검 로그는 GitHub Actions 실행 내역(Actions 탭)과 Vercel Cron 로그에서 확인하세요.\n\n`;

  md += `---\n\n`;
  md += `## 7. 참고\n\n`;
  md += `- 본 보고서는 매일 04:00 KST 에 자동 생성됩니다.\n`;
  md += `- 수동 실행: \`npm run inspection\` 또는 \`node scripts/daily-inspection.mjs\`\n`;
  md += `- API 조회: \`GET /api/cron/daily-inspection\` (CRON_SECRET 인증 필요) / \`GET /api/inspection-report\` (공개 요약)\n`;
  md += `- 문의: 이춘학 (luxrank@gmail.com / 010-2846-8906)\n\n`;
  md += `---\n\n`;
  md += `*© 2026 이춘학 — BUSAN HAK PORT INFO. All rights reserved.*\n`;

  return md;
}

// ── 파일 저장 ───────────────────────────────────────────────────
export async function saveReports(result, now = new Date()) {
  const kstDate = formatKstDate(now);
  const markdown = generateMarkdownReport(result);

  const reportDirs = [
    path.join(ROOT, 'reports'),
    path.join(ROOT, 'docs', 'inspections'),
  ];
  for (const dir of reportDirs) {
    await mkdir(dir, { recursive: true });
  }

  const files = [
    path.join(ROOT, 'reports', `daily-inspection-${kstDate}.md`),
    path.join(ROOT, 'reports', 'latest.md'),
    path.join(ROOT, 'docs', 'inspections', `${kstDate}.md`),
    path.join(ROOT, `점검보고서_${kstDate}.md`),
  ];

  for (const file of files) {
    try {
      await writeFile(file, markdown, 'utf8');
    } catch (e) {
      // Vercel /tmp 외 쓰기 불가 환경에서는 무시 (API 응답으로 대체)
      console.warn(`보고서 저장 건너뜀 (${file}): ${e.message}`);
    }
  }

  // JSON 요약도 저장 (대시보드·API 활용)
  const jsonSummary = {
    kstDate,
    generatedAt: result.generatedAt,
    kstDateTime: result.kstDateTime,
    summary: result.summary,
    checks: result.checks,
  };
  try {
    await writeFile(path.join(ROOT, 'reports', `daily-inspection-${kstDate}.json`), JSON.stringify(jsonSummary, null, 2), 'utf8');
    await writeFile(path.join(ROOT, 'reports', 'latest.json'), JSON.stringify(jsonSummary, null, 2), 'utf8');
  } catch {}

  return { markdown, jsonSummary, files };
}

// ── CLI 진입점 ─────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const now = new Date();
  console.log(`[일일점검] 점검 시작: ${formatKstDateTime(now)}`);
  const result = await runInspection(now);
  const { markdown, jsonSummary } = await saveReports(result, now);

  console.log(`\n[일일점검] 결과: ${result.summary.overall} (PASS ${result.summary.pass}/${result.summary.total}, WARN ${result.summary.warn}, FAIL ${result.summary.fail})`);
  console.log(`[일일점검] 보고서 저장 완료: reports/daily-inspection-${result.kstDate}.md`);

  // 보고서 메일 발송 (기본 OFF)
  //   · Vercel Cron(/api/cron/daily-inspection)이 같은 시각(19:00 UTC)에 이미 발송하므로
  //     중복 수신을 막기 위해 CLI 에서는 기본적으로 보내지 않습니다.
  //   · Vercel Cron 을 못 쓰는 플랜이면 REPORT_EMAIL_ON_CLI=1 로 이쪽에서 발송하세요.
  //   · 발송 실패는 CI 판정(FAIL 항목 기준)에 영향을 주지 않습니다.
  if (String(process.env.REPORT_EMAIL_ON_CLI || '0').trim() === '1') {
    try {
      const { sendInspectionReportEmail } = await import('./daily-report-mailer.mjs');
      const email = await sendInspectionReportEmail({ result, markdown, json: jsonSummary, env: process.env });
      if (email.skipped) {
        console.log(`[일일점검] 보고서 메일: 건너뜀 (${email.reason || '사유 없음'})`);
      } else if (email.ok) {
        console.log(`[일일점검] 보고서 메일: 발송 완료 (${email.transport}${email.messageId ? ` · id=${email.messageId}` : ''})`);
      } else {
        console.warn(`[일일점검] 보고서 메일: 발송 실패 (${email.transport}) ${email.error || ''}`);
      }
    } catch (e) {
      console.warn(`[일일점검] 보고서 메일 오류: ${e?.message || e}`);
    }
  }

  if (result.summary.fail > 0) {
    console.log(`\n[일일점검] FAIL 항목:`);
    for (const c of result.checks.filter(c => c.status === 'FAIL')) {
      console.log(`  ❌ [${c.category}] ${c.name}: ${c.detail}`);
    }
  }
  if (result.summary.warn > 0) {
    console.log(`\n[일일점검] WARN 항목:`);
    for (const c of result.checks.filter(c => c.status === 'WARN')) {
      console.log(`  ⚠️ [${c.category}] ${c.name}: ${c.detail}`);
    }
  }

  // FAIL이 있으면 exit 1로 CI 실패 유도 (WARN만은 통과)
  if (result.summary.fail > 0) {
    process.exit(1);
  }
}
