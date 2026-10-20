#!/usr/bin/env python3
"""Alpha 33: selective canopy/needle illumination and earth detail, offline Draft QA.

Masks come from the ORIGINAL editable near-source SVG paths, not rectangles.
Starts from separately generated Alpha32 RGBA; never changes alpha, silhouette,
repeat edges or shipped game assets. An algorithmic study, NOT approved artwork.
"""
from __future__ import annotations

import hashlib
import io
import json
import random
import xml.etree.ElementTree as ET
from pathlib import Path

import cairosvg
from PIL import Image, ImageChops, ImageDraw

W, H, QUIET = 1600, 1000, 40
SEEDS = {"warm": 330119, "slate": 330527}
SVG_NS = "{http://www.w3.org/2000/svg}"


def editable_geometry(path: Path):
    root = ET.fromstring(path.read_bytes())
    if root.attrib.get("viewBox") != "0 0 3200 2000":
        raise ValueError("Unexpected original editable master dimensions")
    crowns = []
    for g in root.iter():
        if "data-tree" not in g.attrib:
            continue
        shapes = [p for p in g.iter() if p.attrib.get("data-foliage") == "primary"]
        if len(shapes) != 1:
            raise ValueError("Each original tree must have one authored crown path")
        crowns.append((g.attrib.get("data-species", ""), shapes[0].attrib["d"]))
    clips = [p for p in root.iter()
             if p.tag == SVG_NS + "clipPath" and
             p.attrib.get("id") == "foreground-ground-clip"]
    if len(crowns) != 11 or len(clips) != 1:
        raise ValueError("Missing original geometry / repeat-safe ground mask")
    ground = [p.attrib["d"] for p in clips[0] if p.tag == SVG_NS + "path"]
    if len(ground) != 1:
        raise ValueError("Missing original ground ridge path")
    return crowns, ground[0]


def path_mask(d: str):
    # Only the original source d attribute is used. Its path grammar doesn't
    # reference external assets, paint servers or foreignObject.
    source = ('<svg xmlns="http://www.w3.org/2000/svg" width="3200" '
              'height="2000" viewBox="0 0 3200 2000">'
              '<path fill="#ffffff" d="' + d + '"/></svg>')
    data = cairosvg.svg2png(bytestring=source.encode("utf-8"),
                            output_width=W, output_height=H)
    return Image.open(io.BytesIO(data)).convert("RGBA").getchannel("A")


def limit_mask(mask: Image.Image, original_alpha: Image.Image):
    permitted = ImageChops.multiply(mask, original_alpha)
    # Pixel-identical wrap edges; smoothing tapers have already been handled
    # by earlier stages, so no artist strokes can enter the outer 40 columns.
    permitted.paste(0, (0, 0, QUIET, H))
    permitted.paste(0, (W - QUIET, 0, W, H))
    return permitted


def masked_layer(paint: Image.Image, mask: Image.Image):
    paint.putalpha(ImageChops.multiply(paint.getchannel("A"), mask))
    return paint


def paint_study(source: Path, alpha32: Path, theme: str, output: Path):
    if theme not in SEEDS:
        raise ValueError("Unknown landscape")
    crowns, ridge = editable_geometry(source)
    before = Image.open(alpha32).convert("RGBA")
    if before.size != (W, H):
        raise ValueError("Alpha32 dimensions mismatch")
    rng = random.Random(SEEDS[theme])
    original_alpha = before.getchannel("A")
    result = before.copy()
    species_counts = {}
    eligible = 0
    applied_strokes = 0

    # Lit and occluded marks alternate within ACTUAL source crown silhouettes.
    # Species have different mark direction and size; the patterned field is
    # intentionally spatially heterogeneous, avoiding 11 identical crowns.
    if theme == "warm":
        light = [(185, 205, 151, 47), (210, 192, 142, 40),
                 (146, 178, 133, 38)]
        shadow = [(21, 57, 45, 51), (49, 83, 63, 38)]
    else:
        light = [(147, 177, 195, 46), (126, 153, 180, 50),
                 (165, 173, 184, 31)]
        shadow = [(14, 40, 67, 48), (35, 64, 89, 44)]

    for tree_index, (species, d) in enumerate(crowns):
        silhouette = limit_mask(path_mask(d), original_alpha)
        bbox = silhouette.getbbox()
        if bbox is None:
            raise AssertionError("Original source tree disappeared when rasterized")
        x0, y0, x1, y1 = bbox
        if x1 - x0 < 9 or y1 - y0 < 15:
            raise AssertionError("Malformed source tree silhouette")
        eligible += 1
        variant_rng = random.Random(SEEDS[theme] + 7919 * (tree_index + 1))
        tint = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        brush = ImageDraw.Draw(tint, "RGBA")
        # Warm willow gets hanging, vertically slanted brush marks, oak broad
        # separated leaf facets, birch narrow dashes; blue-hour fir receives
        # fine needles, spruce split asymmetrical diagonals, larch airy twigs.
        if theme == "warm":
            count = 195 + tree_index % 4 * 29
        else:
            count = 215 + tree_index % 3 * 37
        species_counts[species] = species_counts.get(species, 0) + 1
        for n in range(count):
            x = variant_rng.uniform(x0 + 2, x1 - 2)
            y = variant_rng.uniform(y0 + 2, y1 - 2)
            if silhouette.getpixel((int(x), int(y))) < 180:
                continue
            # Warm sunlight from upper-left, blue-hour moon rim from right:
            # per-species and per-tree value variation prevents flat clipart.
            fraction_x = (x - x0) / max(1, x1 - x0)
            fraction_y = (y - y0) / max(1, y1 - y0)
            lit = (fraction_x < .59 and fraction_y < .70) if theme == "warm" else (
                fraction_x > .43 and fraction_y < .78)
            base_color = light[(n + tree_index) % len(light)] if lit else shadow[(n + tree_index) % len(shadow)]
            amp = 0.58 + (tree_index % 4) * .085
            rgb = base_color[:3]
            color = (*rgb, int(base_color[3] * amp))
            if species == "willow":
                dx, dy = variant_rng.uniform(-5, 0), variant_rng.uniform(7, 21)
            elif species == "birch":
                dx, dy = variant_rng.uniform(-11, -3), variant_rng.uniform(2, 7)
            elif species == "oak":
                dx, dy = variant_rng.uniform(6, 18), variant_rng.uniform(-5, 3)
            elif species == "alder":
                dx, dy = variant_rng.uniform(-9, 9), variant_rng.uniform(2, 8)
            elif species == "spruce":
                dx, dy = (variant_rng.choice((-1, 1)) * variant_rng.uniform(11, 23),
                          variant_rng.uniform(4, 11))
            elif species == "larch":
                dx, dy = (variant_rng.choice((-1, 1)) * variant_rng.uniform(6, 15),
                          variant_rng.uniform(4, 9))
            else:
                dx, dy = (variant_rng.choice((-1, 1)) * variant_rng.uniform(9, 18),
                          variant_rng.uniform(5, 15))
            brush.line((int(x), int(y), int(x + dx), int(y + dy)),
                       fill=color, width=3 if n % 5 else 4)
            # Rare small leaf stipples; no full opaque blobs.
            if theme == "warm" and n % 13 == 0:
                r = variant_rng.randint(2, 4)
                brush.ellipse((x - r, y - 2, x + r, y + 2),
                              fill=(rgb[0], rgb[1], rgb[2], 30))
            applied_strokes += 1
        result = Image.alpha_composite(result, masked_layer(tint, silhouette))

    # Contour-following floor detail, explicitly masked to the source ridge.
    soil_mask = limit_mask(path_mask(ridge), original_alpha)
    soil_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    brush = ImageDraw.Draw(soil_layer, "RGBA")
    earth = ([(185, 164, 114, 29), (66, 111, 85, 29),
              (30, 69, 57, 42)] if theme == "warm" else
             [(118, 149, 163, 30), (28, 72, 99, 37),
              (16, 41, 65, 48)])
    soil_strokes = 0
    for n in range(940):
        x = rng.uniform(QUIET + 6, W - QUIET - 90)
        y = rng.uniform(760 if theme == "warm" else 785, 979)
        length = rng.uniform(12, 72)
        # Gentle wind-oriented ground contours, with broken lengths.
        color = earth[(n + (int(y) // 19)) % len(earth)]
        brush.line((int(x), int(y), int(x + length), int(y + rng.uniform(-2.7, 2.7))),
                   fill=color, width=2 if n % 3 else 4)
        if n % 7 == 0:
            brush.line((int(x + length * .28), int(y + 4),
                        int(x + length * .65), int(y + 3)),
                       fill=(color[0], color[1], color[2], 18), width=2)
        soil_strokes += 1
    result = Image.alpha_composite(result, masked_layer(soil_layer, soil_mask))
    result.putalpha(original_alpha)
    raw_before, raw_after = before.tobytes(), result.tobytes()
    if result.getchannel("A").tobytes() != original_alpha.tobytes():
        raise AssertionError("Source alpha must remain byte-identical")
    if result.getbbox() != before.getbbox():
        raise AssertionError("Geometry / alpha bounds moved")
    for y in range(H):
        row_start = y * W * 4
        for a, b in ((row_start, row_start + QUIET * 4),
                     (row_start + (W - QUIET) * 4, row_start + W * 4)):
            if raw_before[a:b] != raw_after[a:b]:
                raise AssertionError("Alpha33 changed a horizontal repeat border")
    changed = 0
    delta = 0
    for i in range(0, len(raw_before), 4):
        if raw_before[i + 3] and raw_before[i:i + 3] != raw_after[i:i + 3]:
            changed += 1
            delta += sum(abs(raw_before[i + k] - raw_after[i + k]) for k in range(3))
    if not (5000 <= changed <= 500000 and soil_strokes == 940
            and applied_strokes >= 1000 and eligible == 11):
        raise AssertionError(f"Insufficient or excessive material detail: {theme}, {changed=}, {applied_strokes=}")
    output.parent.mkdir(parents=True, exist_ok=True)
    result.save(output, "PNG", optimize=True, compress_level=9)
    data = output.read_bytes()
    if not (10000 <= len(data) <= 4_000_000):
        raise AssertionError("Invalid RGBA export budget")
    return {"theme": theme, "source_original_master": str(source),
            "alpha32_baseline": str(alpha32), "raster_study": str(output),
            "dimensions": [W, H], "mode": "RGBA", "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "source_tree_paths_clipped": eligible, "species": species_counts,
            "canopy_strokes_drawn": applied_strokes, "ridge_masked_soil_strokes": soil_strokes,
            "visible_pixels_changed_from_alpha32": changed,
            "average_rgb_channel_delta_per_changed_pixel": round(delta / (3 * changed), 3),
            "repeat_border_identical_px": QUIET, "source_alpha_byte_identical": True,
            "game_asset_replaced": False, "approved_final_art": False}


def main():
    root = Path(__file__).resolve().parent.parent
    results = []
    for theme in ("warm", "slate"):
        original = root / f"flappy/assets/v4/masters/{theme}/near-master-pilot.svg"
        baseline = root / f"flappy/assets/v4/pilot/{theme}/near-raster-alpha32.png"
        target = root / f"flappy/assets/v4/pilot/{theme}/near-raster-alpha33.png"
        results.append(paint_study(original, baseline, theme, target))
    metrics = root / "v4-art-qa"
    metrics.mkdir(exist_ok=True)
    (metrics / "alpha33-local-material-metrics.json").write_text(
        json.dumps({"status": "DRAFT_MASKED_MATERIAL_STUDY_NOT_FINAL_ART",
                    "technique": "original-source path-clipped species texture and ridge earth",
                    "assets": results}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8")
    for result in results:
        print("ALPHA33 MASKED ORIGINAL", result)


if __name__ == "__main__":
    main()
