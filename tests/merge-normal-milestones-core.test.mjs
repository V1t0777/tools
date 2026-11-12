import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {ACHIEVEMENT_RULES} from '../merge/supplies.mjs';
import {deriveNormalMilestones} from '../merge/normal-milestones.mjs';
const row=(r,id)=>r.milestones.find(x=>x.id===id);
test('P2.13 normal V3 goals are read-only and deterministic',()=>{
  const s=createInitialState(1000000),before=structuredClone(s);
  const a=deriveNormalMilestones(s);
  assert.deepEqual(a,deriveNormalMilestones(s));
  assert.deepEqual(s,before);
  assert.equal(a.totalCount,9);
  assert.equal(a.completedCount,0);
  assert.equal(a.rewardPolicy,'NONE');
  assert.equal(row(a,'warehouse-full').current,4);
  assert.ok(Object.isFrozen(a)&&Object.isFrozen(a.milestones));
  assert.ok(a.milestones.every(Object.isFrozen));
});
test('P2.13 order and merge thresholds saturate without overflow',()=>{
  const s=createInitialState(1000000);
  s.progress.orders=199;s.progress.merges=599;
  for(const r of ACHIEVEMENT_RULES)s.achievements[r.id]=1;
  assert.equal(validateSave(s),true);
  const a=deriveNormalMilestones(s);
  assert.equal(row(a,'orders-200').remaining,1);
  assert.equal(row(a,'merges-600').remaining,1);
  s.progress.orders=Number.MAX_SAFE_INTEGER;
  s.progress.merges=Number.MAX_SAFE_INTEGER;
  for(const r of deriveNormalMilestones(s).milestones.slice(0,6)){
    assert.equal(r.percent,100);assert.equal(r.remaining,0);
  }
});
