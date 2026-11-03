import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,MAX_ENERGY,ENERGY_REGEN_MS} from '../merge/engine.mjs';
import {createInitialState as legacyInitial} from '../merge/legacy-engine.mjs';
import {SAVE_KEY,LEGACY_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {prepareNormalStartupWithLock} from '../merge/normal-startup-transaction.mjs';

const at=1_000_000;
function memory(raw=null,story=null) {
  const map=new Map(),writes=[];
  if(raw!==null)map.set(SAVE_KEY,raw);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,
    getItem(key){return map.get(key)??null;},
    setItem(key,value){writes.push([key,value]);map.set(key,value);},
    read(key){return map.get(key)??null;}};
}
function locks() {
  let held=false;
  return {request(name,opts,callback){
    assert.equal(opts.mode,'exclusive');
    assert.equal(opts.ifAvailable,true);
    if(held)return Promise.resolve(callback(null));
    held=true;
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}))
      .finally(()=>{held=false;});
  }};
}

test('P2.49 new ordinary save is created once under lock with verified bytes',async()=>{
  const store=memory();
  const result=await prepareNormalStartupWithLock(locks(),store,{now:at});
  assert.equal(result.ok,true);
  assert.equal(result.recovered,false);
  assert.equal(result.attempted,true);
  assert.equal(result.verifiedBaseline,true);
  assert.equal(result.raw,store.read(SAVE_KEY));
  assert.deepEqual(store.writes.map(([key])=>key),[SAVE_KEY]);
});

test('P2.49 unchanged formatted V3 save preserves original bytes and performs zero writes',async()=>{
  const raw=JSON.stringify(createInitialState(at),null,2),store=memory(raw);
  const result=await prepareNormalStartupWithLock(locks(),store,{now:at});
  assert.equal(result.ok,true);
  assert.equal(result.attempted,false);
  assert.equal(result.raw,raw);
  assert.equal(result.verifiedBaseline,true);
  assert.deepEqual(store.writes,[]);
});

test('P2.49 startup regeneration only publishes verified stored energy',async()=>{
  const state={...createInitialState(at),energy:MAX_ENERGY-2};
  const raw=JSON.stringify(state),store=memory(raw);
  const result=await prepareNormalStartupWithLock(locks(),store,
    {now:at+ENERGY_REGEN_MS+1});
  assert.equal(result.ok,true);
  assert.equal(result.attempted,true);
  assert.equal(result.state.energy,MAX_ENERGY-1);
  assert.equal(store.read(SAVE_KEY),result.raw);
  assert.equal(store.writes.length,1);
});

test('P2.49 legacy backup and migration occur under the same lock',async()=>{
  const raw=JSON.stringify(legacyInitial(at)),store=memory(raw);
  const result=await prepareNormalStartupWithLock(locks(),store,{now:at});
  assert.equal(result.ok,true);
  assert.equal(result.migrated,true);
  assert.equal(result.attempted,true);
  assert.equal(store.read(LEGACY_BACKUP_KEY),raw);
  assert.equal(store.read(SAVE_KEY),result.raw);
  assert.deepEqual(store.writes.map(([key])=>key),
    [LEGACY_BACKUP_KEY,SAVE_KEY]);
});

test('P2.49 legacy backup failure does not overwrite the original',async()=>{
  const raw=JSON.stringify(legacyInitial(at)),store=memory(raw);
  const failing={getItem:key=>store.getItem(key),setItem:(key,value)=>{
    if(key===LEGACY_BACKUP_KEY)throw Error('quota');
    store.setItem(key,value);
  }};
  const result=await prepareNormalStartupWithLock(locks(),failing,{now:at});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'BACKUP_UNAVAILABLE');
  assert.equal('state' in result,false);
  assert.equal(store.read(SAVE_KEY),raw);
  assert.deepEqual(store.writes,[]);
});

test('P2.49 corrupt save is never reset or published automatically',async()=>{
  const store=memory('{broken');
  const result=await prepareNormalStartupWithLock(locks(),store,{now:at});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'CORRUPT_SAVE');
  assert.equal('state' in result,false);
  assert.equal(store.read(SAVE_KEY),'{broken');
  assert.deepEqual(store.writes,[]);
});

test('P2.49 missing or busy Web Locks fail closed before any storage write',async()=>{
  const store=memory();
  const unavailable=await prepareNormalStartupWithLock(null,store,{now:at});
  assert.deepEqual(unavailable,{ok:false,reason:'WEB_LOCKS_UNAVAILABLE'});
  const busy=await prepareNormalStartupWithLock({
    request:(_name,_opts,callback)=>callback(null)},store,{now:at});
  assert.deepEqual(busy,{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.deepEqual(store.writes,[]);
});

test('P2.49 readback failure never exposes a startup candidate',async()=>{
  const store=memory();
  let reads=0;
  const fake={getItem(key){
    if(key!==SAVE_KEY)return store.getItem(key);
    reads++;
    // First read: absent. Commit read and readback: real bytes.
    // Final boundary read: uncoordinated overwrite.
    return reads>=4?'intervening':store.getItem(key);
  },setItem:(key,value)=>store.setItem(key,value)};
  const result=await prepareNormalStartupWithLock(locks(),fake,{now:at});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'STARTUP_READBACK_CHANGED');
  assert.equal('state' in result,false);
  assert.equal(store.writes.length,1);
});

test('P2.49 silent lost write blocks startup publication',async()=>{
  const store=memory();
  const fake={getItem:key=>store.getItem(key),setItem:()=>{}};
  const result=await prepareNormalStartupWithLock(locks(),fake,{now:at});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'SAVE_VERIFY_FAILED');
  assert.equal('state' in result,false);
  assert.deepEqual(store.writes,[]);
});

test('P2.49 ordinary startup does not write to the story namespace',async()=>{
  const story='story-original-bytes',store=memory(null,story);
  const result=await prepareNormalStartupWithLock(locks(),store,{now:at});
  assert.equal(result.ok,true);
  assert.equal(store.read(STORY_SAVE_KEY),story);
  assert.deepEqual(store.writes.map(([key])=>key),[SAVE_KEY]);
});

test('P2.49 invalid clock is rejected without lock or storage reads',async()=>{
  let touched=false;
  const lock={request(){touched=true;throw Error('unexpected');}};
  const result=await prepareNormalStartupWithLock(lock,null,{now:NaN});
  assert.deepEqual(result,{ok:false,blocked:true,reason:'INVALID_CLOCK',attempted:false});
  assert.equal(touched,false);
});

test('P2.65ad revoked startup permission before lock callback makes no reads or writes',async()=>{
  const store=memory(),before=store.writes.length;
  const result=await prepareNormalStartupWithLock(locks(),store,{
    now:at,canStart:()=>false
  });
  assert.deepEqual(result,{ok:false,blocked:true,
    reason:'STARTUP_INVALIDATED',attempted:false});
  assert.equal(store.writes.length,before);
  assert.equal(store.read(SAVE_KEY),null);
});

test('P2.65ad synchronous pagehide during startup read cannot create a save',async()=>{
  const store=memory();let allowed=true,reads=0;
  const guarded={
    getItem(key){reads++;const value=store.getItem(key);allowed=false;return value;},
    setItem:(key,value)=>store.setItem(key,value)
  };
  const result=await prepareNormalStartupWithLock(locks(),guarded,{
    now:at,canStart:()=>allowed
  });
  assert.equal(result.ok,false);
  assert.equal(result.reason,'STARTUP_INVALIDATED');
  assert.equal(reads,1);
  assert.deepEqual(store.writes,[]);
});
