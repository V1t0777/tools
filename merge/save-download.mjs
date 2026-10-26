/**
 * P2.65b: one read-only, browser-local download request for a prepared save.
 * A successful return means only that an anchor click was requested, NOT
 * that Safari/WebView persisted a file. Never uploads or writes a save.
 */
const reject=reason=>Object.freeze({ok:false,reason});
const DOWNLOAD_URL_LIFETIME_MS=120_000;

export function requestBrowserSaveDownload(prepared,{
  doc=globalThis.document,
  urlApi=globalThis.URL,
  BlobCtor=globalThis.Blob,
  schedule=globalThis.setTimeout
}={}) {
  if(prepared?.ok!==true||typeof prepared.content!=='string'||
      typeof prepared.mime!=='string'||typeof prepared.filename!=='string'||
      !prepared.filename||!prepared.mime)
    return reject('INVALID_EXPORT_RECEIPT');
  if(typeof doc?.createElement!=='function'||
      typeof doc?.body?.append!=='function'||
      typeof urlApi?.createObjectURL!=='function'||
      typeof urlApi?.revokeObjectURL!=='function'||
      typeof BlobCtor!=='function')
    return reject('DOWNLOAD_UNSUPPORTED');
  let objectUrl=null,link=null;
  try {
    const blob=new BlobCtor([prepared.content],{type:prepared.mime});
    objectUrl=urlApi.createObjectURL(blob);
    if(typeof objectUrl!=='string'||!objectUrl.startsWith('blob:'))
      throw new Error('INVALID_OBJECT_URL');
    link=doc.createElement('a');
    link.href=objectUrl;
    link.download=prepared.filename;
    doc.body.append(link);
    link.click();
  } catch {
    if(objectUrl) {
      try {urlApi.revokeObjectURL(objectUrl);} catch { /* Best effort. */ }
    }
    return reject('DOWNLOAD_REQUEST_FAILED');
  } finally {
    try {link?.remove();} catch { /* Never undo an already requested download. */ }
  }
  // Some mobile WebViews suspend timers, and a scheduling error must not
  // revoke a URL immediately after the click, before the browser consumes it.
  // Keep the bounded (<=2 MB) URL alive if cleanup cannot be scheduled.
  try {
    if(typeof schedule!=='function')throw new Error('NO_DOWNLOAD_TIMER');
    schedule(()=>{
      try {urlApi.revokeObjectURL(objectUrl);} catch { /* Best effort. */ }
    },DOWNLOAD_URL_LIFETIME_MS);
    return Object.freeze({ok:true,cleanupDeferred:false});
  } catch {
    return Object.freeze({ok:true,cleanupDeferred:true});
  }
}
