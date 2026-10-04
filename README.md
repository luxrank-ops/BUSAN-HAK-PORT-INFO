# BUSAN HAK PORT INFO (BUSAN-HAK-PORT-INFO-SE)

부산항 신항·북항 현장 근로자를 위한 스마트 작업 가이드 플랫폼 (v2027 에디션)입니다.

## 프로젝트 개요

이 프로젝트는 항만 근로자들이 실무에서 자주 필요한 정보를 빠르게 확인하고, 정밀한 임금 계산 및 근무일지 정산을 한곳에서 관리할 수 있도록 구성된 스마트 웹 애플리케이션입니다.

### 🚀 v2027 주요 기능 및 오늘 업데이트 내역:
- **⭐ 내 단골 터미널 빠른 실행 바**: 1·2·3항업 9개 터미널 즐겨찾기 고정 및 스케줄·차트·현황·베이플랜·셔틀·식단 1초 실행
- **🧮 정밀 임금 계산기 & 근무일지 원클릭 전송**: 주·야간 자동 분리, 2026~2027년 공휴일 반영, `[📐 입력창 넓게 보기]` 전환 및 계산 결과 근무일지 자동 입력
- **🎯 근무일지 목표 수입 달성률 게이지 바 & 자동완성 칩**: 월 목표 금액 설정, 실시간 달성률(%) 게이지, 자주 쓰는 선박명·동료 이름 원클릭 입력 칩
- **📊 D3.js 월별 수입·근로일수 그래프 & 연간 종합 정산 보고서**: 기간·키워드 검색, 분기별 실적, 주요 선박·동료 TOP 3, 보고서 복사 및 명세서 이미지(PNG) 저장·카톡 공유 (`9445` 보안 잠금)
- **🚢 선박 도감 난이도 별점(★1~5) & 장비 태그 필터 + 전체 선박 목록 뷰**: `#오토콘`, `#수동콘`, `#브릿지주의` 등 장비 태그 필터링 및 상단 고정 헤더·줄무늬 컴팩트 전체 목록 테이블 (`#vessel-result-container`, `9445` 보안 잠금)
- **🌬️ 부산항 실시간 기상 · 작업 안전 전광판**: 부산 신항·북항 실시간 기온·체감온도·풍속(m/s)·강수량 및 강풍 작업 통제 안내
- **🎨 전체 화면 디자인 대개편 & 야간(다크) 모드**: 항업별 맞춤 그라데이션 배너, 카드별 실시간 데이터 건수 요약, 달력 '오늘' 배지 및 만 원 단위 수입 요약 칩
- **운영관리자**: 이춘학 (문의: `luxrank@gmail.com` / `010-2846-8906`)

## 배포 상태

공개 URL:
- https://busan-hak-port.web.app

## 기술 스택

- HTML
- CSS
- JavaScript
- Firebase Hosting
- Firebase Firestore
- Firebase Storage

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
│   ├── ads.txt
│   └── temp.txt
├── firebase.json
├── README.md
└── .git/
```

## 로컬 실행

정적 페이지이므로 간단하게 로컬 서버로 확인할 수 있습니다.

### Python로 실행

```bash
cd BUSAN-HAK-PORT-INFO
python -m http.server 8000
```

그다음 브라우저에서 아래 주소로 접속합니다.

```text
http://localhost:8000/public/index.html
```

## Firebase 배포

Firebase CLI가 설치되어 있다고 가정하면 아래 명령으로 배포할 수 있습니다.

```bash
firebase deploy --only hosting --project busan-hak-port
```

## 참고

- 본 사이트는 항만 현장 근로자용 업무 보조 도구를 목적으로 구성되었습니다.
- 일부 기능은 Firebase Firestore 및 Storage를 사용하므로 실제 동작을 위해 Firebase 프로젝트 설정이 필요합니다.
- 관리자 기능, 게시글, 근무일지, 자료실 업로드는 Firestore 기반으로 동작합니다.

## 연락처

- 이메일: luxrank@gmail.com
- 문자: 010-2846-8906

## 라이선스

해당 프로젝트는 개인 운영 목적의 포트폴리오 및 현장 업무 보조 서비스를 위해 제작되었습니다.
