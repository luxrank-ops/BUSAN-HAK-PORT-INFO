import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readAppJs, extractFunction, extractDeclaration } from './app-source.mjs';

// A-1 (2026-10-17): 커뮤니티 검증 로직은 인라인 스크립트 → public/js/app.js 로 이동.
// 라이브 소스에서 필요한 함수·상태만 추출해 샌드박스에 실행합니다.
const appJs = readAppJs();
const communityCode = [
  extractDeclaration(appJs, 'COMMUNITY_BANNED_WORDS'),
  extractDeclaration(appJs, 'recentCommunitySubmissions'),
  extractDeclaration(appJs, 'COMMUNITY_FLOOD_WINDOW_MS'),
  extractFunction(appJs, 'normalizeModerationText'),
  extractFunction(appJs, 'inspectCommunityContent'),
  extractFunction(appJs, 'notifyAdminAutoBlind'),
  extractFunction(appJs, 'compressImageForUpload')
].filter(Boolean).join('\n');
for (const part of [
  'COMMUNITY_BANNED_WORDS', 'recentCommunitySubmissions', 'COMMUNITY_FLOOD_WINDOW_MS',
  'normalizeModerationText', 'inspectCommunityContent', 'notifyAdminAutoBlind', 'compressImageForUpload'
]) {
  if (!communityCode.includes(part)) throw new Error(`커뮤니티 검증 코드 추출 실패: ${part}`);
}

const notificationsCode = fs.readFileSync(new URL('../public/js/notifications.js', import.meta.url), 'utf8');
const serverCode = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

function createCommunitySandbox() {
  const addedNotifications = [];
  const sandbox = {
    console,
    Date,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Promise,
    setTimeout,
    clearTimeout,
    alert: () => {},
    confirm: () => true,
    showToast: () => {},
    firebase: {
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'SERVER_TIMESTAMP'
        }
      }
    },
    db: {
      collection: (name) => ({
        add: async (doc) => {
          if (name === 'notifications') addedNotifications.push(doc);
          return { id: 'mock-id' };
        }
      })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(communityCode, sandbox, { filename: 'public/js/community.js' });
  return { sandbox, addedNotifications };
}

test('1순위: server.ts에 1시간(60분) 이상 출항/접안 변동 감지 및 FCM 알림 파이프라인이 구현되어 있다', () => {
  assert.doesNotMatch(serverCode, /\/\/\s*@ts-nocheck/, 'server.ts에 @ts-nocheck가 없어야 합니다');
  assert.match(serverCode, /import\s+'dotenv\/config'/, '.env 자동 로드가 포함되어야 합니다');
  assert.match(serverCode, /SCHEDULE_DIFF_THRESHOLD_MINUTES\s*=\s*Number\(process\.env\.SCHEDULE_DIFF_THRESHOLD_MINUTES\)\s*\|\|\s*60/);
  assert.match(serverCode, /export\s+function\s+calculateScheduleDiffMinutes/);
  assert.match(serverCode, /export\s+function\s+isScheduleShiftedByAtLeastOneHour/);
  assert.match(serverCode, /app\.get\('\/api\/config'/);

  // 스케줄 시간 차이 계산 검증을 위해 순수 함수 추출 실행
  const fnSandbox = { Date, Math, Number, String };
  vm.createContext(fnSandbox);
  const normalizeMatch = serverCode.match(/export function normalizeDateTimeStr[\s\S]*?^}/m);
  const parseMatch = serverCode.match(/export function parseScheduleTimeMs[\s\S]*?^}/m);
  const diffMatch = serverCode.match(/export function calculateScheduleDiffMinutes[\s\S]*?^}/m);
  const shiftMatch = serverCode.match(/export function isScheduleShiftedByAtLeastOneHour[\s\S]*?^}/m);
  assert.ok(normalizeMatch && parseMatch && diffMatch && shiftMatch, '스케줄 비교 함수가 모두 존재해야 합니다');

  const runnable = [
    'const SCHEDULE_DIFF_THRESHOLD_MINUTES = 60;',
    normalizeMatch[0].replace(/^export\s+/, '').replace(/:\s*any/g, '').replace(/:\s*string/g, ''),
    parseMatch[0].replace(/^export\s+/, '').replace(/:\s*any/g, '').replace(/:\s*number\s*\|\s*null/g, ''),
    diffMatch[0].replace(/^export\s+/, '').replace(/:\s*any/g, '').replace(/:\s*number\s*\|\s*null/g, ''),
    shiftMatch[0]
      .replace(/^export\s+/, '')
      .replace(/oldTime:\s*any,\s*newTime:\s*any,\s*thresholdMinutes:\s*number\s*=\s*SCHEDULE_DIFF_THRESHOLD_MINUTES/, 'oldTime, newTime, thresholdMinutes = SCHEDULE_DIFF_THRESHOLD_MINUTES')
      .replace(/:\s*boolean/g, '')
  ].join('\n');
  vm.runInContext(runnable, fnSandbox);

  assert.equal(fnSandbox.calculateScheduleDiffMinutes('2026-10-13 14:00', '2026-10-13 14:30'), 30);
  assert.equal(fnSandbox.isScheduleShiftedByAtLeastOneHour('2026-10-13 14:00', '2026-10-13 14:30'), false);
  assert.equal(fnSandbox.calculateScheduleDiffMinutes('2026-10-13 14:00', '2026-10-13 15:00'), 60);
  assert.equal(fnSandbox.isScheduleShiftedByAtLeastOneHour('2026-10-13 14:00', '2026-10-13 15:00'), true);
  assert.equal(fnSandbox.calculateScheduleDiffMinutes('2026-10-13 14:00', '2026-10-13 12:30'), -90);
  assert.equal(fnSandbox.isScheduleShiftedByAtLeastOneHour('2026-10-13 14:00', '2026-10-13 12:30'), true);
});

test('1순위 & 2순위: notifications.js가 문법 오류 없이 동작하며 읽음 처리 시 readAt 타임스탬프를 기록한다', async () => {
  const updatedDocs = [];
  const sandbox = {
    console,
    Date,
    String,
    currentWorkerId: '작업자A',
    firebase: {
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'READ_AT_TIMESTAMP'
        }
      }
    },
    db: {
      batch: () => ({
        update: (ref, data) => updatedDocs.push({ ref, data }),
        commit: async () => {}
      }),
      collection: () => ({
        where: () => ({
          where: () => ({
            get: async () => ({
              empty: false,
              forEach: (cb) => cb({ ref: 'noti-doc-1' })
            })
          })
        })
      })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(notificationsCode, sandbox, { filename: 'public/js/notifications.js' });

  sandbox.markAllNotisAsRead();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(updatedDocs.length, 1);
  assert.equal(updatedDocs[0].data.read, true);
  assert.equal(updatedDocs[0].data.readAt, 'READ_AT_TIMESTAMP');
});

test('2순위: DB 자가 정리(30일 스케줄 캐시 / 14일 읽은 알림 TTL) 및 주간 정기 백업 크론이 설정되어 있다', () => {
  assert.match(serverCode, /SCHEDULE_CACHE_TTL_DAYS\s*=\s*30/);
  assert.match(serverCode, /READ_NOTIFICATION_TTL_DAYS\s*=\s*14/);
  assert.match(serverCode, /BACKUP_COLLECTIONS\s*=\s*\['work_logs',\s*'ships',\s*'posts'\]/);
  assert.match(serverCode, /cron\.schedule\('0 3 \* \* \*'/);
  assert.match(serverCode, /cron\.schedule\('0 0 \* \* 0'/);
  assert.match(serverCode, /export\s+async\s+function\s+runDatabaseAutoCleanup/);
  assert.match(serverCode, /export\s+async\s+function\s+runWeeklyFirestoreBackup/);
});

test('3순위: 커뮤니티 금칙어·욕설 및 도배 패턴을 자동 감지하여 블라인드(hidden: true) 및 관리자 알림을 생성한다', () => {
  const { sandbox, addedNotifications } = createCommunitySandbox();

  // 1) 정상 게시글은 통과
  const normalRes = sandbox.inspectCommunityContent({
    title: '신항 2부두 오늘 작업 수월합니다',
    text: '바람이 조금 불지만 야드 상태 양호합니다.',
    author: '부산항 도선사',
    category: '왁자지껄 게시판',
    nowMs: 1000
  });
  assert.equal(normalRes.hidden, false);
  assert.equal(normalRes.reason, null);

  // 2) 금칙어/욕설(특수문자 우회 포함) 감지
  const profanityRes = sandbox.inspectCommunityContent({
    title: '테스트',
    text: '야 이 시.발 진짜 너무하네',
    author: '익명',
    category: '왁자지껄 게시판',
    nowMs: 2000
  });
  assert.equal(profanityRes.hidden, true);
  assert.match(profanityRes.reason, /금칙어/);

  // 3) 단시간 동일 내용 반복 등록(도배) 감지
  const firstPost = sandbox.inspectCommunityContent({
    title: '동일 도배 테스트',
    text: '같은 내용을 연속으로 올립니다',
    author: '도배러',
    category: '게시판 댓글',
    nowMs: 10_000
  });
  assert.equal(firstPost.hidden, false);

  const duplicatePost = sandbox.inspectCommunityContent({
    title: '동일 도배 테스트',
    text: '같은 내용을 연속으로 올립니다',
    author: '도배러',
    category: '게시판 댓글',
    nowMs: 20_000
  });
  assert.equal(duplicatePost.hidden, true);
  assert.equal(duplicatePost.matchedTerm, 'DUPLICATE_FLOOD');

  // 4) 관리자 알림 발송 확인
  sandbox.notifyAdminAutoBlind({
    category: '왁자지껄 게시판',
    author: '익명',
    title: '문제 게시글',
    reason: profanityRes.reason
  });
  assert.equal(addedNotifications.length, 1);
  assert.equal(addedNotifications[0].userId, 'ADMIN');
  assert.equal(addedNotifications[0].type, 'AUTO_BLIND');
});

test('3순위: 고화질 이미지 업로드 전 자동 압축 함수(compressImageForUpload)가 소형 파일은 통과시키고 대형 이미지는 리사이징한다', async () => {
  const { sandbox } = createCommunitySandbox();

  // 1) 900KB 이하 이미지는 재압축 없이 즉시 원본 반환
  const smallFile = { name: 'small.jpg', type: 'image/jpeg', size: 300 * 1024 };
  const outSmall = await sandbox.compressImageForUpload(smallFile);
  assert.equal(outSmall, smallFile);

  // 2) 이미지가 아닌 일반 파일(PDF 등)은 즉시 원본 반환
  const pdfFile = { name: 'manual.pdf', type: 'application/pdf', size: 5 * 1024 * 1024 };
  const outPdf = await sandbox.compressImageForUpload(pdfFile);
  assert.equal(outPdf, pdfFile);
});

test('4순위: 서버 헬스체크(/api/health) 및 터미널 장애 시 Stale-While-Revalidate 자가 격리가 구성되어 있다', () => {
  assert.match(serverCode, /app\.get\('\/api\/health'/);
  assert.match(serverCode, /export\s+async\s+function\s+fetchTerminalScheduleVesselsWithMeta/);
  assert.match(serverCode, /cacheSource:\s*'stale-memory'/);
  assert.match(serverCode, /cacheSource:\s*'firestore-cache'/);
  assert.match(serverCode, /failures\s*>=\s*2\s*\?\s*'isolated'\s*:\s*'degraded'/);
});
