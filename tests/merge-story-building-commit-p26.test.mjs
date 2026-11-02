import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {storyBuildingWriteAllowed} from '../merge/story/building-commit-guard.mjs';
import {runStoryWriteWithLock} from '../merge/story/write-lock.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {createInitialState,upgradeBuilding,moveOrMerge} from '../merge/engine.mjs';

function storage(){
  const map=new Map(),writes=[];
  return {map,writes,
    getItem(key){return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push(key);map.set(key,value);}
  };
}
function progressThrough(id){
  let progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  for(const entry of CORE_STORY_PACK.entries.filter(x=>x.kind==='main')){
    progress=completeStoryEntry(progress,CORE_STORY_PACK,entry.id,entry.choices[0]?.id??null);
    if(entry.id===id)break;
  }
  return progress;
}
function readyBuilding(building){
  const before=createInitialState(1000000);
  before.xp=1000;before.coins=2000;
  const action=upgradeBuilding(before,building);
  assert.equal(action.ok,true);
  return {before,after:action.state};
}
function locksHeldUntilRelease(){
  let release;
  const waiting=new Promise(resolve=>{release=resolve;});
  let started=false;
  return {release,locks:{request(_name,_opts,callback){
    return waiting.then(()=>{started=true;return callback();});
  }},wasStarted:()=>started};
}

test('P26 all three building spends require their corresponding completed story milestone',()=>{
  for(const [building,required] of [['garden','seed'],['harbor','apprentice'],['storefront','harbor-light']]){
    const store=storage(),{before,after}=readyBuilding(building);
    const earlier=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
    store.setItem(STORY_SAVE_KEY,JSON.stringify(earlier));
    assert.equal(storyBuildingWriteAllowed(store,before,after,store.getItem(STORY_SAVE_KEY)),false,building+' premature');
    const ready=progressThrough(required);
    store.setItem(STORY_SAVE_KEY,JSON.stringify(ready));
    assert.equal(storyBuildingWriteAllowed(store,before,after,store.getItem(STORY_SAVE_KEY)),true,building+' unlocked');
  }
});
test('P26 queued garden spend is rejected if another tab resets the narrative before lock acquisition',async()=>{
  const store=storage(),{before,after}=readyBuilding('garden');
  const story=progressThrough('seed');
  store.setItem(STORY_SAVE_KEY,JSON.stringify(story));
  store.setItem(SAVE_KEY,'normal-sentinel');
  assert.equal(writeStoryWorkshop(store,before,{expectedRaw:null}),true);
  const expectedRaw=store.getItem(STORY_WORKSHOP_KEY);
  const expectedStoryRaw=store.getItem(STORY_SAVE_KEY);
  const held=locksHeldUntilRelease();
  const pending=runStoryWriteWithLock(held.locks,STORY_WORKSHOP_KEY,()=>
    storyBuildingWriteAllowed(store,before,after,expectedStoryRaw)&&
    writeStoryWorkshop(store,after,{expectedRaw}));
  // Simulate a confirmed story reset in a different tab while waiting.
  store.setItem(STORY_SAVE_KEY,JSON.stringify(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK)));
  held.release();
  const result=await pending;
  assert.equal(held.wasStarted(),true);
  assert.equal(result.ok,true);
  assert.equal(result.value,false);
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),expectedRaw);
  assert.equal(store.getItem(SAVE_KEY),'normal-sentinel');
  assert.deepEqual(store.writes.filter(key=>key===STORY_WORKSHOP_KEY),[STORY_WORKSHOP_KEY]);
});
test('P26 even an unrelated story revision change invalidates a queued building spend',()=>{
  const store=storage(),{before,after}=readyBuilding('garden');
  const ready=progressThrough('seed');
  store.setItem(STORY_SAVE_KEY,JSON.stringify(ready));
  const expectedStoryRaw=store.getItem(STORY_SAVE_KEY);
  const updated=structuredClone(ready);updated.revision++;
  store.setItem(STORY_SAVE_KEY,JSON.stringify(updated));
  assert.equal(storyBuildingWriteAllowed(store,before,after,expectedStoryRaw),false);
});
test('P26 corrupt, absent, unavailable or ambiguous narrative snapshots fail closed for buildings',()=>{
  const store=storage(),{before,after}=readyBuilding('garden');
  assert.equal(storyBuildingWriteAllowed(store,before,after,null),false);
  assert.equal(storyBuildingWriteAllowed(store,before,after,undefined),false);
  store.setItem(STORY_SAVE_KEY,'{broken');
  assert.equal(storyBuildingWriteAllowed(store,before,after,'{broken'),false);
  assert.equal(storyBuildingWriteAllowed(null,before,after,null),false);
});
test('P26 non-building moves remain independent of story data, and illegal building reversal is refused',()=>{
  const store=storage(),{before,after}=readyBuilding('garden');
  const movement=moveOrMerge(before,0,2);assert.equal(movement.ok,true);
  assert.equal(storyBuildingWriteAllowed(store,before,movement.state,undefined),true);
  assert.equal(storyBuildingWriteAllowed(store,after,before,null),false);
});
test('P26 UI checks the story snapshot only inside the locked workshop write path',()=>{
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {storyBuildingWriteAllowed} from './building-commit-guard.mjs';"));
  assert.ok(ui.includes('const expectedStoryRaw=readStorySave(storage).raw;'));
  const lock=ui.indexOf('runStoryWriteWithLock(webLocks,STORY_WORKSHOP_KEY,');
  const gate=ui.indexOf('storyBuildingWriteAllowed(storage,state,result.state,expectedStoryRaw)');
  const write=ui.indexOf('writeStoryWorkshop(storage,result.state,{expectedRaw})');
  assert.ok(lock>=0&&lock<gate&&gate<write);
  for(const forbidden of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem','SAVE_KEY'])
    assert.equal(ui.includes(forbidden),false,forbidden);
});
