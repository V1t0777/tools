import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyStoryProgress,validateStoryProgress,MAX_TRACKED_NODES,MAX_TRACKED_CHOICES} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {validateStoryPack,startCoreStory,completeStoryEntry,pinDailyStoryIncident} from '../merge/story/runtime.mjs';

const scene=(index,{kind='main',choice=false}={})=>({
  id:'scene-'+index,kind,title:'容量测试 '+index,chapter:'测试',place:'工作台',
  requires:[],repeatable:kind==='incident',
  lines:[{speaker:'旁白',text:'仅用于容量回归。'}],
  choices:choice?[{id:'accept',label:'确认',reply:'已记录'}]:[]
});
const pack=entries=>({id:'capacity-test',title:'容量边界测试',version:1,entries});

test('P159 first-volume pack remains valid after preflight capacity protection',()=>{
  assert.equal(validateStoryPack(CORE_STORY_PACK),true);
  assert.equal(MAX_TRACKED_NODES,512);
  assert.equal(MAX_TRACKED_CHOICES,256);
});
test('P159 reject the 513th main scene before a late chapter becomes unsaveable',()=>{
  const atLimit=pack(Array.from({length:MAX_TRACKED_NODES},(_,i)=>scene(i)));
  assert.equal(validateStoryPack(atLimit),true);
  const overLimit=pack([...atLimit.entries,scene(MAX_TRACKED_NODES)]);
  assert.equal(validateStoryPack(overLimit),false);
  const initial=createEmptyStoryProgress(),snapshot=structuredClone(initial);
  assert.throws(()=>startCoreStory(initial,overLimit),TypeError);
  assert.deepEqual(initial,snapshot);
});
test('P159 reject more choice-bearing scenes than the persisted dictionary permits',()=>{
  const atLimit=pack(Array.from({length:MAX_TRACKED_CHOICES},(_,i)=>scene(i,{choice:true})));
  assert.equal(validateStoryPack(atLimit),true);
  assert.equal(validateStoryPack(pack([...atLimit.entries,scene(MAX_TRACKED_CHOICES,{choice:true})])),false);
});
test('P159 reserve one choice slot for a daily pin; 255 choices plus incident remain playable',()=>{
  const choiceScenes=Array.from({length:MAX_TRACKED_CHOICES-1},(_,i)=>scene(i,{choice:true}));
  const daily=scene(999,{kind:'incident'});
  const valid=pack([...choiceScenes,daily]);
  assert.equal(validateStoryPack(valid),true);
  assert.equal(validateStoryPack(pack([...choiceScenes,scene(998,{choice:true}),daily])),false);
  let save=startCoreStory(createEmptyStoryProgress(),valid);
  for(const entry of choiceScenes)
    save=completeStoryEntry(save,valid,entry.id,'accept');
  const pinned=pinDailyStoryIncident(save,valid,'2026-10-30');
  assert.equal(validateStoryProgress(pinned),true);
  assert.equal(Object.keys(pinned.packs[valid.id].choices).length,MAX_TRACKED_CHOICES);
  assert.equal(pinned.packs[valid.id].choices['daily-20261030'],daily.id);
  assert.equal(validateStoryProgress(save),true);
});
