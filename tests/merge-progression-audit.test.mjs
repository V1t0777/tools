import test from 'node:test';
import assert from 'node:assert/strict';
import {auditProgression} from '../merge/progression-audit.mjs';
import {createInitialState,validateSave,MAX_ENERGY} from '../merge/engine.mjs';
import {SUPPLY_ITEMS,ACHIEVEMENT_RULES} from '../merge/supplies.mjs';

const baseline={seed:42,days:30,sessionsPerDay:2,sessionMinutes:12,behavior:'casual'};

function checkReport(report){
  const {assumptions,scenarios,supplyBalance,cautions}=report;
  assert.equal(assumptions.maximumLevel,8);
  assert.equal(assumptions.maximumLevelXp,1400);
  assert.equal(assumptions.energyCap,MAX_ENERGY);
  assert.equal(assumptions.saveCompatibility,'NO_RULE_CHANGES');
  assert.equal(assumptions.supplyActionsPerSession,assumptions.sessionMinutes*6);
  for(const name of ['ideal','friction','supply']){
    const item=scenarios[name];
    assert.ok(item.dayOneLevel>=1&&item.dayOneLevel<=assumptions.maximumLevel);
    assert.ok(item.finalLevel>=item.dayOneLevel&&item.finalLevel<=assumptions.maximumLevel);
    assert.ok(item.dayOneOrders>=0&&item.completedOrders>=item.dayOneOrders);
    assert.ok(item.produced>=0);
    assert.ok(item.finalXp>=0);
    assert.equal(item.finalCoins,item.earnedCoins-item.spentCoins);
    assert.ok(item.capReachedDay===null||item.capReachedDay>=1&&item.capReachedDay<=assumptions.days);
    if(item.capReachedDay!==null)assert.equal(item.finalLevel,assumptions.maximumLevel);
  }
  assert.ok(supplyBalance.purchased<=Object.values(SUPPLY_ITEMS).reduce((n,item)=>n+item.limit,0));
  assert.ok(supplyBalance.achievementsClaimed<=ACHIEVEMENT_RULES.length);
  assert.equal(supplyBalance.remaining+supplyBalance.consumed,
    supplyBalance.purchased+supplyBalance.achievementsClaimed);
  assert.equal(supplyBalance.shopCoinsSpent,scenarios.supply.spentCoins);
  assert.equal(cautions.includes('IDEAL_CAP_DAY_ONE'),scenarios.ideal.capReachedDay===1);
  assert.equal(cautions.includes('FRICTION_CAP_DAY_ONE'),scenarios.friction.capReachedDay===1);
  assert.equal(cautions.includes('SUPPLY_CAP_DAY_ONE'),scenarios.supply.capReachedDay===1);
}

test('P2.11 compares real-engine ideal, casual and finite-stock sessions without changing game rules',()=>{
  const report=auditProgression(baseline);
  checkReport(report);
  const state=createInitialState(1_000_000);
  assert.equal(state.energy,120);
  assert.equal(state.xp,0);
  assert.equal(state.schemaVersion,3);
  assert.equal(validateSave(state),true);
});

test('P2.11 audit is reproducible for the same seed and does not mutate input',()=>{
  const config={...baseline,days:7,seed:777};
  const before=structuredClone(config);
  const a=auditProgression(config),b=auditProgression(config);
  assert.deepEqual(a,b);
  assert.deepEqual(config,before);
  checkReport(a);
});

test('P2.11 single-day boundary preserves day-one milestone semantics',()=>{
  const report=auditProgression({...baseline,days:1});
  checkReport(report);
  for(const item of Object.values(report.scenarios)){
    assert.ok(item.capReachedDay===null||item.capReachedDay===1);
    assert.equal(item.dayOneLevel,item.finalLevel);
  }
});

test('P2.11 30-day audit detects documented ideal-model early cap without changing thresholds',()=>{
  const report=auditProgression(baseline);
  checkReport(report);
  assert.equal(report.scenarios.ideal.capReachedDay,1);
  assert.ok(report.cautions.includes('IDEAL_CAP_DAY_ONE'));
  assert.equal(report.scenarios.ideal.dayOneLevel,8);
  // Diagnostic results are model output, not evidence of real-user play rates.
  process.stdout.write('P2.11_30_DAY_REPORT '+JSON.stringify({
    input:report.assumptions,
    profiles:Object.fromEntries(Object.entries(report.scenarios).map(([id,item])=>
      [id,{capReachedDay:item.capReachedDay,dayOneLevel:item.dayOneLevel,
        dayOneOrders:item.dayOneOrders,orders:item.completedOrders,
        earnedCoins:item.earnedCoins,spentCoins:item.spentCoins}])),
    supplyBalance:report.supplyBalance,cautions:report.cautions
  })+'\n');
});

test('P2.11 90-day finite supply economy remains bounded under multi-profile play',()=>{
  const report=auditProgression({...baseline,days:90,seed:77,behavior:'organized'});
  checkReport(report);
  assert.ok(report.supplyBalance.purchased<=9);
  assert.ok(report.supplyBalance.achievementsClaimed<=4);
  assert.ok(report.scenarios.supply.spentCoins>=0);
  process.stdout.write('P2.11_90_DAY_REPORT '+JSON.stringify({
    input:report.assumptions,cautions:report.cautions,
    profiles:Object.fromEntries(Object.entries(report.scenarios).map(([k,v])=>
      [k,{capReachedDay:v.capReachedDay,finalLevel:v.finalLevel,orders:v.completedOrders}])),
    supplyBalance:report.supplyBalance
  })+'\n');
});

test('P2.11 rejects unbounded configurations rather than inventing extrapolated dates',()=>{
  for(const invalid of [
    {seed:-1},{seed:4294967296},{seed:Infinity},{seed:'42'},
    {days:0},{days:91},{days:1.5},{sessionsPerDay:0},{sessionsPerDay:7},
    {sessionMinutes:0},{sessionMinutes:51},{behavior:'unknown'},
    {sessionsPerDay:6,sessionMinutes:51}
  ])assert.throws(()=>auditProgression({...baseline,...invalid}),/Invalid progression audit inputs/);
});

test('P2.11 retains independent day-one and 90-day scenarios under different policies',()=>{
  const a=auditProgression({...baseline,days:1,seed:2,behavior:'cluttered'});
  const b=auditProgression({...baseline,days:1,seed:2,behavior:'organized'});
  checkReport(a);checkReport(b);
  assert.equal(a.assumptions.behavior,'cluttered');
  assert.equal(b.assumptions.behavior,'organized');
  assert.equal(a.scenarios.ideal.finalXp,b.scenarios.ideal.finalXp);
  assert.equal(a.scenarios.supply.finalXp,b.scenarios.supply.finalXp);
});
