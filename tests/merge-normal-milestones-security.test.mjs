import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NORMAL_MILESTONE_RULES} from '../merge/normal-milestone-rules.mjs';
test('P2.13 stable unique bounded display goals',()=>{
  assert.equal(NORMAL_MILESTONE_RULES.length,9);
  assert.equal(new Set(NORMAL_MILESTONE_RULES.map(x=>x.id)).size,9);
  assert.ok(NORMAL_MILESTONE_RULES.every(x=>Object.isFrozen(x)&&
    Number.isSafeInteger(x.target)&&x.target>0&&x.target<=2400));
});
test('P2.15 read-only normal milestone view remains activated without new grants',()=>{
  const files=['normal-milestone-rules.mjs','normal-milestone-metrics.mjs',
    'normal-milestones.mjs'];
  const code=files.map(name=>readFileSync(new URL('../merge/'+name,import.meta.url),'utf8')).join('\n');
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  for(const term of ['localStorage','sessionStorage','fetch(','saveLocal(',
    'purchaseSupply(','recordSupplyProgress(','Date.now(','Math.random('])
    assert.equal(code.includes(term),false,term);
  assert.equal(main.includes("import { deriveNormalMilestones } from './normal-milestones.mjs'"),true);
  assert.equal(main.includes('const report=deriveNormalMilestones(state);'),true);
  assert.equal(main.includes("milestone.complete?'已完成 · 无额外奖励'"),true);
});
