// ============================================================================
// BUSAN HAK PORT INFO — Copyright (c) 2026 이춘학 (luxrank@gmail.com). All rights reserved.
// 사유 소프트웨어입니다. 저작권자의 사전 서면 동의 없이 복제·배포·수정·2차적 저작물 작성·
// 역분석·디컴파일을 할 수 없습니다. 자세한 내용은 저장소의 LICENSE 파일을 참고하세요.
// ============================================================================

/**
 * 파이어베이스 'ships' 컬렉션에서 개수 제한 없이 모든 데이터를 가져와 
 * 게시판(테이블) 형태로 렌더링하고 검색 필터링을 수행하는 함수
 * @param {string} searchKeyword - 검색어 (선택 사항)
 */
async function loadAndSearchAllShips(searchKeyword = "") {
    if (!isWorkLogUnlocked) return;
    const containerId = "vessel-result-container";
    const resultContainer = document.getElementById(containerId);

    try {
        if (!resultContainer) {
            console.error(`[Error] '${containerId}' 요소를 페이지에서 찾을 수 없습니다.`);
            return;
        }

        resultContainer.innerHTML = "<p style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>전체 선박 데이터를 불러오는 중입니다...</p>";

        if (typeof firebase === "undefined" || !firebase.firestore) {
            throw new Error("Firebase Firestore가 초기화되지 않았습니다.");
        }

        let shipList = [];
        if (Array.isArray(allShipsData) && allShipsData.length > 0) {
            shipList = allShipsData.map(item => ({ ...item }));
        } else {
            const db = firebase.firestore();
            const querySnapshot = await db.collection("ships").get();
            if (querySnapshot.empty) {
                resultContainer.innerHTML = "<p style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>등록된 선박 데이터가 없습니다.</p>";
                return;
            }
            querySnapshot.forEach(doc => {
                let data = doc.data();
                data.id = doc.id;
                shipList.push(data);
            });
        }

        if (shipList.length === 0) {
            resultContainer.innerHTML = "<p style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>등록된 선박 데이터가 없습니다.</p>";
            return;
        }

        shipList.sort((a, b) => {
            const tA = a.timestamp && a.timestamp.toMillis ? a.timestamp.toMillis() : 0;
            const tB = b.timestamp && b.timestamp.toMillis ? b.timestamp.toMillis() : 0;
            return tB - tA;
        });

        const keyword = searchKeyword ? searchKeyword.trim().toLowerCase() : "";
        const diffFilter = parseInt(document.getElementById('shipDifficultyFilter')?.value || '0', 10) || 0;
        const warnTags = ["#브릿지주의", "#라싱바무거움", "#턴버클뻑뻑함", "#통로협소"];

        shipList = shipList.filter(item => {
            const sTags = typeof extractShipTags === "function" ? extractShipTags(item) : (Array.isArray(item.tags) ? item.tags : []);
            const sDiff = Number(item.difficulty) || 0;
            if (keyword !== "") {
                const shipName = String(item.shipName || item.name || item.vesselName || item.title || "").toLowerCase();
                const shipCode = String(item.code || item.number || "").toLowerCase();
                const shipMemo = (typeof getShipMemoText === "function"
                    ? `${getShipMemoText(item)} ${getShipLegacyOnshoreText(item)}`
                    : String(item.onboardFeat || item.memo || item.info || "")).toLowerCase();
                const tagStr = sTags.join(" ").toLowerCase();
                const compactTagStr = sTags.map(t => t.replace(/\s+/g, '')).join(" ").toLowerCase();
                if (!shipName.includes(keyword) && !shipCode.includes(keyword) && !shipMemo.includes(keyword) && !tagStr.includes(keyword) && !compactTagStr.includes(keyword)) {
                    return false;
                }
            }
            if (typeof activeShipFilterTags !== "undefined" && activeShipFilterTags.length > 0) {
                if (!activeShipFilterTags.every(t => sTags.includes(t))) return false;
            }
            if (diffFilter > 0) {
                if (diffFilter === 2) {
                    if (!sDiff || sDiff > 2) return false;
                } else if (sDiff < diffFilter) {
                    return false;
                }
            }
            return true;
        });

        if (shipList.length === 0) {
            resultContainer.innerHTML = `<p style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>조건에 맞는 선박 검색 결과가 없습니다.</p>`;
            return;
        }

        let boardHTML = `
            <div class="vessel-scroll-wrap">
                <table class="vessel-compact-table">
                    <thead>
                        <tr>
                            <th style="width:42px; text-align:center;">번호</th>
                            <th>선박명 · 난이도 · 장비 태그 · 작업 요약</th>
                            <th style="width:58px; text-align:center;">상세</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        shipList.forEach((item, index) => {
            const title = escapeHtml(item.shipName || item.name || item.vesselName || item.title || `선박 정보 #${index + 1}`);
            const memoSource = typeof getShipMemoText === "function"
                ? (getShipMemoText(item) || getShipLegacyOnshoreText(item))
                : (item.onboardFeat || item.memo || item.schedule || item.info || "");
            const subInfo = escapeHtml(String(memoSource || "상세 내용 보기").replace(/\s+/g, " ").trim());
            const diff = Number(item.difficulty) || 0;
            const starHtml = diff > 0 ? `<span class="ship-badge-star" style="padding:0px 4px; font-size:0.66rem; margin-left:2px;">${"★".repeat(diff)}${"☆".repeat(5 - diff)}</span>` : "";
            const sTags = typeof extractShipTags === "function" ? extractShipTags(item) : (Array.isArray(item.tags) ? item.tags : []);
            const tagsHtml = sTags.length > 0
                ? sTags.map(t => `<span class="ship-badge-tag ${warnTags.includes(t) ? 'warn' : ''}" style="padding:0px 5px; font-size:0.65rem; margin-right:2px; margin-top:0;">${escapeHtml(t)}</span>`).join("")
                : "";
            let dateStr = "";
            if (item.timestamp && item.timestamp.toDate) {
                const dt = item.timestamp.toDate();
                dateStr = `${String(dt.getFullYear()).slice(2)}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
            }
            const viewCnt = Math.max(0, Number(item.views) || 0);

            boardHTML += `
                <tr onclick="openShipDetailView('${item.id}')">
                    <td style="text-align:center; font-weight:800; color:var(--text-sub); font-size:0.74rem;">${shipList.length - index}</td>
                    <td>
                        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:3px;">
                            <span style="font-weight:900; color:var(--text-main); font-size:0.83rem;">🚢 ${title}</span>
                            ${starHtml}
                            ${tagsHtml}
                            <span id="view-full-s-${item.id}" class="view-count-pill" style="font-size:0.64rem; padding:0px 5px; margin-left:2px;">👁️ ${viewCnt.toLocaleString()}</span>
                            ${dateStr ? `<span style="font-size:0.68rem; color:var(--text-sub); font-weight:700; margin-left:auto;">${dateStr}</span>` : ""}
                        </div>
                        <div style="font-size:0.74rem; color:var(--text-sub); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:56vw;">${subInfo}</div>
                    </td>
                    <td style="text-align:center;">
                        <button type="button" class="vessel-open-btn" style="padding:3px 7px; background:var(--primary-light); color:white; border:none; border-radius:5px; font-size:0.72rem; font-weight:800; cursor:pointer; transition:all 0.14s ease;">열기</button>
                    </td>
                </tr>
            `;
        });

        boardHTML += `
                    </tbody>
                </table>
            </div>
            <div style="padding:8px 4px 2px; text-align:right; font-size:0.82rem; color:var(--primary); font-weight:800;">
                총 조회된 선박 데이터: <strong>${shipList.length}척</strong>
            </div>
        `;

        resultContainer.innerHTML = boardHTML;

    } catch (error) {
        console.error("[Fatal Error] 선박 정보 전체 조회 실패:", error);
        if (resultContainer) {
            resultContainer.innerHTML = "<p style='text-align:center; padding:20px; color:var(--danger); font-weight:700;'>데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.</p>";
        }
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, '&#039;');
}

async function openShipDetailView(docId) {
    try {
        if (typeof incrementBoardItemViewCount === "function") {
            incrementBoardItemViewCount("ships", docId, "s");
        }
        let data = Array.isArray(allShipsData) ? allShipsData.find(s => s.id === docId) : null;
        if (!data) {
            const db = firebase.firestore();
            const docSnap = await db.collection("ships").doc(docId).get();
            if (!docSnap.exists) {
                alert("해당 선박 정보를 찾을 수 없습니다.");
                return;
            }
            data = docSnap.data();
        }
        const hasShipHelpers = typeof getShipMemoText === "function";
        const name = (hasShipHelpers ? getShipDisplayName(data) : (data.shipName || data.name)) || "선박명 없음";
        const diff = Number(data.difficulty) || 0;
        const diffText = diff > 0 ? `${"★".repeat(diff)}${"☆".repeat(5 - diff)} (${diff}점)` : "미지정";
        const sTags = typeof extractShipTags === "function" ? extractShipTags(data) : (Array.isArray(data.tags) ? data.tags : []);
        const feat = (hasShipHelpers ? getShipMemoText(data) : (data.onboardFeat || data.memo)) || "내용 없음";
        const onshoreFeat = hasShipHelpers ? getShipLegacyOnshoreText(data) : "";
        const views = Math.max(1, Number(data.views) || 1);
        let detailText = `🚢 [선박 상세 정보]\n\n• 선박명: ${name}\n• 작업 난이도: ${diffText}\n• 장비/특징 태그: ${sTags.length ? sTags.join(" ") : "없음"}\n• 조회수: ${views.toLocaleString()}회\n\n📝 [작업 내용 및 특이사항]\n${feat}`;
        if (onshoreFeat) detailText += `\n\n🚛 [육상 작업 특징]\n${onshoreFeat}`;
        alert(detailText);

    } catch (error) {
        console.error("[Error] 상세 정보 로드 실패:", error);
        alert("상세 내용을 불러오는 데 실패했습니다.");
    }
}
