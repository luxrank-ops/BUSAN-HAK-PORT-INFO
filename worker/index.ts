// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Cloudflare Workers 진입점 — 기존 Express 앱(server.ts)을 Workers 의 Node.js HTTP
 * 서버 호환 계층(cloudflare:node 의 handleAsNodeRequest)으로 그대로 구동합니다.
 *
 * 라우팅
 *   /api/*  → Express 앱(server.ts). 기존 Vercel 서버리스 함수와 동일한 코드 경로.
 *   그 외    → Workers 정적 자산(빌드 산출물). SPA 폴백은 wrangler 설정의
 *             assets.not_found_handling = "single-page-application" 이 담당합니다.
 *
 * 주기 작업은 Cloudflare Cron Triggers(scheduled)가 기존 /api/cron/* 엔드포인트를
 * CRON_SECRET 으로 호출합니다 — Vercel Cron 과 동일한 경로·주기입니다.
 */
import http from 'node:http';
import { handleAsNodeRequest } from 'cloudflare:node';
import { app } from '../server.js';

const PORT = 8080;

const server = http.createServer(app as unknown as http.RequestListener);
server.listen(PORT);

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Cron Trigger 문자열(UTC) → 호출할 엔드포인트.
 * wrangler.jsonc 의 triggers.crons 와 정확히 같은 문자열이어야 합니다(그대로 전달됨).
 *   '5 * * * *' : 매시간 선박 스케줄 변경 감시(주 경로 — GitHub Actions 예약은 보조)
 */
const CRON_TASKS: Record<string, string> = {
  '5 * * * *': '/api/cron/schedule-watch',
  '0 3 * * *': '/api/cron/daily-cleanup',
  '0 0 * * SUN': '/api/cron/weekly-backup',
  '0 19 * * *': '/api/cron/daily-inspection',
  '0 20 * * SUN': '/api/cron/weekly-self-check'
};

async function callCronEndpoint(pathname: string, env: { CRON_SECRET?: string }, waitUntil?: (p: Promise<any>) => void): Promise<void> {
  const url = `https://internal.local${pathname}`;
  const headers: Record<string, string> = {};
  if (env?.CRON_SECRET) headers.Authorization = `Bearer ${env.CRON_SECRET}`;
  const request = new Request(url, { method: 'GET', headers });
  const work = handleAsNodeRequest(PORT, request).then(async (res) => {
    const text = await res.text();
    console.log(`[CRON] ${pathname} → ${res.status} ${text.slice(0, 200)}`);
  }).catch((err) => {
    console.error(`[CRON] ${pathname} 실패:`, err?.message || err);
  });
  if (waitUntil) waitUntil(work);
  else await work;
}

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      try {
        const res = await handleAsNodeRequest(PORT, request);
        return withSecurityHeaders(res);
      } catch (err: any) {
        console.error('[WORKER] API 요청 처리 예외:', err?.message || err);
        return withSecurityHeaders(new Response(
          JSON.stringify({ ok: false, error: 'internal_server_error' }),
          { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        ));
      }
    }
    return withSecurityHeaders(new Response('Not Found', { status: 404 }));
  },

  async scheduled(controller: { cron: string }, env: { CRON_SECRET?: string }, ctx: { waitUntil: (p: Promise<any>) => void }): Promise<void> {
    const target = CRON_TASKS[controller.cron];
    if (!target) {
      console.warn(`[CRON] 알 수 없는 스케줄: ${controller.cron}`);
      return;
    }
    await callCronEndpoint(target, env, ctx.waitUntil.bind(ctx));
  }
};
