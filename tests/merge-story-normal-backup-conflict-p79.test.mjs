import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {readStorySave} from '../merge/story/local-storage.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';

const NOW=1000;
const encode=value=>JSON.stringify(value);
function fixture({corruptWorkshop=false}={}){
  const normal=encode(createInitialState(NOW));
  const story=encode(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK));
  const workshop=corruptWorkshop?'{broken-story-workshop':normal;
  const data=new Map([[SAVE_KEY,normal],[STORY_SAVE_KEY,story],
    [STORY_WORKSHOP_KEY,workshop]]);
  const writes=[];
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  const names=[];
  const locks={request(name,options,callback){
    names.push(name);
    assert.equal(options.mode,'exclusive');
    if(name===NORMAL_SAVE_LOCK_NAME)assert.equal(options.ifAvailable,true);
    else assert.equal(options.ifAvailable,undefined);
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}));
  }};
  return {normal,story,workshop,data,writes,storage,locks,names};
}
async function firstAndConflictingRestore(f){
  const runtime=createNormalPageRuntime({storage:f.storage,locks:f.locks});
  assert.equal((await runtime.start({now:NOW})).ok,true);
  const first=encode({...createInitialState(NOW),revision:3,coins:120});
  const second=encode({...createInitialState(NOW),revision:4,coins:200});
  assert.equal(validateSave(JSON.parse(first)),true);
  assert.equal(validateSave(JSON.parse(second)),true);
  assert.deepEqual(await runtime.restore(first,
    {expectedRaw:f.normal,confirmed:true}),{ok:true,status:'UI_PUBLISHED'});
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),f.normal);
  const writes=f.writes.length;
  assert.deepEqual(await runtime.restore(second,
    {expectedRaw:first,confirmed:true}),{ok:false,reason:'BACKUP_SLOT_CONFLICT'});
  assert.equal(runtime.blocked,false);
  assert.equal(f.writes.length,writes,'second restore must not write any key');
  assert.equal(f.storage.getItem(SAVE_KEY),first);
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),f.normal);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.story);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  return {runtime,first};
}

test('P79 second normal import backup conflict preserves both story saves and all modes remain writable',async()=>{
  const f=fixture(),{runtime}=await firstAndConflictingRestore(f);
  const story=readStorySave(f.storage);
  const next=completeStoryEntry(story.progress,CORE_STORY_PACK,'arrival','help');
  assert.deepEqual(await saveStoryDialogueWithLock(f.locks,f.storage,next,
    {expectedRaw:story.raw}),{ok:true,mode:'web-lock',value:true});
  const workshop=readStoryWorkshop(f.storage,NOW);
  const moved=moveOrMerge(workshop.state,0,2);
  assert.equal(moved.ok,true);
  assert.equal(writeStoryWorkshop(f.storage,moved.state,
    {expectedRaw:workshop.raw}),true);
  assert.equal((await runtime.action(state=>moveOrMerge(state,0,2))).ok,true);
  assert.equal(readStorySave(f.storage).progress.packs.core.choices.arrival,'help');
  assert.equal(readStoryWorkshop(f.storage,NOW).state.revision,
    workshop.state.revision+1);
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),f.normal);
  assert.equal(JSON.parse(f.storage.getItem(SAVE_KEY)).revision,4);
  assert.ok(f.names.includes(NORMAL_SAVE_LOCK_NAME));
  assert.ok(f.names.some(name=>name!==NORMAL_SAVE_LOCK_NAME),
    'normal and story locks must remain distinct');
});

test('P79 refused second normal import does not auto-repair damaged story workshop',async()=>{
  const f=fixture({corruptWorkshop:true}),{runtime}=await firstAndConflictingRestore(f);
  const damaged=readStoryWorkshop(f.storage,NOW);
  assert.equal(damaged.blocked,true);
  assert.equal(damaged.reason,'CORRUPT_SAVE');
  assert.equal(damaged.raw,f.workshop);
  assert.equal(writeStoryWorkshop(f.storage,createInitialState(NOW),
    {expectedRaw:f.workshop}),false);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  const story=readStorySave(f.storage);
  const next=completeStoryEntry(story.progress,CORE_STORY_PACK,'arrival','help');
  assert.deepEqual(await saveStoryDialogueWithLock(f.locks,f.storage,next,
    {expectedRaw:story.raw}),{ok:true,mode:'web-lock',value:true});
  assert.equal((await runtime.action(state=>moveOrMerge(state,0,2))).ok,true);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),f.normal);
});

test('P79 stale story dialogue after refused normal import cannot overwrite peer progress',async()=>{
  const f=fixture(),{runtime}=await firstAndConflictingRestore(f);
  const before=readStorySave(f.storage);
  const next=completeStoryEntry(before.progress,CORE_STORY_PACK,'arrival','help');
  const peer=completeStoryEntry(before.progress,CORE_STORY_PACK,'arrival','ask');
  // Peer writes a valid later revision between UI read and Web Lock acquisition.
  // The old tab must not replay its previously reviewed choice.
  f.storage.setItem(STORY_SAVE_KEY,encode(peer));
  const writes=f.writes.length;
  const result=await saveStoryDialogueWithLock(f.locks,f.storage,next,
    {expectedRaw:before.raw});
  assert.deepEqual(result,{ok:true,mode:'web-lock',value:false});
  assert.equal(f.writes.length,writes);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),encode(peer));
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal((await runtime.action(state=>moveOrMerge(state,0,2))).ok,true);
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),f.normal);
});
