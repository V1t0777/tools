import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {withNormalSaveLock} from '../merge/normal-save-lock.mjs';
import {commitNormalActionWithLock} from '../merge/normal-action-transaction.mjs';

function memory(raw) {
  let current=raw, writes=0;
  return {getItem(key){return key===SAVE_KEY?current:null;},
    setItem(key,value){if(key!==SAVE_KEY)throw Error('unexpected key');current=value;writes++;},
    get writes(){return writes;},get raw(){return current;}};
}
function locks() {
  let held=false;
  return {request(name,options,callback){
    assert.equal(options.mode,'exclusive');
    assert.equal(options.ifAvailable,true);
    if(held)return Promise.resolve(callback(null));
    held=true;
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}))
      .finally(()=>{held=false;});
  }};
}
const initial=()=>createInitialState(1000);

test('locked gameplay action re-reads, commits and verifies before publishing state',async()=>{
  const state=initial(),raw=JSON.stringify(state),store=memory(raw);
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:current=>moveOrMerge(current,0,2)});
  assert.equal(result.ok,true);
  assert.equal(result.verifiedReadback,true);
  assert.equal(result.state.board[0],null);
  assert.equal(result.state.board[2]?.kind,'material');
  assert.equal(result.state.revision,state.revision+1);
  assert.equal(store.raw,JSON.stringify(result.state));
  assert.equal(store.writes,1);
  assert.equal(state.board[0]?.kind,'material');
});

test('stale raw baseline blocks action evaluation and every write',async()=>{
  const state=initial(),store=memory(JSON.stringify(state));
  let invoked=0;
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:JSON.stringify({...state,revision:state.revision+1}),
    action:current=>{invoked++;return moveOrMerge(current,0,2);}});
  assert.deepEqual(result,{ok:false,reason:'STALE_BASELINE'});
  assert.equal(invoked,0);
  assert.equal(store.writes,0);
});

test('unavailable or busy Web Locks never execute a gameplay action',async()=>{
  const raw=JSON.stringify(initial()),store=memory(raw);
  let invoked=0;
  const args={expectedRaw:raw,action:current=>{
    invoked++;return moveOrMerge(current,0,2);}};
  assert.deepEqual(await commitNormalActionWithLock(null,store,args),
    {ok:false,reason:'WEB_LOCKS_UNAVAILABLE'});
  assert.deepEqual(await commitNormalActionWithLock({
    request:(_name,_opts,callback)=>callback(null)},store,args),
    {ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.equal(invoked,0);
  assert.equal(store.writes,0);
});

test('an active lock blocks a second real action until release',async()=>{
  const lock=locks(),raw=JSON.stringify(initial()),store=memory(raw);
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  const first=withNormalSaveLock(lock,async()=>{started();await gate;return {ok:true};});
  await entered;
  let invoked=0;
  const second=await commitNormalActionWithLock(lock,store,{expectedRaw:raw,
    action:current=>{invoked++;return moveOrMerge(current,0,2);}});
  assert.deepEqual(second,{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.equal(invoked,0);
  assert.equal(store.writes,0);
  release();
  assert.equal((await first).ok,true);
  assert.equal((await commitNormalActionWithLock(lock,store,{
    expectedRaw:raw,action:current=>moveOrMerge(current,0,2)})).ok,true);
});

test('invalid baseline, invalid action, rejected action and async action do not write',async()=>{
  const raw=JSON.stringify(initial()),store=memory(raw),lock=locks();
  assert.deepEqual(await commitNormalActionWithLock(lock,store,{
    expectedRaw:null,action:()=>({ok:true})}),{ok:false,reason:'NO_TRUSTED_BASELINE'});
  assert.deepEqual(await commitNormalActionWithLock(lock,store,{
    expectedRaw:raw,action:null}),{ok:false,reason:'INVALID_ACTION'});
  assert.deepEqual(await commitNormalActionWithLock(lock,store,{
    expectedRaw:raw,action:()=>({ok:false})}),{ok:false,reason:'ACTION_REJECTED'});
  assert.deepEqual(await commitNormalActionWithLock(lock,store,{
    expectedRaw:raw,action:()=>Promise.resolve({ok:true})}),
    {ok:false,reason:'ASYNC_ACTION_NOT_ALLOWED'});
  assert.equal(store.writes,0);
});

test('a missing or corrupt snapshot never gets replaced by a gameplay action',async()=>{
  const raw=JSON.stringify(initial()),lock=locks();
  for(const bad of [null,'{bad']) {
    const store=memory(bad);
    let invoked=0;
    const result=await commitNormalActionWithLock(lock,store,{
      expectedRaw:raw,action:current=>{invoked++;return moveOrMerge(current,0,2);}});
    assert.equal(result.ok,false);
    assert.equal(invoked,0);
    assert.equal(store.writes,0);
  }
});

test('intervening uncoordinated write is rejected by existing CAS guard',async()=>{
  const raw=JSON.stringify(initial());
  let reads=0,writes=0;
  const store={getItem(key){
    assert.equal(key,SAVE_KEY);
    reads++;
    return reads===1?raw:JSON.stringify({...initial(),revision:1});
  },setItem(){writes++;}};
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:current=>moveOrMerge(current,0,2)});
  assert.deepEqual(result,{ok:false,reason:'SAVE_REJECTED_OR_UNCERTAIN'});
  assert.equal(writes,0);
});

test('failed exact readback never publishes the new state as verified',async()=>{
  const raw=JSON.stringify(initial());
  let saved=null;
  const store={getItem(key){assert.equal(key,SAVE_KEY);return saved===null?raw:'tampered';},
    setItem(key,value){assert.equal(key,SAVE_KEY);saved=value;}};
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:current=>moveOrMerge(current,0,2)});
  assert.deepEqual(result,{ok:false,reason:'SAVE_VERIFY_FAILED'});
  assert.ok(saved);
  assert.equal('state' in result,false);
});

test('P2.61h rejects a same-revision economy mutation without touching storage',async()=>{
  const state=initial(),raw=JSON.stringify(state),store=memory(raw);
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:current=>({ok:true,state:{...current,coins:current.coins+999}})
  });
  assert.deepEqual(result,{ok:false,reason:'ACTION_REVISION_INVALID'});
  assert.equal(store.raw,raw);
  assert.equal(store.writes,0);
  assert.equal('state' in result,false);
});

test('P2.61h rejects skipped revisions before saving',async()=>{
  const state=initial(),raw=JSON.stringify(state),store=memory(raw);
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:current=>({ok:true,state:{...current,revision:current.revision+2}})
  });
  assert.deepEqual(result,{ok:false,reason:'ACTION_REVISION_INVALID'});
  assert.equal(store.writes,0);
  assert.equal(store.raw,raw);
});

test('P2.61h rejects an in-place success result even with an incremented revision',async()=>{
  const state=initial(),raw=JSON.stringify(state),store=memory(raw);
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:current=>{
      current.revision++;
      return {ok:true,state:current};
    }
  });
  assert.deepEqual(result,{ok:false,reason:'ACTION_REVISION_INVALID'});
  assert.equal(store.raw,raw);
  assert.equal(store.writes,0);
});

test('P2.61i rejects a nested baseline mutation even with a distinct returned state',async()=>{
  const state=initial(),raw=JSON.stringify(state),store=memory(raw);
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:current=>{
      current.board[0]=null;
      return {ok:true,state:{...current,revision:current.revision+1}};
    }
  });
  assert.deepEqual(result,{ok:false,reason:'ACTION_MUTATED_BASELINE'});
  assert.equal(store.raw,raw);
  assert.equal(store.writes,0);
  assert.equal('state' in result,false);
});

test('P2.61i a rejected action may not silently mutate its input economy',async()=>{
  const state=initial(),raw=JSON.stringify(state),store=memory(raw);
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:current=>{
      current.coins+=10;
      return {ok:false,message:'not allowed'};
    }
  });
  assert.deepEqual(result,{ok:false,reason:'ACTION_MUTATED_BASELINE'});
  assert.equal(store.raw,raw);
  assert.equal(store.writes,0);
});

test('P2.61j rejected async action is observed without writing or publishing',async()=>{
  const raw=JSON.stringify(initial()),store=memory(raw);
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:()=>Promise.reject(new Error('async engine failure'))});
  assert.deepEqual(result,{ok:false,reason:'ASYNC_ACTION_NOT_ALLOWED'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.raw,raw);
  assert.equal(store.writes,0);
  assert.equal('state' in result,false);
});

test('P2.61j delayed async rejection stays rejected without unhandled failure',async()=>{
  const raw=JSON.stringify(initial()),store=memory(raw);
  let rejectLater;
  const pending=new Promise((_resolve,reject)=>{rejectLater=reject;});
  const result=await commitNormalActionWithLock(locks(),store,{
    expectedRaw:raw,action:()=>pending});
  assert.deepEqual(result,{ok:false,reason:'ASYNC_ACTION_NOT_ALLOWED'});
  rejectLater(new Error('late async engine failure'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.raw,raw);
  assert.equal(store.writes,0);
});
