#!/usr/bin/env node
/**
 * BUSAN HAK PORT INFO — 주간 자가 점검 · 자가 복구 엔진 (공용 코어)
 * ─────────────────────────────────────────────────────────────────────────────
 * 이 파일은 "한 번의 주간 점검"에 필요한 순수 로직만 담습니다.
 * 실행 주체(서버 런타임 / GitHub Actions CLI)는 각자 환경에 맞는 **probe(점검 항목)** 와
 * **repair action(복구 동작)** 을 주입하고, 판정·드리프트 분석·복구 계획·보고서 생성은
 * 이 코어가 단독으로 담당합니다. 그래서 두 실행 경로의 판정 기준이 절대 갈라지지 않습니다.
 *
 *   · 주간 점검: 매주 월요일 05:00 KST
 *       - Vercel Cron  → GET /api/cron/weekly-self-check   (vercel.json, 20:00 UTC 일요일)
 *       - node-cron    → 0 5 * * 1 Asia/Seoul (상시 프로세스 서버)
 *       - GitHub Actions → .github/workflows/weekly-self-check.yml (영구 보고서 커밋)
 *   · 보고서 메일: 기본 수신자 REPORT_EMAIL_TO (미설정 시 luxrank@gmail.com)
 *
 * ── 점검 4단계 ───────────────────────────────────────────────────────────────
 *   1) 수집(probe)      : 기능·런타임·터미널 데이터·DB 상태를 각 실행 주체가 수집
 *   2) 판정(drift)      : 지난 점검 기준선(baseline) 대비 수집량·필드 커버리지 변화 감지
 *   3) 복구(repair)     : 아래 고정 규칙표(REPAIR_RULES)에 따라 자동 복구를 순서대로 실행
 *   4) 보고(report)     : 마크다운·JSON 생성 → 메일 발송(+ 이번 주 중복 발송 차단은 호출자)
 *
 * ── 자동 복구는 "안전한 범위"로 제한됩니다 ─────────────────────────────────
 *   · 캐시·상태·파생물(보고서)만 고칩니다. 근무일지·게시글 같은 사용자 원본 데이터는
 *     **절대 수정·삭제하지 않습니다**(읽기 전용 점검).
 *   · 복구 후 반드시 재수집(recheck)으로 효과를 검증하고, 실패하면 GitHub 이슈로 에스컬레이션합니다.
 *   · 모든 복구는 보고서에 실행 내역·결과로 남아 감사(audit) 가능합니다.
 */

import crypto from 'node:crypto';
import { sendReportEmailMessage, resolveMailTransport } from './daily-report-mailer.mjs';

export const SELF_CHECK_VERSION = 1;
export const DEFAULT_SELF_CHECK_RECIPIENT = 'luxrank@gmail.com';
export const SITE_LABEL = '부산항 스마트 작업 가이드';

/** 터미널 스케줄 파서가 반드시 채워야 하는 핵심 필드 (드리프트 판정 기준) */
export const CORE_VESSEL_FIELDS = ['VSL_NM', 'ETB', 'ATD'];
/** 수집량 급감 판정 기본 임계값 (기준선 대비 비율) */
export const DEFAULT_DRIFT_THRESHOLDS = { warnRatio: 0.5, failRatio: 0.15, coverageDropRatio: 0.5 };

const SEVERITY_ORDER = { INFO: 0, PASS: 0, WARN: 1, FAIL: 2 };
const STATUS_EMOJI = { PASS: '✅', WARN: '⚠️', FAIL: '❌' };
const VERDICT = {
  PASS: { label: '정상', emoji: '🟢', color: '#0b8043' },
  WARN: { label: '주의', emoji: '🟡', color: '#a46a21' },
  FAIL: { label: '이상', emoji: '🔴', color: '#b3261e' },
};

/**
 * 자동 복구 규칙표 — 이 표가 "스스로 고치는" 동작의 전부입니다.
 * stopOnFailure: true 인 동작이 실패하면 같은 규칙의 이후 동작은 건너뜁니다.
 */
export const REPAIR_RULES = {
  terminal_recover: {
    label: '터미널 수집 복구',
    actions: ['reset-terminal-health', 'retry-terminal', 'rebuild-schedule-cache'],
    stopOnFailure: { 'reset-terminal-health': false, 'retry-terminal': true, 'rebuild-schedule-cache': false },
  },
  cleanup_overdue: {
    label: '지연된 DB 정리 실행',
    actions: ['run-overdue-cleanup'],
    stopOnFailure: {},
  },
  report_missing: {
    label: '보고서 산출물 재생성',
    actions: ['regenerate-report'],
    stopOnFailure: {},
  },
  baseline_bootstrap: {
    label: '기준선 초기화',
    actions: ['bootstrap-baseline'],
    stopOnFailure: {},
  },
};

// ── 공용 유틸 ────────────────────────────────────────────────────────────────
function truthy(value, defaultValue = false) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return !['0', 'false', 'no', 'off', 'n'].includes(raw);
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRecipients(value) {
  return String(value ?? '')
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** KST(UTC+9) 기준 날짜·시각·ISO 주차 문자열 */
export function getKstParts(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dayName = days[kst.getUTCDay()];
  const date = `${y}-${m}-${d}`;
  const dateTime = `${date} (${dayName}) ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')} KST`;
  // ISO 8601 주차 (KST 날짜 기준)
  const iso = new Date(Date.UTC(y, kst.getUTCMonth(), kst.getUTCDate()));
  const dayNum = iso.getUTCDay() || 7;
  iso.setUTCDate(iso.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(iso.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((iso - yearStart) / 86400000 + 1) / 7);
  return { kstDate: date, kstDateTime: dateTime, dayName, isoWeek: `${iso.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

/**
 * 환경변수에서 주간 자가 점검 설정을 읽습니다.
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveSelfCheckConfig(env = process.env) {
  const thresholds = {
    warnRatio: Number(env.SELF_CHECK_DRIFT_WARN_RATIO) > 0 ? Number(env.SELF_CHECK_DRIFT_WARN_RATIO) : DEFAULT_DRIFT_THRESHOLDS.warnRatio,
    failRatio: Number(env.SELF_CHECK_DRIFT_FAIL_RATIO) > 0 ? Number(env.SELF_CHECK_DRIFT_FAIL_RATIO) : DEFAULT_DRIFT_THRESHOLDS.failRatio,
    coverageDropRatio:
      Number(env.SELF_CHECK_COVERAGE_DROP_RATIO) > 0
        ? Number(env.SELF_CHECK_COVERAGE_DROP_RATIO)
        : DEFAULT_DRIFT_THRESHOLDS.coverageDropRatio,
  };
  const recipients = parseRecipients(env.SELF_CHECK_EMAIL_TO);
  const fallbackRecipients = parseRecipients(env.REPORT_EMAIL_TO);
  const to = recipients.length ? recipients : fallbackRecipients.length ? fallbackRecipients : [DEFAULT_SELF_CHECK_RECIPIENT];
  return {
    enabled: truthy(env.SELF_CHECK_ENABLED, true),
    autoFix: truthy(env.SELF_CHECK_AUTO_FIX, true),
    retryAttempts: Math.min(Math.max(Number(env.SELF_CHECK_RETRY_ATTEMPTS) || 2, 1), 4),
    retryBackoffMs: Math.max(Number(env.SELF_CHECK_RETRY_BACKOFF_MS) || 1200, 0),
    historyLimit: Math.min(Math.max(Number(env.SELF_CHECK_HISTORY_LIMIT) || 8, 3), 52),
    probeTimeoutMs: Math.min(Math.max(Number(env.SELF_CHECK_PROBE_TIMEOUT_MS) || 25000, 3000), 60000),
    thresholds,
    email: {
      enabled: truthy(env.SELF_CHECK_EMAIL_ENABLED, truthy(env.REPORT_EMAIL_ENABLED, true)),
      mode: String(env.SELF_CHECK_EMAIL_MODE || 'always').trim().toLowerCase() === 'alert' ? 'alert' : 'always',
      to,
      from: String(env.REPORT_EMAIL_FROM || '').trim(),
      attach: truthy(env.REPORT_EMAIL_ATTACHMENTS, true),
    },
    escalate: {
      token: String(env.GITHUB_TOKEN || env.GITHUB_ISSUE_TOKEN || '').trim(),
      repo: String(env.GITHUB_REPOSITORY || env.SELF_CHECK_GITHUB_REPO || '').trim(),
    },
  };
}

// ── 기준선(baseline) ────────────────────────────────────────────────────────
export function createEmptyBaseline(now = new Date()) {
  return {
    version: SELF_CHECK_VERSION,
    createdAt: now.toISOString(),
    updatedAt: null,
    terminals: {},
    runs: [],
  };
}

/** 기준선 파일이 없거나 손상되었으면 빈 기준선으로 안전하게 복구합니다. */
export function normalizeBaseline(raw, now = new Date()) {
  if (!raw) return createEmptyBaseline(now);
  let data = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return createEmptyBaseline(now);
    }
  }
  if (!data || typeof data !== 'object') return createEmptyBaseline(now);
  const terminals = data.terminals && typeof data.terminals === 'object' ? data.terminals : {};
  const runs = Array.isArray(data.runs) ? data.runs.slice(-52) : [];
  return {
    version: SELF_CHECK_VERSION,
    createdAt: data.createdAt || now.toISOString(),
    updatedAt: data.updatedAt || null,
    terminals,
    runs,
  };
}

function ewma(prev, next, alpha) {
  if (typeof prev !== 'number' || !Number.isFinite(prev)) return next;
  return prev * (1 - alpha) + next * alpha;
}

/**
 * 기준선 갱신 — 이번 주 수집 결과를 지수이동평균(EWMA)으로 반영합니다.
 * 수집 0척은 기준선을 오염시키지 않습니다(장애 주간이 기준선을 끌어내리면 이후 급감을 못 잡기 때문).
 *
 * @param {object} baseline 정규화된 기준선
 * @param {Array<{terminal: string, count: number, fieldCoverage?: Record<string, number>, at?: string}>} observations
 * @param {Date} now
 * @param {{alpha?: number, limit?: number}} options
 */
export function updateBaseline(baseline, observations = [], now = new Date(), options = {}) {
  const alpha = typeof options.alpha === 'number' ? options.alpha : 0.5;
  const limit = Math.max(Number(options.limit) || 8, 3);
  const next = {
    ...normalizeBaseline(baseline, now),
    terminals: { ...(normalizeBaseline(baseline, now).terminals || {}) },
    runs: [...(normalizeBaseline(baseline, now).runs || [])],
  };
  const at = now.toISOString();
  let updated = 0;

  for (const obs of observations) {
    if (!obs || !obs.terminal) continue;
    const tid = String(obs.terminal).toLowerCase();
    const prev = next.terminals[tid] || null;
    const count = Number(obs.count);
    if (!Number.isFinite(count) || count < 0) continue;

    const prevCount = prev && typeof prev.count === 'number' ? prev.count : null;
    const nextCount = count > 0 ? (prevCount === null ? count : Math.round(ewma(prevCount, count, alpha))) : prevCount ?? 0;
    const coverage = {};
    const prevCoverage = prev?.fieldCoverage || {};
    const incoming = obs.fieldCoverage || {};
    for (const field of new Set([...Object.keys(prevCoverage), ...Object.keys(incoming)])) {
      const val = typeof incoming[field] === 'number' ? incoming[field] : 0;
      coverage[field] = Number(ewma(prevCoverage[field] ?? val, val, alpha).toFixed(4));
    }
    const history = Array.isArray(prev?.history) ? [...prev.history] : [];
    if (count > 0) history.push({ at, count });
    next.terminals[tid] = {
      count: nextCount === null ? 0 : nextCount,
      fieldCoverage: coverage,
      samples: (prev?.samples || 0) + (count > 0 ? 1 : 0),
      updatedAt: count > 0 ? at : prev?.updatedAt || null,
      lastObservedCount: count,
      history: history.slice(-limit),
    };
    updated += 1;
  }

  next.updatedAt = at;
  return { baseline: next, updated };
}

// ── 드리프트(데이터 변화) 판정 ───────────────────────────────────────────────
/**
 * 터미널 1곳의 수집 결과를 기준선과 비교합니다.
 *
 * @param {object} input
 * @param {string} input.terminal
 * @param {number} input.count          이번 주 수집 척수
 * @param {Record<string, number>} [input.fieldCoverage]  필드별 채움 비율(0~1)
 * @param {string|null} [input.error]   수집 자체가 실패한 경우 오류 메시지
 * @param {object} [input.baseline]     normalizeBaseline 결과
 * @param {object} [input.thresholds]
 * @param {object} [input.config]
 */
export function analyzeTerminalDrift(input = {}) {
  const tid = String(input.terminal || '').toLowerCase();
  const count = Number(input.count) || 0;
  const coverage = input.fieldCoverage && typeof input.fieldCoverage === 'object' ? input.fieldCoverage : {};
  const thresholds = { ...DEFAULT_DRIFT_THRESHOLDS, ...(input.thresholds || input.config?.thresholds || {}) };
  const baseline = normalizeBaseline(input.baseline);
  const base = baseline.terminals?.[tid] || null;
  const findings = [];

  const add = (code, severity, detail) => findings.push({ code, severity, detail });

  if (input.error) {
    add('fetch_failed', 'FAIL', `수집 실패: ${String(input.error).slice(0, 300)}`);
  } else if (count === 0) {
    add('zero_rows', 'FAIL', '수집 0척 — 소스 HTML 구조 변경·차단·일정 공백 가능성');
  }

  if (!base || !base.samples) {
    add('baseline_new', 'INFO', '첫 관측 — 이번 결과를 기준선으로 저장합니다');
  } else if (count > 0) {
    const baseCount = Number(base.count) || 0;
    if (baseCount > 0) {
      const ratio = count / baseCount;
      if (ratio < thresholds.failRatio) {
        add('count_drop_fail', 'FAIL', `수집량 급감: ${count}척 (기준선 ${baseCount}척의 ${Math.round(ratio * 100)}%)`);
      } else if (ratio < thresholds.warnRatio) {
        add('count_drop_warn', 'WARN', `수집량 감소: ${count}척 (기준선 ${baseCount}척의 ${Math.round(ratio * 100)}%)`);
      }
    }
    for (const field of CORE_VESSEL_FIELDS) {
      const nowCoverage = typeof coverage[field] === 'number' ? coverage[field] : 0;
      const wasCoverage = typeof base.fieldCoverage?.[field] === 'number' ? base.fieldCoverage[field] : null;
      if (wasCoverage !== null && wasCoverage >= 0.8 && nowCoverage < 0.5) {
        add(
          'field_coverage_drop',
          'FAIL',
          `필드 '${field}' 채움률 급락: ${Math.round(nowCoverage * 100)}% (기준선 ${Math.round(wasCoverage * 100)}%) — 파서 셀렉터 변경 의심`
        );
      } else if (nowCoverage === 0 && wasCoverage === null) {
        add('field_missing', 'WARN', `필드 '${field}' 가 이번 수집에 없습니다`);
      }
    }
    const known = new Set(Object.keys(base.fieldCoverage || {}));
    const added = Object.keys(coverage).filter((f) => !known.has(f) && coverage[f] > 0);
    if (added.length && base.samples >= 2) {
      add('field_added', 'INFO', `새 필드 감지: ${added.slice(0, 6).join(', ')} — 다음 점검부터 기준선에 반영`);
    }
  }

  let status = 'PASS';
  for (const f of findings) {
    if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[status]) status = f.severity;
  }
  const baseCount = Number(base?.count) || 0;
  return {
    terminal: tid,
    status,
    findings,
    current: { count, fieldCoverage: coverage },
    baseline: base ? { count: baseCount, fieldCoverage: base.fieldCoverage || {}, samples: base.samples || 0 } : null,
    changeRatio: baseCount > 0 && count > 0 ? Number((count / baseCount).toFixed(3)) : null,
    error: input.error ? String(input.error).slice(0, 300) : null,
    after: null,
  };
}

export function summarizeFindings(drift = []) {
  return {
    total: drift.length,
    warn: drift.filter((d) => d.status === 'WARN').length,
    fail: drift.filter((d) => d.status === 'FAIL').length,
  };
}

// ── 복구 계획·실행 ──────────────────────────────────────────────────────────
/**
 * 점검 결과·드리프트를 근거로 자동 복구 계획을 세웁니다(고정 규칙표 기반, 무작위 동작 없음).
 *
 * @param {{checks?: Array, drift?: Array, baseline?: object, config?: object}} input
 */
export function planRepairs(input = {}) {
  const checks = Array.isArray(input.checks) ? input.checks : [];
  const drift = Array.isArray(input.drift) ? input.drift : [];
  const baseline = normalizeBaseline(input.baseline);
  const config = input.config || resolveSelfCheckConfig({});
  const plan = [];
  const seenTerminals = new Set();

  for (const d of drift) {
    if (!d || (d.status !== 'WARN' && d.status !== 'FAIL')) continue;
    if (seenTerminals.has(d.terminal)) continue;
    seenTerminals.add(d.terminal);
    const reasons = d.findings.filter((f) => f.severity !== 'INFO').map((f) => f.code);
    plan.push({
      id: `terminal:${d.terminal}`,
      rule: 'terminal_recover',
      target: d.terminal,
      reason: reasons.join(',') || 'drift',
      actions: [...REPAIR_RULES.terminal_recover.actions],
    });
  }

  for (const check of checks) {
    if (check?.code === 'automation.cleanup_overdue' && check.status !== 'PASS') {
      plan.push({ id: 'cleanup', rule: 'cleanup_overdue', target: 'database', reason: 'cleanup_overdue', actions: [...REPAIR_RULES.cleanup_overdue.actions] });
    }
    if (check?.code === 'report.missing' && check.status !== 'PASS') {
      plan.push({ id: 'report', rule: 'report_missing', target: 'reports', reason: 'report_missing', actions: [...REPAIR_RULES.report_missing.actions] });
    }
  }

  const hasBaseline = Object.keys(baseline.terminals || {}).length > 0;
  if (!hasBaseline && drift.length > 0) {
    // 최초 실행: 기준선을 만드는 것 자체가 복구 동작입니다.
    plan.push({ id: 'baseline', rule: 'baseline_bootstrap', target: 'baseline', reason: 'baseline_missing', actions: ['bootstrap-baseline'] });
  }

  if (!config.autoFix) {
    return plan.map((p) => ({ ...p, disabled: true }));
  }
  return plan;
}

/**
 * 복구 계획을 순서대로 실행합니다.
 * actions: { 'reset-terminal-health': async (ctx) => ({ok, detail, recovered?}) , ... }
 */
export async function executeRepairs({ plan = [], actions = {}, context = {}, config = {}, logger = console } = {}) {
  const results = [];
  for (const item of plan) {
    if (item.disabled) {
      results.push({ id: item.id, rule: item.rule, target: item.target, action: 'skipped', status: 'skipped', detail: 'SELF_CHECK_AUTO_FIX=0 — 자동 복구 비활성', at: new Date().toISOString() });
      continue;
    }
    const rule = REPAIR_RULES[item.rule];
    if (!rule) {
      results.push({ id: item.id, rule: item.rule, target: item.target, action: 'skipped', status: 'skipped', detail: '알 수 없는 복구 규칙', at: new Date().toISOString() });
      continue;
    }
    let recovered = null;
    let failed = false;
    for (const actionName of item.actions) {
      if (failed) break;
      const handler = actions[actionName];
      const startedAt = Date.now();
      if (typeof handler !== 'function') {
        results.push({
          id: `${item.id}:${actionName}`,
          rule: item.rule,
          target: item.target,
          action: actionName,
          status: 'skipped',
          detail: '이 실행 환경에서는 지원하지 않는 복구 동작',
          durationMs: 0,
          at: new Date(startedAt).toISOString(),
        });
        if (rule.stopOnFailure[actionName]) failed = true;
        continue;
      }
      try {
        const outcome = (await handler({ ...context, target: item.target, reason: item.reason })) || {};
        const ok = outcome.ok !== false;
        if (outcome.recovered) recovered = outcome.recovered;
        results.push({
          id: `${item.id}:${actionName}`,
          rule: item.rule,
          target: item.target,
          action: actionName,
          status: ok ? 'applied' : 'failed',
          detail: outcome.detail || (ok ? '완료' : '실패'),
          durationMs: Date.now() - startedAt,
          at: new Date(startedAt).toISOString(),
          recovered: outcome.recovered || null,
        });
        logger?.log?.(`[SELF-CHECK] 복구 ${ok ? '적용' : '실패'} — ${item.target}/${actionName}: ${outcome.detail || ''}`);
        if (!ok && rule.stopOnFailure[actionName]) failed = true;
      } catch (error) {
        const detail = error?.message || String(error);
        results.push({
          id: `${item.id}:${actionName}`,
          rule: item.rule,
          target: item.target,
          action: actionName,
          status: 'failed',
          detail,
          durationMs: Date.now() - startedAt,
          at: new Date(startedAt).toISOString(),
        });
        logger?.warn?.(`[SELF-CHECK] 복구 예외 — ${item.target}/${actionName}: ${detail}`);
        if (rule.stopOnFailure[actionName]) failed = true;
      }
    }
    if (recovered) {
      // 재검증 정보는 실제로 수집을 성공시킨 동작(주로 retry-terminal)에 귀속시킵니다.
      const owner = [...results].reverse().find((r) => r.rule === item.rule && r.target === item.target && r.recovered);
      if (owner) owner.recovered = recovered;
    }
  }
  return results;
}

/**
 * 복구 후 재검증 결과를 점검표·드리프트에 반영합니다.
 * (복구가 실제로 효과가 있었는지 확인 — "고쳤다"는 자기 신고만으로 끝내지 않습니다)
 */
export function applyRecoveries({ drift = [], checks = [], repairs = [], baseline = null, thresholds = DEFAULT_DRIFT_THRESHOLDS } = {}) {
  const patchedDrift = drift.map((d) => ({ ...d }));
  const patchedChecks = checks.map((c) => ({ ...c }));
  let fixed = 0;

  for (const repair of repairs) {
    if (!repair?.recovered) continue;
    const target = String(repair.target || '').toLowerCase();
    const index = patchedDrift.findIndex((d) => d.terminal === target);
    if (index < 0) continue;
    const before = patchedDrift[index];
    if (before.status === 'PASS') continue;
    const after = analyzeTerminalDrift({
      terminal: target,
      count: repair.recovered.count,
      fieldCoverage: repair.recovered.fieldCoverage,
      baseline,
      thresholds,
    });
    after.after = { status: after.status, count: after.current.count, findings: after.findings };
    after.before = { status: before.status, count: before.current.count, findings: before.findings };
    // 재검증이 실제로 개선되었을 때만 복구 성공으로 인정
    if (SEVERITY_ORDER[after.status] < SEVERITY_ORDER[before.status]) {
      fixed += 1;
      const ci = patchedChecks.findIndex((c) => c.kind === 'terminal' && String(c.target || '').toLowerCase() === target);
      if (ci >= 0) {
        patchedChecks[ci] = {
          ...patchedChecks[ci],
          status: after.status,
          detail: `${patchedChecks[ci].detail} → 자동 복구 후 재검증 ${after.status} (${after.current.count}척)`,
          recovered: true,
        };
      }
    }
    patchedDrift[index] = after;
  }

  for (const repair of repairs) {
    if (repair.status === 'applied' && !repair.recovered) repair.verified = null;
    if (repair.recovered) repair.verified = true;
  }

  return { drift: patchedDrift, checks: patchedChecks, fixed };
}

// ── probe 실행기 ────────────────────────────────────────────────────────────
function withTimeout(promise, timeoutMs, label) {
  if (!timeoutMs) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 시간 초과 (${timeoutMs}ms)`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function runSingleProbe(probe, timeoutMs) {
  const startedAt = Date.now();
  try {
    const outcome = (await withTimeout(Promise.resolve().then(() => probe.run()), timeoutMs, probe.name || probe.id)) || {};
    const status = ['PASS', 'WARN', 'FAIL'].includes(outcome.status) ? outcome.status : 'PASS';
    return {
      id: probe.id,
      category: probe.category || '기타',
      name: probe.name || probe.id,
      kind: probe.kind || 'feature',
      target: probe.target || null,
      status,
      detail: outcome.detail || '',
      severity: outcome.severity || (status === 'FAIL' ? 'high' : status === 'WARN' ? 'medium' : 'info'),
      code: outcome.code || null,
      data: outcome.data || null,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: probe.id,
      category: probe.category || '기타',
      name: probe.name || probe.id,
      kind: probe.kind || 'feature',
      target: probe.target || null,
      status: 'FAIL',
      detail: error?.message || String(error),
      severity: probe.critical === false ? 'medium' : 'high',
      code: `${probe.id}.error`,
      data: null,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * 주간 자가 점검 1회 실행.
 *
 * @param {object} options
 * @param {Date} [options.now]
 * @param {object} [options.config]        resolveSelfCheckConfig 결과
 * @param {Array}  [options.probes]        점검 항목 목록
 * @param {object} [options.baseline]      지난 기준선(JSON)
 * @param {object} [options.actions]       복구 동작 map
 * @param {(baseline:object)=>Promise<void>|void} [options.saveBaseline]
 * @param {object} [options.platform]      'node-server' | 'vercel-serverless' | 'github-actions'
 * @param {object} [options.logger]
 */
export async function runWeeklySelfCheck(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const config = options.config || resolveSelfCheckConfig(options.env || process.env);
  const logger = options.logger || console;
  const startedAt = Date.now();
  const kst = getKstParts(now);
  const platform = options.platform || 'node-server';
  const steps = [];
  const markStep = (name, label, startedAtMs, status = 'ok', detail = null) => {
    const record = {
      name,
      label,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAtMs),
      status,
      detail,
    };
    steps.push(record);
    return record;
  };

  if (!config.enabled) {
    return {
      skipped: true,
      reason: 'disabled',
      generatedAt: now.toISOString(),
      ...kst,
      platform,
      summary: { total: 0, pass: 0, warn: 0, fail: 0, overall: 'PASS', repaired: 0, repairFailed: 0, unresolved: 0, passRate: 100 },
      checks: [],
      drift: [],
      repairs: [],
      escalation: { attempted: false, status: 'skipped', detail: 'SELF_CHECK_ENABLED=0' },
      baseline: { updated: false, terminals: 0 },
      config: publicConfig(config),
      steps: [],
      durationMs: 0,
    };
  }

  const baseline = normalizeBaseline(options.baseline, now);
  const checks = [];
  const drift = [];
  const tProbes = Date.now();

  for (const probe of Array.isArray(options.probes) ? options.probes : []) {
    const result = await runSingleProbe(probe, config.probeTimeoutMs);
    if (result.kind === 'terminal') {
      const data = result.data || {};
      const analysis = analyzeTerminalDrift({
        terminal: result.target || result.id,
        count: data.count || 0,
        fieldCoverage: data.fieldCoverage || {},
        error: data.error || (result.status === 'FAIL' && !data.count ? result.detail : null),
        baseline,
        thresholds: config.thresholds,
      });
      // 수집 자체가 실패한 경우 드리프트 판정을 그대로 반영하되, probe 의 FAIL 사유는 유지합니다.
      if (result.status === 'FAIL' && analysis.status !== 'FAIL') analysis.status = 'FAIL';
      // 수집은 됐지만 품질이 낮은 경우(예: stale 캐시 폴백)도 WARN 으로 보존합니다.
      if (result.status === 'WARN' && !analysis.findings.some((f) => f.severity !== 'INFO')) {
        analysis.findings.push({ code: result.code || 'terminal.degraded', severity: 'WARN', detail: result.detail || '수집 품질 저하' });
        analysis.status = 'WARN';
      }
      drift.push({ ...analysis, latencyMs: result.durationMs, terminalLabel: data.label || null });
      checks.push({
        ...result,
        status: analysis.status,
        detail: analysis.findings.length ? analysis.findings.map((f) => f.detail).join(' / ') : result.detail || `${analysis.current.count}척 수집 정상`,
      });
    } else {
      checks.push(result);
    }
  }
  markStep('probes', '기능 점검', tProbes, 'ok', `점검 항목 ${checks.length}건`);

  // 데이터 변화 판정은 위 루프에서 함께 계산되지만, 보고서 타임라인에는 별도 단계로 남깁니다.
  const tDrift = Date.now();
  markStep(
    'drift',
    '데이터 변화 판정',
    tDrift,
    'ok',
    `터미널 ${drift.length}곳 · WARN ${drift.filter((d) => d.status === 'WARN').length} · FAIL ${drift.filter((d) => d.status === 'FAIL').length}`
  );

  // 기준선 갱신(수집 성공 관측만 반영)
  const observations = drift.map((d) => ({
    terminal: d.terminal,
    count: d.current.count,
    fieldCoverage: d.current.fieldCoverage,
    at: now.toISOString(),
  }));
  const { baseline: nextBaseline, updated: baselineUpdated } = updateBaseline(baseline, observations, now, {
    limit: config.historyLimit,
  });

  const tRepairs = Date.now();
  const plan = planRepairs({ checks, drift, baseline, config });
  const repairs = plan.length
    ? await executeRepairs({
        plan,
        actions: options.actions || {},
        config,
        logger,
        context: { now, drift, checks, baseline, config, platform },
      })
    : [];

  markStep(
    'repairs',
    '자동 복구',
    tRepairs,
    repairs.every((r) => r.status !== 'failed') ? 'ok' : 'warn',
    `복구 계획 ${plan.length}건 · 실행 ${repairs.length}건 · 실패 ${repairs.filter((r) => r.status === 'failed').length}건`
  );

  const tRecheck = Date.now();
  const recovered = applyRecoveries({ drift, checks, repairs, baseline, thresholds: config.thresholds });
  markStep('recheck', '복구 후 재검증', tRecheck, 'ok', `검증된 복구 ${recovered.fixed}건`);

  const tBaseline = Date.now();
  let baselineSaved = false;
  let baselineSaveError = null;

  // 미해결 FAIL → GitHub 이슈로 에스컬레이션 (사람이 판단해야 하는 영역)
  const unresolvedChecks = recovered.checks.filter((c) => c.status === 'FAIL');
  let escalation = { attempted: false, status: 'skipped', detail: null, url: null, error: null };
  if (unresolvedChecks.length > 0 && config.escalate.token && config.escalate.repo && typeof options.actions?.['escalate-github-issue'] === 'function') {
    try {
      const outcome = (await options.actions['escalate-github-issue']({
        checks: unresolvedChecks,
        drift: recovered.drift,
        repairs,
        kst,
        platform,
        repo: config.escalate.repo,
        token: config.escalate.token,
      })) || {};
      escalation = {
        attempted: true,
        status: outcome.ok === false ? 'failed' : 'created',
        detail: outcome.detail || null,
        url: outcome.url || null,
        error: outcome.ok === false ? outcome.detail || 'failed' : null,
      };
    } catch (error) {
      escalation = { attempted: true, status: 'failed', detail: null, url: null, error: error?.message || String(error) };
    }
  } else if (unresolvedChecks.length > 0) {
    escalation = {
      attempted: false,
      status: 'skipped',
      detail: config.escalate.token && config.escalate.repo ? '에스컬레이션 동작 미등록' : 'GITHUB_TOKEN/GITHUB_REPOSITORY 미설정 — 메일 보고서로만 통보',
      url: null,
      error: null,
    };
  }

  const summary = summarizeChecks(recovered.checks, repairs);

  // 다음 점검을 위한 기준선 영속화 (실패해도 이번 보고서는 유효)
  if (typeof options.saveBaseline === 'function') {
    try {
      await options.saveBaseline({ ...nextBaseline, lastRun: { at: now.toISOString(), overall: summary.overall, pass: summary.pass, warn: summary.warn, fail: summary.fail } });
      baselineSaved = true;
    } catch (error) {
      baselineSaved = false;
      baselineSaveError = error?.message || String(error);
      logger?.warn?.(`[SELF-CHECK] 기준선 저장 실패: ${baselineSaveError}`);
    }
  }
  markStep(
    'baseline',
    '기준선 저장',
    tBaseline,
    baselineSaveError ? 'failed' : baselineSaved ? 'ok' : 'skipped',
    baselineSaveError || (baselineSaved ? `터미널 ${Object.keys(nextBaseline.terminals || {}).length}곳` : '기준선 저장소 미지정')
  );

  const result = {
    version: SELF_CHECK_VERSION,
    skipped: false,
    generatedAt: now.toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    ...kst,
    platform,
    summary,
    checks: recovered.checks,
    drift: recovered.drift,
    repairs,
    escalation,
    // 보고서 생성·메일 발송은 호출자(서버/CLI)가 이어서 기록합니다(appendStep).
    steps,
    baseline: {
      updated: baselineUpdated > 0,
      terminals: Object.keys(nextBaseline.terminals || {}).length,
      runs: nextBaseline.runs?.length || 0,
      saved: baselineSaved,
      ...(baselineSaveError ? { saveError: baselineSaveError } : {}),
    },
    config: publicConfig(config),
    durationMs: Date.now() - startedAt,
  };

  return result;
}

function publicConfig(config) {
  return {
    enabled: config.enabled,
    autoFix: config.autoFix,
    retryAttempts: config.retryAttempts,
    thresholds: config.thresholds,
    emailEnabled: config.email.enabled,
    emailMode: config.email.mode,
    emailTo: config.email.to,
    escalationReady: Boolean(config.escalate.token && config.escalate.repo),
  };
}

/**
 * 파이프라인 단계 기록 — "무엇을 어떤 순서로 끝냈는지"를 보고서·메일·API 에 남깁니다.
 * (메일은 **모든 작업이 끝난 뒤** 발송되며, 이 타임라인이 그 근거가 됩니다)
 */
export function appendStep(result, step = {}) {
  if (!result || typeof result !== 'object') return null;
  if (!Array.isArray(result.steps)) result.steps = [];
  const at = step.at ? new Date(step.at) : new Date();
  const record = {
    name: step.name || 'step',
    label: step.label || step.name || '단계',
    startedAt: step.startedAt || at.toISOString(),
    finishedAt: at.toISOString(),
    durationMs: Number.isFinite(Number(step.durationMs)) ? Number(step.durationMs) : 0,
    status: step.status || 'ok',
    detail: step.detail ?? null,
  };
  result.steps.push(record);
  result.completedAt = record.finishedAt;
  return record;
}

export function summarizeChecks(checks = [], repairs = []) {
  const pass = checks.filter((c) => c.status === 'PASS').length;
  const warn = checks.filter((c) => c.status === 'WARN').length;
  const fail = checks.filter((c) => c.status === 'FAIL').length;
  const total = checks.length;
  const repaired = repairs.filter((r) => r.verified === true).length;
  const repairFailed = repairs.filter((r) => r.status === 'failed').length;
  const overall = fail > 0 ? 'FAIL' : warn > 0 || repaired > 0 || repairFailed > 0 ? 'WARN' : 'PASS';
  return {
    total,
    pass,
    warn,
    fail,
    overall,
    repaired,
    repairFailed,
    unresolved: fail,
    passRate: total ? Math.round((pass / total) * 100) : 100,
  };
}

// ── 보고서(마크다운·메일) ───────────────────────────────────────────────────
function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  if (total < 1000) return `${total}ms`;
  const seconds = total / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}초`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}분 ${Math.round(seconds % 60)}초`;
}

function formatKstDateTimeFromIso(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso || '');
  return getKstParts(date).kstDateTime;
}

function statusLabel(status) {
  return `${STATUS_EMOJI[status] || '❓'} ${status}`;
}

function groupByCategory(checks = []) {
  const map = new Map();
  for (const check of checks) {
    const entry = map.get(check.category) || { category: check.category, pass: 0, warn: 0, fail: 0, total: 0 };
    entry.total += 1;
    if (check.status === 'PASS') entry.pass += 1;
    else if (check.status === 'WARN') entry.warn += 1;
    else entry.fail += 1;
    map.set(check.category, entry);
  }
  return [...map.values()];
}

export function generateWeeklySelfCheckMarkdown(result) {
  const { kstDate, kstDateTime, summary, escalation, baseline, config, platform } = result;
  const checks = result.checks || [];
  const drift = result.drift || [];
  const repairs = result.repairs || [];
  const steps = Array.isArray(result.steps) ? result.steps : [];
  const completedAtLabel = result.completedAt ? formatKstDateTimeFromIso(result.completedAt) : kstDateTime;
  const durationLabel = formatDuration(result.durationMs || 0);
  const verdict = VERDICT[summary.overall] || VERDICT.PASS;
  const byCategory = groupByCategory(checks);
  const actionNeeded = checks.filter((c) => c.status !== 'PASS');

  let md = '';
  md += `# 부산항 스마트 작업 가이드 — 주간 자가 점검 · 자가 복구 보고서\n\n`;
  md += `> **점검 일시**: ${kstDateTime}\n`;
  md += `> **점검 주차**: ${result.isoWeek} · 매주 월요일 05:00 KST 자동 실행\n`;
  md += `> **실행 환경**: ${platform}\n`;
  md += `> **점검 방식**: 기능 점검 → 데이터 변화 감지 → 자동 복구 → 재검증 → 보고 (Vercel Cron · GitHub Actions · node-cron 공용 엔진)\n\n`;
  md += `---\n\n## 0. 요약\n\n`;
  md += `| 구분 | 결과 |\n| --- | --- |\n`;
  md += `| **종합 판정** | ${verdict.emoji} **${verdict.label}** (${summary.overall}) |\n`;
  md += `| 전체 점검 항목 | ${summary.total}건 |\n`;
  md += `| ✅ PASS | ${summary.pass}건 |\n`;
  md += `| ⚠️ WARN | ${summary.warn}건 |\n`;
  md += `| ❌ FAIL | ${summary.fail}건 |\n`;
  md += `| 🛠️ 자동 복구 완료 | ${summary.repaired}건 |\n`;
  md += `| 🔁 복구 실패 | ${summary.repairFailed}건 |\n`;
  md += `| 통과율 | ${summary.passRate}% |\n`;
  md += `| 기준선 상태 | ${baseline?.updated ? `갱신됨 (터미널 ${baseline.terminals}곳)` : '갱신 없음'} |\n`;
  md += `| 작업 종료 시각 | ${completedAtLabel} (총 ${durationLabel}) |\n`;
  md += `| 보고서 메일 | **작업 종료 후 발송** (같은 주 1통 · 수신 ${(config?.emailTo || []).join(', ')}) |\n\n`;

  // 작업 타임라인 — "모든 작업이 끝난 뒤 메일을 보냈다"는 근거를 보고서에 남깁니다.
  if (steps.length) {
    md += `---\n\n## 0-1. 작업 타임라인 (작업 종료 후 발송)\n\n`;
    md += `| # | 단계 | 상태 | 소요 | 상세 |\n| --- | --- | --- | --- | --- |\n`;
    steps.forEach((st, i) => {
      const mark = st.status === 'ok' ? '✅' : st.status === 'failed' ? '❌' : st.status === 'warn' ? '⚠️' : '⏭️';
      md += `| ${i + 1} | ${st.label} | ${mark} ${st.status} | ${formatDuration(st.durationMs)} | ${String(st.detail || '').replace(/\|/g, '/')} |\n`;
    });
    md += `\n> ✅ **모든 단계가 끝난 뒤** 이 보고서를 메일로 발송합니다. 같은 ISO 주차(${result.isoWeek})에는 1통만 도착합니다.\n\n`;
  }

  if (summary.overall === 'PASS') {
    md += `> 🟢 **이상 없음.** 자동 점검·복구가 정상 작동했고 조치할 항목이 없습니다.\n\n`;
  } else if (summary.overall === 'WARN') {
    md += `> 🟡 **주의 항목이 있습니다.** 자동 복구된 항목은 조치 불필요, 남은 WARN 은 아래 5장을 확인하세요.\n\n`;
  } else {
    md += `> 🔴 **미해결 이상 항목이 있습니다.** 자동 복구로 해결되지 않아 사람의 확인이 필요합니다(아래 4장).\n\n`;
  }

  md += `---\n\n## 1. 자동 복구 내역 (${repairs.length}건)\n\n`;
  if (!repairs.length) {
    md += `복구가 필요한 항목이 없었습니다.\n\n`;
  } else {
    md += `| # | 대상 | 동작 | 결과 | 재검증 | 상세 |\n| --- | --- | --- | --- | --- | --- |\n`;
    repairs.forEach((r, i) => {
      const status = r.status === 'applied' ? '✅ 적용' : r.status === 'failed' ? '❌ 실패' : '⏭️ 건너뜀';
      const verified = r.verified === true ? '✅ 개선 확인' : r.recovered ? '⚠️ 일부만 개선' : '—';
      md += `| ${i + 1} | ${r.target} | \`${r.action}\` | ${status} | ${verified} | ${String(r.detail || '').replace(/\|/g, '/').slice(0, 160)} |\n`;
    });
    md += `\n> 자동 복구는 캐시·상태·파생 보고서만 다룹니다. 근무일지·게시글 같은 **원본 데이터는 수정하지 않습니다.**\n\n`;
  }

  md += `---\n\n## 2. 데이터 변화 감지 (터미널 ${drift.length}곳)\n\n`;
  if (!drift.length) {
    md += `이번 실행에서는 터미널 수집 점검이 포함되지 않았습니다(환경에 따라 생략).\n\n`;
  } else {
    md += `| 터미널 | 이번 수집 | 기준선 | 변화율 | 판정 | 주요 감지 내용 |\n| --- | --- | --- | --- | --- | --- |\n`;
    for (const d of drift) {
      const change = d.changeRatio === null ? '—' : `${Math.round(d.changeRatio * 100)}%`;
      const findings = d.findings.length ? d.findings.map((f) => `\`${f.code}\``).join(' ') : '변화 없음';
      const after = d.after ? ` → 재검증 ${d.after.status}` : '';
      md += `| ${d.terminal.toUpperCase()} | ${d.current.count}척 | ${d.baseline ? `${d.baseline.count}척` : '신규'} | ${change} | ${statusLabel(d.status)}${after} | ${findings} |\n`;
    }
    md += `\n`;
    const noteworthy = drift.filter((d) => d.findings.some((f) => f.severity !== 'INFO'));
    if (noteworthy.length) {
      md += `### 감지 상세\n\n`;
      for (const d of noteworthy) {
        md += `- **${d.terminal.toUpperCase()}**\n`;
        for (const f of d.findings.filter((x) => x.severity !== 'INFO')) {
          md += `  - ${STATUS_EMOJI[f.severity] || 'ℹ️'} \`${f.code}\`: ${f.detail}\n`;
        }
      }
      md += `\n`;
    }
    const infoOnly = drift.filter((d) => d.findings.length && !d.findings.some((f) => f.severity !== 'INFO'));
    if (infoOnly.length) {
      md += `> ℹ️ 참고: ${infoOnly.map((d) => d.terminal.toUpperCase()).join(', ')} 는 새 필드/첫 관측만 감지되었습니다(정상 범위).\n\n`;
    }
  }

  md += `---\n\n## 3. 점검 항목 상세\n\n| # | 분야 | 항목 | 결과 | 소요 | 상세 |\n| --- | --- | --- | --- | --- | --- |\n`;
  let idx = 1;
  for (const c of checks) {
    const detail = String(c.detail || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 200);
    md += `| ${idx++} | ${c.category} | ${c.name} | ${statusLabel(c.status)} | ${c.durationMs ? `${c.durationMs}ms` : '—'} | ${detail} |\n`;
  }
  md += `\n---\n\n## 4. 분야별 요약\n\n| 분야 | PASS | WARN | FAIL | 합계 | 상태 |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const row of byCategory) {
    const state = row.fail > 0 ? '🔴 이상' : row.warn > 0 ? '🟡 주의' : '🟢 정상';
    md += `| ${row.category} | ${row.pass} | ${row.warn} | ${row.fail} | ${row.total} | ${state} |\n`;
  }
  md += `\n---\n\n## 5. ${summary.fail > 0 ? '조치 필요 / 에스컬레이션' : '확인 권장 항목'}\n\n`;
  if (!actionNeeded.length) {
    md += `조치 필요 항목 없음 — 모든 점검이 통과했습니다.\n\n`;
  } else {
    for (const c of actionNeeded) {
      md += `- ${STATUS_EMOJI[c.status]} **[${c.category}] ${c.name}** — ${c.detail}\n`;
    }
    md += `\n`;
  }
  md += `### 에스컬레이션\n\n`;
  md += `- 상태: ${escalation?.status === 'created' ? `✅ GitHub 이슈 생성${escalation.url ? ` (${escalation.url})` : ''}` : escalation?.status === 'failed' ? `❌ 실패 — ${escalation.error || escalation.detail || ''}` : `⏭️ 건너뜀${escalation?.detail ? ` — ${escalation.detail}` : ''}`}\n\n`;

  md += `---\n\n## 6. 운영 설정 이번 주 값\n\n`;
  md += `| 항목 | 값 |\n| --- | --- |\n`;
  md += `| 자동 점검 | ${config?.enabled ? 'ON' : 'OFF'} |\n`;
  md += `| 자동 복구 | ${config?.autoFix ? 'ON' : 'OFF'} |\n`;
  md += `| 재시도 횟수 | ${config?.retryAttempts}회 |\n`;
  md += `| 수집량 경고/실패 임계 | ${Math.round((config?.thresholds?.warnRatio ?? 0.5) * 100)}% / ${Math.round((config?.thresholds?.failRatio ?? 0.15) * 100)}% |\n`;
  md += `| 보고서 수신 | ${(config?.emailTo || []).join(', ')} (${config?.emailMode === 'alert' ? '이상 시에만' : '매주'}) |\n\n`;

  md += `---\n\n## 7. 참고\n\n`;
  md += `- 엔진: \`scripts/weekly-self-check.mjs\` (서버·CLI 공용, 판정 기준 단일)\n`;
  md += `- 스케줄: 매주 월요일 05:00 KST — Vercel Cron(\`/api/cron/weekly-self-check\`) · GitHub Actions · node-cron\n`;
  md += `- 수동 실행: \`npm run selfcheck\` · API: \`GET /api/cron/weekly-self-check\` (CRON_SECRET 인증)\n`;
  md += `- 공개 요약: \`GET /api/self-check-report\`\n`;
  md += `- 문의: 이춘학 (luxrank@gmail.com / 010-2846-8906)\n\n`;
  md += `---\n\n*© 2026 이춘학 — BUSAN HAK PORT INFO. All rights reserved.*\n`;
  return md;
}

export function buildWeeklySelfCheckSubject(result) {
  const verdict = VERDICT[result.summary.overall] || VERDICT.PASS;
  const parts = [`PASS ${result.summary.pass}/${result.summary.total}`];
  if (result.summary.warn) parts.push(`WARN ${result.summary.warn}`);
  if (result.summary.fail) parts.push(`FAIL ${result.summary.fail}`);
  if (result.summary.repaired) parts.push(`자동복구 ${result.summary.repaired}`);
  return `[주간자가점검] ${result.kstDate} ${SITE_LABEL} · ${verdict.label} (${parts.join(' · ')})`;
}

export function buildWeeklySelfCheckText(result) {
  const { summary } = result;
  const drift = result.drift || [];
  const repairs = result.repairs || [];
  const checks = result.checks || [];
  const escalation = result.escalation || { status: 'skipped', detail: null, url: null };
  const verdict = VERDICT[summary.overall] || VERDICT.PASS;
  const lines = [];
  lines.push(`${SITE_LABEL} — 주간 자가 점검 · 자가 복구 보고서`);
  lines.push('');
  lines.push(`■ 종합 판정: ${verdict.label} (${summary.overall}) — 통과율 ${summary.passRate}%`);
  lines.push(`점검 일시: ${result.kstDateTime} (${result.isoWeek})`);
  lines.push(`작업 종료: ${result.completedAt ? formatKstDateTimeFromIso(result.completedAt) : result.kstDateTime} (총 ${formatDuration(result.durationMs || 0)})`);
  lines.push(`실행 환경: ${result.platform}`);
  lines.push('발송 시점: **작업 종료 후** — 아래 단계를 모두 마친 뒤 이 메일을 보냅니다.');
  lines.push('');
  if (Array.isArray(result.steps) && result.steps.length) {
    lines.push('■ 진행 단계');
    result.steps.forEach((st, i) => {
      const mark = st.status === 'ok' ? '✔' : st.status === 'failed' ? '✘' : st.status === 'warn' ? '!' : '·';
      lines.push(`- ${mark} ${i + 1}. ${st.label}: ${st.status} (${formatDuration(st.durationMs)}) ${st.detail || ''}`.trimEnd());
    });
    lines.push('');
  }
  lines.push('■ 요약');
  lines.push(`- 전체 ${summary.total}건 / PASS ${summary.pass} / WARN ${summary.warn} / FAIL ${summary.fail}`);
  lines.push(`- 자동 복구 완료 ${summary.repaired}건, 복구 실패 ${summary.repairFailed}건`);
  lines.push('');
  if (repairs.length) {
    lines.push('■ 자동 복구 내역');
    for (const r of repairs) {
      const mark = r.status === 'applied' ? '✔' : r.status === 'failed' ? '✘' : '·';
      lines.push(`- ${mark} [${r.target}] ${r.action}: ${r.detail || ''}${r.verified ? ' (재검증 개선 확인)' : ''}`);
    }
    lines.push('');
  }
  if (drift.length) {
    lines.push('■ 터미널 데이터 변화 감지');
    for (const d of drift) {
      const change = d.changeRatio === null ? '-' : `${Math.round(d.changeRatio * 100)}%`;
      lines.push(`- ${d.terminal.toUpperCase()}: ${d.current.count}척 (기준선 ${d.baseline ? `${d.baseline.count}척` : '신규'}, 변화율 ${change}) — ${d.status}`);
      for (const f of d.findings.filter((x) => x.severity !== 'INFO')) lines.push(`    · ${f.code}: ${f.detail}`);
    }
    lines.push('');
  }
  const issues = checks.filter((c) => c.status !== 'PASS');
  lines.push(`■ ${issues.length ? `확인 필요 항목 (${issues.length}건)` : '확인 필요 항목'}`);
  if (!issues.length) lines.push('조치 필요 항목 없음 — 모든 항목 정상입니다.');
  else for (const c of issues.slice(0, 40)) lines.push(`- ${STATUS_EMOJI[c.status]} [${c.category}] ${c.name}: ${c.detail}`);
  lines.push('');
  lines.push('■ 에스컬레이션');
  lines.push(
    escalation?.status === 'created'
      ? `- GitHub 이슈 생성${escalation.url ? `: ${escalation.url}` : ''}`
      : escalation?.status === 'failed'
        ? `- 이슈 생성 실패: ${escalation.error || escalation.detail || ''}`
        : `- 건너뜀${escalation?.detail ? `: ${escalation.detail}` : ''}`
  );
  lines.push('');
  lines.push('■ 첨부');
  lines.push(`- weekly-self-check-${result.kstDate}.md : 전체 상세 보고서`);
  lines.push(`- weekly-self-check-${result.kstDate}.json : 기계 판독용(JSON)`);
  lines.push('');
  lines.push('※ 매주 월요일 05:00 KST 자동 생성 · 수동 실행: npm run selfcheck');
  lines.push('');
  lines.push('© 2026 이춘학 — BUSAN HAK PORT INFO. All rights reserved.');
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildWeeklySelfCheckHtml(result) {
  const { summary } = result;
  const checks = result.checks || [];
  const drift = result.drift || [];
  const repairs = result.repairs || [];
  const escalation = result.escalation || { status: 'skipped', detail: null, url: null };
  const verdict = VERDICT[summary.overall] || VERDICT.PASS;
  const rows = groupByCategory(checks);
  const issues = checks.filter((c) => c.status !== 'PASS');

  const categoryRows = rows
    .map((row, i) => {
      const bg = i % 2 === 0 ? '#fbfcfe' : '#ffffff';
      const state = row.fail > 0 ? '🔴' : row.warn > 0 ? '🟡' : '🟢';
      return `<tr style="background:${bg};"><td style="padding:8px 10px;border-bottom:1px solid #eceff5;">${escapeHtml(row.category)}</td><td align="center" style="border-bottom:1px solid #eceff5;">${row.pass}</td><td align="center" style="border-bottom:1px solid #eceff5;">${row.warn}</td><td align="center" style="border-bottom:1px solid #eceff5;">${row.fail}</td><td align="center" style="border-bottom:1px solid #eceff5;">${state}</td></tr>`;
    })
    .join('');

  const repairRows = repairs.length
    ? repairs
        .map((r) => {
          const mark = r.status === 'applied' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
          const verified = r.verified ? '✅ 개선 확인' : r.recovered ? '⚠️ 일부 개선' : '—';
          return `<tr><td style="padding:7px 9px;border-bottom:1px solid #eceff5;">${escapeHtml(r.target)}</td><td style="padding:7px 9px;border-bottom:1px solid #eceff5;font-family:Consolas,monospace;font-size:12px;">${escapeHtml(r.action)}</td><td align="center" style="border-bottom:1px solid #eceff5;">${mark} ${escapeHtml(r.status)}</td><td align="center" style="border-bottom:1px solid #eceff5;">${verified}</td><td style="padding:7px 9px;border-bottom:1px solid #eceff5;color:#5a6b86;font-size:12px;">${escapeHtml(String(r.detail || '').slice(0, 140))}</td></tr>`;
        })
        .join('')
    : `<tr><td colspan="5" style="padding:10px;color:#5a6b86;">복구가 필요한 항목이 없었습니다.</td></tr>`;

  const driftRows = drift.length
    ? drift
        .map((d) => {
          const change = d.changeRatio === null ? '—' : `${Math.round(d.changeRatio * 100)}%`;
          const color = d.status === 'FAIL' ? '#b3261e' : d.status === 'WARN' ? '#a46a21' : '#0b8043';
          return `<tr><td style="padding:7px 9px;border-bottom:1px solid #eceff5;font-weight:700;">${escapeHtml(d.terminal.toUpperCase())}</td><td align="center" style="border-bottom:1px solid #eceff5;">${d.current.count}</td><td align="center" style="border-bottom:1px solid #eceff5;">${d.baseline ? d.baseline.count : '신규'}</td><td align="center" style="border-bottom:1px solid #eceff5;">${change}</td><td align="center" style="border-bottom:1px solid #eceff5;color:${color};font-weight:700;">${STATUS_EMOJI[d.status]} ${escapeHtml(d.status)}</td></tr>`;
        })
        .join('')
    : '';

  const issueBlock = issues.length
    ? issues
        .slice(0, 40)
        .map(
          (c) =>
            `<li style="margin-bottom:6px;"><b>[${escapeHtml(c.category)}] ${escapeHtml(c.name)}</b> — ${escapeHtml(String(c.detail || '').slice(0, 220))}</li>`
        )
        .join('')
    : '<li>조치 필요 항목 없음 — 모든 항목이 정상입니다.</li>';

  const escalationLine =
    escalation?.status === 'created'
      ? `✅ GitHub 이슈 생성${escalation.url ? ` — <a href="${escapeHtml(escalation.url)}" style="color:#1a4fba;">${escapeHtml(escalation.url)}</a>` : ''}`
      : escalation?.status === 'failed'
        ? `❌ 이슈 생성 실패 — ${escapeHtml(escalation.error || escalation.detail || '')}`
        : `⏭️ 건너뜀${escalation?.detail ? ` — ${escapeHtml(escalation.detail)}` : ''}`;

  return `<div style="background:#eef2f8;padding:24px 12px;font-family:'Malgun Gothic','Apple SD Gothic Neo',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(10,27,63,0.08);">
    <tr><td style="background:linear-gradient(135deg,#0a1b3f,#1a4fba);padding:26px 28px;">
      <div style="color:#9fc0ff;font-size:12px;letter-spacing:2px;font-weight:700;">WEEKLY SELF-CHECK · AUTO-REPAIR</div>
      <div style="color:#ffffff;font-size:21px;font-weight:800;margin-top:6px;">주간 자가 점검 · 자가 복구 보고서</div>
      <div style="color:#c9d8f2;font-size:12px;margin-top:8px;">${escapeHtml(result.kstDateTime)} · ${escapeHtml(result.isoWeek)} · ${escapeHtml(result.platform)}</div>
      <div style="color:#9fc0ff;font-size:11px;margin-top:6px;">작업 종료 ${escapeHtml(result.completedAt ? formatKstDateTimeFromIso(result.completedAt) : result.kstDateTime)} · 총 ${escapeHtml(formatDuration(result.durationMs || 0))} — <b style="color:#ffffff;">모든 단계 완료 후 발송</b></div>
    </td></tr>
    <tr><td style="padding:22px 28px 4px 28px;">
      <div style="display:inline-block;background:${verdict.color === '#0b8043' ? '#e8f7ee' : verdict.color === '#a46a21' ? '#fff7e8' : '#fdeeee'};color:${verdict.color};font-weight:800;font-size:14px;padding:7px 14px;border-radius:999px;">${verdict.emoji} ${verdict.label} (${summary.overall})</div>
      <div style="color:#5a6b86;font-size:12px;margin-top:12px;line-height:1.8;">
        전체 ${summary.total}건 · ✅ PASS ${summary.pass} · ⚠️ WARN ${summary.warn} · ❌ FAIL ${summary.fail} · 🛠️ 자동 복구 ${summary.repaired}건 · 통과율 ${summary.passRate}%
      </div>
    </td></tr>
    ${
      Array.isArray(result.steps) && result.steps.length
        ? `<tr><td style="padding:18px 28px 0 28px;">
      <div style="font-size:15px;font-weight:800;color:#0a1b3f;border-left:4px solid #1a4fba;padding-left:10px;">0. 작업 타임라인 (종료 후 발송)</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse;font-size:12px;">
        <tr style="background:#0a1b3f;color:#ffffff;"><th align="left" style="padding:7px 9px;">단계</th><th align="center" style="padding:7px 9px;">상태</th><th align="right" style="padding:7px 9px;">소요</th><th align="left" style="padding:7px 9px;">상세</th></tr>
        ${result.steps
          .map((st, i) => {
            const mark = st.status === 'ok' ? '✅' : st.status === 'failed' ? '❌' : st.status === 'warn' ? '⚠️' : '⏭️';
            return `<tr><td style="padding:6px 9px;border-bottom:1px solid #eceff5;">${i + 1}. ${escapeHtml(st.label)}</td><td align="center" style="border-bottom:1px solid #eceff5;">${mark} ${escapeHtml(st.status)}</td><td align="right" style="border-bottom:1px solid #eceff5;color:#5a6b86;">${escapeHtml(formatDuration(st.durationMs))}</td><td style="border-bottom:1px solid #eceff5;color:#5a6b86;font-size:11px;">${escapeHtml(String(st.detail || '').slice(0, 100))}</td></tr>`;
          })
          .join('')}
      </table>
      <div style="color:#8b9bb4;font-size:11px;margin-top:8px;">모든 단계가 끝난 뒤 이 보고서를 발송합니다 — 같은 ISO 주차에는 1통만 도착합니다.</div>
    </td></tr>`
        : ''
    }
    <tr><td style="padding:18px 28px 0 28px;">
      <div style="font-size:15px;font-weight:800;color:#0a1b3f;border-left:4px solid #1a4fba;padding-left:10px;">1. 자동 복구 내역</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse;font-size:12px;">
        <tr style="background:#0a1b3f;color:#ffffff;"><th align="left" style="padding:8px 9px;">대상</th><th align="left" style="padding:8px 9px;">동작</th><th align="center" style="padding:8px 9px;">결과</th><th align="center" style="padding:8px 9px;">재검증</th><th align="left" style="padding:8px 9px;">상세</th></tr>
        ${repairRows}
      </table>
      <div style="color:#8b9bb4;font-size:11px;margin-top:8px;">※ 자동 복구는 캐시·상태·파생 보고서만 다룹니다. 근무일지·게시글 등 원본 데이터는 수정하지 않습니다.</div>
    </td></tr>
    ${
      drift.length
        ? `<tr><td style="padding:22px 28px 0 28px;">
      <div style="font-size:15px;font-weight:800;color:#0a1b3f;border-left:4px solid #1a4fba;padding-left:10px;">2. 터미널 데이터 변화 감지</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse;font-size:12px;">
        <tr style="background:#0a1b3f;color:#ffffff;"><th align="left" style="padding:8px 9px;">터미널</th><th align="center" style="padding:8px 9px;">이번 수집</th><th align="center" style="padding:8px 9px;">기준선</th><th align="center" style="padding:8px 9px;">변화율</th><th align="center" style="padding:8px 9px;">판정</th></tr>
        ${driftRows}
      </table>
    </td></tr>`
        : ''
    }
    <tr><td style="padding:22px 28px 0 28px;">
      <div style="font-size:15px;font-weight:800;color:#0a1b3f;border-left:4px solid ${issues.length ? '#b3261e' : '#0b8043'};padding-left:10px;">3. 확인 필요 항목 (${issues.length}건)</div>
      <ul style="margin:12px 0 0 0;padding-left:18px;color:#33415c;font-size:13px;line-height:1.7;">${issueBlock}</ul>
    </td></tr>
    <tr><td style="padding:18px 28px 0 28px;">
      <div style="font-size:13px;color:#5a6b86;line-height:1.9;"><b style="color:#0a1b3f;">에스컬레이션</b><br>${escalationLine}</div>
    </td></tr>
    <tr><td style="padding:18px 28px 0 28px;">
      <div style="font-size:15px;font-weight:800;color:#0a1b3f;border-left:4px solid #1a4fba;padding-left:10px;">4. 분야별 요약</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse;font-size:12px;">
        <tr style="background:#0a1b3f;color:#ffffff;"><th align="left" style="padding:8px 9px;">분야</th><th align="center" style="padding:8px 9px;">PASS</th><th align="center" style="padding:8px 9px;">WARN</th><th align="center" style="padding:8px 9px;">FAIL</th><th align="center" style="padding:8px 9px;">상태</th></tr>
        ${categoryRows}
      </table>
    </td></tr>
    <tr><td style="padding:22px 28px 24px 28px;border-top:1px solid #eceff5;">
      <div style="color:#5a6b86;font-size:12px;line-height:1.8;">
        전체 상세 보고서는 첨부 파일(weekly-self-check-${escapeHtml(result.kstDate)}.md / .json)에서 확인하세요.<br>
        매주 월요일 05:00 KST 자동 실행 · 수동: <code>npm run selfcheck</code> · API: <code>/api/cron/weekly-self-check</code>
      </div>
    </td></tr>
    <tr><td style="background:#f5f8fc;padding:14px 28px;">
      <div style="color:#8b9bb4;font-size:11px;line-height:1.7;">© 2026 이춘학 — BUSAN HAK PORT INFO. All rights reserved.<br>문의: luxrank@gmail.com / 010-2846-8906</div>
    </td></tr>
  </table>
</div>`;
}

export function buildWeeklySelfCheckEmail({ result, markdown = '', json = null, config }) {
  const attachments = [];
  const cfg = config || resolveSelfCheckConfig({});
  const attach = cfg.email?.attach !== false;
  if (attach && markdown) {
    attachments.push({
      filename: `weekly-self-check-${result.kstDate}.md`,
      content: Buffer.from(markdown, 'utf8').toString('base64'),
      contentType: 'text/markdown; charset=UTF-8',
    });
  }
  if (attach && json) {
    const jsonText = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
    attachments.push({
      filename: `weekly-self-check-${result.kstDate}.json`,
      content: Buffer.from(jsonText, 'utf8').toString('base64'),
      contentType: 'application/json; charset=UTF-8',
    });
  }
  return {
    subject: buildWeeklySelfCheckSubject(result),
    text: buildWeeklySelfCheckText(result),
    html: buildWeeklySelfCheckHtml(result),
    attachments,
    to: cfg.email?.to || [DEFAULT_SELF_CHECK_RECIPIENT],
    from: cfg.email?.from || '',
  };
}

/** 보고서 JSON 요약 (메일 첨부·API 응답 공용, 내부 데이터 최소화) */
export function buildSelfCheckJson(result) {
  return {
    version: result.version,
    generatedAt: result.generatedAt,
    startedAt: result.startedAt || null,
    completedAt: result.completedAt || null,
    durationMs: result.durationMs || 0,
    steps: (result.steps || []).map((st) => ({
      name: st.name,
      label: st.label,
      status: st.status,
      durationMs: st.durationMs,
      detail: st.detail,
      finishedAt: st.finishedAt,
    })),
    kstDate: result.kstDate,
    kstDateTime: result.kstDateTime,
    isoWeek: result.isoWeek,
    platform: result.platform,
    summary: result.summary,
    drift: (result.drift || []).map((d) => ({
      terminal: d.terminal,
      status: d.status,
      current: d.current?.count ?? 0,
      baseline: d.baseline?.count ?? null,
      changeRatio: d.changeRatio,
      findings: (d.findings || []).map((f) => ({ code: f.code, severity: f.severity, detail: f.detail })),
    })),
    repairs: (result.repairs || []).map((r) => ({
      target: r.target,
      action: r.action,
      status: r.status,
      detail: r.detail,
      verified: r.verified ?? null,
    })),
    escalation: result.escalation,
    checks: (result.checks || []).map((c) => ({
      id: c.id,
      category: c.category,
      name: c.name,
      status: c.status,
      detail: c.detail,
      code: c.code || null,
      durationMs: c.durationMs || 0,
    })),
    baseline: result.baseline,
  };
}

/**
 * 저장된 JSON(buildSelfCheckJson 결과)에서 메일·보고서 생성용 결과 객체를 복원합니다.
 * GitHub Actions 처럼 "점검 → 보고서 커밋 → 메일 발송" 을 단계로 나눠 실행할 때
 * 마지막 메일 단계가 앞 단계의 결과를 그대로 재사용하기 위한 함수입니다.
 *
 * @param {object} json buildSelfCheckJson 결과
 * @param {object} [config] resolveSelfCheckConfig(env) — 수신자·임계값 등 표시용
 */
export function rehydrateSelfCheckResult(json = {}, config = null) {
  const cfg = config || resolveSelfCheckConfig({});
  const drift = (json.drift || []).map((d) => ({
    terminal: d.terminal,
    status: d.status,
    findings: Array.isArray(d.findings) ? d.findings : [],
    current: { count: Number(d.current) || 0, fieldCoverage: {} },
    baseline: d.baseline === null || d.baseline === undefined ? null : { count: Number(d.baseline) || 0, fieldCoverage: {}, samples: 0 },
    changeRatio: d.changeRatio ?? null,
    error: null,
    after: d.after || null,
  }));
  return {
    version: json.version ?? SELF_CHECK_VERSION,
    skipped: Boolean(json.skipped),
    generatedAt: json.generatedAt || new Date().toISOString(),
    startedAt: json.startedAt || undefined,
    completedAt: json.completedAt || undefined,
    durationMs: Number(json.durationMs) || 0,
    kstDate: json.kstDate,
    kstDateTime: json.kstDateTime,
    isoWeek: json.isoWeek,
    platform: json.platform || 'cli',
    summary: json.summary,
    checks: json.checks || [],
    drift,
    repairs: json.repairs || [],
    escalation: json.escalation || { attempted: false, status: 'skipped', detail: null, url: null, error: null },
    steps: Array.isArray(json.steps) ? json.steps : [],
    baseline: json.baseline || { updated: false, terminals: 0 },
    config: publicConfig(cfg),
  };
}

/** 보고서 파일명 규칙 (CLI·서버 공용) */
export function weeklyReportPaths(kstDate) {
  return {
    markdown: `weekly-self-check-${kstDate}.md`,
    json: `weekly-self-check-${kstDate}.json`,
    docsMarkdown: `weekly-${kstDate}.md`,
  };
}

/** 점검 결과에서 기준선 파일 무결성 검사용 해시 (변경 감지·감사 추적) */
export function fingerprintReport(markdown) {
  return crypto.createHash('sha256').update(String(markdown || ''), 'utf8').digest('hex').slice(0, 16);
}

/**
 * 주간 자가 점검 보고서 메일 발송.
 * 전송 방식은 일일 점검과 동일한 단일 경로(Resend → Gmail API → SMTP)를 사용합니다.
 * 자격증명이 없으면 skipped 로 조용히 종료하며, 점검 결과 자체는 항상 유효합니다.
 *
 * @param {object} options
 * @param {object} options.result
 * @param {string} [options.markdown]
 * @param {object|string} [options.json]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {object|null} [options.nodemailer]
 * @param {{log?: Function, warn?: Function, error?: Function}} [options.logger]
 */
export async function sendWeeklySelfCheckEmail(options = {}) {
  const { result, markdown = '', json = null, env = process.env, fetchImpl = globalThis.fetch, nodemailer = null, logger = console } = options;
  const skip = (reason, transport = null) => ({ ok: false, skipped: true, reason, transport, messageId: null, error: null });

  if (!result || !result.summary) return skip('no_result');
  const config = resolveSelfCheckConfig(env);
  if (!config.email.enabled) return skip('disabled');
  const resolved = resolveMailTransport(env);
  if (!resolved.transport) return skip(resolved.reason || 'not_configured');
  if (config.email.mode === 'alert' && result.summary.overall === 'PASS') return skip('mode_alert_no_issue', resolved.transport);

  const message = buildWeeklySelfCheckEmail({ result, markdown, json, config });
  return sendReportEmailMessage({ message, env, fetchImpl, nodemailer, logger });
}
