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
const RULES_PATH = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));
const EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

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
            firestore: { rules: readFileSync(RULES_PATH, 'utf8') }
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
        it('본인이 저장한 일지를 다시 저장할 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await assertSucceeds(updateDoc(doc(worker(), 'work_logs/a_2026-10-01'), { totalPay: 120000 }));
        });

        it('남의 일지를 물리 삭제할 수 없다 (삭제는 관리자 전용)', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await assertFails(deleteDoc(doc(worker(), 'work_logs/a_2026-10-01')));
        });

        it('일지의 소유자(workerId)를 바꿔치기할 수 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await assertFails(updateDoc(doc(worker(), 'work_logs/a_2026-10-01'), { workerId: 'b' }));
        });

        it('일지의 날짜를 바꿔 다른 날 기록으로 옮길 수 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await assertFails(updateDoc(doc(worker(), 'work_logs/a_2026-10-01'), { date: '2026-10-02' }));
        });

        it('소프트 삭제 표시(deletedAt)는 저장할 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await assertSucceeds(updateDoc(doc(worker(), 'work_logs/a_2026-10-01'), { deletedAt: new Date() }));
        });

        it('작성자·날짜 형식이 없는 저장은 거부된다', async () => {
            await assertFails(setDoc(doc(worker(), 'work_logs/broken'), { workerId: 'a', date: '2026-1-1' }));
        });
    });

    describe('posts (왁자지껄 게시판)', () => {
        const postRef = (db) => doc(db, 'posts/p1');
        const seedPost = async () => seed(async (db) => {
            await setDoc(doc(db, 'posts/p1'), {
                nick: '라싱반장', title: '제목', content: '내용', password: SHA, timestamp: new Date()
            });
        });

        it('누구나 글을 쓸 수 있다 (해시 비밀번호 형식 준수 시)', async () => {
            await seed(async () => {});
            await assertSucceeds(addDoc(collection(worker(), 'posts'), {
                nick: '익명', title: '제목', content: '내용', password: SHA
            }));
        });

        it('해시가 아닌 비밀번호로는 글을 쓸 수 없다', async () => {
            await seed(async () => {});
            await assertFails(addDoc(collection(worker(), 'posts'), {
                nick: '익명', title: '제목', content: '내용', password: '1234'
            }));
        });

        it('남의 글을 물리 삭제할 수 없다 (누구나 삭제되던 구멍 차단)', async () => {
            await seedPost();
            await assertFails(deleteDoc(postRef(stranger())));
            await assertFails(deleteDoc(postRef(worker())));
        });

        it('소프트 삭제(삭제 표시만)는 허용된다', async () => {
            await seedPost();
            await assertSucceeds(updateDoc(postRef(worker()), { deletedAt: new Date(), deletedBy: 'worker-a' }));
        });

        it('삭제 표시를 빙자해 비밀번호를 바꾸는 요청은 거부된다', async () => {
            await seedPost();
            // deletedAt 만 바꾸는 형태(소프트 삭제)가 아니고, 비밀번호도 그대로가 아니므로 두 경로 모두 거부됩니다.
            await assertFails(updateDoc(postRef(worker()), {
                deletedAt: new Date(), password: OTHER_SHA
            }));
        });

        it('내용을 수정해도 비밀번호는 바꿀 수 없다 (글 잠금 공격 차단)', async () => {
            await seedPost();
            await assertFails(updateDoc(postRef(worker()), {
                nick: '라싱반장', title: '수정', content: '수정 내용', password: OTHER_SHA
            }));
            await assertSucceeds(updateDoc(postRef(worker()), {
                nick: '라싱반장', title: '수정', content: '수정 내용', password: SHA
            }));
        });

        it('조회수 1 증가는 누구나 할 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'posts/p1'), {
                    nick: '라싱반장', title: '제목', content: '내용', password: SHA, views: 3
                });
            });
            await assertSucceeds(updateDoc(postRef(stranger()), { views: 4 }));
            await assertFails(updateDoc(postRef(stranger()), { views: 9 }));
        });

        it('댓글도 남이 삭제할 수 없고, 비밀번호는 바꿀 수 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'posts/p1'), {
                    nick: '라싱반장', title: '제목', content: '내용', password: SHA
                });
                await setDoc(doc(db, 'posts/p1/comments/c1'), {
                    name: '익명', text: '댓글', password: SHA
                });
            });
            const comment = (db) => doc(db, 'posts/p1/comments/c1');
            await assertFails(deleteDoc(comment(stranger())));
            await assertFails(updateDoc(comment(stranger()), {
                name: '익명', text: '수정', password: OTHER_SHA
            }));
            await assertSucceeds(updateDoc(comment(stranger()), { deletedAt: new Date(), deletedBy: 'x' }));
        });
    });

    describe('ships (선박 정보 도감)', () => {
        const shipRef = (db) => doc(db, 'ships/s1');
        const seedShip = async () => seed(async (db) => {
            await setDoc(doc(db, 'ships/s1'), { shipName: 'HMM ALGECIRAS', password: SHA, difficulty: 3 });
        });

        it('선박 정보도 물리 삭제는 관리자 전용이다', async () => {
            await seedShip();
            await assertFails(deleteDoc(shipRef(worker())));
        });

        it('선박 정보 수정 시 비밀번호는 그대로여야 한다', async () => {
            await seedShip();
            await assertFails(updateDoc(shipRef(worker()), {
                shipName: 'HMM ALGECIRAS', password: OTHER_SHA, difficulty: 5
            }));
            await assertSucceeds(updateDoc(shipRef(worker()), {
                shipName: 'HMM ALGECIRAS', password: SHA, difficulty: 5
            }));
        });

        it('소프트 삭제는 허용된다', async () => {
            await seedShip();
            await assertSucceeds(updateDoc(shipRef(worker()), { deletedAt: new Date(), deletedBy: 'worker-a' }));
        });
    });

    describe('admins · settings (권한 상승 차단)', () => {
        it('스스로 관리자 문서를 만들어 권한을 얻을 수 없다', async () => {
            await seed(async () => {});
            await assertFails(setDoc(doc(worker('stranger-uid'), 'admins/stranger-uid'), {
                uid: 'stranger-uid', verifiedAt: new Date()
            }));
        });

        it('관리자 비밀번호 문서는 읽을 수도 쓸 수도 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'settings/admin'), { passwordHash: SHA });
            });
            await assertFails(doc(worker(), 'settings/admin').get());
            await assertFails(setDoc(doc(worker(), 'settings/admin'), { passwordHash: OTHER_SHA }));
        });
    });

    describe('알려진 한계 (C-4 로그인 도입 시 함께 해결)', () => {
        it('work_logs 목록 조회는 아직 인증된 세션이면 허용된다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
            });
            // 화면은 본인 workerId 로만 조회하지만, 규칙 자체는 아직 전체 목록을 막지 못합니다.
            // 이 항목이 실패하기 시작하면 규칙이 강화된 것이므로 이 테스트를 갱신하세요.
            await assertSucceeds(stranger().collection('work_logs').get());
        });
    });
}
