import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {NORMAL_SAVE_LOCK_NAME as CURRENT_LOCK,
  withNormalSaveLock} from '../merge/normal-save-lock.mjs';
import {RESTORE_LOCK_NAME,coordinateNormalSaveRestore}
  from '../merge/save-restore-lock.mjs';
import {NORMAL_SAVE_LOCK_NAME as LEGACY_WRITE_LOCK,
  coordinateNormalSaveWrite} from '../merge/save-write-lock.mjs';
import {commitNormalActionWithLock}
  from '../merge/normal-action-transaction.mjs';

const snapshot = revision =>
  JSON.stringify({...createInitialState(1_000_000),revision});
function storage(initial) {
  const values=new Map([[SAVE_KEY,initial]]);
  const writes=[];
  return {writes,getItem:key=>values.get(key)??null,
    setItem:(key,value)=>{writes.push(key);values.set(key,value);}};
}
function locks() {
  let held=false;
  return {requests:[],request(name,options,callback) {
    this.requests.push(name);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    if(held)return Promise.resolve(callback(null));
    held=true;
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}))
      .finally(()=>{held=false;});
  }};
}

test('P2.21 restore, P2.22 save and P2.45+ transactions use one lock name',()=>{
  assert.equal(RESTORE_LOCK_NAME,CURRENT_LOCK);
  assert.equal(LEGACY_WRITE_LOCK,CURRENT_LOCK);
  assert.equal(typeof withNormalSaveLock,'function');
  assert.equal(typeof coordinateNormalSaveWrite,'function');
});

test('restore holding the shared lock rejects gameplay; stale baseline stays blocked',async()=>{
  const original=snapshot(1),replacement=snapshot(4);
  const db=storage(original),manager=locks();
  const restoring=coordinateNormalSaveRestore(replacement,db,manager,
    {expectedRaw:original,confirmed:true});
  let actions=0;
  const action=()=>{actions++;return {ok:true,state:JSON.parse(snapshot(2))};};
  assert.deepEqual(await commitNormalActionWithLock(manager,db,
    {expectedRaw:original,action}),{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.equal(actions,0);
  assert.equal((await restoring).ok,true);
  assert.equal(db.getItem(SAVE_KEY),replacement);
  assert.deepEqual(await commitNormalActionWithLock(manager,db,
    {expectedRaw:original,action}),{ok:false,reason:'STALE_BASELINE'});
  assert.equal(actions,0);
  assert.deepEqual(manager.requests,[CURRENT_LOCK,CURRENT_LOCK,CURRENT_LOCK]);
});

test('gameplay holding the shared lock rejects restore without creating backup',async()=>{
  const original=snapshot(1),next=JSON.parse(snapshot(2));
  const db=storage(original),manager=locks();
  const action=commitNormalActionWithLock(manager,db,
    {expectedRaw:original,action:()=>({ok:true,state:next})});
  assert.deepEqual(await coordinateNormalSaveRestore(snapshot(3),db,manager,
    {expectedRaw:original,confirmed:true}),{ok:false,reason:'LOCK_BUSY'});
  assert.equal((await action).ok,true);
  assert.equal(db.getItem(SAVE_KEY),JSON.stringify(next));
  assert.deepEqual(db.writes,[SAVE_KEY]);
  assert.deepEqual(manager.requests,[CURRENT_LOCK,CURRENT_LOCK]);
});
