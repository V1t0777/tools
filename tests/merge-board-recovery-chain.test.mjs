import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave,moveOrMerge,fulfillOrder,storeItem,
  withdrawItem,upgradeWarehouse,CELL_COUNT} from '../merge/engine.mjs';
import {getBoardGuidance} from '../merge/board-guidance.mjs';

const start=()=>createInitialState(1_000_000);
const material=(s,chain='tea',tier=6)=>({id:'m'+s.nextId++,kind:'material',chain,tier});
function crowded(s,{warehouse=false}={}){
  for(let i=0;i<CELL_COUNT;i++)if(!s.board[i])s.board[i]=material(s);
  for(const item of s.board)if(item?.kind==='material')item.tier=6;
  if(warehouse)for(let i=0;i<s.warehouse.capacity;i++)
    s.warehouse.slots[i]=material(s);
  for(const order of s.orders){order.chain='bakery';order.tier=2;}
  assert.equal(validateSave(s),true);
  return s;
}
const ids=s=>[...s.board,...s.warehouse.slots].filter(Boolean).map(x=>x.id).sort();

test('P2.65ba full board and full warehouse: affordable upgrade then storage creates real space',()=>{
  let s=crowded(start(),{warehouse:true});s.coins=500;s.xp=100;
  const beforeIds=ids(s),before=JSON.stringify(s);
  const first=getBoardGuidance(s);
  assert.equal(first.type,'upgradeWarehouse');
  assert.equal(first.warehouseUpgrade,true);
  assert.equal(JSON.stringify(s),before,'read-only advice cannot mutate state');
  const expanded=upgradeWarehouse(s);
  assert.equal(expanded.ok,true);
  s=expanded.state;
  assert.equal(s.warehouse.capacity,6);
  const second=getBoardGuidance(s);
  assert.equal(second.type,'store');
  assert.equal(second.boardSlots.length,1);
  const stored=storeItem(s,second.boardSlots[0]);
  assert.equal(stored.ok,true);
  s=stored.state;
  assert.equal(s.board.filter(Boolean).length,CELL_COUNT-1);
  assert.equal(s.warehouse.slots.filter(Boolean).length,5);
  assert.deepEqual(ids(s),beforeIds,'no item lost or fabricated');
  assert.equal(s.coins,450,'only the actual warehouse upgrade costs coins');
  assert.equal(s.revision,2);
  assert.equal(validateSave(s),true);
});

test('P2.65ba full board: store, withdraw hidden order, fulfill without deleting other items',()=>{
  let s=crowded(start());
  s.warehouse.slots[0]=material(s,'bakery',2);
  assert.equal(validateSave(s),true);
  const consumedId=s.warehouse.slots[0].id;
  const beforeIds=ids(s),order=s.orders[0],initialCoins=s.coins,initialXp=s.xp;
  const first=getBoardGuidance(s);
  assert.equal(first.type,'store');
  const stored=storeItem(s,first.boardSlots[0]);
  assert.equal(stored.ok,true);s=stored.state;
  const second=getBoardGuidance(s);
  assert.equal(second.type,'withdraw');
  assert.equal(second.warehouseSlot,0);
  const withdrawn=withdrawItem(s,second.warehouseSlot);
  assert.equal(withdrawn.ok,true);s=withdrawn.state;
  const third=getBoardGuidance(s);
  assert.equal(third.type,'order');
  const delivered=fulfillOrder(s,third.orderId);
  assert.equal(delivered.ok,true);s=delivered.state;
  assert.deepEqual(ids(s),beforeIds.filter(id=>id!==consumedId));
  assert.equal(s.coins,initialCoins+order.coins);
  assert.equal(s.xp,initialXp+order.xp);
  assert.equal(s.revision,3);
  assert.equal(s.board.filter(Boolean).length,CELL_COUNT-1);
  assert.equal(validateSave(s),true);
});

test('P2.65ba full board and full warehouse: merge then fulfill frees two cells',()=>{
  let s=crowded(start(),{warehouse:true});
  s.board[0].tier=1;s.board[1].tier=1;
  s.orders[0].chain='tea';s.orders[0].tier=2;
  assert.equal(validateSave(s),true);
  const initialCount=ids(s).length,initialCoins=s.coins,initialXp=s.xp;
  const order=s.orders[0],first=getBoardGuidance(s);
  assert.equal(first.type,'move');
  const merged=moveOrMerge(s,...first.boardSlots);
  assert.equal(merged.ok,true);assert.equal(merged.kind,'merge');s=merged.state;
  const second=getBoardGuidance(s);
  assert.equal(second.type,'order');
  assert.equal(second.orderId,order.id);
  const delivered=fulfillOrder(s,second.orderId);
  assert.equal(delivered.ok,true);s=delivered.state;
  assert.equal(ids(s).length,initialCount-2);
  assert.equal(s.board.filter(Boolean).length,CELL_COUNT-2);
  assert.equal(s.coins,initialCoins+order.coins);
  assert.equal(s.xp,initialXp+order.xp);
  assert.equal(s.revision,2);
  assert.equal(validateSave(s),true);
});
