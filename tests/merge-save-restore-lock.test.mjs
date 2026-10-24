import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {RESTORE_LOCK_NAME,coordinateNormalSaveRestore as restore} from '../merge/save-restore-lock.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';

const raw=revision=>JSON.stringify({...createInitialState(1_000_000),revision});
function storage(normal=null,story=null){
  const map=new Map(),writes=[];
  if(normal!==null)map.set(SAVE_KEY,normal);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,
    getItem:key=>map.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);map.set(key,value);},
    read:key=>map.get(key)??null};
}
function locks(){
  return {active:false,calls:[],
    request(name,options,callback){
      this.calls.push({name,options});
      assert.equal(name,RESTORE_LOCK_NAME);
      assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
      if(this.active)return Promise.resolve(callback(null));
      this.active=true;
      try{
        return Promise.resolve(callback({name,mode:'exclusive'}))
          .finally(()=>{this.active=false;});
      }catch(error){
        this.active=false;
        return Promise.reject(error);
      }
    }
  };
}

test('missing user confirmation and unsupported Web Locks fail without writes',async()=>{
  const current=raw(3),db=storage(current),manager=locks();
  assert.deepEqual(await restore(raw(4),db,manager,{expectedRaw:current}),
    {ok:false,reason:'CONFIRMATION_REQUIRED'});
  assert.equal(manager.calls.length,0);
  assert.deepEqual(await restore(raw(4),db,null,{expectedRaw:current,confirmed:true}),
    {ok:false,reason:'LOCKS_UNAVAILABLE'});
  assert.equal(db.read(SAVE_KEY),current);
  assert.deepEqual(db.writes,[]);
});

test('exclusive lock executes P2.20 backup, exact restore, readback and story isolation',async()=>{
  const current=raw(3),file=raw(5);
  const story=JSON.stringify(createEmptyStoryProgress());
  const db=storage(current,story),manager=locks();
  const result=await restore(file,db,manager,{expectedRaw:current,confirmed:true});
  assert.equal(result.ok,true);
  assert.equal(result.status,'RESTORE_VERIFIED');
  assert.equal(result.verifiedReadback,true);
  assert.equal(db.read(SAVE_KEY),file);
  assert.equal(db.read(RESTORE_BACKUP_KEY),current);
  assert.equal(db.read(STORY_SAVE_KEY),story);
  assert.deepEqual(db.writes,[[RESTORE_BACKUP_KEY,current],[SAVE_KEY,file]]);
  assert.equal(manager.calls.length,1);
});

test('second simultaneous restore is refused as busy rather than queued',async()=>{
  const current=raw(1),db=storage(current),manager=locks();
  const first=restore(raw(3),db,manager,{expectedRaw:current,confirmed:true});
  const second=restore(raw(4),db,manager,{expectedRaw:current,confirmed:true});
  assert.deepEqual(await second,{ok:false,reason:'LOCK_BUSY'});
  assert.equal((await first).ok,true);
  assert.equal(db.read(SAVE_KEY),raw(3));
  assert.deepEqual(db.writes.map(([key])=>key),[RESTORE_BACKUP_KEY,SAVE_KEY]);
});

test('lock acquired after noncooperating tab update still fails on fresh CAS',async()=>{
  const original=raw(1),later=raw(2),db=storage(original);
  const manager={request(name,options,callback){
    db.map.set(SAVE_KEY,later);
    return callback({name,mode:'exclusive'});
  }};
  assert.deepEqual(await restore(raw(3),db,manager,{expectedRaw:original,confirmed:true}),
    {ok:false,reason:'CURRENT_SAVE_CHANGED'});
  assert.equal(db.read(SAVE_KEY),later);
  assert.deepEqual(db.writes,[]);
});

test('denied or malformed exclusive lock cannot execute restore',async()=>{
  const original=raw(1),db=storage(original);
  for(const manager of [
    {request:(name,options,callback)=>callback(null)},
    {request:(name,options,callback)=>callback({name,mode:'shared'})},
    {request:(name,options,callback)=>callback({name:'unrelated',mode:'exclusive'})}
  ]){
    const result=await restore(raw(2),db,manager,
      {expectedRaw:original,confirmed:true});
    assert.equal(result.ok,false);
    assert.ok(['LOCK_BUSY','LOCK_INVALID'].includes(result.reason));
  }
  assert.deepEqual(db.writes,[]);
});

test('request exception before acquisition is a safe failure',async()=>{
  const old=raw(1),db=storage(old);
  const manager={request(){throw Error('unsupported');}};
  assert.deepEqual(await restore(raw(2),db,manager,{expectedRaw:old,confirmed:true}),
    {ok:false,reason:'LOCK_FAILED'});
  assert.deepEqual(db.writes,[]);
});

test('lock provider failure after restore reports uncertain outcome, never false rollback',async()=>{
  const old=raw(1),db=storage(old);
  const manager={async request(name,options,callback){
    await callback({name,mode:'exclusive'});
    throw Error('lock provider failed after callback');
  }};
  const result=await restore(raw(2),db,manager,{expectedRaw:old,confirmed:true});
  assert.deepEqual(result,{ok:false,reason:'RESTORE_OUTCOME_UNCERTAIN'});
  assert.equal(db.read(SAVE_KEY),raw(2));
  assert.equal(db.read(RESTORE_BACKUP_KEY),old);
});

test('locking adapter stays unconnected to player UI and has no unlocked fallback',()=>{
  const source=readFileSync(new URL('../merge/save-restore-lock.mjs',import.meta.url),'utf8');
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const html=readFileSync(new URL('../merge/index.html',import.meta.url),'utf8');
  for(const forbidden of ['fetch(','localStorage.','setItem(','removeItem(','window.','document.','XMLHttpRequest'])
    assert.equal(source.includes(forbidden),false,forbidden);
  assert.equal(main.includes("from './save-restore-lock.mjs'"),false);
  assert.equal(html.includes('id="import-local-save"'),false);
});
