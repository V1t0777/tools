import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BUILDINGS} from '../merge/economy.mjs';
import {describeStoryConstructionResources as describe} from '../merge/story/construction-progress.mjs';

test('P120 garden exact resource gaps and read-only state',()=>{
  const state={xp:100,coins:90},before=structuredClone(state);
  const hint=describe(state,BUILDINGS.garden);
  assert.match(hint,/需要 4 级和 160 金币；当前 3 级、90 金币/);
  assert.match(hint,/还差 90 经验/);
  assert.match(hint,/还差 70 金币/);
  assert.deepEqual(state,before);
});
test('P120 independent threshold satisfaction and readiness',()=>{
  assert.match(describe({xp:190,coins:159},BUILDINGS.garden),/等级已达标.*还差 1 金币/);
  assert.match(describe({xp:189,coins:160},BUILDINGS.garden),/还差 1 经验.*金币已达标/);
  assert.match(describe({xp:190,coins:160},BUILDINGS.garden),/均已达标，可以修建/);
});
test('P120 all first-volume buildings follow real economy thresholds',()=>{
  assert.match(describe({xp:28,coins:59},BUILDINGS.storefront),/还差 1 金币/);
  assert.match(describe({xp:589,coins:330},BUILDINGS.harbor),/还差 1 经验/);
  assert.match(describe({xp:590,coins:330},BUILDINGS.harbor),/均已达标/);
});
test('P120 corrupt resource inputs cannot imply a building is ready',()=>{
  for(const state of [null,{xp:-1,coins:160},{xp:190,coins:NaN},
    {xp:190.5,coins:160},{xp:190,coins:Infinity}]){
    assert.match(describe(state,BUILDINGS.garden),/无法核对/);
  }
  assert.match(describe({xp:190,coins:160},null),/无法核对/);
});
test('P120 story workshop wires every building to shared read-only guidance',async()=>{
  const src=await readFile(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  for(const id of ['garden','harbor','storefront']){
    assert.ok(src.includes('describeStoryConstructionResources(state,'+id+')'));
    assert.ok(src.includes("$('build-"+id+"').disabled="),
      id+' must retain the original build eligibility check');
  }
  const helper=await readFile(new URL('../merge/story/construction-progress.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/localStorage|setItem|upgradeBuilding\(/);
});
