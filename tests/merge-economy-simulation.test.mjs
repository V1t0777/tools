import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateEconomy } from '../merge/economy-simulator.mjs';

const opts={seed:7421,days:14,sessionsPerDay:2,sessionMinutes:12};

test('simulation is byte-for-byte deterministic for the same seed and schedule',()=>{
  assert.deepEqual(simulateEconomy(opts),simulateEconomy(opts));
});
test('simulation never fabricates currency or exceeds bounded resource levels',()=>{
  for(const policy of ['balanced','save-coins','expand-first']) {
    const r=simulateEconomy({...opts,policy});
    assert.equal(r.final.coins,r.totals.earned-r.totals.spent);
    assert.ok(r.final.energy>=0 && r.final.energy<=120);
    assert.ok(r.final.boardOccupied<=56 && r.totals.maxOccupied<=56);
    assert.ok(r.daily.every(d=>d.coins>=0 && d.xp>=0 && d.occupied<=56));
    assert.ok(r.daily.every((d,i)=>i===0 || d.xp>=r.daily[i-1].xp));
    assert.ok(r.daily.every((d,i)=>i===0 || d.level>=r.daily[i-1].level));
    assert.equal(r.totals.actions,r.totals.produced+r.totals.merged+r.totals.orders+r.totals.upgrades);
    assert.equal(r.totals.energySpent,r.totals.produced);
  }
});
test('saving coins never buys upgrades; all upgrade counts reconcile',()=>{
  const saving=simulateEconomy({...opts,policy:'save-coins'});
  assert.equal(saving.totals.upgrades,0);
  assert.equal(saving.totals.spent,0);
  const balanced=simulateEconomy({...opts,policy:'balanced'});
  assert.equal(balanced.totals.upgrades,balanced.totals.warehouseUpgrades+balanced.totals.producerUpgrades+balanced.totals.buildings);
});
test('longer campaigns include every day and keep nondecreasing lifetime orders',()=>{
  const short=simulateEconomy({...opts,days:3});
  const long=simulateEconomy({...opts,days:30});
  assert.equal(short.daily.length,3);
  assert.equal(long.daily.length,30);
  assert.ok(long.totals.orders>=short.totals.orders);
  assert.ok(long.totals.produced>=short.totals.produced);
  assert.deepEqual(long.daily.slice(0,3),short.daily);
});
test('seeded campaign matrix survives 30-day stress without invalid states',()=>{
  for(const seed of [1,2,13,42,2026,0xffffffff]) {
    const r=simulateEconomy({seed,days:30,sessionsPerDay:3,sessionMinutes:15,policy:'expand-first'});
    assert.equal(r.daily.length,30);
    assert.equal(r.final.coins,r.totals.earned-r.totals.spent);
    assert.ok(r.totals.actions<30*3*800);
  }
});
test('rejects invalid budgets, seeds and policy rather than silently truncating',()=>{
  for(const options of [{seed:-1},{seed:2**32},{days:0},{days:91},
    {sessionsPerDay:0},{sessionsPerDay:9},{sessionMinutes:0},
    {sessionMinutes:61},{sessionsPerDay:8,sessionMinutes:61},{policy:'cheat'}]) {
    assert.throws(()=>simulateEconomy(options));
  }
});

// P2.9 reviewed baseline: +50% energy ceiling changes achievable actions; retain exact ledger golden.
test('golden 30-day campaign captures baseline economy drift for explicit review',()=>{
  const r=simulateEconomy({seed:42,days:30,sessionsPerDay:2,sessionMinutes:12,policy:'balanced'});
  // Baseline numbers are not balance targets. A change requires reviewing the report.
  assert.deepEqual({orders:r.totals.orders,produced:r.totals.produced,
    upgrades:r.totals.upgrades,spent:r.totals.spent,coins:r.final.coins,
    maxLevelDay:r.milestones.level8},
    {orders:2082,produced:7380,upgrades:11,spent:1490,coins:103688,maxLevelDay:1});
});