import test from 'node:test';
import assert from 'node:assert/strict';
import {openNormalPersistence,NORMAL_IDB_MARKER,NORMAL_IDB_MODE}
  from '../merge/normal-indexeddb-persistence.mjs';
import {withNormalSaveLock,NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
const legacy=()=>{
  const m=new Map();
  return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),values:m};
};
test('native-Web-Locks normal tab cannot write after another tab migrates to IDB',async()=>{
  const storage=legacy(),events=[];
  const nativeLocks={request(name,options,callback){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.equal(options.mode,'exclusive');
    events.push('acquired');
    return Promise.resolve(callback({name,mode:'exclusive'}));
  }};
  const p=await openNormalPersistence({legacyStorage:storage,
    nativeLocks,indexedDB:null});
  assert.equal(p.backend,'legacy');
  assert.equal((await withNormalSaveLock(p.locks,()=>{
    events.push('wrote');return {ok:true};
  })).ok,true);
  storage.setItem(NORMAL_IDB_MARKER,NORMAL_IDB_MODE);
  const denied=await withNormalSaveLock(p.locks,()=>{
    events.push('unsafe-write');return {ok:true};
  });
  assert.equal(denied.ok,false);
  assert.equal(events.includes('unsafe-write'),false);
});
test('cloud preview source stays excluded from production build allowlists',async()=>{
  const {readFileSync}=await import('node:fs');
  const publicBuild=readFileSync(new URL('../scripts/build-public.sh',import.meta.url),'utf8');
  const secureBuild=readFileSync(new URL('../cloudflare-secure/build.sh',import.meta.url),'utf8');
  for(const build of [publicBuild,secureBuild]){
    assert.doesNotMatch(build,/cp\s+merge\/cloud-preview/);
    assert.doesNotMatch(build,/cp\s+-R\s+merge\/cloud-preview/);
  }
});
