import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateFriction } from '../merge/economy-friction-simulator.mjs';

// This matrix uses real engine transitions and deterministic, deliberately
// imperfect heuristics. It does NOT estimate player retention or device behavior.
const seeds=[0,1,13,42,2026,7421,65535,0xffffffff];
const profiles=['organized','casual','cluttered'];
const policies=['balanced','save-coins'];

test('30-day multi-seed friction distinguishes behavioral stalls from true rule deadlocks',()=>{
  for(const seed of seeds)for(const behavior of profiles)for(const policy of policies){
    const r=simulateFriction({seed,behavior,policy,days:30,sessionsPerDay:2,sessionMinutes:12});
    const label=`seed=${seed} behavior=${behavior} policy=${policy}`;
    assert.equal(r.daily.length,30,label);
    assert.equal(r.final.coins,r.totals.earned-r.totals.spent,label);
    assert.equal(r.totals.blockedSessions,
      r.totals.behaviorBlockedSessions+r.totals.hardDeadlockSessions,label);
    assert.equal(r.totals.hardDeadlockSessions,
      r.daily.reduce((n,d)=>n+d.hardDeadlockSessions,0),label);
    assert.equal(r.totals.behaviorBlockedSessions,
      r.daily.reduce((n,d)=>n+d.behaviorBlockedSessions,0),label);
    assert.equal(r.totals.recoverableFullSessions,
      r.daily.reduce((n,d)=>n+d.recoverableFullSessions,0),label);
    assert.ok(r.totals.recoverableFullSessions<=60,label);
    assert.ok(['playable','waiting','recoverable','hard-deadlock'].includes(r.final.recovery),label);
    // A genuine rules-level deadlock is a release blocker, not a tolerated
    // "bad player" result. This must fail loudly if a seed ever reaches one.
    assert.equal(r.totals.hardDeadlockSessions,0,label);
  }
});

test('extreme low-efficiency 90-day sessions remain bounded and report recoverability',()=>{
  for(const seed of [1,42,2026,0xffffffff]){
    const r=simulateFriction({seed,behavior:'cluttered',policy:'save-coins',
      days:90,sessionsPerDay:1,sessionMinutes:5});
    assert.equal(r.daily.length,90);
    assert.equal(r.final.coins,r.totals.earned-r.totals.spent);
    assert.equal(r.totals.hardDeadlockSessions,0,`seed=${seed}`);
    assert.equal(r.totals.blockedSessions,
      r.totals.behaviorBlockedSessions+r.totals.hardDeadlockSessions);
    assert.ok(r.final.boardOccupied<=56);
    assert.ok(r.final.warehouseUsed<=r.final.warehouseCapacity);
    assert.ok(r.daily.every(d=>d.coins>=0&&d.occupied<=56));
  }
});

test('diagnostic counters and daily classification replay exactly',()=>{
  const options={seed:42,days:30,behavior:'casual',policy:'save-coins'};
  const a=simulateFriction(options),b=simulateFriction(options);
  assert.deepEqual(a,b);
  assert.ok(a.totals.blockedSessions>0);
  assert.ok(a.totals.behaviorBlockedSessions>0);
  assert.equal(a.totals.hardDeadlockSessions,0);
});
