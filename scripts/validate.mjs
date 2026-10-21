import { readFile, access, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import yaml from 'js-yaml';

// A-1 (2026-10-17): 인라인 스크립트·스타일을 외부 파일로 분리했습니다.
// 전역 스크립트 로드 순서(index.html 과 동일) — scripts/app-source.mjs 와 일치해야 합니다.
const appJsFiles = [
  'public/js/notifications.js',
  'public/js/app.js',
  'public/js/leader-access.js',
  'public/js/ships-board.js',
  'public/js/tab-views.js',
  'public/js/kkung-relay.js'
];

const requiredFiles = [
  '.firebaserc',
  'firebase.json',
  'vercel.json',
  'public/index.html',
  'public/admin.html',
  'public/manifest.json',
  'public/service-worker.js',
  'public/firebase-messaging-sw.js',
  'public/robots.txt',
  'public/sitemap.xml',
  'public/favicon.ico',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/css/app.css',
  ...appJsFiles
];

const jsonFiles = ['.firebaserc', 'firebase.json', 'vercel.json', 'firestore.indexes.json', 'metadata.json', 'package.json', 'public/manifest.json'];
const htmlFiles = ['public/index.html', 'public/admin.html'];
const jsFiles = [
  'public/service-worker.js',
  'public/firebase-messaging-sw.js',
  ...appJsFiles
];
const errors = [];

for (const file of requiredFiles) {
  try {
    await access(file);
  } catch {
    errors.push(`필수 파일이 없습니다: ${file}`);
  }
}

for (const file of jsonFiles) {
  try {
    JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    errors.push(`${file} JSON 오류: ${error.message}`);
  }
}

for (const file of htmlFiles) {
  try {
    const html = await readFile(file, 'utf8');
    if (!/^\s*<!doctype html>/i.test(html)) {
      errors.push(`${file}: <!doctype html> 선언이 없습니다.`);
    }
    if (!/<html(?:\s|>)/i.test(html) || !/<\/html>\s*$/i.test(html)) {
      errors.push(`${file}: 완전한 HTML 문서가 아닙니다.`);
    }

    const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi)];
    for (const [index, match] of inlineScripts.entries()) {
      if (!match[1].trim()) continue;
      try {
        new vm.Script(match[1], { filename: `${file}:inline-script-${index + 1}` });
      } catch (error) {
        errors.push(`${file} 인라인 스크립트 ${index + 1} 문법 오류: ${error.message}`);
      }
      // A-1 (2026-10-17): 앱 로직은 public/js/* 외부 파일에서 관리합니다.
      // index.html 에 큰 인라인 블록이 다시 생기는 것을 차단합니다 (2KB 이하는 허용).
      if (file === 'public/index.html' && match[1].trim().length > 2048) {
        errors.push(`${file} 에 ${match[1].trim().length}바이트 인라인 스크립트가 있습니다 — public/js/* 로 분리하세요.`);
      }
    }
  } catch (error) {
    errors.push(`${file} 검사 오류: ${error.message}`);
  }
}

for (const file of jsFiles) {
  try {
    const code = await readFile(file, 'utf8');
    const normalized = code
      .replace(/^\s*export\s+(async\s+function|function|const|let|var)\s+/gm, '$1 ')
      .replace(/^\s*export\s*\{[\s\S]*?\};?\s*$/gm, '');
    new vm.Script(normalized, { filename: file });
  } catch (error) {
    errors.push(`${file} 스크립트 문법 오류: ${error.message}`);
  }
}

try {
  // 로드 순서로 통합: 파일 간 const/let 중복 선언이 있으면 실행 시점에 깨지므로 여기에서 차단합니다.
  const combinedGlobal = (
    await Promise.all(appJsFiles.map((file) => readFile(file, 'utf8')))
  ).join('\n');
  new vm.Script(combinedGlobal, { filename: 'combined-global-scripts.js' });
} catch (error) {
  errors.push(`전역 스크립트 통합 검증 오류 (중복 선언 등): ${error.message}`);
}

// A-1 (2026-10-17): 외부화한 파일이 실제로 index.html 에서 로드되는지 확인합니다.
// (E-3 — 파일 존재만 강제한 채 참조가 사라지는 "죽은 코드" 회귀 방지)
try {
  const indexHtml = await readFile('public/index.html', 'utf8');
  for (const file of appJsFiles) {
    const asset = file.replace('public/', '');
    if (!new RegExp(`<script[^>]*src="\\.?/${asset.replace(/\\./g, '\\.')}(\\?[^"]*)?"`).test(indexHtml)) {
      errors.push(`index.html 이 ${asset} 를 로드하지 않습니다 — 참조가 사라지면 죽은 코드가 됩니다.`);
    }
  }
  if (!/<link\b[^>]*\bhref="\.?\/css\/app\.css(\?[^"]*)?"/i.test(indexHtml)) {
    errors.push('index.html 이 public/css/app.css 를 <link> 로 참조하지 않습니다.');
  }
} catch (error) {
  errors.push(`외부 자산 참조 검사 오류: ${error.message}`);
}

const firebaseConfig = JSON.parse(await readFile('firebase.json', 'utf8'));
// 배포본은 scripts/build-obfuscate.mjs 가 만든 압축 산출물(build/public)을 사용합니다.
// 원본 public/ 은 개발용 소스이므로, hosting.public 은 반드시 build/public 이어야 합니다.
if (firebaseConfig.hosting?.public !== 'build/public') {
  errors.push(`firebase.json의 hosting.public은 "build/public"이어야 합니다. (현재: ${String(firebaseConfig.hosting?.public)})`);
}
const hostingPredeploy = Array.isArray(firebaseConfig.hosting?.predeploy) ? firebaseConfig.hosting.predeploy : [];
if (!hostingPredeploy.some((cmd) => String(cmd).includes('build:obfuscate'))) {
  errors.push('firebase.json의 hosting.predeploy에 "npm run build:obfuscate"가 있어야 합니다.');
}

// Vercel 은 프리셋 기본값(Output Directory = public) 으로 배포하면 원본 소스가 그대로
// 올라갑니다. 압축·난독화된 build/public 을 배포하도록 vercel.json 이 정의되어야 합니다.
const vercelConfig = JSON.parse(await readFile('vercel.json', 'utf8'));
if (vercelConfig.outputDirectory !== 'build/public') {
  errors.push(`vercel.json의 outputDirectory는 "build/public"이어야 합니다. (현재: ${String(vercelConfig.outputDirectory)})`);
}
if (!String(vercelConfig.buildCommand || '').includes('build')) {
  errors.push('vercel.json의 buildCommand에 빌드(npm run build)가 포함되어야 합니다.');
}

const DEPLOY_SECRET = 'FIREBASE_SERVICE_ACCOUNT_BUSAN_HAK_PORT';
const workflowDir = '.github/workflows';

let workflowFiles = [];
try {
  workflowFiles = (await readdir(workflowDir)).filter((file) => /\.ya?ml$/.test(file)).sort();
} catch {
  errors.push(`워크플로 디렉터리를 읽을 수 없습니다: ${workflowDir}`);
}

if (!workflowFiles.length) {
  errors.push(`${workflowDir}에 워크플로 파일이 없습니다.`);
}

const workflows = new Map();
for (const file of workflowFiles) {
  const path = `${workflowDir}/${file}`;
  try {
    workflows.set(file, yaml.load(await readFile(path, 'utf8')));
  } catch (error) {
    errors.push(`${path} YAML 오류: ${error.message}`);
  }
}

// Firebase 배포 시크릿을 읽는 모든 작업은 반드시 동일한 environment 범위여야 합니다.
// 범위가 갈리면 가드 작업과 배포 작업이 서로 다른 시크릿 값을 읽어,
// 자격 확인은 통과했는데 배포만 실패하거나 반대로 배포가 조용히 건너뛰어집니다.
const deployWorkflow = workflows.get('deploy-firebase.yml');
if (!deployWorkflow?.jobs) {
  errors.push('deploy-firebase.yml을 파싱하지 못했거나 jobs가 없습니다.');
} else {
  const scopes = new Map();
  // 안내 문구에 시크릿 이름만 적힌 작업은 제외하고, 실제 secrets 참조만 대상으로 합니다.
  const secretRef = new RegExp(`secrets\\.\\s*${DEPLOY_SECRET}\\b`);
  for (const [jobId, job] of Object.entries(deployWorkflow.jobs)) {
    if (!secretRef.test(JSON.stringify(job ?? {}))) continue;
    const environment = job?.environment;
    const scope = typeof environment === 'string' ? environment : environment?.name ?? '(환경 미지정)';
    scopes.set(jobId, scope);
  }

  if (scopes.size < 2) {
    errors.push(`deploy-firebase.yml: 시크릿 ${DEPLOY_SECRET}을 읽는 작업이 2개보다 적습니다.`);
  } else if (new Set(scopes.values()).size !== 1) {
    const detail = [...scopes].map(([jobId, scope]) => `${jobId}=${scope}`).join(', ');
    errors.push(`deploy-firebase.yml: 시크릿 ${DEPLOY_SECRET}을 읽는 작업의 environment 범위가 다릅니다 (${detail})`);
  }
}

if (errors.length) {
  console.error(`검증 실패 (${errors.length}건)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `검증 완료: 필수 파일 ${requiredFiles.length}개, JSON ${jsonFiles.length}개, ` +
  `HTML ${htmlFiles.length}개, 워크플로 ${workflowFiles.length}개`
);

