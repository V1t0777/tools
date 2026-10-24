import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge,validateSave} from '../merge/engine.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {resetStoryWorkshopWithLock} from '../merge/story/workshop-reset.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function storage(){
  const data=new Map(),writes=[];
  return {writes,getItem(key){return data.has(key)?data.get(key):null;},
    setItem(key,value){writes.push(key);data.set(key,value);}};
}
const fresh=()=>createInitialState(1000000);

test('P25 reset of a valid workshop always advances revision, even with identical clock',async()=>{
  const store=storage(),initial=fresh();
  assert.equal(writeStoryWorkshop(store,initial,{expectedRaw:null}),true);
  const original=store.getItem(STORY_WORKSHOP_KEY);
  const reset=await resetStoryWorkshopWithLock(null,store,{expectedRaw:original,now:1000000});
  assert.equal(reset.ok,true);assert.equal(reset.mode,'cas-fallback');
  assert.ok(validateSave(reset.value));
  assert.equal(reset.value.revision,initial.revision+1);
  assert.notEqual(store.getItem(STORY_WORKSHOP_KEY),original,'ABA: reset must change the exact bytes');
  assert.deepEqual(reset.value.board,initial.board);
  assert.equal(reset.value.coins,0);
});

test('P25 an old tab cannot replay an action after a same-clock reset',async()=>{
  const store=storage(),initial=fresh();
  assert.equal(writeStoryWorkshop(store,initial,{expectedRaw:null}),true);
  const stale=readStoryWorkshop(store,1000000);
  const move=moveOrMerge(stale.state,0,2);
  assert.equal(move.ok,true);
  const reset=await resetStoryWorkshopWithLock(null,store,{expectedRaw:stale.raw,now:1000000});
  assert.equal(reset.ok,true);assert.ok(reset.value);
  assert.equal(writeStoryWorkshop(store,move.state,{expectedRaw:stale.raw}),false);
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),JSON.stringify(reset.value));
});

test('P25 direct confirmed reset cannot write the same or older revision over a valid save',()=>{
  const store=storage(),initial=fresh();
  assert.equal(writeStoryWorkshop(store,initial,{expectedRaw:null}),true);
  const expectedRaw=store.getItem(STORY_WORKSHOP_KEY);
  assert.equal(writeStoryWorkshop(store,fresh(),{expectedRaw,confirmedReset:true}),false);
  const old=fresh();old.revision=0;
  assert.equal(writeStoryWorkshop(store,old,{expectedRaw,confirmedReset:true}),false);
  const higher=fresh();higher.revision=1;
  assert.equal(writeStoryWorkshop(store,higher,{expectedRaw,confirmedReset:true}),true);
  assert.equal(store.writes.length,2);
});

test('P25 exhausted revision fails closed without touching valid save or other modes',async()=>{
  const store=storage(),initial=fresh();initial.revision=Number.MAX_SAFE_INTEGER;
  assert.equal(validateSave(initial),true);
  assert.equal(writeStoryWorkshop(store,initial,{expectedRaw:null}),true);
  const expectedRaw=store.getItem(STORY_WORKSHOP_KEY);
  store.setItem(STORY_SAVE_KEY,'story-sentinel');
  store.setItem(SAVE_KEY,'normal-sentinel');
  const beforeWrites=store.writes.length;
  const result=await resetStoryWorkshopWithLock(null,store,{expectedRaw,now:1000000});
  assert.equal(result.value,null);
  assert.equal(store.writes.length,beforeWrites);
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),expectedRaw);
  assert.equal(store.getItem(STORY_SAVE_KEY),'story-sentinel');
  assert.equal(store.getItem(SAVE_KEY),'normal-sentinel');
});

test('P25 explicitly confirmed corrupt reset still works, isolated from other saves',async()=>{
  const store=storage();
  store.setItem(STORY_WORKSHOP_KEY,'{corrupt');
  store.setItem(STORY_SAVE_KEY,'story-sentinel');
  store.setItem(SAVE_KEY,'normal-sentinel');
  const reset=await resetStoryWorkshopWithLock(null,store,{expectedRaw:'{corrupt',now:1000000});
  assert.equal(reset.ok,true);assert.ok(validateSave(reset.value));
  assert.equal(reset.value.revision,0,'corrupt records have no trusted prior revision');
  assert.equal(store.getItem(STORY_SAVE_KEY),'story-sentinel');
  assert.equal(store.getItem(SAVE_KEY),'normal-sentinel');
});

test('P25 repeated resets continue increasing revision and cannot be replayed',async()=>{
  const store=storage(),initial=fresh();
  assert.equal(writeStoryWorkshop(store,initial,{expectedRaw:null}),true);
  let expectedRaw=store.getItem(STORY_WORKSHOP_KEY);
  for(let revision=1;revision<=3;revision++){
    const outcome=await resetStoryWorkshopWithLock(null,store,{expectedRaw,now:1000000});
    assert.equal(outcome.value.revision,revision);
    const newer=store.getItem(STORY_WORKSHOP_KEY);
    assert.notEqual(newer,expectedRaw);
    assert.equal((await resetStoryWorkshopWithLock(null,store,{expectedRaw,now:1000000})).value,null);
    expectedRaw=newer;
  }
  assert.equal(store.writes.filter(key=>key===STORY_WORKSHOP_KEY).length,4);
});
