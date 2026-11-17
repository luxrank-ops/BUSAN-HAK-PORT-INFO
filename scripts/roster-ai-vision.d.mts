export interface RosterAiVisionEntry {
    date: string;
    vessel: string;
    time: string;
    company: string;
    support: string;
    group: string;
    note: string;
    workers: string[];
    sourceOcrLine: string;
    sourceOcrVessel: string;
    sourceWorkerCount: number;
    source: string;
}

export interface RosterAiVisionAttempt {
    provider: string;
    model?: string;
    status: number;
    error: string;
}

export interface RosterAiVisionSuccess {
    ok: true;
    provider: string;
    model: string;
    entries: RosterAiVisionEntry[];
    warnings: string[];
    workerCount: number;
    text: string;
    attempts: RosterAiVisionAttempt[];
}

export interface RosterAiVisionFailure {
    ok: false;
    reason: string;
    model: string;
    attempts: RosterAiVisionAttempt[];
}

export interface RosterAiVisionRequestOptions {
    imageBase64?: string;
    imageMimeType?: string;
    referenceBase64?: string;
    referenceMimeType?: string;
    defaultYear?: number;
    defaultDate?: string;
    thinkingBudget?: number | string;
    env?: Record<string, string | undefined>;
    fetchImpl?: (url: string, init: any) => Promise<any>;
    getAccessToken?: () => Promise<string | null | undefined>;
    projectId?: string;
    now?: Date;
    state?: { blockedUntil?: number };
    /** 이 요청 전체에 쓸 수 있는 시간(ms) — 넘으면 다음 모델 시도 없이 기존 판독으로 내려갑니다. */
    totalBudgetMs?: number;
    /** 5xx 재시도 간격(ms) 목록 — 테스트에서 0 으로 줄일 때 씁니다. */
    retryDelaysMs?: number[];
    models?: string[];
}

export const ROSTER_AI_VISION_DEFAULT_MODEL: string;
export const ROSTER_AI_VISION_GENERATIVE_ENDPOINT: string;
export const ROSTER_AI_VISION_VERTEX_LOCATION_DEFAULT: string;
export const ROSTER_AI_VISION_TIMEOUT_MS: number;
export const ROSTER_AI_VISION_FALLBACK_MODELS: string[];
export const ROSTER_AI_VISION_TOTAL_BUDGET_MS: number;
export const ROSTER_AI_VISION_RETRY_DELAYS_MS: number[];
export const ROSTER_AI_VISION_FAILURE_COOLDOWN_MS: number;
export const ROSTER_AI_VISION_TRANSIENT_COOLDOWN_MS: number;
export const ROSTER_AI_VISION_QUOTA_COOLDOWN_MS: number;
export function classifyRosterAiVisionFailure(attempts: RosterAiVisionAttempt[]): 'quota_exceeded' | 'transient_unavailable' | 'request_failed';
export const ROSTER_AI_VISION_RESPONSE_SCHEMA: Record<string, unknown>;

export function buildRosterAiVisionInstruction(options?: { defaultDate?: string; defaultYear?: number }): string;
export function buildRosterAiVisionRequestBody(options?: RosterAiVisionRequestOptions): Record<string, unknown>;
export function extractRosterAiVisionText(payload: unknown): string;
export function parseRosterAiVisionJson(text: string): Record<string, any> | null;
export function normalizeRosterAiDate(value: unknown, options?: { defaultDate?: string; now?: Date }): string;
export function normalizeRosterAiTime(value: unknown): string;
export function normalizeRosterAiVesselName(value: unknown): string;
export function normalizeRosterAiWorkerName(value: unknown): string;
export function normalizeRosterAiVisionResult(
    payload: unknown,
    options?: { defaultDate?: string; defaultYear?: number; now?: Date }
): { entries: RosterAiVisionEntry[]; warnings: string[]; workerCount: number; text: string };
export function buildRosterAiVisionText(rows: RosterAiVisionEntry[]): string;
export function hasRosterAiVisionCredential(env?: Record<string, string | undefined>): boolean;
export function resolveRosterAiVisionModel(env?: Record<string, string | undefined>): string;
export function resolveRosterAiVisionModels(env?: Record<string, string | undefined>): string[];
export function runRosterAiVisionRequest(options?: RosterAiVisionRequestOptions): Promise<RosterAiVisionSuccess | RosterAiVisionFailure>;
