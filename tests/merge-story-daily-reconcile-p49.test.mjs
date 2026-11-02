import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,pinDailyStoryIncident} from '../merge/story/runtime.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {isMatchingConcurrentDailyPin} from '../merge/story/daily-pin-reconcile.mjs';

const pack=CORE_STORY_PACK,day='2026-10-26';
function ready(){
  let state=startCoreStory(createEmptyStoryProgress(),pack);
  state=completeStoryEntry(state,pack,'arrival','help');
  return completeStoryEntry(state,pack,'signboard');
}
const proof=(expectedRaw,observedRaw,proposed,overrides={})=>
  isMatchingConcurrentDailyPin({expectedRaw,observedRaw,proposed,day,pack,...overrides});
function memory(raw){
  const data=new Map([[STORY_SAVE_KEY,raw]]),writes=[];
  return {writes,getItem:k=>data.has(k)?data.get(k):null,
    setItem(k,v){writes.push([k,v]);data.set(k,v);}};
}
function locks(){
  let tail=Promise.resolve();
  return {request(_name,_opts,fn){
    const work=tail.then(fn);tail=work.catch(()=>{});return work;
  }};
}

test('P49 a second tab recognizes the same byte-exact daily pin without writing',async()=>{
  const before=ready(),raw=JSON.stringify(before),db=memory(raw),webLocks=locks();
  const next=pinDailyStoryIncident(before,pack,day);
  const [first,second]=await Promise.all([
    saveStoryDialogueWithLock(webLocks,db,next,{expectedRaw:raw}),
    saveStoryDialogueWithLock(webLocks,db,next,{expectedRaw:raw})
  ]);
  assert.deepEqual([first.value,second.value],[true,false]);
  const actual=db.getItem(STORY_SAVE_KEY);
  assert.equal(proof(raw,actual,next),true);
  assert.equal(db.writes.length,1,'adopting the identical pin must be read-only');
  assert.equal(JSON.stringify(next),actual);
});

test('P49 chapter progression is never mistaken for a competing daily pin',()=>{
  const before=ready(),raw=JSON.stringify(before);
  const next=pinDailyStoryIncident(before,pack,day);
  const chapter=completeStoryEntry(before,pack,'first-order','listen');
  assert.equal(proof(raw,JSON.stringify(chapter),next),false);
  const advanced=completeStoryEntry(next,pack,'first-order','listen');
  assert.equal(proof(raw,JSON.stringify(advanced),next),false);
});

test('P49 other day, other proposal and reserialized saves are never adopted',()=>{
  const before=ready(),raw=JSON.stringify(before);
  const next=pinDailyStoryIncident(before,pack,day),actual=JSON.stringify(next);
  assert.equal(proof(raw,actual,next,{day:'2026-10-27'}),false);
  assert.equal(proof(raw,actual,pinDailyStoryIncident(before,pack,'2026-10-27')),false);
  assert.equal(proof(raw,JSON.stringify(next,null,2),next),false);
  assert.equal(proof(raw,raw,next),false);
});

test('P49 corrupted, unavailable and unregistered saves fail closed',()=>{
  const before=ready(),raw=JSON.stringify(before);
  const next=pinDailyStoryIncident(before,pack,day),actual=JSON.stringify(next);
  for(const malformed of [null,undefined,'{broken','[]','{}'])
    assert.equal(proof(malformed,actual,next),false);
  for(const malformed of [null,undefined,'{broken','[]','{}'])
    assert.equal(proof(raw,malformed,next),false);
  assert.equal(proof(raw,actual,next,{pack:{id:'neighbor',entries:[]}}),false);
  assert.equal(proof(raw,actual,next,{day:'not-a-date'}),false);
});

test('P49 unrelated saved choice cannot be overwritten or silently adopted',()=>{
  const before=ready(),raw=JSON.stringify(before),next=pinDailyStoryIncident(before,pack,day);
  const modified=structuredClone(next);
  modified.packs.core.choices.arrival='ask';
  assert.equal(proof(raw,JSON.stringify(modified),next),false);
  const tampered=structuredClone(next);
  tampered.packs.core.choices['daily-20261026']='other-event';
  assert.equal(proof(raw,JSON.stringify(tampered),next),false);
});

test('P49 UI accepts only a successful lock callback with stale raw and current day',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {isMatchingConcurrentDailyPin} from './daily-pin-reconcile.mjs';"));
  assert.ok(ui.includes('pinDay!==null&&localDay()===pinDay&&attempt.ok&&attempt.value===false&&'));
  assert.ok(ui.includes("(!blocked||reason==='WRITE_CONFLICT')"));
  assert.ok(ui.includes('isMatchingConcurrentDailyPin({expectedRaw,observedRaw:current.raw,proposed:next,day:pinDay,pack:CORE_STORY_PACK})'));
  assert.ok(ui.includes('progress=current.progress;raw=current.raw;blocked=false;reason=null;'));
  assert.ok(ui.includes('if(!attempt.ok||attempt.value!==true||storageEpoch!==expectedEpoch||(!reset&&blocked)){'));
  assert.ok(ui.includes('text.textContent=line.text;'));
  assert.equal(ui.includes('innerHTML'),false);
});
