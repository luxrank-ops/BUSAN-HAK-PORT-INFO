import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getKstParts,
  resolveSelfCheckConfig,
  createEmptyBaseline,
  normalizeBaseline,
  updateBaseline,
  analyzeTerminalDrift,
  planRepairs,
  executeRepairs,
  applyRecoveries,
  runWeeklySelfCheck,
  summarizeChecks,
  generateWeeklySelfCheckMarkdown,
  buildWeeklySelfCheckSubject,
  buildWeeklySelfCheckEmail,
  buildSelfCheckJson,
  rehydrateSelfCheckResult,
  appendStep,
  buildWeeklySelfCheckText,
  buildWeeklySelfCheckHtml,
  sendWeeklySelfCheckEmail,
  DEFAULT_SELF_CHECK_RECIPIENT,
  REPAIR_RULES,
} from './weekly-self-check.mjs';

const HEALTHY_COVERAGE = { VSL_NM: 1, ETB: 1, ATD: 1 };
const WEEK_START = new Date('2026-10-26T20:00:00Z'); // 2026-10-27 (화) 05:00 KST

function baselineWith(terminals = {}) {
  return {
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    terminals,
    runs: [],
  };
}

// ── 1. 날짜·주차 ────────────────────────────────────────────────────────────
test('getKstParts: KST 날짜와 ISO 주차를 계산한다', () => {
  const parts = getKstParts(new Date('2026-10-26T20:00:00Z')); // UTC 일요일 20:00 → KST 월요일 05:00
  assert.equal(parts.kstDate, '2026-10-27');
  assert.equal(parts.dayName, '화');
  assert.match(parts.kstDateTime, /^2026-10-27 \(화\) 05:00:00 KST$/);
  assert.equal(parts.isoWeek, '2026-W44');
});

// ── 2. 설정 ─────────────────────────────────────────────────────────────────
test('resolveSelfCheckConfig: 기본값은 켜짐·자동복구·luxrank 수신', () => {
  const config = resolveSelfCheckConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.autoFix, true);
  assert.deepEqual(config.email.to, [DEFAULT_SELF_CHECK_RECIPIENT]);
  assert.equal(DEFAULT_SELF_CHECK_RECIPIENT, 'luxrank@gmail.com');
  assert.equal(config.email.mode, 'always');
  assert.equal(config.thresholds.warnRatio, 0.5);
  assert.equal(config.thresholds.failRatio, 0.15);
});

test('resolveSelfCheckConfig: 환경변수 override 와 비활성 스위치', () => {
  const config = resolveSelfCheckConfig({
    SELF_CHECK_ENABLED: '0',
    SELF_CHECK_AUTO_FIX: 'false',
    SELF_CHECK_EMAIL_TO: 'a@example.com, b@example.com',
    SELF_CHECK_EMAIL_MODE: 'alert',
    SELF_CHECK_DRIFT_WARN_RATIO: '0.7',
    SELF_CHECK_DRIFT_FAIL_RATIO: '0.3',
    SELF_CHECK_RETRY_ATTEMPTS: '9',
    SELF_CHECK_PROBE_TIMEOUT_MS: '1',
  });
  assert.equal(config.enabled, false);
  assert.equal(config.autoFix, false);
  assert.deepEqual(config.email.to, ['a@example.com', 'b@example.com']);
  assert.equal(config.email.mode, 'alert');
  assert.equal(config.thresholds.warnRatio, 0.7);
  assert.equal(config.thresholds.failRatio, 0.3);
  assert.equal(config.retryAttempts, 4, '재시도는 1~4 범위로 제한');
  assert.equal(config.probeTimeoutMs, 3000, '타임아웃은 최소 3초');
});

test('resolveSelfCheckConfig: SELF_CHECK_EMAIL_TO 가 없으면 REPORT_EMAIL_TO 를 따른다', () => {
  const config = resolveSelfCheckConfig({ REPORT_EMAIL_TO: 'ops@example.com' });
  assert.deepEqual(config.email.to, ['ops@example.com']);
});

// ── 3. 기준선 ───────────────────────────────────────────────────────────────
test('normalizeBaseline: 없거나 손상된 기준선은 빈 기준선으로 복구', () => {
  const empty = createEmptyBaseline(new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(empty.terminals, {});
  assert.equal(normalizeBaseline(null).version, 1);
  const corrupted = normalizeBaseline('{not json');
  assert.deepEqual(corrupted.terminals, {});
  const fromString = normalizeBaseline(JSON.stringify(baselineWith({ hjnc: { count: 5 } })));
  assert.equal(fromString.terminals.hjnc.count, 5);
});

test('updateBaseline: EWMA 로 갱신하고 0척 관측은 기준선을 끌어내리지 않는다', () => {
  const base = baselineWith({ hjnc: { count: 10, fieldCoverage: HEALTHY_COVERAGE, samples: 3, history: [] } });
  const { baseline, updated } = updateBaseline(
    base,
    [
      { terminal: 'hjnc', count: 20, fieldCoverage: HEALTHY_COVERAGE },
      { terminal: 'bnct', count: 0, fieldCoverage: {} },
    ],
    new Date('2026-10-27T00:00:00Z'),
    { alpha: 0.5, limit: 8 }
  );
  assert.equal(updated, 2);
  assert.equal(baseline.terminals.hjnc.count, 15, '(10 + 20) / 2');
  assert.equal(baseline.terminals.bnct.count, 0);
  assert.equal(baseline.terminals.bnct.samples, 0, '0척은 표본으로 세지 않는다');
  assert.equal(baseline.terminals.hjnc.history.length, 1);
  assert.equal(baseline.updatedAt, '2026-10-27T00:00:00.000Z');
});

test('updateBaseline: 이력은 limit 개까지만 보관', () => {
  let base = baselineWith({ hjnc: { count: 10, fieldCoverage: HEALTHY_COVERAGE, samples: 0, history: [] } });
  for (let i = 0; i < 12; i += 1) {
    base = updateBaseline(base, [{ terminal: 'hjnc', count: 10 + i }], new Date(), { limit: 3 }).baseline;
  }
  assert.equal(base.terminals.hjnc.history.length, 3);
});

// ── 4. 데이터 변화 감지 ─────────────────────────────────────────────────────
test('analyzeTerminalDrift: 첫 관측은 INFO, 실패는 FAIL', () => {
  const first = analyzeTerminalDrift({ terminal: 'hjnc', count: 7, fieldCoverage: HEALTHY_COVERAGE });
  assert.equal(first.status, 'PASS');
  assert.ok(first.findings.some((f) => f.code === 'baseline_new'));

  const failed = analyzeTerminalDrift({ terminal: 'hjnc', count: 0, error: 'timeout' });
  assert.equal(failed.status, 'FAIL');
  assert.ok(failed.findings.some((f) => f.code === 'fetch_failed'));
});

test('analyzeTerminalDrift: 수집량 급감은 WARN/FAIL 로 판정', () => {
  const base = baselineWith({ hjnc: { count: 10, fieldCoverage: HEALTHY_COVERAGE, samples: 4 } });
  const warn = analyzeTerminalDrift({ terminal: 'hjnc', count: 4, fieldCoverage: HEALTHY_COVERAGE, baseline: base });
  assert.equal(warn.status, 'WARN');
  assert.equal(warn.changeRatio, 0.4);
  assert.ok(warn.findings.some((f) => f.code === 'count_drop_warn'));

  const fail = analyzeTerminalDrift({ terminal: 'hjnc', count: 1, fieldCoverage: HEALTHY_COVERAGE, baseline: base });
  assert.equal(fail.status, 'FAIL');
  assert.ok(fail.findings.some((f) => f.code === 'count_drop_fail'));
});

test('analyzeTerminalDrift: 핵심 필드 채움률 급락(파서 구조 변경)을 FAIL 로 잡는다', () => {
  const base = baselineWith({ pnc: { count: 8, fieldCoverage: HEALTHY_COVERAGE, samples: 5 } });
  const drift = analyzeTerminalDrift({
    terminal: 'pnc',
    count: 8,
    fieldCoverage: { VSL_NM: 1, ETB: 0, ATD: 1 },
    baseline: base,
  });
  assert.equal(drift.status, 'FAIL');
  assert.ok(drift.findings.some((f) => f.code === 'field_coverage_drop'));
});

test('analyzeTerminalDrift: 새 필드 등장은 INFO 로만 기록', () => {
  const base = baselineWith({ dgt: { count: 5, fieldCoverage: { ...HEALTHY_COVERAGE }, samples: 3 } });
  const drift = analyzeTerminalDrift({
    terminal: 'dgt',
    count: 5,
    fieldCoverage: { ...HEALTHY_COVERAGE, NEW_FIELD: 1 },
    baseline: base,
  });
  assert.equal(drift.status, 'PASS');
  assert.ok(drift.findings.some((f) => f.code === 'field_added' && f.severity === 'INFO'));
});

// ── 5. 복구 계획·실행 ───────────────────────────────────────────────────────
test('planRepairs: 드리프트 → 터미널 복구 규칙, autoFix=0 이면 비활성 표시', () => {
  const drift = [{ terminal: 'hjnc', status: 'FAIL', findings: [{ code: 'zero_rows', severity: 'FAIL' }] }];
  const plan = planRepairs({ drift, config: resolveSelfCheckConfig({}) });
  const item = plan.find((p) => p.rule === 'terminal_recover');
  assert.ok(item);
  assert.deepEqual(item.actions, REPAIR_RULES.terminal_recover.actions);

  const disabled = planRepairs({ drift, config: resolveSelfCheckConfig({ SELF_CHECK_AUTO_FIX: '0' }) });
  assert.equal(disabled.find((p) => p.rule === 'terminal_recover').disabled, true);
});

test('planRepairs: DB 정리 지연·보고서 누락도 복구 대상에 포함', () => {
  const plan = planRepairs({
    checks: [
      { code: 'automation.cleanup_overdue', status: 'WARN', category: '자동화', name: 'DB 정리' },
      { code: 'report.missing', status: 'WARN', category: '보고서', name: '산출물' },
    ],
    config: resolveSelfCheckConfig({}),
  });
  assert.ok(plan.some((p) => p.rule === 'cleanup_overdue'));
  assert.ok(plan.some((p) => p.rule === 'report_missing'));
});

test('executeRepairs: 실패한 동작 이후 중단하고 결과를 감사 기록으로 남긴다', async () => {
  const plan = [
    { id: 'terminal:hjnc', rule: 'terminal_recover', target: 'hjnc', reason: 'zero_rows', actions: ['reset-terminal-health', 'retry-terminal', 'rebuild-schedule-cache'] },
  ];
  const calls = [];
  const results = await executeRepairs({
    plan,
    logger: { log() {}, warn() {} },
    actions: {
      'reset-terminal-health': async () => ({ ok: true, detail: 'reset' }),
      'retry-terminal': async () => {
        calls.push('retry');
        return { ok: false, detail: '재시도 실패' };
      },
      'rebuild-schedule-cache': async () => {
        calls.push('rebuild');
        return { ok: true, detail: '재구축' };
      },
    },
  });
  assert.deepEqual(calls, ['retry'], 'retry-terminal 실패 시 rebuild 는 건너뛴다');
  assert.equal(results.find((r) => r.action === 'reset-terminal-health').status, 'applied');
  assert.equal(results.find((r) => r.action === 'retry-terminal').status, 'failed');
  assert.equal(results.some((r) => r.action === 'rebuild-schedule-cache'), false);
});

test('applyRecoveries: 재검증으로 개선된 경우에만 복구 성공으로 인정', () => {
  const base = baselineWith({ hjnc: { count: 10, fieldCoverage: HEALTHY_COVERAGE, samples: 4 } });
  const drift = [analyzeTerminalDrift({ terminal: 'hjnc', count: 0, baseline: base })];
  const checks = [{ id: 'terminal.hjnc', kind: 'terminal', target: 'hjnc', category: '터미널 데이터', name: 'HJNC', status: 'FAIL', detail: '0척' }];
  const repairs = [
    { target: 'hjnc', action: 'retry-terminal', status: 'applied', detail: 'ok', recovered: { count: 9, fieldCoverage: HEALTHY_COVERAGE } },
  ];
  const patched = applyRecoveries({ drift, checks, repairs, baseline: base });
  assert.equal(patched.fixed, 1);
  assert.equal(patched.drift[0].status, 'PASS');
  assert.equal(patched.checks[0].status, 'PASS');
  assert.equal(patched.checks[0].recovered, true);
  assert.equal(repairs[0].verified, true);
});

test('applyRecoveries: 부분 개선(FAIL→WARN)은 개선으로 인정하되 상태는 그대로 반영', () => {
  const base = baselineWith({ hjnc: { count: 10, fieldCoverage: HEALTHY_COVERAGE, samples: 4 } });
  const drift = [analyzeTerminalDrift({ terminal: 'hjnc', count: 0, baseline: base })];
  const checks = [{ id: 'terminal.hjnc', kind: 'terminal', target: 'hjnc', category: '터미널 데이터', name: 'HJNC', status: 'FAIL', detail: '0척' }];
  const repairs = [{ target: 'hjnc', action: 'retry-terminal', status: 'applied', detail: 'partial', recovered: { count: 2, fieldCoverage: HEALTHY_COVERAGE } }];
  const patched = applyRecoveries({ drift, checks, repairs, baseline: base });
  assert.equal(patched.fixed, 1);
  assert.equal(patched.drift[0].status, 'WARN', '기준선 20% 수준은 WARN 으로 개선(FAIL → WARN)');
});

// ── 6. 전체 실행 ────────────────────────────────────────────────────────────
test('runWeeklySelfCheck: 자동 복구 후 재검증까지 한 번에 수행하고 기준선을 저장한다', async () => {
  const baseline = baselineWith({
    hjnc: { count: 10, fieldCoverage: HEALTHY_COVERAGE, samples: 4 },
    bnct: { count: 6, fieldCoverage: HEALTHY_COVERAGE, samples: 4 },
  });
  const saved = [];
  const result = await runWeeklySelfCheck({
    now: WEEK_START,
    config: resolveSelfCheckConfig({}),
    baseline,
    platform: 'test',
    logger: { log() {}, warn() {}, error() {} },
    probes: [
      { id: 'feature.ok', category: '기능', name: '정상 기능', run: async () => ({ status: 'PASS', detail: 'ok' }) },
      {
        id: 'feature.broken',
        category: '기능',
        name: '고장 기능',
        run: async () => ({ status: 'FAIL', detail: 'broken' }),
      },
      {
        id: 'terminal.hjnc',
        category: '터미널 데이터',
        name: 'HJNC 수집',
        kind: 'terminal',
        target: 'hjnc',
        run: async () => ({ status: 'PASS', data: { count: 10, fieldCoverage: HEALTHY_COVERAGE } }),
      },
      {
        id: 'terminal.bnct',
        category: '터미널 데이터',
        name: 'BNCT 수집',
        kind: 'terminal',
        target: 'bnct',
        run: async () => ({ status: 'FAIL', detail: '소스 차단', data: { count: 0, fieldCoverage: {}, error: '소스 차단' } }),
      },
    ],
    actions: {
      'reset-terminal-health': async () => ({ ok: true, detail: 'reset' }),
      'retry-terminal': async () => ({ ok: true, detail: '재수집 성공', recovered: { count: 5, fieldCoverage: HEALTHY_COVERAGE } }),
      'rebuild-schedule-cache': async () => ({ ok: true, detail: 'cache rebuilt' }),
    },
    saveBaseline: async (next) => saved.push(next),
  });

  const bnctCheck = result.checks.find((c) => c.id === 'terminal.bnct');
  assert.equal(bnctCheck.status, 'PASS', '복구 후 재검증으로 PASS 로 개선');
  assert.equal(bnctCheck.recovered, true);
  assert.equal(result.summary.repaired, 1);
  assert.equal(result.summary.fail, 1, '복구할 수 없는 기능 FAIL 은 그대로 남는다');
  assert.equal(result.summary.overall, 'FAIL');
  assert.equal(saved.length, 1, '다음 주 비교를 위한 기준선 저장');
  assert.equal(result.baseline.terminals, 2);
  assert.equal(result.kstDate, '2026-10-27');
  assert.equal(result.isoWeek, '2026-W44');

  // 보고서
  const markdown = generateWeeklySelfCheckMarkdown(result);
  assert.match(markdown, /주간 자가 점검 · 자가 복구 보고서/);
  assert.match(markdown, /자동 복구 내역/);
  assert.match(markdown, /데이터 변화 감지/);
  assert.match(markdown, /고장 기능/);
  const subject = buildWeeklySelfCheckSubject(result);
  assert.match(subject, /^\[주간자가점검\] 2026-10-27/);
  assert.match(subject, /자동복구 1/);

  const json = buildSelfCheckJson(result);
  assert.equal(json.summary.repaired, 1);
  assert.equal(json.drift.length, 2);
  assert.ok(Array.isArray(json.repairs));
});

test('runWeeklySelfCheck: SELF_CHECK_ENABLED=0 이면 아무 것도 하지 않고 skipped', async () => {
  const result = await runWeeklySelfCheck({
    now: WEEK_START,
    config: resolveSelfCheckConfig({ SELF_CHECK_ENABLED: '0' }),
    probes: [],
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(result.summary.total, 0);
});

test('runWeeklySelfCheck: 기준선 저장 실패도 보고서를 막지 않는다', async () => {
  const result = await runWeeklySelfCheck({
    now: WEEK_START,
    config: resolveSelfCheckConfig({}),
    probes: [{ id: 'x', category: '기능', name: 'x', run: async () => ({ status: 'PASS' }) }],
    saveBaseline: async () => {
      throw new Error('disk full');
    },
    logger: { log() {}, warn() {}, error() {} },
  });
  assert.equal(result.baseline.saved, false);
  assert.match(result.baseline.saveError, /disk full/);
  assert.equal(result.summary.overall, 'PASS');
});

test('runWeeklySelfCheck: probe 예외는 FAIL 로 기록하고 계속 진행한다', async () => {
  const result = await runWeeklySelfCheck({
    now: WEEK_START,
    config: resolveSelfCheckConfig({}),
    probes: [
      { id: 'boom', category: '기능', name: '예외 항목', run: async () => { throw new Error('unexpected'); } },
      { id: 'ok', category: '기능', name: '정상 항목', run: async () => ({ status: 'PASS' }) },
    ],
  });
  assert.equal(result.checks.find((c) => c.id === 'boom').status, 'FAIL');
  assert.match(result.checks.find((c) => c.id === 'boom').detail, /unexpected/);
  assert.equal(result.checks.find((c) => c.id === 'ok').status, 'PASS');
});

test('runWeeklySelfCheck: 미해결 FAIL 은 에스컬레이션 동작으로 인계된다', async () => {
  let escalated = null;
  const result = await runWeeklySelfCheck({
    now: WEEK_START,
    config: resolveSelfCheckConfig({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'owner/repo' }),
    probes: [{ id: 'bad', category: '기능', name: '고장', run: async () => ({ status: 'FAIL', detail: 'x' }) }],
    actions: {
      'escalate-github-issue': async (ctx) => {
        escalated = ctx;
        return { ok: true, detail: '이슈 생성', url: 'https://github.com/owner/repo/issues/1' };
      },
    },
  });
  assert.ok(escalated, '에스컬레이션 컨텍스트 전달');
  assert.equal(escalated.checks.length, 1);
  assert.equal(result.escalation.status, 'created');
  assert.match(result.escalation.url, /issues\/1$/);
});

test('runWeeklySelfCheck: 자격증명이 없으면 에스컬레이션은 건너뛰고 사유를 남긴다', async () => {
  const result = await runWeeklySelfCheck({
    now: WEEK_START,
    config: resolveSelfCheckConfig({}),
    probes: [{ id: 'bad', category: '기능', name: '고장', run: async () => ({ status: 'FAIL', detail: 'x' }) }],
  });
  assert.equal(result.escalation.status, 'skipped');
  assert.match(result.escalation.detail, /GITHUB_TOKEN/);
});

test('summarizeChecks: 복구된 항목은 WARN 으로 집계해 사람이 알 수 있게 한다', () => {
  const summary = summarizeChecks(
    [
      { status: 'PASS' },
      { status: 'PASS', recovered: true },
    ],
    [{ status: 'applied', verified: true }]
  );
  assert.equal(summary.repaired, 1);
  assert.equal(summary.overall, 'WARN');
});

// ── 7. 메일 ─────────────────────────────────────────────────────────────────
test('buildWeeklySelfCheckEmail: 기본 수신자는 luxrank@gmail.com 이고 md/json 을 첨부', () => {
  const result = {
    kstDate: '2026-10-27',
    kstDateTime: '2026-10-27 (화) 05:00:00 KST',
    isoWeek: '2026-W44',
    platform: 'vercel-serverless',
    summary: { total: 3, pass: 3, warn: 0, fail: 0, overall: 'PASS', repaired: 0, repairFailed: 0, unresolved: 0, passRate: 100 },
    checks: [{ id: 'x', category: '기능', name: 'x', status: 'PASS', detail: 'ok' }],
    drift: [],
    repairs: [],
    escalation: { attempted: false, status: 'skipped', detail: null, url: null, error: null },
    baseline: { updated: true, terminals: 8 },
    config: {},
  };
  const message = buildWeeklySelfCheckEmail({ result, markdown: '# report', json: { a: 1 } });
  assert.deepEqual(message.to, ['luxrank@gmail.com']);
  assert.equal(message.attachments.length, 2);
  assert.equal(message.attachments[0].filename, 'weekly-self-check-2026-10-27.md');
  assert.match(message.text, /자동 복구/);
  assert.match(message.html, /주간 자가 점검/);
});

test('sendWeeklySelfCheckEmail: 자격증명이 없으면 skipped 로 조용히 종료', async () => {
  const outcome = await sendWeeklySelfCheckEmail({
    result: { summary: { overall: 'PASS', warn: 0, fail: 0 } },
    env: {},
    logger: { log() {}, warn() {}, error() {} },
  });
  assert.equal(outcome.skipped, true);
  assert.equal(outcome.reason, 'not_configured');
});

test('sendWeeklySelfCheckEmail: Resend 설정 시 luxrank@gmail.com 으로 실제 발송 요청', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, json: async () => ({ id: 'msg_1' }), text: async () => '' };
  };
  const result = {
    kstDate: '2026-10-27',
    kstDateTime: '2026-10-27 (화) 05:00:00 KST',
    isoWeek: '2026-W44',
    platform: 'vercel-serverless',
    summary: { total: 1, pass: 1, warn: 0, fail: 0, overall: 'PASS', repaired: 0, repairFailed: 0, unresolved: 0, passRate: 100 },
    checks: [],
    drift: [],
    repairs: [],
    escalation: { status: 'skipped' },
    baseline: { updated: true, terminals: 0 },
    config: {},
  };
  const outcome = await sendWeeklySelfCheckEmail({
    result,
    markdown: '# report',
    json: { ok: true },
    env: { RESEND_API_KEY: 're_test', REPORT_EMAIL_FROM: 'report@example.com', SELF_CHECK_EMAIL_TO: 'luxrank@gmail.com' },
    fetchImpl,
    logger: { log() {}, warn() {}, error() {} },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.transport, 'resend');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.resend\.com/);
  assert.deepEqual(calls[0].body.to, ['luxrank@gmail.com']);
  assert.match(calls[0].body.subject, /주간자가점검/);
});

test('sendWeeklySelfCheckEmail: mode=alert 이면 PASS 주에는 보내지 않는다', async () => {
  const outcome = await sendWeeklySelfCheckEmail({
    result: { summary: { overall: 'PASS', warn: 0, fail: 0 } },
    env: { RESEND_API_KEY: 're_test', REPORT_EMAIL_FROM: 'r@example.com', SELF_CHECK_EMAIL_MODE: 'alert' },
    fetchImpl: async () => {
      throw new Error('호출되면 안 됩니다');
    },
    logger: { log() {}, warn() {}, error() {} },
  });
  assert.equal(outcome.skipped, true);
  assert.equal(outcome.reason, 'mode_alert_no_issue');
});

test('sendWeeklySelfCheckEmail: 발송 실패는 점검 결과를 훼손하지 않고 error 로 보고', async () => {
  const outcome = await sendWeeklySelfCheckEmail({
    result: { summary: { overall: 'WARN', warn: 1, fail: 0 } },
    env: { RESEND_API_KEY: 're_test', REPORT_EMAIL_FROM: 'r@example.com' },
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized', json: async () => ({}) }),
    logger: { log() {}, warn() {}, error() {} },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.skipped, false);
  assert.match(outcome.error, /401/);
});

// ── 8. 판정 병합 ────────────────────────────────────────────────────────────
test('runWeeklySelfCheck: 수집은 성공했지만 품질 경고(stale 캐시)면 WARN 을 유지한다', async () => {
  const result = await runWeeklySelfCheck({
    now: WEEK_START,
    config: resolveSelfCheckConfig({}),
    baseline: baselineWith({ hjnc: { count: 10, fieldCoverage: HEALTHY_COVERAGE, samples: 3 } }),
    probes: [
      {
        id: 'terminal.hjnc',
        category: '터미널 데이터',
        name: 'HJNC 수집',
        kind: 'terminal',
        target: 'hjnc',
        run: async () => ({
          status: 'WARN',
          code: 'terminal.stale_cache',
          detail: 'stale 캐시 폴백',
          data: { count: 10, fieldCoverage: HEALTHY_COVERAGE },
        }),
      },
    ],
    // 이 실행 환경에는 복구 동작이 없다고 가정 → 판정이 그대로 남는지 확인
    actions: {},
    logger: { log() {}, warn() {}, error() {} },
  });
  assert.equal(result.drift[0].status, 'WARN', 'stale 캐시는 데이터 변화가 아니어도 경고로 남는다');
  assert.ok(result.drift[0].findings.some((f) => f.code === 'terminal.stale_cache'));
  assert.ok(result.repairs.length >= 1, 'stale 이면 캐시 갱신 복구를 시도한다');
  assert.equal(result.repairs[0].status, 'skipped', '복구 동작이 없으면 건너뜀으로 감사 기록');
});

// ── 9. 작업 종료 후 발송 · 타임라인 ──────────────────────────────────────────
test('appendStep: 단계 기록이 누적되고 완료 시각이 갱신된다', () => {
  const result = { generatedAt: '2026-10-27T00:00:00.000Z' };
  appendStep(result, { name: 'probes', label: '기능 점검', status: 'ok', durationMs: 1200, detail: '16건' });
  appendStep(result, { name: 'email', label: '보고서 메일 발송 (작업 종료 후)', status: 'ok', detail: 'luxrank@gmail.com' });
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].durationMs, 1200);
  assert.equal(result.steps[1].name, 'email');
  assert.ok(result.completedAt);
});

test('runWeeklySelfCheck: 단계 타임라인을 결과에 남긴다(기능→변화→복구→재검증→기준선)', async () => {
  const result = await runWeeklySelfCheck({
    now: WEEK_START,
    config: resolveSelfCheckConfig({}),
    probes: [{ id: 'x', category: '기능', name: 'x', run: async () => ({ status: 'PASS' }) }],
    saveBaseline: async () => {},
  });
  const names = result.steps.map((s) => s.name);
  assert.deepEqual(names, ['probes', 'drift', 'repairs', 'recheck', 'baseline']);
  assert.ok(result.startedAt && result.completedAt);
  assert.ok(result.durationMs >= 0);
  const md = generateWeeklySelfCheckMarkdown(result);
  assert.match(md, /## 0-1\. 작업 타임라인 \(작업 종료 후 발송\)/);
  assert.match(md, /모든 단계가 끝난 뒤/);
  assert.ok(buildSelfCheckJson(result).steps.length === 5);
});

test('rehydrateSelfCheckResult: 저장된 JSON 을 메일 발송용 결과로 복원한다', () => {
  const original = {
    version: 1,
    generatedAt: '2026-10-27T00:00:00.000Z',
    startedAt: '2026-10-27T00:00:00.000Z',
    completedAt: '2026-10-27T00:01:00.000Z',
    durationMs: 60000,
    kstDate: '2026-10-27',
    kstDateTime: '2026-10-27 (화) 05:00:00 KST',
    isoWeek: '2026-W44',
    platform: 'github-actions',
    summary: { total: 2, pass: 2, warn: 0, fail: 0, overall: 'PASS', repaired: 1, repairFailed: 0, unresolved: 0, passRate: 100 },
    checks: [{ id: 'a', category: '기능', name: 'a', status: 'PASS', detail: 'ok' }],
    drift: [{ terminal: 'hjnc', status: 'WARN', current: 8, baseline: 10, changeRatio: 0.8, findings: [{ code: 'count_drop_warn', severity: 'WARN', detail: '감소' }] }],
    repairs: [{ target: 'hjnc', action: 'retry-terminal', status: 'applied', detail: 'ok', verified: true }],
    escalation: { attempted: false, status: 'skipped', detail: null, url: null, error: null },
    baseline: { updated: true, terminals: 8 },
    steps: [{ name: 'probes', label: '기능 점검', status: 'ok', durationMs: 10, detail: '2건' }],
  };
  const restored = rehydrateSelfCheckResult(original);
  assert.equal(restored.isoWeek, '2026-W44');
  assert.equal(restored.drift[0].current.count, 8);
  assert.equal(restored.drift[0].baseline.count, 10);
  assert.equal(restored.steps.length, 1);
  assert.equal(restored.completedAt, original.completedAt);
  // 복원된 결과로 메일·보고서를 그대로 만들 수 있어야 합니다.
  const message = buildWeeklySelfCheckEmail({ result: restored, markdown: '# r', json: original });
  assert.match(message.subject, /2026-10-27/);
  assert.match(message.text, /작업 종료/);
  assert.match(generateWeeklySelfCheckMarkdown(restored), /주간 자가 점검/);
});

test('메일 본문/HTML 에 발송 시점·타임라인이 표시된다', () => {
  const result = {
    kstDate: '2026-10-27',
    kstDateTime: '2026-10-27 (화) 05:00:00 KST',
    isoWeek: '2026-W44',
    platform: 'vercel-serverless',
    completedAt: '2026-10-27T00:02:00.000Z',
    durationMs: 120000,
    summary: { total: 2, pass: 2, warn: 0, fail: 0, overall: 'PASS', repaired: 0, repairFailed: 0, unresolved: 0, passRate: 100 },
    checks: [],
    drift: [],
    repairs: [],
    escalation: { attempted: false, status: 'skipped', detail: null, url: null, error: null },
    baseline: { updated: true, terminals: 8 },
    steps: [
      { name: 'probes', label: '기능 점검', status: 'ok', durationMs: 1000, detail: '16건' },
      { name: 'email', label: '보고서 메일 발송 (작업 종료 후)', status: 'ok', durationMs: 200, detail: 'luxrank@gmail.com (smtp)' },
    ],
    config: { emailTo: ['luxrank@gmail.com'], emailMode: 'always', enabled: true, autoFix: true, retryAttempts: 2, thresholds: { warnRatio: 0.5, failRatio: 0.15 } },
  };
  const text = buildWeeklySelfCheckText(result);
  assert.match(text, /발송 시점: \*\*작업 종료 후\*\*/);
  assert.match(text, /1\. 기능 점검: ok/);
  const html = buildWeeklySelfCheckHtml(result);
  assert.match(html, /작업 타임라인/);
  assert.match(html, /모든 단계 완료 후 발송/);
});
