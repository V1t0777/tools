#!/usr/bin/env python3
"""Alpha44: original per-world, per-depth painterly light coherence.

Two original 2x editable 3200x2000 SVG sources contain separately editable
far/mid/near paint groups. Render each individually, mask precisely to the
original prior RGBA, preserve top playable sky and 40px panorama joins.
The six new bitmaps exist in ephemeral Draft QA only, NOT public runtime.
"""
from __future__ import annotations
import copy,hashlib,io,json,sys,xml.etree.ElementTree as ET
from pathlib import Path
import cairosvg
from PIL import Image,ImageChops

W,H,EDGE=1600,1000,40
SKY={"far":430,"mid":555,"near":665}
BASE={
 "warm":{"far":"far-raster-alpha43.png","mid":"mid-raster-alpha41.png","near":"near-raster-alpha36.png"},
 "slate":{"far":"far-raster-alpha43.png","mid":"mid-raster-alpha42.png","near":"near-raster-alpha36.png"}
}
NS="{http://www.w3.org/2000/svg}"
TAGS={"svg","title","desc","defs","linearGradient","stop","g","path"}
ATTR={"width","height","viewBox","role","aria-label","id","x1","x2","y1","y2",
      "offset","stop-color","stop-opacity","d","fill","fill-opacity",
      "data-alpha44-depth","data-alpha44-tone","data-alpha44-layer"}


def source(path):
    raw=path.read_bytes()
    root=ET.fromstring(raw)
    if not 4300<len(raw)<11000 or root.attrib.get("viewBox")!="0 0 3200 2000":
        raise ValueError("Alpha44 requires editable original 2x scene art")
    for node in root.iter():
        if node.tag.removeprefix(NS) not in TAGS or any(k not in ATTR for k in node.attrib):
            raise ValueError("Unexpected or active SVG art node")
    groups={}
    for depth in ("far","mid","near"):
        group=root.find(f".//{NS}g[@id='depth-{depth}']")
        if group is None or group.attrib.get("data-alpha44-layer")!=depth:
            raise ValueError(f"No individually editable {depth} art group")
        strokes=group.findall(f"{NS}path")
        if len(strokes)!=3 or len({x.attrib.get("data-alpha44-tone") for x in strokes})!=3:
            raise ValueError(f"Original {depth} has missing tonal hand-drawn marks")
        if any(n.attrib.get("data-alpha44-depth")!=depth for n in strokes):
            raise ValueError("Art depth groups are mixed")
        groups[depth]=group
        for gradient in (f"{depth}-atmos",f"{depth}-fold"):
            if root.find(f".//{NS}linearGradient[@id='{gradient}']") is None:
                raise ValueError("Expected independently authored light-gradient missing")
    return raw,root,groups


def layer_raster(root,group):
    empty=ET.Element(f"{NS}svg",{
       "width":"3200","height":"2000","viewBox":"0 0 3200 2000"})
    defs=root.find(f"{NS}defs")
    if defs is None:raise ValueError("Gradient definitions missing")
    empty.append(copy.deepcopy(defs))
    empty.append(copy.deepcopy(group))
    rendered=cairosvg.svg2png(bytestring=ET.tostring(empty,encoding="utf-8"),
                              output_width=W,output_height=H)
    return Image.open(io.BytesIO(rendered)).convert("RGBA")


def composite(root,world,depth,art_root,group,source_hash):
    file=root/f"flappy/assets/v4/pilot/{world}/{BASE[world][depth]}"
    out=root/f"flappy/assets/v4/pilot/{world}/{depth}-raster-alpha44.png"
    base=Image.open(file).convert("RGBA")
    overlay=layer_raster(art_root,group)
    if base.size!=(W,H) or overlay.size!=base.size:
        raise AssertionError("2x editable original painted layer output dimensions wrong")
    original_alpha=base.getchannel("A")
    mask=original_alpha.copy()
    mask.paste(0,(0,0,W,SKY[depth]))
    mask.paste(0,(0,0,EDGE,H))
    mask.paste(0,(W-EDGE,0,W,H))
    for x in list(range(EDGE,EDGE+16))+list(range(W-EDGE-16,W-EDGE)):
        t=((x-EDGE+1)/17 if x<W//2 else (W-EDGE-x)/17)
        mask.paste(mask.crop((x,0,x+1,H)).point(lambda v,t=t:int(v*max(0,min(t,1)))),
                   (x,0))
    overlay.putalpha(ImageChops.multiply(overlay.getchannel("A"),mask))
    new=Image.alpha_composite(base,overlay)
    new.putalpha(original_alpha)
    # Explicitly restore hidden RGB bytes in untouched sky; source alpha
    # must stay the same for all scenes, unlike Alpha43 terrain repaint.
    new.paste(base.crop((0,0,W,SKY[depth])),(0,0))
    before,after=base.tobytes(),new.tobytes()
    if base.getchannel("A").tobytes()!=new.getchannel("A").tobytes():
        raise AssertionError("Alpha44 changes the approved pilot skyline geometry")
    for y in range(H):
        i=y*W*4
        if y<SKY[depth] and before[i:i+W*4]!=after[i:i+W*4]:
            raise AssertionError("Background grading altered bird sky safe area")
        if (before[i:i+EDGE*4]!=after[i:i+EDGE*4]
            or before[i+(W-EDGE)*4:i+W*4]!=after[i+(W-EDGE)*4:i+W*4]):
            raise AssertionError("Background grade broke duplicated source tile edges")
    changed=sum(1 for i in range(0,len(before),4) if before[i+3]!=0 and before[i:i+3]!=after[i:i+3])
    if not 1900<=changed<=600000:
        raise AssertionError(f"Original cohesive pigment too weak/strong: {world}/{depth}: {changed}")
    out.parent.mkdir(parents=True,exist_ok=True)
    new.save(out,"PNG",optimize=True,compress_level=9)
    payload=out.read_bytes()
    if not 10000<len(payload)<4000000:
        raise AssertionError("Temporary Alpha44 PNG exceeds 4MB mobile budget")
    return {"world":world,"layer":depth,"source_original_sha256":source_hash,
      "prior_original_rgba":str(file),"draft_png":str(out),
      "draft_png_sha256":hashlib.sha256(payload).hexdigest(),
      "png_bytes":len(payload),"changed_visible_rgb_pixels":changed,
      "source_original_alpha_byte_identical":True,
      "gameplay_sky_unchanged_to_y":SKY[depth],
      "both_panorama_tile_edges_original_rgba_px":EDGE,
      "editable_authored_pigment_shapes":3,
      "live_runtime_asset_swapped":False,"final_artist_approval":False}


def validate_real_chrome(root):
    folder=root/"v4-art-qa"
    from PIL import ImageChops
    results=[]
    for world in ("warm","slate"):
        for w,h in ((320,568),(390,844)):
            old=folder/f"alpha43-world-{world}-320x568.png"
            fresh=folder/f"alpha44-world-{world}-{w}x{h}.png"
            # Previous integrated scene was captured only at 320px.
            # Compare real 320px pixels; 390px version has independent dimensions check.
            with Image.open(fresh) as image:
                if image.size!=(w,h):
                    raise AssertionError("Whole world Chrome viewport mismatch")
                if w==320:
                    with Image.open(old) as before:
                        if before.size!=image.size:raise AssertionError("World A/B sizes mismatch")
                        diff=ImageChops.difference(before.convert("RGB"),image.convert("RGB"))
                        n=diff.convert("L").point(lambda v:255 if v>4 else 0).histogram()[255]
                        if n<250 or n>60000:
                            raise AssertionError(f"Scene grade invisible/overdone in {world}: {n}")
                        results.append({"world":world,"viewport":[w,h],
                                        "significantly_changed_browser_pixels":n})
                else:
                    results.append({"world":world,"viewport":[w,h],
                                    "real_browser_dimensions_verified":True})
    data={"stage":"Alpha44 Draft holistic art cohesion","cases":results}
    (folder/"alpha44-real-world-ab.json").write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("ALPHA44 REAL BROWSER WORLD A/B",json.dumps(data,ensure_ascii=False))


def main():
    root=Path(__file__).resolve().parent.parent
    if sys.argv[1:]==["--verify-screens"]:
        validate_real_chrome(root)
    elif len(sys.argv)==1:
        records=[]
        for world in ("warm","slate"):
            src=root/f"flappy/assets/v4/masters/{world}/depth-harmony-alpha44.svg"
            raw,doc,groups=source(src)
            digest=hashlib.sha256(raw).hexdigest()
            for depth in ("far","mid","near"):
                records.append(composite(root,world,depth,doc,groups[depth],digest))
        folder=root/"v4-art-qa";folder.mkdir(exist_ok=True)
        (folder/"alpha44-cohesion-metrics.json").write_text(json.dumps({
          "status":"DRAFT_ORIGINAL_EDITABLE_VECTOR_COHESION_STUDIES_ONLY",
          "layers":records},ensure_ascii=False,indent=2)+"\n",encoding="utf8")
        for row in records:print("ALPHA44 COHERENT ORIGINAL PLANES",json.dumps(row,ensure_ascii=False))
    else:raise SystemExit("usage: script [--verify-screens]")


if __name__=="__main__":
    main()
