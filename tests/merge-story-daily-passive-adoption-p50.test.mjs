import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,pinDailyStoryIncident} from '../merge/story/runtime.mjs';
import {adoptConcurrentDailyPinStorageEvent as adopt} from '../merge/story/daily-pin-reconcile.mjs';

const pack=CORE_STORY_PACK,day='2026-10-26';
function ready(){
  let state=startCoreStory(createEmptyStoryProgress(),pack);
  state=completeStoryEntry(state,pack,'arrival','help');
  return completeStoryEntry(state,pack,'signboard');
}
function fixture(){
  const before=ready(),raw=JSON.stringify(before);
  const after=pinDailyStoryIncident(before,pack,day),nextRaw=JSON.stringify(after);
  const data=new Map([[STORY_SAVE_KEY,nextRaw]]);
  const storage={getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){data.set(key,value);writes++;}};
  let writes=0;
  const event={key:STORY_SAVE_KEY,storageArea:storage,oldValue:raw,newValue:nextRaw};
  return {before,raw,after,nextRaw,data,storage,event,get writes(){return writes;}};
}
const run=(f,overrides={},options={})=>adopt({...f.event,...overrides},
  {storage:f.storage,expectedRaw:f.raw,day,pack,...options});

test('P50 a passive tab accepts the peer daily pin with exact old/new bytes and no writes',()=>{
  const f=fixture(),before=JSON.stringify(f.before);
  const result=run(f);
  assert.ok(result);
  assert.equal(result.raw,f.nextRaw);
  assert.deepEqual(result.progress,f.after);
  assert.equal(JSON.stringify(f.before),before);
  assert.equal(f.writes,0);
});

test('P50 unrelated and ambiguous storage events never authorize adoption',()=>{
  const f=fixture();
  for(const event of [
    {key:null},{key:'other-key'},{storageArea:{}},{storageArea:null},
    {oldValue:null},{oldValue:'wrong-baseline'},
    {newValue:null},{newValue:'not-the-real-save'}
  ])assert.equal(run(f,event),null);
  assert.equal(f.writes,0);
});

test('P50 readback must match event bytes, including post-event races and storage faults',()=>{
  const f=fixture();
  f.data.set(STORY_SAVE_KEY,'{broken');
  assert.equal(run(f),null);
  f.data.set(STORY_SAVE_KEY,f.raw);
  assert.equal(run(f),null);
  f.data.set(STORY_SAVE_KEY,JSON.stringify({...f.after,revision:f.after.revision+1}));
  assert.equal(run(f),null);
  const broken={getItem(){throw Error('denied');},setItem(){}};
  assert.equal(run(f,{storageArea:broken},{storage:broken}),null);
  assert.equal(f.writes,0);
});

test('P50 chapter completion, tampered choice and formatting-only save are not pins',()=>{
  const f=fixture();
  const chapter=completeStoryEntry(f.before,pack,'first-order','listen');
  for(const candidate of [chapter,{...f.after,revision:f.after.revision+1},
    {...f.after,packs:{...f.after.packs,core:{...f.after.packs.core,
      choices:{...f.after.packs.core.choices,arrival:'ask'}}}}]){
    const raw=JSON.stringify(candidate);
    f.data.set(STORY_SAVE_KEY,raw);
    assert.equal(run(f,{newValue:raw}),null);
  }
  const pretty=JSON.stringify(f.after,null,2);
  f.data.set(STORY_SAVE_KEY,pretty);
  assert.equal(run(f,{newValue:pretty}),null);
});

test('P50 rollover, forged baseline, invalid day and missing pack fail closed',()=>{
  const f=fixture();
  assert.equal(run(f,{}, {day:'2026-10-27'}),null);
  assert.equal(run(f,{}, {day:'invalid'}),null);
  assert.equal(run(f,{}, {pack:null}),null);
  assert.equal(run(f,{}, {expectedRaw:'{invalid'}),null);
  assert.equal(run(f,{}, {expectedRaw:JSON.stringify(f.after)}),null);
  assert.equal(f.writes,0);
});

test('P50 UI adopts only while idle, closes stale dialogue and preserves fail-closed path',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {adoptConcurrentDailyPinStorageEvent} from './daily-pin-reconcile.mjs';"));
  assert.ok(ui.includes('const adopted=!saving&&!blocked?adoptConcurrentDailyPinStorageEvent(event,{'));
  assert.ok(ui.includes('storage:store,expectedRaw:raw,day:localDay(),pack:CORE_STORY_PACK'));
  assert.ok(ui.includes('storageEpoch++;progress=adopted.progress;raw=adopted.raw;'));
  assert.ok(ui.includes('selected=null;selectedChoice=null;selectedIncidentDay=null;'));
  assert.ok(ui.includes("storageEpoch++;blocked=true;reason='WRITE_CONFLICT';selectedChoice=null;"));
  assert.equal(ui.includes('innerHTML'),false);
});
