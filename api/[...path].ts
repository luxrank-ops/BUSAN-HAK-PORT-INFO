// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/**
 * Vercel 서버리스 함수(Node 런타임) 진입점 — /api/* 전체를 잡는 catch-all.
 *
 * server.ts 에서 정의한 Express 앱을 그대로 위임받아 처리합니다.
 * 정적 자산(HTML·CSS·JS·이미지)은 이 함수가 다루지 않습니다 — Vercel CDN 이
 * vercel.json 의 outputDirectory(build/public)에서 직접 서빙하고, /api/ 로
 * 시작하지 않는 경로는 rewrites 로 index.html 로 폴백됩니다(SPA).
 *
 * 주기 작업(스케줄 감시·DB 정리·주간 백업)은 vercel.json crons 와 GitHub Actions
 * 예약 워크플로가 /api/cron/* 를 호출해 트리거합니다 (CRON_SECRET 환경변수 필수).
 *
 * 참고: '../server.js' 지정자는 TypeScript(NodeNext) 규칙으로 실제 파일
 * server.ts 를 가리킵니다 — Vercel 의 함수 빌더(esbuild)도 동일하게 해석합니다.
 */
import { app } from '../server.js';

export default app;
