import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseAuthority } from '../merge/cloud/db-authority.mjs';
import { createMockRepository } from '../merge/cloud/mock-repository.mjs';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const op=(i,rev,action)=>({operationId:`00000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`,expectedRevision:rev,action});
const setup=()=>createDatabaseAuthority(createMockRepository(),{clock:()=>1_000_000,rng:()=>0.9});

test('database adapter rejects anonymous and forged client balances',async()=>{
  const db=setup();
  assert.equal((await db.read(null)).code,'AUTH_REQUIRED');
  assert.equal((await db.execute(uid,{...op(1,0,{type:'produce',slot:42}),coins:1000000})).code,'BAD_COMMAND');
  assert.equal((await db.read(uid)).state.coins,0);
});
test('database CAS: 40 concurrent exact retries spend energy once',async()=>{
  const db=setup();const cmd=op(1,0,{type:'produce',slot:42});
  const results=await Promise.all(Array.from({length:40},()=>db.execute(uid,cmd)));
  assert.equal(results.filter(x=>x.status==='applied').length,1);
  assert.equal(results.filter(x=>x.status==='replayed').length,39);
  assert.equal((await db.read(uid)).state.energy,119);
});
test('database CAS: two devices racing different command IDs conflict',async()=>{
  const db=setup();const results=await Promise.all([
    db.execute(uid,op(1,0,{type:'produce',slot:42})),
    db.execute(uid,op(2,0,{type:'produce',slot:42}))]);
  assert.deepEqual(new Set(results.map(x=>x.status)),new Set(['applied','conflict']));
  assert.equal((await db.read(uid)).revision,1);
});
test('database CAS: old replay cannot rewind a newer authoritative save',async()=>{
  const db=setup();const first=op(1,0,{type:'move',from:0,to:2});
  await db.execute(uid,first);
  await db.execute(uid,op(2,1,{type:'move',from:1,to:4}));
  const replay=await db.execute(uid,first);
  assert.equal(replay.status,'replayed');assert.equal(replay.revision,2);
  assert.deepEqual(replay.state,(await db.read(uid)).state);
});
test('database CAS: duplicate operation ID with different command is rejected',async()=>{
  const db=setup();const c=op(1,0,{type:'order',orderId:'o0'});
  const first=await db.execute(uid,c);assert.equal(first.status,'applied');
  const duplicate=await db.execute(uid,op(1,0,{type:'order',orderId:'o1'}));
  assert.equal(duplicate.code,'OPERATION_ID_REUSE');
  assert.equal((await db.read(uid)).state.coins,first.state.coins);
});
test('database CAS: rejection is stable under retransmission',async()=>{
  const db=setup();const c=op(1,0,{type:'upgradeBuilding',buildingId:'harbor'});
  const a=await db.execute(uid,c),b=await db.execute(uid,c);
  assert.equal(a.status,'rejected');assert.equal(b.status,'replayed');
  assert.equal((await db.read(uid)).revision,0);
});
test('database separate users cannot update each other by choosing a userId in body',async()=>{
  const db=setup();
  await db.execute(uid,op(1,0,{type:'produce',slot:42}));
  assert.equal((await db.read(other)).revision,0);
  assert.equal((await db.execute(other,{...op(2,0,{type:'move',from:0,to:2}),userId:uid})).code,'BAD_COMMAND');
  assert.equal((await db.read(uid)).revision,1);
});