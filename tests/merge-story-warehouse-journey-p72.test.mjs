import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,storeItem,withdrawItem,fulfillOrder,moveOrMerge,validateSave} from '../merge/engine.mjs';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {storyWorkshopRequirement} from '../merge/story/workshop-gate.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function isolatedStorage(){
  const data=new Map([[SAVE_KEY,'normal-sentinel'],[STORY_SAVE_KEY,null],
    [STORY_WORKSHOP_KEY,null]]);
  return {data,getItem:key=>data.get(key)??null,
    setItem:(key,value)=>data.set(key,value)};
}
const materialIds=state=>[...state.board,...state.warehouse.slots]
  .filter(item=>item?.kind==='material').map(item=>item.id).sort();

test('P72 warehouse-staged first order survives story-only save reload and cannot be delivered until withdrawn',()=>{
  const storage=isolatedStorage();
  let state=createInitialState(1_000_000);
  const order=state.orders[0];
  const index=state.board.findIndex(item=>item?.kind==='material'&&
    item.chain===order.chain&&item.tier===order.tier);
  assert.ok(index>=0,'the initial tutorial order must have a genuine board item');
  const staged=storeItem(state,index);
  assert.equal(staged.ok,true);
  assert.equal(validateSave(staged.state),true);
  assert.equal(fulfillOrder(staged.state,order.id).ok,false,
    'an item in the warehouse is not silently delivered');
  assert.equal(writeStoryWorkshop(storage,staged.state,{expectedRaw:null}),true);
  const loaded=readStoryWorkshop(storage);
  assert.equal(loaded.blocked,false);
  assert.equal(loaded.state.warehouse.slots[0].id,state.board[index].id);
  const retrieved=withdrawItem(loaded.state,0);
  assert.equal(retrieved.ok,true);
  assert.deepEqual(materialIds(retrieved.state),materialIds(state));
  assert.equal(writeStoryWorkshop(storage,retrieved.state,{expectedRaw:loaded.raw}),true);
  const again=readStoryWorkshop(storage);
  const delivered=fulfillOrder(again.state,order.id);
  assert.equal(delivered.ok,true);
  assert.equal(storyWorkshopRequirement('first-order',delivered.state).met,true);
  assert.equal(writeStoryWorkshop(storage,delivered.state,{expectedRaw:again.raw}),true);
  assert.equal(storage.getItem(SAVE_KEY),'normal-sentinel');
  assert.equal(storage.getItem(STORY_SAVE_KEY),null);
});

test('P72 full warehouse refuses overflow and full board refuses withdrawal until a real merge frees a cell',()=>{
  let state=createInitialState(1_000_000);
  const originalIds=materialIds(state);
  for(let i=0;i<state.warehouse.capacity;i++){
    const index=state.board.findIndex(item=>item?.kind==='material');
    const outcome=storeItem(state,index);
    assert.equal(outcome.ok,true);
    state=outcome.state;
  }
  const failedStore=storeItem(state,state.board.findIndex(item=>item?.kind==='material'));
  assert.equal(failedStore.ok,false);
  assert.deepEqual(failedStore.state,state);
  assert.equal(state.warehouse.slots.filter(Boolean).length,4);
  const filler=state.board.find(item=>item?.kind==='material');
  assert.ok(filler);
  // Construct a valid, completely occupied stress snapshot without touching a real save.
  const full=structuredClone(state);
  for(let i=0;i<full.board.length;i++)if(!full.board[i])
    full.board[i]={...filler,id:'m'+full.nextId++};
  full.revision++;
  assert.equal(validateSave(full),true);
  const denied=withdrawItem(full,0);
  assert.equal(denied.ok,false);
  assert.deepEqual(denied.state,full);
  const first=full.board.findIndex(item=>item?.kind==='material');
  const second=full.board.findIndex((item,i)=>i>first&&item?.kind==='material'&&
    item.chain===full.board[first].chain&&item.tier===full.board[first].tier);
  assert.ok(second>first);
  const merged=moveOrMerge(full,first,second);
  assert.equal(merged.ok,true);
  const recovered=withdrawItem(merged.state,0);
  assert.equal(recovered.ok,true);
  assert.equal(validateSave(recovered.state),true);
  assert.equal(recovered.state.board.filter(Boolean).length,56);
  assert.equal(recovered.state.warehouse.slots.filter(Boolean).length,3);
  assert.ok(originalIds.every(id=>materialIds(recovered.state).includes(id)),
    'warehouse recovery must not discard any original item');
});

test('P72 16 seeded first-volume runs preserve resources and item identities across detached warehouse round trips',()=>{
  let checks=0;
  for(const seed of [0,7,42,20261027,...Array.from({length:12},(_,i)=>i*7919+1)]){
    let tested=0;
    const result=simulateStoryBoard({seed,strategy:'novice',maxActions:10_000,
      onMilestone:(_milestone,state)=>{
        const index=state.board.findIndex(item=>item?.kind==='material');
        if(index<0)return;
        const before=materialIds(state);
        const staged=storeItem(state,index);
        assert.equal(staged.ok,true);
        const retrieved=withdrawItem(staged.state,0);
        assert.equal(retrieved.ok,true);
        assert.equal(validateSave(retrieved.state),true);
        assert.deepEqual(materialIds(retrieved.state),before);
        assert.deepEqual(retrieved.state.orders,state.orders);
        assert.deepEqual(retrieved.state.buildings,state.buildings);
        for(const field of ['coins','xp','energy','energyAt'])
          assert.equal(retrieved.state[field],state[field],field);
        assert.equal(retrieved.state.revision,state.revision+2);
        tested++;checks++;
      }});
    assert.equal(result.complete,true,'seed '+seed+': '+result.reason);
    assert.ok(tested>=1,'at least one story milestone must exercise warehouse staging');
  }
  assert.ok(checks>=16);
});

test('P72 malformed warehouse save remains protected and cannot be silently replaced',()=>{
  const storage=isolatedStorage();
  const broken=createInitialState(1_000_000);
  broken.warehouse.capacity=3;
  const raw=JSON.stringify(broken);
  storage.setItem(STORY_WORKSHOP_KEY,raw);
  const loaded=readStoryWorkshop(storage);
  assert.equal(loaded.blocked,true);
  assert.equal(loaded.reason,'CORRUPT_SAVE');
  assert.equal(loaded.raw,raw);
  assert.equal(writeStoryWorkshop(storage,createInitialState(1_000_000),
    {expectedRaw:raw}),false);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),raw);
  assert.equal(storage.getItem(SAVE_KEY),'normal-sentinel');
  assert.equal(storage.getItem(STORY_SAVE_KEY),null);
});
