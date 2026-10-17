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
