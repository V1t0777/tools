/**
 * P2.16: manual, read-only download of the exact persisted normal-mode bytes.
 * No parsing/migration/write happens here; invalid bytes can still be preserved
 * for future manual recovery. Never reads the reserved story-mode namespace.
 */
import { validateSave } from './engine.mjs';
import { SAVE_KEY, ABNORMAL_RESET_BACKUP_KEY, MAX_LOCAL_SAVE_BYTES } from './storage.mjs';

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
  // TextEncoder/Blob silently replace isolated UTF-16 surrogates with U+FFFD.
  // Preserve the original localStorage code units in a JSON string envelope.
  // A paired surrogate (e.g. emoji) is valid Unicode and needs no wrapper.
  if(/[\uD800-\uDFFF]/u.test(raw)) {
    const content=JSON.stringify({format:'yunyu-normal-raw-utf16-v1',raw});
    try {
      if(new TextEncoder().encode(content).byteLength>MAX_EXPORT_BYTES)
        return Object.freeze({ok:false,reason:'EXPORT_TOO_LARGE'});
    } catch {return Object.freeze({ok:false,reason:'EXPORT_ENCODING_UNAVAILABLE'});}
    return Object.freeze({
      ok:true,verified:false,wrapped:true,
      filename:'yunyu-unverified-utf16-escaped.json',
      mime:'application/json;charset=utf-8',content
    });
  }
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

/**
 * P2.36: manual, read-only export of the separate original saved before an
 * abnormal confirmed reset. Never substitutes the current normal save, and
 * never touches the story-mode namespace. Not an automatic restore.
 */
export function prepareAbnormalResetBackupExport(storage) {
  // Reuse the exact raw-string bounds/UTF-16 handling of the primary exporter,
  // but route its one permitted read to the dedicated abnormal backup key.
  const view={
    getItem(key) {
      if(key!==SAVE_KEY||typeof storage?.getItem!=='function')
        throw Error('STORAGE_UNAVAILABLE');
      return storage.getItem(ABNORMAL_RESET_BACKUP_KEY);
    }
  };
  const result=prepareLocalSaveExport(view);
  if(!result.ok)return result;
  // An abnormal-reset backup is historical evidence, not the active save.
  // Do not label it as verified gameplay data even if its JSON validates.
  return Object.freeze({...result,verified:false,backup:true,
    filename:result.wrapped
      ?'yunyu-abnormal-reset-utf16-escaped.json'
      :'yunyu-abnormal-reset-original.txt'});
}
