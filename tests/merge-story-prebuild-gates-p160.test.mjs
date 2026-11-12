import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDINGS,getLevel} from '../merge/economy.mjs';
import {validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,availableStoryEntries} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {readStoryWorkshop,writeStoryWorkshop,STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {storyWorkshopRequirement,storyGardenBuildAvailable,
  storyHarborBuildAvailable,storyStorefrontBuildAvailable} from '../merge/story/workshop-gate.mjs';
import {storyDialogueCommitAllowed} from '../merge/story/dialogue-commit-guard.mjs';
import {nextCoreStoryJourney} from '../merge/story/journey-guide.mjs';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';

// P160: the simulation invokes onConstructionReady BEFORE the real engine
// spends coins and upgrades a building. A player can have enough resources
// without having built anything; that snapshot must not unlock a story beat.
const NOW=1_000_000;
const main=CORE_STORY_PACK.entries.filter(entry=>entry.kind==='main');
const gateByBuilding=Object.freeze({
  garden:{entry:'tea-table',anchor:'seed',allowed:storyGardenBuildAvailable},
  harbor:{entry:'harbor-light',anchor:'apprentice',allowed:storyHarborBuildAvailable},
  storefront:{entry:'festival',anchor:'harbor-light',allowed:storyStorefrontBuildAvailable}
});
const normalSentinel='normal-mode-untouched-p160';
function fixture(){
  const values=new Map([[SAVE_KEY,normalSentinel]]);
  const storage={
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,value)
  };
  const initial=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  assert.equal(writeStorySave(storage,initial,{expectedRaw:null}),true);
  return storage;
}
function advanceTo(storage,last){
  const stop=main.findIndex(entry=>entry.id===last);
  assert.ok(stop>=0,'known scene '+last);
  let done=readStorySave(storage).progress.packs.core.completed.main.length;
  assert.ok(done<=stop+1,'cannot rewind narrative');
  while(done<=stop){
    const entry=main[done];
    const before=readStorySave(storage);
    const workshop=readStoryWorkshop(storage,NOW);
    assert.ok(availableStoryEntries(before.progress,CORE_STORY_PACK,'main')
      .some(item=>item.id===entry.id),'scene chronology: '+entry.id);
    assert.equal(storyDialogueCommitAllowed(storage,entry.id,workshop.raw),true,
      'a completed real goal is required for '+entry.id);
    const next=completeStoryEntry(before.progress,CORE_STORY_PACK,entry.id,
      entry.choices[0]?.id??null);
    assert.equal(writeStorySave(storage,next,{expectedRaw:before.raw}),true,entry.id);
    done++;
  }
}
function persist(storage,state){
  assert.equal(validateSave(state),true);
  const previous=readStoryWorkshop(storage,NOW);
  assert.equal(previous.blocked,false);
  // Two buildings can become affordable consecutively: the next pre-build
  // snapshot may be byte-identical to the just-saved previous milestone.
  // Reuse it instead of inventing a revision or performing a rejected write.
  const encoded=JSON.stringify(state);
  if(previous.raw===encoded)return previous;
  assert.ok(state.revision>previous.state.revision,
    'changed snapshot must advance revision; previous '+previous.state.revision+
    ', next '+state.revision);
  assert.equal(writeStoryWorkshop(storage,state,{expectedRaw:previous.raw}),true);
  const restored=readStoryWorkshop(storage,NOW);
  assert.deepEqual(restored.state,state);
  return restored;
}

test('P160 earned coins/level alone never unlock a pre-build chapter; actual construction and saved story do',
  {timeout:180000},()=>{
    for(const strategy of ['novice','novice-supplies']){
      for(const seed of [0,7,42,20261027,0xffffffff]){
        const storage=fixture();
        advanceTo(storage,'signboard');
        const ready=new Map(),seen=[];
        const result=simulateStoryBoard({seed,strategy,maxActions:10_000,
          onConstructionReady:(building,state)=>{
            const spec=gateByBuilding[building];
            assert.ok(spec,'unexpected construction '+building);
            assert.equal(ready.has(building),false,'construction ready once');
            const story=readStorySave(storage).progress;
            assert.equal(spec.allowed(story),true,
              'construction needs its actual preceding scene: '+spec.anchor);
            assert.equal(state.buildings[building],0,
              'coins and level are not proof that '+building+' was built');
            assert.ok(state.coins>=BUILDINGS[building].coins);
            assert.ok(getLevel(state.xp)>=BUILDINGS[building].minLevel);
            const before=persist(storage,state);
            assert.equal(storyWorkshopRequirement(spec.entry,before.state).met,false);
            assert.equal(storyDialogueCommitAllowed(storage,spec.entry,before.raw),false,
              'unspent building resources must never bypass construction');
            const journey=nextCoreStoryJourney(story,before);
            assert.equal(journey.kind,'workshop');
            assert.equal(journey.entry.id,spec.entry);
            ready.set(building,before.raw);
            assert.equal(storage.getItem(SAVE_KEY),normalSentinel);
          },
          onMilestone:(milestone,state)=>{
            seen.push(milestone.id);
            const saved=persist(storage,state);
            if(milestone.id==='first-order'){
              assert.equal(storyDialogueCommitAllowed(storage,'first-order',saved.raw),true);
              advanceTo(storage,'seed');
            }else{
              const spec=gateByBuilding[milestone.id];
              assert.ok(spec,'unexpected milestone '+milestone.id);
              assert.ok(ready.has(milestone.id),'pre-build snapshot was inspected');
              assert.equal(storyDialogueCommitAllowed(storage,spec.entry,
                ready.get(milestone.id)),false,
                'an earlier workshop snapshot cannot authorize a chapter');
              assert.equal(storyWorkshopRequirement(spec.entry,saved.state).met,true);
              assert.equal(storyDialogueCommitAllowed(storage,spec.entry,saved.raw),true);
              const next=milestone.id==='garden'?'apprentice':
                milestone.id==='harbor'?'harbor-light':'letter-answer';
              advanceTo(storage,next);
              if(milestone.id!=='storefront'){
                const journey=nextCoreStoryJourney(readStorySave(storage).progress,
                  readStoryWorkshop(storage,NOW));
                assert.equal(journey.kind,'workshop',
                  'next chapter still requires the next real building');
              }
            }
            assert.equal(storage.getItem(SAVE_KEY),normalSentinel);
          }});
        assert.equal(result.complete,true,strategy+'/'+seed+': '+result.reason);
        assert.deepEqual(seen,['first-order','garden','harbor','storefront']);
        assert.deepEqual([...ready.keys()],['garden','harbor','storefront']);
        const story=readStorySave(storage);
        assert.equal(story.blocked,false);
        assert.deepEqual(story.progress.packs.core.completed.main,
          main.map(entry=>entry.id));
        assert.deepEqual(story.progress.packs.core.completed.side,[]);
        assert.deepEqual(story.progress.packs.core.completed.incident,[]);
        assert.equal(nextCoreStoryJourney(story.progress,
          readStoryWorkshop(storage,NOW)).kind,'complete');
        assert.equal(storage.getItem(SAVE_KEY),normalSentinel);
        assert.equal(storage.getItem(STORY_SAVE_KEY)!==null,true);
        assert.equal(storage.getItem(STORY_WORKSHOP_KEY)!==null,true);
      }
    }
  });
