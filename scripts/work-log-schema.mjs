/**
 * work_logs(근무일지) 문서 필수 필드 점검 — 순수 함수 (읽기 전용)
 * ─────────────────────────────────────────────────────────────────────────────
 * 주간 자가 점검의 `db.integrity` 프로브가 쓰는 판정 로직만 모았습니다.
 * 실데이터는 절대 수정·삭제하지 않고, 표본을 읽어 "앱이 다시 꺼낼 수 있는 문서인지"만 봅니다.
 *
 * ── 2026-11-16 FAIL 1건의 원인 (2026-11-18 규명) ─────────────────────────────
 *   당시 프로브는 `date` 와 **`terminal`/`TERMINAL`** 을 필수로 봤습니다. 그런데 `terminal` 은
 *   터미널 선박 스케줄 문서(`ships`·`vessel_schedules_cache`)의 필드이고, 근무일지에는
 *   존재하지 않는 필드입니다. 근무일지를 저장하는 곳은 클라이언트 한 곳뿐이고
 *   (public/js/app.js saveWorkLog → collection('work_logs').doc(`${workerId}_${date}`).set),
 *   거기에 쓰는 필드는 아래 WORK_LOG_WRITE_FIELDS 뿐입니다. 그래서 표본 20건이 모두
 *   "terminal 누락"으로 잡혀 100% → FAIL 이 났습니다. 데이터는 정상이었습니다.
 *
 * ── 그래서 무엇을 필수로 보는가 ─────────────────────────────────────────────
 *   앱이 일지를 다시 꺼내는 데 반드시 필요한 두 가지, 즉 **날짜**와 **작성자(workerId)** 만 봅니다.
 *   · 날짜: date → dateKey → workDate
 *   · 작성자: workerId
 *   둘 다 없을 때만 문서 ID(`workerId_YYYY-MM-DD`) 접두사·접미사로 대신합니다. 문서 ID 폴백은
 *   관리자 통계(server.ts admin-stats 집계)의 읽기 방식과 같아서, 옛 스키마 문서도 오탐이 되지 않습니다.
 *   폴백으로 읽힌 건수는 따로 세어 보고서에 남깁니다(필드가 비어 있는 문서가 얼마나 되는지 투명하게).
 */

/** 앱이 근무일지를 저장할 때 쓰는 필드 (public/js/app.js saveWorkLog) */
export const WORK_LOG_WRITE_FIELDS = [
  'date',
  'workerId',
  'shipName',
  'wage1',
  'wage2',
  'wage3',
  'wage4',
  'coworkers',
  'memo',
  'totalPay',
  'imageUrl',
  'deletedAt',
  'timestamp'
];

/** 자가 점검이 필수로 보는 키 — 두 개 중 하나라도 없으면 그 문서는 "누락"입니다. */
export const WORK_LOG_REQUIRED_KEYS = ['date', 'workerId'];

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

/** 문서 ID(`workerId_YYYY-MM-DD`)를 접두사(작성자)·접미사(날짜)로 나눕니다. */
export function splitWorkLogDocId(docId) {
  const raw = text(docId);
  const index = raw.indexOf('_');
  if (index < 1) return { workerId: '', date: '' };
  const workerId = raw.slice(0, index).trim();
  const date = raw.slice(index + 1).trim();
  return { workerId, date: DATE_KEY_PATTERN.test(date) ? date : '' };
}

/**
 * 문서 1건의 날짜와 그 근거를 찾습니다. `source` 는 'field' | 'docId' | ''.
 * @param {Record<string, any>} data
 * @param {string} docId
 */
export function resolveWorkLogDate(data = {}, docId = '') {
  for (const key of ['date', 'dateKey', 'workDate']) {
    const value = text(data?.[key]);
    if (value) return { value, source: 'field' };
  }
  const fromId = splitWorkLogDocId(docId).date;
  return fromId ? { value: fromId, source: 'docId' } : { value: '', source: '' };
}

/**
 * 문서 1건의 작성자(workerId)와 그 근거를 찾습니다. `source` 는 'field' | 'docId' | ''.
 * @param {Record<string, any>} data
 * @param {string} docId
 */
export function resolveWorkLogWorkerId(data = {}, docId = '') {
  const direct = text(data?.workerId);
  if (direct) return { value: direct, source: 'field' };
  const fromId = splitWorkLogDocId(docId).workerId;
  return fromId ? { value: fromId, source: 'docId' } : { value: '', source: '' };
}

/**
 * 표본 문서들을 점검해 누락 건수·비율·필드별 내역을 돌려줍니다. (읽기 전용)
 * @param {Array<{id?: string, data?: Record<string, any>} | Record<string, any>>} docs
 */
export function summarizeWorkLogCoverage(docs = []) {
  const list = Array.isArray(docs) ? docs : [];
  const byField = { date: 0, workerId: 0 };
  const viaDocId = { date: 0, workerId: 0 };
  const samples = [];
  let missingCount = 0;

  for (const entry of list) {
    // {id, data} 형태와 평평한 문서 객체 둘 다 받습니다.
    const docId = text(entry?.id ?? entry?.docId ?? '');
    const data = (entry && typeof entry.data === 'object' && entry.data !== null ? entry.data : entry) || {};
    const date = resolveWorkLogDate(data, docId);
    const worker = resolveWorkLogWorkerId(data, docId);
    if (date.source === 'docId') viaDocId.date += 1;
    if (worker.source === 'docId') viaDocId.workerId += 1;

    const missing = [];
    if (!date.value) missing.push('date');
    if (!worker.value) missing.push('workerId');
    if (!missing.length) continue;
    missingCount += 1;
    for (const key of missing) byField[key] += 1;
    if (samples.length < 5) samples.push({ id: docId, missing });
  }

  const total = list.length;
  return {
    total,
    missingCount,
    ratio: total ? missingCount / total : 0,
    byField,
    viaDocId,
    samples
  };
}

/** 보고서에 쓰는 짧은 필드 내역 (예: `date 1·workerId 2`) */
export function describeWorkLogMissingFields(summary) {
  const byField = summary?.byField || {};
  return WORK_LOG_REQUIRED_KEYS
    .filter((key) => Number(byField[key]) > 0)
    .map((key) => `${key} ${Number(byField[key])}`)
    .join('·');
}
