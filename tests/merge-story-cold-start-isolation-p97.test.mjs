import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';
import {attachNormalPageLifecycle} from '../merge/normal-page-lifecycle.mjs';

const NOW=1_000_000;
function events(){
  const target=()=>{const handlers=new Map();return {
    addEventListener:(name,fn)=>handlers.set(name,fn),
    removeEventListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name);},
    emit:(name,event={})=>handlers.get(name)?.(event)
  };};
  return {win:target(),doc:Object.assign(target(),{hidden:false})};
}
function fixture(){
  const values=new Map(),writes=[];
  const storage={
    getItem:key=>values.has(key)?values.get(key):null,
    setItem(key,value){writes.push(key);values.set(key,value);}
  };
  const initial=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  assert.equal(writeStorySave(storage,initial,{expectedRaw:null}),true);
  const workshop=createInitialState(NOW);
  assert.equal(writeStoryWorkshop(storage,workshop,{expectedRaw:null}),true);
  const locks={request(name,options,callback){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}));
  }};
  const runtime=createNormalPageRuntime({locks,storage}),ui=events(),attempts=[];
  let bridge;
  const start=()=>attempts.push(runtime.start({now:NOW,canStart:()=>!bridge.suspended}));
  bridge=attachNormalPageLifecycle({runtime,win:ui.win,doc:ui.doc,storage,
    onReadyForStartup:start});
  return {storage,values,writes,runtime,ui,bridge,attempts,start};
}
function assertNarrativeBytes(h,storyRaw,workshopRaw){
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),storyRaw);
  assert.equal(h.storage.getItem(STORY_WORKSHOP_KEY),workshopRaw);
  assert.equal(h.writes.filter(key=>key===STORY_SAVE_KEY).length,
    h.storyWrites??1);
  assert.equal(h.writes.filter(key=>key===STORY_WORKSHOP_KEY).length,1);
}

test('P97 hidden cold normal page waits while a peer advances story; visible startup preserves both modes',async()=>{
  const h=fixture();
  h.ui.doc.hidden=true;h.ui.doc.emit('visibilitychange');
  assert.equal(h.bridge.suspended,true);
  assert.equal(h.runtime.phase,'cold');
  assert.equal(h.storage.getItem(SAVE_KEY),null);
  const old=readStorySave(h.storage);
  const first=CORE_STORY_PACK.entries.find(entry=>entry.kind==='main');
  const updated=completeStoryEntry(old.progress,CORE_STORY_PACK,first.id,
    first.choices[0]?.id??null);
  assert.equal(writeStorySave(h.storage,updated,{expectedRaw:old.raw}),true);
  h.storyWrites=2;
  const storyRaw=h.storage.getItem(STORY_SAVE_KEY);
  const workshopRaw=h.storage.getItem(STORY_WORKSHOP_KEY);
  assert.equal(h.attempts.length,0);
  h.ui.doc.hidden=false;h.ui.doc.emit('visibilitychange');
  assert.equal(h.attempts.length,1);
  assert.equal((await h.attempts[0]).ok,true);
  assert.equal(h.runtime.phase,'ready');
  assert.equal(validateSave(JSON.parse(h.storage.getItem(SAVE_KEY))),true);
  assertNarrativeBytes(h,storyRaw,workshopRaw);
  assert.deepEqual(h.writes.filter(key=>key===SAVE_KEY),[SAVE_KEY]);
  h.bridge.detach();
});

test('P97 cold pagehide requires actual hidden pageshow then visible before first normal write',async()=>{
  const h=fixture(),storyRaw=h.storage.getItem(STORY_SAVE_KEY);
  const workshopRaw=h.storage.getItem(STORY_WORKSHOP_KEY);
  h.ui.win.emit('pagehide');
  h.ui.doc.hidden=true;h.ui.doc.emit('visibilitychange');
  h.ui.doc.hidden=false;h.ui.doc.emit('visibilitychange');
  assert.equal(h.bridge.suspended,true);
  assert.equal(h.attempts.length,0);
  assert.equal(h.storage.getItem(SAVE_KEY),null);
  h.ui.doc.hidden=true;
  h.ui.win.emit('pageshow',{persisted:true});
  assert.equal(h.attempts.length,0,'hidden BFCache return cannot start');
  h.ui.doc.hidden=false;h.ui.doc.emit('visibilitychange');
  assert.equal(h.attempts.length,1);
  assert.equal((await h.attempts[0]).ok,true);
  assert.equal(h.bridge.suspended,false);
  assertNarrativeBytes(h,storyRaw,workshopRaw);
  assert.equal(h.writes.filter(key=>key===SAVE_KEY).length,1);
  h.bridge.detach();
});

test('P97 cold normal startup never repairs malformed UTF-16 story or workshop evidence',async()=>{
  const h=fixture(),brokenStory='{"story":'+String.fromCharCode(0xd800);
  const brokenWorkshop='{"workshop":'+String.fromCharCode(0xdc00);
  h.values.set(STORY_SAVE_KEY,brokenStory);
  h.values.set(STORY_WORKSHOP_KEY,brokenWorkshop);
  assert.equal(readStorySave(h.storage).blocked,true);
  assert.equal(readStoryWorkshop(h.storage,NOW).blocked,true);
  h.start();
  assert.equal((await h.attempts[0]).ok,true);
  assert.equal(h.runtime.phase,'ready');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),brokenStory);
  assert.equal(h.storage.getItem(STORY_WORKSHOP_KEY),brokenWorkshop);
  assert.deepEqual(h.writes.filter(key=>key===SAVE_KEY),[SAVE_KEY]);
  assert.equal(h.writes.filter(key=>key===STORY_SAVE_KEY).length,1);
  assert.equal(h.writes.filter(key=>key===STORY_WORKSHOP_KEY).length,1);
  h.bridge.detach();
});
