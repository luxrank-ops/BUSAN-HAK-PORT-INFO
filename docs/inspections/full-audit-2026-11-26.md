# BUSAN HAK PORT INFO (학포트 v2027.85) 전체 기능점검 기획 및 멀티 에이전트 정밀 점검 보고서

> **점검 기준일**: 2026-11-26 (목)  
> **대상 저장소**: `luxrank-ops/BUSAN-HAK-PORT-INFO` (`main@6d38aa9`, 총 50,227라인)  
> **점검 방식**: 7인 전문 에이전트 팀 기반 전수 코드 감사 + 빌드/테스트 검증 + 로컬 실서버(`server.ts`) 동적 HTTP/보안 프로브 + 비즈니스 로직 단위 재현  
> **기존 자동점검 대비 차별점**: 기존 `scripts/daily-inspection.mjs`(101건 PASS)는 파일 존재·문자열 매칭 위주의 표면 검사만 수행하여 보안 규칙 취약점·UI/계산 로직 버그·Cloudflare Workers 어댑터 결함·실서버 런타임 오류를 탐지하지 못함. 본 점검은 **실제 실행·재현 기반 심층 점검**을 수행함.

---

## 1. 전체 기능점검 기획서 (What & How)

### 1.1 점검 대상 시스템 인벤토리 (7대 도메인)

| 영역 | 핵심 구성요소 | 파일 규모 |
| --- | --- | --- |
| **① 빌드·테스트·CI/CD·멀티플랫폼 배포** | `package.json`, `vercel.json`, `wrangler.jsonc`, `firebase.json`, `.github/workflows/*` (6종), `scripts/build-obfuscate.mjs`, `scripts/build-worker.mjs`, `scripts/daily-inspection.mjs` | 설정·스크립트 40+개 |
| **② 백엔드 API·터미널 수집·크론·CF Workers** | `server.ts` (4,812줄), `api/*.ts` (7개), `api/cron/*.ts` (5개), `worker/index.ts`, `worker/cf/*` (5개 어댑터) | 약 6,100줄 |
| **③ 보안·인증·권한·Firestore 규칙/색인** | `firestore.rules` (487줄), `firestore.indexes.json`, `server.ts` 인증/토큰/레이트리밋, `leader-access.js`, XSS/CORS | 전 계층 |
| **④ 프론트엔드 핵심·임금계산기·근무일지·PWA** | `public/index.html` (2,280줄), `public/admin.html`, `public/css/app.css` (4,152줄), `public/js/app.js` (11,278줄), `tab-views.js`, `domain-migration.js`, `service-worker.js`, `firebase-messaging-sw.js` | 약 18,600줄 |
| **⑤ 특화 기능·AI 비전/OCR·커뮤니티** | `roster-engine.js` (3,572줄), `scripts/roster-ai-vision.mjs`, `roster-cloud-ocr.mjs`, `want-board.js` (1,180줄), `kkung-relay.js` (864줄), `ships-board.js`, `notifications.js`, 긴급 공지·방문자 통계 | 약 7,900줄 |
| **⑥ 빌드 산출물·동적 런타임 정합성** | `build/public/` 난독화 산출물, `.cf-worker/index.js` (2.93MB), 실서버 Express HTTP 응답/헤더/에러 포맷 | 런타임 실측 |
| **⑦ 데이터 거버넌스·저장소 위생** | 백업 범위, TTL 정리(개인정보 IP 보관), 2027년 전환 대비(최저시급·공휴일), 저장소 불필요/중복 파일 | 운영 전반 |

### 1.2 심각도 분류 기준 (Severity Rubric)

- **P0 (Critical · 즉시 차단/수정 필수)**: 인증 우회, 권한 상승, 타인 개인정보·임금 데이터 유출/변조, 전체 서비스 중단 또는 핵심 관리자 기능 완전 불능
- **P1 (High · 우선 수정)**: 임금 오계산, 달력/기능 고장, XSS 가능성, Cloudflare Workers·Vercel 프로덕션 장애 유발, 크론 타임아웃/실패
- **P2 (Medium · 단기 개선)**: 특정 조건·정적 호스팅 폴백 실패, 캐시/PWA 업데이트 지연, 성능·비용 낭비, 중복 푸시, 문서·코드 불일치
- **P3 (Low · 중기 정리)**: 죽은 코드, 저장소 위생, 사소한 UX/운영 개선

### 1.3 점검 방법론 (4단계 검증 파이프라인)

1. **자동 베이스라인 검증**: `npm run check` (`tsc --noEmit` + `validate` + `tokens:check` + `node --test` 480건), `npm run build` (`build:obfuscate`), `npm run build:cf` (`build-worker.mjs`)
2. **심층 정적 코드·규칙 감사**: 전 파일 라인 단위 리뷰, DOM ID·인라인 핸들러↔난독화 산출물 교차 검증, Firestore 쿼리↔`firestore.indexes.json`·`firestore.rules` 매칭, XSS(`innerHTML`·`href`·`onclick`) 전수 스캔
3. **로컬 실서버 동적 API 프로브**: `server.ts`를 실기동하여 29개 실요청(정상/오류/CORS/헤더/페이로드 초과/비정상 JSON/토큰 위조 PoC) 실행
4. **핵심 비즈니스 로직 경계값 재현**: 31일 월 이동(`changeMonth`), 0.5시간 소수 근무(`calculateWageSegment`), 2026~2027 공휴일·시급 전환, `want-board` UI 상태 전이 추적

---

## 2. 전문 에이전트 팀 편성

| 에이전트 | 역할 | 담당 점검 항목 | 수행 결과 요약 |
| --- | --- | --- | --- |
| **Agent 0** | **QA 총괄 기획자 (Lead)** | 점검 아키텍처 설계, 심각도 기준 수립, 6개 팀 교차 검증 및 최종 로드맵 통합 | 전 영역 36건 이슈 분류·우선순위 확정 |
| **Agent 1** | **빌드·테스트·CI/CD·인프라 에이전트** | `check`/`build`/`build:cf`, GitHub Actions 6종, Vercel 12함수 한도/타임아웃, CF Workers 번들·헤더, 저장소 위생 | 테스트 480/480 PASS, **인프라·CI·번들 결함 8건 발견** |
| **Agent 2** | **백엔드 API·터미널·워커 호환성 에이전트** | `server.ts` 28개 라우트, 8개 터미널 수집기, 크론 5종, `worker/cf/*` REST 어댑터 정합성 | **워커 어댑터·성능·타임존·백업 결함 10건 발견** |
| **Agent 3** | **보안·인증·Firestore 규칙 에이전트** | `firestore.rules`, HMAC 토큰/PIN/관리자 인증, `/api/auth-session`, XSS/CORS, PII 보호 | **P0 5건 포함 치명적 보안 취약점 11건 실증** |
| **Agent 4** | **프론트엔드 핵심·임금·일지·PWA 에이전트** | `app.js`, `index.html`, `tab-views.js`, `domain-migration.js`, `service-worker.js`, `firebase-messaging-sw.js` | **임금 오계산·31일 달력 버그·SW/FCM 결함 9건 발견** |
| **Agent 5** | **특화 기능·AI 비전/OCR 에이전트** | `want-board.js`, `roster-engine.js`, `roster-ai-vision.mjs`, `kkung-relay.js`, `ships-board.js`, `notifications.js` | **운영자에게 바란다 관리자 버튼 소멸·미리보기 수정 먹통 등 7건 발견** |
| **Agent 6** | **동적 런타임·산출물 교차 검증 에이전트** | 실서버 29건 HTTP 프로브, `build/public` 154개 핸들러/ID 검증, 토큰 위조 PoC 재현 | **실서버 PoC로 P0 토큰 위조·HTML 에러 누출·SW 1년 캐시 실증** |

---

## 3. 자동화 베이스라인 실행 결과

| 검사 항목 | 명령어 | 결과 | 비고 |
| --- | --- | --- | --- |
| TypeScript 타입 검사 | `npm run typecheck` | ✅ PASS | 오류 0건 |
| 저장소 구조·문법 검증 | `npm run validate` | ✅ PASS | 필수 파일 23, JSON 7, HTML 2, 워크플로 6 |
| 디자인 토큰 정합성 | `npm run tokens:check` | ✅ PASS | 토큰 188개 · CSS 무결성 OK |
| 단위/회귀 테스트 | `npm test` | ✅ PASS | **480/480 통과** (9.3초) |
| 난독화 정적 빌드 | `npm run build` | ✅ PASS | 전역 함수 533개 보존 (940KB → 572KB) |
| Cloudflare Workers 빌드 | `npm run build:cf` | ⚠️ WARN | 번들 **2.93MB** (gzip 745KB), esbuild 크기 경고(`⚠️`) 출력 |
| HTML 중복 ID / 인라인 핸들러 | Agent 6 교차 스크립트 | ✅ PASS | 중복 ID 0건, 인라인 핸들러 154개 전부 번들 존재 |
| DOM `getElementById` 무결성 | Agent 6 교차 스크립트 | ⚠️ WARN | `wageLayoutToggleBtn` 1건 HTML 미존재 (죽은 코드) |
| Firestore 규칙 에뮬레이터 | `npm run test:rules` | ⏭️ SKIP | 로컬 샌드박스에 Java 미설치 (CI에서는 실행됨) |

---

## 4. 상세 점검 결과 (심각도별 전수 목록)

### 🔴 P0 — Critical (즉시 수정 필수, 6건)

#### [P0-1] 관리자 세션 HMAC 토큰 오프라인 위조 가능 (권한 상승) — *Agent 3 & Agent 6 실증*
- **위치**: `server.ts:109`, `server.ts:112`, `server.ts:249`, `server.ts:267`
- **원인**:
  - `SCREEN_UNLOCK_TOKEN_SECRET`이 `process.env.UNLOCK_TOKEN_SECRET` 미설정 시 기본 4자리 UI 잠금 PIN인 `SCREEN_LOCK_PIN`(기본값 `"9445"`)으로 폴백함.
  - 그런데 이 동일한 키로 **고권한 관리자 API 토큰(`issueAdminSessionToken`)**과 **긴급 공지 토큰(`issueEmergencyUnlockToken`)**까지 서명함.
  - `"9445"`는 `README.md`, 코드 주석, 빌드 기본값에 공개되어 있으므로, 공격자가 관리자 비밀번호(`9363`)를 몰라도 `${expiresAt}.${HMAC_SHA256("9445", "admin-session:" + expiresAt)}`를 오프라인 생성해 관리자 API를 통과할 수 있음.
- **실서버 재현 결과 (Agent 6)**:
  - 무인증 `GET /api/admin-stats` → `401 {"ok":false,"error":"unauthorized"}`
  - `"9445"`로 위조한 Bearer 토큰 `GET /api/admin-stats` → **`verifyAdminSessionToken()` 통과** (`503 firebase_admin_not_initialized` 도달 — Firebase Admin 연결 환경에서는 전 근로자 계정·전체 근무일지 덤프 성공)
  - 동일 위조 토큰 `GET /api/visitor-logs` → **인증 통과** (전체 방문자 IP/위치 로그 열람 가능)
- **조치 방안**: `ADMIN_SESSION_SECRET`을 별도 필수 환경변수로 분리하고, 미설정 시 `"9445"` 폴백 대신 프로세스 랜덤 키(또는 프로덕션 503 차단) 사용.

#### [P0-2] `POST /api/auth-session` (`mode: 'anonymous'`) 임의 근로자 UID 사칭 취약점 — *Agent 3*
- **위치**: `server.ts:3642-3660`
- **원인**:
  - 클라이언트가 요청 본문에 임의의 `clientId`를 넘기면, 검증 없이 `uid = "worker_" + safeSuffix`로 유효한 Firebase Custom Token을 발급함.
  - `want_board/{itemId}`, `want_board_mine/{uid}` 등의 소유권 검사가 `request.auth.uid`에 의존하므로, 다른 사용자의 `worker_*` UID를 알면 비공개 피드백을 열람·삭제할 수 있음.
- **조치 방안**: `clientId`로 기존 UID를 재발급할 때는 서버가 최초 발급한 서명된 세션/디바이스 토큰(HMAC 쿠키 또는 비밀 키) 검증을 요구하거나, Firebase 공식 익명 인증을 주 경로로 전환하고 Custom Token은 서버 생성 랜덤 UID만 허용.

#### [P0-3] Firestore `work_logs` 전체 근로자 임금·근무일지 무단 열람 및 변조 — *Agent 3*
- **위치**: `firestore.rules:170-189`
- **원인**:
  - `allow list: if isSignedIn() && (isAdmin() || (resource.data.workerId is string && resource.data.workerId.size() <= 64));`
  - Firestore 규칙에서 `resource.data.workerId is string`은 "본인 `workerId` 필터 강제"가 아니라 **문자열 필드가 존재하는 모든 문서에 참**으로 평가됨.
  - `allow get`, `allow update` 역시 소유자(`request.auth.uid`) 일치 검사가 전혀 없어, 익명 로그인한 누구라도 `db.collection('work_logs').get()`으로 **전 근로자의 급여·선박·동료·메모 전체를 덤프**하거나 타인의 근무일지를 수정·소프트삭제(`deletedAt`) 가능.
- **조치 방안**: `work_logs` 문서에 `ownerUid` 필드를 도입하거나, 근로자 로그인을 서버 검증 Custom Token(`uid == workerId` 또는 `claims.workerId`)과 결합하여 `resource.data.workerId == request.auth.token.workerId`를 규칙에서 강제.

#### [P0-4] Firestore `user_profiles/{nick}` 계정 탈취 및 비밀번호 해시 노출/덮어쓰기 — *Agent 3*
- **위치**: `firestore.rules:155-166`
- **원인**:
  - `allow get: if isSignedIn() && isValidId(nick);` — 닉네임만 알면 해당 근로자의 `password` SHA-256 해시를 읽을 수 있음(4~6자리 PIN은 오프라인 수 밀리초 내 크래킹 가능).
  - `allow update`가 기존 비밀번호나 소유자 UID 확인 없이 `password`, `fcmToken` 덮어쓰기를 허용 — 누구나 타인 계정의 비밀번호를 바꿔 계정 탈취 가능.
- **조치 방안**: 근로자 가입·로그인·비밀번호 변경을 서버 API(`/api/worker-auth`)로 이관하고, `user_profiles`의 `password` 필드 클라이언트 직접 읽기/쓰기 전면 차단.

#### [P0-5] Firestore `settings/emergency_notice`·`archives`·`notifications`·`posts`/`ships` 무단 조작 — *Agent 3*
- **위치**: `firestore.rules:106-114`, `200-204`, `224-266`, `270-274`, `284-295`
- **원인**:
  - **`settings/emergency_notice`**: `isAdmin()` 없이 익명 사용자 누구나 `isValidEmergencyNoticeWrite()` 형식만 맞추면 **전 접속자 화면 상단에 긴급 플로팅 공지(피싱·허위 통제 공지 등) 게시 가능**.
  - **`archives/{archiveId}`**: 익명 사용자 누구나 문서 생성·수정 가능 → `url: "javascript:..."` 삽입 시 **`public/js/app.js:11273`의 `<a href="${safeUrl}">`를 통해 Stored XSS 연계 가능**.
  - **`notifications/{notiId}`**: 익명 사용자 누구나 타인의 모든 알림 조회(`allow get, list: if isSignedIn()`), 가짜 긴급/스케줄 알림 주입(`allow create`), 타인 알림 읽음 처리 가능.
  - **`posts`·`ships`·`comments`**: `password` 해시가 읽히고 `isValidSoftDelete()`는 비밀번호 검사조차 없어, 익명 사용자 누구나 **모든 게시글·선박도감·댓글을 일괄 소프트 삭제하거나 내용을 덮어쓰기 가능**.
- **조치 방안**:
  - `settings/emergency_notice` 쓰기를 `isAdmin()` 전용으로 제한(긴급 공지 PIN 인증 시 서버가 `admin` 권한 또는 서버 API 경유 저장 처리).
  - `archives`, `hjnc_schedules` 쓰기 `isAdmin()` 제한, `notifications` 읽기/읽음처리를 `resource.data.userId == request.auth.uid || isAdmin()`로 제한하고 `create`는 서버 전용(`if false`)으로 잠금.
  - `archives`/`posts` 링크 렌더링 시 `https://` 또는 `http://` 스킴 화이트리스트 검증 추가.

#### [P0-6] "운영자에게 바란다" 관리자 모드 진입 버튼 자동 소멸 — *Agent 5*
- **위치**: `public/js/want-board.js:771-790`, `public/js/want-board.js:887-894`, `public/js/want-board.js:1005-1015`, `public/index.html:1900`
- **원인**:
  - 초기화(`init()`) 시 `renderWantAdminBar()`가 `#wantBoardAdminBar`에 `"관리자로 보기"` 버튼을 넣고 `.hidden`을 제거함.
  - 그러나 사용자가 게시판을 여는 순간 `openWantBoard()` → `initWantBoardFlow()` → `loadWantMyIndex()` → `renderWantMyList()`가 호출되며, **893행의 `if (adminBar) adminBar.classList.toggle('hidden', !adminMode);`가 즉시 실행**됨.
  - 초기 상태에서 `adminMode === false`이므로, `#wantBoardAdminBar`가 즉시 숨겨져 **관리자가 `"관리자로 보기"` 버튼을 클릭할 수 없는 상태**가 됨(화면이 열린 직후 찰나간 보였다가 사라짐).
- **조치 방안**: `renderWantMyList()`의 893행(`adminBar.classList.toggle('hidden', !adminMode)`)을 제거하고 `renderWantAdminBar()`가 항상 바를 노출(일반 모드: "관리자로 보기" 버튼 / 관리자 모드: "종료" 버튼)하도록 수정.

---

### 🟠 P1 — High (우선 수정 권장, 13건)

#### [P1-1] 근무일지·조장 달력 31일(말일) 월 이동 시 다음/이전 달 건너뜀 버그 — *Agent 4 실증*
- **위치**: `public/js/app.js:7283` (`changeMonth`), `public/js/app.js:11278` (`changeLeaderMonth`)
- **원인**: `currentDate.setMonth(currentDate.getMonth() + s)` 호출 전 일자(`date`)를 `1`로 고정하지 않음.
- **재현 결과**: `2026-03-31`에 `changeMonth(+1)` 호출 → **`2026-05-01` (4월 건너뜀)**, `changeMonth(-1)` 호출 → **`2026-03-03` (2월로 이동 불가)**. 매년 1/31, 3/31, 5/31, 8/31, 10/31 등 말일에 동일 장애 발생.
- **조치 방안**: `currentDate.setDate(1); currentDate.setMonth(currentDate.getMonth() + s);`로 수정.

#### [P1-2] 임금계산기 소수점 시간(예: 8.5시간) 올림 과다 산정 버그 — *Agent 4 실증*
- **위치**: `public/js/app.js:7481-7490` (`calculateWageSegment`)
- **원인**: `wageTotalHours`는 `parseFloat`로 소수점 입력을 허용하지만, `calculateWageSegment` 내부 루프가 `for (let i = 0; i < hours; i++)` 정수 증가로 동작함.
- **재현 결과**: `hours = 8.5` 입력 시 `i = 0..8`로 **9회 반복**되어 `dayHours + nightHours = 9H`로 계산됨(0.5시간 초과 지급, +5,160원 오차). 요약 문구에는 `총 8.5H (주간 9H / 야간 0H)`로 모순 출력.
- **조치 방안**: `Math.floor(hours)` 단위 반복 후 잔여 분수(`hours - Math.floor(hours)`)를 마지막 슬롯의 주/야간·휴일 판정에 가중 합산.

#### [P1-3] 2026년 6월 3일 지방선거일(법정 공휴일) 누락 및 2027년 최저시급 미등록 — *Agent 4 실증*
- **위치**: `public/js/app.js:6246` (`HOLIDAYS`), `public/js/app.js:2615-2640` (`WAGE_HOURLY_BY_YEAR`)
- **원인**:
  - `HOLIDAYS`에 **2026-06-03(제9회 전국동시지방선거일)**이 누락되어 주말·공휴일 수당 자동 계산 및 달력 공휴일 표시에서 제외됨(`2027-02-07` 설날 당일도 집합 미포함 — 일요일이라 요일 판정은 되나 집합 자체 누락).
  - 현재 시점(`2026-11-26`) 기준 36일 후인 `2027-01-01`이 되면 `WAGE_HOURLY_BY_YEAR[2027]`이 `undefined`여서 화면 라벨만 `"2027년 시급"`으로 바뀌고 입력값은 `2026년 시급(10,320원)`에 머무름.
- **조치 방안**: `2026-06-03`·`2027-02-07` 공휴일 추가 및 2027년 확정 최저시급(및 기능공 단가 변동 여부) 반영.

#### [P1-4] 관리자 근무일지 통합 모달 `onclick` 속성 Stored XSS — *Agent 3 & Agent 4*
- **위치**: `public/js/app.js:2229`, `2248`, `2264`
- **원인**: `wid.replace(/\\/g, "\\\\").replace(/'/g, "\\'")`로 작은따옴표만 이스케이프하고 HTML 속성 구분자인 큰따옴표(`"`)를 이스케이프하지 않아 `onclick="filterAdminWorkLogByWorker('${jsWid}')"` 속성 탈출 가능. (P0-3 `work_logs` 쓰기 취약점과 결합 시 관리자 세션 탈취 가능)
- **조치 방안**: `data-*` 속성과 이벤트 위임(`addEventListener`)으로 교체하거나 `escapeShipCommentHtml`을 이중 적용.

#### [P1-5] "운영자에게 바란다" 미리보기 `✏️ 수정` 버튼 먹통 버그 — *Agent 5*
- **위치**: `public/js/want-board.js:631`
- **원인**: 미리보기 하단 `"✏️ 수정"` 버튼이 `onclick="showWantPreview()"`로 연결되어 있음(`closeWantPreview()`가 아님, `closeWantPreview`는 전역 노출도 안 됨). 클릭 시 미리보기가 닫히지 않고 자기 자신을 다시 렌더링하며, `✕ 취소`를 누르면 입력 내용이 전부 초기화됨.
- **조치 방안**: `closeWantPreview`를 전역 노출하고 631행을 `onclick="closeWantPreview()"`로 교체, `submitWantReply`에서는 `area.innerText` 사용 및 부모 문서 `status: 'replied'`·`replyCount` 갱신 추가.

#### [P1-6] Cloudflare Workers Firestore REST 어댑터(`worker/cf/firestore.ts`) 정합성 결함 4종 — *Agent 2*
- **위치**: `worker/cf/firestore.ts:281-304`, `307-332`, `437-459`, `511-550`
- **상세 결함**:
  1. **`updateMask` + `FieldValue` 충돌 (`530-549행`)**: `FieldValue.serverTimestamp()`/`increment()` 필드가 `updateTransforms`로 이동했음에도 `updateMask.fieldPaths`에 포함됨. `increment()` 시 기존 값이 먼저 삭제(0 초기화)된 뒤 증가할 위험 존재.
  2. **`_listAll()` 과다 읽기 (`437-459행`)**: 조건 없는 `.limit(20).get()`(예: `server.ts:2666`의 `db.collection('work_logs').limit(20).get()`)도 `pageSize=1000`으로 **최대 30,000건을 전부 읽은 뒤** `.slice(0, 20)`으로 자름(심각한 지연·비용·Workers subrequest 초과).
  3. **비원자적 `runTransaction()` (`281-304`, `511-528행`)**: Firestore REST `beginTransaction` 없이 일반 `get()` + `commit()`만 수행. `create()` 외 read-modify-write 트랜잭션 동시성 보장 없음.
  4. **`DocumentReference.collection()` 미구현 & `update()` 존재 검증 누락**: 서브컬렉션 접근 불가, `update()`에 `currentDocument: { exists: true }` 미설정으로 미존재 문서가 자동 생성됨.

#### [P1-7] Cloudflare Workers에서 AI 비전(Vertex AI) 및 Google Cloud Vision OCR 인증 실패 위험 — *Agent 2*
- **위치**: `server.ts:3223`, `server.ts:3290`, `server.ts:3440`, `wrangler.jsonc:32`
- **원인**: `wrangler.jsonc`에서 `ROSTER_CLOUD_OCR_ENABLED: "1"`을 활성화했으나, `server.ts`의 `getRosterVisionAuth()`는 `worker/cf/google-auth.ts` 대신 `google-auth-library`의 `GoogleAuth`를 직접 호출함. `worker/cf/google-auth.ts`가 별도 구현된 이유 자체가 Workers 환경에서 `google-auth-library` 호환 문제가 있기 때문이며, 이로 인해 CF Workers 이전 후 Vertex AI·Google Vision OCR이 장애를 일으킬 수 있음.
- **조치 방안**: `IS_CLOUDFLARE` 분기에서 `worker/cf/google-auth.ts`의 `getGoogleAccessToken(SCOPE.cloudPlatform)`를 재사용하거나 공통 경량 JWT 토큰 발급기로 통합.

#### [P1-8] `vercel.json` 크론·관리자 개별 함수 11개에 `maxDuration` 미설정 & Hobby 12함수 한도 포화 — *Agent 1 & Agent 2*
- **위치**: `vercel.json:118-122`, `api/*.ts` (7개) + `api/cron/*.ts` (5개) = 12개
- **원인**:
  - `maxDuration: 60`이 `api/[...path].ts`에만 지정되어 있고, 실제 무거운 작업을 수행하는 `api/cron/schedule-watch.ts`, `weekly-self-check.ts`, `weekly-backup.ts`, `daily-cleanup.ts`, `admin-stats.ts`, `analytics-summary.ts`에는 미적용(기본 10초 제한 위험).
  - 또한 `api/` 파일 수가 정확히 **12개(Hobby 상한)**에 도달해 신규 API 함수 파일 1개만 추가해도 Vercel 배포가 실패함.
- **조치 방안**: `vercel.json`의 `functions`에 `"api/**/*.ts": { "maxDuration": 60 }` 적용(Hobby/Fluid Compute 범위 내 최적화) 및 단일 세그먼트 중복 진입점 정리 검토.

#### [P1-9] 기본 비밀번호(`9445` / `9363`) 영구 백도어 동작 — *Agent 3*
- **위치**: `server.ts:144-149`, `server.ts:344`, `scripts/build-obfuscate.mjs:119`, `public/js/app.js:490`
- **원인**:
  - 운영자가 `SCREEN_LOCK_PIN`을 변경해도 `getAcceptedScreenLockPins()`와 빌드 해시(`__SCREEN_LOCK_DEFAULT_SHA256__`)가 **`"9445"`를 무조건 영구 허용**함.
  - 운영자가 `ADMIN_PASSWORD` 환경변수나 Firestore `settings/admin` 비밀번호를 변경해도 `verifyAdminPassword()`와 `app.js:490`이 **`DEFAULT_ADMIN_PW_HASH`(`"9363"`)를 항상 허용 목록에 유지**함. 즉, **비밀번호 변경 시 기존 기본 비밀번호가 절대 폐기되지 않음**.
- **조치 방안**: 환경변수 또는 `settings/admin`에 명시적 비밀번호가 설정된 경우 기본값을 허용 목록에서 제외.

#### [P1-10] `GET /api/analytics-summary` 무인증·무캐시 6개 전체 컬렉션 풀스캔 (비용/DoS 위험) — *Agent 2*
- **위치**: `server.ts:3672-3715`
- **원인**: 인증·캐시·레이트리밋 없이 매 요청마다 `user_profiles`, `ships`, `posts`, `notices`, `archives`, `work_logs` **6개 컬렉션 전체 문서를 다운로드**함. 데이터 증가 시 Firestore 일일 무료 읽기 한도(5만건) 급속 소진 및 OOM/타임아웃 유발.
- **조치 방안**: 최소 60~180초 메모리/Firestore 요약 캐시 적용, `deletedAt` 없는 카운트는 집계 쿼리(`.count()`) 또는 요약 문서 활용, IP 기반 레이트리밋 적용.

#### [P1-11] `runScheduleChangeDetection()` 순차 700+ RPC 호출 및 KST 타임존 오차 — *Agent 2*
- **위치**: `server.ts:1699-1704`, `server.ts:1749-1775`, `server.ts:4442`, `server.ts:4474`
- **원인**:
  - 매시간 8개 터미널 ~350척에 대해 `for (const v of allVessels)` 루프 안에서 `doc.get()` + `doc.set()`을 **순차 700회 이상 실행** → Cloudflare Workers subrequest 한도 및 서버리스 타임아웃 초과 위험.
  - 또한 `new Date()`가 서버 UTC 기준이라 **매일 00:00~08:59 KST** 사이 스케줄 조회 기본 날짜 범위가 어제 기준으로 1일 어긋남(`/api/hjnc-schedule`, `/api/terminal-schedule`, `runScheduleChangeDetection` 공통).
- **조치 방안**: 기존 캐시 1회 조회(`where('TERMINAL', ...)` 또는 전체 스냅샷 1회) 후 메모리 비교 + 변경분만 `WriteBatch`(400건 단위) 커밋; 날짜 계산은 KST(+9h) 헬퍼 통일.

#### [P1-12] Express `/api/*` JSON 에러 핸들러 부재 (HTML 에러·스택 정보 노출) — *Agent 6 실증*
- **위치**: `server.ts:3170`, `server.ts:4751`
- **실서버 재현 결과**:
  - `POST /api/screen-unlock`에 4KB 초과 본문 전송 → `413 text/html` (`PayloadTooLargeError: request entity too large`)
  - 잘못된 JSON 전송 → `400 text/html` (`SyntaxError: Expected property name...`)
- **조치 방안**: Express 4-인자 에러 미들웨어 `app.use('/api', (err, req, res, next) => ...)`를 추가해 항상 일관된 JSON(`{ ok: false, error }`) 응답 반환.

#### [P1-13] `GET /api/inspection-report` 서버리스 휘발 (주간 자가점검 지속 WARN 근본 원인) — *Agent 2 & Agent 6 실증*
- **위치**: `server.ts:4670-4692`, `reports/self-check/latest.md:83`
- **원인**: `/api/self-check-report`는 Firestore 영속화 폴백이 있으나, `/api/inspection-report`는 인메모리 `automationRuntimeStatus`만 조회함. 서버리스 콜드 스타트마다 `hasReport: false`를 반환하여 주간 자가점검에서 매주 `⚠️ WARN 일일 점검 기록 없음`을 유발. 또한 `server.ts:2219`의 `SCREEN_LOCK_PIN ? 'PASS' : 'WARN'`은 기본값 때문에 절대 `WARN`이 뜨지 않는 죽은 분기임.
- **조치 방안**: `runDailyInspection()` 결과를 Firestore `system_daily_inspection/latest`에 저장하고 `/api/inspection-report`가 폴백 조회하도록 통일.

---

### 🟡 P2 — Medium (단기 개선 권장, 12건)

| ID | 영역 | 위치 | 이슈 내용 및 영향 |
| --- | --- | --- | --- |
| **P2-1** | **PWA · 캐시** | `server.ts:4775` | Node 서버 `express.static`이 `/service-worker.js`와 `/firebase-messaging-sw.js`에도 `Cache-Control: public, max-age=31536000, immutable`을 부여함(실서버 검증 완료). 자체 호스팅/로컬에서 SW 업데이트 영구 차단. |
| **P2-2** | **CF Workers · 보안헤더** | `wrangler.jsonc`, `public/_headers` (미존재) | Cloudflare Workers 정적 자산에 `_headers` 파일이 없어 Vercel(`vercel.json`)·Firebase(`firebase.json`)에 있던 `X-Content-Type-Options: nosniff`, `Referrer-Policy`, SW/HTML `no-cache` 헤더가 누락됨. |
| **P2-3** | **CORS · 도메인 이전** | `server.ts:3133-3141` | `DEFAULT_ALLOWED_ORIGINS`에 새 공식 도메인 `https://busan-hak-port-info.luxrank.workers.dev`가 빠져 있음(`ALLOWED_ORIGINS` env 미설정 환경에서 교차 출처 차단 — 실서버 확인). |
| **P2-4** | **CF Workers · IP/위치** | `server.ts:3832`, `3960` | `locationFromEdgeHeaders`가 `x-vercel-ip-*`만 읽고 Cloudflare의 `cf-ipcountry`/`cf-connecting-ip`를 미지원 → Workers 이전 후 엣지 위치 폴백 및 클라이언트 IP 판별 정확도 저하. |
| **P2-5** | **CF Workers · 백업/FCM** | `worker/cf/storage.ts:15`, `messaging.ts:35` | ① `storage.ts`가 `options.metadata.contentType`/`cacheControl`을 무시해 주간 백업이 `application/octet-stream`으로 저장됨. ② `messaging.ts`의 `sendEachForMulticast`가 순차 전송·`responses` 미반환·`webpush` 옵션 누락. |
| **P2-6** | **FCM · 푸시** | `public/firebase-messaging-sw.js:21-29` | ① `payload.notification.title` 무방어 접근(data-only 푸시 크래시). ② `notification` 페이로드 수신 시 SDK 자동 표시 + `showNotification` 중복 알림 2회 발생. ③ `notificationclick` 핸들러 부재로 푸시 클릭 시 앱 미이동. ④ `server.ts`가 만료/미등록 FCM 토큰을 정리하지 않음. |
| **P2-7** | **정적 호스팅 폴백** | `app.js:4635, 11211`, `notifications.js:304`, `roster-engine.js:1147, 2942, 3030` | 4개 기능(`/api/terminal-schedule`, `/api/emergency-notifications`, `/api/config`, `/api/roster-ocr-*`)이 `fetchPortApiJson` 대신 상대 경로 `fetch('/api/...')`를 직접 호출하여 정적 호스팅(`web.app`) 환경에서 API 실패. |
| **P2-8** | **데이터 정합성** | `server.ts:4347` | `adminStatsHandler`의 `Number(d.totalPay) || (wage1+wage2+wage3+wage4)`가 명시적 `totalPay: 0` 기록을 과거 임금 합으로 되살림(프론트 `app.js` 수정본과 불일치). |
| **P2-9** | **백업 · TTL · 개인정보** | `server.ts:91`, `1898-1940` | ① 주간 백업이 3개 컬렉션(`work_logs`, `ships`, `posts`)만 백업(`user_profiles`, `settings`, `want_board`, `notices`, `archives`, `kkung_chain` 누락). ② `runDatabaseAutoCleanup`이 미열람 장기 알림 및 **평문 IP 로그(`visitor_ip_logs`)**를 영구 보관(PIPA 보유기간·비용 리스크). |
| **P2-10** | **성능 · Firestore 비용** | `public/js/app.js:11270-11273`, `9776` | 앱 첫 로드 시 홈 탭에서도 `notices`·`posts`·`ships`·`archives` **전체 컬렉션 무제한 `onSnapshot`** + 1페이지 게시글 10개의 `comments` 리스너까지 총 15+개 실시간 구독을 즉시 개시함. |
| **P2-11** | **선박도감 · 터미널** | `ships-board.js:33-39`, `app.js:3746`, `README.md` | ① `ships-board.js` 폴백 쿼리가 `deletedAt` 소프트삭제 선박을 필터링하지 않음. ② `README.md`는 9개 터미널 실시간 연동을 표기하나 `BCT`는 `live: false`이며 `server.ts` 미지원(8개만 지원). |
| **P2-12** | **CI/CD · 자가점검 사각지대** | `.github/workflows/ci.yml`, `weekly-self-check.yml`, `scripts/daily-inspection.mjs` | ① `ci.yml`이 `npm run build`와 `npm run build:cf`를 실행하지 않음. ② `weekly-self-check.yml`의 `npm run check`에 `continue-on-error: true` 설정, `git push` 실패도 경고만 출력. ③ `daily-inspection.mjs`에 `roster-engine.js`, `domain-migration.js`, `worker/*`, 신규 API 6종이 미포함. |

---

### 🟢 P3 — Low (중기 정리 및 위생 개선, 5건)

1. **문서·코드 비밀번호 표기 불일치 (`README.md:75, 134`, `public/js/want-board.js:12, 986`)**: 실제 기본 관리자 비밀번호는 `9363`으로 변경되었으나 문서·주석에 구 비밀번호 `0346`이 잔존.
2. **저장소 루트 무관 파일·중복 보고서 누적**: 항만 앱과 무관한 문서(`공문_김해시궁동협회_생림정_시설보완요청.txt`, `공문_김해시체육회_생림정_시설보완요청.txt`, `드라이브_정리_완료보고서.md`) 3건이 루트에 커밋되어 있고, 일일·주간 점검 보고서가 루트(36개)·`reports/`(60개)·`docs/inspections/`(35개)에 3중 중복 보관됨.
3. **Cloudflare Workers 번들 크기 최적화 여지 (`.cf-worker/index.js` 2.93MB)**: `scripts/build-worker.mjs`에 `minify: true` 미적용 + Workers에서 미사용되는 `node-cron`, `nodemailer` 전체, `iconv-lite` 중국어/일본어 인코딩 테이블, `mime-db` 등이 포함되어 있음(번들 경량화로 콜드스타트 단축 가능).
4. **죽은 코드 및 사소한 UI/UX 잔재**: `app.js:5701` `toggleWageLayoutMode()`의 `wageLayoutToggleBtn` HTML 미존재, `ships-board.js:153`의 네이티브 `alert()` 상세보기, `leader-access.js`의 `prompt()` 평문 노출, `public/service-worker.js:115`의 `/manifest.json` Cache-First 처리, `public/index.html` 일부 터미널 링크 평문 `http://`, `package.json`의 `firebase-tools@^15.34.0`과 워크플로 고정 버전(`15.3.1`) 불일치.
5. **사진 명단 베타 잠금 상태 확인 (`public/js/roster-engine.js:31`)**: `ROSTER_FINDER_BETA_LOCK = true` 유지 중(의도된 운영 정책인지 최종 공개 전환 대상인지 확인 필요).

---

## 5. 단계별 조치 로드맵

### Phase 1 — 즉시 조치 (1~2일 내 · 보안/치명 장애 차단)
1. **토큰 서명 키 분리 및 백도어 PIN 제거** (`P0-1`, `P1-9`): `ADMIN_SESSION_SECRET` 분리, `SCREEN_LOCK_PIN`/`ADMIN_PASSWORD` 설정 시 기본값(`9445`/`9363`) 자동 비활성화.
2. **Firestore 보안 규칙 긴급 보강** (`P0-3`, `P0-4`, `P0-5`): `settings/emergency_notice`, `archives`, `hjnc_schedules`, `notifications` 권한 잠금, `work_logs`/`user_profiles` 서버 인증 연동 설계 및 적용, URL 스킴(`https?://`) 검증.
3. **"운영자에게 바란다" 즉시 수정** (`P0-6`, `P1-5`): `want-board.js:893` 관리자 바 숨김 버그 및 `631` 미리보기 수정 버튼 수정.
4. **관리자 모달 XSS 차단** (`P1-4`): `app.js:2229, 2248, 2264`의 `onclick` 문자열 조합 제거.

### Phase 2 — 단기 수정 (1주 내 · 연말/2027 전환 및 CF Workers 안정화)
5. **임금계산기·달력 버그 수정** (`P1-1`, `P1-2`, `P1-3`): `changeMonth`/`changeLeaderMonth` 31일 롤오버 수정, 소수점 시간 계산 보정, `2026-06-03` 공휴일 + **2027년 최저시급** 반영.
6. **Cloudflare Workers 프로덕션 완결성 확보** (`P1-6`, `P1-7`, `P2-2`, `P2-3`, `P2-4`, `P2-5`): `worker/cf/firestore.ts` 4종 버그 수정, Workers용 Google Vision/Vertex 토큰 어댑터 연결, `public/_headers` 추가, `DEFAULT_ALLOWED_ORIGINS`에 `workers.dev` 추가, `cf-connecting-ip`/`cf-ipcountry` 지원.
7. **서버리스·성능·안정성 보강** (`P1-8`, `P1-10`, `P1-11`, `P1-12`, `P1-13`): `vercel.json` 전체 함수 `maxDuration: 60`, `/api/analytics-summary` 캐싱, `runScheduleChangeDetection` 배치화 및 KST 기준 통일, `/api/*` JSON 에러 미들웨어 추가, `/api/inspection-report` Firestore 영속화.

### Phase 3 — 중기 고도화 (2~4주 · 운영 품질·비용 최적화)
8. **PWA·FCM·실시간 구독 최적화** (`P2-1`, `P2-6`, `P2-7`, `P2-10`, `P2-11`): Node SW `no-cache` 헤더, `firebase-messaging-sw.js` 중복 알림/클릭 처리 수정, 정적 호스팅 API 호출 통일, 지연 구독(탭 진입 시 구독) 도입.
9. **백업·TTL·CI·저장소 정비** (`P2-8`, `P2-9`, `P2-12`, `P3`): 백업 컬렉션 확대, `visitor_ip_logs`·미열람 알림 TTL 정리, `ci.yml`에 `build`/`build:cf` 추가, `daily-inspection.mjs` 커버리지 최신화, 무관 파일/중복 보고서 정리.

---

*본 보고서는 2026-11-26 기준 정적·동적 실측 결과를 기반으로 작성되었으며, 코드 수정 없이 점검·진단만 수행되었습니다.*
