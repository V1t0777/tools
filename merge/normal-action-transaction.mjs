/**
 * P2.46: locked ordinary gameplay action -> verified local snapshot.
 * Deliberately NOT wired into the current synchronous UI. Every writer,
 * including startup migration, reset and timer, must migrate together.
 */
import {withNormalSaveLock} from './normal-save-lock.mjs';
import {advanceTime} from './engine.mjs';
import {peekLocalV3} from './storage.mjs';
import {commitNormalSnapshot} from './save-transaction.mjs';

const reject=reason=>Object.freeze({ok:false,reason});

/**
 * action is a synchronous, side-effect-free engine operation. It runs ONLY
 * after the lock is acquired and the exact trusted baseline is re-read.
 * The returned state must not be published until exact storage readback.
 * This helper never performs a reset, migration, network call or cloud sync.
 */
export async function commitNormalActionWithLock(locks,storage,{expectedRaw,action}={}) {
  if(typeof expectedRaw!=='string')return reject('NO_TRUSTED_BASELINE');
  if(typeof action!=='function')return reject('INVALID_ACTION');
  return withNormalSaveLock(locks,()=>{
    const current=peekLocalV3(storage);
    if(!current.ok)return reject(current.reason);
    if(current.raw!==expectedRaw)return reject('STALE_BASELINE');
    const result=action(current.state);
    if(result && typeof result.then==='function')
      return reject('ASYNC_ACTION_NOT_ALLOWED');
    if(!result || result.ok!==true)
      return reject('ACTION_REJECTED');
    const receipt=commitNormalSnapshot(storage,result.state,{expectedRaw:current.raw});
    if(!receipt.ok)return receipt;
    return Object.freeze({...receipt,state:result.state,
      message:typeof result.message==='string'?result.message:''});
  });
}

/**
 * P2.47: a future ordinary-mode energy/cooldown tick runs under the SAME
 * exclusive lock as gameplay. A no-op tick never rewrites the save.
 * Deliberately not wired into the synchronous page until ALL writers migrate.
 */
export async function commitNormalClockWithLock(locks,storage,{expectedRaw,now=Date.now()}={}) {
  if(typeof expectedRaw!=='string')return reject('NO_TRUSTED_BASELINE');
  if(!Number.isFinite(now)||now<0)return reject('INVALID_CLOCK');
  return withNormalSaveLock(locks,()=>{
    const current=peekLocalV3(storage);
    if(!current.ok)return reject(current.reason);
    if(current.raw!==expectedRaw)return reject('STALE_BASELINE');
    const next=advanceTime(current.state,now);
    if(next===current.state)
      return Object.freeze({ok:true,status:'CLOCK_UNCHANGED',changed:false,
        raw:current.raw,state:current.state,verifiedBaseline:true});
    const receipt=commitNormalSnapshot(storage,next,{expectedRaw:current.raw});
    if(!receipt.ok)return receipt;
    return Object.freeze({...receipt,changed:true,state:next});
  });
}
