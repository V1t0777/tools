import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {storyWorkshopGoalHref,storyWorkshopRequirement} from '../merge/story/workshop-gate.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const routes=Object.freeze({
  'first-order':'orders-goal',
  toolbox:'warehouse-goal',
  'tea-table':'garden-goal',
  'harbor-light':'harbor-goal',
  festival:'storefront-goal'
});

test('P43 every real workshop-gated scene links to its own stable section',()=>{
  const html=read('../merge/story-workshop.html');
  for(const [entry,target] of Object.entries(routes)){
    assert.equal(storyWorkshopRequirement(entry,null).required,true,entry);
    assert.equal(storyWorkshopGoalHref(entry),'./story-workshop.html#'+target);
    const tag=html.match(new RegExp('<section[^>]*\\bid="'+target+'"[^>]*>'));
    assert.ok(tag,'missing target section '+target);
    assert.match(tag[0],/story-goal-target/);
    assert.match(tag[0],/tabindex="-1"/);
    assert.equal(html.match(new RegExp('id="'+target+'"','g')).length,1,'unique target');
  }
});

test('P43 ungated and DLC entries cannot invent workshop anchors',()=>{
  for(const id of ['arrival','seed','old-crate','wrong-letter','nonexistent','__proto__']){
    assert.equal(storyWorkshopRequirement(id,null).required,false);
    assert.equal(storyWorkshopGoalHref(id),'./story-workshop.html');
  }
  assert.equal(storyWorkshopGoalHref(null),'./story-workshop.html');
});

test('P43 story cards and modal both navigate to the same goal-specific target',()=>{
  const ui=read('../merge/story/ui.mjs');
  assert.ok(ui.includes("import {inspectStoryWorkshopRequirement,storyWorkshopRequirement,storyWorkshopGoalHref}"));
  assert.ok(ui.includes("go.href=storyWorkshopGoalHref(entry.id);"));
  assert.ok(ui.includes("link.href=storyWorkshopGoalHref(entry.id);"));
  assert.ok(ui.includes("if(!done&&requirement.required){"));
  assert.ok(ui.includes("requirement.blocked?'前往核对工作台存档 →'"));
  assert.ok(ui.includes("go.textContent=requirement.blocked"));
  assert.ok(ui.includes("go.className='back goal-link'"));
  assert.ok(ui.includes("text.textContent=line.text;"));
  assert.equal(ui.includes('innerHTML'),false);
});

test('P43 warehouse return restores the side-story tab without changing progress',()=>{
  const html=read('../merge/story-workshop.html');
  const ui=read('../merge/story/ui.mjs');
  assert.ok(html.includes('href="./story.html#story-toolbox"'));
  assert.ok(ui.includes("readStoryHash(window.location.hash).kind"));
  assert.ok(ui.includes("kind==='incident'"));
  assert.equal(ui.includes('window.localStorage.setItem('),false);
  assert.equal(ui.includes('history.pushState('),false);
});

test('P43 mobile targets retain safe-area, dark mode, reduced motion and large touch area',()=>{
  const css=read('../merge/story/story.css');
  assert.match(css,/\.story-card \.goal-link\{[^}]*min-height:44px/);
  assert.match(css,/\.story-goal-target:target\{[^}]*outline:/);
  assert.ok(css.includes('scroll-margin-top:16px'));
  assert.ok(css.includes('safe-area-inset'));
  assert.ok(css.includes('prefers-color-scheme:dark'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  for(const key of [STORY_WORKSHOP_KEY,STORY_SAVE_KEY,SAVE_KEY])
    assert.equal(css.includes(key),false);
});
