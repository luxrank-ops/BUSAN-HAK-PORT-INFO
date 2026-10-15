#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
docs/ui-structure/ 이미지 9장 렌더러
- 현재 화면 캡처 5장 (public/index.html 실제 구조를 재구성한 렌더)
- 제안 목업 3장 (숫자·문구는 예시)
- 비교 이미지 1장

실행: python3 docs/ui-structure/render_images.py
"""
import os
import re
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = "/tmp/pretendard/fonts"
OUT = HERE

EMOJI_RE = re.compile("[\u2600-\u27BF\u2B00-\u2BFF\uFE0F\U0001F000-\U0001FAFF]")

S = 2  # 렌더 스케일 (2x)

# ---- 팔레트 (public/css/app.css 기준) ----
NAVY = (10, 27, 63)
NAVY2 = (29, 54, 111)
BG = (241, 245, 249)
CARD = (255, 255, 255)
TEXT = (15, 23, 42)
SUB = (100, 116, 139)
BORDER = (203, 213, 225)
BLUE = (37, 99, 235)
BLUE_SOFT = (219, 234, 254)
EMER = (5, 150, 105)
EMER_SOFT = (209, 250, 229)
AMBER = (245, 158, 11)
AMBER_SOFT = (254, 243, 199)
ORANGE = (234, 88, 12)
RED = (220, 38, 38)
PINK = (219, 39, 119)
WHITE = (255, 255, 255)
SLATE = (71, 85, 105)

FONTS = {}
EMOJI_CACHE = {}
CUR_IMG = [None]  # 현재 대상 Image (이모지 paste용)


def font(size, weight="r"):
    key = (size, weight)
    if key not in FONTS:
        name = {
            "r": "Pretendard-Regular.otf",
            "m": "Pretendard-Medium.otf",
            "sb": "Pretendard-SemiBold.otf",
            "b": "Pretendard-Bold.otf",
            "xb": "Pretendard-ExtraBold.otf",
        }[weight]
        FONTS[key] = ImageFont.truetype(os.path.join(FONT_DIR, name), int(size * S))
    return FONTS[key]


def emoji_raster(ch, size):
    """NotoColorEmoji(비트맵)로 이모지를 렌더해 패스용 RGBA 이미지 반환.
    글리프가 없으면 None (텍스트 폰트로 폴백)."""
    key = (ch, round(size, 1))
    if key not in EMOJI_CACHE:
        if "emoji136" not in FONTS:
            FONTS["emoji136"] = ImageFont.truetype(os.path.join(FONT_DIR, "NotoColorEmoji.ttf"), 109)
        tmp = Image.new("RGBA", (240, 240), (0, 0, 0, 0))
        td = ImageDraw.Draw(tmp)
        td.text((30, 30), ch, font=FONTS["emoji136"], embedded_color=True, fill=(0, 0, 0, 255))
        bbox = tmp.getbbox()
        if not bbox:
            EMOJI_CACHE[key] = None
        else:
            glyph = tmp.crop(bbox)
            target_h = max(4, int(size * S * 1.14))
            target_w = max(4, int(glyph.size[0] * target_h / max(1, glyph.size[1])))
            EMOJI_CACHE[key] = glyph.resize((target_w, target_h), Image.LANCZOS)
    return EMOJI_CACHE[key]


def px(v):
    return int(v * S)


def rr(d, x, y, w, h, r=10, fill=CARD, outline=None, width=1):
    d.rounded_rectangle([px(x), px(y), px(x + w), px(y + h)], radius=px(r),
                        fill=fill, outline=outline, width=px(width) if outline else 0)


_MEASURE = ImageDraw.Draw(Image.new("RGB", (1, 1)))


def _adv(ch, size, weight):
    """(논리폭, 이모지여부)"""
    if ch == "\uFE0F":
        return 0.0, False
    if EMOJI_RE.match(ch):
        g = emoji_raster(ch, size)
        if g is not None:
            return (g.size[0] + size * S * 0.10) / S, True
    return _MEASURE.textlength(ch, font=font(size, weight)) / S, False


def txt(d, x, y, s, size=12, weight="r", fill=TEXT, anchor="la"):
    s = str(s)
    horiz = anchor[0] if anchor else "l"
    vert = anchor[1] if len(anchor) > 1 else "a"
    widths = []
    total = 0.0
    for ch in s:
        w, is_e = _adv(ch, size, weight)
        widths.append((ch, w, is_e))
        total += w
    if horiz == "l":
        cx = x
    elif horiz == "m":
        cx = x - total / 2
    else:
        cx = x - total
    f = font(size, weight)
    for ch, w, is_e in widths:
        if ch == "\uFE0F":
            continue
        if is_e:
            g = emoji_raster(ch, size)
            if vert == "m":
                gy = px(y) - g.size[1] // 2
            else:
                gy = px(y) - int(g.size[1] * 0.10)
            if CUR_IMG[0] is not None:
                CUR_IMG[0].paste(g, (int(px(cx)), int(gy)), g)
        else:
            d.text((px(cx), px(y)), ch, font=f, fill=fill, anchor="l" + ("m" if vert == "m" else "a"))
        cx += w


def tw(d, s, size=12, weight="r"):
    return sum(_adv(ch, size, weight)[0] for ch in str(s))


def chip(d, x, y, label, fg=NAVY, bg=BLUE_SOFT, border=None, size=10.5, weight="b", h=26, pad=10):
    w = tw(d, label, size, weight) + pad * 2
    rr(d, x, y, w, h, r=h / 2, fill=bg, outline=border, width=1.2)
    txt(d, x + w / 2, y + h / 2, label, size, weight, fg, anchor="mm")
    return w


def clip(d, x, y, s, max_w, size=12, weight="r", fill=TEXT):
    if tw(d, s, size, weight) <= max_w:
        txt(d, x, y, s, size, weight, fill)
        return
    while s and tw(d, s + "…", size, weight) > max_w:
        s = s[:-1]
    txt(d, x, y, s + "…", size, weight, fill)


# ---------------- 공통 크롬 ----------------

def phone_base(title_left=""):
    img = Image.new("RGB", (px(390), px(844)), BG)
    CUR_IMG[0] = img
    d = ImageDraw.Draw(img)
    # 상태바
    d.rectangle([0, 0, px(390), px(30)], fill=NAVY)
    txt(d, 16, 8, "9:41", 11, "sb", WHITE)
    txt(d, 374, 8, "●●●  Wi-Fi  ▮", 9.5, "m", (148, 163, 184), anchor="ra")
    return img, d


def app_header(d, dark_text=False, right_extra=True):
    y = 30
    d.rectangle([0, px(y), px(390), px(y + 56)], fill=NAVY)
    # 방문자 배지
    rr(d, 12, y + 10, 74, 38, r=9, fill=(219, 234, 254), outline=(147, 197, 253), width=1)
    txt(d, 20, y + 15, "🟢오늘", 8.5, "sb", (29, 78, 216))
    txt(d, 20, y + 26, "128명", 10.5, "xb", (29, 78, 216))
    txt(d, 96, y + 18, "BUSAN HAK PORT", 16.5, "xb", WHITE)
    if right_extra:
        rr(d, 296, y + 14, 30, 30, r=15, fill=NAVY2)
        txt(d, 311, y + 29, "🔔", 13, "r", WHITE, anchor="mm")
        rr(d, 336, y + 14, 30, 30, r=15, fill=NAVY2)
        txt(d, 351, y + 29, "🌙", 12, "r", WHITE, anchor="mm")
    return y + 56


def safety_ticker(d, y):
    d.rectangle([0, px(y), px(390), px(y + 34)], fill=(254, 226, 226))
    txt(d, 14, y + 17, "🚨 안전 제일! 오늘도 무사고!", 11.5, "b", (153, 27, 27), anchor="lm")
    txt(d, 376, y + 17, "➕", 11, "b", (153, 27, 27), anchor="rm")
    return y + 34


def bottom_nav(d, items, active_idx):
    y = 844 - 64
    d.rectangle([0, px(y), px(390), px(844)], fill=WHITE)
    d.line([px(0), px(y), px(390), px(y)], fill=BORDER, width=px(1))
    seg = 390 / len(items)
    for i, (icon, label) in enumerate(items):
        cx = seg * i + seg / 2
        col = NAVY if i == active_idx else SUB
        if i == active_idx:
            rr(d, cx - 26, y + 2, 52, 3, r=2, fill=BLUE)
        txt(d, cx, y + 22, icon, 15, "r", col, anchor="mm")
        txt(d, cx, y + 43, label, 10.5, "b" if i == active_idx else "m", col, anchor="mm")


def scroll_hint(d, text="⋯ 스크롤 계속 ⋯"):
    txt(d, 195, 762, text, 10, "m", SUB, anchor="mm")


# ---------------- 카드 컴포넌트 ----------------

def dash_card(d, x, y, w, h, icon, title, sub, expanded=False, hero=False,
              accent=BLUE, right_extra=None):
    if hero:
        rr(d, x, y, w, h, r=12, fill=CARD, outline=accent, width=2)
    else:
        rr(d, x, y, w, h, r=12, fill=CARD, outline=BORDER, width=1)
    hh = 52
    # 헤더
    rr(d, x + 10, y + 10, 32, 32, r=9, fill=(238, 242, 255) if hero else (241, 245, 249))
    txt(d, x + 26, y + 26, icon, 15, "r", TEXT, anchor="mm")
    txt(d, x + 50, y + 16, title, 13.5, "xb", TEXT)
    clip(d, x + 50, y + 32, sub, w - 120, 9.5, "m", SUB)
    txt(d, x + w - 14, y + 26, "▼" if not expanded else "▲", 10, "b", SUB, anchor="rm")
    if right_extra:
        right_extra(d, x, y)
    if expanded:
        d.line([px(x + 12), px(y + hh), px(x + w - 12), px(y + hh)], fill=accent, width=px(2))
    return y + hh


def action_btn(d, x, y, w, h, label, fg=NAVY, bg=WHITE, border=BORDER, size=10):
    rr(d, x, y, w, h, r=8, fill=bg, outline=border, width=1.2)
    txt(d, x + w / 2, y + h / 2, label, size, "b", fg, anchor="mm")


# ============================================================
# 현재 화면 캡처 5장
# ============================================================

def current_01():
    img, d = phone_base()
    y = app_header(d)
    y = safety_ticker(d, y) + 8

    # 단골 터미널 퀵바
    rr(d, 12, y, 366, 88, r=12, fill=AMBER_SOFT, outline=AMBER, width=1.6)
    txt(d, 24, y + 16, "⭐ 내 단골 터미널", 12, "xb", (146, 64, 14))
    txt(d, 366, y + 16, "1초 실행", 9.5, "b", ORANGE, anchor="ra")
    labels = ["HJNC", "DGT", "BNCT", "BCT"]
    bx = 24
    for lb in labels:
        bx += chip(d, bx, y + 30, lb, (146, 64, 14), (255, 251, 235), ORANGE, 10, "b", 22, 8) + 6
    acts = ["스케줄", "차트", "현황", "베이플랜", "셔틀", "식단"]
    bx = 24
    for a in acts:
        bx += chip(d, bx, y + 58, a, ORANGE, (255, 247, 237), (251, 146, 60), 9.5, "b", 22, 7) + 5
    y += 88 + 10

    # 임금계산기 hero 카드 (헤더 + 주야간 표)
    def wage_right(d, x, y):
        pass
    hh = 118
    dash_card(d, 12, y, 366, hh, "🧮", "임금계산기", "주·야간 자동 분리 및 일지 연동", expanded=False, hero=True, accent=BLUE)
    # 주야간 시간표 (헤더 우측)
    tx, ty, tw_ = 218, y + 6, 148
    rr(d, tx, ty, tw_, 40, r=6, fill=WHITE, outline=(148, 163, 184), width=1.2)
    cols = ["월", "주간", "야간"]
    rows = [("1~3월", "08~18", "18~08"), ("10~12월", "07~17", "17~07")]
    cw = tw_ / 3
    for i, c in enumerate(cols):
        txt(d, tx + cw * i + cw / 2, ty + 8, c, 8, "b", SLATE, anchor="mm")
    for ri, row in enumerate(rows):
        for ci, cell in enumerate(row):
            txt(d, tx + cw * ci + cw / 2, ty + 22 + ri * 11, cell, 7.5, "m", SLATE, anchor="mm")
    txt(d, 24, y + 62, "💡 직종 선택 후 시작·종료 블록을 터치해", 9.5, "m", SUB)
    txt(d, 24, y + 74, "날짜·시간을 설정하세요.", 9.5, "m", SUB)
    roles = [("🚢 본선", True), ("🔧 기능공", False), ("🚛 육상", False)]
    bx = 24
    for lb, act in roles:
        bw = 74
        rr(d, bx, y + 88, bw, 22, r=7, fill=NAVY if act else (241, 245, 249),
           outline=None if act else BORDER, width=1)
        txt(d, bx + bw / 2, y + 99, lb, 9, "b", WHITE if act else SLATE, anchor="mm")
        bx += bw + 8
    y += hh + 10

    # 근무일지 hero 카드
    dash_card(d, 12, y, 366, 64, "📅", "근무일지", "날짜 클릭 기록 · 월간 정산 관리", hero=True, accent=EMER)
    y += 64 + 10

    # 공지 카드 일부
    dash_card(d, 12, y, 366, 52, "📢", "공지사항", "운영 안내 및 주요 소식")
    y += 62
    dash_card(d, 12, y, 366, 52, "🌍", "현장 영어 캘린더", "매일 한 문장 · 항만 실무 영어")
    y += 62
    dash_card(d, 12, y, 366, 52, "💬", "톡톡 게시판", "현장 동료 자유 소통방")
    y += 62
    dash_card(d, 12, y, 366, 52, "📂", "자료실", "근무 계약서·급여명세 양식")
    y += 62
    dash_card(d, 12, y, 366, 52, "🌬️", "기상·작업 안전", "신항·북항 풍속 및 도선 현황")
    scroll_hint(d, "⋯ 12개 카드가 아래로 계속 ⋯")

    bottom_nav(d, [("🏠", "홈"), ("💬", "톡톡"), ("🚢", "선박"), ("📂", "자료")], 0)
    img.save(os.path.join(OUT, "current-01-home-top.png"))


def current_02():
    img, d = phone_base()
    y = 30
    d.rectangle([0, px(y), px(390), px(y + 40)], fill=NAVY)
    txt(d, 16, y + 20, "🧮 임금계산기 (펼침)", 13, "xb", WHITE, anchor="lm")
    txt(d, 374, y + 20, "▲", 11, "b", (148, 163, 184), anchor="rm")
    y += 48

    # 임금계산기 본문
    hh = 330
    rr(d, 12, y, 366, hh, r=12, fill=CARD, outline=BLUE, width=2)
    roles = [("🚢 본선", True), ("🔧 기능공", False), ("🚛 육상", False)]
    bx = 24
    for lb, act in roles:
        bw = 108
        rr(d, bx, y + 12, bw, 30, r=8, fill=NAVY if act else (241, 245, 249),
           outline=None if act else BORDER, width=1)
        txt(d, bx + bw / 2, y + 27, lb, 10.5, "b", WHITE if act else SLATE, anchor="mm")
        bx += bw + 8
    # 시급
    txt(d, 24, y + 56, "2026년 시급", 11, "xb", TEXT)
    rr(d, 232, y + 50, 132, 30, r=8, fill=WHITE, outline=NAVY, width=1.6)
    txt(d, 356, y + 65, "10,320", 13, "xb", (239, 68, 68), anchor="rm")
    # 시작/종료
    for i, (lb, dv, tm) in enumerate([("시작", "2026-10-14 (화)", "18:00"),
                                      ("종료", "2026-10-15 (수)", "06:00")]):
        ry = y + 92 + i * 46
        rr(d, 24, ry, 342, 40, r=9, fill=(248, 250, 252), outline=BORDER, width=1)
        txt(d, 36, ry + 20, lb, 10.5, "b", BLUE, anchor="lm")
        txt(d, 78, ry + 20, dv, 11, "sb", TEXT, anchor="lm")
        txt(d, 354, ry + 20, tm, 12, "xb", NAVY, anchor="rm")
    # 추가수당
    txt(d, 24, y + 192, "추가 수당 시간", 10.5, "xb", TEXT)
    extras = ["연장 0.0h", "야간 8.0h", "휴일 0.0h", "특근 0.0h"]
    bx = 24
    for e in extras:
        bx += chip(d, bx, y + 208, e, SLATE, WHITE, BORDER, 9.5, "b", 24, 8) + 6
    # 계산 결과
    rr(d, 24, y + 242, 342, 74, r=10, fill=(239, 246, 255), outline=(147, 197, 253), width=1.4)
    txt(d, 38, y + 258, "예상 임금", 10, "b", (29, 78, 216))
    txt(d, 352, y + 258, "₩132,096", 17, "xb", NAVY, anchor="rm")
    txt(d, 38, y + 282, "본선 12h × 10,320원 + 야간 8h 수당", 9, "m", SUB)
    txt(d, 38, y + 296, "※ 예시 금액입니다", 8.5, "m", SUB)
    y += hh + 12

    # 근무일지 (펼침)
    d.rectangle([0, px(y), px(390), px(y + 36)], fill=EMER)
    txt(d, 16, y + 18, "📅 근무일지 (펼침)", 12.5, "xb", WHITE, anchor="lm")
    txt(d, 374, y + 18, "▲", 11, "b", (167, 243, 208), anchor="rm")
    y += 44
    rr(d, 12, y, 366, 200, r=12, fill=CARD, outline=EMER, width=2)
    txt(d, 24, y + 14, "🔒 기간·키워드 검색 및 상세 정산 통계 (잠김)", 9.5, "b", (29, 78, 216))
    rr(d, 24, y + 34, 342, 26, r=7, fill=(239, 246, 255), outline=(147, 197, 253))
    txt(d, 34, y + 47, "🔍 근무 기록 기간·키워드 검색", 9.5, "b", (29, 78, 216), anchor="lm")
    fields = [("배 이름", "한진 뉴욕 (HJNY)"), ("임금", "132,096원"), ("근무자", "김○수, 박○철"), ("작업 내용", "작업 내용을 입력하세요")]
    for i, (lb, v) in enumerate(fields):
        ry = y + 70 + i * 32
        txt(d, 24, ry + 13, lb, 9.5, "b", SUB, anchor="lm")
        rr(d, 90, ry, 276, 26, r=7, fill=WHITE, outline=BORDER)
        clip(d, 100, ry + 13, v, 250, 9.5, "m", TEXT if i < 3 else SUB, )
    y += 212
    scroll_hint(d, "⋯ 아래로 스크롤 ⋯")
    bottom_nav(d, [("🏠", "홈"), ("💬", "톡톡"), ("🚢", "선박"), ("📂", "자료")], 0)
    img.save(os.path.join(OUT, "current-02-wage-worklog.png"))


def current_03():
    img, d = phone_base()
    y = 30
    d.rectangle([0, px(y), px(390), px(y + 40)], fill=NAVY)
    txt(d, 16, y + 20, "중단 카드 구간 (공지·영어·톡톡·자료)", 12.5, "xb", WHITE, anchor="lm")
    y += 52

    cards = [
        ("📢", "공지사항", "운영 안내 및 주요 소식", BLUE,
         [("신규 시급 기준 안내 (2026-10)", "10.13"), ("터미널 스케줄 변경 알림", "10.11")]),
        ("🌍", "현장 영어 캘린더", "매일 한 문장 · 항만 실무 영어", (124, 58, 237),
         [("Day 288 · Bay plan check, please.", "10.15")]),
        ("💬", "톡톡 게시판", "현장 동료 자유 소통방", PINK,
         [("오늘 HJNC 야간 조 모집합니다", "💬 12"), ("셔틀버스 막차 시간 아시는 분?", "💬 5")]),
        ("📂", "자료실", "근무 계약서·급여명세 양식", (8, 145, 178),
         [("2027 근로계약서 양식", "⬇")]),
    ]
    cards.append(("📖", "항만 용어 사전", "라싱 · 중장비 · 선박 필수 용어", (124, 58, 237),
                  [("라싱(Lashing) · 스프레더", "52"), ("베이플랜 · OT기사 용어", "31")]))
    for icon, title, sub, accent, rows in cards:
        hh = 32 + 26 + 26 * len(rows) + 14
        rr(d, 12, y, 366, hh, r=12, fill=CARD, outline=BORDER, width=1)
        rr(d, 22, y + 10, 30, 30, r=8, fill=(241, 245, 249))
        txt(d, 37, y + 25, icon, 14, "r", TEXT, anchor="mm")
        txt(d, 60, y + 15, title, 12.5, "xb", TEXT)
        clip(d, 60, y + 31, sub, 280, 9, "m", SUB)
        txt(d, 366, y + 25, "▼", 9.5, "b", SUB, anchor="rm")
        ry = y + 52
        for label, meta in rows:
            txt(d, 28, ry + 11, "·", 11, "b", accent, anchor="lm")
            clip(d, 40, ry + 11, label, 240, 10, "m", TEXT)
            txt(d, 358, ry + 11, meta, 9, "m", SUB, anchor="rm")
            ry += 24
        y += hh + 10

    scroll_hint(d, "⋯ 카드가 계속 이어집니다 ⋯")
    bottom_nav(d, [("🏠", "홈"), ("💬", "톡톡"), ("🚢", "선박"), ("📂", "자료")], 1)
    img.save(os.path.join(OUT, "current-03-notice-community.png"))


def current_04():
    img, d = phone_base()
    y = 30
    d.rectangle([0, px(y), px(390), px(y + 40)], fill=NAVY)
    txt(d, 16, y + 20, "터미널 · 선박 구간", 12.5, "xb", WHITE, anchor="lm")
    y += 52

    # 3항업 배너
    rr(d, 12, y, 366, 46, r=10, fill=(15, 23, 42))
    txt(d, 26, y + 23, "🏗️ 3항업 (신항) ▼", 12.5, "xb", WHITE, anchor="lm")
    bx = 190
    for c in ["HJNC", "BNCT", "DGT", "BCT"]:
        bx += chip(d, bx, y + 12, c, (203, 213, 225), (30, 41, 59), (71, 85, 105), 8.5, "b", 22, 6) + 4
    y += 54

    # 터미널 티커
    rr(d, 12, y, 366, 30, r=8, fill=(255, 251, 235), outline=(253, 230, 138))
    txt(d, 24, y + 15, "🚧 3항업 공지: 10/15 06시 HJNC 5번 버스터 정비 예정", 9, "m", (120, 53, 15), anchor="lm")
    y += 38

    # HJNC 펼침
    hh = 168
    rr(d, 12, y, 366, hh, r=10, fill=CARD, outline=BORDER, width=1)
    rr(d, 12, y, 366, 34, r=10, fill=(255, 251, 235))
    txt(d, 24, y + 17, "한진신항만 (HJNC) ▲", 11.5, "xb", (146, 64, 14), anchor="lm")
    btns = [("스케줄", (255, 251, 235), (217, 119, 6)), ("차트", (255, 251, 235), (217, 119, 6)),
            ("현황", (255, 251, 235), (217, 119, 6))]
    for i, (lb, bg, bd) in enumerate(btns):
        action_btn(d, 24 + i * 112, y + 44, 104, 32, lb, (146, 64, 14), bg, bd, 10.5)
    action_btn(d, 24, y + 84, 222, 30, "🧩 BAY PLAN", (146, 64, 14), (255, 251, 235), AMBER, 10)
    action_btn(d, 254, y + 84, 112, 30, "📅 조장 근무일", (3, 105, 161), (224, 242, 254), (2, 132, 199), 9)
    action_btn(d, 24, y + 122, 342, 32, "✨ 한진 식단 ✨", (154, 52, 18), (255, 237, 213), (251, 146, 60), 11)
    y += hh + 8

    # 접힘 터미널 2줄
    for name in ["부산신항컨테이너터미널 (BNCT) ▼", "동원글로벌터미널부산 (DGT) ▼", "부산컨테이너터미널 (BCT) ▼"]:
        rr(d, 12, y, 366, 34, r=8, fill=CARD, outline=BORDER)
        txt(d, 24, y + 17, name, 10.5, "b", SLATE, anchor="lm")
        y += 40

    # 2항업 배너 + 접힘 터미널
    rr(d, 12, y, 366, 44, r=10, fill=(30, 41, 59))
    txt(d, 26, y + 22, "🏗️ 2항업 (신항) ▼", 12, "xb", WHITE, anchor="lm")
    bx = 196
    for c in ["PNC", "HPNT", "PNIT"]:
        bx += chip(d, bx, y + 11, c, (203, 213, 225), (51, 65, 85), (71, 85, 105), 8.5, "b", 22, 6) + 4
    y += 50
    for name in ["부산신항만 (PNC) ▼", "HMM (HPNT) ▼"]:
        rr(d, 12, y, 366, 34, r=8, fill=CARD, outline=BORDER)
        txt(d, 24, y + 17, name, 10.5, "b", SLATE, anchor="lm")
        y += 40

    # 선박 도감 배너
    rr(d, 12, y, 366, 52, r=10, fill=(146, 64, 14), outline=AMBER, width=1.6)
    txt(d, 195, y + 20, "🚢 선박 도감", 13.5, "xb", WHITE, anchor="mm")
    txt(d, 195, y + 38, "#오토콘  #수동콘  #브릿지주의  ★난이도", 9, "m", (254, 243, 199), anchor="mm")

    bottom_nav(d, [("🏠", "홈"), ("💬", "톡톡"), ("🚢", "선박"), ("📂", "자료")], 2)
    img.save(os.path.join(OUT, "current-04-terminals-ship.png"))


def current_05():
    img, d = phone_base()
    y = 30
    d.rectangle([0, px(y), px(390), px(y + 40)], fill=NAVY)
    txt(d, 16, y + 20, "하단 카드 구간 (기상·안전·용어·개인정보)", 12, "xb", WHITE, anchor="lm")
    y += 52

    cards = [
        ("🌬️", "기상·작업 안전", "신항·북항 풍속 및 도선 현황", BLUE,
         "신항 14°C · 풍속 6.2m/s · 강풍 주의보 없음"),
        ("🛡️", "안전 매뉴얼", "6단계 핵심 현장 안전 매뉴얼", RED,
         "STEP 1 안전장비 점검 → STEP 6 정리정돈"),
        ("📖", "항만 용어 사전", "라싱 · 중장비 · 선박 필수 용어", (124, 58, 237),
         "라싱(Lashing) · 스프레더 · 베이플랜 · OT기사"),
        ("🔐", "개인정보 보호 센터", "데이터 암호화 및 개인정보 보호", SLATE,
         "SHA-256 해시 · 9445 보안 잠금 · 로그아웃"),
    ]
    for icon, title, sub, accent, body in cards:
        hh = 66
        rr(d, 12, y, 366, hh, r=12, fill=CARD, outline=BORDER, width=1)
        rr(d, 22, y + 12, 30, 30, r=8, fill=(241, 245, 249))
        txt(d, 37, y + 27, icon, 14, "r", TEXT, anchor="mm")
        txt(d, 60, y + 18, title, 12, "xb", TEXT)
        clip(d, 60, y + 34, sub, 270, 8.5, "m", SUB)
        txt(d, 366, y + 27, "▼", 9.5, "b", SUB, anchor="rm")
        clip(d, 24, y + 52, body, 330, 8.5, "m", SLATE)
        y += hh + 8

    # 메뉴얼 카드 + footer 요약
    rr(d, 12, y, 366, 54, r=12, fill=(255, 251, 235), outline=AMBER, width=1.4)
    txt(d, 24, y + 18, "📘 메인 작업 매뉴얼", 11.5, "xb", (146, 64, 14))
    clip(d, 24, y + 36, "신규 입사자 필독 · 현장 적응 가이드", 320, 9, "m", (146, 64, 14))
    y += 62
    # 운영 정보
    rr(d, 12, y, 366, 54, r=12, fill=CARD, outline=BORDER, width=1)
    txt(d, 24, y + 18, "☎️ 운영 관리자 연락처", 11.5, "xb", TEXT)
    clip(d, 24, y + 36, "문의: luxrank@gmail.com · 010-2846-8906", 320, 9, "m", SUB)
    y += 62
    txt(d, 195, y + 10, "총 12개 카드 + 터미널 3그룹(9곳) 일렬 배치", 9.5, "b", SUB, anchor="mm")
    txt(d, 195, y + 26, "스크롤 없이 끝까지 보려면 4~5회 스와이프", 9, "m", SUB, anchor="mm")

    bottom_nav(d, [("🏠", "홈"), ("💬", "톡톡"), ("🚢", "선박"), ("📂", "자료")], 0)
    img.save(os.path.join(OUT, "current-05-lower-cards-nav.png"))


# ============================================================
# 제안 목업 3장 (숫자·문구는 예시)
# ============================================================

def mockup_01():
    img, d = phone_base()
    # 상단 컴팩트 헤더 + 검색
    y = 30
    d.rectangle([0, px(y), px(390), px(y + 46)], fill=NAVY)
    txt(d, 16, y + 16, "BUSAN HAK PORT", 13.5, "xb", WHITE, anchor="lm")
    txt(d, 250, y + 16, "🔔", 12, "r", WHITE, anchor="lm")
    txt(d, 285, y + 16, "🌙", 11, "r", WHITE, anchor="lm")
    txt(d, 374, y + 16, "👤", 12, "r", WHITE, anchor="rm")
    rr(d, 12, y + 22, 366, 30, r=15, fill=(255, 255, 255))
    txt(d, 28, y + 37, "🔍  선박·터미널·기능 통합 검색", 10, "m", SUB, anchor="lm")
    y += 62

    # 오늘의 작업 요약 (위계 1)
    rr(d, 12, y, 366, 132, r=14, fill=NAVY)
    txt(d, 28, y + 20, "오늘의 작업", 11, "b", (147, 197, 253), anchor="lm")
    txt(d, 28, y + 48, "₩2,684,000", 26, "xb", WHITE)
    txt(d, 28, y + 76, "10월 누적 · 12일 근무 · 목표 78%", 10, "m", (148, 163, 184))
    # 진행 게이지
    rr(d, 28, y + 94, 334, 10, r=5, fill=(30, 41, 59))
    rr(d, 28, y + 94, 260, 10, r=5, fill=(34, 197, 94))
    txt(d, 28, y + 112, "다음 야간 수당 자동 계산 예정", 9, "m", (148, 163, 184))
    txt(d, 356, y + 112, "예시", 8.5, "m", (100, 116, 139), anchor="rm")
    y += 142

    # 퀵 액션 4개 (위계 2)
    txt(d, 16, y + 8, "빠른 실행", 12, "xb", TEXT, anchor="lm")
    y += 22
    actions = [("🧮", "임금계산", BLUE), ("📅", "근무일지", EMER), ("🚢", "선박검색", AMBER), ("🏗️", "터미널", (124, 58, 237))]
    for i, (ic, lb, col) in enumerate(actions):
        x = 12 + i * 93
        rr(d, x, y, 85, 85, r=13, fill=CARD, outline=BORDER, width=1)
        rr(d, x + 24, y + 12, 38, 38, r=19, fill=(238, 242, 255) if col == BLUE else
           (236, 253, 245) if col == EMER else (255, 251, 235) if col == AMBER else (245, 243, 255))
        txt(d, x + 43, y + 31, ic, 16, "r", TEXT, anchor="mm")
        txt(d, x + 42, y + 64, lb, 10.5, "b", TEXT, anchor="mm")
    y += 97

    # 오늘 입항 선박 칩 (위계 3)
    txt(d, 16, y + 6, "오늘 입항 · HJNC", 11.5, "xb", TEXT, anchor="lm")
    txt(d, 374, y + 6, "전체 보기 ›", 9.5, "b", BLUE, anchor="rm")
    y += 22
    ships = [("한진 뉴욕", "5부두 · 21:00", True), ("MSC 이스탄불", "3부두 · 23:30", False), ("ONE OSAKA", "대기 · 06:00", False)]
    for name, meta, hot in ships:
        rr(d, 12, y, 366, 44, r=10, fill=CARD, outline=AMBER if hot else BORDER, width=1.4 if hot else 1)
        txt(d, 24, y + 15, name, 11, "xb", TEXT, anchor="lm")
        txt(d, 24, y + 31, meta, 8.5, "m", SUB, anchor="lm")
        if hot:
            chip(d, 288, y + 10, "바로입력", (153, 27, 27), (254, 226, 226), None, 8.5, "b", 24, 8)
        else:
            chip(d, 296, y + 10, "자세히", SLATE, (241, 245, 249), BORDER, 8.5, "b", 24, 8)
        y += 50

    # 공지 1줄
    rr(d, 12, y + 4, 366, 34, r=9, fill=(239, 246, 255), outline=(147, 197, 253))
    txt(d, 24, y + 21, "📢 새 시급 기준 반영 완료 · 자세히 ›", 9.5, "b", (29, 78, 216), anchor="lm")
    y += 48

    # 이번 주 미니 차트 (예시)
    rr(d, 12, y, 366, 128, r=13, fill=CARD, outline=BORDER, width=1)
    txt(d, 26, y + 16, "이번 주 근무 요약", 11.5, "xb", TEXT, anchor="lm")
    txt(d, 358, y + 16, "예시", 8.5, "m", SUB, anchor="rm")
    days = [("월", 34), ("화", 52), ("수", 44), ("목", 60), ("금", 52), ("토", 28), ("일", 8)]
    for i, (dv, h) in enumerate(days):
        bx = 34 + i * 47
        rr(d, bx, y + 96 - h, 26, h, r=6, fill=(37, 99, 235) if i < 5 else (147, 197, 253))
        txt(d, bx + 13, y + 110, dv, 9, "m", SUB, anchor="mm")
    txt(d, 358, y + 60, "총 38h", 10, "b", NAVY, anchor="rm")
    y += 136

    # 자주 쓰는 동료 칩
    txt(d, 16, y + 4, "자주 함께하는 동료", 10.5, "xb", TEXT, anchor="lm")
    bx = 24
    for n in ["김○수", "박○철", "이○호", "+ 추가"]:
        bx += chip(d, bx, y + 18, n, SLATE, (241, 245, 249), BORDER, 9, "b", 24, 8) + 6

    bottom_nav(d, [("🏠", "홈"), ("📅", "근무"), ("🚢", "선박"), ("🏗️", "터미널"), ("⋯", "더보기")], 0)
    img.save(os.path.join(OUT, "mockup-01-home-hierarchy.png"))


def mockup_02():
    img, d = phone_base()
    y = 30
    d.rectangle([0, px(y), px(390), px(y + 44)], fill=NAVY)
    txt(d, 20, y + 22, "‹", 16, "b", WHITE, anchor="lm")
    txt(d, 195, y + 22, "근무일지 입력", 13.5, "xb", WHITE, anchor="mm")
    txt(d, 374, y + 22, "저장", 11, "b", (110, 231, 183), anchor="rm")
    y += 56

    # 스텝퍼
    steps = [("1", "기본 정보", True), ("2", "임금 계산", False), ("3", "검토·저장", False)]
    for i, (n, lb, done) in enumerate(steps):
        x = 30 + i * 120
        rr(d, x, y, 26, 26, r=13, fill=EMER if done else (226, 232, 240))
        txt(d, x + 13, y + 13, "✓" if done else n, 11, "xb", WHITE if done else SUB, anchor="mm")
        txt(d, x + 34, y + 13, lb, 9.5, "b" if done else "m", EMER if done else SUB, anchor="lm")
        if i < 2:
            d.line([px(x + 100), px(y + 13), px(x + 112), px(y + 13)], fill=BORDER, width=px(2))
    y += 40
    rr(d, 12, y, 366, 6, r=3, fill=(226, 232, 240))
    rr(d, 12, y, 122, 6, r=3, fill=EMER)
    y += 18

    # Step1 기본 정보
    rr(d, 12, y, 366, 268, r=13, fill=CARD, outline=BORDER, width=1)
    txt(d, 26, y + 16, "① 기본 정보", 12, "xb", TEXT, anchor="lm")
    txt(d, 358, y + 16, "예시", 8.5, "m", SUB, anchor="rm")
    fields = [
        ("근무일", "2026-10-14 (화)"),
        ("터미널", "한진신항만 (HJNC)"),
        ("선박", "한진 뉴욕 (HJNY)"),
        ("근무 시간", "18:00 → 06:00 (12h)"),
    ]
    for i, (lb, v) in enumerate(fields):
        ry = y + 40 + i * 52
        txt(d, 26, ry + 10, lb, 9.5, "b", SUB, anchor="lm")
        rr(d, 26, ry + 22, 338, 30, r=8, fill=(248, 250, 252), outline=BORDER)
        txt(d, 38, ry + 37, v, 10.5, "sb", TEXT, anchor="lm")
        txt(d, 352, ry + 37, "›", 11, "b", SUB, anchor="rm")
    y += 280

    # Step2 미리보기
    rr(d, 12, y, 366, 128, r=13, fill=(236, 253, 245), outline=(167, 243, 208), width=1.4)
    txt(d, 26, y + 16, "② 임금 계산 (자동)", 12, "xb", (4, 120, 87), anchor="lm")
    rows = [("주간 4h × 10,320", "41,280"), ("야간 8h × 12,900", "103,200"), ("야간 수당 포함 합계", "₩144,480")]
    for i, (lb, v) in enumerate(rows):
        ry = y + 40 + i * 26
        big = i == 2
        txt(d, 26, ry + 10, lb, 10 if big else 9.5, "xb" if big else "m", (4, 120, 87) if big else SLATE, anchor="lm")
        txt(d, 352, ry + 10, v, 12 if big else 10.5, "xb", (4, 120, 87) if big else TEXT, anchor="rm")
    y += 140

    # Step3 요약 미리보기
    rr(d, 12, y, 366, 96, r=13, fill=CARD, outline=BORDER, width=1)
    txt(d, 26, y + 16, "③ 검토·저장 항목", 12, "xb", TEXT, anchor="lm")
    txt(d, 358, y + 16, "예시", 8.5, "m", SUB, anchor="rm")
    items = [("근무일·터미널·선박", "입력됨"), ("근무 시간 12h", "확인"), ("현장 사진 1장", "첨부")]
    for i, (lb, st) in enumerate(items):
        ry = y + 40 + i * 18
        txt(d, 26, ry, lb, 9.5, "m", SLATE, anchor="lm")
        txt(d, 358, ry, st, 9, "b", EMER, anchor="rm")
    y += 108

    # 하단 고정 버튼
    rr(d, 12, y, 366, 48, r=13, fill=EMER)
    txt(d, 195, y + 24, "다음: 검토·저장 ›", 13, "xb", WHITE, anchor="mm")

    bottom_nav(d, [("🏠", "홈"), ("📅", "근무"), ("🚢", "선박"), ("🏗️", "터미널"), ("⋯", "더보기")], 1)
    img.save(os.path.join(OUT, "mockup-02-worklog-flow.png"))


def mockup_03():
    img, d = phone_base()
    y = 30
    d.rectangle([0, px(y), px(390), px(y + 44)], fill=NAVY)
    txt(d, 16, y + 22, "화면 구조 맵", 13, "xb", WHITE, anchor="lm")
    txt(d, 374, y + 22, "🎨", 12, "r", WHITE, anchor="rm")
    y += 56

    txt(d, 16, y + 10, "제안: 5탭 + FAB 구조", 13, "xb", TEXT, anchor="lm")
    y += 30

    # 5탭 구조 설명 카드
    tabs_info = [
        ("🏠", "홈", "오늘의 요약 · 퀵 액션 · 입항 선박", BLUE),
        ("📅", "근무", "임금계산기 + 근무일지 통합 플로우", EMER),
        ("🚢", "선박", "선박 도감 · 검색 · 상세", AMBER),
        ("🏗️", "터미널", "9개 터미널 · 스케줄/차트/현황", (124, 58, 237)),
        ("⋯", "더보기", "공지·게시판·자료·용어·설정", SLATE),
    ]
    for ic, lb, desc, col in tabs_info:
        rr(d, 12, y, 366, 52, r=11, fill=CARD, outline=BORDER, width=1)
        rr(d, 22, y + 10, 32, 32, r=16, fill=(241, 245, 249))
        txt(d, 38, y + 26, ic, 14, "r", TEXT, anchor="mm")
        txt(d, 64, y + 18, lb, 11.5, "xb", TEXT)
        clip(d, 64, y + 33, desc, 280, 8.5, "m", SUB)
        # 활성 예시
        if lb == "홈":
            chip(d, 316, y + 15, "기본", (29, 78, 216), (219, 234, 254), None, 8, "b", 22, 7)
        y += 58

    # FAB 설명
    rr(d, 12, y + 4, 366, 74, r=12, fill=(255, 251, 235), outline=AMBER, width=1.4)
    txt(d, 26, y + 22, "➕ 플로팅 액션 버튼(FAB)", 11, "xb", (146, 64, 14), anchor="lm")
    txt(d, 26, y + 42, "어떤 화면에서든 임금계산·근무일지 작성", 9.5, "m", (146, 64, 14))
    txt(d, 26, y + 58, "1탭 진입 — 예시 문구입니다", 9, "m", (146, 64, 14))
    rr(d, 312, y + 20, 52, 52, r=26, fill=EMER)
    txt(d, 338, y + 46, "＋", 22, "xb", WHITE, anchor="mm")
    y += 90

    # 통합 검색·알림 개선
    rr(d, 12, y, 366, 76, r=12, fill=CARD, outline=BORDER, width=1)
    txt(d, 26, y + 18, "🔍 통합 검색 · 🔔 알림 센터", 11, "xb", TEXT, anchor="lm")
    txt(d, 26, y + 38, "선박·터미널·기능을 한 검색창에서", 9.5, "m", SUB)
    txt(d, 26, y + 56, "읽지 않은 알림만 모아보기 (예시)", 9.5, "m", SUB)
    y += 88

    # 위계 요약
    rr(d, 12, y, 366, 88, r=12, fill=NAVY)
    txt(d, 26, y + 20, "카드 12개 일렬 → 3단계 위계", 11.5, "xb", WHITE, anchor="lm")
    lines = ["① 오늘의 작업 (요약/게이지)", "② 빠른 실행 (핵심 4기능)", "③ 컨텍스트 (입항·공지·추천)"]
    for i, ln in enumerate(lines):
        txt(d, 26, y + 42 + i * 16, ln, 9.5, "m", (148, 163, 184))

    bottom_nav(d, [("🏠", "홈"), ("📅", "근무"), ("🚢", "선박"), ("🏗️", "터미널"), ("⋯", "더보기")], 0)
    img.save(os.path.join(OUT, "mockup-03-navigation.png"))


# ============================================================
# 비교 이미지
# ============================================================

def compare_01():
    W, H = 1640, 1060
    img = Image.new("RGB", (px(W), px(H)), (248, 250, 252))
    CUR_IMG[0] = img
    d = ImageDraw.Draw(img)
    # 타이틀
    d.rectangle([0, 0, px(W), px(86)], fill=NAVY)
    txt(d, 40, 43, "화면 구조 개선 비교 — 현재 vs 제안", 24, "xb", WHITE, anchor="lm")
    txt(d, 1600, 43, "BUSAN HAK PORT INFO · 예시 수치 포함", 13, "m", (148, 163, 184), anchor="rm")

    # 좌: 현재 (세로 스크롤 표현)
    left_x, top = 80, 150
    txt(d, left_x + 210, top - 18, "현재 — 단일 긴 스크롤", 18, "xb", (153, 27, 27), anchor="mm")
    ph = 850
    rr(d, left_x, top, 420, ph, r=18, fill=(241, 245, 249), outline=(203, 213, 225), width=2)
    # 스크롤 슬라이더
    rr(d, left_x + 392, top + 60, 14, 200, r=7, fill=(203, 213, 225))
    rr(d, left_x + 392, top + 60, 14, 70, r=7, fill=(220, 38, 38))
    cards = [
        ("🧮 임금계산기", "주·야간 자동 분리", True),
        ("📅 근무일지", "날짜 클릭 기록", True),
        ("🏗️ 3항업/2항업/1항업", "터미널 9곳 아코디언", False),
        ("🚢 선박 도감", "난이도 · 태그 필터", False),
        ("📢 공지사항", "", False),
        ("🌍 현장 영어", "", False),
        ("💬 톡톡 게시판", "", False),
        ("📂 자료실", "", False),
        ("🌬️ 기상 · 🛡️ 안전", "", False),
        ("📖 용어 · 🔐 개인정보", "", False),
        ("📘 메인 매뉴얼", "", False),
    ]
    cy = top + 24
    for i, (t, s, hero) in enumerate(cards):
        h = 66 if hero else 54
        rr(d, left_x + 22, cy, 356, h, r=10, fill=WHITE,
           outline=(37, 99, 235) if hero else (203, 213, 225), width=1.6 if hero else 1)
        txt(d, left_x + 38, cy + h / 2 - (6 if s else 0), t, 12.5, "xb", TEXT, anchor="lm")
        if s:
            txt(d, left_x + 38, cy + h / 2 + 12, s, 9.5, "m", SUB, anchor="lm")
        txt(d, left_x + 362, cy + h / 2, "▼", 9, "b", SUB, anchor="rm")
        cy += h + 8
    txt(d, left_x + 210, top + ph - 34, "스크롤 4~5회 · 카드 12 + 터미널 3그룹", 11.5, "b", (153, 27, 27), anchor="mm")

    # 우: 제안
    right_x = 1140
    txt(d, right_x + 210, top - 18, "제안 — 3단계 위계 + 5탭", 18, "xb", (4, 120, 87), anchor="mm")
    rr(d, right_x, top, 420, ph, r=18, fill=(241, 245, 249), outline=(203, 213, 225), width=2)
    # 헤더+검색
    rr(d, right_x + 22, top + 24, 376, 56, r=10, fill=NAVY)
    txt(d, right_x + 38, top + 42, "BUSAN HAK PORT", 11, "xb", WHITE, anchor="lm")
    rr(d, right_x + 38, top + 52, 344, 18, r=9, fill=WHITE)
    txt(d, right_x + 50, top + 61, "🔍 통합 검색", 8, "m", SUB, anchor="lm")
    # 오늘의 작업
    rr(d, right_x + 22, top + 92, 376, 128, r=12, fill=NAVY)
    txt(d, right_x + 40, top + 112, "오늘의 작업", 10, "b", (147, 197, 253), anchor="lm")
    txt(d, right_x + 40, top + 138, "₩2,684,000", 22, "xb", WHITE)
    txt(d, right_x + 40, top + 166, "12일 근무 · 목표 78%", 9.5, "m", (148, 163, 184))
    rr(d, right_x + 40, top + 186, 340, 9, r=4, fill=(30, 41, 59))
    rr(d, right_x + 40, top + 186, 265, 9, r=4, fill=(34, 197, 94))
    # 퀵액션
    for i, (ic, lb) in enumerate([("🧮", "임금"), ("📅", "일지"), ("🚢", "선박"), ("🏗️", "터미널")]):
        x = right_x + 22 + i * 97
        rr(d, x, top + 232, 88, 78, r=11, fill=WHITE, outline=(203, 213, 225))
        txt(d, x + 44, top + 258, ic, 16, "r", TEXT, anchor="mm")
        txt(d, x + 44, top + 288, lb, 10, "b", TEXT, anchor="mm")
    # 입항 칩
    txt(d, right_x + 38, top + 330, "오늘 입항 · HJNC", 11, "xb", TEXT, anchor="lm")
    for i, (n, hot) in enumerate([("한진 뉴욕 · 21:00", True), ("MSC 이스탄불 · 23:30", False)]):
        ry = top + 350 + i * 52
        rr(d, right_x + 22, ry, 376, 44, r=10, fill=WHITE, outline=(245, 158, 11) if hot else (203, 213, 225), width=1.5 if hot else 1)
        txt(d, right_x + 38, ry + 22, n, 11, "b", TEXT, anchor="lm")
        if hot:
            txt(d, right_x + 382, ry + 22, "바로입력", 9, "b", (153, 27, 27), anchor="rm")
    # 공지
    rr(d, right_x + 22, top + 462, 376, 36, r=9, fill=(239, 246, 255), outline=(147, 197, 253))
    txt(d, right_x + 38, top + 480, "📢 새 시급 기준 반영 완료 · 자세히 ›", 9.5, "b", (29, 78, 216), anchor="lm")
    # 탭바
    rr(d, right_x + 22, top + 520, 376, 62, r=12, fill=WHITE, outline=(203, 213, 225))
    for i, (ic, lb) in enumerate([("🏠", "홈"), ("📅", "근무"), ("🚢", "선박"), ("🏗️", "터미널"), ("⋯", "더보기")]):
        cx = right_x + 22 + 37 + i * 75
        col = NAVY if i == 0 else SUB
        txt(d, cx, top + 542, ic, 13, "r", col, anchor="mm")
        txt(d, cx, top + 566, lb, 8.5, "b" if i == 0 else "m", col, anchor="mm")
    # FAB
    rr(d, right_x + 310, top + 600, 74, 74, r=37, fill=EMER)
    txt(d, right_x + 347, top + 637, "＋", 30, "xb", WHITE, anchor="mm")
    txt(d, right_x + 210, top + ph - 34, "1~2탭 핵심 도달 · 나머지는 탭 분리", 11.5, "b", (4, 120, 87), anchor="mm")

    # 가운데 개선 화살표 + 지표
    mid_x = 560
    metrics = [
        ("핵심 기능 도달", "4~5회 스와이프", "1~2탭"),
        ("홈 카드 수", "12개 + 터미널 3", "3단계 위계"),
        ("하단 내비", "4개 (홈=스크롤↑)", "5개 (상시 화면 전환)"),
        ("목표: 입력 완료 시간", "3분 30초", "2분 이내"),
    ]
    my = top + 120
    for t, a, b in metrics:
        rr(d, mid_x, my, 520, 120, r=14, fill=WHITE, outline=(203, 213, 225), width=1.6)
        txt(d, mid_x + 260, my + 28, t, 13, "xb", TEXT, anchor="mm")
        txt(d, mid_x + 140, my + 66, a, 13, "b", (153, 27, 27), anchor="mm")
        txt(d, mid_x + 260, my + 66, "→", 18, "xb", (37, 99, 235), anchor="mm")
        txt(d, mid_x + 390, my + 66, b, 13, "b", (4, 120, 87), anchor="mm")
        txt(d, mid_x + 260, my + 96, "※ 목표 지표·예시", 9, "m", SUB, anchor="mm")
        my += 150

    img.save(os.path.join(OUT, "compare-01-current-vs-mockup.png"))


if __name__ == "__main__":
    current_01()
    current_02()
    current_03()
    current_04()
    current_05()
    mockup_01()
    mockup_02()
    mockup_03()
    compare_01()
    for f in sorted(os.listdir(OUT)):
        if f.endswith(".png"):
            print(f)
