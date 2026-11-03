import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {MAX_LOCAL_SAVE_BYTES,SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {previewNormalSaveImport} from '../merge/save-import-preflight.mjs';

const initial=()=>createInitialState(1_000_000);
function storage(raw=null,storyRaw=null){
  const saved=new Map();
  if(raw!==null)saved.set(SAVE_KEY,raw);
  if(storyRaw!==null)saved.set(STORY_SAVE_KEY,storyRaw);
  const reads=[],writes=[];
  return {
    reads,writes,
    getItem(key){reads.push(key);return saved.has(key)?saved.get(key):null;},
    setItem(key,value){writes.push([key,value]);saved.set(key,value);},
    original:key=>saved.get(key)??null
  };
}

test('valid V3 backup receives frozen preview, does not write or copy private bytes to report',()=>{
  const state=initial(),raw=JSON.stringify(state,null,2),s=storage();
  const before=structuredClone(state);
  const result=previewNormalSaveImport(raw,s,{expectedRaw:null});
  assert.equal(validateSave(state),true);
  assert.deepEqual(state,before);
  assert.equal(result.ok,true);
  assert.equal(result.status,'PREVIEW_ONLY');
  assert.equal(result.schemaVersion,3);
  assert.equal(result.sourceRevision,state.revision);
  assert.equal(result.currentRevision,null);
  assert.equal(result.wouldReplaceCurrentSave,false);
  assert.equal(result.wouldDecreaseRevision,false);
  assert.equal(result.confirmationRequired,true);
  assert.equal(result.writesPerformed,false);
  assert.ok(Object.isFrozen(result));
  assert.equal('content' in result,false);
  assert.equal('coins' in result,false);
  assert.deepEqual(s.reads,[SAVE_KEY]);
  assert.deepEqual(s.writes,[]);
});

test('existing valid save requires exact observed baseline and flags downgrade without modifying it',()=>{
  const old=initial(),current={...initial(),revision:12};
  const oldRaw=JSON.stringify(old),currentRaw=JSON.stringify(current),s=storage(currentRaw);
  const preview=previewNormalSaveImport(oldRaw,s,{expectedRaw:currentRaw});
  assert.equal(preview.ok,true);
  assert.equal(preview.currentRevision,12);
  assert.equal(preview.wouldReplaceCurrentSave,true);
  assert.equal(preview.wouldDecreaseRevision,true);
  assert.equal(s.original(SAVE_KEY),currentRaw);
  assert.deepEqual(s.writes,[]);
  assert.deepEqual(previewNormalSaveImport(currentRaw,s,{expectedRaw:currentRaw}),
    {ok:false,reason:'ALREADY_PRESENT'});
});

test('preflight rejects changed baseline, including same-revision changes from another tab',()=>{
  const one=initial(),raw1=JSON.stringify(one);
  const raw2=JSON.stringify({...one,energyAt:one.energyAt+1});
  const s=storage(raw2);
  assert.equal(validateSave(JSON.parse(raw2)),true);
  assert.deepEqual(previewNormalSaveImport(raw1,s,{expectedRaw:raw1}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.deepEqual(previewNormalSaveImport(raw1,s,{expectedRaw:null}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.deepEqual(s.writes,[]);
  assert.equal(s.original(SAVE_KEY),raw2);
});

test('missing baseline and storage failures fail closed with zero writes',()=>{
  const raw=JSON.stringify(initial()),s=storage();
  for(const opts of [{},{expectedRaw:undefined},{expectedRaw:42}])
    assert.deepEqual(previewNormalSaveImport(raw,s,opts),
      {ok:false,reason:'NO_TRUSTED_BASELINE'});
  assert.deepEqual(previewNormalSaveImport(raw,null,{expectedRaw:null}),
    {ok:false,reason:'STORAGE_UNAVAILABLE'});
  assert.deepEqual(previewNormalSaveImport(raw,{getItem(){throw Error('denied')}},{expectedRaw:null}),
    {ok:false,reason:'STORAGE_UNAVAILABLE'});
  assert.deepEqual(s.reads,[]);
  assert.deepEqual(s.writes,[]);
});

test('rejects nontext, oversized, malformed, older and story-mode saves',()=>{
  const s=storage();
  const inputs=[
    [null,'EMPTY_OR_NON_TEXT_FILE'],
    ['', 'EMPTY_OR_NON_TEXT_FILE'],
    [42,'EMPTY_OR_NON_TEXT_FILE'],
    ['x'.repeat(MAX_LOCAL_SAVE_BYTES+1),'FILE_TOO_LARGE'],
    ['{"board":','INVALID_JSON'],
    ['{"schemaVersion":1}','UNSUPPORTED_SAVE_VERSION'],
    [JSON.stringify(createEmptyStoryProgress()),'STORY_MODE_FILE'],
    [JSON.stringify({...initial(),coins:-1}),'INVALID_NORMAL_SAVE']
  ];
  for(const [raw,reason] of inputs)
    assert.deepEqual(previewNormalSaveImport(raw,s,{expectedRaw:null}),
      {ok:false,reason},reason);
  assert.deepEqual(s.reads,[]);
  assert.deepEqual(s.writes,[]);
});

test('existing damaged, legacy or oversized data is not silently replaced',()=>{
  const candidate=JSON.stringify(initial());
  for(const persisted of ['{bad','{"schemaVersion":1}', 'x'.repeat(MAX_LOCAL_SAVE_BYTES+1)]){
    const s=storage(persisted);
    assert.deepEqual(previewNormalSaveImport(candidate,s,{expectedRaw:persisted}),
      {ok:false,reason:'CURRENT_SAVE_INVALID'});
    assert.equal(s.original(SAVE_KEY),persisted);
    assert.deepEqual(s.writes,[]);
  }
});

test('story save key is not accessed or changed by normal-mode preflight',()=>{
  const story=JSON.stringify(createEmptyStoryProgress()),s=storage(null,story);
  assert.equal(previewNormalSaveImport(JSON.stringify(initial()),s,{expectedRaw:null}).ok,true);
  assert.deepEqual(s.reads,[SAVE_KEY]);
  assert.equal(s.original(STORY_SAVE_KEY),story);
  assert.deepEqual(s.writes,[]);
});

test('preflight is deliberately not connected to game UI or any import writer',()=>{
  const source=readFileSync(new URL('../merge/save-import-preflight.mjs',import.meta.url),'utf8');
  const html=readFileSync(new URL('../merge/index.html',import.meta.url),'utf8');
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  for(const fragment of ['setItem(', 'removeItem(', 'fetch(', 'XMLHttpRequest','sendBeacon(','innerHTML',
    'localStorage.', 'document.', 'window.'])
    assert.equal(source.includes(fragment),false,'unexpected preflight side effect: '+fragment);
  assert.equal(main.includes("from './save-import-preflight.mjs'"),false);
  assert.equal(html.includes('id="import-local-save"'),false);
});
