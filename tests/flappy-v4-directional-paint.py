#!/usr/bin/env python3
"""Alpha 32: deterministic, geometry-guided foreground brush study.

Draft-art QA only. Independently rasterizes the editable Alpha 30 master,
NOT the Alpha 31 random pigment pixels. Directional leaf, needle, bark and
ground brushwork is intentionally a reproducible *study*, not human-approved
hand-painted original production art. No runtime assets are replaced.
"""
from __future__ import annotations

import hashlib
import io
import json
import random
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import cairosvg
from PIL import Image, ImageChops, ImageDraw


WIDTH, HEIGHT = 1600, 1000
SEEDS = {"warm": 321220, "slate": 321221}
BORDER = 40


def first_xy(path):
    match = re.search(r"\bM\s*(-?[\d.]+)[ ,]+(-?[\d.]+)", path.attrib["d"])
    if match is None:
        raise ValueError("Tree geometry missing first coordinate")
    return float(match.group(1)) / 2, float(match.group(2)) / 2


def get_tree_guides(svg):
    root = ET.fromstring(svg)
    trees = []
    for group in root.findall(".//*[@data-tree]"):
        trunk = group.find(".//*[@data-wood='trunk']")
        foliage = group.find(".//*[@data-foliage='primary']")
        if trunk is None or foliage is None:
            raise ValueError("A foreground tree must have trunk and foliage geometry")
        center, _ = first_xy(trunk)
        _, crown_y = first_xy(foliage)
        trees.append((center + 2.5, crown_y, group.attrib.get("data-species", "")))
    if len(trees) != 11 or len(set(round(x) for x, _, _ in trees)) != 11:
        raise ValueError("Expected 11 independently positioned editable trees")
    return trees


def paint_master(master: Path, theme: str, destination: Path):
    if theme not in SEEDS:
        raise ValueError("Unknown art theme")
    svg = master.read_bytes()
    if not 1000 <= len(svg) <= 100_000:
        raise ValueError("Unexpected master size")
    guides = get_tree_guides(svg)
    original_png = cairosvg.svg2png(bytestring=svg, output_width=WIDTH, output_height=HEIGHT)
    base = Image.open(io.BytesIO(original_png)).convert("RGBA")
    if base.size != (WIDTH, HEIGHT):
        raise ValueError("Source raster size mismatch")
    rng = random.Random(SEEDS[theme])
    ink = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(ink, "RGBA")
    counts = {"foliage": 0, "bark": 0, "ground": 0}
    if theme == "warm":
        leaf_palette = [(154, 181, 135, 41), (183, 190, 139, 31),
                        (24, 67, 55, 30), (198, 184, 132, 23)]
        bark_palette = [(189, 185, 137, 45), (22, 53, 47, 45)]
        earth_palette = [(160, 153, 107, 20), (56, 99, 73, 35),
                         (189, 171, 123, 19)]
    else:
        leaf_palette = [(129, 164, 181, 42), (53, 99, 123, 42),
                        (167, 174, 178, 23), (16, 45, 70, 35)]
        bark_palette = [(153, 165, 172, 35), (12, 35, 57, 52)]
        earth_palette = [(110, 139, 157, 32), (17, 46, 68, 40),
                         (150, 152, 149, 20)]

    # Artist-guided direction fields: broadleaf veining is short and tilted;
    # conifer needles follow opposing diagonals rather than round blotches.
    for index, (center, crown_y, species) in enumerate(guides):
        spread = (42 if theme == "warm" else 30) + (index % 3) * 9
        for j in range(135 if theme == "warm" else 160):
            x = center + rng.uniform(-spread, spread)
            y = crown_y + rng.uniform(-28, 52 if theme == "warm" else 75)
            if not (BORDER + 4 < x < WIDTH - BORDER - 4 and 615 < y < 781):
                continue
            length = rng.uniform(7, 18 if theme == "warm" else 23)
            lean = (-1 if (j + index) % 2 else 1)
            dx = (0.63 if theme == "warm" else 0.88) * length * lean
            dy = (0.45 if theme == "warm" else 0.55) * length
            color = leaf_palette[(j + index) % len(leaf_palette)]
            draw.line((round(x), round(y), round(x + dx), round(y + dy)),
                      fill=color, width=2 if j % 4 else 3)
            counts["foliage"] += 1
        # Sparse vertical trunk grain; strokes intentionally distinct from
        # foliage/ground directions and do not change silhouettes.
        for j in range(24):
            x = center + rng.uniform(-2.2, 3.5)
            y = crown_y + rng.uniform(40, 115)
            if BORDER < x < WIDTH - BORDER and 650 < y < 795:
                draw.line((round(x), round(y), round(x + rng.uniform(-1, 1)),
                           round(y + rng.uniform(8, 23))),
                          fill=bark_palette[j % len(bark_palette)], width=1)
                counts["bark"] += 1

    # Horizontal ground dry-brush ribbons: layered, restrained and directionally
    # coherent, not a second isotropic noise field. Inset protects tile joins.
    for j in range(850):
        x = rng.uniform(BORDER + 6, WIDTH - BORDER - 90)
        y = rng.uniform(763 if theme == "warm" else 792, HEIGHT - 9)
        span = rng.uniform(12, 70)
        incline = rng.uniform(-1.8, 1.8)
        draw.line((round(x), round(y), round(x + span), round(y + incline)),
                  fill=earth_palette[j % len(earth_palette)],
                  width=1 if j % 3 else 3)
        counts["ground"] += 1

    # Original master alpha is the authority. Brushwork may alter RGB only
    # where the SVG was already visible; NEVER add sky pixels or alter hitboxes.
    alpha = base.getchannel("A")
    ink_alpha = ImageChops.multiply(ink.getchannel("A"), alpha)
    ink.putalpha(ink_alpha)
    composite = Image.alpha_composite(base, ink)
    composite.putalpha(alpha)
    if composite.getchannel("A").tobytes() != alpha.tobytes():
        raise AssertionError("Alpha channel changed")
    if composite.getbbox() != base.getbbox():
        raise AssertionError("Alpha bounding box changed")
    old, new = base.tobytes(), composite.tobytes()
    changed = sum(1 for i in range(0, len(old), 4)
                  if old[i:i + 3] != new[i:i + 3] and old[i + 3] > 0)
    if changed < 1200:
        raise AssertionError(f"Directional painting too subtle: {changed}")
    for y in range(HEIGHT):
        start = y * WIDTH * 4
        for left, right in ((start, start + BORDER * 4),
                            (start + (WIDTH - BORDER) * 4, start + WIDTH * 4)):
            if old[left:right] != new[left:right]:
                raise AssertionError("Repeat-edge pixels changed")
    if not (counts["foliage"] >= 1000 and counts["bark"] >= 100
            and counts["ground"] == 850):
        raise AssertionError("Directional material stroke coverage insufficient")
    destination.parent.mkdir(parents=True, exist_ok=True)
    composite.save(destination, format="PNG", optimize=True, compress_level=9)
    encoded = destination.read_bytes()
    if len(encoded) > 4_000_000:
        raise AssertionError("Mobile QA texture exceeded 4MB budget")
    return {"theme": theme, "source_master": str(master),
            "raster_asset": str(destination), "width": WIDTH, "height": HEIGHT,
            "mode": "RGBA", "seed": SEEDS[theme], "bytes": len(encoded),
            "sha256": hashlib.sha256(encoded).hexdigest(),
            "tree_guides": len(guides), "strokes": counts,
            "changed_visible_pixel_count": changed,
            "source_alpha_preserved": True, "source_repeat_border_px": BORDER,
            "material_directions": {"foliage": "leaf-diagonal" if theme == "warm"
                                    else "paired-needle-diagonals",
                                    "bark": "vertical", "earth": "horizontal"},
            "production_art_approved": False, "live_asset_substituted": False}


def main():
    root = Path(__file__).resolve().parent.parent
    reports = []
    for theme in ("warm", "slate"):
        master = root / f"flappy/assets/v4/masters/{theme}/near-master-pilot.svg"
        dest = root / f"flappy/assets/v4/pilot/{theme}/near-raster-alpha32.png"
        reports.append(paint_master(master, theme, dest))
    output = root / "v4-art-qa"
    output.mkdir(parents=True, exist_ok=True)
    (output / "alpha32-directional-paint-metrics.json").write_text(
        json.dumps({"status": "DRAFT_DIRECTED_BRUSH_STUDY_NOT_FINAL",
                    "method": "fresh original SVG raster + separate material-angle strokes",
                    "assets": reports}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    for report in reports:
        print("ALPHA32 DIRECTIONAL BRUSH", report)


if __name__ == "__main__":
    main()
