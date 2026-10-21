// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Vercel 서버리스 함수 진입점 — GET /api/analytics-summary 전용.
 *
 * catch-all(api/[...path].ts)은 단일 세그먼트 경로에만 매칭되므로, 2세그먼트 경로는
 * 개별 함수 파일로 노출해야 플랫폼 404 를 피할 수 있습니다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

let cachedExpressApp: ((req: IncomingMessage, res: ServerResponse) => unknown) | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (!cachedExpressApp) {
      const mod = await import('../server.js');
      cachedExpressApp = mod.app;
    }
    return cachedExpressApp(req, res);
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: false,
        error: 'bootstrap_failed',
        name: String(err?.name || 'Error'),
        message: String(err?.message || err)
      })
    );
  }
}
