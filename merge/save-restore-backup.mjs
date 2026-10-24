/**
 * P2.19 — guarded, local-only backup reservation before a future V3 restore.
 * Does NOT import or overwrite the normal save. Never touches story-mode keys.
 */
import { SAVE_KEY } from './storage.mjs';
import { previewNormalSaveImport } from './save-import-preflight.mjs';

export const RESTORE_BACKUP_KEY = `${SAVE_KEY}.restore-backup-v3`;
const rejected = reason => Object.freeze({ok:false,reason});

/**
 * Only reserve the exact original normal-mode bytes after a successful
 * candidate preflight and an exact observed baseline match.
 * A backup-slot conflict is a hard stop, not permission to overwrite it.
 * This is NOT an atomic cross-tab transaction or permission to restore.
 */
export function prepareNormalSaveRestoreBackup(fileText, storage, {expectedRaw} = {}) {
  const preview = previewNormalSaveImport(fileText, storage, {expectedRaw});
  if (!preview.ok) return rejected(preview.reason);
  if (typeof storage?.getItem !== 'function' ||
      typeof storage?.setItem !== 'function') return rejected('STORAGE_UNAVAILABLE');

  try {
    // Preflight is a separate read; repeat the comparison before any writes.
    if (storage.getItem(SAVE_KEY) !== expectedRaw)
      return rejected('CURRENT_SAVE_CHANGED');
    if (expectedRaw === null) {
      // No original data to back up. Future restore still needs a fresh check.
      return Object.freeze({ok:true,status:'NO_EXISTING_SAVE',
        backupReady:true,backupCreated:false,restorePerformed:false});
    }

    const existing = storage.getItem(RESTORE_BACKUP_KEY);
    if (existing !== null && existing !== expectedRaw)
      return rejected('BACKUP_SLOT_CONFLICT');
    let backupCreated = false;
    if (existing === null) {
      // Best-effort second read narrows, but cannot eliminate, cross-tab races.
      if (storage.getItem(SAVE_KEY) !== expectedRaw ||
          storage.getItem(RESTORE_BACKUP_KEY) !== null)
        return rejected('BACKUP_OR_SAVE_CHANGED');
      storage.setItem(RESTORE_BACKUP_KEY, expectedRaw);
      backupCreated = true;
    }
    if (storage.getItem(RESTORE_BACKUP_KEY) !== expectedRaw)
      return rejected('BACKUP_VERIFY_FAILED');
    if (storage.getItem(SAVE_KEY) !== expectedRaw)
      return rejected('CURRENT_SAVE_CHANGED');
    return Object.freeze({ok:true,status:'BACKUP_READY',backupReady:true,
      backupCreated,restorePerformed:false});
  } catch {
    // The original save is never written by this module. A partial backup
    // may remain after a storage failure and must not be silently removed.
    return rejected('BACKUP_UNAVAILABLE');
  }
}
