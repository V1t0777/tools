import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,MAX_ENERGY,ENERGY_REGEN_MS,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {commitNormalActionWithLock,commitNormalClockWithLock} from '../merge/normal-action-transaction.mjs';
import {commitNormalResetWithLock} from '../merge/normal-reset-transaction.mjs';
import {coordinateNormalSaveRestore} from '../merge/save-restore-lock.mjs';

const at=1000;
const initial=()=>JSON.stringify(createInitialState(at));
const locks={request(name,options,callback){
  assert.equal(name,NORMAL_SAVE_LOCK_NAME);
  assert.equal(options.mode,'exclusive');
  return Promise.resolve(callback({name,mode:'exclusive'}));
}};
function storage(raw,{onRead=()=>{},onWrite=()=>{}}={}){
  const map=new Map([[SAVE_KEY,raw]]),writes=[];
  return {writes,map,
    getItem(key){const value=map.has(key)?map.get(key):null;onRead(key);return value;},
    setItem(key,value){writes.push([key,value]);map.set(key,value);onWrite(key);},
    read(key){return map.get(key)??null;}
  };
}

test('P2.65ae action read-triggered pagehide cannot write',async()=>{
  const raw=initial();let allowed=true;
  const db=storage(raw,{onRead:key=>{if(key===SAVE_KEY)allowed=false;}});
  const result=await commitNormalActionWithLock(locks,db,{expectedRaw:raw,
    action:s=>moveOrMerge(s,0,2),canCommit:()=>allowed});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'ACTION_CANCELLED_BEFORE_WRITE');
  assert.deepEqual(db.writes,[]);
});

test('P2.65ae action callback pagehide cannot commit result',async()=>{
  const raw=initial();let allowed=true;const db=storage(raw);
  const result=await commitNormalActionWithLock(locks,db,{expectedRaw:raw,
    action:s=>{allowed=false;return moveOrMerge(s,0,2);},canCommit:()=>allowed});
  assert.equal(result.ok,false);
  assert.deepEqual(db.writes,[]);
});

test('P2.65ae action final CAS read pagehide blocks setItem',async()=>{
  const raw=initial();let allowed=true,reads=0;
  const db=storage(raw,{onRead:key=>{if(key===SAVE_KEY&&++reads===2)allowed=false;}});
  const result=await commitNormalActionWithLock(locks,db,{expectedRaw:raw,
    action:s=>moveOrMerge(s,0,2),canCommit:()=>allowed});
  assert.equal(result.ok,false);
  assert.deepEqual(db.writes,[]);
  assert.equal(db.read(SAVE_KEY),raw);
});

test('P2.65ae clock final CAS read pagehide blocks energy write',async()=>{
  const state={...createInitialState(at),energy:MAX_ENERGY-1};
  const raw=JSON.stringify(state);let allowed=true,reads=0;
  const db=storage(raw,{onRead:key=>{if(key===SAVE_KEY&&++reads===2)allowed=false;}});
  const result=await commitNormalClockWithLock(locks,db,{expectedRaw:raw,
    now:at+ENERGY_REGEN_MS+1,canCommit:()=>allowed});
  assert.equal(result.ok,false);
  assert.deepEqual(db.writes,[]);
});

test('P2.65ae reset baseline read pagehide blocks reset',async()=>{
  const raw=initial();let allowed=true;
  const db=storage(raw,{onRead:key=>{if(key===SAVE_KEY)allowed=false;}});
  const result=await commitNormalResetWithLock(locks,db,{expectedRaw:raw,
    confirmedReset:true,now:at,canCommit:()=>allowed});
  assert.equal(result.ok,false);
  assert.deepEqual(db.writes,[]);
});

test('P2.65ae reset backup write pagehide preserves original and backup',async()=>{
  const raw='{broken';let allowed=true;
  const db=storage(raw,{onWrite:key=>{
    if(key===ABNORMAL_RESET_BACKUP_KEY)allowed=false;
  }});
  const result=await commitNormalResetWithLock(locks,db,{expectedRaw:raw,
    confirmedReset:true,now:at,canCommit:()=>allowed});
  assert.equal(result.ok,false);
  assert.equal(db.read(SAVE_KEY),raw);
  assert.equal(db.read(ABNORMAL_RESET_BACKUP_KEY),raw);
  assert.deepEqual(db.writes.map(([key])=>key),[ABNORMAL_RESET_BACKUP_KEY]);
});

test('P2.65ae restore preflight pagehide cannot reserve backup or write',async()=>{
  const raw=initial(),incoming=JSON.stringify({...createInitialState(at),revision:2});
  let allowed=true;
  const db=storage(raw,{onRead:key=>{if(key===SAVE_KEY)allowed=false;}});
  const result=await coordinateNormalSaveRestore(incoming,db,locks,{expectedRaw:raw,
    confirmed:true,canCommit:()=>allowed});
  assert.equal(result.ok,false);
  assert.deepEqual(db.writes,[]);
});

test('P2.65ae restore backup write pagehide cannot replace current save',async()=>{
  const raw=initial(),incoming=JSON.stringify({...createInitialState(at),revision:2});
  let allowed=true;
  const db=storage(raw,{onWrite:key=>{if(key===RESTORE_BACKUP_KEY)allowed=false;}});
  const result=await coordinateNormalSaveRestore(incoming,db,locks,{expectedRaw:raw,
    confirmed:true,canCommit:()=>allowed});
  assert.equal(result.ok,false);
  assert.equal(db.read(SAVE_KEY),raw);
  assert.equal(db.read(RESTORE_BACKUP_KEY),raw);
  assert.deepEqual(db.writes.map(([key])=>key),[RESTORE_BACKUP_KEY]);
});

test('P2.65ae invalidated async action still observes rejected thenable',async()=>{
  const raw=initial();let allowed=true,observed=false;
  const db=storage(raw);
  const result=await commitNormalActionWithLock(locks,db,{expectedRaw:raw,
    action:()=>{
      allowed=false;
      return {then(_resolve,reject){observed=true;reject(Error('late async rejection'));}};
    },canCommit:()=>allowed});
  assert.equal(result.ok,false);
  assert.equal(observed,true);
  assert.deepEqual(db.writes,[]);
});
