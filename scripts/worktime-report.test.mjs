import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { APP_JS_FILES, readAppJs, readAppFile, extractFunction as extractFunctionShared } from './app-source.mjs';

// 월단위 작업시간 · 시간대별 책정 금액 리포트 검증.
// 실제 앱 코드(public/js/* 전역 스크립트, A-1 분리 전에는 index.html 인라인)에서 함수를 꺼내 실행한다.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appJs = readAppJs();

function extractFunction(name) {
    const body = extractFunctionShared(appJs, name);
    if (body === null) throw new Error(`function not found: ${name}`);
    return body;
}

const context = vm.createContext({ Number, String, Array, Object, Date, RegExp, Math, Set, Map, console });
vm.runInContext(
    ['extractWorkLogTimeAndWageMetrics', 'aggregateWorkTimeMetrics', 'formatWorkHours']
        .map(extractFunction).join('\n'),
    context
);
const extract = context.extractWorkLogTimeAndWageMetrics;
const aggregate = context.aggregateWorkTimeMetrics;

test('리포트 컨테이너와 월단위 종합표가 스마트 정산 리포트 안에 있다', () => {
    // A-1 (2026-10-17): 컨테이너는 정적 마크업(index.html), 테이블·버튼 라벨은 app.js 템플릿
    assert.match(html, /id="monthlyWorkTimeReportContainer"/);
    assert.match(appJs, /월단위 작업시간 · 시간대별 책정 금액 종합표/);
    assert.match(appJs, /작업시간 리포트 복사/);
    assert.match(appJs, /1~12월 전체 보기/);
});

test('임금계산기 연동 요약(총/주간/야간/주말)을 시간대별 금액으로 분리한다', () => {
    const wt = extract({
        date: '2026-05-05',
        wage1: 170000, wage2: 0, totalPay: 170000,
        memo: '[본선] 2026-05-05 08시~2026-05-05 21시 · 총 13H (주간 10H / 야간 3H / 주말·공휴일 2H)'
    });
    assert.equal(wt.source, 'calc');
    assert.equal(wt.totalHours, 13);
    assert.equal(wt.dayHours, 10);
    assert.equal(wt.nightHours, 3);
    assert.equal(wt.weekendHours, 2);
    assert.equal(wt.dayAmt, 10 * 10320);
    assert.equal(wt.nightAmt, Math.round(3 * 10320 * 1.5));
    assert.equal(wt.weekendAmt, Math.round(2 * 10320 * 0.5));
    // 총액 - (주간+야간+주말) 잔액은 기능공·기타 가산으로 잡힌다
    assert.equal(wt.extraAmt, 170000 - wt.dayAmt - wt.nightAmt - wt.weekendAmt);
    assert.equal(wt.totalPay, 170000);
});

test('더블오더 선박 입·출항 시각으로 주·야간을 나눈다', () => {
    const wt = extract({
        date: '2026-10-08',
        wage1: 0, wage2: 0, totalPay: 0,
        memo: '🚢 더블오더 작업 (선박 2척 · 합계 5H)\n① SHIP ALPHA · 입항 2026-10-08 08:00 → 출항 2026-10-08 10:00 · 2H\n② SHIP BETA · 입항 2026-10-08 18:00 → 출항 2026-10-08 21:00 · 3H'
    });
    assert.equal(wt.source, 'double');
    assert.equal(wt.totalHours, 5);
    // 10~12월 주간은 07~17시: 08~10시는 주간 2H, 18~21시는 야간 3H
    assert.equal(wt.dayHours, 2);
    assert.equal(wt.nightHours, 3);
});

test('메모의 수기 시간(주간/야간 X시간)도 읽는다', () => {
    const wt = extract({
        date: '2026-03-10', totalPay: 0, wage1: 0, wage2: 0,
        memo: '주간 8시간 야간 4시간 작업'
    });
    assert.equal(wt.source, 'memo');
    assert.equal(wt.totalHours, 12);
    assert.equal(wt.dayHours, 8);
    assert.equal(wt.nightHours, 4);
});

test('금액만 있는 기록은 계절별 시간표 기준으로 시간을 추정하고 표시한다', () => {
    // 2026-01-05(월): 1~3월 주간 08~18시, 주간 8H = 82,560원
    const wt = extract({ date: '2026-01-05', totalPay: 82560, wage1: 82560, wage2: 0, memo: '' });
    assert.equal(wt.source, 'estimate');
    assert.equal(wt.estimated, true);
    assert.equal(wt.totalHours, 8);
    assert.equal(wt.dayHours, 8);
});

test('기능공 표기가 있는 기록은 기능공 수당(skilledAmt)과 기타 가산(extraAmt)을 분리한다', () => {
    // 기능공 주간 10H: 기능공 수당 = 10 * 2557 = 25,570원
    const dayAmt = 10 * 10320;
    const skilledAmt = 10 * 2557;
    const wt = extract({
        date: '2026-05-06',
        wage1: dayAmt + skilledAmt + 5000, wage2: 0, totalPay: dayAmt + skilledAmt + 5000,
        memo: '[기능공] 2026-05-06 08시~2026-05-06 18시 · 총 10H (주간 10H / 야간 0H)'
    });
    assert.equal(wt.skilledAmt, skilledAmt);
    assert.equal(wt.extraAmt, 5000);
    // 기능공 표기가 없으면 잔액 전액이 기타 가산
    const plain = extract({
        date: '2026-05-06',
        wage1: dayAmt + 5000, wage2: 0, totalPay: dayAmt + 5000,
        memo: '[본선] 2026-05-06 08시~2026-05-06 18시 · 총 10H (주간 10H / 야간 0H)'
    });
    assert.equal(plain.skilledAmt, 0);
    assert.equal(plain.extraAmt, 5000);
});

test('월 단위 집계가 시간·금액·출근일수를 합산한다', () => {
    const agg = aggregate([
        { date: '2026-05-05', totalPay: 170000, wage1: 170000, wage2: 0, memo: '총 13H (주간 10H / 야간 3H / 주말·공휴일 2H)' },
        { date: '2026-05-06', totalPay: 82560, wage1: 0, wage2: 82560, memo: '주간 8시간' }
    ]);
    assert.equal(agg.days, 2);
    assert.equal(agg.totalHours, 21);
    assert.equal(agg.dayHours, 18);
    assert.equal(agg.nightHours, 3);
    assert.equal(agg.weekendHours, 2);
    assert.equal(agg.totalPay, 252560);
    assert.equal(context.formatWorkHours(agg.totalHours), '21H');
});

const sumAmounts = wt => wt.dayAmt + wt.nightAmt + wt.weekendAmt + wt.skilledAmt + wt.extraAmt;

test('재계산 메모는 임금 슬롯별 마지막 요약만 사용하고 더블오더는 보존한다', () => {
    const wt = extract({ totalPay: 200000, memo: [
        '총 12H (주간 10H / 야간 2H)',
        '총 8H (주간 8H / 야간 0H)',
        '[더블오더 · 임금 2 · B] 총 4H (주간 0H / 야간 4H)',
        '[더블오더 · 임금 2 · B] 총 3H (주간 0H / 야간 3H)'
    ].join('\n') });
    assert.equal(wt.totalHours, 11);
    assert.equal(wt.dayHours, 8);
    assert.equal(wt.nightHours, 3);
});

test('공제·수기 수정·추정 기록의 책정액 합계는 실제 총액과 일치한다', () => {
    for (const log of [
        { totalPay: 80001, memo: '총 12H (주간 8H / 야간 4H / 주말·공휴일 12H)' },
        { totalPay: 1000, memo: '[기능공] 주간 8시간' },
        { date: '2026-01-05', totalPay: 80000, memo: '' },
        { totalPay: 1, memo: '주간 8시간 야간 4시간' },
        { totalPay: 500, memo: '' }
    ]) {
        const wt = extract(log);
        assert.equal(sumAmounts(wt), log.totalPay);
        for (const key of ['dayAmt', 'nightAmt', 'weekendAmt', 'skilledAmt', 'extraAmt']) {
            assert.ok(Number.isInteger(wt[key]) && wt[key] >= 0, key);
        }
    }
});

test('명시적인 총액 0은 과거 임금 필드로 되살리지 않는다', () => {
    const wt = extract({ totalPay: 0, wage1: 100000, memo: '주간 8시간' });
    assert.equal(wt.totalPay, 0);
    assert.equal(sumAmounts(wt), 0);
    const legacy = extract({ wage1: 10000, wage2: 20000 });
    assert.equal(legacy.totalPay, 30000);
    assert.equal(sumAmounts(legacy), 30000);
});

test('분 단위 스케줄은 주야간 경계에서 정확히 나눈다', () => {
    const wt = extract({ date: '2026-10-08', totalPay: 0,
        memo: '① A · 입항 2026-10-08 16:30 → 출항 2026-10-08 18:00' });
    assert.equal(wt.totalHours, 1.5);
    assert.equal(wt.dayHours, 0.5);
    assert.equal(wt.nightHours, 1);
});

test('A-1: 집계 함수는 전역 스크립트(app.js)에 단일 사본으로 유지된다', () => {
    for (const name of ['extractWorkLogTimeAndWageMetrics', 'aggregateWorkTimeMetrics']) {
        const fn = extractFunction(name);
        assert.ok(fn, `${name} must exist in the live source`);
        const copies = APP_JS_FILES.filter((file) => readAppFile(file).includes(`function ${name}(`));
        assert.deepEqual(copies, ['public/js/app.js'], `${name} 사본 위치가 바뀌었습니다: ${copies.join(', ')}`);
    }
});
