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

test('P2.52 stale baseline and throwing transactions each fail closed',async()=>{
  const staleGate=createNormalUiFlight(),errorGate=createNormalUiFlight();
  let published=0;
  assert.deepEqual(await staleGate.run(()=>({ok:false,reason:'STALE_BASELINE'}),
    ()=>published++),{ok:false,reason:'STALE_BASELINE'});
  assert.equal(staleGate.blocked,true);
  assert.deepEqual(await errorGate.run(()=>{throw Error('storage');},
    ()=>published++),{ok:false,reason:'UI_TRANSACTION_FAILED'});
  assert.equal(errorGate.blocked,true);
  assert.equal(published,0);
  assert.equal(staleGate.busy,false);
  assert.equal(errorGate.busy,false);
});

test('P2.52 unverified, malformed and absent receipts block further writes',async()=>{
  let published=0;
  for(const result of [null,{ok:true},{ok:true,state:{revision:1},raw:'bytes'},
    {ok:true,state:{revision:1},raw:123,verifiedReadback:true}]) {
    const gate=createNormalUiFlight();
    const response=await gate.run(()=>result,()=>published++);
    assert.equal(response.ok,false);
    assert.equal(gate.blocked,true);
    assert.deepEqual(await gate.run(()=>verified(),()=>published++),
      {ok:false,reason:'UI_SAVE_BLOCKED'});
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

test('P2.52 publish exception blocks new work after a possibly saved state',async()=>{
  const gate=createNormalUiFlight();
  assert.deepEqual(await gate.run(()=>verified(),()=>{throw Error('render');}),
    {ok:false,reason:'UI_PUBLISH_FAILED'});
  assert.equal(gate.busy,false);
  assert.equal(gate.blocked,true);
  assert.deepEqual(await gate.run(()=>verified(),()=>{}),
    {ok:false,reason:'UI_SAVE_BLOCKED'});
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

test('P2.52 stale and uncertain persistence failures block future operations',async()=>{
  for(const reason of ['STALE_BASELINE','SAVE_VERIFY_FAILED',
    'SAVE_REJECTED_OR_UNCERTAIN','SAVE_OUTCOME_UNCERTAIN',
    'SAVE_LOCK_OUTCOME_UNCERTAIN','STARTUP_READBACK_CHANGED',
    'BACKUP_OUTCOME_UNCERTAIN','STORAGE_UNAVAILABLE','UNKNOWN_NEW_FAILURE']) {
    const gate=createNormalUiFlight();
    let published=0;
    assert.deepEqual(await gate.run(()=>({ok:false,reason}),()=>published++),
      {ok:false,reason});
    assert.equal(gate.blocked,true,reason);
    assert.deepEqual(await gate.run(()=>verified(),()=>published++),
      {ok:false,reason:'UI_SAVE_BLOCKED'});
    assert.equal(published,0);
  }
});

test('P2.52 explicitly safe pre-write failures remain retryable',async()=>{
  for(const reason of ['ACTION_REJECTED','SAVE_LOCK_BUSY',
    'WEB_LOCKS_UNAVAILABLE','RESET_NOT_CONFIRMED','INVALID_CLOCK',
    'INVALID_ACTION','ASYNC_ACTION_NOT_ALLOWED','INVALID_BACKUP_POLICY',
    'INVALID_RESET_FLAG']) {
    const gate=createNormalUiFlight();
    assert.deepEqual(await gate.run(()=>({ok:false,reason}),()=>{}),
      {ok:false,reason});
    assert.equal(gate.blocked,false,reason);
    assert.equal((await gate.run(()=>verified(),()=>{})).ok,true);
  }
});

test('P2.52 throwing transaction permanently blocks uncertain write outcome',async()=>{
  const gate=createNormalUiFlight();
  assert.deepEqual(await gate.run(()=>{throw Error('after write');},()=>{}),
    {ok:false,reason:'UI_TRANSACTION_FAILED'});
  assert.equal(gate.busy,false);
  assert.equal(gate.blocked,true);
});

test('P2.53 invalidated in-flight successful write permanently blocks future actions',async()=>{
  const gate=createNormalUiFlight(),wait=deferred();
  let published=0,executed=0;
  const pending=gate.run(()=>{executed++;return wait.promise;},()=>published++);
  gate.invalidate();
  wait.resolve(verified({revision:2}));
  assert.deepEqual(await pending,{ok:false,reason:'UI_TRANSACTION_INVALIDATED'});
  assert.equal(gate.busy,false);
  assert.equal(gate.blocked,true);
  assert.equal(published,0);
  assert.deepEqual(await gate.run(()=>{executed++;return verified();},()=>published++),
    {ok:false,reason:'UI_SAVE_BLOCKED'});
  assert.equal(executed,1);
});

test('P2.53 invalidation during a pending safe rejection also requires revalidation',async()=>{
  const gate=createNormalUiFlight(),wait=deferred();
  let published=0;
  const pending=gate.run(()=>wait.promise,()=>published++);
  gate.invalidate();
  wait.resolve({ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.deepEqual(await pending,{ok:false,reason:'UI_TRANSACTION_INVALIDATED'});
  assert.equal(gate.blocked,true);
  assert.equal(published,0);
});

test('P2.53 idle invalidation remains transient; active invalidation never reopens',async()=>{
  const idle=createNormalUiFlight();
  idle.invalidate();
  assert.equal(idle.blocked,false);
  assert.equal((await idle.run(()=>verified(),()=>{})).ok,true);
  const gate=createNormalUiFlight(),wait=deferred();
  const pending=gate.run(()=>wait.promise,()=>{});
  gate.invalidate();wait.resolve(verified());
  await pending;
  gate.invalidate();
  assert.equal(gate.blocked,true);
  assert.deepEqual(await gate.run(()=>verified(),()=>{}),
    {ok:false,reason:'UI_SAVE_BLOCKED'});
});

test('P2.54 asynchronous publication cannot report success or reopen UI gate',async()=>{
  const gate=createNormalUiFlight();
  let called=0;
  const result=await gate.run(()=>verified(),async()=>{called++;await Promise.resolve();});
  assert.deepEqual(result,{ok:false,reason:'UI_ASYNC_PUBLISH_NOT_ALLOWED'});
  assert.equal(called,1);
  assert.equal(gate.busy,false);
  assert.equal(gate.blocked,true);
  assert.deepEqual(await gate.run(()=>verified(),()=>{}),
    {ok:false,reason:'UI_SAVE_BLOCKED'});
});

test('P2.54 rejecting async publish is observed without unhandled rejection',async()=>{
  const gate=createNormalUiFlight();
  const result=await gate.run(()=>verified(),async()=>{
    await Promise.resolve();
    throw Error('late rendering failure');
  });
  assert.deepEqual(result,{ok:false,reason:'UI_ASYNC_PUBLISH_NOT_ALLOWED'});
  assert.equal(gate.blocked,true);
  await new Promise(resolve=>setImmediate(resolve));
});

test('P2.54 synchronous publication remains compatible',async()=>{
  const gate=createNormalUiFlight(),seen=[];
  const result=await gate.run(()=>verified(),(state,raw)=>{
    seen.push([state.revision,raw]);
  });
  assert.deepEqual(result,{ok:true,status:'UI_PUBLISHED'});
  assert.deepEqual(seen,[[1,'exact-save']]);
  assert.equal(gate.blocked,false);
});
