import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,MAX_ENERGY,ENERGY_REGEN_MS} from '../merge/engine.mjs';
import {loadLocal,SAVE_KEY,LEGACY_BACKUP_KEY} from '../merge/storage.mjs';
import {createInitialState as legacyInitial} from '../merge/legacy-engine.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {prepareNormalStartup} from '../merge/startup-persist.mjs';
const now=1_000_000;
function db(raw=null,story=null){
  const map=new Map(),writes=[];
  if(raw!==null)map.set(SAVE_KEY,raw);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,getItem:key=>map.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);map.set(key,value);},
    read:key=>map.get(key)??null};
}
test('existing unchanged V3 is never rewritten at startup',()=>{
  const raw=JSON.stringify(createInitialState(now),null,2),store=db(raw);
  const loaded=loadLocal(store,now),result=prepareNormalStartup(loaded,store,now);
  assert.equal(result.blocked,false);
  assert.equal(result.attempted,false);
  assert.equal(result.raw,raw,'preserve exact formatted baseline');
  assert.deepEqual(store.writes,[]);
});
test('first new session is saved once and only after exact readback',()=>{
  const store=db(),loaded=loadLocal(store,now);
  const result=prepareNormalStartup(loaded,store,now);
  assert.equal(result.blocked,false);
  assert.equal(result.attempted,true);
  assert.equal(result.verifiedReadback,true);
  assert.equal(result.raw,store.read(SAVE_KEY));
  assert.deepEqual(store.writes.map(([key])=>key),[SAVE_KEY]);
});
test('startup energy regeneration is published only when saved',()=>{
  const original={...createInitialState(now),energy:MAX_ENERGY-2};
  const raw=JSON.stringify(original),store=db(raw),loaded=loadLocal(store,now);
  const result=prepareNormalStartup(loaded,store,now+ENERGY_REGEN_MS+1);
  assert.equal(result.blocked,false);
  assert.equal(result.attempted,true);
  assert.equal(result.state.energy,MAX_ENERGY-1);
  assert.equal(result.raw,store.read(SAVE_KEY));
  assert.notEqual(result.state,loaded.state);
});
test('stale baseline rejects regeneration and retains original UI state',()=>{
  const original={...createInitialState(now),energy:MAX_ENERGY-2};
  const raw=JSON.stringify(original),store=db(raw),loaded=loadLocal(store,now);
  const changed=JSON.stringify({...original,energy:MAX_ENERGY-1});
  store.setItem(SAVE_KEY,changed);
  const writes=store.writes.length;
  const result=prepareNormalStartup(loaded,store,now+ENERGY_REGEN_MS+1);
  assert.equal(result.blocked,true);
  assert.equal(result.attempted,true);
  assert.equal(result.state,loaded.state);
  assert.equal(result.raw,raw);
  assert.equal(store.read(SAVE_KEY),changed);
  assert.equal(store.writes.length,writes,'no extra stale write');
});
test('silent lost write never publishes regenerated state',()=>{
  const original={...createInitialState(now),energy:MAX_ENERGY-2};
  const raw=JSON.stringify(original),store=db(raw),loaded=loadLocal(store,now);
  const fake={getItem:key=>store.getItem(key),setItem:()=>{}};
  const result=prepareNormalStartup(loaded,fake,now+ENERGY_REGEN_MS+1);
  assert.equal(result.blocked,true);
  assert.equal(result.reason,'SAVE_VERIFY_FAILED');
  assert.equal(result.state,loaded.state);
  assert.equal(store.read(SAVE_KEY),raw);
});
test('corrupt and failed migration never trigger automatic startup writes',()=>{
  const corrupt=db('{broken');
  const blocked=loadLocal(corrupt,now);
  const before=corrupt.writes.length;
  const result=prepareNormalStartup(blocked,corrupt,now);
  assert.equal(result.blocked,true);
  assert.equal(result.attempted,false);
  assert.equal(corrupt.writes.length,before);
  assert.equal(corrupt.read(SAVE_KEY),'{broken');
  const legacy=JSON.stringify(legacyInitial(now)),store=db(legacy);
  const failBackup={getItem:key=>store.getItem(key),
    setItem:(key,value)=>{if(key===LEGACY_BACKUP_KEY)throw Error('quota');store.setItem(key,value);}};
  const loaded=loadLocal(failBackup,now);
  assert.equal(loaded.reason,'BACKUP_UNAVAILABLE');
  const count=store.writes.length;
  const pending=prepareNormalStartup(loaded,failBackup,now);
  assert.equal(pending.attempted,false);
  assert.equal(pending.blocked,true);
  assert.equal(store.writes.length,count);
  assert.equal(store.read(SAVE_KEY),legacy);
});
test('blocked migration verification failure is not advertised as success',()=>{
  const loaded={state:createInitialState(now),raw:'legacy-raw',blocked:true,
    reason:'WRITE_VERIFY_FAILED',migrated:true};
  const store=db('maybe-migrated'),result=prepareNormalStartup(loaded,store,now);
  assert.equal(result.reason,'WRITE_VERIFY_FAILED');
  assert.equal(result.attempted,false);
  assert.deepEqual(store.writes,[]);
});
test('story mode remains unchanged by ordinary startup persistence',()=>{
  const story=JSON.stringify(createEmptyStoryProgress()),store=db(null,story);
  const result=prepareNormalStartup(loadLocal(store,now),store,now);
  assert.equal(result.blocked,false);
  assert.equal(store.read(STORY_SAVE_KEY),story);
  assert.deepEqual(store.writes.map(([key])=>key),[SAVE_KEY]);
});
test('actual UI uses prepared startup and has no unconditional final persist',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  assert.ok(main.includes('const startup = prepareNormalStartup(loaded,store);'));
  assert.ok(main.includes('let state = startup.state;'));
  assert.ok(main.includes('let saveIssue = startup.blocked ? startup.reason : null;'));
  assert.ok(main.includes('let persistedRaw = startup.raw;'));
  assert.ok(main.includes('loaded.migrated && !startup.blocked'));
  assert.equal(main.includes('persist(); render();'),false);
  assert.ok(main.includes('if (startup.blocked) hint('));
});
