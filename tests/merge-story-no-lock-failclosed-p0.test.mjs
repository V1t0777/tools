import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runStoryWriteWithLock} from '../merge/story/write-lock.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {resetStoryWorkshopWithLock} from '../merge/story/workshop-reset.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function storageWithSentinels(){
  const values=new Map([[SAVE_KEY,'normal-unchanged'],[STORY_SAVE_KEY,'story-unchanged'],[STORY_WORKSHOP_KEY,'workshop-unchanged']]);
  let reads=0,writes=0;
  return {storage:{
    getItem(key){reads++;return values.get(key)??null;},
    setItem(key,value){writes++;values.set(key,value);}
  },values,counts:()=>({reads,writes})};
}
test('P0 missing Web Locks prevents parallel writes to both story saves and normal-mode data',async()=>{
  const {storage,values,counts}=storageWithSentinels();
  let callbacks=0;
  const actions=await Promise.all([
    runStoryWriteWithLock(null,STORY_SAVE_KEY,()=>{callbacks++;storage.setItem(STORY_SAVE_KEY,'unsafe');return true;}),
    runStoryWriteWithLock(undefined,STORY_WORKSHOP_KEY,()=>{callbacks++;storage.setItem(STORY_WORKSHOP_KEY,'unsafe');return true;}),
    saveStoryDialogueWithLock(null,storage,createEmptyStoryProgress(),{expectedRaw:'story-unchanged',confirmedReset:true}),
    resetStoryWorkshopWithLock(null,storage,{expectedRaw:'workshop-unchanged'})
  ]);
  assert.equal(callbacks,0);
  for(const action of actions)assert.deepEqual(action,{ok:false,mode:'lock-unavailable',value:false});
  assert.deepEqual(counts(),{reads:0,writes:0});
  assert.equal(values.get(SAVE_KEY),'normal-unchanged');
  assert.equal(values.get(STORY_SAVE_KEY),'story-unchanged');
  assert.equal(values.get(STORY_WORKSHOP_KEY),'workshop-unchanged');
});
test('P0 no-lock refusal does not execute a callback even after repeated attempts',async()=>{
  let calls=0;
  for(let i=0;i<20;i++){
    const result=await runStoryWriteWithLock(null,i%2?STORY_SAVE_KEY:STORY_WORKSHOP_KEY,()=>{calls++;throw Error('must not execute');});
    assert.equal(result.mode,'lock-unavailable');
    assert.equal(result.ok,false);
  }
  assert.equal(calls,0);
});
test('P0 read-only protection is visible in both pages; reset and workshop actions are disabled',()=>{
  const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
  const story=read('../merge/story/ui.mjs'),workshop=read('../merge/story/workshop.mjs');
  for(const ui of [story,workshop]){
    assert.ok(ui.includes("const lockUnavailable=webLocks==null||typeof webLocks.request!=='function';"));
    assert.ok(ui.includes('lockUnavailable'));
    assert.ok(ui.includes('只读'));
  }
  assert.ok(story.includes("pageSuspended()||lockUnavailable||reason==='STORAGE_UNAVAILABLE'"));
  assert.ok(story.includes('if(pageSuspended()||lockUnavailable)return false;'));
  assert.ok(story.includes("finish.disabled=saving||(!done&&(lockUnavailable||blocked"));
  assert.ok(story.includes("$('complete-story').disabled=lockUnavailable||blocked"));
  assert.ok(workshop.includes('const disabled=blocked||saving||pageSuspended()||lockUnavailable;'));
  assert.ok(workshop.includes('if(saving||pageSuspended()||lockUnavailable)return;'));
});
