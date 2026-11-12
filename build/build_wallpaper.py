#!/usr/bin/env python3
"""
Rokar POS - the default wallpaper.

The supplied artwork ("Isometric Fintech Workspace with POS Terminal", a
portrait 1086x1448 illustration) becomes the app's DEFAULT wallpaper: it is
shown on every screen until the owner picks their own in
Admin -> System Settings -> Background Wallpaper.

The artwork is used AS SUPPLIED - never redrawn or recoloured. Because the
source is portrait and a till screen is landscape, the default is a 1920x1080
canvas painted in the artwork's own edge colour with the illustration scaled to
the full canvas height and centred, so the laptop AND the POS terminal stay
completely visible instead of being cropped away by "cover".

Usage:
    python build/build_wallpaper.py
"""
from __future__ import annotations

import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SOURCE = os.path.join(
    REPO, "assets", "wallpaper", "source", "Isometric Fintech Workspace with POS Terminal.png"
)
OUT_DIR = os.path.join(REPO, "src", "renderer", "src", "assets")
OUT_WEBP = os.path.join(OUT_DIR, "wallpaper-default.webp")

CANVAS_W, CANVAS_H = 1920, 1080


def edge_colour(im: Image.Image) -> tuple[int, int, int]:
    """The flat periwinkle the artwork sits on (sampled from its empty area)."""
    samples = [
        im.getpixel((20, 700)),
        im.getpixel((im.size[0] - 20, 700)),
        im.getpixel((im.size[0] // 2, 60)),
    ]
    return tuple(sum(c[i] for c in samples) // len(samples) for i in range(3))  # type: ignore[return-value]


def build() -> None:
    if not os.path.exists(SOURCE):
        raise SystemExit(
            f"wallpaper source missing: {SOURCE}\n"
            "Copy the supplied PNG into assets/wallpaper/source/ first."
        )
    art = Image.open(SOURCE).convert("RGB")

    canvas = Image.new("RGB", (CANVAS_W, CANVAS_H), edge_colour(art))

    # Scale the artwork to the FULL canvas height and centre it: nothing is
    # cropped and the proportions stay exactly as supplied.
    scale = CANVAS_H / art.size[1]
    sized = art.resize((max(1, round(art.size[0] * scale)), CANVAS_H), Image.LANCZOS)
    canvas.paste(sized, ((CANVAS_W - sized.size[0]) // 2, 0))

    os.makedirs(OUT_DIR, exist_ok=True)
    canvas.save(OUT_WEBP, quality=90, method=6)
    print(f"  wrote {os.path.relpath(OUT_WEBP, REPO)} ({canvas.size[0]}x{canvas.size[1]})")
    print(f"  edge colour used: {edge_colour(art)}")


if __name__ == "__main__":
    build()
