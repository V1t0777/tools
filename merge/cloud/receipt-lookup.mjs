import {validateReceiptRow} from './receipt-row.mjs';
/**
 * P3.22: strict receipt validation for a future server-only read endpoint.
 * Verified user identity and durable rate limiter are required.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const blocked = (code, httpStatus) => Object.freeze({ok:false,code,httpStatus});
const missing = () => Object.freeze({
  ok:true,status:'not-found',receipt:null,
  canReplay:false,canReset:false,canResumeCloudWrites:false
});

export function createReceiptLookupService({repository,limiter,deadlineMs=5_000,now=()=>performance.now()}={}) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30_000)
    throw Error('Invalid receipt deadline');
  if (typeof now!=='function') throw Error('Invalid monotonic clock');
  // Quota and receipt share one monotonic deadline, never two full budgets.
  async function bounded(task,deadlineAt) {
    const remaining=deadlineAt-now();
    if (remaining<=0) throw Error('Receipt deadline exceeded');
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(task),
        new Promise((_,reject)=>{
          timer=setTimeout(()=>reject(Error('Receipt deadline exceeded')),remaining);
        })
      ]);
    } finally {clearTimeout(timer);}
  }
  if (typeof repository?.findOperation !== 'function' ||
      typeof limiter?.consume !== 'function')
    throw Error('Trusted read-only repository and durable limiter required');

  return Object.freeze({
    async read(verifiedUid,operationId) {
      if (typeof verifiedUid !== 'string' || !UUID.test(verifiedUid))
        return blocked('AUTH_REQUIRED',401);
      if (typeof operationId !== 'string' || !UUID.test(operationId))
        return blocked('INVALID_OPERATION_ID',400);
      const uid=verifiedUid.toLowerCase();
      const id=operationId.toLowerCase();

      const deadlineAt=now()+deadlineMs;
      let permitted;
      try {permitted=await bounded(()=>limiter.consume(uid),deadlineAt);}
      catch {return blocked('RECEIPT_SERVICE_UNAVAILABLE',503);}
      if (permitted !== true) return permitted===false ?
        blocked('RECEIPT_RATE_LIMITED',429) :
        blocked('RECEIPT_SERVICE_UNAVAILABLE',503);

      let record;
      try {record=await bounded(()=>repository.findOperation(uid,id),deadlineAt);}
      catch {return blocked('RECEIPT_SERVICE_UNAVAILABLE',503);}
      if (record===null) return missing();
      const receipt=validateReceiptRow(record);
      if (!receipt) return blocked('RECEIPT_SERVICE_UNAVAILABLE',503);
      return Object.freeze({
        ok:true,status:'found',receipt,
        canReplay:false,canReset:false,canResumeCloudWrites:false
      });
    }
  });
}
