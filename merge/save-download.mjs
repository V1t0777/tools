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
// A wall-clock correction can jump forward while Safari is still consuming
// a Blob URL. Prefer elapsed monotonic time so a download is never revoked
// early solely because the device time was changed. Older browsers fall back
// to Date.now; a present but broken performance clock fails closed.
const readDownloadClock=()=>{
  const clock=globalThis.performance;
  return typeof clock?.now==='function'
    ?Math.floor(clock.now()):Date.now();
};

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
  now=readDownloadClock,
  authorizeClick
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
  if(authorizeClick!==undefined&&typeof authorizeClick!=='function')
    return reject('DOWNLOAD_AUTHORIZATION_UNAVAILABLE');
  let timestamp;
  try {timestamp=now();} catch {return reject('DOWNLOAD_CLOCK_UNAVAILABLE');}
  if(!Number.isSafeInteger(timestamp)||timestamp<0||
      timestamp>Number.MAX_SAFE_INTEGER-DOWNLOAD_URL_LIFETIME_MS)
    return reject('DOWNLOAD_CLOCK_UNAVAILABLE');
  const pending=pendingFor(urlApi);
  // A mobile WebView may suppress timers indefinitely. Retry expired cleanup
  // on the next explicit download request, but never revoke a young URL.
  for(const entry of pending){
    // A nested/re-entrant download can run while a prior Blob is still being
    // constructed. Never reclaim its reserved quota before it has a URL.
    if(entry.url&&entry.expiresAt<=timestamp)tryRevoke(urlApi,pending,entry);
  }
  if(pending.size>=MAX_PENDING_SAVE_DOWNLOADS)
    return reject('DOWNLOAD_LIMIT_REACHED');

  // Reserve before creating a Blob or clicking an anchor: nested click handlers
  // must not bypass the bounded number of outstanding object URLs.
  const entry={url:null,expiresAt:timestamp+DOWNLOAD_URL_LIFETIME_MS};
  pending.add(entry);
  let objectUrl=null,link=null,clicked=false,failedReason='DOWNLOAD_REQUEST_FAILED';
  try {
    const blob=new BlobCtor([prepared.content],{type:prepared.mime});
    if(!Number.isFinite(blob.size)||blob.size>MAX_DOWNLOAD_BYTES){
      pending.delete(entry);
      return reject('DOWNLOAD_TOO_LARGE');
    }
    objectUrl=urlApi.createObjectURL(blob);
    if(typeof objectUrl!=='string'||!objectUrl.startsWith('blob:'))
      throw new Error('INVALID_OBJECT_URL');
    entry.url=objectUrl;
    link=doc.createElement('a');
    link.href=objectUrl;
    link.download=prepared.filename;
    doc.body.append(link);
    // Recheck after all synchronous Blob/DOM preparation but before the
    // native click. This reduces the stale cross-tab/lifecycle window; it
    // does not claim an atomic snapshot across browser processes.
    if(authorizeClick){
      let authorized=false;
      try{authorized=authorizeClick()===true;}catch{/* Fail closed. */}
      if(!authorized){
        failedReason='DOWNLOAD_SOURCE_CHANGED';
        throw new Error('STALE_DOWNLOAD_SOURCE');
      }
    }
    link.click();
    clicked=true;
  } catch {
    // A failed revoke is not a released Blob URL. Keep it in the bounded
    // registry until a retry succeeds; otherwise repeated blocked clicks
    // can allocate an unbounded number of untracked URLs on mobile WebViews.
    if(entry.url){
      if(!tryRevoke(urlApi,pending,entry)&&typeof schedule==='function'){
        try{schedule(()=>tryRevoke(urlApi,pending,entry),DOWNLOAD_URL_LIFETIME_MS);}catch{}
      }
    }else pending.delete(entry);
    return reject(failedReason);
  } finally {
    try{link?.remove();}catch{ /* Do not undo an already requested download. */ }
  }
  if(!clicked){pending.delete(entry);return reject('DOWNLOAD_REQUEST_FAILED');}
  let armed=false,ranEarly=false,retries=1,revokeRetries=1;
  const cleanup=()=>{
    if(!armed){ranEarly=true;return;}
    let current;
    try{current=now();}catch{return;}
    // Some WebViews fire callbacks too early. Do not revoke before the
    // monotonic deadline, even if the device wall clock jumps forward.
    if(!Number.isFinite(current)||current<entry.expiresAt){
      if(Number.isFinite(current)&&retries-->0){
        try{schedule(cleanup,Math.max(1,Math.min(
          DOWNLOAD_URL_LIFETIME_MS,entry.expiresAt-current)));}catch{}
      }
      return;
    }
    if(!tryRevoke(urlApi,pending,entry)&&revokeRetries-->0){
      try{schedule(cleanup,DOWNLOAD_URL_LIFETIME_MS);}catch{}
    }
  };
  try {
    if(typeof schedule!=='function')throw new Error('NO_DOWNLOAD_TIMER');
    schedule(cleanup,DOWNLOAD_URL_LIFETIME_MS);
    armed=true;
    // A synchronous timer callback ran before arming and was discarded.
    // Re-arm once without unbounded recursion on broken timer shims.
    if(ranEarly){try{schedule(cleanup,DOWNLOAD_URL_LIFETIME_MS);}catch{}}
    return Object.freeze({ok:true,cleanupDeferred:ranEarly});
  } catch {
    return Object.freeze({ok:true,cleanupDeferred:true});
  }
}
