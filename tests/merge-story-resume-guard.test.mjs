import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkStoryResumeSnapshot} from '../merge/story/resume-guard.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';

function storage(){
  const data=new Map();const reads=[];
  return {data,reads,getItem(key){reads.push(key);return data.has(key)?data.get(key):null;},setItem(key,value){data.set(key,value);}};
}
test('P12 resumed story pages accept unchanged and initially absent snapshots without writes',()=>{
  const store=storage();
  for(const key of [STORY_SAVE_KEY,STORY_WORKSHOP_KEY]){
    assert.deepEqual(checkStoryResumeSnapshot(store,{key,expectedRaw:null}),{ok:true,reason:null});
    store.setItem(key,'{"revision":1}');
    assert.deepEqual(checkStoryResumeSnapshot(store,{key,expectedRaw:'{"revision":1}'}),{ok:true,reason:null});
  }
  assert.deepEqual(store.reads,[STORY_SAVE_KEY,STORY_SAVE_KEY,STORY_WORKSHOP_KEY,STORY_WORKSHOP_KEY]);
});
test('P12 resume detects changed, removed and new saves even when revisions might match',()=>{
  const store=storage();store.setItem(STORY_SAVE_KEY,'{"revision":2,"choice":"a"}');
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:'{"revision":2,"choice":"b"}'}).reason,'WRITE_CONFLICT');
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:null}).reason,'WRITE_CONFLICT');
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_WORKSHOP_KEY,expectedRaw:'old'}).reason,'WRITE_CONFLICT');
  assert.equal(store.getItem(STORY_SAVE_KEY),'{"revision":2,"choice":"a"}');
});
test('P12 unavailable storage and invalid keys fail closed before unrelated reads',()=>{
  const store=storage();
  assert.equal(checkStoryResumeSnapshot(store,{key:'toolbox.merge-isle.local.v1',expectedRaw:'secret'}).reason,'INVALID_KEY');
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY}).reason,'INVALID_SNAPSHOT');
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:42}).reason,'INVALID_SNAPSHOT');
  assert.equal(store.reads.length,0);
  assert.equal(checkStoryResumeSnapshot(null,{key:STORY_SAVE_KEY,expectedRaw:null}).reason,'STORAGE_UNAVAILABLE');
  assert.equal(checkStoryResumeSnapshot({getItem(){throw Error('denied');}},{key:STORY_WORKSHOP_KEY,expectedRaw:null}).reason,'STORAGE_UNAVAILABLE');
});
test('P12 both story UIs recheck after BFCache restore and foreground visibility',()=>{
  for(const [path,key,fn] of [
    ['../merge/story/ui.mjs','STORY_SAVE_KEY','recheckStoryOnResume'],
    ['../merge/story/workshop.mjs','STORY_WORKSHOP_KEY','recheckWorkshopOnResume']
  ]){
    const ui=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.ok(ui.includes("import {checkStoryResumeSnapshot} from './resume-guard.mjs';"));
    assert.ok(ui.includes('checkStoryResumeSnapshot('));
    assert.ok(ui.includes('key:'+key+',expectedRaw:raw'));
    assert.ok(ui.includes("window.addEventListener('pageshow',"+fn+")"));
    assert.ok(ui.includes("document.addEventListener('visibilitychange'"));
    assert.ok(ui.includes("document.visibilityState==='visible'"));
    assert.ok(ui.includes("if(!check.ok){blocked=true;reason=check.reason;"));
  }
});
