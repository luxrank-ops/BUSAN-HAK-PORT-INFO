// scripts/pc-visitor-report.mjs 공용 타입 선언 — server.ts(API)와 CLI 가 같은 집계 로직을 씁니다.

export interface VisitorLogLike {
  id?: string;
  ip?: string;
  device?: string;
  userAgent?: string;
  country?: string;
  region?: string;
  city?: string;
  locationLabel?: string;
  dateKey?: string;
  accessedAtMs?: number;
  accessedAt?: string;
}

export interface VisitorDayBucket {
  dateKey: string;
  count: number;
  uniqueIp: number;
}

export interface VisitorLocationBucket {
  label: string;
  count: number;
  uniqueIp: number;
}

export interface VisitorLogSummary {
  totalCount: number;
  uniqueIp: number;
  byDay: VisitorDayBucket[];
  byLocation: VisitorLocationBucket[];
  topLocation: VisitorLocationBucket | null;
}

export function kstDateKey(ms?: number): string;
export function kstDayStartMs(dateKey: string): number;
export function buildDayWindow(days: number, nowMs?: number): { dateKeys: string[]; sinceMs: number; days: number };
export function formatDayLabel(dateKey: string): string;
export function formatKstDateTime(ms?: number): string;
export function maskIp(ip?: string): string;
export function buildLocationLabel(log: { country?: unknown; region?: unknown; city?: unknown }): string;
export function localizeVisitorLocation(log: { country?: unknown; region?: unknown; city?: unknown }): {
  country: string;
  region: string;
  city: string;
};
export function summarizeVisitorLogs(logs: VisitorLogLike[], dateKeys: string[]): VisitorLogSummary;
export function buildCsv(logs: VisitorLogLike[], options?: { maskIps?: boolean }): string;
export function buildMarkdown(options: {
  logs: VisitorLogLike[];
  summary?: VisitorLogSummary;
  days: number;
  dateKeys: string[];
  generatedAt?: number;
  device?: string;
  maskIps?: boolean;
  source?: string;
  dailyPcDeviceCounts?: Record<string, number> | null;
}): string;
export function buildDemoLogs(nowMs?: number): VisitorLogLike[];
