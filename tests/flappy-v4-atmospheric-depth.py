#!/usr/bin/env python3
"""Alpha41 separately editable atmospheric perspective pigment over Alpha40.

Only short-lived Draft QA PNGs. Preserve exact Alpha40 RGBA alpha, top sky
band, repeated tile edges, geometry, score/physics and runtime isolation.
"""
from __future__ import annotations
import hashlib, io, json, sys
import xml.etree.ElementTree as ET
from pathlib import Path
import cairosvg
from PIL import Image, ImageChops, ImageFilter

NS="{http://www.w3.org/2000/svg}"
W,H,EDGE=1600,1000,40
SKY={"far":430,"mid":555}
ALLOWED={"svg","title","desc","defs","linearGradient","stop","g","path"}
ATTR={"width","height","viewBox","role","aria-label","id","x1","x2","y1","y2",
      "offset","stop-color","stop-opacity","d","fill","stroke","fill-opacity",
      "stroke-opacity","stroke-width","stroke-linecap","data-alpha41-airband",
      "data-alpha41-pigment"}


def verify_source(path):
    raw=path.read_bytes()
    svg=ET.fromstring(raw)
    if not 2500<len(raw)<12000 or svg.attrib.get("viewBox")!="0 0 3200 2000":
        raise ValueError("Alpha41 source not an editable 2x original painting")
    for element in svg.iter():
        if element.tag.removeprefix(NS) not in ALLOWED:
            raise ValueError("Active or unexpected original painting element")
        if any(a not in ATTR for a in element.attrib):
            raise ValueError("Unsafe or unexpected SVG attribute")
    bands=svg.findall(f".//{NS}path[@data-alpha41-airband]")
    pigments=svg.findall(f".//{NS}path[@data-alpha41-pigment]")
    if len(bands)!=2 or len(pigments)!=10:
        raise ValueError("Need 2 independent atmospheric regions and 10 rock scumble strokes")
    for gradient in ("atmo-haze","atmo-deep"):
        if svg.find(f".//{NS}linearGradient[@id='{gradient}']") is None:
            raise ValueError("Original editable direction-sensitive pigment gradient missing")
    return raw


def changed_rgb(a,b):
    rawA,rawB=a.tobytes(),b.tobytes()
    return sum(1 for i in range(0,len(rawA),4)
               if rawA[i+3] and rawA[i:i+3]!=rawB[i:i+3])


def paint(root,theme,layer):
    src=root/f"flappy/assets/v4/masters/{theme}/{layer}-atmos-alpha41.svg"
    old=root/f"flappy/assets/v4/pilot/{theme}/{layer}-raster-alpha40.png"
    dest=root/f"flappy/assets/v4/pilot/{theme}/{layer}-raster-alpha41.png"
    original=verify_source(src)
    with Image.open(old) as img: baseline=img.convert("RGBA")
    overlay=Image.open(io.BytesIO(cairosvg.svg2png(
        bytestring=original,output_width=W,output_height=H))).convert("RGBA")
    if baseline.size!=(W,H) or overlay.size!=baseline.size:
        raise AssertionError("Source resolution must be 1600x1000 RGBA")
    mask=baseline.getchannel("A")
    # Protected gameplay sky, tile join strips, and 12px smooth transition.
    mask.paste(0,(0,0,W,SKY[layer]))
    mask.paste(0,(0,0,EDGE,H))
    mask.paste(0,(W-EDGE,0,W,H))
    mask=ImageChops.multiply(mask,Image.new("L",(W,H),255))
    for x in list(range(EDGE,EDGE+12))+list(range(W-EDGE-12,W-EDGE)):
        weight=(x-EDGE+1)/13 if x<W//2 else (W-EDGE-x)/13
        # Avoid half-transparent seams: scale mask, not base PNG alpha.
        col=mask.crop((x,0,x+1,H)).point(
             lambda a,w=weight:int(a*max(0,min(1,w))))
        mask.paste(col,(x,0))
    overlay.putalpha(ImageChops.multiply(mask,overlay.getchannel("A")))
    edited=Image.alpha_composite(baseline,overlay)
    edited.putalpha(baseline.getchannel("A"))
    # Protect even hidden RGB bytes where old source is transparent.
    edited.paste(baseline.crop((0,0,W,SKY[layer])),(0,0))
    a,b=baseline.tobytes(),edited.tobytes()
    if baseline.getchannel("A").tobytes()!=edited.getchannel("A").tobytes():
        raise AssertionError("Original skyline alpha modified by material")
    for y in range(H):
        start=y*W*4
        if y<SKY[layer] and a[start:start+W*4]!=b[start:start+W*4]:
            raise AssertionError("Bird-visible sky was modified")
        if (a[start:start+EDGE*4]!=b[start:start+EDGE*4] or
            a[start+(W-EDGE)*4:start+W*4]!=b[start+(W-EDGE)*4:start+W*4]):
            raise AssertionError("Original tiled parallax edge modified")
    count=changed_rgb(baseline,edited)
    if not 4000<count<700000:
        raise AssertionError(f"Air-distance pigment effect invisible/excessive: {theme}/{layer}, {count}")
    if baseline.getbbox()!=edited.getbbox():
        raise AssertionError("Skyline bounding box changed")
    dest.parent.mkdir(parents=True,exist_ok=True)
    edited.save(dest,"PNG",optimize=True,compress_level=9)
    data=dest.read_bytes()
    if not 15000<len(data)<4000000:
        raise AssertionError("Original PNG exceeds lightweight mobile asset size guard")
    return {"world":theme,"layer":layer,"status":"ORIGINAL_EDITABLE_DRAFT_AIR_STUDY",
       "source":str(src),"source_sha256":hashlib.sha256(original).hexdigest(),
       "old_original_alpha40":str(old),"draft_png":str(dest),
       "png_sha256":hashlib.sha256(data).hexdigest(),"png_bytes":len(data),
       "source_author_painted_bands":2,"source_broken_pigment_strokes":10,
       "edited_source_visible_rgb_pixels":count,"source_alpha_byte_identical":True,
       "upper_sky_byte_identical_y":SKY[layer],"original_repeat_border_px":EDGE,
       "production_texture_changed":False,"final_artist_approved":False}


def verify_mobile(root):
    folder=root/"v4-art-qa"
    records=[]
    for theme in ("warm","slate"):
        for layer in ("far","mid"):
            for w,h in ((320,568),(390,844)):
                before=folder/f"alpha40-{layer}-{theme}-{w}x{h}.png"
                after=folder/f"alpha41-{layer}-{theme}-{w}x{h}.png"
                with Image.open(before) as x, Image.open(after) as y:
                    if x.size!=(w,h) or y.size!=x.size:
                        raise AssertionError("Incorrect real Chrome screenshot dimensions")
                    diff=ImageChops.difference(x.convert("RGB"),y.convert("RGB"))
                    n=diff.convert("L").point(lambda v:255 if v>4 else 0).histogram()[255]
                    if n<300:
                        raise AssertionError(f"Actual phone artwork too weak: {theme}/{layer} {w}x{h} {n}")
                    records.append({"world":theme,"depth":layer,"viewport":[w,h],
                        "changed_actual_browser_pixels_above_four":n})
    result={"status":"REAL_CHROME_AIR_PERSPECTIVE_AB_DRAFT","cases":records}
    (folder/"alpha41-real-chrome-ab.json").write_text(
        json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("ALPHA41 REAL MOBILE AIR A/B",result)


def main():
    root=Path(__file__).resolve().parent.parent
    if sys.argv[1:]==["--verify-screens"]:
        verify_mobile(root)
    elif len(sys.argv)==1:
        all_data=[paint(root,world,layer) for world in ("warm","slate")
                  for layer in ("far","mid")]
        folder=root/"v4-art-qa";folder.mkdir(exist_ok=True)
        (folder/"alpha41-atmospheric-metrics.json").write_text(json.dumps({
            "status":"DRAFT_ONLY_NOT_HANDPAINTED_NATIVE_MASTERS",
            "files":all_data},ensure_ascii=False,indent=2)+"\n",encoding="utf8")
        for result in all_data:print("ALPHA41 ORIGINAL AIR PIGMENT",json.dumps(result,ensure_ascii=False))
    else:
        raise SystemExit("usage: script [--verify-screens]")

if __name__=="__main__":
    main()
