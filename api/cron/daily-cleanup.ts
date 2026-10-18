// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Vercel 서버리스 함수 진입점 — /api/cron/daily-cleanup 전용.
 * (vercel.json crons 의 "0 3 * * *" 등록 경로)
 *
 * catch-all 이 2세그먼트 경로를 매칭시키지 못해 플랫폼 404 로 떨어지는 문제를
 * 피하기 위해 개별 함수 파일로 노출합니다 — 자세한 내용은 api/cron/schedule-watch.ts
 * 주석 참고. 인증·응답 스키마는 catch-all 경로와 동일합니다.
 */
import { app } from '../../server.js';

export default app;
