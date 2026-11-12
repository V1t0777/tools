import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';

// Fault injection uses the real page runtime, locked reset transaction,
// backup reservation and save readback. Only the browser lock and storage
// scheduling are controlled; no reset receipt is forged.
function fixture({onVerified=()=>{}}={}) {
  const original=JSON.stringify(createInitialState(1000));
  const map=new Map([[SAVE_KEY,original],[STORY_SAVE_KEY,'story-original'],
    [RESTORE_BACKUP_KEY,'restore-original']]);
  const writes=[];
  let busy=false,delay=false,release=null,onWrite=()=>{};
  const storage={
    getItem:key=>map.has(key)?map.get(key):null,
    setItem(key,value) {
      writes.push([key,value]);
      map.set(key,value);
      onWrite(key,value);
    }
  };
  const locks={request(name,options,callback) {
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    const granted=()=>callback({name,mode:'exclusive'});
    if(busy)return Promise.resolve().then(()=>callback(null));
    if(delay)return new Promise(resolve=>{release=()=>resolve(granted());});
    return Promise.resolve().then(granted);
  }};
  const runtime=createNormalPageRuntime({storage,locks,
    onVerified:(state,raw,kind,receipt)=>onVerified(state,raw,kind,receipt,map)});
  const isolated=()=>{
    assert.equal(map.get(STORY_SAVE_KEY),'story-original');
    assert.equal(map.get(RESTORE_BACKUP_KEY),'restore-original');
    assert.equal(writes.some(([key])=>
      key===STORY_SAVE_KEY||key===RESTORE_BACKUP_KEY),false);
  };
  return {original,map,writes,runtime,isolated,
    setBusy(value){busy=value;},
    setDelay(value){delay=value;},
    release(){assert.equal(typeof release,'function');release();release=null;},
    onWrite(fn){onWrite=fn;}
  };
}

test('P2.65bn busy reset lock is a definite no-write and can retry safely',async()=>{
  const f=fixture();
  assert.equal((await f.runtime.start({now:1000})).ok,true);
  f.setBusy(true);
  const denied=await f.runtime.reset({confirmed:true,
    requireOriginalBackup:true,now:2000});
  assert.deepEqual(denied,{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.equal(f.runtime.blocked,false);
  assert.equal(f.runtime.phase,'ready');
  assert.equal(f.map.get(SAVE_KEY),f.original);
  assert.equal(f.map.has(ABNORMAL_RESET_BACKUP_KEY),false);
  assert.deepEqual(f.writes,[]);
  f.setBusy(false);
  const accepted=await f.runtime.reset({confirmed:true,
    requireOriginalBackup:true,now:2000});
  assert.deepEqual(accepted,{ok:true,status:'RESET_PUBLISHED',
    backupVerified:true});
  assert.equal(f.map.get(ABNORMAL_RESET_BACKUP_KEY),f.original);
  assert.equal(f.map.get(SAVE_KEY),f.runtime.raw);
  f.isolated();
});

test('P2.65bn pending confirmed reset rejects old action, timer and second reset',async()=>{
  const f=fixture();
  assert.equal((await f.runtime.start({now:1000})).ok,true);
  f.setDelay(true);
  const pending=f.runtime.reset({confirmed:true,
    requireOriginalBackup:true,now:2000});
  assert.equal(f.runtime.busy,true);
  let actionCalls=0;
  assert.deepEqual(await f.runtime.action(()=>{actionCalls++;return null;}),
    {ok:false,reason:'UI_TRANSACTION_BUSY'});
  assert.deepEqual(await f.runtime.clock({now:3000}),
    {ok:false,reason:'UI_TRANSACTION_BUSY'});
  assert.deepEqual(await f.runtime.reset({confirmed:true,now:3000}),
    {ok:false,reason:'UI_TRANSACTION_BUSY'});
  assert.equal(actionCalls,0);
  assert.deepEqual(f.writes,[]);
  f.release();
  assert.deepEqual(await pending,{ok:true,status:'RESET_PUBLISHED',
    backupVerified:true});
  assert.deepEqual(f.writes.map(([key])=>key),
    [ABNORMAL_RESET_BACKUP_KEY,SAVE_KEY]);
  assert.equal(f.map.get(ABNORMAL_RESET_BACKUP_KEY),f.original);
  f.isolated();
});

test('P2.65bn noncooperating tab overwrite during reset write blocks publication',async()=>{
  const f=fixture();
  assert.equal((await f.runtime.start({now:1000})).ok,true);
  const newer=JSON.stringify({...createInitialState(1000),
    revision:19,coins:190});
  f.onWrite(key=>{if(key===SAVE_KEY)f.map.set(SAVE_KEY,newer);});
  const result=await f.runtime.reset({confirmed:true,
    requireOriginalBackup:true,now:2000});
  assert.deepEqual(result,{ok:false,reason:'SAVE_VERIFY_FAILED'});
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),newer);
  assert.equal(f.map.get(ABNORMAL_RESET_BACKUP_KEY),f.original);
  assert.deepEqual(f.writes.map(([key])=>key),
    [ABNORMAL_RESET_BACKUP_KEY,SAVE_KEY]);
  assert.deepEqual(await f.runtime.clock({now:3000}),
    {ok:false,reason:'UI_SAVE_BLOCKED'});
  f.isolated();
});

test('P2.65bn reentrant UI publication cannot acknowledge overwritten reset',async()=>{
  const newer=JSON.stringify({...createInitialState(1000),
    revision:21,coins:210});
  const f=fixture({onVerified:(_state,_raw,kind,_receipt,map)=>{
    if(kind==='reset')map.set(SAVE_KEY,newer);
  }});
  assert.equal((await f.runtime.start({now:1000})).ok,true);
  const result=await f.runtime.reset({confirmed:true,
    requireOriginalBackup:true,now:2000});
  assert.deepEqual(result,{ok:false,reason:'UI_PUBLISH_FAILED'});
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),newer);
  assert.equal(f.map.get(ABNORMAL_RESET_BACKUP_KEY),f.original);
  assert.deepEqual(await f.runtime.reset({confirmed:true,now:3000}),
    {ok:false,reason:'BLOCKED_RESET_REQUIRES_RELOAD'});
  f.isolated();
});
