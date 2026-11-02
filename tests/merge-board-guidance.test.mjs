import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, validateSave, moveOrMerge, fulfillOrder, storeItem,
  withdrawItem, upgradeWarehouse, produce, CELL_COUNT } from '../merge/engine.mjs';
import { discardDeadlockedMaterial } from '../merge/deadlock-rescue.mjs';
import { getBoardGuidance } from '../merge/board-guidance.mjs';
const start = () => createInitialState(1_000_000);
const makeItem = (s,chain='tea',tier=6) => ({id:'m'+s.nextId++,kind:'material',chain,tier});
function fillBoard(s) { for(let i=0;i<CELL_COUNT;i++) if(!s.board[i])s.board[i]=makeItem(s); return s; }
function fullWarehouse(s) { for(let i=0;i<s.warehouse.capacity;i++) if(!s.warehouse.slots[i])s.warehouse.slots[i]=makeItem(s); return s; }
function blockOrder(s) {s.orders.forEach(o=>{o.tier=2;o.chain='bakery'});return s;}

test('guidance describes a deliverable without changing player state',()=>{
  const s=start(), bytes=JSON.stringify(s);const g=getBoardGuidance(s);
  assert.equal(g.type,'order');assert.equal(g.orderId,'o0');assert.deepEqual(g.boardSlots,[]);
  assert.equal(g.revision,0);assert.equal(JSON.stringify(s),bytes);
  assert.equal(fulfillOrder(s,g.orderId).ok,true);
});
test('recommendation of merge highlights real compatible slots',()=>{
  const s=start();s.orders.forEach(o=>{o.tier=6;});
  const g=getBoardGuidance(s);assert.equal(g.type,'move');assert.equal(g.boardSlots.length,2);
  assert.equal(moveOrMerge(s,...g.boardSlots).kind,'merge');
});
test('warehouse can offer an order item for withdrawal',()=>{
  let s=start();s=storeItem(s,16).state;
  s.orders.forEach(o=>{o.chain='tea';o.tier=2;});
  s.board[0].tier=6;s.board[1].tier=5;s.board[3].tier=4;s.board[4].tier=3;
  s.board[9].tier=5;s.board[10].tier=4;s.board[18].tier=5;
  const g=getBoardGuidance(s);assert.equal(g.type,'withdraw');assert.equal(g.warehouseSlot,0);
  assert.equal(withdrawItem(s,g.warehouseSlot).ok,true);
});
test('full board suggests storage when warehouse has free space',()=>{
  const s=fillBoard(blockOrder(start()));
  for(const v of s.board)if(v?.kind==='material')v.tier=6;
  assert.equal(validateSave(s),true);
  const g=getBoardGuidance(s);assert.equal(g.type,'store');assert.equal(g.boardSlots.length,1);
  assert.equal(storeItem(s,g.boardSlots[0]).ok,true);
});
test('full board and full warehouse offers affordable expansion',()=>{
  const s=fullWarehouse(fillBoard(blockOrder(start())));
  for(const v of s.board)if(v?.kind==='material')v.tier=6;
  s.coins=500;s.xp=100;assert.equal(validateSave(s),true);
  const g=getBoardGuidance(s);assert.equal(g.type,'upgradeWarehouse');
  assert.equal(g.warehouseUpgrade,true);assert.equal(upgradeWarehouse(s).ok,true);
});
test('without any recovery reports a true blocked state and never resets',()=>{
  const s=fullWarehouse(fillBoard(blockOrder(start())));
  for(const v of s.board)if(v?.kind==='material')v.tier=6;
  const bytes=JSON.stringify(s),g=getBoardGuidance(s);
  assert.equal(g.type,'no-path');assert.equal(g.recovery,'hard-deadlock');
  assert.match(g.message,/保留存档/);assert.equal(JSON.stringify(s),bytes);
});
test('empty board with ready producer suggests production safely',()=>{
  const s=start();s.board.forEach((x,i)=>{if(x?.kind==='material')s.board[i]=null;});
  assert.equal(validateSave(s),true);
  const g=getBoardGuidance(s);assert.equal(g.type,'produce');
  assert.equal(s.board[g.boardSlots[0]].kind,'producer');
});
test('no energy makes waiting guide, no invented resources',()=>{
  const s=start();s.board.forEach((x,i)=>{if(x?.kind==='material')s.board[i]=null;});
  s.energy=0;const g=getBoardGuidance(s);
  assert.equal(g.type,'wait');assert.deepEqual(g.boardSlots,[]);assert.equal(s.energy,0);
});
test('invalid saves rejected rather than fabricated advice',()=>{
  assert.throws(()=>getBoardGuidance({board:[]}));
});
test('suggestions deterministic and contain no executable callbacks',()=>{
  const s=start(),a=getBoardGuidance(s),b=getBoardGuidance(s);
  assert.deepEqual(a,b);assert.ok(!JSON.stringify(a).includes('function'));
});


test('deadlock rescue guidance targets a pending order and enables a real delivery',()=>{
  const s=fullWarehouse(fillBoard(blockOrder(start())));
  for(const item of s.board)if(item?.kind==='material')item.tier=6;
  s.coins=7;s.xp=30;
  assert.equal(validateSave(s),true);
  assert.equal(getBoardGuidance(s).recovery,'hard-deadlock');
  let current=s;
  const originalCoins=s.coins,originalXp=s.xp;
  for(let i=0;i<2;i++){
    const slot=current.board.findIndex(item=>item?.kind==='material'&&item.tier===6);
    const beforeRevision=current.revision,expectedItemId=current.board[slot].id;
    const discarded=discardDeadlockedMaterial(current,slot,{confirmed:true,expectedItemId});
    assert.equal(discarded.ok,true);
    current=discarded.state;
    assert.equal(current.revision,beforeRevision+1);
    assert.equal(current.coins,originalCoins);
    assert.equal(current.xp,originalXp);
    const bytes=JSON.stringify(current),guidance=getBoardGuidance(current);
    assert.equal(guidance.type,'produce');
    assert.deepEqual(guidance.boardSlots,[44]);
    assert.match(guidance.message,/当前委托/);
    assert.equal(JSON.stringify(current),bytes,'guidance must be read-only');
    const produced=produce(current,44,1_000_000+i*4_000,()=>0.1);
    assert.equal(produced.ok,true);
    current=produced.state;
    assert.equal(validateSave(current),true);
  }
  const merge=getBoardGuidance(current);
  assert.equal(merge.type,'move');
  const merged=moveOrMerge(current,...merge.boardSlots);
  assert.equal(merged.kind,'merge');
  current=merged.state;
  const ready=getBoardGuidance(current);
  assert.equal(ready.type,'order');
  const delivered=fulfillOrder(current,ready.orderId);
  assert.equal(delivered.ok,true);
  assert.equal(validateSave(delivered.state),true);
  assert.ok(delivered.state.coins>originalCoins);
  assert.ok(delivered.state.xp>originalXp);
});

test('cooling order producer retains a truthful generic fallback hint',()=>{
  const s=start();
  s.board=s.board.map(item=>item?.kind==='producer'?item:null);
  s.orders.forEach(order=>{order.chain='bakery';order.tier=2;});
  const bakery=s.board.find(item=>item?.kind==='producer'&&item.chain==='bakery');
  bakery.charges=0;bakery.cooldownUntil=1_200_000;
  assert.equal(validateSave(s),true);
  const hint=getBoardGuidance(s);
  assert.equal(hint.type,'produce');
  assert.deepEqual(hint.boardSlots,[42]);
  assert.doesNotMatch(hint.message,/当前委托/);
});
