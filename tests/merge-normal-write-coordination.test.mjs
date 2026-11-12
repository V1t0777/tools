import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,MAX_ENERGY,ENERGY_REGEN_MS,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {NORMAL_SAVE_LOCK_NAME,withNormalSaveLock} from '../merge/normal-save-lock.mjs';
import {prepareNormalStartupWithLock} from '../merge/normal-startup-transaction.mjs';
import {commitNormalActionWithLock,commitNormalClockWithLock} from '../merge/normal-action-transaction.mjs';
import {commitNormalResetWithLock} from '../merge/normal-reset-transaction.mjs';

const at=1_000_000;

function memory(raw=null,story=null) {
  const data=new Map(),writes=[];
  if(raw!==null)data.set(SAVE_KEY,raw);
  if(story!==null)data.set(STORY_SAVE_KEY,story);
  return {
    writes,
    getItem(key){return data.has(key)?data.get(key):null;},
    setItem(key,value){writes.push([key,value]);data.set(key,value);},
    read(key){return data.has(key)?data.get(key):null;}
  };
}

function exclusiveLocks() {
  let held=false;
  return {request(name,options,callback){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.equal(options.mode,'exclusive');
    assert.equal(options.ifAvailable,true);
    if(held)return Promise.resolve(callback(null));
    held=true;
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}))
      .finally(()=>{held=false;});
  }};
}

test('P2.57 startup -> action -> clock -> reset enforces one raw-byte lineage',async()=>{
  const original={...createInitialState(at),energy:MAX_ENERGY-1};
  const raw=JSON.stringify(original),story='untouched-story-save';
  const db=memory(raw,story),locks=exclusiveLocks();
  const startup=await prepareNormalStartupWithLock(locks,db,{now:at});
  assert.equal(startup.ok,true);
  assert.equal(startup.raw,raw);
  assert.equal(db.writes.length,0);

  const action=await commitNormalActionWithLock(locks,db,{
    expectedRaw:startup.raw,action:state=>moveOrMerge(state,0,2)});
  assert.equal(action.ok,true);
  assert.equal(action.verifiedReadback,true);
  assert.equal(db.read(SAVE_KEY),action.raw);

  const staleClock=await commitNormalClockWithLock(locks,db,{
    expectedRaw:startup.raw,now:at+ENERGY_REGEN_MS+1});
  assert.deepEqual(staleClock,{ok:false,reason:'STALE_BASELINE'});
  assert.equal(db.read(SAVE_KEY),action.raw);

  const clock=await commitNormalClockWithLock(locks,db,{
    expectedRaw:action.raw,now:at+ENERGY_REGEN_MS+1});
  assert.equal(clock.ok,true);
  assert.equal(clock.changed,true);
  assert.equal(clock.verifiedReadback,true);
  assert.equal(clock.state.energy,MAX_ENERGY);
  assert.equal(db.read(SAVE_KEY),clock.raw);

  const staleReset=await commitNormalResetWithLock(locks,db,{
    expectedRaw:action.raw,confirmedReset:true,now:at+ENERGY_REGEN_MS+2});
  assert.deepEqual(staleReset,{ok:false,reason:'STALE_BASELINE'});
  assert.equal(db.read(SAVE_KEY),clock.raw);

  const reset=await commitNormalResetWithLock(locks,db,{
    expectedRaw:clock.raw,confirmedReset:true,now:at+ENERGY_REGEN_MS+2});
  assert.equal(reset.ok,true);
  assert.equal(reset.verifiedReadback,true);
  assert.equal(db.read(SAVE_KEY),reset.raw);

  const staleAction=await commitNormalActionWithLock(locks,db,{
    expectedRaw:clock.raw,action:state=>moveOrMerge(state,0,2)});
  assert.deepEqual(staleAction,{ok:false,reason:'STALE_BASELINE'});
  assert.equal(db.read(SAVE_KEY),reset.raw);
  assert.deepEqual(db.writes.map(([key])=>key),[SAVE_KEY,SAVE_KEY,SAVE_KEY]);
  assert.equal(db.read(STORY_SAVE_KEY),story);
  assert.equal(db.writes.some(([key])=>key===STORY_SAVE_KEY),false);
});

test('P2.57 held lock stops startup/action/timer/reset without even one write',async()=>{
  const raw=JSON.stringify(createInitialState(at)),db=memory(raw);
  const lock=exclusiveLocks();
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  const waiting=new Promise(resolve=>{release=resolve;});
  const holder=withNormalSaveLock(lock,async()=>{
    entered();
    await waiting;
    return {ok:true};
  });
  await started;

  let actionCalls=0;
  const attempts=await Promise.all([
    prepareNormalStartupWithLock(lock,db,{now:at}),
    commitNormalActionWithLock(lock,db,{expectedRaw:raw,action:state=>{
      actionCalls++;
      return moveOrMerge(state,0,2);
    }}),
    commitNormalClockWithLock(lock,db,{expectedRaw:raw,now:at+ENERGY_REGEN_MS}),
    commitNormalResetWithLock(lock,db,{expectedRaw:raw,confirmedReset:true,now:at})
  ]);
  for(const result of attempts)
    assert.deepEqual(result,{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.equal(actionCalls,0);
  assert.deepEqual(db.writes,[]);
  assert.equal(db.read(SAVE_KEY),raw);

  release();
  assert.equal((await holder).ok,true);
  const after=await commitNormalActionWithLock(lock,db,{
    expectedRaw:raw,action:state=>moveOrMerge(state,0,2)});
  assert.equal(after.ok,true);
  assert.equal(db.writes.length,1);
});

test('P2.57 simultaneous action and timer cannot both commit their stale baseline',async()=>{
  const state={...createInitialState(at),energy:MAX_ENERGY-1};
  const raw=JSON.stringify(state),db=memory(raw),lock=exclusiveLocks();
  const [action,clock]=await Promise.all([
    commitNormalActionWithLock(lock,db,{expectedRaw:raw,
      action:current=>moveOrMerge(current,0,2)}),
    commitNormalClockWithLock(lock,db,{expectedRaw:raw,
      now:at+ENERGY_REGEN_MS})
  ]);
  assert.equal(action.ok,true);
  assert.deepEqual(clock,{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.equal(db.writes.length,1);
  assert.equal(db.read(SAVE_KEY),action.raw);

  const retry=await commitNormalClockWithLock(lock,db,{
    expectedRaw:raw,now:at+ENERGY_REGEN_MS});
  assert.deepEqual(retry,{ok:false,reason:'STALE_BASELINE'});
  assert.equal(db.writes.length,1);
});

test('P2.57 abnormal reset backup cannot be created while another writer holds lock',async()=>{
  const raw='{broken-json',story='story-unchanged';
  const db=memory(raw,story),lock=exclusiveLocks();
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  const pending=new Promise(resolve=>{release=resolve;});
  const holder=withNormalSaveLock(lock,async()=>{
    entered();await pending;return {ok:true};
  });
  await started;

  const busy=await commitNormalResetWithLock(lock,db,{
    expectedRaw:raw,confirmedReset:true,now:at});
  assert.deepEqual(busy,{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.equal(db.read(ABNORMAL_RESET_BACKUP_KEY),null);
  assert.deepEqual(db.writes,[]);

  release();
  assert.equal((await holder).ok,true);
  const reset=await commitNormalResetWithLock(lock,db,{
    expectedRaw:raw,confirmedReset:true,now:at});
  assert.equal(reset.ok,true);
  assert.equal(reset.backupVerified,true);
  assert.equal(db.read(ABNORMAL_RESET_BACKUP_KEY),raw);
  assert.equal(db.read(STORY_SAVE_KEY),story);
  assert.deepEqual(db.writes.map(([key])=>key),
    [ABNORMAL_RESET_BACKUP_KEY,SAVE_KEY]);
});
