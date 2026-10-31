import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateFriction } from '../merge/economy-friction-simulator.mjs';
const base={seed:42,days:10,sessionsPerDay:2,sessionMinutes:8};
test('non-ideal campaigns are deterministic',()=>{
  assert.deepEqual(simulateFriction(base),simulateFriction(base));
});
test('economic conservation, bounds, and action ledger hold for all behavior profiles',()=>{
  for(const behavior of ['organized','casual','cluttered']) for(const policy of ['balanced','expand-first','save-coins','warehouse-only']) {
    const r=simulateFriction({...base,behavior,policy});
    assert.equal(r.final.coins,r.totals.earned-r.totals.spent);
    assert.equal(r.totals.actions,r.totals.produced+r.totals.merged+r.totals.orders+r.totals.upgrades+r.totals.stored+r.totals.withdrawn+r.totals.mistakes);
    assert.equal(r.totals.energySpent,r.totals.produced);
    assert.ok(r.final.boardOccupied<=56&&r.totals.maxOccupied<=56);
    assert.ok(r.final.warehouseUsed<=r.final.warehouseCapacity&&r.totals.maxWarehouseUsed<=8);
    assert.ok(r.final.energy>=0&&r.final.energy<=120);
    assert.ok(r.totals.blockedSessions<=r.totals.fullBoardSessions);
    assert.ok(r.totals.hardDeadlockSessions<=r.totals.blockedSessions);
    assert.ok(r.totals.fullBoardSessions<=r.scenario.days*r.scenario.sessionsPerDay);
    assert.ok(r.daily.every(x=>x.coins>=0&&x.occupied<=56&&x.warehouseUsed<=8));
    if(policy==='save-coins') assert.equal(r.totals.upgrades,0);
    if(policy==='warehouse-only') assert.ok(r.totals.upgrades<=2);
  }
});
test('30-day campaigns survive all profiles without fabricated currency',()=>{
  for(const seed of [1,42,2026]) for(const behavior of ['organized','casual','cluttered']) {
    const r=simulateFriction({seed,days:30,behavior,sessionsPerDay:2,sessionMinutes:12});
    assert.equal(r.daily.length,30);
    assert.equal(r.final.coins,r.totals.earned-r.totals.spent);
  }
});
test('rejects invalid seeds, profiles and schedules',()=>{
  for(const x of [{seed:-1},{seed:2**32},{days:0},{days:91},
    {sessionsPerDay:0},{sessionsPerDay:9},{sessionMinutes:0},{sessionMinutes:61},
    {behavior:'__proto__'},{behavior:'fake'},{policy:'fake'}]) assert.throws(()=>simulateFriction(x));
});
test('short and long runs share identical early days',()=>{
  const short=simulateFriction({...base,days:3});
  const long=simulateFriction({...base,days:30});
  assert.deepEqual(short.daily,long.daily.slice(0,3));
});
test('full-board stress does not silently delete inventory or grant progress',()=>{
  const stressed=simulateFriction({seed:42,days:30,behavior:'casual',policy:'save-coins'});
  const organized=simulateFriction({seed:42,days:30,behavior:'organized',policy:'save-coins'});
  assert.equal(stressed.final.boardOccupied,56);
  assert.equal(stressed.final.warehouseUsed,4);
  assert.equal(stressed.totals.blockedSessions,60);
  assert.ok(organized.totals.blockedSessions<stressed.totals.blockedSessions);
  assert.ok(organized.totals.orders>stressed.totals.orders);
});
test('warehouse-only comparison isolates storage upgrades from producer/building upgrades',()=>{
  const noUpgrade=simulateFriction({seed:42,days:30,behavior:'casual',policy:'save-coins'});
  const warehouse=simulateFriction({seed:42,days:30,behavior:'casual',policy:'warehouse-only'});
  assert.equal(noUpgrade.final.warehouseCapacity,4);
  assert.equal(warehouse.final.warehouseCapacity,8);
  assert.equal(warehouse.totals.upgrades,2);
  assert.equal(warehouse.totals.stored,8);
  assert.ok(warehouse.totals.stored>noUpgrade.totals.stored);
});