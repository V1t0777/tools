import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {RESTORE_LOCK_NAME,coordinateNormalSaveRestore} from '../merge/save-restore-lock.mjs';
import {NORMAL_SAVE_LOCK_NAME,coordinateNormalSaveWrite as write} from '../merge/save-write-lock.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';

const state=(revision=0)=>({...createInitialState(1_000_000),revision});
const raw=r=>JSON.stringify(state(r));
function db(normal=null,story=null) {
  const map=new Map(),writes=[];
  if(normal!==null)map.set(SAVE_KEY,normal);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,getItem:key=>map.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);map.set(key,value);},
    read:key=>map.get(key)??null};
}
function locks() {
  let active=false;
  return {requests:0,request(name,options,callback){
    this.requests++;
    assert.equal(name,RESTORE_LOCK_NAME);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    if(active)return Promise.resolve(callback(null));
    active=true;
    try {
      return Promise.resolve(callback({name,mode:'exclusive'}))
        .finally(()=>{active=false;});
    } catch(error) {active=false;return Promise.reject(error);}
  }};
}

test('ordinary save holds same lock as restore and verifies exact persisted bytes',async()=>{
  const prev=raw(1),storage=db(prev),manager=locks();
  const result=await write(state(2),storage,manager,{expectedRaw:prev});
  assert.equal(NORMAL_SAVE_LOCK_NAME,RESTORE_LOCK_NAME);
  assert.deepEqual(result,{ok:true,status:'SAVE_VERIFIED',mode:'normal',
    revision:2,confirmedReset:false,verifiedReadback:true});
  assert.ok(Object.isFrozen(result));
  assert.equal(storage.read(SAVE_KEY),raw(2));
  assert.deepEqual(storage.writes,[[SAVE_KEY,raw(2)]]);
  assert.equal(manager.requests,1);
});

test('no trusted baseline, invalid state or missing locks safely rejects',async()=>{
  const storage=db(),manager=locks();
  for(const opts of [{},{expectedRaw:undefined},{expectedRaw:42}])
    assert.deepEqual(await write(state(),storage,manager,opts),
      {ok:false,reason:'NO_TRUSTED_BASELINE'});
  assert.deepEqual(await write({...state(),coins:-1},storage,manager,{expectedRaw:null}),
    {ok:false,reason:'INVALID_SAVE'});
  assert.deepEqual(await write(state(),storage,null,{expectedRaw:null}),
    {ok:false,reason:'LOCKS_UNAVAILABLE'});
  assert.deepEqual(await write(state(),storage,manager,{expectedRaw:null,confirmedReset:1}),
    {ok:false,reason:'INVALID_RESET_FLAG'});
  assert.equal(manager.requests,0);
  assert.deepEqual(storage.writes,[]);
});

test('same-revision stale tab changes are blocked before write',async()=>{
  const old=raw(1),changed=JSON.stringify({...state(1),energyAt:1_000_001});
  assert.equal(validateSave(JSON.parse(changed)),true);
  const storage=db(changed);
  assert.deepEqual(await write(state(2),storage,locks(),{expectedRaw:old}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(storage.read(SAVE_KEY),changed);
  assert.deepEqual(storage.writes,[]);
});

test('reset needs explicit reset flag and matching last observed save',async()=>{
  const original=raw(8),storage=db(original),manager=locks();
  assert.deepEqual(await write(state(0),storage,manager,{expectedRaw:original}),
    {ok:false,reason:'SAVE_REJECTED_OR_UNCERTAIN'});
  assert.equal(storage.read(SAVE_KEY),original);
  const result=await write(state(0),storage,manager,
    {expectedRaw:original,confirmedReset:true});
  assert.equal(result.ok,true);
  assert.equal(storage.read(SAVE_KEY),raw(0));
});

test('busy restore lock refuses ordinary save; busy ordinary lock refuses restore',async()=>{
  const original=raw(1),storage=db(original),manager=locks();
  const a=coordinateNormalSaveRestore(raw(3),storage,manager,
    {expectedRaw:original,confirmed:true});
  assert.deepEqual(await write(state(4),storage,manager,{expectedRaw:original}),
    {ok:false,reason:'LOCK_BUSY'});
  assert.equal((await a).ok,true);
  assert.equal(storage.read(SAVE_KEY),raw(3));
  assert.equal(storage.read(RESTORE_BACKUP_KEY),original);

  const second=db(original),manager2=locks();
  const b=write(state(2),second,manager2,{expectedRaw:original});
  assert.deepEqual(await coordinateNormalSaveRestore(raw(3),second,manager2,
    {expectedRaw:original,confirmed:true}),{ok:false,reason:'LOCK_BUSY'});
  assert.equal((await b).ok,true);
  assert.equal(second.read(SAVE_KEY),raw(2));
  assert.equal(second.read(RESTORE_BACKUP_KEY),null);
});

test('invalid existing bytes are preserved; a truncated write fails readback',async()=>{
  const broken='{bad',storage=db(broken);
  assert.deepEqual(await write(state(2),storage,locks(),{expectedRaw:broken}),
    {ok:false,reason:'SAVE_REJECTED_OR_UNCERTAIN'});
  assert.deepEqual(storage.writes,[]);
  assert.equal(storage.read(SAVE_KEY),broken);
  const normal=db(raw(1));
  const trunc={getItem:key=>normal.getItem(key),
    setItem:(key,value)=>normal.setItem(key,key===SAVE_KEY?'{partial':value)};
  assert.deepEqual(await write(state(2),trunc,locks(),{expectedRaw:raw(1)}),
    {ok:false,reason:'SAVE_VERIFY_FAILED'});
  assert.equal(normal.read(SAVE_KEY),'{partial');
});

test('provider exceptions before and after save distinguish uncertain outcome',async()=>{
  const prev=raw(1),storage=db(prev);
  assert.deepEqual(await write(state(2),storage,{request(){throw Error('unsupported')}},
    {expectedRaw:prev}),{ok:false,reason:'LOCK_FAILED'});
  assert.deepEqual(storage.writes,[]);
  const faulty={async request(name,options,callback){
    await callback({name,mode:'exclusive'});
    throw Error('provider lost result');
  }};
  assert.deepEqual(await write(state(2),storage,faulty,{expectedRaw:prev}),
    {ok:false,reason:'SAVE_OUTCOME_UNCERTAIN'});
  assert.equal(storage.read(SAVE_KEY),raw(2));
});

test('story save key and current UI remain unchanged by adapter',async()=>{
  const story=JSON.stringify(createEmptyStoryProgress()),storage=db(null,story);
  assert.equal((await write(state(),storage,locks(),{expectedRaw:null})).ok,true);
  assert.equal(storage.read(STORY_SAVE_KEY),story);
  assert.deepEqual(storage.writes.map(([key])=>key),[SAVE_KEY]);
  const source=readFileSync(new URL('../merge/save-write-lock.mjs',import.meta.url),'utf8');
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  for(const forbidden of ['fetch(','XMLHttpRequest','localStorage.','document.','window.','removeItem('])
    assert.equal(source.includes(forbidden),false,forbidden);
  assert.equal(main.includes("from './save-write-lock.mjs'"),false);
});
