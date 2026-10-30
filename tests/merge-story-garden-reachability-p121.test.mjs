import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDINGS,getLevel} from '../merge/economy.mjs';
import {createInitialState,fulfillOrder,moveOrMerge,produce,upgradeBuilding,validateSave} from '../merge/engine.mjs';
import {describeStoryConstructionResources} from '../merge/story/construction-progress.mjs';

// Worst-case low-tier drops. Every action uses the real deterministic engine;
// no fabricated coins, experience, items, or edited save snapshots.
test('P121: tier-one-only production can earn and build the real story garden',()=>{
  let now=1_800_000_000_000;
  let state=createInitialState(now);
  assert.equal(validateSave(state),true);
  assert.equal(upgradeBuilding(state,'garden').ok,false);
  const original=state;
  let delivered=0,produced=0,merged=0;
  for(let step=0;step<1000;step++){
    if(getLevel(state.xp)>=BUILDINGS.garden.minLevel&&
      state.coins>=BUILDINGS.garden.coins)break;
    const available=state.orders.find(order=>state.board.some(item=>
      item?.kind==='material'&&item.chain===order.chain&&item.tier===order.tier));
    let action;
    if(available){
      action=fulfillOrder(state,available.id);
      delivered++;
    }else{
      // Prefer advancing an outstanding order using a genuine matching pair.
      // Never merge above its requested tier or inject a reward.
      let pair=null;
      for(const order of state.orders){
        for(let tier=order.tier-1;tier>=1&&!pair;tier--){
          const slots=state.board.flatMap((item,i)=>
            item?.kind==='material'&&item.chain===order.chain&&item.tier===tier?[i]:[]);
          if(slots.length>=2)pair=[slots[0],slots[1]];
        }
        if(pair)break;
      }
      if(pair){
        action=moveOrMerge(state,pair[0],pair[1]);
        merged++;
      }else{
        const target=state.orders[0];
        const producerSlot=state.board.findIndex(item=>
          item?.kind==='producer'&&item.chain===target.chain);
        assert.ok(producerSlot>=0,'real producer must remain on the board');
        now+=180_000; // simulated offline wait, not free energy injection
        action=produce(state,producerSlot,now,()=>0);
        produced++;
      }
    }
    assert.equal(action.ok,true,'engine action failed: '+action.message+
      '; orders='+delivered+' produced='+produced+' merged='+merged);
    assert.equal(action.state.revision,state.revision+1,
      'each engine action must commit exactly one revision');
    assert.equal(validateSave(action.state),true,
      'engine must preserve the strict persisted-save schema');
    state=action.state;
  }
  assert.ok(delivered>=10,'garden must require genuine sustained order work');
  assert.ok(produced>0&&merged>0,'orders must use real production and merging');
  assert.ok(getLevel(state.xp)>=BUILDINGS.garden.minLevel,
    'real order experience must eventually unlock garden level');
  assert.ok(state.coins>=BUILDINGS.garden.coins,
    'real order coins must eventually cover the garden price');
  const beforeBuild=structuredClone(state);
  assert.match(describeStoryConstructionResources(state,BUILDINGS.garden),
    /等级与金币均已达标，可以修建/);
  assert.deepEqual(state,beforeBuild,'resource guidance must remain read-only');
  const built=upgradeBuilding(state,'garden');
  assert.equal(built.ok,true);
  assert.equal(built.state.buildings.garden,1);
  assert.equal(built.state.coins,state.coins-BUILDINGS.garden.coins);
  assert.equal(built.state.xp,state.xp);
  assert.equal(built.state.revision,state.revision+1);
  assert.equal(validateSave(built.state),true);
  assert.equal(state.buildings.garden,0,'building must not mutate the prior save');
  assert.equal(upgradeBuilding(built.state,'garden').ok,false,
    'completed garden must not charge again');
  assert.equal(original.coins,0,'original story-only state remains unchanged');
});
