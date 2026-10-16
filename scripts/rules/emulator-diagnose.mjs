/**
 * 🔎 Firestore 에뮬레이터 연결 진단 (E-4 보조)
 *
 * `firebase emulators:exec` 안에서 실행되며, 테스트 프로세스가 실제로 어느 주소로
 * 에뮬레이터에 닿을 수 있는지(IPv4/IPv6, 포트)를 확인합니다.
 * Node 17+ 는 localhost 를 ::1 로 먼저 해석할 수 있어 연결이 멈추는 사고가 납니다.
 */
import net from 'node:net';
import dns from 'node:dns/promises';

const raw = process.env.FIRESTORE_EMULATOR_HOST || '';
console.log('[규칙테스트] FIRESTORE_EMULATOR_HOST =', raw || '(미설정)');

const [host, portText] = raw.split(':');
const port = Number(portText || 8080);

function probe(name, targetHost) {
    return new Promise((resolve) => {
        const socket = net.connect({ host: targetHost, port, timeout: 4000 });
        const done = (text) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(`[규칙테스트] ${name} ${targetHost}:${port} → ${text}`);
        };
        socket.on('connect', () => done('연결 성공 ✅'));
        socket.on('timeout', () => done('응답 없음 ⏱'));
        socket.on('error', (error) => done(`실패 (${error.code || error.message})`));
    });
}

console.log(await probe('A·앱이 알려준 주소', host || 'localhost'));
console.log(await probe('B·IPv4', '127.0.0.1'));
console.log(await probe('C·IPv6', '::1'));

try {
    const resolved = await dns.lookup('localhost', { all: true });
    console.log('[규칙테스트] localhost 해석 →', JSON.stringify(resolved));
} catch (error) {
    console.log('[규칙테스트] localhost 해석 실패:', error.message);
}
