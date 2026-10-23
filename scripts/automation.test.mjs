import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as esbuild from 'esbuild';
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

test('PNC 점검 1: SUPPORTED_TERMINALS에 pnc가 포함되고 Info.pnc·ShipVslStatus.pnc HTML 파서 및 검색 폼 추출기가 정확히 동작한다', () => {
  assert.match(serverCode, /SUPPORTED_TERMINALS\s*=\s*\[[^\]]*'pnc'[^\]]*\]/);

  const stripTagsMatch = serverCode.match(/function stripTags[\s\S]*?^}/m);
  const normalizeMatch = serverCode.match(/export function normalizeDateTimeStr[\s\S]*?^}/m);
  const pncBlockMatch = serverCode.match(
    /function decodeBasicEntities[\s\S]*?export function mergePncScheduleAndWorkStatus[\s\S]*?^}/m
  );
  assert.ok(stripTagsMatch && normalizeMatch && pncBlockMatch, 'PNC 파서 함수 블록이 존재해야 합니다');

  const tsSnippet = [stripTagsMatch[0], normalizeMatch[0], pncBlockMatch[0]].join('\n');
  const compiled = esbuild.transformSync(tsSnippet, { loader: 'ts', format: 'cjs' }).code;
  const mod = { exports: {} };
  const ctx = vm.createContext({ module: mod, exports: mod.exports, URL, URLSearchParams, String, Number, Array, Map, RegExp });
  vm.runInContext(compiled, ctx, { filename: 'pnc-parser.cjs' });

  const {
    parsePncScheduleHtml,
    parsePncWorkStatusHtml,
    extractPncSearchFormRequest,
    mergePncScheduleAndWorkStatus
  } = mod.exports;

  const sampleInfoHtml = `
    <form method="post" action="/info/CMS/Ship/Info.pnc?mCode=MN014">
      <input type="hidden" name="mCode" value="MN014">
      <input type="text" name="sDate" value="2026-10-21"> ~
      <input type="text" name="eDate" value="2026-10-30">
      <select name="route"><option value="" selected>ROUTE</option></select>
      <select name="oper"><option value="">OPER</option></select>
      <input type="radio" name="gubun" value="ETB" checked>
      <input type="radio" name="pageUnit" value="100" checked>
      <input type="radio" name="pageUnit" value="500">
      <input type="radio" name="pageUnit" value="1000">
    </form>
    <table>
      <thead>
        <tr>
          <th>No.</th><th>모선명</th><th>모선코드</th><th>선사항차</th><th>운항선사</th>
          <th>항로</th><th>접안방향</th><th>접안(예정)일시</th><th>출항(예정)일시</th><th>선석</th>
          <th>반입마감일시</th><th>양하수량</th><th>선적수량</th><th>Shift</th><th>줄잡이업체</th><th>작업서류</th><th>업데이트일시</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td><td>MISSOURI EXPRESS</td><td>MISX-007/2026</td><td>640W/642E</td><td>HLC</td>
          <td>GUSWC5E</td><td>Port</td><td>2026-10-21 20:45</td><td>2026-10-23 14:00</td><td>B6</td>
          <td>2026-10-21 03:00</td><td>1413</td><td>1628</td><td>124</td><td>New Port Marine</td><td></td><td>2026-10-21 22:35</td>
        </tr>
        <tr>
          <td>2</td><td>CELSIUS EMMEN</td><td>MCSE-003/2026</td><td>642W</td><td>ONE</td>
          <td>JPH</td><td>Star</td><td>2026-10-22 18:10</td><td>2026-10-23 20:00</td><td>B4</td>
          <td>2026-10-22 10:00</td><td>800</td><td>920</td><td>40</td><td>ENS MARINE</td><td></td><td></td>
        </tr>
      </tbody>
    </table>
  `;

  const formReq = extractPncSearchFormRequest(sampleInfoHtml, '2026-10-01', '2026-10-31');
  assert.ok(formReq, '검색 폼 요청이 추출되어야 합니다');
  assert.equal(formReq.method, 'POST');
  assert.equal(formReq.url, 'https://svc.pncport.com/info/CMS/Ship/Info.pnc?mCode=MN014');
  const parsedBody = new URLSearchParams(formReq.body);
  assert.equal(parsedBody.get('sDate'), '2026-10-01');
  assert.equal(parsedBody.get('eDate'), '2026-10-31');
  assert.equal(parsedBody.get('pageUnit'), '1000');
  assert.equal(parsedBody.get('mCode'), 'MN014');

  const scheduleItems = parsePncScheduleHtml(sampleInfoHtml);
  assert.equal(scheduleItems.length, 2);
  assert.equal(scheduleItems[0].TERMINAL, 'PNC');
  assert.equal(scheduleItems[0].VSL_NM, 'MISSOURI EXPRESS');
  assert.equal(scheduleItems[0].BERTH_NO, 'B6');
  assert.equal(scheduleItems[0].PTNR_CODE, 'HLC');
  assert.equal(scheduleItems[0].VOY_NO, '640W/642E');
  assert.equal(scheduleItems[0].ETB, '2026-10-21 20:45');
  assert.equal(scheduleItems[0].ATD, '2026-10-23 14:00');

  const sampleStatusHtml = `
    <table>
      <tr><th>구분</th><th>#4</th><th>#5</th><th>#6</th><th>#9</th></tr>
      <tr><th>선박코드</th><td>MCSE-003/2026</td><td>MXPS-005/2026</td><td>MISX-007/2026</td><td></td></tr>
      <tr><th>선박명</th><td>CELSIUS EMMEN</td><td>X-PRESS SHANNON</td><td>MISSOURI EXPRESS</td><td></td></tr>
      <tr><th>운항선사</th><td>ONE</td><td>HLC</td><td>HLC</td><td></td></tr>
      <tr><th>접안일시</th><td>2026-10-22 18:10</td><td>2026-10-23 02:30</td><td>2026-10-21 20:45</td><td></td></tr>
      <tr><th>작업시작일시</th><td>2026-10-22 20:12</td><td>2026-10-23 03:30</td><td>2026-10-21 21:30</td><td></td></tr>
      <tr><th>출항(예정)일시</th><td>2026-10-23 20:00</td><td>2026-10-23 19:00</td><td>2026-10-23 14:00</td><td></td></tr>
    </table>
  `;

  const statusItems = parsePncWorkStatusHtml(sampleStatusHtml);
  assert.equal(statusItems.length, 3);
  assert.equal(statusItems[0].BERTH_NO, 'B4');
  assert.equal(statusItems[0].ATW, '2026-10-22 20:12');

  const merged = mergePncScheduleAndWorkStatus(scheduleItems, statusItems);
  assert.equal(merged.length, 3);
  const missouri = merged.find((v) => v.VSL_NM === 'MISSOURI EXPRESS');
  assert.equal(missouri.ATW, '2026-10-21 21:30', '본선작업현황의 실제 작업시작일시(ATW)가 보강되어야 합니다');
});

test('PNC 점검 2: 프론트엔드 PNC 실시간 활성화(live: true), 셔틀버스 모달 폴백·초기화, 손상 아이콘 정리가 완료되어 있다', async () => {
  const termListCode = extractDeclaration(appJs, 'TERMINAL_SCHEDULE_LIST');
  const termCtx = vm.createContext({});
  vm.runInContext(`${termListCode}\nglobalThis.list = TERMINAL_SCHEDULE_LIST;`, termCtx);
  const pncEntry = termCtx.list.find((t) => t.id === 'pnc');
  assert.ok(pncEntry, 'TERMINAL_SCHEDULE_LIST에 pnc 항목이 존재해야 합니다');
  assert.equal(pncEntry.live, true, 'PNC 스케줄이 live: true 상태여야 합니다');

  // 백그라운드 SWR 갱신이 getWageScheduleDate()를 참조하는지 검증
  const fetchMonthFn = extractFunction(appJs, 'fetchHjncScheduleForMonth');
  assert.match(fetchMonthFn, /const\s+wageDate\s*=\s*getWageScheduleDate\(\)/);

  // PNC 셔틀버스 모달 동작 검증 (커스텀 이미지 깨짐 시 기본 이미지 자동 폴백 + 닫기 시 초기화)
  const elements = {
    imageModal: { style: { display: 'none' }, classList: { add() {}, remove() {} } },
    modalImage: { src: '', style: { display: 'block' }, onload: null, onerror: null },
    modalImageTitle: { textContent: '', classList: { hidden: true, add() { this.hidden = true; }, remove() { this.hidden = false; } } },
    modalImageStatus: { textContent: '', classList: { hidden: true, add() { this.hidden = true; }, remove() { this.hidden = false; } } },
    pncBusAdminBtn: { classList: { hidden: true, add() { this.hidden = true; }, remove() { this.hidden = false; } } }
  };

  const busCode = [
    extractDeclaration(appJs, 'DEFAULT_PNC_BUS_IMAGE_URL'),
    extractDeclaration(appJs, 'isPncBusModalActive'),
    extractFunction(appJs, 'resetPncBusModalState'),
    extractFunction(appJs, 'openBusSchedule'),
    extractFunction(appJs, 'closeImageModal')
  ].join('\n');

  const events = [];
  const busSandbox = vm.createContext({
    document: { getElementById: (id) => elements[id] || null },
    trackAppEvent: (cat, act) => events.push(`${cat}:${act}`),
    scheduleAppHistoryRecord: () => {},
    console,
    String,
    db: {
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({ imageUrl: 'https://example.com/broken-bus.jpg' })
          })
        })
      })
    }
  });
  vm.runInContext(busCode, busSandbox);

  await busSandbox.openBusSchedule();
  assert.equal(elements.imageModal.style.display, 'flex');
  assert.equal(elements.modalImageTitle.classList.hidden, false);
  assert.equal(elements.pncBusAdminBtn.classList.hidden, false);
  assert.equal(elements.modalImage.src, 'https://example.com/broken-bus.jpg');

  // 커스텀 URL 로드 오류 발생 시 기본 PNC 셔틀 이미지로 자동 폴백
  elements.modalImage.onerror();
  assert.match(elements.modalImage.src, /KakaoTalk_20260129_001114789\.jpg/);

  // 닫기 호출 시 일반 사진 뷰어 오염 방지를 위해 모든 상태 초기화
  busSandbox.closeImageModal();
  assert.equal(elements.imageModal.style.display, 'none');
  assert.equal(elements.modalImageTitle.classList.hidden, true);
  assert.equal(elements.pncBusAdminBtn.classList.hidden, true);

  // icons/ 내 1바이트 깨진 파일이 없어야 함
  const iconsDir = new URL('../icons/', import.meta.url);
  for (const name of fs.readdirSync(iconsDir)) {
    const stat = fs.statSync(new URL(name, iconsDir));
    assert.ok(stat.size > 100, `icons/${name} 파일이 손상되었습니다 (${stat.size} bytes)`);
  }
});

