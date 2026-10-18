/**
 * 화면 잠금(보안 비밀번호) 회귀 방지 테스트
 *
 * 과거에는 잠금 PIN 이 public/js/app.js 에 평문으로 하드코딩되어 있었습니다.
 * 공개 저장소라면 누구나 소스만 열어 잠금을 해제할 수 있는 상태였으므로,
 * PIN 을 서버 환경변수로 옮긴 뒤 이 파일이 그 상태를 지킵니다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const serverCode = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-obfuscate.mjs', import.meta.url), 'utf8');

// 평문 PIN 이 테스트 파일 자체에 다시 등장하지 않도록 분해해 조립합니다.
const LEGACY_PIN = ['94', '45'].join('');

test('서버에 POST /api/screen-unlock 라우트가 있다', () => {
  assert.match(serverCode, /app\.post\(\s*'\/api\/screen-unlock'/);
});

test('PIN 은 저장소 소스가 아니라 서버 환경변수 SCREEN_LOCK_PIN 에서 읽는다', () => {
  assert.match(
    serverCode,
    /SCREEN_LOCK_PIN\s*=\s*String\(process\.env\.SCREEN_LOCK_PIN/,
    'SCREEN_LOCK_PIN 은 환경변수에서만 읽어야 합니다'
  );
});

test('PIN 비교는 상수 시간 비교(timingSafeEqual)로 수행한다', () => {
  assert.match(serverCode, /crypto\.timingSafeEqual/);
  assert.match(serverCode, /function verifyScreenLockPin/);
});

test('무차별 대입 방지 속도 제한이 있다', () => {
  assert.match(serverCode, /isScreenUnlockRateLimited/);
  assert.match(serverCode, /status\(429\)/);
});

test('클라이언트 전역 스크립트에 PIN 평문이 남아 있지 않다', () => {
  assert.doesNotMatch(
    appJs,
    new RegExp(`['"\`]${LEGACY_PIN}['"\`]`),
    'public/js/app.js 에 PIN 평문이 다시 들어갔습니다 — 서버 검증으로 되돌리세요'
  );
  assert.doesNotMatch(
    appJs,
    new RegExp(`=== *['"\`]${LEGACY_PIN}['"\`]`),
    'PIN 비교가 클라이언트에 남아 있습니다'
  );
});

test('클라이언트는 서버 검증을 1순위로 호출한다', () => {
  assert.match(appJs, /SCREEN_UNLOCK_ENDPOINT\s*=\s*"\/api\/screen-unlock"/);
  assert.match(appJs, /async function verifyScreenLockPin/);
  assert.match(appJs, /window\.__SCREEN_LOCK_SHA256__/);
});

test('빌드 스크립트가 PIN 해시를 HTML 에 주입한다', () => {
  assert.match(buildScript, /__SCREEN_LOCK_SHA256__/);
  assert.match(buildScript, /createHash\('sha256'\)/);
  assert.match(buildScript, /SCREEN_LOCK_PIN/);
});

test('빌드 산출물이 있으면 PIN 해시가 주입되어 있다', () => {
  const built = new URL('../build/public/index.html', import.meta.url);
  if (!existsSync(built)) return; // 빌드 전에는 건너뜀
  const html = readFileSync(built, 'utf8');
  assert.match(html, /window\.__SCREEN_LOCK_SHA256__="[a-f0-9]{64}"/);
  assert.doesNotMatch(html, new RegExp(`['"\`]${LEGACY_PIN}['"\`]`), '배포 HTML 에 PIN 평문이 있습니다');
});
