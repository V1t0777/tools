/**
 * P2.20 — guarded, local-only V3 restore commit. NOT wired to the UI.
 * Confirmation must be obtained by the caller from the actual user; a
 * boolean here cannot prove consent. No cloud or story-mode writes.
 */
import { SAVE_KEY } from './storage.mjs';
import { previewNormalSaveImport } from './save-import-preflight.mjs';
import { RESTORE_BACKUP_KEY, prepareNormalSaveRestoreBackup } from './save-restore-backup.mjs';

const rejected = reason => Object.freeze({ok:false,reason});

/**
 * Restore exact validated file bytes, after confirmation, verified original
 * backup, fresh baseline checks and read-back verification.
 *
 * This is best-effort localStorage safety, NOT a cross-tab atomic CAS.
 * Never auto-rollback on failure: another tab might already have changed data.
 */
export function commitNormalSaveRestore(fileText, storage,
  {expectedRaw, confirmed=false, allowDowngrade=false} = {}) {
  if (confirmed !== true) return rejected('CONFIRMATION_REQUIRED');

  const first = previewNormalSaveImport(fileText, storage, {expectedRaw});
  if (!first.ok) return rejected(first.reason);
  if (first.wouldDecreaseRevision && allowDowngrade !== true)
    return rejected('DOWNGRADE_CONFIRMATION_REQUIRED');
  if (typeof storage?.setItem !== 'function')
    return rejected('STORAGE_UNAVAILABLE');

  const backup = prepareNormalSaveRestoreBackup(fileText, storage, {expectedRaw});
  if (!backup.ok) return rejected(backup.reason);

  try {
    // The backup procedure may have performed several reads and one write.
    // Recheck all untrusted inputs and current save immediately before commit.
    const fresh = previewNormalSaveImport(fileText, storage, {expectedRaw});
    if (!fresh.ok) return rejected(fresh.reason);
    if (fresh.wouldDecreaseRevision && allowDowngrade !== true)
      return rejected('DOWNGRADE_CONFIRMATION_REQUIRED');
    if (expectedRaw !== null &&
        storage.getItem(RESTORE_BACKUP_KEY) !== expectedRaw)
      return rejected('BACKUP_CHANGED');
    if (storage.getItem(SAVE_KEY) !== expectedRaw)
      return rejected('CURRENT_SAVE_CHANGED');

    // Do not use saveLocal: intentional restores can lower revision, but only
    // after explicit confirmation, original backup and exact raw baseline.
    storage.setItem(SAVE_KEY, fileText);
    if (storage.getItem(SAVE_KEY) !== fileText)
      return rejected('RESTORE_VERIFY_FAILED');
    return Object.freeze({ok:true,status:'RESTORE_VERIFIED',
      mode:'normal',sourceRevision:fresh.sourceRevision,
      previousRevision:fresh.currentRevision,
      backupCreated:backup.backupCreated,
      backupPreserved:expectedRaw !== null,
      verifiedReadback:true});
  } catch {
    // A failed setItem/getItem can leave the outcome unknown. Do not delete
    // the backup or try to overwrite the current save a second time.
    return rejected('RESTORE_OUTCOME_UNCERTAIN');
  }
}
