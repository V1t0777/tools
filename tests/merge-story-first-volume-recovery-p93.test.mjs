import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,storeItem} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {readStoryWorkshop,writeStoryWorkshop,STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {nextCoreStoryJourney,nextCoreSideJourney} from '../merge/story/journey-guide.mjs';
import {storyDialogueCommitAllowed} from '../merge/story/dialogue-commit-guard.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {resetStoryWorkshopWithLock} from '../merge/story/workshop-reset.mjs';
import {captureStoryWorkshopEvidence,prepareStoryEvidenceDownload,
  isPreparedStoryEvidenceCurrent} from '../merge/story/save-evidence.mjs';

const NOW=1_000_000;
const lock={request:async(_name,_options,callback)=>callback()};
const optional=['wrong-letter','old-seeds','postcard','wood-mark','after-festival'];
function setupPostFinale(){
  const normal=JSON.stringify(createInitialState(NOW));
  const data=new Map([[SAVE_KEY,normal]]);
  const writes=[];
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  let progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  for(const entry of CORE_STORY_PACK.entries.filter(entry=>entry.kind==='main'))
    progress=completeStoryEntry(progress,CORE_STORY_PACK,entry.id,entry.choices[0]?.id??null);
  for(const id of optional){
    const entry=CORE_STORY_PACK.entries.find(item=>item.id===id);
    progress=completeStoryEntry(progress,CORE_STORY_PACK,id,entry.choices[0]?.id??null);
  }
  assert.equal(writeStorySave(storage,progress,{expectedRaw:null}),true);
  assert.equal(nextCoreStoryJourney(readStorySave(storage).progress,
    readStoryWorkshop(storage,NOW)).kind,'complete');
  assert.equal(nextCoreSideJourney(readStorySave(storage).progress,
    readStoryWorkshop(storage,NOW)).entry.id,'toolbox');
  return {storage,writes,normal};
}
function stockWarehouse(storage){
  const before=readStoryWorkshop(storage,NOW);
  const stored=storeItem(before.state,0);
  assert.equal(stored.ok,true);
  assert.equal(writeStoryWorkshop(storage,stored.state,{expectedRaw:before.raw}),true);
  const after=readStoryWorkshop(storage,NOW);
  assert.equal(after.blocked,false);
  assert.equal(storyDialogueCommitAllowed(storage,'toolbox',after.raw),true);
  return after;
}
function pendingToolbox(storage){
  const before=readStorySave(storage);
  return {before,next:completeStoryEntry(before.progress,CORE_STORY_PACK,'toolbox','label')};
}

test('P93 corrupted post-finale warehouse stays blocked through evidence and explicit reset, then requalifies',async()=>{
  const {storage,writes,normal}=setupPostFinale();
  const original=stockWarehouse(storage);
  const {before,next}=pendingToolbox(storage);
  const broken='{"unfinished":\ud800';
  storage.setItem(STORY_WORKSHOP_KEY,broken);
  const damaged=readStoryWorkshop(storage,NOW);
  assert.equal(damaged.blocked,true);
  assert.equal(damaged.reason,'CORRUPT_SAVE');
  const blocked=nextCoreSideJourney(before.progress,damaged);
  assert.equal(blocked.kind,'workshop');
  assert.equal(blocked.blocked,true);
  assert.equal(blocked.entry.id,'toolbox');
  assert.equal(storyDialogueCommitAllowed(storage,'toolbox',original.raw),false);
  const evidence=captureStoryWorkshopEvidence(storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:broken,confirmedByUser:true});
  assert.equal(evidence.ok,true);
  const prepared=prepareStoryEvidenceDownload(evidence.content,'yunyu-post-finale-workshop');
  assert.equal(prepared.wrapped,true);
  assert.equal(JSON.parse(prepared.content).raw,broken);
  assert.equal(isPreparedStoryEvidenceCurrent(storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:broken,download:prepared}),true);
  const refused=await saveStoryDialogueWithLock(lock,storage,next,{
    expectedRaw:before.raw,
    commitGuard:()=>storyDialogueCommitAllowed(storage,'toolbox',original.raw)});
  assert.equal(refused.value,false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),before.raw);
  assert.equal(writeStoryWorkshop(storage,createInitialState(NOW),{expectedRaw:broken}),false);
  const reset=await resetStoryWorkshopWithLock(lock,storage,{expectedRaw:broken,now:NOW});
  assert.equal(reset.ok,true);
  assert.ok(reset.value);
  const clean=readStoryWorkshop(storage,NOW);
  assert.equal(clean.blocked,false);
  assert.equal(nextCoreSideJourney(readStorySave(storage).progress,clean).kind,'workshop');
  assert.equal(storyDialogueCommitAllowed(storage,'toolbox',clean.raw),false);
  assert.equal(isPreparedStoryEvidenceCurrent(storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:broken,download:prepared}),false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),before.raw);
  const restored=stockWarehouse(storage);
  assert.equal(nextCoreSideJourney(readStorySave(storage).progress,restored).kind,'story');
  const accepted=await saveStoryDialogueWithLock(lock,storage,next,{
    expectedRaw:before.raw,
    commitGuard:()=>storyDialogueCommitAllowed(storage,'toolbox',restored.raw)});
  assert.equal(accepted.value,true);
  const final=readStorySave(storage);
  assert.equal(final.progress.packs.core.completed.side.includes('toolbox'),true);
  assert.equal(nextCoreSideJourney(final.progress,readStoryWorkshop(storage,NOW)).kind,'complete');
  assert.equal(storage.getItem(SAVE_KEY),normal);
  assert.equal(writes.filter(key=>key===SAVE_KEY).length,0);
});

test('P93 waiting dialogue cannot consume an old warehouse authorization after peer recovery',async()=>{
  const {storage,normal}=setupPostFinale();
  const original=stockWarehouse(storage);
  const {before,next}=pendingToolbox(storage);
  let peerReset=false;
  const delayedLock={request:async(_name,_options,callback)=>{
    const broken='{"peer":\ud800';
    storage.setItem(STORY_WORKSHOP_KEY,broken);
    const recovered=await resetStoryWorkshopWithLock(lock,storage,{expectedRaw:broken,now:NOW});
    peerReset=recovered.ok&&!!recovered.value;
    return callback();
  }};
  const attempt=await saveStoryDialogueWithLock(delayedLock,storage,next,{
    expectedRaw:before.raw,
    commitGuard:()=>storyDialogueCommitAllowed(storage,'toolbox',original.raw)});
  assert.equal(peerReset,true);
  assert.equal(attempt.value,false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),before.raw);
  assert.equal(nextCoreSideJourney(readStorySave(storage).progress,
    readStoryWorkshop(storage,NOW)).kind,'workshop');
  assert.equal(storage.getItem(SAVE_KEY),normal);
});

test('P93 peer replacement while reset waits cannot erase a recovered workshop or story choices',async()=>{
  const {storage,normal}=setupPostFinale();
  const storyRaw=storage.getItem(STORY_SAVE_KEY);
  const broken='{"damaged":\ud800';
  storage.setItem(STORY_WORKSHOP_KEY,broken);
  const peer=storeItem(createInitialState(NOW),0);
  assert.equal(peer.ok,true);
  let peerRaw;
  const delayedLock={request:async(_name,_options,callback)=>{
    storage.setItem(STORY_WORKSHOP_KEY,JSON.stringify(peer.state));
    peerRaw=storage.getItem(STORY_WORKSHOP_KEY);
    return callback();
  }};
  const reset=await resetStoryWorkshopWithLock(delayedLock,storage,{expectedRaw:broken,now:NOW});
  assert.equal(reset.value,null);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),peerRaw);
  assert.equal(nextCoreSideJourney(readStorySave(storage).progress,
    readStoryWorkshop(storage,NOW)).kind,'story');
  assert.equal(storage.getItem(STORY_SAVE_KEY),storyRaw);
  assert.equal(storage.getItem(SAVE_KEY),normal);
});
