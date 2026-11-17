/**
 * 근무배치(종이오더) AI 비전 판독 — 예시 이미지 학습(Few-shot) + 엄격한 JSON 스키마
 *
 * 왜 필요한가 (2026-11-17):
 *   종이오더는 선박 1척 = 머리말 1줄(날짜·선박명·시간·회사명) + 아래 작업자 이름 2열 표입니다.
 *   기기 Tesseract 는 표 선을 따라가며 칸을 나눠 읽지만, 사진이 기울거나 그늘이 지면
 *   선박명·이름을 잃습니다(실측: 이름 12/87 ~ 73/96). 사용자가 색 테두리로 표시한 규칙
 *   (파랑=선박 블록, 보라=날짜, 빨강=선박명, 노랑=시간, 검정=회사명, 나머지=작업자 이름)을
 *   레퍼런스 이미지로 함께 보내면, 모델이 "어느 칸이 무엇인지"를 먼저 배운 상태로 판독합니다.
 *
 * 이 파일은 순수 함수만 담습니다(요청 본문·프롬프트·응답 정규화). 네트워크 호출은
 * runRosterAiVisionRequest 하나에 모으고 fetch/토큰 발급기를 주입받아 테스트합니다.
 */

export const ROSTER_AI_VISION_DEFAULT_MODEL = 'gemini-3.8-flash';
export const ROSTER_AI_VISION_GENERATIVE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
export const ROSTER_AI_VISION_VERTEX_LOCATION_DEFAULT = 'global';
export const ROSTER_AI_VISION_TIMEOUT_MS = 25000;
/** AI 판독 실패(키 없음·권한 없음·타임아웃)를 같은 인스턴스에서 다시 시도하지 않는 시간 */
export const ROSTER_AI_VISION_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

/** 모델이 지켜야 하는 JSON 스키마 — Gemini responseSchema(OpenAPI 부분집합) */
export const ROSTER_AI_VISION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    vessels: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: '월/일 (예: 11/17). 읽지 못하면 빈 문자열' },
          vesselName: { type: 'STRING', description: '선박명 영문 대문자 (예: ERASMUS FUTURE)' },
          time: { type: 'STRING', description: '24시간제 HH:MM (예: 22:00). 읽지 못하면 빈 문자열' },
          company: { type: 'STRING', description: '회사명 (예: 우진, KML, 웨스턴)' },
          workers: { type: 'ARRAY', items: { type: 'STRING' }, description: '작업자 이름만. 이름 뒤 숫자는 붙여 쓴다' },
          notes: { type: 'ARRAY', items: { type: 'STRING' }, description: '원문자·형광펜 메모 등 이름이 아닌 표시' }
        },
        required: ['date', 'vesselName', 'time', 'company', 'workers', 'notes'],
        propertyOrdering: ['date', 'vesselName', 'time', 'company', 'workers', 'notes']
      }
    },
    unreadable: { type: 'STRING', description: '읽지 못한 영역 설명(없으면 빈 문자열)' }
  },
  required: ['vessels']
};

/** 이름이 아닌 메모 표시 — 기존 기기 판독(roster-engine.js ROSTER_WORK_NOTE_PATTERN)과 같은 낱말 */
const WORK_NOTE_PATTERN = /(벌크|선적|벨트|추가|작업|상차|하차|하역|적재|양하|반입|반출|명단|변경|지원|휴무|보수|지원)/;
const CIRCLED_MARK_PATTERN = /[\u2460-\u2473\u3251-\u325F]/g;

export function buildRosterAiVisionInstruction(options = {}) {
  const referenceDate = /^\d{4}-\d{2}-\d{2}$/.test(String(options.defaultDate || ''))
    ? String(options.defaultDate)
    : '';
  return [
    '너는 부산항 근무배치(종이오더) 사진을 읽어 JSON 으로 옮기는 판독기다.',
    '첫 번째 이미지는 사람이 색 테두리로 규칙을 표시한 예시(레퍼런스)이고, 두 번째 이미지가 실제 판독 대상이다.',
    '',
    '[색 테두리 규칙 — 예시 이미지]',
    '- 파란색 굵은 테두리 = 선박 1척의 블록 (머리말 1줄 + 그 아래 작업자 이름 칸 전체)',
    '- 보라색 테두리 = 날짜 (월/일, 예: 11/17)',
    '- 빨간색 테두리 = 선박명 (영문, 예: ERASMUS FUTURE, ONE TRUST, JIA DE)',
    '- 노란색 테두리 = 시간 (24시간제, 예: 22:00, 08:00)',
    '- 검정색 테두리 = 회사명 (한글, 예: 우진, KML, 웨스턴, 동해, 합동)',
    '- 테두리가 없는 아래 칸 = 작업자 이름. 원문자(①②③④)와 형광펜 메모(05:00추가, 15:00추가, DGT 지원)는 이름이 아니다.',
    '',
    '[출력 규칙]',
    '1. 선박 블록 1개마다 vessels 배열의 원소 1개를 만든다. 표를 왼쪽 위 → 오른쪽 아래 순서로 읽는다.',
    '2. date 는 월/일만 쓴다(예: 11/17). 연도는 쓰지 않는다. 읽지 못하면 "".',
    '3. time 은 24시간제 HH:MM 으로만 쓴다(예: 22:00). 읽지 못하면 "".',
    '4. workers 에는 인쇄된 이름만 넣는다. 읽는 순서는 왼쪽 열 위→아래, 그다음 오른쪽 열 위→아래다.',
    '   이름 뒤에 붙은 숫자는 그대로 붙여 쓴다(예: 김유신1, 이승환2, 김찬우1).',
    '   원문자·형광펜 메모·"지원"·"추가" 같은 표시는 workers 에 넣지 말고 notes 에 넣는다.',
    '5. 보이지 않는 이름을 만들어 내지 않는다. 흐려서 읽기 어려우면 추측해 다른 이름으로 바꾸지 말고 빼거나 읽은 그대로 둔다.',
    '6. 빈 칸·빈 행은 vessels 에 넣지 않는다. 선박명이 없는 칸은 선박 블록이 아니다.',
    '7. 설명·주석 없이 JSON 하나만 출력한다.',
    `8. 스키마: {"vessels":[{"date":"11/17","vesselName":"ERASMUS FUTURE","time":"22:00","company":"우진","workers":["최정한","신경호"],"notes":["05:00추가"]}],"unreadable":""}`,
    referenceDate ? `9. 기준 날짜(연도 판단용, 출력에는 쓰지 않음): ${referenceDate}` : ''
  ].filter(Boolean).join('\n');
}

/** Gemini REST(generateContent) 요청 본문 — 레퍼런스(예시) + 판독 대상 2장을 함께 보냅니다. */
export function buildRosterAiVisionRequestBody(options = {}) {
  const targetBase64 = String(options.imageBase64 || '');
  const referenceBase64 = String(options.referenceBase64 || '');
  const targetMime = String(options.imageMimeType || 'image/jpeg');
  const referenceMime = String(options.referenceMimeType || 'image/jpeg');
  const thinkingBudget = options.thinkingBudget === undefined || options.thinkingBudget === null || options.thinkingBudget === ''
    ? null
    : Number(options.thinkingBudget);
  const parts = [{ text: buildRosterAiVisionInstruction(options) }];
  if (referenceBase64) {
    parts.push({ text: '예시(레퍼런스) 이미지 — 색 테두리 규칙을 표시한 사진:' });
    parts.push({ inlineData: { mimeType: referenceMime, data: referenceBase64 } });
  }
  parts.push({ text: '판독 대상 이미지 — 위 규칙으로 읽어야 하는 실제 근무배치 사진:' });
  parts.push({ inlineData: { mimeType: targetMime, data: targetBase64 } });
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: ROSTER_AI_VISION_RESPONSE_SCHEMA,
      maxOutputTokens: 8192,
      // 사고(thinking) 토큰은 응답 지연과 비용을 키웁니다. 0 이면 끄고, 모델이 0 을 거부하면
      // runRosterAiVisionRequest 가 thinkingConfig 없이 한 번 다시 호출합니다.
      ...(Number.isFinite(thinkingBudget) ? { thinkingConfig: { thinkingBudget } } : {})
    }
  };
}

/** Gemini 응답에서 JSON 본문 텍스트만 꺼냅니다(사고 파트 제외). */
export function extractRosterAiVisionText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => part && typeof part.text === 'string' && part.thought !== true)
    .map((part) => part.text)
    .join('')
    .trim();
}

/** ```json 펜스·앞뒤 설명이 섞여도 첫 객체를 읽습니다. */
export function parseRosterAiVisionJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const withoutFence = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const candidates = [withoutFence];
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(withoutFence.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* 다음 후보를 시도합니다 */
    }
  }
  return null;
}

/** 11/17 · 11.17 · 11월 17일 → YYYY-MM-DD (연도는 기준 날짜에서 고릅니다) */
export function normalizeRosterAiDate(value, options = {}) {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text) return '';
  const full = text.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (full) return toIsoDate(full[1], full[2], full[3]);
  const short = text.match(/(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (!short) return '';
  const month = Number(short[1]);
  const day = Number(short[2]);
  const base = resolveBaseDate(options);
  const year = resolveYearForMonth(month, base);
  return toIsoDate(year, month, day);
}

function resolveBaseDate(options) {
  const supplied = String(options.defaultDate || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(supplied)) return supplied;
  const now = options.now instanceof Date ? options.now : new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function resolveYearForMonth(month, baseDate) {
  const baseYear = Number(String(baseDate).slice(0, 4)) || new Date().getFullYear();
  const baseMonth = Number(String(baseDate).slice(5, 7)) || 1;
  // 12월 말에 본 1/2, 1월 초에 본 12/31 같은 연말 경계를 기준 날짜에서 되짚습니다.
  if (month - baseMonth > 6) return baseYear - 1;
  if (baseMonth - month > 6) return baseYear + 1;
  return baseYear;
}

function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '';
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 22:00 · 22시 · 2200 → HH:MM */
export function normalizeRosterAiTime(value) {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text) return '';
  const withColon = text.match(/(\d{1,2})\s*[:.시]\s*(\d{1,2})(?!\d)/);
  const hourOnly = withColon ? null : text.match(/(\d{1,2})\s*시(?!\s*간)/);
  const compact = withColon || hourOnly ? null : text.match(/^(\d{3,4})$/);
  const hour = withColon
    ? Number(withColon[1])
    : hourOnly
      ? Number(hourOnly[1])
      : compact
        ? Math.floor(Number(compact[1]) / 100)
        : NaN;
  const minute = withColon ? Number(withColon[2]) : compact ? Number(compact[1]) % 100 : 0;
  if (!(hour >= 0 && hour < 24) || !(minute >= 0 && minute < 60)) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 선박명: 공백·기호만 정리하고 대문자로. 영문 3글자 미만(회사명·잡음)은 선박명이 아닙니다. */
export function normalizeRosterAiVesselName(value) {
  const text = String(value || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, ' ').trim();
  const cleaned = text.replace(/^[\s[("'`]+|[\s\])"'`.,;:]+$/g, '').replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const letters = cleaned.match(/[A-Za-z]/g) || [];
  if (letters.length < 3) return '';
  return cleaned.toUpperCase();
}

/** 작업자 이름 정규화 — 원문자·형광펜 메모·문장 부호를 떼고 한글 이름만 남깁니다. */
export function normalizeRosterAiWorkerName(value) {
  let text = String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, ' ');
  text = text.replace(CIRCLED_MARK_PATTERN, ' ');
  text = text.replace(/^\s*[(\[]?\d{1,2}[)\]]?\s*/, ' ');
  text = text.replace(/\s+/g, '');
  if (!text) return '';
  if (WORK_NOTE_PATTERN.test(text)) return '';
  // 한글 이름 2~5자 + 이름 뒤 구분 숫자(김유신1)까지 허용합니다.
  if (!/^[가-힣]{2,5}\d?$/.test(text)) return '';
  return text;
}

function splitWorkerCandidates(value) {
  if (Array.isArray(value)) return value.flatMap(splitWorkerCandidates);
  const text = String(value ?? '');
  return text
    .split(/[,、\n\t]+|\s{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWorkerList(value) {
  const names = [];
  const notes = [];
  for (const item of splitWorkerCandidates(value)) {
    if (item && typeof item === 'object') {
      const name = normalizeRosterAiWorkerName(item.name ?? item.worker ?? '');
      if (name) names.push(name);
      const note = String(item.note ?? item.memo ?? '').trim();
      if (note) notes.push(note);
      continue;
    }
    const name = normalizeRosterAiWorkerName(item);
    if (name) names.push(name);
    else if (WORK_NOTE_PATTERN.test(String(item)) || CIRCLED_MARK_PATTERN.test(String(item))) {
      const note = String(item).trim();
      if (note) notes.push(note);
    }
  }
  return { names: dedupe(names), notes: dedupe(notes.filter(Boolean)) };
}

function dedupe(list) {
  const seen = new Set();
  const output = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    output.push(item);
  }
  return output;
}

/**
 * 모델이 돌려준 JSON(또는 vessels 배열)을 앱 검토표 행으로 바꿉니다.
 * 반환 rows 는 roster-engine.js 의 사진 검토 행과 같은 필드를 씁니다.
 */
export function normalizeRosterAiVisionResult(payload, options = {}) {
  const vessels = Array.isArray(payload) ? payload : Array.isArray(payload?.vessels) ? payload.vessels : [];
  const rows = [];
  const notesWithoutVessel = [];
  vessels.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const vessel = normalizeRosterAiVesselName(item.vesselName ?? item.vessel ?? item.name ?? '');
    const workerList = normalizeWorkerList(item.workers ?? []);
    const extraNotes = Array.isArray(item.notes) ? item.notes : item.notes ? [item.notes] : [];
    const notes = dedupe([
      ...extraNotes.map((note) => String(note ?? '').trim()).filter(Boolean),
      ...workerList.notes
    ]);
    if (!vessel) {
      // 선박명을 읽지 못한 칸의 이름은 엉뚱한 선박에 붙이지 않고 경고로 남깁니다.
      if (workerList.names.length) notesWithoutVessel.push(...workerList.names);
      return;
    }
    const date = normalizeRosterAiDate(item.date ?? '', options);
    const time = normalizeRosterAiTime(item.time ?? '');
    const company = String(item.company ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const support = notes.find((note) => /지원/.test(note)) || '';
    const group = (String(item.group ?? '').match(/\d{1,2}/) || [''])[0];
    rows.push({
      date,
      vessel,
      time,
      company,
      support,
      group,
      note: notes.join(' · '),
      workers: workerList.names,
      sourceOcrLine: [date ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : '', vessel, time, company].filter(Boolean).join(' '),
      sourceOcrVessel: vessel,
      sourceWorkerCount: workerList.names.length,
      source: 'photo-ai'
    });
  });

  const warnings = [];
  if (!rows.length) {
    warnings.push('AI 비전이 선박 블록을 찾지 못했습니다. 사진을 다시 찍거나 기기 판독·직접 입력으로 진행해 주세요.');
  } else {
    warnings.push('🤖 예시 이미지(색 테두리 규칙)로 학습한 AI 비전이 읽은 1차 결과입니다. 적용 전에 원본 사진과 대조해 주세요.');
  }
  const missingDate = rows.filter((row) => !row.date).length;
  const missingTime = rows.filter((row) => !row.time).length;
  const missingCompany = rows.filter((row) => !row.company).length;
  const missingWorkers = rows.filter((row) => !row.workers.length).length;
  if (missingDate) warnings.push(`${missingDate}척은 날짜를 읽지 못했습니다. 검토 표에서 날짜를 채워 주세요.`);
  if (missingTime) warnings.push(`${missingTime}척은 시간을 읽지 못했습니다.`);
  if (missingCompany) warnings.push(`${missingCompany}척은 회사명을 읽지 못했습니다.`);
  if (missingWorkers) warnings.push(`${missingWorkers}척은 작업자 이름을 읽지 못했습니다.`);
  if (notesWithoutVessel.length) {
    warnings.push(`선박명이 없는 칸에서 읽은 이름 ${notesWithoutVessel.length}개(${notesWithoutVessel.slice(0, 6).join(', ')})는 어느 선박에도 붙이지 않았습니다.`);
  }
  const unreadable = String(payload?.unreadable || '').trim();
  if (unreadable) warnings.push(`읽지 못한 영역: ${unreadable}`);

  return {
    entries: rows,
    warnings,
    workerCount: rows.reduce((sum, row) => sum + row.workers.length, 0),
    text: buildRosterAiVisionText(rows)
  };
}

/** 검토표 옆 원문 상자에 넣을 사람이 읽는 형태 */
export function buildRosterAiVisionText(rows) {
  return (rows || []).map((row) => {
    const header = [
      row.date ? `${row.date.slice(5, 7)}/${row.date.slice(8, 10)}` : '',
      row.vessel,
      row.time,
      row.company
    ].filter(Boolean).join(' ');
    const workers = row.workers.join(', ');
    const note = row.note ? `  [${row.note}]` : '';
    return `${header}${workers ? ` | ${workers}` : ''}${note}`;
  }).join('\n');
}

/** 이 환경에서 AI 비전을 시도할 자격이 있는지 (호출 성공 여부와는 다릅니다) */
export function hasRosterAiVisionCredential(env = {}) {
  if (String(env.ROSTER_AI_VISION || '').trim() === '0') return false;
  return Boolean(
    String(env.GEMINI_API_KEY || '').trim()
    || String(env.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim()
    || String(env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()
  );
}

export function resolveRosterAiVisionModel(env = {}) {
  return String(env.ROSTER_AI_VISION_MODEL || '').trim() || ROSTER_AI_VISION_DEFAULT_MODEL;
}

function generativeEndpoint(env) {
  const base = String(env.ROSTER_AI_VISION_GENERATIVE_ENDPOINT || '').trim() || ROSTER_AI_VISION_GENERATIVE_ENDPOINT;
  return base.replace(/\/+$/, '');
}

function vertexEndpoint(env, model, projectId) {
  const project = String(projectId || env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '').trim();
  if (!project) return '';
  const location = String(env.ROSTER_AI_VISION_VERTEX_LOCATION || '').trim() || ROSTER_AI_VISION_VERTEX_LOCATION_DEFAULT;
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function summarizeAttempt(status, body) {
  const message = body?.error?.message || body?.error?.status || '';
  return `HTTP ${status}${message ? `: ${String(message).slice(0, 160)}` : ''}`;
}

/**
 * AI 비전 1차 판독. 성공하면 검토표 행을, 실패하면 이유를 돌려줍니다(예외를 던지지 않음).
 *
 * 자격 우선순위:
 *   1) GEMINI_API_KEY (Google AI Studio 키) → generativelanguage API
 *   2) 기존 Firebase 서비스 계정 → Vertex AI (새 키를 만들지 않아도 되는 경로)
 */
export async function runRosterAiVisionRequest(options = {}) {
  const env = options.env || {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now instanceof Date ? options.now : new Date();
  const state = options.state || {};
  const model = resolveRosterAiVisionModel(env);
  const attempts = [];
  const imageBase64 = String(options.imageBase64 || '');
  if (!imageBase64) return { ok: false, reason: 'missing_image', model, attempts };
  if (!hasRosterAiVisionCredential(env)) return { ok: false, reason: 'no_credential', model, attempts };
  if (!env.ROSTER_AI_VISION_FORCE && Number(state.blockedUntil || 0) > now.getTime()) {
    // 쿨다운 중에도 직전 시도의 상태 코드를 돌려줘 설정 문제를 바로 알 수 있게 합니다.
    return { ok: false, reason: 'cooldown', model, attempts: Array.isArray(state.lastAttempts) ? state.lastAttempts : [] };
  }

  const body = JSON.stringify(buildRosterAiVisionRequestBody({
    ...options,
    imageBase64,
    referenceBase64: options.referenceBase64,
    referenceMimeType: options.referenceMimeType,
    imageMimeType: options.imageMimeType,
    thinkingBudget: options.thinkingBudget ?? env.ROSTER_AI_VISION_THINKING_BUDGET ?? 0
  }));
  // 사고 토큰을 끈 요청을 모델이 거부하면(400) thinkingConfig 없이 한 번 더 시도합니다.
  const withoutThinking = JSON.stringify(buildRosterAiVisionRequestBody({
    ...options,
    imageBase64,
    referenceBase64: options.referenceBase64,
    referenceMimeType: options.referenceMimeType,
    imageMimeType: options.imageMimeType,
    thinkingBudget: null
  }));

  const call = async (url, headers, provider) => {
    const send = async (payload) => {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), ROSTER_AI_VISION_TIMEOUT_MS) : null;
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: payload,
          signal: controller?.signal
        });
        const data = await response.json().catch(() => null);
        return { response, data };
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    try {
      let { response, data } = await send(body);
      if (response.status === 400 && /think/i.test(String(data?.error?.message || '')) && body !== withoutThinking) {
        const retry = await send(withoutThinking);
        response = retry.response;
        data = retry.data;
      }
      if (!response.ok) {
        attempts.push({ provider, status: response.status, error: summarizeAttempt(response.status, data) });
        return null;
      }
      const text = extractRosterAiVisionText(data);
      const parsed = parseRosterAiVisionJson(text);
      if (!parsed) attempts.push({ provider, status: response.status, error: 'empty_json' });
      return parsed ? { parsed, provider, model } : null;
    } catch (error) {
      attempts.push({ provider, status: 0, error: String(error?.message || error).slice(0, 160) });
      return null;
    }
  };

  const apiKey = String(env.GEMINI_API_KEY || '').trim();
  if (apiKey) {
    const url = `${generativeEndpoint(env)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const result = await call(url, {}, 'gemini-api');
    if (result) return finish(result, options);
  }

  const tokenProvider = options.getAccessToken;
  const vertexUrl = vertexEndpoint(env, model, options.projectId);
  if (tokenProvider && vertexUrl) {
    try {
      const token = await tokenProvider();
      if (token) {
        const result = await call(vertexUrl, { Authorization: `Bearer ${token}` }, 'vertex-gemini');
        if (result) return finish(result, options);
      } else {
        attempts.push({ provider: 'vertex-gemini', status: 0, error: 'no_access_token' });
      }
    } catch (error) {
      attempts.push({ provider: 'vertex-gemini', status: 0, error: String(error?.message || error).slice(0, 160) });
    }
  }

  // 자격은 있는데 호출이 실패하면 잠시 건너뜁니다(사진마다 25초를 버리지 않도록).
  state.lastAttempts = attempts.slice();
  state.blockedUntil = now.getTime() + ROSTER_AI_VISION_FAILURE_COOLDOWN_MS;
  return { ok: false, reason: 'request_failed', model, attempts };
}

function finish(result, options) {
  const normalized = normalizeRosterAiVisionResult(result.parsed, options);
  return {
    ok: true,
    provider: result.provider,
    model: result.model,
    entries: normalized.entries,
    warnings: normalized.warnings,
    workerCount: normalized.workerCount,
    text: normalized.text,
    attempts: []
  };
}
