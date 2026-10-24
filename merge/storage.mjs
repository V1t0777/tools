import { createInitialState, upgradeLegacySave, upgradeV2Save, validateV2Save, validateSave } from './engine.mjs';
import { validateSave as validateLegacySave } from './legacy-engine.mjs';

export const SAVE_KEY = 'toolbox.merge-isle.local.v1';
// Reserved for the original bytes preserved before an abnormal confirmed reset.
export const ABNORMAL_RESET_BACKUP_KEY = `${SAVE_KEY}.abnormal-reset-backup-v3`;
export const LEGACY_BACKUP_KEY = `${SAVE_KEY}.backup-v1`;
export const V2_BACKUP_KEY = `${SAVE_KEY}.backup-v2`;
// Much larger than a legitimate 56-cell save; bound parsing and writes from untrusted storage.
export const MAX_LOCAL_SAVE_BYTES = 160_000;

const newSession = (now, reason) => ({state:createInitialState(now), recovered:false,
  migrated:false, raw:null, ...(reason ? {blocked:true, reason, volatile:true} : {})});

export function loadLocal(storage, now = Date.now()) {
  let raw;
  try {
    if (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function')
      return newSession(now, 'STORAGE_UNAVAILABLE');
    raw = storage.getItem(SAVE_KEY);
  } catch { return newSession(now, 'STORAGE_UNAVAILABLE'); }
  if (raw === null) return newSession(now);
  try {
    if (typeof raw !== 'string' || raw.length > MAX_LOCAL_SAVE_BYTES)
      return {...newSession(now, 'CORRUPT_SAVE'),raw};
    const parsed = JSON.parse(raw);
    if (validateSave(parsed)) return {state:parsed, recovered:true, migrated:false, raw};
    const v1=parsed?.schemaVersion===1 && validateLegacySave(parsed);
    const v2=parsed?.schemaVersion===2 && validateV2Save(parsed);
    if(v1||v2){
      const upgraded=v1?upgradeLegacySave(parsed):upgradeV2Save(parsed);
      const backupKey=v1?LEGACY_BACKUP_KEY:V2_BACKUP_KEY;
      // Keep the original bytes intact until a dedicated versioned backup
      // exists. Never overwrite a mismatched or older backup.
      let backedUp=false;
      try{
        const existing=storage.getItem(backupKey);
        if(existing===null)storage.setItem(backupKey,raw);
        backedUp=storage.getItem(backupKey)===raw;
      }catch{/* Do not modify the only valid original. */}
      if(!backedUp)return {state:upgraded,recovered:true,migrated:true,
        volatile:true,blocked:true,reason:'BACKUP_UNAVAILABLE',raw};
      if(saveLocal(storage,upgraded,{migrationRaw:raw})){
        // setItem returning is not proof that bytes persisted. A browser,
        // storage shim or concurrent tab can still yield different data.
        // Never expose a migrated baseline until exact readback succeeds.
        const encoded=JSON.stringify(upgraded);
        try{
          if(storage.getItem(SAVE_KEY)===encoded)
            return {state:upgraded,recovered:true,migrated:true,raw:encoded};
        }catch{/* A post-write read failure leaves the outcome uncertain. */}
        return {state:upgraded,recovered:true,migrated:true,
          volatile:true,blocked:true,reason:'WRITE_VERIFY_FAILED',raw};
      }
      return {state:upgraded,recovered:true,migrated:true,
        volatile:true,blocked:true,reason:'WRITE_FAILED',raw};
    }
  } catch { /* Do not replace malformed or unrecognized stored bytes. */ }
  return {...newSession(now, 'CORRUPT_SAVE'),raw};
}

/**
 * P2.25 — read-only inspection for cross-tab storage events.
 * Unlike loadLocal, this MUST NOT run legacy migrations or write backups.
 * A missing, corrupt or legacy save is a conflict, not a new empty session.
 */
export function peekLocalV3(storage) {
  let raw;
  try {
    if(typeof storage?.getItem!=='function')
      return Object.freeze({ok:false,reason:'STORAGE_UNAVAILABLE'});
    raw=storage.getItem(SAVE_KEY);
  } catch {return Object.freeze({ok:false,reason:'STORAGE_UNAVAILABLE'});}
  if(raw===null)return Object.freeze({ok:false,reason:'SAVE_REMOVED'});
  if(typeof raw!=='string'||raw.length>MAX_LOCAL_SAVE_BYTES)
    return Object.freeze({ok:false,reason:'CORRUPT_SAVE'});
  try {
    const state=JSON.parse(raw);
    if(!validateSave(state))
      return Object.freeze({ok:false,reason:'UNSUPPORTED_OR_CORRUPT_SAVE'});
    return Object.freeze({ok:true,raw,state});
  } catch {return Object.freeze({ok:false,reason:'CORRUPT_SAVE'});}
}

/** Refuse corrupt saves, stale-tab rollback and unsafe legacy overwrite.
 * expectedRaw is the exact last-read/successfully-written value for this tab.
 * It detects sequential same-revision edits and intervening resets, but cannot
 * make localStorage's separate read/write operations atomic across tabs.
 * allowReset requires BOTH explicit user confirmation and the exact last-read
 * raw baseline; confirmation never authorizes overwriting another tab's save.
 * This is a best-effort guard, NOT an atomic cross-tab transaction.
 */
export function saveLocal(storage, state, {allowReset=false, migrationRaw=null, expectedRaw=undefined} = {}) {
  if (!validateSave(state)) return false;
  try {
    if (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function') return false;
    const current = storage.getItem(SAVE_KEY);
    if (allowReset) {
      // A reset must not bypass optimistic concurrency, even with user consent.
      // Undefined means no trusted observed baseline; null means the key was absent.
      if (expectedRaw === undefined ||
          (expectedRaw !== null && typeof expectedRaw !== 'string') ||
          current !== expectedRaw || migrationRaw !== null) return false;
    } else if (expectedRaw !== undefined && current !== expectedRaw) return false;
    if (current !== null) {
      if (migrationRaw !== null) {
        if(current!==migrationRaw)return false;
        const legacy=JSON.parse(current);
        const isV1=legacy?.schemaVersion===1 && validateLegacySave(legacy);
        const isV2=legacy?.schemaVersion===2 && validateV2Save(legacy);
        if(!isV1&&!isV2)return false;
        const backupKey=isV1?LEGACY_BACKUP_KEY:V2_BACKUP_KEY;
        if(storage.getItem(backupKey)!==migrationRaw)return false;
      } else if (!allowReset) {
        if (typeof current !== 'string' || current.length > MAX_LOCAL_SAVE_BYTES) return false;
        const previous = JSON.parse(current);
        if (!validateSave(previous) || previous.revision > state.revision) return false;
      }
    } else if (migrationRaw !== null) return false;
    const encoded = JSON.stringify(state);
    if (encoded.length > MAX_LOCAL_SAVE_BYTES) return false;
    storage.setItem(SAVE_KEY, encoded);
    return true;
  } catch { return false; }
}