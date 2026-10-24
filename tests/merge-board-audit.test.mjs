import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge,fulfillOrder,produce,storeItem,upgradeWarehouse,
  upgradeBuilding} from '../merge/engine.mjs';
import {diagnoseBoard} from '../merge/board-diagnostics.mjs';
import {auditEconomyTransition as audit} from '../merge/cloud/economy-audit.mjs';
const start=()=>createInitialState(1_000_000);
const cmd=(type,args={})=>({action:{type,...args}});
function full({warehouse=false,pair=false,order=false,upgrade=false}={}){
  const s=start();
  s.board=s.board.map(x=>x?.kind==='producer'?x:null);
  for(let i=0;i<s.board.length;i++)if(!s.board[i])
    s.board[i]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:6};
  if(pair){s.board[0]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:1};
    s.board[1]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:1};}
  if(order)s.board[0]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:2};
  if(warehouse)for(let i=0;i<s.warehouse.capacity;i++)
    s.warehouse.slots[i]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:6};
  if(upgrade){s.xp=1600;s.coins=1000;}
  return s;
}
test('opening board suggests a real order; diagnosis does not mutate',()=>{
  const s=start(),saved=structuredClone(s),d=diagnoseBoard(s);
  assert.equal(d.recovery,'playable');assert.equal(d.hint.type,'order');
  assert.equal(fulfillOrder(s,d.hint.orderId).ok,true);assert.deepEqual(s,saved);
});
test('full board with merge pair is recoverable',()=>{
  const s=full({warehouse:true,pair:true}),d=diagnoseBoard(s);
  assert.equal(d.hint.type,'move');assert.equal(d.recovery,'recoverable');
  assert.equal(moveOrMerge(s,d.hint.from,d.hint.to).kind,'merge');
});
test('full board with deliverable order is recoverable',()=>{
  const s=full({warehouse:true,order:true}),d=diagnoseBoard(s);
  assert.equal(d.hint.type,'order');assert.equal(fulfillOrder(s,d.hint.orderId).ok,true);
});
test('warehouse empty space is safe relief without item deletion',()=>{
  const s=full(),d=diagnoseBoard(s),before=s.board.filter(Boolean).length;
  assert.equal(d.hint.type,'store');
  const result=storeItem(s,d.hint.slot);assert.equal(result.ok,true);
  assert.equal(result.state.board.filter(Boolean).length,before-1);
  assert.equal(result.state.warehouse.slots.filter(Boolean).length,1);
});
test('affordable expansion prevents false deadlock',()=>{
  const s=full({warehouse:true,upgrade:true}),d=diagnoseBoard(s);
  assert.equal(d.hint.type,'upgradeWarehouse');
  assert.equal(upgradeWarehouse(s).ok,true);
});
test('full locked board is a genuine rules-level deadlock',()=>{
  const s=full({warehouse:true}),d=diagnoseBoard(s);
  assert.equal(d.recovery,'hard-deadlock');assert.equal(d.hint,null);
  assert.equal(d.actionable.merges,0);
});
test('maximum tier duplicates do not count as valid merges',()=>{
  assert.equal(diagnoseBoard(full({warehouse:true})).actionable.merges,0);
});
test('lack of energy on non-full board means waiting, not deadlock',()=>{
  const s=start();s.board=s.board.map(x=>x?.kind==='producer'?x:null);s.energy=0;
  assert.equal(diagnoseBoard(s).recovery,'waiting');
});
test('invalid saves do not generate hints',()=>{
  const s=start();s.energy=-1;assert.throws(()=>diagnoseBoard(s),TypeError);
});
test('economy audit accepts exact order grant and rejects extra coins',()=>{
  const s=start(),r=fulfillOrder(s,'o0'),a=cmd('order',{orderId:'o0'});
  assert.equal(audit(s,a,r).coins,s.orders[0].coins);
  const bad=structuredClone(r);bad.state.coins++;
  assert.throws(()=>audit(s,a,bad),/mismatched/);
});
test('economy audit rejects artificial XP and keeps inputs untouched',()=>{
  const s=start(),r=fulfillOrder(s,'o0'),bad=structuredClone(r);
  bad.state.xp++;assert.throws(()=>audit(s,cmd('order',{orderId:'o0'}),bad),/mismatched/);
  assert.equal(s.coins,0);
});
test('move and producer action do not mint rewards',()=>{
  const s=start(),r=moveOrMerge(s,0,1);
  assert.equal(audit(s,cmd('move',{from:0,to:1}),r).coins,0);
  const p=produce(s,42,1_000_000,()=>0.7);
  assert.equal(audit(s,cmd('produce',{slot:42}),p).xp,0);
});
test('upgrade amount is audited using pre-action cost',()=>{
  const s=start();s.xp=1600;s.coins=1000;
  const r=upgradeBuilding(s,'garden'),a=cmd('upgradeBuilding',{buildingId:'garden'});
  assert.equal(audit(s,a,r).coins,-160);
  const bad=structuredClone(r);bad.state.coins=s.coins;
  assert.throws(()=>audit(s,a,bad),/mismatched/);
});
test('failed actions cannot mint coins or increment revision',()=>{
  const s=start(),r=upgradeBuilding(s,'harbor');
  assert.equal(audit(s,cmd('upgradeBuilding',{buildingId:'harbor'}),r).coins,0);
  const bad=structuredClone(r);bad.state.revision++;
  assert.throws(()=>audit(s,cmd('upgradeBuilding',{buildingId:'harbor'}),bad),/revision/);
});
test('audit rejects unsupported operation and bad state',()=>{
  const s=start(),r=moveOrMerge(s,0,1);
  assert.throws(()=>audit(s,cmd('claimCoins',{amount:100}),r),/malformed/);
  const bad=structuredClone(r);bad.state.coins=-9;
  assert.throws(()=>audit(s,cmd('move',{from:0,to:1}),bad),/malformed/);
});
