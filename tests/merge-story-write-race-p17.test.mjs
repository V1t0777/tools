import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge,validateSave} from '../merge/engine.mjs';
import {createEmptyStoryProgress,validateStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {writeStorySave} from '../merge/story/local-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

// Deterministically model a second tab committing after the first snapshot read
// but before this tab finishes serialization. No timers or flaky parallelism.
function raceOnSecondRead(key,initial,rival){
  let value=initial,reads=0,writes=0;
  const storage={
    getItem(requested){
      assert.equal(requested,key,'only the story key may be read');
      reads++;
      if(reads===2)value=rival;
      return value;
    },
    setItem(requested,next){
      assert.equal(requested,key,'only the story key may be written');
      writes++;
      value=next;
    }
  };
  return {storage,stats:()=>({value,reads,writes})};
}
test('P17 workshop refuses stale write when a rival tab updates during serialization',()=>{
  const base=createInitialState(1000000);
  const expected=JSON.stringify(base);
  const action=moveOrMerge(base,0,2);
  assert.equal(action.ok,true);
  const rival={...base,revision:base.revision+1,coins:base.coins+1};
  assert.equal(validateSave(rival),true);
  const other=JSON.stringify(rival);
  const race=raceOnSecondRead(STORY_WORKSHOP_KEY,expected,other);
  assert.equal(writeStoryWorkshop(race.storage,action.state,{expectedRaw:expected}),false);
  assert.deepEqual(race.stats(),{value:other,reads:2,writes:0});
  assert.notEqual(STORY_WORKSHOP_KEY,SAVE_KEY);
});
test('P17 first workshop save and confirmed reset cannot overwrite a new rival snapshot',()=>{
  const fresh=createInitialState(1000000),other=JSON.stringify(fresh);
  for(const [initial,reset] of [[null,false],['damaged story workshop',true]]){
    const race=raceOnSecondRead(STORY_WORKSHOP_KEY,initial,other);
    assert.equal(writeStoryWorkshop(race.storage,fresh,{expectedRaw:initial,confirmedReset:reset}),false);
    assert.deepEqual(race.stats(),{value:other,reads:2,writes:0});
  }
});
test('P17 dialogue writer refuses rival change during serialization, including explicit reset',()=>{
  const base=createEmptyStoryProgress();
  const expected=JSON.stringify(base);
  const next={...base,revision:1};
  const rival={...base,revision:2};
  assert.equal(validateStoryProgress(next),true);
  assert.equal(validateStoryProgress(rival),true);
  for(const [initial,reset] of [[expected,false],[null,false],['damaged story dialogue',true]]){
    const other=JSON.stringify(rival);
    const race=raceOnSecondRead(STORY_SAVE_KEY,initial,other);
    assert.equal(writeStorySave(race.storage,next,{expectedRaw:initial,confirmedReset:reset}),false);
    assert.deepEqual(race.stats(),{value:other,reads:2,writes:0});
  }
});
test('P17 unchanged snapshots still write successfully, with verification readback',()=>{
  const workshop=createInitialState(1000000);
  const story=createEmptyStoryProgress();
  for(const [key,next,writer] of [
    [STORY_WORKSHOP_KEY,workshop,writeStoryWorkshop],
    [STORY_SAVE_KEY,story,writeStorySave]
  ]){
    const value={raw:null,reads:0,writes:0};
    const storage={
      getItem(k){assert.equal(k,key);value.reads++;return value.raw;},
      setItem(k,v){assert.equal(k,key);value.writes++;value.raw=v;}
    };
    assert.equal(writer(storage,next,{expectedRaw:null}),true);
    assert.equal(value.reads,3,'pre-check, late check and readback');
    assert.equal(value.writes,1);
    assert.equal(value.raw,JSON.stringify(next));
  }
});
test('P17 storage failures at the second read fail closed without writes',()=>{
  const fresh=createInitialState(1000000);
  const story=createEmptyStoryProgress();
  for(const [key,next,writer] of [
    [STORY_WORKSHOP_KEY,fresh,writeStoryWorkshop],
    [STORY_SAVE_KEY,story,writeStorySave]
  ]){
    let reads=0,writes=0;
    const storage={
      getItem(k){assert.equal(k,key);if(++reads===2)throw Error('Storage blocked');return null;},
      setItem(){writes++;}
    };
    assert.equal(writer(storage,next,{expectedRaw:null}),false);
    assert.equal(reads,2);
    assert.equal(writes,0);
  }
});
