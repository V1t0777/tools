/**
 * P2.50: local single-flight gate for future asynchronous ordinary-mode UI.
 * It never writes storage or publishes state by itself; callers must use the
 * locked startup/action/clock/reset transactions and provide a publish hook.
 * Not yet connected to main.mjs: all normal writers must switch together.
 * P2.52: uncertain transaction outcomes permanently block subsequent UI work.
 * P2.53: invalidated in-flight outcomes also require a fresh page/revalidation.
 */
const reject=reason=>Object.freeze({ok:false,reason});
// P2.52: only failures known to occur before any write may be retried.
// Unknown errors, stale baselines and uncertain receipts must close the gate.
const SAFE_NO_WRITE_REJECTIONS=new Set([
  'ACTION_REJECTED','SAVE_LOCK_BUSY','WEB_LOCKS_UNAVAILABLE',
  'RESET_NOT_CONFIRMED','INVALID_CLOCK','INVALID_ACTION',
  'ASYNC_ACTION_NOT_ALLOWED','INVALID_BACKUP_POLICY','INVALID_RESET_FLAG',
  'LOCK_BUSY','LOCKS_UNAVAILABLE','LOCK_INVALID','LOCK_FAILED'
]);

export function createNormalUiFlight() {
  let busy=false,epoch=0,blocked=false;
  const blockUncertain=()=>{if(!blocked){blocked=true;epoch++;}};
  return Object.freeze({
    get busy(){return busy;},
    get blocked(){return blocked;},
    /** Permanent fail-closed stop after a storage conflict or uncertain save.
     * A new gate must be created only after the page reopens/revalidates.
     */
    block(){blockUncertain();},
    /** Invalidate a pending result after cross-tab conflict, page hide/reset. */
    invalidate(){epoch++;},
    /**
     * Do not replay or queue clicks while an async save is in flight.
     * Only a verified receipt with state + exact raw bytes may reach publish.
     * A successful write that is invalidated mid-flight is NOT published:
     * the page must re-read/reopen rather than assume it was rolled back.
     */
    async run(transaction,publish) {
      if(blocked)return reject('UI_SAVE_BLOCKED');
      if(busy)return reject('UI_TRANSACTION_BUSY');
      if(typeof transaction!=='function'||typeof publish!=='function')
        return reject('INVALID_UI_TRANSACTION');
      busy=true;
      const startedAt=epoch;
      try {
        let receipt;
        try {receipt=await transaction();}
        catch {blockUncertain();return reject('UI_TRANSACTION_FAILED');}
        if(blocked)return reject('UI_SAVE_BLOCKED');
        // P2.53: invalidation can happen AFTER a write but BEFORE publication.
        // Even a subsequently returned pre-write rejection cannot prove the
        // page's old baseline is safe after a cross-tab or lifecycle change.
        // A fresh page/revalidation is required; never silently resume.
        if(startedAt!==epoch) {
          blockUncertain();
          return reject('UI_TRANSACTION_INVALIDATED');
        }
        if(!receipt||receipt.ok!==true) {
          const reason=receipt?.ok===false&&typeof receipt.reason==='string'
            ?receipt.reason:'UI_TRANSACTION_REJECTED';
          if(!SAFE_NO_WRITE_REJECTIONS.has(reason))blockUncertain();
          return reject(reason);
        }
        if(typeof receipt.raw!=='string'||!receipt.state||
            (receipt.verifiedReadback!==true&&
             receipt.verifiedBaseline!==true)) {
          blockUncertain();
          return reject('UI_RECEIPT_NOT_VERIFIED');
        }
        try {
          const publication=publish(receipt.state,receipt.raw,receipt);
          // UI publication must be synchronous. An async callback can reject
          // after this flight has returned, leaving a falsely successful UI.
          // It may already have side effects, so permanently block further
          // actions and observe its rejection to avoid an unhandled promise.
          if(publication && typeof publication.then==='function') {
            void Promise.resolve(publication).catch(()=>{});
            blockUncertain();
            return reject('UI_ASYNC_PUBLISH_NOT_ALLOWED');
          }
        } catch {blockUncertain();return reject('UI_PUBLISH_FAILED');}
        // P2.55: a synchronous publish hook can itself invalidate or block
        // this flight (for example, when an integration detects a conflict).
        // It may already have changed the DOM, so never report success or
        // allow further writes until the page is revalidated.
        if(blocked)return reject('UI_SAVE_BLOCKED');
        if(startedAt!==epoch) {
          blockUncertain();
          return reject('UI_TRANSACTION_INVALIDATED');
        }
        return Object.freeze({ok:true,status:'UI_PUBLISHED'});
      } finally {busy=false;}
    }
  });
}
