/**
 * Workers 번들용 dotenv 대체 모듈.
 * Workers 에는 .env 파일이 없고 환경변수는 wrangler 의 vars/secret 바인딩으로
 * 주입되므로, `import 'dotenv/config'` 는 아무 일도 하지 않아야 합니다.
 * (원본 dotenv 는 fs 를 동적 require 해 ESM 번들에서 실패합니다)
 */
export function config(): { parsed: Record<string, string> } {
  return { parsed: {} };
}

export function parse(): Record<string, string> {
  return {};
}

export default { config, parse };
