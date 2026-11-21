import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_ASSET_VERSION, readAppHtml, readAppFile } from './app-source.mjs';

// 📢 주소 이전 안내(2026-11-22) 회귀 방지
// - 기존 주소(vercel.app) 접속자 : 상단 공지 배너 + 접속 안내 팝업
// - 새 주소(workers.dev) 접속자  : 홈 화면 추가 권장 배너만 (이전 팝업 없음)
// - 도메인 판별·'오늘 하루 보지 않기' 저장은 public/js/domain-migration.js 가 담당합니다.

const html = readAppHtml();
const js = readAppFile('public/js/domain-migration.js');
const css = readAppFile('public/css/app.css');
const sw = readAppFile('public/service-worker.js');

const NEW_HOST = 'busan-hak-port-info.luxrank.workers.dev';
const LEGACY_HOST = 'busan-hak-port-info.vercel.app';

test('상단 공지 배너와 접속 안내 팝업 마크업이 index.html 에 있다', () => {
    ['migrationNoticeBar', 'migrationBarTitle', 'migrationBarClose', 'migrationBarAction',
        'migrationModal', 'migrationModalTitle', 'migrationGoBtn', 'migrationCopyBtn',
        'migrationHideToday', 'migrationCloseBtn'].forEach((id) => {
        assert.ok(html.includes(`id="${id}"`), `#${id} 가 index.html 에 없습니다`);
    });
    // 팝업은 처음에 숨김 상태로 시작해야 합니다(도메인 판별 후 JS 가 엽니다).
    assert.match(html, /id="migrationModal"[^>]*style="display:none;"/, '팝업 초기 상태는 display:none 이어야 합니다');
    assert.match(html, /id="migrationModal"[^>]*role="dialog"/, '팝업에 role="dialog" 가 필요합니다');
});

test('안내 문구에 새 주소·기존 주소·12월 20일 종료가 들어 있다', () => {
    assert.ok(html.includes(NEW_HOST), '새 주소가 마크업에 없습니다');
    assert.ok(html.includes(LEGACY_HOST), '기존 주소가 마크업에 없습니다');
    assert.ok(html.includes('2026년 12월 20일(일)'), '기존 주소 종료일이 없습니다');
    assert.ok(html.includes('그대로 유지'), '기존 기록 유지 안내가 없습니다');
    assert.ok(html.includes('홈 화면 아이콘은'), '홈 화면 재추가 안내가 없습니다');
});

test('배너·팝업 닫힘 상태는 localStorage 에 저장한다', () => {
    assert.match(js, /localStorage\.setItem/);
    assert.match(js, /hakportMigrationPopupHideUntil/, '팝업 "오늘 하루 보지 않기" 키가 없습니다');
    assert.match(js, /hakportMigrationBarHideUntil/, '배너 닫힘 키가 없습니다');
    assert.match(js, /setHours\(23, 59, 59/, "'오늘 하루'는 자정까지 유지되어야 합니다");
});

test('새 주소 접속자에게는 이전 팝업을 띄우지 않는다', () => {
    assert.ok(js.includes('workers.dev'), 'workers.dev 호스트 판별이 없습니다');
    const earlyReturn = js.match(/if \(isNewHost\(\)\) return;/);
    assert.ok(earlyReturn, '새 주소에서는 팝업을 열지 않고 빠져나가야 합니다');
    // 팝업을 여는 popupOpen 호출은 새 주소 조기 반환 뒤에 있어야 합니다.
    assert.ok(js.indexOf('if (isNewHost()) return;') < js.indexOf('setTimeout(popupOpen'), '팝업 호출 순서가 잘못되었습니다');
});

test('주소 복사는 클립보드 API 실패 시 폴백을 쓴다', () => {
    assert.match(js, /navigator\.clipboard\.writeText/);
    assert.match(js, /execCommand\('copy'\)/);
});

test('모듈이 버전 쿼리와 함께 로드되고 프리캐시에 포함된다', () => {
    assert.ok(html.includes(`<script src="./js/domain-migration.js?v=${APP_ASSET_VERSION}"></script>`), 'HTML 로드 태그');
    assert.ok(sw.includes(`"/js/domain-migration.js?v=${APP_ASSET_VERSION}"`), '서비스 워커 프리캐시');
});

test('배너·팝업 스타일이 토큰만 참조한다(원시 색상값 없음)', () => {
    const block = css.slice(css.indexOf('.migration-bar {'));
    assert.ok(block.length > 0, '주소 이전 안내 CSS 가 없습니다');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), 'CSS 에 하드코딩 색상값이 있습니다');
});
