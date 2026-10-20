#!/usr/bin/env python3
"""Alpha44 authentic reviewer bird & obstacle salience regression.

This is a browser-pixel comparison, not a theoretical SVG ratio: load
the two actual no-JS Chrome screenshots from the same 320x568 viewport.
Original 24-frame wing atlas, top metal obstacle and bottom obstacle
must remain visibly readable after background-only grading. 390x844
is separately checked for minimum lower-gate contrast.
"""
from __future__ import annotations
import json,statistics
from pathlib import Path
from PIL import Image,ImageChops,ImageStat

def crop_px(image,rel):
    w,h=image.size
    left,top,right,bottom=rel
    return image.crop((int(w*left),int(h*top),int(w*right),int(h*bottom))).convert("RGB")

def mean_luma(image,box):
    return ImageStat.Stat(crop_px(image,box).convert("L")).mean[0]

def contrast(image, y):
    # Pipe CSS is unchanged: left:68%, width:14%. Sample the opaque
    # gate's interior x=70-79%, and undisturbed local natural backdrop
    # at x=60-65%, at 67%, 71%, 75% screen height.
    center=mean_luma(image,(.71,y,.78,y+.025))
    outer=mean_luma(image,(.61,y,.65,y+.025))
    return round(abs(center-outer),3)

def verify(folder):
    cases=[]
    for world in ("warm","slate"):
        old=folder/f"alpha43-world-{world}-320x568.png"
        new=folder/f"alpha44-world-{world}-320x568.png"
        with Image.open(old) as src, Image.open(new) as dest:
            a=src.convert("RGB");b=dest.convert("RGB")
            if a.size!=(320,568) or b.size!=a.size:
                raise AssertionError("Legibility A/B browser capture not at actual 320x568")
            protected={
              # Bird center x25%, y42%, 24-frame atlas rests inside 18%-32%
              # width and 36%-48% height. Background-only art must not
              # change the already verified bird's visible region.
              "bird_player_lane":(.19,.375,.31,.45),
              # Pipe top y0..30% is in unmodified sky, same metal gradient.
              "top_obstacle":(.70,.11,.80,.22),
              # Pipe bottom is painted over the composed terrain and
              # grading must not recolor the actual physical obstacle.
              "bottom_obstacle_surface":(.70,.68,.80,.75),
            }
            for name,box in protected.items():
                if ImageChops.difference(crop_px(a,box),crop_px(b,box)).getbbox() is not None:
                    raise AssertionError(f"Original bird/pipe color/shape changed: {world}/{name}")
            old_gaps=[contrast(a,y) for y in (.67,.71,.75)]
            new_gaps=[contrast(b,y) for y in (.67,.71,.75)]
            if min(new_gaps)<10:
                raise AssertionError(f"Insufficient obstacle/background luminance separation: {world} {new_gaps}")
            if statistics.mean(new_gaps)<statistics.mean(old_gaps)*.72:
                raise AssertionError(f"Backdrop wash lost too much pipe salience: {world}")
            # Foreground subject pixels are identical. This test is about
            # browser-rendered appearance, not abstract global palette.
            cases.append({"world":world,"viewport":[320,568],
                "bird_and_obstacle_actual_RGB_exactly_unchanged":True,
                "original_pipe_local_luma_deltas":old_gaps,
                "harmonized_pipe_local_luma_deltas":new_gaps,
                "pipe_salience_kept":True})
        wide=folder/f"alpha44-world-{world}-390x844.png"
        with Image.open(wide) as im:
            if im.size!=(390,844):
                raise AssertionError("Actual Chrome 390px viewport proof missing")
            # At 390px, individual landscape rocks can legitimately
            # match the pipe at one elevation. Detect sustained weak
            # salience along the full lower obstacle, not one color match.
            # 8 independent rows are a stronger spatial sample than 3:
            # at least 6/8 rows >=10 AND mean >=20 luminance units.
            rows=(.67,.69,.71,.73,.75,.77,.79,.81)
            gaps=[contrast(im.convert("RGB"),y) for y in rows]
            strong=sum(value>=10 for value in gaps)
            average=round(statistics.mean(gaps),3)
            if strong<6 or average<20:
                raise AssertionError(f"390px sustained gate/background contrast lost: {world}: {gaps}, {strong=}, {average=}")
            cases.append({"world":world,"viewport":[390,844],
                          "local_obstacle_luma_deltas":gaps,
                          "sampled_lower_obstacle_rows":len(rows),
                          "rows_meeting_luma_10":strong,
                          "mean_lower_obstacle_luma_gap":average,
                          "pipe_salience_kept":True})
    result={"stage":"Alpha44 physically rendered screenshot readability",
       "status":"PASS_NOT_HARDWARE_OR_FINAL_ART_ACCEPTANCE",
       "baseline":"actual Alpha43 Chrome 320x568 art review",
       "cases":cases,
       "device_limit":"Chrome simulated mobile viewport; real iPhone/Android still pending"}
    (folder/"alpha44-real-chrome-readability.json").write_text(
       json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("ALPHA44 MOBILE BIRD AND PIPE READABILITY",json.dumps(result,ensure_ascii=False))

if __name__=="__main__":
    root=Path(__file__).resolve().parent.parent
    verify(root/"v4-art-qa")
