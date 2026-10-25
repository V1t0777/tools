import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,MAX_ENERGY,ENERGY_REGEN_MS} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {commitNormalClockWithLock} from '../merge/normal-action-transaction.mjs';
import {createNormalUiFlight} from '../merge/normal-ui-flight.mjs';

function storage(raw) {
  let value=raw, writes=0;
  return {getItem(key){assert.equal(key,SAVE_KEY);return value;},
    setItem(key,next){assert.equal(key,SAVE_KEY);value=next;writes++;},
    get raw(){return value;},get writes(){return writes;}};
}
function exclusiveLock() {
  let held=false;
  return {request(name,opts,cb){
    assert.equal(opts.mode,'exclusive');
    assert.equal(opts.ifAvailable,true);
    if(held)return Promise.resolve(cb(null));
    held=true;
    return Promise.resolve().then(()=>cb({name,mode:'exclusive'}))
      .finally(()=>{held=false;});
  }};
}
const at=1000;
const initial=()=>createInitialState(at);

test('clock no-op validates trusted save without writing or incrementing revision',async()=>{
  const state=initial(),raw=JSON.stringify(state),store=storage(raw);
  const result=await commitNormalClockWithLock(exclusiveLock(),store,
    {expectedRaw:raw,now:at});
  assert.equal(result.ok,true);
  assert.equal(result.status,'CLOCK_UNCHANGED');
  assert.equal(result.changed,false);
  assert.equal(result.verifiedBaseline,true);
  assert.equal(result.raw,raw);
  assert.equal(result.state.revision,state.revision);
  assert.equal(store.writes,0);
});

test('energy regeneration commits exact readback under exclusive lock',async()=>{
  const state={...initial(),energy:MAX_ENERGY-1,energyAt:at};
  const raw=JSON.stringify(state),store=storage(raw);
  const result=await commitNormalClockWithLock(exclusiveLock(),store,
    {expectedRaw:raw,now:at+ENERGY_REGEN_MS});
  assert.equal(result.ok,true);
  assert.equal(result.changed,true);
  assert.equal(result.verifiedReadback,true);
  assert.equal(result.state.energy,MAX_ENERGY);
  assert.equal(store.writes,1);
  assert.equal(store.raw,result.raw);
  assert.equal(JSON.parse(result.raw).energy,MAX_ENERGY);
});

test('stale or missing trusted baseline cannot cause a timer write',async()=>{
  const raw=JSON.stringify(initial()),store=storage(raw),lock=exclusiveLock();
  assert.deepEqual(await commitNormalClockWithLock(lock,store,{expectedRaw:raw+' ',
    now:at+ENERGY_REGEN_MS}),{ok:false,reason:'STALE_BASELINE'});
  assert.deepEqual(await commitNormalClockWithLock(lock,store,{expectedRaw:null,
    now:at}),{ok:false,reason:'NO_TRUSTED_BASELINE'});
  assert.equal(store.writes,0);
});

test('unsupported Web Locks or occupied lock rejects without fallback writes',async()=>{
  const raw=JSON.stringify(initial()),store=storage(raw);
  assert.deepEqual(await commitNormalClockWithLock(null,store,
    {expectedRaw:raw,now:at}),{ok:false,reason:'WEB_LOCKS_UNAVAILABLE'});
  assert.deepEqual(await commitNormalClockWithLock({
    request:(_name,_options,cb)=>cb(null)},store,
    {expectedRaw:raw,now:at}),{ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.equal(store.writes,0);
});

test('invalid clock and corrupt save do not change existing raw bytes',async()=>{
  const raw=JSON.stringify(initial()),store=storage(raw);
  assert.deepEqual(await commitNormalClockWithLock(exclusiveLock(),store,
    {expectedRaw:raw,now:NaN}),{ok:false,reason:'INVALID_CLOCK'});
  const corrupt=storage('{bad');
  assert.equal((await commitNormalClockWithLock(exclusiveLock(),corrupt,
    {expectedRaw:'{bad',now:at})).ok,false);
  assert.equal(corrupt.raw,'{bad');
  assert.equal(corrupt.writes,0);
  assert.equal(store.writes,0);
});

test('failed exact readback does not publish clock-updated state',async()=>{
  const state={...initial(),energy:MAX_ENERGY-1,energyAt:at};
  const raw=JSON.stringify(state);
  let saved=null;
  const store={getItem(key){assert.equal(key,SAVE_KEY);return saved===null?raw:'tampered';},
    setItem(key,next){assert.equal(key,SAVE_KEY);saved=next;}};
  const result=await commitNormalClockWithLock(exclusiveLock(),store,
    {expectedRaw:raw,now:at+ENERGY_REGEN_MS});
  assert.deepEqual(result,{ok:false,reason:'SAVE_VERIFY_FAILED'});
  assert.ok(saved);
  assert.equal('state' in result,false);
});

test('real unchanged clock receipt passes UI gate only with lock-verified baseline',async()=>{
  const state=initial(),raw=JSON.stringify(state),store=storage(raw);
  const gate=createNormalUiFlight(),seen=[];
  const outcome=await gate.run(
    ()=>commitNormalClockWithLock(exclusiveLock(),store,{expectedRaw:raw,now:at}),
    (next,bytes,receipt)=>seen.push({next,bytes,receipt}));
  assert.deepEqual(outcome,{ok:true,status:'UI_PUBLISHED'});
  assert.equal(seen.length,1);
  assert.deepEqual(seen[0].next,state);
  assert.equal(seen[0].bytes,raw);
  assert.equal(seen[0].receipt.verifiedBaseline,true);
  assert.equal(store.writes,0);
  assert.equal(gate.blocked,false);
});
