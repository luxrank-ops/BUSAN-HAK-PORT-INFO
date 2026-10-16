/**
 * 🔐 Firestore 규칙 에뮬레이터 테스트 실행기 (E-4)
 *
 * firebase-tools 15+ 의 Firestore 에뮬레이터는 Java 21 이상이 필요합니다.
 * Java 가 없거나 버전이 낮으면 안내 문구를 출력하고 건너뜁니다(exit 0).
 *   - 항상 도는 정적 안전망: scripts/security-rules.test.mjs (npm test)
 *   - 실제 거부/허용 검증: CI(GitHub Actions)에서 Java 21 설치 후 실행
 *
 *   npm run test:rules
 */
import { spawnSync } from 'node:child_process';

const MIN_JAVA = 21;

function javaMajorVersion() {
    const result = spawnSync('java', ['-version'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) return null;
    const text = `${result.stderr || ''}${result.stdout || ''}`;
    const match = text.match(/version "(?:1\.)?(\d+)/);
    return match ? Number(match[1]) : null;
}

function skip(reason) {
    console.log(`[test:rules] ${reason}`);
    console.log('            실행: CI(GitHub Actions)에서 Java 21 설치 후 npm run test:rules');
    console.log('            항상 도는 정적 안전망은 npm test 의 security-rules 테스트가 담당합니다.');
    process.exit(0);
}

const major = javaMajorVersion();
if (major === null) skip(`Java(JDK ${MIN_JAVA}+) 가 없어 Firestore 에뮬레이터 테스트를 건너뜁니다.`);
if (major < MIN_JAVA) skip(`Java ${major} 는 너무 낮습니다(Firestore 에뮬레이터는 JDK ${MIN_JAVA}+ 필요).`);

const command = [
    'npx --no-install firebase emulators:exec --only firestore --project demo-busan-hak-port',
    '"node --test scripts/rules/firestore-rules.emulator.test.mjs"'
].join(' ');

const result = spawnSync(command, { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
