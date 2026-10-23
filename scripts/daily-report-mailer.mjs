#!/usr/bin/env node
/**
 * BUSAN HAK PORT INFO — 일일 점검 보고서 메일 발송기
 * ─────────────────────────────────────────────────────────────────────────────
 * 매일 04:00 KST 에 실행되는 일일 기능 점검(/api/cron/daily-inspection) 직후에
 * 생성된 보고서를 지정 주소로 메일 발송합니다.
 *
 *  - 실행 주체: server.ts 의 runDailyInspection() → deliverDailyInspectionEmail()
 *              (Vercel Cron · 상시 서버 node-cron 모두 동일 경로)
 *  - CLI(GitHub Actions)에서도 사용 가능: REPORT_EMAIL_ON_CLI=1 일 때만 발송
 *    (Vercel Cron 과 같은 시각에 실행되므로 기본값은 0 — 중복 발송 방지)
 *
 * 전송 방식은 환경변수로 자동 감지합니다 (우선순위 순):
 *   1) resend     — RESEND_API_KEY
 *   2) gmail-api  — GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
 *   3) smtp       — SMTP_HOST (+ SMTP_USER / SMTP_PASS)
 *
 * 외부 의존성 없음(node:crypto·fetch 만 사용). SMTP 는 nodemailer 를 동적 임포트하므로
 * SMTP 를 쓰지 않는 배포에서는 패키지가 없어도 됩니다.
 *
 * 자세한 환경변수 설명은 .env.example 의 "9. 일일 점검 보고서 메일" 절을 참고하세요.
 */
import crypto from 'node:crypto';

export const DEFAULT_REPORT_EMAIL_TO = 'luxrank@gmail.com';
export const SITE_LABEL = '부산항 스마트 작업 가이드';

const VERDICT = {
  PASS: { label: '정상', emoji: '🟢', badge: '#0b8043', bg: '#e8f7ee', border: '#b7e4c7' },
  WARN: { label: '주의', emoji: '🟡', badge: '#a46a21', bg: '#fffaf0', border: '#f4e3bf' },
  FAIL: { label: '이상', emoji: '🔴', badge: '#b3261e', bg: '#fdf4f4', border: '#f3d6d6' },
};

const STATUS_EMOJI = { PASS: '✅', WARN: '⚠️', FAIL: '❌' };

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toBase64(value) {
  return Buffer.from(String(value ?? ''), 'utf8').toString('base64');
}

function wrapBase64(value, width = 76) {
  const lines = [];
  for (let i = 0; i < value.length; i += width) lines.push(value.slice(i, i + width));
  return lines.join('\r\n');
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value ?? ''), 'utf8').toString('base64')}?=`;
}

function truthy(value, defaultValue = false) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return !['0', 'false', 'no', 'off', 'n'].includes(raw);
}

function parseRecipients(value) {
  return String(value ?? '')
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * 환경변수에서 메일 설정을 읽습니다.
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveReportEmailConfig(env = process.env) {
  const enabled = truthy(env.REPORT_EMAIL_ENABLED, true);
  const mode = String(env.REPORT_EMAIL_MODE || 'always').trim().toLowerCase() === 'alert' ? 'alert' : 'always';
  const to = parseRecipients(env.REPORT_EMAIL_TO);
  return {
    enabled,
    mode, // always = 매일 발송 / alert = WARN·FAIL 있을 때만
    to: to.length ? to : [DEFAULT_REPORT_EMAIL_TO],
    from: String(env.REPORT_EMAIL_FROM || '').trim(),
    attach: truthy(env.REPORT_EMAIL_ATTACHMENTS, true),
  };
}

/**
 * 설정된 환경변수로 전송 방식을 결정합니다.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{transport: 'resend'|'gmail-api'|'smtp'|null, reason: string|null, missing?: string[]}}
 */
export function resolveMailTransport(env = process.env) {
  if (!truthy(env.REPORT_EMAIL_ENABLED, true)) {
    return { transport: null, reason: 'disabled', missing: [] };
  }
  if (String(env.RESEND_API_KEY || '').trim()) {
    return { transport: 'resend', reason: null, missing: [] };
  }
  const googleKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
  const hasGoogle = googleKeys.filter((k) => String(env[k] || '').trim());
  if (hasGoogle.length === googleKeys.length) {
    return { transport: 'gmail-api', reason: null, missing: [] };
  }
  if (hasGoogle.length > 0) {
    return { transport: null, reason: 'incomplete_gmail_config', missing: googleKeys.filter((k) => !String(env[k] || '').trim()) };
  }
  if (String(env.SMTP_HOST || '').trim()) {
    return { transport: 'smtp', reason: null, missing: [] };
  }
  return { transport: null, reason: 'not_configured', missing: [] };
}

function groupByCategory(checks = []) {
  const map = new Map();
  for (const check of checks) {
    const entry = map.get(check.category) || { pass: 0, warn: 0, fail: 0, total: 0 };
    entry.total += 1;
    if (check.status === 'PASS') entry.pass += 1;
    else if (check.status === 'WARN') entry.warn += 1;
    else entry.fail += 1;
    map.set(check.category, entry);
  }
  return [...map.entries()].map(([category, stat]) => ({ category, ...stat }));
}

export function buildInspectionSubject(result) {
  const { kstDate, summary } = result;
  const verdict = VERDICT[summary.overall] || VERDICT.PASS;
  const count =
    summary.overall === 'PASS'
      ? `PASS ${summary.pass}/${summary.total}`
      : `WARN ${summary.warn} · FAIL ${summary.fail} (전체 ${summary.total}건)`;
  return `[일일점검] ${kstDate} ${SITE_LABEL} · ${verdict.label} (${count})`;
}

export function buildInspectionText(result) {
  const { kstDate, kstDateTime, summary, checks } = result;
  const verdict = VERDICT[summary.overall] || VERDICT.PASS;
  const lines = [];
  lines.push(`${SITE_LABEL} — 일일 기능 점검 보고서 (${kstDate})`);
  lines.push('');
  lines.push(`■ 종합 판정: ${verdict.label} (${summary.overall}) — 통과율 ${summary.total ? Math.round((summary.pass / summary.total) * 100) : 0}%`);
  lines.push(`점검 일시: ${kstDateTime}`);
  lines.push('점검 방식: 자동 점검 (매일 04:00 KST · GitHub Actions + Vercel Cron + node-cron)');
  lines.push('');
  lines.push('■ 요약');
  lines.push(`- 전체 점검 항목: ${summary.total}건`);
  lines.push(`- PASS ${summary.pass}건 / WARN ${summary.warn}건 / FAIL ${summary.fail}건`);
  lines.push('');
  lines.push('■ 분야별 결과');
  for (const row of groupByCategory(checks)) {
    lines.push(
      `- ${row.category}: PASS ${row.pass} · WARN ${row.warn} · FAIL ${row.fail} (총 ${row.total}건)`
    );
  }
  const issues = checks.filter((c) => c.status !== 'PASS');
  lines.push('');
  if (issues.length === 0) {
    lines.push('■ 조치 사항');
    lines.push('조치 필요 항목 없음 — 모든 항목 정상입니다.');
  } else {
    lines.push(`■ 조치 필요 항목 (${issues.length}건)`);
    for (const c of issues.slice(0, 30)) {
      lines.push(`- ${STATUS_EMOJI[c.status] || ''} [${c.category}] ${c.name}: ${c.detail}`);
    }
  }
  lines.push('');
  lines.push('■ 첨부 파일');
  lines.push(`- daily-inspection-${kstDate}.md : 점검 항목 전체 상세 표`);
  lines.push(`- daily-inspection-${kstDate}.json : 기계 판독용 요약(JSON)`);
  lines.push('');
  lines.push('※ 본 보고서는 매일 04:00 KST 에 자동 생성됩니다.');
  lines.push('※ 수동 실행: npm run inspection / API: GET /api/cron/daily-inspection');
  lines.push('');
  lines.push('© 2026 이춘학 — BUSAN HAK PORT INFO. All rights reserved.');
  return lines.join('\n');
}

export function buildInspectionHtml(result) {
  const { kstDate, kstDateTime, summary, checks } = result;
  const verdict = VERDICT[summary.overall] || VERDICT.PASS;
  const passRate = summary.total ? Math.round((summary.pass / summary.total) * 100) : 0;
  const rows = groupByCategory(checks);
  const issues = checks.filter((c) => c.status !== 'PASS');

  const categoryRows = rows
    .map((row, index) => {
      const bg = index % 2 === 0 ? '#fbfcfe' : '#ffffff';
      const status = row.fail > 0 ? '🔴' : row.warn > 0 ? '🟡' : '🟢';
      return `<tr style="background:${bg};"><td style="padding:8px 10px;border-bottom:1px solid #eceff5;">${escapeHtml(row.category)}</td><td align="center" style="border-bottom:1px solid #eceff5;">${row.pass}</td><td align="center" style="border-bottom:1px solid #eceff5;">${row.warn}</td><td align="center" style="border-bottom:1px solid #eceff5;">${row.fail}</td><td align="center" style="border-bottom:1px solid #eceff5;">${row.total}</td><td align="center" style="border-bottom:1px solid #eceff5;">${status}</td></tr>`;
    })
    .join('');

  const issueBlock = issues.length
    ? `<tr><td style="padding:24px 28px 0 28px;">
            <div style="font-size:15px;font-weight:800;color:#0a1b3f;border-left:4px solid #b3261e;padding-left:10px;">조치 필요 항목 (${issues.length}건)</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;font-size:13px;">
              <tr style="background:#0a1b3f;color:#ffffff;"><th align="left" style="padding:9px 10px;">분야</th><th align="left" style="padding:9px 8px;">항목</th><th align="center" style="padding:9px 8px;">결과</th><th align="left" style="padding:9px 10px;">상세</th></tr>
              ${issues
                .slice(0, 30)
                .map(
                  (c, i) =>
                    `<tr style="background:${i % 2 === 0 ? '#fbfcfe' : '#ffffff'};"><td style="padding:8px 10px;border-bottom:1px solid #eceff5;">${escapeHtml(c.category)}</td><td style="padding:8px;border-bottom:1px solid #eceff5;">${escapeHtml(c.name)}</td><td align="center" style="border-bottom:1px solid #eceff5;">${STATUS_EMOJI[c.status] || ''}</td><td style="padding:8px 10px;border-bottom:1px solid #eceff5;color:#55637a;">${escapeHtml(c.detail)}</td></tr>`
                )
                .join('')}
            </table>
          </td></tr>`
    : '';

  return `<div style="margin:0;padding:0;background:#eef1f6;font-family:'Apple SD Gothic Neo','Malgun Gothic','Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(10,27,63,0.10);">
        <tr>
          <td style="background:#0a1b3f;padding:26px 28px 22px 28px;">
            <div style="color:#60a5fa;font-size:12px;letter-spacing:1.5px;font-weight:700;">BUSAN HAK PORT INFO</div>
            <div style="color:#ffffff;font-size:22px;font-weight:800;margin-top:6px;line-height:1.35;">일일 기능 점검 보고서</div>
            <div style="color:#b9c7de;font-size:13px;margin-top:8px;">${escapeHtml(SITE_LABEL)} · ${escapeHtml(kstDateTime)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 28px 6px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${verdict.bg};border:1px solid ${verdict.border};border-radius:10px;">
              <tr><td style="padding:16px 18px;">
                <div style="font-size:17px;font-weight:800;color:${verdict.badge};">${verdict.emoji} 종합 판정: ${verdict.label} (${escapeHtml(summary.overall)})</div>
                <div style="font-size:13px;color:#33415c;margin-top:6px;line-height:1.6;">${
                  issues.length === 0
                    ? '모든 핵심 기능이 정상 동작합니다. 별도 조치 없이 운영을 계속하세요.'
                    : `WARN ${summary.warn}건 · FAIL ${summary.fail}건 — 아래 항목을 확인하세요.`
                } (통과율 ${passRate}%)</div>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="25%" align="center" style="background:#f6f8fc;border:1px solid #e2e8f2;border-radius:10px;padding:14px 4px;">
                  <div style="font-size:11px;color:#6b7a90;font-weight:700;">전체 항목</div>
                  <div style="font-size:22px;font-weight:800;color:#0a1b3f;margin-top:4px;">${summary.total}</div>
                </td>
                <td width="2%"></td>
                <td width="24%" align="center" style="background:#f3faf6;border:1px solid #d7f0e1;border-radius:10px;padding:14px 4px;">
                  <div style="font-size:11px;color:#6b7a90;font-weight:700;">✅ PASS</div>
                  <div style="font-size:22px;font-weight:800;color:#0b8043;margin-top:4px;">${summary.pass}</div>
                </td>
                <td width="2%"></td>
                <td width="23%" align="center" style="background:#fffaf0;border:1px solid #f4e3bf;border-radius:10px;padding:14px 4px;">
                  <div style="font-size:11px;color:#6b7a90;font-weight:700;">⚠️ WARN</div>
                  <div style="font-size:22px;font-weight:800;color:#a46a21;margin-top:4px;">${summary.warn}</div>
                </td>
                <td width="2%"></td>
                <td width="22%" align="center" style="background:#fdf4f4;border:1px solid #f3d6d6;border-radius:10px;padding:14px 4px;">
                  <div style="font-size:11px;color:#6b7a90;font-weight:700;">❌ FAIL</div>
                  <div style="font-size:22px;font-weight:800;color:#b3261e;margin-top:4px;">${summary.fail}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px 0 28px;">
            <div style="font-size:15px;font-weight:800;color:#0a1b3f;border-left:4px solid #60a5fa;padding-left:10px;">분야별 요약</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;font-size:13px;">
              <tr style="background:#0a1b3f;color:#ffffff;">
                <th align="left" style="padding:9px 10px;">분야</th>
                <th align="center" style="padding:9px 6px;">PASS</th>
                <th align="center" style="padding:9px 6px;">WARN</th>
                <th align="center" style="padding:9px 6px;">FAIL</th>
                <th align="center" style="padding:9px 6px;">합계</th>
                <th align="center" style="padding:9px 10px;">상태</th>
              </tr>
              ${categoryRows}
            </table>
          </td>
        </tr>
        ${issueBlock}
        <tr>
          <td style="padding:24px 28px 0 28px;">
            <div style="font-size:15px;font-weight:800;color:#0a1b3f;border-left:4px solid #fbbf24;padding-left:10px;">첨부 파일</div>
            <div style="margin-top:10px;background:#fffaf0;border:1px solid #f4e3bf;border-radius:10px;padding:14px 16px;font-size:13px;color:#5b4314;line-height:1.7;">
              📎 <b>daily-inspection-${escapeHtml(kstDate)}.md</b> — 점검 항목 전체 상세 표<br>
              📎 <b>daily-inspection-${escapeHtml(kstDate)}.json</b> — 기계 판독용 요약(JSON)
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 28px 0 28px;">
            <div style="border-top:1px solid #e6eaf2;padding-top:14px;font-size:12px;color:#7b8798;line-height:1.8;">
              · 본 보고서는 매일 04:00 KST 에 자동 생성됩니다. (GitHub Actions + Vercel Cron + node-cron)<br>
              · 수동 실행: <code>npm run inspection</code> &nbsp;|&nbsp; API: <code>GET /api/cron/daily-inspection</code><br>
              · 점검 기준일 ${escapeHtml(kstDate)} (KST) · 생성 시각 ${escapeHtml(result.generatedAt || '')}
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#0a1b3f;padding:16px 28px;">
            <div style="color:#b9c7de;font-size:11px;line-height:1.7;">© 2026 이춘학 — BUSAN HAK PORT INFO. All rights reserved.<br>문의: luxrank@gmail.com / 010-2846-8906</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</div>`;
}

/**
 * 점검 결과로 메일 본문·첨부를 구성합니다.
 * @param {{result: object, markdown?: string, json?: object|string|null, config?: object, env?: NodeJS.ProcessEnv}} options
 */
export function buildInspectionEmail(options) {
  const { result, markdown = '', json = null, config: overrideConfig, env = process.env } = options || {};
  const config = overrideConfig || resolveReportEmailConfig(env);
  const attachments = [];
  if (config.attach) {
    if (markdown) {
      attachments.push({
        filename: `daily-inspection-${result.kstDate}.md`,
        content: toBase64(markdown),
        contentType: 'text/markdown; charset=UTF-8',
      });
    }
    if (json) {
      const jsonText = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
      attachments.push({
        filename: `daily-inspection-${result.kstDate}.json`,
        content: toBase64(jsonText),
        contentType: 'application/json; charset=UTF-8',
      });
    }
  }
  return {
    subject: buildInspectionSubject(result),
    text: buildInspectionText(result),
    html: buildInspectionHtml(result),
    attachments,
    to: config.to,
    from: config.from,
  };
}

/**
 * RFC 822 원시 메시지 생성 (Gmail API raw 파라미터용).
 * @param {{from: string, to: string[], subject: string, text: string, html: string, attachments?: Array<{filename: string, content: string, contentType: string}>}} message
 * @returns {string} base64url 인코딩된 raw 메시지
 */
export function buildRfc822Message(message) {
  const { from, to, subject, text, html, attachments = [] } = message;
  const boundary = `----=_Part_${crypto.randomBytes(10).toString('hex')}`;
  const altBoundary = `----=_Alt_${crypto.randomBytes(10).toString('hex')}`;
  const lines = [];
  lines.push(`From: ${from || 'me'}`);
  lines.push(`To: ${(to || []).join(', ')}`);
  lines.push(`Subject: ${encodeMimeHeader(subject)}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  lines.push('');
  lines.push(`--${altBoundary}`);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(wrapBase64(toBase64(text)));
  lines.push('');
  lines.push(`--${altBoundary}`);
  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(wrapBase64(toBase64(html)));
  lines.push('');
  lines.push(`--${altBoundary}--`);
  for (const attachment of attachments) {
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${attachment.contentType || 'application/octet-stream'}`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-Disposition: attachment; filename="${encodeMimeHeader(attachment.filename)}"`);
    lines.push('');
    lines.push(wrapBase64(attachment.content));
  }
  lines.push('');
  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, 500) : '';
  } catch {
    return '';
  }
}

function withTimeout(init = {}, timeoutMs = 20000) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { ...init, signal: AbortSignal.timeout(timeoutMs) };
  }
  return init;
}

async function sendViaResend({ message, env, fetchImpl }) {
  if (!message.from) throw new Error('REPORT_EMAIL_FROM 이 없으면 Resend 로 보낼 수 없습니다.');
  const response = await fetchImpl('https://api.resend.com/emails', withTimeout({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${String(env.RESEND_API_KEY || '').trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content })),
    }),
  }));
  if (!response.ok) {
    throw new Error(`Resend ${response.status}: ${await readErrorBody(response)}`);
  }
  const body = await response.json().catch(() => ({}));
  return { messageId: body?.id || null };
}

async function sendViaGmailApi({ message, env, fetchImpl }) {
  const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', withTimeout({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: String(env.GOOGLE_CLIENT_ID || '').trim(),
      client_secret: String(env.GOOGLE_CLIENT_SECRET || '').trim(),
      refresh_token: String(env.GOOGLE_REFRESH_TOKEN || '').trim(),
      grant_type: 'refresh_token',
    }).toString(),
  }));
  if (!tokenResponse.ok) {
    throw new Error(`Gmail 토큰 발급 실패 ${tokenResponse.status}: ${await readErrorBody(tokenResponse)}`);
  }
  const token = await tokenResponse.json().catch(() => ({}));
  if (!token?.access_token) throw new Error('Gmail 액세스 토큰을 받지 못했습니다.');
  // 지정된 From 이 없으면 인증된 사용자(me) 주소로 발송됩니다.
  const raw = buildRfc822Message({ ...message, from: message.from || 'me' });
  const sendResponse = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', withTimeout({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  }));
  if (!sendResponse.ok) {
    throw new Error(`Gmail 발송 실패 ${sendResponse.status}: ${await readErrorBody(sendResponse)}`);
  }
  const body = await sendResponse.json().catch(() => ({}));
  return { messageId: body?.id || null };
}

async function sendViaSmtp({ message, env, nodemailer }) {
  let mod = nodemailer;
  if (!mod) {
    try {
      mod = await import('nodemailer');
    } catch {
      throw new Error('SMTP 전송에는 nodemailer 가 필요합니다. `npm install nodemailer` 후 다시 시도하세요.');
    }
  }
  const port = Number(env.SMTP_PORT || 465);
  const secure = truthy(env.SMTP_SECURE, port === 465);
  const transporter = (mod.createTransport || mod.default?.createTransport)({
    host: String(env.SMTP_HOST || '').trim(),
    port,
    secure,
    auth: String(env.SMTP_USER || '').trim()
      ? { user: String(env.SMTP_USER || '').trim(), pass: String(env.SMTP_PASS || '') }
      : undefined,
  });
  const info = await transporter.sendMail({
    from: message.from || String(env.SMTP_USER || '').trim(),
    to: message.to.join(', '),
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      encoding: 'base64',
      contentType: a.contentType,
    })),
  });
  return { messageId: info?.messageId || null };
}

/**
 * 일일 점검 보고서 메일을 발송합니다. 설정이 없으면 조용히 건너뜁니다(skipped).
 *
 * @param {object} options
 * @param {object} options.result           점검 결과(InspectionResult)
 * @param {string} [options.markdown]       마크다운 보고서 본문 (첨부)
 * @param {object|string} [options.json]    JSON 요약 (첨부)
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof fetch} [options.fetchImpl] 테스트용 주입
 * @param {object|null} [options.nodemailer] 테스트용 주입(SMTP)
 * @param {{log?: Function, warn?: Function, error?: Function}} [options.logger]
 * @returns {Promise<{ok: boolean, skipped: boolean, reason: string|null, transport: string|null, messageId: string|null, error: string|null}>}
 */
export async function sendInspectionReportEmail(options = {}) {
  const {
    result,
    markdown = '',
    json = null,
    env = process.env,
    fetchImpl = globalThis.fetch,
    nodemailer = null,
    logger = console,
  } = options;

  const skip = (reason, transport = null) => ({ ok: false, skipped: true, reason, transport, messageId: null, error: null });

  if (!result || !result.summary) return skip('no_result');
  const config = resolveReportEmailConfig(env);
  if (!config.enabled) return skip('disabled');

  const resolved = resolveMailTransport(env);
  if (!resolved.transport) return skip(resolved.reason || 'not_configured');
  if (config.mode === 'alert' && result.summary.warn === 0 && result.summary.fail === 0) {
    return skip('mode_alert_no_issue', resolved.transport);
  }
  if (!config.to.length) return skip('no_recipient', resolved.transport);

  const message = buildInspectionEmail({ result, markdown, json, config, env });

  try {
    let sent;
    if (resolved.transport === 'resend') {
      sent = await sendViaResend({ message, env, fetchImpl });
    } else if (resolved.transport === 'gmail-api') {
      sent = await sendViaGmailApi({ message, env, fetchImpl });
    } else {
      sent = await sendViaSmtp({ message, env, nodemailer });
    }
    logger?.log?.(
      `[INSPECTION] 보고서 메일 발송 완료 (${resolved.transport}) → ${config.to.join(', ')} — ${message.subject}`
    );
    return {
      ok: true,
      skipped: false,
      reason: null,
      transport: resolved.transport,
      messageId: sent?.messageId || null,
      error: null,
    };
  } catch (error) {
    const message_ = error?.message || String(error);
    logger?.error?.(`[INSPECTION] 보고서 메일 발송 실패 (${resolved.transport}): ${message_}`);
    return { ok: false, skipped: false, reason: null, transport: resolved.transport, messageId: null, error: message_ };
  }
}
