import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave,fulfillOrder,upgradeWarehouse,storeItem,produce,MAX_TIER} from '../merge/engine.mjs';
import {describeStoryWorkshopStall} from '../merge/story/resource-recovery.mjs';

const NOW=1_000_000;
function fullBoardAndWarehouse(){
  const state=createInitialState(NOW);
  state.board=state.board.map(item=>item?.kind==='producer'?item:
    {id:'m'+state.nextId++,kind:'material',chain:'tea',tier:MAX_TIER});
  for(let i=0;i<state.warehouse.capacity;i++)
    state.warehouse.slots[i]={id:'m'+state.nextId++,kind:'material',chain:'floral',tier:MAX_TIER};
  assert.equal(validateSave(state),true,'pressure fixture must be a structurally valid save');
  return state;
}

test('P142 full board offers an existing deliverable order before claiming deadlock',()=>{
  const state=fullBoardAndWarehouse(),order=state.orders[0];
  const slot=state.board.findIndex(item=>item?.kind==='material');
  state.board[slot]={...state.board[slot],chain:order.chain,tier:order.tier};
  assert.equal(validateSave(state),true);
  const before=structuredClone(state);
  const hint=describeStoryWorkshopStall(state,NOW);
  assert.equal(hint.code,'BOARD_FULL_DELIVER');
  assert.match(hint.message,/交付/);
  assert.deepEqual(state,before,'diagnosis must not modify the save');
  const delivered=fulfillOrder(state,order.id);
  assert.equal(delivered.ok,true);
  assert.equal(delivered.state.board.filter(Boolean).length,55);
  assert.equal(validateSave(delivered.state),true);
});

test('P142 full warehouse can use a legal paid upgrade, then store and produce',()=>{
  const state=fullBoardAndWarehouse();
  state.xp=28;state.coins=50;
  assert.equal(validateSave(state),true);
  const before=structuredClone(state);
  const hint=describeStoryWorkshopStall(state,NOW);
  assert.equal(hint.code,'BOARD_FULL_UPGRADE');
  assert.match(hint.message,/50金币/);
  assert.deepEqual(state,before,'the hint cannot spend coins');
  const upgraded=upgradeWarehouse(state);
  assert.equal(upgraded.ok,true);
  assert.equal(upgraded.state.coins,0);
  assert.equal(upgraded.state.warehouse.capacity,6);
  const stored=storeItem(upgraded.state,0);
  assert.equal(stored.ok,true);
  const produced=produce(stored.state,42,NOW,()=>0);
  assert.equal(produced.ok,true);
  assert.equal(validateSave(produced.state),true);
});

test('P142 no deliverable, merge, store or affordable upgrade remains protected',()=>{
  const state=fullBoardAndWarehouse(),before=structuredClone(state);
  assert.equal(describeStoryWorkshopStall(state,NOW).code,'BOARD_FULL_BLOCKED');
  assert.equal(fulfillOrder(state,state.orders[0].id).ok,false);
  assert.equal(upgradeWarehouse(state).ok,false);
  assert.deepEqual(state,before);
});

test('P142 proactive warehouse guidance is read-only and shares the same diagnosis',()=>{
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.match(ui,/const fullBoardGuidance=!boardHasSpace\?describeStoryWorkshopStall\(state,Date\.now\(\)\):null/);
  assert.match(ui,/fullBoardGuidance\?\.message/);
  assert.ok(ui.includes('棋盘和仓库都满'));
  const source=readFileSync(new URL('../merge/story/resource-recovery.mjs',import.meta.url),'utf8');
  for(const forbidden of ['localStorage','sessionStorage','setItem(','fetch(','sendBeacon(','purchaseSupply(','writeStoryWorkshop('])
    assert.equal(source.includes(forbidden),false,forbidden);
});
