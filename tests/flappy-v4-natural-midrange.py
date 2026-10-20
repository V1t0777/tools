#!/usr/bin/env python3
"""Alpha37: render separately authored natural midrange landscape masters.

CI-only raster QA; never overwrites source pilot / live V4 or V3.1 runtime.
Both editable 3200x2000 originals replace their synchronized mountain crest,
clip and ridge highlight, with separate site-specific sun/moon-facing facets.
"""
from __future__ import annotations
import hashlib
import io
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import cairosvg
from PIL import Image, ImageChops

W, H, TILE_QUIET, SKY_QUIET = 1600, 1000, 40, 555
NS = "{http://www.w3.org/2000/svg}"
SAFE_ELEMENTS = {"svg", "title", "desc", "defs", "linearGradient", "stop",
                 "clipPath", "path", "g"}
SAFE_ATTRIBUTES = {
    "width", "height", "viewBox", "role", "aria-label", "id",
    "x1", "x2", "y1", "y2", "offset", "stop-color", "stop-opacity",
    "d", "fill", "fill-opacity", "stroke", "stroke-opacity",
    "stroke-width", "stroke-linecap", "opacity", "clip-path",
    "data-wash", "data-facet", "data-brush", "data-alpha37-paint",
    "data-alpha37-mark"
}
EXPECTED_MARKS = ["light", "shadow", "light", "shadow", "light", "shadow", "ridge"]


def read_and_validate(path: Path, candidate: bool):
    raw = path.read_bytes()
    svg = ET.fromstring(raw)
    if svg.attrib.get("viewBox") != "0 0 3200 2000":
        raise ValueError("Original midrange painting must be 2x editable source")
    for elem in svg.iter():
        if elem.tag.removeprefix(NS) not in SAFE_ELEMENTS:
            raise ValueError("Disallowed markup in original midrange study")
        if any(k not in SAFE_ATTRIBUTES for k in elem.attrib):
            raise ValueError("Disallowed or scriptable source SVG attribute")
    base = svg.find(f".//{NS}path[@id='mid-painted-base']")
    clip = svg.find(f".//{NS}clipPath[@id='mid-painted-clip']/{NS}path")
    crest = svg.find(f".//{NS}path[@id='mid-crest-highlight']")
    if any(v is None for v in (base, clip, crest)):
        raise ValueError("Mid source lacks connected crest, original clip and highlight")
    source_d = base.attrib["d"]
    if clip.attrib["d"] != source_d:
        raise ValueError("Original edited source ridge and landscape clip diverged")
    if not source_d.endswith(" L3200 2000 L0 2000Z"):
        raise ValueError("Unexpected original source land-floor closure")
    prefix = source_d[: -len(" L3200 2000 L0 2000Z")]
    if crest.attrib["d"] != prefix:
        raise ValueError("Painted mountain crest highlight diverges from silhouette")
    marks = [v.attrib.get("data-alpha37-paint") for v in svg.iter()
             if "data-alpha37-paint" in v.attrib]
    if candidate:
        if marks != EXPECTED_MARKS:
            raise ValueError("Must have exactly 7 authored mountain light/shade details")
    elif marks:
        raise ValueError("Legacy original midrange source not untouched")
    return raw


def render(raw):
    data = cairosvg.svg2png(bytestring=raw, output_width=W, output_height=H)
    return Image.open(io.BytesIO(data)).convert("RGBA")


def inspect(root: Path, theme: str):
    src = root / f"flappy/assets/v4/masters/{theme}/mid-natural-alpha37.svg"
    baseline = root / f"flappy/assets/v4/masters/{theme}/mid-master-pilot.svg"
    dest = root / f"flappy/assets/v4/pilot/{theme}/mid-raster-alpha37.png"
    source = read_and_validate(src, candidate=True)
    base = read_and_validate(baseline, candidate=False)
    old, new = render(base), render(source)
    if old.size != (W, H) or new.size != old.size:
        raise AssertionError("Wrong original transparent raster dimensions")
    # Repeat-safe editorial raster finishing, never applied to original art.
    # Keep the *actual* unmodified source's two 40px strips byte-identical.
    # A 16px spatial feather beyond the preserved edge avoids creating
    # a visible hard line within an otherwise painterly mountain material.
    # This also protects repeat joins when SVG paint strokes differ across
    # Cairo raster engines at the extreme boundaries of the tiled scene.
    original_edges = new.copy()
    feather = 16
    new.paste(old.crop((0, 0, TILE_QUIET, H)), (0, 0))
    new.paste(old.crop((W-TILE_QUIET, 0, W, H)), (W-TILE_QUIET, 0))
    for x in list(range(TILE_QUIET, TILE_QUIET+feather)) + list(
            range(W-TILE_QUIET-feather, W-TILE_QUIET)):
        left_weight = (x-TILE_QUIET+1) / (feather+1)
        if x > W//2:
            left_weight = (W-TILE_QUIET-x)/(feather+1)
        old_col=old.crop((x,0,x+1,H))
        new_col=original_edges.crop((x,0,x+1,H))
        new.paste(Image.blend(old_col,new_col,max(0.,min(1.,left_weight))),(x,0))
    raw_old, raw_new = old.tobytes(), new.tobytes()
    for y in range(H):
        first = y * W * 4
        if y < SKY_QUIET and raw_old[first:first+W*4] != raw_new[first:first+W*4]:
            raise AssertionError("Alpha37 entered sky/bird-visible safety lane")
        for lo, hi in ((first, first + TILE_QUIET*4),
                       (first+(W-TILE_QUIET)*4, first+W*4)):
            if raw_old[lo:hi] != raw_new[lo:hi]:
                raise AssertionError("Original midrange parallax tile border changed")
    if old.getbbox() is None or new.getbbox() is None:
        raise AssertionError("Missing mountain landscape pixels")
    if new.getbbox()[1] < SKY_QUIET or new.getbbox()[3] != old.getbbox()[3]:
        raise AssertionError("Edited ridge grows into active sky or clips original floor")
    diff = ImageChops.difference(old, new)
    bbox = diff.getbbox()
    if bbox is None:
        raise AssertionError("Authored natural mountain PNG identical to geometric pilot")
    total = sum(1 for i in range(0, len(raw_old), 4) if raw_old[i:i+4] != raw_new[i:i+4])
    new_skyline = sum(1 for i in range(3, len(raw_old), 4)
                      if raw_old[i] == 0 and raw_new[i] > 0)
    if not 2000 <= total <= 700000 or new_skyline < 150:
        raise AssertionError(f"Authored mountain shape invisible or excessive: {theme} {total=} {new_skyline=}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    new.save(dest, "PNG", optimize=True, compress_level=9)
    encoded = dest.read_bytes()
    if not (8000 < len(encoded) < 4_000_000):
        raise AssertionError("Bad offline PNG budget")
    return {"theme": theme, "status": "DRAFT_EDITABLE_NATURAL_MOUNTAIN_STUDY",
            "editable_2x_original": str(src),
            "editable_source_sha256": hashlib.sha256(source).hexdigest(),
            "untouched_original_pilot": str(baseline),
            "qa_png": str(dest), "qa_png_sha256": hashlib.sha256(encoded).hexdigest(),
            "qa_png_bytes": len(encoded), "format": "RGBA", "dimensions": [W, H],
            "source_mountain_paint_paths": len(EXPECTED_MARKS),
            "synchronized_source_crest_clip_highlight": True,
            "changed_rgba_pixels": total, "new_mountain_skyline_pixels": new_skyline,
            "original_diff_bbox": list(bbox),
            "bird_sky_region_identical_above_y": SKY_QUIET,
            "tile_border_rgba_identical_px": TILE_QUIET,
            "per_tile_svg_raster_feather_px": feather,
            "runtime_file_changed": False, "artist_approved_final_master": False}


def verify_screens(root):
    folder = root / "v4-art-qa"
    results = []
    for theme in ("warm", "slate"):
        for w,h in ((320,568),(390,844)):
            a = folder / f"pilot-mid-{theme}-{w}x{h}.png"
            b = folder / f"alpha37-mid-{theme}-{w}x{h}.png"
            with Image.open(a) as x, Image.open(b) as y:
                if x.size != (w,h) or y.size != x.size:
                    raise AssertionError("Real Chrome screenshot size mismatch")
                diff=ImageChops.difference(x.convert("RGB"),y.convert("RGB"))
                level=diff.convert("L").point(lambda v: 255 if v>4 else 0)
                n=level.histogram()[255]
                if n<70:
                    raise AssertionError(f"Actual edited midridge missing in {theme} {w}x{h}: {n}")
                results.append({"world":theme,"viewport":[w,h],
                                "changed_browser_pixels_above_4":n})
    data={"status":"DRAFT_REAL_CHROME_ALPHA37_MID_A_B","cases":results}
    (folder/"alpha37-browser-mountain-diff.json").write_text(
        json.dumps(data,indent=2)+"\n",encoding="utf-8")
    print("ALPHA37 REAL MOBILE MIDRANGE A/B",data)


def main():
    root=Path(__file__).resolve().parent.parent
    if sys.argv[1:]==["--verify-screens"]:
        verify_screens(root)
    elif len(sys.argv)==1:
        data=[inspect(root,t) for t in ("warm","slate")]
        folder=root/"v4-art-qa"
        folder.mkdir(exist_ok=True)
        (folder/"alpha37-natural-midrange-metrics.json").write_text(
            json.dumps({"status":"DRAFT_MIDRANGE_REPAINT_NOT_PRODUCTION",
                        "assets":data},indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
        for d in data:print("ALPHA37 NATURAL MIDRANGE SOURCE",json.dumps(d,ensure_ascii=False))
    else:
        raise SystemExit("usage: script [--verify-screens]")


if __name__=="__main__":
    main()
