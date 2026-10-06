# Firebase Hosting 배포 재개를 위한 서비스 계정 키 등록 안내

> 이 문서는 **저장소 관리자(GitHub `luxrank-ops` 계정 소유자)만 수행할 수 있는 작업**을 정리한 것입니다.
> 자동화 환경(Arena 세션)의 토큰은 GitHub Actions 시크릿을 읽거나 쓸 수 없어(`X-OAuth-Scopes` 비어 있음, 시크릿 API 403) 이 절차를 대신 실행할 수 없습니다.

## 1. 현재 상태 (2026-10-06 기준 확인)

| 항목 | 값 | 확인 방법 |
| --- | --- | --- |
| 운영 사이트 (1차) | `https://busan-hak-port-info.vercel.app` — 정상 | Vercel 프로덕션 배포 `state=success` |
| Firebase Hosting (보조) | `https://busan-hak-port.web.app` — v2026 구버전 정체 | 아래 사유로 배포 중단 |
| 배포 실패 원인 | 서비스 계정 키가 **`busan-hak-port-paid-2026`** 프로젝트 소속 | 런 `37482447262` 등 3회 실패, `"Failed to get Firebase project"` |
| 배포 대상 프로젝트 | `busan-hak-port` (`.firebaserc`의 `projects.default`) | 저장소 파일 확인 |
| Hosting 공개 폴더 | `public` (`firebase.json`의 `hosting.public`) | 저장소 파일 확인 |

**운영 사이트는 영향이 없습니다.** `busan-hak-port-info.vercel.app`은 GitHub `main` 머지 시 Vercel이 자동 배포하며, 이 문서의 작업과 무관합니다. 이 작업은 보조 채널인 `busan-hak-port.web.app`을 다시 갱신 가능하게 만드는 것이 목적입니다.

## 2. 서비스 계정 키 발급

1. <https://console.cloud.google.com/iam-admin/serviceaccounts?project=busan-hak-port> 접속
2. **프로젝트 선택기가 `busan-hak-port`인지 반드시 확인**합니다.
   - ⚠️ 이름이 비슷한 `busan-hak-port-paid-2026`은 배포 대상이 아닙니다. 그 프로젝트의 키(`firebase-adminsdk-fbsvc@busan-hak-port-paid-2026.iam.gserviceaccount.com`)로는 배포할 수 없습니다.
3. 기존 서비스 계정을 선택하거나 새로 만들고 **Keys → Add Key → Create new key → JSON**으로 발급합니다.
4. 역할은 Firebase Hosting 배포가 가능해야 합니다 (`Firebase Admin` 또는 `Editor`).
5. 발급된 JSON의 `"project_id"` 값이 **`busan-hak-port`** 인지 메모장 등에서 확인합니다.
   - 워크플로 자격 확인 단계가 이 값을 검사하므로, 다르면 배포가 건너뛰어집니다.

## 3. GitHub Secret 등록

**저장소 시크릿 한 곳에만 등록하는 것을 권장합니다.**

1. <https://github.com/luxrank-ops/BUSAN-HAK-PORT-INFO/settings/secrets/actions> 접속
2. **Repository secrets** 탭 → **New repository secret**
3. Name: `FIREBASE_SERVICE_ACCOUNT_BUSAN_HAK_PORT`
4. Secret: 발급된 JSON 파일 **전체 내용**을 붙여넣기
5. Add secret

### 등록 위치 주의

`Production` **환경** 시크릿으로도 동작합니다. 자격 확인 작업(`credentials`)과 배포 작업(`deploy`)이 모두 `environment: Production`을 지정해 동일한 범위를 읽기 때문입니다.

다만 **두 곳에 서로 다른 값을 등록하면 `Production` 환경 값이 우선**되어 저장소에 넣은 값은 무시됩니다. 혼선을 막으려면 한 곳에만 등록하세요.

> 과거 버그 기록: 자격 확인 작업에 `environment: Production`이 없던 시절에는 저장소 시크릿만 읽혔습니다. 그 상태에서 시크릿을 `Production` 환경에만 등록하면 자격 확인이 "없음"으로 판정해 **배포가 조용히 건너뛰어졌습니다.** 현재는 `npm run check`가 이 범위 불일치를 검사합니다.

### 보안

- 서비스 계정 키는 **저장소 파일, 이슈, PR, 채팅에 절대 올리지 마세요.** GitHub의 암호화된 Secret에만 저장합니다.
- 이 안내를 도와주는 도구에도 키 내용을 붙여넣지 마세요. 등록은 GitHub 웹 UI에서 직접 합니다.

## 4. 배포 실행 및 확인

1. <https://github.com/luxrank-ops/BUSAN-HAK-PORT-INFO/actions/workflows/deploy-firebase.yml> → **Run workflow**
2. 브랜치 `main`, 질문 **"배포하시겠습니까?"** → **"예"** 선택 후 실행
3. `배포 자격 확인` 작업 로그에서 다음 문구를 확인합니다:
   - 성공: `배포용 서비스 계정 시크릿이 등록되어 있고 project_id가 "busan-hak-port"로 일치합니다.`
   - 키 없음: `배포용 서비스 계정 시크릿(...)이 등록되어 있지 않습니다.`
   - 다른 프로젝트: `시크릿의 project_id가 "..." 입니다. 배포 대상인 "busan-hak-port"가 아닙니다.`
4. `승인 후 Firebase Hosting 배포` 작업이 끝나면 <https://busan-hak-port.web.app> 에서 버전이 갱신됐는지 확인합니다.

## 5. 데이터 저장소 유의 (변경 금지)

호스팅 위치와 무관하게 앱의 모든 Firestore·Storage 데이터(공지사항·공지 이미지, 근무일지, 게시판, 선박정보, 방문 통계)는 Firebase 프로젝트 **`busan-hak-port`**(프로젝트 번호 `616469111502`)에 저장됩니다.

이 프로젝트는 운영 데이터의 심장이므로 **삭제하거나 보관 정지하면 안 됩니다.** Vercel로 호스팅을 옮긴 뒤에도 데이터는 이 프로젝트에 남아 있어야 합니다.
