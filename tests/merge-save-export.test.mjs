import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY,MAX_LOCAL_SAVE_BYTES} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {MAX_EXPORT_BYTES,prepareLocalSaveExport,prepareAbnormalResetBackupExport} from '../merge/save-export.mjs';

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

test('P2.33 export limit uses actual UTF-8 bytes for CJK and emoji',()=>{
  const exactly='中'.repeat(Math.floor(MAX_EXPORT_BYTES/3))+'ab';
  assert.equal(new TextEncoder().encode(exactly).byteLength,MAX_EXPORT_BYTES);
  const exact=mockStorage({[SAVE_KEY]:exactly});
  const receipt=prepareLocalSaveExport(exact);
  assert.equal(receipt.ok,true);
  assert.equal(receipt.verified,false);
  assert.equal(receipt.content,exactly);
  assert.deepEqual(exact.writes,[]);
  const tooLarge=mockStorage({[SAVE_KEY]:exactly+'中'});
  assert.ok((exactly+'中').length<MAX_EXPORT_BYTES);
  assert.deepEqual(prepareLocalSaveExport(tooLarge),
    {ok:false,reason:'EXPORT_TOO_LARGE'});
  assert.deepEqual(tooLarge.writes,[]);
  const emoji='🌊'.repeat(Math.floor(MAX_EXPORT_BYTES/4)+1);
  assert.ok(emoji.length<MAX_EXPORT_BYTES);
  assert.deepEqual(prepareLocalSaveExport(mockStorage({[SAVE_KEY]:emoji})),
    {ok:false,reason:'EXPORT_TOO_LARGE'});
});

test('P2.33 rejects missing UTF-8 encoder without claiming a safe download',()=>{
  const encoder=globalThis.TextEncoder;
  const raw='中文存档';
  try {
    globalThis.TextEncoder=undefined;
    assert.deepEqual(prepareLocalSaveExport(mockStorage({[SAVE_KEY]:raw})),
      {ok:false,reason:'EXPORT_ENCODING_UNAVAILABLE'});
  } finally {globalThis.TextEncoder=encoder;}
});

test('P2.33 preview displays explicit encoding-unavailable guidance',()=>{
  const main=source('../merge/main.mjs');
  const action=main.slice(main.indexOf("byId('export-local-save').addEventListener"),
    main.indexOf("byId('reset').addEventListener"));
  assert.ok(action.includes("result.reason==='EXPORT_ENCODING_UNAVAILABLE'"));
  assert.ok(action.includes('当前浏览器无法安全编码备份文件'));
});

test('P2.34 losslessly exports isolated UTF-16 surrogates in a marked JSON envelope',()=>{
  const raw='{"damaged":"\uD800"}';
  assert.equal(/[\uD800-\uDFFF]/u.test(raw),true);
  const s=mockStorage({[SAVE_KEY]:raw});
  const result=prepareLocalSaveExport(s);
  assert.equal(result.ok,true);
  assert.equal(result.verified,false);
  assert.equal(result.wrapped,true);
  assert.equal(result.filename,'yunyu-unverified-utf16-escaped.json');
  assert.equal(result.mime,'application/json;charset=utf-8');
  assert.deepEqual(JSON.parse(result.content),{format:'yunyu-normal-raw-utf16-v1',raw});
  assert.ok(result.content.includes(String.fromCharCode(92)+'ud800'), 'envelope must escape the isolated code unit');
  assert.deepEqual(s.reads,[SAVE_KEY]);
  assert.deepEqual(s.writes,[]);
  assert.equal(s.read(SAVE_KEY),raw);
});

test('P2.34 valid emoji pairs keep the ordinary raw text backup format',()=>{
  const raw='🌊中文原始数据';
  const result=prepareLocalSaveExport(mockStorage({[SAVE_KEY]:raw}));
  assert.equal(result.ok,true);
  assert.equal(result.verified,false);
  assert.equal(result.wrapped,undefined);
  assert.equal(result.content,raw);
  assert.equal(result.filename,'yunyu-unverified-original.txt');
});

test('P2.34 UTF-16 envelope must itself fit the UTF-8 byte budget',()=>{
  const raw='\uD800'.repeat(Math.ceil(MAX_EXPORT_BYTES/6));
  assert.ok(raw.length<MAX_EXPORT_BYTES);
  assert.ok(new TextEncoder().encode(raw).byteLength<MAX_EXPORT_BYTES);
  const s=mockStorage({[SAVE_KEY]:raw});
  assert.deepEqual(prepareLocalSaveExport(s),{ok:false,reason:'EXPORT_TOO_LARGE'});
  assert.deepEqual(s.writes,[]);
});

test('P2.34 UI distinguishes encoded recovery envelope from ordinary raw download',()=>{
  const main=source('../merge/main.mjs');
  const action=main.slice(main.indexOf("byId('export-local-save').addEventListener"),
    main.indexOf("byId('reset').addEventListener"));
  assert.ok(action.includes("result.wrapped?'检测到异常字符"));
  assert.ok(action.includes('不可直接导入'));
});

test('P2.36 exports historical abnormal-reset bytes, not the newer active save',()=>{
  const original='{damaged\\\\uD800';
  const active=JSON.stringify(createInitialState(1_000_000));
  const story=JSON.stringify(createEmptyStoryProgress());
  const s=mockStorage({
    [SAVE_KEY]:active,[ABNORMAL_RESET_BACKUP_KEY]:original,[STORY_SAVE_KEY]:story
  });
  const result=prepareAbnormalResetBackupExport(s);
  assert.equal(result.ok,true);
  assert.equal(result.verified,false);
  assert.equal(result.backup,true);
  assert.equal(result.filename,'yunyu-abnormal-reset-original.txt');
  assert.equal(result.content,original);
  assert.deepEqual(s.reads,[ABNORMAL_RESET_BACKUP_KEY]);
  assert.deepEqual(s.writes,[]);
  assert.equal(s.read(SAVE_KEY),active);
  assert.equal(s.read(STORY_SAVE_KEY),story);
});

test('P2.36 absent backup fails without falling back to current normal save',()=>{
  const active=JSON.stringify(createInitialState(1_000_000));
  const s=mockStorage({[SAVE_KEY]:active});
  assert.deepEqual(prepareAbnormalResetBackupExport(s),
    {ok:false,reason:'NO_SAVED_DATA'});
  assert.deepEqual(s.reads,[ABNORMAL_RESET_BACKUP_KEY]);
  assert.deepEqual(s.writes,[]);
});

test('P2.36 abnormal backup supports lossless UTF-16 wrapper and size rejection',()=>{
  const damaged=String.fromCharCode(0xD800);
  const s=mockStorage({[ABNORMAL_RESET_BACKUP_KEY]:damaged});
  const result=prepareAbnormalResetBackupExport(s);
  assert.equal(result.ok,true);
  assert.equal(result.wrapped,true);
  assert.equal(result.verified,false);
  assert.equal(result.filename,'yunyu-abnormal-reset-utf16-escaped.json');
  assert.equal(JSON.parse(result.content).raw,damaged);
  assert.deepEqual(s.writes,[]);
  const huge=mockStorage({[ABNORMAL_RESET_BACKUP_KEY]:'中'.repeat(MAX_EXPORT_BYTES)});
  assert.deepEqual(prepareAbnormalResetBackupExport(huge),
    {ok:false,reason:'EXPORT_TOO_LARGE'});
  assert.deepEqual(huge.writes,[]);
});

test('P2.36 dedicated backup download remains read-only and touch accessible',()=>{
  const html=source('../merge/index.html');
  const main=source('../merge/main.mjs');
  const css=source('../merge/style.css');
  assert.equal(html.split('id="export-abnormal-reset-backup"').length-1,1);
  assert.ok(html.includes('下载不等于恢复'));
  assert.ok(css.includes('.save-actions .text-button{min-height:44px'));
  assert.ok(main.includes('prepareAbnormalResetBackupExport(store)'));
  const start=main.indexOf("byId('export-abnormal-reset-backup').addEventListener");
  const end=main.indexOf("byId('reset').addEventListener",start);
  assert.ok(start>0&&end>start);
  const action=main.slice(start,end);
  for(const forbidden of ['persist(', 'setItem(', 'fetch(', 'XMLHttpRequest', 'sendBeacon(', 'allowReset:true']) {
    assert.equal(action.includes(forbidden),false,forbidden);
  }
  assert.ok(action.includes('new Blob([result.content],{type:result.mime})'));
  assert.ok(action.includes('URL.revokeObjectURL(downloadUrl)'));
});
