import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {NORMAL_SAVE_LOCK_NAME,withNormalSaveLock} from '../merge/normal-save-lock.mjs';
import {prepareNormalStartupWithLock} from '../merge/normal-startup-transaction.mjs';
import {commitNormalActionWithLock,commitNormalClockWithLock} from '../merge/normal-action-transaction.mjs';
import {commitNormalResetWithLock} from '../merge/normal-reset-transaction.mjs';

function lockManager() {
  let held=false;
  return {request(name,options,callback) {
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    if(held)return Promise.resolve(callback(null));
    held=true;
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}))
      .finally(()=>{held=false;});
  }};
}
function memory(raw=null,story='story-preserved') {
  const map=new Map(),reads=[],writes=[];
  if(raw!==null)map.set(SAVE_KEY,raw);
  map.set(STORY_SAVE_KEY,story);
  return {reads,writes,
    getItem(key){reads.push(key);return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push(key);map.set(key,value);},
    read(key){return map.has(key)?map.get(key):null;}
  };
}
const initial=()=>createInitialState(1000);

test('P2.61v all four writers refuse a busy shared lock before reading storage',async()=>{
  const lock=lockManager(),raw=JSON.stringify(initial()),db=memory(raw);
  let release,entered,actions=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const holding=withNormalSaveLock(lock,async()=>{
    entered();await gate;return {ok:true};
  });
  await started;
  try {
    const results=await Promise.all([
      prepareNormalStartupWithLock(lock,db,{now:1000}),
      commitNormalActionWithLock(lock,db,{expectedRaw:raw,
        action:state=>{actions++;return moveOrMerge(state,0,2);}}),
      commitNormalClockWithLock(lock,db,{expectedRaw:raw,now:1000}),
      commitNormalResetWithLock(lock,db,{expectedRaw:raw,confirmedReset:true,now:2000})
    ]);
    for(const result of results)
      assert.deepEqual(result,{ok:false,reason:'SAVE_LOCK_BUSY'});
    assert.equal(actions,0);
    assert.deepEqual(db.reads,[]);
    assert.deepEqual(db.writes,[]);
    assert.equal(db.read(STORY_SAVE_KEY),'story-preserved');
  } finally {release();await holding;}
});

test('P2.61v missing Web Locks fail closed across all four writer entrypoints',async()=>{
  const raw=JSON.stringify(initial()),db=memory(raw);
  const results=await Promise.all([
    prepareNormalStartupWithLock(null,db,{now:1000}),
    commitNormalActionWithLock(null,db,{expectedRaw:raw,
      action:state=>moveOrMerge(state,0,2)}),
    commitNormalClockWithLock(null,db,{expectedRaw:raw,now:1000}),
    commitNormalResetWithLock(null,db,{expectedRaw:raw,confirmedReset:true,now:2000})
  ]);
  for(const result of results)
    assert.deepEqual(result,{ok:false,reason:'WEB_LOCKS_UNAVAILABLE'});
  assert.deepEqual(db.reads,[]);
  assert.deepEqual(db.writes,[]);
});

test('P2.61v startup, gameplay, no-op clock and reset share a verified serial path',async()=>{
  const lock=lockManager(),db=memory();
  const startup=await prepareNormalStartupWithLock(lock,db,{now:1000});
  assert.equal(startup.ok,true);
  assert.equal(startup.raw,db.read(SAVE_KEY));
  const action=await commitNormalActionWithLock(lock,db,{
    expectedRaw:startup.raw,action:state=>moveOrMerge(state,0,2)
  });
  assert.equal(action.ok,true);
  assert.equal(action.verifiedReadback,true);
  assert.equal(action.state.revision,startup.state.revision+1);
  const clock=await commitNormalClockWithLock(lock,db,{
    expectedRaw:action.raw,now:1000
  });
  assert.equal(clock.ok,true);
  assert.equal(clock.changed,false);
  assert.equal(clock.verifiedBaseline,true);
  assert.equal(clock.raw,action.raw);
  const reset=await commitNormalResetWithLock(lock,db,{
    expectedRaw:clock.raw,confirmedReset:true,now:2000
  });
  assert.equal(reset.ok,true);
  assert.equal(reset.verifiedReadback,true);
  assert.equal(reset.state.revision,0);
  assert.equal(db.read(SAVE_KEY),reset.raw);
  assert.equal(db.read(STORY_SAVE_KEY),'story-preserved');
  assert.deepEqual(db.writes,[SAVE_KEY,SAVE_KEY,SAVE_KEY]);
});

test('P2.61v a stale gameplay action cannot overwrite a reset after lock release',async()=>{
  const lock=lockManager(),raw=JSON.stringify(initial()),db=memory(raw);
  const reset=await commitNormalResetWithLock(lock,db,{
    expectedRaw:raw,confirmedReset:true,now:2000
  });
  assert.equal(reset.ok,true);
  let evaluated=0;
  const stale=await commitNormalActionWithLock(lock,db,{
    expectedRaw:raw,action:state=>{
      evaluated++;return moveOrMerge(state,0,2);
    }
  });
  assert.deepEqual(stale,{ok:false,reason:'STALE_BASELINE'});
  assert.equal(evaluated,0);
  assert.deepEqual(db.writes,[SAVE_KEY]);
  assert.equal(db.read(SAVE_KEY),reset.raw);
});
