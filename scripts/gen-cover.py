#!/usr/bin/env python3
"""Generate Bilibili Toy 4:3 poster (1200x900) and square icon (512x512)."""

from __future__ import annotations

import math
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RELEASE = ROOT / "release"
RELEASE.mkdir(parents=True, exist_ok=True)


def pick_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def vertical_gradient(w: int, h: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    base = Image.new("RGBA", (w, h))
    px = base.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b, 255)
    return base


def add_glow(base: Image.Image, cx: int, cy: int, radius: int, color: tuple[int, int, int, int]) -> Image.Image:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(radius=radius // 2))
    return Image.alpha_composite(base, layer)


def generate_poster() -> Path:
    w, h = 1200, 900
    img = vertical_gradient(w, h, (6, 10, 24), (17, 29, 58))
    img = add_glow(img, 320, 310, 320, (72, 138, 255, 95))
    img = add_glow(img, 920, 620, 340, (168, 85, 247, 80))
    img = add_glow(img, 600, 450, 220, (56, 189, 248, 70))

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 窗外散景微光点
    bokeh = [
        (165, 210, 38, (251, 191, 36, 36)),
        (250, 650, 52, (96, 165, 250, 34)),
        (1010, 220, 44, (192, 132, 252, 42)),
        (960, 720, 58, (34, 211, 238, 30)),
        (1080, 470, 30, (251, 146, 60, 38)),
    ]
    for bx, by, br, bc in bokeh:
        draw.ellipse((bx - br, by - br, bx + br, by + br), fill=bc)

    # 玻璃雨痕斜线
    for i in range(44):
        rx = (i * 97 + 35) % (w - 40) + 20
        ry = (i * 151 + 20) % (h - 120) + 20
        length = 34 + (i % 5) * 18
        alpha = 45 + (i % 4) * 28
        draw.line((rx, ry, rx - int(length * 0.14), ry + length), fill=(195, 225, 255, alpha), width=2)

    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=1))
    img = Image.alpha_composite(img, overlay)

    # 清晰中心声波同心环 + 磨砂卡片
    fg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)

    cx, cy = w // 2, 415
    for idx, r in enumerate((195, 248, 305, 365)):
        alpha = 115 - idx * 24
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(125, 211, 252, alpha), width=2)

    # 居中悬浮主玻璃卡片
    card = (160, 175, 1040, 725)
    d.rounded_rectangle(card, radius=38, fill=(10, 15, 30, 196), outline=(255, 255, 255, 48), width=2)

    # 顶部小标签（按实际文字宽度自适应胶囊尺寸）
    f_tag = pick_font(22, bold=True)
    tag_text = "WEBAUDIO · BINAURAL"
    tag_w = int(d.textlength(tag_text, font=f_tag)) + 52
    d.rounded_rectangle((220, 232, 220 + tag_w, 276), radius=22, fill=(96, 165, 250, 48), outline=(147, 197, 253, 120), width=1)
    d.text((246, 240), tag_text, font=f_tag, fill=(191, 219, 254, 245))

    # 主标题与副标题
    f_title = pick_font(86, bold=True)
    f_sub = pick_font(34, bold=False)
    f_chip = pick_font(24, bold=True)
    d.text((220, 305), "静界 · AuraSpace", font=f_title, fill=(248, 250, 252, 255))
    d.text((222, 422), "8 路程序化空间白噪音  ×  双耳节拍脑波混音工坊", font=f_sub, fill=(203, 213, 225, 230))

    # 底部声波均衡条 + 特性胶囊
    bars = [26, 48, 72, 54, 88, 64, 42, 76, 94, 62, 40, 58, 82, 46, 30]
    bx0 = 224
    by0 = 615
    for i, bh in enumerate(bars):
        x = bx0 + i * 24
        color = (110, 168, 254, 220) if i % 2 == 0 else (192, 132, 252, 220)
        d.rounded_rectangle((x, by0 - bh, x + 13, by0), radius=6, fill=color)

    chips = ["雨夜窗景", "40Hz 专注", "2.5Hz 深睡", "颂钵番茄钟"]
    cx_pos = 222
    for ch in chips:
        tw = int(d.textlength(ch, font=f_chip)) + 36
        d.rounded_rectangle((cx_pos, 640, cx_pos + tw, 684), radius=22, fill=(255, 255, 255, 20), outline=(255, 255, 255, 42), width=1)
        d.text((cx_pos + 18, 648), ch, font=f_chip, fill=(241, 245, 249, 235))
        cx_pos += tw + 14

    # 右下角共振圆点徽标
    for ring_r in (26, 48, 70):
        d.ellipse((930 - ring_r, 575 - ring_r, 930 + ring_r, 575 + ring_r), outline=(56, 189, 248, 160), width=3)
    d.ellipse((916, 561, 944, 589), fill=(125, 211, 252, 255))

    out = Image.alpha_composite(img, fg).convert("RGB")
    out_path = RELEASE / "poster.png"
    out.save(out_path, format="PNG", optimize=True)
    return out_path


def generate_icon() -> Path:
    s = 512
    img = vertical_gradient(s, s, (8, 13, 32), (24, 38, 78))
    img = add_glow(img, 256, 256, 180, (96, 165, 250, 120))
    img = add_glow(img, 310, 210, 120, (192, 132, 252, 95))

    fg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)

    cx, cy = 256, 256
    for idx, (r, w) in enumerate([(176, 4), (132, 5), (88, 6)]):
        alpha = 120 + idx * 45
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(147, 197, 253, alpha), width=w)

    # 居中声波脉冲条
    heights = [46, 92, 138, 96, 52]
    for i, bh in enumerate(heights):
        x = cx - 64 + i * 28
        d.rounded_rectangle((x, cy - bh // 2, x + 16, cy + bh // 2), radius=8, fill=(248, 250, 252, 245))

    out = Image.alpha_composite(img, fg).convert("RGB")
    out_path = RELEASE / "icon.png"
    out.save(out_path, format="PNG", optimize=True)
    return out_path


if __name__ == "__main__":
    p = generate_poster()
    ic = generate_icon()
    print(f"Generated {p} ({p.stat().st_size} bytes)")
    print(f"Generated {ic} ({ic.stat().st_size} bytes)")
