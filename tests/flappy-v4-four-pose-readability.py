#!/usr/bin/env python3
"""Alpha45: genuine 4 x 24-frame atlas poses against unchanged background.

Reads only actually rendered Chrome PNGs: for both worlds and 320/390
viewports capture four real wing-atlas states and matching background
without bird. Tests differentiated, visually separated silhouette in
every pose, protected pipe/gap pixels, and strictly unchanged background
outside the original atlas rectangle. No fake illustrative sprite.
"""
from __future__ import annotations
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

POSES=("rest","power","recovery","glide")
SIZES=((320,568),(390,844))
WORLDS=("warm","slate")


def cropped(im,rect):
    w,h=im.size
    a,b,c,d=rect
    return im.crop((int(w*a),int(h*b),int(w*c),int(h*d))).convert("RGB")


def diff_count(a,b,minimum):
    d=ImageChops.difference(a.convert("RGB"),b.convert("RGB"))
    # Greater than threshold in *any* RGB channel, rather than relying
    # on luma alone (the wing may change hue without getting brighter).
    mask=d.convert("RGB").getchannel("R").point(
       lambda x: 255 if x>minimum else 0)
    for channel in ("G","B"):
        mask=ImageChops.lighter(mask,d.getchannel(channel).point(
            lambda x:255 if x>minimum else 0))
    return mask.histogram()[255]


def run(folder):
    metrics=[]
    for world in WORLDS:
        for width,height in SIZES:
            def path(pose):
                return folder/f"alpha45-actor-{world}-{pose}-{width}x{height}.png"
            with Image.open(path("clear")) as clear_img:
                clear=clear_img.convert("RGB")
            if clear.size!=(width,height):
                raise AssertionError("Alpha45 no-bird control viewport mismatch")
            birds={}
            for pose in POSES:
                with Image.open(path(pose)) as pose_img:
                    image=pose_img.convert("RGB")
                if image.size!=(width,height):
                    raise AssertionError(f"Actual Chrome atlas screenshot size mismatch: {world}/{pose}")
                # .bird original CSS: at x25%, y42%, width17.372%,
                # translate(-50%,-52.5%). The region includes +~8px of
                # tolerance for antialiasing / slight browser pixel rounding.
                region=(.14,.34,.36,.49)
                fg=cropped(image,region)
                bg=cropped(clear,region)
                # All pixels beyond bird's original position *must remain
                # unchanged*: original scenery/pipe unchanged even when
                # the frame changes. Detect accidental global CSS filters.
                clean=image.copy()
                bounds=(int(width*region[0]),int(height*region[1]),
                        int(width*region[2]),int(height*region[3]))
                clean.paste(bg,bounds[:2])
                if ImageChops.difference(clean,clear).getbbox() is not None:
                    raise AssertionError(f"Pose {world}/{pose} modified obstacle or scenery away from the bird")
                visible=diff_count(fg,bg,8)
                strong=diff_count(fg,bg,20)
                if visible<100 or strong<45:
                    raise AssertionError(f"Actual original bird frame lost visual separation: {world}/{pose} {width}px {visible=} {strong=}")
                # Keep original metallic pipes pixel-identical across all
                # poses at their actual Chrome-rendered locations.
                pipe=cropped(image,(.68,.63,.82,.80))
                prior=cropped(clear,(.68,.63,.82,.80))
                if ImageChops.difference(pipe,prior).getbbox() is not None:
                    raise AssertionError(f"Sprite posture unexpectedly altered obstacle: {world}/{pose}")
                birds[pose]=fg
                metrics.append({"world":world,"viewport":[width,height],
                   "pose":pose,"original_atlas_frame":{"rest":0,"power":6,"recovery":12,"glide":18}[pose],
                   "visible_bird_pixels_rgb_difference_gt8":visible,
                   "strong_bird_pixels_rgb_difference_gt20":strong,
                   "full_scene_outside_original_bird_bounds_pixel_identical":True,
                   "pipe_region_pixel_identical":True})
            for i,p in enumerate(POSES):
                for q in POSES[i+1:]:
                    changed=diff_count(birds[p],birds[q],8)
                    if changed<25:
                        raise AssertionError(f"Chrome did not select unique authored wing frames: {world} {width}px {p} vs {q}: {changed}")
    payload={"status":"ALPHA45_REAL_CHROME_ORIGINAL_24_FRAME_SPRITE_READABILITY",
       "scope":"2 worlds x 2 phone sizes x 4 real source atlas poses, plus separate no-bird background controls",
       "evidence_screenshots":20,"pose_evidence":metrics,
       "tested_frames":[0,6,12,18],
       "physical_device_signoff":False,
       "original_game_runtime_changed":False}
    (folder/"alpha45-actual-wing-readability.json").write_text(
         json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("ALPHA45 TRUE FOUR WING POSE REAL CHROME",json.dumps(payload,ensure_ascii=False))

if __name__=="__main__":
    root=Path(__file__).resolve().parent.parent
    run(root/"v4-art-qa")
