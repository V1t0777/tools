import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,pinDailyStoryIncident} from '../merge/story/runtime.mjs';
import {adoptConcurrentDailyPinStorageEvent,canKeepDialogueAfterDailyPin} from '../merge/story/daily-pin-reconcile.mjs';

const pack=CORE_STORY_PACK,day='2026-10-26';
const entry=id=>pack.entries.find(item=>item.id===id);
function through(id){
  let state=startCoreStory(createEmptyStoryProgress(),pack);
  for(const item of pack.entries.filter(x=>x.kind==='main')){
    state=completeStoryEntry(state,pack,item.id,item.choices[0]?.id??null);
    if(item.id===id)return state;
  }
  throw Error('Missing checkpoint');
}

test('P51 a peer daily pin does not discard an open unlocked mainline choice',()=>{
  const before=through('signboard');
  const after=pinDailyStoryIncident(before,pack,day);
  const raw=JSON.stringify(before),nextRaw=JSON.stringify(after);
  const storage={getItem:key=>key===STORY_SAVE_KEY?nextRaw:null,
    setItem(){throw Error('passive adoption must never write');}};
  const event={key:STORY_SAVE_KEY,storageArea:storage,oldValue:raw,newValue:nextRaw};
  const adopted=adoptConcurrentDailyPinStorageEvent(event,{storage,expectedRaw:raw,day,pack});
  assert.ok(adopted);
  assert.equal(canKeepDialogueAfterDailyPin(entry('first-order'),adopted.progress,pack),true);
  const committed=completeStoryEntry(adopted.progress,pack,'first-order','listen');
  assert.equal(committed.packs.core.choices['first-order'],'listen');
  assert.equal(committed.packs.core.choices['daily-20261026'],after.packs.core.choices['daily-20261026']);
  assert.equal(JSON.stringify(before),raw);
});

test('P51 completed mainline and unlocked side dialogues remain readable',()=>{
  const progress=pinDailyStoryIncident(through('first-order'),pack,day);
  assert.equal(canKeepDialogueAfterDailyPin(entry('arrival'),progress,pack),true);
  assert.equal(canKeepDialogueAfterDailyPin(entry('wrong-letter'),progress,pack),true);
});

test('P51 incident dialogues and locked future chapters must close after peer pin',()=>{
  const progress=pinDailyStoryIncident(through('signboard'),pack,day);
  for(const id of ['cat-nap','baking','old-crate','seed','toolbox'])
    assert.equal(canKeepDialogueAfterDailyPin(entry(id),progress,pack),false,id);
});

test('P51 DLC lookalikes, missing pack and invalid saves never keep stale dialogue',()=>{
  const progress=pinDailyStoryIncident(through('signboard'),pack,day);
  assert.equal(canKeepDialogueAfterDailyPin({...entry('first-order')},progress,pack),false);
  assert.equal(canKeepDialogueAfterDailyPin({id:'first-order',kind:'main'},progress,pack),false);
  assert.equal(canKeepDialogueAfterDailyPin(entry('first-order'),progress,null),false);
  assert.equal(canKeepDialogueAfterDailyPin(entry('first-order'),null,pack),false);
  assert.equal(canKeepDialogueAfterDailyPin(entry('first-order'),{packs:{}},pack),false);
});

test('P51 checking whether a chapter may remain open is read-only',()=>{
  const progress=pinDailyStoryIncident(through('first-order'),pack,day);
  const before=JSON.stringify(progress);
  for(const id of ['arrival','first-order','wrong-letter','cat-nap','seed'])
    canKeepDialogueAfterDailyPin(entry(id),progress,pack);
  assert.equal(JSON.stringify(progress),before);
});

test('P51 UI preserves only verified main/side dialog and still closes unsafe ones',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {canKeepDialogueAfterDailyPin} from './daily-pin-reconcile.mjs';"));
  assert.ok(ui.includes("const keepDialog=$('story-dialog').open&&"));
  assert.ok(ui.includes('canKeepDialogueAfterDailyPin(selected,adopted.progress,CORE_STORY_PACK);'));
  assert.ok(ui.includes('storageEpoch++;progress=adopted.progress;raw=adopted.raw;'));
  assert.ok(ui.includes('if(!keepDialog){'));
  assert.ok(ui.includes('selected=null;selectedChoice=null;selectedIncidentDay=null;'));
  assert.ok(ui.includes("storageEpoch++;blocked=true;reason='WRITE_CONFLICT';selectedChoice=null;"));
  assert.equal(ui.includes('innerHTML'),false);
});
