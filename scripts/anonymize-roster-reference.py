#!/usr/bin/env python3
"""근무배치 레퍼런스 사진의 작업자 이름을 모자이크 처리합니다(개인정보 보호).

사용법:
    python3 scripts/anonymize-roster-reference.py [원본사진] [출력경로]

- 휴대폰 갤러리 UI(상단 툴바·하단 썸네일)를 잘라 종이오더+색 테두리만 남깁니다.
- 표의 **작업자 이름 칸**만 모자이크합니다. 머리말(날짜/선박명/시간/회사명)과
  사용자가 그린 색 테두리(파랑·보라·빨강·노랑·검정), 형광펜 메모는 원본 그대로 둡니다.
  → AI 비전이 "테두리 색 = 필드" 규칙을 배우는 데 필요한 정보는 유지됩니다.
- 표 구조(가로선·세로선·칸 배치)도 유지되어 열/블럭 구분을 그대로 학습할 수 있습니다.

좌표는 1044×1394 크롭 기준으로 실측한 값입니다(가로선 y=61/113/390/453/732/779/1051,
가운데 세로선 x=536). 다른 사진으로 바꾸면 좌표를 다시 재야 합니다.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path('/workspace/attachments/2026-11-17/1000035640-7bd0281cbbd0437cbf40f3435ec0ebba.jpg')
DEFAULT_OUTPUT = ROOT / 'assets' / 'roster-ocr-reference.jpg'

CROP = (0, 318, 1044, 1712)          # 휴대폰 UI 제거
COLUMNS = [(8, 528), (544, 1036)]    # 왼쪽 열 / 오른쪽 열 (가운데 세로선 x=536)
BODY_ROWS = [(116, 386), (456, 728), (782, 1048)]  # 선박 3줄의 작업자 이름 칸
MOSAIC_BLOCK = 12                    # 모자이크 한 칸 크기(px)
LONGEST_EDGE = 1024                  # AI 입력용 축소 크기


def build_mask(width: int, height: int) -> Image.Image:
    mask = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for (left, right) in COLUMNS:
        for (top, bottom) in BODY_ROWS:
            draw.rectangle([max(0, left), max(0, top), min(width - 1, right), min(height - 1, bottom)], fill=255)
    return mask


def keep_color_mask(image: Image.Image) -> np.ndarray:
    """사용자가 그린 색 테두리·형광펜(강한 원색)은 모자이크에서 제외합니다(True = 원본 유지).

    JPEG 색 번짐(검은 글자 주변의 색 테두리)까지 보존하면 이름이 그대로 남으므로,
    파랑·보라·빨강·노랑처럼 채널 차이가 큰 원색만 인정합니다.
    """
    array = np.asarray(image.convert('RGB')).astype(np.int16)
    r, g, b = array[:, :, 0], array[:, :, 1], array[:, :, 2]
    blue = (b > 120) & (b - np.maximum(r, g) > 50)
    red = (r > 120) & (r - np.maximum(g, b) > 50)
    purple = (r > 90) & (b > 90) & (g + 45 < np.minimum(r, b))
    yellow = (r > 150) & (g > 140) & (b + 55 < np.minimum(r, g))
    colored = blue | red | purple | yellow
    # 선 두께만큼(1~2px) 주변도 보존해 테두리가 잘리지 않게 합니다.
    dilated = Image.fromarray((colored * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    return np.asarray(dilated) > 0


def anonymize(source: Path, output: Path) -> None:
    paper = Image.open(source).convert('RGB').crop(CROP)
    width, height = paper.size

    # 모자이크 본: 축소 → 확대(최근접) 로 글자를 읽을 수 없게 만듭니다.
    small = paper.resize((max(1, width // MOSAIC_BLOCK), max(1, height // MOSAIC_BLOCK)), Image.BILINEAR)
    mosaic = small.resize((width, height), Image.NEAREST).filter(ImageFilter.GaussianBlur(2.4))

    mask = np.asarray(build_mask(width, height)) > 0
    keep = keep_color_mask(paper)
    apply = mask & ~keep

    paper_array = np.asarray(paper)
    result = paper_array.copy()
    result[apply] = np.asarray(mosaic)[apply]
    # 바탕을 되돌리는 처리는 하지 않습니다. 이름 글자 밝기가 종이와 비슷한 사진에서는
    # 되돌리기가 글자까지 복원해 버립니다(실측: 모자이크를 되돌린 이미지에서 OCR 이 이름 145개를 다시 읽음).
    image = Image.fromarray(result)

    # 배포/AI 입력 크기로 줄입니다(긴 변 1024px).
    scale = LONGEST_EDGE / max(image.size)
    if scale < 1:
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    image.save(output, 'JPEG', quality=84, optimize=True)
    print(f'{output} · {image.size} · {output.stat().st_size:,}바이트')


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT
    if not source.exists():
        raise SystemExit(f'원본 사진이 없습니다: {source}')
    anonymize(source, output)


if __name__ == '__main__':
    main()
