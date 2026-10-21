// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Vercel 서버리스 함수 진입점 — POST /api/auth-session 전용.
 *
 * 1) 익명 인증(signInAnonymously)이 Firebase 콘솔에서 비활성화된 경우에도
 *    서버가 Firebase Custom Token 을 발급해 모든 클라이언트가 isSignedIn() 을 충족하도록 보장
 * 2) 관리자 비밀번호(PIN/해시) 검증 통과 시 admin_luxrank Custom Token 및
 *    서명된 관리자 세션 토큰을 발급해 Firestore 규칙(isAdmin())과 서버 Admin API 를 동시 활성화
 */
import { app } from '../server.js';

export default app;
