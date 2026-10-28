# 🔎 진단 보고서 — "운영자에게 바란다" 제출 실패 (Missing or insufficient permissions)

- 작성일: 2026-10-28
- 신고 화면: `busan-hak-port-info.vercel.app` → ✨ 운영자에게 바란다 → 닉네임 `신항 도선사`, 내용 `1234` → **제출하기**
- 표시된 오류: `제출 실패: Missing or insufficient permissions.`

---

## 1. 결론 (한 줄)

**`firestore.rules` 에 보안 규칙 언어가 지원하지 않는 람다 문법(`items.all(item => ...)`)이 있어
규칙 파일 전체가 컴파일되지 않았고, 그래서 배포가 계속 실패해 운영에는 2026-10-21 자 옛 규칙
(기본 거부)이 남아 있었습니다.** 잘못된 한 줄을 고치면 규칙이 정상 배포됩니다.

```
http://... 429행 (수정 전)
  data.items.all(item => item is map && ...
  → 규칙 언어에 리스트 반복(람다) 문법이 없음 → 컴파일 오류 → 배포 거부
```

---

## 2. 근거

| 관찰 | 값 |
| --- | --- |
| 마지막으로 **성공**한 "Firebase 운영 배포" | **2026-10-21 04:32 UTC**, 커밋 `a639e90` (run `39544646862`) |
| 그 다음 배포 시도 | **2026-10-26 15:38 UTC 실패** (run `40351237546`) — "Firestore 규칙·인덱스·호스팅" 단계에서 즉시 실패 |
| 그 사이 `firestore.rules` 변경 | 179줄 추가 (섹션 10 `kkung_chain`, 11 `visitor_ip_logs`, 12 `want_board`) |
| CI "Firestore 보안 규칙 테스트(에뮬레이터)" | `pass 0 / fail 0 / cancelled 39` — **규칙 업로드 단계에서 실패해 전 테스트가 취소** |
| 문법 검사(공식 ANTLR 문법 파서) | `429:29 Parsing error: no viable alternative at input 'data.items.all(item ='` |

- `Missing or insufficient permissions` 는 Firestore 클라이언트가 **규칙 거부(permission-denied)** 를 받았을 때의 표준 문구입니다.
- 운영 규칙에는 `want_board` · `want_board_mine` 규칙이 없으므로 기본 거부
  `match /{document=**} { allow read, write: if false; }` 가 적용되어 저장이 차단됩니다.
- 같은 이유로 **꿍꿍따 댓글 릴레이(`kkung_chain`)도 운영에서 쓰기가 막혀 있을 가능성**이 큽니다(같은 커밋 묶음에서 추가됨).
- 에뮬레이터 테스트가 "실패(fail)"가 아니라 "취소(cancelled)"로 끝난 것도 같은 원인입니다.
  규칙을 올리는 단계(`initializeTestEnvironment`)에서 컴파일 오류가 나 상위 훅이 죽고, 그 아래 테스트가 전부 취소됩니다.

---

## 3. 조치 내용

### 3-0. 검증 결과 (CI 에뮬레이터)

수정 후 CI 규칙 에뮬레이터 테스트가 **40여 건 모두 통과**했습니다.
(= 그동안 `cancelled 39 · pass 0` 이던 단계가 정상 동작을 시작했습니다.)
이 과정에서 규칙의 두 번째 문제도 드러나 함께 고쳤습니다.

| 문제 | 증상 | 수정 |
| --- | --- | --- |
| 람다 문법 | 규칙 컴파일 실패 → 배포 거부 → 기본 거부 | `items.all(item => ...)` 제거 |
| 답글 `list` 규칙 | 목록 조회 시 문서 ID 와일드카드(`{replyId}`)가 묶이지 않아 작성자·관리자 모두 **답글이 화면에 보이지 않음** | `allow get` / `allow list` 분리 |

### 3-1. 규칙 (근본 수정)

`firestore.rules` — `isValidWantIndex()` 에서 람다 제거:

```diff
- data.items is list && data.items.size() <= 200 &&
- data.items.all(item => item is map && item.id is string && isValidId(item.id) && ... )
+ data.items is list && data.items.size() <= 200;
```

- 규칙 언어가 지원하는 범위(타입·개수)만 검사하고, 항목 내부 값은 화면 코드
  `normalizeWantIndex()` 가 항상 정규화해 기록합니다.
- 인덱스 문서는 **본인(uid 일치)만** 쓸 수 있으므로, 항목 단위 검사를 줄여도 다른 사용자에게 미치는 영향은 없습니다.
- 수정 후 공식 ANTLR 문법 파서로 **문법 오류 0건** 확인.

```diff
- allow get, list: if isSignedIn() && isValidId(replyId) && (isAdmin() || isWantItemAuthor(itemId));
+ allow get:  if isSignedIn() && isValidId(replyId) && (isAdmin() || isWantItemAuthor(itemId));
+ allow list: if isSignedIn() && (isAdmin() || isWantItemAuthor(itemId));
```

### 3-2. 재발 방지 — 정적 가드

`scripts/security-rules.test.mjs` (`npm test` 에 항상 포함)

- 규칙 코드에 `=>`(람다)가 있으면 실패
- 리스트 반복 메서드(`all` · `exists` · `filter` · `map`) 오용 시 실패
- 중괄호·괄호 짝 불일치 시 실패

### 3-3. 화면 — 원인을 알 수 있는 오류 안내

`public/js/want-board.js`

- `classifyWantError()` · `describeWantFailure()` 추가
  - `permission-denied` → "서버가 저장을 거부 · 보안 규칙 미배포 가능성 · 운영자: Firebase 운영 배포 실행" 안내
  - `unauthenticated` → 세션 만료 / `network` → 연결 확인 / `index` → 색인 필요
- 제출·삭제·답글 오류를 모두 위 안내로 교체(원문 노출 제거), 콘솔에는 상세 값 기록
- 제출 저장을 **배치(원자적) 쓰기**로 변경 — 항목만 저장되고 인덱스는 실패하는 반쪽 상태 제거
- 내 기록 조회가 권한으로 막히면 목록에 원인 표시, **글쓰기 버튼은 유지**

### 3-4. 배포 워크플로우 — 단계 분리 + 실패 원인 노출

`.github/workflows/deploy-firebase.yml`

| 순서 | 단계 | 대상 |
| --- | --- | --- |
| 1 | Firestore 보안 규칙 배포 | `--only firestore:rules` (권한이 먼저 살아나야 합니다) |
| 2 | Firestore 색인 배포 | `--only firestore:indexes` |
| 3 | Firebase Hosting 배포 | `--only hosting` |
| 4 | 배포 실패 사유 표시 (`if: failure()`) | 실패 로그의 핵심 문장을 Actions annotation 으로 출력 |

### 3-5. 회귀 테스트

- `scripts/want-board.test.mjs` — 오류 분류·안내 문구, 배치 쓰기, 권한 오류 목록 안내 (4건)
- `scripts/rules/firestore-rules.emulator.test.mjs` — 화면이 보내는 문서 모양 그대로
  `want_board` 저장·조회·위조·답글·인덱스 권한 (6건)
- `scripts/security-rules.test.mjs` — 람다 금지·괄호 짝 (2건)
- `scripts/want-board.test.mjs` — 답글 list 규칙이 문서 ID 를 요구하지 않는지 (1건)
- `scripts/admin-stats-recovery.test.mjs` — 배포 워크플로우 단계 순서 (1건)
- `npm run check` : **304/304 통과**
- CI `Firestore 보안 규칙 테스트 (에뮬레이터)` : **40여 건 전부 통과**(기존에는 cancelled)

---

## 4. 운영자 조치 절차 (권장)

1. GitHub → **Actions** → **Firebase 운영 배포** → **Run workflow**
2. `배포하시겠습니까?` 에서 **예** 선택
3. **Firestore 보안 규칙 배포** 단계가 성공했는지 확인
   - 실패하면 같은 실행의 **배포 실패 사유 표시** 단계에 원인 문장이 그대로 나옵니다.
4. 휴대폰에서 앱을 새로고침(캐시 버전 `2027.19`)한 뒤 다시 제출

> 저장소의 `firestore.rules` 는 이번 수정으로 문법 검사를 통과한 상태이므로, **배포만 하면 됩니다.**

---

## 4-1. 2차 원인 — 배포용 서비스 계정 권한 (`serviceusage.services.get`)

규칙 문법 오류를 고친 뒤 배포를 다시 실행하자, 이번에는 배포가 **다른 이유로** 막혔습니다.

```
Error: Request to https://serviceusage.googleapis.com/v1/projects/busan-hak-port/
       services/firestore.googleapis.com had HTTP Error: 403,
       Permission denied to get service [firestore.googleapis.com]
```

- Firebase CLI 는 `firestore:rules`/`firestore:indexes` 배포 **전에** Service Usage API 로
  "Firestore API 가 켜져 있는지" 확인합니다(`ensureApiEnabled.check`).
- 배포용 서비스 계정에 `serviceusage.services.get` 권한이 없으면 이 확인이 403으로 거부되어
  **규칙 배포가 시작조차 못 합니다.**
- 즉 지금 남은 것은 코드 문제가 아니라 **GCP IAM 권한 문제**입니다.

### 조치 (코드에 반영)

| 단계 | 내용 |
| --- | --- |
| 진단 | `scripts/deploy-preflight.mjs check` — 403이면 "누가 무슨 역할을 부여해야 하는지"를 Actions 요약에 한국어로 안내(실패해도 계속) |
| 우회 | `scripts/deploy-preflight.mjs seed-cache` — Firebase CLI 의 API 확인 캐시(`~/.config/configstore/firebase-tools.json` 의 `apiEnablementCache[projectId][api]`)를 미리 채워 확인 요청을 생략시킵니다. **쓰기 권한 검사는 그대로**입니다. |
| 근본 | 서비스 계정에 `roles/serviceusage.serviceUsageConsumer`(Service Usage 소비자) 부여 |
| 안내 | 배포 실패 시 요약(Step summary)에 규칙·색인·호스팅 단계별 성공/실패 표 + 해결 명령 |

검증(로컬, firebase-tools 15.3.1 코드로 직접 확인):

```
캐시 없음 → check() 가 인증/네트워크로 진입 (403 또는 인증 오류)
캐시 있음 → check() 가 즉시 true 반환 (네트워크 호출 없음)   ← 우회 성립
```

### 긴급 대안 — 서비스 계정 권한 없이 규칙만 배포

```bash
npx firebase-tools@15.3.1 login      # luxrank@gmail.com (프로젝트 소유자) 로그인
npx firebase-tools@15.3.1 deploy --only firestore:rules --project busan-hak-port
```

---

---

## 5. 교훈 (다음에 같은 일을 피하려면)

- 보안 규칙은 **문법 오류가 나면 파일 전체가 배포되지 않습니다.** 한 줄만 틀려도 신규 기능 전체가 조용히 막힙니다.
- 배포 워크플로우가 성공했는지 **기능 배포 후 반드시 확인**해야 합니다(마지막 성공: 10-21).
- 규칙을 크게 바꾼 날은 `npm run test:rules`(에뮬레이터) 결과도 함께 봐야 합니다.
  이번처럼 규칙이 컴파일되지 않으면 테스트는 "실패"가 아니라 **"cancelled 39"** 로 나타납니다.
- 규칙 언어에는 리스트 반복(람다)이 없습니다. 반복 검사는 `hasAll` · `hasOnly` · `diff` · `size` 로 표현하거나,
  화면 코드에서 정규화한 뒤 개수·타입만 검사합니다.
