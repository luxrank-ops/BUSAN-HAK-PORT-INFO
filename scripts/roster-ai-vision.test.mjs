import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    ROSTER_AI_VISION_DEFAULT_MODEL,
    ROSTER_AI_VISION_RESPONSE_SCHEMA,
    buildRosterAiVisionInstruction,
    buildRosterAiVisionRequestBody,
    buildRosterAiVisionText,
    extractRosterAiVisionText,
    hasRosterAiVisionCredential,
    normalizeRosterAiDate,
    normalizeRosterAiTime,
    normalizeRosterAiVesselName,
    normalizeRosterAiVisionResult,
    normalizeRosterAiWorkerName,
    parseRosterAiVisionJson,
    resolveRosterAiVisionModel,
    runRosterAiVisionRequest
} from './roster-ai-vision.mjs';
import { ROSTER_AI_VISION_REFERENCE_BASE64 } from './roster-ai-vision-reference.mjs';

/**
 * 근무배치 AI 비전 판독 (2026-11-17)
 *
 * 사용자가 색 테두리로 표시한 규칙(파랑=선박 블록, 보라=날짜, 빨강=선박명, 노랑=시간,
 * 검정=회사명, 나머지=작업자 이름)을 레퍼런스 이미지로 함께 보내고, 모델 응답을 앱 검토표 행으로
 * 바꾸는 규칙을 고정합니다. 실제 호출 없이 요청 본문·정규화·폴백만 검사합니다.
 */

const PHOTO_ONE_PAYLOAD = {
    vessels: [
        {
            date: '11/17',
            vesselName: 'ERASMUS FUTURE',
            time: '22:00',
            company: '우진',
            workers: ['①최정한', '최동일', '박상원', '신경호', '노익규', '김근우1', '이봉호', '윤승주'],
            notes: []
        },
        {
            date: '11/17',
            vesselName: 'ONE TRUST',
            time: '23:00',
            company: 'KML',
            workers: ['오규환', '정영중', '이경덕', '박규태', '김유신1', '안영준', '05:00추가'],
            notes: ['②', '05:00추가']
        },
        {
            date: '11/18',
            vesselName: 'WAN HAI A12',
            time: '07:00',
            company: '동해',
            workers: ['이종림', '전상진', '이준필', 'DGT 지원'],
            notes: ['DGT 지원']
        }
    ],
    unreadable: ''
};

function geminiResponse(payload, options = {}) {
    return {
        candidates: [{
            content: {
                parts: [
                    ...(options.thought ? [{ text: '생각 과정...', thought: true }] : []),
                    { text: typeof payload === 'string' ? payload : JSON.stringify(payload) }
                ]
            },
            finishReason: 'STOP'
        }]
    };
}

function jsonResponse(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('프롬프트는 다섯 색 테두리 규칙과 JSON 스키마를 모델에 알려 준다', () => {
    const instruction = buildRosterAiVisionInstruction({ defaultDate: '2026-11-17' });
    for (const color of ['파란색', '보라색', '빨간색', '노란색', '검정색']) {
        assert.match(instruction, new RegExp(color));
    }
    assert.match(instruction, /원문자/);
    assert.match(instruction, /형광펜 메모/);
    assert.match(instruction, /김유신1/);
    assert.match(instruction, /JSON 하나만/);
    assert.match(instruction, /2026-11-17/);
    assert.equal(ROSTER_AI_VISION_RESPONSE_SCHEMA.properties.vessels.items.required.includes('workers'), true);
});

test('요청 본문은 레퍼런스(예시) 이미지와 판독 대상 이미지를 함께 보내고 JSON 스키마로 묶는다', () => {
    const body = buildRosterAiVisionRequestBody({
        imageBase64: 'VEFSR0VU',
        referenceBase64: 'UkVGRVJFTkNF',
        defaultDate: '2026-11-17'
    });
    const parts = body.contents[0].parts;
    const inline = parts.filter((part) => part.inlineData);
    assert.equal(inline.length, 2);
    assert.equal(inline[0].inlineData.data, 'UkVGRVJFTkNF');
    assert.equal(inline[1].inlineData.data, 'VEFSR0VU');
    assert.equal(inline[0].inlineData.mimeType, 'image/jpeg');
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(body.generationConfig.responseSchema, ROSTER_AI_VISION_RESPONSE_SCHEMA);
    assert.equal(body.generationConfig.temperature, 0);
    // 사고 토큰은 기본적으로 끕니다(0). 지정하지 않으면 thinkingConfig 자체를 보내지 않습니다.
    const withThinkingOff = buildRosterAiVisionRequestBody({ imageBase64: 'VEFSR0VU', thinkingBudget: 0 });
    assert.equal(withThinkingOff.generationConfig.thinkingConfig.thinkingBudget, 0);
    assert.equal('thinkingConfig' in body.generationConfig, false);
    const withoutReference = buildRosterAiVisionRequestBody({ imageBase64: 'VEFSR0VU' });
    assert.equal(withoutReference.contents[0].parts.filter((part) => part.inlineData).length, 1);
});

test('모델 응답 텍스트에서 사고 파트를 빼고 JSON 만 꺼낸다(```json 펜스 포함)', () => {
    const payload = geminiResponse(PHOTO_ONE_PAYLOAD, { thought: true });
    const text = extractRosterAiVisionText(payload);
    assert.equal(text.includes('생각 과정'), false);
    assert.equal(parseRosterAiVisionJson(text).vessels.length, 3);
    assert.equal(parseRosterAiVisionJson('```json\n{"vessels":[]}\n```').vessels.length, 0);
    assert.equal(parseRosterAiVisionJson('설명입니다. {"vessels":[]} 이상입니다.').vessels.length, 0);
    assert.equal(parseRosterAiVisionJson('not json'), null);
});

test('날짜는 MM/DD 를 기준 날짜의 연도로 채우고 연말 경계를 되짚는다', () => {
    assert.equal(normalizeRosterAiDate('11/17', { defaultDate: '2026-11-17' }), '2026-11-17');
    assert.equal(normalizeRosterAiDate('11.18', { defaultDate: '2026-11-17' }), '2026-11-18');
    assert.equal(normalizeRosterAiDate('11월 18일', { defaultDate: '2026-11-17' }), '2026-11-18');
    assert.equal(normalizeRosterAiDate('2026-11-18', {}), '2026-11-18');
    // 1월 초에 본 12/31 은 지난해, 12월 말에 본 1/2 는 다음 해입니다.
    assert.equal(normalizeRosterAiDate('12/31', { defaultDate: '2026-01-02' }), '2025-12-31');
    assert.equal(normalizeRosterAiDate('1/2', { defaultDate: '2026-12-30' }), '2027-01-02');
    assert.equal(normalizeRosterAiDate('2/30', { defaultDate: '2026-11-17' }), '');
    assert.equal(normalizeRosterAiDate('', {}), '');
});

test('시간은 24시간제 HH:MM 로만 남긴다', () => {
    assert.equal(normalizeRosterAiTime('22:00'), '22:00');
    assert.equal(normalizeRosterAiTime('7:0'), '07:00');
    assert.equal(normalizeRosterAiTime('08시'), '08:00');
    assert.equal(normalizeRosterAiTime('1600'), '16:00');
    assert.equal(normalizeRosterAiTime('25:00'), '');
    assert.equal(normalizeRosterAiTime(''), '');
});

test('선박명은 영문 대문자로 정리하고 회사명·잡음은 선박명으로 쓰지 않는다', () => {
    assert.equal(normalizeRosterAiVesselName(' erasmus future '), 'ERASMUS FUTURE');
    assert.equal(normalizeRosterAiVesselName('[ONE TRUST]'), 'ONE TRUST');
    assert.equal(normalizeRosterAiVesselName('우진'), '');
    assert.equal(normalizeRosterAiVesselName('WAN HAI A12'), 'WAN HAI A12');
});

test('작업자 이름은 원문자·형광펜 메모·구분 숫자를 기존 규칙과 같게 다룬다', () => {
    assert.equal(normalizeRosterAiWorkerName('①최정한'), '최정한');
    assert.equal(normalizeRosterAiWorkerName('(2) 김명준'), '김명준');
    assert.equal(normalizeRosterAiWorkerName('김유신1'), '김유신1');
    assert.equal(normalizeRosterAiWorkerName('05:00추가'), '');
    assert.equal(normalizeRosterAiWorkerName('DGT 지원'), '');
    assert.equal(normalizeRosterAiWorkerName('이 승 환'), '이승환');
    assert.equal(normalizeRosterAiWorkerName('오용구'), '오용구');
});

test('모델 JSON 은 앱 검토표 행으로 바뀌고 메모·원문자·지원은 이름과 분리된다', () => {
    const result = normalizeRosterAiVisionResult(PHOTO_ONE_PAYLOAD, { defaultDate: '2026-11-17' });
    assert.equal(result.entries.length, 3);
    const [first, second, third] = result.entries;
    assert.equal(first.date, '2026-11-17');
    assert.equal(first.vessel, 'ERASMUS FUTURE');
    assert.equal(first.time, '22:00');
    assert.equal(first.company, '우진');
    assert.deepEqual(first.workers, ['최정한', '최동일', '박상원', '신경호', '노익규', '김근우1', '이봉호', '윤승주']);
    assert.equal(first.source, 'photo-ai');
    // 원문자·형광펜 메모는 이름 목록에 들어가지 않고 note 로 빠집니다.
    assert.equal(second.workers.includes('05:00추가'), false);
    assert.equal(second.workers.includes('김유신1'), true);
    assert.match(second.note, /05:00추가/);
    assert.match(second.note, /②/);
    assert.equal(third.support, 'DGT 지원');
    assert.equal(third.workers.includes('DGT 지원'), false);
    assert.equal(result.workerCount, first.workers.length + second.workers.length + third.workers.length);
    assert.match(result.text, /ERASMUS FUTURE/);
    assert.match(buildRosterAiVisionText(result.entries), /우진/);
});

test('선박명이 없는 칸의 이름은 어느 선박에도 붙이지 않고 경고로 남긴다', () => {
    const result = normalizeRosterAiVisionResult({
        vessels: [
            { date: '11/18', vesselName: '', time: '08:00', company: '웨스턴', workers: ['남영우', '서창우'], notes: [] },
            { date: '11/18', vesselName: 'JIA DE', time: '08:00', company: '웨스턴', workers: ['김동근'], notes: [] }
        ]
    }, { defaultDate: '2026-11-18' });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].vessel, 'JIA DE');
    assert.match(result.warnings.join('\n'), /선박명이 없는 칸에서 읽은 이름 2개/);
});

test('빈 응답은 검토 행 없이 경고만 돌려준다', () => {
    const result = normalizeRosterAiVisionResult({ vessels: [] }, { defaultDate: '2026-11-17' });
    assert.equal(result.entries.length, 0);
    assert.match(result.warnings[0], /선박 블록을 찾지 못했습니다/);
    assert.equal(result.text, '');
});

test('자격 판단은 GEMINI_API_KEY · 기존 서비스 계정 · 끄기 스위치를 구분한다', () => {
    assert.equal(hasRosterAiVisionCredential({ GEMINI_API_KEY: 'k' }), true);
    assert.equal(hasRosterAiVisionCredential({ FIREBASE_SERVICE_ACCOUNT_KEY: '{"x":1}' }), true);
    assert.equal(hasRosterAiVisionCredential({}), false);
    assert.equal(hasRosterAiVisionCredential({ GEMINI_API_KEY: 'k', ROSTER_AI_VISION: '0' }), false);
    assert.equal(resolveRosterAiVisionModel({}), ROSTER_AI_VISION_DEFAULT_MODEL);
    assert.equal(resolveRosterAiVisionModel({ ROSTER_AI_VISION_MODEL: 'gemini-2.5-pro' }), 'gemini-2.5-pro');
});

test('GEMINI_API_KEY 가 있으면 레퍼런스+대상 2장을 실은 generateContent 를 호출한다', async () => {
    const calls = [];
    const result = await runRosterAiVisionRequest({
        imageBase64: 'VEFSR0VU',
        referenceBase64: 'UkVGRVJFTkNF',
        defaultDate: '2026-11-17',
        env: { GEMINI_API_KEY: 'test-key' },
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return jsonResponse(geminiResponse(PHOTO_ONE_PAYLOAD));
        }
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'gemini-api');
    assert.equal(result.entries.length, 3);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent/);
    assert.match(calls[0].url, /key=test-key/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.contents[0].parts.filter((part) => part.inlineData).length, 2);
    // 사진 원본은 서버 로그로 남기지 않습니다(요청 본문에만 실립니다).
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
});

test('GEMINI_API_KEY 호출이 실패하면 기존 서비스 계정(Vertex AI)으로 한 번 더 시도한다', async () => {
    const urls = [];
    const result = await runRosterAiVisionRequest({
        imageBase64: 'VEFSR0VU',
        referenceBase64: 'UkVGRVJFTkNF',
        defaultDate: '2026-11-17',
        env: { GEMINI_API_KEY: 'test-key', FIREBASE_PROJECT_ID: 'busan-hak-port' },
        getAccessToken: async () => 'ya29-token',
        fetchImpl: async (url) => {
            urls.push(url);
            if (url.includes('generativelanguage')) return jsonResponse({ error: { message: 'quota' } }, 429);
            return jsonResponse(geminiResponse(PHOTO_ONE_PAYLOAD));
        }
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'vertex-gemini');
    assert.match(urls[1], /aiplatform\.googleapis\.com\/v1\/projects\/busan-hak-port\/locations\/global\/publishers\/google\/models\/gemini-3\.8-flash:generateContent/);
});

test('모델이 사고 토큰 0 을 거부하면 thinkingConfig 없이 한 번 더 시도한다', async () => {
    const bodies = [];
    const result = await runRosterAiVisionRequest({
        imageBase64: 'VEFSR0VU',
        defaultDate: '2026-11-17',
        env: { GEMINI_API_KEY: 'test-key' },
        fetchImpl: async (url, init) => {
            bodies.push(JSON.parse(init.body));
            if (bodies.length === 1) {
                return jsonResponse({ error: { message: 'thinking budget 0 is not supported for this model' } }, 400);
            }
            return jsonResponse(geminiResponse(PHOTO_ONE_PAYLOAD));
        }
    });
    assert.equal(result.ok, true);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].generationConfig.thinkingConfig.thinkingBudget, 0);
    assert.equal('thinkingConfig' in bodies[1].generationConfig, false);
});

test('자격이 없거나 호출이 실패하면 예외 없이 실패 이유를 돌려주고 잠시 재시도를 멈춘다', async () => {
    const noCredential = await runRosterAiVisionRequest({ imageBase64: 'VEFSR0VU', env: {} });
    assert.equal(noCredential.ok, false);
    assert.equal(noCredential.reason, 'no_credential');

    const state = {};
    const failed = await runRosterAiVisionRequest({
        imageBase64: 'VEFSR0VU',
        env: { GEMINI_API_KEY: 'k' },
        state,
        fetchImpl: async () => jsonResponse({ error: { message: 'bad key' } }, 400)
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'request_failed');
    assert.equal(failed.attempts[0].status, 400);
    assert.ok(state.blockedUntil > Date.now());

    // 같은 인스턴스에서는 사진마다 25초를 다시 쓰지 않습니다.
    const cooled = await runRosterAiVisionRequest({ imageBase64: 'VEFSR0VU', env: { GEMINI_API_KEY: 'k' }, state });
    assert.equal(cooled.reason, 'cooldown');
});

test('레퍼런스 이미지는 휴대폰 UI 를 뺀 JPEG 이고 저장소 자산과 같은 바이트다', () => {
    const decoded = Buffer.from(ROSTER_AI_VISION_REFERENCE_BASE64, 'base64');
    assert.equal(decoded[0], 0xff);
    assert.equal(decoded[1], 0xd8);
    assert.ok(decoded.length > 40 * 1024, `레퍼런스 JPEG 가 너무 작습니다: ${decoded.length}`);
    const asset = readFileSync(new URL('../assets/roster-ocr-reference.jpg', import.meta.url));
    assert.equal(decoded.equals(asset), true, 'scripts/roster-ai-vision-reference.mjs 와 assets/roster-ocr-reference.jpg 가 다릅니다');
});

test('서버는 AI 비전 → Google Cloud Vision → 기기 판독 순서로 내려가고 사진을 로그에 남기지 않는다', () => {
    const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    assert.match(server, /runRosterAiVisionRequest\(/);
    assert.match(server, /ROSTER_AI_VISION_REFERENCE_BASE64/);
    assert.match(server, /X-Roster-Ocr-Mode/);
    assert.match(server, /getRosterVertexAccessToken/);
    assert.match(server, /aiVision: isRosterAiVisionEnabled\(\)/);
    assert.match(server, /vision\.googleapis\.com\/v1\/images:annotate/);
    assert.doesNotMatch(server, /console\.(?:log|info)\([^\n]*(?:image\.toString|imageBase64)/i);
    // 화면 잠금·인증·앱 이름·식단 업로드 경로는 그대로 유지됩니다.
    assert.match(server, /verifyFirebaseIdTokenViaRest\(authorization\[1\]\)/);
    assert.match(server, /isScreenUnlockRateLimited\(ip, 'ocr', 5\)/);
});

test('앱은 사진 선택 직후 AI 비전 1차 판독을 시도하고, 실패하면 기기 판독을 이어 간다', () => {
    const engine = readFileSync(new URL('../public/js/roster-engine.js', import.meta.url), 'utf8');
    assert.match(engine, /aiVisionEnabled/);
    assert.match(engine, /maybeRunRosterAiVisionFirst/);
    assert.match(engine, /"X-Roster-Ocr-Mode": "ai"/);
    assert.match(engine, /applyRosterAiVisionResult/);
    // 기존 기기 판독·동의·온라인 재판독 경로는 유지됩니다.
    assert.match(engine, /prepareRosterCanvasForOcr\("enhanced"\)/);
    assert.match(engine, /maybeRunRosterCloudOcrFallback/);
    assert.match(engine, /findRosterWorkerCellColumnSplit/);
});
