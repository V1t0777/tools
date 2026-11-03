import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {RESTORE_LOCK_NAME} from '../merge/save-restore-lock.mjs';
import {createNormalSaveCheckpoint} from '../merge/save-checkpoint.mjs';

const state=(revision=0)=>({...createInitialState(1_000_000),revision});
const raw=r=>JSON.stringify(state(r));
function storage(normal=null,story=null) {
  const map=new Map(),writes=[];
  if(normal!==null)map.set(SAVE_KEY,normal);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,getItem:key=>map.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);map.set(key,value);},
    read:key=>map.get(key)??null};
}
const locks=()=>({request(name,options,callback){
  assert.equal(name,RESTORE_LOCK_NAME);
  assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
  return callback({name,mode:'exclusive'});
}});

test('verified ordinary save clears dirty flag and advances internal baseline',async()=>{
  const old=raw(1),db=storage(old);
  const session=createNormalSaveCheckpoint(db,locks(),{expectedRaw:old});
  assert.equal(Object.isFrozen(session),true);
  assert.equal(session.pending,false);
  assert.equal(session.dirty,false);
  assert.deepEqual(await session.flush(),{ok:false,reason:'NOTHING_STAGED'});
  assert.deepEqual(session.stage(state(2)),{ok:true,status:'STAGED',version:1,dirty:true});
  assert.equal(session.dirty,true);
  const result=await session.flush();
  assert.deepEqual(result,{ok:true,status:'SAVE_VERIFIED',version:1,
    dirty:false,verifiedReadback:true});
  assert.equal(session.dirty,false);
  assert.equal(db.read(SAVE_KEY),raw(2));
  session.stage(state(3));
  assert.equal((await session.flush()).ok,true);
  assert.deepEqual(db.writes,[[SAVE_KEY,raw(2)],[SAVE_KEY,raw(3)]]);
});

test('mutation staged while write is pending stays dirty after earlier save verifies',async()=>{
  const old=raw(1),db=storage(old);
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const slow={async request(name,options,callback){
    assert.equal(name,RESTORE_LOCK_NAME);
    await gate;
    return callback({name,mode:'exclusive'});
  }};
  const session=createNormalSaveCheckpoint(db,slow,{expectedRaw:old});
  session.stage(state(2));
  const first=session.flush();
  assert.equal(session.pending,true);
  session.stage(state(3));
  assert.deepEqual(await session.flush(),{ok:false,reason:'SAVE_IN_FLIGHT'});
  assert.equal(db.read(SAVE_KEY),old);
  release();
  assert.deepEqual(await first,{ok:true,status:'NEWER_STATE_UNSAVED',
    version:1,dirty:true,verifiedReadback:true});
  assert.equal(session.pending,false);
  assert.equal(session.dirty,true);
  assert.equal(db.read(SAVE_KEY),raw(2));
  assert.equal((await session.flush()).status,'SAVE_VERIFIED');
  assert.equal(session.dirty,false);
  assert.equal(db.read(SAVE_KEY),raw(3));
  assert.equal(db.writes.length,2);
});

test('stage snapshots caller object rather than a later mutation',async()=>{
  const db=storage(raw(1)),s=createNormalSaveCheckpoint(db,locks(),
    {expectedRaw:raw(1)});
  const mutable=state(2);
  assert.equal(s.stage(mutable).ok,true);
  mutable.revision=10;
  assert.equal((await s.flush()).ok,true);
  assert.equal(db.read(SAVE_KEY),raw(2));
});

test('invalid staged save does not destroy previously staged valid snapshot',async()=>{
  const db=storage(raw(1)),s=createNormalSaveCheckpoint(db,locks(),
    {expectedRaw:raw(1)});
  s.stage(state(2));
  assert.deepEqual(s.stage({...state(3),coins:-10}),
    {ok:false,reason:'INVALID_SAVE'});
  assert.equal(s.version,1);
  assert.equal(s.dirty,true);
  assert.equal((await s.flush()).ok,true);
  assert.equal(db.read(SAVE_KEY),raw(2));
});

test('stale cross-tab baseline blocks further writes until explicit reconciliation',async()=>{
  const old=raw(1),other=raw(2),db=storage(other);
  const s=createNormalSaveCheckpoint(db,locks(),{expectedRaw:old});
  s.stage(state(3));
  assert.deepEqual(await s.flush(),{ok:false,reason:'CURRENT_SAVE_CHANGED',
    dirty:true,blocked:true});
  assert.equal(s.blocked,true);
  assert.equal(s.dirty,true);
  assert.equal(db.read(SAVE_KEY),other);
  assert.deepEqual(db.writes,[]);
  assert.equal(s.stage(state(4)).status,'STAGED_AWAITING_RECONCILIATION');
  assert.deepEqual(await s.flush(),{ok:false,reason:'RECONCILIATION_REQUIRED'});
  assert.deepEqual(db.writes,[]);
});

test('unsupported locks keep snapshot dirty without fallback or hidden retry',async()=>{
  const old=raw(1),db=storage(old);
  const s=createNormalSaveCheckpoint(db,null,{expectedRaw:old});
  s.stage(state(2));
  assert.deepEqual(await s.flush(),{ok:false,reason:'LOCKS_UNAVAILABLE',
    dirty:true,blocked:false});
  assert.equal(s.dirty,true);
  assert.equal(db.read(SAVE_KEY),old);
  assert.deepEqual(db.writes,[]);
});

test('untrusted baseline cannot write even when snapshot is valid',async()=>{
  const db=storage(),s=createNormalSaveCheckpoint(db,locks());
  s.stage(state(1));
  assert.deepEqual(await s.flush(),{ok:false,reason:'NO_TRUSTED_BASELINE'});
  assert.equal(s.dirty,true);
  assert.deepEqual(db.writes,[]);
});

test('uncertain write outcome blocks retries while retaining latest staged snapshot',async()=>{
  const old=raw(1),db=storage(old);
  const broken={async request(name,options,callback){
    await callback({name,mode:'exclusive'});
    throw Error('provider failed after write');
  }};
  const s=createNormalSaveCheckpoint(db,broken,{expectedRaw:old});
  s.stage(state(2));
  assert.deepEqual(await s.flush(),{ok:false,reason:'SAVE_OUTCOME_UNCERTAIN',
    dirty:true,blocked:true});
  assert.equal(db.read(SAVE_KEY),raw(2));
  assert.equal(s.dirty,true);
  assert.deepEqual(await s.flush(),{ok:false,reason:'RECONCILIATION_REQUIRED'});
  assert.equal(db.writes.length,1);
});

test('story mode is untouched and checkpoint has no UI/network integration',async()=>{
  const story=JSON.stringify(createEmptyStoryProgress());
  const db=storage(null,story),s=createNormalSaveCheckpoint(db,locks(),
    {expectedRaw:null});
  s.stage(state(1));
  assert.equal((await s.flush()).ok,true);
  assert.equal(db.read(STORY_SAVE_KEY),story);
  assert.deepEqual(db.writes.map(([key])=>key),[SAVE_KEY]);
  const src=readFileSync(new URL('../merge/save-checkpoint.mjs',import.meta.url),'utf8');
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  for(const forbidden of ['fetch(','XMLHttpRequest','localStorage.','document.','window.','removeItem('])
    assert.equal(src.includes(forbidden),false,forbidden);
  assert.equal(main.includes("from './save-checkpoint.mjs'"),false);
});
