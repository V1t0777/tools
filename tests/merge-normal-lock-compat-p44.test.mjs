import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {NORMAL_SAVE_LOCK_NAME,withNormalSaveLock,commitNormalSnapshotLocked} from '../merge/normal-save-lock.mjs';

function exclusiveLocks(){
  let held=false;
  const queue=[];
  function pump(){
    if(held||!queue.length)return;
    const task=queue.shift();
    held=true;
    Promise.resolve().then(()=>task.callback({name:NORMAL_SAVE_LOCK_NAME,mode:'exclusive'}))
      .then(task.resolve,task.reject).finally(()=>{held=false;pump();});
  }
  return {request(name,options,callback){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.equal(options.mode,'exclusive');
    if(options.ifAvailable&&held)return Promise.resolve(callback(null));
    return new Promise((resolve,reject)=>{
      queue.push({callback,resolve,reject});
      pump();
    });
  }};
}
const state=revision=>({...createInitialState(1_000_000),revision});

test('P44 upstream P2.60a and legacy P2.57 writers share one exclusive lock',async()=>{
  const old=JSON.stringify(state(1)),writes=[];
  let current=old;
  const storage={getItem:key=>key===SAVE_KEY?current:null,
    setItem:(key,value)=>{assert.equal(key,SAVE_KEY);writes.push(value);current=value;}};
  const locks=exclusiveLocks();
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  const waiting=new Promise(resolve=>{release=resolve;});
  const holder=withNormalSaveLock(locks,async()=>{
    entered();
    await waiting;
    storage.setItem(SAVE_KEY,JSON.stringify(state(2)));
    return {ok:true};
  });
  await started;
  const queued=commitNormalSnapshotLocked(storage,state(3),{expectedRaw:old,locks});
  const busy=await withNormalSaveLock(locks,()=>({ok:true}));
  assert.deepEqual(busy,{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.equal(current,old);
  release();
  assert.equal((await holder).ok,true);
  assert.deepEqual(await queued,{ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(current,JSON.stringify(state(2)));
  assert.equal(writes.length,1,'queued snapshot cannot overwrite older baseline');
});

test('P44 legacy lock refuses a missing grant and malformed callback receipts',async()=>{
  const denied={request:(_name,_options,callback)=>callback(null)};
  assert.deepEqual(await withNormalSaveLock(denied,()=>({ok:true})),
    {ok:false,reason:'SAVE_LOCK_BUSY'});
  const missing={request:()=>Promise.resolve({ok:true})};
  assert.deepEqual(await withNormalSaveLock(missing,()=>({ok:true})),
    {ok:false,reason:'SAVE_LOCK_OUTCOME_UNCERTAIN'});
});
