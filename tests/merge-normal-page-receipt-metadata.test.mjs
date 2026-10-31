import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,moveOrMerge,MAX_ENERGY,ENERGY_REGEN_MS} from '../merge/engine.mjs';
import {createInitialState as legacyInitial} from '../merge/legacy-engine.mjs';
import {SAVE_KEY,LEGACY_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';

const now=1000;
const rawOf=state=>JSON.stringify(state);
function storage(raw=null) {
  const map=new Map(),writes=[];
  if(raw!==null)map.set(SAVE_KEY,raw);
  map.set(STORY_SAVE_KEY,'story-untouched');
  return {writes,
    getItem(key){return map.get(key)??null;},
    setItem(key,value){map.set(key,value);writes.push(key);},
    read(key){return map.get(key)??null;}
  };
}
function locks(){
  let busy=false;
  return {request(name,options,cb){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    if(busy)return Promise.resolve(cb(null));
    busy=true;
    return Promise.resolve().then(()=>cb({name,mode:'exclusive'}))
      .finally(()=>{busy=false;});
  }};
}

test('P2.64a first launch publishes verified recovered=false and migrated=false',async()=>{
  const db=storage(),r=createNormalPageRuntime({storage:db,locks:locks()});
  const result=await r.start({now});
  assert.deepEqual(result,{ok:true,status:'UI_PUBLISHED',recovered:false,migrated:false});
  assert.equal(r.raw,db.read(SAVE_KEY));
  assert.equal(r.phase,'ready');
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
});

test('P2.64a existing V3 save is recovered without migration or write',async()=>{
  const initial=createInitialState(now),db=storage(rawOf(initial));
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  const result=await r.start({now});
  assert.equal(result.ok,true);
  assert.equal(result.recovered,true);
  assert.equal(result.migrated,false);
  assert.deepEqual(db.writes,[]);
});

test('P2.64a migrated V1 save reports migration only after original backup readback',async()=>{
  const original=rawOf(legacyInitial(now)),db=storage(original);
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  const result=await r.start({now});
  assert.deepEqual(result,{ok:true,status:'UI_PUBLISHED',recovered:true,migrated:true});
  assert.equal(db.read(LEGACY_BACKUP_KEY),original);
  assert.equal(r.raw,db.read(SAVE_KEY));
});

test('P2.64a failed startup never reports recovered or migrated metadata',async()=>{
  const db=storage('{broken');
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  const result=await r.start({now});
  assert.deepEqual(result,{ok:false,reason:'CORRUPT_SAVE'});
  assert.equal('recovered' in result,false);
  assert.equal('migrated' in result,false);
  assert.equal(r.blocked,true);
});

test('P2.64a valid action returns original bounded engine message after verified save',async()=>{
  const db=storage(rawOf(createInitialState(now)));
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  await r.start({now});
  const expected=moveOrMerge(r.snapshot(),0,2);
  assert.equal(expected.ok,true);
  const result=await r.action(current=>moveOrMerge(current,0,2));
  assert.deepEqual(result,{ok:true,status:'UI_PUBLISHED',message:expected.message});
  assert.equal(r.raw,db.read(SAVE_KEY));
  assert.equal(r.snapshot().revision,1);
});

test('P2.64a rejected action message survives no-write outcome and remains retryable',async()=>{
  const db=storage(rawOf(createInitialState(now)));
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  await r.start({now});
  const before=db.read(SAVE_KEY),writes=db.writes.length;
  const result=await r.action(()=>({ok:false,message:'原料不足'}));
  assert.deepEqual(result,{ok:false,reason:'ACTION_REJECTED',message:'原料不足'});
  assert.equal(db.read(SAVE_KEY),before);
  assert.equal(db.writes.length,writes);
  assert.equal(r.blocked,false);
  assert.equal((await r.action(s=>moveOrMerge(s,0,2))).ok,true);
});

test('P2.64a long engine failure text is bounded before leaving lock and UI flight',async()=>{
  const db=storage(rawOf(createInitialState(now)));
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  await r.start({now});
  const result=await r.action(()=>({ok:false,message:'提示'.repeat(400)}));
  assert.equal(result.ok,false);
  assert.equal(result.reason,'ACTION_REJECTED');
  assert.equal(result.message.length,200);
  assert.equal(r.blocked,false);
});

test('P2.64a rejected action without a message preserves legacy failure shape',async()=>{
  const db=storage(rawOf(createInitialState(now)));
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  await r.start({now});
  assert.deepEqual(await r.action(()=>({ok:false,reason:'NO_ENERGY'})),
    {ok:false,reason:'ACTION_REJECTED'});
});

test('P2.64a no-op clock returns changed=false without rewriting localStorage',async()=>{
  const db=storage(rawOf(createInitialState(now)));
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  await r.start({now});
  const writes=db.writes.length;
  const result=await r.clock({now});
  assert.deepEqual(result,{ok:true,status:'UI_PUBLISHED',changed:false});
  assert.equal(db.writes.length,writes);
  assert.equal(r.raw,db.read(SAVE_KEY));
});

test('P2.64a due clock returns changed=true only after verified persistence',async()=>{
  const initial={...createInitialState(now),energy:MAX_ENERGY-1};
  const db=storage(rawOf(initial));
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  await r.start({now});
  const result=await r.clock({now:now+ENERGY_REGEN_MS+1});
  assert.deepEqual(result,{ok:true,status:'UI_PUBLISHED',changed:true});
  assert.equal(r.raw,db.read(SAVE_KEY));
  assert.equal(r.snapshot().energy,MAX_ENERGY);
});

test('P2.64a stale action and clock never leak verified metadata or publish',async()=>{
  const db=storage(rawOf(createInitialState(now)));
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  await r.start({now});
  db.setItem(SAVE_KEY,rawOf({...createInitialState(now),revision:9}));
  const result=await r.action(s=>moveOrMerge(s,0,2));
  assert.deepEqual(result,{ok:false,reason:'STALE_BASELINE'});
  assert.equal('message' in result,false);
  assert.equal(r.blocked,true);
  const tick=await r.clock({now});
  assert.deepEqual(tick,{ok:false,reason:'UI_SAVE_BLOCKED'});
  assert.equal('changed' in tick,false);
});

test('P2.64a failed UI publication never exposes action message or clock change',async()=>{
  const db=storage(rawOf(createInitialState(now)));
  const r=createNormalPageRuntime({storage:db,locks:locks(),
    onVerified:(_state,_raw,kind)=>{
      if(kind==='action')throw Error('DOM detached');
    }});
  await r.start({now});
  const result=await r.action(s=>moveOrMerge(s,0,2));
  assert.deepEqual(result,{ok:false,reason:'UI_PUBLISH_FAILED'});
  assert.equal('message' in result,false);
  assert.equal(r.blocked,true);
});
