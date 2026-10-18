import { createInitialState, validateSave } from './engine.mjs';

export const SAVE_KEY = 'toolbox.merge-isle.local.v1';

export function loadLocal(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (validateSave(parsed)) return { state: parsed, recovered: true };
    }
  } catch { /* Storage may be denied or damaged. Start a clean local-only session. */ }
  return { state: createInitialState(now), recovered: false };
}

export function saveLocal(storage, state) {
  if (!validateSave(state)) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}