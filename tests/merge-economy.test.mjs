import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, validateSave, moveOrMerge, produce, fulfillOrder, storeItem, withdrawItem,
  upgradeWarehouse, upgradeProducer, upgradeBuilding, upgradeLegacySave, advanceTime } from '../merge/engine.mjs';
import { createInitialState as createOld } from '../merge/legacy-engine.mjs';
import { loadLocal, SAVE_KEY, LEGACY_BACKUP_KEY } from '../merge/storage.mjs';
import { BUILDINGS, getLevel, getLevelProgress, getMaxOrderTier, getProducerUpgrade,
  estimateOrderEnergy, makeOrder, DROP_DISTRIBUTIONS } from '../merge/economy.mjs';
const start = () => createInitialState(1_000_000);
const rich = (coins=1000, xp=1200) => { const s=start();s.coins=coins;s.xp=xp;return s; };

test('XP thresholds, unlock caps and producer upgrade gates use stable constants', () => {
  assert.equal(getLevel(0),1);assert.equal(getLevel(28),2);assert.equal(getLevel(1399),7);
  assert.equal(getLevel(1400),8);assert.equal(getLevelProgress(90).level,3);
  assert.equal(getMaxOrderTier(0),2);assert.equal(getMaxOrderTier(90),3);
  assert.equal(getMaxOrderTier(1400),6);assert.equal(getProducerUpgrade(1).coins,70);
  assert.equal(getProducerUpgrade(3),null);
});

test('orders never exceed level cap and rotate all available producer chains',()=>{
  for(const xp of [0,28,90,190,350,590,920,1400]){
    const sequence=Array.from({length:100},(_,index)=>makeOrder(index,xp));
    assert.ok(sequence.every(o=>o.tier<=getMaxOrderTier(xp) && o.tier>=2 && o.coins>=0 && o.xp>=0));
    assert.deepEqual(new Set(sequence.map(o=>o.chain)),new Set(['tea','bakery','floral']));
    assert.equal(new Set(sequence.map(o=>o.id)).size,100);
  }
  for(let tier=1;tier<=6;tier++)assert.ok(estimateOrderEnergy(tier)>=2);
});

test('an order pays only once, new orders reflect level unlock, and grants match advertised rewards',()=>{
  const s=start();const reward=s.orders[0];
  const once=fulfillOrder(s,reward.id);
  assert.equal(once.ok,true);assert.equal(once.state.coins,reward.coins);assert.equal(once.state.xp,reward.xp);
  assert.equal(fulfillOrder(once.state,reward.id).ok,false);
  assert.equal(new Set(once.state.orders.map(o=>o.id)).size,3);
  assert.ok(once.state.orders.every(o=>o.tier<=getMaxOrderTier(once.state.xp)));
});

test('warehouse preserves material identity and refuses producers, full banks, and full boards',()=>{
  let s=start();const id=s.board[0].id;
  assert.equal(storeItem(s,42).ok,false);
  const r=storeItem(s,0);s=r.state;
  assert.equal(r.ok,true);assert.equal(s.board[0],null);assert.equal(s.warehouse.slots[0].id,id);
  assert.equal(withdrawItem(s,0).state.board[0].id,id);
  for(let i=0;i<4;i++)s=storeItem(s,[1,3,4,9][i]).state;
  assert.equal(storeItem(s,10).ok,false);
  assert.equal(validateSave(s),true);
  const full=structuredClone(s);
  for(let i=0;i<full.board.length;i++) if(!full.board[i])full.board[i]={id:`m${full.nextId++}`,kind:'material',chain:'tea',tier:1};
  assert.equal(withdrawItem(full,0).ok,false);
  assert.equal(validateSave(full),true);
});

test('warehouse upgrade has level and cost gates, exact debit, and capacity cap',()=>{
  let s=start();assert.equal(upgradeWarehouse(s).ok,false);
  s=rich(49,28);assert.equal(upgradeWarehouse(s).ok,false);
  s.coins=50;
  let r=upgradeWarehouse(s);assert.equal(r.ok,true);assert.equal(r.state.coins,0);
  assert.equal(r.state.warehouse.capacity,6);assert.equal(upgradeWarehouse(r.state).ok,false);
  s=rich(1000,350);s=upgradeWarehouse(s).state;s=upgradeWarehouse(s).state;
  assert.equal(s.warehouse.capacity,8);assert.equal(upgradeWarehouse(s).ok,false);
  assert.equal(validateSave(s),true);
});

test('producer upgrade changes distribution and rejects unavailable funds, levels and duplicates',()=>{
  let s=start();const id=s.board[42].id;assert.equal(upgradeProducer(s,id).ok,false);
  s=rich(70,28);const upgraded=upgradeProducer(s,id);
  assert.equal(upgraded.ok,true);assert.equal(upgraded.state.board[42].level,2);
  assert.equal(upgraded.state.coins,0);assert.equal(s.board[42].level,1);
  assert.equal(upgradeProducer(upgraded.state,id).ok,false);
  const p=produce(upgraded.state,42,1_000_000,()=>0.61);
  assert.equal(p.ok,true);assert.equal(p.state.board.find(x=>x?.kind==='material'&&x.id===`m${upgraded.state.nextId}`).tier,2);
  assert.deepEqual(DROP_DISTRIBUTIONS[3],[0.50,0.36,0.14]);
});

test('pity guarantees tier two no later than tenth low-tier roll',()=>{
  let s=start();const tiers=[];
  for(let i=0;i<10;i++) {
    const prev=s.nextId;
    s=produce(s,42,1_000_000,()=>0.01).state;
    tiers.push(s.board.find(item=>item?.id===`m${prev}`).tier);
  }
  assert.deepEqual(tiers,[1,1,1,1,1,1,1,1,1,2]);
  assert.equal(s.board[42].pity,0);
  assert.equal(validateSave(s),true);
});

test('buildings require economic prerequisites and exactly once state transition',()=>{
  let s=rich(1000,1200);assert.equal(upgradeBuilding(s,'oops').ok,false);
  const bonusBefore=makeOrder(10,s.xp,s.buildings).coins;
  const next=upgradeBuilding(s,'storefront');
  assert.equal(next.ok,true);assert.equal(next.state.coins,1000-BUILDINGS.storefront.coins);
  assert.equal(upgradeBuilding(next.state,'storefront').ok,false);
  assert.ok(makeOrder(10,next.state.xp,next.state.buildings).coins > bonusBefore);
  assert.equal(validateSave(next.state),true);
});

test('v1 save migrates without changing coin, xp, object ids or existing unlockable orders',()=>{
  const old=createOld(1_000_000);
  old.coins=46;old.xp=80;
  const upgraded=upgradeLegacySave(old);
  assert.equal(validateSave(upgraded),true);
  assert.equal(upgraded.coins,46);assert.equal(upgraded.xp,80);
  assert.equal(upgraded.board[42].id,old.board[42].id);
  assert.equal(upgraded.board[42].level,1);
  assert.equal(upgraded.warehouse.capacity,4);
  assert.ok(upgraded.orders.every(o=>o.tier<=getMaxOrderTier(upgraded.xp)));
  const memory=new Map([[SAVE_KEY,JSON.stringify(old)]]);
  const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
  const loaded=loadLocal(storage);
  assert.equal(loaded.recovered,true);assert.equal(loaded.migrated,true);
  assert.equal(JSON.parse(memory.get(LEGACY_BACKUP_KEY)).schemaVersion,1);
  assert.equal(loadLocal(storage).migrated,false);
});

test('legacy migration with advanced orders avoids duplicate active order ids',()=>{
  let old=createOld(1_000_000);
  // Recreate a long-running v1 campaign with order id gaps.
  old.orders=[{id:'o2',chain:'tea',tier:2,coins:12,xp:6},{id:'o5',chain:'bakery',tier:3,coins:30,xp:12},{id:'o7',chain:'floral',tier:3,coins:30,xp:12}];
  old.orderIndex=5;
  const upgraded=upgradeLegacySave(old);
  assert.equal(new Set(upgraded.orders.map(x=>x.id)).size,3);
  assert.equal(validateSave(upgraded),true);
});

test('roundtrip save rejects warehouse duplicates, illegal rank and duplicate producers',()=>{
  let s=storeItem(start(),0).state;
  assert.equal(validateSave(s),true);
  const dup=structuredClone(s);dup.board[1].id=dup.warehouse.slots[0].id;
  assert.equal(validateSave(dup),false);
  const producer=structuredClone(s);producer.board[42].level=9;
  assert.equal(validateSave(producer),false);
  const bad=structuredClone(s);bad.warehouse.slots[7]=bad.warehouse.slots[0];
  assert.equal(validateSave(bad),false);
});

test('3000 seeded randomized actions keep economy and inventory invariant',()=>{
  let s=rich(5000,1600),seed=872113;
  const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let i=0;i<3000;i++){
    let r;const slot=Math.floor(rand()*56),type=Math.floor(rand()*9);
    switch(type){
      case 0:r=moveOrMerge(s,slot,Math.floor(rand()*56));break;
      case 1:r=produce(s,slot,1_000_000+i*180_000,rand);break;
      case 2:r=fulfillOrder(s,s.orders[Math.floor(rand()*3)].id);break;
      case 3:r=storeItem(s,slot);break;
      case 4:r=withdrawItem(s,Math.floor(rand()*8));break;
      case 5:r=upgradeWarehouse(s);break;
      case 6:r=upgradeProducer(s,s.board[slot]?.id);break;
      case 7:r=upgradeBuilding(s,['storefront','garden','harbor'][Math.floor(rand()*3)]);break;
      default:s=advanceTime(s,1_000_000+i*180_000);continue;
    }
    s=r.state;
    assert.equal(validateSave(s),true,`tick ${i}`);
  }
});

test('migration remains usable in memory if backup writes are denied',()=>{
  const old=createOld(1_000_000);
  const storage={getItem:key=>key===SAVE_KEY?JSON.stringify(old):null,setItem:()=>{throw Error('Quota exceeded')}};
  const loaded=loadLocal(storage);
  assert.equal(loaded.recovered,true);
  assert.equal(loaded.migrated,true);
  assert.equal(loaded.volatile,true);
  assert.equal(validateSave(loaded.state),true);
});

test('no monetary debit on rejected building or production upgrade',()=>{
  const s=rich(0,1400);
  assert.equal(upgradeBuilding(s,'harbor').state,s);
  assert.equal(upgradeProducer(s,s.board[42].id).state,s);
  assert.equal(upgradeWarehouse(s).state,s);
  assert.equal(s.coins,0);
});