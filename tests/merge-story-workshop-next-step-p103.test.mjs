import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {nextStoryWorkshopAction} from '../merge/story/workshop-next-step.mjs';

const main=CORE_STORY_PACK.entries.filter(e=>e.kind==='main');
const story=progress=>({blocked:false,raw:JSON.stringify(progress),progress});
const workshop=state=>({blocked:false,raw:JSON.stringify(state),state});
const guide=(progress,state)=>nextStoryWorkshopAction(story(progress),workshop(state));

test('P103 workshop first-volume route follows four real gates and returns to readable scenes',()=>{
  const snapshots=new Map();
  const simulation=simulateStoryBoard({seed:42,onMilestone:(milestone,state)=>{
    assert.equal(validateSave(state),true);
    snapshots.set(milestone.id,state);
  }});
  assert.equal(simulation.complete,true);
  assert.deepEqual([...snapshots.keys()],['first-order','garden','harbor','storefront']);
  let progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  let cursor=0;
  function through(lastId){
    while(cursor<main.length){
      const entry=main[cursor++];
      progress=completeStoryEntry(progress,CORE_STORY_PACK,entry.id,entry.choices[0]?.id??null);
      if(entry.id===lastId)return;
    }
    assert.fail('missing first-volume scene '+lastId);
  }
  assert.equal(guide(progress,createInitialState(1_000)).kind,'story');
  through('signboard');
  assert.deepEqual([guide(progress,createInitialState(1_000)).kind,
    guide(progress,createInitialState(1_000)).href],['workshop','#orders-goal']);
  assert.equal(guide(progress,snapshots.get('first-order')).href,'./story.html#story-first-order');
  through('seed');
  assert.equal(guide(progress,snapshots.get('first-order')).href,'#garden-goal');
  assert.equal(guide(progress,snapshots.get('garden')).href,'./story.html#story-tea-table');
  through('apprentice');
  assert.equal(guide(progress,snapshots.get('garden')).href,'#harbor-goal');
  assert.equal(guide(progress,snapshots.get('harbor')).href,'./story.html#story-harbor-light');
  through('harbor-light');
  assert.equal(guide(progress,snapshots.get('harbor')).href,'#storefront-goal');
  assert.equal(guide(progress,snapshots.get('storefront')).href,'./story.html#story-festival');
  through('letter-answer');
  assert.deepEqual([guide(progress,snapshots.get('storefront')).kind,
    guide(progress,snapshots.get('storefront')).href],['complete','./story.html']);
});

test('P103 missing or corrupt narrative/workshop cannot advertise invented unlocks',()=>{
  const progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  const state=createInitialState(1_000);
  const missing=nextStoryWorkshopAction({blocked:false,raw:null,progress},workshop(state));
  assert.equal(missing.kind,'start');
  assert.equal(missing.href,'./story.html');
  for(const [narrative,workshopRead] of [
    [{blocked:true,reason:'CORRUPT_SAVE'},workshop(state)],
    [story(progress),{blocked:true,reason:'CORRUPT_SAVE'}],
    [story(progress),{blocked:true,reason:'STORAGE_UNAVAILABLE'}]
  ]){
    const action=nextStoryWorkshopAction(narrative,workshopRead);
    assert.equal(action.kind,'unavailable');
    assert.equal(action.href,null);
  }
});

test('P103 workshop navigation remains a read-only accessible link, not a save shortcut',()=>{
  const html=readFileSync(new URL('../merge/story-workshop.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.match(html,/<p id="workshop-next-guidance" role="status" aria-live="polite">/);
  assert.match(html,/<a id="workshop-next-action"[^>]* hidden>/);
  assert.ok(ui.includes('nextStoryWorkshopAction(narrative,{state,raw,blocked,reason})'));
  assert.ok(ui.includes("nextLink.hidden=disabled||!nextAction.href"));
  assert.ok(ui.includes("nextLink.href=nextAction.href"));
  assert.ok(ui.includes("$('workshop-next-guidance').textContent=nextAction.message"));
  assert.equal(html.includes('onclick='),false);
});
