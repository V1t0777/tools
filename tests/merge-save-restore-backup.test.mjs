import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {RESTORE_BACKUP_KEY,prepareNormalSaveRestoreBackup as prepare} from '../merge/save-restore-backup.mjs';

const original=()=>JSON.stringify(createInitialState(1_000_000));
const incoming=()=>JSON.stringify({...createInitialState(1_000_000),revision:1});
function storage(current=null,backup=null,story=null){
  const map=new Map();
  if(current!==null)map.set(SAVE_KEY,current);
  if(backup!==null)map.set(RESTORE_BACKUP_KEY,backup);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  const reads=[],writes=[];
  return {reads,writes,map,
    getItem(key){reads.push(key);return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push([key,value]);map.set(key,value);},
    original:key=>map.get(key)??null};
}

test('preserves original raw bytes in a separate verified slot without touching story',()=>{
  const raw=JSON.stringify(createInitialState(1_000_000),null,2);
  const story=JSON.stringify(createEmptyStoryProgress()),s=storage(raw,null,story);
  const result=prepare(incoming(),s,{expectedRaw:raw});
  assert.equal(result.ok,true);
  assert.equal(result.status,'BACKUP_READY');
  assert.equal(result.backupCreated,true);
  assert.equal(result.restorePerformed,false);
  assert.ok(Object.isFrozen(result));
  assert.equal('content' in result,false);
  assert.deepEqual(s.writes,[[RESTORE_BACKUP_KEY,raw]]);
  assert.equal(s.original(RESTORE_BACKUP_KEY),raw);
  assert.equal(s.original(SAVE_KEY),raw);
  assert.equal(s.original(STORY_SAVE_KEY),story);
  assert.equal(s.reads.includes(STORY_SAVE_KEY),false);
});

test('empty current save causes no write, existing matching backup is reused',()=>{
  const s=storage();
  assert.deepEqual(prepare(incoming(),s,{expectedRaw:null}),
    {ok:true,status:'NO_EXISTING_SAVE',backupReady:true,
      backupCreated:false,restorePerformed:false});
  assert.deepEqual(s.writes,[]);
  const raw=original(),same=storage(raw,raw);
  assert.equal(prepare(incoming(),same,{expectedRaw:raw}).backupCreated,false);
  assert.deepEqual(same.writes,[]);
});

test('conflicting backup slot blocks without overwrite or removal',()=>{
  const raw=original(),s=storage(raw,'other original');
  assert.deepEqual(prepare(incoming(),s,{expectedRaw:raw}),
    {ok:false,reason:'BACKUP_SLOT_CONFLICT'});
  assert.equal(s.original(RESTORE_BACKUP_KEY),'other original');
  assert.equal(s.original(SAVE_KEY),raw);
  assert.deepEqual(s.writes,[]);
});

test('bad candidate, stale baseline and absent baseline never write',()=>{
  const raw=original(),s=storage(raw);
  assert.deepEqual(prepare('{bad',s,{expectedRaw:raw}),
    {ok:false,reason:'INVALID_JSON'});
  assert.deepEqual(prepare(incoming(),s,{expectedRaw:'old'}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.deepEqual(prepare(incoming(),s),
    {ok:false,reason:'NO_TRUSTED_BASELINE'});
  assert.deepEqual(s.writes,[]);
});

test('intervening main save update after preflight blocks backup creation',()=>{
  const raw=original(),next=JSON.stringify({...JSON.parse(raw),energyAt:1_000_001});
  const s=storage(raw);let reads=0;
  const guarded={getItem:key=>{
    if(key===SAVE_KEY && ++reads===2)s.map.set(SAVE_KEY,next);
    return s.getItem(key);
  },setItem:s.setItem};
  assert.deepEqual(prepare(incoming(),guarded,{expectedRaw:raw}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(s.original(SAVE_KEY),next);
  assert.deepEqual(s.writes,[]);
});

test('backup slot changed by another tab before write blocks without overwrite',()=>{
  const raw=original(),s=storage(raw);let reads=0;
  const guarded={getItem:key=>{
    if(key===RESTORE_BACKUP_KEY && ++reads===2)s.map.set(RESTORE_BACKUP_KEY,'other');
    return s.getItem(key);
  },setItem:s.setItem};
  assert.deepEqual(prepare(incoming(),guarded,{expectedRaw:raw}),
    {ok:false,reason:'BACKUP_OR_SAVE_CHANGED'});
  assert.equal(s.original(RESTORE_BACKUP_KEY),'other');
  assert.deepEqual(s.writes,[]);
});

test('quota and readback mismatch fail closed without altering the current save',()=>{
  const raw=original(),s=storage(raw);
  assert.deepEqual(prepare(incoming(),
    {getItem:s.getItem,setItem(){throw Error('quota')}},{expectedRaw:raw}),
    {ok:false,reason:'BACKUP_UNAVAILABLE'});
  assert.equal(s.original(RESTORE_BACKUP_KEY),null);
  assert.deepEqual(prepare(incoming(),
    {getItem:s.getItem,setItem:key=>s.setItem(key,'truncated')},{expectedRaw:raw}),
    {ok:false,reason:'BACKUP_VERIFY_FAILED'});
  assert.equal(s.original(SAVE_KEY),raw);
});

test('main save update during backup write prevents reporting readiness',()=>{
  const raw=original(),next=JSON.stringify({...JSON.parse(raw),energyAt:1_000_001});
  const s=storage(raw);
  const guarded={getItem:s.getItem,setItem:(key,value)=>{
    s.setItem(key,value);s.map.set(SAVE_KEY,next);
  }};
  assert.deepEqual(prepare(incoming(),guarded,{expectedRaw:raw}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(s.original(SAVE_KEY),next);
  assert.equal(s.original(RESTORE_BACKUP_KEY),raw);
});

test('backup module cannot restore current save and is not wired to UI',()=>{
  const source=readFileSync(new URL('../merge/save-restore-backup.mjs',import.meta.url),'utf8');
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  for(const forbidden of ['storage.setItem(SAVE_KEY','removeItem(','fetch(','localStorage.'])
    assert.equal(source.includes(forbidden),false);
  assert.equal(main.includes("from './save-restore-backup.mjs'"),false);
});
