# 근무배치(종이오더) AI 비전 판독 — 예시 이미지 학습 + 테두리·블럭 크롭

2026-11-17 적용. 실서버 `https://busan-hak-port-info.vercel.app` 의 사진 판독(근무배치 찾기 → 사진) 흐름에
**"예시 이미지로 학습한 AI 비전 판독"** 을 1차로 넣고, 기존 Google Cloud Vision·기기 Tesseract 를 폴백으로 남긴 구조입니다.

## 1. 판독 규칙 (사용자가 색 테두리로 표시한 기준)

| 색 | 의미 | 예 |
| --- | --- | --- |
| 파란색 굵은 테두리 | 선박 1척 블록(머리말 1줄 + 아래 작업자 이름 칸) | — |
| 보라색 | 날짜(월/일) | `11/17` |
| 빨간색 | 선박명 | `ERASMUS FUTURE`, `ONE TRUST`, `JIA DE` |
| 노란색 | 시간(24시간제) | `22:00`, `08:00` |
| 검정색 | 회사명 | `우진`, `KML`, `웨스턴`, `동해`, `합동` |
| 테두리 없음 | 작업자 이름(2열, 왼쪽 열 → 오른쪽 열) | `최정한`, `박상원` |
| 이름이 아님 | 원문자 ①②③④, 형광펜 메모 | `05:00추가`, `15:00추가`, `DGT 지원` |

이름 뒤 구분 숫자(`김유신1`, `이승환2`, `김찬우1`)는 기존 `roster-engine.js` 규칙과 동일하게 이름에 붙여 유지합니다.

## 2. 처리 흐름

```
사진 선택
  └─ ① AI 비전 1차 판독 (서버: /api/roster-ocr-run, X-Roster-Ocr-Mode: ai)
        · 레퍼런스 이미지(assets/roster-ocr-reference.jpg) + 업로드 사진 2장을 Few-shot 으로 전송
        · 응답은 vessels:[{date, vesselName, time, company, workers, notes}] JSON 스키마 하나
        · 1척 이상 읽히면 즉시 검토표 표시 (기기 판독 생략)
  └─ ② 실패/미설정 → 기기 Tesseract (테두리·블럭 크롭)
        · 선박 블록별 헤더 4칸(날짜/선박명/시간/회사명) 분리 크롭 + 확대
        · 작업자 칸은 2열 여백을 찾아 좌·우 열을 따로 확대 판독(이름이 적게 나올 때만)
  └─ ③ 기기 판독이 부족 → 사용자 동의 후 Google Cloud Vision 보조 판독
```

`온라인 OCR 재판독` 버튼(서버에 AI 비전이 설정되면 `🤖 AI 비전으로 다시 읽기`)은 AI → Vision 순서로 시도합니다.

### 무료 한도·오류 시 폴백 (2026-11-17 추가)

- Gemini 가 429(무료 티어 하루 한도 초과)나 그 밖의 오류로 실패하면 **팝업 없이 서버 안에서 즉시**
  Google Cloud Vision 으로 내려가고, 그 응답에 기존 판독 결과가 함께 실려 옵니다.
- Vision 도 실패하면 클라이언트가 기기 Tesseract(테두리·블럭 크롭)로 이어 갑니다.
- 응답 메타: `fallbackReason: 'ai_quota_exceeded' | 'ai_unavailable' | 'ai_not_configured' | 'ai_no_vessels' | 'ai_cooldown'`,
  `fallbackProvider: 'google-cloud-vision' | 'device-tesseract'`.
- 한도 초과는 30분, 그 밖의 오류는 10분 동안 AI 호출을 쉬어 사진마다 대기하지 않습니다.
  클라이언트도 AI 가 꺼진 것을 확인한 세션에서는 다시 시도하지 않습니다.

## 3. 필요한 설정 (Vercel → Project Settings → Environment Variables)

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `ROSTER_CLOUD_OCR_ENABLED=1` | 예(이미 설정됨) | 사진 전송 자체의 스위치. 0 이면 AI 비전도 호출하지 않습니다. |
| `GEMINI_API_KEY` | **권장** | Google AI Studio 키. 있으면 `generativelanguage` API 로 호출합니다. |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | 이미 설정됨 | `GEMINI_API_KEY` 가 없을 때 Vertex AI(Gemini) 경로로 시도합니다. Vertex AI API 사용 설정 + 서비스 계정 `aiplatform.user` 역할 필요. |
| `ROSTER_AI_VISION_MODEL` | 선택 | 기본 `gemini-3.8-flash` |
| `ROSTER_AI_VISION=0` | 선택 | AI 경로만 끄기(기존 Vision·기기 판독 유지) |
| `ROSTER_AI_VISION_THINKING_BUDGET` | 선택 | 기본 0(사고 토큰 끔). 모델이 0 을 거부하면 자동으로 thinkingConfig 없이 재시도합니다. |

키가 하나도 없으면 서버는 AI 비전을 건너뛰고 기존 경로로 동작합니다(기능 장애 없음).
`/api/roster-ocr-config` 의 `aiVision` 값이 실제 설정 여부를 알려 줍니다.

## 4. 모델·비용 (2026-11-17 확인)

- 모델: `gemini-3.8-flash` — Stable, 이미지 입력 + 구조화 출력(`responseSchema`) 지원 Flash 모델.
- 가격: 입력 $0.75 / 100만 토큰, 출력 $3.75 / 100만 토큰(2026-12-31 까지, 2027-01-01 부터 2배).
- 사진 1장당 대략: 입력 ~2.4천 토큰(지시문+레퍼런스+대상) + 출력 ~1.3천 토큰 ≈ **$0.007 (약 9원)**
  - 하루 10장이면 월 3,000원 수준. 무료 티어에서는 무료(대신 입력이 모델 개선에 사용됨).
- `gemini-2.5-flash` 는 2026-12-01 부터 `gemini-3.5-flash-lite` 로 자동 라우팅되는 예정 모델이라 기본값에서 제외했습니다.

## 5. 레퍼런스 이미지

- 파일: `assets/roster-ocr-reference.jpg` (휴대폰 갤러리 UI 제거 후 종이+색 테두리만 크롭, 긴 변 1024px)
- **작업자 이름은 모자이크 처리**했습니다(`scripts/anonymize-roster-reference.py`). 날짜·선박명·시간·회사명
  머리말, 색 테두리, 형광펜 메모, 표 구조는 원본 그대로 두어 규칙 학습에 필요한 정보를 유지합니다.
  모자이크 후 같은 사진을 Google Cloud Vision 으로 다시 읽혀 이름이 하나도 남지 않는 것을 확인했습니다
  (머리말·회사명·메모만 인식).
- 서버리스 번들은 파일 경로에 의존하지 않도록 base64 사본 `scripts/roster-ai-vision-reference.mjs` 를 함께 커밋합니다.
- 재생성: `python3 scripts/anonymize-roster-reference.py` → `python3 scripts/generate-roster-ai-reference.py`

## 6. 검증

- `npm run check` (타입·검증·디자인 토큰·테스트 443+건), `npm run build` 통과.
- 신규 테스트
  - `scripts/roster-ai-vision.test.mjs` — 프롬프트 규칙, 요청 본문(2장 이미지·스키마), 날짜/시간/이름 정규화,
    메모·원문자 분리, 자격/폴백/쿨다운, 레퍼런스 자산 일치, 서버·앱 배선
  - `scripts/roster-worker-columns.test.mjs` — 작업자 칸 2열 분할 지점·열 크롭·중복 제거
- 무중단 확인 대상: `/api/*` 응답, `firebase-admin/auth` 미사용(부팅 경로), `firestore.rules` 무변경, 앱 이름
  `부산학 라이싱 작업 가이드`, 식단 업로드(`9363`) 무변경.

## 7. 주의

- 사진은 서버에서 저장하지 않습니다. 전송은 사용자가 동의한 경우(`X-Roster-Ocr-Consent: 1`)에만 하고,
  로그에는 사진 바이트를 남기지 않습니다.
- 무료 티어는 입력이 모델 개선에 사용됩니다. 이름·선박 정보가 민감하면 유료 티어 키를 쓰세요.
- 레퍼런스 이미지에는 실제 작업자 이름이 인쇄되어 있습니다. 저장소 공개 범위를 확인하고 공유하세요.
