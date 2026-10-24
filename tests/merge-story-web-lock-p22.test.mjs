import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runStoryWriteWithLock} from '../merge/story/write-lock.mjs';
import {STORY_WORKSHOP_KEY,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {createInitialState,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function sharedStorage(){
  const map=new Map(),writes=[];
  return {
    map,writes,
    getItem(key){return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push(key);map.set(key,value);}
  };
}
function exclusiveLocks(){
  const tails=new Map(),calls=[];
  return {
    calls,
    request(name,options,callback){
      calls.push({name,mode:options.mode});
      const before=tails.get(name)??Promise.resolve();
      const current=before.catch(()=>{}).then(callback);
      tails.set(name,current.catch(()=>{}));
      return current;
    }
  };
}
test('P22 two participating tabs serialize workshop writes and stale tab loses safely',async()=>{
  const store=sharedStorage(),locks=exclusiveLocks();
  const initial=createInitialState(1000000);
  assert.equal(writeStoryWorkshop(store,initial,{expectedRaw:null}),true);
  const snapshot=store.getItem(STORY_WORKSHOP_KEY);
  const left=moveOrMerge(initial,0,2);
  const right=moveOrMerge(initial,0,3);
  assert.equal(left.ok,true);assert.equal(right.ok,true);
  const actions=[left,right].map(action=>runStoryWriteWithLock(locks,STORY_WORKSHOP_KEY,
    ()=>writeStoryWorkshop(store,action.state,{expectedRaw:snapshot})));
  const results=await Promise.all(actions);
  assert.deepEqual(results.map(x=>x.ok),[true,true]);
  assert.deepEqual(results.map(x=>x.mode),['web-lock','web-lock']);
  assert.deepEqual(results.map(x=>x.value),[true,false]);
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),JSON.stringify(left.state));
  assert.equal(store.writes.filter(key=>key===STORY_WORKSHOP_KEY).length,2,'one initialization plus one action');
  assert.equal(store.map.has(SAVE_KEY),false);
  assert.equal(store.map.has(STORY_SAVE_KEY),false);
  assert.equal(locks.calls[0].name,locks.calls[1].name);
  assert.ok(locks.calls.every(call=>call.mode==='exclusive'));
});
test('P22 absent Web Locks uses the existing CAS writer and returns an explicit fallback mode',async()=>{
  const store=sharedStorage(),state=createInitialState(1000000);
  const result=await runStoryWriteWithLock(undefined,STORY_WORKSHOP_KEY,
    ()=>writeStoryWorkshop(store,state,{expectedRaw:null}));
  assert.deepEqual(result,{ok:true,mode:'cas-fallback',value:true});
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),JSON.stringify(state));
});
test('P22 malformed/rejecting Web Locks fail closed, never retry writes outside the lock',async()=>{
  let writes=0;
  for(const locks of [{request:null},{request(){throw Error('blocked');}},{request(){return Promise.reject(Error('denied'));}}]){
    const result=await runStoryWriteWithLock(locks,STORY_WORKSHOP_KEY,()=>{writes++;return true;});
    assert.deepEqual(result,{ok:false,mode:'lock-error',value:false});
  }
  assert.equal(writes,0);
});
test('P22 only the two story keys can acquire locks; callback errors are not retried',async()=>{
  let calls=0;
  const locks=exclusiveLocks();
  const invalid=await runStoryWriteWithLock(locks,SAVE_KEY,()=>{calls++;return true;});
  assert.deepEqual(invalid,{ok:false,mode:'invalid',value:false});
  assert.equal(locks.calls.length,0);
  const rejected=await runStoryWriteWithLock(locks,STORY_SAVE_KEY,()=>{calls++;throw Error('write failed');});
  assert.deepEqual(rejected,{ok:false,mode:'lock-error',value:false});
  assert.equal(calls,1);
});
test('P22 workshop UI disables actions while waiting, and retains exact-raw CAS',()=>{
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {runStoryWriteWithLock} from './write-lock.mjs';"));
  assert.ok(ui.includes('let saving=false;'));
  assert.ok(ui.includes('async function commit(result){'));
  assert.ok(ui.includes('if(blocked||saving)return;'));
  assert.ok(ui.includes('saving=true;render();'));
  assert.ok(ui.includes('runStoryWriteWithLock(webLocks,STORY_WORKSHOP_KEY,'));
  assert.ok(ui.includes('()=>!blocked&&writeStoryWorkshop(storage,result.state,{expectedRaw})'));
  assert.ok(ui.includes('saving=false;'));
  assert.ok(ui.includes("if(!attempt.ok||attempt.value!==true||blocked)"));
  assert.ok(ui.includes("$('reset-workshop').disabled=saving||"));
  assert.ok(ui.includes("if(saving)return;"));
  for(const forbidden of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem','SAVE_KEY'])
    assert.equal(ui.includes(forbidden),false,forbidden);
});
