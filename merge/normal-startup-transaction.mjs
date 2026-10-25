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
export async function prepareNormalStartupWithLock(locks,storage,{now=Date.now()}={}) {
  if(!Number.isFinite(now)||now<0)return reject('INVALID_CLOCK');
  return withNormalSaveLock(locks,()=>{
    if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
      return reject('STORAGE_UNAVAILABLE');
    const loaded=loadLocal(storage,now);
    if(loaded.blocked)return reject(loaded.reason||'STARTUP_BLOCKED',!!loaded.migrated);
    const startup=prepareNormalStartup(loaded,storage,now);
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
    return Object.freeze({ok:true,blocked:false,state:startup.state,
      raw:startup.raw,recovered:loaded.recovered,migrated:!!loaded.migrated,
      attempted:!!loaded.migrated||!!startup.attempted,
      verifiedBaseline:true});
  });
}
