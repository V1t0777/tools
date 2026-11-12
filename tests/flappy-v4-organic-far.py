#!/usr/bin/env python3
"""Alpha43: two independent full far-ridge natural material masters, Draft only."""
from __future__ import annotations
import hashlib,io,json,sys,xml.etree.ElementTree as ET
from pathlib import Path
import cairosvg
from PIL import Image,ImageChops,ImageFilter

W,H,SKY,EDGE,FEATHER=1600,1000,430,40,16
NS="{http://www.w3.org/2000/svg}"
SAFE={"svg","title","desc","defs","linearGradient","stop","clipPath","path","g"}
ATTR={"width","height","viewBox","role","aria-label","id","x1","x2",
      "y1","y2","offset","stop-color","stop-opacity","d","fill",
      "fill-opacity","stroke","stroke-opacity","stroke-width","stroke-linecap",
      "clip-path","data-alpha43-far-mass","data-alpha43-far-softlight",
      "data-alpha43-far-strata"}
EXPECTED={"data-alpha43-far-mass":8,"data-alpha43-far-softlight":6,
          "data-alpha43-far-strata":6}


def read(path,world):
    raw=path.read_bytes()
    svg=ET.fromstring(raw)
    if not 7000<len(raw)<18000 or svg.attrib.get("viewBox")!="0 0 3200 2000":
        raise ValueError("Alpha43 must be original full 2x editable scene")
    for node in svg.iter():
        if node.tag.removeprefix(NS) not in SAFE:
            raise ValueError("Active or unexpected SVG node")
        if any(key not in ATTR for key in node.attrib):
            raise ValueError("Unsafe SVG painted markup")
    base=svg.find(f".//{NS}path[@id='far-painted-base']")
    clip=svg.find(f".//{NS}clipPath[@id='far-painted-terrain']/{NS}path")
    rim=svg.find(f".//{NS}path[@id='{'dawn-ridge-edge' if world=='warm' else 'slate-ridge-edge'}']")
    end=" L3200 2000 L0 2000Z"
    if base is None or clip is None or rim is None:
        raise ValueError("Original painted ridge, fill or source mask missing")
    d=base.attrib.get("d","")
    if not d.endswith(end) or clip.attrib.get("d")!=d or rim.attrib.get("d")!=d[:-len(end)]:
        raise ValueError("Far mountain painted rim and source mask no longer aligned")
    counts={name:len(svg.findall(f".//{NS}path[@{name}]")) for name in EXPECTED}
    if counts!=EXPECTED or svg.find(f".//{NS}g[@id='alpha43-original-curvilinear-masses']") is None:
        raise ValueError(f"Unapproved/missing separately edited original organic mass set {counts}")
    for gradient in ("alpha43-bloom","alpha43-fold"):
        if svg.find(f".//{NS}linearGradient[@id='{gradient}']") is None:
            raise ValueError("True original luminous atmospheric gradient missing")
    return raw,d


def composite(root,world):
    source=root/f"flappy/assets/v4/masters/{world}/far-organic-alpha43.svg"
    original=root/f"flappy/assets/v4/masters/{world}/far-value-alpha40.svg"
    old=root/f"flappy/assets/v4/pilot/{world}/far-raster-alpha41.png"
    target=root/f"flappy/assets/v4/pilot/{world}/far-raster-alpha43.png"
    raw,contour=read(source,world)
    legacy=ET.fromstring(original.read_bytes()).find(f".//{NS}path[@id='far-painted-base']").attrib["d"]
    if legacy==contour:
        raise AssertionError("Mountain silhouette has not been redrawn")
    before=Image.open(old).convert("RGBA")
    candidate=Image.open(io.BytesIO(cairosvg.svg2png(
        bytestring=raw,output_width=W,output_height=H))).convert("RGBA")
    if before.size!=(W,H) or candidate.size!=before.size:
        raise AssertionError("Wrong source RGBA dimensions")
    # Soft material transitions are composited only into transient review PNG.
    softened=candidate.filter(ImageFilter.GaussianBlur(5))
    authored=Image.blend(candidate,softened,.23)
    authored.putalpha(candidate.getchannel("A"))
    out=authored.copy()
    out.paste(before.crop((0,0,W,SKY)),(0,0))
    out.paste(before.crop((0,0,EDGE,H)),(0,0))
    out.paste(before.crop((W-EDGE,0,W,H)),(W-EDGE,0))
    for x in list(range(EDGE,EDGE+FEATHER))+list(range(W-EDGE-FEATHER,W-EDGE)):
        t=((x-EDGE+1)/(FEATHER+1) if x<W//2 else (W-EDGE-x)/(FEATHER+1))
        out.paste(Image.blend(before.crop((x,0,x+1,H)),
                              authored.crop((x,0,x+1,H)),
                              max(0.,min(1.,t))),(x,0))
    a,b=before.tobytes(),out.tobytes()
    for y in range(H):
        begin=y*W*4
        if y<SKY and a[begin:begin+W*4]!=b[begin:begin+W*4]:
            raise AssertionError("Edited far sky intrudes on playable region")
        if a[begin:begin+EDGE*4]!=b[begin:begin+EDGE*4] or a[begin+(W-EDGE)*4:begin+W*4]!=b[begin+(W-EDGE)*4:begin+W*4]:
            raise AssertionError("Original repeated tile edges differ at RGBA byte level")
    changed=sum(1 for i in range(0,len(a),4) if a[i:i+4]!=b[i:i+4])
    added=sum(1 for i in range(3,len(a),4) if a[i]==0 and b[i]>0)
    removed=sum(1 for i in range(3,len(a),4) if a[i]>0 and b[i]==0)
    if not 100000<changed<1100000 or added<100 or removed<100:
        raise AssertionError(f"Original far organic scene not materially rebuilt {world} {changed=} {added=} {removed=}")
    if out.getbbox()[1]<SKY or out.getbbox()[3]!=H:
        raise AssertionError("Far original skyline/top or ground range violated")
    target.parent.mkdir(parents=True,exist_ok=True)
    out.save(target,"PNG",optimize=True,compress_level=9)
    png=target.read_bytes()
    if not 16000<len(png)<4000000:
        raise AssertionError("Draft mobile RGBA source file invalid")
    return {"theme":world,"status":"UNAPPROVED_DRAFT_ORIGINAL_FAR_LANDFORM",
        "editable_source":str(source),"original_source_sha256":hashlib.sha256(raw).hexdigest(),
        "previous_alpha41_source_rgba":str(old),"draft_png":str(target),
        "draft_png_sha256":hashlib.sha256(png).hexdigest(),
        "draft_png_bytes":len(png),"dimensions":[W,H],
        "organic_landforms":8,"curved_light_glazes":6,"broken_strata":6,
        "updated_pixel_rgba":changed,"new_skyline_alpha_pixels":added,
        "removed_skyline_alpha_pixels":removed,
        "mask_fill_crest_source_d_identical":True,
        "top_bird_sky_original_rgba_px":SKY,
        "both_tile_rgba_borders_preserved_px":EDGE,
        "interior_feather_px":FEATHER,
        "game_runtime_asset_swapped":False,"signed_off_native_painting":False}


def real_browser(root):
    folder=root/"v4-art-qa"
    comparison=[]
    for world in ("warm","slate"):
        for w,h in ((320,568),(390,844)):
            a=folder/f"alpha41-far-{world}-{w}x{h}.png"
            b=folder/f"alpha43-far-{world}-{w}x{h}.png"
            with Image.open(a) as legacy,Image.open(b) as revised:
                if legacy.size!=(w,h) or revised.size!=legacy.size:
                    raise AssertionError("Actual Chrome screenshot viewport mismatch")
                diff=ImageChops.difference(legacy.convert("RGB"),revised.convert("RGB"))
                count=diff.convert("L").point(lambda v:255 if v>4 else 0).histogram()[255]
                if count<2500:
                    raise AssertionError(f"Alpha43 actual phone change too subtle: {world} {w}x{h}={count}")
                comparison.append({"world":world,"viewport":[w,h],
                                   "actual_browser_changed_brightness_pixels_gt4":count})
    payload={"status":"ORIGINAL_FAR_A43_REAL_CHROME_A_B","cases":comparison}
    (folder/"alpha43-far-mobile-ab.json").write_text(
        json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("ALPHA43 REAL CHROME FAR ORGANIC",payload)


def main():
    root=Path(__file__).resolve().parent.parent
    if sys.argv[1:]==["--verify-screens"]:
        real_browser(root)
    elif len(sys.argv)==1:
        all_data=[composite(root,x) for x in ("warm","slate")]
        folder=root/"v4-art-qa";folder.mkdir(exist_ok=True)
        (folder/"alpha43-far-organic-metrics.json").write_text(
            json.dumps({"status":"DRAFT_ONLY","art":all_data},ensure_ascii=False,indent=2)+"\n",
            encoding="utf8")
        for obj in all_data: print("ALPHA43 SOURCE FAR ORGANIC",json.dumps(obj,ensure_ascii=False))
    else:
        raise SystemExit("usage: script [--verify-screens]")


if __name__=="__main__":
    main()
