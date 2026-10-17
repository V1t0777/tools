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

## 2026-10-17 Alpha 11 — counterbalanced sound-enabled / sound-disabled input response

- Added `headless-audio-ab-metrics.json` to the **Draft PR #57 only** real-game Chromium evidence. Eight new actual-browser, first-tap-per-navigation trials cover **warm / slate × sound on / off × two repetitions** in counterbalanced order. The temporary local QA page sets its own `localStorage` sound preference before the original game script loads; the production default and code are **not modified**.
- Each comparison preserves real gravity, collision and pointer handling, loads all five V4 layers, measures pointerdown to applied lift (timestamp after the `bird.vy` assignment) and next Canvas `draw()`, and records synchronous successful audio initialization. A sound-disabled case must create/use **no audio context**; the sound-enabled case must attempt audio. New Node contract tests keep the sound preference override and metrics isolated to the QA tool, absent from `flappy/index.html`.
- Browser run `39006461349`, source commit `e3c11f90`, all eight checks passed:
  - **warm sound off**: 5.0, 8.1ms pointer→Canvas; **warm sound on**: 10.6, 10.7ms.
  - **slate sound off**: 10.5, 6.0ms; **slate sound on**: 5.5, 5.8ms.
  - Pointer→applied bird velocity: all **0.1–0.2ms** within the warmed, virtual browser environment; enabled audio `initAudio` recorded first call **0.9–1.0ms**.
- **Critical caveat:** the A/B sequence currently runs **after** the other actual-game QA scenarios, and all eight cases reuse the same Chromium process. The audio backend and browser caches were likely already initialized; this is **not a true cold process A/B**, so it cannot rule out the previously observed **~349ms synchronous AudioContext cold-start / ~547ms pointer-to-Canvas outlier**. Nor can it prove Safari user-gesture audio correctness or physical input-to-photon latency.
- Next experiment: run A/B first in fresh isolated Chrome profiles/processes with order swapped, and compare against sound-off control. Continue to retain and report individual cold-start outliers. Only ship an audio architecture change after iOS/Android first-tap sound and real device rendering testing. **Keep Alpha 10 flight-first response; do not claim cold stutter eliminated.**

## 2026-10-17 Alpha 12 — eight separately launched Chrome first-gesture sound A/B cases

- Earlier Alpha 11 sound on/off timings were acquired from navigations **inside a reused Chromium process**. This stage adds a separate code path in the test-only `tests/flappy-v4-game-browser.mjs` selected by `V4_COLD_CASE`. Each of **eight** experiments invokes a new Node process, which launches a **new Chrome process and unique empty profile** with no preceding game scenarios. Themes and sound settings run in counterbalanced order: warm off/on, slate on/off, then inverse repetitions.
- Every case uses the original game Canvas, five genuinely decoded V4 image layers and a single real browser pointer event. The QA-only pref sets sound on/off *before* game startup; the first applied bird velocity is timestamped after the actual physics write. Original game production code is **unchanged** this stage. A first-click in sound-on cases is required to attempt audio; sound-off cases must not create/use the audio context. Eight first-flight screenshots plus machine-readable per-process reports and consolidated `cold-process-summary.json` are attached to the Draft PR's read-only GitHub Actions run.
- First successful isolated-process evidence: `39007191247`, commit `97192105` (all eight checks succeeded):
  - warm, **sound OFF**: pointer→Canvas `8.3 / 7.6 ms`; first physics applied `6.6 / 0.5 ms`.
  - warm, **sound ON**: pointer→Canvas `231.1 / 46.8 ms`; synchronous first audio initialization `115.6 / 41.4 ms`; first physics applied `0.4 / 0.5 ms`.
  - slate, **sound OFF**: pointer→Canvas `6.2 / 7.1 ms`; first physics applied `0.3 / 0.4 ms`.
  - slate, **sound ON**: pointer→Canvas `38.5 / 39.8 ms`; audio initialization `33.6 / 34.7 ms`; first physics applied `0.5 / 0.4 ms`.
- **Finding:** independently starting the browser reproduces a substantial sound-enabled first-Canvas delay and adds strong evidence that synchronous `AudioContext` creation is a contributor. The pre-audio bird lift behavior from Alpha 10 remains fast, but the *visible-frame* stall persists. Difference between themes cannot yet be ascribed to artwork rather than run ordering or runtime variation.
- **Limitations:** all eight Chrome processes were launched sequentially on the same hosted runner and **share its OS/audio backend and kernel caches**. Each has a fresh browser profile, but they are not independent physical cold boots; sample size 2 per condition is insufficient for population-level inference. Synthetic pointer-to-Canvas time does not include actual touch screen hardware or scanout. No real Safari first-gesture sound test has been performed.
- **Next gated experiment:** try an opt-in, idle-time `AudioContext` construction/prefill only on the Draft development branch, while preserving the same-gesture `resume()` and fallback. Compare via fresh-process sound ON/OFF cases, then require real iOS Safari and Android validation of audible first flap and foreground-frame latency **before any production merge**. Do not silently defer/drop the first flap sound just to lower a benchmark.

## 2026-10-17 Alpha 13 — guarded Chromium idle audio preparation (release-gated)

- Following Alpha 12's fresh-process evidence that first-gesture `AudioContext` creation blocks game rendering, a **Chromium-only experiment** is now implemented in the V4 feature branch's game HTML. `primeAudioAtIdle()` constructs but **never resumes, sounds, schedules a tone, or otherwise unlocks** an `AudioContext` on a `requestIdleCallback` while the scene is still `ready`. It runs only if the saved sound preference is ON, the page is visible, memory/data-saver policy permits it, and Chromium is identified by `userAgentData` or a Chrome/Chromium UA token. iOS WebKit tokens `CriOS`/`EdgiOS`/`FxiOS` and Safari without Chromium markers do **not** prewarm. The existing `initAudio()` still resumes suspended audio and plays the first flap tone **synchronously inside the actual pointer/keyboard gesture**.
- Animated Canvas often gives only 2–8ms per idle callback. The initial >=10ms rule never actually primed in 16 process-isolated cases. It was adjusted to a conservative >=5ms gate with at most **three callback retries**, no forced timeout, no allocation after the game begins, no priming when muted or constrained, and no permanently latched failure on idle audio construction errors. A genuine user gesture can still retry normally.
- First independent Chromium run demonstrating **4/4 priming success** for sound-on cases: `39008506044`; supporting code source checked by CI (8 required checks SUCCESS). Prime construction itself cost roughly **36ms**. With sound on and idle prime, pointer-to-next Canvas draw was **4.5–9.3ms** across four cases vs **38.4–139.8ms** without prime (only 2 runs per world). No idle audio creation occurred when sound off.
- Added extra **wall-clock frame interval** instrumentation to separate `performance.now()` gaps from synthetic `requestAnimationFrame` timestamps. Latest pass `39009011291` (8 checks SUCCESS): priming succeeded in **4/4 enabled/on** process-isolated cases, requiring **31.0–32.9ms** of synchronous idle audio construction; click-to-Canvas timing **3.5–8.2ms** for primed sound-on, vs **33.0–206.2ms** for nonprimed sound-on. During the explicitly sampled *later ready-screen window*, no >24ms wall-clock frames were observed, but **the first 20 startup frames were excluded** so an earlier audio-related waiting-frame stall is **not ruled out**. One muted trial itself had a 114.2ms input outlier, underscoring CI noise.
- All tests use **headless Chromium** with clean profiles/processes but a **shared hosted runner OS/audio backend**. `pointer→Canvas draw()` is not display photon latency. Sound scheduling/resume has unit coverage, but **audible first-tap playback is not yet verified on real Android or iOS Safari**; early `AudioContext` preparation is not enabled in Safari. Avoid equating these tests with measured real-device power, GPU memory, touch or battery performance.
- **Decision:** keep this as a **development-branch Chromium candidate only**, not a release-approved improvement. Do not merge V4 yet. Pending: first-startup-frame/jank inspection, real Android first-sound/first-flap and battery/thermal tests, untouched Safari gesture/unlock acceptance, and final high-fidelity hand-painted original art.

## 2026-10-17 Alpha 15 — mobile-visible near-forest underpainting, edge-stable

- Added **12 hand-authored broad gouache-shaped pigment masses and 12 lower-opacity broken dry-brush edges** to each original 1600×1000 `warm/near.svg` and `slate/near.svg`. Masses are placed *under* the existing individual pine boughs and clipped by each theme's original near-forest terrain, rather than changing tree collision, ground geometry, scrolling, SVG viewBox or bird/pipes.
- Warm uses restrained sunrise ochre, moss and cool-green washes; slate uses blue-grey, cold teal and dark indigo washes. The palettes and forms remain separate, not a simple CSS tint. Each wash uses **155–312 source units** at broad mobile-readable scale rather than more imperceptible subpixel detail.
- First soft pigment mass is translated inward by 60 units, keeping the repeat-tile edges clean. No external assets, HTML, scripts, SVG filters, raster embedding or new runtime animation.
- Total near-SVG size stays **under 100 KB per theme** (approximately 89 KB warm and 93 KB slate); the original browser 5-layer loading strategy remains unchanged. Added a source regression requiring 12 broad masses, 12 broken edges, clipping, translucent pigments, safe tile padding, separate palettes and resource-size bounds.
- Independent headless Chromium 390×844 actual-game comparison with the **Alpha 14** baseline: pixel differences were confined to the forest portion and below; **0 modified pixels in rows 0–599**. In rows 600–747, pixels with summed RGB-channel difference >=3 accounted for **28.2% warm** and **22.1% slate**. These are change-coverage metrics, **not an artistic quality score**.
- Browser tile-edge test across rows 560–759 at the center repeat join showed unchanged mean adjacent-column RGB-channel absolute difference: **warm 0.807→0.807**, **slate 0.765→0.765**. This supports no regression at the tested seam, but not every scrolling position or display scale.
- Draft QA evidence was captured through GitHub Actions run `39015927536` with 16 Chrome static/art screenshots and the real Canvas interaction suite; security/game checks and CodeQL were green. The new pigment does **not** establish final cinematic photographic/painterly quality: original foreground silhouettes and backdrop geometry remain substantially vector-based and real iPhone/Android perceptual and performance validation is still pending.


## 2026-10-17 Alpha 16 — distant-ridge atmosphere pigment scale (Draft only)

- Both `warm/far.svg` and `slate/far.svg` now have their **own** clipped broad-pigment ridge passes: 12 hand-shaped mountain gouache masses and 9 wide, translucent dry-ridge strokes per world. They sit on top of the distant landform but underneath the forward valley ridge and existing haze, preserving correct depth order.
- Warm is deliberately sunlit ochre / sage stone; slate is blue-grey lunar rock with its own summit placement. No extra layers, network resources, GPU filters, script, gameplay hooks or render-loop costs were added. Both repeat edges remain untouched and the distant SVG stays below 20 KB.
- Added deterministic Node QA for counts, clip ID, painted layer order, translucency, size budgets, safety and distinct hand-authored art. **Visual impact, image raster seams and long-run in-game readability still require real rendered screenshot comparison.** This is an incremental original-vector paint pass, **not** a finished high-resolution cinematic painting.
- Leave PR #57 Draft and keep protected `main` / production V3.1 unchanged. Before release: complete and review final art, real high-score playability, iPhone Safari first-sound and Android touch/FPS/memory tests, remove draft-only capture/review infrastructure, rerun security/functional checks and obtain explicit approval.


## 2026-10-17 Alpha 17 — far-to-mid light bridge and live-render seam probes (Draft only)

- Added **7 large but subdued clipped mid-ridge illumination glazes + 4 low-opacity broken dry-light strokes in each world**. Dawn uses desaturated apricot/grey-sage slope transitions; blue hour has independently composed moonlit blue-grey values. Added under all existing rock microtextures, preserving crisp foreground silhouette readability. Every new path is inset from tile edges, and each `mid.svg` stays below 24 KB. No additional textures, shaders, JavaScript callbacks, or gameplay changes.
- Changed **only Draft QA fixture** `tests/flappy-v4-game-browser.mjs` to measure RGB column differences at the actual source game's tile-join positions. The browser QA drives controlled stabilized scroll offsets to bring **far, mid and near** joins into view (2 worlds × 2 viewports × 3 joins = 12 captures). Measurements come from original game Canvas **immediately after drawing the selected parallax layer, before birds, pipes and ground**, with nearby-column controls, seam coordinate and sample count; new result is `headless-seam-metrics.json`. These are composite pixel samples, *not* isolated-layer RGBA boundaries or a perceptual image model.
- The draft-only workflow uploads screenshots and diagnostics. A loose upper-bound regression threshold catches large adjacent-column discontinuities; **passing it does not prove invisible seams**, and the ordinary game screenshots may obscure joins beneath obstacles. Both automated and manual visual comparisons are needed.
- Hardware iOS/Android render and sound tests, high-score physical playability, final approved original painterly artwork and QA-only infrastructure cleanup remain release blockers. Preserve Draft PR #57, protected `main` and production V3.1.


## 2026-10-17 Alpha 18 — sky directional light continuity (Draft only)

- Both original `sky.svg` worlds now include a **localized horizon backscatter layer** under the cloud brushwork, using two soft radial ellipse washes plus three wide, very-low-opacity atmosphere shelves per theme. Dawn follows the subdued sunrise palette at the existing sun anchor; blue hour follows an independent colder moonlight direction.
- The new appearance is confined to the **already decoded sky image**. No additional file requests, JavaScript per-frame draws, GPU filters, shaders, movement or gameplay changes. Each `sky.svg` stays smaller than 6.5 KB and its existing 1600×1000 viewBox remains fixed.
- A source-level contract checks explicit original hand-authored theme differences, group ordering, translucent marks, size limits and passive SVG security. All scenery remains a **draft engineering vector art direction**; no claim of painterly-master completion or hardware display contrast is made.
- Alpha 17 corrective test fix: the original Draft seam sampler used `qa.scrollOffset + (t - qa.startedAt) * .21`, allowing ambient test scrolling to shift the near-layer join out of the viewport. In seam-probe mode only, the QA runner now holds the synthetic scroll offset fixed while maintaining the original Canvas scene composition and layer speeds. This is a QA-only fix, **not evidence of a production game seam bug**.
- Next acceptance: visual review of the 16 static scene/seam captures, eight real-game snapshots, twelve centered dynamic parallax-seam captures, contrast of bird and pipes, and actual phones. A passing QA pixel-delta threshold detects only large image joins. Finished painterly source artwork, sustained high-score playability, iPhone first-tone gesture fidelity, Android frame/GPU/thermal measurements and cleanup of temporary preview assets are still blocking release.
- **Do not mark Ready, merge protected main, or publish production V4.**


## 2026-10-17 Alpha 19 — restrained protagonist/stone-pillar separation (Draft only)

- After Alpha 18's full security and real-game browser workflow passed, refined the shared existing V3 transparent 24-frame atlases **only on the Draft V4 branch**. Each original warm/slate atlas has exactly 24 matched frames. Increased the subtle dark body contour (opacity .38→.52, original source width 1.8→2.15) and added the same unobtrusive breast-to-feather edge (opacity .17, width 1.55) to every frame. No frame order, rig joints, sprite dimensions (1440×960), wing timing, hitbox, physics, or load URL changed. Total atlas source stays below 265 KB per world. Because both skin atlases are shared with the V3 renderer, final review must account for their visibility in every themed fallback as well as V4 gameplay.
- Refined stone pillars **within their existing physical geometry**: a narrow illuminated inner left edge, a narrow occlusion strip near the right edge, and a quiet inset cap contour. Kept the cap height, obstacle width, masonry layout, material gradients, physics and collision path unchanged; no new shadows, glow filters, particle emitters or per-frame image allocations.
- Added source regression to require a matched 24-frame skeleton, symmetrical theme treatment and in-hitbox column/cap details. Added **draft-only browser Canvas diagnostics** sampling bird-center and visible pipe body against nearby pixels, attached as `visualSeparation` to existing `headless-game-metrics.json`. These single-point mean RGB-channel deltas are **screening data, not perceptual contrast, edge continuity, accessibility compliance or human-readable visibility proofs**, and do not impose an unsupported synthetic quality threshold.
- Need human visual checks at small (320 px) viewport, bright dawn haze, dark slate forest and pipe gap margins. Tests must re-confirm no cold-start audio regression, playable collision, sprite decode and mobile device performance. The final original hand-painted artwork is not yet approved.
- Remain Draft PR #57; leave protected main and production V3.1 unchanged, require explicit release approval.


## 2026-10-17 Alpha 20 — narrow-screen game-canvas visibility evidence (Draft only)

- Existing art reviewer already showed 320×568 as a STATIC composite. This stage adds **real Flappy Canvas captures at 320×568**, while preserving 360×600 and 390×844: 2 original worlds × 3 viewport sizes × 2 normal scenery scroll positions = **12 real-game screenshots**. All captures must show five decoded V4 scenery layers **and the decoded V3 24-frame flight atlas**, rather than silently falling back to procedural artwork.
- The actual layer-repeat join measurements now cover 2 worlds × 3 viewports × 3 parallax layers = **18 centered seam screenshots**, with pixel-readback gaps checked against the previous generous severe-gap threshold. This extends the existing 12; successful automation does *not* imply perfect perceptual seamlessness.
- To replace the weak nearby-pixel heuristic with a more controlled measurement, a **one-shot, Draft-only** instrumentation hook reads two source-game Canvas positions (bird body center and lower breast) **before** drawing pipes, ground and bird, then reads the *same canvas positions* **after** the complete character is drawn. Values are stored in the additional `headless-narrow-readability.json`, with actual RGB channels, mean absolute per-channel difference, nominal bird diameter and specific source image/viewport. The hook performs **no persistent per-frame image sampling** and is never present in production.
- The data is a *screening indicator only*: it does not measure objective silhouette-edge continuity or fine feather details, and a higher RGB difference does **not** by itself establish readability, WCAG contrast compliance, collision fairness or better visual aesthetics. The stabilized QA renderer temporarily disables collisions to hold a steady shot, while separate previously existing tests validate normal physics, real pointer input and endurance. Both theme palettes and in-flight sprite rendering must be reviewed by a person.
- Review matrix for a human art signoff: at 320×568 inspect warm bird against the very bright dawn haze and slate bird against dark forest/blue-hour ridge; bird edge must be readable without thick artificial halo; pipe physical silhouette must agree with its visible border at both ends of the opening. Check 360×600 and 390×844 at the same scenery positions. Record any failures and revise *original artwork* before calling it release-quality.
- Entire stage is evidence/infrastructure, **not a new final painted-art pass**. Physical iOS Safari, Android Chrome, true device GPU time, sound-activation feedback, thermal/memory budget, sustained skilled high-score gameplay, final approved painterly illustration, review-only infrastructure cleanup and final authorization all remain release blockers. Keep PR #57 Draft; production V3.1 and protected main remain untouched.


## 2026-10-17 Alpha 21 — measurable repeat-ridge geometry fix (Draft only)

**Alpha 20 baseline (headless Chromium real Canvas, warm/near, 320×568):** central join adjacent-column RGB delta **3.42**, neighboring control **1.73** (the general severe-gap alarm is 12). This indicated a discontinuity candidate, not proof of a visible line.

**Source diagnosis:** in `warm/near.svg` the 1600-source-pixel repeated forest silhouette met itself at y=800, but incoming and outgoing cubic tangents were not matched. Replaced only the first/last short sections with C1-compatible *flat edge tangents*, preserving interior contour, source tile bounds, tree skeletons and all existing animations. Exactly the same new silhouette is used in its clip, fill and highlight. No blur, GPU filters, new image downloads, per-frame loops or collision changes.

**Measured A/B:** the independent geometric-only revision completed both draft workflows and reduced the warm/near 320×568 pixel mean from **3.42 to 2.68** (nearby control still **1.73**), approximately 21.6% less *RGB delta*. This is not an equivalent perceptual-quality percentage or an iPhone benchmark.

**Rejected follow-up:** a symmetric tree added across the tile edge was separately measured at **3.71** (adjacent controls **2.98**), **worse** than either the 2.68 geometric-only version or the 3.42 original. It was immediately reverted; it is NOT present in the retained artwork. This intentional experiment is recorded so the team will not mistake a structural test passing for an aesthetic improvement.

**Regression gate:** the Draft real-game renderer now applies a narrow, environment-specific **≤3.25 RGB-channel mean** regression criterion for this one 320×568 warm-near seam in addition to the general <12 gap guard. The goal is to prevent re-introducing the 3.42+ issue in the same Chromium CI setup. This is not a blanket claim of invisible seams; future Chromium upgrades, new composition or original painterly masters require recalibration. The source test also verifies all three paths and matching endpoint tangents, file budget <93 KB and passive SVG safety.

**Open release blockers:** qualified manual review of all screenshots at 320–390 px, final approved *original high-resolution painterly* backgrounds, real high-score fairness/playability, physical iOS Safari and Android touch/audio/frame/memory/thermal validation, and removal of Draft QA-only preview files and exceptions. **Keep PR #57 Draft; no main merge, no production V4 release.**


## 2026-10-17 Alpha 22 — dual-world broad valley paint and luminance review (Draft only)

**Artistic target.** Existing V4 vector layers have a sufficient original forest/ridge structure but still reveal granular micro-texture and some weak overall shape lighting. Add a *limited and inspectable* broad-gouache valley transition between the established distant ridges, without introducing procedural noise, raster textures or a large blur pass.

**Two independently composed assets.** In both `warm/far.svg` and `slate/far.svg`, add five broad 1600-source-unit-scale, low-opacity scenic-value washes (dawn cream/sage, blue-hour blue-grey) and four long subdued dry-light contours. Place these after the original distant painting and fog forms, under the existing fine-grain ridge marks, clipped to the existing far terrain. Keep each source below **20 KB**, with all paint insets from left/right tile edges, no external image tags, filters, scripts, shaders, runtime load changes, or moving art. Retain two independent scene palettes and avoid imposing the painterly illustration approval label on SVG engineering intermediates.

**Evidence upgrade.** Alpha 20 already saved 12 actual game Canvas screenshots with matching two-point body/breast RGB snapshots, covering both themes at `320×568`, `360×600`, `390×844` and scroll positions 0/960. Extend the Draft-only one-shot Canvas hook to compute **linearized sRGB relative luminance** of the bird and the original backdrop sampled at *identical positions*, then their absolute differences. Save per-view/frame measurements and per-theme minimum/maximum in `headless-narrow-readability.json`; reject out-of-range/NaN values and missing viewport/atlas coverage in CI.

**Interpretation.** These *two body-point lightness readings* are appropriate for checking changes in a controlled same-run fixture. They are **not WCAG ratios**, edge-recognition accuracy, mean silhouette/background contrast, proof that dark scenes are comfortable to view, or hardware-calibrated light measurements. No arbitrary pass/fail threshold is placed on visual aesthetics; manual screenshot comparisons must account for forest/canopy regions and obstruction edges. Alpha 21 warm/320 near seam <=3.25 guard, source security tests, normal physics and 18 seam captures all remain required.

**Release boundaries.** The final authored high-resolution painterly masters, human quality acceptance, actual skilled high-score play, physical iOS Safari and Android mobile FPS/touch/audio/memory/thermal evidence and removal of QA-only draft infrastructure have not been completed. Leave PR #57 Draft; do not merge `main` or release V4 without explicit authorization.
