// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Vercel 서버리스 함수 진입점 — /api/cron/schedule-watch 전용.
 *
 * 왜 이 파일이 따로 있나
 *   `api/[...path].ts` catch-all 은 Vercel 빌드 산출물에서 **단일 세그먼트** 경로
 *   (/api/health, /api/config 등)에만 매칭됩니다. 2세그먼트 이상 경로는 함수에 도달하지
 *   못하고 Vercel 플랫폼 라우터가 404(NOT_FOUND)를 반환합니다 — 비밀번호 오류(401)와
 *   무관한 라우팅 문제이며, GitHub Actions(매시간 FCM 스케줄 감시)와 Vercel Cron
 *   (매일 정리·매주 백업)이 전부 404 로 떨어지던 원인이었습니다.
 *
 *   따라서 2세그먼트 경로(주기 작업 트리거)는 Vercel 이 확실히 인식하는
 *   **개별 함수 파일**로 노출합니다. 각 파일은 server.ts 의 Express 앱을 그대로
 *   위임하므로 인증(CRON_SECRET)·응답 스키마는 catch-all 경로와 완전히 동일합니다.
 */
import { app } from '../../server.js';

export default app;
