import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';

const now=1000;
const original=()=>JSON.stringify(createInitialState(now));
const changed=()=>JSON.stringify({...createInitialState(now),revision:2,coins:77});
const fail=reason=>({ok:false,reason});
const locks={request(name,options,callback){
  assert.equal(name,NORMAL_SAVE_LOCK_NAME);
  assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
  return Promise.resolve(callback({name,mode:'exclusive'}));
}};
function memory(raw){
  const map=new Map([[SAVE_KEY,raw],[STORY_SAVE_KEY,'story-untouched']]);
  const writes=[];
  let count=0,armed=null;
  return {
    map,writes,
    arm(n,callback){count=0;armed={n,callback};},
    getItem(key){
      const value=map.has(key)?map.get(key):null;
      if(key===SAVE_KEY&&armed&&++count===armed.n){
        const callback=armed.callback;armed=null;callback();
      }
      return value;
    },
    setItem(key,value){writes.push(key);map.set(key,value);},
    read(key){return map.has(key)?map.get(key):null;}
  };
}
async function started(db,events=[]){
  const runtime=createNormalPageRuntime({storage:db,locks,
    onVerified:(_state,_raw,kind)=>events.push(kind)});
  assert.equal((await runtime.start({now})).ok,true);
  return runtime;
}

test('P2.65aj unchanged first read cannot authorize pagehide-invalidated old button',async()=>{
  const old=original(),db=memory(old),events=[];
  const runtime=await started(db,events);
  const before=db.writes.length;
  db.arm(1,()=>runtime.invalidate());
  assert.deepEqual(runtime.reconcile(),fail('RECONCILE_INVALIDATED'));
  assert.equal(runtime.blocked,true);
  assert.equal(runtime.snapshot().revision,0);
  assert.equal(db.writes.length,before);
  assert.deepEqual(await runtime.action(s=>moveOrMerge(s,0,2)),fail('UI_SAVE_BLOCKED'));
  assert.deepEqual(events,['startup']);
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
});

test('P2.65aj changed first read cannot adopt a snapshot after pagehide',async()=>{
  const db=memory(original()),events=[];
  const runtime=await started(db,events);
  db.map.set(SAVE_KEY,changed());
  const before=db.writes.length;
  db.arm(1,()=>runtime.invalidate());
  assert.deepEqual(runtime.reconcile(),fail('RECONCILE_INVALIDATED'));
  assert.equal(runtime.blocked,true);
  assert.equal(runtime.snapshot().coins,createInitialState(now).coins);
  assert.deepEqual(events,['startup']);
  assert.equal(db.writes.length,before);
});

test('P2.65aj unchanged read with intervening cross-tab replacement fails closed',async()=>{
  const old=original(),next=changed(),db=memory(old),events=[];
  const runtime=await started(db,events);
  const before=db.writes.length;
  db.arm(1,()=>db.map.set(SAVE_KEY,next));
  assert.deepEqual(runtime.reconcile(),fail('CURRENT_SAVE_CHANGED'));
  assert.equal(runtime.blocked,true);
  assert.equal(runtime.raw,old);
  assert.equal(db.read(SAVE_KEY),next);
  assert.equal(db.writes.length,before);
  assert.deepEqual(events,['startup']);
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
});

test('P2.65aj second read lifecycle invalidation cannot return unchanged success',async()=>{
  const old=original(),db=memory(old);
  const runtime=await started(db);
  const before=db.writes.length;
  db.arm(2,()=>runtime.invalidate());
  assert.deepEqual(runtime.reconcile(),fail('RECONCILE_INVALIDATED'));
  assert.equal(runtime.blocked,true);
  assert.equal(db.read(SAVE_KEY),old);
  assert.equal(db.writes.length,before);
});
