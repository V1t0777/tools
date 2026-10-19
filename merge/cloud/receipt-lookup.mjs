/**
 * P3.16 future server-only, read-only receipt endpoint core.
 * The caller MUST derive verifiedUid from an authenticated JWT, never request
 * parameters. Repository and limiter MUST be trusted service-side adapters.
 * No cloud write, save creation, command replay, reward, or recovery permission.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const blocked = (code, httpStatus) => Object.freeze({ok:false,code,httpStatus});
const missing = () => Object.freeze({
  ok:true,status:'not-found',receipt:null,
  // Not-found is only a point-in-time observation. A historical operation
  // may have been pruned or committed without the browser receiving an ACK.
  canReplay:false,canReset:false,canResumeCloudWrites:false
});

/**
 * Explicit fail-closed, service-side quota dependency. Do not replace with an
 * in-memory limiter in production: Edge instances are distributed/restarted.
 * SQL draft uses an atomic per-user fixed-window gate, never the client IP.
 */
export function createReceiptLookupService({repository,limiter}={}) {
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

      let permitted;
      try {permitted=await limiter.consume(uid);}
      catch {return blocked('RECEIPT_SERVICE_UNAVAILABLE',503);}
      if (permitted !== true) return permitted===false ?
        blocked('RECEIPT_RATE_LIMITED',429) :
        blocked('RECEIPT_SERVICE_UNAVAILABLE',503);

      let record;
      try {record=await repository.findOperation(uid,id);}
      catch {return blocked('RECEIPT_SERVICE_UNAVAILABLE',503);}
      if (record===null) return missing();
      // Do not reflect arbitrary repository values, snapshots, user IDs,
      // operation IDs, server exceptions, raw SQL, or full response payloads.
      if (!plain(record) || !HASH.test(record.request_hash) ||
          !['applied','rejected'].includes(record.status))
        return blocked('RECEIPT_SERVICE_UNAVAILABLE',503);
      return Object.freeze({
        ok:true,status:'found',
        receipt:Object.freeze({request_hash:record.request_hash,status:record.status}),
        canReplay:false,canReset:false,canResumeCloudWrites:false
      });
    }
  });
}
