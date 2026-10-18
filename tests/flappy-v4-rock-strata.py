#!/usr/bin/env python3
"""Alpha39: separately authored rock strata studies on authentic Alpha38 RGBA.

All work is Draft-only. Source-editable 2x transparent SVG pigments are
rasterized and clipped to actual prior far mountain RGBA; no new alpha is
created. A/B verifies visible change in real 320/390px Chrome screenshots.
"""
from __future__ import annotations
import hashlib, io, json, sys
import xml.etree.ElementTree as ET
from pathlib import Path
import cairosvg
from PIL import Image, ImageChops

W,H,EDGE,SKY=1600,1000,40,430
NS="{http://www.w3.org/2000/svg}"
ALLOWED_ELEMENTS={"svg","title","desc","g","path"}
ALLOWED_ATTRS={"width","height","viewBox","role","aria-label",
  "id","d","data-alpha39-wash","data-alpha39-strata","data-alpha39-flecks",
  "fill","fill-opacity","stroke","stroke-opacity","stroke-width",
  "stroke-linecap","stroke-linejoin"}
EXPECTED={"warm":(4,17,4),"slate":(4,16,4)}


def validate(path,theme):
    data=path.read_bytes()
    if not 2000<len(data)<24000:
        raise ValueError("New original landscape gouache must have real editable paths")
    root=ET.fromstring(data)
    if root.attrib.get("viewBox")!="0 0 3200 2000":
        raise ValueError("Alpha39 original art not in 2x editable coordinate space")
    for n in root.iter():
        if n.tag.removeprefix(NS) not in ALLOWED_ELEMENTS:
            raise ValueError("Unsupported active SVG element")
        if any(k not in ALLOWED_ATTRS for k in n.attrib):
            raise ValueError("Unapproved SVG attribute, possibly active content")
    counts=tuple(len(root.findall(f".//{NS}path[@{t}]")) for t in
      ("data-alpha39-wash","data-alpha39-strata","data-alpha39-flecks"))
    if counts!=EXPECTED[theme]:
        raise ValueError(f"Original layered hand-shaped stroke count mismatch: {theme} {counts}")
    if len(root.findall(f".//{NS}g"))!=3:
        raise ValueError("Need three independent editable material groups")
    return data,counts


def color_changed(before,after):
    a,b=before.tobytes(),after.tobytes()
    return sum(1 for i in range(0,len(a),4)
               if a[i+3]!=0 and a[i:i+3]!=b[i:i+3])


def build(root,theme):
    src=root/f"flappy/assets/v4/masters/{theme}/far-strata-alpha39.svg"
    baseline=root/f"flappy/assets/v4/pilot/{theme}/far-raster-alpha38.png"
    out=root/f"flappy/assets/v4/pilot/{theme}/far-raster-alpha39.png"
    raw,counts=validate(src,theme)
    before=Image.open(baseline).convert("RGBA")
    if before.size!=(W,H):
        raise AssertionError("Alpha38 RGBA baseline missing")
    rendered=cairosvg.svg2png(bytestring=raw,output_width=W,output_height=H)
    original=Image.open(io.BytesIO(rendered)).convert("RGBA")
    brush=original.copy()
    # Preserve original forest silhouette and existing zero-alpha skyline.
    allowed=before.getchannel("A")
    allowed.paste(0,(0,0,W,SKY))
    allowed.paste(0,(0,0,EDGE,H))
    allowed.paste(0,(W-EDGE,0,W,H))
    brush.putalpha(ImageChops.multiply(original.getchannel("A"),allowed))
    result=Image.alpha_composite(before,brush)
    result.putalpha(before.getchannel("A"))
    a,b=before.tobytes(),result.tobytes()
    if before.getchannel("A").tobytes()!=result.getchannel("A").tobytes():
        raise AssertionError("New rock gouache painted outside source skyline")
    for y in range(H):
        start=y*W*4
        if y<SKY and a[start:start+W*4]!=b[start:start+W*4]:
            raise AssertionError("Rock art changed bird/upper sky lane")
        for x1,x2 in ((start,start+EDGE*4),
                      (start+(W-EDGE)*4,start+W*4)):
            if a[x1:x2]!=b[x1:x2]:
                raise AssertionError("Rock art broke original repeated far source edges")
    count=color_changed(before,result)
    if count<4000 or count>300000:
        raise AssertionError(f"Authored rock strata too weak or cover everything: {theme} {count}")
    if before.getbbox()!=result.getbbox():
        raise AssertionError("Rock wash unintentionally changed original mountain geometry")
    out.parent.mkdir(parents=True,exist_ok=True)
    result.save(out,"PNG",optimize=True,compress_level=9)
    data=out.read_bytes()
    if not 8000<len(data)<4000000:
        raise AssertionError("Draft texture file budget invalid")
    return {"theme":theme,"status":"DRAFT_EDITABLE_PAINTED_STRATA_NOT_PRODUCTION",
            "original_source":str(src),"original_source_sha256":hashlib.sha256(raw).hexdigest(),
            "baseline_alpha38":str(baseline),"draft_png":str(out),
            "draft_png_sha256":hashlib.sha256(data).hexdigest(),
            "draft_png_bytes":len(data),"dimensions":[W,H],
            "original_editable_mountain_marks":sum(counts),
            "material_mark_groups":list(counts),
            "changed_visible_rgb_pixels":count,
            "source_rgba_alpha_byte_identical":True,"upper_sky_unchanged_y":SKY,
            "both_tile_edges_unchanged_px":EDGE,
            "live_runtime_changed":False,"native_artist_final_signoff":False}


def verify_screens(root):
    folder=root/"v4-art-qa"
    cases=[]
    for th in ("warm","slate"):
        for w,h in ((320,568),(390,844)):
            b=folder/f"alpha38-far-{th}-{w}x{h}.png"
            a=folder/f"alpha39-far-{th}-{w}x{h}.png"
            with Image.open(b) as base,Image.open(a) as current:
                if base.size!=(w,h) or current.size!=base.size:
                    raise AssertionError("Chrome A/B viewport sizes mismatch")
                diff=ImageChops.difference(base.convert("RGB"),current.convert("RGB"))
                changed=diff.convert("L").point(lambda p:255 if p>4 else 0).histogram()[255]
                if changed<80:
                    raise AssertionError(f"Alpha39 rock painting missing from real {th} {w}x{h} reviewer: {changed}")
                cases.append({"theme":th,"viewport":[w,h],
                              "changed_visible_browser_pixels_above_4":changed})
    report={"status":"DRAFT_REAL_MOBILE_ROCK_AB","cases":cases}
    (folder/"alpha39-real-chrome-rock-diff.json").write_text(
       json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("ALPHA39 REAL ROCK MOBILE A/B",report)


def main():
    root=Path(__file__).resolve().parent.parent
    if sys.argv[1:]==["--verify-screens"]:
        verify_screens(root)
    elif len(sys.argv)==1:
        results=[build(root,t) for t in ("warm","slate")]
        folder=root/"v4-art-qa";folder.mkdir(exist_ok=True)
        (folder/"alpha39-authored-rock-metrics.json").write_text(
          json.dumps({"status":"NOT_PRODUCTION","results":results},
           ensure_ascii=False,indent=2)+"\n",encoding="utf8")
        for r in results:print("ALPHA39 MOUNTAIN STRATA",json.dumps(r,ensure_ascii=False))
    else:raise SystemExit("usage: script [--verify-screens]")


if __name__=="__main__":
    main()
