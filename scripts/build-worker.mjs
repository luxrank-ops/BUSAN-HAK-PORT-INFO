#!/usr/bin/env node
/**
 * Cloudflare Workers 배포 번들 빌드 (scripts/build-worker.mjs)
 *
 * Wrangler 기본 번들러는 일부 CJS 패키지(iconv-lite / body-parser 경로)의 browser
 * 필드를 적용해 스트림 확장 모듈을 비활성화합니다. 그래서 직접 esbuild 로 묶고
 * wrangler 에는 no_bundle 로 넘깁니다.
 *
 *   node scripts/build-worker.mjs      → .cf-worker/index.js
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * dotenv 는 fs 를 동적 require 하므로 Workers ESM 번들에서 실패합니다.
 * Workers 환경변수는 wrangler vars/secret 으로 주입되니 no-op 스텁으로 대체합니다.
 */
const stubDotenv = {
  name: 'stub-dotenv',
  setup(build) {
    build.onResolve({ filter: /^dotenv(\/.*)?$/ }, () => ({ path: resolve(ROOT, 'worker/stubs/dotenv.ts') }));
  }
};

/**
 * firebase-admin 은 gRPC 와 protobuf 문자열 코드 생성(new Function)에 의존해
 * Workers 에서 동작하지 않습니다. 서버 코드가 쓰는 API 표면만 Firestore REST·
 * FCM HTTP v1·Cloud Storage JSON API 로 구현한 worker/cf/* 모듈로 치환합니다.
 */
const firebaseAdminCloudflare = {
  name: 'firebase-admin-cloudflare',
  setup(build) {
    const map = {
      'firebase-admin/app': 'worker/cf/app.ts',
      'firebase-admin/firestore': 'worker/cf/firestore.ts',
      'firebase-admin/messaging': 'worker/cf/messaging.ts',
      'firebase-admin/storage': 'worker/cf/storage.ts'
    };
    build.onResolve({ filter: /^firebase-admin\/(app|firestore|messaging|storage)$/ }, (args) => ({
      path: resolve(ROOT, map[args.path])
    }));
  }
};

const result = await build({
  absWorkingDir: ROOT,
  entryPoints: ['worker/index.ts'],
  outfile: '.cf-worker/index.js',
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  mainFields: ['module', 'main'],
  conditions: ['node', 'import', 'require', 'default'],
  // workerd 런타임이 제공하는 모듈과 firebase-admin(치환 대상)은 번들하지 않습니다.
  external: ['cloudflare:node', 'cloudflare:workers', 'cloudflare:*', 'firebase-admin', 'firebase-admin/*'],
  define: {
    // Workers 에는 import.meta.url 이 없습니다. 파일 경로는 읽기 전용 FS 라 쓰이지 않지만
    // 모듈 최상단에서 fileURLToPath(import.meta.url) 을 계산하는 코드가 있어 값을 채워 둡니다.
    'import.meta.url': '"file:///worker/index.js"'
  },
  plugins: [stubDotenv, firebaseAdminCloudflare],
  // 번들된 CJS 의존성들이 동적 require(내장 모듈)를 호출할 때 workerd 의 모듈
  // 해석기를 쓰도록 실제 require 를 주입합니다. (esbuild 의 기본 __require 는
  // ESM 번들에서 "Dynamic require ... is not supported" 로 실패합니다)
  banner: {
    js: [
      "import { createRequire as __cfCreateRequire } from 'node:module';",
      "const require = __cfCreateRequire('file:///worker/index.js');",
      "globalThis.__dirname ??= '/worker';",
      "globalThis.__filename ??= '/worker/index.js';"
    ].join('\n')
  },
  logLevel: 'info',
  metafile: true
});

const out = Object.values(result.metafile.outputs)[0];
console.log(`worker bundle: ${out.bytes} bytes`);
