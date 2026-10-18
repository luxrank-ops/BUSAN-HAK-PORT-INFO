/**
 * Vercel Node 런타임(서버리스) 전환 회귀 방지 테스트
 *
 * 배경: 과거 Vercel 배포는 순수 정적 호스팅(outputDirectory: build/public)이라
 * /api/* 요청이 전부 index.html 로 폴백되었습니다(선박 스케줄 API·서버 PIN 검증·
 * FCM 주기 작업 모두 동작 불가). 이제 api/[...path].ts 서버리스 함수가
 * server.ts 의 Express 앱을 실행해 /api/* 를 처리합니다.
 *
 * 이 파일은 다음 상태를 지킵니다:
 *   1. 함수 진입점(api/[...path].ts)이 server.ts 의 app 을 그대로 위임 수출한다
 *   2. server.ts 는 Vercel 환경에서 listen·node-cron·정적 서빙을 비활성화한다
 *      (서버리스는 응답 후 프로세스 동결 — 타이머/포트가 의미 없음)
 *   3. vercel.json 은 정적 배포(build/public)를 유지하고, SPA rewrite 가 /api/ 를 침범하지 않는다
 *   4. vercel.json crons 는 Vercel Hobby 플랜 제약(1일 1회 이하 빈도)을 넘지 않는다
 *   5. /api/cron/* 엔드포인트는 CRON_SECRET Bearer 인증(상수 시간 비교) 없이는 실행되지 않는다
 *   6. 매시간 스케줄 감시를 담당하는 GitHub Actions 예약 워크플로가 존재한다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import yaml from 'js-yaml';

const serverCode = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const vercelJson = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const apiEntryUrl = new URL('../api/[...path].ts', import.meta.url);
const workflowPath = new URL('../.github/workflows/cron-schedule-watch.yml', import.meta.url);

test('Vercel 서버리스 함수 진입점이 존재하고 server.ts 의 Express 앱을 위임 수출한다', () => {
  assert.ok(existsSync(apiEntryUrl), 'api/[...path].ts 가 있어야 /api/* 가 함수로 라우팅됩니다');
  const entry = readFileSync(apiEntryUrl, 'utf8');
  // '../server.js' 지정자: TypeScript NodeNext 규칙(.js → .ts 매핑) — tsc·esbuild(Vercel 빌더) 모두 해석 가능
  assert.match(entry, /import\s*{\s*app\s*}\s*from\s*'\.\.\/server\.js'\s*;/);
  assert.match(entry, /export\s+default\s+app\s*;/);
});

test('server.ts 는 Vercel 환경에서 listen·크론·정적 서빙을 비활성화한다', () => {
  assert.match(
    serverCode,
    /export\s+const\s+IS_VERCEL\s*=\s*Boolean\(process\.env\.VERCEL\)/,
    'IS_VERCEL 환경 감지가 필요합니다'
  );
  assert.match(
    serverCode,
    /process\.env\.NODE_ENV\s*!==\s*'test'\s*&&\s*!IS_VERCEL/,
    'node-cron 등록은 상시 프로세스 서버에서만 이뤄져야 합니다'
  );
  assert.match(
    serverCode,
    /!\s*IS_VERCEL\s*&&\s*process\.env\.NODE_ENV\s*!==\s*'test'/,
    'app.listen 은 Vercel 서버리스에서 비활성화되어야 합니다'
  );
  assert.match(
    serverCode,
    /if\s*\(!IS_VERCEL\)\s*{/,
    '정적 서빙·SPA 폴백은 Vercel 에서 건너뛰어야 합니다(CDN 이 build/public 을 서빙)'
  );
  assert.match(
    serverCode,
    /app\.set\('trust proxy',\s*1\)/,
    'Vercel 프록시 뒤에서 실제 클라이언트 IP 기준 속도 제한이 동작하려면 trust proxy 가 필요합니다'
  );
  // 기존 상시 프로세스 서버 동작(node-cron 스케줄 문자열)은 그대로 유지되어야 합니다
  assert.match(serverCode, /cron\.schedule\('0 \* \* \* \*'/);
  assert.match(serverCode, /cron\.schedule\('0 3 \* \* \*'/);
  assert.match(serverCode, /cron\.schedule\('0 0 \* \* 0'/);
});

test('vercel.json 은 정적 배포(build/public)와 /api/ 예외 SPA rewrite 를 유지한다', () => {
  assert.equal(vercelJson.outputDirectory, 'build/public');
  assert.match(String(vercelJson.buildCommand), /build/);
  const spaRewrite = (vercelJson.rewrites || []).find((r) => r.destination === '/index.html');
  assert.ok(spaRewrite, 'SPA 폴백 rewrite 가 필요합니다');
  assert.match(spaRewrite.source, /\(\?!api\/\)/, 'rewrite 가 /api/* 를 index.html 로 삼키면 안 됩니다');
});

test('vercel.json crons 는 Hobby 플랜 제약(1일 1회 이하 빈도)을 넘지 않는다', () => {
  const crons = vercelJson.crons || [];
  assert.ok(crons.length >= 2, '매일 정리·매주 백업 크론이 등록되어 있어야 합니다');
  for (const job of crons) {
    const parts = String(job.schedule).trim().split(/\s+/);
    assert.equal(parts.length, 5, `cron 표현식이 5필드가 아닙니다: ${job.schedule}`);
    // 분·시 필드에 *(매분/매시간 반복)가 있으면 1일 1회 초과 → Hobby 에서 배포 실패
    assert.ok(!parts[0].includes('*'), `Hobby 금지 빈도(분 필드 반복): ${job.schedule}`);
    assert.ok(!parts[1].includes('*'), `Hobby 금지 빈도(시 필드 반복): ${job.schedule}`);
    assert.match(job.path, /^\/api\/cron\//, `크론 경로는 /api/cron/* 여야 합니다: ${job.path}`);
    // 등록 경로가 서버에 실제 구현되어 있어야 합니다
    const escaped = job.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(serverCode, new RegExp(`app\\.get\\('${escaped}'`), `서버에 ${job.path} 엔드포인트가 없습니다`);
  }
  // 매시간 스케줄 감시는 Hobby 제약으로 vercel.json 이 아닌 GitHub Actions 가 담당합니다
  assert.ok(
    !crons.some((job) => job.path === '/api/cron/schedule-watch'),
    '매시간 schedule-watch 를 vercel.json crons 에 넣으면 Hobby 배포가 실패합니다 — GitHub Actions 워크플로 사용'
  );
});

test('서버에 /api/cron/* 트리거 엔드포인트가 있고 CRON_SECRET 인증을 요구한다', () => {
  assert.match(serverCode, /app\.get\('\/api\/cron\/schedule-watch'/);
  assert.match(serverCode, /app\.get\('\/api\/cron\/daily-cleanup'/);
  assert.match(serverCode, /app\.get\('\/api\/cron\/weekly-backup'/);
  assert.match(serverCode, /CRON_SECRET\s*=\s*String\(process\.env\.CRON_SECRET/, 'CRON_SECRET 은 환경변수에서만 읽어야 합니다');
  assert.match(serverCode, /cron_secret_not_configured/, '시크릿 미등록 시 503 거부가 필요합니다');
  assert.match(serverCode, /authorizeCronRequest\(req,\s*res\)/);
});

test('CRON_SECRET Bearer 검증은 상수 시간 비교이며 잘못된 토큰·미설정 시크릿을 거부한다', () => {
  const fnMatch = serverCode.match(/export function verifyCronAuthHeader[\s\S]*?^}/m);
  assert.ok(fnMatch, 'verifyCronAuthHeader 함수가 필요합니다');
  assert.match(fnMatch[0], /crypto\.timingSafeEqual/, '토큰 비교는 상수 시간 비교여야 합니다');

  const runnable = fnMatch[0]
    .replace(/^export\s+/, '')
    .replace(/authHeader:\s*string,\s*secret:\s*string/, 'authHeader, secret')
    .replace(/\):\s*boolean\s*{/, ') {');
  const sandbox = { crypto };
  vm.createContext(sandbox);
  vm.runInContext(runnable, sandbox, { filename: 'verifyCronAuthHeader' });

  assert.equal(sandbox.verifyCronAuthHeader('Bearer s3cr3t-token', 's3cr3t-token'), true);
  assert.equal(sandbox.verifyCronAuthHeader('bearer s3cr3t-token', 's3cr3t-token'), true, '스킴 대소문자는 무시');
  assert.equal(sandbox.verifyCronAuthHeader('Bearer wrong-token', 's3cr3t-token'), false);
  assert.equal(sandbox.verifyCronAuthHeader('Bearer ', 's3cr3t-token'), false);
  assert.equal(sandbox.verifyCronAuthHeader('s3cr3t-token', 's3cr3t-token'), false, 'Bearer 스킴 없이는 거부');
  assert.equal(sandbox.verifyCronAuthHeader('', 's3cr3t-token'), false);
  assert.equal(sandbox.verifyCronAuthHeader('Bearer anything', ''), false, '시크릿 미설정은 항상 거부');
  assert.equal(sandbox.verifyCronAuthHeader(undefined, 's3cr3t-token'), false);
});

test('서버리스에서 백업 경로는 쓰기 가능한 /tmp 를 사용한다', () => {
  const fnMatch = serverCode.match(/export function resolveBackupDir[\s\S]*?^}/m);
  assert.ok(fnMatch, 'resolveBackupDir 함수가 필요합니다');
  const runnable = fnMatch[0]
    .replace(/^export\s+/, '')
    .replace(/\):\s*string\s*{/, ') {');

  const run = (isVercel) => {
    const sandbox = { IS_VERCEL: isVercel, __dirname: '/var/task', path: { join: (...parts) => parts.join('/') } };
    vm.createContext(sandbox);
    vm.runInContext(runnable, sandbox, { filename: 'resolveBackupDir' });
    return sandbox.resolveBackupDir();
  };
  assert.equal(run(true), '/tmp/backups', 'Vercel(읽기 전용 FS)에서는 /tmp 만 쓸 수 있습니다');
  assert.equal(run(false), '/var/task/backups', '상시 프로세스 서버에서는 기존 backups/ 경로를 유지합니다');
});

test('매칭되지 않은 /api/* 는 index.html 대신 JSON 404 를 반환한다', () => {
  assert.match(serverCode, /app\.use\('\/api',\s*\(_req,\s*res\)\s*=>\s*{\s*res\.status\(404\)\.json\({\s*ok:\s*false,\s*error:\s*'not_found'\s*}\);/);
});

test('매시간 스케줄 감시용 GitHub Actions 예약 워크플로가 존재한다 (Hobby 플랜 대체 트리거)', () => {
  assert.ok(existsSync(workflowPath), '.github/workflows/cron-schedule-watch.yml 이 필요합니다');
  const text = readFileSync(workflowPath, 'utf8');
  const wf = yaml.load(text);
  const on = wf.on ?? wf[true]; // js-yaml 은 `on:` 을 boolean 키로 파싱할 수 있습니다
  const schedules = (on && on.schedule) || [];
  assert.ok(schedules.length >= 1, 'schedule 트리거가 필요합니다');

  // 매시간 실행: 분 필드는 고정값, 시 필드는 *
  const hourly = schedules.filter((s) => {
    const parts = String(s.cron || s).trim().split(/\s+/);
    return parts.length === 5 && !parts[0].includes('*') && parts[1] === '*';
  });
  assert.equal(hourly.length, 1, '매시간 크론 표현식 1개가 필요합니다');

  assert.match(text, /\/api\/cron\/schedule-watch/, '스케줄 감시 엔드포인트를 호출해야 합니다');
  assert.match(text, /secrets\.CRON_SECRET/, 'CRON_SECRET 시크릿으로 인증해야 합니다');
  assert.match(text, /Authorization: Bearer/, 'Vercel Cron 과 동일한 Bearer 인증 헤더를 사용해야 합니다');
  assert.match(text, /workflow_dispatch/, '수동 실행도 가능해야 합니다');
});
