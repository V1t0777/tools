import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave,MAX_ENERGY,SAVE_VERSION} from '../merge/engine.mjs';
import {deriveNormalMilestones} from '../merge/normal-milestones.mjs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';

const getSource=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('P2.15 initial normal goal projection is informative and does not mutate save',()=>{
  const state=createInitialState(1_000_000);
  const before=structuredClone(state);
  const projection=deriveNormalMilestones(state);
  assert.equal(projection.rewardPolicy,'NONE');
  assert.equal(projection.mode,'normal');
  assert.equal(projection.totalCount,9);
  assert.equal(projection.completedCount,0);
  assert.ok(projection.milestones.every(m=>m.progress>=0&&m.progress<=m.target));
  assert.deepEqual(state,before);
  assert.equal(SAVE_VERSION,3);
  assert.equal(MAX_ENERGY,120);
  assert.equal(validateSave(state),true);
});

test('P2.15 nine goal labels are wired once and use native bounded progress',()=>{
  const main=getSource('../merge/main.mjs');
  const html=getSource('../merge/index.html');
  const css=getSource('../merge/style.css');
  const goals=deriveNormalMilestones(createInitialState(1_000_000));
  for(const goal of goals.milestones){
    assert.ok(main.includes(`'${goal.id}':`),`Missing localized goal ${goal.id}`);
  }
  assert.equal(goals.milestones.length,9);
  assert.ok(main.includes("import { deriveNormalMilestones } from './normal-milestones.mjs';"));
  assert.ok(main.includes('const report=deriveNormalMilestones(state);'));
  assert.ok(main.includes("bar=document.createElement('progress')"));
  assert.ok(main.includes('bar.max=milestone.target;'));
  assert.ok(main.includes('bar.value=milestone.progress;'));
  assert.ok(main.includes('container.replaceChildren(fragment);'));
  assert.ok(main.includes('renderNormalMilestones();'));
  assert.equal(html.split('id="normal-milestones"').length-1,1);
  assert.equal(html.split('id="normal-milestone-summary"').length-1,1);
  assert.ok(html.includes('aria-labelledby="normal-milestone-title"'));
  assert.ok(css.includes('.normal-milestone-list'));
  assert.ok(css.includes('@media(max-width:480px){.normal-milestone-list'));
});

test('P2.15 visible milestones cannot grant resources, write cloud data or store a second save',()=>{
  const main=getSource('../merge/main.mjs');
  const section=main.slice(main.indexOf('function renderNormalMilestones()'),main.indexOf('function render() {'));
  assert.ok(section.startsWith('function renderNormalMilestones()'));
  for(const banned of ['localStorage','saveLocal(', 'persist(', 'purchaseSupply(', 'useSupply(', 'fetch(', 'coins +=', 'energy +=', 'innerHTML','new Function(']){
    assert.equal(section.includes(banned),false,`Milestones render unexpectedly uses ${banned}`);
  }
  assert.ok(!section.includes("document.createElement('button')"));
  const html=getSource('../merge/index.html');
  const sectionHtml=html.slice(html.indexOf('id="normal-milestone-title"'),html.indexOf('id="notice"'));
  assert.ok(!sectionHtml.includes('领取'));
  assert.ok(!sectionHtml.includes('<button'));
});

test('P2.15 milestones reject story mode data and preserve normal save after arbitrary progress',()=>{
  assert.throws(()=>deriveNormalMilestones(createEmptyStoryProgress()),TypeError);
  const s=createInitialState(1_000_000);
  s.progress.orders=2400;
  s.progress.merges=3000;
  s.achievements={orders3:1,orders6:1,merges30:1,orders20:1};
  assert.equal(validateSave(s),true);
  const before=structuredClone(s);
  const r=deriveNormalMilestones(s);
  assert.equal(r.milestones.slice(0,6).filter(m=>m.complete).length,6);
  assert.equal(r.milestones.slice(0,6).reduce((sum,m)=>sum+m.remaining,0),0);
  assert.deepEqual(s,before);
});
