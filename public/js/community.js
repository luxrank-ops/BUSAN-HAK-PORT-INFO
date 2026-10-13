let currentEditNoticeId = null; let currentEditNoticeImg = null; function autoLink(text) { if (!text) return ""; const urlRegex = /(https?:\/\/[^\s]+)/g; return text.replace(urlRegex, function(url) { return `<a href="${url}" target="_blank" style="color:#2563eb; text-decoration:underline; font-weight:bold;">${url}</a>`; }); }

// --- [3순위 자동화] 1) 이미지 용량 자동 최적화(1~2MB 이하 WebP/JPEG 압축) & 2) 금칙어·도배 자동 블라인드 ---
const COMMUNITY_BANNED_WORDS = [
    "씨발", "시발", "병신", "개새끼", "좆같", "미친놈", "꺼져라", "죽어라",
    "쓰레기새끼", "지랄", "염병", "불법도박", "토토사이트", "카지노사이트", "바카라사이트", "성인용품"
];
const recentCommunitySubmissions = [];
const COMMUNITY_FLOOD_WINDOW_MS = 3 * 60 * 1000;

function normalizeModerationText(value) {
    return String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\u200B\u200C\u200D._\-~*!@#$%^&()+=|<>?/,;:'"`[\]{}\\]+/g, "");
}

function inspectCommunityContent(payload = {}) {
    const rawTitle = String(payload.title || "").trim();
    const rawText = String(payload.text || "").trim();
    const combinedRaw = `${rawTitle} ${rawText}`.trim();
    const normalized = normalizeModerationText(combinedRaw);
    const category = String(payload.category || "community");
    const author = String(payload.author || "익명").trim();
    const nowMs = typeof payload.nowMs === "number" ? payload.nowMs : Date.now();

    if (!combinedRaw) {
        return { hidden: false, reason: null, matchedTerm: null };
    }

    // 1. 금칙어/비방/불법광고 키워드 검사
    for (const badWord of COMMUNITY_BANNED_WORDS) {
        const normBad = normalizeModerationText(badWord);
        if (normBad && normalized.includes(normBad)) {
            return {
                hidden: true,
                reason: "금칙어/비방 표현 감지",
                matchedTerm: badWord
            };
        }
    }

    // 2. 과도한 문자 반복 또는 스팸 링크 도배 검사
    if (/(.)\1{14,}/.test(combinedRaw)) {
        return {
            hidden: true,
            reason: "동일 문자 반복(도배) 감지",
            matchedTerm: "REPEATED_CHARS"
        };
    }
    const urlCount = (combinedRaw.match(/https?:\/\/[^\s]+/gi) || []).length;
    if (urlCount >= 4) {
        return {
            hidden: true,
            reason: "과도한 외부 링크(스팸) 감지",
            matchedTerm: "EXCESSIVE_URLS"
        };
    }

    // 3. 단시간 동일 내용 반복 등록(도배) 검사
    while (recentCommunitySubmissions.length > 0 && nowMs - recentCommunitySubmissions[0].timestampMs > COMMUNITY_FLOOD_WINDOW_MS) {
        recentCommunitySubmissions.shift();
    }
    if (normalized.length >= 4) {
        const duplicateCount = recentCommunitySubmissions.filter(
            item => item.category === category && item.normalized === normalized
        ).length;
        recentCommunitySubmissions.push({
            category,
            author,
            normalized,
            timestampMs: nowMs
        });
        if (duplicateCount >= 1) {
            return {
                hidden: true,
                reason: "동일 내용 반복 등록(도배) 감지",
                matchedTerm: "DUPLICATE_FLOOD"
            };
        }
    }

    return { hidden: false, reason: null, matchedTerm: null };
}

function notifyAdminAutoBlind(info = {}) {
    try {
        if (typeof db === "undefined" || !db || typeof db.collection !== "function") return;
        const createdAt = (typeof firebase !== "undefined" && firebase.firestore && firebase.firestore.FieldValue)
            ? firebase.firestore.FieldValue.serverTimestamp()
            : new Date();
        const snippet = String(info.title || info.text || "").slice(0, 60);
        db.collection("notifications").add({
            userId: "ADMIN",
            title: "🚨 커뮤니티 자동 블라인드 감지",
            body: `[${info.category || "게시판"}] 작성자(${info.author || "익명"})의 게시물이 자동 숨김 처리되었습니다. 사유: ${info.reason || "규칙 위반"} (${snippet})`,
            type: "AUTO_BLIND",
            category: info.category || "board",
            reason: info.reason || null,
            read: false,
            createdAt
        }).catch(() => {});
    } catch (e) {}
}

async function compressImageForUpload(file, options = {}) {
    if (!file || typeof file !== "object") return file;
    const mime = String(file.type || "").toLowerCase();
    if (!mime.startsWith("image/") || mime === "image/gif" || mime === "image/svg+xml") {
        return file;
    }

    const maxDimension = Number(options.maxDimension) || 1600;
    const targetMaxBytes = Number(options.targetMaxBytes) || (1.5 * 1024 * 1024);
    const skipUnderBytes = Number(options.skipUnderBytes) || (900 * 1024);

    if (!options.force && typeof file.size === "number" && file.size > 0 && file.size <= skipUnderBytes) {
        return file;
    }

    if (typeof document === "undefined" || typeof Image === "undefined") {
        return file;
    }

    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target && e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        if (!dataUrl) return file;

        const img = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = dataUrl;
        });

        const origW = Number(img.naturalWidth || img.width) || 0;
        const origH = Number(img.naturalHeight || img.height) || 0;
        if (!origW || !origH) return file;

        let targetW = origW;
        let targetH = origH;
        if (Math.max(origW, origH) > maxDimension) {
            if (origW >= origH) {
                targetW = maxDimension;
                targetH = Math.max(1, Math.round((origH * maxDimension) / origW));
            } else {
                targetH = maxDimension;
                targetW = Math.max(1, Math.round((origW * maxDimension) / origH));
            }
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx || typeof canvas.toBlob !== "function") return file;
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const preferredTypes = ["image/webp", "image/jpeg"];
        const qualities = [0.82, 0.72, 0.6];
        let bestBlob = null;

        for (const outType of preferredTypes) {
            for (const q of qualities) {
                const blob = await new Promise((resolve) => {
                    try {
                        canvas.toBlob((b) => resolve(b), outType, q);
                    } catch {
                        resolve(null);
                    }
                });
                if (!blob) continue;
                bestBlob = blob;
                if (blob.size <= targetMaxBytes) break;
            }
            if (bestBlob && bestBlob.size <= targetMaxBytes) break;
        }

        if (!bestBlob || (typeof file.size === "number" && bestBlob.size >= file.size)) {
            return file;
        }

        const ext = bestBlob.type === "image/webp" ? ".webp" : ".jpg";
        const baseName = String(file.name || "photo").replace(/\.[^.]+$/, "");
        const newName = `${baseName}${ext}`;
        if (typeof File === "function") {
            return new File([bestBlob], newName, { type: bestBlob.type, lastModified: Date.now() });
        }
        bestBlob.name = newName;
        return bestBlob;
    } catch {
        return file;
    }
}

async function startEditNotice(id, title, content, imgUrl, e) { e.stopPropagation(); if (!(await verifyAdmin())) return; currentEditNoticeId = id; currentEditNoticeImg = imgUrl; document.getElementById('noticeTitle').value = title; document.getElementById('noticeContent').value = content.replace(/\\n/g, '\n'); document.getElementById('noticeFileInput').value = ''; document.getElementById('noticeForm').classList.remove('hidden'); document.getElementById('noticeSubmitBtn').innerText = "수정 완료"; document.getElementById('noticeSubmitBtn').style.background = "var(--primary)"; document.getElementById('noticeCancelBtn').style.display = "block"; document.getElementById('noticeForm').scrollIntoView({behavior: 'smooth', block: 'center'}); } function cancelEditNotice() { currentEditNoticeId = null; currentEditNoticeImg = null; document.getElementById('noticeTitle').value = ''; document.getElementById('noticeContent').value = ''; document.getElementById('noticeFileInput').value = ''; document.getElementById('noticeSubmitBtn').innerText = "등록 완료"; document.getElementById('noticeSubmitBtn').style.background = "var(--success)"; document.getElementById('noticeCancelBtn').style.display = "none"; document.getElementById('noticeForm').classList.add('hidden'); } async function saveNotice() { if (!(await verifyAdmin())) return; const t = document.getElementById('noticeTitle').value.trim(); const c = document.getElementById('noticeContent').value.trim(); const f = document.getElementById('noticeFileInput').files[0]; const btn = document.getElementById('noticeSubmitBtn'); if (!t || !c) { alert("공지 제목과 내용을 입력해 주세요."); return; } btn.innerText = "서버 기록 중..."; btn.disabled = true; const finalize = (url) => { const data = { title: t, content: c, timestamp: firebase.firestore.FieldValue.serverTimestamp() }; if (url) { data.imageUrl = url; } else if (currentEditNoticeId && currentEditNoticeImg) { data.imageUrl = currentEditNoticeImg; } else { data.imageUrl = null; } let req; if (currentEditNoticeId) { req = db.collection("notices").doc(currentEditNoticeId).update(data); } else { req = db.collection("notices").add(data); } req.then(() => { const isEdit = !!currentEditNoticeId; cancelEditNotice(); showToast(isEdit ? "공지가 수정되었습니다." : "공지가 등록되었습니다."); }).catch(err => { alert("저장 실패: " + err.message); btn.innerText = currentEditNoticeId ? "수정 완료" : "등록 완료"; btn.disabled = false; }); }; if (f) { const optimizedFile = await compressImageForUpload(f); const storageRef = storage.ref(`notices/${Date.now()}_${optimizedFile.name || f.name}`); const uploadTask = storageRef.put(optimizedFile); uploadTask.on('state_changed', (snap) => { const percent = Math.round((snap.bytesTransferred / snap.totalBytes) * 100); btn.innerText = `사진 업로드 중... ${percent}%`; }, (err) => { alert("사진 업로드 실패: " + err.message); btn.disabled = false; btn.innerText = currentEditNoticeId ? "수정 완료" : "등록 완료"; }, () => { uploadTask.snapshot.ref.getDownloadURL().then(url => finalize(url)); }); } else { finalize(null); } } function delNotice(id,e){ e.stopPropagation(); verifyAdmin().then(r=>{ if(r) db.collection("notices").doc(id).delete(); }); }

const PORT_NICKNAME_STORAGE_KEY = "busanHakPortBoardNickname";
const PORT_NICKNAME_OPTIONS = [
    "부산항 도선사", "신항 도선사", "북항 예선장", "선석 지킴이",
    "컨테이너 포맨", "야드 검수원", "라싱 반장", "크레인 운전원",
    "샤시 기사", "부두 하역반장", "접안 안내원", "갠트리 크레인 기사",
    "RTGC 조종수", "리치스태커 기사", "본선 작업자", "화물 고박 담당",
    "터미널 배차원", "적재 검수원", "양하 작업자", "항만 안전요원",
    "신항 장비반장", "북항 포맨", "벌크 하역 작업자", "갑판 작업자",
    "야드 트랙터 기사", "선석 배정 담당", "컨테이너 기사", "하역 작업반장"
];

function pickPortNickname(previousNickname = "") {
    const options = PORT_NICKNAME_OPTIONS.filter(nickname => nickname !== previousNickname);
    const availableOptions = options.length ? options : PORT_NICKNAME_OPTIONS;
    return availableOptions[Math.floor(Math.random() * availableOptions.length)];
}

function getPortNickname(forceNew = false) {
    let savedNickname = "";
    try {
        savedNickname = localStorage.getItem(PORT_NICKNAME_STORAGE_KEY) || "";
    } catch (error) {
        // Private browsing settings may block localStorage; generation still works for this visit.
    }

    if (!forceNew && PORT_NICKNAME_OPTIONS.includes(savedNickname)) return savedNickname;

    const nickname = pickPortNickname(savedNickname);
    try {
        localStorage.setItem(PORT_NICKNAME_STORAGE_KEY, nickname);
    } catch (error) {
        // Keep the generated nickname in the current form even when it cannot be persisted.
    }
    return nickname;
}

function toggleBoardForm() {
    const form = document.getElementById("boardForm");
    if (!form) return;

    const isOpening = form.classList.contains("hidden");
    if (isOpening && !currentEditPostId) {
        const nicknameInput = document.getElementById("inputNick");
        if (nicknameInput && !nicknameInput.value.trim()) {
            nicknameInput.value = getPortNickname();
        }
    }
    form.classList.toggle("hidden");
}

function refreshBoardNickname() {
    const nicknameInput = document.getElementById("inputNick");
    if (!nicknameInput) return;
    nicknameInput.value = getPortNickname(true);
    nicknameInput.focus();
}

async function addPost() {
    const nickVal = document.getElementById("inputNick").value.trim();
    const titleVal = document.getElementById("inputTitle").value.trim();
    const pwVal = document.getElementById("inputPw").value.trim();
    const contentVal = document.getElementById("inputContent").value.trim();
    const btnEl = document.querySelector("#boardForm .bg-submit");

    if (!nickVal || !titleVal || !pwVal || !contentVal) {
        alert("모든 항목을 입력해 주세요.");
        return;
    }

    btnEl.innerText = "처리 중...";
    btnEl.disabled = true;
    const pwHash = (/^[a-f0-9]{64}$/i.test(pwVal)) ? pwVal.toLowerCase() : (await sha256Hex(pwVal));
    const modResult = inspectCommunityContent({
        title: titleVal,
        text: contentVal,
        author: nickVal,
        category: "왁자지껄 게시판"
    });
    const postData = {
        nick: nickVal,
        title: titleVal,
        password: pwHash,
        content: contentVal,
        hidden: Boolean(modResult.hidden),
        blindReason: modResult.reason || null,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (modResult.hidden) {
        notifyAdminAutoBlind({
            category: "왁자지껄 게시판",
            author: nickVal,
            title: titleVal,
            text: contentVal,
            reason: modResult.reason
        });
    }

    if (currentEditPostId) {
        db.collection("posts").doc(currentEditPostId).update(postData).then(() => {
            resetBoardForm();
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 게시글이 자동 블라인드 처리되었습니다." : "게시글이 수정되었습니다.");
        }).catch(() => {
            alert("수정 실패");
            btnEl.innerText = "수정 완료";
            btnEl.disabled = false;
        });
    } else {
        db.collection("posts").add(postData).then(() => {
            resetBoardForm();
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 게시글이 자동 블라인드 처리되었습니다." : "게시글이 등록되었습니다.");
        }).catch(() => {
            alert("등록 실패");
            btnEl.innerText = "등록";
            btnEl.disabled = false;
        });
    }
}
function resetBoardForm() { document.getElementById('inputNick').value = ''; document.getElementById('inputTitle').value = ''; document.getElementById('inputPw').value = ''; document.getElementById('inputContent').value = ''; document.getElementById('boardForm').classList.add('hidden'); const btnEl = document.querySelector('#boardForm .bg-submit'); if(btnEl) { btnEl.innerText = "등록"; btnEl.disabled = false; } currentEditPostId = null; }
async function tryEditPost(id, savedPw, nick, title, content, e) { e.stopPropagation(); const inputPw = prompt("게시글 비밀번호를 입력하세요:"); if (inputPw === null) return; if (await verifyPasswordMatch(inputPw, savedPw)) { currentEditPostId = id; document.getElementById('inputNick').value = nick; document.getElementById('inputPw').value = inputPw.trim(); document.getElementById('inputTitle').value = title; document.getElementById('inputContent').value = content; document.getElementById('boardForm').classList.remove('hidden'); document.querySelector('#boardForm .bg-submit').innerText = "수정 완료"; document.getElementById('boardForm').scrollIntoView({behavior: 'smooth', block: 'center'}); showToast("수정 모드로 전환되었습니다."); } else alert("⚠️ 비밀번호가 일치하지 않습니다."); }
async function deletePost(id,pw,e){ e.stopPropagation(); const inputPw = prompt("게시글 비밀번호를 입력하세요:"); if (inputPw === null) return; if(await verifyPasswordMatch(inputPw, pw) || await verifyAdmin()) db.collection("posts").doc(id).delete(); } 
async function uploadCommentImageFile(file, pathPrefix = "comments") {
    const optimizedFile = await compressImageForUpload(file);
    return new Promise((resolve, reject) => {
        const safeName = ((optimizedFile && optimizedFile.name) || file.name || "comment_image.jpg").replace(/[^\w.\-가-힣]/g, "_");
        const storageRef = storage.ref(`${pathPrefix}/${Date.now()}_${safeName}`);
        const uploadTask = storageRef.put(optimizedFile || file);
        uploadTask.on('state_changed', null, reject, () => {
            uploadTask.snapshot.ref.getDownloadURL().then(resolve).catch(reject);
        });
    });
}

function handleCommentFileChange(pid, inputEl) {
    const file = inputEl.files && inputEl.files[0];
    const previewEl = document.getElementById(`cmt-preview-${pid}`);
    const labelEl = document.getElementById(`cmt-file-label-${pid}`);
    if (!file) {
        delete selectedCommentFiles[pid];
        if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
        if (labelEl) labelEl.classList.remove("has-file");
        return;
    }
    if (!file.type.startsWith("image/")) {
        alert("이미지 파일만 첨부할 수 있습니다.");
        inputEl.value = "";
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        alert("이미지 용량은 10MB를 초과할 수 없습니다.");
        inputEl.value = "";
        return;
    }
    selectedCommentFiles[pid] = file;
    if (labelEl) labelEl.classList.add("has-file");
    if (previewEl) {
        const reader = new FileReader();
        reader.onload = (e) => {
            previewEl.style.display = "flex";
            previewEl.innerHTML = `
                <img src="${e.target.result}" class="comment-preview-thumb" alt="미리보기">
                <span class="comment-preview-name">${escapeShipCommentHtml(file.name)}</span>
                <button type="button" class="comment-preview-remove" onclick="removeCommentFile('${pid}')" title="첨부 취소">×</button>
            `;
        };
        reader.readAsDataURL(file);
    }
}

function removeCommentFile(pid) {
    delete selectedCommentFiles[pid];
    const inputEl = document.getElementById(`cmt-file-${pid}`);
    if (inputEl) inputEl.value = "";
    const previewEl = document.getElementById(`cmt-preview-${pid}`);
    if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
    const labelEl = document.getElementById(`cmt-file-label-${pid}`);
    if (labelEl) labelEl.classList.remove("has-file");
    if (editingBoardComment && editingBoardComment.pid === pid) {
        editingBoardComment.existingImageUrl = null;
    }
}

function handleShipCommentFileChange(shipId, inputEl) {
    const file = inputEl.files && inputEl.files[0];
    const previewEl = document.getElementById(`ship-comment-preview-${shipId}`);
    const labelEl = document.getElementById(`ship-comment-file-label-${shipId}`);
    if (!file) {
        delete selectedShipCommentFiles[shipId];
        if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
        if (labelEl) labelEl.classList.remove("has-file");
        return;
    }
    if (!file.type.startsWith("image/")) {
        alert("이미지 파일만 첨부할 수 있습니다.");
        inputEl.value = "";
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        alert("이미지 용량은 10MB를 초과할 수 없습니다.");
        inputEl.value = "";
        return;
    }
    selectedShipCommentFiles[shipId] = file;
    if (labelEl) labelEl.classList.add("has-file");
    if (previewEl) {
        const reader = new FileReader();
        reader.onload = (e) => {
            previewEl.style.display = "flex";
            previewEl.innerHTML = `
                <img src="${e.target.result}" class="comment-preview-thumb" alt="미리보기">
                <span class="comment-preview-name">${escapeShipCommentHtml(file.name)}</span>
                <button type="button" class="comment-preview-remove" onclick="removeShipCommentFile('${shipId}')" title="첨부 취소">×</button>
            `;
        };
        reader.readAsDataURL(file);
    }
}

function removeShipCommentFile(shipId) {
    delete selectedShipCommentFiles[shipId];
    const inputEl = document.getElementById(`ship-comment-file-${shipId}`);
    if (inputEl) inputEl.value = "";
    const previewEl = document.getElementById(`ship-comment-preview-${shipId}`);
    if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
    const labelEl = document.getElementById(`ship-comment-file-label-${shipId}`);
    if (labelEl) labelEl.classList.remove("has-file");
    if (editingShipComment && editingShipComment.shipId === shipId) {
        editingShipComment.existingImageUrl = null;
    }
}

async function verifyBoardCommentPassword(comment) {
    const enteredPassword = prompt("댓글 비밀번호를 입력하세요 (작성자 또는 관리자):");
    if (enteredPassword === null) return false;
    if (await verifyPasswordMatch(enteredPassword, comment.password)) return true;
    const enteredHash = await sha256Hex(enteredPassword);
    if (isAdminSessionVerified || enteredHash === DEFAULT_ADMIN_PW_HASH) return true;
    alert("⚠️ 비밀번호가 일치하지 않습니다.");
    return false;
}
async function editComment(pid, cid) {
    const comment = (boardCommentsById[pid] || []).find(item => item.id === cid);
    if (!comment || !(await verifyBoardCommentPassword(comment))) return;
    const nameEl = document.getElementById(`cmt-name-${pid}`);
    const pwEl = document.getElementById(`cmt-pw-${pid}`);
    const txtEl = document.getElementById(`cmt-txt-${pid}`);
    const submitBtn = document.getElementById(`cmt-submit-${pid}`);
    const cancelBtn = document.getElementById(`cmt-cancel-${pid}`);
    const previewEl = document.getElementById(`cmt-preview-${pid}`);
    const labelEl = document.getElementById(`cmt-file-label-${pid}`);
    if (nameEl) nameEl.value = comment.name || "";
    if (pwEl) pwEl.value = "";
    if (txtEl) { txtEl.value = comment.text || ""; txtEl.focus(); }
    delete selectedCommentFiles[pid];
    const fileInput = document.getElementById(`cmt-file-${pid}`);
    if (fileInput) fileInput.value = "";
    if (comment.imageUrl) {
        if (labelEl) labelEl.classList.add("has-file");
        if (previewEl) {
            previewEl.style.display = "flex";
            previewEl.innerHTML = `
                <img src="${escapeShipCommentHtml(comment.imageUrl)}" class="comment-preview-thumb" alt="기존 첨부 이미지">
                <span class="comment-preview-name">기존 첨부 이미지</span>
                <button type="button" class="comment-preview-remove" onclick="removeCommentFile('${pid}')" title="이미지 삭제">×</button>
            `;
        }
    } else {
        if (labelEl) labelEl.classList.remove("has-file");
        if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
    }
    editingBoardComment = { pid, cid, existingImageUrl: comment.imageUrl || null };
    if (submitBtn) submitBtn.innerText = "수정 완료";
    if (cancelBtn) cancelBtn.style.display = "inline-flex";
    showToast("댓글 수정 모드로 전환되었습니다.");
}
function cancelBoardCommentEdit(pid) {
    const nameEl = document.getElementById(`cmt-name-${pid}`);
    const pwEl = document.getElementById(`cmt-pw-${pid}`);
    const txtEl = document.getElementById(`cmt-txt-${pid}`);
    const submitBtn = document.getElementById(`cmt-submit-${pid}`);
    const cancelBtn = document.getElementById(`cmt-cancel-${pid}`);
    if (nameEl) nameEl.value = getPortNickname();
    if (pwEl) pwEl.value = "";
    if (txtEl) txtEl.value = "";
    if (submitBtn) { submitBtn.innerText = "등록"; submitBtn.disabled = false; }
    if (cancelBtn) cancelBtn.style.display = "none";
    removeCommentFile(pid);
    editingBoardComment = null;
}
async function addComment(pid){
    const nameEl = document.getElementById(`cmt-name-${pid}`);
    const pwEl = document.getElementById(`cmt-pw-${pid}`);
    const txtEl = document.getElementById(`cmt-txt-${pid}`);
    const submitBtn = document.getElementById(`cmt-submit-${pid}`);
    const n = (nameEl?.value || "").trim();
    const p = (pwEl?.value || "").trim();
    const t = (txtEl?.value || "").trim();
    const attachedFile = selectedCommentFiles[pid];

    if(!n || !p || (!t && !attachedFile)){
        alert("닉네임, 비밀번호, 그리고 댓글 내용(또는 사진)을 입력해 주세요.");
        return;
    }

    const pwHash = (/^[a-f0-9]{64}$/i.test(p)) ? p.toLowerCase() : (await sha256Hex(p));
    const isEditing = editingBoardComment && editingBoardComment.pid === pid;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = attachedFile ? "사진 업로드 중..." : "저장 중...";
    }

    try {
        let imageUrl = null;
        if (attachedFile) {
            imageUrl = await uploadCommentImageFile(attachedFile, "posts/comments");
        } else if (isEditing) {
            imageUrl = editingBoardComment.existingImageUrl || null;
        }

        const commentsRef = db.collection('posts').doc(pid).collection('comments');
        const modResult = inspectCommunityContent({
            text: t,
            author: n,
            category: "게시판 댓글"
        });
        const commentData = {
            name: n,
            password: pwHash,
            text: t,
            hidden: Boolean(modResult.hidden),
            blindReason: modResult.reason || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (modResult.hidden) {
            notifyAdminAutoBlind({
                category: "게시판 댓글",
                author: n,
                text: t,
                reason: modResult.reason
            });
        }
        if (imageUrl) {
            commentData.imageUrl = imageUrl;
        } else if (isEditing) {
            commentData.imageUrl = null;
        }

        if (isEditing) {
            await commentsRef.doc(editingBoardComment.cid).update(commentData);
            cancelBoardCommentEdit(pid);
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다." : "댓글이 수정되었습니다.");
        } else {
            await commentsRef.add(commentData);
            if (txtEl) txtEl.value = "";
            if (pwEl) pwEl.value = "";
            removeCommentFile(pid);
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다." : "댓글이 등록되었습니다.");
        }
    } catch(err) {
        alert("댓글 저장 실패: " + (err?.message || err));
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = (editingBoardComment && editingBoardComment.pid === pid) ? "수정 완료" : "등록";
        }
    }
}
async function deleteComment(pid,cid,pw){
    const comment = (boardCommentsById[pid] || []).find(item => item.id === cid) || { password: pw };
    if (!(await verifyBoardCommentPassword(comment))) return;
    if (!confirm("이 댓글을 삭제하시겠습니까?")) return;
    db.collection('posts').doc(pid).collection('comments').doc(cid).delete().then(() => {
        if (editingBoardComment && editingBoardComment.pid === pid && editingBoardComment.cid === cid) {
            cancelBoardCommentEdit(pid);
        }
        showToast("댓글이 삭제되었습니다.");
    }).catch(err => alert("댓글 삭제 실패: " + err.message));
}

let currentEditShipId = null;
let selectedShipFormTags = [];
let activeShipFilterTags = [];
let shipDirectorySnapshotLoaded = false;
let pendingVesselInfoLink = null;
let pendingShipInfoRegistration = null;
const handledVesselInfoFollowUps = new Set();

function getAppLocalDateString() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().split("T")[0];
}

function normalizeVesselInfoName(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/^\s*\[[^\]]+\]\s*/, "")
        .replace(/[\s\u200B]+/g, "")
        .toLocaleUpperCase("ko-KR");
}

function getVesselInfoFollowUpKey(name, date) {
    return `${normalizeVesselInfoName(name)}|${date || "no-date"}`;
}

async function lookupVesselInfoRecord(vesselName) {
    const normalized = normalizeVesselInfoName(vesselName);
    const localMatch = (allShipsData || []).find(ship =>
        normalizeVesselInfoName(ship.shipName || ship.name || ship.vesselName) === normalized
    );

    if (localMatch) return { status: "found", ship: localMatch };

    // 실시간 목록에서 찾지 못하면 레거시 문서를 포함해 다시 확인
    try {
        const snapshot = await db.collection("ships").get();
        const records = [];
        snapshot.forEach(doc => records.push({ ...doc.data(), id: doc.id }));

        const found = records.find(ship =>
            normalizeVesselInfoName(ship.shipName || ship.name || ship.vesselName) === normalized
        );

        if (!shipDirectorySnapshotLoaded) {
            allShipsData = records;
            filteredShips = records;
        }

        return found
            ? { status: "found", ship: found }
            : { status: "missing", ship: null };
    } catch (error) {
        console.error("선박 정보 확인 실패:", error);
        return { status: "error", error };
    }
}

function getVesselInfoFollowUpContext(source, overrides = {}) {
    const isWage = source === "wage";
    const vesselName = String(
        overrides.vesselName ??
        (isWage
            ? (document.getElementById("wageShipName")?.value || selectedWageScheduleShipName || "")
            : (document.getElementById("logShipName")?.value || ""))
    ).trim();
    const date = String(
        overrides.date ??
        (isWage
            ? (document.getElementById("wageStartDate")?.value || "")
            : (document.getElementById("dailyLogForm")?.getAttribute("data-date") || ""))
    ).trim();
    const terminalId = overrides.terminalId || selectedScheduleTerminal;
    const sourceLabel = isWage ? "임금계산기" : "근무일지";
    const force = Boolean(overrides.force);
    const key = getVesselInfoFollowUpKey(vesselName, date);
    return { source, sourceLabel, vesselName, date, terminalId, force, key };
}

function setVesselLinkButtonVisible(id, visible) {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = visible ? "block" : "none";
}

function closeVesselInfoLinkModal() {
    const modal = document.getElementById("vesselInfoLinkModal");
    if (modal) modal.style.display = "none";
    document.getElementById("vesselInfoCommentForm")?.classList.add("hidden");
    pendingVesselInfoLink = null;
}

function toggleVesselInfoCommentForm() {
    const form = document.getElementById("vesselInfoCommentForm");
    if (!form) return;
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
        const nameInput = document.getElementById("vesselInfoCommentName");
        if (nameInput && !nameInput.value && currentWorkerId) {
            nameInput.value = currentWorkerId;
        }
        document.getElementById("vesselInfoCommentText")?.focus();
    }
}

function openVesselInfoViewFromLink() {
    const context = pendingVesselInfoLink;
    if (!context?.ship?.id) return;
    const shipId = context.ship.id;
    closeVesselInfoLinkModal();
    const card = document.getElementById("ship-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("ship-card");
    }
    openShipDetailView(shipId);
}

async function startVesselInfoFollowUp(source, overrides = {}) {
    const context = getVesselInfoFollowUpContext(source, overrides);

    if (!normalizeVesselInfoName(context.vesselName)) {
        showToast("선박명을 먼저 입력하거나 스케줄에서 선택해 주세요.");
        return;
    }

    if (!context.force && handledVesselInfoFollowUps.has(context.key)) return;

    const modal = document.getElementById("vesselInfoLinkModal");
    const title = document.getElementById("vesselInfoLinkTitle");
    const message = document.getElementById("vesselInfoLinkMessage");
    const meta = document.getElementById("vesselInfoLinkMeta");
    const actions = document.getElementById("vesselInfoLinkActions");
    const commentForm = document.getElementById("vesselInfoCommentForm");
    if (!modal || !title || !message || !actions) return;

    const pending = { ...context, ship: null, status: "checking" };
    pendingVesselInfoLink = pending;

    commentForm?.classList.add("hidden");
    setVesselLinkButtonVisible("vesselInfoRegisterBtn", false);
    setVesselLinkButtonVisible("vesselInfoCommentBtn", false);
    setVesselLinkButtonVisible("vesselInfoViewBtn", false);

    title.textContent = "🔎 선박 정보 확인";
    message.textContent =
        `‘${context.vesselName}’ 선박이 선박 정보에 등록되어 있는지 확인하고 있습니다...`;
    meta.textContent = context.date
        ? `${context.sourceLabel} · ${context.date}`
        : context.sourceLabel;
    modal.style.display = "flex";

    const result = await lookupVesselInfoRecord(context.vesselName);
    if (pendingVesselInfoLink !== pending) return;
    pending.status = result.status;

    if (result.status === "error") {
        title.textContent = "⚠️ 선박 정보를 확인하지 못했습니다";
        message.textContent =
            "네트워크 또는 데이터베이스 연결을 확인한 뒤 다시 시도해 주세요. " +
            "등록 여부를 확인하지 못했으므로 신규 등록은 아직 시작하지 않았습니다.";
        meta.textContent = "연동 확인에 실패했습니다.";
        return;
    }

    if (result.status === "missing") {
        title.textContent = "📝 신규 선박 등록";
        message.textContent =
            `‘${context.vesselName}’ 선박은 선박 정보에 없습니다. 신규 등록 화면에 선박명을 넣어드릴까요?`;
        setVesselLinkButtonVisible("vesselInfoRegisterBtn", true);
        return;
    }

    pending.ship = result.ship;
    title.textContent = "🚢 기존 선박 정보 확인";
    message.textContent =
        `‘${result.ship.shipName || context.vesselName}’ 선박이 이미 등록되어 있습니다. ` +
        "추가 장비·작업 난이도·주의사항을 댓글로 남기시겠습니까?";

    const tags = extractShipTags(result.ship);
    const details = [];
    if (Number(result.ship.difficulty)) {
        details.push(`작업 난이도 ★${Number(result.ship.difficulty)}`);
    }
    if (tags.length) details.push(tags.join(" · "));

    meta.textContent = [
        context.sourceLabel,
        context.date,
        details.join(" · ")
    ].filter(Boolean).join(" · ");

    setVesselLinkButtonVisible("vesselInfoCommentBtn", true);
    setVesselLinkButtonVisible("vesselInfoViewBtn", true);
}

function openVesselRegistrationFromLink() {
    const context = pendingVesselInfoLink;
    if (!context || context.status !== "missing") return;

    const existingForm = document.getElementById("shipForm");
    const hasUnsavedShipDraft = !!currentEditShipId || !!(
        existingForm &&
        !existingForm.classList.contains("hidden") &&
        (
            document.getElementById("shipName")?.value.trim() ||
            document.getElementById("shipOnboard")?.value.trim() ||
            document.getElementById("shipPw")?.value.trim() ||
            document.getElementById("shipFileInput")?.files?.length
        )
    );

    if (hasUnsavedShipDraft &&
        !confirm("현재 선박 등록·수정 입력 내용이 있습니다. 이를 초기화하고 신규 선박 등록을 시작할까요?")) {
        return;
    }

    const registrationContext = {
        vesselName: context.vesselName,
        key: context.key
    };

    closeVesselInfoLinkModal();

    const card = document.getElementById("ship-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("ship-card");
    }

    if (typeof resetShipForm === "function") resetShipForm();
    pendingShipInfoRegistration = registrationContext;

    const form = document.getElementById("shipForm");
    const nameInput = document.getElementById("shipName");
    const passwordInput = document.getElementById("shipPw");

    if (form) form.classList.remove("hidden");
    if (nameInput) nameInput.value = context.vesselName;
    if (passwordInput) passwordInput.value = "";
    initShipFormSchedulePicker();

    form?.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("신규 등록 양식에 선박명을 입력했습니다. 특징·장비와 비밀번호를 작성해 저장하세요.");
}

async function submitVesselInfoComment() {
    const context = pendingVesselInfoLink;
    if (!context?.ship?.id) return;

    const name =
        document.getElementById("vesselInfoCommentName")?.value.trim() || "";
    const password =
        document.getElementById("vesselInfoCommentPassword")?.value.trim() || "";
    const text =
        document.getElementById("vesselInfoCommentText")?.value.trim() || "";

    if (!name || !password || !text) {
        alert("닉네임, 댓글 비밀번호, 추가사항을 모두 입력해 주세요.");
        return;
    }

    const button = document.querySelector("#vesselInfoCommentForm .bg-submit");
    if (button) {
        button.disabled = true;
        button.innerText = "댓글 저장 중...";
    }

    const sourcePrefix =
        `[${context.sourceLabel}${context.date ? ` · ${context.date}` : ""}]`;

    try {
        const fullText = `${sourcePrefix}\n${text}`;
        const modResult = inspectCommunityContent({
            text: fullText,
            author: name,
            category: "선박 댓글"
        });
        const commentData = {
            name,
            password: await sha256Hex(password),
            text: fullText,
            hidden: Boolean(modResult.hidden),
            blindReason: modResult.reason || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (modResult.hidden) {
            notifyAdminAutoBlind({
                category: "선박 댓글",
                author: name,
                text: fullText,
                reason: modResult.reason
            });
        }

        await db.collection("ships")
            .doc(context.ship.id)
            .collection("comments")
            .add(commentData);

        handledVesselInfoFollowUps.add(context.key);
        document.getElementById("vesselInfoCommentText").value = "";
        closeVesselInfoLinkModal();
        showToast(
            modResult.hidden
                ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다."
                : `💬 ${context.ship.shipName || context.vesselName} 선박 정보에 추가 댓글을 등록했습니다.`
        );
    } catch (error) {
        console.error("선박 정보 댓글 등록 실패:", error);
        alert("댓글 저장에 실패했습니다: " + error.message);
    } finally {
        if (button) {
            button.disabled = false;
            button.innerText = "댓글 등록";
        }
    }
}

async function loadShipRecordById(shipId) {
    if (!shipId) return null;
    const local = (allShipsData || []).find(s => s.id === shipId);
    if (local) return local;
    try {
        const snap = await db.collection("ships").doc(shipId).get();
        if (snap.exists) return { ...snap.data(), id: snap.id };
    } catch (e) {}
    return null;
}

async function sendShipInfoToWage(shipId, event) {
    if (event) event.stopPropagation();

    const ship = await loadShipRecordById(shipId);
    if (!ship) return showToast("선박 정보를 다시 불러와 주세요.");

    const card = document.getElementById("wage-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("wage-card");
    }

    const name = ship.shipName || ship.name || ship.vesselName || "";
    const input = document.getElementById("wageShipName");

    if (input) input.value = name;
    onWageShipNameChange(name);

    const date = document.getElementById("wageStartDate")?.value;
    if (date) loadWageScheduledShipsForDate(date, false);

    document.getElementById("wage-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    input?.focus();

    showToast(`🚢 ${name} 선박을 임금계산기로 보냈습니다.`);
}

async function sendShipInfoToWorkLog(shipId, event) {
    if (event) event.stopPropagation();

    const ship = await loadShipRecordById(shipId);
    if (!ship) return showToast("선박 정보를 다시 불러와 주세요.");

    const card = document.getElementById("log-card");
    if (card && !card.classList.contains("expanded")) {
        toggleDashItem("log-card");
    }

    const form = document.getElementById("dailyLogForm");
    const date = form?.getAttribute("data-date") || getAppLocalDateString();

    if (form?.classList.contains("hidden")) {
        jumpToLogDate(date);
    }

    const name = ship.shipName || ship.name || ship.vesselName || "";
    const input = document.getElementById("logShipName");

    if (input) input.value = name;

    document.getElementById("log-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    input?.focus();

    showToast(`🚢 ${name} 선박을 근무일지 입력창으로 보냈습니다.`);
}
const shipDifficultyDescriptions = {
    1: "★☆☆☆☆ (매우 수월·1점)",
    2: "★★☆☆☆ (수월함·2점)",
    3: "★★★☆☆ (보통·3점)",
    4: "★★★★☆ (까다로움·4점)",
    5: "★★★★★ (극상/주의·5점)"
};
function setShipDifficulty(level) {
    const num = Math.min(5, Math.max(1, parseInt(level, 10) || 3));
    const input = document.getElementById("shipDifficultyInput");
    const label = document.getElementById("shipDifficultyLabel");
    if (input) input.value = String(num);
    if (label) label.innerText = shipDifficultyDescriptions[num] || `★${num}`;
    document.querySelectorAll("#shipStarPicker .ship-star-btn").forEach((btn, idx) => {
        btn.classList.toggle("active", idx < num);
    });
}
function toggleShipFormTag(tag) {
    const idx = selectedShipFormTags.indexOf(tag);
    if (idx >= 0) selectedShipFormTags.splice(idx, 1);
    else selectedShipFormTags.push(tag);
    syncShipFormTagUI();
}
function syncShipFormTagUI() {
    document.querySelectorAll("#shipFormTagList [data-form-tag]").forEach(btn => {
        const tag = btn.getAttribute("data-form-tag");
        btn.classList.toggle("active", selectedShipFormTags.includes(tag));
    });
}
function toggleShipFilterTag(tag) {
    const idx = activeShipFilterTags.indexOf(tag);
    if (idx >= 0) activeShipFilterTags.splice(idx, 1);
    else activeShipFilterTags.push(tag);
    document.querySelectorAll(".ship-filter-bar [data-filter-tag]").forEach(btn => {
        const t = btn.getAttribute("data-filter-tag");
        btn.classList.toggle("active", activeShipFilterTags.includes(t));
    });
    filterShips();
}
function resetShipFilters() {
    activeShipFilterTags = [];
    const searchEl = document.getElementById("shipSearch");
    const diffEl = document.getElementById("shipDifficultyFilter");
    if (searchEl) searchEl.value = "";
    if (diffEl) diffEl.value = "0";
    document.querySelectorAll(".ship-filter-bar [data-filter-tag]").forEach(btn => btn.classList.remove("active"));
    filterShips();
}
function extractShipTags(ship) {
    if (Array.isArray(ship.tags) && ship.tags.length > 0) return ship.tags;
    const text = `${ship.shipName || ""} ${ship.onboardFeat || ""}`;
    const known = ["#오토콘", "#수동콘", "#브릿지주의", "#라싱바무거움", "#턴버클뻑뻑함", "#통로협소"];
    return known.filter(t => text.includes(t) || text.includes(t.slice(1)));
}
async function addShipInfo() {
    const n = document.getElementById('shipName').value.trim();
    const c = document.getElementById('shipOnboard').value.trim();
    const p = document.getElementById('shipPw').value.trim();
    const diff = parseInt(document.getElementById('shipDifficultyInput')?.value || '3', 10) || 3;
    const tags = [...selectedShipFormTags];
    const f = document.getElementById('shipFileInput').files[0];
    const btn = document.getElementById('shipSubmitBtn');
    if (!n || !p) return alert("선박명과 비밀번호는 필수입니다!");
    btn.innerText = "서버 기록 중...";
    btn.disabled = true;
    const pwHash = (/^[a-f0-9]{64}$/i.test(p)) ? p.toLowerCase() : (await sha256Hex(p));
    const finalizeSave = (url) => {
        const shipData = {
            shipName: n,
            onboardFeat: c,
            password: pwHash,
            difficulty: diff,
            tags: tags,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (url) shipData.imageUrl = url;
        let task = currentEditShipId ? db.collection("ships").doc(currentEditShipId).update(shipData) : db.collection("ships").add(shipData);
        task.then(() => {
            const linkedRegistration = pendingShipInfoRegistration;
            const linkedByVesselFlow =
                linkedRegistration &&
                normalizeVesselInfoName(linkedRegistration.vesselName) ===
                    normalizeVesselInfoName(n);

            if (linkedByVesselFlow) {
                handledVesselInfoFollowUps.add(linkedRegistration.key);
                pendingShipInfoRegistration = null;
            }

            showToast(linkedByVesselFlow
                ? "🚢 선박 정보 신규 등록 및 임금계산기·근무일지 연동이 완료되었습니다."
                : "성공적으로 기록되었습니다.");
            resetShipForm();
            btn.innerText = "등록/수정";
            btn.disabled = false;
        }).catch(err => {
            alert("실패: " + err.message);
            btn.disabled = false;
        });
    };
    if (f) {
        const optimizedFile = await compressImageForUpload(f);
        const storageRef = storage.ref(`ships/${Date.now()}_${optimizedFile.name || f.name}`);
        const uploadTask = storageRef.put(optimizedFile);
        uploadTask.on('state_changed', null, null, () => {
            uploadTask.snapshot.ref.getDownloadURL().then(url => finalizeSave(url));
        });
    } else {
        finalizeSave();
    }
}
async function tryEditShip(id, name, feat, savedPw) {
    const inputPw = prompt("비밀번호를 입력하세요 (작성자 또는 관리자):");
    if (!inputPw) return;
    const isAuthor = await verifyPasswordMatch(inputPw, savedPw);
    const inputHash = await sha256Hex(inputPw);
    const isAdmin = isAdminSessionVerified || (inputHash === DEFAULT_ADMIN_PW_HASH);
    if (isAuthor || isAdmin) {
        startEditShip(id, name, feat);
    } else {
        alert("⚠️ 권한이 없습니다. 비밀번호를 확인하세요.");
    }
}
function startEditShip(id, name, feat) {
    currentEditShipId = id;
    const shipObj = allShipsData.find(s => s.id === id) || {};
    document.getElementById('shipName').value = name;
    document.getElementById('shipOnboard').value = feat;
    setShipDifficulty(shipObj.difficulty || 3);
    selectedShipFormTags = Array.isArray(shipObj.tags) ? [...shipObj.tags] : extractShipTags(shipObj);
    syncShipFormTagUI();
    const form = document.getElementById('shipForm');
    if (form.classList.contains('hidden')) form.classList.remove('hidden');
    initShipFormSchedulePicker();
    form.scrollIntoView({behavior: 'smooth', block: 'center'});
    showToast("수정 모드로 전환되었습니다.");
}
function resetShipForm() {
    document.getElementById('shipName').value = '';
    document.getElementById('shipOnboard').value = '';
    document.getElementById('shipFileInput').value = '';
    setShipDifficulty(3);
    selectedShipFormTags = [];
    syncShipFormTagUI();
    document.getElementById('shipForm').classList.add('hidden');
    currentEditShipId = null;
}
function filterShips() {
    const searchTerm = (document.getElementById('shipSearch')?.value || '').trim().toUpperCase();
    const diffFilter = parseInt(document.getElementById('shipDifficultyFilter')?.value || '0', 10) || 0;
    filteredShips = allShipsData.filter(ship => {
        const sTags = extractShipTags(ship);
        const sDiff = Number(ship.difficulty) || 0;
        if (searchTerm !== "") {
            const hay = `${ship.shipName || ""} ${ship.onboardFeat || ""} ${sTags.join(" ")}`.toUpperCase();
            if (!hay.includes(searchTerm)) return false;
        }
        if (activeShipFilterTags.length > 0) {
            const hasAllTags = activeShipFilterTags.every(t => sTags.includes(t));
            if (!hasAllTags) return false;
        }
        if (diffFilter > 0) {
            if (diffFilter === 2) {
                if (!sDiff || sDiff > 2) return false;
            } else {
                if (sDiff < diffFilter) return false;
            }
        }
        return true;
    });
    renderShipPage(1);
    if (typeof loadAndSearchAllShips === "function") {
        loadAndSearchAllShips(document.getElementById('shipSearch')?.value || '');
    }
}
function addArchive() { const t = document.getElementById('archiveTitle').value.trim(); const f = document.getElementById('archiveFile').files[0]; const btn = document.getElementById('archiveSubmitBtn'); if(!t || !f) return alert("파일 설명과 파일을 모두 선택해 주세요."); btn.innerText = "서버 연결 중..."; btn.disabled = true; const ref = storage.ref(`archives/${Date.now()}_${f.name}`); const task = ref.put(f); task.on('state_changed', (s) => { const p = Math.round((s.bytesTransferred / s.totalBytes) * 100); btn.innerText = `업로드 중... ${p}%`; }, (e) => { alert("업로드 실패: " + e.message); btn.disabled = false; btn.innerText = "업로드 완료"; }, () => { task.snapshot.ref.getDownloadURL().then(url => { db.collection("archives").add({ title: t, url: url, timestamp: firebase.firestore.FieldValue.serverTimestamp() }).then(() => { document.getElementById('archiveTitle').value = ""; document.getElementById('archiveFile').value = ""; toggleHidden('archiveForm'); btn.innerText = "업로드 완료"; btn.disabled = false; showToast("파일이 성공적으로 등록되었습니다!"); }); }); } ); } async function deleteShip(id,e){e.stopPropagation(); if(await verifyAdmin()) db.collection("ships").doc(id).delete();} function delArchive(id,e){ e.stopPropagation(); verifyAdmin().then(r=>{ if(r) db.collection("archives").doc(id).delete(); }); } 

function renderBoardPage(p){ currentBoardPage = p; const l = document.getElementById("boardList"); Object.values(commentUnsubscribes).forEach(unsub => { if (typeof unsub === "function") unsub(); }); commentUnsubscribes = {}; l.innerHTML = ""; const start = (p-1) * postsPerPage; const end = start + postsPerPage; const pageData = allPostsData.slice(start, end); if(pageData.length === 0) { l.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>게시글이 없습니다.</td></tr>"; document.getElementById("pagination").innerHTML = ""; return; } const rowsHtml = []; pageData.forEach((x, i) => { let dateStr = ""; if(x.timestamp) { const d = x.timestamp.toDate(); const month = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); const hour = String(d.getHours()).padStart(2, '0'); const min = String(d.getMinutes()).padStart(2, '0'); dateStr = `${month}/${day} ${hour}:${min}`; } const rowId = `p-${x.id}`; const authorName = x.nick || '익명'; const postNum = allPostsData.length - ((currentBoardPage - 1) * postsPerPage) - i; const safeTitle = (x.title || '').replace(/'/g, "\\'").replace(/"/g, "&quot;"); const safeContent = (x.content || '').replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, "\\n"); const isHidden = Boolean(x.hidden); const displayTitle = isHidden ? `🔒 자동 블라인드 처리된 게시글입니다.` : x.title; const displayContent = isHidden ? `🔒 커뮤니티 건전성 보호를 위해 자동 블라인드 처리된 게시글입니다. (${escapeShipCommentHtml(x.blindReason || '금칙어/도배 감지')})` : x.content; rowsHtml.push(`<tr onclick="toggleBoardRow('${rowId}')" style="cursor:pointer;"> <td class="board-no">${postNum}</td> <td class="board-title" style="${isHidden ? 'color:var(--text-sub); font-style:italic;' : ''}">${displayTitle} <span id="cmt-badge-${x.id}" class="cmt-count-pill hidden"></span> <span style="font-size:0.75rem; color:var(--primary); margin-left:4px;">▼</span></td> <td class="board-date">${dateStr}</td> <td class="board-nick">${authorName}</td> </tr> <tr id="${rowId}" class="board-content-row"> <td colspan="4" class="board-content-box"> <div style="margin-bottom:15px; font-weight:600; background:var(--card-bg); padding:12px; border-radius:8px; border:1px solid var(--border);">${displayContent}</div> <div style="text-align:right; border-bottom:1px dashed var(--border); padding-bottom:10px; margin-bottom:10px;"> <button class="mini-btn" style="background:var(--primary-light) !important; color:white !important;" onclick="tryEditPost('${x.id}', '${x.password}', '${authorName}', '${safeTitle}', '${safeContent}', event)">✏️ 수정</button> <button class="mini-btn btn-del" onclick="deletePost('${x.id}','${x.password}',event)">🗑️ 삭제</button> </div> <div id="cmt-list-${x.id}" class="comment-section"></div> <div class="comment-form"> <div class="comment-form-row"> <input id="cmt-name-${x.id}" class="comment-input-sm board-comment-nickname" placeholder="항만용어 닉네임" aria-label="댓글 닉네임 (직접 수정 가능)" maxlength="50"> <input id="cmt-pw-${x.id}" class="comment-input-sm" type="password" placeholder="비밀번호" aria-label="비밀번호" maxlength="30"> </div> <div id="cmt-preview-${x.id}" class="comment-preview-box" style="display:none;"></div> <div class="comment-form-row"> <input id="cmt-txt-${x.id}" class="comment-input-main" placeholder="따뜻한 댓글을 남겨주세요..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();addComment('${x.id}');}"> <label for="cmt-file-${x.id}" id="cmt-file-label-${x.id}" class="comment-attach-btn" title="사진 첨부">📷</label> <input type="file" id="cmt-file-${x.id}" accept="image/*" style="display:none;" onchange="handleCommentFileChange('${x.id}', this)"> <button id="cmt-submit-${x.id}" class="comment-submit" onclick="addComment('${x.id}')">등록</button> <button id="cmt-cancel-${x.id}" type="button" class="mini-btn btn-del" style="display:none; height:32px; padding:0 8px; border-radius:6px; font-size:0.8rem; margin:0; line-height:30px;" onclick="cancelBoardCommentEdit('${x.id}')">취소</button> </div> </div> </td> </tr>`); }); l.innerHTML = rowsHtml.join(""); pageData.forEach(x => { const nicknameInput = document.getElementById(`cmt-name-${x.id}`); if (nicknameInput && !nicknameInput.value.trim()) nicknameInput.value = getPortNickname(); loadComments(x.id); }); renderPagination(p); } 
function renderShipPage(p) {
    const list = document.getElementById("shipList");
    const pagination = document.getElementById("shipPagination");
    Object.values(shipCommentUnsubscribes).forEach(unsubscribe => unsubscribe());
    shipCommentUnsubscribes = {};
    shipCommentsById = {};
    editingShipComment = null;
    list.innerHTML = "";
    pagination.innerHTML = "";
    if (p === 1) pagination.scrollLeft = 0;
    const pageData = filteredShips.slice((p - 1) * postsPerPage, p * postsPerPage);
    if (pageData.length === 0) {
        list.innerHTML = "<tr><td colspan='3' style='text-align:center; padding:20px; color:var(--text-sub); font-weight:700;'>조건에 맞는 선박 정보가 없습니다.</td></tr>";
        return;
    }
    const rowsHtml = [];
    pageData.forEach((ship, index) => {
        const safeName = (ship.shipName || "").replace(/'/g, "\\'");
        const safeFeat = (ship.onboardFeat || "").replace(/'/g, "\\'").replace(/\n/g, "\\n");
        const savedPw = ship.password || "";
        let dateStr = "";
        if (ship.timestamp) {
            const date = ship.timestamp.toDate();
            dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
        }
        const diff = Number(ship.difficulty) || 0;
        const starBadge = diff > 0 ? `<span class="ship-badge-star" title="작업 난이도 ${diff}점">${"★".repeat(diff)}${"☆".repeat(5 - diff)}</span>` : "";
        const sTags = extractShipTags(ship);
        const warnTags = ["#브릿지주의", "#라싱바무거움", "#턴버클뻑뻑함", "#통로협소"];
        const tagsInlineHtml = sTags.length > 0
            ? `<div style="margin-top:3px; white-space:normal;">${sTags.map(t => `<span class="ship-badge-tag ${warnTags.includes(t) ? 'warn' : ''}">${escapeShipCommentHtml(t)}</span>`).join("")}</div>`
            : "";
        const detailMetaHtml = (diff > 0 || sTags.length > 0)
            ? `<div style="background:rgba(10,27,63,0.04); border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:0.82rem;">
                ${diff > 0 ? `<div style="font-weight:900; color:#b45309; margin-bottom:${sTags.length ? '4px' : '0'};">⭐ 작업 난이도: ${"★".repeat(diff)}${"☆".repeat(5 - diff)} (${diff}점)</div>` : ""}
                ${sTags.length > 0 ? `<div><strong style="color:var(--primary);">🏷️ 준비 장비·특징:</strong> ${sTags.map(t => `<span class="ship-badge-tag ${warnTags.includes(t) ? 'warn' : ''}">${escapeShipCommentHtml(t)}</span>`).join("")}</div>` : ""}
            </div>`
            : "";
        const imageHtml = ship.imageUrl
            ? `<div style="margin-top:8px; margin-bottom:10px;"><img src="${ship.imageUrl}" loading="lazy" alt="선박 현장 이미지" class="ship-post-img" style="width:30%; max-width:30%; min-width:140px; height:auto; border-radius:8px; border:1px solid var(--border); cursor:pointer; display:block; object-fit:cover;" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src=this.src;" title="클릭하여 원본 크기로 확대 보기"></div>`
            : "";
        const rowId = `s-${ship.id}`;
        const postNum = filteredShips.length - ((p - 1) * postsPerPage) - index;
        rowsHtml.push(`<tr onclick="toggleBoardRow('${rowId}')" style="cursor:pointer;"><td class="board-no">${postNum}</td><td class="board-title" style="white-space:normal; line-height:1.35;"><div>🚢 ${ship.shipName || "선박명 없음"} ${starBadge} <span style="font-size:0.75rem; color:var(--primary); margin-left:4px;">▼</span></div>${tagsInlineHtml}</td><td class="board-date">${dateStr}</td></tr><tr id="${rowId}" class="board-content-row"><td colspan="3" class="board-content-box">${detailMetaHtml}<div style="margin-bottom:12px; white-space:pre-wrap;">${ship.onboardFeat || ""}</div>${imageHtml}<div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:6px; border-bottom:1px dashed var(--border); padding-bottom:10px; margin-bottom:10px;"><div style="display:flex; flex-wrap:wrap; gap:5px;"><button type="button" class="mini-btn" onclick="sendShipInfoToWage('${ship.id}', event)">🧮 임금계산기로</button><button type="button" class="mini-btn" onclick="sendShipInfoToWorkLog('${ship.id}', event)">📅 근무일지로</button></div><div style="display:flex; gap:5px; margin-left:auto;"><button class="mini-btn" style="background:var(--primary-light) !important; color:white !important;" onclick="tryEditShip('${ship.id}', '${safeName}', '${safeFeat}', '${savedPw}')">✏️ 수정</button><button class="mini-btn btn-del" onclick="deleteShip('${ship.id}',event)">🗑️ 삭제</button></div></div>${renderShipCommentMarkup(ship.id)}</td></tr>`);
    });
    list.innerHTML = rowsHtml.join("");
    const totalPages = Math.ceil(filteredShips.length / postsPerPage);
    const pageHtml = [];
    for (let page = 1; page <= totalPages; page++) {
        pageHtml.push(`<span class="page-num ${page === p ? 'active' : ''}" onclick="renderShipPage(${page})" style="flex:0 0 auto; cursor:pointer; padding:5px 12px; margin:2px; background:#e5e7eb; border-radius:8px; font-weight:800; font-size:0.9rem;">${page}</span>`);
    }
    pagination.innerHTML = pageHtml.join("");
};
function renderShipCommentMarkup(shipId) {
    return `<div style="margin-top:12px; border-top:1px dashed var(--border); padding-top:10px;">
        <div style="font-weight:900; margin-bottom:6px; font-size:0.88rem; color:var(--primary);">댓글</div>
        <div id="ship-comment-list-${shipId}" class="comment-section"></div>
        <div class="comment-form">
            <div class="comment-form-row">
                <input id="ship-comment-name-${shipId}" class="comment-input-sm" placeholder="닉네임" maxlength="50">
                <input id="ship-comment-password-${shipId}" class="comment-input-sm" type="password" placeholder="비밀번호" maxlength="30">
            </div>
            <div id="ship-comment-preview-${shipId}" class="comment-preview-box" style="display:none;"></div>
            <div class="comment-form-row">
                <input id="ship-comment-text-${shipId}" class="comment-input-main" placeholder="선박 댓글을 입력하세요..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submitShipComment('${shipId}');}">
                <label for="ship-comment-file-${shipId}" id="ship-comment-file-label-${shipId}" class="comment-attach-btn" title="사진 첨부">📷</label>
                <input type="file" id="ship-comment-file-${shipId}" accept="image/*" style="display:none;" onchange="handleShipCommentFileChange('${shipId}', this)">
                <button id="ship-comment-submit-${shipId}" class="comment-submit" onclick="submitShipComment('${shipId}')">등록</button>
                <button id="ship-comment-cancel-${shipId}" type="button" class="mini-btn btn-del" style="display:none; height:32px; padding:0 8px; border-radius:6px; font-size:0.8rem; margin:0; line-height:30px;" onclick="cancelShipCommentEdit('${shipId}')">취소</button>
            </div>
        </div>
    </div>`;
}
function escapeShipCommentHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function toggleBoardRow(id) {
    const row = document.getElementById(id);
    if (!row) return;
    if (row.classList.contains("show")) {
        row.classList.remove("show");
        return;
    }
    row.classList.add("show");
    if (id.startsWith("s-")) loadShipComments(id.slice(2));
}
function loadShipComments(shipId) {
    if (shipCommentUnsubscribes[shipId]) return;
    shipCommentUnsubscribes[shipId] = db.collection("ships").doc(shipId).collection("comments").orderBy("timestamp", "asc").onSnapshot(snapshot => {
        const list = document.getElementById(`ship-comment-list-${shipId}`);
        if (!list) return;
        shipCommentsById[shipId] = [];
        list.innerHTML = "";
        if (snapshot.empty) {
            list.innerHTML = "<div style='color:var(--text-sub); font-size:0.8rem; padding:4px 0;'>첫 댓글을 남겨보세요.</div>";
            return;
        }
        snapshot.forEach(doc => {
            const comment = { ...doc.data(), id: doc.id };
            shipCommentsById[shipId].push(comment);
            const isHidden = Boolean(comment.hidden);
            const safeName = escapeShipCommentHtml(comment.name || "익명");
            const safeText = isHidden
                ? `🔒 자동 블라인드 처리된 댓글입니다. (${escapeShipCommentHtml(comment.blindReason || '금칙어/도배 감지')})`
                : escapeShipCommentHtml(comment.text || "");
            const imgHtml = (!isHidden && comment.imageUrl)
                ? `<div style="margin-top:4px;"><img src="${escapeShipCommentHtml(comment.imageUrl)}" loading="lazy" alt="댓글 첨부 이미지" class="comment-img-thumb" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src=this.src;" title="클릭하여 원본 확대 보기"></div>`
                : "";
            list.innerHTML += `<div class="comment-item"><div style="flex:1; min-width:0; padding-right:6px;"><div><span class="comment-meta">${safeName}:</span> <span class="comment-text" style="white-space:pre-wrap; ${isHidden ? 'color:var(--text-sub); font-style:italic;' : ''}">${safeText}</span></div>${imgHtml}</div><div style="display:flex; gap:3px; flex-shrink:0;"><button class="mini-btn" style="padding:2px 8px; font-size:0.75rem; border-radius:4px;" onclick="editShipComment('${shipId}','${doc.id}')">수정</button><button class="mini-btn btn-del" style="padding:2px 8px; font-size:0.75rem; border-radius:4px;" onclick="deleteShipComment('${shipId}','${doc.id}')">삭제</button></div></div>`;
        });
    }, error => {
        const list = document.getElementById(`ship-comment-list-${shipId}`);
        if (list) list.innerHTML = "<div style='color:var(--danger); font-size:0.8rem;'>댓글을 불러오지 못했습니다.</div>";
        console.error("선박 댓글 불러오기 오류:", error);
    });
}
async function verifyShipCommentPassword(comment) {
    const enteredPassword = prompt("댓글 비밀번호를 입력하세요. 관리자도 관리자 비밀번호로 관리할 수 있습니다:");
    if (enteredPassword === null) return false;
    if (await verifyPasswordMatch(enteredPassword, comment.password)) return true;
    const enteredHash = await sha256Hex(enteredPassword);
    if (isAdminSessionVerified || enteredHash === DEFAULT_ADMIN_PW_HASH) return true;
    alert("비밀번호가 일치하지 않습니다.");
    return false;
}
async function editShipComment(shipId, commentId) {
    const comment = (shipCommentsById[shipId] || []).find(item => item.id === commentId);
    if (!comment || !(await verifyShipCommentPassword(comment))) return;
    const nameEl = document.getElementById(`ship-comment-name-${shipId}`);
    const pwEl = document.getElementById(`ship-comment-password-${shipId}`);
    const txtEl = document.getElementById(`ship-comment-text-${shipId}`);
    const submitBtn = document.getElementById(`ship-comment-submit-${shipId}`);
    const cancelBtn = document.getElementById(`ship-comment-cancel-${shipId}`);
    const previewEl = document.getElementById(`ship-comment-preview-${shipId}`);
    const labelEl = document.getElementById(`ship-comment-file-label-${shipId}`);
    if (nameEl) nameEl.value = comment.name || "";
    if (pwEl) pwEl.value = "";
    if (txtEl) { txtEl.value = comment.text || ""; txtEl.focus(); }
    delete selectedShipCommentFiles[shipId];
    const fileInput = document.getElementById(`ship-comment-file-${shipId}`);
    if (fileInput) fileInput.value = "";
    if (comment.imageUrl) {
        if (labelEl) labelEl.classList.add("has-file");
        if (previewEl) {
            previewEl.style.display = "flex";
            previewEl.innerHTML = `
                <img src="${escapeShipCommentHtml(comment.imageUrl)}" class="comment-preview-thumb" alt="기존 첨부 이미지">
                <span class="comment-preview-name">기존 첨부 이미지</span>
                <button type="button" class="comment-preview-remove" onclick="removeShipCommentFile('${shipId}')" title="이미지 삭제">×</button>
            `;
        }
    } else {
        if (labelEl) labelEl.classList.remove("has-file");
        if (previewEl) { previewEl.style.display = "none"; previewEl.innerHTML = ""; }
    }
    editingShipComment = { shipId, commentId, existingImageUrl: comment.imageUrl || null };
    if (submitBtn) submitBtn.innerText = "수정 완료";
    if (cancelBtn) cancelBtn.style.display = "inline-flex";
}
async function deleteShipComment(shipId, commentId) {
    const comment = (shipCommentsById[shipId] || []).find(item => item.id === commentId);
    if (!comment || !(await verifyShipCommentPassword(comment))) return;
    if (!confirm("이 댓글을 삭제할까요?")) return;
    db.collection("ships").doc(shipId).collection("comments").doc(commentId).delete().then(() => {
        if (editingShipComment && editingShipComment.shipId === shipId && editingShipComment.commentId === commentId) {
            cancelShipCommentEdit(shipId);
        }
        showToast("댓글이 삭제되었습니다.");
    }).catch(error => alert("댓글 삭제 실패: " + error.message));
}
function cancelShipCommentEdit(shipId) {
    const nameEl = document.getElementById(`ship-comment-name-${shipId}`);
    const pwEl = document.getElementById(`ship-comment-password-${shipId}`);
    const txtEl = document.getElementById(`ship-comment-text-${shipId}`);
    const submitBtn = document.getElementById(`ship-comment-submit-${shipId}`);
    const cancelBtn = document.getElementById(`ship-comment-cancel-${shipId}`);
    if (nameEl) nameEl.value = "";
    if (pwEl) pwEl.value = "";
    if (txtEl) txtEl.value = "";
    if (submitBtn) { submitBtn.innerText = "등록"; submitBtn.disabled = false; }
    if (cancelBtn) cancelBtn.style.display = "none";
    removeShipCommentFile(shipId);
    editingShipComment = null;
}
async function submitShipComment(shipId) {
    const nameEl = document.getElementById(`ship-comment-name-${shipId}`);
    const pwEl = document.getElementById(`ship-comment-password-${shipId}`);
    const txtEl = document.getElementById(`ship-comment-text-${shipId}`);
    const submitBtn = document.getElementById(`ship-comment-submit-${shipId}`);
    const name = (nameEl?.value || "").trim();
    const password = (pwEl?.value || "").trim();
    const text = (txtEl?.value || "").trim();
    const attachedFile = selectedShipCommentFiles[shipId];

    if (!name || !password || (!text && !attachedFile)) {
        alert("닉네임, 비밀번호, 그리고 댓글 내용(또는 사진)을 입력해 주세요.");
        return;
    }

    const pwHash = (/^[a-f0-9]{64}$/i.test(password)) ? password.toLowerCase() : (await sha256Hex(password));
    const isEditing = editingShipComment && editingShipComment.shipId === shipId;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = attachedFile ? "사진 업로드 중..." : "저장 중...";
    }

    try {
        let imageUrl = null;
        if (attachedFile) {
            imageUrl = await uploadCommentImageFile(attachedFile, "ships/comments");
        } else if (isEditing) {
            imageUrl = editingShipComment.existingImageUrl || null;
        }

        const comments = db.collection("ships").doc(shipId).collection("comments");
        const modResult = inspectCommunityContent({
            text,
            author: name,
            category: "선박 댓글"
        });
        const commentData = {
            name,
            password: pwHash,
            text,
            hidden: Boolean(modResult.hidden),
            blindReason: modResult.reason || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (modResult.hidden) {
            notifyAdminAutoBlind({
                category: "선박 댓글",
                author: name,
                text,
                reason: modResult.reason
            });
        }
        if (imageUrl) {
            commentData.imageUrl = imageUrl;
        } else if (isEditing) {
            commentData.imageUrl = null;
        }

        if (isEditing) {
            await comments.doc(editingShipComment.commentId).update(commentData);
            cancelShipCommentEdit(shipId);
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다." : "선박 댓글이 수정되었습니다.");
        } else {
            await comments.add(commentData);
            if (txtEl) txtEl.value = "";
            if (pwEl) pwEl.value = "";
            removeShipCommentFile(shipId);
            showToast(modResult.hidden ? "⚠️ 금칙어/도배 감지: 댓글이 자동 블라인드 처리되었습니다." : "선박 댓글이 등록되었습니다.");
        }
    } catch (error) {
        alert("댓글 저장 실패: " + (error?.message || error));
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = (editingShipComment && editingShipComment.shipId === shipId) ? "수정 완료" : "등록";
        }
    }
}
function renderPagination(curr) { const total = Math.ceil(allPostsData.length / postsPerPage); const el = document.getElementById('pagination'); if(!el) return; const html = []; for(let i=1; i<=total; i++){ html.push(`<span class="page-num ${i===curr?'active':''}" onclick="renderBoardPage(${i})" style="cursor:pointer; padding:5px 12px; margin:2px; background:#e5e7eb; border-radius:8px; font-weight:800; font-size:0.9rem;">${i}</span>`); } el.innerHTML = html.join(""); } 
function loadComments(pid){if(commentUnsubscribes[pid]) commentUnsubscribes[pid](); commentUnsubscribes[pid]=db.collection('posts').doc(pid).collection('comments').orderBy('timestamp','asc').onSnapshot(s=>{const el=document.getElementById(`cmt-list-${pid}`); const badgeEl=document.getElementById(`cmt-badge-${pid}`); if(badgeEl){ if(s.size>0){ badgeEl.innerText=`💬 ${s.size}`; badgeEl.classList.remove('hidden'); } else { badgeEl.classList.add('hidden'); } } if(!el) return; boardCommentsById[pid]=[]; const items=[]; s.forEach(d=>{const c=d.data()||{}; boardCommentsById[pid].push({...c, id:d.id}); const isHidden=Boolean(c.hidden); const safeName=escapeShipCommentHtml(c.name||"익명"); const safeText=isHidden ? `🔒 자동 블라인드 처리된 댓글입니다. (${escapeShipCommentHtml(c.blindReason||'금칙어/도배 감지')})` : escapeShipCommentHtml(c.text||""); const safePw=String(c.password||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/"/g,"&quot;"); const imgHtml=(!isHidden && c.imageUrl) ? `<div style="margin-top:4px;"><img src="${escapeShipCommentHtml(c.imageUrl)}" loading="lazy" alt="댓글 첨부 이미지" class="comment-img-thumb" onclick="document.getElementById('imageModal').style.display='flex'; document.getElementById('modalImage').src=this.src;" title="클릭하여 원본 확대 보기"></div>` : ""; items.push(`<div class="comment-item"><div style="flex:1; min-width:0; padding-right:6px;"><div><span class="comment-meta">${safeName}:</span> <span class="comment-text" style="white-space:pre-wrap; ${isHidden ? 'color:var(--text-sub); font-style:italic;' : ''}">${safeText}</span></div>${imgHtml}</div><div style="display:flex; gap:3px; flex-shrink:0;"><button class="mini-btn" style="padding:2px 8px; font-size:0.75rem; border-radius:4px;" onclick="editComment('${pid}','${d.id}')">수정</button><button class="mini-btn btn-del" style="padding:2px 8px; font-size:0.75rem; border-radius:4px;" onclick="deleteComment('${pid}','${d.id}','${safePw}')">삭제</button></div></div>`);}); el.innerHTML=items.join("");}, err=>{console.warn("댓글 로드 오류:",err);});} 

