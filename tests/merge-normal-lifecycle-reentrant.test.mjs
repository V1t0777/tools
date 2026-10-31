import test from 'node:test';
import assert from 'node:assert/strict';
import {attachNormalPageLifecycle} from '../merge/normal-page-lifecycle.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

// Synchronous browser-event reentry is intentionally modeled: DOM/storage
// hooks can fire another lifecycle event before the first handler returns.
function harness() {
  const windowListeners=new Map(),documentListeners=new Map();
  const target=listeners=>({
    addEventListener(name,handler){listeners.set(name,handler);},
    removeEventListener(name,handler){
      if(listeners.get(name)===handler)listeners.delete(name);
    },
    emit(name,event={}){listeners.get(name)?.(event);}
  });
  const win=target(windowListeners);
  const doc=Object.assign(target(documentListeners),{hidden:false});
  let reconciles=0,focuses=0;
  const storage={getItem(key){
    assert.equal(key,SAVE_KEY);
    return 'trusted-raw';
  }};
  const runtime={
    phase:'ready',raw:'trusted-raw',blocked:false,invalidations:0,
    reconcile(){reconciles++;return {ok:true,changed:false};},
    invalidate(){this.invalidations++;},
    block(reason){this.phase='blocked';this.blocked=true;this.reason=reason;}
  };
  const bridge=attachNormalPageLifecycle({
    runtime,win,doc,storage,onFocus(){focuses++;}
  });
  return {win,doc,storage,runtime,bridge,
    get reconciles(){return reconciles;},
    get focuses(){return focuses;}
  };
}

test('P2.65ac nested pagehide during BFCache verification cannot clear suspension',()=>{
  const h=harness();
  h.win.emit('pagehide');
  h.runtime.reconcile=()=>{
    h.win.emit('pagehide');
    return {ok:true,changed:false};
  };
  h.win.emit('pageshow',{persisted:true});
  assert.equal(h.bridge.suspended,true);
  assert.equal(h.runtime.blocked,true);
  assert.equal(h.runtime.reason,'LIFECYCLE_INVALIDATED');
  assert.equal(h.runtime.invalidations,2);
  h.bridge.detach();
});

test('P2.65ac reentrant visibility hide cannot be acknowledged as visible',()=>{
  const h=harness();
  h.doc.hidden=true;h.doc.emit('visibilitychange');
  h.doc.hidden=false;
  h.runtime.reconcile=()=>{
    h.doc.hidden=true;h.doc.emit('visibilitychange');
    return {ok:true,changed:false};
  };
  h.doc.emit('visibilitychange');
  assert.equal(h.bridge.suspended,true);
  assert.equal(h.runtime.reason,'LIFECYCLE_INVALIDATED');
  h.bridge.detach();
});

test('P2.65ac storage event during pagehide does not adopt until pageshow',()=>{
  const h=harness();
  h.win.emit('pagehide');
  h.win.emit('storage',{key:SAVE_KEY,storageArea:h.storage});
  assert.equal(h.reconciles,0);
  assert.equal(h.bridge.suspended,true);
  h.win.emit('pageshow',{persisted:true});
  assert.equal(h.reconciles,1);
  assert.equal(h.bridge.suspended,false);
  assert.equal(h.runtime.blocked,false);
  h.bridge.detach();
});

test('P2.65ac nested pagehide in focus verification cannot arm chooser recovery',()=>{
  const h=harness();
  h.runtime.reconcile=()=>{
    h.win.emit('pagehide');
    return {ok:true,changed:false};
  };
  h.win.emit('focus');
  assert.equal(h.focuses,0);
  assert.equal(h.bridge.suspended,true);
  assert.equal(h.runtime.reason,'LIFECYCLE_INVALIDATED');
  h.bridge.detach();
});
