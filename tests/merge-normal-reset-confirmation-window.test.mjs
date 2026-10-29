import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';

const initialRaw=()=>JSON.stringify(createInitialState(1000));
function fixture(){
  const original=initialRaw();
  const map=new Map([[SAVE_KEY,original],[STORY_SAVE_KEY,'story-original'],
    [RESTORE_BACKUP_KEY,'restore-backup-original']]);
  const writes=[];
  let hold=false,release=null,onWrite=()=>{};
  const storage={
    getItem:key=>map.has(key)?map.get(key):null,
    setItem(key,value){
      writes.push([key,value]);map.set(key,value);onWrite(key,value);
    }
  };
  const locks={request(name,options,callback){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    const execute=()=>callback({name,mode:'exclusive'});
    if(hold)return new Promise(resolve=>{release=()=>resolve(execute());});
    return Promise.resolve().then(execute);
  }};
  const runtime=createNormalPageRuntime({locks,storage});
  const assertIsolated=()=>{
    assert.equal(map.get(STORY_SAVE_KEY),'story-original');
    assert.equal(map.get(RESTORE_BACKUP_KEY),'restore-backup-original');
    assert.equal(writes.some(([key])=>key===STORY_SAVE_KEY||key===RESTORE_BACKUP_KEY),false);
  };
  return {map,writes,runtime,original,assertIsolated,
    hold(){hold=true;},
    release(){assert.equal(typeof release,'function');release();},
    onWrite(fn){onWrite=fn;}
  };
}

test('P2.65bm pagehide while reset awaits Web Lock never writes or reserves backup',async()=>{
  const f=fixture();assert.equal((await f.runtime.start({now:1000})).ok,true);
  f.hold();
  const pending=f.runtime.reset({confirmed:true,requireOriginalBackup:true,now:2000});
  f.runtime.invalidate();
  f.release();
  const result=await pending;
  assert.equal(result.ok,false);
  assert.equal(result.reason,'RESET_INVALIDATED');
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),f.original);
  assert.equal(f.map.get(ABNORMAL_RESET_BACKUP_KEY),undefined);
  assert.deepEqual(f.writes,[]);
  f.assertIsolated();
});

test('P2.65bm cross-tab save during reset lock wait is preserved without backup or reset',async()=>{
  const f=fixture();assert.equal((await f.runtime.start({now:1000})).ok,true);
  const newer=JSON.stringify({...createInitialState(1000),revision:7,coins:73});
  f.hold();
  const pending=f.runtime.reset({confirmed:true,requireOriginalBackup:true,now:2000});
  f.map.set(SAVE_KEY,newer); // noncooperating tab before lock acquisition
  f.release();
  const result=await pending;
  assert.equal(result.reason,'STALE_BASELINE');
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),newer);
  assert.equal(f.map.get(ABNORMAL_RESET_BACKUP_KEY),undefined);
  assert.deepEqual(f.writes,[]);
  f.assertIsolated();
});

test('P2.65bm pagehide during backup reservation keeps original and blocks reset',async()=>{
  const f=fixture();assert.equal((await f.runtime.start({now:1000})).ok,true);
  f.onWrite(key=>{if(key===ABNORMAL_RESET_BACKUP_KEY)f.runtime.invalidate();});
  const result=await f.runtime.reset({confirmed:true,requireOriginalBackup:true,now:2000});
  assert.equal(result.reason,'RESET_INVALIDATED');
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),f.original);
  assert.equal(f.map.get(ABNORMAL_RESET_BACKUP_KEY),f.original);
  assert.deepEqual(f.writes.map(([key])=>key),[ABNORMAL_RESET_BACKUP_KEY]);
  f.assertIsolated();
});

test('P2.65bm cross-tab overwrite during backup reservation cannot be reset away',async()=>{
  const f=fixture();assert.equal((await f.runtime.start({now:1000})).ok,true);
  const newer=JSON.stringify({...createInitialState(1000),revision:8,coins:81});
  f.onWrite(key=>{if(key===ABNORMAL_RESET_BACKUP_KEY)f.map.set(SAVE_KEY,newer);});
  const result=await f.runtime.reset({confirmed:true,requireOriginalBackup:true,now:2000});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'CURRENT_SAVE_CHANGED');
  assert.equal(f.runtime.blocked,true);
  assert.equal(f.map.get(SAVE_KEY),newer);
  assert.equal(f.map.get(ABNORMAL_RESET_BACKUP_KEY),f.original);
  assert.deepEqual(f.writes.map(([key])=>key),[ABNORMAL_RESET_BACKUP_KEY]);
  f.assertIsolated();
});
