import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,pinDailyStoryIncident} from '../merge/story/runtime.mjs';
import {adoptConcurrentDailyPinOnResume as adopt} from '../merge/story/daily-pin-reconcile.mjs';

const pack=CORE_STORY_PACK,day='2026-10-26';
function fixture(){
  let before=startCoreStory(createEmptyStoryProgress(),pack);
  before=completeStoryEntry(before,pack,'arrival','help');
  before=completeStoryEntry(before,pack,'signboard');
  const after=pinDailyStoryIncident(before,pack,day);
  const raw=JSON.stringify(before),nextRaw=JSON.stringify(after);
  const data=new Map([[STORY_SAVE_KEY,nextRaw]]);
  let writes=0;
  const storage={getItem(key){return data.has(key)?data.get(key):null;},
    setItem(){writes++;throw Error('resume reconciliation must be read-only');}};
  return {before,after,raw,nextRaw,data,storage,get writes(){return writes;}};
}
const run=(f,overrides={})=>adopt(f.storage,{expectedRaw:f.raw,day,pack,...overrides});

test('P52 BFCache resume adopts only the exact same-day pin without StorageEvent',()=>{
  const f=fixture(),snapshot=JSON.stringify(f.before);
  const result=run(f);
  assert.ok(result);
  assert.equal(result.raw,f.nextRaw);
  assert.deepEqual(result.progress,f.after);
  assert.equal(JSON.stringify(f.before),snapshot);
  assert.equal(f.writes,0);
});

test('P52 a recovered pin preserves the next mainline choice and pinned incident',()=>{
  const f=fixture(),result=run(f);
  assert.ok(result);
  const completed=completeStoryEntry(result.progress,pack,'first-order','listen');
  assert.equal(completed.packs.core.choices['first-order'],'listen');
  assert.equal(completed.packs.core.choices['daily-20261026'],
    f.after.packs.core.choices['daily-20261026']);
  assert.equal(f.writes,0);
});

test('P52 resume never accepts yesterday pin, invalid day, missing pack or baseline',()=>{
  const f=fixture();
  for(const options of [
    {day:'2026-10-27'},{day:'not-a-date'},{pack:null},
    {expectedRaw:null},{expectedRaw:'{invalid'},{expectedRaw:f.nextRaw}
  ])assert.equal(run(f,options),null);
  assert.equal(f.writes,0);
});

test('P52 chapter, choice and revision changes are not recoverable daily pins',()=>{
  const f=fixture();
  const chapter=completeStoryEntry(f.before,pack,'first-order','listen');
  const tampered=structuredClone(f.after);
  tampered.packs.core.choices.arrival='ask';
  for(const candidate of [
    JSON.stringify(chapter),JSON.stringify(tampered),
    JSON.stringify({...f.after,revision:f.after.revision+1}),
    JSON.stringify(f.after,null,2)
  ]){
    f.data.set(STORY_SAVE_KEY,candidate);
    assert.equal(run(f),null);
  }
  assert.equal(f.writes,0);
});

test('P52 missing, damaged, unavailable and racing storage fail closed',()=>{
  const f=fixture();
  for(const raw of [null,'{broken',f.raw]){
    if(raw===null)f.data.delete(STORY_SAVE_KEY);
    else f.data.set(STORY_SAVE_KEY,raw);
    assert.equal(run(f),null);
  }
  assert.equal(adopt(null,{expectedRaw:f.raw,day,pack}),null);
  const denied={getItem(){throw Error('denied');},setItem(){}};
  assert.equal(adopt(denied,{expectedRaw:f.raw,day,pack}),null);
  const readonly={getItem(){return f.nextRaw;}};
  assert.equal(adopt(readonly,{expectedRaw:f.raw,day,pack}),null);
  assert.equal(f.writes,0);
});

test('P52 resumed UI only adopts idle WRITE_CONFLICT and retains strict failure path',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.match(ui,/import \\{adoptConcurrentDailyPinOnResume(?:,canKeepResumedStoryDialogue)?\\} from '\\.\\/daily-pin-reconcile\\.mjs';/);
  assert.ok(ui.includes("if(!check.ok&&!saving&&check.reason==='WRITE_CONFLICT'){"));
  assert.ok(ui.includes('const adopted=adoptConcurrentDailyPinOnResume(store,{'));
  assert.ok(ui.includes('expectedRaw:raw,day:shownDay,pack:CORE_STORY_PACK'));
  assert.ok(ui.includes('storageEpoch++;progress=adopted.progress;raw=adopted.raw;'));
  assert.ok(ui.includes("if(!check.ok){blocked=true;reason=check.reason;storageEpoch++;}"));
  assert.ok(ui.includes("if($('story-dialog').open)$('story-dialog').close();"));
  assert.equal(ui.includes('innerHTML'),false);
});
