# BUSAN HAK PORT INFO

부산항 신항·북항 현장 근로자를 위한 스마트 작업 가이드 웹사이트입니다.

## 프로젝트 개요

이 프로젝트는 항만 근로자들이 실무에서 자주 필요한 정보를 빠르게 확인할 수 있도록 구성된 정적 웹 애플리케이션입니다.

주요 기능:
- 임금 계산기
- 근무일지 관리
- 항만/터미널별 정보 안내
- 안전 가이드
- 공지사항 및 커뮤니티 게시판
- 자료실 업로드
- 선박 정보 관리
- Firebase 연동 데이터 저장

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
