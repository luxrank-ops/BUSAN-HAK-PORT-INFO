import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const workflowPath = new URL('../.github/workflows/daily-inspection.yml', import.meta.url);
const workflowText = readFileSync(workflowPath, 'utf8');
const workflow = yaml.load(workflowText);
const steps = workflow.jobs.inspect.steps;

test('일일 점검에서 Firestore 규칙 에뮬레이터를 실행하고 실패를 숨기지 않는다', () => {
  const javaSetupIndex = steps.findIndex((step) => step.uses === 'actions/setup-java@v6');
  const rulesIndex = steps.findIndex((step) => step.id === 'rules');
  const artifactIndex = steps.findIndex((step) => step.uses === 'actions/upload-artifact@v4');
  const finalStatusIndex = steps.findIndex((step) => step.name === '점검 결과를 워크플로 상태에 반영');

  assert.ok(javaSetupIndex >= 0, 'Firestore emulator 테스트에 필요한 Java 21 설정이 필요합니다');
  assert.ok(rulesIndex > javaSetupIndex, 'Java를 설치한 뒤 규칙 에뮬레이터 테스트를 실행해야 합니다');
  assert.ok(artifactIndex > rulesIndex, '테스트 실패에도 결과 아티팩트를 보존해야 합니다');
  assert.ok(finalStatusIndex > artifactIndex, '보고서 보존 후 실패 상태를 최종 반영해야 합니다');

  const rulesStep = steps[rulesIndex];
  assert.match(rulesStep.run, /echo "exit_code=\$\{status\}" >> "\$GITHUB_OUTPUT"/);
  assert.match(rulesStep.run, /exit 0/, '진단 자료와 보고서를 남긴 뒤 최종 단계에서 실패 처리해야 합니다');

  const finalStep = steps[finalStatusIndex];
  assert.equal(finalStep.if, 'always()');
  assert.match(finalStep.run, /QUALITY_OUTCOME/);
  assert.match(finalStep.run, /INSPECTION_EXIT_CODE/);
  assert.match(finalStep.run, /RULES_EXIT_CODE/);
  assert.match(finalStep.run, /REPORT_COMMIT_OUTCOME/);
  assert.match(finalStep.run, /exit "\$failed"/);
});

test('일일 품질 검사와 보고서 푸시 실패는 Actions 결과에 반영된다', () => {
  assert.ok(steps.some((step) => step.id === 'quality' && step.run === 'npm run check'));
  const reportCommit = steps.find((step) => step.id === 'report_commit');
  assert.ok(reportCommit);
  assert.match(reportCommit.run, /git push\s*$/m);
  assert.doesNotMatch(reportCommit.run, /git push\s*\|\|/, '보고서 푸시 실패를 성공처럼 숨기면 안 됩니다');
});

test('SEO 대표 URL과 사이트맵은 공식 Vercel 도메인을 사용한다', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  const official = 'https://busan-hak-port-info.vercel.app';

  assert.ok(html.includes(`<meta property="og:url" content="${official}/">`));
  assert.ok(html.includes(`<link rel="canonical" href="${official}/">`));
  assert.ok(robots.includes(`Sitemap: ${official}/sitemap.xml`));
  assert.ok(sitemap.includes(`<loc>${official}/</loc>`));
  assert.equal(`${html}${robots}${sitemap}`.includes('https://busan-hak-port.web.app'), false);
});
