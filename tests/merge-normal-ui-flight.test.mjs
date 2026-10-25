import test from 'node:test';
import assert from 'node:assert/strict';
import {createNormalUiFlight} from '../merge/normal-ui-flight.mjs';

const verified=(state={revision:1})=>({ok:true,state,raw:'exact-save',
  verifiedReadback:true});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});
  return {promise,resolve};};

test('P2.50 publishes verified save only after awaited transaction completes',async()=>{
  const gate=createNormalUiFlight(),wait=deferred(),seen=[];
  const pending=gate.run(()=>wait.promise,(state,raw)=>seen.push([state,raw]));
  assert.equal(gate.busy,true);
  assert.deepEqual(seen,[]);
  wait.resolve(verified());
  assert.deepEqual(await pending,{ok:true,status:'UI_PUBLISHED'});
  assert.deepEqual(seen,[[{revision:1},'exact-save']]);
  assert.equal(gate.busy,false);
});

test('P2.50 repeated clicks are rejected without invoking a second action',async()=>{
  const gate=createNormalUiFlight(),wait=deferred();
  let invoked=0;
  const first=gate.run(()=>{invoked++;return wait.promise;},()=>{});
  assert.deepEqual(await gate.run(()=>{invoked++;return verified();},()=>{}),
    {ok:false,reason:'UI_TRANSACTION_BUSY'});
  assert.equal(invoked,1);
  wait.resolve(verified());
  await first;
  assert.equal((await gate.run(()=>verified(),()=>{})).ok,true);
});

test('P2.50 storage conflict invalidates pending save receipt without publishing',async()=>{
  const gate=createNormalUiFlight(),wait=deferred();
  let published=0;
  const pending=gate.run(()=>wait.promise,()=>published++);
  gate.invalidate();
  wait.resolve(verified());
  assert.deepEqual(await pending,{ok:false,reason:'UI_TRANSACTION_INVALIDATED'});
  assert.equal(published,0);
  assert.equal(gate.busy,false);
});

test('P2.50 rejected or throwing transactions cannot publish state',async()=>{
  const gate=createNormalUiFlight();
  let published=0;
  assert.deepEqual(await gate.run(()=>({ok:false,reason:'STALE_BASELINE'}),
    ()=>published++),{ok:false,reason:'STALE_BASELINE'});
  assert.deepEqual(await gate.run(()=>{throw Error('storage');},
    ()=>published++),{ok:false,reason:'UI_TRANSACTION_FAILED'});
  assert.equal(published,0);
  assert.equal(gate.busy,false);
});

test('P2.50 unverified, malformed and absent receipts cannot publish',async()=>{
  const gate=createNormalUiFlight();
  let published=0;
  for(const result of [null,{ok:true},{ok:true,state:{revision:1},raw:'bytes'},
    {ok:true,state:{revision:1},raw:123,verifiedReadback:true}]) {
    const response=await gate.run(()=>result,()=>published++);
    assert.equal(response.ok,false);
  }
  assert.equal(published,0);
});

test('P2.50 unchanged clock and verified startup receipts are publishable',async()=>{
  const gate=createNormalUiFlight();
  let published=0;
  assert.equal((await gate.run(()=>({ok:true,state:{},raw:'old',
    changed:false,status:'CLOCK_UNCHANGED'}),()=>published++)).ok,true);
  assert.equal((await gate.run(()=>({ok:true,state:{},raw:'new',
    verifiedBaseline:true}),()=>published++)).ok,true);
  assert.equal(published,2);
});

test('P2.50 publish exceptions release busy gate for recovery',async()=>{
  const gate=createNormalUiFlight();
  assert.deepEqual(await gate.run(()=>verified(),()=>{throw Error('render');}),
    {ok:false,reason:'UI_PUBLISH_FAILED'});
  assert.equal(gate.busy,false);
  assert.equal((await gate.run(()=>verified(),()=>{})).ok,true);
});

test('P2.50 invalid arguments cannot start or occupy a flight',async()=>{
  const gate=createNormalUiFlight();
  assert.deepEqual(await gate.run(null,()=>{}),
    {ok:false,reason:'INVALID_UI_TRANSACTION'});
  assert.deepEqual(await gate.run(()=>verified(),null),
    {ok:false,reason:'INVALID_UI_TRANSACTION'});
  assert.equal(gate.busy,false);
});

test('P2.51 permanent block rejects new operations without executing transaction',async()=>{
  const gate=createNormalUiFlight();
  let called=0,published=0;
  assert.equal(gate.blocked,false);
  gate.block();
  assert.equal(gate.blocked,true);
  assert.deepEqual(await gate.run(()=>{called++;return verified();},()=>published++),
    {ok:false,reason:'UI_SAVE_BLOCKED'});
  assert.equal(called,0);
  assert.equal(published,0);
  assert.equal(gate.busy,false);
});

test('P2.51 block during in-flight write prevents stale result publication',async()=>{
  const gate=createNormalUiFlight(),wait=deferred();
  let published=0,called=0;
  const pending=gate.run(()=>{called++;return wait.promise;},()=>published++);
  assert.equal(gate.busy,true);
  gate.block();
  assert.equal(gate.blocked,true);
  assert.deepEqual(await gate.run(()=>{called++;return verified();},()=>published++),
    {ok:false,reason:'UI_SAVE_BLOCKED'});
  wait.resolve(verified());
  assert.deepEqual(await pending,{ok:false,reason:'UI_SAVE_BLOCKED'});
  assert.equal(gate.busy,false);
  assert.equal(published,0);
  assert.equal(called,1);
});

test('P2.51 repeated block and transient invalidate cannot reopen blocked gate',async()=>{
  const gate=createNormalUiFlight();
  gate.block();gate.block();gate.invalidate();
  assert.equal(gate.blocked,true);
  assert.deepEqual(await gate.run(()=>verified(),()=>{}),
    {ok:false,reason:'UI_SAVE_BLOCKED'});
  const fresh=createNormalUiFlight();
  assert.equal(fresh.blocked,false);
  fresh.invalidate();
  assert.equal((await fresh.run(()=>verified(),()=>{})).ok,true);
});
