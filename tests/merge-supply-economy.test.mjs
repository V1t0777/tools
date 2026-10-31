import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateSupplyEconomy} from '../merge/supply-economy-simulator.mjs';
import {SUPPLY_ITEMS} from '../merge/engine.mjs';

function expectConservation(result){
  assert.equal(result.daily.length,result.scenario.days);
  assert.equal(result.final.coins,result.totals.earned-result.totals.spent);
  assert.ok(result.final.energy>=0&&result.final.energy<=120);
  assert.ok(result.totals.actions<=result.scenario.days*
    result.scenario.sessionsPerDay*(result.scenario.actionsPerSession+4));
  assert.equal(result.totals.orders+result.totals.merges+result.totals.produced+
    result.totals.used+result.totals.purchases,result.totals.actions);
  for(const [id,rule] of Object.entries(SUPPLY_ITEMS)){
    assert.ok(result.final.purchases[id]>=0&&result.final.purchases[id]<=rule.limit);
    assert.ok(result.final.bag[id]>=0);
    assert.ok(result.final.consumed[id]>=0);
    const achievements={soda:'orders3',meal:'merges30',speed:'orders6',reset:'orders20'};
    assert.equal(result.final.bag[id]+result.final.consumed[id],
      result.final.purchases[id]+result.final.achievements[achievements[id]]);
    assert.equal(result.final.achievements[achievements[id]]===0||
      result.final.achievements[achievements[id]]===1,true);
  }
  assert.equal(result.totals.purchases,Object.values(result.final.purchases).reduce((x,y)=>x+y,0));
  assert.equal(result.totals.used,Object.values(result.final.consumed).reduce((x,y)=>x+y,0));
  assert.equal(result.totals.spent,Object.entries(SUPPLY_ITEMS).reduce((x,[id,item])=>
    x+item.price*result.final.purchases[id],0));
}

test('P2.9 30-day realistic sessions preserve coins and consumable conservation',()=>{
  for(const seed of [1,77,123456]){
    const result=simulateSupplyEconomy({seed,days:30,sessionsPerDay:3,actionsPerSession:140});
    expectConservation(result);
    assert.ok(result.totals.orders>=0);
  }
});

test('P2.9 90-day high-action stress cannot reset finite shop stock or reissue milestones',()=>{
  for(const seed of [7,2026]){
    const result=simulateSupplyEconomy({seed,days:90,sessionsPerDay:6,actionsPerSession:150});
    expectConservation(result);
    for(let i=1;i<result.daily.length;i++){
      assert.ok(result.daily[i].purchases>=result.daily[i-1].purchases);
      assert.ok(result.daily[i].orders>=result.daily[i-1].orders);
    }
    assert.ok(result.totals.purchases<=Object.values(SUPPLY_ITEMS).reduce((n,x)=>n+x.limit,0));
  }
});

test('P2.9 identical seed/schedule produces byte-identical long economy report',()=>{
  const options={seed:4294967295,days:30,sessionsPerDay:4,actionsPerSession:180};
  assert.deepEqual(simulateSupplyEconomy(options),simulateSupplyEconomy(options));
});

test('P2.9 simulation rejects unbounded or malformed budgets',()=>{
  for(const params of [{days:0},{days:91},{sessionsPerDay:7},
    {actionsPerSession:301},{seed:-1},{seed:Infinity},{seed:'7'},{days:1.5}]){
    assert.throws(()=>simulateSupplyEconomy(params),/Invalid/);
  }
});
