/**
 * P2.45: fail-closed, non-waiting Web Lock boundary for future ordinary-mode
 * save transactions. This module does not change the current synchronous UI.
 * All normal-mode writers must eventually use this SAME lock name, including
 * startup migrations, reset and energy ticks, before cross-tab atomicity can
 * be claimed. Never substitute a localStorage spin lock.
 */
export const NORMAL_SAVE_LOCK_NAME = 'toolbox.merge-isle.normal-save.write-v1';
const reject = reason => Object.freeze({ok:false,reason});

/**
 * Execute a synchronous or asynchronous transaction while holding a browser
 * Web Lock. The transaction must return a receipt with a boolean ok field;
 * it should re-read the save and check its exact baseline INSIDE this callback.
 *
 * ifAvailable rejects a busy lock immediately, rather than queuing a stale
 * gameplay action to be replayed against an unknown later state.
 */
export async function withNormalSaveLock(locks, transaction) {
  if (typeof transaction !== 'function') return reject('INVALID_TRANSACTION');
  if (!locks || typeof locks.request !== 'function')
    return reject('WEB_LOCKS_UNAVAILABLE');
  let callbackSeen = false;
  let callbackRepeated = false;
  let requestSettled = false;
  let expectedResult;
  try {
    const returned = await locks.request(NORMAL_SAVE_LOCK_NAME,
      {mode:'exclusive',ifAvailable:true}, async lock => {
        // A nonconforming provider must not invoke this callback twice or
        // invoke it after its request has already resolved/rejected. In both
        // cases, refuse any additional transaction, including a late write.
        if (callbackSeen || requestSettled) {
          callbackRepeated = true;
          return reject('SAVE_LOCK_CALLBACK_REPEATED');
        }
        callbackSeen = true;
        if (!lock) return (expectedResult = reject('SAVE_LOCK_BUSY'));
        if (lock.name !== NORMAL_SAVE_LOCK_NAME || lock.mode !== 'exclusive')
          return (expectedResult = reject('INVALID_SAVE_LOCK'));
        try {
          const receipt = await transaction();
          expectedResult = receipt && typeof receipt.ok === 'boolean'
            ? receipt : reject('INVALID_TRANSACTION_RECEIPT');
          return expectedResult;
        } catch {
          return (expectedResult = reject('SAVE_TRANSACTION_FAILED'));
        }
      });
    // Do not trust an implementation that claims success without executing the
    // locked callback or returns a different value after releasing the lock.
    requestSettled = true;
    if (!callbackSeen || callbackRepeated || returned !== expectedResult)
      return reject('SAVE_LOCK_OUTCOME_UNCERTAIN');
    return returned;
  } catch {
    requestSettled = true;
    return reject('SAVE_LOCK_REQUEST_FAILED');
  }
}
