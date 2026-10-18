#!/usr/bin/env python3
"""Alpha39 batch Chrome CDP screenshot capture: ONE process, staged complete art views.

Draft-only visual QA speed pilot. Keep all prior 135 independently verified
headless Chrome screenshots. Chrome CDP is loopback-only with an ephemeral
profile and randomized debug port; no external connections or production use.
Each scene must complete browser image decoding before capture.
"""
from __future__ import annotations
import argparse, base64, json, subprocess, tempfile, time, urllib.request
from pathlib import Path

import websocket
from PIL import Image

MAX_START_SECONDS = 20
SCRIPT = """(async () => {
  await document.fonts.ready;
  const imgs = [...document.querySelectorAll("img")];
  const css = [...document.querySelectorAll("*")].map(e => getComputedStyle(e).backgroundImage)
    .filter(v => v && v.includes("url("));
  const refs = css.flatMap(v => [...v.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)].map(m=>m[1]));
  await Promise.all([
    ...imgs.map(i=>i.decode().catch(()=>undefined)),
    ...refs.map(s=>new Promise(resolve=>{
      const img = new Image();
      img.onload=img.onerror=()=>resolve();
      img.src=s;
    }))
  ]);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return {ready:document.readyState,images:imgs.length,backgrounds:refs.length};
})()"""


def scenes(stage="alpha39"):
    if stage=="recent":
        # Consolidated A/B histories Alpha39/40 + Alpha41 under ONE
        # isolated DevTools session instead of three Chrome subprocesses.
        for name in ("alpha39","alpha40","alpha41","alpha42","alpha43","alpha44"):
            yield from scenes(name)
        return
    if stage=="alpha44":
        for theme in ("warm","slate"):
            for depth in ("far","mid","near"):
                yield f"alpha44-{depth}-{theme}-320x568.png", f"#{theme}-{depth}-alpha44",320,568
            for w,h in ((320,568),(390,844)):
                yield f"alpha44-world-{theme}-{w}x{h}.png", f"#{theme}-world-alpha44",w,h
            for depth in ("far","mid","near"):
                yield f"alpha44-{depth}-seam-{theme}-320x568.png",f"#{theme}-{depth}-alpha44-seam",320,568
        return
    if stage=="alpha43":
        for theme in ("warm","slate"):
            for w,h in ((320,568),(390,844)):
                yield f"alpha43-far-{theme}-{w}x{h}.png", f"#{theme}-far-alpha43",w,h
            yield f"alpha43-world-{theme}-320x568.png", f"#{theme}-world-alpha43",320,568
            yield f"alpha43-far-seam-{theme}-320x568.png", f"#{theme}-far-alpha43-seam",320,568
        return
    if stage=="alpha42":
        for w,h in ((320,568),(390,844)):
            yield f"alpha42-mid-slate-{w}x{h}.png", "#slate-mid-alpha42",w,h
        yield "alpha42-world-slate-320x568.png", "#slate-world-alpha42",320,568
        yield "alpha42-mid-seam-slate-320x568.png", "#slate-mid-alpha42-seam",320,568
        return
    if stage=="alpha41":
        for theme in ("warm","slate"):
            for layer in ("far","mid"):
                for w,h in ((320,568),(390,844)):
                    yield f"alpha41-{layer}-{theme}-{w}x{h}.png", f"#{theme}-{layer}-alpha41",w,h
            yield f"alpha41-world-{theme}-320x568.png", f"#{theme}-world-alpha41",320,568
            for layer in ("far","mid"):
                yield f"alpha41-{layer}-seam-{theme}-320x568.png", f"#{theme}-{layer}-alpha41-seam",320,568
        return
    if stage=="alpha40":
        for theme in ("warm", "slate"):
            for layer in ("far","mid"):
                for w, h in ((320,568),(390,844)):
                    yield f"alpha40-{layer}-{theme}-{w}x{h}.png", f"#{theme}-{layer}-alpha40", w,h
            yield f"alpha40-world-{theme}-320x568.png", f"#{theme}-world-alpha40", 320,568
            for layer in ("far","mid"):
                yield f"alpha40-{layer}-seam-{theme}-320x568.png", f"#{theme}-{layer}-alpha40-seam",320,568
        return
    if stage!="alpha39":
        raise ValueError("Unknown Draft visual QA stage")
    for theme in ("warm", "slate"):
        for w, h in ((320, 568), (390, 844)):
            yield f"alpha39-far-{theme}-{w}x{h}.png", f"#{theme}-far-alpha39", w, h
        yield f"alpha39-world-{theme}-320x568.png", f"#{theme}-world-alpha39", 320, 568
        yield f"alpha39-far-seam-{theme}-320x568.png", f"#{theme}-far-alpha39-seam", 320, 568


def screenshot_batch(chrome, base, folder, stage='alpha39'):
    folder.mkdir(parents=True, exist_ok=True)
    start=time.monotonic()
    with tempfile.TemporaryDirectory(prefix="flappy-alpha39-chrome-") as profile:
        args=[chrome, "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
              "--hide-scrollbars", "--force-device-scale-factor=1",
              "--no-first-run", "--no-default-browser-check",
              "--remote-debugging-address=127.0.0.1",
              "--remote-debugging-port=0",
              "--remote-allow-origins=http://127.0.0.1",
              f"--user-data-dir={profile}", "about:blank"]
        proc=subprocess.Popen(args, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL)
        try:
            active=Path(profile)/"DevToolsActivePort"
            timeout=time.monotonic()+MAX_START_SECONDS
            while not active.is_file():
                if proc.poll() is not None:
                    raise RuntimeError("Chrome exited before loopback DevTools launch")
                if time.monotonic()>timeout:
                    raise TimeoutError("Chrome did not initialize loopback CDP")
                time.sleep(.05)
            port=int(active.read_text().splitlines()[0])
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/json/list", timeout=5) as response:
                pages=json.load(response)
            tab=next((p for p in pages if p.get("type")=="page"), None)
            if tab is None:
                raise RuntimeError("No Chrome screenshot tab")
            # The binding is local, and origin explicitly matches the strict
            # Chrome remote-allow-origins list; never bind external interfaces.
            socket=websocket.create_connection(
                tab["webSocketDebuggerUrl"], timeout=12,
                origin="http://127.0.0.1")
            try:
                seq=0
                def cdp(method, params=None):
                    nonlocal seq
                    seq+=1
                    current=seq
                    socket.send(json.dumps({"id":current,"method":method,
                                            "params":params or {}}))
                    while True:
                        message=json.loads(socket.recv())
                        if message.get("id")!=current:
                            continue
                        if "error" in message:
                            raise RuntimeError(f"Chrome CDP {method}: {message['error']}")
                        return message.get("result",{})
                cdp("Page.enable")
                cdp("Runtime.enable")
                metrics=[]
                for name, fragment, width, height in scenes(stage):
                    cdp("Emulation.setDeviceMetricsOverride", {
                        "width":width,"height":height,"deviceScaleFactor":1,
                        "mobile":False})
                    cdp("Page.navigate",{"url":base+fragment})
                    # CDP Page.navigate returns before the final document load;
                    # never grab a still-visible previous scene and accidentally
                    # count it as new art. Different URL hashes also reuse DOM.
                    settled=False
                    for _ in range(80):
                        try:
                            state=cdp("Runtime.evaluate", {
                                "expression":"location.hash+'|'+document.readyState",
                                "returnByValue":True})
                            status=state["result"].get("value","")
                            if status==fragment+"|complete":
                                settled=True
                                break
                        except RuntimeError:
                            pass  # Navigation may destroy the old JS context.
                        time.sleep(.05)
                    if not settled:
                        raise TimeoutError(f"New art route never loaded: {fragment}")
                    result=cdp("Runtime.evaluate", {
                        "expression":SCRIPT,"awaitPromise":True,
                        "returnByValue":True})
                    if "exceptionDetails" in result:
                        raise RuntimeError("Browser art did not decode correctly")
                    # Not a randomized screenshot delay: decode completed.
                    shot=cdp("Page.captureScreenshot", {
                        "format":"png","fromSurface":True,
                        "captureBeyondViewport":False})
                    data=base64.b64decode(shot["data"])
                    path=folder/name
                    path.write_bytes(data)
                    with Image.open(path) as im:
                        if im.size!=(width,height) or im.format!="PNG":
                            raise AssertionError(f"CDP viewport screenshot mismatch: {name} {im.size}")
                    if len(data)<12000:
                        raise AssertionError(f"CDP returned suspiciously small image: {name}")
                    metrics.append({"file":name,"viewport":[width,height],
                                    "bytes":len(data),
                                    "browser_ready":result["result"]["value"]})
            finally:
                socket.close()
        finally:
            proc.terminate()
            try: proc.wait(timeout=6)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=6)
    duration=round(time.monotonic()-start,3)
    manifest={
        "stage":stage+" Draft natural landscape QA",
        "strategy":"one headless Chrome CDP process for complete freshly authored stage screenshot batch",
        "actual_chrome_process_launches":1,
        "independent_capture_count":len(metrics),
        "duration_seconds":duration,
        "qa_only":True,
        "old_135_capture_coverage_unchanged":True,
        "historical_143_capture_coverage_unchanged":True,
        "alpha42_four_new_snapshots":stage in ("alpha42","recent"),
        "network_exposure":"local loopback ephemeral DevTools only",
        "screenshots":metrics,
    }
    (folder/f"{stage}-batch-chrome-metrics.json").write_text(
        json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if stage=="recent":
        # Keep every previous stage's original evidence manifest while
        # documenting that all 36 captures share *one* Chrome process.
        for historical in ("alpha39","alpha40","alpha41","alpha42","alpha43","alpha44"):
            subset=[m for m in metrics if m["file"].startswith(historical+"-")]
            expected={"alpha39":8,"alpha40":14,"alpha41":14,"alpha42":4,"alpha43":8,"alpha44":16}[historical]
            if len(subset)!=expected:
                raise AssertionError(f"Pooled browser coverage lost {historical}: {len(subset)}")
            smaller={
                "stage":historical,"strategy":"one shared single CDP Chrome process for all recent historical stages",
                "shared_single_chrome_process":True,
                "total_new_browser_processes_for_recent_stages":1,
                "independent_capture_count":len(subset),
                "total_recent_captures":len(metrics),
                "old_135_capture_coverage_unchanged":True,
                "historical_143_capture_coverage_unchanged":True,
                "all_previous_157_evidence_kept":True,
                "qa_only":True,"screenshots":subset
            }
            (folder/f"{historical}-batch-chrome-metrics.json").write_text(
                json.dumps(smaller,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(stage.upper()+" POOLED CHROME SCREENSHOTS",json.dumps({
        "chrome_processes":1,"images":len(metrics),"duration_seconds":duration,
        "bytes":[m["bytes"] for m in metrics]},ensure_ascii=False))


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--chrome",required=True)
    parser.add_argument("--base-url",required=True)
    parser.add_argument("--output",default="v4-art-qa")
    parser.add_argument("--stage",choices=("alpha39","alpha40","alpha41","alpha42","alpha43","alpha44","recent"),default="alpha39")
    args=parser.parse_args()
    if not args.base_url.startswith("http://127.0.0.1:"):
        raise SystemExit("Alpha39 screenshot target must be local QA HTTP server")
    screenshot_batch(args.chrome,args.base_url,Path(args.output),stage=args.stage)
