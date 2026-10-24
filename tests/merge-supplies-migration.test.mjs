import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave,validateV2Save,upgradeV2Save,purchaseSupply} from '../merge/engine.mjs';
import {loadLocal,saveLocal,SAVE_KEY,V2_BACKUP_KEY,LEGACY_BACKUP_KEY} from '../merge/storage.mjs';
import {createInitialState as createP1} from '../merge/legacy-engine.mjs';
const time=1_000_000;
function oldV2(){
  const old=structuredClone(createInitialState(time));
  old.schemaVersion=2;old.energy=80;
  delete old.bag;delete old.progress;delete old.achievements;delete old.shop;
  assert.equal(validateV2Save(old),true);
  return old;
}
function memory(entries={}){
  const map=new Map(Object.entries(entries));
  return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),get:k=>map.get(k)};
}

test('P2.9 V2 -> V3 migration keeps exact original bytes, money, board and revisions',()=>{
  const v2=oldV2();v2.coins=35;v2.xp=25;v2.revision=8;
  const raw=JSON.stringify(v2,null,2);
  const local=memory({[SAVE_KEY]:raw});
  const loaded=loadLocal(local,time);
  assert.equal(loaded.migrated,true);assert.equal(loaded.recovered,true);
  assert.equal(loaded.volatile,undefined);
  assert.equal(local.get(V2_BACKUP_KEY),raw);
  assert.equal(local.get(LEGACY_BACKUP_KEY),undefined);
  assert.equal(loaded.state.schemaVersion,3);
  assert.equal(loaded.state.energy,80);
  assert.equal(loaded.state.coins,35);
  assert.equal(loaded.state.xp,25);
  assert.equal(loaded.state.revision,8);
  assert.deepEqual(loaded.state.board,v2.board);
  assert.ok(Object.values(loaded.state.bag).every(n=>n===0));
  assert.equal(loaded.raw,local.get(SAVE_KEY));
  assert.equal(loadLocal(local,time).migrated,false);
  assert.equal(validateSave(loaded.state),true);
});

test('P2.9 V2 migration does not award prior achievements from untracked P2 history',()=>{
  const v2=oldV2();v2.xp=1400;v2.coins=1200;
  const result=upgradeV2Save(v2);
  assert.deepEqual(result.progress,{merges:0,orders:0});
  assert.ok(Object.values(result.achievements).every(x=>x===0));
  assert.equal(result.coins,1200);
});

test('P2.9 V2 backup denial blocks migration without touching sole copy',()=>{
  const raw=JSON.stringify(oldV2());
  const m=memory({[SAVE_KEY]:raw});
  const denied={getItem:m.getItem,setItem:(key,val)=>{
    if(key===V2_BACKUP_KEY)throw Error('read-only storage');
    m.setItem(key,val);
  }};
  const result=loadLocal(denied,time);
  assert.equal(result.blocked,true);assert.equal(result.volatile,true);
  assert.equal(result.reason,'BACKUP_UNAVAILABLE');
  assert.equal(m.get(SAVE_KEY),raw);
});

test('P2.9 preexisting mismatched V2 backup is not overwritten',()=>{
  const raw=JSON.stringify(oldV2());
  const m=memory({[SAVE_KEY]:raw,[V2_BACKUP_KEY]:'earlier bytes'});
  const loaded=loadLocal(m,time);
  assert.equal(loaded.reason,'BACKUP_UNAVAILABLE');
  assert.equal(m.get(SAVE_KEY),raw);
  assert.equal(m.get(V2_BACKUP_KEY),'earlier bytes');
});

test('P2.9 migration save failure keeps original V2 and completed backup',()=>{
  const raw=JSON.stringify(oldV2()),m=memory({[SAVE_KEY]:raw});
  const failing={getItem:m.getItem,setItem:(key,v)=>{
    if(key===SAVE_KEY)throw Error('quota');m.setItem(key,v);
  }};
  const res=loadLocal(failing,time);
  assert.equal(res.reason,'WRITE_FAILED');
  assert.equal(m.get(SAVE_KEY),raw);
  assert.equal(m.get(V2_BACKUP_KEY),raw);
});

test('P2.9 stale V2 migration cannot overwrite a concurrent change',()=>{
  const old=oldV2(),raw=JSON.stringify(old);
  const m=memory({[SAVE_KEY]:raw,[V2_BACKUP_KEY]:raw});
  const changed={...old,energy:79};
  m.setItem(SAVE_KEY,JSON.stringify(changed));
  assert.equal(saveLocal(m,upgradeV2Save(old),{migrationRaw:raw}),false);
  assert.deepEqual(JSON.parse(m.get(SAVE_KEY)),changed);
});

test('P2.9 rejects impossible historical V2 energy despite new cap of 120',()=>{
  const tooHigh=oldV2();tooHigh.energy=100;
  assert.equal(validateV2Save(tooHigh),false);
  const raw=JSON.stringify(tooHigh),m=memory({[SAVE_KEY]:raw});
  assert.equal(loadLocal(m,time).reason,'CORRUPT_SAVE');
  assert.equal(m.get(SAVE_KEY),raw);
});

test('P2.9 P1 migrated directly to V3 with independent P1 backup',()=>{
  const original=JSON.stringify(createP1(time)),m=memory({[SAVE_KEY]:original});
  const loaded=loadLocal(m,time);
  assert.equal(loaded.migrated,true);
  assert.equal(loaded.state.schemaVersion,3);
  assert.equal(m.get(LEGACY_BACKUP_KEY),original);
  assert.equal(m.get(V2_BACKUP_KEY),undefined);
});

test('P2.9 V3 inventory purchase survives reload and malformed inventory never overwrites',()=>{
  const m=memory(),s=createInitialState(time);s.coins=1000;
  const purchased=purchaseSupply(s,'soda').state;
  assert.equal(saveLocal(m,purchased),true);
  assert.deepEqual(loadLocal(m,time).state,purchased);
  const corrupted=structuredClone(purchased);corrupted.bag.soda=999;
  const raw=JSON.stringify(corrupted);m.setItem(SAVE_KEY,raw);
  const res=loadLocal(m,time);
  assert.equal(res.reason,'CORRUPT_SAVE');
  assert.equal(m.get(SAVE_KEY),raw);
  assert.equal(saveLocal(m,purchased),false);
});
