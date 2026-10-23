/**
 * 주간 자가 점검 · 자가 복구 — 배선(wiring) 회귀 방지 테스트
 *
 * 엔진 자체의 동작은 scripts/weekly-self-check.test.mjs 가 검증합니다.
 * 이 파일은 "스케줄·라우트·워크플로·환경변수 문서가 실제로 연결되어 있는지"를 지킵니다.
 *  1. vercel.json 에 주간 크론이 등록되고 Hobby 제약(1일 1회 이하)을 넘지 않는다
 *  2. 서버는 공용 엔진을 임포트한다(판정 로직 중복 구현 금지)
 *  3. 크론/별칭/공개 API 라우트와 node-cron(Asia/Seoul) 등록이 존재한다
 *  4. 2세그먼트 경로용 개별 Vercel 함수가 존재하고 server.ts 를 위임한다
 *  5. GitHub Actions 주간 워크플로가 존재하고 실행 스크립트를 호출한다
 *  6. 주간 1통 중복 발송 방지(ISO 주차 마커)와 기본 수신자(luxrank@gmail.com)가 유지된다
 *  7. .env.example 에 자가 점검 설정이 문서화되어 있다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const serverCode = read('server.ts');
const engineCode = read('scripts/weekly-self-check.mjs');
const vercelJson = JSON.parse(read('vercel.json'));

test('vercel.json: 주간 자가 점검 크론이 등록되고 1일 1회 이하 빈도다', () => {
  const crons = vercelJson.crons || [];
  const job = crons.find((c) => c.path === '/api/cron/weekly-self-check');
  assert.ok(job, 'vercel.json crons 에 /api/cron/weekly-self-check 가 필요합니다');
  assert.equal(job.schedule, '0 20 * * 0', '일요일 20:00 UTC = 월요일 05:00 KST');
  // Vercel Hobby: 1일 1회 초과 표현식은 배포 실패 → 모든 크론의 분·시가 고정값이어야 한다.
  // (일(day-of-month)·요일(dow) 제약은 주 1회 실행이므로 문제되지 않습니다)
  for (const c of crons) {
    const [minute, hour] = String(c.schedule).trim().split(/\s+/);
    assert.match(minute, /^\d+$/, `Hobby 제약: 분은 고정값이어야 합니다 — ${c.path} ${c.schedule}`);
    assert.match(hour, /^\d+$/, `Hobby 제약: 시는 고정값이어야 합니다 — ${c.path} ${c.schedule}`);
  }
});

test('server.ts: 서버 런타임도 공용 엔진(scripts/weekly-self-check.mjs)을 사용한다', () => {
  assert.match(serverCode, /from\s+'\.\/scripts\/weekly-self-check\.mjs'/, '공용 엔진 임포트가 필요합니다');
  assert.match(serverCode, /runWeeklySelfCheck\(/, '엔진 실행 함수를 호출해야 합니다');
  assert.match(serverCode, /generateWeeklySelfCheckMarkdown\(/, '보고서 생성도 엔진을 공유해야 합니다');
  // 자체 판정 로직을 복제하지 않았는지(수집량 급감 임계값 등) 최소 확인
  assert.doesNotMatch(serverCode, /SELF_CHECK_DRIFT_WARN_RATIO/, '임계값 해석은 엔진(resolveSelfCheckConfig)이 단독 담당합니다');
});

test('server.ts: 주간 점검 스케줄 상수와 node-cron(Asia/Seoul) 등록', () => {
  assert.match(serverCode, /WEEKLY_SELF_CHECK_CRON\s*=\s*'0 5 \* \* 1'/, '매주 월요일 05:00 상수');
  assert.match(serverCode, /cron\.schedule\(WEEKLY_SELF_CHECK_CRON/, 'node-cron 등록');
  assert.match(serverCode, /timezone:\s*'Asia\/Seoul'/, '타임존 지정 필수');
});

test('server.ts: 크론·별칭·공개 API 라우트 등록', () => {
  assert.match(serverCode, /app\.get\('\/api\/cron\/weekly-self-check'/, '정식 크론 경로');
  assert.match(serverCode, /app\.get\('\/api\/cron-weekly-self-check'/, '단일 세그먼트 별칭 경로');
  assert.match(serverCode, /app\.get\('\/api\/self-check-report'/, '공개 요약 경로');
  assert.match(serverCode, /authorizeCronRequest\(req,\s*res\)/, 'CRON_SECRET 인증 필수');
});

test('서버 측 복구 동작이 정의되어 있다 (캐시·상태·파생물만)', () => {
  for (const action of [
    'reset-terminal-health',
    'retry-terminal',
    'rebuild-schedule-cache',
    'run-overdue-cleanup',
    'regenerate-report',
    'bootstrap-baseline',
    'escalate-github-issue',
  ]) {
    assert.match(engineCode, new RegExp(`'${action}'`), `복구 동작 ${action} 이 규칙표에 필요합니다`);
  }
  // 원본 사용자 데이터 보호: work_logs/posts/ships 에 대한 쓰기([.set/.update/.delete])가 없어야 한다
  const block = serverCode.slice(serverCode.indexOf('buildServerSelfCheckRepairActions'), serverCode.indexOf('saveWeeklySelfCheckArtifacts'));
  assert.ok(block.length > 1000, '복구 동작 블록을 찾지 못했습니다');
  for (const collection of ['work_logs', 'posts', 'ships']) {
    assert.doesNotMatch(block, new RegExp(`collection\\('${collection}'\\)\\s*\\.\\s*(doc\\()?[^;]*\\.(set|update|delete)\\(`), `${collection} 원본 데이터는 수정하면 안 됩니다`);
  }
  assert.match(block, /vessel_schedules_cache/, '캐시 재구축은 vessel_schedules_cache 에만 수행');
});

test('주간 1통 중복 발송 방지와 기본 수신자', () => {
  assert.match(serverCode, /already_sent_this_week/, '같은 ISO 주차 중복 발송 차단 사유');
  assert.match(serverCode, /readWeeklyEmailMarker/, '주차 마커 조회');
  assert.match(serverCode, /writeWeeklyEmailMarker/, '주차 마커 저장');
  assert.match(engineCode, /DEFAULT_SELF_CHECK_RECIPIENT\s*=\s*'luxrank@gmail\.com'/, '기본 수신자');
});

test('2세그먼트 경로용 Vercel 함수가 존재하고 server.ts 앱을 위임한다', () => {
  const rel = 'api/cron/weekly-self-check.ts';
  assert.ok(existsSync(new URL(`../${rel}`, import.meta.url)), `${rel} 필요`);
  const entry = read(rel);
  assert.match(entry, /import\s*{\s*app\s*}\s*from\s*'\.\.\/\.\.\/server\.js'\s*;/);
  assert.match(entry, /export\s+default\s+app\s*;/);
});

test('GitHub Actions 주간 워크플로: 스케줄·실행·권한·보고서 커밋', () => {
  const rel = '.github/workflows/weekly-self-check.yml';
  assert.ok(existsSync(new URL(`../${rel}`, import.meta.url)), `${rel} 필요`);
  const text = read(rel);
  const parsed = yaml.load(text);
  assert.ok(parsed.on?.schedule?.[0]?.cron, 'schedule 트리거가 필요합니다');
  assert.equal(parsed.on.schedule[0].cron, '0 20 * * 0', '일요일 20:00 UTC = 월요일 05:00 KST');
  assert.ok(parsed.on.workflow_dispatch !== undefined, '수동 실행 허용');
  assert.equal(parsed.permissions?.contents, 'write', '보고서 커밋 권한');
  assert.equal(parsed.permissions?.issues, 'write', '미해결 항목 이슈 생성 권한');
  assert.match(text, /scripts\/weekly-self-check-run\.mjs/, '점검 스크립트 실행');
  assert.match(text, /SELF_CHECK_EMAIL_ON_CLI/, 'CLI 메일 발송 스위치');
  // 메일은 "작업 종료 후" 마지막 단계에서 발송되어야 한다
  assert.match(text, /weekly-self-check-run\.mjs --no-email/, '점검 단계에서는 메일을 보내지 않는다');
  assert.match(text, /--email-only/, '보고서 커밋 후 마지막 단계에서 메일 발송');
  const commitIdx = text.indexOf('보고서 커밋');
  const mailIdx = text.indexOf('보고서 메일 발송');
  assert.ok(commitIdx > 0 && mailIdx > commitIdx, '메일 단계는 보고서 커밋 뒤에 있어야 합니다');
  assert.equal(parsed.on.workflow_dispatch.inputs.force_email.type, 'boolean', '수동 재발송 옵션');
  assert.match(text, /git add -A reports\//, '보고서·기준선 커밋');
});

test('.env.example: 자가 점검 환경변수가 문서화되어 있다', () => {
  const env = read('.env.example');
  for (const key of [
    'SELF_CHECK_ENABLED',
    'SELF_CHECK_AUTO_FIX',
    'SELF_CHECK_DRIFT_WARN_RATIO',
    'SELF_CHECK_DRIFT_FAIL_RATIO',
    'SELF_CHECK_EMAIL_TO',
    'SELF_CHECK_EMAIL_ON_CLI',
    'SELF_CHECK_BASE_URL',
  ]) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} 설명이 필요합니다`);
  }
  assert.match(env, /10\. \[자가 점검\]/, '설정 절 제목');
});

test('package.json: npm run selfcheck 로 수동 실행할 수 있다', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.selfcheck, 'node scripts/weekly-self-check-run.mjs');
});

test('일일 점검도 주간 자가 점검 시스템을 감시한다', () => {
  const daily = read('scripts/daily-inspection.mjs');
  assert.match(daily, /scripts\/weekly-self-check\.mjs/, '필수 파일 목록에 엔진 포함');
  assert.match(daily, /api\/cron\/weekly-self-check/, '라우트 점검');
});
