import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,storeItem} from '../merge/engine.mjs';
import {SAVE_KEY,loadLocal,saveLocal} from '../merge/storage.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';

const NOW=1_000_000;
const first=CORE_STORY_PACK.entries.find(entry=>entry.kind==='main');
function fixture(){
  const data=new Map();
  const writes=[];
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  const normal=createInitialState(NOW);
  data.set(SAVE_KEY,JSON.stringify(normal));
  const story=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  assert.equal(writeStorySave(storage,story,{expectedRaw:null}),true);
  return {data,writes,storage};
}
function advanceFirst(storage){
  const before=readStorySave(storage);
  const next=completeStoryEntry(before.progress,CORE_STORY_PACK,
    first.id,first.choices[0]?.id??null);
  assert.equal(writeStorySave(storage,next,{expectedRaw:before.raw}),true);
  return readStorySave(storage);
}

test('P94 normal/story/warehouse independent saves survive alternating page reads',()=>{
  const {storage,writes}=fixture();
  const normalBefore=loadLocal(storage,NOW);
  const normalAction=storeItem(normalBefore.state,0);
  assert.equal(normalAction.ok,true);
  assert.equal(saveLocal(storage,normalAction.state,{expectedRaw:normalBefore.raw}),true);
  const normalRaw=storage.getItem(SAVE_KEY);
  const workshopBefore=readStoryWorkshop(storage,NOW);
  const workshopAction=storeItem(workshopBefore.state,0);
  assert.equal(workshopAction.ok,true);
  assert.equal(writeStoryWorkshop(storage,workshopAction.state,
    {expectedRaw:workshopBefore.raw}),true);
  const workshopRaw=storage.getItem(STORY_WORKSHOP_KEY);
  const story=advanceFirst(storage);
  const storyRaw=story.raw;
  for(let visit=0;visit<3;visit++){
    assert.deepEqual(loadLocal(storage,NOW).state,normalAction.state);
    assert.deepEqual(readStoryWorkshop(storage,NOW).state,workshopAction.state);
    assert.equal(readStorySave(storage).progress.packs.core.completed.main.includes(first.id),true);
    assert.equal(storage.getItem(SAVE_KEY),normalRaw);
    assert.equal(storage.getItem(STORY_WORKSHOP_KEY),workshopRaw);
    assert.equal(storage.getItem(STORY_SAVE_KEY),storyRaw);
  }
  assert.equal(writes.filter(key=>key===SAVE_KEY).length,1);
  assert.equal(writes.filter(key=>key===STORY_WORKSHOP_KEY).length,1);
});

test('P94 corrupt normal mode does not poison story; corrupt story does not overwrite normal',()=>{
  const {data,storage}=fixture();
  const damagedNormal='{"broken":\\ud800';
  data.set(SAVE_KEY,damagedNormal);
  assert.equal(loadLocal(storage,NOW).blocked,true);
  const story=advanceFirst(storage);
  assert.equal(story.blocked,false);
  assert.equal(storage.getItem(SAVE_KEY),damagedNormal);
  const workshop=readStoryWorkshop(storage,NOW);
  const stored=storeItem(workshop.state,0);
  assert.equal(stored.ok,true);
  assert.equal(writeStoryWorkshop(storage,stored.state,{expectedRaw:workshop.raw}),true);
  assert.equal(storage.getItem(SAVE_KEY),damagedNormal);
  const damagedStory='{"story":\\ud800';
  data.set(STORY_SAVE_KEY,damagedStory);
  assert.equal(readStorySave(storage).blocked,true);
  const healthyNormal=JSON.stringify(createInitialState(NOW));
  data.set(SAVE_KEY,healthyNormal);
  const normalAction=storeItem(loadLocal(storage,NOW).state,0);
  assert.equal(normalAction.ok,true);
  assert.equal(saveLocal(storage,normalAction.state,{expectedRaw:healthyNormal}),true);
  assert.equal(storage.getItem(STORY_SAVE_KEY),damagedStory);
  assert.equal(readStoryWorkshop(storage,NOW).blocked,false);
});

test('P94 stale mode-specific CAS attempts cannot roll back a peer update',()=>{
  const {storage}=fixture();
  const oldNormal=loadLocal(storage,NOW);
  const oldStory=readStorySave(storage);
  const peerNormal=storeItem(oldNormal.state,0);
  assert.equal(peerNormal.ok,true);
  assert.equal(saveLocal(storage,peerNormal.state,{expectedRaw:oldNormal.raw}),true);
  const peerStory=advanceFirst(storage);
  const currentNormalRaw=storage.getItem(SAVE_KEY);
  const currentStoryRaw=storage.getItem(STORY_SAVE_KEY);
  const staleNormal=storeItem(oldNormal.state,0);
  assert.equal(staleNormal.ok,true);
  assert.equal(saveLocal(storage,staleNormal.state,{expectedRaw:oldNormal.raw}),false);
  const staleStory=completeStoryEntry(oldStory.progress,CORE_STORY_PACK,
    first.id,first.choices[0]?.id??null);
  assert.equal(writeStorySave(storage,staleStory,{expectedRaw:oldStory.raw}),false);
  assert.equal(storage.getItem(SAVE_KEY),currentNormalRaw);
  assert.equal(storage.getItem(STORY_SAVE_KEY),currentStoryRaw);
  assert.equal(readStorySave(storage).progress.revision,peerStory.progress.revision);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),null);
});
