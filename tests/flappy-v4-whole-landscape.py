#!/usr/bin/env python3
"""Alpha40 genuinely different broad landform painting (two worlds, two depths).

Art source is four fully editable original 3200x2000 SVG masters. These replace
large triangular/faceted material groups with *authored broad curved washes*
and synchronized light/shadow gradients, not tiny procedural overlays.
Generate only Draft QA 1600x1000 RGBA studies. Preserve old RGB(A) tile
strips and sky, and preserve source alpha geometry exactly.
"""
from __future__ import annotations
import hashlib, io, json, sys, xml.etree.ElementTree as ET
from pathlib import Path
import cairosvg
from PIL import Image, ImageChops, ImageFilter

W,H,QUIET_EDGE,INNER_BLEND=1600,1000,40,16
SKY={"far":430,"mid":555}
NS="{http://www.w3.org/2000/svg}"
ALLOW={"svg","title","desc","defs","linearGradient","stop","clipPath","path","g"}
ATTR={"width","height","viewBox","role","aria-label","id",
      "x1","x2","y1","y2","offset","stop-color","stop-opacity",
      "d","fill","fill-opacity","stroke","stroke-opacity","stroke-width",
      "stroke-linecap","clip-path","data-alpha40-landform","data-alpha40-softlight"}
BASE={"far": "alpha39","mid":"alpha37"}
MARKS={"far":(9,6),"mid":(7,6)}


def original_art(path,depth,theme):
    raw=path.read_bytes()
    root=ET.fromstring(raw)
    if not 3500<len(raw)<25000 or root.attrib.get("viewBox")!="0 0 3200 2000":
        raise ValueError("Not a complete original 2x original landscape source")
    for e in root.iter():
        if e.tag.removeprefix(NS) not in ALLOW or any(k not in ATTR for k in e.attrib):
            raise ValueError("Unexpected or active SVG artwork markup")
    counts=tuple(len(root.findall(f".//{NS}path[@{tag}]")) for tag in
                 ("data-alpha40-landform","data-alpha40-softlight"))
    if counts!=MARKS[depth]:
        raise ValueError(f"{theme} {depth}: not all independently positioned washes present: {counts}")
    for name in ("alpha40-atmos-sun","alpha40-atmos-shade"):
        if root.find(f".//{NS}linearGradient[@id='{name}']") is None:
            raise ValueError("Original directional soft light gradient missing")
    if depth=="far":
        clip=root.find(f".//{NS}clipPath[@id='far-painted-terrain']/{NS}path")
        ground=root.find(f".//{NS}path[@id='far-painted-base']")
        ridge=root.find(f".//{NS}path[@id='dawn-ridge-edge']") if theme=="warm" else root.find(f".//{NS}path[@id='slate-ridge-edge']")
    else:
        clip=root.find(f".//{NS}clipPath[@id='mid-painted-clip']/{NS}path")
        ground=root.find(f".//{NS}path[@id='mid-painted-base']")
        ridge=root.find(f".//{NS}path[@id='mid-crest-highlight']")
    ending=" L3200 2000 L0 2000Z"
    if any(x is None for x in (clip,ground,ridge)):
        raise ValueError("Authoring source lost synchronized base/mask/ridge")
    d=ground.attrib.get("d","")
    if not d.endswith(ending) or clip.attrib.get("d")!=d or ridge.attrib.get("d")!=d[:-len(ending)]:
        raise ValueError("Handpaint changed source skyline/clip/rim consistency")
    return raw,counts


def render(raw):
    img=cairosvg.svg2png(bytestring=raw,output_width=W,output_height=H)
    return Image.open(io.BytesIO(img)).convert("RGBA")


def image_change(before,after):
    a,b=before.tobytes(),after.tobytes()
    return sum(1 for i in range(0,len(a),4)
               if a[i+3] and a[i:i+3]!=b[i:i+3])


def compose(root,theme,depth):
    source=root/f"flappy/assets/v4/masters/{theme}/{depth}-value-alpha40.svg"
    previous=root/f"flappy/assets/v4/pilot/{theme}/{depth}-raster-{BASE[depth]}.png"
    out=root/f"flappy/assets/v4/pilot/{theme}/{depth}-raster-alpha40.png"
    raw,marks=original_art(source,depth,theme)
    before=Image.open(previous).convert("RGBA")
    candidate=render(raw)
    if before.size!=(W,H) or candidate.size!=before.size:
        raise AssertionError("Wrong editable draft material size")
    # On the painted material: blend hard vector facet transitions into a
    # locally diffused, curved-value brush. Preserve the *exact* authored
    # original outer silhouette, unlike postprocessing whole screenshot.
    diffuse=candidate.filter(ImageFilter.GaussianBlur(7))
    result=Image.blend(candidate,diffuse,.32)
    # In transparent sky the RGBA *bytes*, not only alpha, must remain
    # original. Blur can leak hidden RGB into zero-alpha pixels.
    result=Image.composite(result,before,before.getchannel("A"))
    result.putalpha(before.getchannel("A"))
    result.paste(before.crop((0,0,W,SKY[depth])),(0,0))
    # Only source tile edge strips are preserved from previous QA candidate.
    # The 16px interior crossfade prevents obvious hard material boundaries.
    result.paste(before.crop((0,0,QUIET_EDGE,H)),(0,0))
    result.paste(before.crop((W-QUIET_EDGE,0,W,H)),(W-QUIET_EDGE,0))
    for x in list(range(QUIET_EDGE,QUIET_EDGE+INNER_BLEND))+list(
        range(W-QUIET_EDGE-INNER_BLEND,W-QUIET_EDGE)):
        weight=((x-QUIET_EDGE+1)/(INNER_BLEND+1) if x<W//2
                else (W-QUIET_EDGE-x)/(INNER_BLEND+1))
        old_col=before.crop((x,0,x+1,H))
        new_col=result.crop((x,0,x+1,H))
        result.paste(Image.blend(old_col,new_col,weight),(x,0))
    a,b=before.tobytes(),result.tobytes()
    if before.getchannel("A").tobytes()!=result.getchannel("A").tobytes():
        raise AssertionError("New original scene painting introduced sky/altered silhouette alpha")
    for y in range(H):
        row=y*W*4
        if y<SKY[depth] and a[row:row+W*4]!=b[row:row+W*4]:
            raise AssertionError("Original player/readable sky lane changed")
        for x1,x2 in ((row,row+QUIET_EDGE*4),
                      (row+(W-QUIET_EDGE)*4,row+W*4)):
            if a[x1:x2]!=b[x1:x2]:
                raise AssertionError("Mountain original repeat edges changed")
    changed=image_change(before,result)
    if not 18000<=changed<=950000:
        raise AssertionError(f"Material redesign too subtle or too disruptive: {theme}/{depth}: {changed}")
    out.parent.mkdir(parents=True,exist_ok=True)
    result.save(out,"PNG",optimize=True,compress_level=9)
    payload=out.read_bytes()
    if not 12000<len(payload)<4_000_000:
        raise AssertionError("Alpha40 mobile PNG candidate exceeds material budget")
    return {"theme":theme,"layer":depth,"status":"UNAPPROVED_DRAFT_WHOLE_PLANE_ART_STUDY",
            "source_3200x2000":str(source),
            "source_sha256":hashlib.sha256(raw).hexdigest(),
            "base_png":str(previous),"png":str(out),
            "png_size":len(payload),"png_sha256":hashlib.sha256(payload).hexdigest(),
            "source_broad_washes":marks[0],"original_gradient_softlight_paths":marks[1],
            "changed_visible_rgb_pixels":changed,
            "same_source_alpha_byte_for_byte":True,
            "unmodified_bird_sky_before_y":SKY[depth],
            "same_repeat_edge_source_rgba_px":QUIET_EDGE,
            "original_material_soft_feather_px":7,
            "game_runtime_swapped":False,"final_artist_approved":False}


def real_browser_diff(root):
    f=root/"v4-art-qa"
    results=[]
    for theme in ("warm","slate"):
        for depth in ("far","mid"):
            for w,h in ((320,568),(390,844)):
                old_ver=BASE[depth]
                old_name=(f"alpha39-far-{theme}-{w}x{h}.png" if depth=="far"
                          else f"alpha37-mid-{theme}-{w}x{h}.png")
                new_name=f"alpha40-{depth}-{theme}-{w}x{h}.png"
                with Image.open(f/old_name) as old, Image.open(f/new_name) as new:
                    if old.size!=(w,h) or new.size!=old.size:
                        raise AssertionError(f"Incorrect browser screenshot dimensions {new_name}")
                    diff=ImageChops.difference(old.convert("RGB"),new.convert("RGB"))
                    pixels=diff.convert("L").point(lambda x:255 if x>4 else 0).histogram()[255]
                    # Whole-plane painting must be clearly visible, not just
                    # one anti-aliased brush in the far distance.
                    if pixels<750:
                        raise AssertionError(f"New broad-value art not visible on phone: {new_name}, {pixels}")
                    results.append({"world":theme,"layer":depth,
                                    "screen":[w,h],"significantly_changed_browser_pixels":pixels})
    summary={"status":"REAL_MOBILE_DRAFT_COMPOSITION_AB","cases":results}
    (f/"alpha40-real-browser-ab.json").write_text(
        json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("ALPHA40 REAL WHOLE SCENE MOBILE A/B",summary)


def main():
    root=Path(__file__).resolve().parent.parent
    if sys.argv[1:]==["--verify-screens"]:
        real_browser_diff(root)
    elif len(sys.argv)==1:
        metrics=[compose(root,t,d) for t in ("warm","slate") for d in ("far","mid")]
        f=root/"v4-art-qa";f.mkdir(exist_ok=True)
        (f/"alpha40-landscape-metrics.json").write_text(
            json.dumps({"status":"DRAFT_FULL_VALUE_ART_NOT_PRODUCTION","assets":metrics},
                       ensure_ascii=False,indent=2)+"\n",encoding="utf8")
        for metric in metrics:print("ALPHA40 PAINTERLY LANDSCAPE",json.dumps(metric,ensure_ascii=False))
    else:
        raise SystemExit("usage: script [--verify-screens]")

if __name__=="__main__":
    main()
