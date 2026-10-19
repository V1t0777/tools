import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineCommandQueue, queueStorageKey} from '../merge/cloud/offline-queue.mjs';
import {createInMemoryAuthority} from '../merge/cloud/authority.mjs';
import {formatCloudSyncStatus} from '../merge/cloud/sync-view.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key=queueStorageKey(uid);
const produce={type:'produce',slot:42};
const now=()=>1_000_000;
function memory(raw=null) {
  const values=new Map();
  if(raw!==null) values.set(key,raw);
  return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),
    raw:()=>values.get(key), overwrite:raw=>values.set(key,raw)};
}
function idSource(seed=1){
  let serial=seed;
  return ()=>`abcdabcd-abcd-4abc-8abc-${(serial++).toString(16).padStart(12,'0')}`;
}
function makeQueue(storage,transport={},seed=1) {
  return createOfflineCommandQueue({uid,storage,clock:now,makeId:idSource(seed),
    transport:{read:transport.read??(async()=>{throw Error('no remote read expected')}),
      execute:transport.execute??(async()=>{throw Error('no remote write expected')})}});
}
function pendingJournal(length=2) {
  const storage=memory(),queue=makeQueue(storage);
  for(let n=0;n<length;n++)assert.equal(queue.enqueue(produce).ok,true);
  return {storage,parsed:JSON.parse(storage.raw())};
}
async function assertFailsClosed(storage) {
  const original=storage.raw();
  let reads=0,sends=0;
  const transport={read:async()=>{reads++;throw Error('should not read')},
    execute:async()=>{sends++;throw Error('should not send')}};
  const queue=makeQueue(storage,transport,200);
  assert.equal(queue.preview().phase,'storage-error');
  assert.equal(queue.preview().verified,false);
  assert.equal(queue.enqueue(produce).code,'STORAGE_ERROR');
  assert.equal((await queue.connect()).code,'STORAGE_ERROR');
  assert.equal((await queue.flush({force:true})).code,'STORAGE_ERROR');
  assert.equal(queue.preview().pending,0,'do not infer count from damaged journal');
  assert.equal(reads,0);assert.equal(sends,0);
  assert.equal(storage.raw(),original,'preserve every original byte');
  assert.equal(formatCloudSyncStatus(queue.preview()).tone,'danger');
}

test('missing key is a fresh journal, but an existing empty string fails closed',async()=>{
  const missing=memory(),fresh=makeQueue(missing);
  assert.equal(fresh.preview().phase,'unverified');
  assert.equal(fresh.enqueue(produce).ok,true);
  assert.equal(JSON.parse(missing.raw()).pending.length,1);
  await assertFailsClosed(memory(''));
});

test('non-string value returned by a faulty storage shim is never treated as absence',()=>{
  let writes=0;
  const storage={getItem:()=>undefined,setItem:()=>{writes++}};
  const queue=makeQueue(storage);
  assert.equal(queue.preview().phase,'storage-error');
  assert.equal(queue.enqueue(produce).code,'STORAGE_ERROR');
  assert.equal(writes,0);
});

test('UUID operation IDs are deduplicated case-insensitively before a server call',async()=>{
  const {storage,parsed}=pendingJournal();
  const first=parsed.pending[0].operationId;
  parsed.pending[1].operationId=first.toUpperCase();
  storage.overwrite(JSON.stringify(parsed));
  assert.notEqual(first,parsed.pending[1].operationId);
  await assertFailsClosed(storage);
});

for(const [name,mutate] of [
  ['pinned unsent tail',journal=>{journal.pending[1].expectedRevision=0;}],
  ['attempted later command',journal=>{
    journal.pending[1].expectedRevision=0;journal.pending[1].attempts=1;
  }],
  ['backoff attached to an unsent tail',journal=>{journal.pending[1].nextRetryAt=1_001_000;}],
  ['unearned retry deadline on the head',journal=>{journal.pending[0].nextRetryAt=1_001_000;}]
]) {
  test(`impossible journal state (${name}) does not discard or transmit queued operations`,async()=>{
    const {storage,parsed}=pendingJournal();
    mutate(parsed);storage.overwrite(JSON.stringify(parsed));
    await assertFailsClosed(storage);
  });
}

test('pending command cannot be pinned without a confirmed server snapshot',async()=>{
  const {storage,parsed}=pendingJournal(1);
  assert.equal(parsed.confirmed,null);
  parsed.pending[0].expectedRevision=0;
  storage.overwrite(JSON.stringify(parsed));
  await assertFailsClosed(storage);
});

test('blocked journal must still contain the original unresolved operation',async()=>{
  const {storage,parsed}=pendingJournal(1);
  parsed.pending=[];
  parsed.blocked='conflict';
  storage.overwrite(JSON.stringify(parsed));
  await assertFailsClosed(storage);
});

test('legitimate ambiguous head and unsent tail survive restart and resolve exactly once',async()=>{
  const storage=memory();
  const authority=createInMemoryAuthority({clock:now,rng:()=>0.9});
  const sent=[];let drop=true;
  const transport={read:()=>authority.read(uid),execute:async command=>{
    sent.push(structuredClone(command));
    const result=await authority.execute(uid,command);
    if(drop){drop=false;throw Error('acknowledgement lost after commit');}
    return result;
  }};
  const first=makeQueue(storage,transport);
  const head=first.enqueue(produce);
  const tail=first.enqueue(produce);
  assert.equal(head.ok,true);assert.equal(tail.ok,true);
  assert.equal((await first.flush()).code,'NETWORK_UNAVAILABLE');
  const persisted=JSON.parse(storage.raw());
  assert.equal(persisted.pending.length,2);
  assert.equal(persisted.pending[0].attempts,1);
  assert.equal(persisted.pending[0].expectedRevision,0);
  assert.equal(persisted.pending[1].attempts,0);
  assert.equal(persisted.pending[1].expectedRevision,null);
  assert.equal((await authority.read(uid)).revision,1);
  const restored=makeQueue(storage,transport,100);
  assert.equal(restored.preview().phase,'unverified');
  assert.equal(restored.preview().pending,2);
  assert.equal(restored.preview().attemptedPending,1);
  assert.equal((await restored.flush({force:true})).ok,true);
  assert.equal(restored.preview().pending,0);
  assert.equal((await authority.read(uid)).revision,2);
  assert.equal((await authority.read(uid)).state.energy,78);
  assert.deepEqual(sent[0],sent[1], 'uncertain head replays the identical operation');
  assert.equal(sent[2].operationId,tail.operationId);
  assert.equal(sent[2].expectedRevision,1);
});

test('definitive conflict remains readable after restart and cannot silently replay',async()=>{
  const storage=memory(),authority=createInMemoryAuthority({clock:now,rng:()=>0.9});
  let drop=true,sendCount=0;
  const transport={read:()=>authority.read(uid),execute:async command=>{
    sendCount++;
    if(drop){drop=false;throw Error('disconnected before transmission');}
    return authority.execute(uid,command);
  }};
  const original=makeQueue(storage,transport);
  const id=original.enqueue({type:'move',from:0,to:2}).operationId;
  assert.equal((await original.flush()).code,'NETWORK_UNAVAILABLE');
  assert.equal((await authority.execute(uid,{
    operationId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    expectedRevision:0,action:{type:'move',from:0,to:7}
  })).status,'applied');
  assert.equal((await original.flush({force:true})).code,'REVISION_CONFLICT');
  const reloaded=makeQueue(storage,transport,100);
  assert.equal(reloaded.preview().blocked,'conflict');
  assert.equal(reloaded.preview().firstOperationId,id);
  assert.equal((await reloaded.flush({force:true})).code,'ACTION_NEEDS_REVIEW');
  assert.equal(sendCount,2,'no extra execute before explicit review');
});
