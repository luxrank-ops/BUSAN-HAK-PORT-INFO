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
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, addDoc, writeBatch, serverTimestamp } from 'firebase/firestore';

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

        test('게시글 조회수 1 증가는 누구나 할 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'posts/p1'), {
                    nick: '라싱반장', title: '제목', content: '내용', password: SHA, views: 3
                });
            });
            await ok(updateDoc(postRef(stranger()), { views: 4 }));
            // 참고: 게시글은 로그인 없이 "내용 수정" 경로(비밀번호 해시 고정)가 열려 있어
            // 조회수만 1씩 증가하도록 규칙으로 강제할 수는 없습니다(C-4 로그인 도입 시 함께 해결).
        });

        test('공지 조회수는 1씩만 증가할 수 있다 (자동 등록 공지 제외)', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'notices/n1'), { title: '일반 공지', content: '내용', views: 3 });
            });
            const notice = (db) => doc(db, 'notices/n1');
            await ok(updateDoc(notice(stranger()), { views: 4 }));
            await denied(updateDoc(notice(stranger()), { views: 9 }));
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
            await denied(getDoc(doc(worker(), 'settings/admin')));
            await denied(setDoc(doc(worker(), 'settings/admin'), { passwordHash: OTHER_SHA }));
        });
    });

    describe('kkung_chain (꿍꿍따 끝말잇기 "댓글 릴레이")', () => {
        const stateRef = (db) => doc(db, 'kkung_chain/active');
        const commentList = (db) => collection(db, 'kkung_chain/active/comments');
        const roundOne = (overrides = {}) => ({
            round: 1,
            starterWord: '고양이',
            lastWord: '고양이',
            wordCount: 0,
            usedWords: ['고양이'],
            lastNick: '라싱반장',
            updatedAt: new Date(),
            ...overrides
        });
        const seedRelay = async (overrides = {}) => seed(async (db) => {
            await setDoc(doc(db, 'kkung_chain/active'), roundOne(overrides));
        });

        test('첫 릴레이 문서를 만들 수 있다 (라운드 1 · 이어진 단어 0개)', async () => {
            await seed(async () => {});
            await ok(setDoc(stateRef(worker()), roundOne()));
        });

        test('라운드 번호·단어 수를 조작한 첫 릴레이 개설은 거부된다', async () => {
            await seed(async () => {});
            await denied(setDoc(stateRef(stranger()), roundOne({ round: 5 })));
            await denied(setDoc(stateRef(stranger()), roundOne({ wordCount: 30 })));
        });

        test('세 글자 한글이 아닌 단어로 릴레이 상태를 만들 수 없다', async () => {
            await seed(async () => {});
            await denied(setDoc(stateRef(stranger()), roundOne({
                starterWord: 'ab', lastWord: 'ab', usedWords: ['ab']
            })));
        });

        test('단어를 이어 쓰면 이어진 개수와 사용 목록이 정확히 1씩 늘어난다', async () => {
            await seedRelay();
            await ok(updateDoc(stateRef(worker()), {
                lastWord: '이야기',
                wordCount: 1,
                usedWords: ['고양이', '이야기'],
                lastNick: '북항 포맨',
                updatedAt: new Date()
            }));
        });

        test('이어진 단어 개수를 부풀리거나 라운드를 몰래 바꾸는 갱신은 거부된다', async () => {
            await seedRelay();
            await denied(updateDoc(stateRef(stranger()), {
                lastWord: '이야기', wordCount: 9,
                usedWords: ['고양이', '이야기'], updatedAt: new Date()
            }));
            await denied(updateDoc(stateRef(stranger()), {
                round: 2, lastWord: '이야기', wordCount: 1,
                usedWords: ['고양이', '이야기'], updatedAt: new Date()
            }));
            await denied(deleteDoc(stateRef(stranger())));
        });

        test('새 출발은 라운드가 1 늘고 0개로 초기화될 때만 허용된다', async () => {
            // 2분 전에 마지막으로 이어진 릴레이 → 막힘/완료가 아니어도 60초 간격을 지켰으므로 새 출발 가능
            await seedRelay({ updatedAt: new Date(Date.now() - 120000) });
            await ok(updateDoc(stateRef(worker()), roundOne({
                round: 2, starterWord: '부산항', lastWord: '부산항',
                usedWords: ['부산항'], lastNick: '북항 포맨', updatedAt: new Date()
            })));
        });

        test('방금 이어진 릴레이를 곧바로 새 출발로 덮을 수 없다 (60초 간격)', async () => {
            await seedRelay({ updatedAt: new Date() });
            await denied(updateDoc(stateRef(stranger()), roundOne({
                round: 2, starterWord: '부산항', lastWord: '부산항',
                usedWords: ['부산항'], updatedAt: new Date()
            })));
        });

        test('릴레이 상태는 로그인한 동료만 읽을 수 있다 (목록 조회는 차단)', async () => {
            await seedRelay();
            await ok(getDoc(stateRef(worker())));
            await denied(getDoc(stateRef(testEnv.unauthenticatedContext().firestore())));
            await denied(worker().collection('kkung_chain').get());
        });

        test('세 글자 한글 단어 댓글만 등록할 수 있다', async () => {
            await seedRelay();
            await ok(addDoc(commentList(worker()), {
                round: 1, name: '북항 포맨', word: '이야기', prevWord: '고양이', memo: null
            }));
            await denied(addDoc(commentList(stranger()), {
                round: 1, name: '북항 포맨', word: '이야기책', prevWord: '고양이'
            }));
            await denied(addDoc(commentList(stranger()), {
                round: 1, name: '', word: '이야기', prevWord: '고양이'
            }));
        });

        test('이어 쓴 단어 댓글은 작성자도 수정·삭제할 수 없다 (릴레이 흐름 보호)', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'kkung_chain/active'), roundOne());
                await setDoc(doc(db, 'kkung_chain/active/comments/c1'), {
                    round: 1, name: '북항 포맨', word: '이야기', prevWord: '고양이'
                });
            });
            const comment = (db) => doc(db, 'kkung_chain/active/comments/c1');
            await ok(getDoc(comment(stranger())));
            await denied(updateDoc(comment(worker()), { word: '이층집' }));
            await denied(deleteDoc(comment(worker())));
        });
    });

    // 💡 운영자에게 바란다 — 2026-10-28 운영 신고("제출 실패: Missing or insufficient permissions")
    // 이후 화면 코드가 실제로 보내는 문서 모양 그대로 규칙을 검증합니다.
    describe('want_board (운영자에게 바란다)', () => {
        const AUTHOR = 'worker-a';
        const ITEM_ID = 'fb_test1';

        /** 화면(confirmWantPreview → commitWantItem)이 만드는 항목 문서와 같은 모양 */
        const itemDoc = (overrides = {}) => ({
            id: ITEM_ID,
            authorUid: AUTHOR,
            nick: '신항 도선사',
            content: '1234',
            createdAt: serverTimestamp(),
            createdAtMs: Date.now(),
            status: 'pending',
            deleted: false,
            replyCount: 0,
            ...overrides
        });

        const indexDoc = (uid = AUTHOR) => ({
            uid,
            items: [{
                id: ITEM_ID,
                nick: '신항 도선사',
                snippet: '1234',
                status: 'pending',
                replyCount: 0,
                deleted: false,
                createdAtMs: Date.now()
            }]
        });

        test('작성자는 피드백과 내 기록 인덱스를 한 번에(배치) 저장할 수 있다', async () => {
            await seed(async () => {});
            const db = worker(AUTHOR);
            const batch = writeBatch(db);
            batch.set(doc(db, 'want_board', ITEM_ID), itemDoc());
            batch.set(doc(db, 'want_board_mine', AUTHOR), indexDoc(), { merge: true });
            await ok(batch.commit());
        });

        test('남의 피드백은 읽을 수 없고, 전체 목록 조회도 불가능하다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'want_board', ITEM_ID), itemDoc());
            });
            await ok(getDoc(doc(worker(AUTHOR), 'want_board', ITEM_ID)));
            await denied(getDoc(doc(stranger(), 'want_board', ITEM_ID)));
            await denied(getDocs(collection(stranger(), 'want_board')));
        });

        test('작성자도 내용·상태를 위조할 수 없고 삭제 표시만 바꿀 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'want_board', ITEM_ID), itemDoc());
            });
            await denied(updateDoc(doc(worker(AUTHOR), 'want_board', ITEM_ID), { content: '위조' }));
            await denied(updateDoc(doc(worker(AUTHOR), 'want_board', ITEM_ID), { status: 'replied' }));
            await ok(updateDoc(doc(worker(AUTHOR), 'want_board', ITEM_ID), { deleted: true }));
        });

        test('인덱스 문서라도 형태가 틀리면(리스트 아님·개수 초과) 거부된다', async () => {
            await seed(async () => {});
            const db = worker(AUTHOR);
            await denied(setDoc(doc(db, 'want_board_mine', AUTHOR), { uid: AUTHOR, items: 'not-a-list' }));
            const tooMany = Array.from({ length: 201 }, (_, index) => ({ id: `fb_${index}` }));
            await denied(setDoc(doc(db, 'want_board_mine', AUTHOR), { uid: AUTHOR, items: tooMany }));
        });

        test('다른 사람의 UID 로 인덱스 문서를 만들 수 없다', async () => {
            await seed(async () => {});
            await denied(setDoc(doc(worker(AUTHOR), 'want_board_mine', 'stranger-uid'), indexDoc('stranger-uid')));
        });

        test('답글은 관리자만 쓸 수 있고, 작성자는 자기 항목의 답글을 읽을 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'want_board', ITEM_ID), itemDoc());
                await setDoc(doc(db, `want_board/${ITEM_ID}/replies/r1`), {
                    itemId: ITEM_ID,
                    authorUid: 'admin_luxrank',
                    name: '운영자',
                    text: '반영하겠습니다',
                    createdAtMs: Date.now(),
                    isAdminReply: true
                });
            });
            await denied(addDoc(collection(worker(AUTHOR), `want_board/${ITEM_ID}/replies`), {
                itemId: ITEM_ID,
                authorUid: AUTHOR,
                name: '신항 도선사',
                text: '위조 답글',
                createdAtMs: Date.now(),
                isAdminReply: true
            }));
            await ok(getDocs(collection(worker(AUTHOR), `want_board/${ITEM_ID}/replies`)));
            await denied(getDocs(collection(stranger(), `want_board/${ITEM_ID}/replies`)));
        });
    });

    describe('알려진 한계 (C-4 로그인 도입 시 함께 해결)', () => {
        test('화면이 쓰는 조회 형태(본인 workerId + 날짜 범위)는 허용된다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
            });
            await ok(stranger().collection('work_logs')
                .where('workerId', '==', 'a')
                .where('date', '>=', '2026-10-01')
                .where('date', '<=', '2026-10-31')
                .get());
        });

        test('workerId 조건이 없는 조회는 규칙이 거부한다 (날짜 범위만으로는 조회 불가)', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
            });
            // 규칙은 필터가 아니므로, 규칙이 요구하는 조건(workerId)을 증명할 수 없는 쿼리는 거부됩니다.
            // 그래서 인덱스가 아직 없을 때의 대체 조회도 workerId 조건을 유지하고 날짜는 화면에서 거릅니다.
            await denied(stranger().collection('work_logs')
                .where('date', '>=', '2026-10-01')
                .where('date', '<=', '2026-10-31')
                .get());
        });

        test('인덱스가 없을 때 쓰는 대체 조회(workerId 만)는 허용된다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
                await setDoc(doc(db, 'work_logs/a_2026-09-30'), { workerId: 'a', date: '2026-09-30' });
            });
            const snap = await ok(stranger().collection('work_logs').where('workerId', '==', 'a').get());
            assert.equal(snap.size, 2);
        });

        test('아직은 남의 workerId 로도 조회할 수 있다 (규칙 한계 — C-4 로그인 도입 시 해결)', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
            });
            // 화면은 본인 것만 요청하지만, 규칙은 "누구의 일지인지"까지는 막지 못합니다.
            // 이 항목이 실패하기 시작하면 규칙이 강화된 것이므로 이 테스트를 갱신하세요.
            await ok(stranger().collection('work_logs').where('workerId', '==', 'a').get());
        });
    });
}
