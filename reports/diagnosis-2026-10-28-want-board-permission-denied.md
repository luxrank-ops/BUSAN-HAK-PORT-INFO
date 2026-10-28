# 🔎 진단 보고서 — "운영자에게 바란다" 제출 실패 (Missing or insufficient permissions)

- 작성일: 2026-10-28
- 신고 화면: `busan-hak-port-info.vercel.app` → ✨ 운영자에게 바란다 → 닉네임 `신항 도선사`, 내용 `1234` → **제출하기**
- 표시된 오류: `제출 실패: Missing or insufficient permissions.`

---

## 1. 결론 (한 줄)

**화면(앱) 버그가 아니라, Firestore 보안 규칙이 운영 프로젝트에 배포되지 않아
기본 거부 규칙에 걸린 것입니다.** 규칙을 한 번 배포하면 즉시 해결됩니다.

```
match /{document=**} { allow read, write: if false; }   ← firestore.rules 0번 (기본 거부)
```

`want_board` · `want_board_mine` 규칙은 저장소 파일에는 있지만, 운영 프로젝트에는 아직 없습니다.

---

## 2. 근거

| 항목 | 값 |
| --- | --- |
| 마지막으로 **성공**한 "Firebase 운영 배포" | **2026-10-21 04:32 UTC**, 커밋 `a639e90` (run `39544646862`) |
| 그 이후 배포 시도 | **2026-10-26 15:38 UTC 실패**, 커밋 `cdc90c6` (run `40351237546`) — 배포 단계에서 실패 |
| 2026-10-21 이후 `firestore.rules` 변경 | 179줄 추가 (섹션 10 `kkung_chain`, 11 `visitor_ip_logs`, 12 `want_board`) |
| 해당 변경 커밋 | `1cc3e01`(10-23) · `6caa0a7`(10-25) · `9b0a842`(10-26) |

즉 `a639e90` 시점의 규칙에는 아래 세 컬렉션 규칙이 **존재하지 않습니다**.

- `want_board` / `want_board/{itemId}/replies` / `want_board_mine` → **제출·조회 모두 거부**
- `kkung_chain`(꿍꿍따 댓글 릴레이) → **운영에서도 같은 이유로 쓰기 거부 상태로 추정**
- `visitor_ip_logs` → 서버(Admin SDK)가 쓰기 때문에 화면에는 증상이 드러나지 않음

`Missing or insufficient permissions` 는 Firestore 클라이언트 SDK 가
**보안 규칙 거부(permission-denied)** 를 받았을 때 내는 표준 문구입니다.
문서 형식·길이 문제라면 다른 문구가 나오므로, 이번 오류는 "규칙 자체가 없다"에 해당합니다.

---

## 3. 왜 배포가 실패했는지 알 수 없었나

기존 워크플로우는 아래처럼 **한 단계에서 세 가지를 묶어** 배포했습니다.

```
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

이 형태는 어느 대상에서 실패했는지 로그를 직접 열어 보지 않으면 알 수 없고,
규칙(권한)이 실패해도 화면(Hosting)만 갱신되는 혼동이 생깁니다.

---

## 4. 조치 내용 (이번 커밋)

### 4-1. 화면 — 원인을 알 수 있는 오류 안내

`public/js/want-board.js`

- `classifyWantError()` · `describeWantFailure()` 추가
  - `permission-denied` → "서버가 저장을 거부했습니다 · 보안 규칙이 아직 배포되지 않았을 가능성이 큽니다 · 운영자: Firebase 운영 배포 실행" 안내
  - `unauthenticated` → 세션 만료 안내 / `network` → 연결 확인 안내 / `index` → 색인 필요 안내
- `Missing or insufficient permissions.` 원문만 노출하던 제출·삭제·답글 오류를 모두 위 안내로 교체
- 내 기록(인덱스) 조회가 권한 거부로 실패하면 목록 영역에 원인을 표시하되 **글쓰기 버튼은 유지**
  (읽기가 막혀도 새 피드백은 남길 수 있게)
- 제출 저장을 **배치(원자적) 쓰기**로 변경 — 항목만 저장되고 인덱스는 실패해 반쪽 상태가 남는 문제 제거
  (`commitWantItem()` · `buildWantIndexItems()`)

### 4-2. 배포 워크플로우 — 단계 분리 + 실패 원인 노출

`.github/workflows/deploy-firebase.yml`

| 순서 | 단계 | 대상 |
| --- | --- | --- |
| 1 | Firestore 보안 규칙 배포 | `--only firestore:rules` (가장 먼저 — 권한이 먼저 살아나야 합니다) |
| 2 | Firestore 색인 배포 | `--only firestore:indexes` |
| 3 | Firebase Hosting 배포 | `--only hosting` |
| 4 | 배포 실패 사유 표시 (`if: failure()`) | 실패 로그의 핵심 문장을 Actions 요약(annotation)으로 출력 |

### 4-3. 회귀 테스트

- `scripts/want-board.test.mjs` — 오류 분류·안내 문구, 배치 쓰기, 권한 오류 시 목록 안내 검증 (4건 추가)
- `scripts/rules/firestore-rules.emulator.test.mjs` — 화면이 실제로 보내는 문서 모양 그대로
  `want_board` 저장/조회/위조/답글 권한을 검증하는 케이스 5건 추가
- `scripts/admin-stats-recovery.test.mjs` — 배포 워크플로우가 규칙 → 색인 → 호스팅 순서로 나뉘었는지 검증

---

## 5. 운영자 조치 절차 (권장)

1. GitHub → **Actions** → **Firebase 운영 배포** → **Run workflow**
2. `배포하시겠습니까?` 에서 **예** 선택
3. 실행이 끝나면 **Firestore 보안 규칙 배포** 단계가 초록색인지 확인
   - 빨간색이면 같은 실행의 **배포 실패 사유 표시** 단계에 원인 문장이 그대로 나옵니다.
4. 배포 후 휴대폰에서 앱을 새로고침(캐시 버전 `2027.19`)하고 다시 제출

> 참고: 저장소의 `firestore.rules` 는 이미 `want_board` 규칙을 포함하고 있으므로 **파일 수정은 필요 없습니다.**
> 배포만 하면 됩니다.

---

## 6. 재발 방지 체크리스트

- [ ] 새 컬렉션을 쓰는 기능을 배포할 때는 **규칙 배포가 같은 날 성공했는지** Actions 이력으로 확인
- [ ] 배포 실패 시 이 보고서 5번 절차로 규칙만 단독 배포 (Hosting 보다 규칙이 먼저)
- [ ] `npm run test:rules`(에뮬레이터) 로컬/CI 실행 결과 확인
      — 현재 CI 의 에뮬레이터 단계는 전 케이스가 `cancelled` 로 끝나는 상태로 별도 점검이 필요합니다(규칙 내용과 무관한 실행 환경 문제).
