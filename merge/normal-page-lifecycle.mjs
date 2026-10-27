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
  runtime,win,doc,storage,cancelGesture=()=>{},onResult=()=>{},onFocus=()=>{}
}={}) {
  if(!runtime||typeof runtime.reconcile!=='function'||
      typeof runtime.invalidate!=='function'||typeof runtime.block!=='function'||
      !win||typeof win.addEventListener!=='function'||
      typeof win.removeEventListener!=='function'||
      !doc||typeof doc.addEventListener!=='function'||
      typeof doc.removeEventListener!=='function'||
      typeof storage?.getItem!=='function'||
      typeof cancelGesture!=='function'||typeof onResult!=='function'||
      typeof onFocus!=='function')
    throw new TypeError('INVALID_NORMAL_PAGE_LIFECYCLE');

  let detached=false,handling=false,pageGone=false,visibilitySuspended=false,resumePending=false;
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
      visibilitySuspended=true;
      try {cancel();} catch {runtime.block('LIFECYCLE_HANDLER_FAILED');}
      runtime.invalidate();
    } else if(!pageGone||resumePending) {
      // Safari may deliver BFCache pageshow while still hidden. A subsequent
      // visibilitychange is the first safe moment to verify the saved bytes.
      // Never unlock a pagehide merely because visibility became visible.
      const result=inspect(resumePending?'bfcache-visible':'visible');
      if(result.ok&&runtime.phase==='ready') {
        visibilitySuspended=false;
        if(resumePending){pageGone=false;resumePending=false;}
      }
    }
  };
  const pageHidden=()=>{
    if(detached)return;
    // Safari/BFCache may fire pagehide before document.hidden changes.
    pageGone=true;
    resumePending=false;
    try {cancel();} catch {runtime.block('LIFECYCLE_HANDLER_FAILED');}
    runtime.invalidate();
  };
  const pageShown=event=>{
    if(detached||(event?.persisted!==true&&!pageGone))return;
    if(doc.hidden) {
      // Remember only a real return from pagehide; focus/visibility alone
      // must not revive a page that never received pageshow.
      if(pageGone)resumePending=true;
      return;
    }
    const result=inspect('bfcache');
    if(result.ok&&runtime.phase==='ready') {
      pageGone=false;
      visibilitySuspended=false;
      resumePending=false;
    }
  };
  const focused=()=>{
    if(detached||doc.hidden||pageGone)return;
    const result=inspect('focus');
    if(result.ok&&runtime.phase==='ready'){
      visibilitySuspended=false;
      // The normal import chooser may omit native cancel. Reuse this
      // verified focus event rather than installing a second window handler.
      try{
        const response=onFocus();
        if(response&&typeof response.then==='function'){
          void Promise.resolve(response).catch(()=>{});
          throw new Error('ASYNC_FOCUS_CALLBACK');
        }
      }catch{fail('LIFECYCLE_HANDLER_FAILED','focus');}
    }
  };

  win.addEventListener('storage',storageChanged);
  win.addEventListener('pagehide',pageHidden);
  win.addEventListener('pageshow',pageShown);
  win.addEventListener('focus',focused);
  doc.addEventListener('visibilitychange',visibilityChanged);

  return Object.freeze({
    get suspended(){return pageGone||visibilitySuspended||doc.hidden;},
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
