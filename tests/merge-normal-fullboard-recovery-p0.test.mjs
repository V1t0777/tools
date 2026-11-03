import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, validateSave, CELL_COUNT, MAX_TIER,
  storeItem, withdrawItem, upgradeWarehouse, produce, fulfillOrder,
  moveOrMerge, advanceTime, ENERGY_REGEN_MS, PRODUCER_RECHARGE_MS
} from '../merge/engine.mjs';
import { diagnoseBoard } from '../merge/board-diagnostics.mjs';

const NOW = 1_000_000;

// A structurally valid adversarial save, NOT a claim that this exact board
// was reached through ordinary player actions. Keep the real three producers.
function saturated({capacity=4, used=capacity, coins=0, xp=0, escape=null}={}) {
  const s=createInitialState(NOW);
  s.board=s.board.map(item=>item?.kind==='producer'?item:null);
  for(let i=0;i<CELL_COUNT;i++) if(!s.board[i])
    s.board[i]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:MAX_TIER};
  s.warehouse.capacity=capacity;
  s.warehouse.slots=s.warehouse.slots.map((_,i)=>i<used
    ? {id:'m'+s.nextId++,kind:'material',chain:'tea',tier:MAX_TIER} : null);
  s.coins=coins;
  s.xp=xp;
  if(escape==='order'){
    const o=s.orders[0];
    s.board[0]={id:'m'+s.nextId++,kind:'material',chain:o.chain,tier:o.tier};
  }
  if(escape==='merge') for(const i of [0,1])
    s.board[i]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:1};
  assert.equal(validateSave(s),true,'fixture must satisfy production save validator');
  return s;
}

test('P0 saturated board and full warehouse have no existing space-making action',()=>{
  const s=saturated(), original=structuredClone(s), d=diagnoseBoard(s);
  assert.equal(d.board.free,0);
  assert.equal(d.warehouse.free,0);
  assert.equal(d.recovery,'hard-deadlock');
  assert.equal(d.hint,null);
  assert.equal(d.actionable.orders,0);
  assert.equal(d.actionable.merges,0);
  assert.equal(storeItem(s,2).ok,false);
  assert.equal(withdrawItem(s,0).ok,false);
  assert.equal(upgradeWarehouse(s).ok,false);
  assert.equal(produce(s,42,NOW,()=>0.1).ok,false);
  assert.equal(moveOrMerge(s,2,3).ok,false,'max-tier pair cannot merge');
  for(const order of s.orders) assert.equal(fulfillOrder(s,order.id).ok,false);
  assert.deepEqual(s,original,'failed operations must not mutate the save');
});

test('P0 one free warehouse slot permits real storage and subsequent production',()=>{
  const s=saturated({used:3}), d=diagnoseBoard(s);
  assert.equal(d.recovery,'recoverable');
  assert.equal(d.hint.type,'store');
  const stored=storeItem(s,d.hint.slot);
  assert.equal(stored.ok,true);
  assert.equal(stored.state.board.filter(Boolean).length,CELL_COUNT-1);
  assert.equal(stored.state.warehouse.slots.filter(Boolean).length,4);
  const produced=produce(stored.state,42,NOW,()=>0.1);
  assert.equal(produced.ok,true);
  assert.equal(produced.state.board.filter(Boolean).length,CELL_COUNT);
  assert.equal(produced.state.coins,s.coins);
  assert.equal(produced.state.revision,s.revision+2);
  assert.equal(validateSave(produced.state),true);
});

test('P0 warehouse expansion is an escape only at the actual level and coin threshold',()=>{
  const poor=saturated({xp:28,coins:49});
  assert.equal(diagnoseBoard(poor).recovery,'hard-deadlock');
  assert.equal(upgradeWarehouse(poor).ok,false);
  const affordable=saturated({xp:28,coins:50});
  const d=diagnoseBoard(affordable);
  assert.equal(d.recovery,'recoverable');
  assert.equal(d.hint.type,'upgradeWarehouse');
  const upgraded=upgradeWarehouse(affordable);
  assert.equal(upgraded.ok,true);
  assert.equal(upgraded.state.coins,0);
  assert.equal(upgraded.state.warehouse.capacity,6);
  const stored=storeItem(upgraded.state,2);
  assert.equal(stored.ok,true);
  assert.equal(stored.state.board.filter(Boolean).length,CELL_COUNT-1);
  assert.equal(validateSave(stored.state),true);
});

test('P0 maximum warehouse capacity and surplus coins do not falsely imply escape',()=>{
  const s=saturated({capacity:8,used:8,coins:9999,xp:1400});
  const d=diagnoseBoard(s);
  assert.equal(d.recovery,'hard-deadlock');
  assert.equal(d.actionable.canUpgradeWarehouse,false);
  assert.equal(upgradeWarehouse(s).ok,false);
  assert.equal(storeItem(s,2).ok,false);
});

test('P0 existing exact order or merge pair opens space without a new rescue rule',()=>{
  const orderState=saturated({escape:'order'});
  const orderHint=diagnoseBoard(orderState).hint;
  assert.equal(orderHint.type,'order');
  const delivered=fulfillOrder(orderState,orderHint.orderId);
  assert.equal(delivered.ok,true);
  assert.equal(delivered.state.board.filter(Boolean).length,CELL_COUNT-1);
  assert.equal(validateSave(delivered.state),true);
  const mergeState=saturated({escape:'merge'});
  const mergeHint=diagnoseBoard(mergeState).hint;
  assert.equal(mergeHint.type,'move');
  const merged=moveOrMerge(mergeState,mergeHint.from,mergeHint.to);
  assert.equal(merged.ok,true);
  assert.equal(merged.state.board.filter(Boolean).length,CELL_COUNT-1);
  assert.equal(validateSave(merged.state),true);
});

test('P0 energy regeneration and producer cooldown do not free a saturated board',()=>{
  const s=saturated();
  s.energy=0;
  for(const item of s.board) if(item?.kind==='producer'){
    item.charges=0;
    item.cooldownUntil=NOW+PRODUCER_RECHARGE_MS;
  }
  assert.equal(validateSave(s),true);
  const resumed=advanceTime(s,NOW+PRODUCER_RECHARGE_MS+ENERGY_REGEN_MS);
  assert.ok(resumed.energy>0);
  assert.ok(resumed.board.filter(item=>item?.kind==='producer').every(p=>p.charges>0));
  assert.equal(diagnoseBoard(resumed).recovery,'hard-deadlock');
  assert.equal(produce(resumed,42,NOW+PRODUCER_RECHARGE_MS+ENERGY_REGEN_MS,()=>0.1).ok,false);
  assert.equal(resumed.board.filter(Boolean).length,CELL_COUNT);
  assert.equal(validateSave(resumed),true);
});
