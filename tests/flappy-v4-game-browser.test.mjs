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
  assert.match(probe,/const profile=mkdtempSync/);
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
  assert.match(game,/requestIdleCallback\(function\(deadline\)/);
  assert.match(game,/state!=='ready'\|\|document\.hidden/);
  assert.match(probe,/AUDIO_IDLE_PRIME=window\.__v4GameQa\.prewarm/);
  assert.match(probe,/primeSuccess/);
  assert.match(probe,/primedAudioMs/);
  assert.match(probe,/variant==='control'/);
  assert.match(workflow,/len\(combinations\)==16/);
  assert.doesNotMatch(game,/coldCaseParts|__v4GameQa|V4_COLD_CASE/);
});
