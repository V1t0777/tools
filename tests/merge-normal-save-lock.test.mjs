import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {NORMAL_SAVE_LOCK_NAME,commitNormalSnapshotLocked} from '../merge/normal-save-lock.mjs';

const state=revision=>({...createInitialState(1_000_000),revision});
const raw=revision=>JSON.stringify(state(revision));
function storage(initial=null,story='story-bytes') {
  const data=new Map([[STORY_SAVE_KEY,story]]);
  if(initial!==null)data.set(SAVE_KEY,initial);
  const writes=[];
  return {data,writes,getItem:key=>data.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);data.set(key,value);}};
}
function serialLocks() {
  let tail=Promise.resolve();
  const calls=[];
  return {calls,request(name,options,callback) {
    calls.push({name,mode:options.mode});
    const pending=tail.then(()=>callback({name,mode:options.mode}));
    tail=pending.then(()=>{},()=>{});
    return pending;
  }};
}

test('P2.60a lock serializes two stale tabs: exactly one save succeeds',async()=>{
  const previous=raw(1),db=storage(previous),locks=serialLocks();
  const [first,second]=await Promise.all([
    commitNormalSnapshotLocked(db,state(2),{expectedRaw:previous,locks}),
    commitNormalSnapshotLocked(db,state(3),{expectedRaw:previous,locks})
  ]);
  assert.equal(first.ok,true);
  assert.equal(first.verifiedReadback,true);
  assert.deepEqual(second,{ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(db.getItem(SAVE_KEY),raw(2));
  assert.deepEqual(db.writes.map(([key])=>key),[SAVE_KEY]);
  assert.deepEqual(locks.calls,[
    {name:NORMAL_SAVE_LOCK_NAME,mode:'exclusive'},
    {name:NORMAL_SAVE_LOCK_NAME,mode:'exclusive'}]);
  assert.equal(db.getItem(STORY_SAVE_KEY),'story-bytes');
});

test('P2.60a no Web Locks support refuses writes, no fake storage lock',async()=>{
  const db=storage(raw(1));
  const result=await commitNormalSnapshotLocked(db,state(2),{
    expectedRaw:raw(1),locks:null});
  assert.deepEqual(result,{ok:false,reason:'MULTITAB_LOCK_UNAVAILABLE'});
  assert.equal(db.getItem(SAVE_KEY),raw(1));
  assert.deepEqual(db.writes,[]);
});

test('P2.60a missing baseline refuses before requesting a lock',async()=>{
  const db=storage(raw(1)),locks=serialLocks();
  assert.deepEqual(await commitNormalSnapshotLocked(db,state(2),{locks}),
    {ok:false,reason:'NO_TRUSTED_BASELINE'});
  assert.deepEqual(locks.calls,[]);
  assert.deepEqual(db.writes,[]);
});

test('P2.60a denied or malformed grant never writes',async()=>{
  for(const grant of [null,{name:NORMAL_SAVE_LOCK_NAME,mode:'shared'},
    {name:'wrong',mode:'exclusive'}]) {
    const db=storage(raw(1));
    const locks={request:(_name,_options,callback)=>callback(grant)};
    assert.deepEqual(await commitNormalSnapshotLocked(db,state(2),{
      expectedRaw:raw(1),locks}),{ok:false,reason:'LOCK_NOT_GRANTED'});
    assert.deepEqual(db.writes,[]);
  }
});

test('P2.60a lock rejection and absent callback receipt fail closed',async()=>{
  for(const request of [()=>{throw Error('denied');},
    ()=>Promise.reject(Error('denied')),()=>undefined]) {
    const db=storage(raw(1));
    assert.deepEqual(await commitNormalSnapshotLocked(db,state(2),{
      expectedRaw:raw(1),locks:{request}}),
    {ok:false,reason:'LOCK_REQUEST_FAILED'});
    assert.deepEqual(db.writes,[]);
  }
});

test('P2.60a storage read failure under lock preserves raw data',async()=>{
  const db=storage(raw(1)),locks=serialLocks();
  const broken={getItem(){throw Error('blocked');},setItem:db.setItem};
  assert.deepEqual(await commitNormalSnapshotLocked(broken,state(2),{
    expectedRaw:raw(1),locks}),{ok:false,reason:'STORAGE_UNAVAILABLE'});
  assert.deepEqual(db.writes,[]);
});

test('P2.60a confirmed reset still requires exact locked baseline',async()=>{
  const db=storage(raw(8)),locks=serialLocks();
  assert.deepEqual(await commitNormalSnapshotLocked(db,state(0),{
    expectedRaw:raw(7),confirmedReset:true,locks}),
  {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(db.getItem(SAVE_KEY),raw(8));
  const accepted=await commitNormalSnapshotLocked(db,state(0),{
    expectedRaw:raw(8),confirmedReset:true,locks});
  assert.equal(accepted.ok,true);
  assert.equal(db.getItem(SAVE_KEY),raw(0));
  assert.equal(db.getItem(STORY_SAVE_KEY),'story-bytes');
});

test('P2.60a locked initialization from absent key verifies exact bytes',async()=>{
  const db=storage(null),locks=serialLocks();
  const receipt=await commitNormalSnapshotLocked(db,state(0),{
    expectedRaw:null,locks});
  assert.equal(receipt.ok,true);
  assert.equal(db.getItem(SAVE_KEY),raw(0));
});

test('P2.60a readback failure is not mislabeled a successful locked write',async()=>{
  const db=storage(raw(1)),locks=serialLocks();
  const broken={getItem:db.getItem,setItem(){}};
  const receipt=await commitNormalSnapshotLocked(broken,state(2),{
    expectedRaw:raw(1),locks});
  assert.deepEqual(receipt,{ok:false,reason:'SAVE_VERIFY_FAILED'});
  assert.equal(db.getItem(SAVE_KEY),raw(1));
});
