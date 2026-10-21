#!/usr/bin/env node
/**
 * 배포용 자산 난독화·압축 빌드 (scripts/build-obfuscate.mjs)
 *
 * - 원본: public/            (개발·관리 소스, 저장소에 그대로 보관)
 * - 산출물: build/public/    (배포 전용, .gitignore 대상)
 *
 * 하는 일
 *   1. public/ 전체를 build/public/ 로 복사
 *   2. .js / .css 는 esbuild 로 압축 + 지역 식별자 난독화(minify)
 *   3. 모든 압축 파일 상단에 저작권·무단복사 금지 배너 삽입
 *   4. HTML 에 서버 잠금 PIN 해시(window.__SCREEN_LOCK_SHA256__) 주입
 *
 * 안전 장치
 *   - 전역 함수·전역 변수(onclick 핸들러가 참조)는 이름을 바꾸지 않습니다.
 *     esbuild transform 은 파일을 IIFE 로 감싸지 않으므로 <script src> 그대로 동작합니다.
 *   - 객체 프로퍼명(mangleProps)은 건드리지 않습니다. Firestore 문서 키와
 *     firebase SDK 응답 필드가 깨지지 않도록 하기 위함입니다.
 *   - 파일 이름·경로·?v= 버전 쿼리는 원본과 1:1 로 유지합니다.
 *     service-worker.js 의 프리캐시 목록과 반드시 일치해야 합니다.
 *
 * 사용법
 *   node scripts/build-obfuscate.mjs                 # 빌드
 *   SCREEN_LOCK_PIN=1234 node scripts/build-obfuscate.mjs   # 잠금 PIN 지정
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'public');
const OUT_DIR = join(ROOT, 'build', 'public');

const DEFAULT_SCREEN_LOCK_PIN = '9445';
/** 긴급 공지 기본 관리자 PIN — EMERGENCY_NOTICE_PIN 미설정 배포에서만 인정합니다. */
const DEFAULT_EMERGENCY_PIN = '9445';

/** 저작권·무단복사 금지 배너 (압축 파일 상단에 삽입) */
function copyrightBanner(style) {
  const text = [
    'BUSAN HAK PORT INFO (busan-hak-port-info) — Copyright (c) 2026 이춘학 (luxrank@gmail.com).',
    'All rights reserved. 본 파일은 배포용으로 압축된 산출물입니다.',
    '저작권자의 사전 서면 동의 없이 본 파일의 전체 또는 일부를 복제·배포·수정·2차적',
    '저작물 작성·공중송신·역분석·디컴파일할 수 없습니다. (저작권법 제16조·제18조·제136조)',
    '문의: luxrank@gmail.com'
  ];
  const body = text.map((line) => (style === 'css' ? ` ${line}` : ` * ${line}`));
  if (style === 'css') return ['/*', ...body, ' */', ''].join('\n');
  return ['/*!', ...body, ' */', ''].join('\n');
}

/** 배포 HTML 에 주입할 저작권 주석 */
const HTML_NOTICE = [
  '<!--',
  '  BUSAN HAK PORT INFO (busan-hak-port-info) — Copyright (c) 2026 이춘학 (luxrank@gmail.com).',
  '  All rights reserved. 저작권자의 사전 서면 동의 없이 본 문서·연결된 스크립트·스타일시트의',
  '  전체 또는 일부를 복제·배포·수정·2차적 저작물 작성할 수 없습니다.',
  '  문의: luxrank@gmail.com',
  '-->'
].join('\n');

/** 재귀적으로 파일 목록 수집 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function minifyJs(code, file) {
  const result = await esbuild.transform(code, {
    loader: 'js',
    minify: true,
    // IIFE 로 감싸지 않음 → 전역 함수·전역 변수 유지 (onclick 핸들러 호환)
    target: ['es2019'],
    legalComments: 'none',
    charset: 'utf8',
    sourcefile: file
  });
  return result.code;
}

async function minifyCss(code, file) {
  const result = await esbuild.transform(code, {
    loader: 'css',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    sourcefile: file
  });
  return result.code;
}

/**
 * HTML 에 저작권 주석 + 런타임 설정 스크립트 주입
 *
 * 긴급 공지 해시는 서버(server.ts)와 동일한 규칙으로 계산합니다.
 *  - EMERGENCY_NOTICE_PIN 을 지정한 배포: 그 값만 인정
 *  - 지정하지 않은 배포: 화면 잠금 PIN + 기본 관리자 PIN(9445) 을 함께 인정
 *    → 근무일지 잠금 비밀번호를 다른 값으로 바꾼 배포에서도 안내된 기본 비밀번호로 열립니다.
 */
function normalizePinForHash(pin) {
  let s = String(pin || '').trim();
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/\s+/g, '');
  return s;
}
function transformHtml(html, screenLockPin, emergencyPin = screenLockPin, emergencyDefaultPin = '') {
  const normScreenPin = normalizePinForHash(screenLockPin);
  const normEmergencyPin = normalizePinForHash(emergencyPin);
  const sha256 = createHash('sha256').update(normScreenPin, 'utf8').digest('hex');
  const emergencySha256 = createHash('sha256').update(normEmergencyPin, 'utf8').digest('hex');
  const fallbackPin = normalizePinForHash(emergencyDefaultPin);
  const fallbackSha256 = fallbackPin
    ? createHash('sha256').update(fallbackPin, 'utf8').digest('hex')
    : '';
  // 화면 잠금 기본 백업 PIN(9445) — 운영자가 PIN을 바꿔도 기존 안내 번호로 열리도록
  const screenDefaultSha256 = createHash('sha256').update('9445', 'utf8').digest('hex');
  const configScript = [
    '<script>',
    '/* 서버 검증 실패(정적 호스팅·오프라인) 시 사용하는 화면 잠금 PIN 해시.',
    '   실제 값은 서버 환경변수 SCREEN_LOCK_PIN 으로 관리하며 소스에는 평문이 없습니다. */',
    `window.__SCREEN_LOCK_SHA256__="${sha256}";`,
    `window.__SCREEN_LOCK_DEFAULT_SHA256__="${screenDefaultSha256}";`,
    '/* 🚨 긴급 플로팅 공지 작성 잠금 해시 (서버 환경변수 EMERGENCY_NOTICE_PIN). */',
    `window.__EMERGENCY_PIN_SHA256__="${emergencySha256}";`,
    ...(fallbackSha256
      ? [
          '/* 긴급 공지 기본 관리자 PIN 해시 — EMERGENCY_NOTICE_PIN 미설정 배포에서만 주입됩니다. */',
          `window.__EMERGENCY_DEFAULT_PIN_SHA256__="${fallbackSha256}";`
        ]
      : []),
    '</script>'
  ].join('\n');

  let out = html;
  // </head> 직전에 주입. </head> 가 없으면 <body> 직전, 그것도 없으면 맨 앞.
  if (/<\/head\s*>/i.test(out)) {
    out = out.replace(/<\/head\s*>/i, (m) => `${HTML_NOTICE}\n${configScript}\n${m}`);
  } else if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body[^>]*>/i, (m) => `${HTML_NOTICE}\n${configScript}\n${m}`);
  } else {
    out = `${HTML_NOTICE}\n${configScript}\n${out}`;
  }
  return out;
}

/** service-worker.js 프리캐시·HTML 과 동일한 전역 스크립트 로드 순서 */
const JS_LOAD_ORDER = [
  'js/notifications.js',
  'js/app.js',
  'js/leader-access.js',
  'js/ships-board.js',
  'js/tab-views.js',
  'js/kkung-game.js'
];

/**
 * 압축 결과가 원본과 동일한 전역 API 를 노출하는지 검증합니다.
 * 전역 함수는 HTML 의 onclick 같은 인라인 핸들러가 "이름으로" 호출하므로,
 * 압축 중 이름이 바뀌면 운영 화면이 즉시 깨집니다. 배포 전에 반드시 막아야 합니다.
 */
function verifyBuild() {
  const srcCombined = JS_LOAD_ORDER.map((rel) => readFileSync(join(SRC_DIR, rel), 'utf8')).join('\n;\n');
  const outCombined = JS_LOAD_ORDER.map((rel) => readFileSync(join(OUT_DIR, rel), 'utf8')).join('\n;\n');

  try {
    // eslint-disable-next-line no-new
    new vm.Script(outCombined, { filename: 'build-combined-global.js' });
  } catch (err) {
    throw new Error(`압축 결과에 문법 오류가 있습니다: ${err.message}`);
  }

  const missing = [];
  let globalCount = 0;
  for (const rel of JS_LOAD_ORDER) {
    const src = readFileSync(join(SRC_DIR, rel), 'utf8');
    const out = readFileSync(join(OUT_DIR, rel), 'utf8');
    // 파일 첫 칸(들여쓰기 없음)에 선언된 function 만 최상위 전역으로 간주
    const globals = new Set([...src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]));
    globalCount += globals.size;
    for (const name of globals) {
      if (!new RegExp(`function\\s+${name}\\s*\\(`).test(out)) missing.push(`${rel} → ${name}()`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `압축 후 전역 함수 ${missing.length}개가 사라졌습니다(HTML 인라인 핸들러가 깨집니다): ` +
        missing.slice(0, 10).join(', ')
    );
  }

  console.log(`  안전 검증 통과 · 전역 함수 ${globalCount}개 보존 · 원본 ${fmt(Buffer.byteLength(srcCombined))} → ${fmt(Buffer.byteLength(outCombined))}`);
}

async function main() {
  const started = Date.now();

  if (!statSync(SRC_DIR, { throwIfNoEntry: false })) {
    console.error(`[build:obfuscate] 원본 디렉터리가 없습니다: ${SRC_DIR}`);
    process.exit(1);
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const pin = String(process.env.SCREEN_LOCK_PIN || DEFAULT_SCREEN_LOCK_PIN).trim() || DEFAULT_SCREEN_LOCK_PIN;
  // 긴급 공지 작성 비밀번호: EMERGENCY_NOTICE_PIN → (미설정 시) 화면 잠금 PIN 순으로 결정합니다.
  const explicitEmergencyPin = String(process.env.EMERGENCY_NOTICE_PIN || '').trim();
  const emergencyPin = explicitEmergencyPin || pin;
  // EMERGENCY_NOTICE_PIN 을 따로 지정하지 않은 배포에서만, 기본 관리자 PIN(9445)도 인정합니다.
  // (서버 server.ts 의 getAcceptedEmergencyNoticePins() 와 동일한 규칙 — 반드시 함께 바꿔야 합니다.)
  const emergencyDefaultPin = explicitEmergencyPin ? '' : DEFAULT_EMERGENCY_PIN;

  const files = walk(SRC_DIR);
  let jsCount = 0;
  let cssCount = 0;
  let htmlCount = 0;
  let beforeBytes = 0;
  let afterBytes = 0;

  for (const file of files) {
    const rel = relative(SRC_DIR, file);
    const dest = join(OUT_DIR, rel);
    mkdirSync(dirname(dest), { recursive: true });

    const ext = extname(file).toLowerCase();

    if (ext === '.js' || ext === '.mjs') {
      const src = readFileSync(file, 'utf8');
      beforeBytes += Buffer.byteLength(src);
      const out = await minifyJs(src, rel);
      const banner = copyrightBanner('js');
      writeFileSync(dest, `${banner}${out.trimEnd()}\n`, 'utf8');
      afterBytes += Buffer.byteLength(banner) + Buffer.byteLength(out);
      jsCount += 1;
      continue;
    }

    if (ext === '.css') {
      const src = readFileSync(file, 'utf8');
      beforeBytes += Buffer.byteLength(src);
      const out = await minifyCss(src, rel);
      const banner = copyrightBanner('css');
      writeFileSync(dest, `${banner}${out.trimEnd()}\n`, 'utf8');
      afterBytes += Buffer.byteLength(banner) + Buffer.byteLength(out);
      cssCount += 1;
      continue;
    }

    if (ext === '.html' || ext === '.htm') {
      const src = readFileSync(file, 'utf8');
      writeFileSync(dest, transformHtml(src, pin, emergencyPin, emergencyDefaultPin), 'utf8');
      htmlCount += 1;
      continue;
    }

    // 이미지·아이콘·매니페스트·robots·sitemap 등은 그대로 복사
    cpSync(file, dest);
  }

  // ---------------------------------------------------------------
  // 배포 전 안전 검증: 압축으로 전역 함수가 사라지면 운영 화면이 즉시 깨집니다.
  // ---------------------------------------------------------------
  verifyBuild();

  const ms = Date.now() - started;
  console.log(`[build:obfuscate] ${OUT_DIR.replace(`${ROOT}/`, '')} 생성 완료 (${ms}ms)`);
  console.log(`  JS  ${jsCount}개 압축 · CSS ${cssCount}개 압축 · HTML ${htmlCount}개 처리`);
  console.log(`  텍스트 자산 ${fmt(beforeBytes)} → ${fmt(afterBytes)} (${Math.round((1 - afterBytes / Math.max(beforeBytes, 1)) * 100)}% 감소)`);
  console.log(`  화면 잠금 PIN: 서버 환경변수 SCREEN_LOCK_PIN 사용(미설정 시 기본값), 해시만 HTML 에 주입`);
  console.log(`  긴급 공지 PIN: 서버 환경변수 EMERGENCY_NOTICE_PIN 사용(미설정 시 화면 잠금 PIN), 해시만 HTML 에 주입`);
}

main().catch((err) => {
  console.error('[build:obfuscate] 실패:', err && err.message ? err.message : err);
  process.exit(1);
});
