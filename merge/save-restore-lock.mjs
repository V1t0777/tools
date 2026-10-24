/**
 * P2.21 — optional Web Locks coordination for guarded local V3 restores.
 * NOT connected to the UI; unsupported browsers must fail closed.
 * All normal-mode writers must also adopt the SAME lock for true
 * cross-tab coordination. This module alone does not provide atomic CAS.
 */
import { commitNormalSaveRestore } from './save-restore-commit.mjs';

export const RESTORE_LOCK_NAME = 'toolbox.merge-isle.normal.restore.v1';
const rejected = reason => Object.freeze({ok:false,reason});

/**
 * Attempt a non-queued exclusive Web Lock for a synchronous local restore.
 * No background retry or silent fallback to unlocked persistence.
 * Inject the browser's navigator.locks explicitly for testability.
 */
export async function coordinateNormalSaveRestore(fileText,storage,lockManager,
  {expectedRaw,confirmed=false,allowDowngrade=false}={}) {
  if(confirmed!==true)return rejected('CONFIRMATION_REQUIRED');
  if(typeof lockManager?.request!=='function')return rejected('LOCKS_UNAVAILABLE');
  let entered=false,attempted=false;
  try {
    const result=await lockManager.request(RESTORE_LOCK_NAME,
      {mode:'exclusive',ifAvailable:true},lock=>{
        if(entered)return rejected('LOCK_CALLBACK_REPEATED');
        entered=true;
        if(lock===null)return rejected('LOCK_BUSY');
        if(lock?.name!==RESTORE_LOCK_NAME||lock.mode!=='exclusive')
          return rejected('LOCK_INVALID');
        attempted=true;
        // The restore checks expectedRaw, reserves a backup and verifies
        // the write while the participating Web Lock is held.
        return commitNormalSaveRestore(fileText,storage,
          {expectedRaw,confirmed,allowDowngrade});
      });
    if(!entered || !result || typeof result.ok!=='boolean')
      return rejected(attempted?'RESTORE_OUTCOME_UNCERTAIN':'LOCK_RESULT_INVALID');
    return result;
  } catch {
    // A rejected request AFTER commit may have written the save.
    // Never retry blindly or claim that no write occurred.
    return rejected(attempted?'RESTORE_OUTCOME_UNCERTAIN':'LOCK_FAILED');
  }
}
