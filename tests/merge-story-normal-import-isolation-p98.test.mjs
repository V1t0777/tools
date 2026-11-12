import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {performNormalSaveImport} from '../merge/normal-save-import-flow.mjs';

const NOW=1_000;
const raw=value=>JSON.stringify(value);
function fixture({corruptStory=false}={}){
  const normal=raw(createInitialState(NOW));
  const candidate=raw({...createInitialState(NOW),revision:3,coins:180});
  const story=corruptStory?'{"story":'+String.fromCharCode(0xd800):
    raw(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK));
  const workshop=corruptStory?'{"workshop":'+String.fromCharCode(0xdc00):
    raw(createInitialState(NOW));
  const data=new Map([[SAVE_KEY,normal],[STORY_SAVE_KEY,story],
    [STORY_WORKSHOP_KEY,workshop]]);
  const writes=[];
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,String(value));}
  };
  const locks={request(name,options,callback){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    return Promise.resolve(callback({name,mode:'exclusive'}));
  }};
  const runtime=createNormalPageRuntime({storage,locks});
  const config={
    file:{size:new TextEncoder().encode(candidate).length,text:async()=>candidate},
    storage,runtime,confirm:()=>true,revalidate:()=>storage.getItem(SAVE_KEY)===runtime.raw,
    isSuspended:()=>false,getEpoch:()=>0
  };
  return {normal,candidate,story,workshop,data,writes,storage,runtime,config};
}

test('P98 normal native import replaces only normal save; story dialogue remains writable',async()=>{
  const f=fixture();
  assert.equal((await f.runtime.start({now:NOW})).ok,true);
  assert.equal((await performNormalSaveImport(f.config)).ok,true);
  assert.equal(f.storage.getItem(SAVE_KEY),f.candidate);
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),f.normal);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.story);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(f.writes.includes(STORY_SAVE_KEY),false);
  assert.equal(f.writes.includes(STORY_WORKSHOP_KEY),false);
  const previous=readStorySave(f.storage);
  const next=completeStoryEntry(previous.progress,CORE_STORY_PACK,'arrival','help');
  assert.equal(writeStorySave(f.storage,next,{expectedRaw:previous.raw}),true);
  assert.equal(readStorySave(f.storage).progress.packs.core.choices.arrival,'help');
  assert.equal(f.storage.getItem(SAVE_KEY),f.candidate);
  assert.equal(readStoryWorkshop(f.storage,NOW).blocked,false);
});

test('P98 importing a story progress file cannot repair corrupt story/workshop evidence',async()=>{
  const f=fixture({corruptStory:true});
  assert.equal((await f.runtime.start({now:NOW})).ok,true);
  let confirms=0;
  const storyFile=raw(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK));
  f.config.file={size:new TextEncoder().encode(storyFile).length,text:async()=>storyFile};
  f.config.confirm=()=>{confirms++;return true;};
  assert.equal((await performNormalSaveImport(f.config)).reason,'STORY_MODE_FILE');
  assert.equal(confirms,0);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.story);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(readStorySave(f.storage).blocked,true);
  assert.equal(readStoryWorkshop(f.storage,NOW).blocked,true);
  assert.deepEqual(f.writes,[]);
});

test('P98 cross-tab normal replacement during file read blocks import but keeps peer story advance',async()=>{
  const f=fixture();
  assert.equal((await f.runtime.start({now:NOW})).ok,true);
  const newer=raw({...createInitialState(NOW),revision:5,coins:275});
  let confirms=0;
  f.config.confirm=()=>{confirms++;return true;};
  f.config.file.text=async()=>{
    f.data.set(SAVE_KEY,newer);
    const old=readStorySave(f.storage);
    const next=completeStoryEntry(old.progress,CORE_STORY_PACK,'arrival','help');
    assert.equal(writeStorySave(f.storage,next,{expectedRaw:old.raw}),true);
    return f.candidate;
  };
  assert.equal((await performNormalSaveImport(f.config)).reason,'SAVE_CHANGED');
  assert.equal(confirms,0);
  assert.equal(f.storage.getItem(SAVE_KEY),newer);
  assert.equal(f.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(readStorySave(f.storage).progress.packs.core.choices.arrival,'help');
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.deepEqual(f.writes,[STORY_SAVE_KEY]);
});
