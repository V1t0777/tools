import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,MAX_ENERGY,ENERGY_REGEN_MS,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';
import {attachNormalPageLifecycle} from '../merge/normal-page-lifecycle.mjs';

const now=1000,rawOf=s=>JSON.stringify(s),reject=reason=>({ok:false,reason});
function storage(raw=rawOf(createInitialState(now))) {
  const map=new Map(),writes=[];
  if(raw!==null)map.set(SAVE_KEY,raw);
  return {map,writes,
    getItem(key){return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push(key);map.set(key,value);},
    read(){return map.get(SAVE_KEY)??null;}
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
function events() {
  const w=new Map(),d=new Map();
  const target=map=>({
    addEventListener(name,fn){map.set(name,fn);},
    removeEventListener(name,fn){if(map.get(name)===fn)map.delete(name);},
    emit(name,event={}){map.get(name)?.(event);}
  });
  const win=target(w),doc=Object.assign(target(d),{hidden:false});
  return {win,doc,w,d};
}
function harness(initial=rawOf(createInitialState(now))) {
  const db=storage(initial),lock=locks(),ui=events(),changes=[],cancels=[];
  const runtime=createNormalPageRuntime({storage:db,locks:lock});
  const bridge=attachNormalPageLifecycle({
    runtime,win:ui.win,doc:ui.doc,storage:db,
    cancelGesture:()=>cancels.push('cancel'),
    onResult:(result,source)=>changes.push({result,source})
  });
  return {db,lock,runtime,bridge,ui,changes,cancels,
    event(key=SAVE_KEY,area=db){ui.win.emit('storage',{key,storageArea:area});}
  };
}

test('V3.1 P2.63 startup publication cannot acknowledge an overwritten raw save',async()=>{
  const db=storage(),replacement='{external';
  const r=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:(_s,_raw,kind)=>{if(kind==='startup')db.setItem(SAVE_KEY,replacement);}});
  assert.deepEqual(await r.start({now}),reject('UI_PUBLISH_FAILED'));
  assert.equal(r.blocked,true);
  assert.equal(db.read(),replacement);
  assert.deepEqual(await r.action(s=>moveOrMerge(s,0,2)),reject('UI_SAVE_BLOCKED'));
});

test('V3.1 P2.63 action publication callback cannot replace the save and still report success',async()=>{
  const db=storage(),replacement=rawOf({...createInitialState(now),revision:7});
  const r=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:(_s,_raw,kind)=>{if(kind==='action')db.setItem(SAVE_KEY,replacement);}});
  await r.start({now});
  assert.deepEqual(await r.action(s=>moveOrMerge(s,0,2)),
    reject('UI_PUBLISH_FAILED'));
  assert.equal(r.blocked,true);
  assert.equal(db.read(),replacement);
});

test('V3.1 P2.63 clock publication callback cannot change the verified baseline',async()=>{
  const initial={...createInitialState(now),energy:MAX_ENERGY-1};
  const db=storage(rawOf(initial)),replacement=rawOf({...initial,revision:7});
  const r=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:(_s,_raw,kind)=>{if(kind==='clock')db.setItem(SAVE_KEY,replacement);}});
  await r.start({now});
  assert.deepEqual(await r.clock({now:now+ENERGY_REGEN_MS+1}),
    reject('UI_PUBLISH_FAILED'));
  assert.equal(r.blocked,true);
  assert.equal(db.read(),replacement);
});

test('V3.1 P2.63 reset publication callback cannot falsely report a safe reset',async()=>{
  const db=storage(),replacement='{newer';
  const r=createNormalPageRuntime({locks:locks(),storage:db,
    onVerified:(_s,_raw,kind)=>{if(kind==='reset')db.setItem(SAVE_KEY,replacement);}});
  await r.start({now});
  assert.deepEqual(await r.reset({confirmed:true,now:now+1}),
    reject('UI_PUBLISH_FAILED'));
  assert.equal(r.blocked,true);
  assert.equal(db.read(),replacement);
});

test('V3.1 P2.63 lifecycle ignores unrelated storage and initial pageshow',async()=>{
  const h=harness();
  await h.runtime.start({now});
  h.event('other');
  h.event(SAVE_KEY,{});
  h.ui.win.emit('pageshow',{persisted:false});
  assert.deepEqual(h.cancels,[]);
  assert.deepEqual(h.changes,[]);
  assert.equal(h.runtime.phase,'ready');
  assert.equal(h.ui.w.size,4);
  assert.equal(h.ui.d.size,1);
});

test('V3.1 P2.63 storage event cancels stale gesture before adopting a valid clock',async()=>{
  const initial={...createInitialState(now),energy:MAX_ENERGY-1};
  const h=harness(rawOf(initial));
  await h.runtime.start({now});
  h.db.setItem(SAVE_KEY,rawOf({...initial,energy:MAX_ENERGY,
    energyAt:now+ENERGY_REGEN_MS}));
  h.event();
  assert.deepEqual(h.cancels,['cancel']);
  assert.equal(h.runtime.snapshot().energy,MAX_ENERGY);
  assert.equal(h.changes.length,1);
  assert.equal(h.changes[0].source,'storage');
  assert.equal(h.changes[0].result.changed,true);
  assert.equal(h.runtime.raw,h.db.read());
});

test('V3.1 P2.63 divergent equal revision blocks and cancels old pointer',async()=>{
  const initial=createInitialState(now),h=harness(rawOf(initial));
  await h.runtime.start({now});
  h.db.setItem(SAVE_KEY,rawOf({...initial,coins:initial.coins+200}));
  h.event(null);
  assert.equal(h.runtime.blocked,true);
  assert.equal(h.runtime.snapshot().coins,initial.coins);
  assert.equal(h.changes.length,1);
  assert.equal(h.changes[0].result.reason,'CURRENT_SAVE_CHANGED');
  assert.ok(h.cancels.length>=1);
  assert.deepEqual(await h.runtime.action(s=>moveOrMerge(s,0,2)),
    reject('UI_SAVE_BLOCKED'));
});

test('V3.1 P2.63 BFCache and focus reconcile only when visible',async()=>{
  const h=harness();
  await h.runtime.start({now});
  h.ui.doc.hidden=true;
  h.ui.win.emit('pageshow',{persisted:true});
  h.ui.win.emit('focus');
  assert.deepEqual(h.changes,[]);
  h.ui.doc.hidden=false;
  h.ui.win.emit('pageshow',{persisted:false});
  assert.deepEqual(h.cancels,[]);
  h.ui.win.emit('pageshow',{persisted:true});
  h.ui.win.emit('focus');
  assert.equal(h.runtime.phase,'ready');
  assert.deepEqual(h.changes,[]);
});

test('V3.1 P2.63 pagehide and hidden visibility cancel gestures and invalidate pending writes',async()=>{
  const h=harness();
  await h.runtime.start({now});
  h.ui.doc.hidden=true;
  h.ui.doc.emit('visibilitychange');
  h.ui.win.emit('pagehide');
  assert.deepEqual(h.cancels,['cancel','cancel']);
  assert.equal(h.runtime.blocked,false);
});

test('V3.1 P2.63 synchronous reentrant storage callback permanently blocks',async()=>{
  const db=storage(),ui=events();
  const r=createNormalPageRuntime({storage:db,locks:locks()});
  await r.start({now});
  const bridge=attachNormalPageLifecycle({
    runtime:r,win:ui.win,doc:ui.doc,storage:db,
    onResult:()=>ui.win.emit('storage',{key:SAVE_KEY,storageArea:db})
  });
  db.setItem(SAVE_KEY,rawOf({...createInitialState(now),revision:2}));
  ui.win.emit('storage',{key:SAVE_KEY,storageArea:db});
  assert.equal(r.blocked,true);
  assert.deepEqual(await r.clock({now}),reject('UI_SAVE_BLOCKED'));
  bridge.detach();
});

test('V3.1 P2.63 inaccessible storage blocks and never writes through lifecycle',async()=>{
  const h=harness();
  await h.runtime.start({now});
  const original=h.db.getItem;
  h.db.getItem=()=>{throw Error('denied');};
  h.event();
  assert.equal(h.runtime.blocked,true);
  assert.equal(h.changes[0].result.reason,'STORAGE_UNAVAILABLE');
  h.db.getItem=original;
});

test('V3.1 P2.63 detached bridge removes every listener and ignores later events',async()=>{
  const h=harness();
  await h.runtime.start({now});
  h.bridge.detach();
  h.bridge.detach();
  assert.equal(h.ui.w.size,0);
  assert.equal(h.ui.d.size,0);
  h.db.setItem(SAVE_KEY,'{broken');
  h.event();
  assert.equal(h.runtime.blocked,false);
  assert.deepEqual(h.changes,[]);
  assert.deepEqual(h.cancels,[]);
});


test('P2.65d pagehide suspends writes without document.hidden until verified pageshow',async()=>{
  const h=harness();
  await h.runtime.start({now});
  assert.equal(h.bridge.suspended,false);
  h.ui.win.emit('pagehide');
  assert.equal(h.bridge.suspended,true);
  h.ui.win.emit('focus');
  assert.equal(h.bridge.suspended,true,'focus cannot revive pagehide session');
  h.ui.win.emit('pageshow',{persisted:true});
  assert.equal(h.bridge.suspended,false);
  assert.equal(h.runtime.blocked,false);
});

test('P2.65d visibility restoration requires verified reconciliation',async()=>{
  const h=harness();
  await h.runtime.start({now});
  h.ui.doc.hidden=true;
  h.ui.doc.emit('visibilitychange');
  assert.equal(h.bridge.suspended,true);
  h.ui.doc.hidden=false;
  h.ui.doc.emit('visibilitychange');
  assert.equal(h.bridge.suspended,false);
  h.ui.doc.hidden=true;
  h.ui.doc.emit('visibilitychange');
  h.db.setItem(SAVE_KEY,'{corrupt');
  h.ui.doc.hidden=false;
  h.ui.doc.emit('visibilitychange');
  assert.equal(h.bridge.suspended,true);
  assert.equal(h.runtime.blocked,true);
});
