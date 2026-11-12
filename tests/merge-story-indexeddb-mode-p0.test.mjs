import test from 'node:test';
import assert from 'node:assert/strict';
import {openStoryPersistence,STORY_IDB_MARKER,STORY_IDB_MODE} from '../merge/story/indexeddb-persistence.mjs';
import {runStoryWriteWithLock} from '../merge/story/write-lock.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function fakeStorage(marker=null){
  const map=new Map([[SAVE_KEY,'normal-preserved'],[STORY_SAVE_KEY,'story-preserved'],[STORY_WORKSHOP_KEY,'workshop-preserved']]);
  if(marker!==null)map.set(STORY_IDB_MARKER,marker);
  let writes=0;
  const storage={
    getItem:k=>map.has(k)?map.get(k):null,
    setItem(k,v){writes++;map.set(k,v);}
  };
  return {map,storage,count:()=>writes};
}
const nativeLocks={request:async(_name,_options,callback)=>callback()};
test('P0 legacy Web Locks pathway is unchanged before IndexedDB migration',async()=>{
  const f=fakeStorage();
  const backend=await openStoryPersistence({legacyStorage:f.storage,nativeLocks,indexedDB:null});
  assert.equal(backend.backend,'legacy');
  assert.equal(backend.storage,f.storage);
  assert.equal(backend.locks,nativeLocks);
  assert.equal(f.count(),0);
});
test('P0 migrated origin with unavailable IndexedDB never falls back to legacy writes',async()=>{
  const f=fakeStorage(STORY_IDB_MODE);
  const backend=await openStoryPersistence({legacyStorage:f.storage,nativeLocks,indexedDB:null});
  assert.equal(backend.backend,'read-only');
  assert.equal(backend.locks,null);
  assert.equal(f.count(),0);
});
test('P0 older open native-lock tab cannot write after IndexedDB migration marker appears',async()=>{
  const f=fakeStorage(STORY_IDB_MODE),original=globalThis.window;
  globalThis.window={localStorage:f.storage};
  let executed=0;
  try{
    const outcome=await runStoryWriteWithLock(nativeLocks,STORY_SAVE_KEY,()=>{
      executed++;f.storage.setItem(STORY_SAVE_KEY,'overwrite');return true;
    });
    assert.deepEqual(outcome,{ok:true,mode:'web-lock',value:false});
    assert.equal(executed,0);assert.equal(f.count(),0);
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-preserved');
    assert.equal(f.map.get(STORY_WORKSHOP_KEY),'workshop-preserved');
    assert.equal(f.map.get(SAVE_KEY),'normal-preserved');
  }finally{globalThis.window=original;}
});
test('P0 unknown migration marker remains fail-closed rather than guessing a source of truth',async()=>{
  const f=fakeStorage('unexpected-data');
  const backend=await openStoryPersistence({legacyStorage:f.storage,nativeLocks,indexedDB:{}});
  assert.equal(backend.backend,'read-only');
  assert.equal(backend.locks,null);
});
