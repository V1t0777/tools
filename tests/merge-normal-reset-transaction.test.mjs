import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {commitNormalResetWithLock} from '../merge/normal-reset-transaction.mjs';

function memory(raw=null,backup=null,story=null) {
  const map=new Map(),writes=[];
  if(raw!==null)map.set(SAVE_KEY,raw);
  if(backup!==null)map.set(ABNORMAL_RESET_BACKUP_KEY,backup);
  if(story!==null)map.set(STORY_SAVE_KEY,story);
  return {map,writes,
    getItem(key){return map.has(key)?map.get(key):null;},
    setItem(key,value){writes.push([key,value]);map.set(key,value);},
    read(key){return map.has(key)?map.get(key):null;}};
}
function locks() {
  let held=false;
  return {request(name,options,callback){
    assert.equal(options.mode,'exclusive');
    assert.equal(options.ifAvailable,true);
    if(held)return Promise.resolve(callback(null));
    held=true;
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}))
      .finally(()=>{held=false;});
  }};
}
const at=1000;
const valid=()=>JSON.stringify(createInitialState(at));

test('P2.48 refuses unconfirmed reset before requesting any lock',async()=>{
  const raw=valid(),db=memory(raw);
  let requested=0;
  const lock={request(){requested++;throw Error('should not request');}};
  assert.deepEqual(await commitNormalResetWithLock(lock,db,
    {expectedRaw:raw,now:at}),{ok:false,reason:'RESET_NOT_CONFIRMED'});
  assert.equal(requested,0);
  assert.deepEqual(db.writes,[]);
});

test('P2.48 verified reset of valid save uses one locked save write',async()=>{
  const raw=valid(),db=memory(raw);
  const result=await commitNormalResetWithLock(locks(),db,
    {expectedRaw:raw,confirmedReset:true,now:at+100});
  assert.equal(result.ok,true);
  assert.equal(result.verifiedReadback,true);
  assert.equal(result.backupVerified,false);
  assert.equal(result.backupCreated,false);
  assert.equal(result.state.revision,0);
  assert.equal(result.state.energyAt,at+100);
  assert.deepEqual(db.writes,[[SAVE_KEY,result.raw]]);
  assert.equal(db.read(SAVE_KEY),JSON.stringify(result.state));
});

test('P2.48 damaged original is backed up and verified before reset, story untouched',async()=>{
  const raw='{broken',story='story-bytes-unchanged',db=memory(raw,null,story);
  const result=await commitNormalResetWithLock(locks(),db,
    {expectedRaw:raw,confirmedReset:true,now:at});
  assert.equal(result.ok,true);
  assert.equal(result.backupVerified,true);
  assert.equal(result.backupCreated,true);
  assert.deepEqual(db.writes.map(([key])=>key),
    [ABNORMAL_RESET_BACKUP_KEY,SAVE_KEY]);
  assert.equal(db.read(ABNORMAL_RESET_BACKUP_KEY),raw);
  assert.equal(db.read(STORY_SAVE_KEY),story);
  assert.equal(db.writes.some(([key])=>key===STORY_SAVE_KEY),false);
});

test('P2.48 caller can demand original backup for valid but uncertain save',async()=>{
  const raw=valid(),db=memory(raw);
  const result=await commitNormalResetWithLock(locks(),db,
    {expectedRaw:raw,confirmedReset:true,requireOriginalBackup:true,now:at});
  assert.equal(result.ok,true);
  assert.equal(result.backupVerified,true);
  assert.equal(db.read(ABNORMAL_RESET_BACKUP_KEY),raw);
});

test('P2.48 stale baseline refuses backup and reset',async()=>{
  const raw=valid(),db=memory(raw);
  assert.deepEqual(await commitNormalResetWithLock(locks(),db,
    {expectedRaw:raw+' ',confirmedReset:true,now:at}),
    {ok:false,reason:'STALE_BASELINE'});
  assert.deepEqual(db.writes,[]);
  assert.equal(db.read(SAVE_KEY),raw);
});

test('P2.48 conflicting backup slot prevents damaged-save reset',async()=>{
  const raw='{broken',db=memory(raw,'previous-original');
  assert.deepEqual(await commitNormalResetWithLock(locks(),db,
    {expectedRaw:raw,confirmedReset:true,now:at}),
    {ok:false,reason:'BACKUP_SLOT_CONFLICT'});
  assert.deepEqual(db.writes,[]);
  assert.equal(db.read(SAVE_KEY),raw);
});

test('P2.48 failed backup readback never authorizes reset',async()=>{
  const raw='{broken';
  let saveWrites=0;
  const db={getItem:key=>key===SAVE_KEY?raw:null,
    setItem(key){if(key===SAVE_KEY)saveWrites++;}};
  assert.deepEqual(await commitNormalResetWithLock(locks(),db,
    {expectedRaw:raw,confirmedReset:true,now:at}),
    {ok:false,reason:'BACKUP_VERIFY_FAILED'});
  assert.equal(saveWrites,0);
});

test('P2.48 missing Web Locks and busy lock never write',async()=>{
  const raw=valid(),db=memory(raw),args={
    expectedRaw:raw,confirmedReset:true,now:at};
  assert.deepEqual(await commitNormalResetWithLock(null,db,args),
    {ok:false,reason:'WEB_LOCKS_UNAVAILABLE'});
  assert.deepEqual(await commitNormalResetWithLock({
    request:(_name,_options,cb)=>cb(null)},db,args),
    {ok:false,reason:'SAVE_LOCK_BUSY'});
  assert.deepEqual(db.writes,[]);
});

test('P2.48 missing original may initialize only without required backup',async()=>{
  const db=memory();
  assert.deepEqual(await commitNormalResetWithLock(locks(),db,
    {expectedRaw:null,confirmedReset:true,requireOriginalBackup:true,now:at}),
    {ok:false,reason:'NO_ORIGINAL_TO_BACKUP'});
  assert.deepEqual(db.writes,[]);
  const result=await commitNormalResetWithLock(locks(),db,
    {expectedRaw:null,confirmedReset:true,now:at});
  assert.equal(result.ok,true);
  assert.equal(db.read(SAVE_KEY),result.raw);
  assert.equal(db.writes.length,1);
});

test('P2.48 uncertain save readback never publishes reset state',async()=>{
  const raw=valid();
  let wrote=false;
  const db={getItem:key=>key===SAVE_KEY?(wrote?'tampered':raw):null,
    setItem(key){if(key===SAVE_KEY)wrote=true;}};
  const result=await commitNormalResetWithLock(locks(),db,
    {expectedRaw:raw,confirmedReset:true,now:at});
  assert.deepEqual(result,{ok:false,reason:'SAVE_VERIFY_FAILED'});
  assert.equal('state' in result,false);
  assert.equal(wrote,true);
});

test('P2.48 invalid clock and policy fail before any write',async()=>{
  const raw=valid(),db=memory(raw);
  assert.deepEqual(await commitNormalResetWithLock(locks(),db,
    {expectedRaw:raw,confirmedReset:true,now:NaN}),
    {ok:false,reason:'INVALID_CLOCK'});
  assert.deepEqual(await commitNormalResetWithLock(locks(),db,
    {expectedRaw:raw,confirmedReset:true,requireOriginalBackup:'yes',now:at}),
    {ok:false,reason:'INVALID_BACKUP_POLICY'});
  assert.deepEqual(db.writes,[]);
});


test('P2.65r invalidated reset confirmation cannot reserve backup or write',async()=>{
  const raw='{broken',db=memory(raw);
  for(const canCommit of [()=>false,()=>{throw Error('pagehide');}]){
    assert.deepEqual(await commitNormalResetWithLock(locks(),db,{
      expectedRaw:raw,confirmedReset:true,now:at,canCommit}),
      {ok:false,reason:'RESET_CANCELLED_BEFORE_WRITE'});
  }
  assert.deepEqual(db.writes,[]);
  assert.equal(db.read(SAVE_KEY),raw);
  assert.equal(db.read(ABNORMAL_RESET_BACKUP_KEY),null);
});
