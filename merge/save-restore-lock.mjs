/**
 * P2.21 — optional Web Locks coordination for guarded local V3 restores.
 * NOT connected to the UI; unsupported browsers must fail closed.
 * All normal-mode writers must also adopt the SAME lock for true
 * cross-tab coordination. This module alone does not provide atomic CAS.
 */
import { commitNormalSaveRestore } from './save-restore-commit.mjs';
import { NORMAL_SAVE_LOCK_NAME } from './normal-save-lock.mjs';

// P2.60: legacy restore and save adapters must share the P2.45+ normal
// action/clock/reset/startup lock. A separate name permits simultaneous
// restore and gameplay transactions even when both request exclusive locks.
export const RESTORE_LOCK_NAME = NORMAL_SAVE_LOCK_NAME;
const rejected = reason => Object.freeze({ok:false,reason});

/**
 * Attempt a non-queued exclusive Web Lock for a synchronous local restore.
 * No background retry or silent fallback to unlocked persistence.
 * Inject the browser's navigator.locks explicitly for testability.
 */
export async function coordinateNormalSaveRestore(fileText,storage,lockManager,
  {expectedRaw,confirmed=false,allowDowngrade=false,canCommit=()=>true}={}) {
  if(typeof canCommit!=='function')return rejected('RESTORE_GUARD_UNAVAILABLE');
  if(confirmed!==true)return rejected('CONFIRMATION_REQUIRED');
  if(typeof lockManager?.request!=='function')return rejected('LOCKS_UNAVAILABLE');
  let entered=false,attempted=false,callbackRepeated=false,requestSettled=false;
  let expectedResult;
  const permitted=()=>{try{return canCommit()===true;}catch{return false;}};
  // A pagehide can occur during preflight reads or backup reservation.
  // Recheck the lease at each write, including the final save replacement.
  const guardedStorage={
    getItem:key=>storage.getItem(key),
    setItem:(key,value)=>{
      if(!permitted())throw new Error('RESTORE_LIFECYCLE_INVALIDATED');
      return storage['setItem'](key,value);
    }
  };
  try {
    const result=await lockManager.request(RESTORE_LOCK_NAME,
      {mode:'exclusive',ifAvailable:true},lock=>{
        // A malformed provider must never replay a restore callback, including
        // one delivered after its request has already settled.
        if(entered || requestSettled){
          callbackRepeated=true;
          return rejected('LOCK_CALLBACK_REPEATED');
        }
        entered=true;
        if(lock===null)return (expectedResult=rejected('LOCK_BUSY'));
        if(lock?.name!==RESTORE_LOCK_NAME||lock.mode!=='exclusive')
          return (expectedResult=rejected('LOCK_INVALID'));
        attempted=true;
        // A pagehide, BFCache transition or cancelled file read may happen
        // while a lock request is pending. Re-check inside the acquired lock
        // BEFORE reserving the original backup or writing the normal save.
        if(!permitted())return (expectedResult=rejected('RESTORE_CANCELLED_BEFORE_WRITE'));
        // The restore checks expectedRaw, reserves a backup and verifies
        // the write while the participating Web Lock is held.
        const receipt=commitNormalSaveRestore(fileText,guardedStorage,
          {expectedRaw,confirmed,allowDowngrade});
        // Even a verified write must not be acknowledged after pagehide.
        if(!permitted())return (expectedResult=rejected('RESTORE_OUTCOME_UNCERTAIN'));
        return (expectedResult=receipt);
      });
    requestSettled=true;
    // The browser's Web Locks request resolves to the exact callback result.
    // A duplicate callback or forged return makes any completed write uncertain.
    if(!entered || callbackRepeated || result!==expectedResult ||
        !result || typeof result.ok!=='boolean')
      return rejected(attempted?'RESTORE_OUTCOME_UNCERTAIN':'LOCK_RESULT_INVALID');
    return result;
  } catch {
    requestSettled=true;
    // A rejected request AFTER commit may have written the save.
    // Never retry blindly or claim that no write occurred.
    return rejected(attempted?'RESTORE_OUTCOME_UNCERTAIN':'LOCK_FAILED');
  }
}
