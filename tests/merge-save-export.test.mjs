import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY,MAX_LOCAL_SAVE_BYTES} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {MAX_EXPORT_BYTES,prepareLocalSaveExport} from '../merge/save-export.mjs';

function mockStorage(entries={}){
  const map=new Map(Object.entries(entries));
  const reads=[],writes=[];
  return {
    reads,writes,
    getItem:key=>{reads.push(key);return map.get(key)??null;},
    setItem:(key,value)=>{writes.push(key);map.set(key,value);},
    read:key=>map.get(key)
  };
}
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('P2.16 exports exact persisted V3 bytes including whitespace, never in-memory state',()=>{
  const save=createInitialState(1_000_000);
  const raw=JSON.stringify(save,null,2);
  const storage=mockStorage({[SAVE_KEY]:raw});
  const before=structuredClone(save);
  const result=prepareLocalSaveExport(storage);
  assert.equal(result.ok,true);
  assert.equal(result.verified,true);
  assert.equal(result.filename,'yunyu-normal-save-v3.json');
  assert.equal(result.mime,'application/json;charset=utf-8');
  assert.equal(result.content,raw);
  assert.equal(validateSave(JSON.parse(result.content)),true);
  assert.deepEqual(save,before);
  assert.deepEqual(storage.reads,[SAVE_KEY]);
  assert.deepEqual(storage.writes,[]);
  assert.equal(storage.read(SAVE_KEY),raw);
  assert.ok(Object.isFrozen(result));
});

test('P2.16 preserves malformed bytes verbatim in a non-executable text file',()=>{
  const raw='{"schemaVersion":3,"board":';
  const storage=mockStorage({[SAVE_KEY]:raw});
  const result=prepareLocalSaveExport(storage);
  assert.equal(result.ok,true);
  assert.equal(result.verified,false);
  assert.equal(result.filename,'yunyu-unverified-original.txt');
  assert.equal(result.mime,'text/plain;charset=utf-8');
  assert.equal(result.content,raw);
  assert.equal(storage.read(SAVE_KEY),raw);
  assert.deepEqual(storage.writes,[]);
});

test('P2.16 never mislabels legacy, story, or invalid normal data as a valid V3 backup',()=>{
  for(const raw of [
    '{"schemaVersion":1}',
    JSON.stringify(createEmptyStoryProgress()),
    JSON.stringify({...createInitialState(1_000_000),coins:-1})
  ]){
    const result=prepareLocalSaveExport(mockStorage({[SAVE_KEY]:raw}));
    assert.equal(result.ok,true);
    assert.equal(result.verified,false);
    assert.equal(result.content,raw);
  }
});

test('P2.16 reads only normal save key, never story namespace or backups',()=>{
  const story=JSON.stringify(createEmptyStoryProgress());
  const s=mockStorage({[STORY_SAVE_KEY]:story});
  const result=prepareLocalSaveExport(s);
  assert.deepEqual(result,{ok:false,reason:'NO_SAVED_DATA'});
  assert.deepEqual(s.reads,[SAVE_KEY]);
  assert.deepEqual(s.writes,[]);
});

test('P2.16 exports bounded anomalous raw bytes without parsing or writing',()=>{
  const raw='x'.repeat(MAX_LOCAL_SAVE_BYTES+1);
  const s=mockStorage({[SAVE_KEY]:raw});
  const result=prepareLocalSaveExport(s);
  assert.equal(result.ok,true);
  assert.equal(result.verified,false);
  assert.equal(result.content.length,MAX_LOCAL_SAVE_BYTES+1);
  assert.equal(s.writes.length,0);
  const tooLarge=mockStorage({[SAVE_KEY]:'x'.repeat(MAX_EXPORT_BYTES+1)});
  assert.deepEqual(prepareLocalSaveExport(tooLarge),{ok:false,reason:'EXPORT_TOO_LARGE'});
  assert.deepEqual(tooLarge.writes,[]);
});

test('P2.16 refuses unavailable storage or non-string values without side effects',()=>{
  assert.deepEqual(prepareLocalSaveExport(null),{ok:false,reason:'STORAGE_UNAVAILABLE'});
  assert.deepEqual(prepareLocalSaveExport({getItem(){throw Error('denied')}}),
    {ok:false,reason:'STORAGE_UNAVAILABLE'});
  assert.deepEqual(prepareLocalSaveExport({getItem(){return 123}}),
    {ok:false,reason:'EXPORT_TOO_LARGE'});
});

test('P2.16 preview UI offers export without cloud transfer, import or overwrite',()=>{
  const html=source('../merge/index.html');
  const main=source('../merge/main.mjs');
  const css=source('../merge/style.css');
  assert.equal(html.split('id="export-local-save"').length-1,1);
  assert.ok(html.includes('原始数据作为人工备份'));
  assert.ok(html.includes('此功能不导入存档'));
  assert.ok(main.includes("import { prepareLocalSaveExport } from './save-export.mjs';"));
  assert.ok(main.includes("byId('export-local-save').addEventListener('click'"));
  assert.ok(main.includes('const result=prepareLocalSaveExport(store);'));
  assert.ok(main.includes('new Blob([result.content],{type:result.mime})'));
  assert.ok(main.includes('URL.createObjectURL(blob)'));
  assert.ok(main.includes('URL.revokeObjectURL(downloadUrl)'));
  assert.ok(main.includes('link.download=result.filename;'));
  assert.ok(css.includes('.save-actions .text-button{min-height:44px'));
  const action=main.slice(main.indexOf("byId('export-local-save').addEventListener"),
    main.indexOf("byId('reset').addEventListener"));
  assert.ok(action.startsWith("byId('export-local-save').addEventListener"));
  for(const forbidden of ['saveLocal(', 'persist(', 'setItem(', 'fetch(', 'XMLHttpRequest', 'sendBeacon(', 'innerHTML', 'allowReset:true']){
    assert.equal(action.includes(forbidden),false,`Unexpected export side effect: ${forbidden}`);
  }
});
