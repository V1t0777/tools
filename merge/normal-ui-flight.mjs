/**
 * P2.50: local single-flight gate for future asynchronous ordinary-mode UI.
 * It never writes storage or publishes state by itself; callers must use the
 * locked startup/action/clock/reset transactions and provide a publish hook.
 * Not yet connected to main.mjs: all normal writers must switch together.
 */
const reject=reason=>Object.freeze({ok:false,reason});

export function createNormalUiFlight() {
  let busy=false,epoch=0;
  return Object.freeze({
    get busy(){return busy;},
    /** Invalidate a pending result after cross-tab conflict, page hide/reset. */
    invalidate(){epoch++;},
    /**
     * Do not replay or queue clicks while an async save is in flight.
     * Only a verified receipt with state + exact raw bytes may reach publish.
     * A successful write that is invalidated mid-flight is NOT published:
     * the page must re-read/reopen rather than assume it was rolled back.
     */
    async run(transaction,publish) {
      if(busy)return reject('UI_TRANSACTION_BUSY');
      if(typeof transaction!=='function'||typeof publish!=='function')
        return reject('INVALID_UI_TRANSACTION');
      busy=true;
      const startedAt=epoch;
      try {
        let receipt;
        try {receipt=await transaction();}
        catch {return reject('UI_TRANSACTION_FAILED');}
        if(startedAt!==epoch)return reject('UI_TRANSACTION_INVALIDATED');
        if(!receipt||receipt.ok!==true)return receipt?.ok===false&&typeof receipt.reason==='string'
          ?reject(receipt.reason):reject('UI_TRANSACTION_REJECTED');
        if(typeof receipt.raw!=='string'||!receipt.state||
            (receipt.verifiedReadback!==true&&
             receipt.verifiedBaseline!==true&&
             !(receipt.changed===false&&receipt.status==='CLOCK_UNCHANGED')))
          return reject('UI_RECEIPT_NOT_VERIFIED');
        try {publish(receipt.state,receipt.raw,receipt);}
        catch {return reject('UI_PUBLISH_FAILED');}
        return Object.freeze({ok:true,status:'UI_PUBLISHED'});
      } finally {busy=false;}
    }
  });
}
