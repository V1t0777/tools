import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave,MAX_ENERGY,SAVE_VERSION} from '../merge/engine.mjs';
import {BUILDINGS,MAX_PRODUCER_LEVEL,XP_THRESHOLDS} from '../merge/economy.mjs';
import {registerStoryPack,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {deriveNormalMilestones} from '../merge/normal-milestones.mjs';
test('P2.13 infrastructure targets use current normal save only',()=>{
  const s=createInitialState(1000000);
  s.xp=1400;s.coins=10000;
  for(const id of Object.keys(BUILDINGS))s.buildings[id]=1;
  s.warehouse.capacity=8;
  for(const item of s.board)if(item?.kind==='producer'){
    item.level=MAX_PRODUCER_LEVEL;item.pity=0;
  }
  assert.equal(validateSave(s),true);
  const r=deriveNormalMilestones(s);
  assert.equal(r.completedCount,3);
  assert.ok(r.milestones.slice(-3).every(x=>x.complete&&x.percent===100));
  assert.equal(s.coins,10000);assert.equal(s.energy,MAX_ENERGY);
  assert.equal(SAVE_VERSION,3);assert.equal(XP_THRESHOLDS.at(-1),1400);
});
test('P2.13 story, mixed mode and corrupt inputs are rejected',()=>{
  const story=registerStoryPack(createEmptyStoryProgress(),'core');
  assert.throws(()=>deriveNormalMilestones(story),TypeError);
  const s=createInitialState(1000000);
  const mixed=structuredClone(s);mixed.mode='story';
  assert.throws(()=>deriveNormalMilestones(mixed),TypeError);
  const packed=structuredClone(s);packed.packs={};
  assert.throws(()=>deriveNormalMilestones(packed),TypeError);
  const corrupt=structuredClone(s);corrupt.progress.orders=-1;
  assert.throws(()=>deriveNormalMilestones(corrupt),TypeError);
  assert.equal(validateSave(s),true);
});
