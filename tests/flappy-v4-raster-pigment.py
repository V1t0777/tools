#!/usr/bin/env python3
"""Alpha 31: offline, deterministic painted-pigment *study* from editable SVG.

No runtime JS, shaders, API/network calls or game bundle substitutions.
CairoSVG + Pillow are needed in the Draft QA runner only. Not artist-approved art.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import random
from pathlib import Path

import cairosvg
from PIL import Image


WIDTH, HEIGHT = 1600, 1000
SEEDS = {"warm": 30031, "slate": 71931}


def noise_field(width: int, height: int, grid_w: int, grid_h: int, seed: int) -> Image.Image:
    rng = random.Random(seed)
    grid = Image.new("L", (grid_w, grid_h))
    grid.putdata([rng.randrange(54, 203) for _ in range(grid_w * grid_h)])
    return grid.resize((width, height), Image.Resampling.BICUBIC)


def raster_pigment(svg_path: Path, theme: str, target: Path) -> dict:
    if theme not in SEEDS:
        raise ValueError("Unknown art theme")
    svg = svg_path.read_bytes()
    if len(svg) > 100_000:
        raise ValueError("Unexpectedly large source master")
    rendered = cairosvg.svg2png(bytestring=svg, output_width=WIDTH, output_height=HEIGHT)
    base = Image.open(io.BytesIO(rendered)).convert("RGBA")
    if base.size != (WIDTH, HEIGHT):
        raise AssertionError("Source raster geometry mismatch")

    # Macro/mid/fine slow-changing pigments, seeded and stable on every build.
    macro = noise_field(WIDTH, HEIGHT, 26, 18, SEEDS[theme])
    mid = noise_field(WIDTH, HEIGHT, 115, 79, SEEDS[theme] + 1)
    fine = noise_field(WIDTH, HEIGHT, 420, 270, SEEDS[theme] + 2)
    original = base.tobytes()
    p1, p2, p3 = macro.tobytes(), mid.tobytes(), fine.tobytes()
    new = bytearray(original)
    changed = 0
    total = 0
    delta_sum = 0
    transparent = 0
    # 20-pixel seam quiet zone. Never introduce a texture discontinuity
    # across the two neighboring horizontally repeating copies.
    quiet = 20
    color_mix = (0.78, 1.00, 0.73) if theme == "warm" else (0.72, 0.88, 1.00)
    for y in range(HEIGHT):
        for x in range(WIDTH):
            i = y * WIDTH + x
            pos = i * 4
            a = original[pos + 3]
            if a == 0:
                transparent += 1
                continue
            total += 1
            # A smooth taper makes source master, mask and RGB identical
            # in the first/last 20 pixels; no source geometry is modified.
            border = min(x, WIDTH - 1 - x)
            edge = max(0.0, min(1.0, (border - 9) / (quiet - 9)))
            # Preserve very thin transparent/anti-aliased canopy edges.
            coverage = min(1.0, a / 140.0)
            pigment = (p1[i] - 128) * 0.27 + (p2[i] - 128) * 0.11 + (
                p3[i] - 128
            ) * 0.065
            intensity = edge * coverage * pigment
            for channel in range(3):
                v = original[pos + channel]
                adjustment = round(intensity * color_mix[channel])
                value = max(0, min(255, v + adjustment))
                new[pos + channel] = value
                if value != v:
                    changed += 1
                    delta_sum += abs(value - v)
    out = Image.frombytes("RGBA", (WIDTH, HEIGHT), bytes(new))
    assert out.getchannel("A").tobytes() == base.getchannel("A").tobytes()
    assert out.getbbox() == base.getbbox(), "Pigment should not change the alpha bounding box"
    for x in list(range(0, 10)) + list(range(WIDTH - 10, WIDTH)):
        for y in range(0, HEIGHT, 3):
            i = (y * WIDTH + x) * 4
            assert new[i : i + 4] == original[i : i + 4], "Border pixels must be unchanged"

    target.parent.mkdir(parents=True, exist_ok=True)
    out.save(target, format="PNG", optimize=True, compress_level=9)
    encoded = target.read_bytes()
    changed_share = changed / max(1, total * 3)
    mean_delta = delta_sum / max(1, changed)
    if not (0.22 <= changed_share <= 0.95 and 1.0 <= mean_delta <= 22):
        raise AssertionError(
            f"Out-of-range pigment effect: {theme} {changed_share=:.3f} {mean_delta=:.2f}"
        )
    if len(encoded) > 4_000_000:
        raise AssertionError("Single mobile QA texture exceeded 4MB budget")
    return {
        "theme": theme,
        "width": WIDTH,
        "height": HEIGHT,
        "mode": "RGBA",
        "seed": SEEDS[theme],
        "source_master": str(svg_path),
        "raster_asset": str(target),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "bytes": len(encoded),
        "opaque_or_antialiased_pixels": total,
        "transparent_pixels": transparent,
        "changed_channel_share": round(changed_share, 4),
        "mean_changed_channel_delta": round(mean_delta, 3),
        "transparent_alpha_preserved": True,
        "raster_border_quiet_zone_px": quiet,
        "production_art_approved": False,
        "live_asset_substituted": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()
    root = Path(args.repo_root)
    reports = []
    for theme in ("warm", "slate"):
        master = root / f"flappy/assets/v4/masters/{theme}/near-master-pilot.svg"
        target = root / f"flappy/assets/v4/pilot/{theme}/near-raster-alpha31.png"
        reports.append(raster_pigment(master, theme, target))
    evidence = root / "v4-art-qa"
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "alpha31-pigment-study-metrics.json").write_text(
        json.dumps({
            "status": "DRAFT_OFFLINE_RASTER_STUDY_NOT_FINAL_MASTER",
            "dependencies": ["cairosvg==2.8.2", "Pillow==11.3.0"],
            "assets": reports,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for report in reports:
        print("ALPHA31 RASTER", report)


if __name__ == "__main__":
    main()
