/**
 * P2.49: a fail-closed, Web-Lock-coordinated ordinary-mode startup boundary.
 * Deliberately NOT wired into main.mjs until every ordinary writer migrates.
 * Existing loadLocal() may write legacy backups/migrations; therefore it MUST
 * execute inside the SAME lock as action, clock and reset transactions.
 */
import {loadLocal,SAVE_KEY} from './storage.mjs';
import {prepareNormalStartup} from './startup-persist.mjs';
import {withNormalSaveLock} from './normal-save-lock.mjs';

const reject = (reason, attempted=false) =>
  Object.freeze({ok:false,blocked:true,reason,attempted});

/**
 * On success, state/raw are verified against the actual stored V3 snapshot.
 * On uncertainty, NEVER expose a candidate state for UI publication.
 * The lock alone cannot protect against older uncoordinated page writers.
 */
export async function prepareNormalStartupWithLock(locks,storage,{
  now=Date.now(),canStart=()=>true
}={}) {
  if(!Number.isFinite(now)||now<0)return reject('INVALID_CLOCK');
  if(typeof canStart!=='function')return reject('STARTUP_INVALIDATED');
  const permitted=()=>{try{return canStart()===true;}catch{return false;}};
  return withNormalSaveLock(locks,()=>{
    // Pagehide can invalidate startup while Web Locks is still pending.
    // Check only after acquiring the lock; a stale page must not migrate,
    // create, or advance a save when the delayed callback finally runs.
    if(!permitted())return reject('STARTUP_INVALIDATED');
    if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
      return reject('STORAGE_UNAVAILABLE');
    // Browser/storage callbacks may synchronously dispatch pagehide during
    // a read. Guard EVERY startup write, including legacy backup migration.
    const guardedStorage={
      getItem:key=>storage.getItem(key),
      setItem:(key,value)=>{
        if(!permitted())throw new Error('STARTUP_INVALIDATED');
        return storage.setItem(key,value);
      }
    };
    const loaded=loadLocal(guardedStorage,now);
    if(!permitted())return reject('STARTUP_INVALIDATED',!!loaded.migrated);
    if(loaded.blocked)return reject(loaded.reason||'STARTUP_BLOCKED',!!loaded.migrated);
    const startup=prepareNormalStartup(loaded,guardedStorage,now);
    if(!permitted())return reject('STARTUP_INVALIDATED',
      !!loaded.migrated||!!startup.attempted);
    if(startup.blocked)
      return reject(startup.reason||'STARTUP_SAVE_UNCERTAIN',
        !!loaded.migrated||!!startup.attempted);
    // Also verify the no-write path: another tab or storage shim must not
    // replace a trusted recovered snapshot before we return it to the UI.
    try {
      if(typeof startup.raw!=='string'||storage.getItem(SAVE_KEY)!==startup.raw)
        return reject('STARTUP_READBACK_CHANGED',
          !!loaded.migrated||!!startup.attempted);
    } catch {
      return reject('STARTUP_READBACK_UNAVAILABLE',
        !!loaded.migrated||!!startup.attempted);
    }
    if(!permitted())return reject('STARTUP_INVALIDATED',
      !!loaded.migrated||!!startup.attempted);
    return Object.freeze({ok:true,blocked:false,state:startup.state,
      raw:startup.raw,recovered:loaded.recovered,migrated:!!loaded.migrated,
      attempted:!!loaded.migrated||!!startup.attempted,
      verifiedBaseline:true});
  });
}
