// ============================================================================
// BUSAN HAK PORT INFO — Cloudflare Workers 어댑터
// Google 서비스 계정 → OAuth2 액세스 토큰 (JWT Bearer, fetch 기반)
// ============================================================================
/**
 * Workers 에는 google-auth-library 의 gRPC·네이티브 경로가 없으므로, 서비스 계정
 * 키(FIREBASE_SERVICE_ACCOUNT_KEY: JSON 원문 또는 base64)로 JWT 를 서명해
 * OAuth2 토큰 엔드포인트에서 액세스 토큰을 받습니다. scope 별로 만료까지 캐시합니다.
 */
import crypto from 'node:crypto';

export interface ServiceAccountKey {
  project_id?: string;
  client_email: string;
  private_key: string;
}

let cachedKey: ServiceAccountKey | null = null;
let cachedRawKey = '';

export function loadServiceAccountKey(): ServiceAccountKey | null {
  const raw = String((globalThis as any).process?.env?.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim();
  if (!raw) return null;
  if (cachedKey && cachedRawKey === raw) return cachedKey;
  try {
    const decoded = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (!parsed?.client_email || !parsed?.private_key) return null;
    cachedKey = parsed as ServiceAccountKey;
    cachedRawKey = raw;
    return cachedKey;
  } catch {
    return null;
  }
}

export function resolveProjectId(): string {
  const explicit = String((globalThis as any).process?.env?.FIREBASE_PROJECT_ID || '').trim();
  if (explicit) return explicit;
  return loadServiceAccountKey()?.project_id || 'busan-hak-port';
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** scope(공백 구분 가능)에 대한 액세스 토큰을 반환합니다. */
export async function getGoogleAccessToken(scope: string): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;

  const key = loadServiceAccountKey();
  if (!key) throw new Error('service_account_unavailable');

  const iat = Math.floor(now / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlEncode(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600
    })
  );
  const signingInput = `${header}.${claims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(key.private_key));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    }).toString()
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`oauth_token_failed:${res.status}:${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text || '{}');
  const token = String(json.access_token || '');
  if (!token) throw new Error('oauth_token_missing');
  const expiresIn = Number(json.expires_in) || 3600;
  tokenCache.set(scope, { token, expiresAt: now + expiresIn * 1000 });
  return token;
}

export const SCOPE = {
  datastore: 'https://www.googleapis.com/auth/datastore',
  cloudPlatform: 'https://www.googleapis.com/auth/cloud-platform',
  firebaseMessaging: 'https://www.googleapis.com/auth/firebase.messaging',
  devstorage: 'https://www.googleapis.com/auth/devstorage.read_write'
} as const;
