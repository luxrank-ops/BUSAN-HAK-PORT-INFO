import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCsv,
    buildDayWindow,
    buildLocationLabel,
    buildMarkdown,
    buildDemoLogs,
    formatDayLabel,
    kstDateKey,
    localizeVisitorLocation,
    maskIp,
    summarizeVisitorLogs
} from './pc-visitor-report.mjs';
import { extractDeclaration, extractFunction, readAppJs } from './app-source.mjs';

// 최근 3일 PC 접속자 위치 리스트 — CLI 리포트 생성기 + 앱 화면 연결 검증.
const NOW_MS = Date.UTC(2026, 9, 23, 3, 0, 0); // 2026-10-23 12:00 KST
const HTML = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const APP_JS = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const SERVER_TS = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function fixtureLogs() {
    return [
        { ip: '121.130.45.12', country: '대한민국', region: '부산광역시', city: '해운대구', device: 'desktop', accessedAtMs: Date.UTC(2026, 9, 23, 2, 10), accessedAt: '2026-10-23 11:10' },
        { ip: '121.130.45.12', country: '대한민국', region: '부산광역시', city: '해운대구', device: 'desktop', accessedAtMs: Date.UTC(2026, 9, 22, 6, 0), accessedAt: '2026-10-22 15:00' },
        { ip: '211.234.77.4', country: '대한민국', region: '부산광역시', city: '남구', device: 'desktop', accessedAtMs: Date.UTC(2026, 9, 21, 1, 30), accessedAt: '2026-10-21 10:30' },
        { ip: '104.28.61.9', country: '미국', region: 'California', city: 'Los Angeles', device: 'desktop', accessedAtMs: Date.UTC(2026, 9, 20, 1, 30), accessedAt: '2026-10-20 10:30' }
    ].map((log, idx) => ({ ...log, id: `row-${idx + 1}`, dateKey: kstDateKey(log.accessedAtMs) }));
}

test('buildDayWindow — 오늘 포함 최근 3일 창을 KST 자정 기준으로 만든다', () => {
    const { dateKeys, sinceMs, days } = buildDayWindow(3, NOW_MS);
    assert.deepEqual(dateKeys, ['2026-10-21', '2026-10-22', '2026-10-23']);
    assert.equal(days, 3);
    assert.equal(sinceMs, Date.UTC(2026, 9, 20, 15, 0, 0)); // 2026-10-21 00:00 KST
    assert.equal(buildDayWindow(1, NOW_MS).dateKeys.length, 1);
    assert.equal(buildDayWindow(99, NOW_MS).dateKeys.length, 31, '과도한 값은 31일로 제한');
});

test('maskIp / buildLocationLabel — 개인정보 마스킹과 위치 라벨', () => {
    assert.equal(maskIp('121.130.45.12'), '121.130.45.***');
    assert.equal(maskIp('2001:db8:85a3::8a2e:370:7334'), '2001:db8:85a3:****');
    assert.equal(maskIp(''), '-');
    assert.equal(buildLocationLabel({ country: '대한민국', region: '부산광역시', city: '해운대구' }), '대한민국 › 부산광역시 › 해운대구');
    assert.equal(buildLocationLabel({ country: 'Busan', region: 'Busan', city: 'Busan' }), 'Busan', '중복 값은 한 번만');
    assert.equal(buildLocationLabel({}), '위치 미확인');
    assert.deepEqual(localizeVisitorLocation({ country: 'South Korea', region: 'Busan', city: 'Haeundae-gu' }), {
        country: '대한민국',
        region: '부산광역시',
        city: '해운대구'
    });
    assert.equal(buildLocationLabel(localizeVisitorLocation({ country: 'South Korea', region: 'Busan', city: 'Busan' })), '대한민국 › 부산광역시');
});

test('summarizeVisitorLogs — 건수·고유 IP·날짜별·지역별 집계', () => {
    const { dateKeys } = buildDayWindow(3, NOW_MS);
    const summary = summarizeVisitorLogs(fixtureLogs(), dateKeys);
    assert.equal(summary.totalCount, 4);
    assert.equal(summary.uniqueIp, 3);
    assert.deepEqual(summary.byDay.map((d) => [d.dateKey, d.count]), [
        ['2026-10-23', 1],
        ['2026-10-22', 1],
        ['2026-10-21', 1],
        ['2026-10-20', 1]
    ], '최신 날짜가 먼저 오고, 창 밖(10-20) 기록은 별도 날짜로 남는다');
    assert.equal(summary.byDay.find((d) => d.dateKey === '2026-10-23').uniqueIp, 1);
    assert.deepEqual(summary.byLocation.map((l) => l.count), [2, 1, 1]);
    assert.equal(summary.topLocation.label, '대한민국 › 부산광역시 › 해운대구');
});

test('buildCsv — 헤더·행 수·마스킹 정책', () => {
    const logs = fixtureLogs();
    const masked = buildCsv(logs);
    const lines = masked.split('\r\n');
    assert.equal(lines.length, logs.length + 1);
    assert.match(lines[0], /^"No","접속일시\(KST\)","IP"/);
    assert.match(lines[1], /"121\.130\.45\.\*\*\*"/);
    assert.doesNotMatch(masked, /121\.130\.45\.12/);
    const full = buildCsv(logs, { maskIps: false });
    assert.match(full, /"121\.130\.45\.12"/, '--full-ip 는 원문 IP');
    assert.match(lines[1], /"PC"/);
});

test('buildMarkdown — 요약·날짜별·지역 순위·상세 표를 모두 담는다', () => {
    const logs = fixtureLogs();
    const { dateKeys, days } = buildDayWindow(3, NOW_MS);
    const summary = summarizeVisitorLogs(logs, dateKeys);
    const md = buildMarkdown({ logs, summary, days, dateKeys, generatedAt: NOW_MS });
    assert.match(md, /^# 🖥️ 최근 3일 PC 접속자 위치 리스트/);
    assert.match(md, /조회 기간\*\*: 2026-10-21 ~ 2026-10-23/);
    assert.match(md, /PC 접속 기록 \| \*\*4건\*\*/);
    assert.match(md, /## 2\. 날짜별 접속/);
    assert.match(md, /## 3\. 지역별 순위/);
    assert.match(md, /## 4\. 상세 목록/);
    assert.match(md, /10-23 \(금\)/);
    assert.match(md, /121\.130\.45\.\*\*\*/);
    assert.doesNotMatch(md, /121\.130\.45\.12/);
    assert.match(md, /IP 기반 추정값/);
});

test('buildDemoLogs — 3일 창 안의 예시 데이터만 돌려준다', () => {
    const logs = buildDemoLogs(NOW_MS);
    const { sinceMs } = buildDayWindow(3, NOW_MS);
    assert.ok(logs.length >= 8);
    assert.ok(logs.every((l) => l.accessedAtMs >= sinceMs));
    assert.ok(logs.every((l) => l.device === 'desktop'));
});

test('CLI — --demo --no-write 로 콘솔 표를 출력한다', () => {
    const out = execFileSync(
        process.execPath,
        [fileURLToPath(new URL('./pc-visitor-report.mjs', import.meta.url)), '--demo', '--no-write'],
        { encoding: 'utf8' }
    );
    assert.match(out, /최근 3일 PC 접속자 위치 리스트/);
    assert.match(out, /총 \d+건 · 고유 IP \d+개/);
    assert.match(out, /121\.130\.45\.\*\*\*/, '기본은 IP 마스킹');
});

test('앱 연결 — 관리자 화면·API·npm 스크립트 배선', () => {
    assert.match(HTML, /id="statsVisitorIpRange"/);
    assert.match(HTML, /최근 3일 PC 접속자 위치 리스트/);
    assert.match(HTML, /onclick="downloadPcVisitorLocationCsv\(\)"/);
    assert.match(HTML, /onclick="copyPcVisitorLocationReport\(\)"/);
    assert.match(HTML, /onclick="togglePcVisitorIpMask\(\)"/);
    assert.match(APP_JS, /async function loadPcVisitorLocationList/);
    assert.match(APP_JS, /\/api\/visitor-logs\?device=desktop&days=\$\{pcVisitorLocationState\.days\}/);
    assert.match(APP_JS, /function buildPcVisitorLocationReportText/);
    assert.match(SERVER_TS, /const days = Math\.min\(7, Math\.max\(1,/, '서버가 days 파라미터를 지원');
    assert.match(SERVER_TS, /summarizeVisitorLogs,[\s\S]{0,80}from '\.\/scripts\/pc-visitor-report\.mjs'/, 'API 가 CLI 와 같은 집계 함수를 재사용');
    assert.match(SERVER_TS, /locationLabel:/);
    assert.equal(PKG.scripts['visitor:report'], 'node scripts/pc-visitor-report.mjs');
});

test('앱 렌더링 — 최근 3일 목록 마크업과 리포트 텍스트', () => {
    const appJs = readAppJs();
    const elements = {
        statsVisitorIpLogs: { innerHTML: '' },
        statsVisitorIpSummary: { innerText: '' },
        statsVisitorIpSummaryCards: { innerHTML: '' }
    };
    const sandbox = {
        document: { getElementById: (id) => elements[id] || null },
        showToast: () => {},
        getVisitorDateKey: () => '2026-10-23',
        Number, String, Array, Object, Math, Date, JSON, Set, Map, console, navigator: {}
    };
    const context = vm.createContext(sandbox);
    const declaration = extractDeclaration(appJs, 'pcVisitorLocationState');
    assert.ok(declaration, 'pcVisitorLocationState 선언을 찾을 수 있어야 한다');
    // vm 컨텍스트에서 sandbox 속성으로 접근하려면 var 선언이어야 한다 (원본은 const).
    const sharedDeclaration = declaration.replace(/^const\s+/, 'var ');
    const funcs = [
        'maskVisitorIp',
        'escapePcVisitorText',
        'formatPcVisitorDayLabel',
        'renderPcVisitorLocationRank',
        'renderPcVisitorSummaryCards',
        'getPcVisitorIpText',
        'pcVisitorRowTags',
        'pcVisitorKindLabel',
        'renderStatsVisitorIpLogs',
        'buildPcVisitorLocationReportText'
    ].map((name) => {
        const body = extractFunction(appJs, name);
        assert.ok(body, `함수 추출 실패: ${name}`);
        return body;
    });
    vm.runInContext([sharedDeclaration, ...funcs].join('\n'), context);

    const logs = fixtureLogs().filter((l) => l.accessedAtMs >= buildDayWindow(3, NOW_MS).sinceMs);
    sandbox.pcVisitorLocationState.logs = logs;
    sandbox.pcVisitorLocationState.days = 3;
    sandbox.pcVisitorLocationState.rangeLabel = '2026-10-21 ~ 2026-10-23 (KST, 최근 3일)';
    sandbox.pcVisitorLocationState.summary = summarizeVisitorLogs(logs, buildDayWindow(3, NOW_MS).dateKeys);
    vm.runInContext('renderStatsVisitorIpLogs(pcVisitorLocationState.logs);', context);

    const html = elements.statsVisitorIpLogs.innerHTML;
    assert.match(html, /📅 10-23 \(금\)/);
    assert.match(html, /121\.130\.45\.\*\*\*/);
    assert.doesNotMatch(html, /121\.130\.45\.12/, '기본은 IP 마스킹');
    assert.match(html, /부산광역시 › 해운대구/);
    assert.match(html, /IP 전체 보기/);
    assert.match(elements.statsVisitorIpSummaryCards.innerHTML, /고유 IP/);
    assert.match(elements.statsVisitorIpSummary.innerText, /최근 3일|총 3건/);

    const report = vm.runInContext('buildPcVisitorLocationReportText()', context);
    assert.match(report, /최근 3일 PC 접속자 위치 리스트/);
    assert.match(report, /지역 TOP 5/);
    assert.match(report, /121\.130\.45\.\*\*\*/);
});
