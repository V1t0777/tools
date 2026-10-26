import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,MAX_ENERGY,ENERGY_REGEN_MS,moveOrMerge} from '../merge/engine.mjs';
import {createInitialState as legacyInitial} from '../merge/legacy-engine.mjs';
import {SAVE_KEY,LEGACY_BACKUP_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';

const now=1000,encoded=value=>JSON.stringify(value);
const error=reason=>({ok:false,reason});
function memory(save=null) {
  const map=new Map(),writes=[];
  if(save!==null)map.set(SAVE_KEY,save);
  map.set(STORY_SAVE_KEY,'story-untouched');
  return {map,writes,
    getItem(key){return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push(key);map.set(key,value);},
    read(key){return map.has(key)?map.get(key):null;}
  };
}
function locks() {
  let held=false;
  return {request(name,opts,callback) {
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(opts,{mode:'exclusive',ifAvailable:true});
    if(held)return Promise.resolve(callback(null));
    held=true;
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}))
      .finally(()=>{held=false;});
  }};
}

test('P2.61w startup, real gameplay, no-op clock and reset have one verified lifecycle',async()=>{
  const db=memory(),events=[];
  const r=createNormalPageRuntime({storage:db,locks:locks(),
    onVerified:(state,raw,kind)=>events.push([kind,state.revision,raw])});
  assert.equal(r.snapshot(),null);
  assert.equal((await r.start({now})).ok,true);
  assert.equal(r.phase,'ready');
  const external=r.snapshot();
  external.coins=999999;
  assert.notEqual(r.snapshot().coins,999999);
  assert.equal((await r.action(s=>moveOrMerge(s,0,2))).ok,true);
  assert.equal(r.snapshot().revision,1);
  assert.equal((await r.clock({now})).ok,true);
  assert.equal(r.raw,db.read(SAVE_KEY));
  assert.deepEqual(await r.reset({confirmed:true,now:now+5}),
    {ok:true,status:'RESET_PUBLISHED',backupVerified:false});
  assert.equal(r.snapshot().revision,0);
  assert.equal(r.raw,db.read(SAVE_KEY));
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
  assert.deepEqual(events.map(x=>x[0]),['startup','action','clock','reset']);
  assert.deepEqual(db.writes,[SAVE_KEY,SAVE_KEY,SAVE_KEY]);
});

test('P2.61w legacy backup and migration are both executed under one lock',async()=>{
  const raw=encoded(legacyInitial(now)),db=memory(raw);
  const r=createNormalPageRuntime({locks:locks(),storage:db});
  assert.equal((await r.start({now})).ok,true);
  assert.equal(db.read(LEGACY_BACKUP_KEY),raw);
  assert.equal(db.read(SAVE_KEY),r.raw);
  assert.deepEqual(db.writes,[LEGACY_BACKUP_KEY,SAVE_KEY]);
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
});

test('P2.61w no Web Locks never falls back to unguarded startup or action',async()=>{
  const db=memory(),r=createNormalPageRuntime({locks:null,storage:db});
  assert.deepEqual(await r.start({now}),error('WEB_LOCKS_UNAVAILABLE'));
  assert.equal(r.phase,'cold');
  assert.equal(r.snapshot(),null);
  assert.deepEqual(db.writes,[]);
  assert.deepEqual(await r.action(s=>moveOrMerge(s,0,2)),
    error('STARTUP_REQUIRED'));
});

test('P2.61w two tabs sharing lock reject a stale action and never replay it',async()=>{
  const db=memory(),lock=locks();
  const a=createNormalPageRuntime({locks:lock,storage:db});
  const b=createNormalPageRuntime({locks:lock,storage:db});
  assert.equal((await a.start({now})).ok,true);
  assert.equal((await b.start({now})).ok,true);
  assert.equal((await a.action(s=>moveOrMerge(s,0,2))).ok,true);
  assert.deepEqual(await b.action(s=>moveOrMerge(s,0,2)),
    error('STALE_BASELINE'));
  assert.equal(b.blocked,true);
  assert.equal(b.snapshot().revision,0);
  assert.notEqual(b.raw,db.read(SAVE_KEY));
  assert.deepEqual(await b.clock({now}),error('UI_SAVE_BLOCKED'));
});

test('P2.61w verified clock-only cross-tab update can be adopted read-only',async()=>{
  const initial={...createInitialState(now),energy:MAX_ENERGY-1};
  const db=memory(encoded(initial)),events=[];
  const r=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:(_s,_b,kind)=>events.push(kind)});
  assert.equal((await r.start({now})).ok,true);
  db.setItem(SAVE_KEY,encoded({...initial,energy:MAX_ENERGY,
    energyAt:now+ENERGY_REGEN_MS}));
  assert.deepEqual(r.reconcile(),{ok:true,changed:true});
  assert.equal(r.snapshot().energy,MAX_ENERGY);
  assert.equal(r.raw,db.read(SAVE_KEY));
  assert.deepEqual(events,['startup','external']);
});

test('P2.61w same-revision economic fork blocks without changing UI snapshot',async()=>{
  const initial=createInitialState(now),db=memory(encoded(initial));
  const r=createNormalPageRuntime({locks:locks(),storage:db});
  await r.start({now});
  db.setItem(SAVE_KEY,encoded({...initial,coins:initial.coins+200}));
  assert.deepEqual(r.reconcile(),error('CURRENT_SAVE_CHANGED'));
  assert.equal(r.blocked,true);
  assert.equal(r.snapshot().coins,initial.coins);
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
});

test('P2.61w corrupt storage on resume blocks all subsequent writes',async()=>{
  const db=memory(encoded(createInitialState(now)));
  const r=createNormalPageRuntime({locks:locks(),storage:db});
  await r.start({now});
  db.setItem(SAVE_KEY,'{broken');
  assert.deepEqual(r.reconcile(),error('CORRUPT_SAVE'));
  assert.equal(r.blocked,true);
  const before=db.writes.length;
  assert.deepEqual(await r.action(s=>moveOrMerge(s,0,2)),
    error('UI_SAVE_BLOCKED'));
  assert.equal(db.writes.length,before);
});

test('P2.61w pending action is single-flight and invalidation suppresses stale publish',async()=>{
  const db=memory(encoded(createInitialState(now))),base=locks();
  let release,entered,delay=false;
  const gate=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const slow={request(name,opts,cb){
    if(!delay)return base.request(name,opts,cb);
    return base.request(name,opts,async lock=>{
      entered();await gate;return cb(lock);
    });
  }};
  const events=[];
  const r=createNormalPageRuntime({locks:slow,storage:db,
    onVerified:(_s,_b,kind)=>events.push(kind)});
  await r.start({now});
  delay=true;
  const pending=r.action(s=>moveOrMerge(s,0,2));
  await started;
  assert.equal(r.busy,true);
  assert.deepEqual(await r.action(s=>moveOrMerge(s,0,2)),
    error('UI_TRANSACTION_BUSY'));
  assert.deepEqual(await r.clock({now}),error('UI_TRANSACTION_BUSY'));
  assert.deepEqual(await r.reset({confirmed:true,now}),
    error('UI_TRANSACTION_BUSY'));
  r.invalidate();
  release();
  assert.deepEqual(await pending,error('UI_SAVE_BLOCKED'));
  assert.equal(r.blocked,true);
  assert.deepEqual(events,['startup']);
});

test('P2.61w corrupted save can reset only after explicit original backup',async()=>{
  const original='{broken',db=memory(original);
  const r=createNormalPageRuntime({locks:locks(),storage:db});
  assert.deepEqual(await r.start({now}),error('CORRUPT_SAVE'));
  assert.equal(r.blocked,true);
  assert.deepEqual(await r.reset(),error('RESET_NOT_CONFIRMED'));
  assert.deepEqual(await r.reset({confirmed:true,now}),
    error('NO_TRUSTED_BASELINE'));
  assert.deepEqual(await r.reset({confirmed:true,expectedRaw:original,now}),
    {ok:true,status:'RESET_PUBLISHED',backupVerified:true});
  assert.equal(db.read(ABNORMAL_RESET_BACKUP_KEY),original);
  assert.equal(db.read(STORY_SAVE_KEY),'story-untouched');
  assert.equal(r.phase,'ready');
  assert.equal((await r.action(s=>moveOrMerge(s,0,2))).ok,true);
});

test('P2.61w action rejected before write may retry without losing baseline',async()=>{
  const db=memory(encoded(createInitialState(now)));
  const r=createNormalPageRuntime({locks:locks(),storage:db});
  await r.start({now});
  assert.deepEqual(await r.action(()=>({ok:false,reason:'NO_ENERGY'})),
    error('ACTION_REJECTED'));
  assert.equal(r.blocked,false);
  assert.equal((await r.action(s=>moveOrMerge(s,0,2))).ok,true);
});

test('P2.61w async publication hook fails closed and is never claimed successful',async()=>{
  const db=memory();
  const r=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:async()=>{}});
  assert.deepEqual(await r.start({now}),error('UI_PUBLISH_FAILED'));
  assert.equal(r.blocked,true);
  assert.deepEqual(await r.start({now}),error('STARTUP_ALREADY_ATTEMPTED'));
});

test('P2.61w reset rejects another tab changing the trusted baseline',async()=>{
  const db=memory(encoded(createInitialState(now)));
  const r=createNormalPageRuntime({locks:locks(),storage:db});
  await r.start({now});
  db.setItem(SAVE_KEY,encoded({...createInitialState(now),revision:9}));
  assert.deepEqual(await r.reset({confirmed:true,now}),
    error('STALE_BASELINE'));
  assert.equal(r.blocked,true);
});
