import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge,fulfillOrder,advanceTime,useSupply,
  purchaseSupply,validateSave,MAX_ENERGY,PRODUCER_CHARGES,SUPPLY_ITEMS,ACHIEVEMENT_RULES
} from '../merge/engine.mjs';

const clock=1_000_000;
const start=()=>createInitialState(clock);
const earned=(state,id,count)=>{
  const a=structuredClone(state);
  const rules=ACHIEVEMENT_RULES.filter(x=>x.reward===id);
  for(const r of rules){
    a.progress[r.counter]=Math.max(a.progress[r.counter],r.threshold);
    for(const prior of ACHIEVEMENT_RULES.filter(x=>x.counter===r.counter && x.threshold<=r.threshold))
      a.achievements[prior.id]=1;
  }
  a.bag[id]=count;
  assert.equal(validateSave(a),true);
  return a;
};

test('P2.9 starts with 120 energy, zero supplies, bounded lifetime shop and valid snapshot',()=>{
  const s=start();
  assert.equal(MAX_ENERGY,120);
  assert.equal(s.energy,120);
  assert.equal(validateSave(s),true);
  assert.deepEqual(Object.keys(s.bag),Object.keys(SUPPLY_ITEMS));
  assert.ok(Object.values(s.bag).every(v=>v===0));
  assert.ok(Object.values(s.shop.purchases).every(v=>v===0));
});

test('P2.9 normal matching merge awards meal at threshold 30 exactly once',()=>{
  let s=start();s.progress.merges=29;
  const done=moveOrMerge(s,0,1);
  assert.equal(done.ok,true);
  assert.equal(done.state.bag.meal,1);
  assert.equal(done.state.achievements.merges30,1);
  s=moveOrMerge(done.state,3,4).state;
  assert.equal(s.bag.meal,1);
  assert.equal(s.progress.merges,31);
  assert.equal(validateSave(s),true);
  assert.equal(done.state.revision,s.revision-1);
});

test('P2.9 three delivered orders grant soda without changing coins or xp rewards',()=>{
  const s=start();s.progress.orders=2;
  const o=s.orders[0],r=fulfillOrder(s,o.id);
  assert.equal(r.ok,true);
  assert.equal(r.state.bag.soda,1);
  assert.equal(r.state.achievements.orders3,1);
  assert.equal(r.state.coins,o.coins);
  assert.equal(r.state.xp,o.xp);
  assert.equal(fulfillOrder(r.state,o.id).ok,false);
  assert.equal(r.state.bag.soda,1);
  assert.equal(validateSave(r.state),true);
});

test('P2.9 sixth order grants acceleration, twentieth order grants instant reset',()=>{
  const s=start();s.progress.orders=5;s.achievements.orders3=1;
  const sixth=fulfillOrder(s,s.orders[0].id).state;
  assert.equal(sixth.bag.speed,1);assert.equal(sixth.achievements.orders6,1);
  assert.equal(validateSave(sixth),true);
  const hi=start();hi.progress.orders=19;hi.achievements.orders3=1;hi.achievements.orders6=1;
  const twentieth=fulfillOrder(hi,hi.orders[0].id).state;
  assert.equal(twentieth.bag.reset,1);assert.equal(twentieth.achievements.orders20,1);
  assert.equal(validateSave(twentieth),true);
});

test('P2.9 energy consumables reject full bar, restore exact amount and cap at 120',()=>{
  let s=earned(start(),'soda',1);
  assert.equal(useSupply(s,'soda',null,clock).ok,false);
  s.energy=100;s.energyAt=clock;
  const r=useSupply(s,'soda',null,clock);
  assert.equal(r.ok,true);assert.equal(r.state.energy,120);assert.equal(r.state.bag.soda,0);
  assert.equal(r.state.energyAt,clock);
  assert.equal(useSupply(r.state,'soda',null,clock).ok,false);
  assert.equal(validateSave(r.state),true);
  let meal=earned(start(),'meal',1);meal.energy=10;
  const m=useSupply(meal,'meal',null,clock);
  assert.equal(m.ok,true);assert.equal(m.state.energy,70);
  assert.equal(m.state.bag.meal,0);
});

test('P2.9 acceleration halves only a selected producer cooldown, without extra charges',()=>{
  let s=earned(start(),'speed',1);
  s.board[42].charges=0;s.board[42].cooldownUntil=clock+40_000;
  const r=useSupply(s,'speed',s.board[42].id,clock);
  assert.equal(r.ok,true);
  assert.equal(r.state.board[42].cooldownUntil,clock+20_000);
  assert.equal(r.state.board[42].charges,0);
  assert.equal(r.state.bag.speed,0);
  assert.equal(r.state.board[44].charges,PRODUCER_CHARGES);
  assert.equal(validateSave(r.state),true);
});

test('P2.9 instant reset only works on active cooldown and restores precisely once',()=>{
  let s=earned(start(),'reset',1);
  s.board[42].charges=0;s.board[42].cooldownUntil=clock+45_000;
  const r=useSupply(s,'reset',s.board[42].id,clock);
  assert.equal(r.ok,true);assert.equal(r.state.board[42].charges,PRODUCER_CHARGES);
  assert.equal(r.state.board[42].cooldownUntil,0);
  assert.equal(useSupply(r.state,'reset',s.board[42].id,clock).ok,false);
  assert.equal(validateSave(r.state),true);
});

test('P2.9 unusable items do not spend inventory or revisions',()=>{
  const s=earned(start(),'speed',1);
  for(const [item,id] of [['speed',s.board[42].id],['speed','unknown'],['unknown',null]]){
    const r=useSupply(s,item,id,clock);
    assert.equal(r.ok,false);
    assert.equal(s.bag.speed,1);
    assert.equal(s.revision,0);
  }
  assert.equal(useSupply(s,'soda',null,clock).ok,false);
  assert.equal(useSupply(s,'reset',null,Number.NaN).ok,false);
});

test('P2.9 shop finite stock, exact coins and no refresh with time',()=>{
  let s=start();s.coins=10000;
  let spent=0;
  for(const [id,item] of Object.entries(SUPPLY_ITEMS)){
    for(let i=0;i<item.limit;i++){
      const before=s;
      const result=purchaseSupply(s,id);
      assert.equal(result.ok,true);
      s=result.state;
      assert.equal(s.coins,before.coins-item.price);
      assert.equal(s.shop.purchases[id],i+1);
      spent+=item.price;
    }
    assert.equal(purchaseSupply(s,id).ok,false);
  }
  assert.equal(s.coins,10000-spent);
  assert.equal(validateSave(s),true);
  s=advanceTime(s,clock+1000*86_400_000);
  assert.ok(Object.entries(SUPPLY_ITEMS).every(([id,item])=>s.shop.purchases[id]===item.limit));
  assert.equal(purchaseSupply(s,'soda').ok,false);
});

test('P2.9 shop never grants currency and fails closed for wrong item and missing funds',()=>{
  const s=start();
  assert.equal(purchaseSupply(s,'soda').ok,false);
  assert.equal(purchaseSupply(s,'unknown').ok,false);
  assert.equal(s.coins,0);
  const rich=start();rich.coins=90;
  const bought=purchaseSupply(rich,'soda');
  assert.equal(bought.ok,true);
  assert.equal(bought.state.coins,0);
  assert.equal(bought.state.bag.soda,1);
  assert.equal(bought.state.revision,1);
  assert.equal(validateSave(bought.state),true);
});

test('P2.9 snapshot rejects forged inventory, overbuying and achievement mismatch',()=>{
  for(const mutate of [
    x=>{x.bag.soda=1},
    x=>{x.shop.purchases.soda=5},
    x=>{x.progress.orders=3},
    x=>{x.achievements.orders3=1},
    x=>{x.shop.purchases.meal=1;x.bag.meal=2},
    x=>{x.bag.speed=-1},
    x=>{x.bag.reset=Infinity},
    x=>{delete x.bag.soda}
  ]){
    const s=start();mutate(s);
    assert.equal(validateSave(s),false);
  }
});

test('P2.9 finite shop cannot be repeated by purchasing then consuming',()=>{
  let s=start();s.coins=20000;
  const price=SUPPLY_ITEMS.soda.price;
  for(let i=0;i<30;i++){
    const buy=purchaseSupply(s,'soda');
    if(!buy.ok)break;
    s=buy.state;
    s.energy=0;s.energyAt=clock;
    s=useSupply(s,'soda',null,clock).state;
    assert.equal(validateSave(s),true);
  }
  assert.equal(s.shop.purchases.soda,SUPPLY_ITEMS.soda.limit);
  assert.equal(s.coins,20000-price*SUPPLY_ITEMS.soda.limit);
  assert.equal(s.bag.soda,0);
});
