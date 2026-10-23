// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Vercel 서버리스 함수 진입점 — /api/cron/weekly-self-check 전용.
 * (vercel.json crons 의 "0 20 * * 0" 등록 경로 = 매주 월요일 05:00 KST)
 *
 * catch-all 이 2세그먼트 경로를 매칭시키지 못해 플랫폼 404 로 떨어지는 문제를
 * 피하기 위해 개별 함수 파일로 노출합니다 — api/cron/schedule-watch.ts 주석 참고.
 *
 * ── 실행 파이프라인 (server.ts) ──────────────────────────────────────────────
 *   1. `authorizeCronRequest()`      — CRON_SECRET Bearer 인증 (미등록 503, 불일치 401)
 *   2. `buildServerSelfCheckProbes()` — 런타임·자동화·DB·터미널 8곳 실수집 점검
 *   3. `runWeeklySelfCheck()`         — 공용 엔진: 드리프트 판정 → 자동 복구 → 재검증
 *   4. `saveSelfCheckBaseline()`      — 다음 주 비교 기준선 영속화(Firestore + 파일)
 *   5. `sendWeeklySelfCheckEmail()`   — 보고서 메일 발송 (기본 수신 luxrank@gmail.com)
 *        · 전송 방식: RESEND_API_KEY → GOOGLE_* (Gmail API) → SMTP_*
 *        · 같은 ISO 주차에는 1통만 발송(system_self_check/state 마커 — ?forceEmail=1 로 무시)
 *   6. 응답에 보고서 전문 포함 (Vercel /tmp 는 함수 종료 시 소멸)
 *
 * ※ 동일 엔진이 상시 서버(node-cron, 매주 월요일 05:00 Asia/Seoul)와
 *   GitHub Actions(.github/workflows/weekly-self-check.yml)에서도 실행됩니다.
 */
import { app } from '../../server.js';

export default app;
