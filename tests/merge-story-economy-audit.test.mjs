import test from 'node:test';
import assert from 'node:assert/strict';
import {projectStoryEconomy} from '../merge/story/economy-audit.mjs';
import {BUILDINGS,getLevel,makeOrder} from '../merge/economy.mjs';
import {MAX_ENERGY,ENERGY_REGEN_MS} from '../merge/engine.mjs';

test('both deterministic story-order strategies reach all three real building gates',()=>{
  for(const selection of ['fifo','lowest-energy']){
    const result=projectStoryEconomy({selection});
    assert.equal(result.complete,true);
    assert.deepEqual(result.milestones.map(x=>x.id),
      ['first-order','garden','harbor','storefront']);
    const [,garden,harbor,storefront]=result.milestones;
    assert.ok(garden.orders>=8&&garden.orders<=30);
    assert.ok(harbor.orders>=25&&harbor.orders<=75);
    assert.equal(harbor.orders,storefront.orders,
      'storefront is affordable after harbor in these optimistic policies');
    assert.equal(garden.buildCost,BUILDINGS.garden.coins);
    assert.equal(harbor.buildCost,BUILDINGS.harbor.coins);
    assert.equal(storefront.buildCost,BUILDINGS.storefront.coins);
    assert.ok(garden.level>=BUILDINGS.garden.minLevel);
    assert.ok(harbor.level>=BUILDINGS.harbor.minLevel);
    assert.ok(storefront.level>=BUILDINGS.storefront.minLevel);
    assert.equal(result.coinsSpent,160+330+60);
    assert.equal(result.coinsEarned-result.coinsSpent,result.coins);
    assert.equal(result.estimatedEnergy,storefront.estimatedEnergy);
    assert.equal(result.estimatedPassiveRegenMinutes,
      Math.max(0,result.estimatedEnergy-MAX_ENERGY)*ENERGY_REGEN_MS/60000);
    assert.ok(result.estimatedEnergy>MAX_ENERGY,
      'progress consumes more than the initial pool in this optimistic model');
    assert.ok(Object.isFrozen(result.milestones));
    for(const step of result.milestones){
      assert.ok(step.coins>=0);
      assert.equal(getLevel(step.xp),step.level);
      assert.equal(step.coinsEarned-step.coinsSpent,step.coins);
    }
  }
});
test('projection is stable, intentionally optimistic and does not mutate normal/gameplay state',()=>{
  const a=projectStoryEconomy({selection:'fifo'}),b=projectStoryEconomy({selection:'fifo'});
  assert.deepEqual(a,b);
  const target=makeOrder(0,0,{storefront:0,garden:0,harbor:0});
  assert.equal(a.milestones[0].coinsEarned,target.coins);
  assert.equal(a.milestones[0].xp,target.xp);
  assert.equal(a.milestones[0].estimatedEnergy,target.estimatedEnergy);
  assert.match(a.limitations,/未模拟棋盘/);
});
test('truncated projections fail visibly; option input is strictly bounded',()=>{
  const result=projectStoryEconomy({maxOrders:1});
  assert.equal(result.complete,false);
  assert.deepEqual(result.milestones.map(x=>x.id),['first-order']);
  for(const options of [{selection:'unlimited'}, {maxOrders:0},{maxOrders:1001},
    {maxOrders:Infinity},{maxOrders:1.2}]){
    assert.throws(()=>projectStoryEconomy(options),RangeError);
  }
});
