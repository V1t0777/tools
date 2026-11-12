import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,MAX_ENERGY,ENERGY_REGEN_MS,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';

const now=1000,fail=reason=>({ok:false,reason});
function memory(raw) {
  const data=new Map();
  if(raw!==undefined)data.set(SAVE_KEY,raw);
  return {
    getItem(key){return data.has(key)?data.get(key):null;},
    setItem(key,value){data.set(key,value);},
    read(){return data.get(SAVE_KEY);}
  };
}
function locks() {
  return {request(name,opts,callback) {
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(opts,{mode:'exclusive',ifAvailable:true});
    return Promise.resolve(callback({name,mode:'exclusive'}));
  }};
}
const externalClock=initial=>({...initial,energy:MAX_ENERGY,
  energyAt:now+ENERGY_REGEN_MS});

test('V3.1 reset callback invalidation never reports a completed reset',async()=>{
  const db=memory(JSON.stringify(createInitialState(now)));
  let page;
  page=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:(_state,_raw,kind)=>{if(kind==='reset')page.invalidate();}});
  assert.equal((await page.start({now})).ok,true);
  assert.deepEqual(await page.reset({confirmed:true,now:now+1}),
    fail('RESET_INVALIDATED'));
  assert.equal(page.phase,'blocked');
  assert.equal(page.blocked,true);
  assert.deepEqual(await page.action(s=>moveOrMerge(s,0,2)),
    fail('UI_SAVE_BLOCKED'));
});

test('V3.1 reentrant block during reset publication cannot reopen gameplay',async()=>{
  const db=memory(JSON.stringify(createInitialState(now)));
  let page;
  page=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:(_state,_raw,kind)=>{
      if(kind==='reset')page.block('CURRENT_SAVE_CHANGED');
    }});
  await page.start({now});
  assert.deepEqual(await page.reset({confirmed:true,now:now+1}),
    fail('RESET_INVALIDATED'));
  assert.equal(page.phase,'blocked');
  assert.equal(page.blocked,true);
});

test('V3.1 external reconciliation callback invalidation stays blocked',async()=>{
  const initial={...createInitialState(now),energy:MAX_ENERGY-1};
  const db=memory(JSON.stringify(initial));
  let page;
  page=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:(_state,_raw,kind)=>{if(kind==='external')page.invalidate();}});
  await page.start({now});
  db.setItem(SAVE_KEY,JSON.stringify(externalClock(initial)));
  assert.deepEqual(page.reconcile(),fail('RECONCILE_INVALIDATED'));
  assert.equal(page.phase,'blocked');
  assert.deepEqual(await page.clock({now}),fail('UI_SAVE_BLOCKED'));
});

test('V3.1 reentrant external overwrite never acknowledges stale readback',async()=>{
  const initial={...createInitialState(now),energy:MAX_ENERGY-1};
  const db=memory(JSON.stringify(initial));
  const altered=JSON.stringify({...initial,revision:7});
  const page=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:(_state,_raw,kind)=>{
      if(kind==='external')db.setItem(SAVE_KEY,altered);
    }});
  await page.start({now});
  db.setItem(SAVE_KEY,JSON.stringify(externalClock(initial)));
  assert.deepEqual(page.reconcile(),fail('CURRENT_SAVE_CHANGED'));
  assert.equal(page.phase,'blocked');
  assert.equal(db.read(),altered);
});

test('V3.1 unchanged externally verified clock can still reconcile',async()=>{
  const initial={...createInitialState(now),energy:MAX_ENERGY-1};
  const db=memory(JSON.stringify(initial));
  const page=createNormalPageRuntime({locks:locks(),storage:db});
  await page.start({now});
  db.setItem(SAVE_KEY,JSON.stringify(externalClock(initial)));
  assert.deepEqual(page.reconcile(),{ok:true,changed:true});
  assert.equal(page.phase,'ready');
  assert.equal(page.raw,db.read());
});
