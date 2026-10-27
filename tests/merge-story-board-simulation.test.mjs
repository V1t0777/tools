import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';
import {projectStoryEconomy} from '../merge/story/economy-audit.mjs';
import {BUILDINGS,getLevel} from '../merge/economy.mjs';
import {MAX_ENERGY} from '../merge/engine.mjs';

test('P6 seeded real-engine playthrough reaches first order and all three story construction gates',()=>{
  for(const seed of [0,1,2,7,42,20261024,0xffffffff]){
    const result=simulateStoryBoard({seed});
    assert.equal(result.complete,true,`seed ${seed}: ${result.reason}`);
    assert.deepEqual(result.milestones.map(x=>x.id),
      ['first-order','garden','harbor','storefront']);
    assert.deepEqual(result.buildings,{storefront:1,garden:1,harbor:1});
    assert.equal(result.milestones[0].productions,0,
      'initial board already contains a valid tier-2 first order');
    assert.ok(result.orders>=35&&result.orders<=70);
    assert.ok(result.productions>0);
    assert.ok(result.boardUsed<=56);
    assert.ok(result.peakBoardUsed>=result.boardUsed&&result.peakBoardUsed<=56);
    assert.ok(result.energy>=0&&result.energy<=MAX_ENERGY);
    assert.ok(result.coins>=0&&result.xp>=0);
    for(const id of ['garden','harbor','storefront']){
      const milestone=result.milestones.find(m=>m.id===id);
      assert.ok(getLevel(milestone.xp)>=BUILDINGS[id].minLevel);
      assert.ok(milestone.coins>=0);
    }
  }
});

test('P6 64 deterministic RNG seeds all finish under bounded action budget',()=>{
  const results=Array.from({length:64},(_,i)=>simulateStoryBoard({seed:i*7919+1}));
  const failures=results.filter(x=>!x.complete).map(x=>({seed:x.seed,reason:x.reason}));
  assert.deepEqual(failures,[]);
  assert.ok(results.every(x=>x.actions<20_000));
  assert.ok(new Set(results.map(x=>x.productions)).size>1,
    'different RNG seeds should expose real production variance');
  const range=key=>[Math.min(...results.map(x=>x[key])),Math.max(...results.map(x=>x[key]))];
  console.log('P6 actual-board audit (64 seeds): '+JSON.stringify({
    orders:range('orders'),productions:range('productions'),
    merges:range('merges'),forcedWaitMinutes:range('elapsedMinutes'),
    maximumPeakBoardUsed:Math.max(...results.map(x=>x.peakBoardUsed))
  }));
});

test('P6 seed-42 regression distinguishes actual production from P5 heuristic',()=>{
  const result=simulateStoryBoard({seed:42});
  assert.equal(result.orders,40);
  assert.equal(result.productions,103);
  assert.equal(result.merges,71);
  assert.equal(result.milestones[1].orders,15);
  assert.equal(result.milestones[2].orders,40);
  assert.ok(result.productions<projectStoryEconomy().estimatedEnergy,
    'P5 estimate is not observed energy; avoid presenting it as a hard lower bound');
  assert.match(result.limitations,/绝非真实通关时间/);
});

test('P7 novice strategy stresses real board with 24 reproducible seeds',()=>{
  const seeds=Array.from({length:24},(_,i)=>i*7919+1);
  const results=seeds.map(seed=>simulateStoryBoard({seed,strategy:'novice',maxActions:10_000}));
  assert.ok(results.every(x=>x.strategy==='novice'&&x.actions<=10_000));
  assert.ok(results.every(x=>x.peakBoardUsed<=56&&x.boardUsed<=56));
  assert.ok(results.every(x=>x.energy>=0&&x.energy<=MAX_ENERGY&&x.coins>=0));
  assert.ok(results.every(x=>x.reason!=='invalid-state'));
  assert.deepEqual(results.filter(x=>!x.complete).map(x=>({seed:x.seed,reason:x.reason})),[],
    'a novice run must finish all three real construction gates within the budget');
  assert.ok(results.every(x=>x.milestones.map(m=>m.id).join(',')===
    'first-order,garden,harbor,storefront'));
  assert.ok(results.some(x=>x.peakBoardUsed>=44),'novice policy must exercise crowded boards');
  assert.ok(results.some(x=>x.offTargetProductions>0),'round-robin must produce off-target items');
  for(const result of results){
    if(result.complete)assert.deepEqual(result.buildings,{storefront:1,garden:1,harbor:1});
    assert.deepEqual(result,simulateStoryBoard({
      seed:result.seed,strategy:'novice',maxActions:10_000
    }));
  }
  const failureCounts={};
  for(const result of results)if(!result.complete){
    failureCounts[result.reason]=(failureCounts[result.reason]??0)+1;
  }
  console.log('P7 novice stress (24 seeds): '+JSON.stringify({
    complete:results.filter(x=>x.complete).length,
    failures:failureCounts,
    peakBoardUsed:[
      Math.min(...results.map(x=>x.peakBoardUsed)),
      Math.max(...results.map(x=>x.peakBoardUsed))
    ],
    offTargetProductions:[
      Math.min(...results.map(x=>x.offTargetProductions)),
      Math.max(...results.map(x=>x.offTargetProductions))
    ]
  }));
});

test('P6 bounded failure and invalid seed/options are explicit',()=>{
  const truncated=simulateStoryBoard({seed:1,maxActions:1});
  assert.equal(truncated.complete,false);
  assert.equal(truncated.reason,'action-cap');
  assert.deepEqual(truncated.milestones.map(x=>x.id),['first-order']);
  for(const options of [{strategy:'magic'},{seed:-1},{seed:0x100000000},{seed:1.2},
    {seed:NaN},{maxActions:0},{maxActions:50_001},{maxActions:1.1}]){
    assert.throws(()=>simulateStoryBoard(options),RangeError);
  }
});

test('P6 audit module cannot write saves, contact network or change mode',()=>{
  const source=readFileSync(new URL('../merge/story/board-simulation.mjs',import.meta.url),'utf8');
  for(const forbidden of ['localStorage','sessionStorage','fetch(','XMLHttpRequest',
    'writeStorySave','writeStoryWorkshop','Math.random(']){
    assert.equal(source.includes(forbidden),false,forbidden);
  }
  // P77 intentionally exercises finite supplies via the real deterministic
  // engine. Keep explicit simulation-clock calls and prohibit any save I/O.
  assert.match(source,/purchaseSupply\\(state,'soda'\\)/);
  assert.match(source,/useSupply\\(state,id,null,now\\)/);
  assert.match(source,/useSupply\\(state,id,state\\.board\\[slot\\]\\.id,now\\)/);
  const before=simulateStoryBoard({seed:7});
  const after=simulateStoryBoard({seed:7});
  assert.deepEqual(after,before);
  assert.ok(Object.isFrozen(after.milestones));
});
