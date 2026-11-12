import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,availableStoryEntries} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {readStoryWorkshop,writeStoryWorkshop,STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {storyDialogueCommitAllowed} from '../merge/story/dialogue-commit-guard.mjs';
import {nextCoreStoryJourney,nextCoreSideJourney} from '../merge/story/journey-guide.mjs';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';
import {validateSave} from '../merge/engine.mjs';

const NOW=1_000_000;
const normalKey='toolbox.merge-isle.local.v1';
const normalSentinel='independent-normal-save-do-not-touch';
const main=CORE_STORY_PACK.entries.filter(entry=>entry.kind==='main');
const byId=new Map(CORE_STORY_PACK.entries.map(entry=>[entry.id,entry]));
const choices=Object.freeze({
  arrival:'ask','first-order':'smile',seed:'try',apprentice:'trust',
  postcard:'hold',toolbox:'space'
});
function fixture(){
  const bytes=new Map([[normalKey,normalSentinel]]);
  const storage={
    getItem:key=>bytes.has(key)?bytes.get(key):null,
    setItem:(key,value)=>bytes.set(key,value)
  };
  const initial=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  assert.equal(writeStorySave(storage,initial,{expectedRaw:null}),true);
  return storage;
}
function commitEntry(storage,id){
  const entry=byId.get(id);
  assert.ok(entry,'known scene: '+id);
  const before=readStorySave(storage);
  const workshop=readStoryWorkshop(storage,NOW);
  assert.equal(before.blocked,false);
  assert.equal(storyDialogueCommitAllowed(storage,id,workshop.raw),true,
    'economic/warehouse guard for '+id);
  assert.ok(availableStoryEntries(before.progress,CORE_STORY_PACK,entry.kind)
    .some(item=>item.id===id),'narrative prerequisites for '+id);
  const selected=choices[id]??entry.choices[0]?.id??null;
  const after=completeStoryEntry(before.progress,CORE_STORY_PACK,id,selected);
  assert.equal(writeStorySave(storage,after,{expectedRaw:before.raw}),true,id);
  const restored=readStorySave(storage);
  assert.equal(restored.blocked,false);
  assert.equal(restored.progress.revision,before.progress.revision+1);
  assert.ok(restored.progress.packs.core.completed[entry.kind].includes(id));
  if(selected!==null)assert.equal(restored.progress.packs.core.choices[id],selected);
  assert.equal(storage.getItem(normalKey),normalSentinel);
  return restored;
}
function advanceMain(storage,last){
  const stop=main.findIndex(entry=>entry.id===last);
  assert.ok(stop>=0);
  const done=readStorySave(storage).progress.packs.core.completed.main.length;
  assert.ok(done<=stop+1);
  for(let i=done;i<=stop;i++)commitEntry(storage,main[i].id);
}

test('P139 multi-seed inefficient play preserves alternative choices, side stories and all four economic gates',()=>{
  const seeds=[0,7,42,20261027,0xffffffff,7919,15839,23758];
  for(const strategy of ['novice','novice-supplies']){
    for(const seed of seeds){
      const storage=fixture();
      advanceMain(storage,'signboard');
      assert.equal(storyDialogueCommitAllowed(storage,'first-order',null),false);
      assert.equal(nextCoreStoryJourney(readStorySave(storage).progress,
        readStoryWorkshop(storage,NOW)).kind,'workshop');
      assert.equal(availableStoryEntries(readStorySave(storage).progress,
        CORE_STORY_PACK,'side').some(x=>x.id==='wrong-letter'),false);
      const seen=[];
      const result=simulateStoryBoard({seed,strategy,maxActions:10_000,
        onMilestone:(milestone,state)=>{
          seen.push(milestone.id);
          assert.equal(validateSave(state),true);
          const previous=readStoryWorkshop(storage,NOW);
          assert.equal(previous.blocked,false);
          assert.equal(writeStoryWorkshop(storage,state,{expectedRaw:previous.raw}),true);
          assert.deepEqual(readStoryWorkshop(storage,NOW).state,state,
            'reopening must restore the earned engine state');
          assert.equal(writeStoryWorkshop(storage,state,{expectedRaw:previous.raw}),false,
            'a stale tab cannot replay a construction milestone');
          if(milestone.id==='first-order'){
            advanceMain(storage,'seed');
            commitEntry(storage,'wrong-letter');
            commitEntry(storage,'old-seeds');
            assert.equal(storyDialogueCommitAllowed(storage,'tea-table',
              storage.getItem(STORY_WORKSHOP_KEY)),false);
          }else if(milestone.id==='garden'){
            advanceMain(storage,'apprentice');
            commitEntry(storage,'postcard');
            assert.equal(storyDialogueCommitAllowed(storage,'harbor-light',
              storage.getItem(STORY_WORKSHOP_KEY)),false);
          }else if(milestone.id==='harbor'){
            advanceMain(storage,'harbor-light');
            commitEntry(storage,'wood-mark');
            assert.equal(storyDialogueCommitAllowed(storage,'festival',
              storage.getItem(STORY_WORKSHOP_KEY)),false);
          }else if(milestone.id==='storefront'){
            advanceMain(storage,'letter-answer');
            commitEntry(storage,'after-festival');
          }else assert.fail('unexpected milestone '+milestone.id);
          assert.equal(storage.getItem(normalKey),normalSentinel);
        }});
      assert.equal(result.complete,true,strategy+'/'+seed+': '+result.reason);
      assert.deepEqual(seen,['first-order','garden','harbor','storefront']);
      const saved=readStorySave(storage);
      assert.equal(saved.blocked,false);
      assert.deepEqual(saved.progress.packs.core.completed.main,
        main.map(entry=>entry.id));
      assert.deepEqual(saved.progress.packs.core.completed.side,
        ['wrong-letter','old-seeds','postcard','wood-mark','after-festival']);
      for(const [id,choice] of Object.entries(choices)){
        if(id!=='toolbox')assert.equal(saved.progress.packs.core.choices[id],choice);
      }
      assert.equal(saved.progress.packs.core.completed.incident.length,0);
      assert.equal(nextCoreStoryJourney(saved.progress,
        readStoryWorkshop(storage,NOW)).kind,'complete');
      assert.equal(nextCoreSideJourney(saved.progress,
        readStoryWorkshop(storage,NOW)).entry.id,'toolbox',
        'warehouse-dependent side story remains optional and gated');
      assert.equal(storage.getItem(normalKey),normalSentinel);
    }
  }
});

test('P139 optional narrative cannot unlock construction or overwrite a damaged workshop',()=>{
  const storage=fixture();
  advanceMain(storage,'signboard');
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',null),false);
  assert.throws(()=>completeStoryEntry(readStorySave(storage).progress,
    CORE_STORY_PACK,'wrong-letter'),RangeError);
  const damaged='{invalid-workshop';
  storage.setItem(STORY_WORKSHOP_KEY,damaged);
  const storyBefore=storage.getItem(STORY_SAVE_KEY);
  const blocked=readStoryWorkshop(storage,NOW);
  assert.equal(blocked.blocked,true);
  assert.equal(storyDialogueCommitAllowed(storage,'first-order',damaged),false);
  assert.equal(nextCoreStoryJourney(readStorySave(storage).progress,blocked).blocked,true);
  assert.equal(writeStoryWorkshop(storage,blocked.state,{expectedRaw:damaged}),false);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),damaged);
  assert.equal(storage.getItem(STORY_SAVE_KEY),storyBefore);
  assert.equal(storage.getItem(normalKey),normalSentinel);
});
