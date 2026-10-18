import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineCommandQueue, queueStorageKey } from '../merge/cloud/offline-queue.mjs';
import { formatCloudSyncStatus } from '../merge/cloud/sync-view.mjs';
import { createInMemoryAuthority } from '../merge/cloud/authority.mjs';
import { validateSave } from '../merge/engine.mjs';

const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function store() {
  const values = new Map();
  return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
}
function idGenerator() {let n=0;return ()=>`00000000-0000-4000-8000-${(++n).toString(16).padStart(12,'0')}`;}
function setup({storage=store(), clock=()=>1_000_000, transport=null, makeId=idGenerator()}={}) {
  const authority=createInMemoryAuthority({clock,rng:()=>0.9});
  const adapter=transport??{read:()=>authority.read(uid),execute:c=>authority.execute(uid,c)};
  const queue=createOfflineCommandQueue({uid,storage,transport:adapter,clock,makeId});
  return {authority,queue,storage,adapter};
}
const move = {type:'move',from:0,to:2};
const producer = {type:'produce',slot:42};

test('offline journal stores only commands, never client-reported money or snapshots',async()=>{
  const {queue,storage}=setup();
  assert.equal(queue.enqueue({...producer,coins:900000}).code,'BAD_COMMAND');
  assert.equal(queue.enqueue(producer).ok,true);
  const parsed=JSON.parse(storage.getItem(queueStorageKey(uid)));
  assert.equal(parsed.pending[0].action.coins,undefined);
  assert.equal(parsed.pending[0].expectedRevision,null);
  assert.equal(parsed.confirmed,null);
  assert.equal(queue.preview().verified,false);
});

test('queue flushes serially and pins each new command to latest confirmed revision',async()=>{
  const {queue,authority}=setup();
  queue.enqueue(move);
  queue.enqueue(producer);
  const result=await queue.flush();
  assert.equal(result.ok,true);
  assert.equal(result.revision,2);
  assert.equal(result.pending,0);
  assert.equal(queue.preview().verified,true);
  assert.equal((await authority.read(uid)).state.energy,79);
});

test('unknown network outcome replays same stable operation ID and spends energy exactly once',async()=>{
  const authority=createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});
  let sends=0;const commands=[];
  const transport={read:()=>authority.read(uid),execute:async cmd=>{
    sends++;commands.push(structuredClone(cmd));const result=await authority.execute(uid,cmd);
    if(sends===1)throw Error('HTTP connection dropped after commit');
    return result;
  }};
  const {queue}=setup({transport});
  queue.enqueue(producer);
  const failed=await queue.flush();
  assert.equal(failed.code,'NETWORK_UNAVAILABLE');
  assert.equal(failed.pending,1);
  const recovered=await queue.flush({force:true});
  assert.equal(recovered.ok,true);
  assert.equal(recovered.revision,1);
  assert.deepEqual(commands[0],commands[1]);
  assert.equal((await authority.read(uid)).state.energy,79);
});

test('retry delay is bounded and respects stored backoff unless user forces retry',async()=>{
  let now=1_000_000;
  let calls=0;
  const {queue}=setup({clock:()=>now,transport:{read:async()=>({ok:true,status:'ok',revision:0,state:(await createInMemoryAuthority({clock:()=>now}).read(uid)).state}),execute:async()=>{calls++;throw Error('offline');}}});
  queue.enqueue(move);
  await queue.flush();
  assert.equal(calls,1);
  assert.equal((await queue.flush()).code,'RETRY_LATER');
  assert.equal(calls,1);
  now+=1_500;
  assert.equal((await queue.flush()).code,'NETWORK_UNAVAILABLE');
  assert.equal(calls,2);
});

test('conflict never auto-rebases an earlier pinned command over newer device progress',async()=>{
  const authority=createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});
  let drop=true;
  const transport={read:()=>authority.read(uid),execute:async c=>{if(drop){drop=false;throw Error('offline before arrival');}return authority.execute(uid,c);}};
  const {queue}=setup({transport});
  queue.enqueue(move);queue.enqueue(producer);
  await queue.flush();
  // Another device moves the same item before this device can retry.
  await authority.execute(uid,{operationId:'ffffffff-ffff-4fff-8fff-ffffffffffff',expectedRevision:0,action:{type:'move',from:0,to:7}});
  const result=await queue.flush({force:true});
  assert.equal(result.code,'REVISION_CONFLICT');
  assert.equal(result.blocked,'conflict');
  assert.equal(result.pending,2);
  assert.equal(queue.preview().state.board[7]?.tier,1);
  assert.equal((await queue.flush({force:true})).code,'ACTION_NEEDS_REVIEW');
  assert.equal(queue.discardConflicted().code,'CONFIRMATION_REQUIRED');
  assert.equal(queue.discardConflicted({confirmedByUser:true}).ok,true);
  assert.equal(queue.preview().pending,0);
  assert.equal((await authority.read(uid)).revision,1);
});

test('restart restores pending journal with unchanged ID and pinned revision',async()=>{
  const storage=store();const authority=createInMemoryAuthority({clock:()=>1_000_000});
  let count=0;const trans={read:()=>authority.read(uid),execute:async c=>{count++;if(count===1)throw Error('offline');return authority.execute(uid,c);}};
  const first=setup({storage,transport:trans,makeId:idGenerator()}).queue;
  const queued=first.enqueue(move);
  await first.flush();
  const second=setup({storage,transport:trans,makeId:idGenerator()}).queue;
  assert.equal(second.preview().firstOperationId,queued.operationId);
  assert.equal(second.preview().pending,1);
  const result=await second.flush({force:true});
  assert.equal(result.ok,true);
  assert.equal(result.revision,1);
});

test('storage refusal stops queueing or transmitting ambiguous money-changing commands',async()=>{
  const base=store();let broken=true;
  const failing={getItem:base.getItem,setItem:(k,v)=>{if(broken)throw Error('quota');base.setItem(k,v);}};
  const {queue}=setup({storage:failing});
  assert.equal(queue.enqueue(producer).code,'STORAGE_ERROR');
  assert.equal((await queue.flush()).code,'STORAGE_ERROR');
  broken=false;
});

test('corrupted or tampered saved journal does not silently reset to an empty queue',async()=>{
  const storage=store();storage.setItem(queueStorageKey(uid),'not-json');
  const {queue}=setup({storage});
  assert.equal(queue.enqueue(producer).code,'STORAGE_ERROR');
  assert.equal(storage.getItem(queueStorageKey(uid)),'not-json');
});

test('account-scoped queues prevent cross-user browser storage bleed',()=>{
  const storage=store();const {queue}=setup({storage});queue.enqueue(move);
  const peer=createOfflineCommandQueue({uid:other,storage,makeId:idGenerator(),transport:{read:async()=>null,execute:async()=>null}});
  assert.equal(peer.preview().pending,0);
  assert.notEqual(queueStorageKey(uid),queueStorageKey(other));
});

test('cannot discard possibly-sent operation until server has definitively resolved it',async()=>{
  const {queue}=setup({transport:{read:async()=>{throw Error('offline')},execute:async()=>null}});
  queue.enqueue(move);
  assert.equal(queue.discardUnsent().ok,true);
  queue.enqueue(move);
  assert.equal((await queue.flush()).code,'NETWORK_UNAVAILABLE');
  // Read failure occurs before transmit: conservative rule still permits dropping unpinned commands.
  assert.equal(queue.discardUnsent().ok,true);
});

test('sync status wording distinguishes confirmed from cached, offline, and conflict',()=>{
  assert.match(formatCloudSyncStatus({phase:'synced',verified:true,revision:7,pending:0}).title,/已确认/);
  assert.match(formatCloudSyncStatus({phase:'offline',pending:2}).detail,/未确认/);
  assert.match(formatCloudSyncStatus({phase:'blocked',blocked:'conflict',pending:2}).title,/其他设备/);
  assert.match(formatCloudSyncStatus({phase:'unverified',verified:false,pending:0}).detail,/尚未/);
});

test('transport must never claim success with invalid or stale server snapshot',async()=>{
  const authority=createInMemoryAuthority({clock:()=>1_000_000});
  const transport={read:()=>authority.read(uid),execute:async()=>({status:'applied',ok:true,revision:999,state:{wallet:{coins:100000}}})};
  const {queue}=setup({transport});
  queue.enqueue(move);
  assert.equal((await queue.flush()).code,'INVALID_RESPONSE');
  assert.equal(queue.preview().blocked,'protocol-error');
});

test('concurrent flush calls share a single send rather than racing commands',async()=>{
  const authority=createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});
  let sends=0;
  const transport={read:()=>authority.read(uid),execute:async c=>{sends++;await Promise.resolve();return authority.execute(uid,c)}};
  const {queue}=setup({transport});queue.enqueue(producer);
  const [a,b]=await Promise.all([queue.flush(),queue.flush()]);
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  assert.equal(sends,1);
  assert.equal((await authority.read(uid)).state.energy,79);
});

test('no later queued action is sent after definitive server rejection',async()=>{
  const authority=createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});
  let sends=0;const transport={read:()=>authority.read(uid),execute:async c=>{sends++;return authority.execute(uid,c)}};
  const {queue}=setup({transport});
  queue.enqueue({type:'upgradeBuilding',buildingId:'harbor'});queue.enqueue(move);
  const result=await queue.flush();
  assert.equal(result.ok,false);
  assert.equal(result.blocked,'rejected');
  assert.equal(result.pending,2);
  assert.equal(sends,1);
  assert.equal(queue.discardConflicted({confirmedByUser:true}).ok,true);
  assert.equal((await authority.read(uid)).revision,0);
});

test('source client cannot mutate a returned preview to change stored wallet',async()=>{
  const {queue}=setup();
  await queue.connect();
  const snap=queue.preview();
  assert.ok(validateSave(snap.state));
  snap.state.coins=987654;
  assert.equal(queue.preview().state.coins,0);
});

test('two account-scoped journals preserve their own queued actions after reconstruction',()=>{
  const storage=store();
  const one=setup({storage}).queue;one.enqueue(move);
  const second=createOfflineCommandQueue({uid:other,storage,makeId:idGenerator(),transport:{read:async()=>null,execute:async()=>null}});
  second.enqueue(producer);
  const oneAgain=setup({storage}).queue;
  assert.equal(oneAgain.preview().pending,1);
  assert.equal(second.preview().pending,1);
  assert.notEqual(queueStorageKey(uid),queueStorageKey(other));
});

test('lost acknowledgment followed by a second-device action resolves as replay of latest remote state',async()=>{
  const authority=createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});
  let first=true;
  const transport={read:()=>authority.read(uid),execute:async c=>{
    const result=await authority.execute(uid,c);
    if (first) {first=false;throw Error('lost acknowledgment');}
    return result;
  }};
  const {queue}=setup({transport});
  queue.enqueue(producer);
  assert.equal((await queue.flush()).code,'NETWORK_UNAVAILABLE');
  // Other device receives revision 1 and completes an independent legitimate action.
  const second=await authority.execute(uid,{operationId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',expectedRevision:1,action:move});
  assert.equal(second.status,'applied');
  const result=await queue.flush({force:true});
  assert.equal(result.ok,true);
  assert.equal(result.revision,2);
  assert.equal(result.pending,0);
  assert.deepEqual(queue.preview().state,(await authority.read(uid)).state);
  assert.equal((await authority.read(uid)).state.energy,79);
});

test('persisted unknown transmission cannot be manually erased without replay confirmation',async()=>{
  const authority=createInMemoryAuthority({clock:()=>1_000_000});
  const t={read:()=>authority.read(uid),execute:async()=>{throw Error('ambiguous disconnect')}};
  const {queue}=setup({transport:t});
  queue.enqueue(move);
  await queue.flush();
  assert.equal(queue.discardUnsent().code,'OUTCOME_MAY_BE_UNKNOWN');
  assert.equal(queue.preview().pending,1);
});

test('cloud status does not imply a verified remote read from a cached journal',async()=>{
  const storage=store(),backend=createInMemoryAuthority({clock:()=>1_000_000});
  const online=setup({storage,transport:{read:()=>backend.read(uid),execute:c=>backend.execute(uid,c)}}).queue;
  await online.connect();
  assert.equal(online.preview().verified,true);
  const restarted=setup({storage,transport:{read:async()=>{throw Error('offline')},execute:async()=>null}}).queue;
  assert.equal(restarted.preview().verified,false);
  assert.equal((await restarted.connect()).code,'NETWORK_UNAVAILABLE');
  assert.equal(restarted.preview().verified,false);
});