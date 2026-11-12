import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {createInitialState as createLegacy} from '../merge/legacy-engine.mjs';
import {inspectNormalJsonKeys} from '../merge/json-key-guard.mjs';
import {SAVE_KEY,LEGACY_BACKUP_KEY,loadLocal,peekLocalV3,saveLocal} from '../merge/storage.mjs';
import {previewNormalSaveImport} from '../merge/save-import-preflight.mjs';
import {prepareLocalSaveExport} from '../merge/save-export.mjs';
function mock(raw=null){
  const map=new Map(raw===null?[]:[[SAVE_KEY,raw]]),writes=[];
  return {writes,getItem:key=>map.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);map.set(key,value);}};
}
const initial=()=>createInitialState(1_000_000);
const normal=()=>JSON.stringify(initial());
const duplicate=raw=>raw.replace('"coins":0,','"coins":500,"coins":0,');
const escaped=raw=>raw.replace('"coins":0,','"coins":500,"co\\u0069ns":0,');
test('bounded scanner recognizes escaped and nested aliases without false sibling duplicates',()=>{
  assert.deepEqual(inspectNormalJsonKeys('{"a":[{"id":1},{"id":2}]}'),{ok:true,hasDuplicateKeys:false});
  for(const raw of ['{"a":1,"a":2}','{"coins":500,"co\\u0069ns":0}',
    '{"a":[{"id":1,"id":2}]}','{"\\ud83d\\ude00":1,"😀":2}'])
    assert.deepEqual(inspectNormalJsonKeys(raw),{ok:true,hasDuplicateKeys:true});
  for(const raw of ['{"a":1,}','[1,]','{"a":','[[[0]]]'])
    assert.equal(inspectNormalJsonKeys(raw,{maxDepth:2}).ok,false);
  assert.equal(inspectNormalJsonKeys('{"a":1,"b":2}',{maxKeys:1}).ok,false);
});
test('duplicate V3 original is quarantined without writes or cross-tab adoption',()=>{
  for(const raw of [duplicate(normal()),escaped(normal())]){
    assert.notEqual(raw,normal());
    assert.equal(inspectNormalJsonKeys(raw).hasDuplicateKeys,true);
    const s=mock(raw),loaded=loadLocal(s,1_000_000);
    assert.equal(loaded.reason,'CORRUPT_SAVE');
    assert.equal(loaded.raw,raw);
    assert.deepEqual(peekLocalV3(s),{ok:false,reason:'CORRUPT_SAVE'});
    assert.equal(saveLocal(s,initial(),{expectedRaw:raw}),false);
    assert.equal(s.getItem(SAVE_KEY),raw);
    assert.deepEqual(s.writes,[]);
  }
});
test('nested duplicate item key is quarantined',()=>{
  const clean=normal(),raw=clean.replace('"id":"m1"','"id":"m999","id":"m1"');
  assert.notEqual(raw,clean);
  const s=mock(raw);
  assert.equal(loadLocal(s).reason,'CORRUPT_SAVE');
  assert.deepEqual(s.writes,[]);
});
test('duplicate legacy save never migrates or writes a backup',()=>{
  const raw=duplicate(JSON.stringify(createLegacy(1_000_000))),s=mock(raw);
  assert.equal(inspectNormalJsonKeys(raw).hasDuplicateKeys,true);
  assert.equal(loadLocal(s).reason,'CORRUPT_SAVE');
  assert.equal(s.getItem(LEGACY_BACKUP_KEY),null);
  assert.deepEqual(s.writes,[]);
});
test('preflight rejects ambiguous file and ambiguous current save',()=>{
  const clean=normal(),bad=duplicate(clean),s=mock(clean);
  assert.deepEqual(previewNormalSaveImport(bad,s,{expectedRaw:clean}),
    {ok:false,reason:'DUPLICATE_JSON_KEYS'});
  const corrupt=mock(bad);
  assert.deepEqual(previewNormalSaveImport(clean,corrupt,{expectedRaw:bad}),
    {ok:false,reason:'CURRENT_SAVE_INVALID'});
  assert.deepEqual(s.writes,[]);
  assert.deepEqual(corrupt.writes,[]);
});
test('export retains original ambiguous bytes but does not claim verification',()=>{
  const raw=duplicate(normal()),s=mock(raw),result=prepareLocalSaveExport(s);
  assert.equal(result.ok,true);
  assert.equal(result.verified,false);
  assert.equal(result.content,raw);
  assert.equal(result.filename,'yunyu-unverified-original.txt');
  assert.deepEqual(s.writes,[]);
});
test('ordinary valid save still loads, previews, exports and persists',()=>{
  const raw=normal(),s=mock(raw);
  assert.equal(loadLocal(s).recovered,true);
  assert.equal(peekLocalV3(s).ok,true);
  assert.equal(previewNormalSaveImport(raw,mock(),{expectedRaw:null}).ok,true);
  assert.equal(prepareLocalSaveExport(s).verified,true);
  assert.equal(saveLocal(s,initial(),{expectedRaw:raw}),true);
});
