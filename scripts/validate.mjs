import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';

const requiredFiles = [
  '.firebaserc',
  'firebase.json',
  'public/index.html',
  'public/admin.html',
  'public/manifest.json',
  'public/service-worker.js',
  'public/robots.txt',
  'public/sitemap.xml',
  'public/favicon.ico',
  'public/icon-192.png',
  'public/icon-512.png'
];

const jsonFiles = ['.firebaserc', 'firebase.json', 'metadata.json', 'package.json', 'public/manifest.json'];
const htmlFiles = ['public/index.html', 'public/admin.html'];
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
    }
  } catch (error) {
    errors.push(`${file} 검사 오류: ${error.message}`);
  }
}

const firebaseConfig = JSON.parse(await readFile('firebase.json', 'utf8'));
if (firebaseConfig.hosting?.public !== 'public') {
  errors.push('firebase.json의 hosting.public은 "public"이어야 합니다.');
}

if (errors.length) {
  console.error(`검증 실패 (${errors.length}건)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`검증 완료: 필수 파일 ${requiredFiles.length}개, JSON ${jsonFiles.length}개, HTML ${htmlFiles.length}개`);
