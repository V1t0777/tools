import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';
import {BUILDINGS,getLevel} from '../merge/economy.mjs';
import {validateSave} from '../merge/engine.mjs';

test('P123 detached pre-build snapshots are genuinely earned and cannot change the simulation',()=>{
  const baseline=simulateStoryBoard({seed:42});
  const seen=[];
  const replay=simulateStoryBoard({seed:42,onConstructionReady:(id,state)=>{
    seen.push(id);
    assert.equal(validateSave(state),true);
    assert.equal(state.buildings[id],0,'snapshot is before the real engine construction');
    assert.ok(getLevel(state.xp)>=BUILDINGS[id].minLevel);
    assert.ok(state.coins>=BUILDINGS[id].coins);
    state.coins=0;
    state.board.length=0;
    state.buildings[id]=99;
  }});
  assert.deepEqual(seen,['garden','harbor','storefront']);
  assert.deepEqual(replay,baseline,'observer must not mutate live engine progress');
  assert.throws(()=>simulateStoryBoard({onConstructionReady:true}),RangeError);
});
