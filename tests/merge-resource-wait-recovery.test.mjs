import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState, validateSave, advanceTime, produce, useSupply,
  purchaseSupply, ENERGY_REGEN_MS, PRODUCER_RECHARGE_MS,
  PRODUCER_CHARGES, CELL_COUNT} from '../merge/engine.mjs';
import {diagnoseBoard} from '../merge/board-diagnostics.mjs';
import {getBoardGuidance} from '../merge/board-guidance.mjs';
import {simulateFriction} from '../merge/economy-friction-simulator.mjs';

const T=1_000_000;
function clearMaterials(){
  const s=createInitialState(T);
  s.board=s.board.map(item=>item?.kind==='material'?null:item);
  assert.equal(validateSave(s),true);
  return s;
}
const materialCount=s=>s.board.filter(item=>item?.kind==='material').length;

test('P2.65bb energy exhaustion waits for a real tick before a single legal production',()=>{
  const s=clearMaterials();s.energy=0;s.energyAt=T;
  assert.equal(validateSave(s),true);
  const raw=JSON.stringify(s),hint=getBoardGuidance(s);
  assert.equal(diagnoseBoard(s).recovery,'waiting');
  assert.equal(hint.type,'wait');assert.match(hint.message,/体力/);
  assert.equal(produce(s,42,T,()=>0).ok,false);
  assert.equal(advanceTime(s,T+ENERGY_REGEN_MS-1).energy,0);
  assert.equal(JSON.stringify(s),raw,'waiting and rejected actions must not change the save');
  const ready=advanceTime(s,T+ENERGY_REGEN_MS);
  assert.equal(ready.energy,1);assert.equal(ready.revision,0);
  assert.equal(getBoardGuidance(ready).type,'produce');
  const result=produce(ready,42,T+ENERGY_REGEN_MS,()=>0);
  assert.equal(result.ok,true);
  assert.equal(result.state.energy,0);assert.equal(result.state.revision,1);
  assert.equal(materialCount(result.state),1);
  assert.equal(result.state.coins,0);assert.equal(result.state.xp,0);
  assert.equal(validateSave(result.state),true);
});

test('P2.65bb exhausted producers wait for cooldown, without extra energy or coins',()=>{
  const s=clearMaterials();s.energy=7;
  for(const item of s.board)if(item?.kind==='producer'){
    item.charges=0;item.cooldownUntil=T+PRODUCER_RECHARGE_MS;
  }
  assert.equal(validateSave(s),true);
  assert.equal(diagnoseBoard(s).recovery,'waiting');
  assert.equal(getBoardGuidance(s).type,'wait');
  assert.match(getBoardGuidance(s).message,/工坊/);
  assert.equal(produce(s,42,T+PRODUCER_RECHARGE_MS-1,()=>0).ok,false);
  const ready=advanceTime(s,T+PRODUCER_RECHARGE_MS);
  assert.equal(ready.energy,7);assert.equal(ready.revision,0);
  assert.equal(ready.board[42].charges,PRODUCER_CHARGES);
  assert.equal(getBoardGuidance(ready).type,'produce');
  const result=produce(ready,42,T+PRODUCER_RECHARGE_MS,()=>0);
  assert.equal(result.ok,true);
  assert.equal(result.state.board[42].charges,PRODUCER_CHARGES-1);
  assert.equal(result.state.energy,6);assert.equal(result.state.revision,1);
  assert.equal(result.state.coins,0);assert.equal(result.state.xp,0);
  assert.equal(validateSave(result.state),true);
});

test('P2.65bb cooldown completion alone cannot bypass simultaneous energy shortage',()=>{
  const s=clearMaterials();s.energy=0;s.energyAt=T;
  for(const item of s.board)if(item?.kind==='producer'){
    item.charges=0;item.cooldownUntil=T+PRODUCER_RECHARGE_MS;
  }
  assert.equal(validateSave(s),true);
  const cooled=advanceTime(s,T+PRODUCER_RECHARGE_MS);
  assert.equal(cooled.board[42].charges,PRODUCER_CHARGES);
  assert.equal(cooled.energy,0);assert.equal(cooled.revision,0);
  assert.equal(diagnoseBoard(cooled).recovery,'waiting');
  assert.equal(getBoardGuidance(cooled).type,'wait');
  assert.equal(produce(cooled,42,T+PRODUCER_RECHARGE_MS,()=>0).ok,false);
  const recovered=advanceTime(cooled,T+ENERGY_REGEN_MS);
  assert.equal(recovered.energy,1);assert.equal(recovered.revision,0);
  assert.equal(getBoardGuidance(recovered).type,'produce');
  const result=produce(recovered,42,T+ENERGY_REGEN_MS,()=>0);
  assert.equal(result.ok,true);assert.equal(result.state.revision,1);
  assert.equal(result.state.energy,0);
  assert.equal(validateSave(result.state),true);
});

test('P2.65bb insufficient coins and missing supplies cannot create a free rescue',()=>{
  const s=clearMaterials();s.energy=0;s.energyAt=T;
  const raw=JSON.stringify(s);
  assert.equal(purchaseSupply(s,'soda').ok,false);
  assert.equal(useSupply(s,'soda',null,T).ok,false);
  assert.equal(s.bag.soda,0);assert.equal(s.shop.purchases.soda,0);
  assert.equal(s.coins,0);assert.equal(s.revision,0);
  assert.equal(JSON.stringify(s),raw);
  assert.equal(getBoardGuidance(s).type,'wait');
  assert.equal(validateSave(s),true);
});

test('P2.65bb 90-day low-efficiency scarcity scenarios keep economic bounds and deadlock accounting',()=>{
  for(const seed of [0,42])for(const behavior of ['casual','cluttered'])
    for(const policy of ['save-coins','warehouse-only']){
      const r=simulateFriction({seed,behavior,policy,days:90,sessionsPerDay:1,sessionMinutes:5});
      const label=[seed,behavior,policy].join('/');
      assert.equal(r.daily.length,90,label);
      assert.equal(r.final.coins,r.totals.earned-r.totals.spent,label);
      assert.equal(r.totals.blockedSessions,
        r.totals.behaviorBlockedSessions+r.totals.hardDeadlockSessions,label);
      assert.ok(r.totals.maxOccupied<=CELL_COUNT,label);
      assert.ok(r.totals.maxWarehouseUsed<=8,label);
      assert.ok(r.final.boardOccupied<=CELL_COUNT,label);
      assert.ok(r.final.warehouseUsed<=r.final.warehouseCapacity,label);
      assert.ok(r.daily.every(day=>day.coins>=0&&day.occupied<=CELL_COUNT),label);
      assert.ok(['playable','waiting','recoverable','hard-deadlock'].includes(r.final.recovery),label);
    }
});
