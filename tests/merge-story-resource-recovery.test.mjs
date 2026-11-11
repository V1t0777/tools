import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,produce,validateSave,ENERGY_REGEN_MS,PRODUCER_RECHARGE_MS,MAX_TIER} from '../merge/engine.mjs';
import {describeStoryWorkshopStall} from '../merge/story/resource-recovery.mjs';
const NOW=1_000_000;
test('P141 energy exhaustion recovers through actual engine time, not a grant',()=>{
  const state=createInitialState(NOW);state.energy=0;
  const before=structuredClone(state);
  assert.equal(produce(state,42,NOW).ok,false);
  assert.equal(describeStoryWorkshopStall(state,NOW).code,'ENERGY_WAIT');
  assert.match(describeStoryWorkshopStall(state,NOW).message,/180秒/);
  assert.deepEqual(state,before);
  const result=produce(state,42,NOW+ENERGY_REGEN_MS);
  assert.equal(result.ok,true);
  assert.equal(result.state.energy,0);
  assert.equal(result.state.revision,state.revision+1);
  assert.equal(validateSave(result.state),true);
  assert.equal(describeStoryWorkshopStall(state,NOW+ENERGY_REGEN_MS),null);
});
test('P141 cooldown recovers naturally without consuming a card',()=>{
  const state=createInitialState(NOW);
  state.board=state.board.map(x=>x?.kind==='producer'?{...x,charges:0,cooldownUntil:NOW+PRODUCER_RECHARGE_MS}:x);
  const before=structuredClone(state);
  assert.equal(produce(state,42,NOW).ok,false);
  assert.equal(describeStoryWorkshopStall(state,NOW).code,'COOLDOWN_WAIT');
  assert.match(describeStoryWorkshopStall(state,NOW).message,/45秒/);
  assert.deepEqual(state,before);
  const result=produce(state,42,NOW+PRODUCER_RECHARGE_MS);
  assert.equal(result.ok,true);
  assert.equal(result.state.board[42].charges,11);
  assert.deepEqual(result.state.bag,state.bag);
  assert.equal(validateSave(result.state),true);
  assert.equal(describeStoryWorkshopStall(state,NOW+PRODUCER_RECHARGE_MS),null);
});
test('P141 full-board pressure fixtures distinguish store, merge and dead end',()=>{
  const state=createInitialState(NOW);
  state.board=state.board.map((x,i)=>x?.kind==='producer'?x:{id:'m'+(1000+i),kind:'material',chain:'tea',tier:MAX_TIER});
  assert.equal(describeStoryWorkshopStall(state,NOW).code,'BOARD_FULL_STORE');
  state.warehouse.slots=state.warehouse.slots.map((_,i)=>i<state.warehouse.capacity?
    {id:'m'+(2000+i),kind:'material',chain:'tea',tier:MAX_TIER}:null);
  assert.equal(describeStoryWorkshopStall(state,NOW).code,'BOARD_FULL_BLOCKED');
  const indices=state.board.map((x,i)=>x?.kind==='material'?i:-1).filter(i=>i>=0);
  state.board[indices[0]].tier=1;state.board[indices[1]].tier=1;
  assert.equal(describeStoryWorkshopStall(state,NOW).code,'BOARD_FULL_MERGE');
  assert.equal(describeStoryWorkshopStall(null,NOW),null);
  assert.equal(describeStoryWorkshopStall(state,NaN),null);
});
test('P141 UI failure guidance cannot write or reach network',()=>{
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  const source=readFileSync(new URL('../merge/story/resource-recovery.mjs',import.meta.url),'utf8');
  assert.match(ui,/describeStoryWorkshopStall\(state,Date\.now\(\)\)/);
  for(const forbidden of ['localStorage','sessionStorage','setItem(','fetch(','sendBeacon(','purchaseSupply(','writeStoryWorkshop('])
    assert.equal(source.includes(forbidden),false,forbidden);
});

test('P148 backwards device clock shows a safe energy warning, then normal engine recovery',()=>{
  const state=createInitialState(NOW);
  state.energy=0;
  state.energyAt=NOW+2*ENERGY_REGEN_MS;
  assert.equal(validateSave(state),true);
  const original=structuredClone(state);
  const warning=describeStoryWorkshopStall(state,NOW);
  assert.equal(warning.code,'CLOCK_BEHIND_ENERGY');
  assert.match(warning.message,/系统日期和时间/);
  assert.equal(produce(state,42,NOW).ok,false);
  assert.deepEqual(state,original,'diagnostic must not rewrite future timer');
  assert.equal(describeStoryWorkshopStall(state,NOW+2*ENERGY_REGEN_MS).code,'ENERGY_WAIT');
  const resumed=produce(state,42,NOW+3*ENERGY_REGEN_MS,()=>0);
  assert.equal(resumed.ok,true);
  assert.equal(resumed.state.revision,state.revision+1);
  assert.equal(validateSave(resumed.state),true);
});
test('P148 impossible cooldown wait warns of clock rollback without granting a card',()=>{
  const state=createInitialState(NOW);
  state.board=state.board.map(x=>x?.kind==='producer'
    ? {...x,charges:0,cooldownUntil:NOW+2*PRODUCER_RECHARGE_MS}:x);
  assert.equal(validateSave(state),true);
  const original=structuredClone(state);
  const warning=describeStoryWorkshopStall(state,NOW);
  assert.equal(warning.code,'CLOCK_BEHIND_COOLDOWN');
  assert.match(warning.message,/设备时间回拨/);
  assert.deepEqual(state,original);
  assert.equal(describeStoryWorkshopStall(state,NOW+PRODUCER_RECHARGE_MS).code,'COOLDOWN_WAIT');
  const resumed=produce(state,42,NOW+2*PRODUCER_RECHARGE_MS,()=>0);
  assert.equal(resumed.ok,true);
  assert.deepEqual(resumed.state.bag,state.bag,'no automatic cooldown card use');
  assert.equal(validateSave(resumed.state),true);
});
