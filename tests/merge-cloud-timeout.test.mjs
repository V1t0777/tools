import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeadlineTransport, CloudNetworkTimeoutError } from '../merge/cloud/timeout-transport.mjs';
import { createCoordinatedCloudQueue } from '../merge/cloud/tab-coordinator.mjs';
import { createInMemoryAuthority } from '../merge/cloud/authority.mjs';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const never=()=>new Promise(()=>{});
function memory(){const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};}
function locks(){return {request:(_name,_opt,callback)=>callback()};}

test('read timeout aborts best-effort and is identified as an ambiguous network error',async()=>{
  let signal;
  const transport=createDeadlineTransport({read:({signal:s})=>{signal=s;return never()},execute:()=>never()},
    {readTimeoutMs:100});
  await assert.rejects(transport.read(),e=>e instanceof CloudNetworkTimeoutError&&e.code==='NETWORK_TIMEOUT');
  assert.equal(signal.aborted,true);
});

test('write deadline passes AbortSignal and never rewrites outbound operation',async()=>{
  const action={operationId:'00000000-0000-4000-8000-000000000001',expectedRevision:0,
    action:{type:'produce',slot:42}};
  let submitted,signal;
  const transport=createDeadlineTransport({read:()=>({ok:true}),execute:(cmd,{signal:s})=>{
    submitted=cmd;signal=s;return never();}}, {executeTimeoutMs:100});
  await assert.rejects(transport.execute(action),e=>e.code==='NETWORK_TIMEOUT');
  assert.equal(signal.aborted,true);assert.deepEqual(submitted,action);
});

test('successful read/write calls clear timers and preserve returned data',async()=>{
  let cleared=0;const setTimer=()=>42,clearTimer=()=>cleared++;
  const raw={read:async()=>({ok:true,revision:1}),execute:async c=>({ok:true,id:c.operationId})};
  const tx=createDeadlineTransport(raw,{setTimer,clearTimer});
  assert.deepEqual(await tx.read(),{ok:true,revision:1});
  assert.deepEqual(await tx.execute({operationId:'a'}),{ok:true,id:'a'});
  assert.equal(cleared,2);
});

test('invalid deadlines are rejected rather than silently disabling timeouts',()=>{
  assert.throws(()=>createDeadlineTransport({read:()=>0,execute:()=>0},{readTimeoutMs:0}));
  assert.throws(()=>createDeadlineTransport({read:()=>0,execute:()=>0},{executeTimeoutMs:Infinity}));
  assert.throws(()=>createDeadlineTransport({read:()=>0,execute:()=>0},{executeTimeoutMs:120001}));
});

test('timeout after server commit: replay original operationId while another device already advanced',async()=>{
  const auth=createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});
  let lost=true;let firstId;
  const underlying={read:()=>auth.read(uid),execute:async(cmd)=>{
    if(lost){lost=false;firstId=cmd.operationId;await auth.execute(uid,cmd);return never();}
    assert.equal(cmd.operationId,firstId);return auth.execute(uid,cmd);
  }};
  const tx=createDeadlineTransport(underlying,{executeTimeoutMs:100});
  const q=createCoordinatedCloudQueue({uid,storage:memory(),locks:locks(),transport:tx,
    clock:()=>1_000_000, makeId:()=> '00000000-0000-4000-8000-000000000001'});
  await q.enqueue({type:'produce',slot:42});
  assert.equal((await q.flush()).code,'NETWORK_UNAVAILABLE');
  assert.equal(q.preview().pending,1);
  assert.equal((await auth.read(uid)).revision,1);
  await auth.execute(uid,{operationId:'00000000-0000-4000-8000-000000000002',expectedRevision:1,
    action:{type:'move',from:0,to:2}});
  assert.equal((await auth.read(uid)).revision,2);
  const retried=await q.flush({force:true});
  assert.equal(retried.ok,true);assert.equal(retried.revision,2);
  assert.equal(q.preview().pending,0);
  assert.equal((await auth.read(uid)).revision,2);
});

test('an in-flight timeout never allows user to delete a possibly committed command',async()=>{
  const auth=createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});
  const tx=createDeadlineTransport({read:()=>auth.read(uid),execute:()=>never()},
    {executeTimeoutMs:100});
  const q=createCoordinatedCloudQueue({uid,storage:memory(),locks:locks(),transport:tx,
    makeId:()=> '00000000-0000-4000-8000-000000000001'});
  await q.enqueue({type:'produce',slot:42});
  await q.flush();
  assert.equal((await q.discardUnsent()).code,'OUTCOME_MAY_BE_UNKNOWN');
});