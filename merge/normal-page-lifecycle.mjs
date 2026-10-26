/**
 * V3.1 P2.63: read-only browser lifecycle bridge for the locked normal-mode
 * page runtime. It does not start or persist a game. Wire it only when ALL
 * four writers in main.mjs migrate to createNormalPageRuntime together.
 */
import {SAVE_KEY} from './storage.mjs';

const reject=reason=>Object.freeze({ok:false,reason});
const unchanged=Object.freeze({ok:true,changed:false,skipped:true});

/**
 * @param {object} options
 * @param {object} options.runtime createNormalPageRuntime controller
 * @param {Window} options.win window (injected for tests)
 * @param {Document} options.doc document (injected for tests)
 * @param {Storage} options.storage normal-mode localStorage area
 * @param {function} options.cancelGesture synchronously drops an old pointer
 * @param {function} options.onResult synchronous UI status/update hook
 */
export function attachNormalPageLifecycle({
  runtime,win,doc,storage,cancelGesture=()=>{},onResult=()=>{}
}={}) {
  if(!runtime||typeof runtime.reconcile!=='function'||
      typeof runtime.invalidate!=='function'||typeof runtime.block!=='function'||
      !win||typeof win.addEventListener!=='function'||
      typeof win.removeEventListener!=='function'||
      !doc||typeof doc.addEventListener!=='function'||
      typeof doc.removeEventListener!=='function'||
      typeof storage?.getItem!=='function'||
      typeof cancelGesture!=='function'||typeof onResult!=='function')
    throw new TypeError('INVALID_NORMAL_PAGE_LIFECYCLE');

  let detached=false,handling=false;
  const cancel=()=>{
    const result=cancelGesture();
    if(result&&typeof result.then==='function') {
      void Promise.resolve(result).catch(()=>{});
      throw new Error('ASYNC_GESTURE_CANCELLATION');
    }
  };
  const notify=(result,source)=>{
    const response=onResult(result,source);
    if(response&&typeof response.then==='function'){
      void Promise.resolve(response).catch(()=>{});
      throw new Error('ASYNC_LIFECYCLE_NOTIFICATION');
    }
  };
  const fail=(reason,source)=>{
    runtime.block(reason);
    try {cancel();} catch { /* Runtime already blocked. */ }
    try {notify(reject(reason),source);} catch { /* Never unlock on UI error. */ }
    return reject(reason);
  };

  const inspect=(source='manual')=>{
    if(detached||doc.hidden||runtime.phase!=='ready')return unchanged;
    if(handling)return fail('LIFECYCLE_REENTRANT',source);
    handling=true;
    try {
      // Read-only preflight. Cancel the gesture BEFORE adopting a changed
      // board; the runtime independently re-reads and validates the save.
      let current;
      try {current=storage.getItem(SAVE_KEY);}
      catch {return fail('STORAGE_UNAVAILABLE',source);}
      if(current!==runtime.raw)cancel();
      const result=runtime.reconcile();
      if(!result?.ok) {
        cancel();
        notify(result||reject('LIFECYCLE_RECONCILE_FAILED'),source);
        return result||reject('LIFECYCLE_RECONCILE_FAILED');
      }
      if(result.changed)notify(result,source);
      // The UI callback must not replace the save after reconciliation.
      if(storage.getItem(SAVE_KEY)!==runtime.raw||
         runtime.phase!=='ready'||runtime.blocked)
        return fail('LIFECYCLE_INVALIDATED',source);
      return result;
    } catch {return fail('LIFECYCLE_HANDLER_FAILED',source);}
    finally {handling=false;}
  };

  const storageChanged=event=>{
    if(detached||event?.storageArea!==storage||
        (event.key!==SAVE_KEY&&event.key!==null))return;
    inspect('storage');
  };
  const visibilityChanged=()=>{
    if(detached)return;
    if(doc.hidden) {
      try {cancel();} catch {runtime.block('LIFECYCLE_HANDLER_FAILED');}
      runtime.invalidate();
    } else inspect('visible');
  };
  const pageHidden=()=>{
    if(detached)return;
    try {cancel();} catch {runtime.block('LIFECYCLE_HANDLER_FAILED');}
    runtime.invalidate();
  };
  const pageShown=event=>{
    if(!detached&&event?.persisted===true&&!doc.hidden)inspect('bfcache');
  };
  const focused=()=>{if(!detached&&!doc.hidden)inspect('focus');};

  win.addEventListener('storage',storageChanged);
  win.addEventListener('pagehide',pageHidden);
  win.addEventListener('pageshow',pageShown);
  win.addEventListener('focus',focused);
  doc.addEventListener('visibilitychange',visibilityChanged);

  return Object.freeze({
    inspect,
    detach(){
      if(detached)return;
      detached=true;
      win.removeEventListener('storage',storageChanged);
      win.removeEventListener('pagehide',pageHidden);
      win.removeEventListener('pageshow',pageShown);
      win.removeEventListener('focus',focused);
      doc.removeEventListener('visibilitychange',visibilityChanged);
    }
  });
}
