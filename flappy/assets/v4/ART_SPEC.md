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
