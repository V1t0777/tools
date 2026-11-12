#!/usr/bin/env python3
"""Alpha 34: render *explicit authored* original gouache path composition.

Two separately authored source-editable 3200x2000 scene overlays; no random
stroke generation at this stage. Align original Alpha30 authored silhouettes,
retain original Alpha33 transparency and quiet tile edges. Offline Draft only.
"""
from __future__ import annotations
import hashlib
import io
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import cairosvg
from PIL import Image, ImageChops

WIDTH, HEIGHT, EDGE = 1600, 1000, 40
NS = "{http://www.w3.org/2000/svg}"
ALLOWED_TAGS = {"svg", "title", "desc", "g", "path"}
ALLOWED_ATTRS = {"width", "height", "viewBox", "role", "aria-label",
                 "id", "data-alpha34", "data-paint-tree", "data-material",
                 "transform", "data-author-mark", "data-ground-paint",
                 "d", "fill", "fill-opacity", "stroke", "stroke-width",
                 "stroke-opacity", "stroke-linejoin", "stroke-linecap"}


def validate_authored_source(path: Path):
    data = path.read_bytes()
    if not (2000 <= len(data) < 35000):
        raise ValueError("Unusually small or huge hand-authored study")
    root = ET.fromstring(data)
    if root.attrib.get("viewBox") != "0 0 3200 2000":
        raise ValueError("Must be original editable 3200px source")
    for element in root.iter():
        if element.tag.removeprefix(NS) not in ALLOWED_TAGS:
            raise ValueError("Unsafe SVG element in original art")
        if any(key not in ALLOWED_ATTRS for key in element.attrib):
            raise ValueError("Unknown or active SVG attribute")
    groups = root.findall(f".//{NS}g[@data-paint-tree]")
    if len(groups) != 11 or [g.attrib["data-paint-tree"] for g in groups] != [
            str(i) for i in range(1, 12)]:
        raise ValueError("Every original tree needs exactly one authored group")
    for g in groups:
        markers = [c.attrib.get("data-author-mark") for c in g]
        if markers != ["light", "occlusion", "edge"]:
            raise ValueError("Each tree requires unique value, shade, edge authored paths")
        if not all(c.tag == NS + "path" for c in g):
            raise ValueError("Every art mark must be a path")
    ground = root.findall(f".//{NS}path[@data-ground-paint]")
    if len(ground) != 9:
        raise ValueError("Nine hand-shaped original soil gouache paths required")
    crown_group = root.find(f".//{NS}g[@id='authored-crown-gouache']")
    soil_group = root.find(f".//{NS}g[@id='authored-ground-gouache']")
    if crown_group is None or soil_group is None:
        raise ValueError("Missing separately editable paint groups")
    return root, crown_group, soil_group, data


def render_elements(elements):
    page = ET.Element(NS + "svg", {"width": "3200", "height": "2000",
                                  "viewBox": "0 0 3200 2000"})
    for element in elements:
        page.append(element)
    raw = ET.tostring(page, encoding="utf-8")
    pixels = cairosvg.svg2png(bytestring=raw, output_width=WIDTH,
                              output_height=HEIGHT)
    return Image.open(io.BytesIO(pixels)).convert("RGBA")


def original_masks(master):
    tree_paths, soil_paths = [], []
    for element in ET.fromstring(master.read_bytes()).iter():
        if element.tag == NS + "path" and element.attrib.get("data-foliage") == "primary":
            tree_paths.append(element.attrib["d"])
        if (element.tag == NS + "clipPath" and
                element.attrib.get("id") == "foreground-ground-clip"):
            soil_paths += [child.attrib["d"] for child in element
                           if child.tag == NS + "path"]
    if len(tree_paths) != 11 or len(soil_paths) != 1:
        raise ValueError("Original source masks changed")
    def make(paths):
        xml = ET.Element(NS + "svg", {"width": "3200", "height": "2000",
                                    "viewBox": "0 0 3200 2000"})
        for d in paths:
            ET.SubElement(xml, NS + "path", {"d": d, "fill": "#ffffff"})
        return render_elements(list(xml)).getchannel("A")
    return make(tree_paths), make(soil_paths)


def mask_and_paint(base, paint, allowed):
    permitted = ImageChops.multiply(base.getchannel("A"), allowed)
    permitted.paste(0, (0, 0, EDGE, HEIGHT))
    permitted.paste(0, (WIDTH - EDGE, 0, WIDTH, HEIGHT))
    paint.putalpha(ImageChops.multiply(paint.getchannel("A"), permitted))
    return Image.alpha_composite(base, paint)


def differing_pixels(one, two):
    a, b = one.tobytes(), two.tobytes()
    return sum(1 for i in range(0, len(a), 4)
               if a[i+3] > 0 and a[i:i+3] != b[i:i+3])


def build(root, theme):
    if theme not in ("warm", "slate"):
        raise ValueError("Unknown visual world")
    source = root / f"flappy/assets/v4/masters/{theme}/near-gouache-alpha34.svg"
    original = root / f"flappy/assets/v4/masters/{theme}/near-master-pilot.svg"
    baseline = root / f"flappy/assets/v4/pilot/{theme}/near-raster-alpha33.png"
    destination = root / f"flappy/assets/v4/pilot/{theme}/near-raster-alpha34.png"
    _, crown, soil, raw_source = validate_authored_source(source)
    before = Image.open(baseline).convert("RGBA")
    if before.size != (WIDTH, HEIGHT):
        raise ValueError("Alpha33 baseline dimensions mismatch")
    canopy_mask, ground_mask = original_masks(original)
    # Both vectors were individually placed by art direction, not sampled
    # algorithmically; mask to original tree and terrain pixels only.
    canopy_pass = mask_and_paint(before, render_elements([crown]), canopy_mask)
    canopy_changed = differing_pixels(before, canopy_pass)
    finished = mask_and_paint(canopy_pass, render_elements([soil]), ground_mask)
    soil_changed = differing_pixels(canopy_pass, finished)
    finished.putalpha(before.getchannel("A"))
    old, new = before.tobytes(), finished.tobytes()
    if finished.getchannel("A").tobytes() != before.getchannel("A").tobytes():
        raise AssertionError("Original source alpha changed")
    if finished.getbbox() != before.getbbox():
        raise AssertionError("Source geometry changed")
    for y in range(HEIGHT):
        start = y * WIDTH * 4
        if old[start:start+4*EDGE] != new[start:start+4*EDGE]:
            raise AssertionError("Left tile seam RGB(A) changed")
        end = start + 4 * WIDTH
        if old[end-4*EDGE:end] != new[end-4*EDGE:end]:
            raise AssertionError("Right tile seam RGB(A) changed")
    if canopy_changed < 700 or soil_changed < 700:
        raise AssertionError(f"Authored paint too subtle or missing: {theme} "
                             f"{canopy_changed=} {soil_changed=}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    finished.save(destination, "PNG", optimize=True, compress_level=9)
    encoded = destination.read_bytes()
    if len(encoded) > 4_000_000:
        raise AssertionError("Mobile offline candidate too large")
    return {"theme": theme, "source_art": str(source),
            "authored_svg_sha256": hashlib.sha256(raw_source).hexdigest(),
            "original_editable_terrain": str(original),
            "baseline_rgba": str(baseline),
            "produced_rgba": str(destination),
            "image_size": [WIDTH, HEIGHT], "mode": "RGBA",
            "bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest(),
            "authored_tree_compositions": 11, "authored_canopy_marks": 33,
            "authored_terrain_strokes": 9,
            "canopy_visible_pixels_changed": canopy_changed,
            "ground_visible_pixels_changed": soil_changed,
            "source_alpha_byte_identical": True,
            "tile_edge_untouched_px": EDGE,
            "actual_game_asset_swapped": False,
            "professionally_approved_final_master": False}


def main():
    root = Path(__file__).resolve().parent.parent
    results = [build(root, theme) for theme in ("warm", "slate")]
    folder = root / "v4-art-qa"
    folder.mkdir(exist_ok=True)
    (folder / "alpha34-editorial-composition-metrics.json").write_text(
        json.dumps({
            "status": "DRAFT_ORIGINAL_VECTOR_PAINT_NOT_FINAL_NATIVE_ART",
            "technique": "per-tree hand-composed shape-level pigment studies",
            "results": results,
        }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for report in results:
        print("ALPHA34 ART-DIRECTED", report)


if __name__ == "__main__":
    main()
