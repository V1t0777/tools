import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,fulfillOrder} from '../merge/engine.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {readStoryWorkshop,STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {inspectStoryWorkshopRequirementFromRead,inspectStoryWorkshopRequirement} from '../merge/story/workshop-gate.mjs';
import {storyWorkshopChapterEcho} from '../merge/story/mainline-workshop-context.mjs';
import {storyDialogueCommitAllowed} from '../merge/story/dialogue-commit-guard.mjs';
import {checkStoryResumeSnapshot} from '../merge/story/resume-guard.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';

const pack=CORE_STORY_PACK;
function progressBeforeOrder(){
  let p=startCoreStory(createEmptyStoryProgress(),pack);
  p=completeStoryEntry(p,pack,'arrival','help');
  return completeStoryEntry(p,pack,'signboard');
}
function earned(){
  const before=createInitialState(1000000),after=fulfillOrder(before,before.orders[0].id);
  assert.equal(after.ok,true);
  return {before,after:after.state};
}
function db(){
  const data=new Map();let writes=0;
  const storage={getItem(k){return data.has(k)?data.get(k):null;},
    setItem(k,v){writes++;data.set(k,v);}};
  return {data,storage,get writes(){return writes;}};
}

test('P56 workshop gate and chapter echo share the same read during a peer write',()=>{
  const {before,after}=earned(),entry=pack.entries.find(e=>e.id==='first-order');
  const initial=JSON.stringify(before),newer=JSON.stringify(after);
  let reads=0;
  const storage={getItem(key){assert.equal(key,STORY_WORKSHOP_KEY);
    return reads++===0?initial:newer;},setItem(){}};
  const snapshot=readStoryWorkshop(storage);
  assert.equal(reads,1);
  assert.equal(inspectStoryWorkshopRequirementFromRead('first-order',snapshot).met,false);
  assert.equal(storyWorkshopChapterEcho(entry,progressBeforeOrder(),snapshot.state),null);
  assert.equal(reads,1,'using captured snapshot must not re-read storage');
  assert.equal(inspectStoryWorkshopRequirement('first-order',storage).met,true,
    'a second read would otherwise contradict the rendered dialogue');
  assert.equal(reads,2);
  assert.match(storyWorkshopChapterEcho(entry,progressBeforeOrder(),after).text,/交付的街坊委托/);
});

test('P56 corrupt, missing and unavailable workshop snapshots never satisfy story goals',()=>{
  const corrupted=readStoryWorkshop({getItem(){return '{bad-json';},setItem(){}});
  const denied=readStoryWorkshop({getItem(){throw Error('denied');},setItem(){}});
  for(const read of [null,corrupted,denied,{blocked:false,state:{board:[]}}]){
    const gate=inspectStoryWorkshopRequirementFromRead('first-order',read);
    assert.equal(gate.met,false);
    assert.equal(gate.blocked,read?.blocked!==false);
  }
  assert.equal(inspectStoryWorkshopRequirementFromRead('unrecognized-dlc-goal',null).required,false);
});

test('P56 a missed workshop update blocks an otherwise ungated story choice without writing',async()=>{
  const {before,after}=earned(),f=db();
  const p=startCoreStory(createEmptyStoryProgress(),pack);
  const raw=JSON.stringify(p),oldWorkshop=JSON.stringify(before);
  f.data.set(STORY_SAVE_KEY,raw);f.data.set(STORY_WORKSHOP_KEY,oldWorkshop);
  const opened=readStoryWorkshop(f.storage);
  f.data.set(STORY_WORKSHOP_KEY,JSON.stringify(after));
  assert.equal(storyDialogueCommitAllowed(f.storage,'arrival',undefined),true);
  const guard=()=>checkStoryResumeSnapshot(f.storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:opened.raw
  }).ok&&storyDialogueCommitAllowed(f.storage,'arrival',undefined);
  assert.equal(guard(),false);
  const next=completeStoryEntry(p,pack,'arrival','help');
  const result=await saveStoryDialogueWithLock({request:async(_n,_o,fn)=>fn()},f.storage,next,{
    expectedRaw:raw,commitGuard:guard
  });
  assert.equal(result.ok,true);assert.equal(result.value,false);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),raw);
  assert.equal(f.writes,0);
});

test('P56 unchanged workshop still permits the existing story locked write',async()=>{
  const {before}=earned(),f=db();
  const p=startCoreStory(createEmptyStoryProgress(),pack);
  const raw=JSON.stringify(p),original=JSON.stringify(before);
  f.data.set(STORY_SAVE_KEY,raw);f.data.set(STORY_WORKSHOP_KEY,original);
  const next=completeStoryEntry(p,pack,'arrival','help');
  const result=await saveStoryDialogueWithLock({request:async(_n,_o,fn)=>fn()},f.storage,next,{
    expectedRaw:raw,commitGuard:()=>checkStoryResumeSnapshot(f.storage,{
      key:STORY_WORKSHOP_KEY,expectedRaw:original
    }).ok&&storyDialogueCommitAllowed(f.storage,'arrival',undefined)
  });
  assert.equal(result.ok,true);assert.equal(result.value,true);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),JSON.stringify(next));
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),original);
  assert.equal(f.writes,1);
});

test('P56 UI opens one workshop snapshot and checks the same raw before and within commit',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  const start=ui.indexOf('function open(entry){'),end=ui.indexOf("$('close-dialog')",start);
  assert.ok(start>=0&&end>start);
  const open=ui.slice(start,end);
  assert.equal((open.match(/readStoryWorkshop\(store\)/g)||[]).length,1);
  assert.equal((open.match(/const workshop=workshopAtOpen;/g)||[]).length,2);
  assert.ok(open.includes('inspectStoryWorkshopRequirementFromRead(entry.id,workshopAtOpen)'));
  assert.ok(ui.includes('if(!openWorkshopCurrent()){'));
  assert.ok(ui.includes('const commitGuard=()=>openWorkshopCurrent()&&'));
  assert.ok(ui.includes('storyDialogueCommitAllowed(store,entryId,expectedWorkshopRaw)'));
  assert.equal(ui.includes('innerHTML'),false);
});
