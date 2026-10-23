// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Vercel 서버리스 함수 진입점 — /api/cron/daily-inspection 전용.
 * (vercel.json crons 의 "0 19 * * *" 등록 경로 = 매일 04:00 KST)
 *
 * catch-all 이 2세그먼트 경로를 매칭시키지 못해 플랫폼 404 로 떨어지는 문제를
 * 피하기 위해 개별 함수 파일로 노출합니다 — 자세한 내용은 api/cron/schedule-watch.ts
 * 주석 참고. 인증·응답 스키마는 catch-all 경로와 동일합니다.
 *
 * ── 실행 파이프라인 (server.ts) ──────────────────────────────────────────────
 *   1. `authorizeCronRequest()` — CRON_SECRET Bearer 인증 (미등록 503, 불일치 401)
 *   2. `runDailyInspection()`   — 10개 분야 기능 점검 + 마크다운·JSON 보고서 생성
 *   3. `deliverDailyInspectionEmail()` — 생성된 보고서를 메일로 발송
 *        · 실제 구현체: scripts/daily-report-mailer.mjs
 *        · 전송 방식 자동 감지: RESEND_API_KEY → GOOGLE_* (Gmail API) → SMTP_*
 *        · 자격증명이 없으면 skipped(점검은 정상 종료), 실패해도 응답 ok 는 유지
 *        · 응답의 `email` 필드에 status/transport/reason/sentAt/error 로 기록
 *   4. 응답 바디에 보고서 전문 포함 (Vercel /tmp 는 함수 종료 시 소멸)
 *
 * ※ 같은 파이프라인이 상시 서버(node-cron, 매일 04:00 Asia/Seoul)에서도 실행됩니다.
 *   Vercel 서버리스에서는 node-cron 이 비활성화되므로 중복 발송은 발생하지 않습니다.
 *   GitHub Actions(scripts/daily-inspection.mjs)는 REPORT_EMAIL_ON_CLI=1 일 때만
 *   발송하므로, 기본 구성에서는 하루 1통만 도착합니다.
 */
import { app } from '../../server.js';

export default app;
