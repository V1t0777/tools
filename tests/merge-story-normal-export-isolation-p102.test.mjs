import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {prepareLocalSaveExport,prepareAbnormalResetBackupExport} from '../merge/save-export.mjs';
import {isPreparedExportUnchanged} from '../merge/save-export-snapshot.mjs';
import {requestBrowserSaveDownload} from '../merge/save-download.mjs';

const NOW=1_000_000;
function fixture(){
  const normal=JSON.stringify(createInitialState(NOW));
  const story=JSON.stringify(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK));
  const workshop=JSON.stringify(createInitialState(NOW));
  const map=new Map([[SAVE_KEY,normal],[STORY_SAVE_KEY,story],[STORY_WORKSHOP_KEY,workshop]]);
  const writes=[],reads=[];
  const storage={
    getItem(key){reads.push(key);return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push(key);map.set(key,String(value));}
  };
  return {normal,story,workshop,map,writes,reads,storage};
}
function browser({onBlob=()=>{}}={}){
  let clicks=0;
  const revoked=[];
  const doc={
    body:{append(){}},
    createElement(){return {click(){clicks++;},remove(){}};}
  };
  const urlApi={
    createObjectURL:()=> 'blob:p102-story-normal-export',
    revokeObjectURL:url=>revoked.push(url)
  };
  class BlobCtor{
    constructor(parts){
      onBlob();
      this.size=Buffer.byteLength(String(parts[0]),'utf8');
    }
  }
  return {
    options:{doc,urlApi,BlobCtor,schedule:()=>1,now:()=>1_000},
    clicks:()=>clicks,revoked
  };
}

test('P102 normal export permits an independent story advance during Blob preparation',()=>{
  const f=fixture();
  const prepared=prepareLocalSaveExport(f.storage);
  assert.equal(prepared.ok,true);
  assert.equal(prepared.verified,true);
  const b=browser({onBlob:()=>{
    const before=readStorySave(f.storage);
    const next=completeStoryEntry(before.progress,CORE_STORY_PACK,'arrival','help');
    assert.equal(writeStorySave(f.storage,next,{expectedRaw:before.raw}),true);
  }});
  const result=requestBrowserSaveDownload(prepared,{
    ...b.options,
    authorizeClick:()=>isPreparedExportUnchanged(prepared,()=>f.storage.getItem(SAVE_KEY))
  });
  assert.equal(result.ok,true);
  assert.equal(b.clicks(),1);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.equal(readStorySave(f.storage).progress.packs.core.choices.arrival,'help');
  assert.deepEqual(f.writes,[STORY_SAVE_KEY]);
});

test('P102 normal save replaced during Blob construction blocks stale click without touching story',()=>{
  const f=fixture(),prepared=prepareLocalSaveExport(f.storage);
  const newer=JSON.stringify({...createInitialState(NOW),revision:2,coins:195});
  const b=browser({onBlob:()=>f.map.set(SAVE_KEY,newer)});
  const result=requestBrowserSaveDownload(prepared,{
    ...b.options,
    authorizeClick:()=>isPreparedExportUnchanged(prepared,()=>f.storage.getItem(SAVE_KEY))
  });
  assert.deepEqual(result,{ok:false,reason:'DOWNLOAD_SOURCE_CHANGED'});
  assert.equal(b.clicks(),0);
  assert.equal(b.revoked.length,1);
  assert.equal(f.storage.getItem(SAVE_KEY),newer);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.story);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.deepEqual(f.writes,[]);
});

test('P102 normal UTF-16 evidence export never reads or rewrites damaged story namespaces',()=>{
  const f=fixture();
  const damagedNormal='{"normal":'+String.fromCharCode(0xd800);
  const damagedStory='{"story":'+String.fromCharCode(0xdc00);
  f.map.set(SAVE_KEY,damagedNormal);
  f.map.set(STORY_SAVE_KEY,damagedStory);
  const prepared=prepareLocalSaveExport(f.storage);
  assert.equal(prepared.ok,true);
  assert.equal(prepared.wrapped,true);
  assert.equal(JSON.parse(prepared.content).raw,damagedNormal);
  assert.equal(isPreparedExportUnchanged(prepared,()=>f.storage.getItem(SAVE_KEY)),true);
  assert.deepEqual(f.reads,[SAVE_KEY,SAVE_KEY]);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),damagedStory);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.deepEqual(f.writes,[]);
});

test('P102 abnormal normal backup export remains separate from live story and workshop',()=>{
  const f=fixture();
  const backup='old-normal-'+String.fromCharCode(0xd800);
  f.map.set(ABNORMAL_RESET_BACKUP_KEY,backup);
  const prepared=prepareAbnormalResetBackupExport(f.storage);
  assert.equal(prepared.ok,true);
  assert.equal(prepared.verified,false);
  assert.equal(prepared.backup,true);
  assert.equal(JSON.parse(prepared.content).raw,backup);
  assert.deepEqual(f.reads,[ABNORMAL_RESET_BACKUP_KEY]);
  assert.equal(f.storage.getItem(SAVE_KEY),f.normal);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.story);
  assert.equal(f.storage.getItem(STORY_WORKSHOP_KEY),f.workshop);
  assert.deepEqual(f.writes,[]);
});
