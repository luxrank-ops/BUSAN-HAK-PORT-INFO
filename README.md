# BUSAN HAK PORT INFO (BUSAN-HAK-PORT-INFO)

부산항 신항·북항 현장 근로자를 위한 스마트 작업 가이드 플랫폼 (v2027 에디션)입니다.

## 프로젝트 개요

이 프로젝트는 항만 근로자들이 실무에서 자주 필요한 정보를 빠르게 확인하고, 정밀한 임금 계산 및 근무일지 정산을 한곳에서 관리할 수 있도록 구성된 스마트 웹 애플리케이션입니다.

### 🚀 v2027 주요 기능 및 오늘 업데이트 내역:
- **⭐ 내 단골 터미널 빠른 실행 바**: 1·2·3항업 9개 터미널 즐겨찾기 고정 및 스케줄·차트·현황·베이플랜·셔틀·식단 1초 실행
- **🧮 정밀 임금 계산기 & 근무일지 원클릭 전송**: 주·야간 자동 분리, 2026~2027년 공휴일 반영, `[📐 입력창 넓게 보기]` 전환 및 계산 결과 근무일지 자동 입력
- **🎯 근무일지 목표 수입 달성률 게이지 바 & 동료 자동완성 칩**: 월 목표 금액 설정, 실시간 달성률(%) 게이지, 자주 쓰는 동료 이름 원클릭 입력 칩 (선박명은 터미널별 입항·접안 선박 칩으로 입력)
- **📊 D3.js 월별 수입·근로일수 그래프 & 연간 종합 정산 보고서**: 기간·키워드 검색, 분기별 실적, 주요 선박·동료 TOP 3, 보고서 복사 및 명세서 이미지(PNG) 저장·카톡 공유 (`9445` 보안 잠금)
- **🚢 선박 도감 난이도 별점(★1~5) & 장비 태그 필터 + 전체 선박 목록 뷰**: `#오토콘`, `#수동콘`, `#브릿지주의` 등 장비 태그 필터링 및 상단 고정 헤더·줄무늬 컴팩트 전체 목록 테이블 (`#vessel-result-container`, `9445` 보안 잠금), 신규 선박 등록 시 날짜·터미널별 입항 선박 원클릭 자동입력 탑재
- **⚓ 9개 터미널 선석배정 스케줄 연동**: 근무일지 및 선박정보 신규등록 시 날짜·터미널(한진 HJNC, 동원 DGT, 고려 BNCT, BCT, PNC, HPNT, PNIT, BPTC, HBCT)별 실시간 입항·접안 선박 칩 조회 및 원클릭 자동입력
- **🛡️ 보안 강화 & 정밀 방문자 통계**: Firebase 익명 인증 자동 연결, 관리자 UID·이메일 화이트리스트 + SHA-256 단방향 해시 검증, 전 컬렉션 비밀번호 SHA-256 해시 암호화, 자정 경계(`dateKey`) 분리 및 `localStorage` 기반 일일 순 방문자(Unique)·재방문율 KPI 통계
- **🌬️ 부산항 실시간 기상 · 작업 안전 전광판**: 부산 신항·북항 실시간 기온·체감온도·풍속(m/s)·강수량 및 강풍 작업 통제 안내
- **🎨 전체 화면 디자인 대개편 & 야간(다크) 모드**: 항업별 맞춤 그라데이션 배너, 카드별 실시간 데이터 건수 요약, 달력 '오늘' 배지 및 만 원 단위 수입 요약 칩
- **운영관리자**: 이춘학 (문의: `luxrank@gmail.com` / `010-2846-8906`)

## 배포 상태

공개 URL:

| 구분 | URL | 배포 방식 | 상태 (2026-10-06 기준) |
| --- | --- | --- | --- |
| **운영 (1차)** | https://busan-hak-port-info.vercel.app | Vercel — GitHub `main` 브랜치 머지 시 **자동 프로덕션 배포** | ✅ 최신(v2027) 서비스 중. 현장 사용자 기준 운영 주소 |
| 레거시 (보조) | https://busan-hak-port.web.app | Firebase Hosting — 승인형 GitHub Actions 워크플로 | ⚠️ v2026 구버전 게시 중. 원본 프로젝트 배포 키 미등록으로 갱신 중단 (아래 "승인형 Firebase 배포" 참고) |

> ⚠️ **데이터 저장소 유의**: 호스팅 위치와 무관하게 앱의 모든 Firestore·Storage 데이터(공지사항·공지 이미지, 근무일지, 게시판, 선박정보, 방문 통계)는 Firebase 프로젝트 **`busan-hak-port`**(프로젝트 번호 `616469111502`)에 저장됩니다. 이 프로젝트는 운영 데이터의 심장이므로 **삭제·보관 정지하면 안 됩니다.** 프로젝트 접근이 안 되는 계정(luxrank75@gmail.com 등)에서는 보이지 않을 수 있으며, 원본 소유 Google 계정에서의 접근 복구가 선행되어야 합니다.

## 기술 스택

- Frontend: HTML5, CSS3, Vanilla JavaScript (ES2022+), D3.js v7
- Backend Proxy: Node.js, Express (`server.ts` — 터미널 실시간 선석배정 수집 및 인메모리 캐싱)
- Cloud & BaaS: Firebase Hosting, Firebase Authentication (Anonymous & Admin Auth), Cloud Firestore (`firestore.rules`), Firebase Storage

## 프로젝트 구조

```text
BUSAN-HAK-PORT-INFO/
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── manifest.json
│   ├── service-worker.js
│   ├── favicon.ico
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── robots.txt
│   ├── sitemap.xml
│   └── ads.txt
├── server.ts
├── firestore.rules
├── firebase-blueprint.json
├── firebase.json
├── package.json
└── README.md
```

## 로컬 실행

Node.js Express 서버(`server.ts`)를 통해 정적 파일 서빙과 실시간 터미널 선석 스케줄 API(`/api/terminal-schedule`, `/api/hjnc-schedule`)를 함께 실행할 수 있습니다.

```bash
npm install
npm run dev
```

그다음 브라우저에서 아래 주소로 접속합니다.

```text
http://localhost:3000
```

## 검사 및 빌드

```bash
npm ci
npm run check
```

`npm run check`는 TypeScript 타입, 필수 배포 파일, JSON 형식, HTML 문서 및 인라인 JavaScript 문법을 검사합니다. 추가로 `.github/workflows/*.yml`의 YAML 문법과, Firebase 배포 시크릿을 참조하는 작업들의 `environment` 범위 일치 여부를 검사합니다. Pull Request와 `main`/`arena/**` 브랜치 푸시에서도 동일한 검사가 자동 실행됩니다.

## 승인형 Firebase 배포

> **2026-10-06 상태 안내**: 현재 등록된 서비스 계정 키가 **다른 프로젝트(`busan-hak-port-paid-2026`) 소속**이라 실제 배포 대상인 `busan-hak-port` 프로젝트를 배포할 권한이 없어, 최근 실행들이 "Failed to get Firebase project" 오류로 실패했습니다. 워크플로우를 개선하여, 이제는 배포용 시크릿이 없거나 **다른 프로젝트의 키인 경우에도** 실패(빨간 X) 대신 안내와 함께 실행을 건너뜁니다. 원본 프로젝트 소속 서비스 계정 키를 아래 방법으로 등록하면 다시 배포됩니다.
>
> ⚠️ 키 발급 시 프로젝트를 반드시 **`busan-hak-port`** 로 선택하세요. 이름이 비슷한 `busan-hak-port-paid-2026` 프로젝트의 키(`firebase-adminsdk-fbsvc@busan-hak-port-paid-2026.iam.gserviceaccount.com`)로는 배포할 수 없습니다.

운영 배포는 GitHub에 코드를 푸시하는 것만으로는 실행되지 않습니다. GitHub Actions의 **Firebase 운영 배포** 워크플로를 수동 실행하고, 질문 **“배포하시겠습니까?”**에 **“예”**를 선택한 경우에만 다음 순서로 배포됩니다.

1. 배포용 서비스 계정 시크릿 존재·`project_id` 확인 (없거나 다른 프로젝트 키면 배포 대신 안내 후 건너뜀)
2. `main` 브랜치인지 확인
3. 의존성 설치
4. 타입 및 정적 파일 최종 검사
5. Google Cloud 서비스 계정 인증
6. Firebase Hosting 운영 배포

“아니요”를 선택하면 배포 명령은 실행되지 않습니다. 동시에 두 운영 배포가 실행되지 않도록 동시 실행도 제한합니다.

### 최초 1회 필요한 GitHub Secret

다음 이름으로 Firebase 배포용 서비스 계정 JSON을 등록해야 합니다.

```text
FIREBASE_SERVICE_ACCOUNT_BUSAN_HAK_PORT
```

**저장소 시크릿 한 곳에만 등록하는 것을 권장합니다** (Settings → Secrets and variables → Actions → *Repository secrets*).

`Production` 환경 시크릿으로도 동작합니다. 자격 확인 작업과 배포 작업이 모두 `Production` 환경을 지정해 **동일한 범위**를 읽기 때문입니다. 다만 두 곳에 서로 다른 값을 등록하면 `Production` 환경 값이 우선 적용되어 저장소에 넣은 값은 무시되므로, 혼선을 막으려면 한 곳에만 두세요.

> 자격 확인 작업에 `environment: Production`이 없던 시절에는 저장소 시크릿만 읽혔습니다. 그 상태에서 시크릿을 `Production` 환경에만 등록하면 자격 확인은 "없음"으로 판정되어 **배포가 아무 안내 없이 건너뛰어집니다.** `npm run check`가 이 범위 불일치를 검사하므로 재발을 막습니다.

등록 후 워크플로를 다시 실행하면 자격 확인 단계가 키의 `project_id`가 `busan-hak-port`인지 확인합니다. 다른 프로젝트 키(예: `busan-hak-port-paid-2026`)이면 `"Failed to get Firebase project"` 오류로 실패하기 전에 안내와 함께 건너뜁니다.

서비스 계정 키는 저장소 파일이나 채팅에 올리지 말고 GitHub의 암호화된 Secret에만 저장합니다. 운영 URL은 `https://busan-hak-port.web.app`입니다.

> `server.ts`의 터미널 일정 API는 로컬 Express 실행용입니다. 현재 Firebase Hosting 워크플로는 `public/` 정적 파일만 배포하며 서버 프로세스는 배포하지 않습니다. 운영 화면은 API 응답이 JSON일 때만 해당 응답을 사용하고, 그 외에는 Firestore 캐시를 사용합니다.

## 참고

- 본 사이트는 항만 현장 근로자용 업무 보조 도구를 목적으로 구성되었습니다.
- 일부 기능은 Firebase Firestore 및 Storage를 사용하므로 실제 동작을 위해 Firebase 프로젝트 설정이 필요합니다.
- 관리자 기능, 게시글, 근무일지, 자료실 업로드는 Firestore 기반으로 동작합니다.

## 연락처
- 이름 : 이춘학
- 이메일: luxrank@gmail.com
- 문자: 010-2846-8906

## 라이선스

해당 프로젝트는 개인 운영 목적의 포트폴리오 및 현장 업무 보조 서비스를 위해 제작되었습니다.
