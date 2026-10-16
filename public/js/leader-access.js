/**
 * 조장 근무일 접근 권한 검증 모듈
 * @param {Event} event - 클릭 이벤트 객체
 */
function verifyLeaderAccess(event) {
    try {
        // 1. 기본 이벤트 전파 차단
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        // 2. 요청하신 안내 문구와 함께 비밀번호 입력창 호출
        const userPassword = prompt("비밀번호를 입력하세요.\n(비밀번호는 제작자에게 문의 바랍니다. 문의: luxrank@gmail.com / 문자: 010-2846-8906)");

        // 3. 취소 버튼을 누르거나 빈값일 경우 안전하게 중단 (예외 처리)
        if (userPassword === null) {
            return false;
        }

        // 4. 비밀번호 확인 (9363)
        if (userPassword.trim() === "9363") {
            alert("인증되었습니다.");
            
            // 5. 원래 실행되어야 할 함수가 있다면 안전하게 호출, 없으면 관리자 페이지 등으로 연결
            if (typeof openLeaderSchedule === "function") {
                openLeaderSchedule();
            } else {
                // 만약 연결된 함수가 없다면 기본 동작이나 페이지 이동 처리 가능
                console.warn("openLeaderSchedule 함수가 정의되어 있지 않습니다.");
            }
        } else {
            alert("비밀번호가 일치하지 않습니다.");
            return false;
        }
    } catch (error) {
        // 6. 런타임 에러 핸들링 (OWASP 방어 지침 준수)
        console.error("비밀번호 검증 중 오류 발생:", error);
        alert("일시적인 오류가 발생했습니다. 다시 시도해 주세요.");
        return false;
    }
}
