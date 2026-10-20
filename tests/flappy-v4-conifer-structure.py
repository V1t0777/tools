#!/usr/bin/env python3
"""Alpha35: independently masked, explicitly authored slate conifer value art.

Build phase renders 11 separate hand-composed editable source-tree stroke sets
and verifies byte-identical source transparency, repeat borders and the active
bird's upper flight lane. Optional screenshot mode checks that the reviewer
actually DISPLAYED the new art in narrow and tall browser screenshots.
CI/Draft only, not a final painted master or production asset.
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

W, H, EDGE, SAFE_LANE = 1600, 1000, 40, 600
NS = "{http://www.w3.org/2000/svg}"
TAGS = {"svg", "title", "desc", "g", "path"}
ATTRS = {"width", "height", "viewBox", "role", "aria-label",
         "id", "data-alpha35-tree", "data-species", "transform",
         "data-alpha35-mark", "d", "fill", "fill-opacity",
         "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
         "stroke-linejoin"}
SPECIES = ["fir", "spruce", "larch", "fir", "spruce", "larch",
           "fir", "spruce", "larch", "fir", "spruce"]
MARKS = ("volume", "shade", "rim", "bough",
         "needle", "dark-branch", "spark", "fleck")


def render(nodes):
    svg = ET.Element(NS + "svg", {"width": "3200", "height": "2000",
                                  "viewBox": "0 0 3200 2000"})
    for node in nodes:
        svg.append(node)
    data = cairosvg.svg2png(bytestring=ET.tostring(svg, encoding="utf-8"),
                            output_width=W, output_height=H)
    return Image.open(io.BytesIO(data)).convert("RGBA")


def author_groups(path):
    raw = path.read_bytes()
    if not (3000 < len(raw) < 50000):
        raise ValueError("Unexpected editable slate artwork size")
    root = ET.fromstring(raw)
    if root.attrib.get("viewBox") != "0 0 3200 2000":
        raise ValueError("Authored slate art must be editable at 2x source")
    if any(e.tag.removeprefix(NS) not in TAGS or
           any(k not in ATTRS for k in e.attrib) for e in root.iter()):
        raise ValueError("Unsafe element or active SVG attribute in authored art")
    trees = root.findall(f".//{NS}g[@data-alpha35-tree]")
    if len(trees) != 11:
        raise ValueError("The whole original near forest must be authored")
    for i, group in enumerate(trees):
        if group.attrib.get("data-alpha35-tree") != str(i + 1):
            raise ValueError("Reordered individually addressed conifer tree")
        if group.attrib.get("data-species") != SPECIES[i]:
            raise ValueError("Tree species changed from source study")
        if [c.attrib.get("data-alpha35-mark") for c in group] != list(MARKS):
            raise ValueError("Missing or duplicated independently authored stroke paths")
        if any(c.tag != NS + "path" for c in group):
            raise ValueError("Unexpected markup under a paintable tree")
    return trees, raw


def original_tree_masks(path):
    root = ET.fromstring(path.read_bytes())
    groups = [e for e in root.iter() if "data-tree" in e.attrib]
    if len(groups) != 11:
        raise ValueError("Original source no longer has 11 trees")
    masks = []
    for index, group in enumerate(groups):
        if group.attrib.get("data-species") != SPECIES[index]:
            raise ValueError("Original source species no longer align")
        crowns = [p for p in group.iter()
                  if p.tag == NS + "path" and
                  p.attrib.get("data-foliage") == "primary"]
        if len(crowns) != 1:
            raise ValueError("Original crown path missing or duplicated")
        path_node = ET.Element(NS + "path", {
            "d": crowns[0].attrib["d"], "fill": "#ffffff"})
        masks.append(render([path_node]).getchannel("A"))
    return masks


def changed_pixels(a, b):
    old, new = a.tobytes(), b.tobytes()
    return sum(1 for i in range(0, len(old), 4)
               if old[i + 3] != 0 and old[i:i + 3] != new[i:i + 3])


def build(root):
    theme = "slate"
    art = root / "flappy/assets/v4/masters/slate/near-structure-alpha35.svg"
    master = root / "flappy/assets/v4/masters/slate/near-master-pilot.svg"
    baseline = root / "flappy/assets/v4/pilot/slate/near-raster-alpha34.png"
    output = root / "flappy/assets/v4/pilot/slate/near-raster-alpha35.png"
    edited, source = author_groups(art)
    tree_masks = original_tree_masks(master)
    before = Image.open(baseline).convert("RGBA")
    if before.size != (W, H):
        raise ValueError("Alpha34 transparent material raster missing")
    original_alpha = before.getchannel("A")
    result = before.copy()
    counts = []
    for i, (group, mask) in enumerate(zip(edited, tree_masks)):
        brush = render([group])
        allowed = ImageChops.multiply(mask, original_alpha)
        allowed.paste(0, (0, 0, EDGE, H))
        allowed.paste(0, (W - EDGE, 0, W, H))
        brush.putalpha(ImageChops.multiply(brush.getchannel("A"), allowed))
        next_img = Image.alpha_composite(result, brush)
        changed = changed_pixels(result, next_img)
        if changed < 30:
            raise AssertionError(f"Original tree {i + 1} authored marks not visible: {changed}")
        counts.append({"tree": i + 1, "species": SPECIES[i],
                       "visible_pixels_changed": changed})
        result = next_img
    result.putalpha(original_alpha)
    raw_baseline, raw_final = before.tobytes(), result.tobytes()
    if result.getchannel("A").tobytes() != original_alpha.tobytes():
        raise AssertionError("Alpha35 introduced forbidden silhouette/sky pixels")
    if before.getbbox() != result.getbbox():
        raise AssertionError("Source bounds changed")
    for y in range(H):
        row = y * W * 4
        if y < SAFE_LANE and raw_baseline[row:row + W * 4] != raw_final[row:row + W * 4]:
            raise AssertionError("Bird-readable upper flight lane altered")
        for left, right in ((row, row + EDGE * 4),
                            (row + (W - EDGE) * 4, row + W * 4)):
            if raw_baseline[left:right] != raw_final[left:right]:
                raise AssertionError("Repeat-edge RGB(A) no longer identical")
    total = changed_pixels(before, result)
    if total < 5000:
        raise AssertionError(f"Slate conifer original structural painting too subtle: {total}")
    output.parent.mkdir(parents=True, exist_ok=True)
    result.save(output, "PNG", optimize=True, compress_level=9)
    data = output.read_bytes()
    if len(data) > 4_000_000:
        raise AssertionError("Candidate exceeded mobile 4MB budget")
    metrics = {
        "status": "DRAFT_ORIGINAL_CANOPY_STRUCTURE_UNAPPROVED",
        "theme": theme, "source_2x_editable_art": str(art),
        "source_sha256": hashlib.sha256(source).hexdigest(),
        "baseline_rgba": str(baseline), "candidate_rgba": str(output),
        "candidate_png_bytes": len(data), "candidate_sha256": hashlib.sha256(data).hexdigest(),
        "dimensions": [W, H], "format": "RGBA",
        "per_tree_source_masked_changed_pixels": counts,
        "total_visible_changed_pixels_vs_alpha34": total,
        "total_original_authored_paths": len(edited) * len(MARKS),
        "no_change_above_source_y": SAFE_LANE,
        "repeating_tile_quiet_border_px": EDGE,
        "source_alpha_byte_identical": True, "runtime_asset_replaced": False,
        "real_mobile_tested": False, "final_paint_approved": False}
    path = root / "v4-art-qa/alpha35-structural-art-metrics.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("ALPHA35 SOURCE-MASKED SLATE ART", json.dumps(metrics, ensure_ascii=False))


def verify_screens(root):
    root_dir = root / "v4-art-qa"
    metrics = {"status": "DRAFT_CHROME_VISIBLE_ART_AB_DIFF", "theme": "slate", "cases": []}
    for width, height in ((320, 568), (390, 844)):
        baseline = root_dir / f"alpha34-raster-slate-{width}x{height}.png"
        candidate = root_dir / f"alpha35-raster-slate-{width}x{height}.png"
        with Image.open(baseline) as first, Image.open(candidate) as second:
            if first.size != (width, height) or second.size != first.size:
                raise AssertionError("Chrome A/B viewport size mismatch")
            old, new = first.convert("RGB"), second.convert("RGB")
            delta = ImageChops.difference(old, new)
            # Ignore 1-level Chrome antialiasing noise. Painted area must
            # actually be visible in each screenshot to accept the route.
            diff = delta.convert("L").point(lambda v: 255 if v > 4 else 0)
            count = diff.histogram()[255]
            if count < 30:
                raise AssertionError(f"Alpha35 art missing from actual {width}x{height} screenshot: {count}")
            metrics["cases"].append({
                "viewport": [width, height],
                "visibly_changed_browser_pixels_over_4_levels": count})
    (root_dir / "alpha35-browser-art-diff.json").write_text(
        json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print("ALPHA35 TRUE BROWSER A/B", metrics)


def main():
    root = Path(__file__).resolve().parent.parent
    if sys.argv[1:] == ["--verify-screens"]:
        verify_screens(root)
    elif len(sys.argv) == 1:
        build(root)
    else:
        raise SystemExit("usage: script [--verify-screens]")


if __name__ == "__main__":
    main()
