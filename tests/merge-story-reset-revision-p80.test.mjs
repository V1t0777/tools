import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';

function fixture(raw){
  const data=new Map([[STORY_SAVE_KEY,raw],[STORY_WORKSHOP_KEY,'workshop-unchanged'],
    [SAVE_KEY,'normal-unchanged']]);
  const writes=[];
  return {data,writes,storage:{
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,value);}
  }};
}
const progress=revision=>({...createEmptyStoryProgress(),revision});

test('P80 confirmed dialogue reset rejects lower and equal revisions of a valid save',()=>{
  const before=JSON.stringify(progress(8)),f=fixture(before);
  for(const revision of [0,7,8]){
    assert.equal(writeStorySave(f.storage,progress(revision),
      {expectedRaw:before,confirmedReset:true}),false);
    assert.equal(f.data.get(STORY_SAVE_KEY),before);
  }
  assert.deepEqual(f.writes,[]);
  assert.equal(f.data.get(SAVE_KEY),'normal-unchanged');
  assert.equal(f.data.get(STORY_WORKSHOP_KEY),'workshop-unchanged');
});

test('P80 strictly increasing confirmed reset is permitted and preserves both other modes',()=>{
  const before=JSON.stringify(progress(8)),f=fixture(before);
  assert.equal(writeStorySave(f.storage,progress(9),
    {expectedRaw:before,confirmedReset:true}),true);
  assert.equal(readStorySave(f.storage).progress.revision,9);
  assert.deepEqual(f.writes,[STORY_SAVE_KEY]);
  assert.equal(f.data.get(SAVE_KEY),'normal-unchanged');
  assert.equal(f.data.get(STORY_WORKSHOP_KEY),'workshop-unchanged');
});

test('P80 explicit reset can still replace damaged dialogue bytes without repairing other saves',()=>{
  const f=fixture('{damaged-dialogue');
  assert.equal(readStorySave(f.storage).reason,'CORRUPT_SAVE');
  assert.equal(writeStorySave(f.storage,progress(0),
    {expectedRaw:'{damaged-dialogue',confirmedReset:true}),true);
  assert.equal(readStorySave(f.storage).blocked,false);
  assert.deepEqual(f.writes,[STORY_SAVE_KEY]);
  assert.equal(f.data.get(SAVE_KEY),'normal-unchanged');
  assert.equal(f.data.get(STORY_WORKSHOP_KEY),'workshop-unchanged');
});

test('P80 a stale confirmed reset cannot overwrite a peer save even at higher revision',async()=>{
  const old=JSON.stringify(progress(8)),peer=JSON.stringify(progress(9));
  const f=fixture(peer);
  assert.equal(writeStorySave(f.storage,progress(10),
    {expectedRaw:old,confirmedReset:true}),false);
  const result=await saveStoryDialogueWithLock(null,f.storage,progress(10),
    {expectedRaw:old,confirmedReset:true});
  assert.deepEqual(result,{ok:true,mode:'cas-fallback',value:false});
  assert.equal(f.data.get(STORY_SAVE_KEY),peer);
  assert.deepEqual(f.writes,[]);
});
