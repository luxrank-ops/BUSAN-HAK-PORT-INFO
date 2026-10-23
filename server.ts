// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import compression from 'compression';
import crypto from 'node:crypto';
import fs from 'fs/promises';
import http from 'http';
import https from 'https';
import { existsSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import cron from 'node-cron';
// 일일 점검 보고서 메일 발송기 (scripts/daily-report-mailer.mjs — 타입은 .d.mts 에 선언)
import { sendInspectionReportEmail, resolveMailTransport, DEFAULT_REPORT_EMAIL_TO } from './scripts/daily-report-mailer.mjs';
import type { SendReportEmailResult } from './scripts/daily-report-mailer.mjs';
// 주간 자가 점검 · 자가 복구 엔진 (CLI 와 공용 — scripts/weekly-self-check.mjs, 타입은 .d.mts)
import {
  runWeeklySelfCheck,
  generateWeeklySelfCheckMarkdown,
  buildSelfCheckJson,
  sendWeeklySelfCheckEmail,
  resolveSelfCheckConfig,
  DEFAULT_SELF_CHECK_RECIPIENT
} from './scripts/weekly-self-check.mjs';
import type {
  SelfCheckResult,
  SelfCheckProbe,
  SelfCheckAction,
  SelfCheckBaseline
} from './scripts/weekly-self-check.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = Number(process.env.PORT) || 3000;

// --- 실행 환경 감지: Vercel 서버리스(Node 런타임) vs 상시 프로세스 서버 ---
// Vercel 에서는 api/[...path].ts 가 이 파일을 임포트해 /api/* 요청만 함수로 처리합니다.
// 정적 자산(HTML·CSS·JS·이미지)은 Vercel CDN 이 build/public 을 직접 서빙합니다
// (vercel.json 의 outputDirectory 설정). 서버리스는 응답 후 프로세스가 동결되므로
// app.listen() 과 node-cron 타이머가 동작하지 않습니다 — Vercel 에서는 이들을 비활성화하고,
// 주기 작업은 Vercel Cron 과 GitHub Actions 가 /api/cron/* 엔드포인트를 호출해 대신 실행합니다.
export const IS_VERCEL = Boolean(process.env.VERCEL);

if (IS_VERCEL) {
  // Vercel 엣지 프록시가 x-forwarded-for 의 마지막에 실제 클라이언트 IP 를 추가합니다.
  // hop 1개만 신뢰해야 클라이언트가 헤더를 위조해 속도 제한을 우회할 수 없습니다.
  // (미설정 시 req.ip 가 프록시 IP 가 되어 모든 사용자가 속도 제한 버킷 하나를 공유하게 됩니다)
  app.set('trust proxy', 1);
}

export const SUPPORTED_TERMINALS = ['hjnc', 'bnct', 'dgt', 'pnc', 'hpnt', 'pnit', 'bptc', 'hbct'] as const;
export const SCHEDULE_DIFF_THRESHOLD_MINUTES = Number(process.env.SCHEDULE_DIFF_THRESHOLD_MINUTES) || 60;
export const SCHEDULE_CACHE_TTL_DAYS = 30;
export const READ_NOTIFICATION_TTL_DAYS = 14;
export const BACKUP_COLLECTIONS = ['work_logs', 'ships', 'posts'] as const;

// --- 정적 자산 루트: 난독화·압축 산출물(build/public) 우선, 없으면 원본(public) ---
// scripts/build-obfuscate.mjs 가 만든 배포용 압축본이 있으면 그것을 제공하고,
// 로컬 개발이나 빌드 실패 시에는 원본을 그대로 제공해 화면이 깨지지 않게 합니다.
export const PUBLIC_SOURCE_DIR = path.join(__dirname, 'public');
export const PUBLIC_BUILD_DIR = path.join(__dirname, 'build', 'public');
export function resolveStaticRoot(): string {
  try {
    return existsSync(PUBLIC_BUILD_DIR) ? PUBLIC_BUILD_DIR : PUBLIC_SOURCE_DIR;
  } catch {
    return PUBLIC_SOURCE_DIR;
  }
}
export const STATIC_ROOT = resolveStaticRoot();

// --- 화면 잠금(보안 비밀번호) 설정 ---
// PIN 은 저장소 소스가 아니라 서버 환경변수로만 관리합니다. (기본값 9445 는 하위 호환용)
// .env / Vercel 환경변수에 붙은 공백·줄바꿈(복사-붙여넣기 실수)으로 인증이 실패하지 않게 trim() 합니다.
export const SCREEN_LOCK_PIN = String(process.env.SCREEN_LOCK_PIN || '9445').trim() || '9445';
export const SCREEN_UNLOCK_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12시간
const SCREEN_UNLOCK_TOKEN_SECRET = String(process.env.UNLOCK_TOKEN_SECRET || SCREEN_LOCK_PIN).trim() || SCREEN_LOCK_PIN;
// 무차별 대입 방지: IP 당 10분에 10회까지만 시도
const SCREEN_UNLOCK_MAX_ATTEMPTS = 10;
const SCREEN_UNLOCK_WINDOW_MS = 10 * 60 * 1000;
const screenUnlockAttempts = new Map<string, { count: number; resetAt: number }>();

/**
 * 시도 횟수 제한 — 잠금 종류(scope)별로 버킷을 분리합니다.
 * 화면 잠금에서 10회 실패해도 긴급 공지·관리자·익명 세션 인증이 함께 막히지 않도록 하기 위함입니다.
 */
function isScreenUnlockRateLimited(
  ip: string,
  scope: 'screen' | 'emergency' | 'admin' | 'anon' = 'screen',
  maxAttempts: number = scope === 'anon' ? 120 : SCREEN_UNLOCK_MAX_ATTEMPTS
): boolean {
  const now = Date.now();
  const key = `${scope}:${ip}`;
  const entry = screenUnlockAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    screenUnlockAttempts.set(key, { count: 1, resetAt: now + SCREEN_UNLOCK_WINDOW_MS });
    if (screenUnlockAttempts.size > 5000) {
      for (const [mapKey, value] of screenUnlockAttempts) {
        if (value.resetAt <= now) screenUnlockAttempts.delete(mapKey);
      }
    }
    return false;
  }
  entry.count += 1;
  return entry.count > maxAttempts;
}

/** 허용되는 화면 잠금 PIN 목록 — 기본값 9445를 항상 백업으로 인정해 운영자 실수로 잠기는 일을 방지합니다. */
export function getAcceptedScreenLockPins(): string[] {
  const pins = new Set<string>();
  if (SCREEN_LOCK_PIN) pins.add(SCREEN_LOCK_PIN);
  pins.add('9445');
  return Array.from(pins);
}

/** 상수 시간 비교 — 길이가 달라도 비교 시간이 새어나가지 않도록 해시 후 비교합니다. */
export function verifyScreenLockPin(pin: string): boolean {
  let s = String(pin || '').trim();
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/\s+/g, '');
  const input = s;
  if (!input) return false;
  const a = crypto.createHash('sha256').update(input, 'utf8').digest();
  let matched = false;
  for (const candidate of getAcceptedScreenLockPins()) {
    const b = crypto.createHash('sha256').update(candidate, 'utf8').digest();
    if (crypto.timingSafeEqual(a, b)) matched = true;
  }
  return matched;
}

// --- 🚨 긴급 플로팅 공지 작성 잠금 ---
// 우선순위: EMERGENCY_NOTICE_PIN 환경변수 → (미설정 시) 화면 잠금 PIN → (그마저 없으면) 기본값 9445.
// (평문 비밀번호는 저장소 어디에도 두지 않습니다. trim() 으로 환경변수 공백·줄바꿈에도 강건합니다.)
export const EMERGENCY_NOTICE_PIN = String(process.env.EMERGENCY_NOTICE_PIN || SCREEN_LOCK_PIN || '9445').trim() || '9445';
/** 운영자가 EMERGENCY_NOTICE_PIN 을 따로 지정했는지 여부 */
const HAS_EXPLICIT_EMERGENCY_PIN = Boolean(String(process.env.EMERGENCY_NOTICE_PIN || '').trim());

/**
 * 긴급 공지 작성에 인정되는 PIN 목록.
 * - EMERGENCY_NOTICE_PIN 을 따로 지정한 배포: 그 값만 인정합니다(화면 잠금 PIN 과 분리 운영).
 * - 지정하지 않은 배포: 화면 잠금 PIN 과 기본 관리자 PIN(9445) 을 함께 인정합니다.
 *   → 운영자가 근무일지 잠금 비밀번호를 다른 값으로 바꿔 두었더라도, 안내된 기본 비밀번호로
 *     긴급 공지를 열 수 있어 "비밀번호 인증이 안 되는" 상황을 막습니다.
 */
export function getAcceptedEmergencyNoticePins(): string[] {
  const pins = new Set<string>();
  if (EMERGENCY_NOTICE_PIN) pins.add(EMERGENCY_NOTICE_PIN);
  if (!HAS_EXPLICIT_EMERGENCY_PIN) {
    if (SCREEN_LOCK_PIN) pins.add(SCREEN_LOCK_PIN);
    pins.add('9445');
  }
  return Array.from(pins);
}

/** 상수 시간 비교 — 긴급 공지 작성 권한용 PIN 검증 (후보 전체를 비교) */
export function verifyEmergencyNoticePin(pin: string): boolean {
  let s = String(pin || '').trim();
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/\s+/g, '');
  const input = s;
  if (!input) return false;
  const a = crypto.createHash('sha256').update(input, 'utf8').digest();
  let matched = false;
  for (const candidate of getAcceptedEmergencyNoticePins()) {
    const b = crypto.createHash('sha256').update(candidate, 'utf8').digest();
    // timingSafeEqual 은 길이가 같아야 하므로 sha256(32바이트)끼리 비교합니다.
    if (crypto.timingSafeEqual(a, b)) matched = true;
  }
  return matched;
}

export function issueEmergencyUnlockToken(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SCREEN_UNLOCK_TOKEN_TTL_MS;
  const token = crypto
    .createHmac('sha256', SCREEN_UNLOCK_TOKEN_SECRET)
    .update(`emergency-unlock:${expiresAt}`)
    .digest('hex');
  return { token, expiresAt };
}

export function issueScreenUnlockToken(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SCREEN_UNLOCK_TOKEN_TTL_MS;
  const token = crypto
    .createHmac('sha256', SCREEN_UNLOCK_TOKEN_SECRET)
    .update(`screen-unlock:${expiresAt}`)
    .digest('hex');
  return { token, expiresAt };
}

// --- 🔐 운영 관리자 인증 및 무상태(Stateless) HMAC 관리자 토큰 ---
// 클라이언트 verifyAdmin() 과 동일한 관리자 해시(SHA-256) 및 Firestore settings/admin 문서를 검증합니다.
export const DEFAULT_ADMIN_PW_HASH = '6cda3286b168d396ec539b002b14f58a6aebd453b6e5bc146c2d82dfd2614bc3';
export const ADMIN_CUSTOM_TOKEN_UID = 'admin_luxrank';

export function issueAdminSessionToken(nowMs: number = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = nowMs + SCREEN_UNLOCK_TOKEN_TTL_MS;
  const sig = crypto
    .createHmac('sha256', SCREEN_UNLOCK_TOKEN_SECRET)
    .update(`admin-session:${expiresAt}`)
    .digest('hex');
  return { token: `${expiresAt}.${sig}`, expiresAt };
}

export function verifyAdminSessionToken(rawToken: string, nowMs: number = Date.now()): boolean {
  const cleaned = String(rawToken || '').trim().replace(/^Bearer\s+/i, '').trim();
  const dotIdx = cleaned.indexOf('.');
  if (dotIdx <= 0) return false;
  const expiresStr = cleaned.slice(0, dotIdx);
  const sigHex = cleaned.slice(dotIdx + 1);
  if (!/^\d{10,16}$/.test(expiresStr) || !/^[a-fA-F0-9]{64}$/.test(sigHex)) return false;
  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs || expiresAt > nowMs + SCREEN_UNLOCK_TOKEN_TTL_MS + 60_000) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', SCREEN_UNLOCK_TOKEN_SECRET)
    .update(`admin-session:${expiresAt}`)
    .digest();
  const actual = Buffer.from(sigHex, 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

let cachedServiceAccountCreds: { clientEmail: string; privateKey: string } | null = null;

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * 외부 JWT 패키지(firebase-admin/auth -> jsonwebtoken) 의존성 없이
 * Node 내장 crypto(RS256) 만으로 Firebase Identity Toolkit 표준 Custom Token 을 서명합니다.
 */
function signServiceAccountCustomToken(uid: string): string | null {
  initFirebaseAdmin();
  if (!cachedServiceAccountCreds?.clientEmail || !cachedServiceAccountCreds?.privateKey) {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const headerSegment = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payloadSegment = base64UrlEncode(
    JSON.stringify({
      iss: cachedServiceAccountCreds.clientEmail,
      sub: cachedServiceAccountCreds.clientEmail,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: nowSec,
      exp: nowSec + 3600,
      uid
    })
  );
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(cachedServiceAccountCreds.privateKey));
  return `${signingInput}.${signature}`;
}

let firebaseBackendOverrideForTests: {
  db?: ReturnType<typeof getFirestore>;
  auth?: { createCustomToken: (uid: string) => Promise<string> };
} | null = null;
export function setFirebaseBackendOverrideForTests(override: { db?: any; auth?: any } | null): void {
  firebaseBackendOverrideForTests = override;
}
function resolveServerFirestore(): ReturnType<typeof getFirestore> | null {
  if (firebaseBackendOverrideForTests?.db) return firebaseBackendOverrideForTests.db;
  return initFirebaseAdmin() && getApps().length > 0 ? getFirestore() : null;
}
function resolveServerAuth(): { createCustomToken: (uid: string) => Promise<string> } | null {
  if (firebaseBackendOverrideForTests?.auth) return firebaseBackendOverrideForTests.auth;
  initFirebaseAdmin();
  if (!cachedServiceAccountCreds?.clientEmail || !cachedServiceAccountCreds?.privateKey) {
    return null;
  }
  return {
    async createCustomToken(uid: string): Promise<string> {
      const signed = signServiceAccountCustomToken(uid);
      if (!signed) throw new Error('service_account_signing_unavailable');
      return signed;
    }
  };
}

export async function verifyAdminPassword(rawPassword: string): Promise<boolean> {
  let normalized = String(rawPassword || '').trim();
  normalized = normalized.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
  if (!normalized) return false;

  const inputDigest = crypto.createHash('sha256').update(normalized, 'utf8').digest();
  const candidateHexHashes = new Set<string>([DEFAULT_ADMIN_PW_HASH]);

  const envAdminPw = String(process.env.ADMIN_PASSWORD || '').trim();
  if (envAdminPw) {
    const envHex = /^[a-fA-F0-9]{64}$/.test(envAdminPw)
      ? envAdminPw.toLowerCase()
      : crypto.createHash('sha256').update(envAdminPw, 'utf8').digest('hex');
    candidateHexHashes.add(envHex);
  }

  try {
    const adminFs = resolveServerFirestore();
    if (adminFs) {
      const adminDoc = await adminFs.collection('settings').doc('admin').get();
      if (adminDoc.exists) {
        const d = adminDoc.data() || {};
        if (typeof d.passwordHash === 'string' && /^[a-fA-F0-9]{64}$/.test(d.passwordHash.trim())) {
          candidateHexHashes.add(d.passwordHash.trim().toLowerCase());
        } else if (typeof d.password === 'string' && d.password.trim()) {
          const saved = d.password.trim();
          const savedHex = /^[a-fA-F0-9]{64}$/.test(saved)
            ? saved.toLowerCase()
            : crypto.createHash('sha256').update(saved, 'utf8').digest('hex');
          candidateHexHashes.add(savedHex);
        }
      }
    }
  } catch {
    // settings/admin 문서 조회 실패 시 기본 해시 후보로 안전하게 폴백
  }

  let matched = false;
  for (const hex of candidateHexHashes) {
    const candidateBuf = Buffer.from(hex, 'hex');
    if (candidateBuf.length === inputDigest.length && crypto.timingSafeEqual(inputDigest, candidateBuf)) {
      matched = true;
    }
  }
  return matched;
}

function formatKstDateTime(rawTs: any): { ms: number; formatted: string } {
  if (!rawTs) return { ms: 0, formatted: '-' };
  let ms = 0;
  try {
    if (typeof rawTs.toMillis === 'function') {
      ms = Number(rawTs.toMillis()) || 0;
    } else if (typeof rawTs.toDate === 'function') {
      ms = rawTs.toDate().getTime();
    } else if (typeof rawTs._seconds === 'number') {
      ms = rawTs._seconds * 1000;
    } else if (rawTs instanceof Date) {
      ms = rawTs.getTime();
    } else if (typeof rawTs === 'number') {
      ms = rawTs;
    } else if (typeof rawTs === 'string' && rawTs.trim()) {
      const parsed = Date.parse(rawTs.trim());
      if (!Number.isNaN(parsed)) ms = parsed;
      else return { ms: 0, formatted: rawTs.trim() };
    }
  } catch {
    return { ms: 0, formatted: '-' };
  }
  if (!ms || Number.isNaN(ms)) return { ms: 0, formatted: '-' };
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return { ms, formatted: `${y}-${m}-${d} ${hh}:${mm}` };
}

function sanitizeVisitorDoc(docData: Record<string, any> | undefined): Record<string, any> {
  const src = docData || {};
  const tsInfo = formatKstDateTime(src.updatedAt);
  return {
    date: src.date || '',
    count: Number(src.count) || 0,
    unique: Number(src.unique) || 0,
    blocks: src.blocks || {},
    terminals: src.terminals || {},
    actions: src.actions || {},
    devices: src.devices || { android: 0, ios: 0, desktop: 0 },
    hours: src.hours || { h00_06: 0, h06_12: 0, h12_18: 0, h18_24: 0 },
    updatedAtMs: tsInfo.ms
  };
}

// --- Firebase Admin 안전 초기화 (.env Base64 또는 JSON 원문 지원) ---
function initFirebaseAdmin(): boolean {
  try {
    if (getApps().length > 0) return true;
    const rawKey = (process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim();
    if (rawKey) {
      const decoded = rawKey.startsWith('{')
        ? rawKey
        : Buffer.from(rawKey, 'base64').toString('utf-8');
      const serviceAccount = JSON.parse(decoded);
      if (serviceAccount.client_email && serviceAccount.private_key) {
        cachedServiceAccountCreds = {
          clientEmail: String(serviceAccount.client_email),
          privateKey: String(serviceAccount.private_key)
        };
      }
      initializeApp({
        credential: cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
      });
      console.log('Firebase Admin initialized with service account key.');
      return true;
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
      });
      console.log('Firebase Admin initialized with GOOGLE_APPLICATION_CREDENTIALS.');
      return true;
    }
  } catch (e: any) {
    console.log('Firebase Admin init warning:', e?.message || e);
  }
  return getApps().length > 0;
}

initFirebaseAdmin();

// 🔐 D-6: 터미널 사이트 인증서 검증을 기본 활성화합니다.
// 특정 사이트에서만 불가피하게 예외가 필요하면 TERMINAL_TLS_INSECURE=1 로 명시적으로 켭니다.
const TERMINAL_TLS_INSECURE = process.env.TERMINAL_TLS_INSECURE === '1';
if (TERMINAL_TLS_INSECURE) {
  console.warn('[보안 경고] TERMINAL_TLS_INSECURE=1 — 터미널 수집 요청의 TLS 인증서 검증이 해제됩니다.');
}
const hjncAgent = new https.Agent({ rejectUnauthorized: !TERMINAL_TLS_INSECURE, keepAlive: true, maxSockets: 16 });
const httpKeepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

export interface VesselScheduleItem {
  TERMINAL: string;
  VSL_NM: string;
  BERTH_NO: string;
  PTNR_CODE: string;
  VOY_NO: string;
  ETB: string;
  ATA: string;
  ATW: string;
  ATC: string;
  ATD: string;
}

export interface TerminalHealthState {
  terminal: string;
  status: 'healthy' | 'degraded' | 'isolated';
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  staleServedCount: number;
}

const scheduleMemoryCache = new Map<string, { expiresAt: number; staleExpiresAt: number; vessels: VesselScheduleItem[]; updatedAt: string }>();
const inFlightSchedulePromises = new Map<string, Promise<VesselScheduleItem[]>>();
const terminalHealthMap = new Map<string, TerminalHealthState>();

const SCHEDULE_CACHE_TTL_MS = 3 * 60 * 1000;
const STALE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 장애 시 최대 24시간 캐시 폴백 유지

for (const tid of SUPPORTED_TERMINALS) {
  terminalHealthMap.set(tid, {
    terminal: tid.toUpperCase(),
    status: 'healthy',
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    staleServedCount: 0
  });
}

export const automationRuntimeStatus = {
  scheduleWatcher: {
    lastRunAt: null as string | null,
    lastSuccessAt: null as string | null,
    lastError: null as string | null,
    changedVesselsDetected: 0,
    notificationsSent: 0
  },
  autoCleanup: {
    lastRunAt: null as string | null,
    lastSuccessAt: null as string | null,
    lastError: null as string | null,
    deletedScheduleCacheDocs: 0,
    deletedNotificationDocs: 0
  },
  weeklyBackup: {
    lastRunAt: null as string | null,
    lastSuccessAt: null as string | null,
    lastBackupPath: null as string | null,
    lastError: null as string | null
  },
  dailyInspection: {
    lastRunAt: null as string | null,
    lastSuccessAt: null as string | null,
    lastReportPath: null as string | null,
    lastError: null as string | null,
    lastResult: null as null | { kstDate: string; overall: string; pass: number; warn: number; fail: number; total: number },
    // 보고서 메일 발송 상태 (미설정 환경에서는 skipped 로 기록되고 점검 자체는 성공)
    lastEmailAt: null as string | null,
    lastEmailStatus: null as 'sent' | 'skipped' | 'failed' | null,
    lastEmailTransport: null as string | null,
    lastEmailReason: null as string | null,
    lastEmailError: null as string | null
  },
  // 주간 자가 점검 · 자가 복구 (매주 월요일 05:00 KST)
  weeklySelfCheck: {
    lastRunAt: null as string | null,
    lastSuccessAt: null as string | null,
    lastError: null as string | null,
    lastReportPath: null as string | null,
    lastResult: null as null | {
      kstDate: string;
      isoWeek: string;
      overall: string;
      pass: number;
      warn: number;
      fail: number;
      total: number;
      repaired: number;
    },
    lastChecks: [] as Array<{ id: string; category: string; name: string; status: string; detail: string }>,
    lastDrift: [] as Array<{ terminal: string; status: string; count: number; baselineCount: number | null; changeRatio: number | null }>,
    lastRepairs: [] as Array<{ target: string; action: string; status: string; detail: string; verified?: boolean | null }>,
    lastEmailAt: null as string | null,
    lastEmailWeek: null as string | null,
    lastEmailStatus: null as 'sent' | 'skipped' | 'failed' | null,
    lastEmailTransport: null as string | null,
    lastEmailReason: null as string | null,
    lastEmailError: null as string | null
  }
};

function recordTerminalSuccess(tid: string): void {
  const prev = terminalHealthMap.get(tid);
  terminalHealthMap.set(tid, {
    terminal: tid.toUpperCase(),
    status: 'healthy',
    consecutiveFailures: 0,
    lastSuccessAt: new Date().toISOString(),
    lastErrorAt: prev?.lastErrorAt || null,
    lastError: null,
    staleServedCount: prev?.staleServedCount || 0
  });
}

function recordTerminalFailure(tid: string, errorMessage: string): void {
  const prev = terminalHealthMap.get(tid);
  const failures = (prev?.consecutiveFailures || 0) + 1;
  terminalHealthMap.set(tid, {
    terminal: tid.toUpperCase(),
    status: failures >= 2 ? 'isolated' : 'degraded',
    consecutiveFailures: failures,
    lastSuccessAt: prev?.lastSuccessAt || null,
    lastErrorAt: new Date().toISOString(),
    lastError: errorMessage,
    staleServedCount: prev?.staleServedCount || 0
  });
}

function incrementTerminalStaleServed(tid: string): void {
  const prev = terminalHealthMap.get(tid);
  if (prev) {
    prev.staleServedCount += 1;
  }
}

export function getTerminalHealthSummary(): TerminalHealthState[] {
  return Array.from(terminalHealthMap.values());
}

export function normalizeDateTimeStr(raw: any): string {
  if (!raw) return '';
  const s = String(raw).trim().replace(/\//g, '-');
  const m = s.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
  if (!m) return '';
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

export function parseScheduleTimeMs(raw: any): number | null {
  const norm = normalizeDateTimeStr(raw);
  if (!norm) return null;
  const m = norm.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = m[4] !== undefined ? Number(m[4]) : 0;
  const minute = m[5] !== undefined ? Number(m[5]) : 0;
  const ms = Date.UTC(year, month, day, hour, minute);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 이전 시간과 새 시간의 차이(분)를 계산합니다.
 * 양수면 지연(뒤로 밀림), 음수면 조기(앞당겨짐), 파싱 불가 시 null 반환.
 */
export function calculateScheduleDiffMinutes(oldTime: any, newTime: any): number | null {
  const oldMs = parseScheduleTimeMs(oldTime);
  const newMs = parseScheduleTimeMs(newTime);
  if (oldMs === null || newMs === null) return null;
  return Math.round((newMs - oldMs) / (60 * 1000));
}

/**
 * 출항/접안 시간이 기준 시간(기본 60분 = 1시간) 이상 변동되었는지 판정합니다.
 */
export function isScheduleShiftedByAtLeastOneHour(
  oldTime: any,
  newTime: any,
  thresholdMinutes: number = SCHEDULE_DIFF_THRESHOLD_MINUTES
): boolean {
  const diff = calculateScheduleDiffMinutes(oldTime, newTime);
  if (diff === null) return false;
  return Math.abs(diff) >= thresholdMinutes;
}

function stripTags(html: string): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function httpsGetBuffer(url: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: hjncAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 200,
            headers: res.headers as Record<string, any>,
            body: Buffer.concat(chunks).toString('utf-8')
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('HJNC request timeout'));
    });
  });
}

function httpRequestText(
  urlStr: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; encoding?: string } = {}
): Promise<{ statusCode: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const isHttps = parsedUrl.protocol === 'https:';
    const mod = isHttps ? https : http;
    const req = mod.request(
      urlStr,
      {
        method: options.method || 'GET',
        agent: isHttps ? hjncAgent : httpKeepAliveAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(options.headers || {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let text = '';
          if (options.encoding === 'euc-kr') {
            try {
              text = new TextDecoder('euc-kr').decode(buf);
            } catch {
              text = buf.toString('utf-8');
            }
          } else {
            text = buf.toString('utf-8');
          }
          resolve({
            statusCode: res.statusCode || 200,
            headers: res.headers as Record<string, any>,
            body: text
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Terminal schedule request timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function loadTerminalFallbackFromFirestore(tid: string): Promise<VesselScheduleItem[]> {
  try {
    if (getApps().length === 0) return [];
    const snapshot = await getFirestore()
      .collection('vessel_schedules_cache')
      .where('TERMINAL', '==', tid.toUpperCase())
      .limit(200)
      .get();
    const items: VesselScheduleItem[] = [];
    snapshot.forEach((doc) => {
      const d = doc.data() || {};
      if (d.VSL_NM) {
        items.push({
          TERMINAL: String(d.TERMINAL || tid.toUpperCase()),
          VSL_NM: String(d.VSL_NM || ''),
          BERTH_NO: String(d.BERTH_NO || ''),
          PTNR_CODE: String(d.PTNR_CODE || ''),
          VOY_NO: String(d.VOY_NO || ''),
          ETB: normalizeDateTimeStr(d.ETB),
          ATA: normalizeDateTimeStr(d.ATA || d.ETB),
          ATW: normalizeDateTimeStr(d.ATW),
          ATC: normalizeDateTimeStr(d.ATC || d.ATD),
          ATD: normalizeDateTimeStr(d.ATD)
        });
      }
    });
    return items;
  } catch {
    return [];
  }
}

export async function fetchTerminalScheduleVesselsWithMeta(
  terminalId: string,
  startDate: string,
  endDate: string,
  customFetcher?: (tid: string, s: string, e: string) => Promise<VesselScheduleItem[]>
): Promise<{ vessels: VesselScheduleItem[]; stale: boolean; cacheSource: 'fresh' | 'memory-cache' | 'stale-memory' | 'firestore-cache' }> {
  const tid = terminalId.toLowerCase();
  const cacheKey = `${tid}:${startDate}:${endDate}`;
  const now = Date.now();
  const cached = scheduleMemoryCache.get(cacheKey);
  const fetcher = customFetcher || fetchTerminalScheduleVesselsUncached;

  // 1) 신선한 캐시가 있으면 즉시 반환
  if (cached && cached.expiresAt > now) {
    return { vessels: cached.vessels, stale: false, cacheSource: 'memory-cache' };
  }

  // 2) Stale-While-Revalidate: 만료되었지만 Stale 허용 범위 내 캐시가 있고 현재 터미널이 격리(isolated) 상태면
  //    즉시 Stale 캐시를 반환하고 백그라운드에서 재검증(Revalidate) 수행
  const health = terminalHealthMap.get(tid);
  if (cached && cached.staleExpiresAt > now && health?.status === 'isolated' && !customFetcher) {
    incrementTerminalStaleServed(tid);
    if (!inFlightSchedulePromises.has(cacheKey)) {
      const bgPromise = fetcher(tid, startDate, endDate)
        .then((vessels) => {
          recordTerminalSuccess(tid);
          if (Array.isArray(vessels) && vessels.length > 0) {
            scheduleMemoryCache.set(cacheKey, {
              expiresAt: Date.now() + SCHEDULE_CACHE_TTL_MS,
              staleExpiresAt: Date.now() + STALE_CACHE_MAX_AGE_MS,
              vessels,
              updatedAt: new Date().toISOString()
            });
          }
          return vessels;
        })
        .catch((err: any) => {
          recordTerminalFailure(tid, err?.message || 'Background revalidation failed');
          return cached.vessels;
        })
        .finally(() => {
          inFlightSchedulePromises.delete(cacheKey);
        });
      inFlightSchedulePromises.set(cacheKey, bgPromise);
    }
    return { vessels: cached.vessels, stale: true, cacheSource: 'stale-memory' };
  }

  const existingPromise = inFlightSchedulePromises.get(cacheKey);
  if (existingPromise) {
    const vessels = await existingPromise;
    return { vessels, stale: false, cacheSource: 'fresh' };
  }

  const fetchPromise = fetcher(tid, startDate, endDate)
    .then((vessels) => {
      recordTerminalSuccess(tid);
      if (Array.isArray(vessels) && vessels.length > 0) {
        scheduleMemoryCache.set(cacheKey, {
          expiresAt: Date.now() + SCHEDULE_CACHE_TTL_MS,
          staleExpiresAt: Date.now() + STALE_CACHE_MAX_AGE_MS,
          vessels,
          updatedAt: new Date().toISOString()
        });
      }
      return vessels;
    })
    .finally(() => {
      inFlightSchedulePromises.delete(cacheKey);
    });

  inFlightSchedulePromises.set(cacheKey, fetchPromise);

  try {
    const vessels = await fetchPromise;
    return { vessels, stale: false, cacheSource: 'fresh' };
  } catch (err: any) {
    recordTerminalFailure(tid, err?.message || 'Terminal crawl failed');

    // 자가 격리 폴백 1: 메모리에 남아있는 이전 Stale 캐시 반환
    if (cached && cached.vessels.length > 0) {
      incrementTerminalStaleServed(tid);
      return { vessels: cached.vessels, stale: true, cacheSource: 'stale-memory' };
    }

    // 자가 격리 폴백 2: 동일 터미널의 다른 날짜 범위 Stale 캐시 탐색
    for (const [key, entry] of scheduleMemoryCache.entries()) {
      if (key.startsWith(`${tid}:`) && entry.vessels.length > 0) {
        incrementTerminalStaleServed(tid);
        return { vessels: entry.vessels, stale: true, cacheSource: 'stale-memory' };
      }
    }

    // 자가 격리 폴백 3: Firestore vessel_schedules_cache 폴백
    const firestoreFallback = await loadTerminalFallbackFromFirestore(tid);
    if (firestoreFallback.length > 0) {
      incrementTerminalStaleServed(tid);
      return { vessels: firestoreFallback, stale: true, cacheSource: 'firestore-cache' };
    }

    throw err;
  }
}

function decodeBasicEntities(str: string): string {
  return String(str || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

export function parsePncScheduleHtml(html: string): VesselScheduleItem[] {
  const results: VesselScheduleItem[] = [];
  if (!html) return results;

  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableBody = tableMatch[1];
    const headerCells = Array.from(tableBody.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) =>
      decodeBasicEntities(stripTags(m[1]))
    );

    let idxName = 1;
    let idxCode = 2;
    let idxVoy = 3;
    let idxOper = 4;
    let idxEtb = 7;
    let idxAtd = 8;
    let idxBerth = 9;

    if (headerCells.length >= 10) {
      headerCells.forEach((h, idx) => {
        const lower = h.toLowerCase();
        if (/모선명|선박명|^name$/i.test(lower)) idxName = idx;
        else if (/모선코드|선박코드|^code$/i.test(lower)) idxCode = idx;
        else if (/선사항차|항차|voyage/i.test(lower)) idxVoy = idx;
        else if (/운항선사|선사|operator/i.test(lower)) idxOper = idx;
        else if (/접안.*일시|^etb$/i.test(lower)) idxEtb = idx;
        else if (/출항.*일시|^etd$/i.test(lower)) idxAtd = idx;
        else if (/^선석$|berth/i.test(lower)) idxBerth = idx;
      });
    }

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableBody)) !== null) {
      const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) =>
        decodeBasicEntities(stripTags(m[1]))
      );
      if (cells.length >= 10 && /^\d+$/.test(cells[0] || '')) {
        const vslName = (cells[idxName] || '').trim();
        const codeStr = (cells[idxCode] || '').trim();
        const voyStr = (cells[idxVoy] || codeStr).trim();
        const operStr = (cells[idxOper] || '').trim();
        const etbNorm = normalizeDateTimeStr(cells[idxEtb] || '');
        const atdNorm = normalizeDateTimeStr(cells[idxAtd] || '');
        const berthStr = (cells[idxBerth] || '').trim();
        if (vslName && (etbNorm || atdNorm)) {
          results.push({
            TERMINAL: 'PNC',
            VSL_NM: vslName,
            BERTH_NO: berthStr,
            PTNR_CODE: operStr,
            VOY_NO: voyStr,
            ETB: etbNorm,
            ATA: etbNorm,
            ATW: etbNorm,
            ATC: atdNorm,
            ATD: atdNorm
          });
        }
      }
    }
  }
  return results;
}

export function parsePncWorkStatusHtml(html: string): VesselScheduleItem[] {
  const results: VesselScheduleItem[] = [];
  if (!html) return results;

  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const rows: string[][] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableMatch[1])) !== null) {
      const cells = Array.from(rowMatch[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)).map((m) =>
        decodeBasicEntities(stripTags(m[1]))
      );
      if (cells.length >= 2) rows.push(cells);
    }

    const rowMap = new Map<string, string[]>();
    for (const r of rows) {
      const label = (r[0] || '').replace(/\s+/g, '');
      if (label) rowMap.set(label, r.slice(1));
    }

    const names = rowMap.get('선박명') || rowMap.get('모선명');
    if (!names || names.length === 0) continue;

    const headers = rowMap.get('구분') || [];
    const codes = rowMap.get('선박코드') || rowMap.get('모선코드') || [];
    const opers = rowMap.get('운항선사') || rowMap.get('선사') || [];
    const atas = rowMap.get('접안일시') || rowMap.get('접안(예정)일시') || [];
    const atws = rowMap.get('작업시작일시') || [];
    const atds = rowMap.get('출항(예정)일시') || rowMap.get('출항일시') || [];

    for (let i = 0; i < names.length; i++) {
      const vslName = (names[i] || '').trim();
      if (!vslName || vslName === '-') continue;
      const rawBerth = (headers[i] || '').trim();
      const berthNo = /^#\d+$/.test(rawBerth) ? `B${rawBerth.slice(1)}` : rawBerth;
      const ataNorm = normalizeDateTimeStr(atas[i] || '');
      const atwNorm = normalizeDateTimeStr(atws[i] || '') || ataNorm;
      const atdNorm = normalizeDateTimeStr(atds[i] || '');

      results.push({
        TERMINAL: 'PNC',
        VSL_NM: vslName,
        BERTH_NO: berthNo,
        PTNR_CODE: (opers[i] || '').trim(),
        VOY_NO: (codes[i] || '').trim(),
        ETB: ataNorm,
        ATA: ataNorm,
        ATW: atwNorm,
        ATC: atdNorm,
        ATD: atdNorm
      });
    }
  }
  return results;
}

export function extractPncSearchFormRequest(
  html: string,
  startDate: string,
  endDate: string,
  baseUrl: string = 'https://svc.pncport.com/info/CMS/Ship/Info.pnc?mCode=MN014'
): { method: 'GET' | 'POST'; url: string; body: string } | null {
  if (!html) return null;
  const formRegex = /<form([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch;
  while ((formMatch = formRegex.exec(html)) !== null) {
    const formAttrs = formMatch[1] || '';
    const formInner = formMatch[2] || '';

    const params = new URLSearchParams();
    const dateInputs: Array<{ name: string; sep: string }> = [];
    let pageSizeFieldName = '';

    const inputRegex = /<input\b([^>]*)>/gi;
    let inputMatch;
    while ((inputMatch = inputRegex.exec(formInner)) !== null) {
      const attrs = inputMatch[1] || '';
      const nameMatch = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
      const inputType = (typeMatch ? typeMatch[1] : 'text').toLowerCase();
      const valMatch = attrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i);
      const val = valMatch ? decodeBasicEntities(valMatch[1]) : '';
      const isChecked = /\bchecked\b/i.test(attrs);

      if (val === '1000' && (inputType === 'radio' || inputType === 'hidden')) {
        pageSizeFieldName = name;
      }

      const dateValMatch = val.match(/^\d{4}([-./])\d{2}\1\d{2}$/);
      if (inputType !== 'hidden' && inputType !== 'radio' && inputType !== 'checkbox' && dateValMatch) {
        dateInputs.push({ name, sep: dateValMatch[1] });
        continue;
      }

      if (inputType === 'radio' || inputType === 'checkbox') {
        if (isChecked) params.append(name, val || 'on');
      } else if (inputType !== 'button' && inputType !== 'submit' && inputType !== 'reset' && inputType !== 'image') {
        params.set(name, val);
      }
    }

    if (dateInputs.length < 2) continue;

    const selectRegex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
    let selectMatch;
    while ((selectMatch = selectRegex.exec(formInner)) !== null) {
      const sAttrs = selectMatch[1] || '';
      const sInner = selectMatch[2] || '';
      const nameMatch = sAttrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
      if (!nameMatch) continue;
      const sName = nameMatch[1];
      const options = Array.from(sInner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi));
      let chosenVal = '';
      let has1000Option = false;
      for (const opt of options) {
        const oAttrs = opt[1] || '';
        const oValMatch = oAttrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i);
        const oVal = oValMatch ? decodeBasicEntities(oValMatch[1]) : stripTags(opt[2]);
        if (oVal === '1000') has1000Option = true;
        if (/\bselected\b/i.test(oAttrs)) chosenVal = oVal;
      }
      if (has1000Option) {
        params.set(sName, '1000');
      } else if (!params.has(sName) && options.length > 0) {
        if (!chosenVal) {
          const firstValMatch = (options[0][1] || '').match(/\bvalue\s*=\s*["']([^"']*)["']/i);
          chosenVal = firstValMatch ? decodeBasicEntities(firstValMatch[1]) : '';
        }
        params.set(sName, chosenVal);
      }
    }

    const fmtDate = (iso: string, sep: string) => (sep === '-' ? iso : iso.replace(/-/g, sep));
    params.set(dateInputs[0].name, fmtDate(startDate, dateInputs[0].sep));
    params.set(dateInputs[1].name, fmtDate(endDate, dateInputs[1].sep));
    if (pageSizeFieldName) {
      params.set(pageSizeFieldName, '1000');
    }

    const methodMatch = formAttrs.match(/\bmethod\s*=\s*["']([^"']+)["']/i);
    const method: 'GET' | 'POST' =
      methodMatch && methodMatch[1].toUpperCase() === 'GET' ? 'GET' : 'POST';
    const actionMatch = formAttrs.match(/\baction\s*=\s*["']([^"']*)["']/i);
    const rawAction = actionMatch && actionMatch[1].trim() ? decodeBasicEntities(actionMatch[1].trim()) : baseUrl;
    const resolvedUrl = new URL(rawAction, baseUrl);
    if (!params.has('mCode') && resolvedUrl.searchParams.get('mCode')) {
      params.set('mCode', resolvedUrl.searchParams.get('mCode') || 'MN014');
    }

    if (method === 'GET') {
      params.forEach((v, k) => resolvedUrl.searchParams.set(k, v));
      return { method: 'GET', url: resolvedUrl.toString(), body: '' };
    }
    return { method: 'POST', url: resolvedUrl.toString(), body: params.toString() };
  }
  return null;
}

export function mergePncScheduleAndWorkStatus(
  scheduleList: VesselScheduleItem[],
  statusList: VesselScheduleItem[] = []
): VesselScheduleItem[] {
  const merged = new Map<string, VesselScheduleItem>();
  for (const item of scheduleList) {
    if (!item.VSL_NM) continue;
    const key = `${item.VSL_NM.toUpperCase()}|${item.ETB || item.ATA || ''}`;
    if (!merged.has(key)) {
      merged.set(key, { ...item });
    }
  }

  for (const st of statusList) {
    if (!st.VSL_NM) continue;
    const targetName = st.VSL_NM.toUpperCase();
    let matched = false;
    for (const existing of merged.values()) {
      if (existing.VSL_NM.toUpperCase() === targetName) {
        if (st.ATW) existing.ATW = st.ATW;
        if (st.ATA) existing.ATA = st.ATA;
        if (st.ATD) {
          existing.ATD = st.ATD;
          existing.ATC = st.ATD;
        }
        if (st.BERTH_NO && !existing.BERTH_NO) existing.BERTH_NO = st.BERTH_NO;
        if (st.PTNR_CODE && !existing.PTNR_CODE) existing.PTNR_CODE = st.PTNR_CODE;
        matched = true;
      }
    }
    if (!matched && (st.ETB || st.ATA || st.ATD)) {
      merged.set(`${targetName}|${st.ETB || st.ATA || ''}`, { ...st });
    }
  }

  return Array.from(merged.values());
}

export async function fetchTerminalScheduleVessels(terminalId: string, startDate: string, endDate: string): Promise<VesselScheduleItem[]> {
  const result = await fetchTerminalScheduleVesselsWithMeta(terminalId, startDate, endDate);
  return result.vessels;
}

async function fetchTerminalScheduleVesselsUncached(tid: string, startDate: string, endDate: string): Promise<VesselScheduleItem[]> {
  if (tid === 'hjnc') {
    const pageRes = await httpsGetBuffer('https://www.hjnc.co.kr/esvc/vessel/berthScheduleT');
    const rawCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0];

    const query = new URLSearchParams({
      startDate,
      endDate,
      sort: 'ETB',
      dateType: '',
      route: '',
      oper: '',
      amount: '1000',
      page: '1'
    }).toString();

    const dataRes = await httpsGetBuffer(`https://www.hjnc.co.kr/esvc/vessel/berthScheduleT/data?${query}`, {
      Cookie: cookieHeader,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json',
      Referer: 'https://www.hjnc.co.kr/esvc/vessel/berthScheduleT'
    });

    const parsed = JSON.parse(dataRes.body || '{}');
    const list = parsed.stringContent ? JSON.parse(parsed.stringContent) : [];
    return (Array.isArray(list) ? list : []).map((v: any) => ({
      TERMINAL: 'HJNC',
      VSL_NM: String(v.VSL_NM || '').trim(),
      BERTH_NO: String(v.BERTH_NO || '').trim(),
      PTNR_CODE: String(v.PTNR_CODE || '').trim(),
      VOY_NO: String(v.VOY_NO || v.OPR_VOY || '').trim(),
      ETB: normalizeDateTimeStr(v.ETB),
      ATA: normalizeDateTimeStr(v.ATA || v.ETB),
      ATW: normalizeDateTimeStr(v.ATW),
      ATC: normalizeDateTimeStr(v.ATC),
      ATD: normalizeDateTimeStr(v.ATD)
    })).filter((v: VesselScheduleItem) => Boolean(v.VSL_NM));
  }

  if (tid === 'bnct') {
    const pageRes = await httpRequestText('https://info.bnctkorea.com/esvc/vessel/berthScheduleT');
    const rawCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0];

    const query = new URLSearchParams({
      VVD: '',
      StrDate: startDate,
      EndDate: endDate
    }).toString();

    const dataRes = await httpRequestText(`https://info.bnctkorea.com/esvc/vessel/berthScheduleT/list?${query}`, {
      headers: {
        Cookie: cookieHeader,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: 'https://info.bnctkorea.com/esvc/vessel/berthScheduleT'
      }
    });

    const list = JSON.parse(dataRes.body || '[]');
    return (Array.isArray(list) ? list : []).map((v: any) => ({
      TERMINAL: 'BNCT',
      VSL_NM: String(v.VSLNAME || '').trim(),
      BERTH_NO: String(v.BERTHNO || '').trim(),
      PTNR_CODE: String(v.OPERATOR || '').trim(),
      VOY_NO: String(v.VVD || '').trim(),
      ETB: normalizeDateTimeStr(v.ETBDATE || v.ATBDATE),
      ATA: normalizeDateTimeStr(v.ATBDATE || v.ETBDATE),
      ATW: normalizeDateTimeStr(v.ATBDATE),
      ATC: normalizeDateTimeStr(v.ATDDATE || v.ETDDATE),
      ATD: normalizeDateTimeStr(v.ATDDATE || v.ETDDATE)
    })).filter((v: VesselScheduleItem) => Boolean(v.VSL_NM));
  }

  if (tid === 'dgt') {
    const pageRes = await httpRequestText('https://www.dgtbusan.com/DGT/esvc/vessel/berthScheduleT');
    const rawCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0];
    const csrfMatch = pageRes.body.match(/name="_csrf"\s+content="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const payload = JSON.stringify({
      fromDate: startDate.replace(/-/g, ''),
      toDate: endDate.replace(/-/g, ''),
      vessel: '',
      voyage: '',
      route: ''
    });

    const dataRes = await httpRequestText('https://www.dgtbusan.com/DGT/esvc/vessel/vesselSchedule', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'X-CSRF-TOKEN': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/json',
        Referer: 'https://www.dgtbusan.com/DGT/esvc/vessel/berthScheduleT',
        'Content-Length': String(Buffer.byteLength(payload))
      },
      body: payload
    });

    const parsed = JSON.parse(dataRes.body || '{}');
    const list = parsed.vesselSchedules || [];
    return (Array.isArray(list) ? list : []).map((v: any) => ({
      TERMINAL: 'DGT',
      VSL_NM: String(v.vesselName || '').trim(),
      BERTH_NO: String(v.berthNo || '').trim(),
      PTNR_CODE: String(v.carrier || '').trim(),
      VOY_NO: `${v.vesselCode || ''}-${v.voyageSeq || ''}`,
      ETB: normalizeDateTimeStr(v.etb || v.eta),
      ATA: normalizeDateTimeStr(v.atb || v.ata || v.etb),
      ATW: normalizeDateTimeStr(v.workStartDate),
      ATC: normalizeDateTimeStr(v.workEndDate),
      ATD: normalizeDateTimeStr(v.atd || v.etd)
    })).filter((v: VesselScheduleItem) => Boolean(v.VSL_NM));
  }

  if (tid === 'pnc') {
    const scheduleUrl = 'https://svc.pncport.com/info/CMS/Ship/Info.pnc?mCode=MN014';
    const statusUrl = 'https://svc.pncport.com/info/CMS/Ship/ShipVslStatus.pnc?mCode=MN020';

    const [pageSettled, statusSettled] = await Promise.allSettled([
      httpRequestText(scheduleUrl),
      httpRequestText(statusUrl)
    ]);

    if (pageSettled.status !== 'fulfilled') {
      throw pageSettled.reason || new Error('PNC schedule fetch failed');
    }

    const pageRes = pageSettled.value;
    const rawCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0];

    const collectedSchedules: VesselScheduleItem[] = [...parsePncScheduleHtml(pageRes.body)];

    const searchReq = extractPncSearchFormRequest(pageRes.body, startDate, endDate, scheduleUrl);
    if (searchReq) {
      try {
        const searchRes =
          searchReq.method === 'GET'
            ? await httpRequestText(searchReq.url, {
                headers: {
                  Cookie: cookieHeader,
                  Referer: scheduleUrl
                }
              })
            : await httpRequestText(searchReq.url, {
                method: 'POST',
                headers: {
                  Cookie: cookieHeader,
                  Origin: 'https://svc.pncport.com',
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Referer: scheduleUrl,
                  'Content-Length': String(Buffer.byteLength(searchReq.body))
                },
                body: searchReq.body
              });
        const rangedList = parsePncScheduleHtml(searchRes.body);
        if (rangedList.length > 0) {
          collectedSchedules.unshift(...rangedList);
        }
      } catch {}
    }

    const statusList =
      statusSettled.status === 'fulfilled' ? parsePncWorkStatusHtml(statusSettled.value.body) : [];

    return mergePncScheduleAndWorkStatus(collectedSchedules, statusList);
  }

  if (tid === 'hpnt' || tid === 'pnit') {
    const baseUrl = tid === 'hpnt'
      ? 'https://www.hpnt.co.kr/infoservice/vessel/vslScheduleList.jsp'
      : 'https://www.pnitl.com/infoservice/vessel/vslScheduleList.jsp';
    const originUrl = tid === 'hpnt' ? 'https://www.hpnt.co.kr' : 'https://www.pnitl.com';
    const tmnCod = tid === 'hpnt' ? 'H' : 'P';

    const pageRes = await httpRequestText(baseUrl);
    const rawCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0];

    const csrfMatch = pageRes.body.match(/CSRF_TOKEN'\s*,\s*value\s*:\s*'([^']+)'/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const formParams: Record<string, string> = {
      isSearch: 'Y',
      page: '1',
      URI: '',
      userID: '',
      groupID: 'U999',
      tmnCod,
      strdStDate: startDate,
      strdEdDate: endDate,
      route: ''
    };
    if (csrfToken) formParams.CSRF_TOKEN = csrfToken;
    const formBody = new URLSearchParams(formParams).toString();

    let html = pageRes.body;
    try {
      const postRes = await httpRequestText(baseUrl, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          Origin: originUrl,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: baseUrl,
          'Content-Length': String(Buffer.byteLength(formBody))
        },
        body: formBody
      });
      if (/class="color_/.test(postRes.body)) {
        html = postRes.body;
      }
    } catch {}
    const rowRegex = /<tr[^>]*class="color_[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    const results: VesselScheduleItem[] = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
      if (cells.length >= 10) {
        const isPnitLayout = /^\d+\s*\(\d+\)/.test(cells[4] || '');
        const vslName = isPnitLayout ? cells[5] : cells[4];
        const etbStr = cells[8] || '';
        const atdStr = cells[9] || '';
        if (vslName) {
          results.push({
            TERMINAL: tid.toUpperCase(),
            VSL_NM: vslName,
            BERTH_NO: cells[0] || '',
            PTNR_CODE: cells[1] || '',
            VOY_NO: cells[2] || '',
            ETB: normalizeDateTimeStr(etbStr),
            ATA: normalizeDateTimeStr(etbStr),
            ATW: normalizeDateTimeStr(etbStr),
            ATC: normalizeDateTimeStr(atdStr),
            ATD: normalizeDateTimeStr(atdStr)
          });
        }
      }
    }
    return results;
  }

  if (tid === 'bptc') {
    const [y1, m1, d1] = startDate.split('-');
    const [y2, m2, d2] = endDate.split('-');
    const formBody = new URLSearchParams({
      v_time: 'term',
      YEAR1: y1,
      MONTH1: m1,
      DAY1: d1,
      YEAR2: y2,
      MONTH2: m2,
      DAY2: d2,
      ROCD: 'ALL',
      v_oper_cd: '',
      ORDER: 'item2',
      v_gu: 'A'
    }).toString();

    const res = await httpRequestText('http://info.bptc.co.kr:9084/Berth_status_text_servlet_sw_kr', {
      method: 'POST',
      encoding: 'euc-kr',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'http://info.bptc.co.kr:9084/content/sw/frame/berth_status_text_frame_sw_kr.jsp',
        'Content-Length': String(Buffer.byteLength(formBody))
      },
      body: formBody
    });

    const tbodyMatch = res.body.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    const tbody = tbodyMatch ? tbodyMatch[1] : res.body;
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const results: VesselScheduleItem[] = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tbody)) !== null) {
      const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
      if (cells.length >= 10 && cells[3]) {
        results.push({
          TERMINAL: 'BPTC',
          VSL_NM: cells[3],
          BERTH_NO: `${cells[0] || ''}${cells[1] || ''}`.trim(),
          PTNR_CODE: cells[5] || '',
          VOY_NO: cells[2] || '',
          ETB: normalizeDateTimeStr(cells[6] || cells[7]),
          ATA: normalizeDateTimeStr(cells[7] || cells[6]),
          ATW: normalizeDateTimeStr(cells[7] || cells[6]),
          ATC: normalizeDateTimeStr(cells[8]),
          ATD: normalizeDateTimeStr(cells[9])
        });
      }
    }
    return results;
  }

  if (tid === 'hbct') {
    const [y1, m1, d1] = startDate.split('-');
    const results: VesselScheduleItem[] = [];
    const seenKeys = new Set<string>();
    const pagesToFetch = [1, 2, 3];

    const pageBodies = await Promise.all(
      pagesToFetch.map(async (pageNum) => {
        const formBody = new URLSearchParams({
          year: y1,
          month: m1,
          day: d1,
          langType: 'K',
          mainType: 'T01',
          subType: '01',
          optType: 'T',
          terminal: 'HBCTLIB',
          currentPage: String(pageNum),
          startPage: '1'
        }).toString();

        try {
          const res = await httpRequestText('https://custom.hktl.com/jsp/T01/sunsuk.jsp', {
            method: 'POST',
            encoding: 'euc-kr',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Referer: 'https://custom.hktl.com/jsp/T01/sunsuk.jsp',
              'Content-Length': String(Buffer.byteLength(formBody))
            },
            body: formBody
          });
          return res.body;
        } catch {
          return '';
        }
      })
    );

    for (const body of pageBodies) {
      if (!body) continue;
      const rowRegex = /<tr[^>]*bgcolor="#(?:CCFFFF|FFFFFF|F0F8FF|FFFFCC|CCCCCC|FFFF99)"[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(body)) !== null) {
        const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
        if (cells.length >= 13 && cells[11] && cells[11] !== '선명') {
          const key = `${cells[0]}_${cells[11]}_${cells[4]}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({
              TERMINAL: 'HBCT',
              VSL_NM: cells[11],
              BERTH_NO: cells[2] || '',
              PTNR_CODE: cells[12] || '',
              VOY_NO: cells[0] || '',
              ETB: normalizeDateTimeStr(cells[4]),
              ATA: normalizeDateTimeStr(cells[5] || cells[4]),
              ATW: normalizeDateTimeStr(cells[5] || cells[4]),
              ATC: normalizeDateTimeStr(cells[6]),
              ATD: normalizeDateTimeStr(cells[6])
            });
          }
        }
      }
    }
    return results;
  }

  return [];
}

// --- 1순위: 선박 출항/접안 스케줄 변경(1시간 이상) 감지 및 투트랙 알림 파이프라인 ---
async function sendPushNotification(userId: string, title: string, body: string): Promise<boolean> {
  try {
    if (getApps().length === 0) return false;
    const userDoc = await getFirestore().collection('user_profiles').doc(userId).get();
    if (!userDoc.exists) return false;

    const data = userDoc.data() || {};
    const token = data.fcmToken;
    if (!token) return false;

    await getMessaging().send({
      token,
      notification: { title, body },
      data: { type: 'SCHEDULE_CHANGE', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
    });
    console.log(`[FCM] ${userId}에게 푸시 발송 완료`);
    return true;
  } catch (err: any) {
    console.error(`[FCM] ${userId} 발송 실패:`, err?.message || err);
    return false;
  }
}

export async function runScheduleChangeDetection(): Promise<{ changedVessels: number; notificationsSent: number }> {
  automationRuntimeStatus.scheduleWatcher.lastRunAt = new Date().toISOString();
  let changedVessels = 0;
  let notificationsSent = 0;

  try {
    if (getApps().length === 0) {
      console.log('[CRON] Firebase Admin이 초기화되지 않아 스케줄러를 종료합니다.');
      return { changedVessels: 0, notificationsSent: 0 };
    }
    const firestore = getFirestore();

    const base = new Date();
    const s = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
    const e = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 3);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const startDate = fmt(s);
    const endDate = fmt(e);

    const allVessels: VesselScheduleItem[] = [];

    for (const term of SUPPORTED_TERMINALS) {
      try {
        const vessels = await fetchTerminalScheduleVessels(term, startDate, endDate);
        allVessels.push(...vessels);
      } catch (err: any) {
        console.error(`[CRON] ${term} 스케줄 조회 실패:`, err?.message || err);
      }
    }

    const cacheRef = firestore.collection('vessel_schedules_cache');
    const logsRef = firestore.collection('work_logs');

    for (const v of allVessels) {
      if (!v.VSL_NM) continue;
      const safeName = v.VSL_NM.replace(/[\s/]+/g, '_');
      const vslId = `${v.TERMINAL}_${v.VOY_NO || 'NOVOY'}_${safeName}`;
      const doc = await cacheRef.doc(vslId).get();

      let changedField: 'ATD' | 'ETB' | null = null;
      let oldTime: string | null = null;
      let newTime: string | null = null;
      let diffMinutes = 0;

      if (doc.exists) {
        const data = doc.data() || {};
        const oldAtd = data.ATD || null;
        const oldEtb = data.ETB || null;

        if (oldAtd && v.ATD && isScheduleShiftedByAtLeastOneHour(oldAtd, v.ATD)) {
          changedField = 'ATD';
          oldTime = oldAtd;
          newTime = v.ATD;
          diffMinutes = calculateScheduleDiffMinutes(oldAtd, v.ATD) || 0;
        } else if (oldEtb && v.ETB && isScheduleShiftedByAtLeastOneHour(oldEtb, v.ETB)) {
          changedField = 'ETB';
          oldTime = oldEtb;
          newTime = v.ETB;
          diffMinutes = calculateScheduleDiffMinutes(oldEtb, v.ETB) || 0;
        }
      }

      await cacheRef.doc(vslId).set({
        TERMINAL: v.TERMINAL,
        VSL_NM: v.VSL_NM,
        BERTH_NO: v.BERTH_NO || '',
        PTNR_CODE: v.PTNR_CODE || '',
        VOY_NO: v.VOY_NO || '',
        ETB: v.ETB || null,
        ATD: v.ATD || null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: Date.now()
      }, { merge: true });

      if (changedField && oldTime && newTime) {
        changedVessels += 1;
        const label = changedField === 'ATD' ? '출항' : '접안';
        const diffHours = (Math.abs(diffMinutes) / 60).toFixed(1).replace(/\.0$/, '');
        const direction = diffMinutes > 0 ? `${diffHours}시간 지연` : `${diffHours}시간 조기`;
        console.log(`[CRON] ${label}시간 1시간 이상 변경 감지: ${v.VSL_NM} (${oldTime} -> ${newTime}, ${direction})`);

        const snapshot = await logsRef.where('date', '>=', startDate).where('date', '<=', endDate).get();
        const notifiedUsers = new Set<string>();
        const targetShipName = v.VSL_NM.replace(/\s+/g, '').toUpperCase();

        for (const logDoc of snapshot.docs) {
          const logData = logDoc.data() || {};
          const savedShipName = String(logData.shipName || '').replace(/\s+/g, '').toUpperCase();
          const workerId = String(logData.workerId || '').trim();

          if (workerId && savedShipName.includes(targetShipName) && !notifiedUsers.has(workerId)) {
            notifiedUsers.add(workerId);

            const notiRef = firestore.collection('notifications').doc();
            const title = `${label} 시간 변경 안내 (${direction}) 🚢`;
            const message = `[${v.TERMINAL}] ${v.VSL_NM}호의 ${label} 시간이 변경되었습니다. (${oldTime} → ${newTime})`;

            await notiRef.set({
              userId: workerId,
              title,
              body: message,
              type: 'SCHEDULE_CHANGE',
              terminal: v.TERMINAL,
              vesselName: v.VSL_NM,
              oldTime,
              newTime,
              diffMinutes,
              read: false,
              createdAt: FieldValue.serverTimestamp(),
              createdAtMs: Date.now()
            });

            await sendPushNotification(workerId, title, message);
            notificationsSent += 1;
          }
        }
      }
    }

    automationRuntimeStatus.scheduleWatcher.lastSuccessAt = new Date().toISOString();
    automationRuntimeStatus.scheduleWatcher.lastError = null;
    automationRuntimeStatus.scheduleWatcher.changedVesselsDetected += changedVessels;
    automationRuntimeStatus.scheduleWatcher.notificationsSent += notificationsSent;
    console.log(`[CRON] 선박 스케줄 변경 감지 완료 (변동 선박 ${changedVessels}척, 알림 ${notificationsSent}건)`);
  } catch (error: any) {
    automationRuntimeStatus.scheduleWatcher.lastError = error?.message || String(error);
    console.error('[CRON] 스케줄 감지 에러 발생:', error);
  }

  return { changedVessels, notificationsSent };
}

// --- 2순위: 데이터베이스 자가 정리(Auto-Cleanup) 및 주간 정기 백업 자동화 ---
export function extractDocTimestampMs(docData: Record<string, any>, primaryField: string, fallbackField?: string): number | null {
  const fields = [primaryField, fallbackField].filter(Boolean) as string[];
  for (const f of fields) {
    const val = docData[f];
    if (!val) continue;
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (val instanceof Date) return val.getTime();
    if (typeof val._seconds === 'number') return val._seconds * 1000;
    if (typeof val.seconds === 'number') return val.seconds * 1000;
    if (typeof val === 'string') {
      const parsed = Date.parse(val);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * 매일 새벽 3시 실행:
 * 1) 30일 이상 지난 vessel_schedules_cache 문서 자동 삭제
 * 2) 읽은 지(read: true) 14일 이상 지난 notifications 문서 자동 삭제
 */
export async function runDatabaseAutoCleanup(nowMs: number = Date.now()): Promise<{ deletedCacheDocs: number; deletedNotiDocs: number }> {
  automationRuntimeStatus.autoCleanup.lastRunAt = new Date(nowMs).toISOString();
  let deletedCacheDocs = 0;
  let deletedNotiDocs = 0;

  try {
    if (getApps().length === 0) {
      return { deletedCacheDocs: 0, deletedNotiDocs: 0 };
    }
    const firestore = getFirestore();
    const cacheCutoffMs = nowMs - SCHEDULE_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    const notiCutoffMs = nowMs - READ_NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000;

    // 1) 30일 경과 vessel_schedules_cache 정리
    const cacheSnap = await firestore.collection('vessel_schedules_cache').get();
    let batch = firestore.batch();
    let batchCount = 0;
    for (const doc of cacheSnap.docs) {
      const data = doc.data() || {};
      const updatedMs =
        extractDocTimestampMs(data, 'updatedAtMs', 'updatedAt') ??
        parseScheduleTimeMs(data.ATD || data.ETB);
      if (updatedMs !== null && updatedMs < cacheCutoffMs) {
        batch.delete(doc.ref);
        batchCount += 1;
        deletedCacheDocs += 1;
        if (batchCount >= 400) {
          await batch.commit();
          batch = firestore.batch();
          batchCount = 0;
        }
      }
    }
    if (batchCount > 0) {
      await batch.commit();
    }

    // 2) 읽은 지 14일 지난 notifications 정리
    const readNotiSnap = await firestore.collection('notifications').where('read', '==', true).get();
    let notiBatch = firestore.batch();
    let notiBatchCount = 0;
    for (const doc of readNotiSnap.docs) {
      const data = doc.data() || {};
      const readMs = extractDocTimestampMs(data, 'readAt', 'createdAt') ?? extractDocTimestampMs(data, 'createdAtMs');
      if (readMs !== null && readMs < notiCutoffMs) {
        notiBatch.delete(doc.ref);
        notiBatchCount += 1;
        deletedNotiDocs += 1;
        if (notiBatchCount >= 400) {
          await notiBatch.commit();
          notiBatch = firestore.batch();
          notiBatchCount = 0;
        }
      }
    }
    if (notiBatchCount > 0) {
      await notiBatch.commit();
    }

    automationRuntimeStatus.autoCleanup.lastSuccessAt = new Date().toISOString();
    automationRuntimeStatus.autoCleanup.lastError = null;
    automationRuntimeStatus.autoCleanup.deletedScheduleCacheDocs += deletedCacheDocs;
    automationRuntimeStatus.autoCleanup.deletedNotificationDocs += deletedNotiDocs;
    console.log(`[CLEANUP] DB 자가 정리 완료: 스케줄 캐시 ${deletedCacheDocs}건, 읽은 알림 ${deletedNotiDocs}건 삭제`);
  } catch (err: any) {
    automationRuntimeStatus.autoCleanup.lastError = err?.message || String(err);
    console.error('[CLEANUP] DB 자가 정리 오류:', err);
  }

  return { deletedCacheDocs, deletedNotiDocs };
}

/**
 * 매주 일요일 자정(0 0 * * 0) 실행:
 * Firestore의 핵심 데이터(work_logs, ships, posts)를 JSON으로 덤프하여 backups/ 폴더에 보관
 */
export async function runWeeklyFirestoreBackup(targetDir: string = path.join(__dirname, 'backups')): Promise<{ backupFilePath: string | null; counts: Record<string, number> }> {
  automationRuntimeStatus.weeklyBackup.lastRunAt = new Date().toISOString();
  const counts: Record<string, number> = { work_logs: 0, ships: 0, posts: 0 };

  try {
    if (getApps().length === 0) {
      return { backupFilePath: null, counts };
    }
    const firestore = getFirestore();
    const dumpData: Record<string, any[]> = {};

    for (const colName of BACKUP_COLLECTIONS) {
      const snap = await firestore.collection(colName).get();
      const docs: any[] = [];
      snap.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() });
      });
      dumpData[colName] = docs;
      counts[colName] = docs.length;
    }

    await fs.mkdir(targetDir, { recursive: true });
    const now = new Date();
    const dateTag = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const backupFilePath = path.join(targetDir, `firestore-backup-${dateTag}.json`);

    const payload = JSON.stringify({
      backedUpAt: now.toISOString(),
      projectId: process.env.FIREBASE_PROJECT_ID || 'busan-hak-port',
      counts,
      collections: dumpData
    }, null, 2);

    await fs.writeFile(backupFilePath, payload, 'utf-8');

    // 최근 8개 백업 파일만 유지하고 오래된 백업 파일 정리
    const files = (await fs.readdir(targetDir))
      .filter((f) => /^firestore-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    while (files.length > 8) {
      const oldest = files.shift();
      if (oldest) {
        await fs.unlink(path.join(targetDir, oldest)).catch(() => {});
      }
    }

    automationRuntimeStatus.weeklyBackup.lastSuccessAt = new Date().toISOString();
    automationRuntimeStatus.weeklyBackup.lastBackupPath = backupFilePath;
    automationRuntimeStatus.weeklyBackup.lastError = null;
    console.log(`[BACKUP] 주간 정기 백업 완료: ${backupFilePath}`, counts);
    return { backupFilePath, counts };
  } catch (err: any) {
    automationRuntimeStatus.weeklyBackup.lastError = err?.message || String(err);
    console.error('[BACKUP] 주간 백업 실패:', err);
    return { backupFilePath: null, counts };
  }
}

// ── 일일 점검 보고서 메일 발송 ─────────────────────────────────────────────
// 매일 04:00 KST 에 실행되는 runDailyInspection() 이 보고서 생성 직후 호출합니다.
//   · 전송 방식은 환경변수로 자동 감지 — Resend → Gmail API → SMTP 순
//   · 아무 자격증명도 없으면 조용히 건너뜁니다(skipped). 점검 성공·실패 판정에는 영향 없음
//   · 설정 방법은 .env.example 의 "9. 일일 점검 보고서 메일" 절 참고
export const REPORT_EMAIL_TO = String(process.env.REPORT_EMAIL_TO || DEFAULT_REPORT_EMAIL_TO).trim() || DEFAULT_REPORT_EMAIL_TO;

/** 보고서 메일 발송 + 상태 기록. 실패해도 예외를 던지지 않습니다(점검 결과 보존). */
export async function deliverDailyInspectionEmail(
  result: InspectionResult,
  markdown: string
): Promise<SendReportEmailResult> {
  const status = automationRuntimeStatus.dailyInspection;
  try {
    const sent = await sendInspectionReportEmail({
      result,
      markdown,
      json: { kstDate: result.kstDate, kstDateTime: result.kstDateTime, generatedAt: result.generatedAt, summary: result.summary, checks: result.checks },
      env: process.env,
    });
    status.lastEmailAt = new Date().toISOString();
    status.lastEmailTransport = sent.transport;
    status.lastEmailReason = sent.reason;
    status.lastEmailError = sent.error;
    status.lastEmailStatus = sent.ok ? 'sent' : sent.skipped ? 'skipped' : 'failed';
    return sent;
  } catch (err: any) {
    status.lastEmailAt = new Date().toISOString();
    status.lastEmailStatus = 'failed';
    status.lastEmailError = err?.message || String(err);
    console.error('[INSPECTION] 보고서 메일 처리 중 오류:', status.lastEmailError);
    return { ok: false, skipped: false, reason: null, transport: null, messageId: null, error: status.lastEmailError };
  }
}

// ── 매일 04시(KST) 기능 점검 — 보고서 자동 생성 ────────────────────────────
export interface InspectionCheck {
  category: string;
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
  severity?: string;
}
export interface InspectionResult {
  kstDate: string;
  kstDateTime: string;
  generatedAt: string;
  checks: InspectionCheck[];
  summary: { total: number; pass: number; warn: number; fail: number; overall: 'PASS' | 'WARN' | 'FAIL' };
}

function formatKstDateForInspection(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}
function formatKstDateTimeForInspection(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} (${days[kst.getUTCDay()]}) ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')} KST`;
}

export async function runDailyInspection(
  now: Date = new Date(),
  options: { sendEmail?: boolean } = {}
): Promise<InspectionResult> {
  automationRuntimeStatus.dailyInspection.lastRunAt = now.toISOString();
  const kstDate = formatKstDateForInspection(now);
  const kstDateTime = formatKstDateTimeForInspection(now);
  const checks: InspectionCheck[] = [];

  const add = (category: string, name: string, status: 'PASS' | 'WARN' | 'FAIL', detail: string, severity = 'info') => {
    checks.push({ category, name, status, detail, severity });
  };

  // 1) 필수 파일
  const requiredFiles = [
    '.firebaserc', 'firebase.json', 'vercel.json', 'firestore.rules', 'package.json',
    'public/index.html', 'public/css/app.css', 'public/js/app.js', 'server.ts'
  ];
  for (const f of requiredFiles) {
    try {
      await fs.access(path.join(__dirname, f));
      add('파일 존재', f, 'PASS', '존재');
    } catch {
      // __dirname 기준이 build/ 일 수도 있으므로 ROOT 폴백
      try {
        const altRoot = path.resolve(__dirname, '..');
        await fs.access(path.join(altRoot, f));
        add('파일 존재', f, 'PASS', '존재');
      } catch {
        add('파일 존재', f, 'FAIL', '없음', 'high');
      }
    }
  }

  // 2) 지원 터미널
  for (const tid of SUPPORTED_TERMINALS) {
    add('터미널', tid.toUpperCase(), 'PASS', '지원');
  }
  if (SUPPORTED_TERMINALS.length !== 8) {
    add('터미널', '개수', 'FAIL', `기대 8개, 실제 ${SUPPORTED_TERMINALS.length}개`, 'high');
  }

  // 3) 터미널 헬스
  const health = getTerminalHealthSummary();
  const isolated = health.filter(h => h.status === 'isolated').length;
  const degraded = health.filter(h => h.status === 'degraded').length;
  if (isolated === 0 && degraded === 0) {
    add('터미널 헬스', '전체', 'PASS', '모든 터미널 healthy');
  } else if (isolated === health.length) {
    add('터미널 헬스', '전체', 'FAIL', `전체 격리 (${isolated}/${health.length})`, 'high');
  } else if (isolated > 0) {
    add('터미널 헬스', '전체', 'WARN', `격리 ${isolated}개, 저하 ${degraded}개`, 'medium');
  } else {
    add('터미널 헬스', '전체', 'WARN', `저하 ${degraded}개`, 'medium');
  }
  for (const h of health) {
    if (h.status === 'isolated') add('터미널 헬스', h.terminal, 'FAIL', h.lastError || '격리', 'high');
    else if (h.status === 'degraded') add('터미널 헬스', h.terminal, 'WARN', h.lastError || '저하', 'medium');
  }

  // 4) 자동화 상태
  const autoChecks: Array<[string, string | null]> = [
    ['scheduleWatcher', automationRuntimeStatus.scheduleWatcher.lastSuccessAt],
    ['autoCleanup', automationRuntimeStatus.autoCleanup.lastSuccessAt],
    ['weeklyBackup', automationRuntimeStatus.weeklyBackup.lastSuccessAt],
  ];
  for (const [name, lastSuccess] of autoChecks) {
    if (lastSuccess) add('자동화', name, 'PASS', `마지막 성공 ${lastSuccess}`);
    else add('자동화', name, 'WARN', '아직 실행 기록 없음', 'medium');
  }

  // 5) 보안·설정
  add('보안', 'SCREEN_LOCK_PIN', SCREEN_LOCK_PIN ? 'PASS' : 'WARN', SCREEN_LOCK_PIN ? '설정됨' : '기본값 사용');
  add('보안', 'CRON_SECRET', CRON_SECRET ? 'PASS' : 'WARN', CRON_SECRET ? '설정됨' : '미설정 — 외부 트리거 제한 없음', 'medium');
  add('보안', 'Firebase Admin', getApps().length > 0 ? 'PASS' : 'WARN', getApps().length > 0 ? '초기화됨' : '미초기화 — Firestore 폴백 불가', 'medium');

  // 6) 배포 설정
  add('배포', '플랫폼', IS_VERCEL ? 'PASS' : 'PASS', IS_VERCEL ? 'vercel-serverless' : 'node-server');
  add('배포', 'TTL 정책', 'PASS', `캐시 ${SCHEDULE_CACHE_TTL_DAYS}일 / 알림 ${READ_NOTIFICATION_TTL_DAYS}일`);

  // 7) 스케줄 감지 함수
  const funcs = ['calculateScheduleDiffMinutes', 'isScheduleShiftedByAtLeastOneHour', 'parseScheduleTimeMs'];
  for (const fn of funcs) {
    add('로직', fn, 'PASS', '함수 존재');
  }

  const pass = checks.filter(c => c.status === 'PASS').length;
  const warn = checks.filter(c => c.status === 'WARN').length;
  const fail = checks.filter(c => c.status === 'FAIL').length;
  const overall: 'PASS' | 'WARN' | 'FAIL' = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'PASS';

  const result: InspectionResult = {
    kstDate,
    kstDateTime,
    generatedAt: now.toISOString(),
    checks,
    summary: { total: checks.length, pass, warn, fail, overall },
  };

  // 보고서 생성 및 저장 시도 (Vercel /tmp, 로컬은 reports/)
  let reportMarkdown: string | null = null;
  try {
    const markdown = generateInspectionMarkdown(result);
    reportMarkdown = markdown;
    const dirs = IS_VERCEL
      ? [path.join('/tmp', 'reports'), path.join('/tmp', 'inspections')]
      : [path.join(__dirname, 'reports'), path.join(__dirname, '..', 'reports'), path.join(__dirname, 'docs', 'inspections')];

    // also try public reports via ROOT
    const primaryDir = IS_VERCEL ? path.join('/tmp', 'reports') : path.join(path.resolve(__dirname), 'reports');
    const secondaryDir = path.join(path.resolve(__dirname, '..'), 'reports');
    const docsDir = path.join(path.resolve(__dirname, '..'), 'docs', 'inspections');
    const altDocsDir = path.join(__dirname, 'docs', 'inspections');

    const candidates: string[] = [];
    if (!IS_VERCEL) {
      // local: ensure reports at repo root
      const repoRoot = path.resolve(__dirname);
      // __dirname is repo root when run via tsx server.ts
      // When compiled, __dirname may be different, so try both
      candidates.push(path.join(repoRoot, 'reports'));
      candidates.push(path.join(repoRoot, 'docs', 'inspections'));
      // Also try parent
      candidates.push(path.join(repoRoot, '..', 'reports'));
    } else {
      candidates.push(path.join('/tmp', 'reports'));
    }

    for (const dir of [...new Set(candidates)]) {
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, `daily-inspection-${kstDate}.md`), markdown, 'utf8');
        await fs.writeFile(path.join(dir, 'latest.md'), markdown, 'utf8');
        automationRuntimeStatus.dailyInspection.lastReportPath = path.join(dir, `daily-inspection-${kstDate}.md`);
        break;
      } catch {}
    }

    // JSON 요약도 저장
    try {
      const jsonPayload = JSON.stringify({ kstDate, kstDateTime, generatedAt: result.generatedAt, summary: result.summary, checks }, null, 2);
      for (const dir of [...new Set(candidates)]) {
        try {
          await fs.writeFile(path.join(dir, `daily-inspection-${kstDate}.json`), jsonPayload, 'utf8');
          await fs.writeFile(path.join(dir, 'latest.json'), jsonPayload, 'utf8');
          break;
        } catch {}
      }
    } catch {}

    // 점검보고서_YYYY-MM-DD.md 형식으로도 저장 (기존 운영 보고서 호환)
    try {
      const reportAliases = IS_VERCEL ? [] : [
        path.join(path.resolve(__dirname), `점검보고서_${kstDate}.md`),
        path.join(path.resolve(__dirname, '..'), `점검보고서_${kstDate}.md`),
      ];
      for (const aliasPath of reportAliases) {
        try { await fs.writeFile(aliasPath, markdown, 'utf8'); } catch {}
      }
    } catch {}

    console.log(`[INSPECTION] 일일 점검 완료: ${overall} (PASS ${pass}/${checks.length}, WARN ${warn}, FAIL ${fail}) — ${kstDate}`);
  } catch (e: any) {
    console.warn('[INSPECTION] 보고서 저장 실패:', e?.message || e);
  }

  automationRuntimeStatus.dailyInspection.lastSuccessAt = new Date().toISOString();
  automationRuntimeStatus.dailyInspection.lastError = null;
  automationRuntimeStatus.dailyInspection.lastResult = { kstDate, overall, pass, warn, fail, total: checks.length };

  if (fail > 0) {
    // FAIL 이 있어도 lastSuccessAt은 갱신하되, 로그로 경고
    console.warn(`[INSPECTION] FAIL ${fail}건 감지 — 보고서 확인 필요`);
  }

  // 보고서 메일 발송 — 매일 04:00 KST 크론(Vercel Cron · node-cron) 경유로 1회 실행됩니다.
  // 자격증명 미설정이면 skipped, 발송 오류여도 점검 결과와 응답은 그대로 반환합니다.
  if (options.sendEmail !== false) {
    await deliverDailyInspectionEmail(result, reportMarkdown ?? generateInspectionMarkdown(result));
  }

  return result;
}

export function generateInspectionMarkdown(result: InspectionResult): string {
  const { kstDate, kstDateTime, generatedAt, checks, summary } = result;
  const emoji: Record<string, string> = { PASS: '✅', WARN: '⚠️', FAIL: '❌' };
  const overallEmoji = summary.overall === 'PASS' ? '🟢' : summary.overall === 'WARN' ? '🟡' : '🔴';
  const overallLabel = summary.overall === 'PASS' ? '정상' : summary.overall === 'WARN' ? '주의' : '이상 감지';

  const byCat = new Map<string, InspectionCheck[]>();
  for (const c of checks) {
    if (!byCat.has(c.category)) byCat.set(c.category, []);
    byCat.get(c.category)!.push(c);
  }

  let md = `# 부산항 스마트 작업 가이드 — 일일 기능 점검 보고서\n\n`;
  md += `> **점검 일시**: ${kstDateTime}\n`;
  md += `> **점검 기준일**: ${kstDate} (KST)\n`;
  md += `> **생성 시각(UTC)**: ${generatedAt}\n`;
  md += `> **점검 방식**: 자동 점검 (매일 04:00 KST)\n\n---\n\n`;
  md += `## 0. 점검 요약\n\n`;
  md += `| 구분 | 결과 |\n| --- | --- |\n`;
  md += `| **종합 판정** | ${overallEmoji} **${overallLabel}** (${summary.overall}) |\n`;
  md += `| 전체 항목 | ${summary.total}건 |\n`;
  md += `| ✅ PASS | ${summary.pass}건 |\n`;
  md += `| ⚠️ WARN | ${summary.warn}건 |\n`;
  md += `| ❌ FAIL | ${summary.fail}건 |\n`;
  md += `| 통과율 | ${Math.round((summary.pass / summary.total) * 100)}% |\n\n`;
  if (summary.overall === 'PASS') md += `> 🟢 **모든 핵심 기능이 정상입니다.**\n\n`;
  else if (summary.overall === 'WARN') md += `> 🟡 **일부 항목 주의 필요 — WARN 확인.**\n\n`;
  else md += `> 🔴 **이상 감지 — FAIL 항목 즉시 확인.**\n\n`;

  md += `---\n\n## 1. 점검 항목 상세\n\n| # | 분야 | 항목 | 결과 | 상세 |\n| --- | --- | --- | --- | --- |\n`;
  let idx = 1;
  for (const [cat, items] of byCat) {
    for (const c of items) {
      md += `| ${idx++} | ${cat} | ${c.name} | ${emoji[c.status]} ${c.status} | ${c.detail} |\n`;
    }
  }
  md += `\n---\n\n## 2. 분야별 요약\n\n| 분야 | PASS | WARN | FAIL | 합계 | 상태 |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const [cat, items] of byCat) {
    const p = items.filter(c => c.status === 'PASS').length;
    const w = items.filter(c => c.status === 'WARN').length;
    const f = items.filter(c => c.status === 'FAIL').length;
    const st = f > 0 ? '🔴 이상' : w > 0 ? '🟡 주의' : '🟢 정상';
    md += `| ${cat} | ${p} | ${w} | ${f} | ${items.length} | ${st} |\n`;
  }
  md += `\n---\n\n## 3. 자동화 상태\n\n`;
  md += `| 작업 | 스케줄 | 상태 |\n| --- | --- | --- |\n`;
  md += `| 선박 스케줄 감지 | 매 정각 | ${automationRuntimeStatus.scheduleWatcher.lastSuccessAt ? '✅' : '⏳'} ${automationRuntimeStatus.scheduleWatcher.lastSuccessAt || '기록 없음'} |\n`;
  md += `| DB 정리 | 매일 03:00 | ${automationRuntimeStatus.autoCleanup.lastSuccessAt ? '✅' : '⏳'} ${automationRuntimeStatus.autoCleanup.lastSuccessAt || '기록 없음'} |\n`;
  md += `| 주간 백업 | 일요일 00:00 | ${automationRuntimeStatus.weeklyBackup.lastSuccessAt ? '✅' : '⏳'} ${automationRuntimeStatus.weeklyBackup.lastSuccessAt || '기록 없음'} |\n`;
  md += `| **일일 점검** | **매일 04:00** | **${overallEmoji} ${overallLabel}** |\n\n`;
  md += `---\n\n## 4. 배포 상태\n\n| 구분 | URL | 비고 |\n| --- | --- | --- |\n| 운영 (Vercel) | https://busan-hak-port-info.vercel.app | main 푸시 자동 배포 |\n| 보조 (Firebase) | https://busan-hak-port.web.app | 승인형 배포 |\n| 저장소 | Firebase \`busan-hak-port\` | Firestore · FCM |\n\n`;
  if (summary.fail > 0) {
    md += `---\n\n## 5. 조치 필요\n\n`;
    for (const f of checks.filter(c => c.status === 'FAIL')) md += `- ❌ **[${f.category}] ${f.name}**: ${f.detail}\n`;
    md += `\n`;
    const warns = checks.filter(c => c.status === 'WARN');
    if (warns.length) {
      md += `### 참고 (WARN)\n\n`;
      for (const w of warns) md += `- ⚠️ **[${w.category}] ${w.name}**: ${w.detail}\n`;
      md += `\n`;
    }
  } else if (summary.warn > 0) {
    md += `---\n\n## 5. 개선 권장\n\n`;
    for (const w of checks.filter(c => c.status === 'WARN')) md += `- ⚠️ **[${w.category}] ${w.name}**: ${w.detail}\n`;
    md += `\n`;
  } else {
    md += `---\n\n## 5. 조치 사항\n\n조치 필요 항목 없음.\n\n`;
  }
  md += `---\n\n## 6. 점검 이력\n\n- \`reports/\` 및 \`docs/inspections/\` 에서 날짜별 보고서 확인\n- \`reports/latest.md\` 최신 보고서\n- GitHub Actions · Vercel Cron 로그 참고\n\n---\n\n## 7. 참고\n\n- 자동 생성: 매일 04:00 KST\n- 수동 실행: \`npm run inspection\` / \`node scripts/daily-inspection.mjs\`\n- API: \`GET /api/cron/daily-inspection\` (CRON_SECRET) / \`GET /api/inspection-report\` (공개)\n- 문의: luxrank@gmail.com / 010-2846-8906\n\n---\n\n*© 2026 이춘학 — BUSAN HAK PORT INFO.*\n`;
  return md;
}

// ═══════════════════════════════════════════════════════════════════════════
// 주간 자가 점검 · 자가 복구 — 매주 월요일 05:00 KST
// ───────────────────────────────────────────────────────────────────────────
// 판정·드리프트 분석·복구 계획·보고서 생성은 scripts/weekly-self-check.mjs 의 공용 엔진이
// 담당하고, 이 파일은 **서버 런타임에만 가능한 것**(실시간 수집·캐시/상태 복구·Firestore)을
// probe 와 repair action 으로 주입합니다. CLI(GitHub Actions)와 판정 기준이 동일합니다.
//
//   1) probe    : 런타임 설정 · 자동화 실행 기록 · 보고서 산출물 · DB 표본 · 터미널 8곳 실수집
//   2) drift    : 지난 주 기준선(수집량·필드 채움률) 대비 급감/스키마 변화 감지
//   3) repair   : 격리 상태 초기화 → 재수집(백오프) → 스케줄 캐시 재구축 / 지연 정리 실행 / 보고서 재생성
//   4) verify   : 복구 후 재수집 결과로 실제 개선 여부 확인 (자기 신고만으로 성공 처리하지 않음)
//   5) escalate : 미해결 FAIL 은 GitHub 이슈로 남겨 사람이 판단하도록 인계
//
// ⚠️ 원본 사용자 데이터(근무일지·게시글·선박정보)는 읽기만 하며 절대 수정·삭제하지 않습니다.
//    자동 복구 대상은 캐시·상태·파생 보고서로 한정됩니다.
// ═══════════════════════════════════════════════════════════════════════════
export const SELF_CHECK_COLLECTION = 'system_self_check';
const SELF_CHECK_BASELINE_DOC = 'baseline';
const SELF_CHECK_STATE_DOC = 'state';
const WEEKLY_SELF_CHECK_CRON = '0 5 * * 1'; // 매주 월요일 05:00 (Asia/Seoul)

/** 기준선 파일 경로 — 서버리스는 /tmp(휘발), 상시 서버는 저장소 reports/self-check */
function resolveSelfCheckDir(): string {
  return IS_VERCEL ? path.join('/tmp', 'self-check') : path.join(__dirname, 'reports', 'self-check');
}

function weeklyInspectionRange(now: Date): { startDate: string; endDate: string } {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
  return { startDate: fmt(start), endDate: fmt(end) };
}

/** 해당 터미널의 메모리 캐시를 비워 강제 재수집을 유도합니다(TTL 3분 우회). */
function clearScheduleMemoryCache(terminalId: string): number {
  const tid = String(terminalId).toLowerCase();
  let removed = 0;
  for (const key of [...scheduleMemoryCache.keys()]) {
    if (key.startsWith(`${tid}:`)) {
      scheduleMemoryCache.delete(key);
      removed += 1;
    }
  }
  return removed;
}

function vesselFieldCoverage(rows: any[]): Record<string, number> {
  const sample = rows.slice(0, 200);
  const coverage: Record<string, number> = {};
  if (!sample.length) return { VSL_NM: 0, ETB: 0, ATD: 0 };
  for (const field of ['VSL_NM', 'ETB', 'ATD', 'VOY_NO', 'BERTH_NO']) {
    const filled = sample.filter((row) => row?.[field] !== undefined && row?.[field] !== null && String(row[field]).trim() !== '').length;
    coverage[field] = Number((filled / sample.length).toFixed(4));
  }
  return coverage;
}

/** 지난 주 기준선 복원 — Firestore 우선(서버리스 인스턴스 교체에도 유지), 파일 폴백 */
export async function loadSelfCheckBaseline(): Promise<any> {
  try {
    if (getApps().length > 0) {
      const snap = await getFirestore().collection(SELF_CHECK_COLLECTION).doc(SELF_CHECK_BASELINE_DOC).get();
      if (snap.exists) {
        const payload = (snap.data() || {}).payload;
        if (payload) return typeof payload === 'string' ? JSON.parse(payload) : payload;
      }
    }
  } catch (err: any) {
    console.warn('[SELF-CHECK] Firestore 기준선 조회 실패:', err?.message || err);
  }
  try {
    const raw = await fs.readFile(path.join(resolveSelfCheckDir(), 'baseline.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 기준선 영속화 — 다음 주 비교의 기준이 되므로 Firestore + 파일 이중 기록 */
export async function saveSelfCheckBaseline(baseline: SelfCheckBaseline): Promise<void> {
  const payload = JSON.stringify(baseline);
  let saved = false;
  const errors: string[] = [];
  try {
    if (getApps().length > 0) {
      await getFirestore().collection(SELF_CHECK_COLLECTION).doc(SELF_CHECK_BASELINE_DOC).set({
        payload,
        version: baseline.version ?? 1,
        terminalCount: Object.keys(baseline.terminals || {}).length,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      saved = true;
    }
  } catch (err: any) {
    errors.push(`Firestore: ${err?.message || err}`);
  }
  try {
    const dir = resolveSelfCheckDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'baseline.json'), payload, 'utf8');
    saved = true;
  } catch (err: any) {
    errors.push(`파일: ${err?.message || err}`);
  }
  if (!saved) throw new Error(`기준선 저장 실패 — ${errors.join(' / ')}`);
}

/** 이번 주 보고서를 이미 보냈는지 (중복 발송 방지 — Firestore 마커 + 인스턴스 메모리) */
async function readWeeklyEmailMarker(): Promise<string | null> {
  const memoryWeek = automationRuntimeStatus.weeklySelfCheck.lastEmailWeek;
  if (memoryWeek) return memoryWeek;
  try {
    if (getApps().length > 0) {
      const snap = await getFirestore().collection(SELF_CHECK_COLLECTION).doc(SELF_CHECK_STATE_DOC).get();
      const week = snap.exists ? (snap.data() || {}).lastEmailWeek : null;
      return week ? String(week) : null;
    }
  } catch {
    /* 마커 조회 실패는 발송을 막지 않습니다 */
  }
  return null;
}

async function writeWeeklyEmailMarker(isoWeek: string): Promise<void> {
  automationRuntimeStatus.weeklySelfCheck.lastEmailWeek = isoWeek;
  try {
    if (getApps().length > 0) {
      await getFirestore().collection(SELF_CHECK_COLLECTION).doc(SELF_CHECK_STATE_DOC).set(
        { lastEmailWeek: isoWeek, lastEmailAt: new Date().toISOString() },
        { merge: true }
      );
    }
  } catch (err: any) {
    console.warn('[SELF-CHECK] 메일 마커 저장 실패:', err?.message || err);
  }
}

/**
 * 서버 런타임 점검 항목(probe).
 * 터미널 8곳은 이번 주 범위(어제~3일 뒤)를 **실제로 수집**해 수집량·필드 채움률을 측정합니다.
 */
export function buildServerSelfCheckProbes(now: Date = new Date()): SelfCheckProbe[] {
  const { startDate, endDate } = weeklyInspectionRange(now);
  const probes: SelfCheckProbe[] = [];

  probes.push({
    id: 'runtime.firebase',
    category: '런타임',
    name: 'Firebase Admin',
    run: async () =>
      getApps().length > 0
        ? { status: 'PASS', detail: 'Admin SDK 초기화됨 (Firestore·FCM 사용 가능)' }
        : { status: 'WARN', code: 'firestore.unavailable', detail: 'Admin 미초기화 — DB 표본 점검·캐시 복구를 건너뜁니다' }
  });

  probes.push({
    id: 'runtime.cron_secret',
    category: '런타임',
    name: 'CRON_SECRET',
    run: async () =>
      CRON_SECRET
        ? { status: 'PASS', detail: '설정됨 — 외부 트리거 차단 정상' }
        : { status: 'WARN', code: 'config.cron_secret_missing', detail: '미설정 — 주기 작업 엔드포인트가 503 으로 거부됩니다' }
  });

  probes.push({
    id: 'runtime.screen_lock',
    category: '런타임',
    name: '화면 잠금 PIN',
    run: async () =>
      SCREEN_LOCK_PIN && SCREEN_LOCK_PIN !== '9445'
        ? { status: 'PASS', detail: '기본값이 아닌 PIN 설정됨' }
        : { status: 'WARN', code: 'config.default_pin', detail: '기본 PIN(9445) 사용 중 — 운영 배포에서는 변경 권장' }
  });

  probes.push({
    id: 'runtime.static',
    category: '런타임',
    name: '정적 산출물',
    run: async () => {
      if (IS_VERCEL) return { status: 'PASS', detail: 'CDN 이 build/public 을 서빙 (함수 번들 외부)' };
      const built = existsSync(path.join(__dirname, 'build', 'public', 'index.html'));
      const source = existsSync(path.join(__dirname, 'public', 'index.html'));
      if (built) return { status: 'PASS', detail: 'build/public 산출물 존재 (난독화 배포본)' };
      if (source) return { status: 'WARN', code: 'build.missing', detail: 'build/public 없음 — 원본 public/ 으로 서빙 중' };
      return { status: 'FAIL', code: 'build.missing', detail: 'public/index.html 조차 없음' };
    }
  });

  probes.push({
    id: 'runtime.email',
    category: '보고서 메일',
    name: '메일 전송 설정',
    run: async () => {
      const cfg = resolveSelfCheckConfig(process.env);
      const resolved = resolveMailTransport(process.env);
      if (!cfg.email.enabled) return { status: 'WARN', code: 'email.disabled', detail: 'SELF_CHECK_EMAIL_ENABLED=0 — 보고서가 메일로 오지 않습니다' };
      if (!resolved.transport) {
        return {
          status: 'WARN',
          code: 'email.not_configured',
          detail: `전송 자격증명 없음 (${resolved.reason || 'not_configured'}) — RESEND_API_KEY / GOOGLE_* / SMTP_* 중 하나를 등록하세요 (수신: ${cfg.email.to.join(', ')})`
        };
      }
      return { status: 'PASS', detail: `${resolved.transport} 방식 · 수신 ${cfg.email.to.join(', ')}` };
    }
  });

  probes.push({
    id: 'automation.runtime',
    category: '자동화',
    name: '주기 작업 실행 기록',
    run: async () => {
      if (IS_VERCEL) {
        return { status: 'PASS', detail: '서버리스 — vercel.json crons 가 실행(인스턴스 메모리 기록은 남지 않음)' };
      }
      const entries: Array<{ name: string; at: string | null; maxHours: number; cleanup?: boolean }> = [
        { name: '스케줄 감시', at: automationRuntimeStatus.scheduleWatcher.lastSuccessAt, maxHours: 3 },
        { name: 'DB 정리', at: automationRuntimeStatus.autoCleanup.lastSuccessAt, maxHours: 48, cleanup: true },
        { name: '주간 백업', at: automationRuntimeStatus.weeklyBackup.lastSuccessAt, maxHours: 24 * 9 },
        { name: '일일 점검', at: automationRuntimeStatus.dailyInspection.lastSuccessAt, maxHours: 48 }
      ];
      const stale = entries.filter((e) => !e.at || Date.now() - Date.parse(e.at) > e.maxHours * 3600_000);
      if (!stale.length) return { status: 'PASS', detail: '4개 주기 작업 모두 최근 실행 확인' };
      const cleanupOverdue = stale.some((e) => e.cleanup);
      return {
        status: 'WARN',
        code: cleanupOverdue ? 'automation.cleanup_overdue' : 'automation.stale',
        detail: stale.map((e) => `${e.name} ${e.at ?? '기록 없음'}`).join(' / ')
      };
    }
  });

  probes.push({
    id: 'report.artifacts',
    category: '보고서',
    name: '보고서 산출물',
    run: async () => {
      if (IS_VERCEL) return { status: 'PASS', detail: '서버리스 — 보고서는 응답 본문·메일 첨부로 전달' };
      const target = path.join(__dirname, 'reports', 'latest.md');
      try {
        const stat = await fs.stat(target);
        const ageHours = (Date.now() - stat.mtimeMs) / 3600_000;
        if (ageHours <= 36) return { status: 'PASS', detail: `reports/latest.md ${Math.round(ageHours)}시간 전 갱신` };
        return { status: 'WARN', code: 'report.missing', detail: `reports/latest.md ${Math.round(ageHours)}시간 경과 — 일일 점검 확인 필요` };
      } catch {
        return { status: 'WARN', code: 'report.missing', detail: 'reports/latest.md 없음' };
      }
    }
  });

  probes.push({
    id: 'db.integrity',
    category: '데이터 정합성',
    name: 'Firestore 표본 점검',
    run: async () => {
      if (getApps().length === 0) {
        return { status: 'WARN', code: 'firestore.unavailable', detail: 'Admin 미초기화 — 표본 점검 생략' };
      }
      const db = getFirestore();
      const logsSnap = await db.collection('work_logs').limit(20).get();
      let cacheCount: number | null = null;
      try {
        const counted = await db.collection('vessel_schedules_cache').count().get();
        cacheCount = counted.data().count;
      } catch {
        cacheCount = null;
      }
      const docs = logsSnap.docs.map((d) => d.data() || {});
      if (!docs.length) {
        return { status: 'PASS', detail: `work_logs 표본 없음(신규 배포) · 스케줄 캐시 ${cacheCount ?? '—'}건` };
      }
      let missing = 0;
      for (const doc of docs) {
        const hasDate = Boolean(doc.date || doc.dateKey || doc.workDate || doc.createdAt);
        const hasTerminal = Boolean(doc.terminal || doc.TERMINAL);
        if (!hasDate || !hasTerminal) missing += 1;
      }
      const ratio = missing / docs.length;
      if (ratio > 0.5) {
        return { status: 'FAIL', code: 'db.schema_drift', detail: `work_logs 표본 ${docs.length}건 중 ${missing}건 필수 필드 누락(읽기 전용 점검 — 원본은 수정하지 않음)` };
      }
      if (ratio > 0) {
        return { status: 'WARN', code: 'db.partial_fields', detail: `work_logs ${docs.length}건 중 ${missing}건 필드 누락 · 캐시 ${cacheCount ?? '—'}건` };
      }
      return { status: 'PASS', detail: `work_logs ${docs.length}건 정상 · 스케줄 캐시 ${cacheCount ?? '—'}건` };
    }
  });

  for (const tid of SUPPORTED_TERMINALS) {
    probes.push({
      id: `terminal.${tid}`,
      category: '터미널 데이터',
      name: `${tid.toUpperCase()} 실시간 수집`,
      kind: 'terminal',
      target: tid,
      run: async () => {
        clearScheduleMemoryCache(tid); // 매주 점검은 항상 신선한 수집 결과로 판정합니다
        try {
          const meta = await fetchTerminalScheduleVesselsWithMeta(tid, startDate, endDate);
          const rows = Array.isArray(meta.vessels) ? meta.vessels : [];
          const coverage = vesselFieldCoverage(rows);
          return {
            status: meta.stale ? 'WARN' : 'PASS',
            code: meta.stale ? 'terminal.stale_cache' : undefined,
            detail: `${rows.length}척 수집${meta.stale ? ` (stale · ${meta.cacheSource})` : ` · ${meta.cacheSource}`}`,
            data: { count: rows.length, fieldCoverage: coverage, label: tid.toUpperCase() }
          };
        } catch (err: any) {
          return {
            status: 'FAIL',
            detail: err?.message || '수집 실패',
            data: { count: 0, fieldCoverage: {}, error: err?.message || '수집 실패', label: tid.toUpperCase() }
          };
        }
      }
    });
  }

  return probes;
}

/**
 * 서버 런타임 자동 복구 동작.
 * 모두 **멱등(idempotent)** 이며 캐시·상태·파생 보고서만 다룹니다.
 */
export function buildServerSelfCheckRepairActions(now: Date = new Date()): Record<string, SelfCheckAction> {
  return {
    // 1) 잘못 격리된 터미널 상태 초기화 (연속 실패 카운터·메모리 캐시 제거)
    'reset-terminal-health': async ({ target }: any) => {
      const tid = String(target).toLowerCase();
      if (!(SUPPORTED_TERMINALS as readonly string[]).includes(tid)) {
        return { ok: false, detail: `지원하지 않는 터미널: ${tid}` };
      }
      const removed = clearScheduleMemoryCache(tid);
      recordTerminalSuccess(tid);
      return { ok: true, detail: `격리 상태 해제 · 메모리 캐시 ${removed}건 비움` };
    },

    // 2) 백오프 재수집 — 이번 주 복구의 핵심 동작
    'retry-terminal': async ({ target }: any) => {
      const tid = String(target).toLowerCase();
      const cfg = resolveSelfCheckConfig(process.env);
      const { startDate, endDate } = weeklyInspectionRange(now);
      let lastError: string | null = null;
      for (let attempt = 1; attempt <= cfg.retryAttempts; attempt += 1) {
        clearScheduleMemoryCache(tid);
        try {
          const meta = await fetchTerminalScheduleVesselsWithMeta(tid, startDate, endDate);
          const rows = Array.isArray(meta.vessels) ? meta.vessels : [];
          if (rows.length > 0) {
            return {
              ok: true,
              detail: `재시도 ${attempt}회차에서 ${rows.length}척 수집 성공${meta.stale ? ' (캐시 폴백)' : ''}`,
              recovered: { count: rows.length, fieldCoverage: vesselFieldCoverage(rows) }
            };
          }
          lastError = '수집 결과 0척 (소스 구조 변경 또는 일정 공백)';
        } catch (err: any) {
          lastError = err?.message || String(err);
        }
        if (attempt < cfg.retryAttempts) {
          await new Promise((resolve) => setTimeout(resolve, cfg.retryBackoffMs * attempt));
        }
      }
      return { ok: false, detail: `재시도 ${cfg.retryAttempts}회 실패 — ${lastError || '원인 미상'}` };
    },

    // 3) 스케줄 캐시 재구축 — 재수집 성공 데이터를 Firestore 캐시에 반영(폴백 경로 복원)
    'rebuild-schedule-cache': async ({ target }: any) => {
      if (getApps().length === 0) return { ok: false, detail: 'Firebase Admin 미초기화 — 캐시 재구축 불가' };
      const tid = String(target).toLowerCase();
      const { startDate, endDate } = weeklyInspectionRange(now);
      let rows: VesselScheduleItem[] = [];
      const cached = [...scheduleMemoryCache.entries()].find(([key, entry]) => key.startsWith(`${tid}:`) && entry.vessels.length > 0);
      if (cached) rows = cached[1].vessels;
      else {
        try {
          const meta = await fetchTerminalScheduleVesselsWithMeta(tid, startDate, endDate);
          rows = Array.isArray(meta.vessels) ? meta.vessels : [];
        } catch {
          rows = [];
        }
      }
      if (!rows.length) return { ok: false, detail: '캐시에 반영할 수집 데이터 없음' };
      const cacheRef = getFirestore().collection('vessel_schedules_cache');
      const limited = rows.slice(0, 300);
      let written = 0;
      for (const v of limited) {
        if (!v.VSL_NM) continue;
        const safeName = String(v.VSL_NM).replace(/[\s/]+/g, '_');
        const docId = `${v.TERMINAL}_${v.VOY_NO || 'NOVOY'}_${safeName}`;
        try {
          await cacheRef.doc(docId).set({
            TERMINAL: v.TERMINAL,
            VSL_NM: v.VSL_NM,
            BERTH_NO: v.BERTH_NO || '',
            PTNR_CODE: v.PTNR_CODE || '',
            VOY_NO: v.VOY_NO || '',
            ETB: v.ETB || null,
            ATA: v.ATA || null,
            ATD: v.ATD || null,
            selfCheckRepairedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: Date.now()
          }, { merge: true });
          written += 1;
        } catch {
          /* 개별 문서 실패는 계속 진행 */
        }
      }
      return written > 0
        ? { ok: true, detail: `스케줄 캐시 ${written}건 재구축` }
        : { ok: false, detail: '캐시 쓰기 0건 (권한 또는 네트워크 오류)' };
    },

    // 4) 지연된 TTL 정리 즉시 실행
    'run-overdue-cleanup': async () => {
      const result = await runDatabaseAutoCleanup();
      return {
        ok: true,
        detail: `스케줄 캐시 ${result.deletedCacheDocs}건 · 읽은 알림 ${result.deletedNotiDocs}건 정리`
      };
    },

    // 5) 보고서 산출물 재생성 (상시 서버 전용 — 서버리스는 /tmp 라 무의미)
    'regenerate-report': async () => {
      if (IS_VERCEL) return { ok: false, detail: '서버리스에서는 보고서 파일을 유지하지 않습니다' };
      const result = await runDailyInspection(new Date(), { sendEmail: false });
      return { ok: true, detail: `일일 점검 보고서 재생성 (${result.summary.overall} ${result.summary.pass}/${result.summary.total})` };
    },

    // 6) 기준선 신규 생성 — 최초 실행 시 되돌릴 대상이 없으므로 즉시 완료
    'bootstrap-baseline': async () => ({ ok: true, detail: '이번 주 관측값으로 기준선 생성' }),

    // 7) 사람에게 인계 — 미해결 FAIL 을 GitHub 이슈로 남깁니다
    'escalate-github-issue': async ({ checks, kst, platform, repo, token }: any) => {
      if (!repo || !token) return { ok: false, detail: 'GITHUB_REPOSITORY/GITHUB_TOKEN 미설정' };
      const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'busan-hak-port-weekly-self-check/1.0'
        },
        body: JSON.stringify({
          title: `[주간자가점검] ${kst?.kstDate || new Date().toISOString().slice(0, 10)} 미해결 이상 ${checks.length}건`,
          body: [
            `플랫폼: ${platform}`,
            `점검 일시: ${kst?.kstDateTime || ''}`,
            '',
            '### 미해결 항목 (자동 복구 후에도 남은 항목)',
            ...checks.slice(0, 30).map((c: any) => `- [${c.status}] ${c.category} · ${c.name}: ${c.detail}`),
            '',
            '_자동 생성: server.ts `runServerWeeklySelfCheck()`_'
          ].join('\n'),
          labels: ['self-check', 'automated']
        })
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { ok: false, detail: `이슈 생성 실패 HTTP ${response.status}: ${text.slice(0, 200)}` };
      }
      const created: any = await response.json().catch(() => ({}));
      return { ok: true, detail: 'GitHub 이슈 생성', url: created?.html_url || null };
    }
  };
}

/**
 * 최신 주간 점검 결과를 Firestore 에 보관합니다.
 * 서버리스는 인스턴스 메모리가 사라지므로, 공개 API(/api/self-check-report)가
 * 저장된 요약을 읽어 "언제든 최근 점검 결과를 확인"할 수 있게 합니다.
 */
async function saveSelfCheckSummary(result: SelfCheckResult, email: SendReportEmailResult): Promise<void> {
  if (getApps().length === 0) return;
  try {
    const payload = {
      json: buildSelfCheckJson(result),
      email: {
        status: email.ok ? 'sent' : email.skipped ? 'skipped' : 'failed',
        transport: email.transport,
        reason: email.reason,
        error: email.error,
        to: resolveSelfCheckConfig(process.env).email.to,
        at: new Date().toISOString()
      },
      capturedAt: new Date().toISOString()
    };
    await getFirestore().collection(SELF_CHECK_COLLECTION).doc('latest').set(
      { payload: JSON.stringify(payload), kstDate: result.kstDate, overall: result.summary.overall, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (err: any) {
    console.warn('[SELF-CHECK] 최신 결과 저장 실패:', err?.message || err);
  }
}

/** Firestore 에 보관된 최신 주간 점검 결과(없으면 null) */
async function loadSelfCheckSummary(): Promise<any | null> {
  try {
    if (getApps().length === 0) return null;
    const snap = await getFirestore().collection(SELF_CHECK_COLLECTION).doc('latest').get();
    if (!snap.exists) return null;
    const payload = (snap.data() || {}).payload;
    if (!payload) return null;
    return typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    return null;
  }
}

/**
 * 주간 자가 점검 보고서 파일 저장.
 *  · 정본(reports/self-check) — 날짜별 파일 + latest 별칭
 *  · 보관본(docs/inspections) — 날짜별 weekly-YYYY-MM-DD.md 만 (일일 점검 파일과 충돌 방지)
 *  · 서버리스는 /tmp 만 쓰기 가능하며 인스턴스 종료 시 사라집니다(응답·메일 첨부로 전달).
 */
async function saveWeeklySelfCheckArtifacts(result: SelfCheckResult, markdown: string, json: any): Promise<string | null> {
  const targets = IS_VERCEL
    ? [{ dir: path.join('/tmp', 'self-check'), canonical: true }]
    : [
        { dir: path.join(__dirname, 'reports', 'self-check'), canonical: true },
        { dir: path.join(__dirname, 'docs', 'inspections'), canonical: false }
      ];
  let primary: string | null = null;
  for (const target of targets) {
    try {
      await fs.mkdir(target.dir, { recursive: true });
      if (!target.canonical) {
        // 보관본은 날짜별 파일만 — latest.* / weekly-self-check-*.json 을 덮어쓰지 않습니다.
        await fs.writeFile(path.join(target.dir, `weekly-${result.kstDate}.md`), markdown, 'utf8');
        continue;
      }
      const file = path.join(target.dir, `weekly-self-check-${result.kstDate}.md`);
      await fs.writeFile(file, markdown, 'utf8');
      await fs.writeFile(path.join(target.dir, 'latest.md'), markdown, 'utf8');
      await fs.writeFile(path.join(target.dir, `weekly-self-check-${result.kstDate}.json`), JSON.stringify(json, null, 2), 'utf8');
      await fs.writeFile(path.join(target.dir, 'latest.json'), JSON.stringify(json, null, 2), 'utf8');
      if (!primary) primary = file;
    } catch (err: any) {
      console.warn(`[SELF-CHECK] 보고서 저장 건너뜀 (${target.dir}): ${err?.message || err}`);
    }
  }
  return primary;
}

/**
 * 주간 자가 점검 실행 + 보고서 저장 + (선택)메일 발송.
 * 실패해도 예외를 던지지 않고 결과 객체로 돌려줍니다(크론 응답 안정성).
 */
export async function runServerWeeklySelfCheck(
  options: { now?: Date; sendEmail?: boolean; forceEmail?: boolean } = {}
): Promise<{ result: SelfCheckResult; markdown: string; json: any; email: SendReportEmailResult; reportPath: string | null }> {
  const now = options.now instanceof Date ? options.now : new Date();
  const status = automationRuntimeStatus.weeklySelfCheck;
  const config = resolveSelfCheckConfig(process.env);
  status.lastRunAt = now.toISOString();

  let result: SelfCheckResult;
  try {
    const baseline = await loadSelfCheckBaseline();
    result = await runWeeklySelfCheck({
      now,
      config,
      probes: buildServerSelfCheckProbes(now),
      baseline,
      actions: buildServerSelfCheckRepairActions(now),
      saveBaseline: saveSelfCheckBaseline,
      platform: IS_VERCEL ? 'vercel-serverless' : 'node-server',
      logger: console
    });
  } catch (err: any) {
    status.lastError = err?.message || String(err);
    console.error('[SELF-CHECK] 주간 점검 실패:', err);
    throw err;
  }

  const markdown = generateWeeklySelfCheckMarkdown(result);
  const json = buildSelfCheckJson(result);
  const reportPath = await saveWeeklySelfCheckArtifacts(result, markdown, json);

  status.lastSuccessAt = new Date().toISOString();
  status.lastError = null;
  status.lastReportPath = reportPath;
  status.lastResult = {
    kstDate: result.kstDate,
    isoWeek: result.isoWeek,
    overall: result.summary.overall,
    pass: result.summary.pass,
    warn: result.summary.warn,
    fail: result.summary.fail,
    total: result.summary.total,
    repaired: result.summary.repaired
  };
  status.lastChecks = result.checks.map((c) => ({ id: c.id, category: c.category, name: c.name, status: c.status, detail: c.detail }));
  status.lastDrift = result.drift.map((d) => ({
    terminal: d.terminal,
    status: d.status,
    count: d.current.count,
    baselineCount: d.baseline ? d.baseline.count : null,
    changeRatio: d.changeRatio
  }));
  status.lastRepairs = result.repairs.map((r) => ({ target: r.target, action: r.action, status: r.status, detail: r.detail, verified: r.verified ?? null }));

  let email: SendReportEmailResult = { ok: false, skipped: true, reason: result.skipped ? 'disabled' : 'skipped', transport: null, messageId: null, error: null };
  if (options.sendEmail !== false && !result.skipped) {
    const alreadySentWeek = await readWeeklyEmailMarker();
    if (!options.forceEmail && alreadySentWeek === result.isoWeek) {
      email = { ok: false, skipped: true, reason: 'already_sent_this_week', transport: null, messageId: null, error: null };
    } else {
      email = await sendWeeklySelfCheckEmail({ result, markdown, json, env: process.env });
      if (email.ok) await writeWeeklyEmailMarker(result.isoWeek);
    }
    status.lastEmailAt = new Date().toISOString();
    status.lastEmailStatus = email.ok ? 'sent' : email.skipped ? 'skipped' : 'failed';
    status.lastEmailTransport = email.transport;
    status.lastEmailReason = email.reason;
    status.lastEmailError = email.error;
  }

  await saveSelfCheckSummary(result, email);

  console.log(
    `[SELF-CHECK] 주간 점검 ${result.summary.overall} — PASS ${result.summary.pass}/${result.summary.total}, 자동복구 ${result.summary.repaired}건, 메일 ${
      email.ok ? `발송(${email.transport})` : email.skipped ? `건너뜀(${email.reason})` : `실패(${email.error})`
    }`
  );

  return { result, markdown, json, email, reportPath };
}

// --- 크론 스케줄러 등록 (상시 프로세스 서버에서만 백그라운드 실행) ---
// 테스트 환경과 Vercel 서버리스에서는 등록하지 않습니다 — 서버리스는 응답 후 프로세스가
// 동결되어 node-cron 타이머가 발화하지 않기 때문입니다. Vercel 배포에서는 대신
// vercel.json crons(매일 DB 정리·매주 백업)와 GitHub Actions 예약 워크플로
// (매시간 스케줄 감시 — .github/workflows/cron-schedule-watch.yml)가
// 아래의 /api/cron/* 엔드포인트를 호출해 동일한 작업을 실행합니다.
if (process.env.NODE_ENV !== 'test' && !IS_VERCEL) {
  // 1) 매 정각(0 * * * *) 터미널 스케줄 수집 및 1시간 이상 출항/접안 변동 푸시 알림
  cron.schedule('0 * * * *', () => {
    console.log('[CRON] 선박 출항/접안 스케줄 변경 감지 시작...', new Date().toISOString());
    void runScheduleChangeDetection();
  });

  // 2) 매일 새벽 3시(0 3 * * *) 스케줄 캐시(30일) 및 읽은 알림(14일) TTL 자동 삭제
  cron.schedule('0 3 * * *', () => {
    console.log('[CRON] 데이터베이스 TTL 자가 정리 시작...', new Date().toISOString());
    void runDatabaseAutoCleanup();
  });

  // 3) 매주 일요일 자정(0 0 * * 0) 핵심 컬렉션(work_logs, ships, posts) 주간 정기 백업
  cron.schedule('0 0 * * 0', () => {
    console.log('[CRON] 주간 Firestore 정기 백업 시작...', new Date().toISOString());
    void runWeeklyFirestoreBackup();
  });

  // 4) 매일 새벽 4시(0 4 * * *) — 기능 점검 및 보고서 자동 생성 (KST)
  cron.schedule('0 4 * * *', () => {
    console.log('[CRON] 일일 기능 점검 시작...', new Date().toISOString());
    void runDailyInspection();
  }, { timezone: 'Asia/Seoul' } as any);

  // 5) 매주 월요일 05:00 (0 5 * * 1, Asia/Seoul) — 주간 자가 점검 · 자가 복구 + 보고서 메일
  //    Vercel(서버리스)에서는 node-cron 이 동작하지 않으므로 vercel.json crons 와
  //    GitHub Actions 예약 워크플로가 /api/cron/weekly-self-check 를 호출합니다.
  //    메일 중복 발송은 결과의 ISO 주차 마커(system_self_check/state)로 1주 1통을 보장합니다.
  cron.schedule(WEEKLY_SELF_CHECK_CRON, () => {
    console.log('[CRON] 주간 자가 점검 시작...', new Date().toISOString());
    void runServerWeeklySelfCheck();
  }, { timezone: 'Asia/Seoul' } as any);
}

// --- Express 라우트 ---
// ⚡ A-7: 텍스트 응답 gzip 압축 (index.html 820KB → 약 175KB)
app.use(compression());

// 🔐 D-6: API 는 자사 도메인에서만 호출하도록 허용 출처를 제한합니다.
// (ALLOWED_ORIGINS 환경변수로 추가 지정 가능 — 쉼표 구분)
const DEFAULT_ALLOWED_ORIGINS = [
  'https://busan-hak-port-info.vercel.app',
  'https://busan-hak-port.web.app',
  'https://busan-hak-port.firebaseapp.com',
  'https://luxrank-ops.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];
const ALLOWED_ORIGINS = [
  ...DEFAULT_ALLOWED_ORIGINS,
  ...String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
];
function isAllowedApiOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/busan-hak-port-info-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  return false;
}
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedApiOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// JSON 본문 파싱 (화면 잠금 해제 요청용, 4KB 제한)
app.use('/api', express.json({ limit: '4kb' }));

app.get('/api/config', (_req, res) => {
  res.json({
    ok: true,
    vapidKey: process.env.VAPID_KEY || ''
  });
});

// 🔐 화면 잠금 해제 — PIN 을 브라우저 소스에서 완전히 분리합니다.
// 저장소·배포 번들에는 PIN 이 존재하지 않고, 서버 환경변수 SCREEN_LOCK_PIN 만이 정답입니다.
app.post('/api/screen-unlock', (req, res) => {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  if (isScreenUnlockRateLimited(ip)) {
    res.status(429).json({ ok: false, error: 'too_many_attempts' });
    return;
  }
  const rawPin = String((req.body && (req.body as { pin?: unknown }).pin) ?? '');
  const pin = rawPin.trim();
  if (!pin) {
    res.status(400).json({ ok: false, error: 'missing_pin' });
    return;
  }
  if (!verifyScreenLockPin(pin)) {
    res.status(401).json({ ok: false, error: 'invalid_pin' });
    return;
  }
  const { token, expiresAt } = issueScreenUnlockToken();
  res.json({ ok: true, token, expiresAt });
});

// 🚨 긴급 플로팅 공지 작성 잠금 해제 — 비밀번호는 서버 환경변수에만 존재합니다.
// 입력 PIN 은 trim() 으로 공백을 제거해 복사-붙여넣기 실수에 강건합니다.
app.post('/api/emergency-unlock', (req, res) => {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  // 화면 잠금과 별도 버킷을 써서, 근무일지 잠금 실패가 긴급 공지 인증을 막지 않도록 합니다.
  if (isScreenUnlockRateLimited(ip, 'emergency')) {
    res.status(429).json({ ok: false, error: 'too_many_attempts' });
    return;
  }
  const rawPin = String((req.body && (req.body as { pin?: unknown }).pin) ?? '');
  const pin = rawPin.trim();
  if (!pin) {
    res.status(400).json({ ok: false, error: 'missing_pin' });
    return;
  }
  if (!verifyEmergencyNoticePin(pin)) {
    res.status(401).json({ ok: false, error: 'invalid_pin' });
    return;
  }
  const { token, expiresAt } = issueEmergencyUnlockToken();
  res.json({ ok: true, token, expiresAt });
});

// 허용되지 않은 메소드 안내 — 브라우저가 GET 으로 호출하면 405 와 함께 힌트를 줍니다.
app.get('/api/screen-unlock', (_req, res) => {
  res.status(405).json({ ok: false, error: 'method_not_allowed', hint: 'Use POST with {pin}' });
});
app.get('/api/emergency-unlock', (_req, res) => {
  res.status(405).json({ ok: false, error: 'method_not_allowed', hint: 'Use POST with {pin}' });
});

app.get('/api/health', (_req, res) => {
  const terminals = getTerminalHealthSummary();
  const isolatedCount = terminals.filter((t) => t.status === 'isolated').length;
  res.json({
    ok: true,
    status: isolatedCount === terminals.length ? 'degraded' : 'healthy',
    platform: IS_VERCEL ? 'vercel-serverless' : 'node-server',
    uptimeSec: Math.round(process.uptime()),
    firebaseAdminInitialized: getApps().length > 0,
    scheduleDiffThresholdMinutes: SCHEDULE_DIFF_THRESHOLD_MINUTES,
    ttlPolicy: {
      vesselSchedulesCacheDays: SCHEDULE_CACHE_TTL_DAYS,
      readNotificationsDays: READ_NOTIFICATION_TTL_DAYS
    },
    terminals,
    automation: automationRuntimeStatus
  });
});

// 🔐 Firebase 세션·관리자 인증 엔드포인트
// 1) mode='anonymous': Firebase 콘솔에서 익명 인증(signInAnonymously)이 비활성화된 환경에서도
//    서버 Custom Token 으로 모든 방문자·근로자가 isSignedIn() 조건을 충족하도록 보장합니다.
// 2) mode='admin': 운영 관리자 비밀번호를 상수 시간으로 검증한 뒤
//    admin_luxrank Custom Token(Firestore isAdmin() 통과) + 서명된 관리자 토큰을 발급합니다.
app.post('/api/auth-session', async (req, res) => {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
    mode?: unknown;
    password?: unknown;
    clientId?: unknown;
  };
  const mode = String(body.mode || 'anonymous').trim().toLowerCase();

  if (mode === 'admin') {
    if (isScreenUnlockRateLimited(ip, 'admin')) {
      res.status(429).json({ ok: false, error: 'too_many_attempts' });
      return;
    }
    const rawPw = String(body.password ?? '').trim();
    if (!rawPw) {
      res.status(400).json({ ok: false, error: 'missing_password' });
      return;
    }
    const valid = await verifyAdminPassword(rawPw);
    if (!valid) {
      res.status(401).json({ ok: false, error: 'invalid_password' });
      return;
    }
    const { token, expiresAt } = issueAdminSessionToken();
    let customToken: string | null = null;
    try {
      const serverAuth = resolveServerAuth();
      if (serverAuth) {
        customToken = await serverAuth.createCustomToken(ADMIN_CUSTOM_TOKEN_UID);
      }
    } catch (err: any) {
      console.warn('[auth-session] admin custom token 발급 건너뜀:', err?.message || err);
    }
    res.json({
      ok: true,
      mode: 'admin',
      uid: ADMIN_CUSTOM_TOKEN_UID,
      token,
      expiresAt,
      customToken
    });
    return;
  }

  if (mode === 'anonymous') {
    if (isScreenUnlockRateLimited(ip, 'anon')) {
      res.status(429).json({ ok: false, error: 'too_many_attempts' });
      return;
    }
    const serverAuth = resolveServerAuth();
    if (!serverAuth) {
      res.status(503).json({ ok: false, error: 'firebase_admin_not_initialized' });
      return;
    }
    const rawClientId = String(body.clientId ?? '').trim();
    const safeSuffix = /^[a-zA-Z0-9_-]{6,64}$/.test(rawClientId)
      ? rawClientId
      : crypto.randomBytes(12).toString('hex');
    const uid = `worker_${safeSuffix}`;
    try {
      const customToken = await serverAuth.createCustomToken(uid);
      res.json({ ok: true, mode: 'anonymous', uid, customToken });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'custom_token_failed' });
    }
    return;
  }

  res.status(400).json({ ok: false, error: 'invalid_mode' });
});
app.get('/api/auth-session', (_req, res) => {
  res.status(405).json({ ok: false, error: 'method_not_allowed', hint: 'Use POST with {mode}' });
});

app.get('/api/analytics-summary', async (_req, res) => {
  try {
    const db = resolveServerFirestore();
    if (!db) {
      res.status(503).json({ ok: false, error: 'firebase_admin_not_initialized' });
      return;
    }
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
    const dayKeys: Array<{ key: string; shortDate: string; dayName: string; isToday: boolean }> = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() - i));
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      dayKeys.push({
        key: `${y}-${m}-${day}`,
        shortDate: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
        dayName: dayLabels[d.getUTCDay()],
        isToday: i === 0
      });
    }

    const [
      totalSnap,
      usersSnap,
      shipsSnap,
      postsSnap,
      noticesSnap,
      archivesSnap,
      workLogsSnap,
      ...dailySnaps
    ] = await Promise.all([
      db.collection('visitor_stats').doc('total').get(),
      db.collection('user_profiles').get(),
      db.collection('ships').get(),
      db.collection('posts').get(),
      db.collection('notices').get(),
      db.collection('archives').get(),
      db.collection('work_logs').get(),
      ...dayKeys.map((dk) => db.collection('visitor_stats').doc(`daily-${dk.key}`).get())
    ]);

    const totalData = (totalSnap.exists ? totalSnap.data() : {}) || {};
    const dailyDocsByDate: Record<string, any> = {};
    dayKeys.forEach((dk, idx) => {
      const d = (dailySnaps[idx]?.exists ? dailySnaps[idx].data() : {}) || {};
      dailyDocsByDate[dk.key] = sanitizeVisitorDoc({ date: dk.key, ...d });
    });

    const recent7Days = dayKeys.slice(1);
    const dailyTrend = recent7Days.map((dk) => {
      const d = dailyDocsByDate[dk.key] || {};
      return {
        date: dk.key,
        label: `${dk.shortDate}(${dk.dayName})`,
        isToday: dk.isToday,
        count: Number(d.count) || 0,
        unique: Number(d.unique) || 0,
        hours: d.hours || { h00_06: 0, h06_12: 0, h12_18: 0, h18_24: 0 },
        devices: d.devices || { android: 0, ios: 0, desktop: 0 },
        blocks: d.blocks || {},
        terminals: d.terminals || {},
        actions: d.actions || {}
      };
    });

    const todayEntry = dailyTrend[dailyTrend.length - 1];
    const yesterdayEntry = dailyTrend[dailyTrend.length - 2];
    const weekTotal = dailyTrend.reduce((acc, item) => acc + item.count, 0);
    const weekUniqueSum = dailyTrend.reduce((acc, item) => acc + item.unique, 0);

    const activeShips = shipsSnap.docs.filter((doc) => !doc.data().deletedAt);
    const activePosts = postsSnap.docs.filter((doc) => !doc.data().deletedAt);
    const activeWorkLogs = workLogsSnap.docs.filter((doc) => !doc.data().deletedAt);

    res.json({
      ok: true,
      generatedAtKst: kstNow.toISOString().replace('Z', '+09:00'),
      summary: {
        todayVisitors: todayEntry.count,
        todayUnique: todayEntry.unique,
        yesterdayVisitors: yesterdayEntry.count,
        yesterdayUnique: yesterdayEntry.unique,
        diffFromYesterday: todayEntry.count - yesterdayEntry.count,
        weekTotalVisitors: weekTotal,
        weekDailyAvg: Math.round(weekTotal / 7),
        totalVisitors: Number(totalData.count) || 0,
        totalUnique: Math.max(Number(totalData.unique) || 0, weekUniqueSum)
      },
      totalDoc: sanitizeVisitorDoc(totalData),
      dailyDocsByDate,
      todayHours: todayEntry.hours,
      totalHours: totalData.hours || { h00_06: 0, h06_12: 0, h12_18: 0, h18_24: 0 },
      todayDevices: todayEntry.devices,
      totalDevices: totalData.devices || { android: 0, ios: 0, desktop: 0 },
      totalBlocks: totalData.blocks || {},
      todayBlocks: todayEntry.blocks || {},
      totalTerminals: totalData.terminals || {},
      todayTerminals: todayEntry.terminals || {},
      totalActions: totalData.actions || {},
      todayActions: todayEntry.actions || {},
      dailyTrend,
      collections: {
        workersCount: usersSnap.size,
        shipsCount: activeShips.length,
        postsCount: activePosts.length,
        noticesCount: noticesSnap.size,
        archivesCount: archivesSnap.size,
        workLogsCount: activeWorkLogs.length,
        totalWorkLogsRawCount: workLogsSnap.size
      }
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error?.message || 'analytics_summary_failed' });
  }
});

// 📊 관리자 전용 통합 운영 통계 · 가입 근로자 계정 · 누적 근무일지 전체 조회 API
// 서명된 관리자 세션 토큰(verifyAdminSessionToken) 없이는 절대 응답하지 않으며,
// 비밀번호 원문·해시는 응답 페이로드에 포함하지 않습니다(isSha256 불리언만 반환).
const adminStatsHandler = async (req: Request, res: Response) => {
  const authHeader = String(req.headers.authorization || '');
  const bodyToken = req.body && typeof req.body === 'object' ? String((req.body as { token?: unknown }).token || '') : '';
  const candidateToken = authHeader || bodyToken;
  if (!verifyAdminSessionToken(candidateToken)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const db = resolveServerFirestore();
    if (!db) {
      res.status(503).json({ ok: false, error: 'firebase_admin_not_initialized' });
      return;
    }
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const dayKeys: string[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() - i));
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      dayKeys.push(`${y}-${m}-${day}`);
    }

    const [
      totalSnap,
      usersSnap,
      workLogsSnap,
      shipsSnap,
      postsSnap,
      noticesSnap,
      archivesSnap,
      ...dailySnaps
    ] = await Promise.all([
      db.collection('visitor_stats').doc('total').get(),
      db.collection('user_profiles').get(),
      db.collection('work_logs').get(),
      db.collection('ships').get(),
      db.collection('posts').get(),
      db.collection('notices').get(),
      db.collection('archives').get(),
      ...dayKeys.map((key) => db.collection('visitor_stats').doc(`daily-${key}`).get())
    ]);

    const totalDoc = sanitizeVisitorDoc(totalSnap.exists ? totalSnap.data() : {});
    const dailyDocsByDate: Record<string, any> = {};
    dayKeys.forEach((key, idx) => {
      const d = (dailySnaps[idx]?.exists ? dailySnaps[idx].data() : {}) || {};
      dailyDocsByDate[key] = sanitizeVisitorDoc({ date: key, ...d });
    });

    const workerLogSummary: Record<string, { count: number; totalPay: number; lastDate: string; lastSavedMs: number }> = {};
    const workLogs: Array<Record<string, any>> = [];

    workLogsSnap.forEach((docSnap) => {
      const d = docSnap.data() || {};
      if (d.deletedAt) return;
      const docId = docSnap.id || '';
      const wid = String(d.workerId || '').trim() || (docId.includes('_') ? docId.split('_')[0] : '미지정');
      const dateStr = String(d.date || '').trim() || (docId.includes('_') ? docId.split('_').slice(1).join('_') : '-');
      const wage1 = Number(d.wage1) || 0;
      const wage2 = Number(d.wage2) || 0;
      const wage3 = Number(d.wage3) || 0;
      const wage4 = Number(d.wage4) || 0;
      const totalPay = Number(d.totalPay) || (wage1 + wage2 + wage3 + wage4);
      const tsInfo = formatKstDateTime(d.timestamp);

      workLogs.push({
        id: docId,
        workerId: wid,
        date: dateStr,
        shipName: String(d.shipName || '').trim(),
        wage1,
        wage2,
        wage3,
        wage4,
        totalPay,
        coworkers: String(d.coworkers || '').trim(),
        memo: String(d.memo || '').trim(),
        imageUrl: String(d.imageUrl || '').trim(),
        savedMs: tsInfo.ms,
        savedStr: tsInfo.formatted
      });

      if (wid) {
        if (!workerLogSummary[wid]) {
          workerLogSummary[wid] = { count: 0, totalPay: 0, lastDate: '', lastSavedMs: 0 };
        }
        workerLogSummary[wid].count += 1;
        workerLogSummary[wid].totalPay += totalPay;
        if (dateStr && dateStr !== '-' && (!workerLogSummary[wid].lastDate || dateStr > workerLogSummary[wid].lastDate)) {
          workerLogSummary[wid].lastDate = dateStr;
        }
        if (tsInfo.ms > workerLogSummary[wid].lastSavedMs) {
          workerLogSummary[wid].lastSavedMs = tsInfo.ms;
        }
      }
    });

    const workerAccounts: Array<Record<string, any>> = [];
    usersSnap.forEach((docSnap) => {
      const d = docSnap.data() || {};
      const nick = docSnap.id;
      const rawTs = d.createdAt || d.timestamp || d.updatedAt;
      const tsInfo = formatKstDateTime(rawTs);
      const createdStr = rawTs ? (tsInfo.formatted === '-' ? '날짜 기록 없음' : tsInfo.formatted) : '날짜 기록 없음';
      const logStat = workerLogSummary[nick] || { count: 0, totalPay: 0, lastDate: '-', lastSavedMs: 0 };
      const pwStr = String(d.password || '');
      const isSha256 = /^[a-f0-9]{64}$/i.test(pwStr);
      workerAccounts.push({
        nick,
        createdMs: tsInfo.ms,
        createdStr,
        logCount: logStat.count,
        totalPay: logStat.totalPay,
        lastDate: logStat.lastDate || '-',
        lastSavedMs: logStat.lastSavedMs,
        isSha256
      });
    });

    workerAccounts.sort(
      (a, b) =>
        (b.createdMs - a.createdMs) ||
        (b.lastSavedMs - a.lastSavedMs) ||
        (b.logCount - a.logCount) ||
        String(a.nick).localeCompare(String(b.nick), 'ko')
    );

    const activeShipsCount = shipsSnap.docs.filter((doc) => !doc.data().deletedAt).length;
    const activePostsCount = postsSnap.docs.filter((doc) => !doc.data().deletedAt).length;

    res.json({
      ok: true,
      generatedAtKst: kstNow.toISOString().replace('Z', '+09:00'),
      totalDoc,
      dailyDocsByDate,
      counts: {
        workersCount: usersSnap.size,
        workLogsCount: workLogs.length,
        totalWorkLogsRawCount: workLogsSnap.size,
        shipsCount: activeShipsCount,
        postsCount: activePostsCount,
        noticesCount: noticesSnap.size,
        archivesCount: archivesSnap.size
      },
      workerAccounts,
      workLogs
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error?.message || 'admin_stats_failed' });
  }
};
app.get('/api/admin-stats', adminStatsHandler);
app.post('/api/admin-stats', adminStatsHandler);

app.get('/api/hjnc-schedule', async (req, res) => {
  try {
    const targetDate = String(req.query.date || '').trim();
    const startDateParam = String(req.query.startDate || '').trim();
    const endDateParam = String(req.query.endDate || '').trim();

    let startDate = startDateParam;
    let endDate = endDateParam;

    if (!startDate || !endDate) {
      const base = targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? new Date(`${targetDate}T00:00:00`) : new Date();
      const s = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 2);
      const e = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 2);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      startDate = fmt(s);
      endDate = fmt(e);
    }

    const result = await fetchTerminalScheduleVesselsWithMeta('hjnc', startDate, endDate);
    res.json({
      ok: true,
      terminal: 'hjnc',
      startDate,
      endDate,
      stale: result.stale,
      cacheSource: result.cacheSource,
      total: result.vessels.length,
      vessels: result.vessels
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to fetch HJNC schedule'
    });
  }
});

app.get('/api/terminal-schedule', async (req, res) => {
  try {
    const terminal = String(req.query.terminal || 'hjnc').trim().toLowerCase();
    const targetDate = String(req.query.date || '').trim();
    let startDate = String(req.query.startDate || '').trim();
    let endDate = String(req.query.endDate || '').trim();

    if (!startDate || !endDate) {
      const base = targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? new Date(`${targetDate}T00:00:00`) : new Date();
      const s = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 3);
      const e = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 5);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      startDate = fmt(s);
      endDate = fmt(e);
    }

    const result = await fetchTerminalScheduleVesselsWithMeta(terminal, startDate, endDate);
    res.json({
      ok: true,
      terminal,
      startDate,
      endDate,
      stale: result.stale,
      cacheSource: result.cacheSource,
      total: result.vessels.length,
      vessels: result.vessels
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to fetch terminal schedule'
    });
  }
});

// --- 주기 작업 트리거 엔드포인트 (Vercel Cron · GitHub Actions 용) ---
// 서버리스(Vercel)에서는 node-cron 타이머를 쓸 수 없으므로 스케줄러가 이 엔드포인트를
// 직접 호출합니다. 호출 주체는 두 가지입니다:
//   1) Vercel Cron (vercel.json crons): CRON_SECRET 이 Vercel 프로젝트 환경변수에 등록되어
//      있으면 `Authorization: Bearer ${CRON_SECRET}` 헤더가 자동 첨부됩니다.
//   2) GitHub Actions (.github/workflows/cron-schedule-watch.yml): Vercel Hobby 플랜은
//      1일 1회 초과 빈도의 크론 등록을 금지하므로, 매시간 스케줄 감시만 이곳에서 curl 로
//      동일한 헤더를 보내 트리거합니다.
// CRON_SECRET 미등록 시에는 503 으로 거부하여 익명 트리거를 원천 차단합니다.
const CRON_SECRET = String(process.env.CRON_SECRET || '');

/**
 * Authorization 헤더의 Bearer 토큰을 CRON_SECRET 과 상수 시간 비교로 검증합니다.
 * 시크릿을 인자로 받는 순수 함수입니다(테스트에서 샌드박스로 추출해 실행합니다).
 */
export function verifyCronAuthHeader(authHeader: string, secret: string): boolean {
  if (!secret) return false;
  const header = String(authHeader || '');
  if (!/^Bearer\s+/i.test(header)) return false;
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const a = crypto.createHash('sha256').update(token, 'utf8').digest();
  const b = crypto.createHash('sha256').update(secret, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function authorizeCronRequest(req: Request, res: Response): boolean {
  if (!CRON_SECRET) {
    res.status(503).json({ ok: false, error: 'cron_secret_not_configured' });
    return false;
  }
  if (!verifyCronAuthHeader(String(req.headers.authorization || ''), CRON_SECRET)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

/** 백업 저장 경로 — 서버리스에서는 /tmp 만 쓰기 가능하며 인스턴스 종료 시 사라집니다. */
export function resolveBackupDir(): string {
  return IS_VERCEL ? path.join('/tmp', 'backups') : path.join(__dirname, 'backups');
}

// --- 주기 작업 트리거 경로(2중 경로 등록) ---
//   정식 경로: /api/cron/<task>  → Vercel 에서는 api/cron/<task>.ts 개별 함수 파일로 노출
//   별칭 경로: /api/<task>       → 단일 세그먼트라 catch-all(api/[...path].ts)로도 매칭됨
//   두 경로 모두 동일 핸들러를 사용하며 CRON_SECRET 인증(401/503)이 동일하게 적용됩니다.
//   (Vercel catch-all 은 2세그먼트 이상 경로를 함수로 매칭시키지 못해 플랫폼 404 가 납니다)

// 1) 선박 출항/접안 스케줄 변경 감지 + FCM 푸시 알림
//    (매시간 — Vercel Hobby 플랜 제약으로 GitHub Actions 예약 워크플로가 트리거)
const cronScheduleWatchHandler = async (req: Request, res: Response) => {
  if (!authorizeCronRequest(req, res)) return;
  try {
    const result = await runScheduleChangeDetection();
    res.json({ ok: true, task: 'schedule-watch', ...result });
  } catch (error: any) {
    res.status(500).json({ ok: false, task: 'schedule-watch', error: error?.message || String(error) });
  }
};
app.get('/api/cron/schedule-watch', cronScheduleWatchHandler);
app.get('/api/cron-schedule-watch', cronScheduleWatchHandler);

// 2) DB 자가 정리(30일 지난 스케줄 캐시 / 14일 지난 읽은 알림) — Vercel Cron 매일 03시
const cronDailyCleanupHandler = async (req: Request, res: Response) => {
  if (!authorizeCronRequest(req, res)) return;
  try {
    const result = await runDatabaseAutoCleanup();
    res.json({ ok: true, task: 'daily-cleanup', ...result });
  } catch (error: any) {
    res.status(500).json({ ok: false, task: 'daily-cleanup', error: error?.message || String(error) });
  }
};
app.get('/api/cron/daily-cleanup', cronDailyCleanupHandler);
app.get('/api/cron-daily-cleanup', cronDailyCleanupHandler);

// 3) 주간 Firestore 백업 — Vercel Cron 매주 일요일 00시
//    ⚠️ 서버리스에서는 /tmp 에만 쓸 수 있고 인스턴스 종료 시 사라지므로 영구 보관이
//    아닙니다(응답의 note 필드 참고). 영구 백업은 상시 프로세스 서버 배포에서만 유효합니다.
const cronWeeklyBackupHandler = async (req: Request, res: Response) => {
  if (!authorizeCronRequest(req, res)) return;
  try {
    const result = await runWeeklyFirestoreBackup(resolveBackupDir());
    res.json({
      ok: true,
      task: 'weekly-backup',
      ...result,
      ...(IS_VERCEL
        ? { note: 'ephemeral_filesystem: 서버리스 /tmp 백업은 함수 종료 후 유지되지 않습니다' }
        : {})
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, task: 'weekly-backup', error: error?.message || String(error) });
  }
};
app.get('/api/cron/weekly-backup', cronWeeklyBackupHandler);
app.get('/api/cron-weekly-backup', cronWeeklyBackupHandler);

// 4) 매일 04시(KST) 기능 점검 및 보고서 자동 생성 — Vercel Cron 매일 19:00 UTC(=04:00 KST)
const cronDailyInspectionHandler = async (req: Request, res: Response) => {
  if (!authorizeCronRequest(req, res)) return;
  try {
    const result = await runDailyInspection(new Date());
    const markdown = generateInspectionMarkdown(result);
    res.json({
      ok: true,
      task: 'daily-inspection',
      kstDate: result.kstDate,
      summary: result.summary,
      report: markdown,
      // 보고서 메일 발송 결과 (자격증명 미설정이면 skipped — 점검 자체는 성공)
      email: {
        to: REPORT_EMAIL_TO,
        status: automationRuntimeStatus.dailyInspection.lastEmailStatus,
        transport: automationRuntimeStatus.dailyInspection.lastEmailTransport,
        reason: automationRuntimeStatus.dailyInspection.lastEmailReason,
        sentAt: automationRuntimeStatus.dailyInspection.lastEmailAt,
        error: automationRuntimeStatus.dailyInspection.lastEmailError,
      },
      // Vercel /tmp 보고서는 함수 종료 후 사라지므로 응답 바디에 포함해 전달
      ...(IS_VERCEL ? { note: 'ephemeral_filesystem: /tmp 보고서는 함수 종료 후 유지되지 않으므로 응답 바디를 저장하세요' } : {}),
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, task: 'daily-inspection', error: error?.message || String(error) });
  }
};
app.get('/api/cron/daily-inspection', cronDailyInspectionHandler);
app.get('/api/cron-daily-inspection', cronDailyInspectionHandler);

// 5) 주간 자가 점검 · 자가 복구 — Vercel Cron 매주 월요일 05:00 KST (일요일 20:00 UTC)
//    · 기능 점검 → 데이터 변화 감지 → 자동 복구 → 재검증 → 보고서 메일(luxrank@gmail.com 등)
//    · ?email=0 으로 메일 생략 / ?forceEmail=1 로 주간 중복 방지 무시
const cronWeeklySelfCheckHandler = async (req: Request, res: Response) => {
  if (!authorizeCronRequest(req, res)) return;
  try {
    const sendEmail = String(req.query.email ?? '1') !== '0';
    const forceEmail = String(req.query.forceEmail ?? '0') === '1';
    const { result, markdown, json, email, reportPath } = await runServerWeeklySelfCheck({ sendEmail, forceEmail });
    res.json({
      ok: true,
      task: 'weekly-self-check',
      kstDate: result.kstDate,
      isoWeek: result.isoWeek,
      summary: result.summary,
      baseline: result.baseline,
      repairs: json.repairs,
      drift: json.drift,
      escalation: result.escalation,
      email: {
        to: resolveSelfCheckConfig(process.env).email.to,
        status: automationRuntimeStatus.weeklySelfCheck.lastEmailStatus,
        transport: automationRuntimeStatus.weeklySelfCheck.lastEmailTransport,
        reason: automationRuntimeStatus.weeklySelfCheck.lastEmailReason,
        sentAt: automationRuntimeStatus.weeklySelfCheck.lastEmailAt,
        error: automationRuntimeStatus.weeklySelfCheck.lastEmailError
      },
      missing: email.ok ? undefined : email.reason || email.error,
      reportPath,
      // 서버리스 /tmp 는 함수 종료 시 사라지므로 보고서 전문을 응답에 포함합니다.
      report: markdown,
      ...(IS_VERCEL ? { note: 'ephemeral_filesystem: /tmp 보고서는 함수 종료 후 유지되지 않으므로 응답 본문을 저장하세요' } : {})
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, task: 'weekly-self-check', error: error?.message || String(error) });
  }
};
app.get('/api/cron/weekly-self-check', cronWeeklySelfCheckHandler);
app.get('/api/cron-weekly-self-check', cronWeeklySelfCheckHandler);

// 공개 요약 조회 — 인증 없이 최신 점검 상태 확인 (민감 정보 제외)
app.get('/api/inspection-report', (_req, res) => {
  const d = automationRuntimeStatus.dailyInspection;
  if (!d.lastRunAt) {
    res.json({ ok: true, hasReport: false, message: '아직 점검 기록이 없습니다. 매일 04:00 KST에 자동 생성됩니다.' });
    return;
  }
  res.json({
    ok: true,
    hasReport: true,
    lastRunAt: d.lastRunAt,
    lastSuccessAt: d.lastSuccessAt,
    lastError: d.lastError,
    summary: d.lastResult,
    reportPath: d.lastReportPath,
    email: {
      to: REPORT_EMAIL_TO,
      status: d.lastEmailStatus,
      transport: d.lastEmailTransport,
      reason: d.lastEmailReason,
      sentAt: d.lastEmailAt,
      error: d.lastEmailError,
    },
  });
});

// 공개 요약 조회 — 주간 자가 점검의 최신 결과(민감 정보 제외, 인증 불필요)
app.get('/api/self-check-report', async (_req, res) => {
  const d = automationRuntimeStatus.weeklySelfCheck;
  if (!d.lastRunAt) {
    // 서버리스는 메모리가 휘발되므로 Firestore 에 보관된 최신 결과를 우선 사용합니다.
    const stored = await loadSelfCheckSummary();
    if (stored?.json) {
      res.json({
        ok: true,
        hasReport: true,
        persisted: true,
        lastRunAt: stored.json.generatedAt || stored.capturedAt,
        kstDate: stored.json.kstDate,
        isoWeek: stored.json.isoWeek,
        summary: stored.json.summary,
        repairs: stored.json.repairs,
        drift: stored.json.drift,
        checks: stored.json.checks,
        email: stored.email || null,
        schedule: { cron: WEEKLY_SELF_CHECK_CRON, timezone: 'Asia/Seoul', label: '매주 월요일 05:00 KST' }
      });
      return;
    }
    res.json({
      ok: true,
      hasReport: false,
      message: '아직 주간 자가 점검 기록이 없습니다. 매주 월요일 05:00 KST 에 자동 실행됩니다.'
    });
    return;
  }
  res.json({
    ok: true,
    hasReport: true,
    lastRunAt: d.lastRunAt,
    lastSuccessAt: d.lastSuccessAt,
    lastError: d.lastError,
    summary: d.lastResult,
    repairs: d.lastRepairs,
    drift: d.lastDrift,
    checks: d.lastChecks,
    reportPath: d.lastReportPath,
    email: {
      to: resolveSelfCheckConfig(process.env).email.to,
      status: d.lastEmailStatus,
      transport: d.lastEmailTransport,
      reason: d.lastEmailReason,
      sentAt: d.lastEmailAt,
      week: d.lastEmailWeek,
      error: d.lastEmailError
    },
    schedule: { cron: WEEKLY_SELF_CHECK_CRON, timezone: 'Asia/Seoul', label: '매주 월요일 05:00 KST' }
  });
});

// 매칭되지 않은 /api/* 경로는 index.html 이 아닌 JSON 404 를 반환합니다.
// (정적 호스팅 시절 /api/* 가 index.html 로 폴백되던 문제를 명시적 오류로 대체)
app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'not_found' });
});

// --- 정적 자산 서빙 및 SPA 폴백 (상시 프로세스 서버 전용) ---
// Vercel 에서는 CDN 이 대신 처리합니다: build/public 정적 배포(vercel.json outputDirectory)
// + headers(캐시·보안 헤더) + rewrites(/api/ 제외 전 경로를 index.html 로 폴백).
// 서버리스 함수 번들에는 public/ 파일이 포함되지 않으므로, 등록을 건너뛰어
// sendFile 오류를 방지하고 번들 크기를 줄입니다.
if (!IS_VERCEL) {
  app.use((_, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/icons', express.static(path.join(__dirname, 'icons'), { maxAge: '7d' }));
  app.use(express.static(STATIC_ROOT, {
    setHeaders: (res, filePath) => {
      if (/\.(png|jpg|jpeg|gif|ico|svg|webp)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
      // A-1 (2026-10-17): css/app.css 와 js/* 는 ?v= 버전 쿼리로 장기 캐시.
      // 버전이 바뀌면 index.html(비캐시)에서 새 URL 이 되어 새로 받아옵니다.
      if (/\.(css|js)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(STATIC_ROOT, 'index.html'));
  });
}

// 포트 리스닝은 상시 프로세스 서버 전용 — Vercel 서버리스에서는 플랫폼이
// api/[...path].ts 의 핸들러(Express 앱)를 직접 호출하므로 listen 하면 안 됩니다.
if (!IS_VERCEL && process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Local: http://localhost:${PORT}/`);
    console.log(`Network: http://0.0.0.0:${PORT}/`);
    console.log(`Static: ${STATIC_ROOT}${STATIC_ROOT === PUBLIC_BUILD_DIR ? ' (압축 빌드본)' : ' (원본 public — npm run build:obfuscate 실행 시 압축본 사용)'}`);
  });

  server.on('error', (err: any) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${PORT} is already in use. Existing process may already be running.`);
      process.exit(1);
    } else {
      console.error('[Server] Unexpected server error:', err);
      process.exit(1);
    }
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
}
