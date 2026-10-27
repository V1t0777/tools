import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';
import {SUPPLY_ITEMS} from '../merge/engine.mjs';

const seeds=[0,7,42,20261027,0xffffffff,...Array.from({length:11},(_,i)=>i*7919+1)];

test('P77 finite novice supplies replay remains deterministic and reaches every construction',()=>{
  let used=0;
  for(const seed of seeds){
    const result=simulateStoryBoard({seed,strategy:'novice-supplies',maxActions:10_000});
    assert.equal(result.complete,true,'seed '+seed+': '+result.reason);
    assert.deepEqual(result.milestones.map(x=>x.id),
      ['first-order','garden','harbor','storefront']);
    assert.deepEqual(simulateStoryBoard({seed,strategy:'novice-supplies',maxActions:10_000}),result);
    assert.ok(result.supplyPurchases<=SUPPLY_ITEMS.soda.limit);
    assert.equal(result.supplyCoinsSpent,result.supplyPurchases*SUPPLY_ITEMS.soda.price);
    assert.equal(result.purchaseAudit.length,result.supplyPurchases);
    assert.ok(result.cooldownCardsUsed<=2,'only two one-time cooldown card awards exist');
    assert.ok(result.supplyUses<=result.supplyPurchases+4,
      'no extra supplies beyond finite shop and four achievements');
    for(const purchase of result.purchaseAudit){
      assert.equal(purchase.price,SUPPLY_ITEMS.soda.price);
      assert.ok(purchase.coinsBefore-purchase.price>=purchase.reserve,
        'must preserve full next-building coin reserve');
    }
    used+=result.supplyUses;
  }
  assert.ok(used>0,'the scenario must actually exercise supply use');
});

test('P77 supply strategy is opt-in and rejects invalid strategies',()=>{
  const greedy=simulateStoryBoard({seed:42});
  const novice=simulateStoryBoard({seed:42,strategy:'novice'});
  assert.equal(greedy.supplyUses,0);
  assert.equal(novice.supplyUses,0);
  assert.equal(greedy.supplyPurchases,0);
  assert.equal(novice.supplyPurchases,0);
  assert.deepEqual(greedy.purchaseAudit,[]);
  assert.throws(()=>simulateStoryBoard({strategy:'novice-unlimited'}),RangeError);
});
