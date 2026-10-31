import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';
import {attachNormalPageLifecycle} from '../merge/normal-page-lifecycle.mjs';

// Integrates the actual lifecycle bridge with the actual reset runtime.
// Only event dispatch, Web Lock scheduling and storage are deterministic.
// No game save transaction, receipt or UI publication is mocked.
function fixture() {
  const original=JSON.stringify(createInitialState(1000));
  const map=new Map([[SAVE_KEY,original],[STORY_SAVE_KEY,'story-original'],
    [RESTORE_BACKUP_KEY,'restore-original']]);
  const writes=[];
  let held=false,release=null,onWrite=()=>{};
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
    const grant=()=>callback({name,mode:'exclusive'});
    if(held)return new Promise(resolve=>{release=()=>resolve(grant());});
    return Promise.resolve().then(grant);
  }};
  const eventTarget=()=>{
    const listeners=new Map();
    return {
      addEventListener(name,fn){listeners.set(name,fn);},
      removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);},
      emit(name,event={}){listeners.get(name)?.(event);}
    };
  };
  const win=eventTarget(),doc=Object.assign(eventTarget(),{hidden:false});
  const runtime=createNormalPageRuntime({locks,storage});
  const cancellations=[],notices=[];
  const lifecycle=attachNormalPageLifecycle({runtime,win,doc,storage,
    cancelGesture:()=>{cancellations.push('cancel');},
    onResult:(result,source)=>notices.push({result,source})
  });
  const assertIsolated=()=>{
    assert.equal(map.get(STORY_SAVE_KEY),'story-original');
    assert.equal(map.get(RESTORE_BACKUP_KEY),'restore-original');
    assert.equal(writes.some(([key])=>
      key===STORY_SAVE_KEY||key===RESTORE_BACKUP_KEY),false);
  };
  return {original,map,writes,storage,win,doc,runtime,lifecycle,cancellations,notices,
    hold(){held=true;},
    release(){assert.equal(typeof release,'function');release();release=null;},
    onWrite(fn){onWrite=fn;},
    assertIsolated
  };
}

test('P2.65bo hidden plus pagehide while reset awaits lock cannot resume stale confirmation',async()=>{
  const f=fixture();
  assert.equal((await f.runtime.start({now:1000})).ok,true);
  f.hold();
  const pending=f.runtime.reset({confirmed:true,requireOriginalBackup:true,now:2000});
  f.doc.hidden=true;
  f.doc.emit('visibilitychange');
  f.win.emit('pagehide');
  f.win.emit('pageshow',{persisted:true});
  f.doc.hidden=false;
  f.doc.emit('visibilitychange');
  f.release();
  const result=await pending;
  assert.deepEqual(result,{ok:false,reason:'RESET_INVALIDATED'});
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),f.original);
  assert.equal(f.map.has(ABNORMAL_RESET_BACKUP_KEY),false);
  assert.deepEqual(f.writes,[]);
  assert.ok(f.cancellations.length>=2);
  f.assertIsolated();
  f.lifecycle.detach();
});

test('P2.65bo external save event during pending reset never rolls back newer tab',async()=>{
  const f=fixture();
  assert.equal((await f.runtime.start({now:1000})).ok,true);
  f.hold();
  const pending=f.runtime.reset({confirmed:true,requireOriginalBackup:true,now:2000});
  const newer=JSON.stringify({...createInitialState(1000),revision:9,coins:91});
  f.map.set(SAVE_KEY,newer);
  f.win.emit('storage',{key:SAVE_KEY,storageArea:f.storage});
  // The lifecycle bridge receives the real same-area event while resetting.
  // The locked transaction must still reject the changed baseline.
  f.release();
  const result=await pending;
  assert.equal(result.ok,false);
  assert.equal(result.reason,'STALE_BASELINE');
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),newer);
  assert.equal(f.map.has(ABNORMAL_RESET_BACKUP_KEY),false);
  assert.deepEqual(f.writes,[]);
  f.assertIsolated();
  f.lifecycle.detach();
});

test('P2.65bo BFCache pageshow before delayed reset settles cannot reauthorize it',async()=>{
  const f=fixture();
  assert.equal((await f.runtime.start({now:1000})).ok,true);
  f.hold();
  const pending=f.runtime.reset({confirmed:true,requireOriginalBackup:true,now:2000});
  f.win.emit('pagehide'); // Safari may fire before document.hidden changes.
  f.win.emit('pageshow',{persisted:true});
  f.win.emit('focus');
  f.release();
  assert.deepEqual(await pending,{ok:false,reason:'RESET_INVALIDATED'});
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),f.original);
  assert.equal(f.map.has(ABNORMAL_RESET_BACKUP_KEY),false);
  assert.deepEqual(f.writes,[]);
  f.assertIsolated();
  f.lifecycle.detach();
});

test('P2.65bo pagehide during backup reservation preserves original and never resets',async()=>{
  const f=fixture();
  assert.equal((await f.runtime.start({now:1000})).ok,true);
  f.onWrite(key=>{
    if(key===ABNORMAL_RESET_BACKUP_KEY) {
      f.win.emit('pagehide');
      f.win.emit('pageshow',{persisted:true});
    }
  });
  const result=await f.runtime.reset({
    confirmed:true,requireOriginalBackup:true,now:2000
  });
  assert.deepEqual(result,{ok:false,reason:'RESET_INVALIDATED'});
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),f.original);
  assert.equal(f.map.get(ABNORMAL_RESET_BACKUP_KEY),f.original);
  assert.deepEqual(f.writes.map(([key])=>key),[ABNORMAL_RESET_BACKUP_KEY]);
  f.assertIsolated();
  f.lifecycle.detach();
});
