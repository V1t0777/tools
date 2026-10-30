import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState} from '../merge/engine.mjs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory} from '../merge/story/runtime.mjs';
import {nextStoryWorkshopAction,isStoryWorkshopRouteCurrent} from '../merge/story/workshop-next-step.mjs';

const progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
const state=createInitialState(12345);
const story={blocked:false,raw:JSON.stringify(progress),progress};
const workshop={blocked:false,raw:JSON.stringify(state),state};
const route=nextStoryWorkshopAction(story,workshop);
const snapshot={storyRaw:story.raw,workshopRaw:workshop.raw,href:route.href};

test('P105 route is valid only for its exact two rendered save snapshots',()=>{
  assert.equal(route.kind,'story');
  assert.equal(isStoryWorkshopRouteCurrent(snapshot,story,workshop),true);
  assert.equal(isStoryWorkshopRouteCurrent(null,story,workshop),false);
  assert.equal(isStoryWorkshopRouteCurrent({...snapshot,href:''},story,workshop),false);
  assert.equal(isStoryWorkshopRouteCurrent({...snapshot,href:'#storefront-goal'},story,workshop),false);
});

test('P105 changed or unreadable narrative/workshop blocks a stale link',()=>{
  assert.equal(isStoryWorkshopRouteCurrent(snapshot,{...story,raw:story.raw+' '},workshop),false);
  assert.equal(isStoryWorkshopRouteCurrent(snapshot,story,{...workshop,raw:workshop.raw+' '}),false);
  assert.equal(isStoryWorkshopRouteCurrent(snapshot,{...story,blocked:true},workshop),false);
  assert.equal(isStoryWorkshopRouteCurrent(snapshot,story,{...workshop,blocked:true}),false);
});

test('P105 workshop anchor preflight checks both saves and page suspension',()=>{
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes('renderedNextRoute=nextAction.href'));
  assert.ok(ui.includes('storyRaw:narrative.raw,workshopRaw:raw,href:nextAction.href'));
  assert.ok(ui.includes("$('workshop-next-action').addEventListener('click',event=>"));
  assert.ok(ui.includes('const story=readStorySave(storage);\n  const workshop=readStoryWorkshop(storage);'));
  assert.ok(ui.includes('const storyAfterWorkshop=readStorySave(storage);'));
  assert.ok(ui.includes('storyAfterWorkshop.raw!==story.raw'));
  assert.ok(ui.includes('!isStoryWorkshopRouteCurrent(snapshot,storyAfterWorkshop,workshop)'));
  assert.ok(ui.includes('event.preventDefault()'));
});
