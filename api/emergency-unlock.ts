// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Vercel 서버리스 함수 진입점 — POST /api/emergency-unlock 전용.
 *
 * 왜 이 파일이 따로 있나
 *   `api/[...path].ts` catch-all 은 Vercel 빌드 산출물에서 **단일 세그먼트** 경로
 *   (/api/health, /api/config 등)에만 매칭됩니다. `/api/emergency-unlock` 처럼
 *   2세그먼트인 경로는 함수에 도달하지 못하고 Vercel 플랫폼 라우터가 404(NOT_FOUND)를
 *   반환합니다 — 그래서 화면에서 아무리 올바른 비밀번호를 입력해도 서버 검증이
 *   실행되지 않고 "인증 실패"로 보였습니다.
 *
 *   같은 이유로 `/api/screen-unlock` 도 api/screen-unlock.ts 로 노출합니다.
 *   (주기 작업 경로 api/cron/*.ts 와 동일한 방식)
 */
import { app } from '../server.js';

export default app;
