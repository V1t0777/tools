import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineCommandQueue,queueStorageKey} from '../merge/cloud/offline-queue.mjs';
import {createCoordinatedCloudQueue} from '../merge/cloud/tab-coordinator.mjs';
import {createInMemoryAuthority} from '../merge/cloud/authority.mjs';
import {formatCloudSyncStatus} from '../merge/cloud/sync-view.mjs';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const makeId=()=>{let n=0;return ()=>`00000000-0000-4000-8000-${(++n).toString(16).padStart(12,'0')}`};
const move={type:'move',from:0,to:2};
const remoteMove={type:'move',from:0,to:7};
const freshMove={type:'move',from:1,to:6};
const otherCommand={operationId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',expectedRevision:0,action:remoteMove};
function setup({tail=false,locks=null}={}) {
  const data=new Map();const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  const authority=createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});
  let drop=true,sendCount=0,readCount=0,offline=false;
  const transport={
    read:()=>{readCount++;if(offline)throw Error('offline');return authority.read(uid)},
    execute:async command=>{sendCount++;if(drop){drop=false;throw Error('lost before delivery');}return authority.execute(uid,command)}
  };
  const options={uid,storage,transport,clock:()=>1_000_000,makeId:makeId()};
  const queue=createOfflineCommandQueue(options);
  async function conflict() {
    const first=queue.enqueue(move);
    if(tail)queue.enqueue({type:'produce',slot:42});
    assert.equal((await queue.flush()).code,'NETWORK_UNAVAILABLE');
    assert.equal((await authority.execute(uid,otherCommand)).status,'applied');
    const outcome=await queue.flush({force:true});
    assert.equal(outcome.code,'REVISION_CONFLICT');
    assert.equal(outcome.blocked,'conflict');
    return first.operationId;
  }
  return {queue,authority,transport,storage,options,conflict,
    setOffline:x=>{offline=x}, get sends(){return sendCount},get reads(){return readCount}};
}

test('conflict review shows original intent and a detached latest canonical snapshot',async()=>{
  const x=setup();const id=await x.conflict();
  const review=x.queue.inspectConflict();
  assert.equal(review.ok,true);
  assert.equal(review.originalOperationId,id);
  assert.deepEqual(review.action,move);
  assert.equal(review.revision,1);
  assert.equal(review.state.board[7]?.tier,1);
  review.state.coins=123456;review.action.from=55;
  assert.equal(x.queue.inspectConflict().state.coins,0);
  assert.deepEqual(x.queue.inspectConflict().action,move);
});

test('no consent, wrong original operation ID or invalid replacement can clear conflict',async()=>{
  const x=setup();const id=await x.conflict();const rev=x.queue.inspectConflict().revision;
  const args={originalOperationId:id,expectedRevision:rev,newAction:freshMove};
  assert.equal((await x.queue.replaceConflicted(args)).code,'REVIEW_CONFIRMATION_REQUIRED');
  assert.equal((await x.queue.replaceConflicted({...args,confirmedByUser:true,originalOperationId:'bad'})).code,'REVIEW_CONFIRMATION_REQUIRED');
  assert.equal((await x.queue.replaceConflicted({...args,confirmedByUser:true,newAction:{...freshMove,coins:1}})).code,'BAD_COMMAND');
  assert.equal(x.queue.preview().blocked,'conflict');
  assert.equal(x.queue.preview().pending,1);
  assert.equal(x.sends,2);
});

test('explicit replacement makes a fresh ID, does not send until flush, and preserves remote state',async()=>{
  const x=setup();const old=await x.conflict();const r=x.queue.inspectConflict();
  const out=await x.queue.replaceConflicted({confirmedByUser:true,originalOperationId:old,
    expectedRevision:r.revision,newAction:freshMove});
  assert.equal(out.ok,true);assert.notEqual(out.operationId,old);
  assert.equal(out.discarded,1);assert.equal(out.pending,1);
  assert.equal(x.sends,2,'replacement is only durable queue mutation');
  assert.equal((await x.authority.read(uid)).revision,1);
  const saved=JSON.parse(x.storage.getItem(queueStorageKey(uid)));
  assert.equal(saved.pending[0].operationId,out.operationId);
  assert.equal(saved.pending[0].expectedRevision,null);
  assert.deepEqual(saved.pending[0].action,freshMove);
  assert.equal((await x.queue.flush()).ok,true);
  const current=await x.authority.read(uid);
  assert.equal(current.revision,2);
  assert.equal(current.state.board[7]?.tier,1);
  assert.equal(current.state.board[6]?.tier,1);
});

test('second device updating after review invalidates confirmation and leaves original queue blocked',async()=>{
  const x=setup();const old=await x.conflict();const r=x.queue.inspectConflict();
  assert.equal((await x.authority.execute(uid,{operationId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    expectedRevision:1,action:freshMove})).status,'applied');
  const out=await x.queue.replaceConflicted({confirmedByUser:true,originalOperationId:old,
    expectedRevision:r.revision,newAction:{type:'produce',slot:42}});
  assert.equal(out.code,'REVIEW_STALE');
  assert.equal(out.blocked,'conflict');assert.equal(out.revision,2);
  assert.equal(x.queue.preview().firstOperationId,old);
  assert.equal((await x.authority.read(uid)).revision,2);
});

test('queued dependent actions cannot be silently reinterpreted after conflict',async()=>{
  const x=setup({tail:true});const old=await x.conflict();const r=x.queue.inspectConflict();
  assert.equal(r.pending,2);assert.equal(r.followingUnsent,true);
  const args={confirmedByUser:true,originalOperationId:old,expectedRevision:r.revision,newAction:freshMove};
  assert.equal((await x.queue.replaceConflicted(args)).code,'FOLLOWING_ACTIONS_NEED_REVIEW');
  assert.equal(x.queue.preview().pending,2);
  const out=await x.queue.replaceConflicted({...args,discardFollowing:true});
  assert.equal(out.ok,true);assert.equal(out.discarded,2);assert.equal(out.pending,1);
});

test('network failure during review preserves conflicted command and never sends a replacement',async()=>{
  const x=setup();const old=await x.conflict();const r=x.queue.inspectConflict();
  x.setOffline(true);
  const out=await x.queue.replaceConflicted({confirmedByUser:true,originalOperationId:old,
    expectedRevision:r.revision,newAction:freshMove});
  assert.equal(out.code,'NETWORK_UNAVAILABLE');
  assert.equal(x.queue.preview().firstOperationId,old);
  assert.equal(x.queue.preview().blocked,'conflict');
  assert.equal(x.sends,2);
});

test('restart requires fresh server verification before conflict intent is shown',async()=>{
  const x=setup();await x.conflict();
  const restarted=createOfflineCommandQueue({...x.options,makeId:()=> 'ffffffff-ffff-4fff-8fff-ffffffffffff'});
  assert.equal(restarted.inspectConflict().code,'REMOTE_VERIFICATION_REQUIRED');
  assert.equal((await restarted.connect()).ok,true);
  assert.equal(restarted.inspectConflict().ok,true);
});

test('replacement write failure retains original journal bytes and does not send',async()=>{
  const x=setup();const old=await x.conflict();const r=x.queue.inspectConflict();
  const before=x.storage.getItem(queueStorageKey(uid));
  const failing={getItem:x.storage.getItem,setItem:()=>{throw Error('quota')}};
  const restarted=createOfflineCommandQueue({...x.options,storage:failing,makeId:()=> 'ffffffff-ffff-4fff-8fff-ffffffffffff'});
  const out=await restarted.replaceConflicted({confirmedByUser:true,originalOperationId:old,
    expectedRevision:r.revision,newAction:freshMove});
  assert.equal(out.code,'STORAGE_ERROR');
  assert.equal(x.storage.getItem(queueStorageKey(uid)),before);
  assert.equal(x.sends,2);
});

test('coordinator reviews and replaces under the Web Lock after fresh reload',async()=>{
  const x=setup();const old=await x.conflict();
  let locked=false;
  const locks={async request(name,opts,callback){assert.equal(opts.mode,'exclusive');assert.equal(locked,false);locked=true;
    try{return await callback();}finally{locked=false;}}};
  const coordinated=createCoordinatedCloudQueue({...x.options,locks,
    makeId:()=> 'ffffffff-ffff-4fff-8fff-ffffffffffff'});
  const review=await coordinated.inspectConflict();
  assert.equal(review.ok,true);assert.equal(review.originalOperationId,old);
  const result=await coordinated.replaceConflicted({confirmedByUser:true,
    originalOperationId:old,expectedRevision:review.revision,newAction:freshMove});
  assert.equal(result.ok,true);assert.equal(locked,false);
  assert.equal((await x.authority.read(uid)).revision,1);
  assert.equal((await coordinated.flush()).ok,true);
  assert.equal((await x.authority.read(uid)).revision,2);
});

test('status copy explains explicit review, not automatic rebasing',()=>{
  const presentation=formatCloudSyncStatus({phase:'blocked',blocked:'conflict',pending:2});
  assert.match(presentation.detail,/核对最新云端物品/);
  assert.match(presentation.detail,/重新发起/);
});