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

    /** 익명으로 로그인한 현장 근로자 세션 (workerId 지정 시 서버 발급 커스텀 클레임 포함) */
    const worker = (uid = 'worker-a', workerId = undefined) =>
        testEnv.authenticatedContext(uid, workerId ? { workerId } : undefined).firestore();
    /** 관리자 세션 */
    const admin = () => testEnv.authenticatedContext('admin_luxrank').firestore();
    /** 아직 아무 문서도 없는 새 기기 세션 */
    const stranger = () => testEnv.authenticatedContext('stranger-uid').firestore();

    const seed = async (seeder) => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await seeder(ctx.firestore());
        });
    };

    describe('work_logs (근무일지·임금 기록)', () => {
        test('본인(workerId 클레임 일치)이 저장한 일지를 다시 저장할 수 있다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await ok(updateDoc(doc(worker('worker-a', 'a'), 'work_logs/a_2026-10-01'), { totalPay: 120000 }));
            await denied(updateDoc(doc(stranger(), 'work_logs/a_2026-10-01'), { totalPay: 999999 }));
        });

        test('남의 일지를 물리 삭제할 수 없다 (삭제는 관리자 전용)', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await denied(deleteDoc(doc(worker('worker-a', 'a'), 'work_logs/a_2026-10-01')));
        });

        test('일지의 소유자(workerId)를 바꿔치기할 수 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await denied(updateDoc(doc(worker('worker-a', 'a'), 'work_logs/a_2026-10-01'), { workerId: 'b' }));
        });

        test('일지의 날짜를 바꿔 다른 날 기록으로 옮길 수 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await denied(updateDoc(doc(worker('worker-a', 'a'), 'work_logs/a_2026-10-01'), { date: '2026-10-02' }));
        });

        test('본인의 소프트 삭제 표시(deletedAt)는 저장할 수 있고 타인은 거부된다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), {
                    workerId: 'a', date: '2026-10-01', totalPay: 100000
                });
            });
            await denied(updateDoc(doc(stranger(), 'work_logs/a_2026-10-01'), { deletedAt: new Date() }));
            await ok(updateDoc(doc(worker('worker-a', 'a'), 'work_logs/a_2026-10-01'), { deletedAt: new Date() }));
        });

        test('작성자·날짜 형식이 없는 저장은 거부된다', async () => {
            await denied(setDoc(doc(worker('worker-a', 'a'), 'work_logs/broken'), { workerId: 'a', date: '2026-1-1' }));
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

    describe('terminal_as_requests (터미널 시설·정비 수리 / A/S 요청)', () => {
        const requestList = (db) => collection(db, 'terminal_as_requests');
        const requestDoc = (id) => (db) => doc(db, `terminal_as_requests/${id}`);
        const validRequest = (overrides = {}) => ({
            terminalId: 'hjnc',
            terminalLabel: '한진(HJNC)',
            type: 'facility',
            content: '3번 게이트 조명이 꺼졌어요',
            author: '한진***',
            authorUid: 'worker-a',
            anonCode: 'K7Q2',
            status: 'received',
            imageUrls: ['https://firebasestorage.googleapis.com/v0/b/test/o/terminal-as%2Fp1.jpg'],
            createdAtMs: Date.now(),
            createdAt: new Date(),
            ...overrides
        });
        const seedRequest = async (id = 'r1', overrides = {}) => seed(async (db) => {
            await setDoc(doc(db, `terminal_as_requests/${id}`), validRequest(overrides));
        });
        /** isAdmin() 을 만족하는 관리자 세션 (uid 화이트리스트) */
        const admin = () => testEnv.authenticatedContext('admin_luxrank').firestore();

        test('로그인한 동료는 비밀번호 없이 사진 포함 익명 접수할 수 있다', async () => {
            await seed(async () => {});
            await ok(addDoc(requestList(worker()), validRequest()));
            await ok(addDoc(requestList(stranger()), validRequest({
                terminalId: 'dgt',
                terminalLabel: '동원(DGT)',
                author: '동원***',
                authorUid: 'stranger-uid',
                anonCode: 'B4M8',
                imageUrls: []
            })));
        });

        test('미인증 사용자는 접수·조회·수정·삭제 모두 거부된다', async () => {
            await seedRequest();
            const anon = testEnv.unauthenticatedContext().firestore();
            await denied(addDoc(requestList(anon), validRequest()));
            await denied(getDoc(requestDoc('r1')(anon)));
            await denied(getDocs(requestList(anon)));
            await denied(updateDoc(requestDoc('r1')(anon), { content: '수정 시도' }));
            await denied(deleteDoc(requestDoc('r1')(anon)));
        });

        test('알 수 없는 터미널·종류·타인 UID 사칭·잘못된 사진 URL·임의 필드는 거부된다', async () => {
            await seed(async () => {});
            await denied(addDoc(requestList(stranger()), validRequest({ authorUid: 'worker-a' })));
            await denied(addDoc(requestList(stranger()), validRequest({ authorUid: 'stranger-uid', terminalId: 'nope' })));
            await denied(addDoc(requestList(stranger()), validRequest({ authorUid: 'stranger-uid', type: 'nope' })));
            await denied(addDoc(requestList(stranger()), validRequest({ authorUid: 'stranger-uid', content: '가' })));
            await denied(addDoc(requestList(stranger()), validRequest({ authorUid: 'stranger-uid', content: '가'.repeat(501) })));
            await denied(addDoc(requestList(stranger()), validRequest({ authorUid: 'stranger-uid', author: '' })));
            await denied(addDoc(requestList(stranger()), validRequest({ authorUid: 'stranger-uid', status: 'done' })));
            await denied(addDoc(requestList(stranger()), validRequest({ authorUid: 'stranger-uid', phone: '010-0000-0000' })));
            await denied(addDoc(requestList(stranger()), validRequest({
                authorUid: 'stranger-uid',
                imageUrls: ['https://a.com/1.jpg', 'https://a.com/2.jpg', 'https://a.com/3.jpg', 'https://a.com/4.jpg']
            })));
            await denied(addDoc(requestList(stranger()), validRequest({
                authorUid: 'stranger-uid',
                imageUrls: ['javascript:alert(1)']
            })));
        });

        test('작성자 본인은 내용·사진을 수정하고 삭제할 수 있으며, 타인은 본문 수정/삭제는 거부되지만 조치완료·좋아요·댓글은 허용된다', async () => {
            await seedRequest();
            await ok(getDoc(requestDoc('r1')(stranger())));
            await ok(getDocs(requestList(stranger())));
            // 타인 본문 수정·삭제 거부
            await denied(updateDoc(requestDoc('r1')(stranger()), { content: '남의 글 수정 시도' }));
            await denied(deleteDoc(requestDoc('r1')(stranger())));
            // 타인의 상태 되돌리기·UID 변조 거부
            await denied(updateDoc(requestDoc('r1')(stranger()), { status: 'processing' }));
            await denied(updateDoc(requestDoc('r1')(worker()), { authorUid: 'stranger-uid' }));
            // 본인 내용·사진 수정 성공
            await ok(updateDoc(requestDoc('r1')(worker()), {
                content: '3번 게이트 LED 교체 요청으로 수정합니다',
                imageUrls: ['https://firebasestorage.googleapis.com/v0/b/test/o/terminal-as%2Fp2.jpg'],
                updatedAtMs: Date.now()
            }));
            // 누구나 게시글 좋아요(본인 UID 키만)·조치 완료 처리 가능
            await ok(updateDoc(requestDoc('r1')(stranger()), { 'likedBy.stranger-uid': true }));
            await denied(updateDoc(requestDoc('r1')(stranger()), { 'likedBy.worker-a': true }));
            await ok(updateDoc(requestDoc('r1')(stranger()), { status: 'done', resolvedAtMs: Date.now() }));
            // 관리자 상태 변경 및 삭제 성공
            await ok(updateDoc(requestDoc('r1')(admin()), { status: 'processing' }));
            await ok(deleteDoc(requestDoc('r1')(admin())));
            // 본인 삭제 성공 (새 문서 기준)
            await seedRequest('r2');
            await ok(deleteDoc(requestDoc('r2')(worker())));
        });

        test('댓글 작성·조회·댓글 좋아요·작성자 삭제 및 타인 댓글 변조 차단', async () => {
            await seedRequest();
            const cmtRef = (db, cid = 'c1') => doc(db, `terminal_as_requests/r1/comments/${cid}`);
            const cmtList = (db) => collection(db, 'terminal_as_requests/r1/comments');
            const validComment = (overrides = {}) => ({
                requestId: 'r1',
                content: '확인 후 교체 진행 중입니다.',
                author: '한진***',
                anonCode: 'M2K9',
                authorUid: 'stranger-uid',
                createdAtMs: Date.now(),
                createdAt: new Date(),
                ...overrides
            });

            // 작성자 UID 사칭 거부
            await denied(setDoc(cmtRef(worker(), 'bad1'), validComment({ authorUid: 'stranger-uid' })));
            // 정상 댓글 작성 & 조회
            await ok(setDoc(cmtRef(stranger(), 'c1'), validComment()));
            await ok(getDocs(cmtList(worker())));
            await ok(updateDoc(requestDoc('r1')(stranger()), { commentCount: 1 }));
            // 다른 사용자가 댓글 좋아요 가능, 타인 좋아요 키 위조 거부
            await ok(updateDoc(cmtRef(worker(), 'c1'), { 'likedBy.worker-a': true }));
            await denied(updateDoc(cmtRef(worker(), 'c1'), { 'likedBy.other': true }));
            // 타인 댓글 내용 수정·삭제 거부
            await denied(updateDoc(cmtRef(worker(), 'c1'), { content: '남의 댓글 수정' }));
            await denied(deleteDoc(cmtRef(worker(), 'c1')));
            // 작성자 본인 댓글 수정·삭제 성공
            await ok(updateDoc(cmtRef(stranger(), 'c1'), { content: '교체 완료했습니다!', updatedAtMs: Date.now() }));
            await ok(deleteDoc(cmtRef(stranger(), 'c1')));
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

        const seedItemWithReply = () => seed(async (db) => {
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

        test('일반 작성자는 답글을 쓸 수 없다 (관리자 전용)', async () => {
            await seedItemWithReply();
            await denied(addDoc(collection(worker(AUTHOR), `want_board/${ITEM_ID}/replies`), {
                itemId: ITEM_ID,
                authorUid: AUTHOR,
                name: '신항 도선사',
                text: '위조 답글',
                createdAtMs: Date.now(),
                isAdminReply: true
            }));
        });

        test('작성자는 자기 항목의 답글 목록을 읽을 수 있다', async () => {
            await seedItemWithReply();
            const snap = await ok(getDocs(collection(worker(AUTHOR), `want_board/${ITEM_ID}/replies`)));
            assert.equal(snap.size, 1);
        });

        test('다른 사용자는 남의 항목 답글 목록을 읽을 수 없다', async () => {
            await seedItemWithReply();
            await denied(getDocs(collection(stranger(), `want_board/${ITEM_ID}/replies`)));
        });
    });

    describe('강화된 소유권·권한 경계 (Phase 1 보안 보강)', () => {
        test('본인 workerId 클레임이 일치하는 날짜 범위 조회는 허용된다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
            });
            await ok(worker('worker-a', 'a').collection('work_logs')
                .where('workerId', '==', 'a')
                .where('date', '>=', '2026-10-01')
                .where('date', '<=', '2026-10-31')
                .get());
        });

        test('workerId 조건이 없는 조회는 규칙이 거부한다 (날짜 범위만으로는 조회 불가)', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
            });
            await denied(worker('worker-a', 'a').collection('work_logs')
                .where('date', '>=', '2026-10-01')
                .where('date', '<=', '2026-10-31')
                .get());
        });

        test('인덱스가 없을 때 쓰는 대체 조회(본인 workerId 만)는 허용된다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
                await setDoc(doc(db, 'work_logs/a_2026-09-30'), { workerId: 'a', date: '2026-09-30' });
            });
            const snap = await ok(worker('worker-a', 'a').collection('work_logs').where('workerId', '==', 'a').get());
            assert.equal(snap.size, 2);
        });

        test('타인(클레임 없음·불일치)은 남의 workerId 로도 근무일지를 조회할 수 없다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'work_logs/a_2026-10-01'), { workerId: 'a', date: '2026-10-01' });
            });
            await denied(stranger().collection('work_logs').where('workerId', '==', 'a').get());
            await denied(worker('worker-b', 'b').collection('work_logs').where('workerId', '==', 'a').get());
            await denied(getDoc(doc(stranger(), 'work_logs/a_2026-10-01')));
        });

        test('user_profiles: 타인은 비밀번호 해시를 읽거나 덮어쓸 수 없고 본인도 fcmToken 만 갱신 가능하다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'user_profiles/홍길동'), { password: SHA, createdAt: new Date() });
            });
            await denied(getDoc(doc(stranger(), 'user_profiles/홍길동')));
            await denied(updateDoc(doc(stranger(), 'user_profiles/홍길동'), { password: OTHER_SHA }));
            await denied(updateDoc(doc(worker('worker-h', '홍길동'), 'user_profiles/홍길동'), { password: OTHER_SHA }));
            await ok(updateDoc(doc(worker('worker-h', '홍길동'), 'user_profiles/홍길동'), { fcmToken: 'fcm-token-ok' }));
        });

        test('settings/emergency_notice: 비관리자는 긴급 공지를 변조할 수 없고 관리자만 작성할 수 있다', async () => {
            await seed(async () => {});
            const validNotice = { enabled: true, title: '긴급', message: '테스트 공지', level: 'danger', revision: 1 };
            await denied(setDoc(doc(stranger(), 'settings/emergency_notice'), validNotice));
            await ok(setDoc(doc(admin(), 'settings/emergency_notice'), validNotice));
        });

        test('archives: javascript: 등 위험 스킴 URL 등록은 차단되고 https:// 링크만 허용된다', async () => {
            await seed(async () => {});
            await denied(setDoc(doc(worker(), 'archives/a1'), {
                title: '위험 링크', url: 'javascript:alert(1)', password: SHA
            }));
            await ok(setDoc(doc(worker(), 'archives/a2'), {
                title: '정상 파일', url: 'https://storage.googleapis.com/file.pdf', password: SHA
            }));
        });

        test('notifications: 타인 알림 조회·위조 생성은 차단되고 본인 조회·읽음 처리와 ADMIN 자동 블라인드만 허용된다', async () => {
            await seed(async (db) => {
                await setDoc(doc(db, 'notifications/n1'), {
                    userId: '홍길동', title: '출항 변경', body: '본문', read: false
                });
            });
            await denied(getDoc(doc(stranger(), 'notifications/n1')));
            await denied(updateDoc(doc(stranger(), 'notifications/n1'), { read: true }));
            await denied(setDoc(doc(stranger(), 'notifications/fake1'), {
                userId: '홍길동', title: '가짜 공지', body: '피싱'
            }));
            await ok(getDoc(doc(worker('worker-h', '홍길동'), 'notifications/n1')));
            await ok(updateDoc(doc(worker('worker-h', '홍길동'), 'notifications/n1'), { read: true, readAt: new Date() }));
            await ok(setDoc(doc(stranger(), 'notifications/blind1'), {
                userId: 'ADMIN', type: 'AUTO_BLIND', title: '자동 블라인드', body: '금칙어 감지'
            }));
        });
    });
}
