/**
 * P2.65c: bounded, read-only browser download requests for local save exports.
 * Success means a click was requested, never that Safari/WebView saved a file.
 * The 2 MB ceiling mirrors save-export.mjs, without reading or writing storage.
 */
const reject=reason=>Object.freeze({ok:false,reason});
export const DOWNLOAD_URL_LIFETIME_MS=120_000;
export const MAX_PENDING_SAVE_DOWNLOADS=8;
const MAX_DOWNLOAD_BYTES=2_000_000;
const pendingByApi=new WeakMap();

function pendingFor(urlApi){
  let entries=pendingByApi.get(urlApi);
  if(!entries){entries=new Set();pendingByApi.set(urlApi,entries);}
  return entries;
}
function tryRevoke(urlApi,entries,entry){
  try {urlApi.revokeObjectURL(entry.url);entries.delete(entry);return true;}
  catch {return false;}
}

export function requestBrowserSaveDownload(prepared,{
  doc=globalThis.document,
  urlApi=globalThis.URL,
  BlobCtor=globalThis.Blob,
  schedule=globalThis.setTimeout,
  now=Date.now
}={}) {
  if(prepared?.ok!==true||typeof prepared.content!=='string'||
      typeof prepared.mime!=='string'||typeof prepared.filename!=='string'||
      !prepared.filename||!prepared.mime)
    return reject('INVALID_EXPORT_RECEIPT');
  // Never allocate an unbounded Blob even if a caller bypasses the exporter.
  if(prepared.content.length>MAX_DOWNLOAD_BYTES)
    return reject('DOWNLOAD_TOO_LARGE');
  if(typeof doc?.createElement!=='function'||
      typeof doc?.body?.append!=='function'||
      typeof urlApi?.createObjectURL!=='function'||
      typeof urlApi?.revokeObjectURL!=='function'||
      typeof BlobCtor!=='function')
    return reject('DOWNLOAD_UNSUPPORTED');
  let timestamp;
  try {timestamp=now();} catch {return reject('DOWNLOAD_CLOCK_UNAVAILABLE');}
  if(!Number.isFinite(timestamp)||timestamp<0)
    return reject('DOWNLOAD_CLOCK_UNAVAILABLE');
  const pending=pendingFor(urlApi);
  // A mobile WebView may suppress timers indefinitely. Retry expired cleanup
  // on the next explicit download request, but never revoke a young URL.
  for(const entry of pending){
    if(entry.expiresAt<=timestamp)tryRevoke(urlApi,pending,entry);
  }
  if(pending.size>=MAX_PENDING_SAVE_DOWNLOADS)
    return reject('DOWNLOAD_LIMIT_REACHED');

  let objectUrl=null,link=null,clicked=false;
  try {
    const blob=new BlobCtor([prepared.content],{type:prepared.mime});
    if(!Number.isFinite(blob.size)||blob.size>MAX_DOWNLOAD_BYTES)
      return reject('DOWNLOAD_TOO_LARGE');
    objectUrl=urlApi.createObjectURL(blob);
    if(typeof objectUrl!=='string'||!objectUrl.startsWith('blob:'))
      throw new Error('INVALID_OBJECT_URL');
    link=doc.createElement('a');
    link.href=objectUrl;
    link.download=prepared.filename;
    doc.body.append(link);
    link.click();
    clicked=true;
  } catch {
    if(objectUrl){try{urlApi.revokeObjectURL(objectUrl);}catch{ /* Best effort. */ }}
    return reject('DOWNLOAD_REQUEST_FAILED');
  } finally {
    try{link?.remove();}catch{ /* Do not undo an already requested download. */ }
  }
  if(!clicked)return reject('DOWNLOAD_REQUEST_FAILED');
  const entry={url:objectUrl,expiresAt:timestamp+DOWNLOAD_URL_LIFETIME_MS};
  pending.add(entry);
  let armed=false,ranEarly=false;
  try {
    if(typeof schedule!=='function')throw new Error('NO_DOWNLOAD_TIMER');
    schedule(()=>{
      // A broken synchronous timer must not revoke before the browser has
      // processed the anchor click; retry after TTL on a later request.
      if(!armed){ranEarly=true;return;}
      tryRevoke(urlApi,pending,entry);
    },DOWNLOAD_URL_LIFETIME_MS);
    armed=true;
    return Object.freeze({ok:true,cleanupDeferred:ranEarly});
  } catch {
    return Object.freeze({ok:true,cleanupDeferred:true});
  }
}
