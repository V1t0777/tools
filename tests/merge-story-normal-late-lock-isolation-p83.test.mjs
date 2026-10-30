import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {commitNormalActionWithLock} from '../merge/normal-action-transaction.mjs';
import {commitNormalResetWithLock} from '../merge/normal-reset-transaction.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {readStorySave} from '../merge/story/local-storage.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';

function fixture(){
  const normal=JSON.stringify(createInitialState(1000));
  const story=JSON.stringify(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK));
  const workshop=JSON.stringify(createInitialState(1000));
  const values=new Map([[SAVE_KEY,normal],[STORY_SAVE_KEY,story],[STORY_WORKSHOP_KEY,workshop]]);
  const writes=[];
  const storage={
    getItem:key=>values.has(key)?values.get(key):null,
    setItem(key,value){writes.push(key);values.set(key,value);}
  };
  return {normal,story,workshop,values,writes,storage};
}

function deferredNormalLock(){
  let releaseNormal;
  const locks={request(name,options,callback){
    if(name===NORMAL_SAVE_LOCK_NAME){
      assert.equal(options.mode,'exclusive');
      assert.equal(options.ifAvailable,true);
      return new Promise(resolve=>{
        releaseNormal=async()=>resolve(await callback({name,mode:'exclusive'}));
      });
    }
    // The story writer uses a separate lock name and must remain usable
    // while the ordinary page has a pending lock callback.
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}));
  }};
  return {locks,async release(){
    assert.equal(typeof releaseNormal,'function');
    await releaseNormal();
  }};
}

test('P83 pending ordinary action cancelled on pagehide cannot write or block story dialogue',async()=>{
  const f=fixture(),gate=deferredNormalLock();
  let active=true,actionCalls=0;
  const pending=commitNormalActionWithLock(gate.locks,f.storage,{
    expectedRaw:f.normal,canCommit:()=>active,
    action(){actionCalls++;throw new Error('must not evaluate stale action');}
  });
  const before=readStorySave(f.storage).progress;
  const next=completeStoryEntry(before,CORE_STORY_PACK,'arrival','help');
  const storyResult=await saveStoryDialogueWithLock(gate.locks,f.storage,next,{expectedRaw:f.story});
  assert.deepEqual(storyResult,{ok:true,mode:'web-lock',value:true});
  assert.equal(readStorySave(f.storage).progress.packs.core.choices.arrival,'help');
  active=false; // Simulates a pagehide invalidating the ordinary UI epoch.
  await gate.release();
  assert.deepEqual(await pending,{ok:false,reason:'ACTION_CANCELLED_BEFORE_WRITE'});
  assert.equal(actionCalls,0);
  assert.equal(f.values.get(SAVE_KEY),f.normal);
  assert.equal(f.values.get(STORY_WORKSHOP_KEY),f.workshop);
  assert.deepEqual(f.writes,[STORY_SAVE_KEY]);
});

test('P83 pending ordinary reset cancelled on pagehide cannot reserve backup or touch story saves',async()=>{
  const f=fixture(),gate=deferredNormalLock();
  let active=true;
  const pending=commitNormalResetWithLock(gate.locks,f.storage,{
    expectedRaw:f.normal,confirmedReset:true,requireOriginalBackup:true,
    now:2000,canCommit:()=>active
  });
  active=false;
  await gate.release();
  assert.deepEqual(await pending,{ok:false,reason:'RESET_CANCELLED_BEFORE_WRITE'});
  assert.equal(f.values.get(SAVE_KEY),f.normal);
  assert.equal(f.values.get(ABNORMAL_RESET_BACKUP_KEY),undefined);
  assert.equal(f.values.get(STORY_SAVE_KEY),f.story);
  assert.equal(f.values.get(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(readStorySave(f.storage).blocked,false);
  assert.equal(readStoryWorkshop(f.storage,1000).blocked,false);
  assert.deepEqual(f.writes,[]);
});
