#!/usr/bin/env python3
"""Alpha38 original distant mountain silhouettes, isolated Draft-only QA.

The seven separately authored 2x paths for each world use the same original
terrain, original clip and original crest highlight, without touching
production or main. Repeat edges are copied and feathered at PNG stage only.
"""
from __future__ import annotations
import hashlib
import json
import io
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
import cairosvg
from PIL import Image, ImageChops

W, H, TILE_BORDER, FEATHER, QUIET_SKY = 1600, 1000, 40, 16, 430
N = "{http://www.w3.org/2000/svg}"
SAFE_ELEMENTS = {"svg", "title", "desc", "defs", "linearGradient",
                 "stop", "clipPath", "path", "g"}
SAFE_ATTRS = {"width", "height", "viewBox", "role", "aria-label",
              "id", "x1", "x2", "y1", "y2", "offset", "stop-color",
              "stop-opacity", "d", "fill", "fill-opacity", "stroke",
              "stroke-width", "stroke-opacity", "stroke-linecap",
              "stroke-linejoin", "opacity", "clip-path", "data-gouache",
              "data-brush", "data-grain", "data-alpha38-far", "data-alpha38-mark"}
EXPECTED_PAINT = {
    "warm": ["sun", "shade", "sun", "shade", "sun", "shade", "crest"],
    "slate": ["moon", "shade", "moon", "shade", "moon", "shade", "crest"],
}


def source_svg(path, theme, candidate):
    raw = path.read_bytes()
    if not (6000 <= len(raw) <= 24000):
        raise ValueError("Far authored source SVG size out of expected range")
    root = ET.fromstring(raw)
    if root.attrib.get("viewBox") != "0 0 3200 2000":
        raise ValueError("Far master is not an editable 2x source")
    for element in root.iter():
        if element.tag.removeprefix(N) not in SAFE_ELEMENTS:
            raise ValueError("Unsafe or non-painting original SVG node")
        if any(key not in SAFE_ATTRS for key in element.attrib):
            raise ValueError("Unsafe or unexpected SVG original art attribute")
    base = root.find(f".//{N}path[@id='far-painted-base']")
    clip = root.find(f".//{N}clipPath[@id='far-painted-terrain']/{N}path")
    edge = root.find(f".//{N}path[@id='{ 'dawn-ridge-edge' if theme=='warm' else 'slate-ridge-edge'}']")
    if base is None or clip is None or edge is None:
        raise ValueError("Original far painted terrain or clip or skyline missing")
    d = base.attrib.get("d")
    closure = " L3200 2000 L0 2000Z"
    if not d or not d.endswith(closure) or clip.attrib.get("d") != d or edge.attrib.get("d") != d[:-len(closure)]:
        raise ValueError("Far artwork base / original mask / rim outline no longer exactly aligned")
    marks = [e.attrib.get("data-alpha38-far") for e in root.iter()
             if "data-alpha38-far" in e.attrib]
    if candidate and marks != EXPECTED_PAINT[theme]:
        raise ValueError("Author-painted seven far plane marks not present")
    if not candidate and marks:
        raise ValueError("Legacy original was unexpectedly overwritten")
    return raw


def render(source):
    png = cairosvg.svg2png(bytestring=source, output_width=W, output_height=H)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def composite(root, theme):
    source = root/f"flappy/assets/v4/masters/{theme}/far-natural-alpha38.svg"
    old_path = root/f"flappy/assets/v4/masters/{theme}/far-master-pilot.svg"
    dest = root/f"flappy/assets/v4/pilot/{theme}/far-raster-alpha38.png"
    new_source = source_svg(source, theme, True)
    old_source = source_svg(old_path, theme, False)
    before = render(old_source)
    result = render(new_source)
    if before.size != (W,H) or result.size != (W,H):
        raise AssertionError("Original far PNG raster dimensions corrupted")
    # Keep exact original tile-edge RGBA and feather back into edited
    # source painting in a narrow non-shipping 16px interior zone.
    authored = result.copy()
    result.paste(before.crop((0,0,TILE_BORDER,H)), (0,0))
    result.paste(before.crop((W-TILE_BORDER,0,W,H)), (W-TILE_BORDER,0))
    for x in list(range(TILE_BORDER,TILE_BORDER+FEATHER)) + list(
            range(W-TILE_BORDER-FEATHER,W-TILE_BORDER)):
        strength = ((x-TILE_BORDER+1)/(FEATHER+1) if x<W//2
                    else (W-TILE_BORDER-x)/(FEATHER+1))
        row_old=before.crop((x,0,x+1,H))
        row_new=authored.crop((x,0,x+1,H))
        result.paste(Image.blend(row_old,row_new,max(0,min(1,strength))),(x,0))
    pre,post=before.tobytes(),result.tobytes()
    for y in range(H):
        begin=y*W*4
        if y<QUIET_SKY and pre[begin:begin+4*W]!=post[begin:begin+4*W]:
            raise AssertionError("New far painterly mountain enters bird/upper sky")
        for a,b in ((begin,begin+TILE_BORDER*4),
                    (begin+(W-TILE_BORDER)*4,begin+W*4)):
            if pre[a:b]!=post[a:b]:
                raise AssertionError("Original far parallax tile edge changed")
    if before.getbbox() is None or result.getbbox() is None:
        raise AssertionError("Original mountain alpha missing")
    changed=sum(1 for i in range(0,len(pre),4) if pre[i:i+4]!=post[i:i+4])
    new_ridge=sum(1 for i in range(3,len(pre),4) if pre[i]==0 and post[i]>0)
    if not 2500<changed<800000 or new_ridge<120:
        raise AssertionError(f"Far ridge not visibly authored or too much altered: {theme} {changed=} {new_ridge=}")
    if result.getbbox()[1]<QUIET_SKY or result.getbbox()[3]!=H:
        raise AssertionError("Far raster top or ground is out of bounds")
    dest.parent.mkdir(parents=True,exist_ok=True)
    result.save(dest,"PNG",optimize=True,compress_level=9)
    png=dest.read_bytes()
    if not 8000<len(png)<4000000:
        raise AssertionError("Far PNG size outside reasonable offline art limit")
    return {"theme":theme,"qa_only":True,
            "original_2x_editable_svg":str(source),
            "original_sha256":hashlib.sha256(new_source).hexdigest(),
            "original_far_legacy_unchanged":str(old_path),
            "transparent_study_png":str(dest),
            "png_sha256":hashlib.sha256(png).hexdigest(),
            "png_bytes":len(png),"dimensions":[W,H],
            "author_painted_far_detail_paths":7,
            "base_clip_rim_d_identical":True,
            "changed_rgba_pixels":changed,
            "new_far_skyline_alpha_pixels":new_ridge,
            "actual_diff_bbox":list(ImageChops.difference(before,result).getbbox()),
            "upper_bird_sky_lane_byte_identical_y":QUIET_SKY,
            "repeat_edges_byte_identical_px":TILE_BORDER,
            "transition_feather_px":FEATHER,
            "production_game_asset_swapped":False,
            "native_art_final_approved":False}


def screenshot_diff(root):
    folder=root/"v4-art-qa"
    cases=[]
    for theme in ("warm","slate"):
        for w,h in ((320,568),(390,844)):
            old=folder/f"pilot-{theme}-far-{w}x{h}.png"
            now=folder/f"alpha38-far-{theme}-{w}x{h}.png"
            with Image.open(old) as a,Image.open(now) as b:
                if a.size!=b.size or a.size!=(w,h):
                    raise AssertionError("Browser A/B dimensions mismatch")
                delta=ImageChops.difference(a.convert("RGB"),b.convert("RGB"))
                count=delta.convert("L").point(lambda p:255 if p>4 else 0).histogram()[255]
                if count<60:
                    raise AssertionError(f"Far A/B CSS layer not shown in real mobile screenshot: {theme}, {count}")
                cases.append({"world":theme,"viewport":[w,h],
                              "actual_browser_pixels_changed_above_4":count})
    out={"status":"REAL_CHROME_DRAFT_ALPHA38_FAR_AB","cases":cases}
    (folder/"alpha38-far-browser-diff.json").write_text(json.dumps(out,indent=2)+"\n",encoding="utf-8")
    print("ALPHA38 REAL CHROME FAR A/B",out)


def main():
    root=Path(__file__).resolve().parent.parent
    if sys.argv[1:]==["--verify-screens"]:
        screenshot_diff(root)
    elif len(sys.argv)==1:
        data=[composite(root,t) for t in ("warm","slate")]
        folder=root/"v4-art-qa";folder.mkdir(exist_ok=True)
        (folder/"alpha38-far-source-metrics.json").write_text(
            json.dumps({"status":"EDITABLE_ORIGINAL_DRAFT_ONLY_NOT_PRODUCTION","assets":data},
                       indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
        for d in data:print("ALPHA38 SOURCE-COMPOSED FAR",json.dumps(d,ensure_ascii=False))
    else:
        raise SystemExit("usage: flappy-v4-natural-far.py [--verify-screens]")


if __name__=="__main__":
    main()
