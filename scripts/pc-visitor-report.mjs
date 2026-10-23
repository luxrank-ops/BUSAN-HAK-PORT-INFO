#!/usr/bin/env node
/**
 * BUSAN HAK PORT INFO — 최근 N일 PC 접속자 위치 리스트 생성기
 * ─────────────────────────────────────────────────────────────────────────────
 * 앱의 방문자 비콘(/api/visitor-beacon)이 Firestore `visitor_ip_logs` 에 남긴
 * IP·위치 기록을 읽어, **최근 3일(기본) PC(데스크톱) 접속자 위치 리스트**를
 * Markdown · CSV · 콘솔 표 세 가지 형태로 만들어 줍니다.
 *
 * 사용법
 *   node scripts/pc-visitor-report.mjs                 # 최근 3일 · PC만
 *   node scripts/pc-visitor-report.mjs --days 1        # 오늘만
 *   node scripts/pc-visitor-report.mjs --days 7        # 최근 7일
 *   node scripts/pc-visitor-report.mjs --device all    # 모바일 포함 전체 기기
 *   node scripts/pc-visitor-report.mjs --demo          # 예시 데이터로 형식 확인
 *   node scripts/pc-visitor-report.mjs --full-ip       # IP 마스킹 해제
 *
 * 필요한 환경변수 (둘 중 하나)
 *   FIREBASE_SERVICE_ACCOUNT_KEY  서비스 계정 키 JSON 또는 Base64 인코딩 문자열
 *   GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 키 파일 경로
 *
 * 결과물
 *   reports/pc-visitors-YYYY-MM-DD.md   (사람이 읽는 표)
 *   reports/pc-visitors-YYYY-MM-DD.csv  (엑셀 업로드용)
 *
 * 이 파일은 순수 함수(buildCsv / buildMarkdown / summarizeVisitorLogs …)를
 * 함께 내보내므로 scripts/pc-visitor-report.test.mjs 에서 의존성 없이 검증합니다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

/** ms 타임스탬프 → KST dateKey(YYYY-MM-DD) */
export function kstDateKey(ms) {
    const kst = new Date(Number(ms || 0) + KST_OFFSET_MS);
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}

/** KST dateKey(YYYY-MM-DD) 00:00 → ms */
export function kstDayStartMs(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    if (!m) return 0;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST_OFFSET_MS;
}

/** 최근 days 일(오늘 포함) 의 dateKey 목록과 조회 시작 시각 */
export function buildDayWindow(days, nowMs = Date.now()) {
    const safeDays = Math.min(31, Math.max(1, Math.floor(Number(days) || 3)));
    const todayStart = kstDayStartMs(kstDateKey(nowMs));
    const dateKeys = [];
    for (let i = safeDays - 1; i >= 0; i--) dateKeys.push(kstDateKey(todayStart - i * 86400000));
    return { dateKeys, sinceMs: todayStart - (safeDays - 1) * 86400000, days: safeDays };
}

/** 'YYYY-MM-DD' → '10-23 (금)' */
export function formatDayLabel(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    if (!m) return String(dateKey || '-');
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return `${m[2]}-${m[3]} (${WEEKDAY_KR[day]})`;
}

/** ms → 'YYYY-MM-DD HH:MM' (KST) */
export function formatKstDateTime(ms) {
    const n = Number(ms || 0);
    if (!n) return '-';
    const kst = new Date(n + KST_OFFSET_MS);
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}

/** IP 마스킹 — 마지막 옥텟(IPv6 는 뒷부분)을 가립니다. */
export function maskIp(ip) {
    const raw = String(ip || '').trim();
    if (!raw) return '-';
    if (raw.includes('.')) {
        const parts = raw.split('.');
        if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
        return raw;
    }
    const groups = raw.split(':');
    if (groups.length >= 3) return `${groups.slice(0, 3).join(':')}:****`;
    return raw;
}

/** 국가 › 지역 › 도시 라벨 (중복 제거) */
export function buildLocationLabel(log) {
    const parts = [];
    for (const raw of [log?.country, log?.region, log?.city]) {
        const value = String(raw ?? '').trim();
        if (!value) continue;
        if (parts.some((p) => p.toLowerCase() === value.toLowerCase())) continue;
        parts.push(value);
    }
    return parts.length ? parts.join(' › ') : '위치 미확인';
}

/**
 * 로그 배열을 날짜별·지역별로 요약합니다.
 * @param {Array<object>} logs
 * @param {string[]} dateKeys 조회 창의 날짜 키 (오래된 날짜 → 오늘)
 */
export function summarizeVisitorLogs(logs, dateKeys) {
    const dayMap = new Map();
    (dateKeys || []).forEach((dk) => dayMap.set(dk, { dateKey: dk, count: 0, ips: new Set() }));
    const locationMap = new Map();
    const uniqueIps = new Set();

    (logs || []).forEach((log) => {
        const ip = String(log.ip || '').trim();
        const dateKey = String(log.dateKey || '').trim() || kstDateKey(Number(log.accessedAtMs) || 0);
        const label = buildLocationLabel(log);
        if (ip) uniqueIps.add(ip);

        if (!dayMap.has(dateKey)) dayMap.set(dateKey, { dateKey, count: 0, ips: new Set() });
        const day = dayMap.get(dateKey);
        day.count += 1;
        if (ip) day.ips.add(ip);

        if (!locationMap.has(label)) locationMap.set(label, { label, count: 0, ips: new Set() });
        const loc = locationMap.get(label);
        loc.count += 1;
        if (ip) loc.ips.add(ip);
    });

    const byDay = [...dayMap.values()]
        .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1))
        .map((d) => ({ dateKey: d.dateKey, count: d.count, uniqueIp: d.ips.size }));

    const byLocation = [...locationMap.values()]
        .sort((a, b) => b.count - a.count || b.ips.size - a.ips.size || a.label.localeCompare(b.label))
        .map((l) => ({ label: l.label, count: l.count, uniqueIp: l.ips.size }));

    return {
        totalCount: (logs || []).length,
        uniqueIp: uniqueIps.size,
        byDay,
        byLocation,
        topLocation: byLocation[0] || null
    };
}

function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** CSV(엑셀) 문자열 — BOM 은 저장 단계에서 붙입니다. */
export function buildCsv(logs, options = {}) {
    const { maskIps = true } = options;
    const headers = ['No', '접속일시(KST)', 'IP', '국가', '지역(시·도)', '도시', '위치 라벨', '기기', '접속일(dateKey)'];
    const lines = [headers.map(csvCell).join(',')];
    (logs || []).forEach((log, idx) => {
        lines.push([
            idx + 1,
            String(log.accessedAt || '').trim() || formatKstDateTime(Number(log.accessedAtMs)),
            maskIps ? maskIp(log.ip) : String(log.ip || ''),
            log.country || '',
            log.region || '',
            log.city || '',
            buildLocationLabel(log),
            log.device === 'desktop' ? 'PC' : (log.device || ''),
            log.dateKey || kstDateKey(Number(log.accessedAtMs) || 0)
        ].map(csvCell).join(','));
    });
    return lines.join('\r\n');
}

/** Markdown 리포트 문자열 */
export function buildMarkdown({ logs, summary, days, dateKeys, generatedAt = Date.now(), device = 'desktop', maskIps = true, source = 'Firestore visitor_ip_logs' }) {
    const safeSummary = summary || summarizeVisitorLogs(logs, dateKeys);
    const rangeLabel = `${dateKeys[0]} ~ ${dateKeys[dateKeys.length - 1]} (KST, 최근 ${days}일)`;
    const deviceLabel = device === 'desktop' ? 'PC(데스크톱)' : device === 'all' ? '전체 기기' : device;
    const total = safeSummary.totalCount;
    const top = safeSummary.topLocation;
    const pct = (n) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%');

    const rows = (logs || []).map((log, idx) => {
        const location = buildLocationLabel(log).replace(/\|/g, '\\|');
        const ip = maskIps ? maskIp(log.ip) : String(log.ip || '');
        const when = String(log.accessedAt || '').trim() || formatKstDateTime(Number(log.accessedAtMs));
        return `| ${idx + 1} | ${when} | ${ip} | ${log.country || '-'} | ${log.region || '-'} | ${log.city || '-'} |`;
    });

    return [
        `# 🖥️ 최근 ${days}일 PC 접속자 위치 리스트`,
        '',
        `> **조회 기간**: ${rangeLabel}`,
        `> **생성 시각**: ${formatKstDateTime(generatedAt)} KST`,
        `> **수집 기준**: ${source} · 대상 기기: ${deviceLabel}`,
        `> **개인정보**: ${maskIps ? 'IP 마지막 자리 마스킹(기본)' : 'IP 원문 표시(--full-ip)'}`,
        '',
        '## 1. 요약',
        '',
        '| 항목 | 값 |',
        '| --- | --- |',
        `| PC 접속 기록 | **${total.toLocaleString('ko-KR')}건** |`,
        `| 고유 IP | ${safeSummary.uniqueIp.toLocaleString('ko-KR')}개 |`,
        `| 1위 지역 | ${top ? `${top.label} (${top.count}건)` : '-'} |`,
        `| 기록 있는 날짜 | ${safeSummary.byDay.filter((d) => d.count > 0).map((d) => `${formatDayLabel(d.dateKey)} ${d.count}건`).join(' · ') || '없음'} |`,
        '',
        '## 2. 날짜별 접속',
        '',
        '| 날짜 | 접속 건수 | 고유 IP |',
        '| --- | ---: | ---: |',
        ...safeSummary.byDay.map((d) => `| ${formatDayLabel(d.dateKey)} | ${d.count.toLocaleString('ko-KR')} | ${d.uniqueIp.toLocaleString('ko-KR')} |`),
        '',
        '## 3. 지역별 순위',
        '',
        '| 순위 | 위치 | 접속 | 고유 IP | 비중 |',
        '| ---: | --- | ---: | ---: | ---: |',
        ...(safeSummary.byLocation.length
            ? safeSummary.byLocation.slice(0, 15).map((l, i) => `| ${i + 1} | ${l.label} | ${l.count.toLocaleString('ko-KR')} | ${l.uniqueIp.toLocaleString('ko-KR')} | ${pct(l.count)} |`)
            : ['| - | 기록 없음 | 0 | 0 | 0% |']),
        '',
        '## 4. 상세 목록',
        '',
        total === 0
            ? '_최근 기간에 기록된 PC 접속 위치가 없습니다._'
            : ['| No | 접속일시(KST) | IP | 국가 | 지역(시·도) | 도시 |', '| ---: | --- | --- | --- | --- | --- |', ...rows].join('\n'),
        '',
        '---',
        '',
        '※ 위치는 IP 기반 추정값이라 실제 PC 위치와 다를 수 있습니다. VPN·공유망 이용 시에는 접속망 지역으로 표시됩니다.',
        '※ 기록은 앱 접속 비콘 기준이며, 같은 IP 는 30분 간격으로만 새로 기록됩니다.'
    ].join('\n');
}

/** --demo 용 예시 로그 (실제 데이터 아님) */
export function buildDemoLogs(nowMs = Date.now()) {
    const { sinceMs } = buildDayWindow(3, nowMs);
    const samples = [
        ['121.130.45.12', '대한민국', '부산광역시', '해운대구', 0.15],
        ['121.130.45.12', '대한민국', '부산광역시', '해운대구', 0.45],
        ['175.223.11.87', '대한민국', '부산광역시', '강서구', 0.95],
        ['211.234.77.4', '대한민국', '부산광역시', '남구', 1.25],
        ['211.234.77.4', '대한민국', '부산광역시', '남구', 1.55],
        ['58.121.9.203', '대한민국', '경상남도', '창원시', 1.85],
        ['182.212.34.55', '대한민국', '서울특별시', '송파구', 2.05],
        ['104.28.61.9', '미국', 'California', 'Los Angeles', 2.25],
        ['121.130.45.12', '대한민국', '부산광역시', '해운대구', 2.55],
        ['49.165.88.31', '대한민국', '부산광역시', '사하구', 2.85]
    ];
    return samples.map(([ip, country, region, city, dayAgo], idx) => {
        const ms = Math.round(nowMs - dayAgo * 86400000);
        return {
            id: `demo-${idx + 1}`,
            ip,
            country,
            region,
            city,
            device: 'desktop',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Demo',
            dateKey: kstDateKey(ms),
            accessedAtMs: ms,
            accessedAt: formatKstDateTime(ms)
        };
    }).filter((l) => l.accessedAtMs >= sinceMs);
}

/** Firestore 에서 최근 N일 방문 로그를 읽어옵니다. (firebase-admin 동적 임포트) */
async function fetchLogsFromFirestore({ days, device, limit }) {
    const { sinceMs, dateKeys } = buildDayWindow(days);
    let adminApp;
    let adminFirestore;
    try {
        adminApp = await import('firebase-admin/app');
        adminFirestore = await import('firebase-admin/firestore');
    } catch (e) {
        throw new Error('firebase-admin 패키지를 찾을 수 없습니다. 저장소 루트에서 `npm install` 을 먼저 실행하세요.');
    }
    const rawKey = String(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim();
    if (adminApp.getApps().length === 0) {
        if (rawKey) {
            const decoded = rawKey.startsWith('{') ? rawKey : Buffer.from(rawKey, 'base64').toString('utf-8');
            adminApp.initializeApp({ credential: adminApp.cert(JSON.parse(decoded)) });
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            adminApp.initializeApp({});
        } else {
            throw new Error(
                '인증 정보가 없습니다. FIREBASE_SERVICE_ACCOUNT_KEY(JSON 또는 Base64) 또는 ' +
                'GOOGLE_APPLICATION_CREDENTIALS(키 파일 경로)를 지정하세요. 형식만 확인하려면 --demo 를 사용하세요.'
            );
        }
    }
    const db = adminFirestore.getFirestore();
    const collection = db.collection('visitor_ip_logs');
    // 복합 인덱스(device ASC · accessedAtMs DESC) 활용 → 없으면 단계적으로 완화
    const builders = [];
    if (device && device !== 'all') {
        builders.push(() => collection.where('device', '==', device).where('accessedAtMs', '>=', sinceMs).orderBy('accessedAtMs', 'desc').limit(limit).get());
        builders.push(() => collection.where('device', '==', device).orderBy('accessedAtMs', 'desc').limit(limit * 2).get());
    }
    builders.push(() => collection.where('accessedAtMs', '>=', sinceMs).orderBy('accessedAtMs', 'desc').limit(limit * 2).get());
    builders.push(() => collection.orderBy('accessedAtMs', 'desc').limit(limit * 3).get());

    let snap = null;
    let lastErr = null;
    for (const build of builders) {
        try {
            snap = await build();
            break;
        } catch (err) {
            lastErr = err;
            const msg = String(err?.message || err);
            if (!(/index/i.test(msg) || err?.code === 'failed-precondition' || err?.code === 'invalid-argument')) throw err;
        }
    }
    if (!snap) throw lastErr || new Error('visitor_logs_query_failed');
    let logs = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    logs = logs.filter((l) => Number(l.accessedAtMs) >= sinceMs);
    if (device && device !== 'all') logs = logs.filter((l) => l.device === device);
    logs.sort((a, b) => Number(b.accessedAtMs || 0) - Number(a.accessedAtMs || 0));
    return { logs: logs.slice(0, limit), dateKeys, sinceMs };
}

function parseArgs(argv) {
    const args = { days: 3, device: 'desktop', demo: false, fullIp: false, limit: 2000, outDir: path.join(REPO_ROOT, 'reports'), write: true };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--demo') args.demo = true;
        else if (arg === '--full-ip') args.fullIp = true;
        else if (arg === '--no-write') args.write = false;
        else if (arg.startsWith('--days')) args.days = Number(arg.includes('=') ? arg.split('=')[1] : argv[++i]) || 3;
        else if (arg.startsWith('--device')) args.device = String(arg.includes('=') ? arg.split('=')[1] : argv[++i] || 'desktop');
        else if (arg.startsWith('--limit')) args.limit = Number(arg.includes('=') ? arg.split('=')[1] : argv[++i]) || 2000;
        else if (arg.startsWith('--out')) args.outDir = path.resolve(REPO_ROOT, arg.includes('=') ? arg.split('=')[1] : argv[++i] || 'reports');
        else if (arg === '--help' || arg === '-h') args.help = true;
    }
    return args;
}

function printHelp() {
    console.log(`최근 N일 PC 접속자 위치 리스트 생성기

  node scripts/pc-visitor-report.mjs [옵션]

옵션
  --days <1~31>     조회 기간 (기본 3일, 오늘 포함)
  --device <값>     desktop(기본) | android | ios | all
  --limit <n>       최대 조회 건수 (기본 2000)
  --out <폴더>      결과물 저장 위치 (기본 reports/)
  --full-ip         IP 마스킹 해제 (기본은 마지막 자리 마스킹)
  --no-write        파일로 저장하지 않고 콘솔에만 출력
  --demo            예시 데이터로 형식 확인 (Firestore 접속 불필요)
`);
}

function printConsoleList(logs, summary, days, dateKeys, maskIps) {
    const rangeLabel = `${dateKeys[0]} ~ ${dateKeys[dateKeys.length - 1]}`;
    console.log('');
    console.log(`🖥️  최근 ${days}일 PC 접속자 위치 리스트  (${rangeLabel} KST)`);
    console.log(`    총 ${summary.totalCount}건 · 고유 IP ${summary.uniqueIp}개` + (summary.topLocation ? ` · 1위 ${summary.topLocation.label}(${summary.topLocation.count}건)` : ''));
    console.log('');
    if (logs.length === 0) {
        console.log('   (해당 기간에 기록된 접속 위치가 없습니다)');
        return;
    }
    console.log('  No.  접속일시(KST)        IP                 위치                                  기기');
    console.log('  ' + '-'.repeat(96));
    logs.slice(0, 100).forEach((log, idx) => {
        const ip = maskIps ? maskIp(log.ip) : String(log.ip || '');
        const when = String(log.accessedAt || '').trim() || formatKstDateTime(Number(log.accessedAtMs));
        const location = buildLocationLabel(log);
        console.log(`  ${String(idx + 1).padStart(3)}  ${when.padEnd(18)} ${ip.padEnd(18)} ${location.padEnd(36)} ${log.device === 'desktop' ? 'PC' : (log.device || '')}`);
    });
    if (logs.length > 100) console.log(`  ... 외 ${logs.length - 100}건 (파일에서 전체 확인)`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }
    const nowMs = Date.now();
    const { dateKeys, days } = buildDayWindow(args.days, nowMs);
    const maskIps = !args.fullIp;

    let logs;
    let source;
    if (args.demo) {
        logs = buildDemoLogs(nowMs);
        source = '예시 데이터(--demo · 실제 방문 기록 아님)';
    } else {
        const fetched = await fetchLogsFromFirestore({ days, device: args.device, limit: args.limit });
        logs = fetched.logs.map((log) => ({
            ...log,
            accessedAt: String(log.accessedAt || '').trim() || formatKstDateTime(Number(log.accessedAtMs))
        }));
        source = 'Firestore visitor_ip_logs';
    }

    const summary = summarizeVisitorLogs(logs, dateKeys);
    printConsoleList(logs, summary, days, dateKeys, maskIps);

    if (!args.write) return;

    await fs.mkdir(args.outDir, { recursive: true });
    const todayKey = kstDateKey(nowMs);
    const baseName = args.demo ? `pc-visitors-demo` : `pc-visitors-${todayKey}`;
    const mdPath = path.join(args.outDir, `${baseName}.md`);
    const csvPath = path.join(args.outDir, `${baseName}.csv`);
    const markdown = buildMarkdown({ logs, summary, days, dateKeys, generatedAt: nowMs, device: args.demo ? 'desktop' : args.device, maskIps, source });
    await fs.writeFile(mdPath, markdown + '\n', 'utf8');
    await fs.writeFile(csvPath, '\uFEFF' + buildCsv(logs, { maskIps }) + '\r\n', 'utf8');
    console.log('');
    console.log(`📄 저장 완료: ${path.relative(REPO_ROOT, mdPath)}`);
    console.log(`📊 저장 완료: ${path.relative(REPO_ROOT, csvPath)}`);
}

const isCliEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCliEntry) {
    main().catch((err) => {
        console.error(`❌ 리포트 생성 실패: ${err?.message || err}`);
        process.exitCode = 1;
    });
}
