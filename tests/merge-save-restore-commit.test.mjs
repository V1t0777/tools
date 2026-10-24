import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {commitNormalSaveRestore as commit} from '../merge/save-restore-commit.mjs';

const raw=(revision=0)=>JSON.stringify({...createInitialState(1_000_000),revision});
function storage(current=null,backup=null,story=null){
  const map=new Map(),writes=[],reads=[];
  if(current!==null)map.set(SAVE_KEY,current);
  if(backup!==null)map.set(RESTORE_BACKUP_KEY,backup);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,reads,
    getItem(key){reads.push(key);return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push([key,value]);map.set(key,value);},
    read:key=>map.get(key)??null};
}

test('confirmation is mandatory, without it neither backup nor save is written',()=>{
  const current=raw(3),s=storage(current);
  for(const opts of [{expectedRaw:current},{expectedRaw:current,confirmed:1},
    {expectedRaw:current,confirmed:'true'}]){
    assert.deepEqual(commit(raw(4),s,opts),{ok:false,reason:'CONFIRMATION_REQUIRED'});
  }
  assert.deepEqual(s.writes,[]);
  assert.equal(s.read(SAVE_KEY),current);
});

test('confirmed restore preserves original bytes, restores exact file text and verifies readback',()=>{
  const original=JSON.stringify(createInitialState(1_000_000),null,2);
  const file=JSON.stringify({...createInitialState(1_000_000),revision:2},null,2);
  const story=JSON.stringify(createEmptyStoryProgress()),s=storage(original,null,story);
  const result=commit(file,s,{expectedRaw:original,confirmed:true});
  assert.equal(result.ok,true);
  assert.equal(result.status,'RESTORE_VERIFIED');
  assert.equal(result.backupCreated,true);
  assert.equal(result.backupPreserved,true);
  assert.equal(result.verifiedReadback,true);
  assert.ok(Object.isFrozen(result));
  assert.equal('content' in result,false);
  assert.equal(s.read(SAVE_KEY),file);
  assert.equal(s.read(RESTORE_BACKUP_KEY),original);
  assert.equal(s.read(STORY_SAVE_KEY),story);
  assert.deepEqual(s.writes,[[RESTORE_BACKUP_KEY,original],[SAVE_KEY,file]]);
  assert.equal(s.reads.includes(STORY_SAVE_KEY),false);
});

test('new installation restores without creating a fake backup',()=>{
  const s=storage(),file=raw(4);
  const result=commit(file,s,{expectedRaw:null,confirmed:true});
  assert.equal(result.ok,true);
  assert.equal(result.backupCreated,false);
  assert.equal(result.backupPreserved,false);
  assert.equal(s.read(SAVE_KEY),file);
  assert.equal(s.read(RESTORE_BACKUP_KEY),null);
  assert.deepEqual(s.writes,[[SAVE_KEY,file]]);
});

test('downgrade needs independent explicit acknowledgement before any write',()=>{
  const current=raw(8),file=raw(2),s=storage(current);
  assert.deepEqual(commit(file,s,{expectedRaw:current,confirmed:true}),
    {ok:false,reason:'DOWNGRADE_CONFIRMATION_REQUIRED'});
  assert.deepEqual(s.writes,[]);
  const result=commit(file,s,{expectedRaw:current,confirmed:true,allowDowngrade:true});
  assert.equal(result.ok,true);
  assert.equal(result.previousRevision,8);
  assert.equal(result.sourceRevision,2);
  assert.equal(s.read(RESTORE_BACKUP_KEY),current);
  assert.equal(s.read(SAVE_KEY),file);
});

test('stale baseline, corrupt source and backup-slot conflict fail closed',()=>{
  const current=raw(3),s=storage(current,'different-backup');
  assert.deepEqual(commit(raw(4),s,{expectedRaw:current,confirmed:true}),
    {ok:false,reason:'BACKUP_SLOT_CONFLICT'});
  assert.deepEqual(commit(raw(4),s,{expectedRaw:raw(1),confirmed:true}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.deepEqual(commit('{bad',s,{expectedRaw:current,confirmed:true}),
    {ok:false,reason:'INVALID_JSON'});
  assert.deepEqual(commit(raw(4),s,{confirmed:true}),
    {ok:false,reason:'NO_TRUSTED_BASELINE'});
  assert.deepEqual(s.writes,[]);
  assert.equal(s.read(SAVE_KEY),current);
});

test('intervening tab change during backup causes no main save overwrite',()=>{
  const current=raw(3),newer=raw(4),s=storage(current);
  const guarded={getItem:key=>s.getItem(key),setItem:(key,value)=>{
    s.setItem(key,value);
    if(key===RESTORE_BACKUP_KEY)s.map.set(SAVE_KEY,newer);
  }};
  assert.deepEqual(commit(raw(5),guarded,{expectedRaw:current,confirmed:true}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(s.read(SAVE_KEY),newer);
  assert.equal(s.read(RESTORE_BACKUP_KEY),current);
  assert.deepEqual(s.writes,[[RESTORE_BACKUP_KEY,current]]);
});

test('backup changed after reservation is detected before main save write',()=>{
  const current=raw(3),s=storage(current);
  let backupReads=0;
  const guarded={getItem:key=>{
    if(key===RESTORE_BACKUP_KEY && ++backupReads===4)
      s.map.set(RESTORE_BACKUP_KEY,'another-tab');
    return s.getItem(key);
  },setItem:(key,value)=>s.setItem(key,value)};
  const result=commit(raw(5),guarded,{expectedRaw:current,confirmed:true});
  assert.deepEqual(result,{ok:false,reason:'BACKUP_CHANGED'});
  assert.equal(s.read(SAVE_KEY),current);
  assert.equal(s.read(RESTORE_BACKUP_KEY),'another-tab');
  assert.equal(s.writes.some(([key])=>key===SAVE_KEY),false);
});

test('storage failures and mismatched readback never report verified restoration',()=>{
  const current=raw(3),file=raw(5);
  const s=storage(current);
  const writeDenied={getItem:key=>s.getItem(key),setItem:(key,value)=>{
    if(key===SAVE_KEY)throw Error('quota');
    s.setItem(key,value);
  }};
  assert.deepEqual(commit(file,writeDenied,{expectedRaw:current,confirmed:true}),
    {ok:false,reason:'RESTORE_OUTCOME_UNCERTAIN'});
  assert.equal(s.read(SAVE_KEY),current);
  assert.equal(s.read(RESTORE_BACKUP_KEY),current);

  const other=storage(current);
  const truncated={getItem:key=>other.getItem(key),setItem:(key,value)=>{
    other.setItem(key,key===SAVE_KEY?'partial':value);
  }};
  assert.deepEqual(commit(file,truncated,{expectedRaw:current,confirmed:true}),
    {ok:false,reason:'RESTORE_VERIFY_FAILED'});
  assert.equal(other.read(SAVE_KEY),'partial');
  assert.equal(other.read(RESTORE_BACKUP_KEY),current);
});

test('does not wire unreviewed restoration to player UI, network or story mode',()=>{
  const module=readFileSync(new URL('../merge/save-restore-commit.mjs',import.meta.url),'utf8');
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const html=readFileSync(new URL('../merge/index.html',import.meta.url),'utf8');
  for(const forbidden of ['fetch(','XMLHttpRequest','sendBeacon(','localStorage.','removeItem(','STORY_SAVE_KEY'])
    assert.equal(module.includes(forbidden),false,'unexpected side effect: '+forbidden);
  assert.equal(main.includes("from './save-restore-commit.mjs'"),false);
  assert.equal(html.includes('id="import-local-save"'),false);
  assert.equal(validateSave(JSON.parse(raw(4))),true);
});
