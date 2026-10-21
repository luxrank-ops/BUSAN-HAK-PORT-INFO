// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Vercel 서버리스 함수 진입점 — GET/POST /api/admin-stats 전용.
 *
 * 서명된 관리자 토큰으로 인증된 요청에 한해 Firebase Admin SDK 로
 * 가입 근로자 계정(user_profiles), 누적 근무일지 전체(work_logs), 방문·운영 통계를 조회합니다.
 */
import { app } from '../server.js';

export default app;
