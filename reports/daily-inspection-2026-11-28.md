# 부산학 라이싱 작업 가이드 — 일일 기능 점검 보고서

> **점검 일시**: 2026-11-28 (토) 10:50:27 KST
> **점검 기준일**: 2026-11-28 (KST)
> **생성 시각(UTC)**: 2026-11-28T01:50:27.466Z
> **점검 방식**: 자동 점검 (매일 04:00 KST · GitHub Actions + Cloudflare Cron Triggers)

---

## 0. 점검 요약

| 구분 | 결과 |
| --- | --- |
| **종합 판정** | 🟢 **정상** (PASS) |
| 전체 점검 항목 | 119건 |
| ✅ PASS | 119건 |
| ⚠️ WARN | 0건 |
| ❌ FAIL | 0건 |
| 통과율 | 100% |

> 🟢 **모든 핵심 기능이 정상 동작합니다.** 별도 조치 없이 운영을 계속하세요.

---

## 1. 점검 항목 상세

| # | 분야 | 항목 | 결과 | 상세 |
| --- | --- | --- | --- | --- |
| 1 | 파일 존재 | .firebaserc | ✅ PASS | 파일 존재 확인 |
| 2 | 파일 존재 | firebase.json | ✅ PASS | 파일 존재 확인 |
| 3 | 파일 존재 | vercel.json | ✅ PASS | 파일 존재 확인 |
| 4 | 파일 존재 | wrangler.jsonc | ✅ PASS | 파일 존재 확인 |
| 5 | 파일 존재 | firestore.rules | ✅ PASS | 파일 존재 확인 |
| 6 | 파일 존재 | firestore.indexes.json | ✅ PASS | 파일 존재 확인 |
| 7 | 파일 존재 | package.json | ✅ PASS | 파일 존재 확인 |
| 8 | 파일 존재 | public/index.html | ✅ PASS | 파일 존재 확인 |
| 9 | 파일 존재 | public/admin.html | ✅ PASS | 파일 존재 확인 |
| 10 | 파일 존재 | public/manifest.json | ✅ PASS | 파일 존재 확인 |
| 11 | 파일 존재 | public/_headers | ✅ PASS | 파일 존재 확인 |
| 12 | 파일 존재 | public/service-worker.js | ✅ PASS | 파일 존재 확인 |
| 13 | 파일 존재 | public/firebase-messaging-sw.js | ✅ PASS | 파일 존재 확인 |
| 14 | 파일 존재 | public/css/app.css | ✅ PASS | 파일 존재 확인 |
| 15 | 파일 존재 | public/js/app.js | ✅ PASS | 파일 존재 확인 |
| 16 | 파일 존재 | public/js/notifications.js | ✅ PASS | 파일 존재 확인 |
| 17 | 파일 존재 | public/js/roster-engine.js | ✅ PASS | 파일 존재 확인 |
| 18 | 파일 존재 | public/js/leader-access.js | ✅ PASS | 파일 존재 확인 |
| 19 | 파일 존재 | public/js/ships-board.js | ✅ PASS | 파일 존재 확인 |
| 20 | 파일 존재 | public/js/tab-views.js | ✅ PASS | 파일 존재 확인 |
| 21 | 파일 존재 | public/js/terminal-as.js | ✅ PASS | 파일 존재 확인 |
| 22 | 파일 존재 | public/js/want-board.js | ✅ PASS | 파일 존재 확인 |
| 23 | 파일 존재 | public/js/domain-migration.js | ✅ PASS | 파일 존재 확인 |
| 24 | 파일 존재 | server.ts | ✅ PASS | 파일 존재 확인 |
| 25 | 파일 존재 | worker/index.ts | ✅ PASS | 파일 존재 확인 |
| 26 | 파일 존재 | worker/cf/firestore.ts | ✅ PASS | 파일 존재 확인 |
| 27 | 파일 존재 | worker/cf/google-auth.ts | ✅ PASS | 파일 존재 확인 |
| 28 | 파일 존재 | worker/cf/storage.ts | ✅ PASS | 파일 존재 확인 |
| 29 | 파일 존재 | worker/cf/messaging.ts | ✅ PASS | 파일 존재 확인 |
| 30 | 파일 존재 | api/[...path].ts | ✅ PASS | 파일 존재 확인 |
| 31 | 파일 존재 | scripts/weekly-self-check.mjs | ✅ PASS | 파일 존재 확인 |
| 32 | 파일 존재 | scripts/weekly-self-check-run.mjs | ✅ PASS | 파일 존재 확인 |
| 33 | 파일 존재 | api/cron/weekly-self-check.ts | ✅ PASS | 파일 존재 확인 |
| 34 | JSON 문법 | .firebaserc | ✅ PASS | JSON 파싱 성공 |
| 35 | JSON 문법 | firebase.json | ✅ PASS | JSON 파싱 성공 |
| 36 | JSON 문법 | vercel.json | ✅ PASS | JSON 파싱 성공 |
| 37 | JSON 문법 | firestore.indexes.json | ✅ PASS | JSON 파싱 성공 |
| 38 | JSON 문법 | package.json | ✅ PASS | JSON 파싱 성공 |
| 39 | JSON 문법 | public/manifest.json | ✅ PASS | JSON 파싱 성공 |
| 40 | HTML 구조 | public/index.html | ✅ PASS | 문서 구조 정상 |
| 41 | HTML 구조 | public/admin.html | ✅ PASS | 문서 구조 정상 |
| 42 | API 라우트 | GET /api/health | ✅ PASS | 라우트 존재 |
| 43 | API 라우트 | GET /api/config | ✅ PASS | 라우트 존재 |
| 44 | API 라우트 | POST /api/screen-unlock | ✅ PASS | 라우트 존재 |
| 45 | API 라우트 | POST /api/emergency-unlock | ✅ PASS | 라우트 존재 |
| 46 | API 라우트 | POST /api/emergency-notifications | ✅ PASS | 라우트 존재 |
| 47 | API 라우트 | PUT /api/emergency-notifications | ✅ PASS | 라우트 존재 |
| 48 | API 라우트 | POST /api/auth-session | ✅ PASS | 라우트 존재 |
| 49 | API 라우트 | GET /api/roster-ocr-config | ✅ PASS | 라우트 존재 |
| 50 | API 라우트 | POST /api/roster-ocr-run | ✅ PASS | 라우트 존재 |
| 51 | API 라우트 | POST /api/visitor-beacon | ✅ PASS | 라우트 존재 |
| 52 | API 라우트 | GET /api/visitor-logs | ✅ PASS | 라우트 존재 |
| 53 | API 라우트 | GET /api/analytics-summary | ✅ PASS | 라우트 존재 |
| 54 | API 라우트 | GET /api/admin-stats | ✅ PASS | 라우트 존재 |
| 55 | API 라우트 | GET /api/hjnc-schedule | ✅ PASS | 라우트 존재 |
| 56 | API 라우트 | GET /api/terminal-schedule | ✅ PASS | 라우트 존재 |
| 57 | API 라우트 | GET /api/cron/schedule-watch | ✅ PASS | 라우트 존재 |
| 58 | API 라우트 | GET /api/cron/daily-cleanup | ✅ PASS | 라우트 존재 |
| 59 | API 라우트 | GET /api/cron/weekly-backup | ✅ PASS | 라우트 존재 |
| 60 | API 라우트 | GET /api/cron/daily-inspection | ✅ PASS | 라우트 존재 |
| 61 | API 라우트 | GET /api/cron/weekly-self-check | ✅ PASS | 라우트 존재 |
| 62 | API 라우트 | GET /api/inspection-report | ✅ PASS | 라우트 존재 |
| 63 | API 라우트 | GET /api/self-check-report | ✅ PASS | 라우트 존재 |
| 64 | 터미널 지원 | HJNC | ✅ PASS | 지원 목록 포함 |
| 65 | 터미널 지원 | BNCT | ✅ PASS | 지원 목록 포함 |
| 66 | 터미널 지원 | DGT | ✅ PASS | 지원 목록 포함 |
| 67 | 터미널 지원 | PNC | ✅ PASS | 지원 목록 포함 |
| 68 | 터미널 지원 | HPNT | ✅ PASS | 지원 목록 포함 |
| 69 | 터미널 지원 | PNIT | ✅ PASS | 지원 목록 포함 |
| 70 | 터미널 지원 | BPTC | ✅ PASS | 지원 목록 포함 |
| 71 | 터미널 지원 | HBCT | ✅ PASS | 지원 목록 포함 |
| 72 | 터미널 파서 | parsePncScheduleHtml | ✅ PASS | 함수 존재 |
| 73 | 터미널 파서 | parsePncWorkStatusHtml | ✅ PASS | 함수 존재 |
| 74 | 터미널 파서 | extractPncSearchFormRequest | ✅ PASS | 함수 존재 |
| 75 | 터미널 파서 | mergePncScheduleAndWorkStatus | ✅ PASS | 함수 존재 |
| 76 | 자동화 크론 | 스케줄 감시 (매 정각) | ✅ PASS | 크론 등록됨 |
| 77 | 자동화 크론 | DB 정리 (매일 03시) | ✅ PASS | 크론 등록됨 |
| 78 | 자동화 크론 | 주간 백업 (일요일 00시) | ✅ PASS | 크론 등록됨 |
| 79 | 자동화 크론 | 일일 점검 (매일 04시) | ✅ PASS | 크론 등록됨 |
| 80 | 자동화 크론 | 주간 자가 점검 (월요일 05시) | ✅ PASS | 크론 등록됨 |
| 81 | 자동화 크론 | 주간 자가 점검 시간대 | ✅ PASS | 매주 월요일 05:00 (Asia/Seoul) |
| 82 | 자동화 상태 | automationRuntimeStatus.scheduleWatcher | ✅ PASS | 상태 트래킹 존재 |
| 83 | 자동화 상태 | automationRuntimeStatus.autoCleanup | ✅ PASS | 상태 트래킹 존재 |
| 84 | 자동화 상태 | automationRuntimeStatus.weeklyBackup | ✅ PASS | 상태 트래킹 존재 |
| 85 | 자동화 상태 | automationRuntimeStatus.dailyInspection | ✅ PASS | 일일 점검 상태 트래킹 존재 |
| 86 | 자동화 함수 | runScheduleChangeDetection | ✅ PASS | 함수 존재 |
| 87 | 자동화 함수 | runDatabaseAutoCleanup | ✅ PASS | 함수 존재 |
| 88 | 자동화 함수 | runWeeklyFirestoreBackup | ✅ PASS | 함수 존재 |
| 89 | 자동화 함수 | runDailyInspection | ✅ PASS | 일일 점검 함수 존재 |
| 90 | 배포 설정 | vercel.json outputDirectory | ✅ PASS | build/public 정상 |
| 91 | 배포 설정 | vercel.json crons /api/cron/daily-cleanup | ✅ PASS | 크론 등록됨 |
| 92 | 배포 설정 | vercel.json crons /api/cron/weekly-backup | ✅ PASS | 크론 등록됨 |
| 93 | 배포 설정 | vercel.json crons 일일 점검 | ✅ PASS | 미등록 — Cloudflare 크론 단독 실행(메일 1통) |
| 94 | 배포 설정 | wrangler.jsonc crons 일일 점검 | ✅ PASS | 0 19 * * * (04:00 KST) 등록됨 |
| 95 | 배포 설정 | worker scheduled 일일 점검 매핑 | ✅ PASS | /api/cron/daily-inspection 매핑됨 |
| 96 | 배포 설정 | firebase.json hosting.public | ✅ PASS | build/public 정상 |
| 97 | 배포 설정 | firebase.json predeploy | ✅ PASS | build:obfuscate 등록됨 |
| 98 | 보안·인증 | 화면 잠금 PIN 검증 | ✅ PASS | 구현 존재 |
| 99 | 보안·인증 | 긴급 공지 PIN 검증 | ✅ PASS | 구현 존재 |
| 100 | 보안·인증 | 관리자 세션 토큰 검증 | ✅ PASS | 구현 존재 |
| 101 | 보안·인증 | CRON_SECRET 인증 | ✅ PASS | 구현 존재 |
| 102 | 보안·인증 | 속도 제한 (Rate Limit) | ✅ PASS | 구현 존재 |
| 103 | 보안·인증 | SCREEN_LOCK_PIN 환경변수 참조 | ✅ PASS | 구현 존재 |
| 104 | 보안·인증 | CRON_SECRET 환경변수 참조 | ✅ PASS | 구현 존재 |
| 105 | 보안·인증 | firestore.rules isAdmin | ✅ PASS | 관리자 규칙 존재 |
| 106 | 보안·인증 | firestore.rules 크기 | ✅ PASS | 29KB |
| 107 | 디자인 토큰 | 토큰 정의 수 | ✅ PASS | 421개 토큰 정의 |
| 108 | 디자인 토큰 | CSS 토큰 참조 | ✅ PASS | var(--토큰) 사용 확인 |
| 109 | 워크플로 | 워크플로 파일 수 | ✅ PASS | 6개 파일 |
| 110 | 워크플로 | ci.yml | ✅ PASS | 파일 존재 |
| 111 | 워크플로 | cron-schedule-watch.yml | ✅ PASS | 파일 존재 |
| 112 | 워크플로 | deploy-firebase.yml | ✅ PASS | 파일 존재 |
| 113 | 워크플로 | daily-inspection.yml | ✅ PASS | 파일 존재 |
| 114 | 워크플로 | package.json script:dev | ✅ PASS | 스크립트 존재 |
| 115 | 워크플로 | package.json script:build | ✅ PASS | 스크립트 존재 |
| 116 | 워크플로 | package.json script:typecheck | ✅ PASS | 스크립트 존재 |
| 117 | 워크플로 | package.json script:validate | ✅ PASS | 스크립트 존재 |
| 118 | 워크플로 | package.json script:test | ✅ PASS | 스크립트 존재 |
| 119 | 워크플로 | package.json script:check | ✅ PASS | 스크립트 존재 |

---

## 2. 분야별 요약

| 분야 | PASS | WARN | FAIL | 합계 | 상태 |
| --- | --- | --- | --- | --- | --- |
| 파일 존재 | 33 | 0 | 0 | 33 | 🟢 정상 |
| JSON 문법 | 6 | 0 | 0 | 6 | 🟢 정상 |
| HTML 구조 | 2 | 0 | 0 | 2 | 🟢 정상 |
| API 라우트 | 22 | 0 | 0 | 22 | 🟢 정상 |
| 터미널 지원 | 8 | 0 | 0 | 8 | 🟢 정상 |
| 터미널 파서 | 4 | 0 | 0 | 4 | 🟢 정상 |
| 자동화 크론 | 6 | 0 | 0 | 6 | 🟢 정상 |
| 자동화 상태 | 4 | 0 | 0 | 4 | 🟢 정상 |
| 자동화 함수 | 4 | 0 | 0 | 4 | 🟢 정상 |
| 배포 설정 | 8 | 0 | 0 | 8 | 🟢 정상 |
| 보안·인증 | 9 | 0 | 0 | 9 | 🟢 정상 |
| 디자인 토큰 | 2 | 0 | 0 | 2 | 🟢 정상 |
| 워크플로 | 11 | 0 | 0 | 11 | 🟢 정상 |

---

## 3. 자동화 상태

| 작업 | 스케줄 | 트리거 | 상태 |
| --- | --- | --- | --- |
| 선박 스케줄 변경 감지 | 매시간 (5 * * * *) | Cloudflare Cron Triggers / GitHub Actions(보조) / node-cron | ✅ 정상 |
| DB 자가 정리 | 매일 03:00 (0 3 * * *) | Vercel Cron / node-cron | ✅ 정상 |
| 주간 백업 | 매주 일요일 00:00 (0 0 * * 0) | Vercel Cron / node-cron | ✅ 정상 |
| **일일 기능 점검** | **매일 04:00 (0 19 * * * UTC)** | **GitHub Actions + Cloudflare Cron Triggers** | **✅ 정상** |

---

## 4. 배포 상태

| 구분 | URL | 상태 |
| --- | --- | --- |
| 운영 (Cloudflare Workers) | https://busan-hak-port-info.luxrank.workers.dev | main 푸시 후 수동 배포 · Cron Triggers |
| 병행 (Vercel) | https://busan-hak-port-info.vercel.app | 서비스 공지상 2026-12-01 종료 (Vercel Pro는 2026-12-20 만료) |
| 보조 (Firebase Hosting) | https://busan-hak-port.web.app | 승인형 배포 |
| 데이터 저장소 | Firebase 프로젝트 `busan-hak-port` | Firestore · Storage · FCM |

---

## 5. 조치 사항

조치 필요 항목 없음 — 모든 항목 정상입니다.

---

## 6. 점검 이력

- 이전 점검 보고서는 `reports/` 및 `docs/inspections/` 디렉터리에서 날짜별로 확인할 수 있습니다.
- 최신 보고서는 `reports/latest.md` 에서 항상 확인할 수 있습니다.
- 자동 점검 로그는 GitHub Actions 실행 내역(Actions 탭)과 Vercel Cron 로그에서 확인하세요.

---

## 7. 참고

- 본 보고서는 매일 04:00 KST 에 자동 생성됩니다.
- 수동 실행: `npm run inspection` 또는 `node scripts/daily-inspection.mjs`
- API 조회: `GET /api/cron/daily-inspection` (CRON_SECRET 인증 필요) / `GET /api/inspection-report` (공개 요약)
- 문의: 이춘학 (luxrank@gmail.com / 010-2846-8906)

---

*© 2026 이춘학 — BUSAN HAK PORT INFO. All rights reserved.*
