import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {readStoryWorkshop,writeStoryWorkshop,STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {nextCoreStoryJourney} from '../merge/story/journey-guide.mjs';
import {storyDialogueCommitAllowed} from '../merge/story/dialogue-commit-guard.mjs';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';

const NOW=1_000_000;
const main=CORE_STORY_PACK.entries.filter(entry=>entry.kind==='main');
const gates=Object.freeze({
  'first-order':{through:'seed',next:'tea-table'},
  garden:{through:'apprentice',next:'harbor-light'},
  harbor:{through:'harbor-light',next:'festival'},
  storefront:{through:'letter-answer',next:null}
});
const normalRaw=JSON.stringify(createInitialState(NOW));
function fixture(){
  const data=new Map([[SAVE_KEY,normalRaw]]);
  let failKey=null;
  // Reopening returns a different page-facing storage adapter over durable bytes.
  const reopen=()=>({
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){
      if(key===failKey)throw new Error('QuotaExceededError');
      data.set(key,value);
    }
  });
  const storage=reopen();
  const initial=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  assert.equal(writeStorySave(storage,initial,{expectedRaw:null}),true);
  return {reopen,setFailure:key=>{failKey=key;}};
}
function advance(storage,through){
  const target=main.findIndex(entry=>entry.id===through);
  const done=readStorySave(storage).progress.packs.core.completed.main.length;
  assert.ok(target>=done,through);
  for(let i=done;i<=target;i++){
    const entry=main[i];
    const story=readStorySave(storage);
    const workshop=readStoryWorkshop(storage,NOW);
    assert.equal(story.blocked,false);
    assert.equal(storyDialogueCommitAllowed(storage,entry.id,workshop.raw),true,entry.id);
    const next=completeStoryEntry(story.progress,CORE_STORY_PACK,entry.id,
      entry.choices[0]?.id??null);
    assert.equal(writeStorySave(storage,next,{expectedRaw:story.raw}),true,entry.id);
  }
}
test('P96 inefficient strategies persist all four real workshop gates across page reopenings',()=>{
  for(const strategy of ['novice','novice-supplies']){
    for(const seed of [7,42,20261027]){
      const h=fixture();
      advance(h.reopen(),'signboard');
      const seen=[];
      const result=simulateStoryBoard({seed,strategy,maxActions:10_000,
        onMilestone:(milestone,state)=>{
          const storage=h.reopen();
          const before=readStoryWorkshop(storage,NOW);
          assert.equal(before.blocked,false);
          assert.equal(validateSave(state),true);
          assert.equal(writeStoryWorkshop(storage,state,{expectedRaw:before.raw}),true);
          assert.equal(writeStoryWorkshop(storage,state,{expectedRaw:before.raw}),false,
            'stale page cannot replay a previously saved milestone');
          const fresh=h.reopen();
          const restored=readStoryWorkshop(fresh,NOW);
          assert.equal(restored.blocked,false);
          assert.deepEqual(restored.state,state);
          assert.equal(storyDialogueCommitAllowed(fresh,
            milestone.id==='garden'?'tea-table':milestone.id==='harbor'?'harbor-light':
              milestone.id==='storefront'?'festival':'first-order',restored.raw),true);
          advance(fresh,gates[milestone.id].through);
          const story=readStorySave(h.reopen());
          assert.equal(story.blocked,false);
          const journey=nextCoreStoryJourney(story.progress,readStoryWorkshop(h.reopen(),NOW));
          assert.equal(journey.kind,gates[milestone.id].next?'workshop':'complete');
          if(gates[milestone.id].next)
            assert.equal(journey.entry.id,gates[milestone.id].next);
          assert.equal(fresh.getItem(SAVE_KEY),normalRaw);
          seen.push(milestone.id);
        }});
      assert.equal(result.complete,true,strategy+'/'+seed+': '+result.reason);
      assert.deepEqual(seen,Object.keys(gates));
      assert.equal(readStorySave(h.reopen()).progress.packs.core.completed.main.length,main.length);
      assert.equal(readStorySave(h.reopen()).progress.packs.core.completed.side.length,0);
      assert.equal(h.reopen().getItem(SAVE_KEY),normalRaw);
      assert.ok(result.actions<10_000);
    }
  }
});
test('P96 quota failure at workshop and dialogue commits never fabricates chapter progress',()=>{
  const h=fixture();
  advance(h.reopen(),'signboard');
  let checked=false;
  const result=simulateStoryBoard({seed:7,strategy:'novice',maxActions:10_000,
    onMilestone:(milestone,state)=>{
      if(milestone.id!=='first-order')return;
      checked=true;
      const storage=h.reopen();
      const before=readStorySave(storage);
      h.setFailure(STORY_WORKSHOP_KEY);
      assert.equal(writeStoryWorkshop(storage,state,{expectedRaw:null}),false);
      assert.equal(storage.getItem(STORY_WORKSHOP_KEY),null);
      assert.equal(storyDialogueCommitAllowed(storage,'first-order',null),false);
      assert.equal(nextCoreStoryJourney(readStorySave(storage).progress,
        readStoryWorkshop(storage,NOW)).kind,'workshop');
      h.setFailure(null);
      assert.equal(writeStoryWorkshop(storage,state,{expectedRaw:null}),true);
      const workshop=readStoryWorkshop(h.reopen(),NOW);
      assert.equal(storyDialogueCommitAllowed(storage,'first-order',workshop.raw),true);
      const entry=main.find(item=>item.id==='first-order');
      const next=completeStoryEntry(before.progress,CORE_STORY_PACK,'first-order',
        entry.choices[0]?.id??null);
      h.setFailure(STORY_SAVE_KEY);
      assert.equal(writeStorySave(storage,next,{expectedRaw:before.raw}),false);
      assert.equal(storage.getItem(STORY_SAVE_KEY),before.raw);
      h.setFailure(null);
      assert.equal(writeStorySave(h.reopen(),next,{expectedRaw:before.raw}),true);
      assert.equal(readStorySave(h.reopen()).progress.packs.core.completed.main.includes('first-order'),true);
      assert.equal(h.reopen().getItem(SAVE_KEY),normalRaw);
    }});
  assert.equal(checked,true);
  assert.equal(result.complete,true,result.reason);
  assert.equal(h.reopen().getItem(SAVE_KEY),normalRaw);
});
