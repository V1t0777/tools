import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInMemoryAuthority, normalizeCommand, planTrustedTransition } from '../merge/cloud/authority.mjs';
import { createInitialState, validateSave } from '../merge/engine.mjs';
const uid1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uid2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const op = (id, revision, action) => ({operationId:`00000000-0000-4000-8000-${id.toString(16).padStart(12,'0')}`,expectedRevision:revision,action});
const create = () => createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});

test('requires an authenticated server actor and rejects arbitrary state/coin injection',async()=>{
  const backend = create();
  assert.equal((await backend.read(null)).code,'AUTH_REQUIRED');
  assert.equal((await backend.execute('attacker',op(1,0,{type:'produce',slot:42}))).code,'AUTH_REQUIRED');
  const forged = {...op(1,0,{type:'produce',slot:42}),coins:10000000};
  assert.equal((await backend.execute(uid1,forged)).code,'BAD_COMMAND');
  assert.equal((await backend.execute(uid1,op(2,0,{type:'order',orderId:'o0',coins:1000}))).code,'BAD_COMMAND');
  assert.equal((await backend.execute(uid1,op(3,0,{type:'upgradeProducer',producerId:'m9',level:99}))).code,'BAD_COMMAND');
  assert.equal((await backend.read(uid1)).state.coins,0);
});

test('same operation is idempotent including concurrent exact replay',async()=>{
  const authority=create();const command=op(1,0,{type:'produce',slot:42});
  const results=await Promise.all(Array.from({length:30},()=>authority.execute(uid1,command)));
  assert.equal(results.filter(x=>x.status==='applied').length,1);
  assert.equal(results.filter(x=>x.status==='replayed').length,29);
  assert.equal((await authority.read(uid1)).state.energy,79);
  assert.equal((await authority.read(uid1)).revision,1);
});

test('different operation with same expectedRevision conflicts instead of overwriting',async()=>{
  const authority=create();
  const [a,b]=await Promise.all([authority.execute(uid1,op(1,0,{type:'produce',slot:42})),
    authority.execute(uid1,op(2,0,{type:'produce',slot:42}))]);
  assert.deepEqual(new Set([a.status,b.status]),new Set(['applied','conflict']));
  const snapshot=await authority.read(uid1);
  assert.equal(snapshot.revision,1);assert.equal(snapshot.state.energy,79);
});

test('replay returns current canonical state rather than old stale reply',async()=>{
  const authority=create();const a=op(1,0,{type:'move',from:0,to:2});
  assert.equal((await authority.execute(uid1,a)).status,'applied');
  assert.equal((await authority.execute(uid1,op(2,1,{type:'move',from:1,to:3}))).status,'applied');
  const replay=await authority.execute(uid1,a);
  assert.equal(replay.status,'replayed');assert.equal(replay.revision,2);
  assert.deepEqual(replay.state,(await authority.read(uid1)).state);
});

test('operation-id reuse with different payload is rejected, no double reward',async()=>{
  const authority=create();
  assert.equal((await authority.execute(uid1,op(1,0,{type:'order',orderId:'o0'}))).status,'applied');
  const attempt=await authority.execute(uid1,op(1,0,{type:'order',orderId:'o1'}));
  assert.equal(attempt.code,'OPERATION_ID_REUSE');
  assert.equal((await authority.read(uid1)).state.coins,19);
});

test('two users are isolated even with identical operation IDs',async()=>{
  const authority=create();const c=op(1,0,{type:'produce',slot:42});
  await authority.execute(uid1,c);
  assert.equal((await authority.read(uid2)).revision,0);
  assert.equal((await authority.execute(uid2,c)).status,'applied');
  assert.equal((await authority.read(uid1)).revision,1);
});

test('failed valid action is idempotently rejected, with no coin or revision change',async()=>{
  const authority=create();const c=op(1,0,{type:'upgradeBuilding',buildingId:'harbor'});
  const first=await authority.execute(uid1,c);
  assert.equal(first.status,'rejected');assert.equal(first.revision,0);
  assert.equal((await authority.execute(uid1,c)).status,'replayed');
  assert.equal((await authority.read(uid1)).state.coins,0);
});

test('remote snapshot is server-created, not loaded from modified localStorage',async()=>{
  const backend=create(); const fromServer=await backend.read(uid1);
  assert.deepEqual(fromServer.state,createInitialState(1_000_000));
  const forged=structuredClone(fromServer.state);forged.coins=100_000;
  assert.equal((await backend.execute(uid1,{...op(1,0,{type:'move',from:0,to:2}),state:forged})).code,'BAD_COMMAND');
  assert.equal((await backend.read(uid1)).state.coins,0);
});

test('rejects invalid envelopes, spoofed actor and unsupported actions',()=>{
  assert.equal(normalizeCommand(op(1,0,{type:'move',from:0,to:7})).action.type,'move');
  assert.equal(normalizeCommand(op(1,0,{type:'claimCoins',value:999})),null);
  assert.equal(normalizeCommand(op(1,0,{type:'move',from:0,to:56})),null);
  assert.equal(normalizeCommand(op(1,0,{type:'store',slot:-1})),null);
  assert.equal(normalizeCommand({...op(1,0,{type:'produce',slot:42}),expectedRevision:1.2}),null);
  assert.equal(normalizeCommand(op(1,0,{type:'order',orderId:'o0',extra:4})),null);
  assert.equal(normalizeCommand(op(1,0,{type:'upgradeBuilding',buildingId:'__proto__'})),null);
});

test('each action kind goes through shared P2 transition validation',()=>{
  const initial=createInitialState(1_000_000);
  const cmd=normalizeCommand(op(1,0,{type:'produce',slot:42}));
  const transition=planTrustedTransition(initial,cmd,{now:1_000_000,rng:()=>0.99});
  assert.equal(transition.ok,true);
  assert.equal(transition.state.revision,1);
  assert.equal(validateSave(transition.state),true);
  assert.equal(transition.state.energy,79);
});

test('SQL migration draft explicitly denies browser access, controls RPCs and locks row',()=>{
  const sql=readFileSync(new URL('../supabase/drafts/merge-isle-p3-NOT-APPLIED.sql',import.meta.url),'utf8');
  for(const required of ['DO NOT APPLY','ENABLE ROW LEVEL SECURITY','REVOKE ALL ON public.merge_saves',
    'REVOKE ALL ON public.merge_operations','GRANT EXECUTE ON FUNCTION public.merge_open_save',
    'GRANT EXECUTE ON FUNCTION public.merge_commit_operation','FOR UPDATE','PRIMARY KEY (user_id, operation_id)',
    'SECURITY DEFINER SET search_path =', 'TO service_role']) assert.ok(sql.includes(required),required);
  assert.ok(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]+TO\s+authenticated\s*;/i.test(sql));
});

test('1500 conflicting client commands never fork the history',async()=>{
  const authority=create();let state=await authority.read(uid1);
  for(let i=0;i<500;i++) {
    const current=state.revision;
    const nextOp=i%2 ? {type:'move',from:0,to:2} : {type:'produce',slot:42};
    const cmds=[op(i*3+1,current,nextOp),op(i*3+2,current,nextOp),op(i*3+3,current,nextOp)];
    const out=await Promise.all(cmds.map(c=>authority.execute(uid1,c)));
    assert.ok(out.filter(r=>r.status==='applied').length<=1);
    state=await authority.read(uid1);
    assert.equal(validateSave(state.state),true);
    assert.ok(state.revision>=current);
  }
});