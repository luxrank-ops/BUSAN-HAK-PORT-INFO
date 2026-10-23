/**
 * scripts/weekly-self-check.mjs 타입 선언
 * ─────────────────────────────────────────────────────────────────────────────
 * server.ts(TypeScript, moduleResolution: NodeNext)가 런타임 구현체(.mjs)를 그대로
 * 임포트하면서 `npm run typecheck` 를 통과하도록 타입만 제공합니다.
 * 구현과 선언이 어긋나면 CI(typecheck)가 실패하므로 시그니처 변경 시 함께 갱신하세요.
 */

import type { SendReportEmailResult } from './daily-report-mailer.mjs';

export type SelfCheckStatus = 'PASS' | 'WARN' | 'FAIL';
export type SelfCheckSeverity = 'info' | 'low' | 'medium' | 'high';

export interface SelfCheckThresholds {
  warnRatio: number;
  failRatio: number;
  coverageDropRatio: number;
}

export interface SelfCheckConfig {
  enabled: boolean;
  autoFix: boolean;
  retryAttempts: number;
  retryBackoffMs: number;
  historyLimit: number;
  probeTimeoutMs: number;
  thresholds: SelfCheckThresholds;
  email: {
    enabled: boolean;
    mode: 'always' | 'alert';
    to: string[];
    from: string;
    attach: boolean;
  };
  escalate: { token: string; repo: string };
}

export interface SelfCheckProbeOutcome {
  status: SelfCheckStatus;
  detail?: string;
  severity?: SelfCheckSeverity;
  code?: string | null;
  data?: any;
}

export interface SelfCheckProbe {
  id: string;
  category?: string;
  name?: string;
  kind?: 'feature' | 'terminal';
  target?: string;
  critical?: boolean;
  run: () => Promise<SelfCheckProbeOutcome> | SelfCheckProbeOutcome;
}

export interface SelfCheckCheck {
  id: string;
  category: string;
  name: string;
  kind: string;
  target: string | null;
  status: SelfCheckStatus;
  detail: string;
  severity: string;
  code: string | null;
  data: any;
  durationMs: number;
  recovered?: boolean;
}

export interface SelfCheckFinding {
  code: string;
  severity: SelfCheckStatus | 'INFO';
  detail: string;
}

export interface SelfCheckDrift {
  terminal: string;
  status: SelfCheckStatus;
  findings: SelfCheckFinding[];
  current: { count: number; fieldCoverage: Record<string, number> };
  baseline: { count: number; fieldCoverage: Record<string, number>; samples: number } | null;
  changeRatio: number | null;
  error: string | null;
  latencyMs?: number;
  after?: any;
  before?: any;
}

export interface SelfCheckRepair {
  id: string;
  rule: string;
  target: string;
  action: string;
  status: 'applied' | 'failed' | 'skipped';
  detail: string;
  durationMs?: number;
  at: string;
  verified?: boolean | null;
  recovered?: { count: number; fieldCoverage: Record<string, number> } | null;
}

export interface SelfCheckSummary {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  overall: SelfCheckStatus;
  repaired: number;
  repairFailed: number;
  unresolved: number;
  passRate: number;
}

export interface SelfCheckEscalation {
  attempted: boolean;
  status: 'skipped' | 'created' | 'failed';
  detail: string | null;
  url: string | null;
  error: string | null;
}

export interface SelfCheckBaseline {
  version: number;
  createdAt: string;
  updatedAt: string | null;
  terminals: Record<string, any>;
  runs: any[];
  lastRun?: any;
}

export interface SelfCheckStep {
  name: string;
  label: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'ok' | 'warn' | 'failed' | 'skipped' | string;
  detail?: string | null;
}

export interface SelfCheckResult {
  version: number;
  skipped?: boolean;
  reason?: string;
  generatedAt: string;
  startedAt?: string;
  completedAt?: string;
  kstDate: string;
  kstDateTime: string;
  dayName: string;
  isoWeek: string;
  platform: string;
  summary: SelfCheckSummary;
  steps?: SelfCheckStep[];
  checks: SelfCheckCheck[];
  drift: SelfCheckDrift[];
  repairs: SelfCheckRepair[];
  escalation: SelfCheckEscalation;
  baseline: { updated: boolean; terminals: number; runs?: number; saved?: boolean; saveError?: string };
  config: any;
  durationMs: number;
}

export interface SelfCheckRepairOutcome {
  ok?: boolean;
  detail?: string;
  recovered?: { count: number; fieldCoverage: Record<string, number> };
  url?: string | null;
}

export type SelfCheckAction = (context: any) => Promise<SelfCheckRepairOutcome> | SelfCheckRepairOutcome;

export interface RunWeeklySelfCheckOptions {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  config?: SelfCheckConfig;
  probes?: SelfCheckProbe[];
  baseline?: unknown;
  actions?: Record<string, SelfCheckAction>;
  saveBaseline?: (baseline: SelfCheckBaseline) => Promise<void> | void;
  platform?: string;
  logger?: { log?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
}

export declare const SELF_CHECK_VERSION: number;
export declare const DEFAULT_SELF_CHECK_RECIPIENT: string;
export declare const SITE_LABEL: string;
export declare const CORE_VESSEL_FIELDS: string[];
export declare const DEFAULT_DRIFT_THRESHOLDS: SelfCheckThresholds;
export declare const REPAIR_RULES: Record<
  string,
  { label: string; actions: string[]; stopOnFailure: Record<string, boolean> }
>;

export declare function getKstParts(now?: Date): { kstDate: string; kstDateTime: string; dayName: string; isoWeek: string };
export declare function resolveSelfCheckConfig(env?: NodeJS.ProcessEnv): SelfCheckConfig;
export declare function createEmptyBaseline(now?: Date): SelfCheckBaseline;
export declare function normalizeBaseline(raw: unknown, now?: Date): SelfCheckBaseline;
export declare function updateBaseline(
  baseline: unknown,
  observations?: Array<{ terminal: string; count: number; fieldCoverage?: Record<string, number>; at?: string }>,
  now?: Date,
  options?: { alpha?: number; limit?: number }
): { baseline: SelfCheckBaseline; updated: number };
export declare function analyzeTerminalDrift(input: {
  terminal: string;
  count: number;
  fieldCoverage?: Record<string, number>;
  error?: string | null;
  baseline?: unknown;
  thresholds?: Partial<SelfCheckThresholds>;
  config?: SelfCheckConfig;
}): SelfCheckDrift;
export declare function summarizeFindings(drift?: SelfCheckDrift[]): { total: number; warn: number; fail: number };
export declare function planRepairs(input: {
  checks?: SelfCheckCheck[];
  drift?: SelfCheckDrift[];
  baseline?: unknown;
  config?: SelfCheckConfig;
}): Array<{ id: string; rule: string; target: string; reason: string; actions: string[]; disabled?: boolean }>;
export declare function executeRepairs(input: {
  plan?: Array<{ id: string; rule: string; target: string; reason: string; actions: string[]; disabled?: boolean }>;
  actions?: Record<string, SelfCheckAction>;
  context?: any;
  config?: SelfCheckConfig;
  logger?: any;
}): Promise<SelfCheckRepair[]>;
export declare function applyRecoveries(input: {
  drift?: SelfCheckDrift[];
  checks?: SelfCheckCheck[];
  repairs?: SelfCheckRepair[];
  baseline?: unknown;
  thresholds?: Partial<SelfCheckThresholds>;
}): { drift: SelfCheckDrift[]; checks: SelfCheckCheck[]; fixed: number };
export declare function runWeeklySelfCheck(options?: RunWeeklySelfCheckOptions): Promise<SelfCheckResult>;
export declare function appendStep(
  result: SelfCheckResult | Record<string, any>,
  step?: Partial<SelfCheckStep> & { at?: string | Date }
): SelfCheckStep | null;
export declare function summarizeChecks(checks?: SelfCheckCheck[], repairs?: SelfCheckRepair[]): SelfCheckSummary;
export declare function generateWeeklySelfCheckMarkdown(result: SelfCheckResult): string;
export declare function buildWeeklySelfCheckSubject(result: SelfCheckResult): string;
export declare function buildWeeklySelfCheckText(result: SelfCheckResult): string;
export declare function buildWeeklySelfCheckHtml(result: SelfCheckResult): string;
export declare function buildWeeklySelfCheckEmail(options: {
  result: SelfCheckResult;
  markdown?: string;
  json?: object | string | null;
  config?: SelfCheckConfig;
}): { subject: string; text: string; html: string; attachments: Array<{ filename: string; content: string; contentType: string }>; to: string[]; from: string };
export declare function buildSelfCheckJson(result: SelfCheckResult): object;
export declare function rehydrateSelfCheckResult(json: any, config?: SelfCheckConfig): SelfCheckResult;
export declare function weeklyReportPaths(kstDate: string): { markdown: string; json: string; docsMarkdown: string };
export declare function fingerprintReport(markdown: string): string;
export declare function sendWeeklySelfCheckEmail(options: {
  result: SelfCheckResult;
  markdown?: string;
  json?: object | string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  nodemailer?: any;
  logger?: any;
}): Promise<SendReportEmailResult>;
