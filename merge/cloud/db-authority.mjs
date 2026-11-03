/** Server-only orchestration for a future authenticated Supabase Edge endpoint.
 * Storage contract: open(uid, seed), findOperation(uid, operationId),
 * commit({uid, command, hash, result, now}), all authenticated on the server.
 */
import { createInitialState, validateSave } from '../engine.mjs';
import { normalizeCommand, planTrustedTransition, secureRandom } from './authority.mjs';

const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function hashOperation(command) {
  if (!globalThis.crypto?.subtle) throw Error('WebCrypto unavailable');
  const bytes = new TextEncoder().encode(JSON.stringify(command));
  const digest = await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export function createDatabaseAuthority(repository, {clock=()=>Date.now(),rng=secureRandom}={}) {
  if (!repository || ['open','findOperation','commit'].some(k=>typeof repository[k]!=='function')) throw Error('Missing trusted repository');
  const verified = uid => typeof uid==='string' && UID.test(uid);
  async function open(uid, time) {
    const current = await repository.open(uid,createInitialState(time));
    if (!current || !validateSave(current.state) || current.revision !== current.state.revision)
      throw Error('Invalid authoritative snapshot');
    return current;
  }
  return {
    async read(verifiedUid) {
      if (!verified(verifiedUid)) return {ok:false,status:'rejected',code:'AUTH_REQUIRED'};
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid server clock');
      const current = await open(verifiedUid,now);
      return {ok:true,status:'ok',revision:current.revision,state:current.state};
    },
    async execute(verifiedUid, rawCommand) {
      if (!verified(verifiedUid)) return {ok:false,status:'rejected',code:'AUTH_REQUIRED'};
      const command=normalizeCommand(rawCommand);
      if (!command) return {ok:false,status:'rejected',code:'BAD_COMMAND'};
      const now=clock();
      if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid server clock');
      const hash=await hashOperation(command);
      const existing=await repository.findOperation(verifiedUid,command.operationId);
      if (existing) {
        const current=await open(verifiedUid,now);
        return existing.request_hash===hash ? {status:'replayed',ok:existing.status==='applied',
          code:existing.code,revision:current.revision,state:current.state,original:existing.response}
          : {status:'rejected',ok:false,code:'OPERATION_ID_REUSE',revision:current.revision,state:current.state};
      }
      const current=await open(verifiedUid,now);
      if (current.revision!==command.expectedRevision)
        return {status:'conflict',ok:false,code:'REVISION_CONFLICT',revision:current.revision,state:current.state};
      const result=planTrustedTransition(current.state,command,{now,rng});
      // Atomic CAS in SQL rechecks both revision AND duplicate ID after row lock.
      const committed=await repository.commit({uid:verifiedUid,command,hash,result,now});
      if (!committed || !validateSave(committed.state) || committed.revision!==committed.state.revision)
        throw Error('Invalid authoritative commit response');
      return committed;
    }
  };
}