import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('mobile RC entrypoints preserve viewport-fit safe area and separate storage',()=>{
  for(const file of ['merge/index.html','merge/story.html','merge/story-workshop.html','merge/cloud-preview.html'])
    assert.match(read(file),/viewport-fit=cover/);
  const normal=read('merge/style.css'),story=read('merge/story/story.css'),
    workshop=read('merge/story/workshop.css'),cloud=read('merge/cloud-preview.css');
  assert.match(normal,/safe-area-inset-bottom/);
  assert.match(normal,/min-height:44px/);
  assert.match(story,/\.dialog-inner\{max-height:calc\(100dvh/);
  assert.match(story,/\.dialog-choices button\{min-height:48px/);
  assert.match(workshop,/\.workshop-cell\{touch-action:manipulation/);
  assert.match(workshop,/\.workshop-board-navigation button\{flex:1 1 50%;min-height:44px/);
  assert.match(normal,/\.supply-select\{font-size:16px/);
  assert.match(cloud,/input\{font-size:16px/);
  assert.match(cloud,/\.board-navigation button\{flex:1 1 50%;min-height:44px/);
});
test('cloud mobile arrows are accessible non-gameplay controls',()=>{
  const html=read('merge/cloud-preview.html'),js=read('merge/cloud-preview.mjs');
  assert.match(html,/id="cloud-board-viewport"[^>]*role="region" tabindex="0"/);
  assert.match(html,/id="cloud-board-left"[^>]*aria-controls="cloud-board-viewport"/);
  assert.match(html,/id="cloud-board-right"[^>]*aria-controls="cloud-board-viewport"/);
  assert.match(js,/function scrollCloudBoard\(direction\)/);
  assert.match(js,/boardLeft.addEventListener\('click'/);
  assert.match(js,/boardRight.addEventListener\('click'/);
  const navFunction=js.slice(js.indexOf('function scrollCloudBoard(direction)'),js.indexOf("boardLeft.addEventListener('click'"));
  assert.doesNotMatch(navFunction,/session\.enqueue|session\.flush/);
});
test('private RC never adds the game to public build output or deploys backend',()=>{
  const publicBuild=read('scripts/build-public.sh');
  const secureBuild=read('cloudflare-secure/build.sh');
  for(const script of [publicBuild,secureBuild])
    assert.doesNotMatch(script,/cp\s+[^\n]*merge\/|\/merge\/cloud-preview/);
  assert.match(read('scripts/build-yunyu-private-review.sh'),/127\.0\.0\.1/);
});

test('story workshop mobile arrows never write game state or bypass save guards',()=>{
  const html=read('merge/story-workshop.html');
  const nav=read('merge/story/workshop-mobile-navigation.mjs');
  assert.match(html,/id="workshop-board-viewport"[^>]*role="region"[^>]*tabindex="0"/);
  assert.match(html,/id="workshop-board-left"[^>]*aria-controls="workshop-board-viewport"/);
  assert.match(html,/id="workshop-board-right"[^>]*aria-controls="workshop-board-viewport"/);
  assert.match(nav,/previous.addEventListener/);
  assert.match(nav,/next.addEventListener/);
  assert.doesNotMatch(nav,/localStorage|indexedDB|\.enqueue\(|\.execute\(|\.persist\(|\.write\(/);
});
