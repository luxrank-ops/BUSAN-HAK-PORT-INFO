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

export const SUPPORTED_TERMINALS = ['hjnc', 'bnct', 'dgt', 'hpnt', 'pnit', 'bptc', 'hbct'] as const;
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
 * 화면 잠금에서 10회 실패해도 긴급 공지 인증이 함께 막히지 않도록 하기 위함입니다.
 */
function isScreenUnlockRateLimited(ip: string, scope: 'screen' | 'emergency' = 'screen'): boolean {
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
  return entry.count > SCREEN_UNLOCK_MAX_ATTEMPTS;
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
}

// --- Express 라우트 ---
// ⚡ A-7: 텍스트 응답 gzip 압축 (index.html 820KB → 약 175KB)
app.use(compression());

// 🔐 D-6: API 는 자사 도메인에서만 호출하도록 허용 출처를 제한합니다.
// (ALLOWED_ORIGINS 환경변수로 추가 지정 가능 — 쉼표 구분)
const DEFAULT_ALLOWED_ORIGINS = [
  'https://busan-hak-port-info.vercel.app',
  'https://busan-hak-port.web.app',
  'https://busan-hak-port.firebaseapp.com'
];
const ALLOWED_ORIGINS = [
  ...DEFAULT_ALLOWED_ORIGINS,
  ...String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
];
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
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

app.get('/api/analytics-summary', async (_req, res) => {
  try {
    if (!initFirebaseAdmin() || getApps().length === 0) {
      res.status(503).json({ ok: false, error: 'firebase_admin_not_initialized' });
      return;
    }
    const db = getFirestore();
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
    const dayKeys: Array<{ key: string; shortDate: string; dayName: string; isToday: boolean }> = [];
    for (let i = 6; i >= 0; i--) {
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

    const [totalSnap, shipsSnap, postsSnap, noticesSnap, workLogsSnap, ...dailySnaps] = await Promise.all([
      db.collection('visitor_stats').doc('total').get(),
      db.collection('ships').limit(200).get(),
      db.collection('posts').limit(200).get(),
      db.collection('notices').limit(50).get(),
      db.collection('work_logs').limit(500).get(),
      ...dayKeys.map((dk) => db.collection('visitor_stats').doc(`daily-${dk.key}`).get())
    ]);

    const totalData = (totalSnap.exists ? totalSnap.data() : {}) || {};
    const dailyTrend = dayKeys.map((dk, idx) => {
      const d = (dailySnaps[idx]?.exists ? dailySnaps[idx].data() : {}) || {};
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
        shipsCount: activeShips.length,
        postsCount: activePosts.length,
        noticesCount: noticesSnap.size,
        workLogsCount: activeWorkLogs.length
      }
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error?.message || 'analytics_summary_failed' });
  }
});

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
