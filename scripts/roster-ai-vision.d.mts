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
    now?: Date;
    state?: { blockedUntil?: number };
}

export const ROSTER_AI_VISION_DEFAULT_MODEL: string;
export const ROSTER_AI_VISION_GENERATIVE_ENDPOINT: string;
export const ROSTER_AI_VISION_VERTEX_LOCATION_DEFAULT: string;
export const ROSTER_AI_VISION_TIMEOUT_MS: number;
export const ROSTER_AI_VISION_FAILURE_COOLDOWN_MS: number;
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
export function runRosterAiVisionRequest(options?: RosterAiVisionRequestOptions): Promise<RosterAiVisionSuccess | RosterAiVisionFailure>;
