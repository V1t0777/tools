import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {performNormalSaveImport} from '../merge/normal-save-import-flow.mjs';

// A downgrade requires two approvals. The second dialog cannot authorize a
// save or page that changed while the user was considering that warning.
function setup() {
  const current=JSON.stringify({...createInitialState(1),revision:5,coins:90});
  const incoming=JSON.stringify({...createInitialState(1),revision:1,coins:37});
  const map=new Map([[SAVE_KEY,current],[STORY_SAVE_KEY,'story-sentinel']]);
  const storage={getItem:key=>map.get(key)??null,
    setItem:(key,value)=>map.set(key,String(value))};
  const restores=[];
  const runtime={phase:'ready',blocked:false,busy:false,raw:current,
    async restore(text,options){restores.push({text,options});return {ok:true};}};
  let epoch=0;
  const file={size:new TextEncoder().encode(incoming).length,text:async()=>incoming};
  const config={file,storage,runtime,confirm:()=>true,
    isSuspended:()=>false,getEpoch:()=>epoch,
    revalidate:()=>map.get(SAVE_KEY)===runtime.raw};
  return {config,map,current,restores,bumpEpoch:()=>{epoch++;}};
}
function assertPreserved(f,expected=f.current){
  assert.equal(f.restores.length,0,'no restore may reach the locked writer');
  assert.equal(f.map.get(SAVE_KEY),expected,'normal save raw bytes preserved');
  assert.equal(f.map.get(STORY_SAVE_KEY),'story-sentinel','story namespace isolated');
}

test('P0 import downgrade: cross-tab replacement during second consent cannot overwrite new save',async()=>{
  const f=setup();
  const newer=JSON.stringify({...createInitialState(1),revision:6,coins:120});
  let dialogs=0;
  f.config.confirm=()=>{if(++dialogs===2)f.map.set(SAVE_KEY,newer);return true;};
  const result=await performNormalSaveImport(f.config);
  assert.equal(dialogs,2,'downgrade must show a separate second consent');
  assert.equal(result.reason,'SAVE_CHANGED');
  assertPreserved(f,newer);
});

test('P0 import downgrade: BFCache/pagehide epoch change during second consent revokes restore',async()=>{
  const f=setup();let dialogs=0;
  f.config.confirm=()=>{if(++dialogs===2)f.bumpEpoch();return true;};
  const result=await performNormalSaveImport(f.config);
  assert.equal(dialogs,2);
  assert.equal(result.reason,'PAGE_SUSPENDED');
  assertPreserved(f);
});

test('P0 import downgrade: abort during second consent revokes pending restore',async()=>{
  const f=setup(),controller=new AbortController();let dialogs=0;
  f.config.signal=controller.signal;
  f.config.confirm=()=>{if(++dialogs===2)controller.abort();return true;};
  const result=await performNormalSaveImport(f.config);
  assert.equal(dialogs,2);
  assert.equal(result.reason,'PAGE_SUSPENDED');
  assertPreserved(f);
});

test('P0 import: rejected native File.text cannot open either confirmation or restore',async()=>{
  const f=setup();let dialogs=0;
  f.config.file.text=()=>Promise.reject(new Error('native reader failed'));
  f.config.confirm=()=>{dialogs++;return true;};
  const result=await performNormalSaveImport(f.config);
  assert.equal(result.reason,'FILE_READ_FAILED');
  assert.equal(dialogs,0);
  assertPreserved(f);
});
