/**
 * 일일 점검 보고서 메일 발송기 회귀 방지 테스트
 *
 * 목적:
 *   1. 전송 방식 자동 감지(Resend → Gmail API → SMTP → 미설정)가 환경변수대로 동작한다
 *   2. 점검 결과로 만든 메일 제목·본문·첨부가 기대한 형태다 (네트워크 호출 없음)
 *   3. 실제 발송 경로(Resend / Gmail API / SMTP)가 올바른 요청을 만든다 (fetch 주입)
 *   4. 자격증명이 없거나 alert 모드에서 이상이 없으면 예외 없이 건너뛴다(skipped)
 *      → 크론 본체(점검 성공/실패)가 메일 설정 유무에 영향을 받지 않아야 한다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REPORT_EMAIL_TO,
  buildInspectionEmail,
  buildRfc822Message,
  buildInspectionSubject,
  resolveMailTransport,
  resolveReportEmailConfig,
  sendInspectionReportEmail,
} from './daily-report-mailer.mjs';

const sampleResult = {
  kstDate: '2026-10-23',
  kstDateTime: '2026-10-23 (금) 04:00:00 KST',
  generatedAt: '2026-10-22T19:00:00.000Z',
  summary: { total: 6, pass: 5, warn: 1, fail: 0, overall: 'WARN' },
  checks: [
    { category: '파일 존재', name: 'vercel.json', status: 'PASS', detail: '존재' },
    { category: '파일 존재', name: 'firebase.json', status: 'PASS', detail: '존재' },
    { category: 'API 라우트', name: 'GET /api/health', status: 'PASS', detail: '라우트 존재' },
    { category: 'API 라우트', name: 'GET /api/config', status: 'PASS', detail: '라우트 존재' },
    { category: '보안', name: 'CRON_SECRET', status: 'PASS', detail: '설정됨' },
    { category: '보안', name: '<script>alert(1)</script>', status: 'WARN', detail: '미설정 & 위험' },
  ],
};

const cleanEnv = (extra = {}) => ({ ...extra });

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const result = (await handler(url, init)) || {};
    return {
      ok: result.status ? result.status < 400 : true,
      status: result.status ?? 200,
      json: async () => result.json ?? {},
      text: async () => result.text ?? '',
    };
  };
  return { impl, calls };
}

test('전송 방식 자동 감지 — 우선순위와 미설정 판정', () => {
  assert.equal(resolveMailTransport(cleanEnv()).transport, null);
  assert.equal(resolveMailTransport(cleanEnv()).reason, 'not_configured');

  assert.equal(resolveMailTransport(cleanEnv({ RESEND_API_KEY: 're_123' })).transport, 'resend');

  // Resend 가 최우선
  assert.equal(
    resolveMailTransport(cleanEnv({ RESEND_API_KEY: 're_123', SMTP_HOST: 'smtp.gmail.com' })).transport,
    'resend'
  );

  // Gmail 은 세 값이 모두 있어야 함
  assert.equal(resolveMailTransport(cleanEnv({ GOOGLE_REFRESH_TOKEN: 'rt' })).reason, 'incomplete_gmail_config');
  assert.equal(
    resolveMailTransport(
      cleanEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'rt' })
    ).transport,
    'gmail-api'
  );

  assert.equal(resolveMailTransport(cleanEnv({ SMTP_HOST: 'smtp.gmail.com' })).transport, 'smtp');

  // 명시적 비활성화
  assert.equal(resolveMailTransport(cleanEnv({ RESEND_API_KEY: 're_123', REPORT_EMAIL_ENABLED: '0' })).reason, 'disabled');
});

test('메일 설정 — 기본 수신자·복수 수신자·모드', () => {
  const config = resolveReportEmailConfig(cleanEnv());
  assert.deepEqual(config.to, [DEFAULT_REPORT_EMAIL_TO]);
  assert.equal(config.mode, 'always');
  assert.equal(config.attach, true);

  const multi = resolveReportEmailConfig(cleanEnv({ REPORT_EMAIL_TO: 'a@b.com; c@d.com' }));
  assert.deepEqual(multi.to, ['a@b.com', 'c@d.com']);

  assert.equal(resolveReportEmailConfig(cleanEnv({ REPORT_EMAIL_MODE: 'alert' })).mode, 'alert');
  assert.equal(resolveReportEmailConfig(cleanEnv({ REPORT_EMAIL_ENABLED: '0' })).enabled, false);
});

test('메일 제목 — 판정과 건수를 담는다', () => {
  assert.match(buildInspectionSubject(sampleResult), /^\[일일점검\] 2026-10-23 .* 주의 \(WARN 1 · FAIL 0 \(전체 6건\)\)$/);
  const passResult = { ...sampleResult, summary: { total: 93, pass: 93, warn: 0, fail: 0, overall: 'PASS' } };
  assert.match(buildInspectionSubject(passResult), /정상 \(PASS 93\/93\)$/);
});

test('메일 본문 — 요약·분야별 집계·HTML 이스케이프·첨부(base64)', () => {
  const email = buildInspectionEmail({
    result: sampleResult,
    markdown: '# 보고서 본문\n',
    json: { kstDate: '2026-10-23', summary: sampleResult.summary },
    env: cleanEnv({ REPORT_EMAIL_TO: 'luxrank@gmail.com' }),
  });

  assert.deepEqual(email.to, ['luxrank@gmail.com']);
  assert.equal(email.attachments.length, 2);
  assert.equal(email.attachments[0].filename, 'daily-inspection-2026-10-23.md');
  assert.equal(Buffer.from(email.attachments[0].content, 'base64').toString('utf8'), '# 보고서 본문\n');
  assert.equal(email.attachments[1].filename, 'daily-inspection-2026-10-23.json');
  assert.equal(JSON.parse(Buffer.from(email.attachments[1].content, 'base64').toString('utf8')).kstDate, '2026-10-23');

  assert.match(email.html, /일일 기능 점검 보고서/);
  assert.match(email.html, /종합 판정: 주의 \(WARN\)/);
  assert.match(email.html, /분야별 요약/);
  assert.match(email.html, /조치 필요 항목 \(1건\)/);
  // 분야별 집계: 파일 존재 2 · API 라우트 2 · 보안 2 (PASS 1 / WARN 1)
  assert.match(email.html, /파일 존재/);
  assert.match(email.html, /API 라우트/);
  // XSS 방지 — 점검 항목 이름이 그대로 HTML 로 삽입되지 않아야 한다
  assert.ok(!email.html.includes('<script>alert(1)</script>'), 'HTML 이스케이프가 적용되어야 합니다');
  assert.match(email.html, /&lt;script&gt;/);

  assert.match(email.text, /종합 판정: 주의 \(WARN\)/);
  assert.match(email.text, /보안: PASS 1 · WARN 1 · FAIL 0/);
});

test('첨부를 끄면 본문만 구성된다', () => {
  const email = buildInspectionEmail({
    result: sampleResult,
    markdown: '# 보고서',
    env: cleanEnv({ REPORT_EMAIL_ATTACHMENTS: '0' }),
  });
  assert.equal(email.attachments.length, 0);
});

test('RFC 822 원시 메시지 — base64url 로 디코딩되고 첨부를 포함한다', () => {
  const raw = buildRfc822Message({
    from: 'report@example.com',
    to: ['luxrank@gmail.com'],
    subject: '[일일점검] 2026-10-23 보고서',
    text: '본문',
    html: '<b>본문</b>',
    attachments: [{ filename: 'daily-inspection-2026-10-23.md', content: Buffer.from('# md').toString('base64'), contentType: 'text/markdown; charset=UTF-8' }],
  });
  assert.ok(/^[A-Za-z0-9_-]+$/.test(raw), 'Gmail raw 는 base64url 이어야 합니다');
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /To: luxrank@gmail.com/);
  assert.match(decoded, /Subject: =\?UTF-8\?B\?/);
  assert.match(decoded, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(decoded, /Content-Disposition: attachment; filename=/);
  // 첨부 본문은 Content-Transfer-Encoding: base64 이므로 base64 문자열로 실린다
  assert.match(decoded, new RegExp(Buffer.from('# md').toString('base64')));
});

test('자격증명이 없으면 예외 없이 건너뛴다 (네트워크 호출 없음)', async () => {
  const { impl, calls } = fakeFetch(async () => {
    throw new Error('발송 경로가 호출되면 안 됩니다');
  });
  const result = await sendInspectionReportEmail({
    result: sampleResult,
    markdown: '# 보고서',
    env: cleanEnv(),
    fetchImpl: impl,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'not_configured');
  assert.equal(calls.length, 0);
});

test('alert 모드 — 이상이 없으면 건너뛰고, WARN·FAIL 이 있으면 발송한다', async () => {
  const passResult = { ...sampleResult, summary: { total: 6, pass: 6, warn: 0, fail: 0, overall: 'PASS' }, checks: sampleResult.checks.slice(0, 5) };

  const skipped = await sendInspectionReportEmail({
    result: passResult,
    markdown: '# 보고서',
    env: cleanEnv({ RESEND_API_KEY: 're_123', REPORT_EMAIL_FROM: 'report@example.com', REPORT_EMAIL_MODE: 'alert' }),
    fetchImpl: async () => ({ status: 200, json: { id: 'msg-1' } }),
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, 'mode_alert_no_issue');
  assert.equal(skipped.transport, 'resend');

  const { impl, calls } = fakeFetch(async () => ({ status: 200, json: { id: 'msg-2' } }));
  const sent = await sendInspectionReportEmail({
    result: sampleResult, // WARN 1건
    markdown: '# 보고서',
    env: cleanEnv({ RESEND_API_KEY: 're_123', REPORT_EMAIL_FROM: 'report@example.com', REPORT_EMAIL_MODE: 'alert' }),
    fetchImpl: impl,
  });
  assert.equal(sent.ok, true);
  assert.equal(calls.length, 1);
});

test('Resend 전송 — 엔드포인트·헤더·첨부 페이로드', async () => {
  const { impl, calls } = fakeFetch(async () => ({ status: 200, json: { id: 'msg-resend' } }));
  const result = await sendInspectionReportEmail({
    result: sampleResult,
    markdown: '# 보고서',
    json: { kstDate: '2026-10-23' },
    env: cleanEnv({
      RESEND_API_KEY: 're_test',
      REPORT_EMAIL_FROM: 'report@example.com',
      REPORT_EMAIL_TO: 'luxrank@gmail.com',
    }),
    fetchImpl: impl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.transport, 'resend');
  assert.equal(result.messageId, 'msg-resend');

  const [call] = calls;
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.init.headers.Authorization, 'Bearer re_test');
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.to, ['luxrank@gmail.com']);
  assert.equal(body.from, 'report@example.com');
  assert.match(body.subject, /^\[일일점검\] 2026-10-23 /);
  assert.equal(body.attachments.length, 2);
  assert.equal(body.attachments[0].filename, 'daily-inspection-2026-10-23.md');
});

test('Resend — From 미설정이면 실패하되 예외를 던지지 않는다', async () => {
  const result = await sendInspectionReportEmail({
    result: sampleResult,
    markdown: '# 보고서',
    env: cleanEnv({ RESEND_API_KEY: 're_test' }),
    fetchImpl: async () => ({ status: 200, json: {} }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.match(result.error, /REPORT_EMAIL_FROM/);
});

test('Gmail API 전송 — 토큰 발급 후 raw 메시지를 보낸다', async () => {
  const { impl, calls } = fakeFetch(async (url) => {
    if (url.includes('oauth2.googleapis.com')) return { status: 200, json: { access_token: 'ya29.token' } };
    return { status: 200, json: { id: 'msg-gmail' } };
  });
  const result = await sendInspectionReportEmail({
    result: sampleResult,
    markdown: '# 보고서',
    env: cleanEnv({
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'csecret',
      GOOGLE_REFRESH_TOKEN: 'rt',
      REPORT_EMAIL_TO: 'luxrank@gmail.com',
    }),
    fetchImpl: impl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.transport, 'gmail-api');
  assert.equal(result.messageId, 'msg-gmail');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /oauth2\.googleapis\.com\/token/);
  assert.match(calls[0].init.body, /grant_type=refresh_token/);
  assert.equal(calls[1].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer ya29.token');
  const raw = JSON.parse(calls[1].init.body).raw;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /To: luxrank@gmail.com/);
  // 첨부 본문은 base64 로 실리므로 마크다운 자체가 아닌 base64 문자열이 있어야 한다
  assert.match(decoded, new RegExp(Buffer.from('# 보고서').toString('base64')));
});

test('SMTP 전송 — 주입된 nodemailer 로 첨부까지 전달', async () => {
  const sent = [];
  const fakeNodemailer = {
    createTransport(options) {
      sent.push({ options });
      return {
        async sendMail(message) {
          sent.push({ message });
          return { messageId: '<smtp-1@example.com>' };
        },
      };
    },
  };
  const result = await sendInspectionReportEmail({
    result: sampleResult,
    markdown: '# 보고서',
    env: cleanEnv({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_USER: 'luxrank@gmail.com',
      SMTP_PASS: 'app-password',
      REPORT_EMAIL_TO: 'luxrank@gmail.com',
    }),
    nodemailer: fakeNodemailer,
  });

  assert.equal(result.ok, true);
  assert.equal(result.transport, 'smtp');
  assert.equal(result.messageId, '<smtp-1@example.com>');
  const transportOptions = sent[0].options;
  assert.equal(transportOptions.host, 'smtp.gmail.com');
  assert.equal(transportOptions.port, 465);
  assert.equal(transportOptions.secure, true);
  assert.equal(transportOptions.auth.user, 'luxrank@gmail.com');
  const message = sent[1].message;
  assert.equal(message.to, 'luxrank@gmail.com');
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].encoding, 'base64');
});

test('발송 실패(HTTP 오류)는 ok:false 로 기록되고 예외를 전파하지 않는다', async () => {
  const { impl } = fakeFetch(async () => ({ status: 422, text: 'Invalid `to` field' }));
  const result = await sendInspectionReportEmail({
    result: sampleResult,
    markdown: '# 보고서',
    env: cleanEnv({ RESEND_API_KEY: 're_test', REPORT_EMAIL_FROM: 'report@example.com' }),
    fetchImpl: impl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.equal(result.transport, 'resend');
  assert.match(result.error, /Resend 422/);
});
