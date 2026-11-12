import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReceiptLookupService} from '../merge/cloud/receipt-lookup.mjs';
import {createDatabaseAuthority} from '../merge/cloud/db-authority.mjs';
import {createMockRepository} from '../merge/cloud/mock-repository.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id=i=>'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
const command=(n,rev=0,action={type:'produce',slot:42})=>({operationId:id(n),expectedRevision:rev,action});
const safe=r=>{assert.equal(r.canReplay,false);assert.equal(r.canReset,false);
  assert.equal(r.canResumeCloudWrites,false);assert.doesNotMatch(JSON.stringify(r),/aaaaaaaa-aaaa|bbbbbbbb-bbbb|00000000-0000-4000-8000/);};
const quota=()=>({consume:async()=>true});
const make=(repository,limiter=quota())=>createReceiptLookupService({repository,limiter});
const readSql=()=>readFileSync(new URL('../supabase/drafts/merge-isle-p3.16-NOT-APPLIED.sql',import.meta.url),'utf8');
const edge=()=>readFileSync(new URL('../supabase/functions/merge-game/index.ts',import.meta.url),'utf8');

test('missing shared limiter or repository fails closed at construction',()=>{
  assert.throws(()=>createReceiptLookupService({repository:{findOperation:async()=>null}}),/limiter/);
  assert.throws(()=>createReceiptLookupService({limiter:quota()}),/repository/);
});

test('never reads receipt when authenticated identity is missing or malformed',async()=>{
  let budget=0,queries=0;
  const service=make({findOperation:async()=>{queries++;return null;}},{consume:async()=>{budget++;return true;}});
  for(const identity of [null,'','not-uuid',42]) {
    const r=await service.read(identity,id(1));
    assert.equal(r.code,'AUTH_REQUIRED');assert.equal(r.httpStatus,401);
  }
  assert.equal(budget,0);assert.equal(queries,0);
});

test('invalid operation identifiers cannot trigger ledger access or budget consumption',async()=>{
  let budget=0,queries=0;
  const service=make({findOperation:async()=>{queries++;return null;}},{consume:async()=>{budget++;return true;}});
  for(const candidate of [null,{},'../other','not-uuid',id(1)+'junk']) {
    const r=await service.read(uid,candidate);
    assert.equal(r.code,'INVALID_OPERATION_ID');assert.equal(r.httpStatus,400);
  }
  assert.equal(queries,0);assert.equal(budget,0);
});

test('only the JWT-derived user partition can find its own recorded operation',async()=>{
  const repo=createMockRepository(),db=createDatabaseAuthority(repo,{clock:()=>1_000_000,rng:()=>0.9});
  assert.equal((await db.execute(uid,command(1))).status,'applied');
  const service=make(repo);
  const owner=await service.read(uid,id(1));
  assert.equal(owner.ok,true);assert.equal(owner.status,'found');safe(owner);
  assert.equal(owner.receipt.status,'applied');assert.match(owner.receipt.request_hash,/^[0-9a-f]{64}$/);
  const foreign=await service.read(other,id(1));
  assert.equal(foreign.status,'not-found');safe(foreign);
  assert.equal(await repo.findOperation(other,id(1)),null,'foreign account has no receipt');
  assert.equal((await db.read(uid)).revision,1,'receipt lookup does not replay');
});

test('recorded rejected command returns only hash and outcome, not wallet or response',async()=>{
  const repo=createMockRepository(),db=createDatabaseAuthority(repo,{clock:()=>1_000_000,rng:()=>0.9});
  assert.equal((await db.execute(uid,command(2,0,{type:'upgradeBuilding',buildingId:'harbor'}))).status,'rejected');
  const result=await make(repo).read(uid,id(2));
  assert.equal(result.status,'found');assert.equal(result.receipt.status,'rejected');
  safe(result);assert.deepEqual(Object.keys(result.receipt).sort(),['request_hash','status']);
  assert.equal(result.state,undefined);assert.equal(result.coins,undefined);
});

test('missing receipt does not imply safe retry or an unexecuted command',async()=>{
  const result=await make({findOperation:async()=>null}).read(uid,id(3));
  assert.equal(result.status,'not-found');safe(result);
  assert.equal(result.receipt,null);
});

test('rate limiter denial always occurs before any database read',async()=>{
  let dbReads=0;
  const service=make({findOperation:async()=>{dbReads++;return null;}},{consume:async()=>false});
  const result=await service.read(uid,id(4));
  assert.equal(result.code,'RECEIPT_RATE_LIMITED');assert.equal(result.httpStatus,429);
  assert.equal(dbReads,0);
});

test('limiter failure and uncertain result block repository reads, never fall through',async()=>{
  for(const consume of [async()=>{throw Error('quota sql outage')},async()=>undefined,async()=>({allowed:true})]) {
    let queries=0;
    const response=await make({findOperation:async()=>{queries++}},{consume}).read(uid,id(5));
    assert.equal(response.code,'RECEIPT_SERVICE_UNAVAILABLE');assert.equal(response.httpStatus,503);
    assert.equal(queries,0);
    assert.doesNotMatch(JSON.stringify(response),/quota sql outage/);
  }
});

test('40 simultaneous calls consume one shared quota gate and cannot exceed 12',async()=>{
  let count=0,dbReads=0;
  const limiter={consume:async()=>++count<=12};
  const service=make({findOperation:async()=>{dbReads++;return null;}},limiter);
  const results=await Promise.all(Array.from({length:40},()=>service.read(uid,id(6))));
  assert.equal(results.filter(r=>r.status==='not-found').length,12);
  assert.equal(results.filter(r=>r.code==='RECEIPT_RATE_LIMITED').length,28);
  assert.equal(dbReads,12);
});

test('database faults and sensitive exception strings do not escape into response',async()=>{
  const response=await make({findOperation:async()=>{throw Error('sql service secret')}}).read(uid,id(7));
  assert.equal(response.code,'RECEIPT_SERVICE_UNAVAILABLE');assert.equal(response.httpStatus,503);
  assert.doesNotMatch(JSON.stringify(response),/secret/);
});

test('malformed, missing or forged repository rows never leak untrusted values',async()=>{
  for(const row of [undefined,[],{status:'applied',request_hash:'bad'},
    {status:'unknown',request_hash:'a'.repeat(64)},
    {status:'applied',request_hash:'A'.repeat(64)}]){
    const response=await make({findOperation:async()=>row}).read(uid,id(8));
    assert.equal(response.code,'RECEIPT_SERVICE_UNAVAILABLE');
    assert.equal(response.httpStatus,503);
  }
});

test('service strips all response, account and metadata fields from repository row',async()=>{
  const record={status:'applied',request_hash:'a'.repeat(64),user_id:other,
    operation_id:id(99),response:{coins:1000},raw_private:'never output'};
  const result=await make({findOperation:async()=>record}).read(uid,id(9));
  assert.equal(result.status,'found');safe(result);
  assert.doesNotMatch(JSON.stringify(result),/private|coins|response|bbbbbbbb/);
  assert.deepEqual(Object.keys(result.receipt).sort(),['request_hash','status']);
});

test('canonical lowercase uid and operation ID forwarded only to trusted repo',async()=>{
  let uidArg,idArg;
  const r=await make({findOperation:async (user,opId)=>{uidArg=user;idArg=opId;return null;}})
    .read(uid.toUpperCase(),id(10).toUpperCase());
  assert.equal(r.status,'not-found');
  assert.equal(uidArg,uid);assert.equal(idArg,id(10));
});

test('Edge draft guards JWT and exact request keys before service lookup',()=>{
  const content=edge();
  assert.ok(content.includes("anon.auth.getUser(bearer)"));
  assert.ok(content.includes("exactKeys(body,['mode','operationId']) && body.mode==='receipt'"));
  assert.ok(content.includes("receiptLookup.read(data.user.id,body.operationId)"));
  assert.ok(content.includes("admin.rpc('merge_consume_receipt_quota'"));
  assert.ok(content.includes(".select('request_hash,status')"));
  assert.ok(content.includes(".eq('user_id',uid).eq('operation_id',operationId)"));
  assert.ok(content.includes("RECEIPT_RATE_LIMITED"));
  assert.ok(!/receiptLookup\.read\(body\.userId|body\.userId.*receiptLookup\.read/.test(content));
  assert.ok(content.includes("'Cache-Control':'no-store'"));
});

test('SQL draft has service-role only execute with atomic quota and no live migration',()=>{
  const content=readSql();
  assert.match(content,/NOT APPLIED/);
  assert.match(content,/ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(content,/RETURN v_count <= 12;/);
  assert.match(content,/ENABLE ROW LEVEL SECURITY/);
  assert.match(content,/REVOKE ALL ON FUNCTION public\.merge_consume_receipt_quota\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(content,/GRANT EXECUTE ON FUNCTION public\.merge_consume_receipt_quota\(uuid\) TO service_role/);
  assert.ok(!edge().includes("CREATE TABLE"));
});
