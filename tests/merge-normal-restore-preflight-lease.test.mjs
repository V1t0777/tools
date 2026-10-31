import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';

const now=1000;
const initial=()=>JSON.stringify(createInitialState(now));
const incoming=()=>JSON.stringify({...createInitialState(now),revision:2,coins:75});
const lock={request(name,options,callback){
  assert.equal(name,NORMAL_SAVE_LOCK_NAME);
  assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
  return Promise.resolve(callback({name,mode:'exclusive'}));
}};
function memory(raw){
  const map=new Map([[SAVE_KEY,raw],[STORY_SAVE_KEY,'story-untouched']]);
  const writes=[];
  let readCount=0,triggerAt=Infinity,trigger=()=>{};
  return {map,writes,
    arm(n,callback){readCount=0;triggerAt=n;trigger=callback;},
    getItem(key){
      const value=map.has(key)?map.get(key):null;
      if(key===SAVE_KEY&&++readCount===triggerAt)trigger();
      return value;
    },
    setItem(key,value){writes.push(key);map.set(key,value);},
    read(key){return map.get(key)??null;}
  };
}
async function started(db){
  const runtime=createNormalPageRuntime({storage:db,locks:lock});
  assert.equal((await runtime.start({now})).ok,true);
  return runtime;
}

test('P2.65ai pagehide during runtime restore preflight revokes the original confirmation',async()=>{
  const old=initial(),db=memory(old),runtime=await started(db);
  const writes=db.writes.length;
  db.arm(1,()=>runtime.invalidate());
  assert.deepEqual(await runtime.restore(incoming(),
    {expectedRaw:old,confirmed:true}),{
      ok:false,reason:'RESTORE_CANCELLED_BEFORE_WRITE'});
  assert.equal(db.writes.length,writes);
  assert.equal(db.read(SAVE_KEY),old);
  assert.equal(db.read(RESTORE_BACKUP_KEY),null);
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
});

test('P2.65ai pagehide during post-preview baseline recheck cannot reserve backup',async()=>{
  const old=initial(),db=memory(old),runtime=await started(db);
  const writes=db.writes.length;
  db.arm(2,()=>runtime.invalidate());
  assert.deepEqual(await runtime.restore(incoming(),
    {expectedRaw:old,confirmed:true}),{
      ok:false,reason:'RESTORE_CANCELLED_BEFORE_WRITE'});
  assert.equal(db.writes.length,writes);
  assert.equal(db.read(RESTORE_BACKUP_KEY),null);
  assert.equal(db.read(SAVE_KEY),old);
});

test('P2.65ai replacement after preflight read is rejected before Web Lock or backup',async()=>{
  const old=initial(),next=incoming(),db=memory(old),runtime=await started(db);
  const external=JSON.stringify({...createInitialState(now),revision:3,coins:99});
  const writes=db.writes.length;
  db.arm(1,()=>db.map.set(SAVE_KEY,external));
  assert.deepEqual(await runtime.restore(next,
    {expectedRaw:old,confirmed:true}),{
      ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(runtime.blocked,true);
  assert.equal(db.writes.length,writes);
  assert.equal(db.read(SAVE_KEY),external);
  assert.equal(db.read(RESTORE_BACKUP_KEY),null);
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
});

test('P2.65ai unchanged authorized restore still preserves original backup',async()=>{
  const old=initial(),next=incoming(),db=memory(old),runtime=await started(db);
  assert.deepEqual(await runtime.restore(next,
    {expectedRaw:old,confirmed:true}),{ok:true,status:'UI_PUBLISHED'});
  assert.equal(db.read(SAVE_KEY),next);
  assert.equal(db.read(RESTORE_BACKUP_KEY),old);
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
});
