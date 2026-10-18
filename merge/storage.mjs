import { createInitialState, upgradeLegacySave, validateSave } from './engine.mjs';
import { validateSave as validateLegacySave } from './legacy-engine.mjs';

export const SAVE_KEY = 'toolbox.merge-isle.local.v1';
export const LEGACY_BACKUP_KEY = `${SAVE_KEY}.backup-v1`;
// Much larger than a legitimate 56-cell save; bound parsing and writes from untrusted storage.
export const MAX_LOCAL_SAVE_BYTES = 160_000;

const newSession = (now, reason) => ({state:createInitialState(now), recovered:false,
  migrated:false, ...(reason ? {blocked:true, reason, volatile:true} : {})});

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
      return newSession(now, 'CORRUPT_SAVE');
    const parsed = JSON.parse(raw);
    if (validateSave(parsed)) return {state:parsed, recovered:true, migrated:false};
    if (parsed?.schemaVersion === 1 && validateLegacySave(parsed)) {
      const upgraded = upgradeLegacySave(parsed);
      // Never replace the sole valid legacy copy without a byte-for-byte backup.
      let backedUp = false;
      try {
        const existing = storage.getItem(LEGACY_BACKUP_KEY);
        if (existing === null) storage.setItem(LEGACY_BACKUP_KEY, raw);
        backedUp = storage.getItem(LEGACY_BACKUP_KEY) === raw;
      } catch { /* Keep the original save intact. */ }
      if (!backedUp) return {state:upgraded,recovered:true,migrated:true,
        volatile:true,blocked:true,reason:'BACKUP_UNAVAILABLE'};
      if (saveLocal(storage,upgraded,{migrationRaw:raw}))
        return {state:upgraded,recovered:true,migrated:true};
      return {state:upgraded,recovered:true,migrated:true,
        volatile:true,blocked:true,reason:'WRITE_FAILED'};
    }
  } catch { /* Do not replace malformed or unrecognized stored bytes. */ }
  return newSession(now, 'CORRUPT_SAVE');
}

/** Refuse corrupt saves, stale-tab rollback and unsafe legacy overwrite.
 * allowReset must be used ONLY after an explicit user-confirmed reset.
 */
export function saveLocal(storage, state, {allowReset=false, migrationRaw=null} = {}) {
  if (!validateSave(state)) return false;
  try {
    if (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function') return false;
    const current = storage.getItem(SAVE_KEY);
    if (current !== null) {
      if (migrationRaw !== null) {
        if (current !== migrationRaw || storage.getItem(LEGACY_BACKUP_KEY) !== migrationRaw)
          return false;
        const legacy = JSON.parse(current);
        if (legacy?.schemaVersion !== 1 || !validateLegacySave(legacy)) return false;
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