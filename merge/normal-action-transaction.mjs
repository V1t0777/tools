/**
 * P2.46: locked ordinary gameplay action -> verified local snapshot.
 * Deliberately NOT wired into the current synchronous UI. Every writer,
 * including startup migration, reset and timer, must migrate together.
 */
import {withNormalSaveLock} from './normal-save-lock.mjs';
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
