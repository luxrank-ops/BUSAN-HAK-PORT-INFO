/**
 * scripts/work-log-schema.mjs 타입 선언
 * ─────────────────────────────────────────────────────────────────────────────
 * server.ts(TypeScript, moduleResolution: NodeNext)가 런타임 구현체(.mjs)를 그대로
 * 임포트하면서 `npm run typecheck` 를 통과하도록 타입만 제공합니다.
 * 구현과 선언이 어긋나면 CI(typecheck)가 실패하므로 시그니처 변경 시 함께 갱신하세요.
 */

export const WORK_LOG_WRITE_FIELDS: string[];
export const WORK_LOG_REQUIRED_KEYS: string[];

export interface WorkLogResolvedValue {
  value: string;
  source: 'field' | 'docId' | '';
}

export interface WorkLogDocInput {
  id?: string;
  docId?: string;
  data?: Record<string, any>;
  [key: string]: any;
}

export interface WorkLogCoverageSummary {
  total: number;
  missingCount: number;
  ratio: number;
  byField: { date: number; workerId: number };
  viaDocId: { date: number; workerId: number };
  samples: Array<{ id: string; missing: string[] }>;
}

export function splitWorkLogDocId(docId: string): { workerId: string; date: string };
export function resolveWorkLogDate(data?: Record<string, any>, docId?: string): WorkLogResolvedValue;
export function resolveWorkLogWorkerId(data?: Record<string, any>, docId?: string): WorkLogResolvedValue;
export function summarizeWorkLogCoverage(docs?: WorkLogDocInput[]): WorkLogCoverageSummary;
export function describeWorkLogMissingFields(summary: WorkLogCoverageSummary): string;
