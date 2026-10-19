import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinatedCloudQueue, cloudQueueLockName } from '../merge/cloud/tab-coordinator.mjs';
import { createInMemoryAuthority } from '../merge/cloud/authority.mjs';
import { queueStorageKey } from '../merge/cloud/offline-queue.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const makeStorage=()=>{const data=new Map();return {
  getItem:k=>data.get(k)??null, setItem:(k,v)=>data.set(k,v), raw:data
};};
function makeLocks(){const lanes=new Map();let highest=0;let active=0;
  return {get maxConcurrent(){return highest},async request(name,options,callback){
    assert.equal(options.mode,'exclusive');
    const previous=lanes.get(name)??Promise.resolve();
    let release;const current=new Promise(resolve=>{release=resolve;});
    lanes.set(name,current);
    await previous;
    active++;highest=Math.max(highest,active);
    try {return await callback();}
    finally {active--;release();if(lanes.get(name)===current)lanes.delete(name);}
  }};
}
function setup(){const storage=makeStorage(),locks=makeLocks();
  const auth=createInMemoryAuthority({clock:()=>1_000_000,rng:()=>0.9});
  const transport={read:()=>auth.read(uid),execute:cmd=>auth.execute(uid,cmd)};
  const factory=(seed,extras={})=>{let id=seed;return createCoordinatedCloudQueue({uid,storage,locks,transport,
    clock:()=>1_000_000, makeId:()=>`00000000-0000-4000-8000-${(id++).toString(16).padStart(12,'0')}`,...extras});};
  return {storage,locks,auth,transport,factory};
}

test('simultaneous cross-tab enqueues are not lost, even when same origin storage shares a key',async()=>{
  const {factory,storage,locks}=setup(),a=factory(1),b=factory(100);
  const out=await Promise.all(Array.from({length:32},(_,i)=>(i%2?a:b).enqueue({type:'produce',slot:42})));
  assert.equal(out.filter(x=>x.ok).length,32);
  const saved=JSON.parse(storage.getItem(queueStorageKey(uid)));
  assert.equal(saved.pending.length,32);
  assert.equal(new Set(saved.pending.map(x=>x.operationId)).size,32);
  assert.equal((await b.enqueue({type:'produce',slot:42})).code,'QUEUE_FULL');
  assert.equal(locks.maxConcurrent,1);
});

test('two simultaneous tab flushes cannot spend energy twice or duplicate rewards',async()=>{
  const {factory,auth,locks}=setup(),a=factory(1),b=factory(100);
  for(let i=0;i<4;i++)assert.equal((await a.enqueue({type:'produce',slot:42})).ok,true);
  const [left,right]=await Promise.all([a.flush(),b.flush()]);
  assert.equal(left.ok,true);assert.equal(right.ok,true);
  const remote=await auth.read(uid);
  assert.equal(remote.revision,4);assert.equal(remote.state.energy,76);
  assert.equal(a.preview().pending,0);assert.equal(b.preview().pending,0);
  assert.equal(locks.maxConcurrent,1);
});

test('adding an operation in a second tab while first tab is mid-flight preserves both',async()=>{
  const {factory,storage,transport,auth,locks}=setup(),a=factory(1);
  let started;const sent=new Promise(resolve=>{started=resolve});
  let release;const gate=new Promise(resolve=>{release=resolve});
  const slow={read:transport.read, execute:async command=>{started();await gate;return transport.execute(command)}};
  const slowTab=factory(100,{transport:slow}), fastTab=factory(200);
  assert.equal((await a.enqueue({type:'produce',slot:42})).ok,true);
  const flush=slowTab.flush();await sent;
  let secondCompleted=false;
  const waiting=fastTab.enqueue({type:'produce',slot:44}).then(r=>{secondCompleted=true;return r});
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(secondCompleted,false,'another tab cannot write during the locked network operation');
  release();assert.equal((await flush).ok,true);
  assert.equal((await waiting).ok,true);
  assert.equal(JSON.parse(storage.getItem(queueStorageKey(uid))).pending.length,1);
  assert.equal((await fastTab.flush()).ok,true);
  assert.equal((await auth.read(uid)).revision,2);
  assert.equal(locks.maxConcurrent,1);
});

test('a newly opened tab rereads the journal and does not trust an unverified remote cache',async()=>{
  const {factory}=setup(),a=factory(1);
  assert.equal((await a.connect()).verified,true);
  assert.equal(a.preview().verified,true);
  const reopened=factory(100);
  assert.equal(reopened.preview().verified,false);
  assert.equal((await reopened.connect()).verified,true);
});

test('same tab loses verified flag after another tab confirms a newer revision',async()=>{
  const {factory}=setup(),a=factory(1),b=factory(100);
  await a.connect();assert.equal(a.preview().verified,true);
  await b.enqueue({type:'produce',slot:42});
  await b.flush();
  assert.equal(a.preview().revision,1);
  assert.equal(a.preview().verified,false);
});

test('coordinator refuses all cloud actions when Web Locks API unavailable',async()=>{
  const {storage,transport}=setup();let network=0;
  const q=createCoordinatedCloudQueue({uid,storage,locks:null,
    transport:{read:()=>{network++;return transport.read()},execute:()=>{network++;throw Error('unexpected')}}});
  assert.equal(q.preview().lockAvailable,false);
  for(const result of [await q.enqueue({type:'produce',slot:42}),await q.connect(),await q.flush(),
    await q.discardUnsent(),await q.discardConflicted({confirmedByUser:true})])
    assert.equal(result.code,'MULTITAB_LOCK_UNAVAILABLE');
  assert.equal(network,0);assert.equal(storage.getItem(queueStorageKey(uid)),null);
});

test('cross-account coordinator keys remain distinct',()=>{
  assert.notEqual(cloudQueueLockName(uid),cloudQueueLockName(other));
  assert.ok(cloudQueueLockName(uid).includes(queueStorageKey(uid)));
});

test('storage corruption remains fail-closed rather than silently replacing pending commands',async()=>{
  const {factory,storage}=setup();storage.setItem(queueStorageKey(uid),'{garbage');
  const tab=factory(1);
  assert.equal((await tab.enqueue({type:'produce',slot:42})).code,'STORAGE_ERROR');
  assert.equal(storage.getItem(queueStorageKey(uid)),'{garbage');
});

test('two tab cancellation attempts serialize and do not unexpectedly erase later entry',async()=>{
  const {factory}=setup(),a=factory(1),b=factory(100);
  await a.enqueue({type:'produce',slot:42});
  const [cancel,newEntry]=await Promise.all([a.discardUnsent(),b.enqueue({type:'produce',slot:44})]);
  assert.equal(cancel.ok,true);assert.equal(newEntry.ok,true);
  assert.equal(a.preview().pending,1);
});
test('same-revision remote refresh in another tab invalidates the old verified snapshot',async()=>{
  const {factory,transport}=setup(),first=factory(1);
  assert.equal((await first.connect()).ok,true);
  assert.equal(first.preview().verified,true);
  const other=factory(100,{transport:{
    read:async()=>{
      const fresh=await transport.read();
      return {...fresh,state:{...fresh.state,coins:fresh.state.coins+1}};
    },
    execute:transport.execute
  }});
  assert.equal((await other.connect()).ok,true);
  assert.equal(other.preview().verified,true);
  assert.equal(other.preview().revision,first.preview().revision);
  assert.equal(first.preview().verified,false,'equal revisions do not prove equal game state');
});

test('same-revision local journal edit cannot retain a remote verification badge',async()=>{
  const {factory,storage}=setup(),tab=factory(1);
  await tab.connect();
  const key=queueStorageKey(uid),journal=JSON.parse(storage.getItem(key));
  const revision=journal.confirmed.revision;
  journal.confirmed.state.coins++;
  storage.setItem(key,JSON.stringify(journal));
  assert.equal(tab.preview().revision,revision);
  assert.equal(tab.preview().verified,false);
});

test('failed remote re-verification revokes the old proof and shows offline status',async()=>{
  const {factory,transport}=setup();
  let offline=false;
  const tab=factory(1,{transport:{
    read:()=>offline ? Promise.reject(Error('disconnected')) : transport.read(),
    execute:transport.execute
  }});
  assert.equal((await tab.connect()).ok,true);
  assert.equal(tab.preview().verified,true);
  offline=true;
  assert.equal((await tab.connect()).code,'NETWORK_UNAVAILABLE');
  assert.equal(tab.preview().verified,false);
  assert.equal(tab.preview().phase,'offline');
});

test('lock request failure revokes prior verified state and exposes blocking status',async()=>{
  const {factory,locks}=setup();
  let deny=false;
  const tab=factory(1,{locks:{
    request:(...args)=>deny ? Promise.reject(Error('lock denied')) : locks.request(...args)
  }});
  assert.equal((await tab.connect()).ok,true);
  assert.equal(tab.preview().verified,true);
  deny=true;
  assert.equal((await tab.connect()).code,'LOCK_REQUEST_FAILED');
  assert.equal(tab.preview().verified,false);
  assert.equal(tab.preview().code,'LOCK_REQUEST_FAILED');
  assert.equal(tab.preview().phase,'blocked');
});

test('in-flight remote validation never retains an earlier synced proof',async()=>{
  const {factory,transport}=setup();
  let delayed=false,release,signal;
  const entered=new Promise(resolve=>{signal=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const tab=factory(1,{transport:{
    read:async()=>{if(delayed){signal();await gate;}return transport.read();},
    execute:transport.execute
  }});
  assert.equal((await tab.connect()).ok,true);
  assert.equal(tab.preview().verified,true);
  delayed=true;
  const pending=tab.connect();
  await entered;
  assert.equal(tab.preview().verified,false);
  release();
  assert.equal((await pending).ok,true);
  assert.equal(tab.preview().verified,true);
});

test('successful second server read with unchanged snapshot restores verification',async()=>{
  const {factory}=setup(),tab=factory(1);
  assert.equal((await tab.connect()).ok,true);
  assert.equal(tab.preview().verified,true);
  assert.equal((await tab.connect()).ok,true);
  assert.equal(tab.preview().verified,true);
});

test('new journal corruption overrides a previous offline status with a storage warning',async()=>{
  const {factory,storage,transport}=setup();
  let offline=false;
  const tab=factory(1,{transport:{
    read:()=>offline ? Promise.reject(Error('network lost')) : transport.read(),
    execute:transport.execute
  }});
  assert.equal((await tab.connect()).ok,true);
  offline=true;
  assert.equal((await tab.connect()).code,'NETWORK_UNAVAILABLE');
  assert.equal(tab.preview().phase,'offline');
  storage.setItem(queueStorageKey(uid),'{corrupt');
  assert.equal(tab.preview().phase,'storage-error');
  assert.equal(tab.preview().code,undefined);
  assert.equal(tab.preview().verified,false);
});

test('new journal corruption overrides a previous lock failure',async()=>{
  const {factory,storage,locks}=setup();
  let deny=false;
  const tab=factory(1,{locks:{
    request:(...args)=>deny ? Promise.reject(Error('lock denied')) : locks.request(...args)
  }});
  assert.equal((await tab.connect()).ok,true);
  deny=true;
  assert.equal((await tab.connect()).code,'LOCK_REQUEST_FAILED');
  storage.setItem(queueStorageKey(uid),'{corrupt');
  assert.equal(tab.preview().phase,'storage-error');
  assert.equal(tab.preview().code,undefined);
  assert.equal(tab.preview().verified,false);
});
