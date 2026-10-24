/**
 * P2.35: reserve the exact abnormal normal-mode save before a confirmed reset.
 * This module NEVER resets, restores or touches the story-mode namespace.
 * A same-origin backup is NOT a substitute for a downloaded backup.
 */
import {SAVE_KEY} from './storage.mjs';
import {MAX_EXPORT_BYTES} from './save-export.mjs';

export const ABNORMAL_RESET_BACKUP_KEY=`${SAVE_KEY}.abnormal-reset-backup-v3`;
const reject=reason=>Object.freeze({ok:false,reason});

/** Fail closed on a stale tab, occupied backup slot or unverified storage. */
export function prepareAbnormalResetBackup(storage,{expectedRaw}={}) {
  if(typeof expectedRaw!=='string')return reject('NO_ORIGINAL_TO_BACKUP');
  if(expectedRaw.length>MAX_EXPORT_BYTES)return reject('BACKUP_TOO_LARGE');
  if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
    return reject('STORAGE_UNAVAILABLE');
  try {
    if(storage.getItem(SAVE_KEY)!==expectedRaw)
      return reject('CURRENT_SAVE_CHANGED');
    const existing=storage.getItem(ABNORMAL_RESET_BACKUP_KEY);
    if(existing!==null&&existing!==expectedRaw)
      return reject('BACKUP_SLOT_CONFLICT');
    let backupCreated=false;
    if(existing===null) {
      // Re-read both keys immediately before reserving the original bytes.
      if(storage.getItem(SAVE_KEY)!==expectedRaw||
          storage.getItem(ABNORMAL_RESET_BACKUP_KEY)!==null)
        return reject('BACKUP_OR_SAVE_CHANGED');
      storage.setItem(ABNORMAL_RESET_BACKUP_KEY,expectedRaw);
      backupCreated=true;
    }
    if(storage.getItem(ABNORMAL_RESET_BACKUP_KEY)!==expectedRaw)
      return reject('BACKUP_VERIFY_FAILED');
    if(storage.getItem(SAVE_KEY)!==expectedRaw)
      return reject('CURRENT_SAVE_CHANGED');
    return Object.freeze({ok:true,status:'ORIGINAL_BACKUP_VERIFIED',
      backupCreated,verifiedReadback:true});
  } catch {return reject('BACKUP_OUTCOME_UNCERTAIN');}
}
