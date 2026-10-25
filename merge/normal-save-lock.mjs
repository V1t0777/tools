/** P2.60a — opt-in Web Locks boundary for ordinary-mode V3 saves.
 * This is NOT wired into the live ordinary-mode page yet. Callers must route
 * ALL normal-mode writers (including startup/migration, timer and reset) here
 * before treating the normal save as cross-tab serialized.
 */
import {SAVE_KEY} from './storage.mjs';
import {commitNormalSnapshot} from './save-transaction.mjs';

export const NORMAL_SAVE_LOCK_NAME = 'toolbox.merge-isle.normal-save.v3';
const blocked = reason => Object.freeze({ok:false,reason});

/** Serialize a single verified normal save with other cooperating tabs.
 * The candidate may have been computed before waiting; re-read the raw key
 * INSIDE the exclusive lock and refuse a stale baseline rather than rebasing
 * gameplay or a reset. Do not use a localStorage spin-lock fallback.
 */
export async function commitNormalSnapshotLocked(storage,nextState,{
  expectedRaw,confirmedReset=false,locks=globalThis.navigator?.locks
}={}) {
  if(expectedRaw===undefined||(expectedRaw!==null&&typeof expectedRaw!=='string'))
    return blocked('NO_TRUSTED_BASELINE');
  if(!locks||typeof locks.request!=='function')
    return blocked('MULTITAB_LOCK_UNAVAILABLE');
  try {
    const receipt=await locks.request(NORMAL_SAVE_LOCK_NAME,{mode:'exclusive'},lock=>{
      // ifAvailable-style null grants, or a broken adapter, cannot write.
      if(lock?.name!==NORMAL_SAVE_LOCK_NAME||lock?.mode!=='exclusive')
        return blocked('LOCK_NOT_GRANTED');
      let current;
      try {
        if(typeof storage?.getItem!=='function')return blocked('STORAGE_UNAVAILABLE');
        current=storage.getItem(SAVE_KEY);
      } catch {return blocked('STORAGE_UNAVAILABLE');}
      if(current!==expectedRaw)return blocked('CURRENT_SAVE_CHANGED');
      // Includes its own optimistic CAS and exact readback verification.
      return commitNormalSnapshot(storage,nextState,{expectedRaw,confirmedReset});
    });
    return receipt&&typeof receipt.ok==='boolean'
      ? receipt : blocked('LOCK_REQUEST_FAILED');
  } catch {return blocked('LOCK_REQUEST_FAILED');}
}
