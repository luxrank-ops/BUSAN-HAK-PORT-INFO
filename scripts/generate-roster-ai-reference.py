#!/usr/bin/env python3
"""근무배치 AI 비전 레퍼런스 이미지(base64 모듈) 재생성기.

사용법:
    python3 scripts/generate-roster-ai-reference.py

assets/roster-ocr-reference.jpg (색 테두리 규칙을 표시한 종이오더 사진, 휴대폰 UI 제거본)를
읽어 scripts/roster-ai-vision-reference.mjs 를 다시 만듭니다. 서버리스 번들에서 파일 경로(fs)에
의존하지 않도록 JPEG 를 문자열로 포함하기 위한 단계입니다.
"""
import base64
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSET = ROOT / 'assets' / 'roster-ocr-reference.jpg'
OUTPUT = ROOT / 'scripts' / 'roster-ai-vision-reference.mjs'

HEADER = """/**
 * 근무배치(종이오더) AI 비전 판독용 레퍼런스 이미지 — 사용자가 직접 색 테두리로 규칙을 표시한 사진.
 *
 * 원본: attachments/2026-11-17/1000035640-... (휴대폰 갤러리 UI 제거 후 종이 영역만 크롭, 긴 변 1024px)
 * 보관: assets/roster-ocr-reference.jpg — 이 파일은 그 JPEG 의 base64 사본입니다.
 * 재생성: python3 scripts/generate-roster-ai-reference.py
 *
 * 서버리스 번들에서 파일 경로(fs)에 의존하지 않도록 문자열로 포함합니다.
 * 색 테두리 규칙: 파란색=선박 1척 블럭, 보라색=날짜, 빨간색=선박명, 노란색=시간, 검정색=회사명,
 * 나머지 칸=작업자 이름(원문자·형광펜 메모는 이름과 분리).
 */
export const ROSTER_AI_VISION_REFERENCE_MIME = 'image/jpeg';
export const ROSTER_AI_VISION_REFERENCE_BASE64 = [
"""


def main() -> None:
    raw = ASSET.read_bytes()
    if raw[:2] != b'\xff\xd8':
        raise SystemExit(f'JPEG 가 아닙니다: {ASSET}')
    encoded = base64.b64encode(raw).decode('ascii')
    lines = ",\n".join(f"    '{line}'" for line in textwrap.wrap(encoded, 120))
    OUTPUT.write_text(f"{HEADER}{lines}\n].join('');\n", encoding='utf-8')
    print(f'{OUTPUT.relative_to(ROOT)} 생성 — JPEG {len(raw):,}바이트 / base64 {len(encoded):,}자')


if __name__ == '__main__':
    main()
