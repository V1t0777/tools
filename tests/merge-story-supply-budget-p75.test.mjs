import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {nextStoryConstructionBudget,wouldSpendStoryConstructionReserve}
  from '../merge/story/supply-budget.mjs';

test('P75 next unbuilt first-volume construction budget is read-only and deterministic',()=>{
  const state=createInitialState(1_000_000);
  state.coins=160;
  assert.equal(validateSave(state),true);
  const raw=JSON.stringify(state);
  const budget=nextStoryConstructionBudget(state);
  assert.equal(budget.ok,true);
  assert.equal(budget.id,'garden');
  assert.equal(budget.cost,160);
  assert.equal(budget.shortfall,0);
  assert.equal(Object.isFrozen(budget),true);
  assert.equal(wouldSpendStoryConstructionReserve(budget,90),true);
  assert.equal(wouldSpendStoryConstructionReserve(budget,0),false);
  assert.equal(wouldSpendStoryConstructionReserve(budget,1),true);
  assert.equal(JSON.stringify(state),raw);
});

test('P75 reserve warning is advisory: shortfall and next chapter cost are precise',()=>{
  const state=createInitialState(1_000_000);
  state.buildings.garden=1;
  state.coins=300;
  const harbor=nextStoryConstructionBudget(state);
  assert.equal(harbor.id,'harbor');
  assert.equal(harbor.cost,330);
  assert.equal(harbor.shortfall,30);
  assert.match(harbor.description,/还差 ◈30/);
  assert.equal(wouldSpendStoryConstructionReserve(harbor,90),false);
  state.coins=330;
  assert.equal(wouldSpendStoryConstructionReserve(nextStoryConstructionBudget(state),90),true);
  state.buildings.harbor=1;
  state.coins=60;
  assert.equal(nextStoryConstructionBudget(state).id,'storefront');
  assert.equal(nextStoryConstructionBudget(state).cost,60);
});

test('P75 completed volume and malformed inputs never invent a construction reserve',()=>{
  const state=createInitialState(1_000_000);
  state.buildings={garden:1,harbor:1,storefront:1};
  const done=nextStoryConstructionBudget(state);
  assert.equal(done.complete,true);
  assert.equal(wouldSpendStoryConstructionReserve(done,90),false);
  for(const bad of [null,{}, {coins:-1,buildings:state.buildings},
    {coins:10,buildings:{garden:2,harbor:0,storefront:0}}]){
    assert.equal(nextStoryConstructionBudget(bad).ok,false);
  }
});
