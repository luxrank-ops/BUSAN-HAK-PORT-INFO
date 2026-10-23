#!/usr/bin/env node
/**
 * BUSAN HAK PORT INFO — 주간 자가 점검 CLI (GitHub Actions · 로컬 실행)
 * ─────────────────────────────────────────────────────────────────────────────
 * 서버리스(Vercel Cron)와 **동일한 판정 엔진**(scripts/weekly-self-check.mjs)을 사용하되,
 * 서버 런타임에 접근할 수 없는 환경이므로 아래 항목을 원격/저장소 기준으로 점검합니다.
 *
 *   1) 저장소 무결성      : 필수 파일·JSON 문법·크론 등록(vercel.json/server.ts)·워크플로 존재
 *   2) 배포 사이트 헬스    : GET / , GET /api/health , GET /api/inspection-report
 *   3) 터미널 데이터 변화  : 8개 터미널 스케줄 API 수집량·핵심 필드 채움률 → 기준선 대비 드리프트
 *   4) 기준선 영속화       : reports/self-check/baseline.json (워크플로가 Git 에 커밋 → 주간 이력 보존)
 *
 *   사용법:
 *     node scripts/weekly-self-check-run.mjs                # 실제 점검 + 보고서 저장
 *     node scripts/weekly-self-check-run.mjs --offline      # 네트워크 점검 생략(로컬/CI 검증용)
 *     node scripts/weekly-self-check-run.mjs --no-email     # 메일 발송 생략
 *     node scripts/weekly-self-check-run.mjs --force-email  # 중복 방지 무시하고 발송
 *     node scripts/weekly-self-check-run.mjs --base-url=https://...   # 대상 사이트 변경
 *
 *   메일: 기본적으로 CLI 에서는 보내지 않습니다(Vercel Cron 이 같은 주에 발송).
 *         CLI 발송을 켜려면 SELF_CHECK_EMAIL_ON_CLI=1 (또는 --email).
 *   종료코드: FAIL 1건 이상이면 1 (CI 실패 표시용, 보고서·메일은 그대로 남습니다).
 */
import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runWeeklySelfCheck,
  generateWeeklySelfCheckMarkdown,
  buildSelfCheckJson,
  sendWeeklySelfCheckEmail,
  resolveSelfCheckConfig,
  getKstParts,
  DEFAULT_SELF_CHECK_RECIPIENT,
} from './weekly-self-check.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = String(process.env.SELF_CHECK_BASE_URL || 'https://busan-hak-port-info.vercel.app').replace(/\/+$/, '');
const BASELINE_PATH = path.join(ROOT, 'reports', 'self-check', 'baseline.json');
const TERMINALS = ['hjnc', 'bnct', 'dgt', 'pnc', 'hpnt', 'pnit', 'bptc', 'hbct'];
const CORE_FIELDS = ['VSL_NM', 'ETB', 'ATD'];

function parseArgs(argv = process.argv.slice(2)) {
  const args = { offline: false, email: false, noEmail: false, forceEmail: false, baseUrl: DEFAULT_BASE_URL, json: false };
  for (const raw of argv) {
    if (raw === '--offline') args.offline = true;
    else if (raw === '--email') args.email = true;
    else if (raw === '--no-email') args.noEmail = true;
    else if (raw === '--force-email') args.forceEmail = true;
    else if (raw === '--json') args.json = true;
    else if (raw.startsWith('--base-url=')) args.baseUrl = raw.slice('--base-url='.length).replace(/\/+$/, '');
  }
  return args;
}

function truthy(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return Boolean(raw) && !['0', 'false', 'no', 'off', 'n'].includes(raw);
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json,text/html;q=0.9', 'user-agent': 'busan-hak-port-self-check/1.0' },
      signal: controller?.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, ok: response.ok, text, body };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fieldCoverageOf(rows = []) {
  const coverage = {};
  const sample = rows.slice(0, 200);
  for (const field of CORE_FIELDS) {
    if (!sample.length) {
      coverage[field] = 0;
      continue;
    }
    const filled = sample.filter((row) => {
      const value = row?.[field];
      return value !== undefined && value !== null && String(value).trim() !== '';
    }).length;
    coverage[field] = Number((filled / sample.length).toFixed(4));
  }
  // 추가 필드(스키마 변화 감지용)
  for (const key of Object.keys(sample[0] || {})) {
    if (key in coverage) continue;
    const filled = sample.filter((row) => row?.[key] !== undefined && row?.[key] !== null && String(row[key]).trim() !== '').length;
    coverage[key] = Number((filled / sample.length).toFixed(4));
  }
  return coverage;
}

// ── 1) 저장소 무결성 probe ─────────────────────────────────────────────────
function repositoryProbes(options = {}) {
  const requiredFiles = [
    'package.json',
    'server.ts',
    'vercel.json',
    'firebase.json',
    'firestore.rules',
    'api/cron/weekly-self-check.ts',
    '.github/workflows/weekly-self-check.yml',
    'scripts/weekly-self-check.mjs',
    'public/index.html',
    'public/js/app.js',
  ];
  const jsonFiles = ['.firebaserc', 'firebase.json', 'vercel.json', 'firestore.indexes.json', 'package.json', 'public/manifest.json'];

  return [
    {
      id: 'repo.files',
      category: '저장소 무결성',
      name: '필수 파일',
      run: async () => {
        const missing = [];
        for (const file of requiredFiles) {
          try {
            await access(path.join(ROOT, file));
          } catch {
            missing.push(file);
          }
        }
        return missing.length
          ? { status: 'FAIL', code: 'repo.missing_files', detail: `없음: ${missing.join(', ')}` }
          : { status: 'PASS', detail: `${requiredFiles.length}개 파일 확인` };
      },
    },
    {
      id: 'repo.json',
      category: '저장소 무결성',
      name: 'JSON 문법',
      run: async () => {
        const broken = [];
        for (const file of jsonFiles) {
          try {
            JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
          } catch (error) {
            broken.push(`${file}: ${error.message}`);
          }
        }
        return broken.length
          ? { status: 'FAIL', code: 'repo.json_broken', detail: broken.join(' / ') }
          : { status: 'PASS', detail: `${jsonFiles.length}개 JSON 정상` };
      },
    },
    {
      id: 'repo.schedule',
      category: '자동화 등록',
      name: '주간 점검 스케줄',
      run: async () => {
        const vercel = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
        const crons = Array.isArray(vercel.crons) ? vercel.crons : [];
        const weekly = crons.find((c) => String(c.path || '').includes('weekly-self-check'));
        if (!weekly) {
          return { status: 'FAIL', code: 'schedule.missing', detail: 'vercel.json crons 에 /api/cron/weekly-self-check 미등록' };
        }
        const serverCode = await readFile(path.join(ROOT, 'server.ts'), 'utf8');
        // 상수(WEEKLY_SELF_CHECK_CRON) 또는 리터럴 어느 쪽으로 등록해도 인정합니다.
        const cronPattern = /WEEKLY_SELF_CHECK_CRON\s*=\s*'0 5 \* \* 1'/;
        const nodeCron =
          cronPattern.test(serverCode) ||
          /cron\.schedule\(\s*'0 5 \* \* 1'/.test(serverCode) ||
          (/cron\.schedule\(\s*WEEKLY_SELF_CHECK_CRON/.test(serverCode) && serverCode.includes("0 5 * * 1"));
        const route = serverCode.includes("'/api/cron/weekly-self-check'");
        if (!route) return { status: 'FAIL', code: 'schedule.route_missing', detail: 'server.ts 에 주간 점검 라우트 미등록' };
        if (!nodeCron) return { status: 'WARN', code: 'schedule.node_cron_missing', detail: 'node-cron(0 5 * * 1) 미등록 — 서버리스에서는 영향 없음' };
        return { status: 'PASS', detail: `Vercel Cron '${weekly.schedule}' · node-cron · API 라우트 확인` };
      },
    },
    {
      id: 'repo.workflow',
      category: '자동화 등록',
      name: 'GitHub Actions 워크플로',
      run: async () => {
        const file = path.join(ROOT, '.github/workflows/weekly-self-check.yml');
        if (!existsSync(file)) return { status: 'FAIL', code: 'schedule.workflow_missing', detail: '주간 점검 워크플로 파일 없음' };
        const yml = await readFile(file, 'utf8');
        if (!/schedule:/.test(yml) || !/weekly-self-check-run\.mjs/.test(yml)) {
          return { status: 'WARN', code: 'schedule.workflow_incomplete', detail: '워크플로에 schedule/실행 스크립트가 없습니다' };
        }
        return { status: 'PASS', detail: '주간 워크플로 등록 확인' };
      },
    },
    {
      id: 'repo.baseline',
      category: '자가 점검 기준선',
      name: '기준선 파일',
      run: async () => {
        // 오프라인 실행은 터미널을 수집하지 않으므로 기준선 판정을 보류합니다(오탐 방지).
        const offlineNote = { status: 'PASS', detail: '오프라인 실행 — 기준선은 온라인(터미널 수집) 점검에서 관리됩니다' };
        if (!existsSync(BASELINE_PATH)) {
          return options.offline ? offlineNote : { status: 'WARN', code: 'baseline.missing', detail: '기준선 파일 없음 — 이번 실행에서 생성합니다' };
        }
        try {
          const raw = JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
          const terminals = Object.keys(raw.terminals || {}).length;
          if (!terminals) {
            return options.offline ? offlineNote : { status: 'WARN', code: 'baseline.missing', detail: '기준선 터미널 기록 0건 — 이번 실행에서 재생성' };
          }
          return { status: 'PASS', detail: `터미널 ${terminals}곳 기준선 (${raw.updatedAt || '갱신 시각 없음'})` };
        } catch (error) {
          return { status: 'WARN', code: 'baseline.corrupt', detail: `기준선 파일 손상: ${error.message} — 이번 실행에서 재생성` };
        }
      },
    },
  ];
}

// ── 2) 배포 사이트 probe ────────────────────────────────────────────────────
function siteProbes(baseUrl) {
  return [
    {
      id: 'site.health',
      category: '배포 사이트',
      name: '헬스 체크 /api/health',
      run: async () => {
        const res = await fetchJson(`${baseUrl}/api/health`);
        if (!res.ok) return { status: 'FAIL', code: 'site.health_failed', detail: `HTTP ${res.status}` };
        if (res.body && res.body.ok === false) return { status: 'FAIL', code: 'site.health_failed', detail: `ok=false (${JSON.stringify(res.body).slice(0, 160)})` };
        return { status: 'PASS', detail: `HTTP ${res.status} · ${res.text.length}B` };
      },
    },
    {
      id: 'site.home',
      category: '배포 사이트',
      name: '메인 화면 응답',
      run: async () => {
        const res = await fetchJson(`${baseUrl}/`);
        if (!res.ok) return { status: 'FAIL', code: 'site.home_failed', detail: `HTTP ${res.status}` };
        if (!/<html/i.test(res.text)) return { status: 'FAIL', code: 'site.home_broken', detail: 'HTML 문서가 아닌 응답' };
        const hasApp = /js\/app\.js/.test(res.text);
        return hasApp
          ? { status: 'PASS', detail: `HTTP ${res.status} · ${Math.round(res.text.length / 1024)}KB · app.js 로드 확인` }
          : { status: 'WARN', code: 'site.asset_missing', detail: 'app.js 스크립트 태그 미확인 — 캐시/배포 확인 필요' };
      },
    },
    {
      id: 'site.inspection',
      category: '배포 사이트',
      name: '일일 점검 상태 API',
      run: async () => {
        const res = await fetchJson(`${baseUrl}/api/inspection-report`);
        if (!res.ok || !res.body) return { status: 'WARN', code: 'site.inspection_api', detail: `HTTP ${res.status}` };
        if (!res.body.hasReport) return { status: 'WARN', code: 'site.inspection_api', detail: '일일 점검 기록 없음' };
        const overall = res.body.summary?.overall;
        return overall === 'FAIL'
          ? { status: 'FAIL', code: 'site.inspection_fail', detail: `일일 점검 FAIL · ${res.body.lastRunAt || ''}` }
          : { status: 'PASS', detail: `최근 일일 점검 ${overall || '기록'} · ${res.body.lastRunAt || ''}` };
      },
    },
  ];
}

function terminalProbes(baseUrl) {
  return TERMINALS.map((tid) => ({
    id: `terminal.${tid}`,
    category: '터미널 데이터',
    name: `${tid.toUpperCase()} 스케줄 수집`,
    kind: 'terminal',
    target: tid,
    run: async () => {
      const res = await fetchJson(`${baseUrl}/api/terminal-schedule?terminal=${tid}`);
      if (!res.ok || !res.body) {
        return { status: 'FAIL', detail: `HTTP ${res.status}`, data: { count: 0, fieldCoverage: {}, error: `HTTP ${res.status}`, label: tid.toUpperCase() } };
      }
      if (res.body.ok === false) {
        return { status: 'FAIL', detail: String(res.body.error || 'api 오류'), data: { count: 0, fieldCoverage: {}, error: String(res.body.error || 'api 오류'), label: tid.toUpperCase() } };
      }
      const rows = Array.isArray(res.body.vessels) ? res.body.vessels : [];
      const coverage = fieldCoverageOf(rows);
      const stale = Boolean(res.body.stale);
      return {
        status: stale ? 'WARN' : 'PASS',
        detail: `${rows.length}척 수집${stale ? ` (stale · ${res.body.cacheSource})` : ''} · VSL_NM ${Math.round((coverage.VSL_NM || 0) * 100)}%`,
        severity: stale ? 'medium' : 'info',
        code: stale ? 'terminal.stale_cache' : undefined,
        data: { count: rows.length, fieldCoverage: coverage, label: tid.toUpperCase() },
      };
    },
  }));
}

// ── 3) 복구 동작 (CLI 는 원격 자원을 건드리지 않습니다) ──────────────────────
function buildRepairActions({ baseUrl, logger = console }) {
  return {
    // 원격 서버 상태는 CLI 가 직접 바꿀 수 없습니다 → CRON_SECRET 이 있으면 관측 재시도만 수행
    'reset-terminal-health': async ({ target }) => ({
      ok: false,
      detail: `원격 상태 초기화는 서버 런타임 전용 동작입니다 (${target}) — CLI 는 재수집으로 대체`,
    }),
    'retry-terminal': async ({ target }) => {
      const retries = 2;
      let last = null;
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
          last = await fetchJson(`${baseUrl}/api/terminal-schedule?terminal=${target}`);
          const rows = Array.isArray(last.body?.vessels) ? last.body.vessels : [];
          if (last.ok && rows.length > 0) {
            return {
              ok: true,
              detail: `재시도 ${attempt}회차에서 ${rows.length}척 수집`,
              recovered: { count: rows.length, fieldCoverage: fieldCoverageOf(rows) },
            };
          }
        } catch (error) {
          last = null;
          logger?.warn?.(`[SELF-CHECK] ${target} 재시도 ${attempt} 실패: ${error?.message || error}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      }
      return { ok: false, detail: `재시도 ${retries}회 모두 수집 실패 (HTTP ${last?.status ?? 'n/a'})` };
    },
    'rebuild-schedule-cache': async ({ target }) => ({
      ok: false,
      detail: `캐시 재구축은 서버 런타임 동작입니다 (${target}) — 자동 복구는 서버에서 수행`,
    }),
    'run-overdue-cleanup': async () => ({
      ok: false,
      detail: 'DB 정리는 서버 런타임(Vercel Cron) 동작입니다 — CLI 에서는 실행하지 않습니다',
    }),
    'bootstrap-baseline': async () => ({ ok: true, detail: '이번 관측값으로 기준선 생성' }),
    'regenerate-report': async () => {
      // 저장소 안의 최신 일일 점검 보고서를 latest.md 로 복원합니다(파일 유실·지연 대응).
      try {
        const files = await readdir(path.join(ROOT, 'reports'));
        const dated = files
          .filter((f) => /^daily-inspection-\d{4}-\d{2}-\d{2}\.md$/.test(f))
          .sort()
          .pop();
        if (!dated) return { ok: false, detail: '복원할 일일 점검 보고서가 없습니다' };
        const source = path.join(ROOT, 'reports', dated);
        const body = await readFile(source, 'utf8');
        await writeFile(path.join(ROOT, 'reports', 'latest.md'), body, 'utf8');
        return { ok: true, detail: `reports/latest.md 를 ${dated} 내용으로 복원` };
      } catch (error) {
        return { ok: false, detail: `보고서 복원 실패: ${error.message}` };
      }
    },
    'escalate-github-issue': async ({ checks, kst, platform, repo, token }) => {
      if (!repo || !token) return { ok: false, detail: 'GITHUB_REPOSITORY/GITHUB_TOKEN 미설정' };
      const body = {
        title: `[주간자가점검] ${kst.kstDate} 미해결 이상 ${checks.length}건`,
        body: [
          `플랫폼: ${platform}`,
          `점검 일시: ${kst.kstDateTime}`,
          '',
          '### 미해결 항목',
          ...checks.slice(0, 30).map((c) => `- [${c.status}] ${c.category} · ${c.name}: ${c.detail}`),
          '',
          '_자동 생성: scripts/weekly-self-check-run.mjs_',
        ].join('\n'),
        labels: ['self-check', 'automated'],
      };
      const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'busan-hak-port-self-check/1.0',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { ok: false, detail: `이슈 생성 실패 HTTP ${response.status}: ${text.slice(0, 200)}` };
      }
      const created = await response.json().catch(() => ({}));
      return { ok: true, detail: 'GitHub 이슈 생성', url: created?.html_url || null };
    },
  };
}

async function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function saveJsonFile(file, payload) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeReports(result) {
  const markdown = generateWeeklySelfCheckMarkdown(result);
  const json = buildSelfCheckJson(result);
  const dirs = [path.join(ROOT, 'reports', 'self-check'), path.join(ROOT, 'docs', 'inspections')];
  for (const dir of dirs) await mkdir(dir, { recursive: true });

  await writeFile(path.join(ROOT, 'reports', 'self-check', `weekly-self-check-${result.kstDate}.md`), markdown, 'utf8');
  await writeFile(path.join(ROOT, 'reports', 'self-check', 'latest.md'), markdown, 'utf8');
  await saveJsonFile(path.join(ROOT, 'reports', 'self-check', `weekly-self-check-${result.kstDate}.json`), json);
  await saveJsonFile(path.join(ROOT, 'reports', 'self-check', 'latest.json'), json);
  await writeFile(path.join(ROOT, 'docs', 'inspections', `weekly-${result.kstDate}.md`), markdown, 'utf8');
  await writeFile(path.join(ROOT, `주간점검보고서_${result.kstDate}.md`), markdown, 'utf8');
  return { markdown, json };
}

// ── CLI 진입점 ─────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const args = parseArgs();
  const now = new Date();
  const kst = getKstParts(now);
  const config = resolveSelfCheckConfig(process.env);

  console.log(`[주간자가점검] 시작: ${kst.kstDateTime} (${kst.isoWeek}) · 대상 ${args.baseUrl}${args.offline ? ' (offline)' : ''}`);

  const baseline = await readBaseline();
  if (!baseline) console.log('[주간자가점검] 기준선 없음 — 이번 실행으로 최초 기준선을 만듭니다.');

  const probes = [...repositoryProbes({ offline: args.offline })];
  if (!args.offline) probes.push(...siteProbes(args.baseUrl), ...terminalProbes(args.baseUrl));

  const result = await runWeeklySelfCheck({
    now,
    config,
    probes,
    baseline,
    platform: process.env.GITHUB_ACTIONS ? 'github-actions' : 'cli',
    actions: buildRepairActions({ baseUrl: args.baseUrl }),
    saveBaseline: async (next) => saveJsonFile(BASELINE_PATH, next),
  });

  const { markdown, json } = await writeReports(result);
  console.log(
    `[주간자가점검] 판정 ${result.summary.overall} — PASS ${result.summary.pass}/${result.summary.total}, WARN ${result.summary.warn}, FAIL ${result.summary.fail}, 자동복구 ${result.summary.repaired}건`
  );
  console.log(`[주간자가점검] 보고서: reports/self-check/weekly-self-check-${result.kstDate}.md`);

  // 메일 발송 (기본 OFF — Vercel Cron 과 중복 방지. --email 또는 SELF_CHECK_EMAIL_ON_CLI=1 로 켭니다)
  const shouldEmail =
    !args.noEmail &&
    (args.email || args.forceEmail || truthy(process.env.SELF_CHECK_EMAIL_ON_CLI) || truthy(process.env.REPORT_EMAIL_ON_CLI));
  if (shouldEmail) {
    const email = await sendWeeklySelfCheckEmail({ result, markdown, json, env: process.env });
    if (email.skipped) console.log(`[주간자가점검] 메일: 건너뜀 (${email.reason || '사유 없음'})`);
    else if (email.ok) console.log(`[주간자가점검] 메일: 발송 완료 → ${config.email.to.join(', ')} (${email.transport})`);
    else console.warn(`[주간자가점검] 메일: 발송 실패 — ${email.error || ''}`);
  } else {
    console.log(`[주간자가점검] 메일: 생략 (CLI 기본값) — 수신 ${config.email.to.join(', ') || DEFAULT_SELF_CHECK_RECIPIENT}`);
  }

  if (args.json) console.log(JSON.stringify(json, null, 2));

  if (result.summary.fail > 0) {
    console.log('\n[주간자가점검] 미해결 FAIL 항목:');
    for (const c of result.checks.filter((c) => c.status === 'FAIL')) console.log(`  ❌ [${c.category}] ${c.name}: ${c.detail}`);
    process.exit(1);
  }
}

export { parseArgs, fieldCoverageOf, repositoryProbes, siteProbes, terminalProbes, buildRepairActions, readBaseline, writeReports };
