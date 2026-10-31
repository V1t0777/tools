import test from 'node:test';
import assert from 'node:assert/strict';
import {NORMAL_SAVE_LOCK_NAME,withNormalSaveLock} from '../merge/normal-save-lock.mjs';

function lockManager() {
  let held = false;
  const calls = [];
  return {calls,request(name,options,callback) {
    calls.push({name,options});
    if (held) return Promise.resolve(callback(null));
    held = true;
    return Promise.resolve().then(() => callback({name,mode:'exclusive'}))
      .finally(() => {held = false;});
  }};
}

test('normal write uses a stable exclusive non-waiting Web Lock',async()=>{
  const locks=lockManager();
  const receipt=Object.freeze({ok:true,raw:'verified'});
  assert.equal(await withNormalSaveLock(locks,()=>receipt),receipt);
  assert.deepEqual(locks.calls,[{name:NORMAL_SAVE_LOCK_NAME,
    options:{mode:'exclusive',ifAvailable:true}}]);
});

test('simultaneous tabs cannot run the second write while the first holds the lock',async()=>{
  const locks=lockManager();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let firstStarted;
  const started=new Promise(resolve=>{firstStarted=resolve;});
  const writes=[];
  const first=withNormalSaveLock(locks,async()=>{
    firstStarted();
    await gate;
    writes.push('first');
    return {ok:true};
  });
  await started;
  const second=await withNormalSaveLock(locks,()=>{
    writes.push('second');
    return {ok:true};
  });
  assert.deepEqual(second,{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.deepEqual(writes,[]);
  release();
  assert.equal((await first).ok,true);
  assert.deepEqual(writes,['first']);
  assert.equal((await withNormalSaveLock(locks,()=>{
    writes.push('third');return {ok:true};
  })).ok,true);
  assert.deepEqual(writes,['first','third']);
});

test('missing Web Locks and invalid callback never write',async()=>{
  let writes=0;
  assert.deepEqual(await withNormalSaveLock(null,()=>{writes++;return {ok:true};}),
    {ok:false,reason:'WEB_LOCKS_UNAVAILABLE'});
  assert.deepEqual(await withNormalSaveLock({},()=>{writes++;return {ok:true};}),
    {ok:false,reason:'WEB_LOCKS_UNAVAILABLE'});
  assert.deepEqual(await withNormalSaveLock(lockManager(),null),
    {ok:false,reason:'INVALID_TRANSACTION'});
  assert.equal(writes,0);
});

test('wrong lock name or shared mode cannot authorize a write',async()=>{
  for(const bad of [{name:'wrong',mode:'exclusive'},
    {name:NORMAL_SAVE_LOCK_NAME,mode:'shared'}]) {
    let writes=0;
    const locks={request:(_name,_options,callback)=>callback(bad)};
    assert.deepEqual(await withNormalSaveLock(locks,()=>{
      writes++;return {ok:true};
    }),{ok:false,reason:'INVALID_SAVE_LOCK'});
    assert.equal(writes,0);
  }
});

test('lock request errors, fake completion, and invalid receipts fail closed',async()=>{
  const broken={request(){throw Error('denied');}};
  assert.deepEqual(await withNormalSaveLock(broken,()=>({ok:true})),
    {ok:false,reason:'SAVE_LOCK_REQUEST_FAILED'});
  assert.deepEqual(await withNormalSaveLock({request:()=>({ok:true})},()=>({ok:true})),
    {ok:false,reason:'SAVE_LOCK_OUTCOME_UNCERTAIN'});
  assert.deepEqual(await withNormalSaveLock(lockManager(),()=>undefined),
    {ok:false,reason:'INVALID_TRANSACTION_RECEIPT'});
  assert.deepEqual(await withNormalSaveLock(lockManager(),()=>{throw Error('fail');}),
    {ok:false,reason:'SAVE_TRANSACTION_FAILED'});
});

test('transaction rejection releases lock for a subsequent safe attempt',async()=>{
  const locks=lockManager();
  assert.deepEqual(await withNormalSaveLock(locks,async()=>{throw Error('quota');}),
    {ok:false,reason:'SAVE_TRANSACTION_FAILED'});
  assert.deepEqual(await withNormalSaveLock(locks,()=>({ok:false,reason:'STALE_BASELINE'})),
    {ok:false,reason:'STALE_BASELINE'});
  assert.equal((await withNormalSaveLock(locks,()=>({ok:true}))).ok,true);
});

test('repeated callback cannot execute a second save, even when provider returns first receipt',async()=>{
  let writes=0;
  const fake={async request(name,_options,callback){
    const lock={name,mode:'exclusive'};
    const first=await callback(lock);
    const repeated=await callback(lock);
    assert.deepEqual(repeated,{ok:false,reason:'SAVE_LOCK_CALLBACK_REPEATED'});
    return first;
  }};
  assert.deepEqual(await withNormalSaveLock(fake,()=>{
    writes++;return {ok:true};
  }),{ok:false,reason:'SAVE_LOCK_OUTCOME_UNCERTAIN'});
  assert.equal(writes,1);
});

test('concurrent duplicate callback cannot run transaction while first is pending',async()=>{
  let writes=0,release;
  const pending=new Promise(resolve=>{release=resolve;});
  const fake={async request(name,_options,callback){
    const lock={name,mode:'exclusive'};
    const first=callback(lock);
    const second=callback(lock);
    assert.deepEqual(await second,{ok:false,reason:'SAVE_LOCK_CALLBACK_REPEATED'});
    release();
    return first;
  }};
  assert.deepEqual(await withNormalSaveLock(fake,async()=>{
    writes++;await pending;return {ok:true};
  }),{ok:false,reason:'SAVE_LOCK_OUTCOME_UNCERTAIN'});
  assert.equal(writes,1);
});

test('callback delivered after resolved or rejected request cannot write',async()=>{
  for(const rejected of [false,true]){
    let late,writes=0;
    const fake={request(_name,_options,callback){
      late=callback;
      if(rejected)throw Error('provider failed');
      return Promise.resolve({ok:true});
    }};
    assert.deepEqual(await withNormalSaveLock(fake,()=>{
      writes++;return {ok:true};
    }),{ok:false,reason:rejected?'SAVE_LOCK_REQUEST_FAILED':'SAVE_LOCK_OUTCOME_UNCERTAIN'});
    assert.deepEqual(await late({name:NORMAL_SAVE_LOCK_NAME,mode:'exclusive'}),
      {ok:false,reason:'SAVE_LOCK_CALLBACK_REPEATED'});
    assert.equal(writes,0);
  }
});
