/**
 * P2.18 — read-only normal-mode local backup import preflight.
 * This is a preview, NOT an importer. The actual restore transaction,
 * source confirmation and original-save backup belong in a separate step.
 */
import { SAVE_VERSION, validateSave } from './engine.mjs';
import { SAVE_KEY, MAX_LOCAL_SAVE_BYTES } from './storage.mjs';

const rejected = reason => Object.freeze({ok:false,reason});

/**
 * @param {string} fileText untrusted file contents, NOT a file path
 * @param {Storage} storage read-only current-browser storage
 * @param {object} options expectedRaw is the caller's last observed raw value
 * @returns {object} frozen, redacted preflight assessment (no save bytes)
 */
export function previewNormalSaveImport(fileText, storage, {expectedRaw} = {}) {
  if (typeof fileText !== 'string' || fileText.length === 0)
    return rejected('EMPTY_OR_NON_TEXT_FILE');
  // Match the storage validator's JS string budget, not a UTF-8 byte budget.
  if (fileText.length > MAX_LOCAL_SAVE_BYTES)
    return rejected('FILE_TOO_LARGE');

  let candidate;
  try { candidate = JSON.parse(fileText); }
  catch { return rejected('INVALID_JSON'); }
  if (candidate?.mode === 'story') return rejected('STORY_MODE_FILE');
  if (candidate?.schemaVersion !== SAVE_VERSION)
    return rejected('UNSUPPORTED_SAVE_VERSION');
  try {
    if (!validateSave(candidate)) return rejected('INVALID_NORMAL_SAVE');
  } catch { return rejected('INVALID_NORMAL_SAVE'); }

  if (expectedRaw === undefined ||
      (expectedRaw !== null && typeof expectedRaw !== 'string'))
    return rejected('NO_TRUSTED_BASELINE');

  let currentRaw;
  try {
    if (typeof storage?.getItem !== 'function')
      return rejected('STORAGE_UNAVAILABLE');
    currentRaw = storage.getItem(SAVE_KEY);
  } catch { return rejected('STORAGE_UNAVAILABLE'); }
  // No writes; reject if another tab modified or removed the observed save.
  if (currentRaw !== expectedRaw) return rejected('CURRENT_SAVE_CHANGED');

  let currentRevision = null;
  if (currentRaw !== null) {
    if (typeof currentRaw !== 'string' ||
        currentRaw.length > MAX_LOCAL_SAVE_BYTES)
      return rejected('CURRENT_SAVE_INVALID');
    try {
      const current = JSON.parse(currentRaw);
      if (!validateSave(current)) return rejected('CURRENT_SAVE_INVALID');
      currentRevision = current.revision;
    } catch { return rejected('CURRENT_SAVE_INVALID'); }
    if (currentRaw === fileText) return rejected('ALREADY_PRESENT');
  }

  // This intentionally carries no import text, balances, inventory, or mutator.
  // Future commit logic MUST re-read current storage, verify again, make a
  // verified backup, require explicit confirmation and check the raw baseline.
  return Object.freeze({
    ok:true,
    status:'PREVIEW_ONLY',
    mode:'normal',
    schemaVersion:SAVE_VERSION,
    sourceRevision:candidate.revision,
    currentRevision,
    wouldReplaceCurrentSave:currentRaw !== null,
    wouldDecreaseRevision:currentRevision !== null &&
      candidate.revision < currentRevision,
    confirmationRequired:true,
    writesPerformed:false
  });
}
