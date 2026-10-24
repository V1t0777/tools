import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {ABNORMAL_RESET_BACKUP_KEY,prepareAbnormalResetBackup as reserve} from '../merge/reset-backup.mjs';

function storage(original='{broken',backup=null,story=null) {
  const map=new Map(),writes=[],reads=[];
  if(original!==null)map.set(SAVE_KEY,original);
  if(backup!==null)map.set(ABNORMAL_RESET_BACKUP_KEY,backup);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,reads,
    getItem(key){reads.push(key);return map.get(key)??null;},
    setItem(key,value){writes.push([key,value]);map.set(key,value);},
    read(key){return map.get(key)??null;}
  };
}
test('P2.35 preserves exact malformed bytes before abnormal reset',()=>{
  const original='{invalid\\uD800',story=JSON.stringify(createEmptyStoryProgress());
  const db=storage(original,null,story);
  const result=reserve(db,{expectedRaw:original});
  assert.deepEqual(result,{ok:true,status:'ORIGINAL_BACKUP_VERIFIED',
    backupCreated:true,verifiedReadback:true});
  assert.equal(Object.isFrozen(result),true);
  assert.deepEqual(db.writes,[[ABNORMAL_RESET_BACKUP_KEY,original]]);
  assert.equal(db.read(SAVE_KEY),original);
  assert.equal(db.read(ABNORMAL_RESET_BACKUP_KEY),original);
  assert.equal(db.read(STORY_SAVE_KEY),story);
  assert.equal(db.reads.includes(STORY_SAVE_KEY),false);
});
test('P2.35 matching existing backup is reused without any write',()=>{
  const original='{damaged',db=storage(original,original);
  assert.deepEqual(reserve(db,{expectedRaw:original}),
    {ok:true,status:'ORIGINAL_BACKUP_VERIFIED',backupCreated:false,verifiedReadback:true});
  assert.deepEqual(db.writes,[]);
});
test('P2.35 stale tab, absent original, conflicting slot and oversized raw fail closed',()=>{
  const original='{damaged';
  for(const [db,expected,reason] of [
    [storage(original),'{older','CURRENT_SAVE_CHANGED'],
    [storage(original),null,'NO_ORIGINAL_TO_BACKUP'],
    [storage(original,'older-backup'),original,'BACKUP_SLOT_CONFLICT'],
    [storage('x'.repeat(2_000_001)),'x'.repeat(2_000_001),'BACKUP_TOO_LARGE']
  ]) {
    assert.deepEqual(reserve(db,{expectedRaw:expected}),{ok:false,reason});
    assert.deepEqual(db.writes,[]);
  }
});
test('P2.35 rejected, silent and interrupted writes never authorize reset',()=>{
  const raw='{broken';
  const denied=storage(raw);
  assert.deepEqual(reserve({
    getItem:key=>denied.getItem(key),
    setItem(){throw Error('quota');}
  },{expectedRaw:raw}),{ok:false,reason:'BACKUP_OUTCOME_UNCERTAIN'});
  assert.equal(denied.read(SAVE_KEY),raw);
  const silent=storage(raw);
  assert.deepEqual(reserve({
    getItem:key=>silent.getItem(key),setItem(){}
  },{expectedRaw:raw}),{ok:false,reason:'BACKUP_VERIFY_FAILED'});
  const raced=storage(raw);
  const conflict={
    getItem:key=>raced.getItem(key),
    setItem(key,value){raced.setItem(key,value);raced.map.set(SAVE_KEY,'newer-tab');}
  };
  assert.deepEqual(reserve(conflict,{expectedRaw:raw}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(raced.read(SAVE_KEY),'newer-tab');
  assert.equal(raced.read(ABNORMAL_RESET_BACKUP_KEY),raw);
});
test('P2.35 real reset click path reserves backup before calling persist',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const handler=main.slice(main.indexOf("byId('reset').addEventListener"),
    main.indexOf("const dialog = byId('guide')"));
  const backup=handler.indexOf('prepareAbnormalResetBackup(store,{expectedRaw:persistedRaw})');
  const persist=handler.indexOf('persist(resetState,{confirmedReset:true})');
  assert.ok(backup>0&&persist>backup);
  assert.ok(handler.includes('if(!backup.ok)'));
  assert.ok(handler.includes('重置已中止'));
  assert.ok(main.includes("import { prepareAbnormalResetBackup } from './reset-backup.mjs';"));
  assert.equal(handler.includes('removeItem('),false);
});

test('P2.37 refuses abnormal reset backup that exceeds actual UTF-8 export budget',()=>{
  // Below the UTF-16 code-unit cap, but beyond the download byte cap.
  const raw='中'.repeat(Math.ceil(2_000_000/3));
  assert.ok(raw.length<2_000_000);
  const db=storage(raw);
  assert.deepEqual(reserve(db,{expectedRaw:raw}),
    {ok:false,reason:'BACKUP_TOO_LARGE'});
  assert.deepEqual(db.writes,[]);
  assert.equal(db.read(SAVE_KEY),raw);
  assert.equal(db.read(ABNORMAL_RESET_BACKUP_KEY),null);
});

test('P2.37 rejects unexportable escaped UTF-16 backup envelope',()=>{
  // The malformed raw itself fits the encoder budget, but its escaped
  // JSON envelope exceeds it. No backup or reset may be authorized.
  const raw=String.fromCharCode(0xD800).repeat(Math.ceil(2_000_000/6));
  assert.ok(new TextEncoder().encode(raw).byteLength<2_000_000);
  const db=storage(raw);
  assert.deepEqual(reserve(db,{expectedRaw:raw}),
    {ok:false,reason:'BACKUP_TOO_LARGE'});
  assert.deepEqual(db.writes,[]);
  assert.equal(db.read(SAVE_KEY),raw);
});

test('P2.37 accepts an exportable malformed original without altering it',()=>{
  const raw='异常'+String.fromCharCode(0xD800)+'原文';
  const db=storage(raw);
  const result=reserve(db,{expectedRaw:raw});
  assert.equal(result.ok,true);
  assert.equal(result.verifiedReadback,true);
  assert.deepEqual(db.writes,[[ABNORMAL_RESET_BACKUP_KEY,raw]]);
  assert.equal(db.read(SAVE_KEY),raw);
});

test('P2.37 refuses backup if the browser cannot encode it',()=>{
  const raw='{broken';
  const db=storage(raw);
  const previous=globalThis.TextEncoder;
  try {
    globalThis.TextEncoder=undefined;
    assert.deepEqual(reserve(db,{expectedRaw:raw}),
      {ok:false,reason:'BACKUP_ENCODING_UNAVAILABLE'});
    assert.deepEqual(db.writes,[]);
    assert.equal(db.read(SAVE_KEY),raw);
  } finally {globalThis.TextEncoder=previous;}
});
