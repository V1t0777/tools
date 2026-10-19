import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineCommandQueue, queueStorageKey} from '../merge/cloud/offline-queue.mjs';
import {createInMemoryAuthority} from '../merge/cloud/authority.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key=queueStorageKey(uid);
const produce={type:'produce',slot:42};
const clock=()=>1_000_000;
function durableStore() {
  const values=new Map();
  let denyWrites=false, writeCount=0, denyAt=0;
  return {
    storage:{
      getItem:k=>values.get(k)??null,
      setItem:(k,v)=>{
        writeCount++;
        if(denyWrites || (denyAt !== 0 && writeCount === denyAt)) throw Error('quota exceeded');
        values.set(k,v);
      }
    },
    read:()=>JSON.parse(values.get(key)),
    raw:()=>values.get(key),
    overwrite:s=>values.set(key,s),
    deny:on=>{denyWrites=on},
    failOnWrite:n=>{denyAt=n},
    get writes(){return writeCount}
  };
}
function makeQueue(storage, transport, seed=1, getNow=clock) {
  let serial=seed;
  return createOfflineCommandQueue({uid,storage,transport,clock:getNow,
    makeId:()=>`00000000-0000-4000-8000-${(serial++).toString(16).padStart(12,'0')}`});
}
const makeAuthority=()=>createInMemoryAuthority({clock,rng:()=>0.9});

test('server commit then acknowledgment storage failure is replayed after restart, without double reward',async()=>{
  const durable=durableStore(),authority=makeAuthority(),sent=[];
  const transport={
    read:()=>authority.read(uid),
    execute:async command=>{
      sent.push(structuredClone(command));
      const result=await authority.execute(uid,command);
      durable.deny(true); // Browser storage becomes unavailable after server commit.
      return result;
    }
  };
  const tab=makeQueue(durable.storage,transport);
  const op=tab.enqueue(produce);
  assert.equal(op.ok,true);
  const result=await tab.flush();
  assert.equal(result.code,'STORAGE_ERROR');
  assert.equal(result.phase,'storage-error');
  assert.equal(durable.read().pending.length,1);
  assert.equal(durable.read().pending[0].operationId,op.operationId);
  assert.equal(durable.read().pending[0].expectedRevision,0);
  assert.equal(durable.read().pending[0].attempts,1);
  assert.equal((await authority.read(uid)).revision,1);
  durable.deny(false);
  const retry=makeQueue(durable.storage,{
    read:()=>authority.read(uid),
    execute:async command=>{sent.push(structuredClone(command));return authority.execute(uid,command);}
  },500);
  assert.equal(retry.preview().verified,false);
  assert.equal((await retry.flush()).ok,true);
  assert.equal(retry.preview().pending,0);
  assert.deepEqual(sent[0],sent[1], 'reboot must use identical operationId and pinned revision');
  assert.equal((await authority.read(uid)).state.energy,79);
  assert.equal((await authority.read(uid)).revision,1);
});

test('network unknown plus retry-backoff write denial reports STORAGE_ERROR, retaining original attempt',async()=>{
  const durable=durableStore(),authority=makeAuthority(),sent=[];
  const tab=makeQueue(durable.storage,{
    read:()=>authority.read(uid),
    execute:async command=>{
      sent.push(structuredClone(command));
      await authority.execute(uid,command);
      durable.deny(true); // The retry metadata write must not silently fail.
      throw Error('lost acknowledgment');
    }
  });
  const queued=tab.enqueue(produce);
  const failed=await tab.flush();
  assert.equal(failed.code,'STORAGE_ERROR');
  assert.equal(failed.phase,'storage-error');
  assert.equal(durable.read().pending[0].operationId,queued.operationId);
  assert.equal(durable.read().pending[0].expectedRevision,0);
  assert.equal(durable.read().pending[0].attempts,1);
  assert.equal(durable.read().pending[0].nextRetryAt,0);
  durable.deny(false);
  const recovered=makeQueue(durable.storage,{
    read:()=>authority.read(uid),
    execute:async command=>{sent.push(structuredClone(command));return authority.execute(uid,command);}
  },900);
  assert.equal((await recovered.flush()).ok,true);
  assert.deepEqual(sent[0],sent[1]);
  assert.equal((await authority.read(uid)).revision,1);
  assert.equal((await authority.read(uid)).state.energy,79);
});

test('failed durable attempt marker prevents any network send before a restart',async()=>{
  const durable=durableStore(),authority=makeAuthority(),sent=[];
  // Writes: enqueue, authoritative read cache, revision pin, send-attempt marker.
  durable.failOnWrite(4);
  const transport={read:()=>authority.read(uid),
    execute:async command=>{sent.push(structuredClone(command));return authority.execute(uid,command);}};
  const tab=makeQueue(durable.storage,transport);
  const op=tab.enqueue(produce);
  const failed=await tab.flush();
  assert.equal(failed.code,'STORAGE_ERROR');
  assert.equal(sent.length,0,'unpersisted send attempts must never reach the server');
  assert.equal((await authority.read(uid)).revision,0);
  assert.equal(durable.read().pending[0].operationId,op.operationId);
  assert.equal(durable.read().pending[0].expectedRevision,0);
  assert.equal(durable.read().pending[0].attempts,0);
  const reboot=makeQueue(durable.storage,transport,700);
  assert.equal((await reboot.flush()).ok,true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].operationId,op.operationId);
  assert.equal((await authority.read(uid)).state.energy,79);
});

test('failed first acknowledgment cannot send dependent second command until recovery',async()=>{
  const durable=durableStore(),authority=makeAuthority(),sent=[];
  let faultOnce=true;
  const transport={read:()=>authority.read(uid),execute:async command=>{
    sent.push(structuredClone(command));
    const reply=await authority.execute(uid,command);
    if(faultOnce){faultOnce=false;durable.deny(true);}
    return reply;
  }};
  const tab=makeQueue(durable.storage,transport);
  const first=tab.enqueue(produce),second=tab.enqueue(produce);
  assert.equal(first.ok,true);assert.equal(second.ok,true);
  assert.equal((await tab.flush()).code,'STORAGE_ERROR');
  assert.equal(sent.length,1);
  assert.equal(durable.read().pending.length,2);
  assert.equal(durable.read().pending[1].attempts,0);
  assert.equal((await authority.read(uid)).revision,1);
  durable.deny(false);
  const reboot=makeQueue(durable.storage,transport,400);
  assert.equal((await reboot.flush()).ok,true);
  assert.equal(sent.length,3);
  assert.deepEqual(sent[0],sent[1]);
  assert.equal(sent[2].operationId,second.operationId);
  assert.equal(sent[2].expectedRevision,1);
  assert.equal((await authority.read(uid)).revision,2);
  assert.equal((await authority.read(uid)).state.energy,78);
});

test('persisted backoff survives restart and force is not needed after the deadline',async()=>{
  let now=1_000_000,first=true;
  const durable=durableStore(),authority=makeAuthority(),sent=[];
  const transport={read:()=>authority.read(uid),execute:async command=>{
    sent.push(structuredClone(command));
    const reply=await authority.execute(uid,command);
    if(first){first=false;throw Error('response lost');}
    return reply;
  }};
  const tab=makeQueue(durable.storage,transport,1,()=>now);
  const queued=tab.enqueue(produce);
  assert.equal((await tab.flush()).code,'NETWORK_UNAVAILABLE');
  assert.equal(durable.read().pending[0].nextRetryAt,1_001_000);
  const reboot=makeQueue(durable.storage,transport,300,()=>now);
  assert.equal((await reboot.flush()).code,'RETRY_LATER');
  assert.equal(sent.length,1);
  assert.equal(reboot.preview().firstOperationId,queued.operationId);
  now=1_001_000;
  assert.equal((await reboot.flush()).ok,true);
  assert.deepEqual(sent[0],sent[1]);
  assert.equal((await authority.read(uid)).state.energy,79);
});

test('multiple restarts and repeated lost acknowledgments keep a single original operation',async()=>{
  const durable=durableStore(),authority=makeAuthority(),sent=[];
  let remainingFailures=3;
  const transport={read:()=>authority.read(uid),execute:async command=>{
    sent.push(structuredClone(command));
    const result=await authority.execute(uid,command);
    if(remainingFailures-->0){durable.deny(true);return result;}
    return result;
  }};
  const first=makeQueue(durable.storage,transport,1);
  const queued=first.enqueue(produce);
  for(let attempt=0;attempt<3;attempt++){
    durable.deny(false);
    const tab=attempt===0?first:makeQueue(durable.storage,transport,200+attempt);
    assert.equal((await tab.flush({force:true})).code,'STORAGE_ERROR');
    assert.equal(durable.read().pending[0].operationId,queued.operationId);
    assert.equal((await authority.read(uid)).revision,1);
  }
  durable.deny(false);
  const last=makeQueue(durable.storage,transport,800);
  assert.equal((await last.flush({force:true})).ok,true);
  assert.equal(last.preview().pending,0);
  assert.equal(sent.length,4);
  assert.ok(sent.every(command=>command.operationId===queued.operationId));
  assert.ok(sent.every(command=>command.expectedRevision===0));
  assert.equal((await authority.read(uid)).state.energy,79);
  assert.equal((await authority.read(uid)).revision,1);
});

test('corrupted pending journal after an ambiguous send fails closed across restarts',async()=>{
  const durable=durableStore(),authority=makeAuthority();
  let sends=0,reads=0;
  const transport={read:()=>{reads++;return authority.read(uid)},execute:async command=>{
    sends++;await authority.execute(uid,command);throw Error('lost response');
  }};
  const tab=makeQueue(durable.storage,transport);
  const id=tab.enqueue(produce).operationId;
  assert.equal((await tab.flush()).code,'NETWORK_UNAVAILABLE');
  assert.equal(durable.read().pending[0].operationId,id);
  durable.overwrite('{\"pending\":'); // Simulate interrupted / corrupted journal.
  const corrupted=durable.raw();
  const reboot=makeQueue(durable.storage,transport,100);
  const calls={sends,reads};
  assert.equal(reboot.preview().phase,'storage-error');
  assert.equal((await reboot.flush({force:true})).code,'STORAGE_ERROR');
  assert.equal((await reboot.connect()).code,'STORAGE_ERROR');
  assert.equal(reboot.enqueue(produce).code,'STORAGE_ERROR');
  assert.equal(reboot.preview().pending,0);
  assert.equal(durable.raw(),corrupted);
  assert.equal(sends,calls.sends);
  assert.equal(reads,calls.reads);
  assert.equal((await authority.read(uid)).state.energy,79);
});
