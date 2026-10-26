import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkStoryResumeSnapshot} from '../merge/story/resume-guard.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');

test('P64 stale interaction preflight is wired before selection and transaction outcome',()=>{
  const guard=ui.slice(ui.indexOf('function revalidateWorkshopBeforeInteraction(){'),ui.indexOf('async function commit(result){'));
  const commit=ui.slice(ui.indexOf('async function commit(result){'),ui.indexOf('function touch(index){'));
  const touch=ui.slice(ui.indexOf('function touch(index){'),ui.indexOf("$('store-selected').addEventListener"));
  assert.ok(guard.includes('checkStoryResumeSnapshot(storage,{key:STORY_WORKSHOP_KEY,expectedRaw:raw})'));
  assert.ok(guard.includes('storageEpoch++;blocked=true;reason=check.reason;selected=-1;'));
  assert.ok(guard.includes('if(check.ok)return true;'));
  assert.ok(commit.indexOf('if(!revalidateWorkshopBeforeInteraction())return;')>=0);
  assert.ok(commit.indexOf('if(!revalidateWorkshopBeforeInteraction())return;')<commit.indexOf('if(!result.ok)'));
  assert.ok(touch.indexOf('if(!revalidateWorkshopBeforeInteraction())return;')<touch.indexOf('const item=state.board[index];'));
  assert.ok(ui.includes('writeStoryWorkshop(storage,result.state,{expectedRaw})'));
  assert.ok(ui.includes('runStoryWriteWithLock(webLocks,STORY_WORKSHOP_KEY'));
});

test('P64 same revision but different workshop bytes are rejected before late storage event',()=>{
  const expected='{"revision":7,"coins":10}';
  let actual=expected;let reads=0;
  const store={getItem(key){assert.equal(key,STORY_WORKSHOP_KEY);reads++;return actual;}};
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_WORKSHOP_KEY,expectedRaw:expected}).ok,true);
  actual='{"revision":7,"coins":11}';
  assert.deepEqual(checkStoryResumeSnapshot(store,{key:STORY_WORKSHOP_KEY,expectedRaw:expected}),{ok:false,reason:'WRITE_CONFLICT'});
  assert.equal(reads,2);
});

test('P64 deleted, newly inserted and inaccessible workshop saves fail closed',()=>{
  const key=STORY_WORKSHOP_KEY;
  assert.equal(checkStoryResumeSnapshot({getItem(){return null;}},{key,expectedRaw:'old'}).reason,'WRITE_CONFLICT');
  assert.equal(checkStoryResumeSnapshot({getItem(){return 'new';}},{key,expectedRaw:null}).reason,'WRITE_CONFLICT');
  assert.equal(checkStoryResumeSnapshot({getItem(){throw Error('denied');}},{key,expectedRaw:'old'}).reason,'STORAGE_UNAVAILABLE');
  assert.equal(checkStoryResumeSnapshot(null,{key,expectedRaw:null}).reason,'STORAGE_UNAVAILABLE');
});

test('P64 preflight never inspects normal-mode save or mutates storage',()=>{
  let writes=0;const reads=[];
  const store={getItem(key){reads.push(key);return null;},setItem(){writes++;},removeItem(){writes++;}};
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_WORKSHOP_KEY,expectedRaw:null}).ok,true);
  assert.deepEqual(reads,[STORY_WORKSHOP_KEY]);
  assert.notEqual(STORY_WORKSHOP_KEY,SAVE_KEY);
  assert.equal(writes,0);
});
