/**
 * 🔐 Firestore 규칙 에뮬레이터 테스트 실행기 (E-4)
 *
 * Java(JDK 11+) 가 없는 환경에서는 에뮬레이터를 띄울 수 없으므로,
 * 안내 문구를 출력하고 건너뜁니다(exit 0). Java 가 있으면 실제로 규칙 테스트를 돌립니다.
 *
 *   npm run test:rules
 */
import { spawnSync } from 'node:child_process';

const hasJava = spawnSync('java', ['-version'], { stdio: 'ignore' }).status === 0;

if (!hasJava) {
    console.log('[test:rules] Java(JDK) 가 없어 Firestore 에뮬레이터 테스트를 건너뜁니다.');
    console.log('            실제 규칙 검증은 Java 설치 후 다시 실행하거나 CI(GitHub Actions)에서 수행됩니다.');
    console.log('            (정적 안전망은 npm test 의 security-rules 테스트가 항상 검사합니다.)');
    process.exit(0);
}

const command = [
    'npx --no-install firebase emulators:exec --only firestore --project demo-busan-hak-port',
    '"node --test scripts/rules/firestore-rules.emulator.test.mjs"'
].join(' ');

const result = spawnSync(command, { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
