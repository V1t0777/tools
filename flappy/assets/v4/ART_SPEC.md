# Flappy V4.0 — Cinematic Worlds Production Specification

Status: **ALPHA 2 ENGINEERING SAMPLE / NOT FOR RELEASE**. The `main` branch and production Cloudflare environment must remain unchanged until **both** worlds and their performance / accessibility tests are accepted.

## Art direction and gameplay contract

- **Warm traveler → Dawn Valley** (`warm`). Misty blue-grey sky, muted apricot sunrise, atmospherically separated alpine ridges, restrained pine forest, weathered sandstone pipes.
- **Slate bird → Blue-Hour Range** (`slate`). Cool twilight, restrained moonlight, jagged ridges and dark conifers, weathered slate pipes.
- Same silhouette scale, camera, visual hierarchy and overall production quality across worlds; avoid tinting the warm art into a cheap imitation of a night scene.
- The playable corridor is the center of the canvas. No high-contrast tree, glowing particle or opaque foreground may occlude a bird or pipe.
- Gameplay state, spawn timing, hitboxes, physical lift, leaderboard, Supabase authentication and accessibility interactions are **out of scope**.

## World layer contract

The scene is drawn **behind pipes and ground**, from back to front. Static SVGs are valid as the stage-2 technical sample: they are original, self-contained, un-scripted and all but `sky` must retain a genuinely transparent canvas. Final painted/WebP assets can later replace these sources under the same contract.

| ID | Content | Intended scroll factor | Alpha | Tile rule |
| --- | --- | ---: | --- | --- |
| sky | sunrise gradient, soft sun, faint upper cloud banks | 0 | opaque | stretch to canvas, no horizontal wrap |
| far | distant, fog-softened alpine ridge silhouette | 0.045 | transparent | left and right horizon endpoints coincide |
| mid | structured alpine ridges with selective shade | 0.12 | transparent | left and right silhouette endpoints coincide |
| mist | narrow low-contrast bands between depths | 0.19 | transparent | seamless side edges, motion can be reduced |
| near | partial forest/rock silhouette below main flight lane | 0.28 | transparent | seamless side edges |

Asset coordinate system: `viewBox="0 0 1600 1000"`. For each parallax image, draw it at height `H`; tile width = `H * 1.6`. The physical ground starts at approximately 88.5% of `H`; all non-opaque layers may extend below it, hidden by the ground renderer. For each repeatable layer, both edges must meet at a visually matching altitude/color with no abrupt vertical seam.

## Rendering / loading

- Load **only** the selected world. The first sample is warm only; while the slate sample is incomplete, slate uses the existing V3.1 procedure-generated background.
- Use a two-phase loader with per-image `load`/`error` resolution. **No partial world** may render while any required layer is pending/failed.
- Avoid re-creating images or gradients inside the render loop. `drawImage()` only; preserve old rendering functions as fallback.
- Clamp DPR according to existing game policy. On reduced-motion / low quality, render fewer transparent overlays; gameplay scrolling remains correct.
- Respect the existing CSP (`img-src 'self' data:`) and Cloudflare explicit allowlist. No external CDNs, tracking, texture scripts, filters requiring GPU post-processing, or shader execution.

## Visual QA before release

1. Large/small mobile portrait widths and landscape cropping.
2. No seams after 100+ seconds of repeated scrolling at different game speeds.
3. The bird and stone-pipe edges remain distinguishable at sunrise and in the darker twilight set.
4. Cold-start image loading, offline/404/error fallback (single missing layer → complete old-scene fallback).
5. A/B quality profiles: no overload on mid-range phones and no visible black image flashes.
6. Idle, active, paused, hit and score progression.
7. Automated tests and repository security gates green; actual device frame-time and memory sampling, not invented benchmark numbers.

## Milestones

- [x] **Alpha 1 engineering sample:** Dawn Valley self-contained five-layer SVG kit; loading, repeat rendering, fallback, basic tests.
- [ ] Alpha 1 art approval: visual comparison to high-fidelity reference, pixel-level seam inspection, device screenshot review.
- [x] **Alpha 2 engineering sample:** original, independently composed blue-hour slate sky, jagged ridges, mist and conifers; both worlds share an atomic renderer with per-theme failure fallback.
- [x] **Basic seam/safety regression:** tile edge altitude alignment, fog bounds, cross-theme load races and build isolation.
- [ ] Alpha 2 art review: compare dawn/twilight compositions with the original cinematic references, refine painted surface texture, manually inspect animated seams at different screen ratios.
- [ ] High-fidelity final art pass: replace temporary SVG engineering art with professionally finished original material layers after visual approval.
- [x] **Beta 1 atmosphere engineering:** restrained dual-phase valley mist, existing slow clouds, material detail constrained to landforms; honors reduced-motion and quality tiers.
- [ ] Beta 1 artistic QA: visually inspect atmospheric motion, lighting realism and foreground readability in browser captures; tune if intrusive.
- [x] **Beta 2 quality-policy implementation:** memory and data-saving hints with high/medium/low scenery tiers; sustained slow frames downgrade only scenery draw complexity.
- [ ] Beta 2 **real-device performance verification:** collect frame-time distributions, decoded-image memory, warm/cold scene load times, and contrast/screenshot evidence from real phones.
- [ ] Release: all checks pass, final user approval, protected-branch PR merge and Cloudflare production verification.

*This is an art/engineering starter kit, not a claim that the final painted cinematic artwork is already complete.*

## 2026-10-17 progress — design safeguards

- Original slate layers: `slate/{sky,far,mid,mist,near}.svg` and corresponding `manifest.json` (distinct mountain shapes, moonlit atmosphere and rock coloration).
- Each of the two worlds is independently and atomically loaded. Completing an old theme's images cannot switch a newer theme. A failed layer returns to the V3 procedural renderer.
- Background is fixed for the current run, including when image loading finishes during play. A subsequent run can select the completed world.
- Basic geometric seam assertions are in Node CI, but **do not replace** visual seam and contrast inspection with actual rendered screenshots on devices.
- Quality grades, texture production, real mobile FPS measurements and accessibility checks remain pending. The PR must remain Draft and must not be merged.

## 2026-10-17 Beta 1/2 technical increment

- Atmospheric motion is restrained: in the high tier, mist uses a slower base drift and a second translucent phase-offset pass; in medium, one pass; in low and reduced-motion, neither dynamic cloud/fog pass is rendered.
- Both themed midground and foreground scenes receive deterministic, clipped microtexture: rock strata, restrained edge glints, and very small moss/boulder marks. All material lives inside terrain silhouettes with no external SVG media, script, animated SVG or expensive noise filters.
- `navigator.deviceMemory` and `saveData` help pick initial quality where browser hints exist. A separate, bounded frame-time observer may downgrade *only* scenery after sustained slow-frame evidence. Missing browser hints assume high quality; quality never affects collision, physics, scoring or authentication.
- A quality tier should not be claimed as a measured FPS guarantee; native device verification is still mandatory.
- **Important art gate:** these remain handcrafted SVG technical layers. Texture-rich final painted art, visual browser captures, seam/contrast inspection and actual iPhone/Android testing are not yet complete. Draft PR stays unmerged.

## 2026-10-17 art-review preview infrastructure (temporary)
- A draft-only `flappy/review-v4.html` page shows both original scene layer stacks side by side. This security-minimal **script-free static art review** offers four crop dimensions, bird/stone-column readability proxies and a fog visibility toggle. Animated parallax and loop seams must be checked separately in the branch-preview game.
- This page is **not** a game release or a substitute for actual game screenshots. The stone pillars are simple silhouettes for contrast comparison; game collision is untouched.
- Alpha QA checks include matching horizon elevations, both-world asset readiness, independent world failure recovery, and high-DPR fractional tile overlap to avoid thin raster seams.
- **MANDATORY REMOVAL BEFORE PRODUCTION:** remove `flappy/review-v4.html`, its copy command from `cloudflare-secure/build.sh`, the `dist-secure/flappy/review-v4.html` assertion in `scripts/security-check.sh`, and development-only QA test `tests/flappy-v4-review.test.mjs` (or rewrite tests for final permitted art routes).
- Perform browser screenshots at the specified aspect ratios and a full scrolling scene before marking art gate complete. Do not claim screenshots or measured device FPS from Node contract tests.

## 2026-10-17 Alpha 3: hand-shaped scene brushwork — completed on Draft PR #57

- Both pine forests now have a separate shoulder/branchlet and canopy-glazing pass: **58** warm and **63** slate bough overlays; avoid adding detached opaque sprites in the playable lane. The underlying original tree silhouettes and collision-free placement remain.
- Both mountain midgrounds now use **five light-facing crest facets with neighboring shadow and rock-scoring lines**; all of the strokes are limited by the corresponding terrain silhouette.
- Added deterministic bounding checks: near-layer compressed source budget below **100 KB per SVG**, mid below **24 KB**, new facets remain in clipped terrain, and no SVG scripts, live filters, external images or runtime GPU shaders are used.
- GitHub Actions browser capture produced **8 PNG screenshots** at mobile viewports 320×568, 360×600, 390×844 and 420×740 after the artwork changes (run `38949341322`).
- **Honest visual assessment:** this noticeably improves layering, not yet photorealistic or high-resolution painted realism. The base ridge shapes remain stylized. True final textured original art, moving-game seam inspection and physical device performance are still release blockers.

## 2026-10-17 Alpha 4 — memory discipline, raster-first readiness and seam evidence

**Memory and loading**
- `Image.onload` does not imply decoded raster content. On browsers implementing `HTMLImageElement.decode()`, all five SVG layers must finish asynchronous decode before V4 becomes active; a rejected decode invokes complete V3 fallback. Browsers without `decode()` continue using the guarded `onload` path.
- On randomized theme selection, the inactive world is discarded (image handlers detached, texture references removed, stale session invalidated); only the current five-layer world is retained by the application. Typical worst-case uncompressed RGBA surface budget is approximately **5 × 1600 × 1000 × 4 = 32,000,000 bytes (~30.5 MiB)** for one full world, *excluding browser overhead, bird atlases and other buffers*. Real GPU use is device-specific and **not measured**.
- VM regressions now explicitly cover partial async decoding, rejected SVG decoding, inactive theme eviction and a return to the previously discarded theme.

**Repeatable edge-join checks**
- Temporary script-free art reviewer provides `#warm-seam` and `#slate-seam` to draw each tiled layer twice, meeting exactly at the viewport center. The draft-only GitHub Actions Chrome job captures **16 PNGs** (two worlds × four viewport sizes × normal-scene / center-seam).
- Actual browser screenshot inspection found a discontinuity in the forest/midground repeat joins caused by **horizontal gradient endpoints that did not match**. Warm midground and both worlds' foreground glaze gradients were changed to vertical-only fades; tests now reject nonmatching `x1`/`x2` for repeating-layer linear gradients.
- For 390×844 Chrome seam screenshots, a *diagnostic*, nonperceptual metric measured mean absolute adjacent-RGB-column change at the exact center join, restricted to image rows 65%–90%: **warm 6.06 → 0.81; slate 2.25 → 0.77** (unit: mean 8-bit channel difference per adjacent column). This is evidence that this specific seam artifact was reduced, *not* proof of zero seams at all camera positions.
- Files and screenshot runs are kept on the Draft PR, not added to `main`. True live in-game panning, image raster quality, frame-time and memory verification on iOS/Android are still pending.

## 2026-10-17 Alpha 5 — real-game Canvas visual evidence, not only layer proxies

- Added isolated, **Draft PR #57 only** visual harness at `tests/flappy-v4-game-browser.mjs`: reads the existing game HTML, serves a test-only variant **in memory** on localhost, and uses Chrome DevTools Protocol with Node's built-in WebSocket (no npm package, no production debug endpoint).
- Harness records the *real* `draw()` path, bird atlas, stone pipe rendering, procedural gameplay ground and V4 parallax stacks. It fixes bird vertical position and bypasses collision **only in the ephemeral test response** so the capture can cover two intentionally different scroll positions without losing the game. The repository's `flappy/index.html` is unchanged.
- Chromium desktop/headless visual QA produced **8 genuine game screenshots**: warm/slate × 390×844 and 360×600 × two scroll offsets (0 and 960), alongside the existing 16 static-art/seam screenshots.
- Automatic report `headless-game-metrics.json` records per-case layer/resource entries, time until five images decode (approximately **42–203 ms** in this particular CI run), actual canvas dimensions, frame-interval median/p95 and confirmed cinematic-world activation and real pipe count. The observed p95 frame interval was around 16.7–16.8 ms in this **headless CI browser**, with one warm 390×844 report containing a **166.6 ms max-frame outlier**. These are diagnostic values from the test runner, not reliable mobile FPS or input latency measurements.
- Evidence: GitHub Actions run `38987526255` artifact `flappy-v4-draft-real-game-pr57`. The screenshots establish what the real rendering path looks like; they do **not** complete the high-fidelity art acceptance gate.
- Browser QA retains read-only `contents: read` permissions, runs only on the specified Draft PR, and does not deploy the generated HTML. Keep this workflow test-only and **remove the temporary QA assets/workflow before the final production release** per the existing release checklist.
- **Remaining gates:** hand-painted cinematic-quality terrain rather than stylized vector art; genuine live-game long-duration seam and user-interaction tests without test-only stabilized physics; iPhone and Android frame-time, decoded memory, load time and touch input-latency measurements. Do not infer real-device results from CI Chrome.

## 2026-10-17 Alpha 6 — actual input, gravity, collision and restart browser QA

- Extended the **test-only, localhost** Chromium CDP harness in `tests/flappy-v4-game-browser.mjs` with a new `mode=live`. Unlike the stabilized art capture, this second mode does **not** skip collision, reposition the bird, override scrolling or invoke `startGame()` / `flap()` as internal functions.
- Each original world is selected using only the temporary fixture skin selector and loads its real five-layer V4 background; a genuine browser `Input.dispatchMouseEvent` generates an actual bubbling `pointerdown` at the stage, exercising the app's real interaction handler.
- Verified on the CI headless Chrome runner for **warm and slate separately**: first tap begins normal flight, bird moves under gravity, scroll advances with gameplay, natural collision enters `falling` then `over`, second actual pointerdown restarts the game, and theme remains unchanged during this test scenario.
- First successful run evidence: `headless-live-input-metrics.json` within artifact `flappy-v4-draft-real-game-pr57` on GitHub Actions run `38999750241`. The test recorded **2 taps / 2 game starts / 1 collision** per theme; cumulative vertical motion across the flight was **295.8px (warm)** and **296.1px (slate)**; frame intervals had runner-specific p95 around 16.7–16.8ms. One warm trial saw a **166.7ms** maximum frame interval, therefore even CI hardware is not free of frame outliers.
- Also exports `live-warm-normal-flight.png` and `live-slate-normal-flight.png`, in addition to 8 previously stabilized art captures. All are actual Canvas renders with the original bird and pipes.
- Added a read-only, draft-only CI artifact requirement for 2 live screenshots and JSON metrics, plus `node --check` and source-isolation regression rules to prevent the test-only collision override from ever reaching the shipped game.
- This is **browser automation at an emulated mobile viewport, not a physical-device benchmark**, a long-duration uninterrupted survival test, or evidence of final painterly art acceptance. Pending: extended genuine gameplay under repeated physical tap events, progressive scenery comparison on an actual running game, and iOS/Android touch/thermal/memory measurements.

## 2026-10-17 Alpha 7 — repeated physical pointer events and real parallax endurance

- Extended the **local, test-only** Chromium CDP harness with an input-pacing run that **does not** freeze the bird, bypass normal collision, alter gravity, advance scroll artificially or call internal flap methods. The controller reads bird position, velocity and approaching real pipe geometry; it issues browser `Input.dispatchMouseEvent` mouse/pointer events only when a flap is needed.
- Both scenes completed the >=2.5s gameplay-scroll / >=4 genuine-pointer-input contract. First successful draft-only Chrome run `39001708946` (commit `54ca54e2`), artifact `flappy-v4-draft-real-game-pr57`:
  - **warm:** 12 pointerdown flaps, 6,172ms continuous normal-physics gameplay, scroll **22→954** (~932px), still `running`, **0 detected abnormal wing phase resets**.
  - **slate:** 7 pointerdown flaps, 3,900ms gameplay, scroll **22→589** (~567px), ended in normal `falling` collision, **0 detected abnormal wing phase resets**.
  - Both used a **360×600 mobile viewport** in *desktop/headless Chromium*, not physical touch input. These observations neither establish indefinite survival nor that players will have a certain score, FPS or low touch latency.
- Test-only instrumentation checks a backwards wing-phase jump beyond the natural 24-frame loop, with exact start/over/restart checks from Alpha 6 retained. It also verifies that the cinematic world remains selected and real scroll progresses.
- Evidence JSON: `headless-endurance-metrics.json` (includes runtime and cursor tap count), alongside `headless-live-input-metrics.json` and existing eight real-game PNGs. Source isolation checks still assert that **no QA hooks appear in production game HTML**.
- CI headless frame-interval p95 around 16.7ms; largest single raw frame interval was **166.7ms** in one 390×844 warm art capture. This is an observable CI outlier, not a device benchmark. No runtime FPS promises are made.
- **Unresolved**: prolonged (30–60s) all-world randomized pipe survival and gameplay transition stress tests, repeatability across controlled random seeds, memory after many restarts, finished cinematic painted art and real iOS/Android performance and input-latency testing.

## 2026-10-17 Alpha 8 — >30s aggregate true multiround browser stress

- Added a **second extended browser QA stage** to `tests/flappy-v4-game-browser.mjs`, complementing the Alpha 6 normal collisions and Alpha 7 repeated flapping runs. Draft Chrome now executes **two >=16s mobile-viewport samples** (one per world) with original gravity, original pipes, random gap locations, and real pointerdown clicks that start, flap and restart.
- The test does *not* force bird position or velocity, increase scores, teleport obstacles, override scroll, disable collisions or alter game difficulty. The test-only controller observes actual bird velocity, current pipe gap and elapsed round time to choose mouse/pointer inputs. The first round is given up to 5.7s of adaptive flapping to attempt genuine pipe traversal; later rounds deliberately allow natural death and restart.
- For both worlds, asserts >=3 naturally started rounds, >=5 browser pointer clicks, >=2 distinct observed randomized pipe height bands, >100 cumulative actual gameplay scroll pixels, all **five background layers retained during play**, no cinematic-session changes, and zero observed wing-loop phase anomalies. The >=31s combined duration assertion is across both worlds, **not** a single unbroken 31s flight.
- Browser evidence, run `39002410187`, artifact `flappy-v4-draft-real-game-pr57`:
  - **warm:** 16,033ms, six game starts, five collisions/restarts, 24 pointer clicks, **max 2 real points**, six observed gap-height bands, 1,943px cumulative scroll, all five layers retained, no scene swap or wing reset, maximum observed frame gap 33.3ms.
  - **slate:** 16,016ms, six starts, five collisions/restarts, 24 pointer clicks, **max 3 real points**, nine observed gap-height bands, 2,063px cumulative scroll, all five layers retained, no scene swap or wing reset, maximum observed frame gap 33.3ms.
- Final CI artifacts include `headless-multiround-metrics.json`, `headless-endurance-metrics.json`, `headless-live-input-metrics.json` and genuine original renderer screenshots. Eight required checks passed for the tested source commit.
- **Limitations:** test score progression only reached 2 and 3, so high-difficulty obstacle fairness is still unverified; no device GPU memory measurements, touch latency, battery/thermal sampling or physical iOS/Android performance. In particular, Chrome's frame p95 (~16.8ms) in a hosted desktop runner is not an iPhone/Android 60-FPS guarantee.

## 2026-10-17 Alpha 9 — high-score geometry audit & measured click response (development-only)

- Added `tests/flappy-v4-difficulty-geometry.test.mjs`, a deterministic source-contract audit of the actual V4 game's pipe formula across **four mobile viewports** (320×568, 360×600, 390×844, 420×740) and **101 score levels (0–100)**. It also simulates **five seeded, 300-pipe sequences per viewport** (6,000 generated obstacle positions) to enforce legal pipe centers, bounded adjacent gap-center movement, minimum collision corridor width, monotonically increasing/capped difficulty and sensible speed-vs-spacing geometry.
- Verified score-45+ formula caps: initial pipe-center spacing / nominal horizontal speed ≈ **1.46s** at score 0, ≈ **0.97s** at score 45+, independent of viewport aspect; minimum collision opening at 320×568 is about **116px before bird diameter**. These are geometry bounds, **not** proof that a human or physics-controlled bird can clear arbitrary high-score sequences; live scoring beyond 3 is still pending.
- The local-only Chrome harness now captures real pointerdown→flap physics application and flap physics→subsequent Canvas draw completion separately, with input p50/p95 and max. The harness logs synchronous `initAudio()` call durations **without touching the production game HTML or changing mobile audio behavior**. Values are software event/draw timestamps, not actual screen photon latency and not physical mobile input timings.
- Latest verified headless run `39003410245`: first *warm* click input→physics **98.3ms**, input→Canvas draw **149.7ms**; synchronous first `initAudio()` **90.3ms**. First *slate* click: input→physics **1.4ms**, input→draw **10.6ms**, first audio initialization **1.1ms**. Contrast with an earlier warm cold-run outlier: ~230ms to physics / ~437ms to Canvas draw. **Do not average these non-identical cold samples or report them as stable hardware latency.**
- With **23 genuine pointer input samples** per theme during normal-physics 16s multi-round runs, pointer→Canvas-draw P95 was **10.1ms warm / 10.4ms slate**, reported via `headless-multiround-metrics.json`. Audio init showed warm first **1.0ms** and slate first **1.0ms** in these independent run contexts; the cold-start penalty is inconsistent and merits further tracing.
- The same most recent headless run retained genuine scoring, collision and many-round restart, with both themes' **maxScore=3**, five scene layers, zero unexpected scene changes, and 0 wing-reset anomalies.
- **Release blocker**: investigate/mitigate cold `AudioContext` construction and first-frame delays in a manner compatible with iOS/Safari's user-gesture unlock requirement; measure actual user-perceived tap-to-visible response and first-sound availability on real iPhone and Android devices. An optimization must not lose first-tap audio or compromise game responsiveness. Do not assert a physical 60 FPS or low latency based on Chromium CI.

## 2026-10-17 Alpha 10 — prioritize flight physics before first Web Audio initialization

- Production `flappy/index.html` no longer constructs `AudioContext` at the very start of every `pointerdown`. `startGame()` / `flap()` applies the bird's upward velocity first; `flap()` then starts `tone()` and `airy()` **within the same pointer gesture**, preserving the gesture needed to unlock audio on iOS Safari (physical verification still required).
- `initAudio()` now gracefully handles synchronous AudioContext constructor or `resume()` failures, including rejected `resume()` promises. A failed constructor is not retried every flap; explicitly switching sound off and back on permits another attempt. Missing sound must never block starting, flapping, score changes or game completion.
- Node regressions test sound-context creation timing relative to the negative vertical lift, real sound oscillator scheduling in that first event and denied audio construction (including retry after explicit sound re-enable). The real-game Chrome harness's pointer-to-physics timestamp was moved **after** the `bird.vy` assignment so the metric measures an applied impulse rather than function entry. Instrumentation is confined to a localhost-only QA response.
- Latest calibrated draft Chromium run `39005915519`, commit `d6ace278`: first *warm* tap pointer-to-applied-physics **11.0 ms**, but audio initialization was **348.6 ms** and pointer-to-Canvas-draw **546.7 ms** (a major cold-start outlier); first *slate* tap physics **0.3 ms**, audio **1.1 ms**, draw **9.2 ms**. In separate 16-second, 24-tap normal-physics rounds for each theme, pointer-to-Canvas-draw P95 was **9.6 ms warm / 9.3 ms slate**, with maximum live scores **3** in both. All eight CI checks passed at that code commit.
- These are **headless CI Chromium event/draw timestamps, not a physical touch-to-photon latency measurement**. Comparing separate runs is noisy: earlier warm cold-tap draw samples were ~58, ~149, ~231, ~437 ms, and now ~547 ms. The audio constructor cold-start jank is NOT solved by the ordering change; only the order of physics application improved.
- **Release blocker remains:** find a Safari-compatible way to avoid observable cold-audio frame blocking without losing first-tap sound; compare sound-on/off cold captures using the same Chrome runner, and test real iPhone/Android devices for first-sound unlock, touch-to-visible responsiveness and memory/performance. Never claim this stage meets final low-latency requirements.
