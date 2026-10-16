/**
 * 🔐 Firestore 보안 규칙 회귀 테스트 (E-4)
 *
 * 목적: "거부되어야 할 접근이 실제로 거부되는가"를 증명합니다.
 *   - 익명 세션이 남의 게시글·댓글·선박 정보를 물리 삭제할 수 없는가
 *   - 비밀번호를 몰라도 게시글 내용·비밀번호를 바꿀 수 없는가
 *   - 근무일지의 소유자(workerId)·날짜를 다른 사람 것으로 바꿔치기할 수 없는가
 *   - 관리자 문서(admins)를 스스로 만들어 권한을 얻을 수 없는가
 *
 * 실행: `npm run test:rules`  (Firestore 에뮬레이터를 띄워서 실행합니다. Java 필요)
 *   내부적으로 `firebase emulators:exec --only firestore` 가 이 파일을 실행하므로,
 *   에뮬레이터가 없으면(= FIRESTORE_EMULATOR_HOST 미설정) 전체를 건너뜁니다.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, collection, addDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-busan-hak-port';
const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
// Node 17+ 는 localhost 를 IPv6(::1)로 먼저 해석합니다. Firestore 에뮬레이터는 IPv4 로 뜨기 때문에
// 그대로 두면 연결이 성립하지 않고 작업이 응답 없이 대기(멈춤)합니다. 그래서 IPv4 로 고정합니다.
function emulatorEndpoint() {
    const raw = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!raw) return null;
    const [host, port] = raw.split(':');
    return { host: host === 'localhost' ? '127.0.0.1' : host, port: Number(port || 8080) };
}

const ENDPOINT = emulatorEndpoint();
const EMULATOR_AVAILABLE = ENDPOINT !== null;

const VERBOSE = process.env.RULES_TEST_VERBOSE === '1';
const OP_TIMEOUT_MS = 20000;

/** 진행 마커(진단용). RULES_TEST_VERBOSE=1 일 때만 출력합니다. */
const test = (name, fn) => it(name, async () => {
    if (VERBOSE) console.log(`[규칙테스트] \u25b6 ${name}`);
    await fn();
    if (VERBOSE) console.log(`[규칙테스트] \u2714 ${name}`);
});

/** 요청이 응답 없이 멈추는 사고를 실패로 바꿔 주는 시간 제한 */
function guarded(promise) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(
            () => reject(new Error(`[규칙테스트] Firestore 요청이 ${OP_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다`)),
            OP_TIMEOUT_MS
        ))
    ]);
}

const ok = (promise) => assertSucceeds(guarded(promise));
const denied = (promise) => assertFails(guarded(promise));

const SHA = 'a'.repeat(64);        // 형식만 맞는 SHA-256 해시(작성자 비밀번호)
const OTHER_SHA = 'b'.repeat(64);  // 다른 비밀번호 해시

if (!EMULATOR_AVAILABLE) {
    describe('Firestore 보안 규칙', () => {
        it('에뮬레이터가 없어 건너뜁니다 (npm run test:rules 로 실행하세요)', () => {
            assert.ok(true);
        });
    });
} else {
    let testEnv;

    before(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: {
                rules: readFileSync(RULES_PATH, 'utf8'),
                host: ENDPOINT.host,
                port: ENDPOINT.port
            }
        });
    });

    after(async () => {
        if (testEnv) await testEnv.cleanup();
    });

    /** 익명으로 로그인한 현장 근로자 세션 */
    const worker = (uid = 'worker-a') => testEnv.authenticatedContext(uid).firestore();
    /** 아직 아무 문서도 없는 새 기기 세션 */
    const stranger = () => testEnv.authenticatedContext('stranger-uid').firestore();

    const seed = async (seeder) => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await seeder(ctx.firestore());
        });
    };

    describe('work_logs (근무일지·임금 기록)', () => {
        test('본인이 저장한 일지를 다시 저장할 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await ok(updateDoc(doc(worker(), 'work_logs/a_2026-10-01'), { totalPay: 120000 }));
        });

        test('남의 일지를 물리 삭제할 수 없다 (삭제는 관리자 전용)', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await denied(deleteDoc(doc(worker(), 'work_logs/a_2026-10-01')));
        });

        test('일지의 소유자(workerId)를 바꿔치기할 수 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await denied(updateDoc(doc(worker(), 'work_logs/a_2026-10-01'), { workerId: 'b' }));
        });

        test('일지의 날짜를 바꿔 다른 날 기록으로 옮길 수 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await denied(updateDoc(doc(worker(), 'work_logs/a_2026-10-01'), { date: '2026-10-02' }));
        });

        test('소프트 삭제 표시(deletedAt)는 저장할 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await ok(updateDoc(doc(worker(), 'work_logs/a_2026-10-01'), { deletedAt: new Date() }));
        });

        test('작성자·날짜 형식이 없는 저장은 거부된다', async () => {
            await denied(setDoc(doc(worker(), 'work_logs/broken'), { workerId: 'a', date: '2026-1-1' }));
        });
    });

    describe('posts (왁자지껄 게시판)', () => {
        const postRef = (db) => doc(db, 'posts/p1');
        const seedPost = async () => seed(async (db) => {
            await setDoc(doc(db, 'posts/p1'), {
                nick: '라싱반장', title: '제목', content: '내용', password: SHA, timestamp: new Date()
            });
        });

        test('누구나 글을 쓸 수 있다 (해시 비밀번호 형식 준수 시)', async () => {
            await seed(async () => {});
            await ok(addDoc(collection(worker(), 'posts'), {
                nick: '익명', title: '제목', content: '내용', password: SHA
            }));
        });

        test('해시가 아닌 비밀번호로는 글을 쓸 수 없다', async () => {
            await seed(async () => {});
            await denied(addDoc(collection(worker(), 'posts'), {
                nick: '익명', title: '제목', content: '내용', password: '1234'
            }));
        });

        test('남의 글을 물리 삭제할 수 없다 (누구나 삭제되던 구멍 차단)', async () => {
            await seedPost();
            await denied(deleteDoc(postRef(stranger())));
            await denied(deleteDoc(postRef(worker())));
        });

        test('소프트 삭제(삭제 표시만)는 허용된다', async () => {
            await seedPost();
            await ok(updateDoc(postRef(worker()), { deletedAt: new Date(), deletedBy: 'worker-a' }));
        });

        test('삭제 표시를 빙자해 비밀번호를 바꾸는 요청은 거부된다', async () => {
            await seedPost();
            // deletedAt 만 바꾸는 형태(소프트 삭제)가 아니고, 비밀번호도 그대로가 아니므로 두 경로 모두 거부됩니다.
            await denied(updateDoc(postRef(worker()), {
                deletedAt: new Date(), password: OTHER_SHA
            }));
        });

        test('내용을 수정해도 비밀번호는 바꿀 수 없다 (글 잠금 공격 차단)', async () => {
            await seedPost();
            await denied(updateDoc(postRef(worker()), {
                nick: '라싱반장', title: '수정', content: '수정 내용', password: OTHER_SHA
            }));
            await ok(updateDoc(postRef(worker()), {
                nick: '라싱반장', title: '수정', content: '수정 내용', password: SHA
            }));
        });

        test('조회수 1 증가는 누구나 할 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'posts/p1'), {
                    nick: '라싱반장', title: '제목', content: '내용', password: SHA, views: 3
                });
            });
            await ok(updateDoc(postRef(stranger()), { views: 4 }));
            await denied(updateDoc(postRef(stranger()), { views: 9 }));
        });

        test('댓글도 남이 삭제할 수 없고, 비밀번호는 바꿀 수 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'posts/p1'), {
                    nick: '라싱반장', title: '제목', content: '내용', password: SHA
                });
                await setDoc(doc(db, 'posts/p1/comments/c1'), {
                    name: '익명', text: '댓글', password: SHA
                });
            });
            const comment = (db) => doc(db, 'posts/p1/comments/c1');
            await denied(deleteDoc(comment(stranger())));
            await denied(updateDoc(comment(stranger()), {
                name: '익명', text: '수정', password: OTHER_SHA
            }));
            await ok(updateDoc(comment(stranger()), { deletedAt: new Date(), deletedBy: 'x' }));
        });
    });

    describe('ships (선박 정보 도감)', () => {
        const shipRef = (db) => doc(db, 'ships/s1');
        const seedShip = async () => seed(async (db) => {
            await setDoc(doc(db, 'ships/s1'), { shipName: 'HMM ALGECIRAS', password: SHA, difficulty: 3 });
        });

        test('선박 정보도 물리 삭제는 관리자 전용이다', async () => {
            await seedShip();
            await denied(deleteDoc(shipRef(worker())));
        });

        test('선박 정보 수정 시 비밀번호는 그대로여야 한다', async () => {
            await seedShip();
            await denied(updateDoc(shipRef(worker()), {
                shipName: 'HMM ALGECIRAS', password: OTHER_SHA, difficulty: 5
            }));
            await ok(updateDoc(shipRef(worker()), {
                shipName: 'HMM ALGECIRAS', password: SHA, difficulty: 5
            }));
        });

        test('소프트 삭제는 허용된다', async () => {
            await seedShip();
            await ok(updateDoc(shipRef(worker()), { deletedAt: new Date(), deletedBy: 'worker-a' }));
        });
    });

    describe('admins · settings (권한 상승 차단)', () => {
        test('스스로 관리자 문서를 만들어 권한을 얻을 수 없다', async () => {
            await seed(async () => {});
            await denied(setDoc(doc(worker('stranger-uid'), 'admins/stranger-uid'), {
                uid: 'stranger-uid', verifiedAt: new Date()
            }));
        });

        test('관리자 비밀번호 문서는 읽을 수도 쓸 수도 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'settings/admin'), { passwordHash: SHA });
            });
            await denied(doc(worker(), 'settings/admin').get());
            await denied(setDoc(doc(worker(), 'settings/admin'), { passwordHash: OTHER_SHA }));
        });
    });

    describe('알려진 한계 (C-4 로그인 도입 시 함께 해결)', () => {
        test('work_logs 목록 조회는 아직 인증된 세션이면 허용된다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
            });
            // 화면은 본인 workerId 로만 조회하지만, 규칙 자체는 아직 전체 목록을 막지 못합니다.
            // 이 항목이 실패하기 시작하면 규칙이 강화된 것이므로 이 테스트를 갱신하세요.
            await ok(stranger().collection('work_logs').get());
        });
    });
}
