import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {readStorySave} from '../merge/story/local-storage.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';

const now=1000;
const raw=value=>JSON.stringify(value);
const rejected=reason=>({ok:false,reason});

function fixture({corruptWorkshop=false}={}){
  const normal=raw(createInitialState(now));
  const story=raw(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK));
  const workshop=corruptWorkshop?'{broken-workshop':raw(createInitialState(now));
  const data=new Map([[SAVE_KEY,normal],[STORY_SAVE_KEY,story],
    [STORY_WORKSHOP_KEY,workshop]]);
  const writes=[];
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  return {normal,story,workshop,storage,writes};
}

function independentLocks(){
  let normalBusy=false;
  const names=[];
  return {names,setNormalBusy:value=>{normalBusy=value;},
    request(name,options,callback){
      names.push(name);
      assert.equal(options.mode,'exclusive');
      if(name===NORMAL_SAVE_LOCK_NAME){
        assert.equal(options.ifAvailable,true);
        return Promise.resolve(callback(normalBusy?null:{name,mode:'exclusive'}));
      }
      assert.equal(options.ifAvailable,undefined,
        'story writers must retain their own independent lock contract');
      return Promise.resolve(callback({name,mode:'exclusive'}));
    }
  };
}

async function advanceStoryDialogue(f,locks){
  const previous=readStorySave(f.storage);
  assert.equal(previous.blocked,false);
  const next=completeStoryEntry(previous.progress,CORE_STORY_PACK,'arrival','help');
  const receipt=await saveStoryDialogueWithLock(locks,f.storage,next,
    {expectedRaw:previous.raw});
  assert.deepEqual(receipt,{ok:true,mode:'web-lock',value:true});
  assert.equal(readStorySave(f.storage).progress.packs.core.choices.arrival,'help');
}

test('P73 verified normal restore preserves both real story saves and permits later story commits',async()=>{
  const f=fixture(),locks=independentLocks(),events=[];
  const runtime=createNormalPageRuntime({locks,storage:f.storage,
    onVerified:(_state,_bytes,kind)=>events.push(kind)});
  assert.equal((await runtime.start({now})).ok,true);
  const restored=raw({...createInitialState(now),revision:4,coins:250});
  assert.equal(validateSave(JSON.parse(restored)),true);
  assert.deepEqual(await runtime.restore(restored,
    {expectedRaw:f.normal,confirmed:true}),{ok:true,status:'UI_PUBLISHED'});
  assert.equal(f.storage.getItem(SAVE_KEY),restored);
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),f.normal);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.story);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(readStorySave(f.storage).blocked,false);
  assert.equal(readStoryWorkshop(f.storage,now).blocked,false);
  assert.deepEqual(events,['startup','restore']);
  assert.equal(f.writes.includes(STORY_SAVE_KEY),false);
  assert.equal(f.writes.includes(STORY_WORKSHOP_KEY),false);

  await advanceStoryDialogue(f,locks);
  const before=readStoryWorkshop(f.storage,now);
  const action=moveOrMerge(before.state,0,2);
  assert.equal(action.ok,true);
  assert.equal(writeStoryWorkshop(f.storage,action.state,
    {expectedRaw:before.raw}),true);
  assert.equal(readStoryWorkshop(f.storage,now).state.revision,
    before.state.revision+1);
  assert.equal(f.storage.getItem(SAVE_KEY),restored,
    'story actions after a normal restore must not rewrite the normal save');
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),f.normal);
  assert.ok(locks.names.includes(NORMAL_SAVE_LOCK_NAME));
  assert.ok(locks.names.some(name=>name!==NORMAL_SAVE_LOCK_NAME),
    'story and normal writes must use different lock names');
});

test('P73 normal restore never repairs or replaces a corrupt story workshop',async()=>{
  const f=fixture({corruptWorkshop:true}),locks=independentLocks();
  const runtime=createNormalPageRuntime({locks,storage:f.storage});
  assert.equal((await runtime.start({now})).ok,true);
  const incoming=raw({...createInitialState(now),revision:2,coins:100});
  assert.equal((await runtime.restore(incoming,
    {expectedRaw:f.normal,confirmed:true})).ok,true);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(readStoryWorkshop(f.storage,now).blocked,true);
  assert.equal(readStoryWorkshop(f.storage,now).reason,'CORRUPT_SAVE');
  assert.equal(f.writes.includes(STORY_WORKSHOP_KEY),false);
  await advanceStoryDialogue(f,locks);
  assert.equal(f.storage.getItem(SAVE_KEY),incoming);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
});

test('P73 normal restore lock contention does not freeze healthy story progress',async()=>{
  const f=fixture(),locks=independentLocks();
  const runtime=createNormalPageRuntime({locks,storage:f.storage});
  assert.equal((await runtime.start({now})).ok,true);
  const incoming=raw({...createInitialState(now),revision:3,coins:100});
  locks.setNormalBusy(true);
  assert.deepEqual(await runtime.restore(incoming,
    {expectedRaw:f.normal,confirmed:true}),rejected('LOCK_BUSY'));
  assert.equal(runtime.blocked,false);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  await advanceStoryDialogue(f,locks);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  locks.setNormalBusy(false);
  assert.equal((await runtime.restore(incoming,
    {expectedRaw:f.normal,confirmed:true})).ok,true);
  assert.equal(f.storage.getItem(SAVE_KEY),incoming);
  assert.equal(readStorySave(f.storage).progress.packs.core.choices.arrival,'help');
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
});

test('P73 actual story-progress file is refused by normal restore without touching story keys',async()=>{
  const f=fixture(),locks=independentLocks();
  const runtime=createNormalPageRuntime({locks,storage:f.storage});
  assert.equal((await runtime.start({now})).ok,true);
  const before=f.writes.length;
  assert.deepEqual(await runtime.restore(f.story,
    {expectedRaw:f.normal,confirmed:true}),rejected('STORY_MODE_FILE'));
  assert.equal(f.writes.length,before);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.story);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(runtime.blocked,false);
});
