// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================
/* 꿍~꿍~따리~꿍꿍따♡ — 3음절 끝말잇기 "댓글 릴레이" (2026-10-21 개편)
 *
 * AI·2인 "대전(승부)" 게임이 아닙니다.
 * 동료들이 시간 날 때마다 댓글 한 줄(세 글자 단어)을 남기고, 그 단어의 끝 글자가
 * 다음 사람의 시작 글자가 되어 릴레이가 계속 이어지는 방식입니다.
 *
 *  · 턴 제한 시간·점수판·승패 없음 → 언제 참여해도, 언제 나가도 됩니다
 *  · Firestore `kkung_chain/active`(현재 릴레이 상태) + `comments`(단어 댓글) 에 저장
 *    → 모든 동료에게 실시간(onSnapshot)으로 공유됩니다
 *  · 카드를 펼쳐 볼 때만 구독하고 접으면 구독을 해제해 읽기 비용을 아낍니다
 *  · 릴레이가 막히거나 30개를 채우면 누구나 "새 출발"로 다음 릴레이를 엽니다
 *  · 내장 사전은 승부용이 아니라 "막혔을 때 이어갈 단어 추천" 용도로만 씁니다
 *    (사전 밖 단어도 세 글자 한글이면 댓글로 남길 수 있습니다)
 */
(function initKkungKkungTtaRelay(global) {
    'use strict';

    // 이어갈 단어가 막혔을 때 추천·새 릴레이 출발 후보로만 쓰는 내장 어휘 모음입니다.
    // 외부 사전/API 없이 동작하며 고유명사·지역어·외래어는 일부 제외됩니다.
    const WORDS = Object.freeze([...new Set(`
가구점 가로등 가로수 가방끈 가을밤 가을비 가족들 가정집 간식비 감기약 감자전 감자탕 감정선 강남역 강아지 강철판 개구리 개나리 개학식 거짓말 건강식 겨울밤 겨울비 결승전 경비실 계단식 고구마 고깃집 고양이 고추장 공깃밥 공사장 공원길 과일즙 구경꾼 구급차 구두약 구독자 구슬땀 구조대 구이집 구입처 국물맛 국수집 국어책 국화꽃 국제선 그늘막 그림자 그림책 금요일 금반지 기계실 기념일 기념품 기상청 기저귀 기차역 기침약 기름통 긴장감 김치통 꽃다발 꽃무늬
나들이 나무꾼 나무판 나뭇잎 나비잠 나팔꽃 나침반 날갯짓 남산길 남학생 낙서장 낙엽길 낙지탕 낚싯대 내복약 냉장고 노래방 노란색 노숙자 노점상 노후화 누룽지 눈동자 눈사람 눈송이 다람쥐 다리미 단골집 단풍잎 달맞이 달력표 닭갈비 대장간 대출금 대학생 독립문 독서실 도서관 도마뱀 동물원 동창회 동요책 두꺼비 뒷골목 뒷마당 뒷모습 등산객 등산화 디딤돌 라디오 레몬차 로봇팔 리듬감 리모컨 리본끈 리어카
마당쇠 마른김 마스크 마술사 마중물 만둣국 만화책 매실차 매운탕 머리띠 머리핀 메모장 모기향 모범생 모래성 모퉁이 목걸이 목도리 목욕탕 무궁화 무지개 물감통 물고기 물방울 물소리 물장난 물탱크 물티슈 미끄럼 미소녀 미술관 미역국 미용실 바나나 바느질 바닷가 바닷물 바람결 바위산 박물관 반딧불 반찬통 발자국 밤하늘 방울꽃 방울뱀 방청소 방화문 배수구 배수로 백설기 백화점 버스표 버터빵 벚꽃길 별사탕 보리밥 보물섬 보조개 복숭아 볼펜촉 봄나물 봉사자 부동산 부산역 부산항 분홍색 비빔밥 비상구 비행기 빗자루
사거리 사과즙 사기꾼 사람들 사물함 사우나 산책길 산호초 삼각형 새우깡 새우젓 새벽녘 생강차 생수병 생일상 생선회 생태계 설거지 설날밤 설문지 소금물 소나기 소방차 소풍날 손가락 수건통 수박씨 수정과 수영장 숙제장 시골길 시계방 신발끈 신호등 신혼집 실내화 실력자 실망감 실험실 싱크대
아기곰 아랫집 아침밥 악보집 안경집 안전띠 안전모 앞마당 약수터 양말짝 양치질 양파즙 어깨춤 어린이 어머니 어묵탕 얼음물 여름밤 여름비 여행길 연필심 영화관 오락실 오리발 오징어 옥수수 온도계 옷걸이 왕사탕 우산통 우승컵 우체통 운동장 운동화 유리창 음식점 월세방 월요일 이발관 이발소 이불장 이삿짐 이슬비 이웃집 이야기 이층집 인사말
자동차 자전거 자물쇠 장갑차 장난감 장맛비 장미꽃 장식장 재봉틀 전기차 전등불 전시회 전자책 전통주 전학생 정답지 정류장 조개탕 조리법 종달새 종이컵 주머니 주먹밥 주차장 지구본 지렛대 지상파 지우개 지진계 지하철 지도책 진달래
차고지 차단기 차표값 천연수 철도역 청소기 초등생 초코빵 초코칩 초콜릿 추억담 카나페 카메라 카카오 카센터 카페인 카레밥 콘서트 콜라병 탁구장 털장갑 텀블러 타이어 토끼풀 토마토 토스트 파란색 파리채 파자마 파출소 팔꿈치 편의점 편지함 표백제 표준어 표지판 풍경화 풍선껌 피아노 피자집
하늘색 한겨울 한글날 한밤중 한자책 해돋이 해장국 향수병 허리띠 현관문 호박죽 화분대 화장실 화학식 환승역 활주로 회사원 회의실 회전문 휴대폰 희망차
라싱바 라싱봉 선박명 신항만 항공기 항만청 항아리
갈비탕 고무줄 과학실 구석방 구청장 국립대 날씨표 낙하물 노랫말 농구장 단체전 대기실 독감약 된장국 동네북 마을길 매표소 문구점 문방구 문지방 문어발 물놀이 바둑판 밥그릇 보행로 부두길 불안감 불편함 불장난 상품권 새싹길 상상력 상점가 상차림 소매점 소방서 손전등 수리공 시청각 신호수 안전화 약초밭 양념장 연습장 원고지 원시림 원예사 원동기 우편함 이발기 잠자리 전동차 전철역 종착역 중심가 중국집 중고차 중학생 차림표 청과물 체육관 출입문 태양광 통나무 하역장 한강변 한라산 함박눈 향신료 형광등 홍보물 화물차 회의록
갈림길 교통비 급식실 기숙사 기와집 네거리 노을빛 도깨비 뒷자리 만두집 목공소 미나리 반창고 방석집 배달원 별자리 보름달 사다리 생일날 세탁기 소화기 식당가 안개꽃 야구장 연주회 열기구 우량아 유치원 장난질 전봇대 전시장 정육점 주방장 창문틀 책가방 책갈피 책받침 체온계 축구장 칫솔통 캠핑장 콩나물 학용품 한마음 햇빛길 형제간 황금빛 휴게실 출항일 입항일 선원실 작업복 작업장 교대조 야간조 주간조
`.trim().split(/\s+/u))]);

    // 새 릴레이 출발 단어 후보 (내장 사전에 있고 바로 이어 쓸 수 있는 단어만 고릅니다)
    const STARTER_WORDS = Object.freeze(`강아지 고양이 바나나 노래방 운동장 구급차 물고기 비상구 거짓말 안전모 신호등 부산항 정류장 냉장고 미역국 반딧불 타이어 화장실 이슬비 소나기 고구마 부산역 책가방`.split(/\s+/u));

    /* ---- 릴레이 운영 값 (firestore.rules 의 kkung_chain 규칙과 반드시 일치시켜야 합니다) ---- */
    const RELAY_COLLECTION = 'kkung_chain';
    const RELAY_DOC_ID = 'active';
    const FEED_LIMIT = 150;                       // 한 번에 불러오는 최근 댓글 수
    const ROUND_TARGET_WORDS = 30;                // 이만큼 이어지면 누구나 새 출발 가능
    const ROUND_IDLE_RESET_MS = 12 * 60 * 60 * 1000;  // 12시간 멈추면 새 출발 가능
    const MAX_USED_WORDS = 400;                   // 한 릴레이에 쌓을 수 있는 단어 상한
    const MAX_MEMO_LENGTH = 120;
    const MAX_NICK_LENGTH = 20;
    const NICK_STORAGE_KEY = 'busanPortKkungRelayNickV1';
    const HANGUL_TRIPLE = /^[가-힣]{3}$/u;

    /* ==================================================================
       순수 로직 — DOM·Firestore 없이도 단독 실행/테스트할 수 있습니다
       ================================================================== */

    function lastSyllable(word) {
        const chars = Array.from(String(word || ''));
        return chars.length ? chars[chars.length - 1] : '';
    }

    function toUsedSet(usedWords) {
        if (usedWords instanceof Set) return usedWords;
        return new Set(Array.isArray(usedWords) ? usedWords : []);
    }

    /** 앞 단어의 끝 글자로 시작하는 "내장 사전" 단어 목록 (추천·막힘 판정용) */
    function getPlayableWords(previousWord, usedWords = []) {
        const required = lastSyllable(previousWord);
        if (!required) return [];
        const used = toUsedSet(usedWords);
        return WORDS.filter(word => word[0] === required && !used.has(word));
    }

    /**
     * 댓글로 남길 단어 검증. 대전 방식과 달리 "내장 사전 단어만" 조건은 없습니다.
     * (세 글자 한글 + 끝 글자 잇기 + 이번 릴레이에서 아직 안 나온 단어)
     */
    function validateRelayWord(input, previousWord, usedWords = []) {
        const word = String(input ?? '').normalize('NFC').replace(/\s+/gu, '').trim();
        const used = toUsedSet(usedWords);
        if (!word) return { ok: false, code: 'empty', message: '이어갈 세 글자 단어를 적어 주세요.' };
        if (!HANGUL_TRIPLE.test(word)) {
            return { ok: false, code: 'length', message: '한글 세 글자 단어만 댓글로 남길 수 있어요. (공백·숫자·영문은 안 돼요)' };
        }
        if (used.has(word)) {
            return { ok: false, code: 'duplicate', message: `“${word}”는 이번 릴레이에 이미 나온 단어예요. 다른 단어를 이어 주세요.` };
        }
        const required = lastSyllable(previousWord);
        if (required && word[0] !== required) {
            return { ok: false, code: 'chain', message: `마지막 글자 “${required}”로 시작하는 단어를 적어 주세요.` };
        }
        return { ok: true, code: 'ok', word };
    }

    function pickRandom(items, random = Math.random) {
        if (!items.length) return null;
        const value = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
        return items[Math.floor(value * items.length)];
    }

    /** 막혔을 때 도와주는 추천 단어 (내장 사전 기준, 최대 limit 개) */
    function suggestRelayWords(previousWord, usedWords = [], limit = 6, random = Math.random) {
        const candidates = getPlayableWords(previousWord, usedWords);
        const pool = candidates.slice();
        const picks = [];
        const max = Math.max(0, Math.min(pool.length, Number(limit) || 0));
        while (picks.length < max) {
            const index = Math.min(pool.length - 1, Math.max(0, Math.floor((Number(random()) || 0) * pool.length)));
            picks.push(pool.splice(index, 1)[0]);
        }
        return picks;
    }

    function chooseStarterWord(random = Math.random) {
        const pool = STARTER_WORDS.filter(word =>
            HANGUL_TRIPLE.test(word) && getPlayableWords(word, [word]).length > 0
        );
        return pickRandom(pool, random) || '고양이';
    }

    /** 새 릴레이 상태 문서 (kkung_chain/active 에 그대로 저장되는 형태) */
    function createRelayState(starterWord, round = 1, nick = '') {
        return {
            round: Number.isFinite(Number(round)) ? Math.max(1, Math.trunc(Number(round))) : 1,
            starterWord: String(starterWord || ''),
            lastWord: String(starterWord || ''),
            wordCount: 0,
            usedWords: [String(starterWord || '')],
            lastNick: String(nick || '').slice(0, MAX_NICK_LENGTH),
            startedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
    }

    /** Firestore 문서 → 화면이 쓰는 상태 객체 (비정상 값은 안전한 기본값으로) */
    function normalizeRelayState(data) {
        const source = data && typeof data === 'object' ? data : {};
        const roundValue = Number(source.round);
        const countValue = Number(source.wordCount);
        const starterWord = HANGUL_TRIPLE.test(String(source.starterWord || '')) ? String(source.starterWord) : '';
        const lastWord = HANGUL_TRIPLE.test(String(source.lastWord || '')) ? String(source.lastWord) : starterWord;
        const rawUpdated = source.updatedAt;
        const updatedMs = rawUpdated && typeof rawUpdated.toMillis === 'function' ? rawUpdated.toMillis() : rawUpdated;
        return {
            round: Number.isFinite(roundValue) ? Math.max(1, Math.trunc(roundValue)) : 1,
            starterWord,
            lastWord,
            wordCount: Number.isFinite(countValue) ? Math.max(0, Math.trunc(countValue)) : 0,
            usedWords: Array.isArray(source.usedWords)
                ? source.usedWords.filter(item => typeof item === 'string')
                : [],
            lastNick: String(source.lastNick || '').slice(0, 50),
            updatedAtMs: Number.isFinite(Number(updatedMs)) && updatedMs ? Number(updatedMs) : null
        };
    }

    /**
     * 새 출발(다음 릴레이) 가능 여부.
     * 서버 규칙은 "60초 간격"만 강제하고, 아래 조건은 화면에서 먼저 안내하기 위한ものです.
     */
    function canStartNewRound(state, options = {}) {
        if (!state || !state.lastWord) return { allowed: true, reason: '첫 릴레이를 시작해요.' };
        const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
        const suggestions = Array.isArray(options.suggestions)
            ? options.suggestions
            : suggestRelayWords(state.lastWord, state.usedWords, 6);
        if (state.wordCount >= ROUND_TARGET_WORDS) {
            return { allowed: true, reason: `이번 릴레이가 ${state.wordCount}개 단어까지 이어졌어요. 새 릴레이를 열 수 있어요.` };
        }
        if (!suggestions.length) {
            return { allowed: true, reason: `“${lastSyllable(state.lastWord)}”로 시작할 단어를 찾지 못해 릴레이가 막혔어요. 새 출발이 필요해요.` };
        }
        if (state.updatedAtMs && nowMs - state.updatedAtMs >= ROUND_IDLE_RESET_MS) {
            return { allowed: true, reason: '12시간 넘게 멈춰 있던 릴레이예요. 새 출발할 수 있어요.' };
        }
        return {
            allowed: false,
            reason: `지금 릴레이가 이어지는 중이에요. 막히거나 ${ROUND_TARGET_WORDS}개를 채우면 새 출발할 수 있어요.`
        };
    }

    function formatRelativeTime(timestampMs, nowMs = Date.now()) {
        const value = Number(timestampMs);
        if (!Number.isFinite(value) || value <= 0) return '방금 전';
        const diff = Math.max(0, Number(nowMs) - value);
        if (diff < 60000) return '방금 전';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
        const date = new Date(value);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${month}.${day}`;
    }

    function countParticipants(entries) {
        const names = new Set();
        (Array.isArray(entries) ? entries : []).forEach(entry => {
            const name = String(entry?.name || '').trim();
            if (name) names.add(name);
        });
        return names.size;
    }

    /* ==================================================================
       Firestore 연결부
       ================================================================== */

    function relayFirestore() {
        try {
            return (typeof db !== 'undefined' && db && typeof db.collection === 'function') ? db : null;
        } catch (_) {
            return null;
        }
    }

    function serverTimestamp() {
        try {
            const firebase = global.firebase;
            return firebase && firebase.firestore && firebase.firestore.FieldValue
                ? firebase.firestore.FieldValue.serverTimestamp()
                : null;
        } catch (_) {
            return null;
        }
    }

    function relayStateRef() {
        const store = relayFirestore();
        return store ? store.collection(RELAY_COLLECTION).doc(RELAY_DOC_ID) : null;
    }

    function relayCommentsRef() {
        const stateRef = relayStateRef();
        return stateRef ? stateRef.collection('comments') : null;
    }

    /** 규칙이 isSignedIn() 을 요구하므로 쓰기 전에 익명 인증을 확인합니다. */
    async function ensureRelayAuth() {
        try {
            if (typeof global.ensureAnonymousAuth === 'function') {
                const user = await global.ensureAnonymousAuth();
                if (user) return user;
            }
            const firebase = global.firebase;
            if (firebase && typeof firebase.auth === 'function' && firebase.auth().currentUser) {
                return firebase.auth().currentUser;
            }
        } catch (_) {
            // 인증 준비 실패는 쓰기 시도의 오류 메시지로 안내합니다.
        }
        return null;
    }

    function relayError(message) {
        const error = new Error(message);
        error.kkungMessage = message;
        return error;
    }

    function describeRelayError(error) {
        if (error && error.kkungMessage) return error.kkungMessage;
        const code = String(error?.code || '');
        if (code === 'permission-denied') return '저장 권한이 없어요. 잠시 후 다시 시도하거나 앱을 새로고침해 주세요.';
        if (code === 'unavailable') return '네트워크 연결이 필요해요. 연결 상태를 확인한 뒤 다시 눌러 주세요.';
        if (code === 'failed-precondition') return '릴레이 데이터를 아직 준비 중이에요. 잠시 후 다시 시도해 주세요.';
        if (code === 'aborted' || code === 'already-exists') return '같은 순간에 다른 동료가 단어를 남겼어요. 바뀐 릴레이를 보고 다시 적어 주세요.';
        return `저장에 실패했어요. (${(error && error.message) || code || '알 수 없는 오류'})`;
    }

    /* ==================================================================
       화면 상태
       ================================================================== */

    let relayState = null;      // normalizeRelayState() 결과 (문서가 없으면 null)
    let feedEntries = [];       // 최근 댓글 (오래된 순)
    let stateUnsubscribe = null;
    let feedUnsubscribe = null;
    let visibilityObserver = null;
    let isSubmitting = false;
    let relayVisible = false;
    let pendingWord = '';

    function byId(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    function readSavedNick() {
        try {
            return String(global.localStorage?.getItem(NICK_STORAGE_KEY) || '').trim();
        } catch (_) {
            return '';
        }
    }

    function saveNick(nick) {
        try {
            if (nick) global.localStorage?.setItem(NICK_STORAGE_KEY, nick);
        } catch (_) {}
    }

    function currentNick() {
        const typed = String(byId('kkungNick')?.value || '').trim();
        if (typed) return typed.slice(0, MAX_NICK_LENGTH);
        const saved = readSavedNick();
        if (saved) return saved.slice(0, MAX_NICK_LENGTH);
        try {
            if (typeof global.getPortNickname === 'function') {
                const generated = String(global.getPortNickname() || '').trim();
                if (generated) return generated.slice(0, MAX_NICK_LENGTH);
            }
        } catch (_) {}
        return '부산항 동료';
    }

    /** 게시판·선박 댓글과 동일한 금칙어/도배 필터를 그대로 씁니다 — 감지되면 등록 자체를 막습니다. */
    function moderateRelayText(word, memo, nick) {
        try {
            if (typeof global.inspectCommunityContent === 'function') {
                const result = global.inspectCommunityContent({
                    text: `${word} ${memo || ''}`.trim(),
                    author: nick,
                    category: '꿍꿍따 릴레이'
                });
                if (result && typeof result === 'object') return result;
            }
        } catch (_) {}
        return { hidden: false, reason: null };
    }

    function notifyRelayBlind(info) {
        try {
            if (typeof global.notifyAdminAutoBlind === 'function') global.notifyAdminAutoBlind(info);
        } catch (_) {}
    }

    function setStatus(message, tone = 'neutral') {
        const status = byId('kkungRelayStatus');
        if (!status) return;
        status.textContent = message;
        status.classList.remove('is-error', 'is-success', 'is-neutral');
        status.classList.add(tone === 'error' || tone === 'success' ? `is-${tone}` : 'is-neutral');
    }

    function setLiveBadge(live) {
        const badge = byId('kkungLiveBadge');
        if (!badge) return;
        badge.textContent = live ? '🟢 실시간 공유 중' : '⚪ 업데이트 대기';
        badge.classList.toggle('is-live', Boolean(live));
    }

    function setBusy(busy) {
        const input = byId('kkungWordInput');
        const memo = byId('kkungMemoInput');
        const nick = byId('kkungNick');
        const submit = byId('kkungSubmit');
        const hint = byId('kkungHintButton');
        const reset = byId('kkungNewRoundButton');
        if (input) input.disabled = busy;
        if (memo) memo.disabled = busy;
        if (nick) nick.disabled = busy;
        if (submit) {
            submit.disabled = busy;
            submit.textContent = busy ? '등록 중…' : '댓글 등록';
        }
        if (hint) hint.disabled = busy;
        if (reset) reset.disabled = busy;
    }

    function visibleEntries() {
        if (!relayState) return [];
        return feedEntries.filter(entry => entry.round === relayState.round && HANGUL_TRIPLE.test(entry.word));
    }

    function countMyEntries() {
        const nick = currentNick();
        return visibleEntries().filter(entry => entry.name === nick).length;
    }

    function isNearBottom(list) {
        try {
            return list.scrollHeight - list.scrollTop - list.clientHeight < 60;
        } catch (_) {
            return true;
        }
    }

    function createFeedItem({ index, word, name, timeText, memo, starter = false }) {
        const item = document.createElement('li');
        item.className = `kkung-feed-item${starter ? ' is-starter' : ''}`;

        const number = document.createElement('span');
        number.className = 'kkung-feed-index';
        number.textContent = starter ? '출발' : String(index);

        const body = document.createElement('div');
        body.className = 'kkung-feed-body';

        const wordLine = document.createElement('div');
        wordLine.className = 'kkung-feed-wordline';
        const wordEl = document.createElement('strong');
        wordEl.className = 'kkung-feed-word';
        wordEl.textContent = word;
        wordLine.append(wordEl);
        if (timeText) {
            const timeEl = document.createElement('span');
            timeEl.className = 'kkung-feed-time';
            timeEl.textContent = timeText;
            wordLine.append(timeEl);
        }

        const meta = document.createElement('span');
        meta.className = 'kkung-feed-meta';
        meta.textContent = starter ? '릴레이 출발 단어' : `${name} 님이 이어씀`;

        body.append(wordLine, meta);
        if (memo) {
            const memoEl = document.createElement('p');
            memoEl.className = 'kkung-feed-memo';
            memoEl.textContent = memo;
            body.append(memoEl);
        }

        item.append(number, body);
        return item;
    }

    function renderFeed() {
        const list = byId('kkungFeed');
        if (!list) return;
        const stickToBottom = isNearBottom(list);
        const entries = visibleEntries();
        list.replaceChildren();

        if (relayState && relayState.starterWord) {
            list.append(createFeedItem({
                index: 0,
                word: relayState.starterWord,
                name: '',
                timeText: '',
                memo: '',
                starter: true
            }));
        }

        if (!entries.length) {
            const empty = document.createElement('li');
            empty.className = 'kkung-feed-empty';
            empty.textContent = relayState
                ? '아직 이어진 댓글이 없어요. 첫 번째로 단어를 남겨 보세요!'
                : '릴레이가 시작되면 여기에 동료들의 댓글이 쌓입니다.';
            list.append(empty);
        }

        entries.forEach((entry, index) => {
            list.append(createFeedItem({
                index: index + 1,
                word: entry.word,
                name: entry.name,
                timeText: formatRelativeTime(entry.timestampMs),
                memo: entry.memo
            }));
        });

        if (stickToBottom) list.scrollTop = list.scrollHeight;
    }

    function renderSummary() {
        const total = byId('kkungWordTotal');
        const members = byId('kkungMemberTotal');
        const roundTitle = byId('kkungRoundTitle');
        const lastWord = byId('kkungLastWord');
        const required = byId('kkungRequiredLetter');
        const meta = byId('kkungFeedMeta');
        const resetNote = byId('kkungNewRoundHint');
        const entries = visibleEntries();

        if (total) total.textContent = String(relayState ? relayState.wordCount : 0);
        if (members) members.textContent = String(countParticipants(entries));
        if (roundTitle) roundTitle.textContent = relayState ? `릴레이 #${relayState.round}` : '릴레이 준비 중';
        if (lastWord) lastWord.textContent = relayState && relayState.lastWord ? relayState.lastWord : '—';
        if (required) required.textContent = relayState && relayState.lastWord ? lastSyllable(relayState.lastWord) : '—';
        if (meta) {
            meta.textContent = relayState
                ? `${entries.length}개 댓글 · 내가 남긴 ${countMyEntries()}개${relayState.lastNick ? ` · 최근 ${relayState.lastNick}` : ''}`
                : '첫 릴레이를 시작해 주세요';
        }
        if (resetNote) {
            const gate = canStartNewRound(relayState, { nowMs: Date.now() });
            resetNote.textContent = gate.allowed ? gate.reason : '이어지는 중이라 아직 새 출발할 수 없어요.';
        }
        const resetButton = byId('kkungNewRoundButton');
        if (resetButton && !isSubmitting) {
            resetButton.textContent = relayState ? '🔁 새 출발' : '🎬 첫 릴레이 시작';
        }
    }

    function renderAll() {
        renderFeed();
        renderSummary();
    }

    /* ---------------- 추천(힌트) ---------------- */

    function hideSuggestions() {
        const box = byId('kkungSuggestBox');
        if (!box) return;
        box.hidden = true;
        box.replaceChildren();
    }

    function showRelayHint() {
        if (isSubmitting) return;
        const box = byId('kkungSuggestBox');
        if (!relayState || !relayState.lastWord) {
            setStatus('릴레이가 시작되면 이어갈 단어를 추천해 드려요.', 'error');
            return;
        }
        const picks = suggestRelayWords(relayState.lastWord, relayState.usedWords, 6);
        if (!box) return;
        box.replaceChildren();
        if (!picks.length) {
            box.hidden = true;
            setStatus(`“${lastSyllable(relayState.lastWord)}”로 시작하는 추천 단어가 없어요. “새 출발”로 다음 릴레이를 열어 주세요.`, 'error');
            return;
        }
        const label = document.createElement('span');
        label.className = 'kkung-suggest-label';
        label.textContent = `“${lastSyllable(relayState.lastWord)}”로 시작하는 단어 (누르면 그대로 입력)`;
        box.append(label);
        picks.forEach(word => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'kkung-suggest-chip';
            chip.setAttribute('data-kkung-word', word);
            chip.textContent = word;
            box.append(chip);
        });
        box.hidden = false;
        setStatus('추천 단어를 눌러 이어도 좋고, 직접 다른 단어를 적어도 됩니다.', 'success');
    }

    function onSuggestionClick(event) {
        const chip = event.target?.closest?.('[data-kkung-word]');
        if (!chip) return;
        const input = byId('kkungWordInput');
        if (!input) return;
        input.value = chip.getAttribute('data-kkung-word') || '';
        input.focus();
    }

    /* ---------------- 실시간 구독 (카드를 볼 때만) ---------------- */

    function toFeedEntry(id, data) {
        const rawTimestamp = data.timestamp;
        const millis = rawTimestamp && typeof rawTimestamp.toMillis === 'function' ? rawTimestamp.toMillis() : rawTimestamp;
        return {
            id,
            round: Number.isFinite(Number(data.round)) ? Math.trunc(Number(data.round)) : 0,
            name: String(data.name || '익명').slice(0, MAX_NICK_LENGTH),
            word: String(data.word || ''),
            memo: String(data.memo || '').slice(0, MAX_MEMO_LENGTH),
            timestampMs: Number.isFinite(Number(millis)) && millis ? Number(millis) : null
        };
    }

    function startRelaySubscription() {
        if (stateUnsubscribe || feedUnsubscribe) return;
        const stateRef = relayStateRef();
        const commentsRef = relayCommentsRef();
        if (!stateRef || !commentsRef) {
            setLiveBadge(false);
            setStatus('데이터베이스를 준비하지 못했어요. 앱을 새로고침한 뒤 다시 열어 주세요.', 'error');
            return;
        }

        stateUnsubscribe = stateRef.onSnapshot(snapshot => {
            relayState = snapshot.exists ? normalizeRelayState(snapshot.data()) : null;
            setLiveBadge(true);
            renderAll();
            if (!relayState) {
                setStatus('아직 시작된 릴레이가 없어요. “첫 릴레이 시작”을 눌러 출발 단어를 정해 주세요.', 'neutral');
            }
        }, error => {
            console.warn('꿍꿍따 릴레이 상태 구독 오류:', error);
            setLiveBadge(false);
            setStatus('릴레이 정보를 불러오지 못했어요. 네트워크 상태를 확인해 주세요.', 'error');
        });

        feedUnsubscribe = commentsRef
            .orderBy('timestamp', 'desc')
            .limit(FEED_LIMIT)
            .onSnapshot(snapshot => {
                const entries = [];
                snapshot.forEach(docSnapshot => {
                    const data = docSnapshot.data() || {};
                    // 관리자 정리(소프트 삭제)·블라인드 기록은 릴레이에서 숨깁니다.
                    if (data.deletedAt || data.hidden) return;
                    entries.push(toFeedEntry(docSnapshot.id, data));
                });
                // desc 로 받았으니 화면에서는 오래된 순(위→아래)으로 뒤집습니다.
                entries.reverse();
                feedEntries = entries;
                renderAll();
            }, error => {
                console.warn('꿍꿍따 릴레이 댓글 구독 오류:', error);
            });
    }

    function stopRelaySubscription() {
        if (typeof stateUnsubscribe === 'function') stateUnsubscribe();
        if (typeof feedUnsubscribe === 'function') feedUnsubscribe();
        stateUnsubscribe = null;
        feedUnsubscribe = null;
        setLiveBadge(false);
    }

    function syncSubscription() {
        const shouldRun = relayVisible && (typeof document === 'undefined' || !document.hidden);
        if (shouldRun) startRelaySubscription();
        else stopRelaySubscription();
    }

    function observeRelayVisibility() {
        const root = byId('kkungRelay');
        if (!root) return;
        if (typeof global.IntersectionObserver !== 'function') {
            // 구형 브라우저: 항상 구독 (카드를 접어도 실시간 갱신 유지)
            relayVisible = true;
            syncSubscription();
            return;
        }
        visibilityObserver = new global.IntersectionObserver(entries => {
            relayVisible = entries.some(entry => entry.isIntersecting);
            syncSubscription();
        }, { threshold: 0.02 });
        visibilityObserver.observe(root);
        document.addEventListener('visibilitychange', () => syncSubscription());
    }

    /* ---------------- 쓰기: 단어 댓글 · 새 출발 ---------------- */

    async function submitRelayWord(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (isSubmitting) return;

        const wordInput = byId('kkungWordInput');
        const memoInput = byId('kkungMemoInput');
        if (!wordInput) return;

        if (!relayState || !relayState.lastWord) {
            setStatus('아직 릴레이가 없어요. 아래 “첫 릴레이 시작”을 눌러 출발 단어를 정해 주세요.', 'error');
            return;
        }

        const check = validateRelayWord(wordInput.value, relayState.lastWord, relayState.usedWords);
        if (!check.ok) {
            setStatus(check.message, 'error');
            wordInput.focus();
            return;
        }

        const nick = currentNick();
        const memo = String(memoInput?.value || '').trim().slice(0, MAX_MEMO_LENGTH);
        const moderation = moderateRelayText(check.word, memo, nick);
        if (moderation.hidden) {
            setStatus(`⚠️ ${moderation.reason || '금칙어/도배'} 감지로 등록할 수 없어요.`, 'error');
            notifyRelayBlind({
                category: '꿍꿍따 릴레이',
                author: nick,
                text: `${check.word} ${memo}`.trim(),
                reason: moderation.reason
            });
            return;
        }
        if (relayState.usedWords.length >= MAX_USED_WORDS) {
            setStatus(`한 릴레이에 단어가 ${MAX_USED_WORDS}개까지 쌓였어요. “새 출발”로 다음 릴레이를 열어 주세요.`, 'error');
            return;
        }

        const store = relayFirestore();
        const stateRef = relayStateRef();
        const commentsRef = relayCommentsRef();
        if (!store || !stateRef || !commentsRef) {
            setStatus('데이터베이스를 준비하지 못했어요. 앱을 새로고침해 주세요.', 'error');
            return;
        }

        isSubmitting = true;
        setBusy(true);
        try {
            await ensureRelayAuth();
            // 트랜잭션: 두 명이 동시에 같은 단어를 잇거나 순서가 뒤엉키는 것을 막습니다.
            await store.runTransaction(async transaction => {
                const snapshot = await transaction.get(stateRef);
                if (!snapshot.exists) throw relayError('릴레이가 초기화되었어요. “첫 릴레이 시작”을 눌러 주세요.');
                const state = normalizeRelayState(snapshot.data());
                const fresh = validateRelayWord(check.word, state.lastWord, state.usedWords);
                if (!fresh.ok) throw relayError(fresh.message);
                if (state.usedWords.length >= MAX_USED_WORDS) {
                    throw relayError(`단어가 ${MAX_USED_WORDS}개까지 쌓였어요. “새 출발”로 다음 릴레이를 열어 주세요.`);
                }
                transaction.set(commentsRef.doc(), {
                    round: state.round,
                    name: nick,
                    word: fresh.word,
                    prevWord: state.lastWord,
                    memo: memo || null,
                    timestamp: serverTimestamp()
                });
                transaction.update(stateRef, {
                    round: state.round,
                    lastWord: fresh.word,
                    wordCount: state.wordCount + 1,
                    usedWords: state.usedWords.concat([fresh.word]),
                    lastNick: nick,
                    updatedAt: serverTimestamp()
                });
                pendingWord = fresh.word;
            });

            const word = pendingWord || check.word;
            pendingWord = '';
            wordInput.value = '';
            if (memoInput) memoInput.value = '';
            saveNick(nick);
            hideSuggestions();
            setStatus(`✅ “${word}” 남겼어요. 다음 동료는 “${lastSyllable(word)}”로 시작하면 됩니다.`, 'success');
        } catch (error) {
            pendingWord = '';
            console.warn('꿍꿍따 릴레이 댓글 등록 실패:', error);
            setStatus(describeRelayError(error), 'error');
        } finally {
            isSubmitting = false;
            setBusy(false);
        }
    }

    async function startNewKkungRound() {
        if (isSubmitting) return;
        const store = relayFirestore();
        const stateRef = relayStateRef();
        if (!store || !stateRef) {
            setStatus('데이터베이스를 준비하지 못했어요. 앱을 새로고침해 주세요.', 'error');
            return;
        }

        const gate = canStartNewRound(relayState, { nowMs: Date.now() });
        if (relayState && !gate.allowed) {
            setStatus(gate.reason, 'error');
            return;
        }

        const nick = currentNick();
        const starter = chooseStarterWord();
        const question = relayState
            ? `지금까지 ${relayState.wordCount}개 단어가 이어졌어요.\n“${starter}”로 새 릴레이를 시작할까요?`
            : `“${starter}”로 첫 릴레이를 시작할까요?`;
        if (typeof global.confirm === 'function' && !global.confirm(question)) return;

        isSubmitting = true;
        setBusy(true);
        let startedRound = 1;
        try {
            await ensureRelayAuth();
            await store.runTransaction(async transaction => {
                const snapshot = await transaction.get(stateRef);
                const state = snapshot.exists ? normalizeRelayState(snapshot.data()) : null;
                if (!state) {
                    startedRound = 1;
                    transaction.set(stateRef, createRelayState(starter, 1, nick));
                    return;
                }
                const freshGate = canStartNewRound(state, { nowMs: Date.now() });
                if (!freshGate.allowed) throw relayError(freshGate.reason);
                startedRound = state.round + 1;
                transaction.set(stateRef, createRelayState(starter, startedRound, nick));
            });
            saveNick(nick);
            hideSuggestions();
            setStatus(`🔁 릴레이 #${startedRound} 출발! 출발 단어는 “${starter}”, “${lastSyllable(starter)}”로 이어 주세요.`, 'success');
        } catch (error) {
            console.warn('꿍꿍따 릴레이 새 출발 실패:', error);
            if (error && error.code === 'permission-denied' && relayState) {
                setStatus('방금 단어가 이어져 아직 새 출발할 수 없어요. 1분 뒤에 다시 시도해 주세요.', 'error');
            } else {
                setStatus(describeRelayError(error), 'error');
            }
        } finally {
            isSubmitting = false;
            setBusy(false);
            renderSummary();
        }
    }

    /* ---------------- 초기화 ---------------- */

    function init() {
        // 이 모듈의 마크업이 없는 배포본(테스트·관리자 화면 등)에서는 조용히 종료합니다.
        if (!byId('kkungRelay')) return;

        const dictionaryCount = byId('kkungDictionaryCount');
        if (dictionaryCount) dictionaryCount.textContent = WORDS.length.toLocaleString('ko-KR');

        const nickInput = byId('kkungNick');
        if (nickInput) {
            const saved = readSavedNick();
            let fallback = '';
            try {
                if (typeof global.getPortNickname === 'function') fallback = String(global.getPortNickname() || '');
            } catch (_) {}
            nickInput.value = saved || fallback;
            nickInput.addEventListener('change', () => saveNick(String(nickInput.value || '').trim().slice(0, MAX_NICK_LENGTH)));
        }

        byId('kkungRelayForm')?.addEventListener('submit', submitRelayWord);
        byId('kkungSuggestBox')?.addEventListener('click', onSuggestionClick);
        byId('kkungHintButton')?.addEventListener('click', showRelayHint);
        byId('kkungNewRoundButton')?.addEventListener('click', startNewKkungRound);

        observeRelayVisibility();
        renderAll();
    }

    global.KkungKkungTtaCore = Object.freeze({
        words: WORDS,
        roundTargetWords: ROUND_TARGET_WORDS,
        roundIdleResetMs: ROUND_IDLE_RESET_MS,
        maxUsedWords: MAX_USED_WORDS,
        collection: RELAY_COLLECTION,
        docId: RELAY_DOC_ID,
        lastSyllable,
        getPlayableWords,
        validateRelayWord,
        suggestRelayWords,
        chooseStarterWord,
        createRelayState,
        normalizeRelayState,
        canStartNewRound,
        formatRelativeTime,
        countParticipants
    });
    global.submitKkungRelayWord = submitRelayWord;
    global.showKkungRelayHint = showRelayHint;
    global.startNewKkungRound = startNewKkungRound;

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
