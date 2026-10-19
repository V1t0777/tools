import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewDamagedJournalReceipts} from '../merge/cloud/recovery-receipts.mjs';
import {createMockRepository} from '../merge/cloud/mock-repository.mjs';
import {createDatabaseAuthority} from '../merge/cloud/db-authority.mjs';
import {hashOperation} from '../merge/cloud/db-authority.mjs';
import {queueStorageKey} from '../merge/cloud/offline-queue.mjs';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const key=queueStorageKey(uid);
const op=(n,expectedRevision,action={type:'produce',slot:42})=>({
  operationId:'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0'),
  expectedRevision,action
});
function journal(pending=[],extras={}) {
  // Structurally corrupt top-level 'blocked' but parseable operation evidence.
  return JSON.stringify({version:1,uid,confirmed:null,pending,blocked:'unexpected',...extras});
}
const item=(command,attempts=1)=>({
  operationId:command.operationId,action:command.action,
  expectedRevision:command.expectedRevision,attempts,nextRetryAt:0
});
function store(raw) {
  let current=raw,reads=0,writes=0;
  return {
    getItem(k){reads++;return k===key?current:null},
    setItem(){writes++;throw Error('review must never write')},
    change(v){current=v},
    get reads(){return reads},get writes(){return writes},raw:()=>current
  };
}
function guard(result,expected) {
  assert.equal(result.code,expected);
  assert.equal(result.readyToReset,false);
  assert.equal(result.readyToReplay,false);
  assert.equal(result.canResumeCloudWrites,false);
  assert.equal(result.remoteVerified,false);
  assert.equal(JSON.stringify(result).includes(uid),false);
  assert.equal(JSON.stringify(result).includes('00000000-0000-4000-8000-'),false);
}

test('without explicit consent neither local evidence nor remote ledger is read',async()=>{
  const s=store(journal([item(op(1,0))]));let remote=0;
  guard(await reviewDamagedJournalReceipts({uid,storage:s,
    findOperation:()=>{remote++},confirmedByUser:false}),'USER_CONFIRMATION_REQUIRED');
  assert.equal(s.reads,0);assert.equal(remote,0);assert.equal(s.writes,0);
});

test('healthy queue cannot enter damaged-record review even with consent',async()=>{
  const s=store(JSON.stringify({version:1,uid,confirmed:null,pending:[],blocked:null}));
  let remote=0;
  guard(await reviewDamagedJournalReceipts({uid,storage:s,confirmedByUser:true,
    findOperation:()=>{remote++}}),'JOURNAL_NOT_DAMAGED');
  assert.equal(remote,0);assert.equal(s.writes,0);
});

test('truncated, missing, malformed and oversized evidence never touch ledger',async()=>{
  for (const raw of [null,'','{"pending":','x'.repeat(160_001)]) {
    const s=store(raw);let remote=0;
    guard(await reviewDamagedJournalReceipts({uid,storage:s,confirmedByUser:true,
      findOperation:()=>{remote++}}),'NO_SAFE_PARSEABLE_EVIDENCE');
    assert.equal(remote,0);assert.equal(s.writes,0);
  }
});

test('a foreign account or unsupported journal version is never reconciled',async()=>{
  for(const extras of [{uid:otherUid},{version:2}]) {
    const s=store(journal([item(op(1,0))],extras));
    guard(await reviewDamagedJournalReceipts({uid,storage:s,confirmedByUser:true,
      findOperation:()=>{throw Error('must not read ledger')}}),'UNTRUSTWORTHY_JOURNAL_STRUCTURE');
    assert.equal(s.writes,0);
  }
});

test('duplicate UUID aliases and malformed action fail closed before ledger access',async()=>{
  const first=item(op(1,0));
  for (const raw of [
    journal([first,{...first,operationId:first.operationId.toUpperCase()}]),
    journal([{...first,action:{type:'produce',slot:42,coins:999}}]),
    journal([{...first,attempts:1,expectedRevision:null}])
  ]) {
    let reads=0;
    const result=await reviewDamagedJournalReceipts({uid,storage:store(raw),confirmedByUser:true,
      findOperation:()=>{reads++}});
    assert.equal(reads,0);
    assert.equal(result.readyToReplay,false);
    assert.equal(result.canResumeCloudWrites,false);
    assert.ok(['DUPLICATE_OPERATION_IDS','UNTRUSTWORTHY_OPERATION_EVIDENCE','UNPINNED_ATTEMPT'].includes(result.code));
  }
});

test('zero recorded sends cannot prove remote absence and does not query ledger',async()=>{
  const s=store(journal([item(op(1,null),0)]));
  let lookups=0;
  const r=await reviewDamagedJournalReceipts({uid,storage:s,confirmedByUser:true,
    findOperation:()=>{lookups++}});
  guard(r,'NO_RECORDED_SEND_ATTEMPTS');
  assert.equal(r.unattempted,1);assert.equal(lookups,0);
});

test('crash-after-commit receipt matches exact original command without replaying it',async()=>{
  const repo=createMockRepository();
  const authority=createDatabaseAuthority(repo,{clock:()=>1_000_000,rng:()=>0.9});
  const cmd=op(1,0);
  const issued=await authority.execute(uid,cmd);
  assert.equal(issued.status,'applied');
  const s=store(journal([item(cmd)]));let lookup=0;
  const result=await reviewDamagedJournalReceipts({uid,storage:s,confirmedByUser:true,
    findOperation:async (actor,id)=>{lookup++;return repo.findOperation(actor,id)}});
  guard(result,'MATCHED_RECEIPTS_REVIEW_REQUIRED');
  assert.equal(result.applied,1);assert.equal(result.unresolved,0);
  assert.equal(lookup,1);assert.equal(s.writes,0);
  assert.equal((await authority.read(uid)).revision,1,
    'receipt review did not resubmit action or create second reward');
});

test('recorded rejection is a known result, not permission to reset or retry',async()=>{
  const repo=createMockRepository();
  const authority=createDatabaseAuthority(repo,{clock:()=>1_000_000,rng:()=>0.9});
  const cmd=op(2,0,{type:'upgradeBuilding',buildingId:'harbor'});
  assert.equal((await authority.execute(uid,cmd)).status,'rejected');
  const r=await reviewDamagedJournalReceipts({uid,storage:store(journal([item(cmd)])),
    confirmedByUser:true,findOperation:(actor,id)=>repo.findOperation(actor,id)});
  guard(r,'MATCHED_RECEIPTS_REVIEW_REQUIRED');
  assert.equal(r.rejected,1);assert.equal((await authority.read(uid)).revision,0);
});

test('missing ledger record is UNKNOWN even when server revision has advanced',async()=>{
  const repo=createMockRepository();
  const authority=createDatabaseAuthority(repo,{clock:()=>1_000_000,rng:()=>0.9});
  await authority.execute(uid,op(1,0));
  const missing=op(2,0);
  const r=await reviewDamagedJournalReceipts({uid,
    storage:store(journal([item(missing)])),confirmedByUser:true,
    findOperation:(actor,id)=>repo.findOperation(actor,id)});
  guard(r,'LEDGER_ENTRIES_MISSING');
  assert.equal(r.unresolved,1);assert.equal(r.applied,0);
});

test('different operation payload with the SAME ID is a fingerprint mismatch',async()=>{
  const repo=createMockRepository();
  const authority=createDatabaseAuthority(repo,{clock:()=>1_000_000,rng:()=>0.9});
  const cmd=op(3,0);
  await authority.execute(uid,cmd);
  const substituted=op(3,0,{type:'upgradeWarehouse'});
  const r=await reviewDamagedJournalReceipts({uid,
    storage:store(journal([item(substituted)])),confirmedByUser:true,
    findOperation:(actor,id)=>repo.findOperation(actor,id)});
  guard(r,'OPERATION_FINGERPRINT_MISMATCH');
});

test('forged/invalid receipt is rejected; mismatch cannot be hidden by status text',async()=>{
  const cmd=op(4,0),hash=await hashOperation(cmd);
  for (const record of [
    {status:'applied',request_hash:'f'.repeat(64)},
    {status:'applied',request_hash:hash.toUpperCase()},
    {status:'conflict',request_hash:hash},
    {status:'applied',request_hash:null}
  ]) {
    const r=await reviewDamagedJournalReceipts({uid,
      storage:store(journal([item(cmd)])),confirmedByUser:true,
      findOperation:async()=>record});
    assert.equal(r.canResumeCloudWrites,false);
    assert.ok(['INVALID_LEDGER_RECORD','OPERATION_FINGERPRINT_MISMATCH'].includes(r.code));
  }
});

test('lookup failures cannot be construed as negative receipts',async()=>{
  const r=await reviewDamagedJournalReceipts({uid,storage:store(journal([item(op(5,0))])),
    confirmedByUser:true,findOperation:()=>{throw Error('sensitive server fault')}});
  guard(r,'TRUSTED_LEDGER_READ_FAILED');
  assert.equal(JSON.stringify(r).includes('sensitive server fault'),false);
});

test('missing trusted repository is a hard blocker',async()=>{
  guard(await reviewDamagedJournalReceipts({uid,
    storage:store(journal([item(op(6,0))])),confirmedByUser:true}),
  'TRUSTED_LEDGER_UNAVAILABLE');
});

test('unsent dependent tail is counted but NEVER assumed safe to discard',async()=>{
  const cmd=op(7,0),tail=op(8,null);
  const repo=createMockRepository();
  const authority=createDatabaseAuthority(repo,{clock:()=>1_000_000,rng:()=>0.9});
  await authority.execute(uid,cmd);
  const r=await reviewDamagedJournalReceipts({uid,
    storage:store(journal([item(cmd),item(tail,0)])),
    confirmedByUser:true,findOperation:(actor,id)=>repo.findOperation(actor,id)});
  guard(r,'MATCHED_RECEIPTS_REVIEW_REQUIRED');
  assert.equal(r.attempted,1);assert.equal(r.unattempted,1);
});

test('another tab modifying original bytes during a remote lookup invalidates result',async()=>{
  const cmd=op(9,0),s=store(journal([item(cmd)])),hash=await hashOperation(cmd);
  const r=await reviewDamagedJournalReceipts({uid,storage:s,confirmedByUser:true,
    findOperation:async()=>{s.change(journal([item(cmd)],{blocked:'different'}));
      return {status:'applied',request_hash:hash}}});
  guard(r,'LOCAL_EVIDENCE_CHANGED');
  assert.equal(s.writes,0);
});

test('a crash during final re-read invalidates any reported match',async()=>{
  const cmd=op(10,0),hash=await hashOperation(cmd);
  let call=0;
  const storage={
    getItem(){call++;if(call===2)throw Error('storage revoked');return journal([item(cmd)])},
    setItem(){throw Error('not allowed')}
  };
  guard(await reviewDamagedJournalReceipts({uid,storage,confirmedByUser:true,
    findOperation:async()=>({status:'applied',request_hash:hash})}),
  'LOCAL_EVIDENCE_CHANGED');
});
