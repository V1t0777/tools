import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createReceiptLookupService} from '../merge/cloud/receipt-lookup.mjs';

test('P3.23 quota and lookup share a single monotonic deadline',async()=>{
  let tick=0,reads=0;
  const svc=createReceiptLookupService({
    deadlineMs:100,now:()=>tick,
    limiter:{consume:async()=>{tick=101;return true;}},
    repository:{findOperation:async()=>{reads++;return null;}}
  });
  const result=await svc.read(randomUUID(),randomUUID());
  assert.equal(result.code,'RECEIPT_SERVICE_UNAVAILABLE');
  assert.equal(result.httpStatus,503);
  assert.equal(reads,0);
});

test('P3.23 fast quota and lookup still return read-only not-found',async()=>{
  const svc=createReceiptLookupService({
    deadlineMs:100,now:()=>10,
    limiter:{consume:async()=>true},
    repository:{findOperation:async()=>null}
  });
  const result=await svc.read(randomUUID(),randomUUID());
  assert.equal(result.status,'not-found');
  assert.equal(result.canResumeCloudWrites,false);
});

test('P3.23 invalid monotonic clock configuration is rejected',()=>{
  assert.throws(()=>createReceiptLookupService({now:null}),/Invalid monotonic clock/);
});
