import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyStoryProgress,validateStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {validateStoryPack,startCoreStory,completeStoryEntry,completedStoryEntries} from '../merge/story/runtime.mjs';

// Pack validation must agree with the persisted save schema before gameplay.
const laterPack=()=>({
  id:'coast.chapter2',title:'海岸后记',version:1,
  entries:[{
    id:'visit-again',kind:'main',title:'再访海岸',chapter:'后记',
    place:'海岸小路',requires:[],repeatable:false,
    lines:[{speaker:'旁白',text:'岛上的新一天开始了。'}],
    choices:[{id:'wait',label:'稍作停留',reply:'海风吹过。'}]
  }]
});
test('P158 legal dotted DLC registers and saves without changing core progress',()=>{
  assert.equal(validateStoryPack(CORE_STORY_PACK),true);
  const dlc=laterPack();
  assert.equal(validateStoryPack(dlc),true);
  const core=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  const before=structuredClone(core.packs.core);
  const registered=startCoreStory(core,dlc);
  const completed=completeStoryEntry(registered,dlc,'visit-again','wait');
  assert.equal(validateStoryProgress(completed),true);
  assert.deepEqual(completed.packs.core,before);
  assert.deepEqual(completedStoryEntries(completed,dlc,'main').map(x=>x.id),['visit-again']);
  assert.equal(completed.packs['coast.chapter2'].choices['visit-again'],'wait');
});
test('P158 reject reserved pack names and dotted components before registration',()=>{
  for(const id of ['constructor','prototype','__proto__',
    'dlc.constructor','dlc.prototype','constructor.dlc']){
    const pack={...laterPack(),id};
    assert.equal(validateStoryPack(pack),false,id);
    const original=createEmptyStoryProgress(),snapshot=structuredClone(original);
    assert.throws(()=>startCoreStory(original,pack),TypeError,id);
    assert.deepEqual(original,snapshot,'failed registration cannot mutate save');
  }
});
test('P158 reject reserved entry IDs before an unsaveable scene is offered',()=>{
  for(const id of ['constructor','prototype','__proto__']){
    const pack=laterPack();pack.entries[0].id=id;
    assert.equal(validateStoryPack(pack),false,id);
    assert.throws(()=>startCoreStory(createEmptyStoryProgress(),pack),TypeError,id);
  }
});
test('P158 reject reserved choice IDs before an unsaveable dialogue is offered',()=>{
  for(const id of ['constructor','prototype','__proto__']){
    const pack=laterPack();pack.entries[0].choices[0].id=id;
    assert.equal(validateStoryPack(pack),false,id);
    assert.throws(()=>startCoreStory(createEmptyStoryProgress(),pack),TypeError,id);
  }
});
