// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 부산항 스마트 작업 가이드의 오프라인 3음절 끝말잇기 미니게임.
// ============================================================================
(function initKkungKkungTta(global) {
    'use strict';

    // 외부 사전/API 없이 동작하는 기본 어휘 모음입니다. 고유명사·지역어·외래어는 일부 제외됩니다.
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
    const WORD_SET = new Set(WORDS);

    const TURN_SECONDS = 18;
    const TURN_MS = TURN_SECONDS * 1000;
    const STORAGE_KEY = 'busanPortKkungKkungTtaStatsV1';
    const STARTER_WORDS = Object.freeze(`강아지 고양이 바나나 노래방 운동장 구급차 물고기 비상구 거짓말 안전모 신호등 부산항 정류장 냉장고 미역국 반딧불 타이어 화장실 이슬비 소나기 고구마 부산역 책가방`.split(/\s+/u));

    function lastSyllable(word) {
        const chars = Array.from(String(word || ''));
        return chars.length ? chars[chars.length - 1] : '';
    }

    function toUsedSet(usedWords) {
        if (usedWords instanceof Set) return usedWords;
        return new Set(Array.isArray(usedWords) ? usedWords : []);
    }

    function getPlayableWords(previousWord, usedWords = []) {
        const required = lastSyllable(previousWord);
        if (!required) return [];
        const used = toUsedSet(usedWords);
        return WORDS.filter(word => word[0] === required && !used.has(word));
    }

    function validateWord(input, previousWord, usedWords = []) {
        const word = String(input ?? '').normalize('NFC').trim();
        const used = toUsedSet(usedWords);
        if (!word) return { ok: false, code: 'empty', message: '단어를 입력해 주세요.' };
        if (!/^[가-힣]{3}$/u.test(word)) {
            return { ok: false, code: 'length', message: '꿍꿍따는 한글 세 글자 단어만 가능해요.' };
        }
        if (!WORD_SET.has(word)) {
            return { ok: false, code: 'dictionary', message: '앱 내장 사전에 없는 단어예요. 다른 단어를 골라 주세요.' };
        }
        if (used.has(word)) {
            return { ok: false, code: 'duplicate', message: '이미 나온 단어예요. 새로운 단어를 말해 주세요.' };
        }
        const required = lastSyllable(previousWord);
        if (required && word[0] !== required) {
            return { ok: false, code: 'chain', message: `“${required}”으로 시작하는 단어를 입력해 주세요.` };
        }
        return { ok: true, code: 'ok', word };
    }

    function pickRandom(items, random = Math.random) {
        if (!items.length) return null;
        const value = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
        return items[Math.floor(value * items.length)];
    }

    function chooseStarterWord(random = Math.random) {
        const pool = STARTER_WORDS.filter(word =>
            WORD_SET.has(word) && getPlayableWords(word, [word]).length > 0
        );
        return pickRandom(pool, random) || '고양이';
    }

    function chooseAiWord(previousWord, usedWords = [], difficulty = 'normal', random = Math.random) {
        const candidates = getPlayableWords(previousWord, usedWords);
        if (!candidates.length) return null;
        if (difficulty === 'easy') return pickRandom(candidates, random);

        const used = new Set(toUsedSet(usedWords));
        const scored = candidates.map(word => {
            const nextUsed = new Set(used);
            nextUsed.add(word);
            return { word, nextMoves: getPlayableWords(word, nextUsed).length };
        });

        if (difficulty === 'hard') {
            const fewest = Math.min(...scored.map(item => item.nextMoves));
            return pickRandom(scored.filter(item => item.nextMoves === fewest), random).word;
        }

        // 보통 난이도는 바로 막히는 수를 피하고, 선택지가 지나치게 많지 않은 단어를 고릅니다.
        const viable = scored.filter(item => item.nextMoves > 0);
        const fairPool = viable.filter(item => item.nextMoves <= 5);
        return pickRandom(fairPool.length ? fairPool : (viable.length ? viable : scored), random).word;
    }

    function chooseHint(previousWord, usedWords = [], random = Math.random) {
        const candidates = getPlayableWords(previousWord, usedWords);
        if (!candidates.length) return null;
        const used = new Set(toUsedSet(usedWords));
        const scored = candidates.map(word => {
            const nextUsed = new Set(used);
            nextUsed.add(word);
            return { word, nextMoves: getPlayableWords(word, nextUsed).length };
        });
        const mostOptions = Math.max(...scored.map(item => item.nextMoves));
        return pickRandom(scored.filter(item => item.nextMoves === mostOptions), random).word;
    }

    function createStats() {
        return { aiMatches: 0, aiWins: 0, bestChain: 0 };
    }

    function loadStats() {
        try {
            const saved = JSON.parse(global.localStorage?.getItem(STORAGE_KEY) || 'null');
            return {
                aiMatches: Number.isFinite(Number(saved?.aiMatches)) ? Number(saved.aiMatches) : 0,
                aiWins: Number.isFinite(Number(saved?.aiWins)) ? Number(saved.aiWins) : 0,
                bestChain: Number.isFinite(Number(saved?.bestChain)) ? Number(saved.bestChain) : 0
            };
        } catch (_) {
            return createStats();
        }
    }

    function saveStats(stats) {
        try { global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch (_) {}
    }

    let selectedMode = 'ai';
    let game = null;
    let stats = loadStats();
    let clockId = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function setScreen(screen) {
        const ids = { setup: 'kkungSetup', play: 'kkungPlay', result: 'kkungResult' };
        Object.entries(ids).forEach(([key, id]) => {
            const el = byId(id);
            if (el) el.hidden = key !== screen;
        });
    }

    function updateStats() {
        const wins = byId('kkungAiWins');
        const best = byId('kkungBestChain');
        if (wins) wins.textContent = String(stats.aiWins);
        if (best) best.textContent = String(stats.bestChain);
    }

    function selectMode(mode) {
        if (mode !== 'ai' && mode !== 'local') return;
        selectedMode = mode;
        document.querySelectorAll('[data-kkung-mode]').forEach(button => {
            const active = button.getAttribute('data-kkung-mode') === mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        const localOptions = byId('kkungLocalOptions');
        const aiOptions = byId('kkungAiOptions');
        if (localOptions) localOptions.hidden = mode !== 'local';
        if (aiOptions) aiOptions.hidden = mode !== 'ai';
    }

    function isGameVisible() {
        const card = byId('safety-card');
        return Boolean(
            !document.hidden &&
            card &&
            card.classList.contains('expanded') &&
            !card.classList.contains('view-hidden')
        );
    }

    function setStatus(message, tone = '') {
        const status = byId('kkungGameStatus');
        if (!status) return;
        status.textContent = message;
        status.classList.remove('is-error', 'is-success', 'is-neutral');
        status.classList.add(tone ? `is-${tone}` : 'is-neutral');
    }

    function renderPlayers() {
        const wrap = byId('kkungPlayers');
        if (!wrap || !game) return;
        wrap.replaceChildren();
        game.players.forEach((name, index) => {
            const card = document.createElement('div');
            card.className = `kkung-player${game.currentPlayer === index ? ' is-current' : ''}`;
            const top = document.createElement('div');
            top.className = 'kkung-player-top';
            const label = document.createElement('span');
            label.className = 'kkung-player-name';
            label.textContent = name;
            const badge = document.createElement('span');
            badge.className = 'kkung-player-turn';
            badge.textContent = game.currentPlayer === index && !game.isAiThinking ? '차례' : '';
            top.append(label, badge);
            const score = document.createElement('strong');
            score.className = 'kkung-player-score';
            score.textContent = String(game.scores[index] || 0);
            const unit = document.createElement('span');
            unit.className = 'kkung-player-unit';
            unit.textContent = '단어';
            const scoreRow = document.createElement('div');
            scoreRow.className = 'kkung-player-score-row';
            scoreRow.append(score, unit);
            card.append(top, scoreRow);
            wrap.append(card);
        });
    }

    function renderHistory() {
        const list = byId('kkungWordHistory');
        if (!list || !game) return;
        list.replaceChildren();
        game.history.forEach((entry, index) => {
            const item = document.createElement('li');
            item.className = `kkung-history-item${index === game.history.length - 1 ? ' is-latest' : ''}${entry.starter ? ' is-starter' : ''}`;
            const number = document.createElement('span');
            number.className = 'kkung-history-number';
            number.textContent = entry.starter ? 'START' : String(index).padStart(2, '0');
            const word = document.createElement('strong');
            word.className = 'kkung-history-word';
            word.textContent = entry.word;
            const owner = document.createElement('span');
            owner.className = 'kkung-history-owner';
            owner.textContent = entry.starter ? '출발 단어' : game.players[entry.owner];
            item.append(number, word, owner);
            list.append(item);
        });
        list.scrollTop = list.scrollHeight;
        const count = byId('kkungWordCount');
        if (count) count.textContent = `${game.history.length}개 단어`;
    }

    function renderTimer() {
        if (!game) return;
        const totalSeconds = Math.ceil(game.remainingMs / 1000);
        const timerText = byId('kkungTimerText');
        const track = byId('kkungTimerBar');
        const progress = byId('kkungTimerTrack');
        const percent = Math.max(0, Math.min(100, (game.remainingMs / TURN_MS) * 100));
        if (timerText) timerText.textContent = `${totalSeconds}초`;
        if (track) track.style.width = `${percent}%`;
        if (progress) progress.setAttribute('aria-valuenow', String(totalSeconds));
        if (progress) progress.classList.toggle('is-urgent', totalSeconds <= 5);
    }

    function renderGame() {
        if (!game) return;
        const lastWord = byId('kkungLastWord');
        const required = byId('kkungRequiredLetter');
        const turnName = byId('kkungTurnName');
        const input = byId('kkungWordInput');
        const submit = byId('kkungSubmit');
        const hint = byId('kkungHintButton');
        const hintCount = byId('kkungHintCount');
        if (lastWord) lastWord.textContent = game.lastWord;
        if (required) required.textContent = lastSyllable(game.lastWord);
        if (turnName) turnName.textContent = game.isAiThinking ? `${game.players[1]} 생각 중…` : `${game.players[game.currentPlayer]} 차례`;
        if (input) input.disabled = !game.active || game.isAiThinking;
        if (submit) submit.disabled = !game.active || game.isAiThinking;
        if (hint) hint.hidden = game.mode !== 'ai';
        if (hintCount) hintCount.textContent = String(game.hintsLeft);
        if (hint) hint.disabled = game.hintsLeft <= 0 || !game.active || game.isAiThinking;
        renderPlayers();
        renderHistory();
        renderTimer();
    }

    function clearTimers() {
        if (clockId !== null) {
            global.clearInterval(clockId);
            clockId = null;
        }
        if (game?.aiTimeoutId) {
            global.clearTimeout(game.aiTimeoutId);
            game.aiTimeoutId = null;
        }
    }

    function startClock() {
        if (clockId !== null) global.clearInterval(clockId);
        if (!game) return;
        game.lastClockAt = Date.now();
        clockId = global.setInterval(() => {
            if (!game?.active || game.isAiThinking) return;
            const now = Date.now();
            if (!isGameVisible()) {
                game.lastClockAt = now;
                return;
            }
            const elapsed = Math.max(0, now - game.lastClockAt);
            game.lastClockAt = now;
            game.remainingMs = Math.max(0, game.remainingMs - elapsed);
            renderTimer();
            if (game.remainingMs <= 0) finishRound(1 - game.currentPlayer, 'timeout');
        }, 200);
    }

    function startTurn() {
        if (!game?.active) return;
        game.isAiThinking = false;
        game.remainingMs = TURN_MS;
        game.lastClockAt = Date.now();
        setStatus(`${game.players[game.currentPlayer]}님 차례예요. 마지막 글자 “${lastSyllable(game.lastWord)}”로 시작하는 세 글자 단어를 입력하세요.`, 'neutral');
        renderGame();
    }

    function startGame() {
        if (!byId('kkungGame')) return;
        clearTimers();
        const mode = selectedMode;
        const starter = chooseStarterWord();
        const nameOne = (byId('kkungPlayerOne')?.value || '').trim().slice(0, 10) || '나';
        const nameTwo = (byId('kkungPlayerTwo')?.value || '').trim().slice(0, 10) || '친구';
        const difficulty = byId('kkungDifficulty')?.value || 'normal';
        const players = mode === 'ai' ? [nameOne, 'AI'] : [nameOne, nameTwo];
        game = {
            active: true,
            mode,
            difficulty,
            players,
            scores: [0, 0],
            currentPlayer: 0,
            lastWord: starter,
            usedWords: new Set([starter]),
            history: [{ word: starter, owner: -1, starter: true }],
            remainingMs: TURN_MS,
            lastClockAt: Date.now(),
            isAiThinking: false,
            aiTimeoutId: null,
            hintsLeft: 2,
            moveCount: 0,
            winner: null,
            reason: ''
        };
        const input = byId('kkungWordInput');
        if (input) input.value = '';
        setScreen('play');
        setStatus(`출발 단어는 “${starter}”예요. “${lastSyllable(starter)}”로 시작해 보세요!`, 'neutral');
        renderGame();
        startClock();
    }

    function recordWord(word, owner) {
        game.usedWords.add(word);
        game.lastWord = word;
        game.history.push({ word, owner, starter: false });
        game.scores[owner] += 1;
        game.moveCount += 1;
    }

    function submitWord(event) {
        if (event?.preventDefault) event.preventDefault();
        if (!game?.active || game.isAiThinking) return;
        const input = byId('kkungWordInput');
        if (!input) return;
        const result = validateWord(input.value, game.lastWord, game.usedWords);
        if (!result.ok) {
            setStatus(result.message, 'error');
            input.focus();
            return;
        }

        recordWord(result.word, game.currentPlayer);
        input.value = '';

        if (game.mode === 'ai') {
            game.currentPlayer = 1;
            game.isAiThinking = true;
            game.remainingMs = TURN_MS;
            setStatus('좋아요! AI가 단어를 고르고 있어요…', 'success');
            renderGame();
            game.aiTimeoutId = global.setTimeout(() => {
                if (!game?.active) return;
                const answer = chooseAiWord(game.lastWord, game.usedWords, game.difficulty);
                if (!answer) {
                    finishRound(0, 'ai-stuck');
                    return;
                }
                recordWord(answer, 1);
                game.currentPlayer = 0;
                startTurn();
            }, 650);
            return;
        }

        game.currentPlayer = 1 - game.currentPlayer;
        startTurn();
    }

    function useHint() {
        if (!game?.active || game.mode !== 'ai' || game.isAiThinking || game.hintsLeft <= 0) return;
        const hint = chooseHint(game.lastWord, game.usedWords);
        game.hintsLeft -= 1;
        if (hint) {
            setStatus(`힌트: “${hint}”도 가능해요. 직접 입력해 보세요!`, 'success');
        } else {
            setStatus('이 글자로 시작하는 사전 단어가 더 이상 없어요.', 'error');
        }
        renderGame();
    }

    function finishRound(winner, reason) {
        if (!game?.active) return;
        game.active = false;
        game.winner = winner;
        game.reason = reason;
        clearTimers();

        if (game.mode === 'ai') {
            stats.aiMatches += 1;
            if (winner === 0) stats.aiWins += 1;
            stats.bestChain = Math.max(stats.bestChain, game.moveCount);
            saveStats(stats);
            updateStats();
        } else {
            stats.bestChain = Math.max(stats.bestChain, game.moveCount);
            saveStats(stats);
            updateStats();
        }

        const title = byId('kkungResultTitle');
        const detail = byId('kkungResultDetail');
        const emoji = byId('kkungResultEmoji');
        const score = byId('kkungResultScore');
        const won = winner === 0;
        if (title) title.textContent = `${game.players[winner]} 승리!`;
        if (emoji) emoji.textContent = won ? '🎉' : (reason === 'timeout' ? '⏰' : '👏');
        if (detail) {
            if (reason === 'timeout') detail.textContent = `${game.players[1 - winner]}님 시간이 다 됐어요. 한 판 더 도전해 볼까요?`;
            else if (reason === 'ai-stuck') detail.textContent = 'AI가 이어갈 단어를 찾지 못했어요. 멋진 한 수였어요!';
            else detail.textContent = `${game.players[1 - winner]}님이 게임을 마쳤어요.`;
        }
        if (score) score.textContent = `${game.moveCount}개 단어를 이어 갔어요 · ${game.players[0]} ${game.scores[0]} : ${game.scores[1]} ${game.players[1]}`;
        setScreen('result');
    }

    function showSetup() {
        clearTimers();
        if (game) game.active = false;
        setScreen('setup');
        updateStats();
    }

    function leaveGame() {
        if (game?.active && typeof global.confirm === 'function' && !global.confirm('현재 판을 끝내고 게임 메뉴로 돌아갈까요?')) return;
        showSetup();
    }

    function init() {
        // 앱의 다른 화면 테스트/배포본에서도 게임 마크업이 없으면 조용히 종료합니다.
        if (!byId('kkungGame')) return;
        selectMode('ai');
        updateStats();
        const dictionaryCount = byId('kkungDictionaryCount');
        if (dictionaryCount) dictionaryCount.textContent = WORDS.length.toLocaleString('ko-KR');
        document.querySelectorAll('[data-kkung-mode]').forEach(button => {
            button.addEventListener('click', () => selectMode(button.getAttribute('data-kkung-mode')));
        });
        byId('kkungStartGame')?.addEventListener('click', startGame);
        byId('kkungWordForm')?.addEventListener('submit', submitWord);
        document.addEventListener('visibilitychange', () => {
            if (game) game.lastClockAt = Date.now();
        });
    }

    global.KkungKkungTtaCore = Object.freeze({
        words: WORDS,
        turnSeconds: TURN_SECONDS,
        lastSyllable,
        getPlayableWords,
        validateWord,
        chooseStarterWord,
        chooseAiWord,
        chooseHint
    });
    global.selectKkungGameMode = selectMode;
    global.startKkungGame = startGame;
    global.submitKkungGameWord = submitWord;
    global.useKkungGameHint = useHint;
    global.showKkungGameSetup = showSetup;
    global.leaveKkungGame = leaveGame;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})(window);
