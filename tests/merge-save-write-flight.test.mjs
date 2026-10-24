import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {RESTORE_LOCK_NAME} from '../merge/save-restore-lock.mjs';
import {createNormalSaveFlight} from '../merge/save-write-flight.mjs';

const state=(revision=0)=>({...createInitialState(1_000_000),revision});
const raw=revision=>JSON.stringify(state(revision));
function storage(normal=null,story=null) {
  const map=new Map(),writes=[];
  if(normal!==null)map.set(SAVE_KEY,normal);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {writes,map,getItem:key=>map.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);map.set(key,value);},
    read:key=>map.get(key)??null};
}
function lock() {
  return {request(name,opts,callback){
    assert.equal(name,RESTORE_LOCK_NAME);
    assert.deepEqual(opts,{mode:'exclusive',ifAvailable:true});
    return callback({name,mode:'exclusive'});
  }};
}

test('normal save flight prevents overlapping asynchronous UI writes',async()=>{
  const original=raw(1),db=storage(original);
  let release;
  const wait=new Promise(resolve=>{release=resolve;});
  const manager={async request(name,opts,callback){
    assert.equal(name,RESTORE_LOCK_NAME);
    await wait;
    return callback({name,mode:'exclusive'});
  }};
  const flight=createNormalSaveFlight(db,manager);
  assert.equal(flight.pending,false);
  assert.ok(Object.isFrozen(flight));
  const first=flight.write(state(2),{expectedRaw:original});
  assert.equal(flight.pending,true);
  const second=await flight.write(state(3),{expectedRaw:original});
  assert.deepEqual(second,{ok:false,reason:'SAVE_IN_FLIGHT'});
  assert.equal(flight.pending,true);
  assert.equal(db.read(SAVE_KEY),original);
  assert.deepEqual(db.writes,[]);
  release();
  const result=await first;
  assert.equal(result.ok,true);
  assert.equal(result.verifiedReadback,true);
  assert.equal(flight.pending,false);
  assert.equal(db.read(SAVE_KEY),raw(2));
  assert.deepEqual(db.writes,[[SAVE_KEY,raw(2)]]);
  // After success the caller must use the new observed raw baseline.
  const next=await flight.write(state(3),{expectedRaw:raw(2)});
  assert.equal(next.ok,true);
  assert.equal(db.read(SAVE_KEY),raw(3));
});

test('stale baseline fails without automatic retry, then releases single-flight guard',async()=>{
  const original=raw(1),newer=raw(2),db=storage(newer);
  const flight=createNormalSaveFlight(db,lock());
  const result=await flight.write(state(3),{expectedRaw:original});
  assert.deepEqual(result,{ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(flight.pending,false);
  assert.equal(db.read(SAVE_KEY),newer);
  assert.deepEqual(db.writes,[]);
  // Explicit new call after the caller has re-read a trusted baseline.
  assert.equal((await flight.write(state(3),{expectedRaw:newer})).ok,true);
  assert.equal(db.read(SAVE_KEY),raw(3));
});

test('unavailable Web Locks never trigger unlocked save or a hidden queue',async()=>{
  const old=raw(1),db=storage(old),flight=createNormalSaveFlight(db,null);
  assert.deepEqual(await flight.write(state(2),{expectedRaw:old}),
    {ok:false,reason:'LOCKS_UNAVAILABLE'});
  assert.equal(flight.pending,false);
  assert.equal(db.read(SAVE_KEY),old);
  assert.deepEqual(db.writes,[]);
});

test('reset remains explicit and cannot be disguised as ordinary downgrade',async()=>{
  const old=raw(7),db=storage(old),flight=createNormalSaveFlight(db,lock());
  assert.deepEqual(await flight.write(state(0),{expectedRaw:old}),
    {ok:false,reason:'SAVE_REJECTED_OR_UNCERTAIN'});
  assert.equal(db.read(SAVE_KEY),old);
  assert.equal((await flight.write(state(0),
    {expectedRaw:old,confirmedReset:true})).ok,true);
  assert.equal(db.read(SAVE_KEY),raw(0));
});

test('unexpected provider errors release guard without falsely claiming safety',async()=>{
  const old=raw(1),db=storage(old);
  const flight=createNormalSaveFlight(db,{request(){throw Error('broken');}});
  assert.deepEqual(await flight.write(state(2),{expectedRaw:old}),
    {ok:false,reason:'LOCK_FAILED'});
  assert.equal(flight.pending,false);
  assert.deepEqual(db.writes,[]);
});

test('story key, network and current gameplay UI are untouched',async()=>{
  const story=JSON.stringify(createEmptyStoryProgress());
  const db=storage(null,story),flight=createNormalSaveFlight(db,lock());
  assert.equal((await flight.write(state(),{expectedRaw:null})).ok,true);
  assert.equal(db.read(STORY_SAVE_KEY),story);
  assert.deepEqual(db.writes.map(([key])=>key),[SAVE_KEY]);
  const src=readFileSync(new URL('../merge/save-write-flight.mjs',import.meta.url),'utf8');
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  for(const bad of ['fetch(','XMLHttpRequest','localStorage.','document.','window.','removeItem('])
    assert.equal(src.includes(bad),false,bad);
  assert.equal(main.includes("from './save-write-flight.mjs'"),false);
});
