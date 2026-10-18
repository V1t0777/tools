#!/usr/bin/env python3
"""Alpha36: bounded additive/recessive asymmetric tree outline editing.

Unlike Alpha31-35, this stage intentionally changes small areas of *alpha*
at the source canopy perimeter. It never touches runtime art, the upper
600-pixel flight lane, or the left/right 40-pixel repeating tile border.
Edited paths are independent 3200x2000 source SVG, rasterized by CairoSVG
with exact original per-tree crown masks as their only spatial authority.
"""
from __future__ import annotations
import hashlib
import io
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import cairosvg
from PIL import Image, ImageChops, ImageFilter

W, H, EDGE, FLIGHT_Y = 1600, 1000, 40, 600
NS = "{http://www.w3.org/2000/svg}"
VALID_TAGS = {"svg", "title", "desc", "g", "path"}
VALID_ATTRS = {"width", "height", "viewBox", "role", "aria-label", "id",
               "data-alpha36-tree", "data-species", "transform",
               "data-edge-add", "data-edge-remove", "data-edge-positive",
               "data-edge-negative", "d", "fill", "fill-opacity"}
SPECIES = {
    "warm": ["oak", "willow", "birch", "alder", "oak", "willow",
             "birch", "alder", "oak", "willow", "birch"],
    "slate": ["fir", "spruce", "larch", "fir", "spruce", "larch",
              "fir", "spruce", "larch", "fir", "spruce"],
}


def raster(children):
    svg = ET.Element(NS + "svg", {"width": "3200", "height": "2000",
                                  "viewBox": "0 0 3200 2000"})
    for child in children:
        svg.append(child)
    png = cairosvg.svg2png(bytestring=ET.tostring(svg, encoding="utf-8"),
                           output_width=W, output_height=H)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def editable_source(path, theme):
    raw = path.read_bytes()
    if not (3000 < len(raw) < 25000):
        raise ValueError("Unexpected editable contour artwork size")
    root = ET.fromstring(raw)
    if root.attrib.get("viewBox") != "0 0 3200 2000":
        raise ValueError("Alpha36 authoring must be 3200x2000")
    for element in root.iter():
        if element.tag.removeprefix(NS) not in VALID_TAGS:
            raise ValueError("SVG contains unsupported or active node")
        if any(key not in VALID_ATTRS for key in element.attrib):
            raise ValueError("SVG contains unsupported or active attribute")
    groups = root.findall(f".//{NS}g[@data-alpha36-tree]")
    if len(groups) != 11:
        raise ValueError("Original 11 tree authored groups missing")
    for i, group in enumerate(groups):
        if group.attrib.get("data-alpha36-tree") != str(i + 1):
            raise ValueError("Original authored tree layout reordered")
        if group.attrib.get("data-species") != SPECIES[theme][i]:
            raise ValueError("Species does not match source forest")
        add = group.find(f"./{NS}g[@data-edge-add]")
        remove = group.find(f"./{NS}g[@data-edge-remove]")
        if add is None or remove is None:
            raise ValueError("Need positive and negative editable brush groups")
        if [e.attrib.get("data-edge-positive") for e in add] != ["1", "2", "3"]:
            raise ValueError("Three positive per-tree lobes required")
        if [e.attrib.get("data-edge-negative") for e in remove] != ["1", "2"]:
            raise ValueError("Two negative gaps required")
        if any(e.tag != NS + "path" for e in list(add) + list(remove)):
            raise ValueError("Art markup must use original path painting")
    return groups, raw


def original_masks(path, theme):
    root = ET.fromstring(path.read_bytes())
    groups = [e for e in root.iter() if "data-tree" in e.attrib]
    if len(groups) != 11:
        raise ValueError("Expected eleven tree source crowns")
    masks = []
    for i, group in enumerate(groups):
        if group.attrib.get("data-species") != SPECIES[theme][i]:
            raise ValueError("Original source species unexpectedly changed")
        crowns = [e for e in group.iter()
                  if e.tag == NS + "path" and
                  e.attrib.get("data-foliage") == "primary"]
        if len(crowns) != 1:
            raise ValueError("Each original source tree requires one primary crown")
        white = ET.Element(NS + "path", {
            "d": crowns[0].attrib["d"], "fill": "#ffffff"})
        masks.append(raster([white]).getchannel("A"))
    return masks


def silent_edges(mask):
    mask.paste(0, (0, 0, W, FLIGHT_Y))
    mask.paste(0, (0, 0, EDGE, H))
    mask.paste(0, (W - EDGE, 0, W, H))
    return mask


def render_group(group, key):
    # Keep the *specific* original tree transform but isolate positive/negative
    # authored paths to prevent the two paint types from contaminating masks.
    chosen = group.find(f"./{NS}g[@{key}]")
    wrapped = ET.Element(NS + "g", {"transform": group.attrib["transform"]})
    wrapped.append(chosen)
    return raster([wrapped])


def count_changes(previous, current):
    p, c = previous.tobytes(), current.tobytes()
    changed = added = erased = 0
    for i in range(0, len(p), 4):
        if p[i:i+4] != c[i:i+4]:
            changed += 1
        if p[i+3] == 0 and c[i+3] > 0:
            added += 1
        if c[i+3] < p[i+3]:
            erased += 1
    return changed, added, erased


def compose(root: Path, theme: str):
    baseline = root / f"flappy/assets/v4/pilot/{theme}/near-raster-alpha{'34' if theme == 'warm' else '35'}.png"
    art = root / f"flappy/assets/v4/masters/{theme}/near-outline-alpha36.svg"
    original = root / f"flappy/assets/v4/masters/{theme}/near-master-pilot.svg"
    dest = root / f"flappy/assets/v4/pilot/{theme}/near-raster-alpha36.png"
    groups, source = editable_source(art, theme)
    tree_masks = original_masks(original, theme)
    before = Image.open(baseline).convert("RGBA")
    if before.size != (W, H):
        raise ValueError("Alpha35/34 master candidate size mismatch")
    result = before.copy()
    contributions = []
    for i, (group, mask) in enumerate(zip(groups, tree_masks)):
        # +/- up to 14 px from the ORIGINAL unaltered tree crown mask.
        # The mask is independent for each of the 11 individual tree crowns.
        outward = silent_edges(mask.filter(ImageFilter.MaxFilter(29)))
        inward = silent_edges(ImageChops.subtract(
            mask, mask.filter(ImageFilter.MinFilter(19))))
        addition = render_group(group, "data-edge-add")
        addition.putalpha(ImageChops.multiply(addition.getchannel("A"), outward))
        positive = Image.alpha_composite(result, addition)
        removal = render_group(group, "data-edge-remove")
        knockout = ImageChops.multiply(removal.getchannel("A"), inward)
        # Intentional 3/5 anti-alias alpha removal creates sky gaps at crown
        # edges but never erases the silhouette core, ground, or distant sky.
        knockout = knockout.point(lambda level: level * 3 // 5)
        alpha_after = ImageChops.subtract(positive.getchannel("A"), knockout)
        positive.putalpha(alpha_after)
        changed, added, erased = count_changes(result, positive)
        if changed < 35:
            raise AssertionError(
                f"{theme} tree {i + 1} authored outline invisible: {changed}")
        contributions.append({"tree": i + 1, "species": SPECIES[theme][i],
                              "rgba_changed_pixels": changed,
                              "new_sky_edge_coverage_pixels": added,
                              "carved_perimeter_pixels": erased})
        result = positive
    prev_data, current_data = before.tobytes(), result.tobytes()
    for y in range(H):
        start = y * W * 4
        if y < FLIGHT_Y and prev_data[start:start+4*W] != current_data[start:start+4*W]:
            raise AssertionError(f"{theme} bird-readable flight lane changed")
        for a, b in ((start, start + EDGE * 4),
                     (start + (W - EDGE)*4, start + W*4)):
            if prev_data[a:b] != current_data[a:b]:
                raise AssertionError(f"{theme} repeat-edge bytes changed")
    total, alpha_added, alpha_carved = count_changes(before, result)
    if total < 1000 or total > 100000 or alpha_added < 10:
        raise AssertionError(
            f"{theme} alpha36 outline modification out of bounds: "
            f"{total=}, {alpha_added=}, {alpha_carved=}")
    old_box, new_box = before.getbbox(), result.getbbox()
    # Source silhouette is *intentionally* edited; a taller nearby tree tip
    # may move the image's alpha top bounding edge a little. Never reject a
    # legitimate localized outline edit merely because its alpha bbox moved.
    # Instead require bounded expansion within the protected play-lane limit,
    # with no change to horizontal/global lower canvas coverage.
    if old_box is None or new_box is None:
        raise AssertionError("Source transparent forest unexpectedly empty")
    if (new_box[0] != old_box[0] or new_box[2] != old_box[2] or
            new_box[3] != old_box[3] or
            new_box[1] < FLIGHT_Y or
            abs(new_box[1] - old_box[1]) > 28):
        raise AssertionError(
            f"Original contour changed canvas bounds too far: {old_box} to {new_box}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    result.save(dest, "PNG", optimize=True, compress_level=9)
    png = dest.read_bytes()
    if len(png) > 4_000_000:
        raise AssertionError("Mobile candidate PNG exceeds 4MB")
    return {"theme": theme, "status": "DRAFT_EDITED_OUTER_CONTOUR_NOT_FINAL",
            "source_editable_3200x2000": str(art),
            "source_sha256": hashlib.sha256(source).hexdigest(),
            "baseline_transparent_candidate": str(baseline),
            "candidate_png": str(dest), "png_size": len(png),
            "png_sha256": hashlib.sha256(png).hexdigest(),
            "source_tree_groups": len(groups), "source_authored_paths": 55,
            "individual_tree_coverage": contributions,
            "rgba_changed_pixels": total,
            "NEW_alpha_edge_pixels": alpha_added,
            "recessed_source_perimeter_pixels": alpha_carved,
            "altered_alpha_intentionally": True,
            "alpha_bbox_before": list(old_box),
            "alpha_bbox_after": list(new_box),
            "alpha_bbox_top_offset_px": new_box[1] - old_box[1],
            "upper_flight_lane_unchanged_to_px": FLIGHT_Y,
            "tile_border_byte_identical_px": EDGE,
            "maximum_tree_crown_spatial_dilation_px": 14,
            "mobile_real_device_approved": False,
            "professional_final_master_approved": False,
            "actual_game_asset_modified": False}


def verify_screens(root):
    folder = root / "v4-art-qa"
    comparisons = []
    for theme in ("warm", "slate"):
        baseline = 34 if theme == "warm" else 35
        for width, height in ((320, 568), (390, 844)):
            previous = folder / f"alpha{baseline}-raster-{theme}-{width}x{height}.png"
            proposed = folder / f"alpha36-raster-{theme}-{width}x{height}.png"
            with Image.open(previous) as a, Image.open(proposed) as b:
                if a.size != b.size or a.size != (width, height):
                    raise AssertionError("Mismatched actual browser A/B dimensions")
                diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
                count = diff.convert("L").point(
                    lambda value: 255 if value > 4 else 0).histogram()[255]
                if count < 24:
                    raise AssertionError(
                        f"Alpha36 {theme} actual mobile screenshot blank A/B: {count}")
                comparisons.append({"theme": theme, "viewport": [width, height],
                                    "visible_browser_rgb_pixels_above_4": count})
    report = {"status": "DRAFT_REAL_CHROME_AB_PIXEL_GUARD",
              "compared_with": {"warm": 34, "slate": 35},
              "cases": comparisons}
    (folder / "alpha36-actual-chrome-ab-diffs.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("ALPHA36 BROWSER SOURCE EDGE A/B", report)


def main():
    root = Path(__file__).resolve().parent.parent
    if sys.argv[1:] == ["--verify-screens"]:
        verify_screens(root)
    elif len(sys.argv) == 1:
        results = [compose(root, th) for th in ("warm", "slate")]
        folder = root / "v4-art-qa"
        folder.mkdir(exist_ok=True)
        (folder / "alpha36-original-outline-metrics.json").write_text(
            json.dumps({"status": "TWO_EDITABLE_NONPRODUCTION_OUTLINE_STUDIES",
                        "assets": results}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        for item in results:
            print("ALPHA36 ORIGINAL EDGE PAINT", json.dumps(item, ensure_ascii=False))
    else:
        raise SystemExit("usage: script [--verify-screens]")


if __name__ == "__main__":
    main()
