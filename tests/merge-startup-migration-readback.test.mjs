import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateV2Save} from '../merge/engine.mjs';
import {createInitialState as createLegacy} from '../merge/legacy-engine.mjs';
import {loadLocal,SAVE_KEY,LEGACY_BACKUP_KEY,V2_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';

const now=1_000_000;
const v1=()=>createLegacy(now);
const v2=()=>{
  const {bag,progress,achievements,shop,...rest}=createInitialState(now);
  const save={...rest,schemaVersion:2,energy:80};
  assert.equal(validateV2Save(save),true);
  return save;
};
const cases=[['V1',v1,LEGACY_BACKUP_KEY],['V2',v2,V2_BACKUP_KEY]];
function memory(raw,story=null) {
  const map=new Map([[SAVE_KEY,raw]]),writes=[];
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,getItem:key=>map.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);map.set(key,value);},
    read:key=>map.get(key)??null};
}

for(const [label,create,backupKey] of cases){
  test(label+' successful migration only reports confirmed persisted bytes',()=>{
    const original=JSON.stringify(create()),story=JSON.stringify(createEmptyStoryProgress());
    const db=memory(original,story);
    const result=loadLocal(db,now);
    assert.equal(result.migrated,true);
    assert.equal(result.recovered,true);
    assert.equal(result.blocked,undefined);
    assert.equal(result.volatile,undefined);
    assert.equal(result.raw,db.read(SAVE_KEY));
    assert.equal(JSON.parse(result.raw).schemaVersion,3);
    assert.equal(db.read(backupKey),original);
    assert.equal(db.read(STORY_SAVE_KEY),story);
    assert.deepEqual(db.writes.map(([key])=>key),[backupKey,SAVE_KEY]);
  });

  test(label+' no-op save cannot be mistaken for successful migration',()=>{
    const original=JSON.stringify(create()),db=memory(original);
    const silent={getItem:key=>db.getItem(key),setItem:(key,value)=>{
      if(key!==SAVE_KEY)db.setItem(key,value);
    }};
    const result=loadLocal(silent,now);
    assert.equal(result.recovered,true);
    assert.equal(result.migrated,true);
    assert.equal(result.blocked,true);
    assert.equal(result.volatile,true);
    assert.equal(result.reason,'WRITE_VERIFY_FAILED');
    assert.equal(result.raw,original);
    assert.equal(db.read(SAVE_KEY),original);
    assert.equal(db.read(backupKey),original);
    assert.deepEqual(db.writes.map(([key])=>key),[backupKey]);
  });

  test(label+' partial post-write bytes trigger fail-closed uncertain status',()=>{
    const original=JSON.stringify(create()),db=memory(original);
    const partial={getItem:key=>db.getItem(key),setItem:(key,value)=>{
      db.setItem(key,key===SAVE_KEY?'{partial':value);
    }};
    const result=loadLocal(partial,now);
    assert.equal(result.blocked,true);
    assert.equal(result.volatile,true);
    assert.equal(result.reason,'WRITE_VERIFY_FAILED');
    assert.equal(result.raw,original,'do not claim partial data as valid baseline');
    assert.equal(db.read(SAVE_KEY),'{partial');
    assert.equal(db.read(backupKey),original,'recoverable original backup must remain');
  });

  test(label+' post-write read exception is not a verified migration',()=>{
    const original=JSON.stringify(create()),db=memory(original);
    let wrote=false;
    const throwing={getItem:key=>{
      if(key===SAVE_KEY&&wrote)throw Error('storage read blocked after write');
      return db.getItem(key);
    },setItem:(key,value)=>{
      db.setItem(key,value);
      if(key===SAVE_KEY)wrote=true;
    }};
    const result=loadLocal(throwing,now);
    assert.equal(result.reason,'WRITE_VERIFY_FAILED');
    assert.equal(result.blocked,true);
    assert.equal(result.volatile,true);
    assert.equal(result.raw,original);
    assert.equal(JSON.parse(db.read(SAVE_KEY)).schemaVersion,3);
    assert.equal(db.read(backupKey),original);
  });
}
