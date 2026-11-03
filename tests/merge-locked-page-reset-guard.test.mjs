import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';

function fixture() {
  const map=new Map(),writes=[];
  const initial=JSON.stringify(createInitialState(1000));
  map.set(SAVE_KEY,initial);
  const storage={
    getItem:key=>map.has(key)?map.get(key):null,
    setItem(key,value){writes.push(key);map.set(key,value);}
  };
  const locks={request(name,opts,cb){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(opts,{mode:'exclusive',ifAvailable:true});
    return Promise.resolve(cb({name,mode:'exclusive'}));
  }};
  return {storage,locks,map,writes};
}
test('P2.64c a blocked cross-tab conflict cannot reset even with newly supplied bytes',async()=>{
  const f=fixture(),r=createNormalPageRuntime(f);
  assert.equal((await r.start({now:1000})).ok,true);
  const newRaw=JSON.stringify({...JSON.parse(f.storage.getItem(SAVE_KEY)),coins:77});
  f.storage.setItem(SAVE_KEY,newRaw);
  assert.deepEqual(r.reconcile(),{ok:false,reason:'CURRENT_SAVE_CHANGED'});
  const writes=f.writes.length;
  assert.deepEqual(await r.reset({confirmed:true,expectedRaw:newRaw,now:1001}),
    {ok:false,reason:'BLOCKED_RESET_REQUIRES_RELOAD'});
  assert.equal(f.writes.length,writes);
  assert.equal(f.storage.getItem(SAVE_KEY),newRaw);
  assert.equal(f.storage.getItem(ABNORMAL_RESET_BACKUP_KEY),null);
  assert.equal(r.blocked,true);
});
test('P2.64c uncertain write block cannot be reclassified as corrupt reset',async()=>{
  const f=fixture(),r=createNormalPageRuntime(f);
  assert.equal((await r.start({now:1000})).ok,true);
  const original=f.storage.getItem(SAVE_KEY);
  r.block('UI_TRANSACTION_INVALIDATED');
  assert.deepEqual(await r.reset({confirmed:true,expectedRaw:original,now:1001}),
    {ok:false,reason:'BLOCKED_RESET_REQUIRES_RELOAD'});
  assert.equal(f.storage.getItem(SAVE_KEY),original);
  assert.deepEqual(f.writes,[]);
});
