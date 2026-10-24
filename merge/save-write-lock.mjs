/**
 * P2.22 — guarded normal-mode V3 save/reset, using the same Web Lock as P2.21.
 * NOT wired to gameplay UI: old/unlocked tabs can still race.
 */
import {validateSave} from './engine.mjs';
import {SAVE_KEY,saveLocal} from './storage.mjs';
import {RESTORE_LOCK_NAME} from './save-restore-lock.mjs';

export const NORMAL_SAVE_LOCK_NAME=RESTORE_LOCK_NAME;
const reject=reason=>Object.freeze({ok:false,reason});

/** Pass the last observed exact raw data or null (known absent).
 * For reset, caller obtains user consent BEFORE confirmedReset=true.
 * No queueing, automatic retry, or unlocked fallback. */
export async function coordinateNormalSaveWrite(state,storage,lockManager,
  {expectedRaw,confirmedReset=false}={}) {
  if(expectedRaw===undefined||
      (expectedRaw!==null&&typeof expectedRaw!=='string'))
    return reject('NO_TRUSTED_BASELINE');
  if(typeof confirmedReset!=='boolean')return reject('INVALID_RESET_FLAG');
  if(!validateSave(state))return reject('INVALID_SAVE');
  if(typeof lockManager?.request!=='function')return reject('LOCKS_UNAVAILABLE');
  if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
    return reject('STORAGE_UNAVAILABLE');

  const serialized=JSON.stringify(state);
  let entered=false,writeAttempted=false;
  try {
    const result=await lockManager.request(NORMAL_SAVE_LOCK_NAME,
      {mode:'exclusive',ifAvailable:true},lock=>{
        if(entered)return reject('LOCK_CALLBACK_REPEATED');
        entered=true;
        if(lock===null)return reject('LOCK_BUSY');
        if(lock?.name!==NORMAL_SAVE_LOCK_NAME||lock.mode!=='exclusive')
          return reject('LOCK_INVALID');
        // Check before writing AND inside saveLocal to reject stale tabs.
        if(storage.getItem(SAVE_KEY)!==expectedRaw)
          return reject('CURRENT_SAVE_CHANGED');
        writeAttempted=true;
        if(!saveLocal(storage,state,{expectedRaw,allowReset:confirmedReset}))
          return reject('SAVE_REJECTED_OR_UNCERTAIN');
        // saveLocal checks that setItem returns, not the persisted value.
        if(storage.getItem(SAVE_KEY)!==serialized)
          return reject('SAVE_VERIFY_FAILED');
        return Object.freeze({ok:true,status:'SAVE_VERIFIED',mode:'normal',
          revision:state.revision,confirmedReset,verifiedReadback:true});
      });
    if(!entered||!result||typeof result.ok!=='boolean')
      return reject(writeAttempted?'SAVE_OUTCOME_UNCERTAIN':'LOCK_RESULT_INVALID');
    return result;
  } catch {
    // The provider/storage may throw AFTER writing. Do not retry blindly.
    return reject(writeAttempted?'SAVE_OUTCOME_UNCERTAIN':'LOCK_FAILED');
  }
}
