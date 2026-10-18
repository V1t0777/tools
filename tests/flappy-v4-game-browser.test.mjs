import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const read=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const game=read('flappy/index.html');
const probe=read('tests/flappy-v4-game-browser.mjs');
const workflow=read('.github/workflows/flappy-v4-art-qa.yml');
const builder=read('cloudflare-secure/build.sh');

test('V4 real-game browser evidence reuses the checked-in game renderer without production debug hooks',()=>{
  for(const anchor of ['function frame(t){','function collides(){', "var nextSkin=Math.random()<.5?'warm':'slate';"])
    assert.ok(game.includes(anchor),'game no longer matches expected production renderer');
  assert.match(probe,/readFileSync\(join\(root,'flappy\/index\.html'\)/);
  assert.match(probe,/function visualFixture\(\)/);
  assert.match(probe,/qa\.frames\+\+/);
  assert.match(probe,/qa\.world=cinematicSession/);
  assert.match(probe,/qa\.pipeCount=pipes\.length/);
  assert.match(probe,/qa\.readyMs=performance\.now\(\)-qa\.createdAt/);
  assert.match(probe,/Page\.captureScreenshot/);
  assert.match(probe,/frameIntervalsMs/);
  assert.match(probe,/skin of \['warm','slate'\]/);
  assert.match(probe,/\[390,844\],\[360,600\]/);
  assert.match(probe,/offset of \[0,960\]/);
});

test('V4 browser QA is read-only, draft only and never shipped into production',()=>{
  assert.doesNotMatch(game,/__v4GameQa|qa-game\.html/);
  assert.doesNotMatch(builder,/flappy-v4-game-browser|qa-game\.html/);
  assert.doesNotMatch(read('scripts/build-public.sh'),/flappy-v4-game-browser|qa-game\.html/);
  assert.match(workflow,/github\.event\.pull_request\.draft/);
  assert.match(workflow,/pull_request\.number == 57/);
  assert.match(workflow,/node tests\/flappy-v4-game-browser\.mjs/);
  assert.match(workflow,/flappy-v4-draft-real-game-pr57/);
  assert.match(probe,/Headless Chromium frame intervals are NOT iPhone\/Android FPS/);
});

test('V4 normal input QA keeps genuine gravity and collision on, then restarts via Chromium pointer events',()=>{
  assert.match(probe,/mode:qaArgs\.get\("mode"\)==="live"\?"live":"stabilized"/);
  assert.match(probe,/mode==='live'/);
  assert.match(probe,/__v4GameQa\?\.mode===\\'stabilized\\'/);
  assert.match(probe,/Input\.dispatchMouseEvent/);
  assert.match(probe,/type:'mousePressed'/);
  assert.match(probe,/type:'mouseReleased'/);
  assert.match(probe,/birdYSpan>5/);
  assert.match(probe,/collisionSeen&&window\.__v4GameQa\.gameOverSeen/);
  assert.match(probe,/startCount>=2/);
  assert.match(probe,/headless-live-input-metrics\.json/);
  assert.match(workflow,/test -s v4-game-qa\/headless-live-input-metrics\.json/);
  assert.match(workflow,/live-\*\.png/);
  assert.ok(!game.includes("if(window.__v4GameQa"),'production collisions must not be modified');
});

test('V4 sustained real-pointer QA checks continuous wing motion without disabling physical gameplay',()=>{
  assert.match(probe,/Closed-loop long run/);
  assert.match(probe,/realPointerFlaps:turns\+1/);
  assert.match(probe,/headless-endurance-metrics\.json/);
  assert.match(probe,/unexpectedWingResets/);
  assert.match(probe,/bird\.wingPhase<qa\.previousWingPhase-\.4/);
  assert.match(probe,/Input\.dispatchMouseEvent/);
  assert.match(probe,/snap\.birdY>target\+8&&snap\.birdVy>0/);
  assert.match(probe,/record\.endScroll-record\.startScroll>220/);
  assert.match(probe,/assert\.equal\(record\.unexpectedWingResets,0/);
  assert.match(workflow,/test -s v4-game-qa\/headless-endurance-metrics\.json/);
  assert.doesNotMatch(game,/headless-endurance-metrics|__v4GameQa/);
});

test('V4 multi-round exercise retains real collisions and original randomized pipe layouts for 30+ seconds',()=>{
  assert.match(probe,/kind:'Multi-round Chrome input\/obstacle\/scene retention stress'/);
  assert.match(probe,/began\+16000/);
  assert.match(probe,/state==='ready'\|\|q\.state==='over'/);
  assert.match(probe,/physicalPointerInputs:taps/);
  assert.match(probe,/normalCollisions:collisions/);
  assert.match(probe,/observedObstacleHeightBands:heights\.size/);
  assert.match(probe,/activeWorldMinimumLayers:lowestLayers/);
  assert.match(probe,/cumulativeScroll>100/);
  assert.match(probe,/sceneSwitches,0/);
  assert.match(probe,/headless-multiround-metrics\.json/);
  assert.match(probe,/>=31000/);
  assert.match(workflow,/test -s v4-game-qa\/headless-multiround-metrics\.json/);
  assert.doesNotMatch(game,/headless-multiround-metrics|__v4GameQa/);
});

test('V4 draft-only QA distinguishes browser pointer-to-physics from next Canvas draw',()=>{
  assert.match(probe,/latestPointerAt=performance\.now\(\)/);
  assert.match(probe,/q\.pendingFlap=\{fromPointer:/);
  assert.match(probe,/physics timestamp belongs AFTER bird\.vy is updated/);
  assert.match(probe,/bird\.vy=Math\.min\(bird\.vy,0\)\*\.12-flapPower/);
  assert.match(probe,/qa\.latencySamples\.push\(/);
  assert.match(probe,/pointerToPhysicsMs:/);
  assert.match(probe,/physicsToDrawMs:/);
  assert.match(probe,/pointerToDrawMs:/);
  assert.match(probe,/pointerToDrawP95Ms/);
  assert.match(probe,/last\.inputResponse\.samples>=3/);
  assert.match(probe,/This is an in-browser/);
  assert.doesNotMatch(game,/pendingFlap|latestPointerAt|latencySamples|__v4GameQa/);
});

test('V4 browser evidence measures cold audio initialization without changing shipped AudioContext code',()=>{
  assert.match(probe,/originalInitAudio/);
  assert.match(probe,/audioTimes\.push/);
  assert.match(probe,/audioInitialization:\{calls:audio\.length/);
  assert.match(probe,/maxSynchronousMs/);
  assert.match(probe,/inputResponse:last\.inputResponse/);
  assert.match(workflow,/headless-multiround-metrics\.json/);
  assert.doesNotMatch(game,/originalInitAudio|audioTimes|__v4GameQa/);
});

test('V4 first-tap A/B compares sound-on with sound-off using unchanged source, real pointer events and separate reloads',()=>{
  assert.match(probe,/kind:'Counterbalanced first-tap sound-on vs sound-off Chrome diagnostic'/);
  assert.match(probe,/qaArgs\.get\("sound"\)==="off"\?"off":"on"/);
  assert.match(probe,/localStorage\.setItem\("zhaoFlappySound\.v1"/);
  assert.match(probe,/const order=\[\['warm','off'\],\['warm','on'\]/);
  assert.match(probe,/\['slate','on'\],\['slate','off'\]/);
  assert.match(probe,/audioAb\.scenarios\.length,8/);
  assert.match(probe,/totalAudioCalls,0/);
  assert.match(probe,/totalAudioCalls>=1/);
  assert.match(probe,/headless-audio-ab-metrics\.json/);
  assert.match(probe,/Browser process is reused/);
  assert.match(workflow,/test -s v4-game-qa\/headless-audio-ab-metrics\.json/);
  assert.doesNotMatch(game,/headless-audio-ab-metrics|__v4GameQa/);
});

test('V4 fresh-process first-tap A/B uses the original game with a unique Chrome profile and exactly one actual input',()=>{
  assert.match(probe,/V4_COLD_CASE/);
  assert.match(probe,/coldCaseParts/);
  assert.match(probe,/if\(coldCaseParts\)\{/);
  assert.match(probe,/let profile=mkdtempSync/);
  assert.match(probe,/remote-debugging-port=0/);
  assert.match(probe,/user-data-dir='\+profile/);
  assert.match(probe,/qa\.clicks,1/);
  assert.match(probe,/qa\.sceneStatus,'ready'/);
  assert.match(probe,/qa\.loadedLayers,5/);
  assert.match(probe,/headless-audio-ab-metrics\.json/);
  assert.match(probe,/cold-firsttap\.json/);
  assert.match(probe,/if\(sound==='on'\)assert\.ok\(qa\.audioCalls>=1/);
  assert.match(probe,/else assert\.equal\(qa\.audioCalls,0/);
  assert.match(probe,/Runner OS\/audio backend remains shared/);
  assert.doesNotMatch(game,/V4_COLD_CASE|cold-firsttap\.json|__v4GameQa/);
});

test('V4 draft CI runs sixteen independent cold browser invocations before warmed game captures',()=>{
  assert.match(workflow,/name: Capture isolated Chrome-process first-tap audio A\/B/);
  assert.match(workflow,/Every invocation starts its OWN Chrome process/);
  assert.match(workflow,/V4_COLD_CASE="\$spec" node tests\/flappy-v4-game-browser\.mjs/);
  assert.match(workflow,/for spec in/);
  assert.match(workflow,/warm:on:1:prime/);
  assert.match(workflow,/warm:on:1:control/);
  assert.match(workflow,/slate:off:2:prime/);
  assert.match(workflow,/slate:off:2:control/);
  assert.match(workflow,/len\(files\)==16/);
  assert.match(workflow,/cold-process-summary\.json/);
  assert.match(workflow,/name: flappy-v4-draft-cold-audio-pr57/);
  assert.ok(workflow.indexOf('Capture isolated Chrome-process first-tap audio A/B') <
            workflow.indexOf('Capture actual Flappy game Canvas'));
  assert.doesNotMatch(game,/V4_COLD_CASE|cold-process-summary|headless-audio-ab-metrics/);
});

test('V4 idle prime experiment remains isolated from production debug controls',()=>{
  assert.match(game,/var AUDIO_IDLE_PRIME=true/);
  assert.match(game,/function primeAudioAtIdle\(\)/);
  assert.match(game,/navigator\.userAgentData&&navigator\.userAgentData\.brands/);
  assert.match(game,/entry\.brand==='Chromium'/);
  assert.match(game,/function primeOnIdle\(deadline\)/);
  assert.match(game,/budgetRetries\+\+<3/);
  assert.match(game,/requestIdleCallback\(primeOnIdle\)/);
  assert.match(game,/state!=='ready'\|\|document\.hidden/);
  assert.match(probe,/AUDIO_IDLE_PRIME=window\.__v4GameQa\.prewarm/);
  assert.match(probe,/primeSuccess/);
  assert.match(probe,/primedAudioMs/);
  assert.match(probe,/variant==='control'/);
  assert.match(workflow,/len\(combinations\)==16/);
  assert.doesNotMatch(game,/coldCaseParts|__v4GameQa|V4_COLD_CASE/);
});

test('V4 fresh-process comparison records ready-screen long frames as well as tap latency',()=>{
  assert.match(probe,/preTapFrames=JSON\.parse/);
  assert.match(probe,/slow24ms:a\.filter\(v=>v>24\)\.length/);
  assert.match(probe,/slow40ms:a\.filter\(v=>v>40\)\.length/);
  assert.match(probe,/preTapFrames\.samples>=15/);
  assert.match(probe,/wallFrameIntervals/);
  assert.match(probe,/performance\.now\(\)/);
  assert.match(probe,/wallMaxMs/);
  assert.match(probe,/wallSlow40ms/);
  assert.match(probe,/readyElapsedMs,preTapFrames/);
  assert.doesNotMatch(game,/preTapFrames|slow24ms|__v4GameQa/);
});

test('V4 browser QA allows one clean-profile retry for Chrome debugging startup only',()=>{
 assert.match(probe,/function launchChrome\(\)/);
 assert.match(probe,/const child=spawn\(process\.env\.CHROME/);
 assert.doesNotMatch(probe,/const process=spawn/);
 assert.match(probe,/attempt<2&&\!debuggerPort/);
 assert.match(probe,/profile=mkdtempSync/);
 assert.match(probe,/No gameplay or audio assertion is retried after page navigation/);
 assert.match(probe,/Chrome did not expose debugger after bounded startup retry/);
});


test('Actual-game tile-join sampling captures all parallax layers with direct Canvas pixels, not only static reviewer images',()=>{
 assert.match(probe,/seamQa\.seamTarget===layer\.id/);
 assert.match(probe,/ctx\.getImageData\(joinPx-9,row0,19,row1-row0\)/);
 assert.match(probe,/sampledBeforeGameplayOverlays:true/);
 assert.match(probe,/seamMeanRgbDelta:/);
 assert.match(probe,/adjacentControlRgbDelta:/);
 assert.match(probe,/for\(const \[layer,speed\] of \[\['far',\.045\],\['mid',\.12\],\['near',\.28\]\]\)/);
 assert.match(probe,/const targetScroll=\(tileWidth-expectedX\)\/speed/);
 assert.match(probe,/assert\.equal\(seamAudit\.results\.length,18\)/);
 assert.match(probe,/headless-seam-metrics\.json/);
 assert.match(probe,/seam-game-/);
 assert.match(workflow,/test -s v4-game-qa\/headless-seam-metrics\.json/);
 assert.match(workflow,/seam-game-\*\.png/);
 assert.doesNotMatch(game,/seamQa|seamTarget|seamResult|sampledBeforeGameplayOverlays/);
 assert.doesNotMatch(builder,/headless-seam-metrics|seam-game/);
});


test('V4 Alpha 19 diagnostic separation is sampled only by the Draft browser harness',()=>{
 assert.match(probe,/const visualSeparation=\{kind:/);
 assert.match(probe,/birdCenterVsNearby:difference\(birdFront,birdNearby\)/);
 assert.match(probe,/pipeInnerVsNearby:difference\(pipeFront,pipeNearby\)/);
 assert.match(probe,/readable\.getImageData\(px,py,1,1\)/);
 assert.match(probe,/qa\.birdX=bird\.x;qa\.birdY=bird\.y;/);
 assert.match(probe,/visualSeparation,/);
 assert.match(probe,/compositeReadability:q\.compositeReadability,atlasReady:q\.atlasReady,assets/);
 assert.match(probe,/not perceptual contrast or WCAG/);
 assert.doesNotMatch(game,/visualSeparation|pipeInnerVsNearby|birdCenterVsNearby/);
 assert.doesNotMatch(builder,/visualSeparation|pipeInnerVsNearby/);
});


test('V4 Alpha 20 true Canvas 320-pixel legibility and atlas evidence is Draft-only',()=>{
 assert.match(probe,/for\(const \[width,height\] of \[\[390,844\],\[360,600\],\[320,568\]\]\)/);
 assert.match(probe,/qa\.atlasReady=!!\(flightAtlases\[birdSkin\]&&flightAtlases\[birdSkin\]\.ready\)/);
 assert.match(probe,/window\.__v4GameQa\.atlasReady/);
 assert.match(probe,/contrastQa\.mode==='stabilized'&&contrastQa\.contrastProbe/);
 assert.match(probe,/one-shot \*matched-position\* backdrop\/bird readback/);
 assert.match(probe,/backgroundCenter:contrastRgb\(aX,aY\)/);
 assert.match(probe,/backgroundBreast:contrastRgb\(aX\+r\*\.37,aY\+r\*\.28\)/);
 assert.match(probe,/centerRgbDelta:rgbDelta\(center,contrastBefore\.backgroundCenter\)/);
 assert.match(probe,/breastRgbDelta:rgbDelta\(breast,contrastBefore\.backgroundBreast\)/);
 assert.match(probe,/assert\.equal\(evidence\.samples\.length,12\)/);
 assert.match(probe,/assert\.equal\(seamAudit\.results\.length,18\)/);
 assert.match(probe,/headless-narrow-readability\.json/);
 assert.match(probe,/const narrowReadability=/);
 assert.match(probe,/assert\.equal\(narrowReadability\.captures\.filter\(x=>x\.viewport==='320x568'\)\.length,4\)/);
 assert.match(workflow,/test -s v4-game-qa\/headless-narrow-readability\.json/);
 assert.match(workflow,/seam-game-\*\.png' \| wc -l\)" -eq 18/);
 assert.match(workflow,/game-\*\.png' \| wc -l\)" -eq 12/);
 assert.match(workflow,/v4-game-qa\/headless-narrow-readability\.json/);
 assert.match(probe,/NOT WCAG, visible edge detection, Android\/iOS hardware proof/);
 // Never embed the sampling hook or QA debug state in the production game.
 assert.doesNotMatch(game,/contrastProbe|compositeReadability|contrastQa|headless-narrow-readability/);
 assert.doesNotMatch(builder,/contrastProbe|compositeReadability|headless-narrow-readability/);
});


test('Alpha 21 keeps narrow warm-near improvement guard inside the Draft browser harness',()=>{
 assert.match(probe,/Alpha 21 narrow warm-near seam regression/);
 assert.match(probe,/sample\.seamMeanRgbDelta<=3\.25/);
 assert.match(probe,/skin==='warm'&&width===320&&height===568&&layer==='near'/);
 assert.doesNotMatch(game,/Alpha 21 narrow warm-near seam regression/);
 assert.doesNotMatch(builder,/Alpha 21 narrow warm-near seam regression/);
});


test('Alpha 22 luminance diagnostics remain one-shot, bounded and strictly Draft-only',()=>{
 assert.match(probe,/function linearChannel\(v\)\{v=v\/255/);
 assert.match(probe,/v<=\.04045\?v\/12\.92:Math\.pow\(\(v\+\.055\)\/1\.055,2\.4\)/);
 assert.match(probe,/function luminance\(rgb\)/);
 assert.match(probe,/\.2126\*linearChannel\(rgb\[0\]\)/);
 assert.match(probe,/\.7152\*linearChannel\(rgb\[1\]\)/);
 assert.match(probe,/\.0722\*linearChannel\(rgb\[2\]\)/);
 assert.match(probe,/centerLinearLuminanceGap:luminanceGap\(center,contrastBefore\.backgroundCenter\)/);
 assert.match(probe,/breastLinearLuminanceGap:luminanceGap\(breast,contrastBefore\.backgroundBreast\)/);
 assert.match(probe,/narrowReadability\.luminanceSummary=\['warm','slate'\]\.map/);
 assert.match(probe,/minCenterGap:Math\.min\(\.\.\.values\)/);
 assert.match(probe,/for\(const name of \['centerLinearLuminance','underCenterLinearLuminance'/);
 assert.match(probe,/NOT WCAG, outline legibility, human perception or hardware verification/);
 assert.doesNotMatch(game,/function linearChannel|centerLinearLuminanceGap|luminanceSummary/);
 assert.doesNotMatch(builder,/centerLinearLuminanceGap|luminanceSummary/);
});


test('Alpha 23 no-script real atlas pose capture expands draft-only evidence safely',()=>{
 assert.match(workflow,/for phase in power recovery glide/);
 assert.match(workflow,/for shape in "320 568" "390 844"/);
 assert.match(workflow,/pose-\$theme-\$phase-\$W/);
 assert.match(workflow,/review-v4\.html#\$theme-\$phase/);
 assert.match(workflow,/scene_count=len\(list\(Path\("v4-art-qa"\)\.glob\("scene-\*\.png"\)\)\)/);
 assert.match(workflow,/if \(scene_count,seam_count,pose_count,pilot_count,master_count,pilot_seam_count,mid_count,stack_count,mid_seam_count,mist_count,atmo_count,mist_seam_count,sky_count,light_count,near_count,full_count,near_seam_count,alpha29_ref_count,alpha31_raster_count,alpha31_raster_seam_count,alpha32_raster_count,alpha32_raster_seam_count\)!=\(8,8,12,4,10,2,4,4,2,4,4,2,4,4,4,4,2,4,4,2,4,2\)/);
 assert.match(workflow,/Keep 98 browser artwork shots and four actual 1600px RGBA study outputs/);
 assert.match(workflow,/if: github\.event\.pull_request\.draft && github\.event\.pull_request\.number == 57/);
 assert.doesNotMatch(game,/phase-anchor|review-v4\.html|pose-\$theme-\$phase/);
 assert.doesNotMatch(builder,/phase-anchor|pose-\$theme-\$phase/);
});


test('Alpha 24 painted master pilot is never loaded into the real game and has exactly two A/B captures',()=>{
 assert.match(workflow,/test -s flappy\/assets\/v4\/masters\/warm\/far-master-pilot\.svg/);
 assert.match(workflow,/test -s flappy\/assets\/v4\/pilot\/warm\/far\.svg/);
 assert.match(workflow,/for shape in "320 568" "390 844"/);
 assert.match(workflow,/review-v4\.html#warm-pilot/);
 assert.match(workflow,/! cmp -s "\$png" "v4-art-qa\/scene-\$theme-\$W/);
 assert.match(workflow,/pilot_count=sum\(len\(list\(Path\("v4-art-qa"\)\.glob\(f"pilot-\{theme\}-far-\*\.png"\)\)\) for theme in \("warm","slate"\)\)/);
 assert.doesNotMatch(game,/pilot\/warm\/far\.svg|far-master-pilot\.svg|warm-pilot/);
 assert.doesNotMatch(builder,/pilot\/warm\/far\.svg|far-master-pilot\.svg|warm-pilot/);
});


test('Alpha 24 master raster proof remains an expiring Draft-only evidence file',()=>{
 assert.match(workflow,/--window-size="3200,2000"/);
 assert.match(workflow,/master-warm-far-3200x2000\.png/);
 assert.match(workflow,/masters\/warm\/far-master-pilot\.svg/);
 assert.match(workflow,/master_count=len\(list\(Path\("v4-art-qa"\)\.glob\("master-\*\.png"\)\)\)/);
 assert.match(workflow,/retention-days: 7/);
 assert.doesNotMatch(game,/master-warm-far|far-master-pilot|pilot\/warm\/far/);
});


test('Alpha 25 both painted pilot masters, four A/B frames and two edge joins are Draft-only',()=>{
 for(const theme of ['warm','slate']){
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/masters/'+theme+'/far-master-pilot\\.svg'));
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/pilot/'+theme+'/far\\.svg'));
 }
 assert.match(workflow,/for theme in warm slate; do/);
 assert.match(workflow,/pilot-\$theme-far-\$W/);
 assert.match(workflow,/review-v4\.html#\$theme-pilot/);
 assert.match(workflow,/pilot-seam-\$theme-320x568\.png/);
 assert.match(workflow,/review-v4\.html#\$theme-pilot-seam/);
 assert.match(workflow,/master-\$theme-far-3200x2000\.png/);
 assert.match(workflow,/pilot_seam_count=len\(list\(Path\("v4-art-qa"\)\.glob\("pilot-seam-\*\.png"\)\)\)/);
 assert.match(workflow,/if \(scene_count,seam_count,pose_count,pilot_count,master_count,pilot_seam_count,mid_count,stack_count,mid_seam_count,mist_count,atmo_count,mist_seam_count,sky_count,light_count,near_count,full_count,near_seam_count,alpha29_ref_count,alpha31_raster_count,alpha31_raster_seam_count,alpha32_raster_count,alpha32_raster_seam_count\)!=\(8,8,12,4,10,2,4,4,2,4,4,2,4,4,4,4,2,4,4,2,4,2\)/);
 assert.match(workflow,/if: github\.event\.pull_request\.draft && github\.event\.pull_request\.number == 57/);
 assert.doesNotMatch(game,/pilot\/slate\/far|far-master-pilot|slate-pilot-seam/);
 assert.doesNotMatch(builder,/pilot\/slate\/far|far-master-pilot|slate-pilot-seam/);
});


test('Alpha 26 middle painting evidence is 12 added Draft-only PNGs, never live-game overrides',()=>{
 for(const theme of ['warm','slate']){
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/masters/'+theme+'/mid-master-pilot\\.svg'));
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/pilot/'+theme+'/mid\\.svg'));
 }
 assert.match(workflow,/for kind in mid stack/);
 assert.match(workflow,/pilot-\$kind-\$theme-\$W/);
 assert.match(workflow,/review-v4\.html#\$theme-\$kind-pilot/);
 assert.match(workflow,/pilot-mid-seam-\$theme-320x568\.png/);
 assert.match(workflow,/master-\$theme-mid-3200x2000\.png/);
 assert.match(workflow,/mid_seam_count=len\(list\(Path\("v4-art-qa"\)\.glob\("pilot-mid-seam-\*\.png"\)\)\)/);
 assert.match(workflow,/stack_count=len\(list\(Path\("v4-art-qa"\)\.glob\("pilot-stack-\*\.png"\)\)\)/);
 assert.doesNotMatch(game,/pilot\/slate\/mid|pilot\/warm\/mid|mid-master-pilot|stack-pilot/);
 assert.doesNotMatch(builder,/pilot\/slate\/mid|pilot\/warm\/mid|mid-master-pilot|stack-pilot/);
});


test('Alpha 26 painting seam PNG decode and actual RGB checks reject hand-painted tile edge defects',()=>{
 const audit=read('tests/flappy-v4-pilot-seam-check.py');
 assert.match(audit,/import zlib/);
 assert.match(audit,/def png_rgb\(path: Path\):/);
 assert.match(audit,/def seam_audit\(path: Path\):/);
 assert.match(audit,/zlib\.crc32\(kind \+ value\)/);
 assert.match(audit,/filtertype == 4/);
 assert.match(audit,/pilot-\{layer\}-seam-\{theme\}-320x568\.png/);
 assert.match(audit,/pilot-seam-\{theme\}-320x568\.png/);
 assert.match(audit,/mean <= 4\.0 and mean <= reference \+ 2\.25/);
 assert.match(audit,/if not all\(row\["passes"\] for row in reports\):/);
 assert.match(workflow,/python3 tests\/flappy-v4-pilot-seam-check\.py v4-art-qa/);
 assert.match(workflow,/v4-art-qa\/headless-painted-pilot-seams\.json/);
 assert.doesNotMatch(game,/flappy-v4-pilot-seam-check\.py|headless-painted-pilot-seams/);
});


test('Alpha 27 12 mist visual proofs and 6 real PNG seam samples remain Draft-only',()=>{
 for(const theme of ['warm','slate']){
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/masters/'+theme+'/mist-master-pilot\\.svg'));
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/pilot/'+theme+'/mist\\.svg'));
 }
 assert.match(workflow,/for kind in mist atmo/);
 assert.match(workflow,/pilot-\$kind-\$theme-\$W/);
 assert.match(workflow,/review-v4\.html#\$theme-\$kind-pilot/);
 assert.match(workflow,/master-\$theme-mist-3200x2000\.png/);
 assert.match(workflow,/pilot-mist-seam-\$theme-320x568\.png/);
 assert.match(workflow,/pilot-mist-seam-\*\.png/);
 assert.match(workflow,/mist_count=len\(list\(Path\("v4-art-qa"\)\.glob\("pilot-mist-\*\.png"\)\)\)/);
 assert.match(workflow,/if \(scene_count,seam_count,pose_count,pilot_count,master_count,pilot_seam_count,mid_count,stack_count,mid_seam_count,mist_count,atmo_count,mist_seam_count,sky_count,light_count,near_count,full_count,near_seam_count,alpha29_ref_count,alpha31_raster_count,alpha31_raster_seam_count,alpha32_raster_count,alpha32_raster_seam_count\)!=\(8,8,12,4,10,2,4,4,2,4,4,2,4,4,4,4,2,4,4,2,4,2\)/);
 const seamAudit=read('tests/flappy-v4-pilot-seam-check.py');
 assert.match(seamAudit,/for layer in \("far", "mid", "mist", "near"\):/);
 assert.doesNotMatch(game,/mist-master-pilot|pilot\/slate\/mist|pilot\/warm\/mist|atmo-pilot/);
 assert.doesNotMatch(builder,/mist-master-pilot|pilot\/slate\/mist|pilot\/warm\/mist|atmo-pilot/);
});


test('Alpha 27 compressed transparent mist screenshot exception keeps all ordinary PNG size gates',()=>{
 assert.match(workflow,/min_bytes=12000 if path\.name\.startswith\(\("pilot-mist-seam-", "pilot-near-seam-"\)\) else 20000/);
 assert.match(workflow,/if len\(b\)<min_bytes:/);
 assert.match(workflow,/Wrong mobile capture dimensions:/);
 assert.match(workflow,/b\[:8\]!=b"\\x89PNG/);
 assert.match(workflow,/python3 tests\/flappy-v4-pilot-seam-check\.py v4-art-qa/);
 assert.doesNotMatch(game,/min_bytes=12000|pilot-mist-seam-/);
});


test('Alpha 28 original sun and moon source sky A/B never enters game renderer',()=>{
 for(const th of ['warm','slate']){
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/masters/'+th+'/sky-master-pilot\\.svg'));
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/pilot/'+th+'/sky\\.svg'));
 }
 assert.match(workflow,/for kind in sky light; do/);
 assert.match(workflow,/review-v4\.html#\$theme-\$kind-pilot/);
 assert.match(workflow,/pilot-\$kind-\$theme-\$W/);
 assert.match(workflow,/master-\$theme-sky-3200x2000\.png/);
 assert.match(workflow,/sky_count=len\(list\(Path\("v4-art-qa"\)\.glob\("pilot-sky-\*\.png"\)\)\)/);
 assert.match(workflow,/light_count=len\(list\(Path\("v4-art-qa"\)\.glob\("pilot-light-\*\.png"\)\)\)/);
 assert.match(workflow,/if \(scene_count,seam_count,pose_count,pilot_count,master_count,pilot_seam_count,mid_count,stack_count,mid_seam_count,mist_count,atmo_count,mist_seam_count,sky_count,light_count,near_count,full_count,near_seam_count,alpha29_ref_count,alpha31_raster_count,alpha31_raster_seam_count,alpha32_raster_count,alpha32_raster_seam_count\)!=\(8,8,12,4,10,2,4,4,2,4,4,2,4,4,4,4,2,4,4,2,4,2\)/);
 assert.doesNotMatch(game,/sky-master-pilot|pilot\/slate\/sky|pilot\/warm\/sky|light-pilot/);
 assert.doesNotMatch(builder,/sky-master-pilot|pilot\/slate\/sky|pilot\/warm\/sky|light-pilot/);
});


test('Alpha 29 Draft-only near and full five-layer originals produce 82 screenshots without game changes',()=>{
 for(const theme of ['warm','slate']){
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/masters/'+theme+'/near-master-pilot\\.svg'));
   assert.match(workflow,new RegExp('test -s flappy/assets/v4/pilot/'+theme+'/near\\.svg'));
 }
 assert.match(workflow,/for kind in near full; do/);
 assert.match(workflow,/review-v4\.html#\$theme-\$kind-pilot/);
 assert.match(workflow,/pilot-\$kind-\$theme-\$W/);
 assert.match(workflow,/master-\$theme-near-3200x2000\.png/);
 assert.match(workflow,/pilot-near-seam-\$theme-320x568\.png/);
 assert.match(workflow,/near_count=len\(list\(Path\("v4-art-qa"\)\.glob\("pilot-near-\*\.png"\)\)\)/);
 assert.match(workflow,/near_seam_count=len\(list\(Path\("v4-art-qa"\)\.glob\("pilot-near-seam-\*\.png"\)\)\)/);
 assert.match(workflow,/full_count=len\(list\(Path\("v4-art-qa"\)\.glob\("pilot-full-\*\.png"\)\)\)/);
 assert.match(workflow,/if \(scene_count,seam_count,pose_count,pilot_count,master_count,pilot_seam_count,mid_count,stack_count,mid_seam_count,mist_count,atmo_count,mist_seam_count,sky_count,light_count,near_count,full_count,near_seam_count,alpha29_ref_count,alpha31_raster_count,alpha31_raster_seam_count,alpha32_raster_count,alpha32_raster_seam_count\)!=\(8,8,12,4,10,2,4,4,2,4,4,2,4,4,4,4,2,4,4,2,4,2\)/);
 const audit=read('tests/flappy-v4-pilot-seam-check.py');
 assert.match(audit,/for layer in \("far", "mid", "mist", "near"\):/);
 assert.doesNotMatch(game,/near-master-pilot|pilot\/warm\/near|pilot\/slate\/near|full-pilot/);
 assert.doesNotMatch(builder,/near-master-pilot|pilot\/warm\/near|pilot\/slate\/near|full-pilot/);
});


test('Alpha 29 low-compression near tile PNG exception is narrow and checked pixel-by-pixel',()=>{
 assert.match(workflow,/min_bytes=12000 if path\.name\.startswith\(\("pilot-mist-seam-", "pilot-near-seam-"\)\) else 20000/);
 assert.match(workflow,/if len\(b\)<min_bytes/);
 assert.match(workflow,/python3 tests\/flappy-v4-pilot-seam-check\.py v4-art-qa/);
 assert.match(workflow,/v4-art-qa\/headless-painted-pilot-seams\.json/);
 assert.doesNotMatch(game,/pilot-near-seam-|min_bytes=12000/);
});


test('Alpha 30 comparison uses retained original Alpha 29 forest imagery and counts all four screenshots',()=>{
 const reviewer=read('flappy/review-v4.html');
 for(const theme of ['warm','slate']){
  assert.match(workflow,new RegExp('test -s flappy/assets/v4/masters/'+theme+'/near-master-alpha29\\.svg'));
  assert.match(workflow,new RegExp('test -s flappy/assets/v4/pilot/'+theme+'/near-alpha29\\.svg'));
  assert.match(reviewer,new RegExp('id="'+theme+'-near-alpha29"'));
 }
 assert.match(workflow,/alpha29-near-\$theme-\$W/);
 assert.match(workflow,/review-v4\.html#\$theme-near-alpha29/);
 assert.match(workflow,/alpha29_ref_count=len\(list\(Path\("v4-art-qa"\)\.glob\("alpha29-near-\*\.png"\)\)\)/);
 assert.match(workflow,/if \(scene_count,seam_count,pose_count,pilot_count,master_count,pilot_seam_count,mid_count,stack_count,mid_seam_count,mist_count,atmo_count,mist_seam_count,sky_count,light_count,near_count,full_count,near_seam_count,alpha29_ref_count,alpha31_raster_count,alpha31_raster_seam_count,alpha32_raster_count,alpha32_raster_seam_count\)!=\(8,8,12,4,10,2,4,4,2,4,4,2,4,4,4,4,2,4,4,2,4,2\)/);
 assert.doesNotMatch(game,/near-alpha29|data-natural-contour|near-master-pilot/);
});


test('Alpha 31 offline deterministic RGBA near raster resources and 92 Draft Chrome screenshots',()=>{
 const painter=read('tests/flappy-v4-raster-pigment.py');
 assert.match(painter,/def raster_pigment\(svg_path: Path, theme: str, target: Path\)/);
 assert.match(painter,/cairosvg\.svg2png/);
 assert.match(painter,/Image\.frombytes\("RGBA"/);
 assert.match(painter,/SEEDS = \{"warm": 30031, "slate": 71931\}/);
 assert.match(painter,/assert out\.getchannel\("A"\)\.tobytes\(\) == base\.getchannel\("A"\)\.tobytes\(\)/);
 assert.match(painter,/target\.parent\.mkdir/);
 assert.match(painter,/for x in range\(WIDTH\)/);
 assert.match(painter,/transparent_alpha_preserved/);
 assert.match(painter,/production_art_approved": False/);
 assert.match(workflow,/Generate offline alpha-accurate original raster pigment candidates \(QA only\)/);
 assert.match(workflow,/CairoSVG==2\.8\.2/);
 assert.match(workflow,/Pillow==11\.3\.0/);
 assert.match(workflow,/python tests\/flappy-v4-raster-pigment\.py/);
 assert.match(workflow,/alpha31-raster-\$theme-\$W/);
 assert.match(workflow,/alpha31-raster-seam-\$theme-320x568/);
 assert.match(workflow,/v4-art-qa\/alpha31-raster\/\*\.png/);
 assert.match(workflow,/alpha31-pigment-study-metrics\.json/);
 assert.match(workflow,/if \(scene_count,seam_count,pose_count,pilot_count,master_count,pilot_seam_count,mid_count,stack_count,mid_seam_count,mist_count,atmo_count,mist_seam_count,sky_count,light_count,near_count,full_count,near_seam_count,alpha29_ref_count,alpha31_raster_count,alpha31_raster_seam_count,alpha32_raster_count,alpha32_raster_seam_count\)!=\(8,8,12,4,10,2,4,4,2,4,4,2,4,4,4,4,2,4,4,2,4,2\)/);
 const seam=read('tests/flappy-v4-pilot-seam-check.py');
 assert.match(seam,/alpha31-raster-seam-\{theme\}-320x568\.png/);
 assert.doesNotMatch(game,/near-raster-alpha31|cairosvg|raster-pigment/);
 assert.doesNotMatch(builder,/near-raster-alpha31|cairosvg|raster-pigment/);
});

test('Alpha32 directed material brush candidate is isolated and auditable',()=>{
 const art=read('tests/flappy-v4-directional-paint.py');
 const wf=read('.github/workflows/flappy-v4-art-qa.yml');
 const html=read('flappy/review-v4.html');
 const seam=read('tests/flappy-v4-pilot-seam-check.py');
 assert.match(art,/def paint_master\(master: Path, theme: str, destination: Path\)/);
 assert.match(art,/source_repeat_border_px/);
 assert.match(art,/ImageChops\.multiply/);
 assert.match(art,/get_tree_guides/);
 assert.match(art,/material_directions/);
 assert.match(wf,/flappy-v4-directional-paint\.py/);
 assert.match(wf,/alpha32-raster-\$theme-\$W/);
 assert.match(wf,/alpha32-raster-seam-\$theme-320x568/);
 assert.match(wf,/Alpha 32 expected 98 static art screenshots/);
 assert.match(seam,/alpha32-raster-seam-\{theme\}-320x568\.png/);
 for(const theme of ['warm','slate']){
  assert.ok(html.includes('id="'+theme+'-raster-alpha32"'));
  assert.ok(html.includes('id="'+theme+'-raster-alpha32-seam"'));
 }
 assert.doesNotMatch(game,/near-raster-alpha32|directional-paint/);
 assert.doesNotMatch(builder,/near-raster-alpha32|directional-paint/);
});
