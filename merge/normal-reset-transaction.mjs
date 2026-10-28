/**
 * P2.48: confirmed ordinary-mode reset under the SAME exclusive Web Lock as
 * normal actions and clock ticks. Not wired into the synchronous page yet.
 * Never touches the story-mode save or an online database.
 */
import {createInitialState} from './engine.mjs';
import {SAVE_KEY,peekLocalV3} from './storage.mjs';
import {withNormalSaveLock} from './normal-save-lock.mjs';
import {prepareAbnormalResetBackup} from './reset-backup.mjs';
import {commitNormalSnapshot} from './save-transaction.mjs';

const reject=reason=>Object.freeze({ok:false,reason});

/**
 * User confirmation is mandatory. expectedRaw is the exact last trusted
 * original (null only when the key was observed absent). The caller must
 * request a backup for any other uncertain save state. Corrupt/legacy bytes
 * always require a verified original backup regardless of caller policy.
 *
 * The lock covers baseline check, backup reservation and verified reset write.
 * This is not end-to-end atomic until all other writers use the same lock.
 */
export async function commitNormalResetWithLock(locks,storage,{
  expectedRaw,confirmedReset=false,requireOriginalBackup=false,now=Date.now(),
  canCommit=()=>true
}={}) {
  if(confirmedReset!==true)return reject('RESET_NOT_CONFIRMED');
  if(expectedRaw!==null&&typeof expectedRaw!=='string')
    return reject('NO_TRUSTED_BASELINE');
  if(typeof requireOriginalBackup!=='boolean')
    return reject('INVALID_BACKUP_POLICY');
  if(!Number.isFinite(now)||now<0)return reject('INVALID_CLOCK');
  if(typeof canCommit!=='function')return reject('RESET_GUARD_UNAVAILABLE');

  const permitted=()=>{try{return canCommit()===true;}catch{return false;}};
  const guardedStorage={
    getItem:key=>storage.getItem(key),
    setItem:(key,value)=>{
      if(!permitted())throw new Error('RESET_LIFECYCLE_INVALIDATED');
      return storage.setItem(key,value);
    }
  };
  return withNormalSaveLock(locks,()=>{
    // Confirmation becomes stale on pagehide/BFCache while waiting for lock.
    // Check before any original-backup reservation or reset write.
    if(!permitted())return reject('RESET_CANCELLED_BEFORE_WRITE');
    if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
      return reject('STORAGE_UNAVAILABLE');
    let current;
    try {current=guardedStorage.getItem(SAVE_KEY);}
    catch {return reject('STORAGE_UNAVAILABLE');}
    if(!permitted())return reject('RESET_CANCELLED_BEFORE_WRITE');
    if(current!==expectedRaw)return reject('STALE_BASELINE');

    let backupVerified=false,backupCreated=false;
    if(current===null) {
      if(requireOriginalBackup)return reject('NO_ORIGINAL_TO_BACKUP');
    } else {
      const inspection=peekLocalV3(guardedStorage);
      if(!permitted())return reject('RESET_CANCELLED_BEFORE_WRITE');
      if(inspection.ok) {
        if(inspection.raw!==current)return reject('STALE_BASELINE');
      } else if(inspection.reason!=='CORRUPT_SAVE'&&
                inspection.reason!=='UNSUPPORTED_OR_CORRUPT_SAVE') {
        return reject(inspection.reason);
      }
      if(requireOriginalBackup||!inspection.ok) {
        const backup=prepareAbnormalResetBackup(guardedStorage,{expectedRaw:current});
        if(!permitted())return reject('RESET_CANCELLED_BEFORE_WRITE');
        if(!backup.ok)return backup;
        backupVerified=backup.verifiedReadback;
        backupCreated=backup.backupCreated;
      }
    }

    if(!permitted())return reject('RESET_CANCELLED_BEFORE_WRITE');
    const state=createInitialState(now);
    const receipt=commitNormalSnapshot(guardedStorage,state,
      {expectedRaw:current,confirmedReset:true});
    if(!receipt.ok)return receipt;
    return Object.freeze({...receipt,state,backupVerified,backupCreated});
  });
}
