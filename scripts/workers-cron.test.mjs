import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ⏰ Cloudflare Workers Cron Trigger 회귀 방지 (2026-11-23)
// 배경: GitHub Actions 예약 실행이 2026-08-27 이후 '느린 레인'으로 밀려 매시간 크론이
//       7~8시간 간격(하루 3회)으로만 돌았습니다. 매시간 선박 스케줄 감시의 주 경로를
//       Cloudflare Cron Trigger '5 * * * *' 로 옮기고, worker/index.ts 의 scheduled
//       핸들러가 그 문자열을 /api/cron/* 로 매핑합니다.
//       → wrangler.jsonc 의 크론과 worker 매핑 표가 어긋나면 조용히 실행되지 않으므로 여기서 고정합니다.

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/** 주석(// ...)을 제거해 JSONC 를 JSON 으로 파싱합니다. 문자열 안의 // 는 다루지 않습니다(설정 파일 한정). */
function parseJsonc(text) {
  const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(withoutBlock.replace(/^\s*\/\/.*$/gm, ''));
}

const wrangler = parseJsonc(read('wrangler.jsonc'));
const worker = read('worker/index.ts');
const crons = wrangler.triggers?.crons ?? [];

test('wrangler.jsonc 에 매시간 선박 스케줄 감시 크론(5 * * * *)이 등록되어 있다', () => {
  assert.ok(crons.includes('5 * * * *'), "매시간 크론 '5 * * * *' 이 없습니다");
  assert.ok(crons.length <= 5, 'Cloudflare Workers Free 플랜은 계정당 Cron Trigger 5개까지입니다');
});

test('기존 매일·매주 크론 4종은 그대로 유지된다', () => {
  for (const cron of ['0 3 * * *', '0 0 * * SUN', '0 19 * * *', '0 20 * * SUN']) {
    assert.ok(crons.includes(cron), `${cron} 크론이 사라졌습니다`);
  }
});

test('worker scheduled 핸들러가 모든 크론을 /api/cron/* 로 매핑한다', () => {
  const table = worker.slice(worker.indexOf('const CRON_TASKS'), worker.indexOf('}', worker.indexOf('const CRON_TASKS')));
  for (const cron of crons) {
    assert.ok(table.includes(`'${cron}'`), `CRON_TASKS 에 '${cron}' 매핑이 없습니다`);
  }
  assert.match(table, /'5 \* \* \* \*':\s*'\/api\/cron\/schedule-watch'/, '매시간 크론은 schedule-watch 를 호출해야 합니다');
});

test('선박 스케줄 감시 워크플로는 대상 URL 을 저장소 variable 로 덮어쓸 수 있다', () => {
  const workflow = read('.github/workflows/cron-schedule-watch.yml');
  // 2026-11-23: GitHub App 에 workflows 권한이 없어 워크플로 파일 자체는 앱이 수정할 수 없습니다.
  // 전환은 저장소 variable SCHEDULE_WATCH_URL 로 하고, 파일 기본값은 보조 트리거용으로 남겨 둡니다.
  assert.match(workflow, /APP_URL: \$\{\{ vars\.SCHEDULE_WATCH_URL \|\| 'https:\/\/busan-hak-port-info\.vercel\.app' \}\}/,
    'SCHEDULE_WATCH_URL variable 로 대상 URL 을 바꿀 수 있어야 합니다');
});

test('정적 호스팅 클라이언트의 폴백 API 주소도 workers.dev 를 가리킨다', () => {
  // GitHub Pages 등 정적 호스팅에서 앱을 열면 이 주소로 API 를 호출합니다.
  // vercel.app 이 2026-12-20 종료되므로 폴백이 옛 주소를 가리키면 그때부터 로그인·기록이 끊깁니다.
  const appJs = read('public/js/app.js');
  assert.match(appJs, /const FALLBACK_PRODUCTION_API_ORIGIN = "https:\/\/busan-hak-port-info\.luxrank\.workers\.dev";/);
});

test('주간 자가 점검 워크플로도 대상 URL 을 variable 로 덮어쓸 수 있다', () => {
  const workflow = read('.github/workflows/weekly-self-check.yml');
  assert.match(workflow, /SELF_CHECK_BASE_URL: \$\{\{ vars\.SELF_CHECK_BASE_URL \|\| 'https:\/\/busan-hak-port-info\.vercel\.app' \}\}/);
});
