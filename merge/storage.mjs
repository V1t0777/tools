import { createInitialState, upgradeLegacySave, validateSave } from './engine.mjs';
import { validateSave as validateLegacySave } from './legacy-engine.mjs';

export const SAVE_KEY = 'toolbox.merge-isle.local.v1';
export const LEGACY_BACKUP_KEY = `${SAVE_KEY}.backup-v1`;

export function loadLocal(storage, now = Date.now()) {
  try {
    const raw = storage?.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (validateSave(parsed)) return { state: parsed, recovered: true, migrated: false };
      if (parsed?.schemaVersion === 1 && validateLegacySave(parsed)) {
        const upgraded = upgradeLegacySave(parsed);
        // Preserve the v1 bytes once, even if committing the upgraded snapshot fails.
        try {
          if (storage?.getItem(LEGACY_BACKUP_KEY) === null) storage?.setItem(LEGACY_BACKUP_KEY, raw);
        } catch { /* Backup may be quota-blocked; never discard the in-memory migration. */ }
        if (saveLocal(storage, upgraded)) return { state: upgraded, recovered: true, migrated: true };
        // Do not reset valid data merely because this browser denies writes.
        return { state: upgraded, recovered: true, migrated: true, volatile: true };
      }
    }
  } catch { /* Corrupt storage and storage permission errors must never crash UI. */ }
  return { state: createInitialState(now), recovered: false, migrated: false };
}

export function saveLocal(storage, state) {
  if (!validateSave(state)) return false;
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(state));
    return !!storage;
  } catch { return false; }
}