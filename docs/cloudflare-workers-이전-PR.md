## 요약

학포트를 **Vercel(운영 중) 그대로 두고** Cloudflare Workers 로 병행 배포할 수 있는 경로를 추가합니다.

- **새 주소**: https://busan-hak-port-info.luxrank.workers.dev (실측 검증 완료)
- 기존 `busan-hak-port-info.vercel.app`, `vercel.json`, GitHub Actions 의 `vercel.app` 주소는 **변경 없음**

## 무엇을 했나

| 파일 | 역할 |
| --- | --- |
| `worker/index.ts` | `/api/*` → 기존 Express 앱(`server.ts`), 그 외 → Workers Assets(SPA 폴백). Cron Triggers → `/api/cron/*` |
| `worker/cf/firestore.ts` | firebase-admin Firestore 대체 (REST v1). doc get/set/update/delete/create, add, where/orderBy/limit, count, batch, runTransaction, FieldValue(serverTimestamp·increment·arrayUnion) |
| `worker/cf/google-auth.ts` | 서비스 계정 JWT 서명 → OAuth 액세스 토큰(scope별 캐시) |
| `worker/cf/messaging.ts` | FCM HTTP v1 (`getMessaging().send`) |
| `worker/cf/storage.ts` | Cloud Storage JSON API (`bucket().file().save/download/exists`) |
| `worker/cf/app.ts` | `initializeApp`/`cert`/`getApps` 셰임 |
| `scripts/build-worker.mjs` | esbuild 번들(node 내장 모듈 external, dotenv 스텁, firebase-admin → worker/cf 치환) |
| `wrangler.jsonc` | Assets(`build/public`), cron 4종, 비밀값 제외 환경변수 |
| `server.ts` | `IS_CLOUDFLARE` 감지, Firestore REST 초기화, `compression()` 중복 압축 방지, 읽기 전용 FS(파일 점검·백업 로컬 사본) 대응 |

## 왜 firebase-admin 을 그대로 못 쓰나

Workers 에는 gRPC(TCP·HTTP/2)가 없고 문자열 코드 생성(`new Function`)이 금지됩니다.
`firebase-admin` 은 `@grpc/grpc-js` 와 `protobufjs` 코드 생성에 의존해 **import 단계에서 실패**합니다(실측).
그래서 서버가 실제로 쓰는 API 표면만 Firestore REST 로 구현했습니다. 번들 745KB(gzip, 무료 한도 3MB 이내).

## 검증 (실서비스 데이터 기준)

| 항목 | 결과 |
| --- | --- |
| `GET /` (정적 자산 + SPA) | 200 |
| `GET /api/health` | 200 · `platform: cloudflare-workers` · `firebaseAdminInitialized: true` |
| `GET /api/config` | 200 (VAPID 키 일치) |
| `GET /api/terminal-schedule?terminal=hjnc` | 200 · 실시간 28척 파싱 |
| `POST /api/screen-unlock` | 200 · 토큰 발급(Firestore `settings/admin` 조회) |
| `POST /api/auth-session` (anonymous) | 200 · Custom Token 서명 발급 |
| `POST /api/visitor-beacon` | 200 · Firestore 쓰기 |
| `GET /api/analytics-summary` | 200 · Firestore 집계(오늘 97·누적 5,693명) |
| `GET /api/cron/daily-cleanup` (무토큰/토큰) | 401 / 200 · 만료 캐시 정리 실행 |
| `GET /api/cron/daily-inspection` | 200 · 29/29 PASS, 메일 발송(gmail-api) |
| 없는 `/api/*` | 404 JSON |

## 배포 방법 (재배포 시)

```bash
# 최초 1회: 로그인 또는 토큰
export CLOUDFLARE_API_TOKEN=...        # 계정 b95a6c54… (Workers 편집 권한)

# 정적 자산은 SCREEN_LOCK_PIN 을 포함해 빌드해야 클라이언트 폴백 해시가 운영 PIN 과 일치합니다.
SCREEN_LOCK_PIN=900754 npm run deploy:cf
```

Worker Secret(Variables and Secrets): `FIREBASE_SERVICE_ACCOUNT_KEY`, `CRON_SECRET`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `VAPID_KEY`, `UNLOCK_TOKEN_SECRET`,
`SCREEN_LOCK_PIN` — 나머지 일반 값은 `wrangler.jsonc` 의 `vars`.

## 남은 것 (이 PR 범위 밖, 배포 시 수동)

1. `GEMINI_API_KEY` — Vercel 이 Secret 타입이라 값을 읽을 수 없어 Worker 에 아직 없습니다. 현재 OCR 은 Google Cloud Vision 경로로 동작하고, AI 비전(Gemini)은 키 등록 후 활성화됩니다. (`busan-hak-port` 프로젝트에 Gemini API 는 사용 설정됨)
2. GitHub Actions 의 `SELF_CHECK_BASE_URL`·`SCHEDULE_WATCH_URL`(기본값 `vercel.app`) 전환은 사용자가 Cloudflare 전환을 확정한 뒤 별도 커밋으로.
3. Cloudflare 전환 공지 후 Vercel Pro 해지.
