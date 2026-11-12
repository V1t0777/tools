#!/usr/bin/env python3
"""Alpha42: original rebuilt blue-hour midrange crest and curved landform paint.

Creates only a Draft QA 1600x1000 RGBA bitmap. Editing 3200x2000 SVG
reworks *both* the skyline, its crop mask, the rim and interior materials.
Unlike Alpha41 study alpha, the actual skyline must change. Protect
top bird-sky rows and first/last 40px RGBA repeating edges exactly.
"""
from __future__ import annotations
import hashlib, io, json, sys, xml.etree.ElementTree as ET
from pathlib import Path
import cairosvg
from PIL import Image, ImageChops, ImageFilter

W,H,SAFE_SKY,EDGE,BLEND=1600,1000,555,40,16
NS="{http://www.w3.org/2000/svg}"
ELEMENTS={"svg","title","desc","defs","linearGradient","stop","clipPath","path","g"}
ATTRS={"width","height","viewBox","role","aria-label","id",
 "x1","x2","y1","y2","offset","stop-color","stop-opacity",
 "d","fill","fill-opacity","stroke","stroke-opacity","stroke-width",
 "stroke-linecap","opacity","clip-path","data-alpha42-mass",
 "data-alpha42-glaze","data-alpha42-strata"}


def read_source(path):
    raw=path.read_bytes()
    svg=ET.fromstring(raw)
    if not 6500<len(raw)<25000 or svg.attrib.get("viewBox")!="0 0 3200 2000":
        raise ValueError("Alpha42 not a full 2x editable blue-hour scene")
    for e in svg.iter():
        if e.tag.removeprefix(NS) not in ELEMENTS or any(k not in ATTRS for k in e.attrib):
            raise ValueError("Unsafe or noneditable original painting markup")
    base=svg.find(f".//{NS}path[@id='mid-painted-base']")
    clip=svg.find(f".//{NS}clipPath[@id='mid-painted-clip']/{NS}path")
    edge=svg.find(f".//{NS}path[@id='mid-crest-highlight']")
    ending=" L3200 2000 L0 2000Z"
    if base is None or clip is None or edge is None:
        raise ValueError("Original midrange terrain/rim/clip absent")
    path_d=base.attrib.get("d","")
    if not path_d.endswith(ending) or clip.attrib.get("d")!=path_d or edge.attrib.get("d")!=path_d[:-len(ending)]:
        raise ValueError("Reauthored skyline, clip and crest edge diverged")
    marked={}
    for label,count in (("data-alpha42-mass",8),("data-alpha42-glaze",4),
                        ("data-alpha42-strata",7)):
        nodes=svg.findall(f".//{NS}path[@{label}]")
        if len(nodes)!=count:
            raise ValueError(f"Missing distinct material paths {label}: {len(nodes)}")
        marked[label]=len(nodes)
    if svg.find(f".//{NS}g[@id='alpha42-scene-repaint']") is None:
        raise ValueError("Missing independent scene material editing group")
    for grad in ("alpha42-air-distance","alpha42-low-valley","alpha42-moon-veil"):
        if svg.find(f".//{NS}linearGradient[@id='{grad}']") is None:
            raise ValueError("Original valley directed material gradient absent")
    return raw,path_d,marked


def paint(root):
    source=root/"flappy/assets/v4/masters/slate/mid-organic-alpha42.svg"
    old_paint=root/"flappy/assets/v4/masters/slate/mid-value-alpha40.svg"
    old_png=root/"flappy/assets/v4/pilot/slate/mid-raster-alpha41.png"
    output=root/"flappy/assets/v4/pilot/slate/mid-raster-alpha42.png"
    raw,crest,marks=read_source(source)
    old_svg=ET.fromstring(old_paint.read_bytes())
    prior=old_svg.find(f".//{NS}path[@id='mid-painted-base']").attrib["d"]
    if prior==crest:
        raise AssertionError("Alpha42 has not actually revised the geometric ridge")
    before=Image.open(old_png).convert("RGBA")
    raster=cairosvg.svg2png(bytestring=raw,output_width=W,output_height=H)
    fresh=Image.open(io.BytesIO(raster)).convert("RGBA")
    if before.size!=(W,H) or fresh.size!=before.size:
        raise AssertionError("Original and revised scene must raster to 1600x1000")
    blur=fresh.filter(ImageFilter.GaussianBlur(5))
    result=Image.blend(fresh,blur,.2)
    # Keep new alpha of redesigned natural crest. No change to gameplay sky.
    result.putalpha(fresh.getchannel("A"))
    result.paste(before.crop((0,0,W,SAFE_SKY)),(0,0))
    # Original tile boundaries and 16px interior soft material transition.
    authored=result.copy()
    result.paste(before.crop((0,0,EDGE,H)),(0,0))
    result.paste(before.crop((W-EDGE,0,W,H)),(W-EDGE,0))
    for x in list(range(EDGE,EDGE+BLEND))+list(range(W-EDGE-BLEND,W-EDGE)):
        w=((x-EDGE+1)/(BLEND+1) if x<W//2 else
           (W-EDGE-x)/(BLEND+1))
        base_col=before.crop((x,0,x+1,H))
        new_col=authored.crop((x,0,x+1,H))
        result.paste(Image.blend(base_col,new_col,max(0,min(1,w))),(x,0))
    old,new=before.tobytes(),result.tobytes()
    for y in range(H):
        lo=y*W*4
        if y<SAFE_SKY and old[lo:lo+4*W]!=new[lo:lo+4*W]:
            raise AssertionError("Source changed protected bird gameplay sky")
        if (old[lo:lo+EDGE*4]!=new[lo:lo+EDGE*4] or
           old[lo+(W-EDGE)*4:lo+4*W]!=new[lo+(W-EDGE)*4:lo+4*W]):
            raise AssertionError("Tiled scene lost original byte-identical edges")
    changed=sum(1 for i in range(0,len(old),4) if old[i:i+4]!=new[i:i+4])
    added=sum(1 for i in range(3,len(old),4) if old[i]==0 and new[i]>0)
    removed=sum(1 for i in range(3,len(old),4) if old[i]>0 and new[i]==0)
    if not 75000<=changed<=900000 or added<200 or removed<100:
        raise AssertionError(f"Authored organic shape insufficient or excessive {changed=} {added=} {removed=}")
    if result.getbbox()[1]<SAFE_SKY or result.getbbox()[3]!=H:
        raise AssertionError("Revised ridge leaks sky or loses the lower painted mountain")
    output.parent.mkdir(parents=True,exist_ok=True)
    result.save(output,"PNG",compress_level=9,optimize=True)
    data=output.read_bytes()
    if not 16000<len(data)<4_000_000:
        raise AssertionError("Mobile original scene transparent PNG budget invalid")
    return {"status":"DRAFT_REAUTHORED_SLATE_MID_NOT_NATIVE_MASTER",
      "original_editable_source":str(source),"original_sha256":hashlib.sha256(raw).hexdigest(),
      "retained_original_alpha41_png":str(old_png),
      "draft_png":str(output),"png_bytes":len(data),
      "png_sha256":hashlib.sha256(data).hexdigest(),
      "source_art_path_counts":marks,"synchronized_crest_clip_and_base":True,
      "changed_original_rgba_pixels":changed,
      "new_organic_skyline_alpha_pixels":added,
      "removed_geometric_skyline_alpha_pixels":removed,
      "upper_game_sky_rgba_byte_identical_y":SAFE_SKY,
      "repeat_borders_rgba_byte_identical_px":EDGE,
      "painted_landform_material_transition_px":BLEND,
      "changes_game_runtime":False,"approved_final_native_art":False}


def verify_browser(root):
    folder=root/"v4-art-qa"
    cases=[]
    for width,height in ((320,568),(390,844)):
        original=folder/f"alpha41-mid-slate-{width}x{height}.png"
        changed=folder/f"alpha42-mid-slate-{width}x{height}.png"
        with Image.open(original) as a,Image.open(changed) as b:
            if a.size!=(width,height) or b.size!=a.size:
                raise AssertionError("Alpha42 actual Chrome picture viewport mismatch")
            diff=ImageChops.difference(a.convert("RGB"),b.convert("RGB"))
            pixels=diff.convert("L").point(lambda p:255 if p>4 else 0).histogram()[255]
            if pixels<2500:
                raise AssertionError(f"Slate alpha42 changed too few visible Chrome pixels: {width}x{height}, {pixels}")
            cases.append({"viewport":[width,height],"real_mobile_changed_luminance_pixels_gt4":pixels})
    payload={"status":"REAL_CHROME_SLATE_MID_ORGANIC_REBUILD_AB",
             "cases":cases}
    (folder/"alpha42-slate-mobile-ab.json").write_text(
        json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("ALPHA42 REAL CHROME SLATE MID REBUILD",payload)


def main():
    root=Path(__file__).resolve().parent.parent
    if sys.argv[1:]==["--verify-screens"]:
        verify_browser(root)
    elif len(sys.argv)==1:
        payload=paint(root)
        folder=root/"v4-art-qa";folder.mkdir(exist_ok=True)
        (folder/"alpha42-slate-organic-metrics.json").write_text(
            json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print("ALPHA42 ORIGINAL SLATE ORGANIC",json.dumps(payload,ensure_ascii=False))
    else:
        raise SystemExit("usage: script [--verify-screens]")


if __name__=="__main__":
    main()
