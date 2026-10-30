import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {STORY_WORKSHOP_KEY,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';

const NOW=1_000_000;
const locks={request(name,options,callback){
  assert.equal(name,NORMAL_SAVE_LOCK_NAME);
  assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
  return Promise.resolve(callback({name,mode:'exclusive'}));
}};
function fixture(){
  const normalRaw=JSON.stringify(createInitialState(NOW));
  const values=new Map([[SAVE_KEY,normalRaw]]),writes=[];
  let onNormalRead=null;
  const storage={
    getItem(key){
      const value=values.has(key)?values.get(key):null;
      if(key===SAVE_KEY&&onNormalRead){
        const callback=onNormalRead;onNormalRead=null;callback();
      }
      return value;
    },
    setItem(key,value){writes.push(key);values.set(key,value);}
  };
  const initial=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  assert.equal(writeStorySave(storage,initial,{expectedRaw:null}),true);
  assert.equal(writeStoryWorkshop(storage,createInitialState(NOW),{expectedRaw:null}),true);
  const events=[];
  const runtime=createNormalPageRuntime({locks,storage,
    onVerified:(_state,_raw,kind)=>events.push(kind)});
  return {storage,values,writes,runtime,events,
    hook:callback=>{onNormalRead=callback;}};
}
async function start(h){
  assert.equal((await h.runtime.start({now:NOW})).ok,true);
  assert.equal(h.runtime.phase,'ready');
}
function advanceStory(h){
  const old=readStorySave(h.storage);
  assert.equal(old.blocked,false);
  const first=CORE_STORY_PACK.entries.find(entry=>entry.kind==='main');
  const next=completeStoryEntry(old.progress,CORE_STORY_PACK,first.id,
    first.choices[0]?.id??null);
  assert.equal(writeStorySave(h.storage,next,{expectedRaw:old.raw}),true);
  return h.storage.getItem(STORY_SAVE_KEY);
}
function externalNormal(h){
  h.values.set(SAVE_KEY,JSON.stringify({...createInitialState(NOW),
    revision:2,coins:77}));
}
function storyWrites(h){return h.writes.filter(key=>
  key===STORY_SAVE_KEY||key===STORY_WORKSHOP_KEY).length;}

test('P101 normal external reconcile adopts only normal save after story progress advances',async()=>{
  const h=fixture();await start(h);
  const storyRaw=advanceStory(h);
  const workshopRaw=h.storage.getItem(STORY_WORKSHOP_KEY);
  const before=storyWrites(h);
  externalNormal(h);
  assert.deepEqual(h.runtime.reconcile(),{ok:true,changed:true});
  assert.equal(h.runtime.snapshot().coins,77);
  assert.deepEqual(h.events,['startup','external']);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),storyRaw);
  assert.equal(h.storage.getItem(STORY_WORKSHOP_KEY),workshopRaw);
  assert.equal(storyWrites(h),before);
});

test('P101 pagehide during normal reconciliation cannot revoke independently saved story progress',async()=>{
  const h=fixture();await start(h);
  const before=storyWrites(h);
  let savedStory;
  h.hook(()=>{
    h.runtime.invalidate();
    savedStory=advanceStory(h);
  });
  assert.deepEqual(h.runtime.reconcile(),{ok:false,reason:'RECONCILE_INVALIDATED'});
  assert.equal(h.runtime.blocked,true);
  assert.deepEqual(h.events,['startup']);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),savedStory);
  assert.equal(storyWrites(h),before+1);
  assert.equal(h.storage.getItem(SAVE_KEY),h.runtime.raw);
});

test('P101 normal reconciliation never repairs malformed story and workshop UTF-16 evidence',async()=>{
  const h=fixture();await start(h);
  const brokenStory='{"story":'+String.fromCharCode(0xd800);
  const brokenWorkshop='{"workshop":'+String.fromCharCode(0xdc00);
  h.values.set(STORY_SAVE_KEY,brokenStory);
  h.values.set(STORY_WORKSHOP_KEY,brokenWorkshop);
  const before=storyWrites(h);
  externalNormal(h);
  assert.deepEqual(h.runtime.reconcile(),{ok:true,changed:true});
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),brokenStory);
  assert.equal(h.storage.getItem(STORY_WORKSHOP_KEY),brokenWorkshop);
  assert.equal(storyWrites(h),before);
  assert.equal(h.runtime.snapshot().revision,2);
});
