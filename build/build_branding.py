#!/usr/bin/env python3
"""
Rokar POS - official branding assets.

Turns the supplied brand artwork into every format the app, the installer and
the website need:

  build/icon.ico                       multi-resolution Windows icon
                                         (16, 24, 32, 48, 64, 128, 256)
  build/icon-source.png                the 1024 square app icon (source of truth)
  src/renderer/src/assets/rokar-sidebar-icon.png
                                         the square mark for the sidebar
  src/renderer/src/assets/rokar-pos-logo-light.png
                                         horizontal lockup for LIGHT surfaces
  src/renderer/src/assets/rokar-pos-logo-dark.png
                                         horizontal lockup for DARK surfaces
  src/renderer/public/favicon.ico      the renderer favicon (+ PNG sizes)

The artwork is NEVER redrawn or recoloured: the script only crops the supplied
PNGs and turns the near-white page background into transparency (a flood fill
from the image border, so the white detail inside the green mark survives).

Usage:
    python build/build_branding.py                     # write into this repo
    python build/build_branding.py --site <path>       # also write the site assets
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from collections import deque

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SOURCE_DIR = os.path.join(REPO, "assets", "branding", "source")

SRC_LOGO_VARIATIONS = "01-RokarPOS-Logo-Variations.png"
SRC_APP_ICON = "02-RokarPOS-Windows-App-Icon-1024x1024.png"
SRC_HORIZONTAL = "03-RokarPOS-Horizontal-Logo-Light-and-Dark.png"

ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

# The page background the artwork was exported on (near-white). Everything
# connected to the border within this tolerance becomes transparent.
BG_LEVEL = 235
BG_TOLERANCE = 14


def is_background(px: tuple[int, int, int]) -> bool:
    r, g, b = px[:3]
    if min(r, g, b) < BG_LEVEL:
        return False
    return (max(r, g, b) - min(r, g, b)) <= BG_TOLERANCE


def is_brand_green(px: tuple[int, int, int]) -> bool:
    """The emerald plate of the dark lockup (#01563F-ish artwork green)."""
    r, g, b = px[:3]
    return g > 40 and g < 130 and r < 70 and b < 100 and g > r + 30


def is_light_art(px: tuple[int, int, int]) -> bool:
    """The white / gold artwork of the dark lockup."""
    r, g, b = px[:3]
    # gold #F5B301 (and its lighter blends)
    if r > 170 and 110 < g < 225 and b < 130 and r > b + 90:
        return True
    # white / very light grey
    return min(r, g, b) >= 165 and (max(r, g, b) - min(r, g, b)) <= 40


def key_out(im: Image.Image, keep) -> Image.Image:
    """Keep only the pixels `keep` accepts; everything else becomes transparent."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not keep((r, g, b)):
                px[x, y] = (r, g, b, 0)
    return im


def flood_out(
    im: Image.Image, match, alpha: int = 0
) -> Image.Image:
    """Make every border-connected pixel that `match` accepts transparent."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        idx = y * w + x
        if seen[idx]:
            return
        if not match(px[x, y]):
            return
        seen[idx] = 1
        q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        px[x, y] = (px[x, y][0], px[x, y][1], px[x, y][2], alpha)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny)
    return im


def make_page_transparent(im: Image.Image) -> Image.Image:
    """Flood fill the near-white page background from the border outwards."""
    return flood_out(im, is_background)


def trim(im: Image.Image, pad: int = 0) -> Image.Image:
    """Crop to the visible content (plus an optional padding)."""
    bbox = im.getbbox()
    if not bbox:
        return im
    left, top, right, bottom = bbox
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(im.size[0], right + pad)
    bottom = min(im.size[1], bottom + pad)
    return im.crop((left, top, right, bottom))


def load(name: str) -> Image.Image:
    path = os.path.join(SOURCE_DIR, name)
    if not os.path.exists(path):
        raise SystemExit(
            f"brand source missing: {path}\n"
            "Copy the three supplied PNGs into assets/branding/source/ first."
        )
    return Image.open(path)


def write(img: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print(f"  wrote {os.path.relpath(path, REPO)} ({img.size[0]}x{img.size[1]})")


def build_app_icon() -> Image.Image:
    """The square app icon with transparent corners (the artwork as supplied)."""
    icon = make_page_transparent(load(SRC_APP_ICON))
    return icon


def build_horizontal() -> tuple[Image.Image, Image.Image, Image.Image]:
    """(light lockup, white lockup for dark surfaces, white mark for the sidebar)."""
    art = load(SRC_HORIZONTAL).convert("RGB")
    w, h = art.size
    light = make_page_transparent(art.crop((0, 0, w, h // 2)))
    dark_raw = art.crop((0, h // 2, w, h))
    dark_plate = make_page_transparent(dark_raw)
    # On a dark green surface the green plate would disappear, so the WHITE
    # artwork is used on its own (the supplied artwork, just without the plate).
    white_lockup = key_out(dark_raw, is_light_art)
    mark = trim(crop_mark(white_lockup))
    return trim(light), trim(white_lockup), mark


def crop_mark(im: Image.Image) -> Image.Image:
    """Cut the standalone R mark (left of the divider) out of the lockup."""
    a = im.getchannel("A")
    w, h = im.size
    px = a.load()
    cols = [any(px[x, y] > 0 for y in range(0, h, 4)) for x in range(w)]
    # Find the first empty gap after the mark (the divider sits in it).
    gap = None
    run = 0
    for x in range(int(w * 0.08), w):
        if not cols[x]:
            run += 1
            if run >= 12:
                gap = x - run
                break
        else:
            run = 0
    if gap is None:
        gap = int(w * 0.26)
    return im.crop((0, 0, gap, im.size[1]))


def save_ico(img: Image.Image, path: str, sizes=ICO_SIZES) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, format="ICO", sizes=sizes)
    print(f"  wrote {os.path.relpath(path, REPO)} (ico {', '.join(str(s[0]) for s in sizes)})")


def build(site_dir: str | None) -> None:
    print("Rokar POS branding")

    icon = build_app_icon()
    light, dark, mark = build_horizontal()

    # ── Windows app + installer ────────────────────────────────────────────
    write(icon, os.path.join(REPO, "build", "icon-source.png"))
    save_ico(icon, os.path.join(REPO, "build", "icon.ico"))

    # ── Renderer assets ─────────────────────────────────────────────────────
    assets = os.path.join(REPO, "src", "renderer", "src", "assets")
    # The sidebar shows the mark at 32px - ship a 256px PNG, not the 1024 source.
    icon.resize((256, 256), Image.LANCZOS).save(os.path.join(assets, "rokar-sidebar-icon.png"))
    print(f"  wrote src\\renderer\\src\\assets\\rokar-sidebar-icon.png (256x256)")
    write(light, os.path.join(assets, "rokar-pos-logo-light.png"))
    write(dark, os.path.join(assets, "rokar-pos-logo-dark.png"))
    write(mark, os.path.join(assets, "rokar-pos-mark-dark.png"))

    # ── Renderer favicon ────────────────────────────────────────────────────
    public = os.path.join(REPO, "src", "renderer", "public")
    save_ico(icon, os.path.join(public, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    for size in (16, 32, 48):
        icon.resize((size, size), Image.LANCZOS).save(os.path.join(public, f"favicon-{size}.png"))
        print(f"  wrote {os.path.relpath(os.path.join(public, f'favicon-{size}.png'), REPO)} ({size}x{size})")

    # ── Website ─────────────────────────────────────────────────────────────
    if site_dir:
        site_public = os.path.join(site_dir, "public")
        # The site header shows the square mark at 40px - a 512px master is
        # plenty (the srcSet serves the 80/160 variants).
        square = trim(icon).resize((512, 512), Image.LANCZOS)
        write(square, os.path.join(site_public, "logo.png"))
        for size in (80, 160):
            square.resize((size, size), Image.LANCZOS).save(os.path.join(site_public, f"logo-{size}.png"))
            print(f"  wrote {os.path.relpath(os.path.join(site_public, f'logo-{size}.png'), REPO)} ({size}x{size})")
        save_ico(icon, os.path.join(site_public, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
        for size in (192, 512):
            icon.resize((size, size), Image.LANCZOS).save(os.path.join(site_public, f"icon-{size}.png"))
            print(f"  wrote {os.path.relpath(os.path.join(site_public, f'icon-{size}.png'), REPO)} ({size}x{size})")
        icon.resize((180, 180), Image.LANCZOS).save(os.path.join(site_public, "apple-touch-icon.png"))
        print(f"  wrote {os.path.relpath(os.path.join(site_public, 'apple-touch-icon.png'), REPO)} (180x180)")
        # An SVG favicon that embeds the supplied PNG - the artwork is reused
        # verbatim instead of being redrawn as vectors.
        import base64

        png = os.path.join(site_public, "icon-192.png")
        with open(png, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">'
            f'<image href="data:image/png;base64,{b64}" width="192" height="192"/>'
            "</svg>"
        )
        with open(os.path.join(site_public, "favicon.svg"), "w", encoding="utf-8") as fh:
            fh.write(svg)
        print(f"  wrote {os.path.relpath(os.path.join(site_public, 'favicon.svg'), REPO)}")

    print("done.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", help="path to the website repo (public/ is updated)")
    args = ap.parse_args()
    build(args.site)
    return 0


if __name__ == "__main__":
    sys.exit(main())
