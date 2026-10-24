import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAbnormalResetBackup} from '../merge/reset-backup.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {createInitialState} from '../merge/engine.mjs';

function isolatedStorage(normalRaw){
  const dialogue=JSON.stringify(createEmptyStoryProgress());
  const workshop=JSON.stringify(createInitialState(1000000));
  const map=new Map([[SAVE_KEY,normalRaw],[STORY_SAVE_KEY,dialogue],[STORY_WORKSHOP_KEY,workshop]]);
  const reads=[],writes=[];
  return {
    map,reads,writes,dialogue,workshop,
    getItem(key){reads.push(key);return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push([key,value]);map.set(key,value);}
  };
}

function assertStoryUntouched(store){
  assert.equal(store.map.get(STORY_SAVE_KEY),store.dialogue);
  assert.equal(store.map.get(STORY_WORKSHOP_KEY),store.workshop);
  assert.equal(store.reads.includes(STORY_SAVE_KEY),false);
  assert.equal(store.reads.includes(STORY_WORKSHOP_KEY),false);
  assert.equal(store.writes.some(([key])=>key===STORY_SAVE_KEY||key===STORY_WORKSHOP_KEY),false);
}

test('P21 P2.37 refuses non-exportable normal backup without touching either story save',()=>{
  const raw='中'.repeat(Math.ceil(2_000_000/3));
  const store=isolatedStorage(raw);
  assert.deepEqual(prepareAbnormalResetBackup(store,{expectedRaw:raw}),
    {ok:false,reason:'BACKUP_TOO_LARGE'});
  assert.deepEqual(store.writes,[]);
  assert.equal(store.map.get(SAVE_KEY),raw);
  assert.equal(store.map.has(ABNORMAL_RESET_BACKUP_KEY),false);
  assertStoryUntouched(store);
});

test('P21 P2.37 permits exact exportable abnormal backup and keeps story data isolated',()=>{
  const raw='异常'+String.fromCharCode(0xD800)+'原文';
  const store=isolatedStorage(raw);
  const outcome=prepareAbnormalResetBackup(store,{expectedRaw:raw});
  assert.deepEqual(outcome,{ok:true,status:'ORIGINAL_BACKUP_VERIFIED',
    backupCreated:true,verifiedReadback:true});
  assert.deepEqual(store.writes,[[ABNORMAL_RESET_BACKUP_KEY,raw]]);
  assert.equal(store.map.get(SAVE_KEY),raw);
  assert.equal(store.map.get(ABNORMAL_RESET_BACKUP_KEY),raw);
  assertStoryUntouched(store);
});
