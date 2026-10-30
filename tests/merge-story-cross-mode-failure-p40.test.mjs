import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {readStorySave} from '../merge/story/local-storage.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {commitNormalActionWithLock,commitNormalClockWithLock} from '../merge/normal-action-transaction.mjs';
import {createNormalUiFlight} from '../merge/normal-ui-flight.mjs';

// These tests exercise the real save writers, not just different string constants.
// The fake storage is shared by both modes and refuses only selected writes.
function fixture({storyRaw}={}) {
  const normal=JSON.stringify(createInitialState(1000));
  const story=storyRaw??JSON.stringify(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK));
  const workshop=JSON.stringify(createInitialState(1000));
  const data=new Map([[SAVE_KEY,normal],[STORY_SAVE_KEY,story],[STORY_WORKSHOP_KEY,workshop]]);
  const writes=[];
  let rejectNormalWrites=false;
  const storage={
    getItem(key){return data.has(key)?data.get(key):null;},
    setItem(key,value){
      if(key===SAVE_KEY&&rejectNormalWrites)throw new Error('simulated disk failure');
      writes.push(key);
      data.set(key,value);
    }
  };
  return {normal,story,workshop,storage,writes,
    failNormal(){rejectNormalWrites=true;}};
}
function locks() {
  const names=[];
  return {names,request(name,options,callback){
    names.push(name);
    assert.equal(options.mode,'exclusive');
    if(options.ifAvailable===true)
      return Promise.resolve().then(()=>callback({name,mode:'exclusive'}));
    return Promise.resolve().then(()=>callback());
  }};
}
function assertStoryUnchanged(f) {
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.story);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(readStorySave(f.storage).blocked,false);
  assert.equal(readStoryWorkshop(f.storage,1000).blocked,false);
}

test('P40 ordinary action write failure blocks its UI but preserves both story saves and subsequent dialogue',async()=>{
  const f=fixture(),lock=locks(),gate=createNormalUiFlight();
  f.failNormal();
  let published=0;
  const outcome=await gate.run(
    ()=>commitNormalActionWithLock(lock,f.storage,{
      expectedRaw:f.normal,action:state=>moveOrMerge(state,0,2)
    }),
    ()=>published++);
  assert.deepEqual(outcome,{ok:false,reason:'SAVE_REJECTED_OR_UNCERTAIN'});
  assert.equal(gate.blocked,true);
  assert.equal(published,0);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  assertStoryUnchanged(f);
  assert.deepEqual(f.writes,[]);

  // Normal-mode UI blocking is not a license to erase or freeze healthy story saves.
  const before=readStorySave(f.storage).progress;
  const next=completeStoryEntry(before,CORE_STORY_PACK,'arrival','help');
  const saved=await saveStoryDialogueWithLock(lock,f.storage,next,{expectedRaw:f.story});
  assert.deepEqual(saved,{ok:true,mode:'web-lock',value:true});
  assert.equal(readStorySave(f.storage).progress.packs.core.choices.arrival,'help');
  assert.equal(readStoryWorkshop(f.storage,1000).raw,f.workshop);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  assert.deepEqual(f.writes,[STORY_SAVE_KEY]);
  assert.notEqual(lock.names[0],lock.names[1],'normal and story locks must remain distinct');
  assert.deepEqual(await gate.run(()=>({ok:true}),()=>published++),
    {ok:false,reason:'UI_SAVE_BLOCKED'});
});

test('P40 genuine unchanged normal clock passes verified UI gate without touching either story save',async()=>{
  const f=fixture(),lock=locks(),gate=createNormalUiFlight(),seen=[];
  const outcome=await gate.run(
    ()=>commitNormalClockWithLock(lock,f.storage,{expectedRaw:f.normal,now:1000}),
    (state,raw,receipt)=>seen.push({raw,verifiedBaseline:receipt.verifiedBaseline,changed:receipt.changed}));
  assert.deepEqual(outcome,{ok:true,status:'UI_PUBLISHED'});
  assert.deepEqual(seen,[{raw:f.normal,verifiedBaseline:true,changed:false}]);
  assert.equal(gate.blocked,false);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  assertStoryUnchanged(f);
  assert.deepEqual(f.writes,[]);
});

test('P40 corrupt story dialogue remains untouched by valid ordinary-mode read-only clock',async()=>{
  const f=fixture({storyRaw:'{corrupt-story-save'}),gate=createNormalUiFlight();
  const outcome=await gate.run(
    ()=>commitNormalClockWithLock(locks(),f.storage,{expectedRaw:f.normal,now:1000}),
    ()=>{});
  assert.deepEqual(outcome,{ok:true,status:'UI_PUBLISHED'});
  assert.equal(readStorySave(f.storage).blocked,true);
  assert.equal(readStorySave(f.storage).reason,'CORRUPT_SAVE');
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.story);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  assert.deepEqual(f.writes,[]);
});
