/**
 * P2.16: manual, read-only download of the exact persisted normal-mode bytes.
 * No parsing/migration/write happens here; invalid bytes can still be preserved
 * for future manual recovery. Never reads the reserved story-mode namespace.
 */
import { validateSave } from './engine.mjs';
import { SAVE_KEY, MAX_LOCAL_SAVE_BYTES } from './storage.mjs';

// Actual encoded file limit, not a JavaScript UTF-16 code-unit count.
export const MAX_EXPORT_BYTES = 2_000_000;

export function prepareLocalSaveExport(storage) {
  let raw;
  try {
    if (typeof storage?.getItem !== 'function') return Object.freeze({ok:false,reason:'STORAGE_UNAVAILABLE'});
    raw=storage.getItem(SAVE_KEY);
  } catch {
    return Object.freeze({ok:false,reason:'STORAGE_UNAVAILABLE'});
  }
  if (raw===null) return Object.freeze({ok:false,reason:'NO_SAVED_DATA'});
  // Guard UTF-16 input length first to avoid unbounded encoder allocation.
  if (typeof raw!=='string' || raw.length>MAX_EXPORT_BYTES)
    return Object.freeze({ok:false,reason:'EXPORT_TOO_LARGE'});
  // Blob text downloads are UTF-8, not UTF-16. A large Chinese/emoji
  // anomalous save may use far more bytes than raw.length suggests.
  let utf8Bytes;
  try { utf8Bytes=new TextEncoder().encode(raw).byteLength; }
  catch { return Object.freeze({ok:false,reason:'EXPORT_ENCODING_UNAVAILABLE'}); }
  if(utf8Bytes>MAX_EXPORT_BYTES)
    return Object.freeze({ok:false,reason:'EXPORT_TOO_LARGE'});
  let verified=false;
  if(raw.length<=MAX_LOCAL_SAVE_BYTES){
    try { verified=validateSave(JSON.parse(raw)); }
    catch { /* Preserve invalid bytes without interpreting or modifying them. */ }
  }
  return Object.freeze({
    ok:true,
    verified,
    filename:verified?'yunyu-normal-save-v3.json':'yunyu-unverified-original.txt',
    mime:verified?'application/json;charset=utf-8':'text/plain;charset=utf-8',
    content:raw
  });
}
