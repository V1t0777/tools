import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,pinDailyStoryIncident} from '../merge/story/runtime.mjs';
import {adoptConcurrentDailyPinOnResume,canKeepResumedStoryDialogue} from '../merge/story/daily-pin-reconcile.mjs';

const pack=CORE_STORY_PACK,day='2026-10-26';
const entry=id=>pack.entries.find(item=>item.id===id);
function fixture(){
  let before=startCoreStory(createEmptyStoryProgress(),pack);
  before=completeStoryEntry(before,pack,'arrival','help');
  before=completeStoryEntry(before,pack,'signboard');
  const after=pinDailyStoryIncident(before,pack,day);
  const raw=JSON.stringify(before),nextRaw=JSON.stringify(after);
  const storage={getItem:key=>key===STORY_SAVE_KEY?nextRaw:null,
    setItem(){throw Error('read-only resume must not write');}};
  return {before,after,raw,nextRaw,storage};
}
function keep(progress,options={}){
  return canKeepResumedStoryDialogue({
    snapshotOk:true,blocked:false,saving:false,dialogOpen:true,
    entry:entry('first-order'),progress,pack,...options
  });
}

test('P53 duplicate safe resume signals retain an unlocked mainline choice',()=>{
  const f=fixture();
  assert.equal(keep(f.before),true);
  assert.equal(keep(f.before),true);
  const finished=completeStoryEntry(f.before,pack,'first-order','listen');
  assert.equal(finished.packs.core.choices['first-order'],'listen');
});

test('P53 byte-identical daily pin adoption retains a mainline choice on resume',()=>{
  const f=fixture();
  const adopted=adoptConcurrentDailyPinOnResume(f.storage,{
    expectedRaw:f.raw,day,pack
  });
  assert.ok(adopted);
  assert.equal(adopted.raw,f.nextRaw);
  assert.equal(keep(adopted.progress),true);
  assert.equal(keep(adopted.progress),true);
  const finished=completeStoryEntry(adopted.progress,pack,'first-order','listen');
  assert.equal(finished.packs.core.choices['daily-20261026'],
    f.after.packs.core.choices['daily-20261026']);
});

test('P53 completed chapters are readable but daily and locked scenes must close',()=>{
  const f=fixture();
  assert.equal(keep(f.after,{entry:entry('arrival')}),true);
  for(const id of ['cat-nap','baking','old-crate','seed','toolbox'])
    assert.equal(keep(f.after,{entry:entry(id)}),false,id);
  assert.equal(keep(f.after,{entry:{...entry('first-order')}}),false);
});

test('P53 stale, blocked, saving, hidden, and unknown resume flags fail closed',()=>{
  const f=fixture();
  for(const flags of [
    {snapshotOk:false},{snapshotOk:undefined},{blocked:true},
    {blocked:undefined},{saving:true},{saving:undefined},
    {dialogOpen:false},{dialogOpen:undefined},{entry:null},
    {progress:null},{pack:null}
  ])assert.equal(keep(f.after,flags),false,JSON.stringify(flags));
  assert.equal(canKeepResumedStoryDialogue(),false);
});

test('P53 guard never mutates the story progress or the daily pin',()=>{
  const f=fixture(),before=JSON.stringify(f.after);
  for(let i=0;i<3;i++)keep(f.after);
  assert.equal(JSON.stringify(f.after),before);
});

test('P53 UI retains only verified main/side dialogue across double resume events',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes('let snapshotOk=false;'));
  assert.ok(ui.includes('snapshotOk=check.ok;'));
  assert.ok(ui.includes('const keepDialog=canKeepResumedStoryDialogue({'));
  assert.ok(ui.includes("snapshotOk,blocked,saving,dialogOpen:$('story-dialog').open,"));
  assert.ok(ui.includes('entry:selected,progress,pack:CORE_STORY_PACK'));
  assert.ok(ui.includes('if(!keepDialog){'));
  assert.ok(ui.includes('selected=null;selectedChoice=null;selectedIncidentDay=null;'));
  assert.ok(ui.includes("if(!check.ok){blocked=true;reason=check.reason;storageEpoch++;}"));
  assert.ok(ui.includes('if(!commitGuard()){'));
  assert.equal(ui.includes('innerHTML'),false);
});
