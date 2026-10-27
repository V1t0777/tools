import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,fulfillOrder,storeItem,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {readStoryWorkshop,writeStoryWorkshop,STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {nextCoreStoryJourney,nextCoreSideJourney} from '../merge/story/journey-guide.mjs';
import {storyDialogueCommitAllowed} from '../merge/story/dialogue-commit-guard.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {checkStoryResumeSnapshot} from '../merge/story/resume-guard.mjs';
import {captureStoryWorkshopEvidence,prepareStoryEvidenceDownload,
  isPreparedStoryEvidenceCurrent} from '../merge/story/save-evidence.mjs';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';

const main=CORE_STORY_PACK.entries.filter(entry=>entry.kind==='main');
const normalRaw=JSON.stringify(createInitialState(1_000_000));
function fixture(){
  const data=new Map([[SAVE_KEY,normalRaw]]),writes=[];
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  const initial=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  assert.equal(writeStorySave(storage,initial,{expectedRaw:null}),true);
  return {storage,writes};
}
function advanceMain(storage,through){
  const progress=readStorySave(storage);
  assert.equal(progress.blocked,false);
  const done=progress.progress.packs.core.completed.main.length;
  const target=main.findIndex(entry=>entry.id===through);
  assert.ok(target>=done,'mainline target must move forward: '+through);
  for(let i=done;i<=target;i++){
    const entry=main[i];
    const story=readStorySave(storage),workshop=readStoryWorkshop(storage,1_000_000);
    assert.equal(storyDialogueCommitAllowed(storage,entry.id,workshop.raw),true,
      'a real workshop gate must authorize '+entry.id);
    const next=completeStoryEntry(story.progress,CORE_STORY_PACK,entry.id,
      entry.choices[0]?.id??null);
    assert.equal(writeStorySave(storage,next,{expectedRaw:story.raw}),true,entry.id);
    assert.equal(readStorySave(storage).progress.packs.core.completed.main.includes(entry.id),true);
  }
}
function persistMilestone(storage,state){
  assert.equal(validateSave(state),true);
  const previous=readStoryWorkshop(storage,1_000_000);
  assert.equal(previous.blocked,false);
  assert.equal(writeStoryWorkshop(storage,state,{expectedRaw:previous.raw}),true);
  const reloaded=readStoryWorkshop(storage,1_000_000);
  assert.equal(reloaded.blocked,false);
  assert.deepEqual(reloaded.state,state);
  return reloaded;
}

test('P89 first-volume chapter gates survive actual separated save round trips at every milestone',()=>{
  for(const seed of [0,42,20261027]){
    const {storage,writes}=fixture();
    advanceMain(storage,'signboard');
    assert.equal(nextCoreStoryJourney(readStorySave(storage).progress,
      readStoryWorkshop(storage)).kind,'workshop');
    const seen=[];
    const result=simulateStoryBoard({seed,strategy:'novice-supplies',maxActions:10_000,
      onMilestone:(milestone,state)=>{
        seen.push(milestone.id);
        const workshop=persistMilestone(storage,state);
        const goals={
          'first-order':['first-order','seed','tea-table'],
          garden:['tea-table','apprentice','harbor-light'],
          harbor:['harbor-light','harbor-light','festival'],
          storefront:['festival','letter-answer',null]
        };
        const [goal,through,blockedNext]=goals[milestone.id];
        assert.equal(storyDialogueCommitAllowed(storage,goal,workshop.raw),true,goal);
        advanceMain(storage,through);
        const journey=nextCoreStoryJourney(readStorySave(storage).progress,
          readStoryWorkshop(storage));
        if(blockedNext){
          assert.equal(journey.kind,'workshop',milestone.id);
          assert.equal(journey.entry.id,blockedNext,milestone.id);
        }else assert.equal(journey.kind,'complete');
        assert.equal(storage.getItem(SAVE_KEY),normalRaw,
          'story milestones cannot mutate normal-mode economy');
      }});
    assert.equal(result.complete,true,seed+': '+result.reason);
    assert.deepEqual(seen,['first-order','garden','harbor','storefront']);
    assert.deepEqual(readStorySave(storage).progress.packs.core.completed.main,
      main.map(entry=>entry.id));
    assert.equal(readStorySave(storage).progress.packs.core.completed.side.length,0);
    assert.equal(readStorySave(storage).progress.packs.core.completed.incident.length,0);
    assert.equal(writes.filter(key=>key===SAVE_KEY).length,0);
  }
});

test('P89 corrupted workshop between chapters blocks the next scene and preserves exact evidence',()=>{
  const {storage,writes}=fixture();
  advanceMain(storage,'signboard');
  const storyBefore=storage.getItem(STORY_SAVE_KEY);
  const broken='{"incomplete":\ud800';
  storage.setItem(STORY_WORKSHOP_KEY,broken);
  const workshop=readStoryWorkshop(storage,1_000_000);
  assert.equal(workshop.blocked,true);
  assert.equal(workshop.reason,'CORRUPT_SAVE');
  const journey=nextCoreStoryJourney(readStorySave(storage).progress,workshop);
  assert.equal(journey.kind,'workshop');
  assert.equal(journey.blocked,true);
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',broken),false);
  assert.equal(writeStoryWorkshop(storage,createInitialState(1_000_000),
    {expectedRaw:broken}),false,'a corrupt record is never silently replaced');
  const evidence=captureStoryWorkshopEvidence(storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:broken,confirmedByUser:true});
  assert.equal(evidence.ok,true);
  const prepared=prepareStoryEvidenceDownload(evidence.content,'yunyu-story-workshop-corrupt-save');
  assert.equal(prepared.wrapped,true);
  assert.equal(JSON.parse(prepared.content).raw,broken);
  assert.equal(isPreparedStoryEvidenceCurrent(storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:broken,download:prepared}),true);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),broken);
  assert.equal(storage.getItem(STORY_SAVE_KEY),storyBefore);
  assert.equal(storage.getItem(SAVE_KEY),normalRaw);
  assert.equal(writes.filter(key=>key===STORY_SAVE_KEY).length,3);
});

test('P89 peer warehouse update invalidates stale chapter completion but permits a fresh guarded retry',async()=>{
  const {storage}=fixture();
  advanceMain(storage,'signboard');
  const initial=createInitialState(1_000_000);
  const first=fulfillOrder(initial,initial.orders[0].id);
  assert.equal(first.ok,true);
  const before=persistMilestone(storage,first.state);
  const storyBefore=readStorySave(storage);
  const next=completeStoryEntry(storyBefore.progress,CORE_STORY_PACK,'first-order','listen');
  const material=before.state.board.findIndex(item=>item?.kind==='material');
  assert.ok(material>=0);
  const peer=storeItem(before.state,material);
  assert.equal(peer.ok,true);
  assert.equal(writeStoryWorkshop(storage,peer.state,{expectedRaw:before.raw}),true);
  const current=readStoryWorkshop(storage);
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',before.raw),false);
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',current.raw),true);
  assert.equal(checkStoryResumeSnapshot(storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:before.raw}).ok,false);
  const locks={request:async(_name,_options,callback)=>callback()};
  const stale=await saveStoryDialogueWithLock(locks,storage,next,{
    expectedRaw:storyBefore.raw,
    commitGuard:()=>storyDialogueCommitAllowed(storage,'first-order',before.raw)
  });
  assert.equal(stale.value,false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),storyBefore.raw);
  const fresh=await saveStoryDialogueWithLock(locks,storage,next,{
    expectedRaw:storyBefore.raw,
    commitGuard:()=>storyDialogueCommitAllowed(storage,'first-order',current.raw)
  });
  assert.equal(fresh.value,true);
  assert.equal(readStorySave(storage).progress.packs.core.completed.main.includes('first-order'),true);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),current.raw);
  assert.equal(storage.getItem(SAVE_KEY),normalRaw);
});

test('P92 post-finale optional stories persist independently and the toolbox requires real warehouse storage',()=>{
  const {storage,writes}=fixture();
  // P89 separately verifies all four economic gates; here the completed
  // first volume is a fixture for optional-story persistence, not a bypass.
  let progress=readStorySave(storage).progress;
  for(const entry of main)
    progress=completeStoryEntry(progress,CORE_STORY_PACK,entry.id,entry.choices[0]?.id??null);
  assert.equal(writeStorySave(storage,progress,{
    expectedRaw:storage.getItem(STORY_SAVE_KEY)}),true);
  assert.equal(nextCoreStoryJourney(readStorySave(storage).progress,
    readStoryWorkshop(storage)).kind,'complete');
  assert.equal(nextCoreSideJourney(readStorySave(storage).progress,
    readStoryWorkshop(storage)).entry.id,'wrong-letter');

  for(const id of ['wrong-letter','old-seeds','postcard','wood-mark','after-festival']){
    const before=readStorySave(storage);
    const entry=CORE_STORY_PACK.entries.find(item=>item.id===id);
    assert.ok(entry);
    const updated=completeStoryEntry(before.progress,CORE_STORY_PACK,id,
      entry.choices[0]?.id??null);
    assert.equal(writeStorySave(storage,updated,{expectedRaw:before.raw}),true,id);
    const restored=readStorySave(storage);
    assert.equal(restored.blocked,false);
    assert.equal(restored.progress.packs.core.completed.side.includes(id),true,id);
    assert.equal(storage.getItem(SAVE_KEY),normalRaw);
  }
  const pending=nextCoreSideJourney(readStorySave(storage).progress,
    readStoryWorkshop(storage));
  assert.equal(pending.kind,'workshop');
  assert.equal(pending.entry.id,'toolbox');
  assert.equal(storyDialogueCommitAllowed(storage,'toolbox',null),false);

  const stored=storeItem(createInitialState(1_000_000),0);
  assert.equal(stored.ok,true);
  const beforeWorkshop=readStoryWorkshop(storage);
  assert.equal(writeStoryWorkshop(storage,stored.state,{
    expectedRaw:beforeWorkshop.raw}),true);
  const workshop=readStoryWorkshop(storage);
  assert.equal(nextCoreSideJourney(readStorySave(storage).progress,workshop).kind,'story');
  assert.equal(storyDialogueCommitAllowed(storage,'toolbox',workshop.raw),true);
  const before=readStorySave(storage);
  const completed=completeStoryEntry(before.progress,CORE_STORY_PACK,'toolbox','label');
  assert.equal(writeStorySave(storage,completed,{expectedRaw:before.raw}),true);
  const restored=readStorySave(storage);
  assert.equal(nextCoreSideJourney(restored.progress,readStoryWorkshop(storage)).kind,'complete');
  assert.equal(restored.progress.packs.core.completed.side.length,6);
  assert.equal(restored.progress.packs.core.choices.postcard,'send');
  assert.equal(restored.progress.packs.core.choices.toolbox,'label');
  assert.equal(restored.progress.packs.core.completed.main.length,main.length);
  assert.equal(storage.getItem(SAVE_KEY),normalRaw);
  assert.equal(writes.filter(key=>key===SAVE_KEY).length,0);
});

test('P92 stale optional-story save cannot overwrite another tab choice or normal-mode save',()=>{
  const {storage}=fixture();
  let progress=readStorySave(storage).progress;
  for(const entry of main.slice(0,3))
    progress=completeStoryEntry(progress,CORE_STORY_PACK,entry.id,
      entry.choices[0]?.id??null);
  assert.equal(writeStorySave(storage,progress,{
    expectedRaw:storage.getItem(STORY_SAVE_KEY)}),true);
  const stale=readStorySave(storage);
  const peer=completeStoryEntry(stale.progress,CORE_STORY_PACK,'wrong-letter');
  assert.equal(writeStorySave(storage,peer,{expectedRaw:stale.raw}),true);
  const peerRaw=storage.getItem(STORY_SAVE_KEY);
  const staleAttempt=completeStoryEntry(stale.progress,CORE_STORY_PACK,'wrong-letter');
  assert.equal(writeStorySave(storage,staleAttempt,{expectedRaw:stale.raw}),false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),peerRaw);
  assert.equal(readStorySave(storage).progress.packs.core.completed.side.includes('wrong-letter'),true);
  assert.equal(storage.getItem(SAVE_KEY),normalRaw);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),null);
});
