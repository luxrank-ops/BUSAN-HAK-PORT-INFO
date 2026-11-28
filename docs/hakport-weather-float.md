# ☂️ 비 예보 플로팅 카드 — 학포트 이식 기록

> **출처**: arena-emoticon-maker(이모티학) PR #117 `feat(home): 창원 비 예보 시 우하단 플로팅 날씨 카드 (Open-Meteo)`
> (머지 `994b0f4`) → 사용자 요청으로 PR #140 리버트(머지 `e3c9de4`).
> 2026-11-26 세션 전달 문서(부록 A 소스 원문)를 학포트에 이식했습니다.
>
> ⚠️ **전제 정정**: 전달 문서는 "학포트는 Next.js + Tailwind 라고 가정"했지만, 실제 학포트는
> **vanilla HTML/CSS/JS SPA + Express(`server.ts`) + 디자인 토큰(`scripts/design-tokens.mjs`)** 입니다.
> 그래서 React 컴포넌트·Tailwind 클래스 대신 **전역 스크립트 모듈 + `app.css` 토큰 클래스**로
> 동일한 동작을 옮겼습니다(전달 문서 2장 "스택이 다르면 아래 항목만 바꿉니다" 지침 준수).
> 비 판정 임계값·8초 타임아웃·KST 당일 숨김·조용한 실패 로직은 원본 그대로입니다.

---

## 1. 한눈에 보기

| 항목 | 내용 |
| --- | --- |
| 무엇 | 홈 진입 시 [Open-Meteo](https://open-meteo.com/)(API 키 불필요 · CORS 허용 · CC BY 4.0)에서 **부산항 오늘 예보**를 조회해, **비·눈·안개·강풍이 예보된 날에만** 우하단 카드를 띄움 |
| 비 판정 | WMO 비 계열 코드(이슬비·어는비·비·소나기·뇌우) **OR** 최대 강수확률 ≥ 50% **OR** 예상 강수량 ≥ 1mm |
| 눈 판정 | WMO 눈 계열 코드 `71·73·75·77·85·86` (2026-11-28 추가) |
| 안개 판정 | WMO 안개 계열 코드 `45·48` (2026-11-28 추가) |
| 강풍 판정 | 일 최대 풍속·돌풍 중 큰 값이 **10m/s↑ = 강풍 주의**, **15m/s↑ = 고소 작업 통제** — 기상 전광판 배지와 같은 기준 (`wind_speed_unit=ms` 필수) |
| 우선순위 | 통제급 강풍 > 눈 > 비 > 강풍 주의 > 안개 (여러 위험이 겹치면 제목은 가장 센 것, 나머지는 상세 줄) |
| 카드 내용 | 아이콘(☂️/❄️/🌫️/💨) · 제목 · 강수확률/강수량/날씨 라벨 · 강풍 시 `최대 풍속 · 돌풍 · 기준` 줄 · CTA · 출처(Open-Meteo, CC BY 4.0) |
| 닫기 | ✕ → `localStorage` 에 `hakport:rain-float-dismissed:<KST YYYY-MM-DD>` 기록 → **그날은 미노출**, 다음 날 재확인 |
| CTA | 학포트에 `/brief` 가 없으므로 기존 **'📡 날씨 및 도선 상황' 카드(`#weather-card`)** 를 펼쳐 실시간 기상 전광판으로 이동(착지 시 고정 헤더·방문자 배지 아래로 보정) |
| 실패 시 | 네트워크 오류 · 8초 타임아웃 · HTTP 오류 · 응답 형식 이상 → **아무것도 렌더하지 않음**(조용한 실패, 홈 렌더링 무영향) |
| 위치 | 부산항(북항) 고정 좌표 `35.104, 129.042` — 전광판 북항 지점과 같은 방향 · `geolocation` 미사용(권한 요청 없음) |
| 겹침 회피 | `bottom: max(140px, safe+130px)` — 하단 내비(65px) · `운영자에게 바란다`(~125px) · 🚨 다시 보기(~130px) 위. 긴급 공지 패널·다시 보기는 `--z-modal`(3000)이라 예보 카드(2500)보다 위 |
| SSR | 서버 HTML에는 없고 마운트 후 비동기 등장(원본과 동일) |

## 2. 전달 문서 체크리스트 → 학포트 적용

| # | 항목 | 학포트 적용 |
| --- | --- | --- |
| 1 | 지역 좌표 | `PORT = { latitude: 35.104, longitude: 129.042, timezone: 'Asia/Seoul' }`(부산항 북항) · `FORECAST_URL` 도 같은 좌표 |
| 2 | CTA 링크 | `/brief` 제거 → `openWeatherBoard()` 가 `#weather-card` 를 `toggleDashItem()` 으로 펼치고 스크롤 |
| 3 | i18n | 학포트는 `ko` 단일 로케일 → `COPY` ko 고정 문자열. `rainCodeLabel(code, locale)` 은 ko/en 라벨 유지 |
| 4 | 스타일 토큰 | Tailwind/이모티학 토큰 대신 `app.css` 의 `.rain-float-*` 클래스 + `--sp-*`/`--fs-*`/`--blue-*`/`--shadow-elev-*`/`--z-visitor-badge` 등 **188개 디자인 토큰만 참조**. 하단 고정 내비(`.bottom-nav`) 회피 오프셋 유지 |
| 5 | 아이콘 | `lucide-react` 없음 → ☂️ / ☁️ / ✕ 텍스트로 대체 |
| 6 | 스토리지 키 | `emotime:` → **`hakport:rain-float-dismissed:`** |
| 7 | 문구 | "오늘 창원에…" → "오늘 부산항에 비 소식이 있어요", eyebrow/출처도 부산항 |
| 8 | 배치 | 한/영 랜딩 2곳 대신 **홈(`index.html`) 1곳** — `public/js/rain-float.js` 를 전역 스크립트로 로드 |
| 9 | 지점 원칙 | 고정 좌표 유지. 서비스워커는 이미 `open-meteo.com` 요청을 캐시 대상에서 제외하고 있어 충돌 없음 |
| 10 | 출처 표기 | 카드 하단 `Open-Meteo · 부산항` + `CC BY 4.0` 링크 유지 |

## 3. 변경 파일

| 파일 | 역할 |
| --- | --- |
| `public/js/rain-float.js` | **신규** — 예보 조회·파싱·비 판정·카드 생성·닫기·CTA (IIFE, 전역 오염 없음). 순수 로직은 `window.HakportRainFloat` 로 노출해 테스트가 재사용 |
| `public/css/app.css` | `.rain-float-*` 블록 추가(라이트/다크 · reduced-motion · 모바일 하단 내비 회피 · 44px 터치 타깃) |
| `public/index.html` | `<script src="./js/rain-float.js?v=…">` 추가. 마크업은 건드리지 않음(카드는 JS 가 동적 생성) |
| `public/service-worker.js` | 프리캐시 목록에 신규 스크립트 추가 + `CACHE_VERSION` 갱신 |
| `scripts/app-source.mjs` | `APP_JS_FILES` 로드 순서 등록 + `APP_ASSET_VERSION` 상향 |
| `scripts/validate.mjs` · `scripts/build-obfuscate.mjs` | 전역 스크립트 목록 등록(통합 문법 검증 · 배포 압축 검증) |
| `scripts/app-split.test.mjs` | 로드 순서 회귀 테스트에 신규 모듈 포함 |
| `scripts/rain-float.test.mjs` | **신규** — 전달 문서 검증 8가지 + 렌더/닫기/CTA/실패/배선 회귀 테스트 13개 |
| `README.md` | 기능 표에 한 줄 추가 |

> 자산 버전은 `2027.85 → 2027.86`(이식) → `2027.96 → 2027.97`(2026-11-28 강풍·안개·눈 확장 및 레이아웃 수정) 으로 올렸습니다. 학포트 규칙상 `?v=` 쿼리 ·
> `STATIC_PRECACHE_ASSETS` · `CACHE_VERSION` · `APP_ASSET_VERSION` 을 함께 갱신해야
> 서비스워커가 새 CSS/JS 를 받습니다(`npm run check` 가 1:1 일치를 검증).

## 3-1. 2026-11-28 변경 — 레이아웃 겹침 3건 + 강풍·안개·눈

| 문제(점검 보고서) | 수정 |
| --- | --- |
| P1 ① PC·태블릿(≥768px)에서 카드가 하단 내비를 41px 덮어 탭 클릭 차단 | `@media (min-width:768px)` 가 `bottom` 을 24px 로 덮던 규칙을 제거하고, 모든 폭에서 `bottom: max(140px, safe+130px)` 로 내비(65px) 위에 고정 |
| P1 ② 🚨 긴급 공지 `다시 보기` 버튼이 카드에 완전히 가려짐(둘 다 z 2500) | 카드는 `--z-visitor-badge`(2500) 유지, **긴급 공지 패널·다시 보기 버튼은 `--z-modal`(3000)** 으로 올려 안전 공지가 항상 위·클릭 가능. 카드도 140px 위로 띄워 버튼과 물리적으로 분리 |
| P2 ③ 좌하단 `운영자에게 바란다` 가 출처 표기(CC BY 4.0)를 덮음 | 카드 하단을 버튼 위(~125px)로 올려 모든 폭(320~430)에서 출처가 보임 |
| P3 가로모드·CTA 착지 | 가로모드도 같은 오프셋으로 내비 회피 · CTA 는 `scrollTo(cardTop - 헤더높이/배지하단 - 8)` 로 착지해 상단 배지가 제목을 덮지 않음 |
| P3 눈·안개·강풍 미탐지 | `daily` 에 `wind_speed_10m_max,wind_gusts_10m_max` + `wind_speed_unit=ms` 추가, `SNOW_CODES`·`FOG_CODES`·`windLevel()` 도입, 종류별 아이콘·문구·우선순위 적용 |

## 4. 검증

```bash
npm run check              # typecheck + validate + tokens:check + 전체 테스트(CI 동일)
npm run build:obfuscate    # 배포본 압축·전역 API 보존 검증
```

- `scripts/rain-float.test.mjs` 가 전달 문서의 8가지 판정 케이스를 그대로 고정합니다.
  (61/80%/3.2mm · 3/65%/0mm · 2/10%/1.4mm · 2/10%/0mm · 95/30%/0.2mm ·
  daily 없음 · 레거시 `weathercode` · 오늘 닫힘 키)
- 추가로 **가짜 DOM** 으로 실제 렌더·✕ 닫힘(localStorage 저장)·CTA(`#weather-card` 펼침)·
  네트워크/HTTP/파싱 실패 시 무렌더·8초 타이머 정리까지 검증합니다.
- 브라우저 확인: 개발 서버 홈 → 네트워크 탭에서
  `https://api.open-meteo.com/v1/forecast?latitude=35.1796&longitude=129.0756&daily=…` 200 응답,
  비 예보일 때만 우하단 카드 등장. ✕ 후 새로고침 → 당일 미노출 / 키 삭제 후 재노출.
- 샌드박스·오프라인에서는 Open-Meteo 에 닿지 못하므로 **미표시가 정상**입니다.

## 5. 알려진 제약

- 지역은 고정 좌표입니다(사용자 위치 기반 아님). 위치 기반으로 바꾸려면 권한 처리 + 실패 시 폴백 좌표가 필요합니다.
- 카드는 마운트 후 비동기로 등장합니다(서버 HTML 없음). SSR 값이 필요하면 서버에서 Open-Meteo 를 직접 조회하는 방식으로 바꿔야 합니다.
- 학포트에는 이미 신항·북항 **실시간(current)** 기상 전광판(`fetchBusanPortLiveWeather`)이 있습니다.
  이 카드는 **오늘 일일 예보(daily)** 를 별도로 조회하며, CTA 는 그 기존 전광판으로 연결됩니다(중복 기능 아님).
