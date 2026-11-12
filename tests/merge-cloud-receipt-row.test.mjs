import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReceiptRow} from '../merge/cloud/receipt-row.mjs';
import {createReceiptLookupService} from '../merge/cloud/receipt-lookup.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const op='00000000-0000-4000-8000-000000000001';
const hash='a'.repeat(64);
const valid=()=>({request_hash:hash,status:'applied'});
const lookup=row=>createReceiptLookupService({
  limiter:{consume:async()=>true},
  repository:{findOperation:async()=>row}
});

test('P3.22 accepts only primitive lowercase SHA-256 and exact outcomes',()=>{
  assert.deepEqual(validateReceiptRow(valid()),valid());
  assert.deepEqual(validateReceiptRow({request_hash:hash,status:'rejected'}),{request_hash:hash,status:'rejected'});
  for(const row of [
    null,undefined,[],new Date(),new Map(),{request_hash:hash.toUpperCase(),status:'applied'},
    {request_hash:hash,status:'pending'},{request_hash:hash,status:null},
    {request_hash:hash.slice(1),status:'applied'},
    {request_hash:{toString:()=>hash},status:'applied'},
    {request_hash:new String(hash),status:'applied'},
    {request_hash:hash,status:{toString:()=> 'applied'}}
  ])assert.equal(validateReceiptRow(row),null);
});
test('P3.22 rejects inherited, accessor, and class-instance receipt properties',()=>{
  const inherited=Object.create(valid());
  assert.equal(validateReceiptRow(inherited),null);
  let getterCalled=0;
  const accessors={status:'applied',get request_hash(){getterCalled++;return hash;}};
  assert.equal(validateReceiptRow(accessors),null);
  assert.equal(getterCalled,0);
  class Receipt {constructor(){this.request_hash=hash;this.status='applied';}}
  assert.equal(validateReceiptRow(new Receipt()),null);
});
test('P3.22 hostile proxy cannot throw past the receipt validator',()=>{
  const hostile=new Proxy(valid(),{getPrototypeOf(){throw Error('private database error')}});
  assert.equal(validateReceiptRow(hostile),null);
  const hostileDescriptor=new Proxy(valid(),{getOwnPropertyDescriptor(){throw Error('private database error')}});
  assert.equal(validateReceiptRow(hostileDescriptor),null);
});
test('P3.22 strips private extras without evaluating getters',()=>{
  let leaked=0;
  const row=valid();
  Object.defineProperty(row,'private',{enumerable:true,get(){leaked++;throw Error('private data');}});
  row.user_id='not-for-client';
  const receipt=validateReceiptRow(row);
  assert.deepEqual(Object.keys(receipt).sort(),['request_hash','status']);
  assert.equal(leaked,0);
  assert.equal(Object.isFrozen(receipt),true);
  assert.equal(JSON.stringify(receipt).includes('not-for-client'),false);
});
test('P3.22 null-prototype database rows remain valid',()=>{
  const row=Object.assign(Object.create(null),valid());
  const receipt=validateReceiptRow(row);
  assert.deepEqual(receipt,valid());
});
test('P3.22 malformed adapter values fail closed after quota without response leaks',async()=>{
  let queries=0,consumes=0;
  const service=createReceiptLookupService({
    limiter:{consume:async()=>{consumes++;return true;}},
    repository:{findOperation:async()=>{queries++;return {request_hash:{toString:()=>hash},status:'applied',private:'do not leak'};}}
  });
  const response=await service.read(uid,op);
  assert.equal(response.code,'RECEIPT_SERVICE_UNAVAILABLE');
  assert.equal(response.httpStatus,503);
  assert.equal(response.canResumeCloudWrites,undefined);
  assert.equal(queries,1);assert.equal(consumes,1);
  assert.doesNotMatch(JSON.stringify(response),/private|do not leak/);
});
test('P3.22 valid receipts remain read-only and cannot grant cloud recovery',async()=>{
  const response=await lookup(valid()).read(uid,op);
  assert.equal(response.ok,true);
  assert.equal(response.receipt.request_hash,hash);
  assert.equal(response.receipt.status,'applied');
  assert.equal(response.canReplay,false);
  assert.equal(response.canReset,false);
  assert.equal(response.canResumeCloudWrites,false);
});
