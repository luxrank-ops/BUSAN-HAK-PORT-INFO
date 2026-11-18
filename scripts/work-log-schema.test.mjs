/**
 * work_logs 필수 필드 점검 — 회귀 방지 테스트
 *
 * 2026-11-16 주간 자가 점검 FAIL 1건("work_logs 표본 20건 필수 필드 누락")은
 * 근무일지에 존재하지 않는 필드(terminal)를 점검이 요구한 **오탐**이었습니다.
 * 이 파일은 (1) 정상 문서가 더 이상 누락으로 잡히지 않는지,
 * (2) 정말 깨진 문서는 여전히 잡히는지, (3) 서버 프로브가 이 판정을 쓰는지를 지킵니다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORK_LOG_WRITE_FIELDS,
  WORK_LOG_REQUIRED_KEYS,
  splitWorkLogDocId,
  resolveWorkLogDate,
  resolveWorkLogWorkerId,
  summarizeWorkLogCoverage,
  describeWorkLogMissingFields
} from './work-log-schema.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** public/js/app.js saveWorkLog 가 쓰는 모양 그대로의 문서 (terminal 없음) */
function appWorkLogDoc(workerId, date, extra = {}) {
  return {
    id: `${workerId}_${date}`,
    data: {
      date,
      workerId,
      shipName: 'ERASMUS FUTURE',
      wage1: 120000,
      wage2: 0,
      wage3: 0,
      wage4: 0,
      coworkers: '',
      memo: '',
      totalPay: 120000,
      imageUrl: '',
      deletedAt: null,
      timestamp: { seconds: 1763452800, nanoseconds: 0 },
      ...extra
    }
  };
}

test('필수 키는 앱이 쓰는 date·workerId 두 개이고, terminal 은 필수가 아니다', () => {
  assert.deepEqual(WORK_LOG_REQUIRED_KEYS, ['date', 'workerId']);
  assert.ok(WORK_LOG_WRITE_FIELDS.includes('date') && WORK_LOG_WRITE_FIELDS.includes('workerId'));
  assert.ok(!WORK_LOG_WRITE_FIELDS.includes('terminal'), '근무일지에는 terminal 필드가 없습니다');
  assert.ok(!WORK_LOG_REQUIRED_KEYS.includes('terminal'), '11-16 오탐의 원인 — terminal 을 요구하면 안 됩니다');
});

test('앱이 저장한 정상 문서 20건은 누락 0건 (11-16 FAIL 재발 방지)', () => {
  const docs = Array.from({ length: 20 }, (_, i) =>
    appWorkLogDoc(`worker${i % 5}`, `2026-11-${String((i % 18) + 1).padStart(2, '0')}`)
  );
  const summary = summarizeWorkLogCoverage(docs);
  assert.equal(summary.total, 20);
  assert.equal(summary.missingCount, 0);
  assert.equal(summary.ratio, 0);
  assert.deepEqual(summary.byField, { date: 0, workerId: 0 });
  assert.equal(describeWorkLogMissingFields(summary), '');
});

test('문서 ID(workerId_YYYY-MM-DD)로 날짜·작성자를 보완한다', () => {
  assert.deepEqual(splitWorkLogDocId('hakdory75_2026-11-16'), { workerId: 'hakdory75', date: '2026-11-16' });
  assert.deepEqual(splitWorkLogDocId('no-date-here'), { workerId: '', date: '' });

  const summary = summarizeWorkLogCoverage([{ id: 'kim_2026-11-15', data: { shipName: 'ONE TRUST' } }]);
  assert.equal(summary.missingCount, 0, '문서 ID 로 읽을 수 있으면 누락이 아닙니다');
  assert.deepEqual(summary.viaDocId, { date: 1, workerId: 1 });
});

test('날짜 필드가 우선이고, dateKey·workDate 옛 이름도 인정한다', () => {
  assert.deepEqual(resolveWorkLogDate({ date: '2026-11-16' }), { value: '2026-11-16', source: 'field' });
  assert.deepEqual(resolveWorkLogDate({ dateKey: '2026-11-14' }), { value: '2026-11-14', source: 'field' });
  assert.deepEqual(resolveWorkLogDate({ workDate: '2026-11-13' }), { value: '2026-11-13', source: 'field' });
  assert.deepEqual(resolveWorkLogDate({}, 'kim_2026-11-12'), { value: '2026-11-12', source: 'docId' });
  assert.deepEqual(resolveWorkLogDate({ memo: '메모만 있음' }, 'memo-only'), { value: '', source: '' });
  assert.deepEqual(resolveWorkLogWorkerId({ workerId: 'kim' }, 'other_2026-11-12'), { value: 'kim', source: 'field' });
  assert.deepEqual(resolveWorkLogWorkerId({}, 'kim_2026-11-12'), { value: 'kim', source: 'docId' });
});

test('정말 깨진 문서는 여전히 누락으로 잡고, 필드 내역을 남긴다', () => {
  const docs = [
    appWorkLogDoc('kim', '2026-11-16'),
    { id: 'broken1', data: { memo: '날짜·작성자 없음' } },
    { id: 'broken2', data: { date: '2026-11-15' } }, // 작성자 없음 + ID 에 접두사 없음
    { id: 'broken3', data: { date: '2026-11-14' } },
  ];
  const summary = summarizeWorkLogCoverage(docs);
  assert.equal(summary.total, 4);
  assert.equal(summary.missingCount, 3);
  assert.equal(summary.ratio, 0.75);
  assert.deepEqual(summary.byField, { date: 1, workerId: 3 });
  assert.equal(describeWorkLogMissingFields(summary), 'date 1·workerId 3');
  assert.equal(summary.samples.length, 3, '표본 내역은 최대 5건까지 남깁니다');
});

test('표본이 없으면 비율 0 (신규 배포에서 FAIL 하지 않음)', () => {
  const summary = summarizeWorkLogCoverage([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.ratio, 0);
  assert.equal(describeWorkLogMissingFields(summary), '');
});

test('서버 db.integrity 프로브가 공용 판정 함수를 쓰고, 읽기 전용이다', () => {
  const server = read('server.ts');
  const start = server.indexOf("id: 'db.integrity'");
  assert.ok(start > 0, 'db.integrity 프로브가 필요합니다');
  const block = server.slice(start, start + 2600);
  assert.match(block, /summarizeWorkLogCoverage\(/, '공용 판정 함수를 써야 합니다');
  assert.match(block, /describeWorkLogMissingFields\(/, '누락 필드 내역을 보고서에 남겨야 합니다');
  // 회귀 방지: 근무일지에 없는 terminal 필드를 다시 요구하면 11-16 오탐이 그대로 재발합니다.
  assert.doesNotMatch(block, /doc\.terminal|doc\.TERMINAL/, 'work_logs 에 terminal 필드를 요구하면 안 됩니다');
  // 원본 데이터 보호: 표본 점검은 읽기만 합니다.
  assert.doesNotMatch(block, /\.(set|update|delete)\s*\(/, '표본 점검에서 원본을 수정하면 안 됩니다');
});
