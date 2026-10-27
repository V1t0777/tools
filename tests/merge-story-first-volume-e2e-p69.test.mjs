import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {createEmptyStoryProgress,validateStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {nextCoreStoryJourney} from '../merge/story/journey-guide.mjs';
import {storyGardenBuildAvailable,storyHarborBuildAvailable,
  storyStorefrontBuildAvailable,storyWorkshopRequirement} from '../merge/story/workshop-gate.mjs';
import {storyDialogueCommitAllowed} from '../merge/story/dialogue-commit-guard.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';

const main=CORE_STORY_PACK.entries.filter(entry=>entry.kind==='main');
const read=state=>({state,raw:JSON.stringify(state),blocked:false,reason:null});
function storage(){
  const data=new Map([[SAVE_KEY,'normal-mode-sentinel']]);
  return {data,getItem:key=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,value)};
}
function firstVolume(seed,strategy='greedy'){
  const store=storage();
  let progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  let nextIndex=0;
  const observed=[];
  function through(lastId){
    while(nextIndex<main.length){
      const entry=main[nextIndex++];
      progress=completeStoryEntry(progress,CORE_STORY_PACK,entry.id,
        entry.choices[0]?.id??null);
      if(entry.id===lastId)return;
    }
    assert.fail('missing mainline scene '+lastId);
  }
  function checkGoal(entryId,state){
    assert.equal(validateSave(state),true);
    const raw=JSON.stringify(state);
    store.setItem(STORY_WORKSHOP_KEY,raw);
    assert.equal(storyWorkshopRequirement(entryId,state).met,true,entryId);
    assert.equal(storyDialogueCommitAllowed(store,entryId,raw),true,entryId);
    assert.equal(storyDialogueCommitAllowed(store,entryId,'stale-workshop'),false,
      'a stale cross-save snapshot cannot authorize '+entryId);
    assert.equal(nextCoreStoryJourney(progress,read(state)).entry?.id,entryId);
    assert.equal(nextCoreStoryJourney(progress,read(state)).kind,'story');
  }
  through('signboard');
  assert.equal(nextCoreStoryJourney(progress,read(createInitialState(1_000_000))).kind,
    'workshop','first order must not be narrated before delivery');
  const result=simulateStoryBoard({seed,strategy,maxActions:10_000,onMilestone:(milestone,state)=>{
    observed.push(milestone.id);
    if(milestone.id==='first-order'){
      checkGoal('first-order',state);
      through('seed');
      assert.equal(storyGardenBuildAvailable(progress),true);
      assert.equal(nextCoreStoryJourney(progress,read(state)).kind,'workshop',
        'tea-table must await a real garden');
    }else if(milestone.id==='garden'){
      checkGoal('tea-table',state);
      through('apprentice');
      assert.equal(storyHarborBuildAvailable(progress),true);
      assert.equal(nextCoreStoryJourney(progress,read(state)).kind,'workshop',
        'harbor-light must await a real harbor');
    }else if(milestone.id==='harbor'){
      checkGoal('harbor-light',state);
      through('harbor-light');
      assert.equal(storyStorefrontBuildAvailable(progress),true);
      assert.equal(nextCoreStoryJourney(progress,read(state)).kind,'workshop',
        'festival must await a real storefront');
    }else if(milestone.id==='storefront'){
      checkGoal('festival',state);
      through('letter-answer');
      assert.equal(nextCoreStoryJourney(progress,read(state)).kind,'complete');
    }else assert.fail('unexpected milestone '+milestone.id);
  }});
  assert.equal(result.complete,true,strategy+' seed '+seed+': '+result.reason);
  assert.equal(result.strategy,strategy);
  assert.ok(result.actions<10_000,'unexpected action-cap pressure: '+strategy+' seed '+seed);
  assert.deepEqual(observed,['first-order','garden','harbor','storefront']);
  assert.equal(progress.packs.core.completed.main.length,main.length);
  assert.equal(progress.packs.core.completed.side.length,0,
    'optional side quests must not be mandatory');
  assert.equal(progress.packs.core.completed.incident.length,0,
    'daily events must not be mandatory');
  assert.equal(validateStoryProgress(progress),true);
  assert.equal(store.getItem(SAVE_KEY),'normal-mode-sentinel',
    'story milestones must not write normal-mode economy');
  assert.equal(store.getItem(STORY_SAVE_KEY),null,
    'the audit must not persist narrative progress');
  return {result,progress};
}

test('P69 first-volume mainline + real 7x8 economic gates close on seeded engine states',()=>{
  for(const seed of [0,7,42,20261027,0xffffffff])firstVolume(seed);
});

test('P69 detached milestone snapshots cannot mutate the live simulation',()=>{
  const baseline=simulateStoryBoard({seed:42});
  const observed=[];
  const replay=simulateStoryBoard({seed:42,onMilestone:(milestone,state)=>{
    observed.push(milestone.id);
    state.coins=-100;
    state.board.length=0;
    state.buildings.garden=99;
  }});
  assert.deepEqual(replay,baseline);
  assert.deepEqual(observed,['first-order','garden','harbor','storefront']);
  assert.throws(()=>simulateStoryBoard({onMilestone:true}),RangeError);
});

test('P71 novice first-volume replay respects all twelve story beats and four real gates',()=>{
  const seeds=[0,0xffffffff,...Array.from({length:48},(_,i)=>i*7919+1)];
  for(const seed of seeds)firstVolume(seed,'novice');
});
