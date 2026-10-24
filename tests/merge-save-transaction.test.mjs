import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {commitNormalSnapshot} from '../merge/save-transaction.mjs';
const make=(revision=0)=>({...createInitialState(1_000_000),revision});
const raw=n=>JSON.stringify(make(n));
function storage(initial=null,story=null) {
  const map=new Map(),writes=[];
  if(initial!==null)map.set(SAVE_KEY,initial);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,getItem:key=>map.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);map.set(key,value);},
    read:key=>map.get(key)??null};
}
test('successful write confirms exact persisted snapshot',()=>{
  const prior=raw(1),db=storage(prior),next=make(2);
  const result=commitNormalSnapshot(db,next,{expectedRaw:prior});
  assert.equal(result.ok,true);
  assert.equal(result.status,'SAVE_VERIFIED');
  assert.equal(result.verifiedReadback,true);
  assert.equal(result.raw,JSON.stringify(next));
  assert.deepEqual(db.writes,[[SAVE_KEY,JSON.stringify(next)]]);
  assert.ok(Object.isFrozen(result));
});
test('stale tab, absent baseline and corrupt saves fail without writes',()=>{
  const prior=raw(1),changed=JSON.stringify({...make(1),energyAt:1_000_001});
  const db=storage(changed);
  assert.deepEqual(commitNormalSnapshot(db,make(2),{expectedRaw:prior}),
    {ok:false,reason:'SAVE_REJECTED_OR_UNCERTAIN'});
  assert.deepEqual(commitNormalSnapshot(db,make(2)),
    {ok:false,reason:'NO_TRUSTED_BASELINE'});
  const broken=storage('{bad');
  assert.deepEqual(commitNormalSnapshot(broken,make(2),{expectedRaw:'{bad'}),
    {ok:false,reason:'SAVE_REJECTED_OR_UNCERTAIN'});
  assert.deepEqual(db.writes,[]);
  assert.deepEqual(broken.writes,[]);
});
test('setItem no-op cannot claim verified success',()=>{
  const prior=raw(1),db=storage(prior);
  const broken={getItem:key=>db.getItem(key),setItem:()=>{}};
  assert.deepEqual(commitNormalSnapshot(broken,make(2),{expectedRaw:prior}),
    {ok:false,reason:'SAVE_VERIFY_FAILED'});
  assert.equal(db.read(SAVE_KEY),prior);
});
test('storage quota rejection retains previous data',()=>{
  const prior=raw(1),db=storage(prior);
  const broken={getItem:key=>db.getItem(key),setItem:()=>{throw Error('quota')}};
  assert.deepEqual(commitNormalSnapshot(broken,make(2),{expectedRaw:prior}),
    {ok:false,reason:'SAVE_REJECTED_OR_UNCERTAIN'});
  assert.equal(db.read(SAVE_KEY),prior);
});
test('downgrade needs explicit confirmed reset with exact baseline',()=>{
  const prior=raw(8),db=storage(prior);
  assert.equal(commitNormalSnapshot(db,make(0),{expectedRaw:prior}).ok,false);
  assert.equal(db.read(SAVE_KEY),prior);
  assert.equal(commitNormalSnapshot(db,make(0),
    {expectedRaw:prior,confirmedReset:true}).ok,true);
  assert.equal(db.read(SAVE_KEY),raw(0));
});
test('ordinary save leaves story mode untouched',()=>{
  const story=JSON.stringify(createEmptyStoryProgress()),db=storage(null,story);
  assert.equal(commitNormalSnapshot(db,make(),{expectedRaw:null}).ok,true);
  assert.equal(db.read(STORY_SAVE_KEY),story);
  assert.deepEqual(db.writes.map(([key])=>key),[SAVE_KEY]);
});
test('UI publishes economic actions and energy tick only after persistence',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const action=main.slice(main.indexOf('function commit(result) {'),
    main.indexOf('function maybeProduce'));
  assert.ok(action.includes('if(!persist(result.state))'));
  assert.ok(action.indexOf('state=result.state;')>action.indexOf('if(!persist(result.state))'));
  assert.ok(action.includes('if(saveIssue)'));
  const reset=main.slice(main.indexOf("byId('reset').addEventListener"),
    main.indexOf("const dialog = byId('guide')"));
  assert.ok(reset.indexOf('state=resetState;')>reset.indexOf('persist(resetState,{confirmedReset:true})'));
  const tick=main.slice(main.indexOf('window.setInterval(() => {'));
  assert.ok(tick.indexOf('state=updated;')>tick.indexOf('if(persist(updated))'));
  assert.ok(tick.includes('!saveIssue && updated !== state'));
});
