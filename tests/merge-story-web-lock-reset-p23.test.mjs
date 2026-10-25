import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runStoryWriteWithLock} from '../merge/story/write-lock.mjs';
import {resetStoryWorkshopWithLock} from '../merge/story/workshop-reset.mjs';
import {STORY_WORKSHOP_KEY,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {createInitialState,moveOrMerge,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function sharedStorage(){
  const data=new Map(),writes=[];
  return {data,writes,
    getItem(key){return data.has(key)?data.get(key):null;},
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
}
function exclusiveLocks(){
  const tails=new Map(),calls=[];
  return {calls,request(name,options,callback){
    calls.push({name,mode:options.mode});
    const before=tails.get(name)??Promise.resolve();
    const result=before.catch(()=>{}).then(callback);
    tails.set(name,result.catch(()=>{}));
    return result;
  }};
}
test('P23 regular workshop write wins shared lock; stale confirmed reset cannot erase it',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks();
  const initial=createInitialState(1000000);
  assert.equal(writeStoryWorkshop(storage,initial,{expectedRaw:null}),true);
  const expectedRaw=storage.getItem(STORY_WORKSHOP_KEY);
  const moved=moveOrMerge(initial,0,2);assert.equal(moved.ok,true);
  const [write,reset]=await Promise.all([
    runStoryWriteWithLock(locks,STORY_WORKSHOP_KEY,()=>writeStoryWorkshop(storage,moved.state,{expectedRaw})),
    resetStoryWorkshopWithLock(locks,storage,{expectedRaw,now:1000001})
  ]);
  assert.equal(write.value,true);
  assert.equal(reset.ok,true);assert.equal(reset.mode,'web-lock');assert.equal(reset.value,null);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),JSON.stringify(moved.state));
  assert.equal(storage.writes.filter(x=>x===STORY_WORKSHOP_KEY).length,2);
  assert.equal(locks.calls.length,2);
  assert.equal(locks.calls[0].name,locks.calls[1].name);
  assert.ok(locks.calls.every(x=>x.mode==='exclusive'));
});
test('P23 confirmed reset wins shared lock; stale workshop action cannot undo it',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks(),initial=createInitialState(1000000);
  assert.equal(writeStoryWorkshop(storage,initial,{expectedRaw:null}),true);
  const expectedRaw=storage.getItem(STORY_WORKSHOP_KEY);
  const moved=moveOrMerge(initial,0,2);assert.equal(moved.ok,true);
  const [reset,write]=await Promise.all([
    resetStoryWorkshopWithLock(locks,storage,{expectedRaw,now:1000100}),
    runStoryWriteWithLock(locks,STORY_WORKSHOP_KEY,()=>writeStoryWorkshop(storage,moved.state,{expectedRaw}))
  ]);
  assert.equal(reset.ok,true);assert.ok(validateSave(reset.value));
  assert.equal(write.value,false);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),JSON.stringify(reset.value));
  assert.equal(storage.writes.filter(x=>x===STORY_WORKSHOP_KEY).length,2);
});
test('P23 explicitly confirmed corrupt reset preserves normal economy and story dialogue',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks();
  storage.setItem(STORY_WORKSHOP_KEY,'{broken');
  storage.setItem(STORY_SAVE_KEY,'story-sentinel');
  storage.setItem(SAVE_KEY,'normal-sentinel');
  const result=await resetStoryWorkshopWithLock(locks,storage,{expectedRaw:'{broken',now:1000000});
  assert.equal(result.ok,true);assert.ok(validateSave(result.value));
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),JSON.stringify(result.value));
  assert.equal(storage.getItem(STORY_SAVE_KEY),'story-sentinel');
  assert.equal(storage.getItem(SAVE_KEY),'normal-sentinel');
  assert.deepEqual(storage.writes.slice(3),[STORY_WORKSHOP_KEY]);
});
test('P23 reset fails closed for stale, invalid or rejected lock; no silent fallback',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks();
  const initial=createInitialState(1000000);
  assert.equal(writeStoryWorkshop(storage,initial,{expectedRaw:null}),true);
  const expectedRaw=storage.getItem(STORY_WORKSHOP_KEY);
  assert.equal((await resetStoryWorkshopWithLock(locks,storage,{expectedRaw:'stale'})).value,null);
  assert.equal((await resetStoryWorkshopWithLock(locks,storage,{expectedRaw:undefined})).ok,false);
  assert.equal((await resetStoryWorkshopWithLock({request(){throw Error('denied');}},storage,{expectedRaw})).ok,false);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),expectedRaw);
  assert.equal(storage.writes.length,1);
});
test('P23 storage invalidation while lock is queued aborts reset before write',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks();
  const initial=createInitialState(1000000);
  assert.equal(writeStoryWorkshop(storage,initial,{expectedRaw:null}),true);
  const expectedRaw=storage.getItem(STORY_WORKSHOP_KEY);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const blocker=locks.request('toolbox.merge-isle.story.write.'+STORY_SAVE_KEY,{mode:'exclusive'},()=>gate);
  let current=true;
  const reset=resetStoryWorkshopWithLock(locks,storage,{expectedRaw,isCurrent:()=>current});
  current=false;release();
  await blocker;
  assert.equal((await reset).value,null);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),expectedRaw);
  assert.equal(storage.writes.length,1);
});
test('P23 browsers without Web Locks retain exact-raw CAS for confirmed reset',async()=>{
  const storage=sharedStorage(),initial=createInitialState(1000000);
  assert.equal(writeStoryWorkshop(storage,initial,{expectedRaw:null}),true);
  const expectedRaw=storage.getItem(STORY_WORKSHOP_KEY);
  const result=await resetStoryWorkshopWithLock(null,storage,{expectedRaw,now:1001000});
  assert.equal(result.mode,'cas-fallback');assert.equal(result.ok,true);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),JSON.stringify(result.value));
  assert.equal((await resetStoryWorkshopWithLock(null,storage,{expectedRaw,now:1001001})).value,null);
});
test('P23 UI confirms before lock, disables actions, and never bypasses CAS',()=>{
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {resetStoryWorkshopWithLock} from './workshop-reset.mjs';"));
  const handler=ui.slice(ui.indexOf("$('reset-workshop').addEventListener('click',async()=>{"));
  assert.ok(handler.includes("if(saving)return;"));
  assert.ok(handler.includes("window.confirm('确认重置剧情工作台"));
  assert.ok(handler.indexOf("window.confirm('确认重置剧情工作台")<handler.indexOf('resetStoryWorkshopWithLock('));
  assert.ok(handler.includes('saving=true;render();'));
  assert.ok(handler.includes('expectedRaw,isCurrent:()=>storageEpoch===expectedEpoch'));
  assert.ok(handler.includes("if(!attempt.ok||!attempt.value||storageEpoch!==expectedEpoch)"));
  assert.ok(ui.includes("if(!check.ok){storageEpoch++;blocked=true;"));
  assert.ok(ui.includes("storageEpoch++;blocked=true;reason='WRITE_CONFLICT'"));
  assert.ok(ui.includes("$('reset-workshop').disabled=saving||"));
  assert.ok(ui.includes('runStoryWriteWithLock(webLocks,STORY_WORKSHOP_KEY,'));
  for(const forbidden of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem','SAVE_KEY'])
    assert.equal(ui.includes(forbidden),false,forbidden);
});
