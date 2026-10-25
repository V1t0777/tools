import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY,validateStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function sharedStorage(){
  const map=new Map(),writes=[];
  return {map,writes,
    getItem(key){return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push(key);map.set(key,value);}
  };
}
function exclusiveLocks(){
  const tails=new Map(),calls=[];
  return {calls,request(name,options,callback){
    calls.push({name,mode:options.mode});
    const before=tails.get(name)??Promise.resolve();
    const pending=before.catch(()=>{}).then(callback);
    tails.set(name,pending.catch(()=>{}));
    return pending;
  }};
}
const fresh=()=>startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);

test('P24 two tabs completing different dialogue choices share one lock and reject stale progress',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks(),base=fresh();
  assert.equal(writeStorySave(storage,base,{expectedRaw:null}),true);
  storage.setItem(SAVE_KEY,'normal-preserved');
  storage.setItem(STORY_WORKSHOP_KEY,'workshop-preserved');
  const expectedRaw=storage.getItem(STORY_SAVE_KEY);
  const left=completeStoryEntry(base,CORE_STORY_PACK,'arrival','help');
  const right=completeStoryEntry(base,CORE_STORY_PACK,'arrival','ask');
  const results=await Promise.all([left,right].map(next=>saveStoryDialogueWithLock(locks,storage,next,{expectedRaw})));
  assert.deepEqual(results.map(x=>x.value),[true,false]);
  assert.ok(results.every(x=>x.ok&&x.mode==='web-lock'));
  assert.equal(storage.getItem(STORY_SAVE_KEY),JSON.stringify(left));
  assert.equal(storage.getItem(SAVE_KEY),'normal-preserved');
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),'workshop-preserved');
  assert.equal(storage.writes.filter(x=>x===STORY_SAVE_KEY).length,2);
  assert.equal(locks.calls[0].name,locks.calls[1].name);
  assert.ok(locks.calls.every(x=>x.mode==='exclusive'));
});
test('P24 a queued confirmed reset cannot erase a newly completed dialogue',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks(),base=fresh();
  assert.equal(writeStorySave(storage,base,{expectedRaw:null}),true);
  const expectedRaw=storage.getItem(STORY_SAVE_KEY);
  const next=completeStoryEntry(base,CORE_STORY_PACK,'arrival','help');
  const reset=fresh();reset.revision=base.revision+1;
  const [saved,cleared]=await Promise.all([
    saveStoryDialogueWithLock(locks,storage,next,{expectedRaw}),
    saveStoryDialogueWithLock(locks,storage,reset,{expectedRaw,confirmedReset:true})
  ]);
  assert.equal(saved.value,true);
  assert.equal(cleared.value,false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),JSON.stringify(next));
});
test('P24 confirmed reset wins first; queued dialogue completion cannot restore old progress',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks(),base=fresh();
  assert.equal(writeStorySave(storage,base,{expectedRaw:null}),true);
  const expectedRaw=storage.getItem(STORY_SAVE_KEY);
  const next=completeStoryEntry(base,CORE_STORY_PACK,'arrival','help');
  const reset=fresh();reset.revision=base.revision+1;
  const [cleared,saved]=await Promise.all([
    saveStoryDialogueWithLock(locks,storage,reset,{expectedRaw,confirmedReset:true}),
    saveStoryDialogueWithLock(locks,storage,next,{expectedRaw})
  ]);
  assert.equal(cleared.value,true);
  assert.equal(saved.value,false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),JSON.stringify(reset));
  assert.ok(reset.revision>base.revision,'reset advances revision to prevent ABA');
});
test('P24 first-time initialization is serialized and never overwrites a concurrent tab',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks();
  const initial=fresh();
  const results=await Promise.all([
    saveStoryDialogueWithLock(locks,storage,initial,{expectedRaw:null}),
    saveStoryDialogueWithLock(locks,storage,initial,{expectedRaw:null})
  ]);
  assert.deepEqual(results.map(x=>x.value),[true,false]);
  assert.equal(storage.writes.filter(x=>x===STORY_SAVE_KEY).length,1);
  assert.deepEqual(readStorySave(storage).progress,initial);
});
test('P24 confirmed corrupt reset is isolated; malformed/rejecting locks never silently downgrade',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks();
  storage.setItem(STORY_SAVE_KEY,'{corrupt');
  storage.setItem(SAVE_KEY,'normal');
  storage.setItem(STORY_WORKSHOP_KEY,'workshop');
  const reset=await saveStoryDialogueWithLock(locks,storage,fresh(),{expectedRaw:'{corrupt',confirmedReset:true});
  assert.equal(reset.value,true);
  assert.equal(validateStoryProgress(readStorySave(storage).progress),true);
  assert.equal(storage.getItem(SAVE_KEY),'normal');
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),'workshop');
  const expectedRaw=storage.getItem(STORY_SAVE_KEY);
  assert.equal((await saveStoryDialogueWithLock(locks,storage,fresh(),{expectedRaw,confirmedReset:true})).value,false,'same-revision reset cannot recreate an identical old snapshot');
  for(const bad of [{request:null},{request(){throw Error('blocked');}},{request(){return Promise.reject(Error('blocked'));}}]){
    assert.equal((await saveStoryDialogueWithLock(bad,storage,fresh(),{expectedRaw,confirmedReset:true})).ok,false);
    assert.equal(storage.getItem(STORY_SAVE_KEY),expectedRaw);
  }
  const nextReset=fresh();nextReset.revision=readStorySave(storage).progress.revision+1;
  assert.equal((await saveStoryDialogueWithLock(null,storage,nextReset,{expectedRaw,confirmedReset:true})).mode,'cas-fallback');
});
test('P24 invalidated page aborts a queued write before touching localStorage',async()=>{
  const storage=sharedStorage(),locks=exclusiveLocks();
  const base=fresh();assert.equal(writeStorySave(storage,base,{expectedRaw:null}),true);
  const expectedRaw=storage.getItem(STORY_SAVE_KEY);
  const next=completeStoryEntry(base,CORE_STORY_PACK,'arrival','help');
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const name='toolbox.merge-isle.story.write.'+STORY_SAVE_KEY;
  const blocker=locks.request(name,{mode:'exclusive'},()=>gate);
  let current=true;
  const queued=saveStoryDialogueWithLock(locks,storage,next,{expectedRaw,isCurrent:()=>current});
  current=false;release();await blocker;
  assert.equal((await queued).value,false);
  assert.equal(storage.getItem(STORY_SAVE_KEY),expectedRaw);
  assert.equal(storage.writes.filter(x=>x===STORY_SAVE_KEY).length,1);
  assert.equal((await saveStoryDialogueWithLock(locks,storage,next,{expectedRaw:undefined})).ok,false);
});
test('P24 dialogue UI gates choices and reset while pending and uses lock for all three save paths',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {saveStoryDialogueWithLock} from './dialogue-write.mjs';"));
  assert.ok(ui.includes('let saving=false,storageEpoch=0;'));
  assert.ok(ui.includes('async function save(next,reset=false,commitGuard=()=>true){'));
  assert.ok(ui.includes('if(saving)return false;'));
  assert.ok(ui.includes('saveStoryDialogueWithLock(webLocks,store,next,{'));
  assert.ok(ui.includes('expectedRaw,confirmedReset:reset,commitGuard'));
  assert.ok(ui.includes('isCurrent:()=>storageEpoch===expectedEpoch&&(!blocked||reset)'));
  assert.ok(ui.includes('void save(next);'),'first-time initialization');
  assert.ok(ui.includes('if(await save(next,false,commitGuard))'),'completed dialogue with cross-save guard');
  assert.ok(ui.includes('await save(next,true);'),'confirmed reset');
  assert.ok(ui.includes('next.revision=current.progress.revision+1;'),'ABA-safe reset revision');
  assert.ok(ui.includes("window.confirm('确认重置此浏览器的剧情进度吗"));
  assert.ok(ui.includes('storageEpoch++;blocked=true;'));
  assert.ok(ui.includes("$('reset-story').disabled=saving||"));
  assert.ok(ui.includes('button.disabled=saving;'));
  for(const forbidden of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem'])
    assert.equal(ui.includes(forbidden),false,forbidden);
  assert.equal(/\\bSAVE_KEY\\b/.test(ui),false,'normal-mode save key must not appear');
});
