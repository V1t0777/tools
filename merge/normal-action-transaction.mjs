/**
 * P2.46: locked ordinary gameplay action -> verified local snapshot.
 * Deliberately NOT wired into the current synchronous UI. Every writer,
 * including startup migration, reset and timer, must migrate together.
 */
import {withNormalSaveLock} from './normal-save-lock.mjs';
import {advanceTime} from './engine.mjs';
import {peekLocalV3,SAVE_KEY} from './storage.mjs';
import {commitNormalSnapshot} from './save-transaction.mjs';

const reject=reason=>Object.freeze({ok:false,reason});

/**
 * action is a synchronous, side-effect-free engine operation. It runs ONLY
 * after the lock is acquired and the exact trusted baseline is re-read.
 * The returned state must not be published until exact storage readback.
 * This helper never performs a reset, migration, network call or cloud sync.
 */
export async function commitNormalActionWithLock(locks,storage,{expectedRaw,action,canCommit=()=>true}={}) {
  if(typeof expectedRaw!=='string')return reject('NO_TRUSTED_BASELINE');
  if(typeof action!=='function')return reject('INVALID_ACTION');
  if(typeof canCommit!=='function')return reject('ACTION_GUARD_UNAVAILABLE');
  const permitted=()=>{try{return canCommit()===true;}catch{return false;}};
  // Reads may synchronously dispatch pagehide. The final storage write must
  // independently check the lifecycle lease, not just the initial lock entry.
  const guardedStorage={
    getItem:key=>storage.getItem(key),
    setItem:(key,value)=>{
      if(!permitted())throw new Error('ACTION_LIFECYCLE_INVALIDATED');
      return storage.setItem(key,value);
    }
  };
  return withNormalSaveLock(locks,()=>{
    // Pagehide/BFCache may invalidate a gesture while Web Locks is pending.
    // Refuse before even evaluating the engine action or reading a new save.
    if(!permitted())return reject('ACTION_CANCELLED_BEFORE_WRITE');
    const current=peekLocalV3(guardedStorage);
    if(!permitted())return reject('ACTION_CANCELLED_BEFORE_WRITE');
    if(!current.ok)return reject(current.reason);
    if(current.raw!==expectedRaw)return reject('STALE_BASELINE');
    // Every successful ordinary gameplay action in the V3 engine creates a
    // distinct snapshot and advances its revision exactly once. Reject an
    // accidental no-op/forged economy update with the old revision before it
    // can be persisted as an equal-revision cross-tab conflict.
    const baselineRevision=current.state.revision;
    // A successful action must not mutate its input even when it returns a
    // distinct outer object. Detect nested board/economy mutations before
    // persisting an aliased result; the trusted raw save remains untouched.
    const baselineSnapshot=JSON.stringify(current.state);
    const result=action(current.state);
    if(!permitted())return reject('ACTION_CANCELLED_BEFORE_WRITE');
    // Observe a rejected thenable immediately. Later purity checks may fail
    // (or JSON serialization may throw), but its rejection must not escape
    // as an unhandled Promise after the lock releases.
    const asyncResult=result && typeof result.then==='function';
    if(asyncResult) void Promise.resolve(result).catch(()=>{});
    // Preserve the existing P2.61h contract for the exact same object.
    if(result?.ok===true && result.state===current.state)
      return reject('ACTION_REVISION_INVALID');
    if(JSON.stringify(current.state)!==baselineSnapshot)
      return reject('ACTION_MUTATED_BASELINE');
    if(asyncResult) return reject('ASYNC_ACTION_NOT_ALLOWED');
    if(!result || result.ok!==true) {
      // A normal engine rejection has no write side effects. Retain its
      // bounded Chinese UI message for the future async page gateway.
      if(typeof result?.message==='string')
        return Object.freeze({ok:false,reason:'ACTION_REJECTED',
          message:result.message.slice(0,200)});
      return reject('ACTION_REJECTED');
    }
    if(!result.state || result.state===current.state ||
        result.state.revision!==baselineRevision+1)
      return reject('ACTION_REVISION_INVALID');
    if(!permitted())return reject('ACTION_CANCELLED_BEFORE_WRITE');
    const receipt=commitNormalSnapshot(guardedStorage,result.state,{expectedRaw:current.raw});
    if(!receipt.ok)return receipt;
    return Object.freeze({...receipt,state:result.state,
      message:typeof result.message==='string'?result.message:''});
  });
}

/**
 * P2.47: a future ordinary-mode energy/cooldown tick runs under the SAME
 * exclusive lock as gameplay. A no-op tick never rewrites the save.
 * Deliberately not wired into the synchronous page until ALL writers migrate.
 */
export async function commitNormalClockWithLock(locks,storage,{expectedRaw,now=Date.now(),canCommit=()=>true}={}) {
  if(typeof expectedRaw!=='string')return reject('NO_TRUSTED_BASELINE');
  if(!Number.isFinite(now)||now<0)return reject('INVALID_CLOCK');
  if(typeof canCommit!=='function')return reject('CLOCK_GUARD_UNAVAILABLE');
  return withNormalSaveLock(locks,()=>{
    if(!permitted())return reject('CLOCK_CANCELLED_BEFORE_WRITE');
    const current=peekLocalV3(guardedStorage);
    if(!permitted())return reject('CLOCK_CANCELLED_BEFORE_WRITE');
    if(!current.ok)return reject(current.reason);
    if(current.raw!==expectedRaw)return reject('STALE_BASELINE');
    const next=advanceTime(current.state,now);
    if(!permitted())return reject('CLOCK_CANCELLED_BEFORE_WRITE');
    if(next===current.state) {
      // A no-op still publishes a trusted baseline to the async UI. An
      // uncoordinated older tab may have replaced the save after our first
      // read, so never call that baseline verified without a final readback.
      // This is not a substitute for every writer using the same Web Lock.
      let observed;
      try {observed=guardedStorage.getItem(SAVE_KEY);}
      catch {return reject('STORAGE_UNAVAILABLE');}
      if(!permitted())return reject('CLOCK_CANCELLED_BEFORE_WRITE');
      if(observed!==current.raw)return reject('STALE_BASELINE');
      return Object.freeze({ok:true,status:'CLOCK_UNCHANGED',changed:false,
        raw:current.raw,state:current.state,verifiedBaseline:true});
    }
    const receipt=commitNormalSnapshot(guardedStorage,next,{expectedRaw:current.raw});
    if(!receipt.ok)return receipt;
    return Object.freeze({...receipt,changed:true,state:next});
  });
}
