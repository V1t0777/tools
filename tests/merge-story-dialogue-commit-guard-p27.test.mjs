import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,fulfillOrder} from '../merge/engine.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {writeStorySave} from '../merge/story/local-storage.mjs';
import {STORY_WORKSHOP_KEY,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {storyDialogueCommitAllowed} from '../merge/story/dialogue-commit-guard.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';

const db=()=>{const map=new Map();return {
  getItem:key=>map.has(key)?map.get(key):null,
  setItem:(key,value)=>map.set(key,value),map
};};
function prepared(){
  const storage=db(),initial=createInitialState(1000000),order=initial.orders[0];
  const found=initial.board.findIndex(x=>x?.kind==='material'&&x.chain===order.chain&&x.tier===order.tier);
  if(found<0){
    const slot=initial.board.findIndex(x=>!x);
    assert.ok(slot>=0);
    initial.board[slot]={id:'m'+initial.nextId++,kind:'material',chain:order.chain,tier:order.tier};
  }
  const fulfilled=fulfillOrder(initial,order.id);
  assert.equal(fulfilled.ok,true);
  const workshop=fulfilled.state;
  assert.equal(writeStoryWorkshop(storage,workshop,{expectedRaw:null}),true);
  let story=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  story=completeStoryEntry(story,CORE_STORY_PACK,'arrival','help');
  story=completeStoryEntry(story,CORE_STORY_PACK,'signboard');
  assert.equal(writeStorySave(storage,story,{expectedRaw:null}),true);
  return {storage,workshop,story,storyRaw:storage.getItem(STORY_SAVE_KEY),
    workshopRaw:storage.getItem(STORY_WORKSHOP_KEY)};
}
test('P27 only persisted, valid, unchanged workshop goals authorize completion',()=>{
  const {storage,workshop,workshopRaw}=prepared();
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',workshopRaw),true);
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',undefined),false);
  assert.equal(storyDialogueCommitAllowed(storage,'first-order','stale'),false);
  assert.equal(storyDialogueCommitAllowed(storage,'arrival',undefined),true);
  storage.setItem(STORY_WORKSHOP_KEY,'{corrupt');
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',workshopRaw),false);
  storage.setItem(STORY_WORKSHOP_KEY,JSON.stringify(createInitialState(1000001)));
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',storage.getItem(STORY_WORKSHOP_KEY)),false);
  storage.setItem(STORY_WORKSHOP_KEY,JSON.stringify(workshop));
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',workshopRaw),true);
});
test('P27 workshop changes during queued dialogue lock reject stale completion',async()=>{
  const {storage,workshop,story,storyRaw,workshopRaw}=prepared();
  const next=completeStoryEntry(story,CORE_STORY_PACK,'first-order','listen');
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const locks={request:async(_name,_options,write)=>{await gate;return write();}};
  const pending=saveStoryDialogueWithLock(locks,storage,next,{
    expectedRaw:storyRaw,commitGuard:()=>storyDialogueCommitAllowed(storage,'first-order',workshopRaw)
  });
  const changed=structuredClone(workshop);changed.revision++;
  assert.equal(writeStoryWorkshop(storage,changed,{expectedRaw:workshopRaw}),true);
  release();
  const result=await pending;
  assert.equal(result.ok,true);
  assert.equal(result.value,false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),storyRaw);
});
test('P27 unchanged workshop goal permits dialogue completion',async()=>{
  const {storage,story,storyRaw,workshopRaw}=prepared();
  const next=completeStoryEntry(story,CORE_STORY_PACK,'first-order','listen');
  const locks={request:async(_name,_options,write)=>write()};
  const result=await saveStoryDialogueWithLock(locks,storage,next,{
    expectedRaw:storyRaw,commitGuard:()=>storyDialogueCommitAllowed(storage,'first-order',workshopRaw)
  });
  assert.equal(result.ok,true);
  assert.equal(result.value,true);
  assert.equal(JSON.parse(storage.getItem(STORY_SAVE_KEY)).packs.core.completed.main.includes('first-order'),true);
});
test('P27 throwing or invalid guard fails closed without modifying story save',async()=>{
  const {storage,story,storyRaw}=prepared();
  const next=completeStoryEntry(story,CORE_STORY_PACK,'first-order','listen');
  const locks={request:async(_name,_options,write)=>write()};
  const thrown=await saveStoryDialogueWithLock(locks,storage,next,{
    expectedRaw:storyRaw,commitGuard:()=>{throw new Error('read failed');}
  });
  assert.equal(thrown.ok,false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),storyRaw);
  const invalid=await saveStoryDialogueWithLock(locks,storage,next,{expectedRaw:storyRaw,commitGuard:null});
  assert.equal(invalid.ok,false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),storyRaw);
});
test('P27 UI passes cross-save guard to locked writer',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  const writer=readFileSync(new URL('../merge/story/dialogue-write.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes('const expectedWorkshopRaw=workshopSnapshot?.raw'));
  assert.ok(ui.includes('storyDialogueCommitAllowed(store,entryId,expectedWorkshopRaw)'));
  assert.ok(ui.includes('save(next,false,commitGuard)'));
  assert.ok(writer.includes('if(!isCurrent()||!commitGuard())return false;'));
});
